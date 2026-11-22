import { formatRoomHash, generateRoomCredentials, type RoomCredentials } from "./room-auth";
import { boardStorageKey } from "./storage-keys";
import {
  MAX_STORAGE_BYTES,
  parseStoredBoardSnapshot,
  type StoredBoardSnapshot,
} from "./sync-validation";

/** `#import=<base64url(gzip(JSON StoredBoardSnapshot))>`, no padding. The fragment never reaches the server. */
export const IMPORT_HASH_PREFIX = "#import=";
export const MAX_IMPORT_PAYLOAD_CHARS = 64 * 1024;
export const BOARD_FILE_FORMAT = "skot-board/1";
const OPENABLE_FILE_FORMATS = new Set([BOARD_FILE_FORMAT, "skot-bot-scene/1"]);
const MAX_BOARD_FILE_CHARS = 4 * MAX_STORAGE_BYTES;
const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function hasImportHash(hash: string): boolean {
  return hash.startsWith(IMPORT_HASH_PREFIX);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function pipeThrough(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): ReadableStream<Uint8Array> {
  return new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
}

/** The part of a snapshot that a fresh room needs: no tombstones, epochs or revisions of the source room. */
function portableSnapshot(snapshot: StoredBoardSnapshot): StoredBoardSnapshot {
  return snapshot.boardTitle === undefined
    ? { elements: snapshot.elements }
    : { elements: snapshot.elements, boardTitle: snapshot.boardTitle };
}

export async function encodeImportHash(snapshot: StoredBoardSnapshot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(portableSnapshot(snapshot)));
  const gz = await readCapped(pipeThrough(json, new CompressionStream("gzip")), Number.MAX_SAFE_INTEGER);
  return IMPORT_HASH_PREFIX + bytesToBase64Url(gz ?? new Uint8Array());
}

export async function decodeImportHash(hash: string): Promise<StoredBoardSnapshot | null> {
  if (!hasImportHash(hash)) return null;
  const payload = hash.slice(IMPORT_HASH_PREFIX.length).replace(/=+$/, "");
  if (payload.length === 0 || payload.length > MAX_IMPORT_PAYLOAD_CHARS) return null;
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  try {
    const json = await readCapped(pipeThrough(bytes, new DecompressionStream("gzip")), MAX_STORAGE_BYTES);
    if (!json) return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(json);
    return parseStoredBoardSnapshot(text);
  } catch {
    return null;
  }
}

/** Accepts `{format: "skot-board/1" | "skot-bot-scene/1", snapshot}` or a bare snapshot. */
export function parseBoardFile(text: string): StoredBoardSnapshot | null {
  if (text.length === 0 || text.length > MAX_BOARD_FILE_CHARS) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  const record = decoded as Record<string, unknown>;
  if (FORBIDDEN_KEYS.some((key) => Object.hasOwn(record, key))) return null;
  if (!("format" in record)) return parseStoredBoardSnapshot(text);
  if (typeof record.format !== "string" || !OPENABLE_FILE_FORMATS.has(record.format)) return null;
  if (!record.snapshot || typeof record.snapshot !== "object") return null;
  return parseStoredBoardSnapshot(JSON.stringify(record.snapshot));
}

export function buildBoardFile(snapshot: StoredBoardSnapshot): string {
  return JSON.stringify({ format: BOARD_FILE_FORMAT, snapshot: portableSnapshot(snapshot) }, null, 2);
}

/** Creates a fresh room whose saved board is `snapshot`; the normal restore path then loads it. */
export function stageImportedBoard(
  snapshot: StoredBoardSnapshot,
  storage: Pick<Storage, "setItem">
): RoomCredentials {
  const creds = generateRoomCredentials();
  storage.setItem(
    boardStorageKey(creds.roomId),
    JSON.stringify({ ...portableSnapshot(snapshot), hasLocalEdits: true, editedAt: Date.now() })
  );
  return creds;
}

/** Resolves an `#import=` fragment to the `#room=…&k=…` fragment of a fresh room holding the board, or null. */
export async function openImportHash(
  hash: string,
  storage: Pick<Storage, "setItem">
): Promise<string | null> {
  const snapshot = await decodeImportHash(hash);
  if (!snapshot) return null;
  const creds = stageImportedBoard(snapshot, storage);
  return formatRoomHash(creds.roomId, creds.roomSecret);
}

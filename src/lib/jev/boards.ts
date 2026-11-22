import { appUrl, normalizeBasePath } from "@/lib/base-path";
import { practiceStorageKey } from "./practice-session";
import { DEFAULT_BOARD_TITLE } from "./prediction-engine";
import {
  getBeforeRestoreStorageKey,
  getRecoveryStorageKey,
  hasSavedCopies,
  type StorageLike,
} from "./recovery-buffer";
import { boardPath, generateRoomCredentials, ROOM_ID_PATTERN, ROOM_SECRET_PATTERN, type RoomCredentials } from "./room-auth";
import { boardStorageKey } from "./storage-keys";

/*
 * Which board an address opens, and which boards this browser has. The boards are found by their own storage
 * keys: there is no index to fall out of step, to hide an older board or to make room for.
 */

export interface BoardStorage extends StorageLike {
  readonly length: number;
  key(index: number): string | null;
}

/** Boards started here and not yet edited. Nothing is saved for them, so only the newest few are remembered. */
export const NEW_BOARDS_KEY = "jev_new_boards";
export const MAX_NEW_BOARDS = 20;

export function roomSecretStorageKey(roomId: string): string {
  return `jev_room_secret_${roomId}`;
}

export function browserBoardStorage(): BoardStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // reading window.localStorage throws when the browser blocks it
  }
}

export function newBoardPath(): string {
  return appUrl("/new");
}

export interface BoardAddress {
  pathname: string;
  hash: string;
  collab: boolean;
  now: number;
}

/** `id` is null at `/` (the board edited last) and at `/new` (another board). An old `#room=` wins over the path. */
export function readAddress(pathname: string, hash: string) {
  const base = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  const path = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const key = params.get("k") ?? "";
  let id = params.get("room") || null;
  if (id === null) {
    const segment = /^\/b\/([^/]+)\/?$/.exec(path)?.[1] ?? null;
    try {
      id = segment && decodeURIComponent(segment);
    } catch {
      id = segment; // not an escape this app ever wrote: it names no board
    }
  }
  return { id, secret: ROOM_SECRET_PATTERN.test(key) ? key : "", create: /^\/new\/?$/.test(path) };
}

interface BoardData {
  elements: unknown[];
  boardTitle?: unknown;
  editedAt?: unknown;
  [field: string]: unknown;
}

export function parseBoardData(raw: string | null): BoardData | null {
  try {
    const data = JSON.parse(raw ?? "null") as BoardData | null;
    return Array.isArray(data?.elements) ? data : null;
  } catch {
    return null;
  }
}

/** Null if it was never edited. Boards saved before `editedAt` existed go by the newest time they hold. */
export function lastEdited(data: BoardData | null, now: number): number | null {
  if (!data) return null;
  if (typeof data.editedAt === "number" && Number.isFinite(data.editedAt)) return Math.min(data.editedAt, now);
  if (data.elements.length === 0 && !data.hasLocalEdits) return null;
  let newest = 0;
  const consider = (value: unknown) => {
    if (typeof value === "number" && value > newest) newest = value;
  };
  consider(data.baseTimestamp);
  consider(data.boardEpochCreatedAt);
  consider(data.tombstoneHorizonAt);
  for (const element of data.elements as Array<{ updatedAt?: unknown; createdAt?: unknown } | null>) {
    consider(element?.updatedAt ?? element?.createdAt);
  }
  for (const gone of Object.values(data.tombstones ?? {}) as Array<{ deletedAt?: unknown } | null>) {
    consider(gone?.deletedAt);
  }
  return Math.min(newest, now);
}

function isKept(storage: StorageLike, id: string): boolean {
  return (
    storage.getItem(boardStorageKey(id)) !== null ||
    hasSavedCopies(storage, id) ||
    storage.getItem(practiceStorageKey(id)) !== null
  );
}

function practiceStarted(storage: StorageLike, id: string): number | null {
  try {
    const startedAt = JSON.parse(storage.getItem(practiceStorageKey(id)) ?? "null")?.startedAt;
    return typeof startedAt === "number" ? startedAt : null;
  } catch {
    return null;
  }
}

export interface BoardSummary {
  id: string;
  title: string;
  /** Null: never edited, or it can't be told. */
  edited: number | null;
  /** Null: it can't be read. */
  count: number | null;
  unreadable: boolean;
  hasCopies: boolean;
}

/** Every board in this browser, newest edit first. Reads only. */
export function listBoards(storage: BoardStorage | null, now: number): BoardSummary[] {
  if (!storage) return [];
  try {
    const prefixes = [boardStorageKey, getRecoveryStorageKey, getBeforeRestoreStorageKey, practiceStorageKey].map(
      (keyFor) => keyFor("")
    );
    const ids = new Set<string>();
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i) ?? "";
      const prefix = prefixes.find((p) => key.startsWith(p));
      if (prefix && key.length > prefix.length) ids.add(key.slice(prefix.length));
    }

    const boards: BoardSummary[] = [];
    for (const id of ids) {
      if (!isKept(storage, id)) continue;
      const raw = storage.getItem(boardStorageKey(id));
      const data = parseBoardData(raw);
      const unreadable = raw !== null && !data;
      const started = practiceStarted(storage, id);
      boards.push({
        id,
        title: (typeof data?.boardTitle === "string" && data.boardTitle.trim()) || DEFAULT_BOARD_TITLE,
        edited: lastEdited(data, now) ?? (started === null ? null : Math.min(started, now)),
        count: unreadable ? null : (data?.elements.length ?? 0),
        unreadable,
        hasCopies: hasSavedCopies(storage, id),
      });
    }
    return boards.sort(
      (a, b) => (b.edited ?? -1) - (a.edited ?? -1) || Number(b.unreadable) - Number(a.unreadable)
    );
  } catch {
    return [];
  }
}

function readNewBoards(storage: StorageLike | null): RoomCredentials[] {
  try {
    const list: unknown = JSON.parse(storage?.getItem(NEW_BOARDS_KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item) => ROOM_ID_PATTERN.test(item?.roomId ?? "") && ROOM_SECRET_PATTERN.test(item?.roomSecret ?? "")
    );
  } catch {
    return [];
  }
}

function startBoard(storage: StorageLike | null): RoomCredentials {
  const board = generateRoomCredentials();
  try {
    storage?.setItem(NEW_BOARDS_KEY, JSON.stringify([board, ...readNewBoards(storage)].slice(0, MAX_NEW_BOARDS)));
  } catch {
    // no room to remember an empty board: it is saved like any other once it is edited
  }
  return board;
}

export function storeRoomSecret(storage: Pick<Storage, "setItem">, roomId: string, secret: string): void {
  try {
    storage.setItem(roomSecretStorageKey(roomId), secret);
  } catch {
    // the board matters more than its secret: nothing is removed to make room
  }
}

export interface OpenBoard extends RoomCredentials {
  kind: "open";
  url: string;
  /** Started in this browser and not saved yet. */
  createdNew: boolean;
  /** Someone else's board, arriving from a self-hosted share link. */
  joining: boolean;
}

export interface MissingBoardInfo {
  kind: "missing";
  id: string;
  url: string;
  storageBlocked: boolean;
}

export function resolveBoard(
  storage: BoardStorage | null,
  { pathname, hash, collab, now }: BoardAddress
): OpenBoard | MissingBoardInfo {
  let readable = storage;
  try {
    readable?.getItem(NEW_BOARDS_KEY);
  } catch {
    readable = null;
  }

  const address = readAddress(pathname, hash);
  let { id } = address;
  if (id === null) {
    if (!address.create) {
      const last = listBoards(readable, now)[0];
      if (last && last.edited !== null) id = last.id;
      // Looking at / again and again must not make board after board.
      else id = readNewBoards(readable).find((b) => readable && !isKept(readable, b.roomId))?.roomId ?? null;
    }
    if (id === null) {
      const board = startBoard(readable);
      return { kind: "open", ...board, createdNew: true, joining: false, url: boardUrl(board, collab) };
    }
  }

  const kept = readable !== null && isKept(readable, id);
  const started = readNewBoards(readable).find((b) => b.roomId === id);
  if (!kept && !started) {
    if (collab && address.secret && ROOM_ID_PATTERN.test(id)) {
      const board = { roomId: id, roomSecret: address.secret };
      return { kind: "open", ...board, createdNew: false, joining: true, url: boardUrl(board, collab) };
    }
    return { kind: "missing", id, url: boardPath(id), storageBlocked: readable === null };
  }

  const stored = readable?.getItem(roomSecretStorageKey(id)) || started?.roomSecret || "";
  // A self-hosted share link has to work. Without collaboration a link can't replace the key this browser keeps.
  let roomSecret = collab ? address.secret || stored : stored || address.secret;
  if (collab && !roomSecret) roomSecret = generateRoomCredentials().roomSecret;
  if (readable && kept && roomSecret && roomSecret !== stored) storeRoomSecret(readable, id, roomSecret);

  const board = { roomId: id, roomSecret };
  const createdNew = Boolean(started) && readable?.getItem(boardStorageKey(id)) === null;
  return { kind: "open", ...board, createdNew, joining: false, url: boardUrl(board, collab) };
}

/** The secret is in the address only where collaboration needs it to be passed on. */
function boardUrl({ roomId, roomSecret }: RoomCredentials, collab: boolean): string {
  return collab ? `${boardPath(roomId)}#k=${roomSecret}` : boardPath(roomId);
}

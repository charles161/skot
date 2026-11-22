/**
 * Cryptographic room credentials & URL hash-fragment helpers.
 * The secret is kept in the browser, or in the URL fragment of a self-hosted share link (`/b/<id>#k=...`) and of
 * links made before /b/ (`#room=...&k=...`), so it never reaches HTTP Referer headers or server access logs.
 */

import { appUrl } from "@/lib/base-path";

// 128+ bits encoded as base64url is at least 22 characters.
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
export const ROOM_SECRET_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
export const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;
export const PEER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
export const CREATOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function getCreatorTokenStorageKey(roomId: string): string {
  return `jev_creator_token_${roomId}`;
}

export interface RoomCredentials {
  roomId: string;
  roomSecret: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(numBytes: number): string {
  const bytes = new Uint8Array(numBytes);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function generateRoomCredentials(): RoomCredentials {
  return {
    // 16 random bytes = 128 bits (22 base64url chars)
    roomId: randomBase64Url(16),
    // 24 random bytes = 192 bits (32 base64url chars)
    roomSecret: randomBase64Url(24),
  };
}

export function formatRoomHash(roomId: string, roomSecret: string): string {
  return `#room=${encodeURIComponent(roomId)}&k=${encodeURIComponent(roomSecret)}`;
}

export function parseRoomHash(hash: string): RoomCredentials | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const roomId = params.get("room") ?? "";
  const roomSecret = params.get("k") ?? "";

  if (!ROOM_ID_PATTERN.test(roomId) || !ROOM_SECRET_PATTERN.test(roomSecret)) {
    return null;
  }

  return { roomId, roomSecret };
}

export function boardPath(roomId: string): string {
  return appUrl(`/b/${encodeURIComponent(roomId)}`);
}

export function buildRoomShareUrl(origin: string, roomId: string, roomSecret: string): string {
  return `${origin}${boardPath(roomId)}#k=${encodeURIComponent(roomSecret)}`;
}

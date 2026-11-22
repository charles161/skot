import { describe, expect, it } from "vitest";
import {
  buildRoomShareUrl,
  formatRoomHash,
  generateRoomCredentials,
  parseRoomHash,
  ROOM_ID_PATTERN,
  ROOM_SECRET_PATTERN,
} from "@/lib/jev/room-auth";

describe("room-auth (Blocker 1: >=128-bit room IDs & hash-fragment secret)", () => {
  it("generates >=128-bit unguessable roomId and per-room secret", () => {
    const a = generateRoomCredentials();
    const b = generateRoomCredentials();

    // 128 bits in base64url is 22 chars minimum
    expect(a.roomId.length).toBeGreaterThanOrEqual(22);
    expect(a.roomSecret.length).toBeGreaterThanOrEqual(22);
    expect(ROOM_ID_PATTERN.test(a.roomId)).toBe(true);
    expect(ROOM_SECRET_PATTERN.test(a.roomSecret)).toBe(true);
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.roomSecret).not.toBe(b.roomSecret);
    expect(a.roomId).not.toBe(a.roomSecret);
  });

  it("a share link is the board's path with the secret in the fragment, never in the path or a query", () => {
    const { roomId, roomSecret } = generateRoomCredentials();
    const url = new URL(buildRoomShareUrl("https://jev.example.com", roomId, roomSecret));

    expect(url.search).toBe("");
    expect(url.pathname).toBe(`/b/${roomId}`);
    expect(url.hash).toBe(`#k=${roomSecret}`);
  });

  it("old #room=…&k=… fragments still parse", () => {
    const creds = generateRoomCredentials();
    expect(parseRoomHash(formatRoomHash(creds.roomId, creds.roomSecret))).toEqual(creds);
  });

  it("rejects weak 4-char room IDs and missing or short secrets", () => {
    expect(parseRoomHash("#room=jev-ab12&k=short")).toBeNull();
    expect(
      parseRoomHash("#room=jev-ab12&k=abcdefghijklmnopqrstuvwxyz123456")
    ).toBeNull();
    expect(
      parseRoomHash("#room=abcdefghijklmnopqrstuvwxyz123456")
    ).toBeNull();
    expect(parseRoomHash("")).toBeNull();
  });
});

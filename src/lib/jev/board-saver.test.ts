import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BoardSaver, type BoardRecord } from "./board-saver";
import { roomSecretStorageKey } from "./boards";
import { boardStorageKey } from "./storage-keys";
import type { JevElement } from "./types";

const node = (id: string): JevElement => ({
  id, kind: "node", x: 0, y: 0, width: 160, height: 64, label: id, tone: "ink", seed: 1, createdAt: 1, updatedAt: 1,
});
const SAVED: BoardRecord = {
  elements: [node("a")], boardTitle: "A", boardEpoch: "bep_1", baseTimestamp: 100, hasLocalEdits: true,
};
const SECRET = "s".repeat(32);

function setUp({ stored = SAVED as BoardRecord | null, canSave = true, id = "board_a" } = {}) {
  const map = new Map<string, string>();
  const key = boardStorageKey(id);
  if (stored) map.set(key, JSON.stringify(stored));
  const setItem = vi.fn((k: string, v: string) => void map.set(k, v));
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem };
  const live = { board: structuredClone(stored ?? { elements: [], boardTitle: "Untitled Sheet" }), canSave };
  const saver = new BoardSaver({
    storage: () => storage,
    roomId: id,
    roomSecret: SECRET,
    read: () => live.board,
    canSave: () => live.canSave,
    adopt: (board) => {
      live.board = { ...board };
    },
    loadedRaw: map.get(key) ?? null,
    now: 5000,
  });
  return { map, setItem, storage, live, saver, saved: () => JSON.parse(map.get(key)!) };
}

describe("BoardSaver", () => {
  it("opening and leaving a board writes nothing, so a stale tab can't overwrite a newer one", () => {
    const t = setUp();
    const newer = JSON.stringify({ ...SAVED, elements: [node("a"), node("newer")] });
    t.map.set(boardStorageKey("board_a"), newer);
    expect(t.saver.save(6000)).toBe("unchanged");
    expect(t.setItem).not.toHaveBeenCalled();
    expect(t.map.get(boardStorageKey("board_a"))).toBe(newer);
  });

  it("an edit is saved with the time it was made", () => {
    const t = setUp();
    t.live.board = { ...SAVED, elements: [node("a"), node("b")] };
    expect(t.saver.save(6000)).toBe("saved");
    expect(t.saved()).toMatchObject({ editedAt: 6000 });
    expect(t.saved().elements).toHaveLength(2);
  });

  it("a change that isn't an edit keeps the time of the last one", () => {
    const t = setUp({ stored: { ...SAVED, editedAt: 300 } as BoardRecord });
    t.live.board = { ...SAVED, baseTimestamp: 999 };
    expect(t.saver.save(6000)).toBe("saved");
    expect(t.saved().editedAt).toBe(300);
  });

  it("a board with no epoch saves the one it was given, so two tabs agree, without counting as an edit", () => {
    const t = setUp({ stored: { elements: [node("a")], boardTitle: "A", hasLocalEdits: true, baseTimestamp: 100 } });
    t.live.board = { ...SAVED };
    expect(t.saver.save(6000)).toBe("saved");
    expect(t.saved()).toMatchObject({ boardEpoch: "bep_1", editedAt: 100 });
  });

  it("a board nobody edited makes no storage", () => {
    const t = setUp({ stored: null, canSave: false });
    expect(t.saver.save(6000)).toBe("unchanged");
    expect(t.map.size).toBe(0);
  });

  it("keeps the secret once the board is saved, and never ahead of it", () => {
    const t = setUp({ stored: null });
    t.live.board = { ...SAVED };
    t.saver.save(6000);
    expect(t.setItem.mock.calls.map(([k]) => k)).toEqual([boardStorageKey("board_a"), roomSecretStorageKey("board_a")]);
  });

  it("a failed save is reported, tried again, and evicts nothing", () => {
    const t = setUp();
    t.live.board = { ...SAVED, boardTitle: "Renamed" };
    t.setItem.mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    expect(t.saver.save(6000)).toBe("storage_failed");
    expect(t.saved().boardTitle).toBe("A");
    expect(t.saver.save(7000)).toBe("saved");
    expect(t.saved().boardTitle).toBe("Renamed");
  });

  it("an unreadable saved board is never replaced", () => {
    const t = setUp();
    t.map.set(boardStorageKey("board_a"), "{broken");
    t.live.board = { ...SAVED, boardTitle: "Renamed" };
    expect(t.saver.save(6000)).toBe("kept_unreadable");
    expect(t.map.get(boardStorageKey("board_a"))).toBe("{broken");
  });

  it("blocked storage reports an edit, and stays quiet without one", () => {
    const live = { board: SAVED, canSave: false };
    const saver = new BoardSaver({
      storage: () => null, roomId: "x", roomSecret: "", read: () => live.board, canSave: () => live.canSave,
      adopt: () => {}, loadedRaw: null, now: 1,
    });
    expect(saver.save(2)).toBe("unchanged");
    live.canSave = true;
    live.board = { ...SAVED, boardTitle: "B" };
    expect(saver.save(3)).toBe("storage_failed");
  });

  it("writes only under the board it was made for", () => {
    const t = setUp({ id: "board_b" });
    t.live.board = { ...SAVED, boardTitle: "B" };
    t.saver.save(6000);
    expect([...t.map.keys()].every((key) => key.endsWith("board_b"))).toBe(true);
  });
});

describe("the one writer of saved boards", () => {
  it("the workspace never writes a board except through its saver, which is bound to one room", () => {
    const ws = readFileSync(path.join(__dirname, "../../components/jev/JevWorkspace.tsx"), "utf8");
    expect(ws, "save through BoardSaver: a key taken from state or the address can be another board's").not.toMatch(
      /writeSavedBoard\(/
    );
  });
});

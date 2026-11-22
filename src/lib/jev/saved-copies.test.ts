// "Restore earlier copy": the copies a board-loss leaves behind are someone's only way back.
import { describe, expect, it } from "vitest";
import { BoardHistoryController } from "./board-history";
import {
  hasSavedCopies,
  listSavedCopies,
  loadRecoverySnapshots,
  popRecoverySnapshot,
  pushRecoverySnapshot,
  saveBeforeRestore,
  type BoardRecoveryEntry,
} from "./recovery-buffer";
import type { JevElement } from "./types";

const ROOM = "room";
const KEY = `jev_recovery_${ROOM}`;
const BEFORE = `jev_before_restore_${ROOM}`;

const el = (i: number, label = `Node ${i}`): JevElement => ({
  id: `n${i}`, kind: "node", x: i, y: 0, width: 160, height: 64, label, tone: "ink", seed: 1, createdAt: 1, updatedAt: 1,
});
const board = (count: number, boardTitle = "Board") => ({
  elements: Array.from({ length: count }, (_, i) => el(i)), boardTitle,
});
const copy = (at: number, count: number, title = `Copy ${at}`): BoardRecoveryEntry => ({
  id: `rec_${at}`, savedAt: at, reason: "periodic", removedCount: 0, previousElementCount: count,
  snapshot: board(count, title),
});

function memory(initial: Record<string, unknown> = {}, maxChars = Infinity) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > maxChars) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
}
const stored = (s: ReturnType<typeof memory>, key = KEY) => JSON.parse(s.data.get(key)!);
const eight = () => Array.from({ length: 8 }, (_, i) => copy(80 - i * 10, i === 5 ? 9 : 2));

describe("saved copies load with the tolerant local loader", () => {
  it("loads and saves a copy over 500 elements whole", () => {
    const s = memory({ [KEY]: [copy(1, 501)] });
    expect(loadRecoverySnapshots(s, ROOM)[0].snapshot.elements).toHaveLength(501);
    pushRecoverySnapshot(s, ROOM, copy(2, 620));
    expect(loadRecoverySnapshots(s, ROOM).map((c) => c.snapshot.elements.length)).toEqual([620, 501]);
  });

  it("one unreadable copy does not hide the others, and a save does not delete it", () => {
    const bad = { id: "bad", savedAt: 5, snapshot: { elements: [{ id: "cut" }] } };
    const s = memory({ [KEY]: [copy(9, 3), bad, copy(1, 4)] });
    expect(loadRecoverySnapshots(s, ROOM)).toHaveLength(2);
    for (let at = 10; at < 22; at += 1) pushRecoverySnapshot(s, ROOM, copy(at, 1));
    expect(stored(s)).toContainEqual(bad);
    expect(loadRecoverySnapshots(s, ROOM)).toHaveLength(8);
  });

  it("copies that are not JSON at all are kept, and can be downloaded as they were", () => {
    const s = memory({ [KEY]: "[{cut short" });
    expect(listSavedCopies(s, ROOM)).toEqual([{ kind: "unreadable", raw: "[{cut short" }]);
    pushRecoverySnapshot(s, ROOM, copy(1, 2));
    expect(listSavedCopies(s, ROOM)).toContainEqual({ kind: "unreadable", raw: "[{cut short" });
  });

  it("taking the latest copy back never deletes an unreadable one", () => {
    const s = memory({ [KEY]: [{ broken: true }, copy(4, 2)] });
    expect(popRecoverySnapshot(s, ROOM).entry?.id).toBe("rec_4");
    expect(stored(s)).toEqual([{ broken: true }]);
  });

  it("a full storage never trims an unreadable copy", () => {
    const bad = { broken: "x".repeat(900) };
    const s = memory({ [KEY]: [bad] }, 700);
    pushRecoverySnapshot(s, ROOM, copy(1, 1));
    expect(stored(s)).toEqual([bad]);
  });
});

describe("the list", () => {
  it("is newest first across both kinds of copy, marking the newest and the fullest", () => {
    const s = memory({ [KEY]: [copy(30, 2), copy(10, 9)], [BEFORE]: [{ ...copy(20, 4), reason: "manual" }] });
    const list = listSavedCopies(s, ROOM).flatMap((c) => (c.kind === "copy" ? [c] : []));
    expect(list.map((c) => [c.entry.savedAt, c.newest, c.fullest])).toEqual([
      [30, true, false], [20, false, false], [10, false, true],
    ]);
  });

  it("says when there is nothing to restore, and reading writes nothing", () => {
    expect(hasSavedCopies(memory(), ROOM)).toBe(false);
    expect(hasSavedCopies(memory({ [KEY]: [] }), ROOM)).toBe(false);
    const s = memory({ [KEY]: eight() });
    const was = new Map(s.data);
    expect(hasSavedCopies(s, ROOM)).toBe(true);
    listSavedCopies(s, ROOM);
    expect(s.data).toEqual(was);
  });
});

describe("restoring never costs a copy", () => {
  it("keeps the current board beside the 8, not among them", () => {
    const s = memory({ [KEY]: eight() });
    const was = s.data.get(KEY);
    expect(saveBeforeRestore(s, ROOM, board(1, "Shrunk"), 99)).toBe(true);
    expect(s.data.get(KEY)).toBe(was);
    expect(stored(s, BEFORE)).toMatchObject([{ reason: "manual", snapshot: { boardTitle: "Shrunk" } }]);
  });

  it("going back and forth between saved boards adds nothing", () => {
    const s = memory({ [KEY]: eight() });
    for (let at = 100; at < 110; at += 1) saveBeforeRestore(s, ROOM, board(1, "Shrunk"), at);
    expect(stored(s, BEFORE)).toHaveLength(1);
    const restamped = board(9, "Copy 30");
    restamped.elements = restamped.elements.map((e) => ({ ...e, rev: 7, updatedAt: 999 }));
    saveBeforeRestore(s, ROOM, restamped, 120);
    expect(stored(s, BEFORE)).toHaveLength(1);
  });

  it("the 2-minute save after a restore or its undo pushes nothing out", () => {
    const s = memory({ [KEY]: eight(), [BEFORE]: [{ ...copy(90, 1, "Shrunk"), reason: "manual" }] });
    const was = s.data.get(KEY);
    pushRecoverySnapshot(s, ROOM, copy(200, 1, "Shrunk")); // undone back to the board before the restore
    pushRecoverySnapshot(s, ROOM, copy(210, 9, "Copy 30")); // redone
    expect(s.data.get(KEY)).toBe(was);
  });

  it("keeps the fullest pre-restore board when that list is full", () => {
    const s = memory();
    [40, 1, 2, 3, 4].forEach((count, at) => saveBeforeRestore(s, ROOM, board(count, `Try ${at}`), at));
    expect(stored(s, BEFORE).map((c: BoardRecoveryEntry) => c.snapshot.elements.length)).toEqual([4, 3, 40]);
  });

  it("reports when the current board could not be kept, and leaves what was stored", () => {
    const s = memory({ [KEY]: eight() }, 50);
    const was = new Map(s.data);
    expect(saveBeforeRestore(s, ROOM, board(30), 99)).toBe(false);
    expect(s.data).toEqual(was);
  });

  it("has nothing to keep for a blank board, so a full storage can't block that restore", () => {
    expect(saveBeforeRestore(memory({}, 1), ROOM, board(0), 99)).toBe(true);
  });

  it("keeps a board over 500 elements before replacing it", () => {
    const s = memory();
    expect(saveBeforeRestore(s, ROOM, board(501), 99)).toBe(true);
    expect(stored(s, BEFORE)[0].snapshot.elements).toHaveLength(501);
  });
});

describe("a restore is one undo step", () => {
  it("takes the title along with the elements, both ways", () => {
    const history = new BoardHistoryController([el(1)]);
    history.commitLocal([el(1), el(2)], { title: { before: "Untitled", after: "Checkout" } });
    expect(history.undo()).toEqual([el(1)]);
    expect(history.steppedTitle).toBe("Untitled");
    expect(history.redo()).toHaveLength(2);
    expect(history.steppedTitle).toBe("Checkout");
  });

  it("leaves the title alone on every other step", () => {
    const history = new BoardHistoryController([]);
    history.commitLocal([el(1)], { title: { before: "A", after: "B" } });
    history.commitLocal([el(1), el(2)]);
    history.undo();
    expect(history.steppedTitle).toBeUndefined();
  });
});

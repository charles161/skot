// Outsider judge, 22 Nov 2026, on 1e68d4b: a tab saved over what another tab had saved (board a day old, board
// rearranged, board over 500, board with no epoch). A save must never lose what another tab saved.
import { describe, expect, it } from "vitest";
import { applyLocalElementsChange, TOMBSTONE_TTL_MS } from "./board-sync";
import { BoardSaver, type BoardRecord } from "./board-saver";
import { readSavedBoard } from "./saved-board";
import { boardStorageKey } from "./storage-keys";
import type { JevElement } from "./types";

const ID = "board_tabs";
const DAY = 86_400_000;
const T0 = 1_795_000_000_000;

function makeNode(id: string, at: number, label = id): JevElement {
  return { id, kind: "node", x: 0, y: 0, width: 160, height: 64, label, tone: "ink", seed: 1, createdAt: at, updatedAt: at };
}

function browser(initial: BoardRecord | null) {
  const map = new Map<string, string>();
  const key = boardStorageKey(ID);
  if (initial) map.set(key, JSON.stringify(initial));
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };

  function openTab(name: string, now: number) {
    const raw = storage.getItem(key);
    const loaded = readSavedBoard(raw);
    let board: BoardRecord =
      loaded.kind === "board"
        ? { ...loaded.snapshot, boardTitle: loaded.snapshot.boardTitle ?? "Untitled Sheet" }
        : { elements: [], boardTitle: "Untitled Sheet" };
    board.boardEpoch ??= `bep_${name}`;
    let canSave = loaded.kind === "board";
    const saver = new BoardSaver({
      storage: () => storage,
      roomId: ID,
      roomSecret: "",
      read: () => board,
      canSave: () => canSave,
      adopt: (next) => {
        board = { ...next };
        canSave = true;
      },
      loadedRaw: raw,
      now,
    });
    return {
      get board() {
        return board;
      },
      edit(change: (els: JevElement[]) => JevElement[], at: number) {
        const next = applyLocalElementsChange(
          board.elements, change(board.elements), board.tombstones ?? {}, name, at, board.tombstoneHorizonRev ?? 0,
          { ttlMs: TOMBSTONE_TTL_MS, prevHorizonAt: board.tombstoneHorizonAt }
        );
        board = { ...board, ...next, hasLocalEdits: true };
        canSave = true;
      },
      retitle(title: string) {
        board = { ...board, boardTitle: title, titleRev: (board.titleRev ?? 0) + 1, hasLocalEdits: true };
        canSave = true;
      },
      save: (at: number) => saver.save(at),
    };
  }

  const stored = () => JSON.parse(storage.getItem(key)!) as BoardRecord;
  return { openTab, stored, map, key, ids: () => stored().elements.map((e) => e.id).sort() };
}

const saved = (ids: string[], at: number, extra: object = {}): BoardRecord => ({
  elements: ids.map((id) => makeNode(id, at)), boardTitle: "Board", hasLocalEdits: true,
  boardEpoch: "bep_saved", boardEpochCreatedAt: at, baseTimestamp: at, ...extra,
});

describe("a stale tab can't save over another tab's work", () => {
  it.each([0, 2, 30])("board %i days old: the stale tab's edit keeps what was added", (days) => {
    const b = browser(saved(["gateway", "orders"], T0 - days * DAY));
    const a = b.openTab("a", T0);
    const stale = b.openTab("stale", T0);
    a.edit((els) => [...els, makeNode("search", T0 + 1), makeNode("billing", T0 + 1)], T0 + 1);
    a.save(T0 + 2);
    stale.edit((els) => [...els, makeNode("mailer", T0 + 3)], T0 + 3);
    stale.save(T0 + 4);
    expect(b.ids()).toEqual(["billing", "gateway", "mailer", "orders", "search"]);
  });

  it("a title edit alone keeps the other tab's elements, and the other tab's title survives an element edit", () => {
    const b = browser(saved(["one"], T0));
    const a = b.openTab("a", T0);
    const c = b.openTab("c", T0);
    a.edit((els) => [...els, makeNode("two", T0 + 1)], T0 + 1);
    a.save(T0 + 2);
    c.retitle("Renamed");
    c.save(T0 + 3);
    expect(b.ids()).toEqual(["one", "two"]);
    a.edit((els) => [...els, makeNode("three", T0 + 4)], T0 + 4);
    a.save(T0 + 5);
    expect(b.stored().boardTitle).toBe("Renamed");
  });

  it("everything rearranged in one tab is neither refused nor undone by the other", () => {
    const b = browser(saved(["a", "b", "c", "d", "e"], T0));
    const a = b.openTab("a", T0);
    const other = b.openTab("other", T0);
    a.edit((els) => els.map((e) => ({ ...e, y: 300 })), T0 + 1);
    a.save(T0 + 2);
    other.edit((els) => [...els, makeNode("later", T0 + 3)], T0 + 3);
    other.save(T0 + 4);
    expect(b.stored().elements.filter((e) => e.y === 300)).toHaveLength(5);
    expect(b.ids()).toContain("later");
  });

  it("540 elements cleared in one tab do not come back, and what was added after stays", () => {
    const b = browser(saved(Array.from({ length: 540 }, (_, i) => `n${i}`), T0 - DAY));
    const a = b.openTab("a", T0);
    const other = b.openTab("other", T0);
    a.edit(() => [], T0 + 1);
    a.save(T0 + 2);
    a.edit(() => [makeNode("fresh", T0 + 3)], T0 + 3);
    a.save(T0 + 4);
    other.retitle("Renamed by the other tab");
    other.save(T0 + 5);
    expect(b.ids()).toEqual(["fresh"]);
  });

  it("two tabs that each made up an epoch still keep both edits", () => {
    const b = browser({ elements: [makeNode("seed", T0)], boardTitle: "Old", hasLocalEdits: true });
    const a = b.openTab("a", T0);
    const c = b.openTab("c", T0);
    a.edit((els) => [...els, makeNode("p", T0 + 1)], T0 + 1);
    a.save(T0 + 2);
    c.edit((els) => [...els, makeNode("q", T0 + 3)], T0 + 3);
    c.save(T0 + 4);
    expect(b.ids()).toEqual(["p", "q", "seed"]);
  });

  it("two tabs on a board nobody had edited keep both first edits", () => {
    const b = browser(null);
    const a = b.openTab("a", T0);
    const c = b.openTab("c", T0);
    a.edit((els) => [...els, makeNode("first", T0 + 1)], T0 + 1);
    a.save(T0 + 2);
    c.edit((els) => [...els, makeNode("second", T0 + 3)], T0 + 3);
    c.save(T0 + 4);
    expect(b.ids()).toEqual(["first", "second"]);
  });

  it("a tab of an older build that overwrote without looking doesn't lose this tab's work", () => {
    const start = saved(["one"], T0);
    const b = browser(start);
    const a = b.openTab("a", T0);
    a.edit((els) => [...els, makeNode("mine", T0 + 1)], T0 + 1);
    a.save(T0 + 2);
    b.map.set(b.key, JSON.stringify({ ...start, elements: [...start.elements, makeNode("theirs", T0 + 3)] }));
    expect(a.save(T0 + 4)).toBe("saved");
    expect(b.ids()).toEqual(["mine", "one", "theirs"]);
  });

  it("a tab with no edit follows without writing", () => {
    const b = browser(saved(["one"], T0));
    const a = b.openTab("a", T0);
    const looking = b.openTab("looking", T0);
    a.edit((els) => [...els, makeNode("two", T0 + 1)], T0 + 1);
    a.save(T0 + 2);
    const written = b.map.get(b.key);
    expect(looking.save(T0 + 3)).toBe("unchanged");
    expect(b.map.get(b.key)).toBe(written);
    expect(looking.board.elements.map((e) => e.id)).toEqual(["one", "two"]);
  });
});

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("any interleaving of edits and saves in up to four tabs", () => {
  it("converges, and every element ends as its last edit left it", () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const next = random(seed);
      const below = (n: number) => Math.floor(next() * n);
      const initial = ["i0", "i1", "i2", "i3"].slice(0, below(5));
      const b = browser(saved(initial, T0 - below(40) * DAY));
      const tabs = Array.from({ length: 2 + below(3) }, (_, i) => b.openTab(`t${i}`, T0));
      const last = new Map<string, string | null>(initial.map((id) => [id, id]));
      let at = T0;

      for (let step = 0; step < 24; step += 1) {
        at += 1000;
        const tab = tabs[below(tabs.length)];
        const held = tab.board.elements;
        const action = below(8);
        if (action < 2) {
          const id = `s${step}`;
          tab.edit((els) => [...els, makeNode(id, at)], at);
          last.set(id, id);
        } else if (action < 4 && held.length) {
          const { id } = held[below(held.length)];
          const label = `${id}@${step}`;
          tab.edit((els) => els.map((e) => (e.id === id ? { ...e, label } : e)), at);
          last.set(id, label);
        } else if (action === 4 && held.length) {
          const { id } = held[below(held.length)];
          tab.edit((els) => els.filter((e) => e.id !== id), at);
          last.set(id, null);
        } else {
          tab.save(at);
        }
      }
      for (let round = 0; round < 3; round += 1) for (const tab of tabs) tab.save((at += 1000));

      const onDisk = b.stored().elements;
      const want = [...last].filter(([, label]) => label !== null).sort();
      expect(onDisk.map((e) => [e.id, e.label]).sort(), `seed ${seed}`).toEqual(want);
      for (const tab of tabs) {
        expect(tab.board.elements.map((e) => [e.id, e.label]), `seed ${seed}`).toEqual(onDisk.map((e) => [e.id, e.label]));
      }
    }
  });
});

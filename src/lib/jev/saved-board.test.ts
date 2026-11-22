// 22 Nov 2026, reproduced on prod be25a4b: the 501st element saved a board the loader rejects, the reload showed a
// blank board, and the next edit saved that blank over the only copy (501 elements to 1).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBoardFile } from "./board-import";
import { exceedsBoardLimit, readSavedBoard, writeSavedBoard } from "./saved-board";
import { parseStoredBoardSnapshot, parseWireMessage } from "./sync-validation";
import type { JevElement } from "./types";

const el = (i: number, extra: Partial<JevElement> = {}): JevElement => ({
  id: `n${i}`, kind: "node", x: i, y: 0, width: 160, height: 64, label: `Node ${i}`, tone: "ink", seed: 1,
  createdAt: 1, updatedAt: 1, ...extra,
});
const many = (n: number, extra: Partial<JevElement> = {}) => Array.from({ length: n }, (_, i) => el(i, extra));
const save = (elements: unknown[], extra: object = {}) => JSON.stringify({ elements, hasLocalEdits: true, ...extra });

function longMorph(summary: string, attribute: string): JevElement {
  return el(1, {
    morphMeta: {
      groupId: "g1",
      notation: "er",
      groupRecord: {
        groupId: "g1",
        anchorBounds: { x: 0, y: 0, width: 400, height: 200 },
        spec: {
          summary, actors: [], messages: [], steps: [], states: [], transitions: [], relations: [],
          entities: [{ id: "e1", name: "Orders", attributes: [attribute] }],
        },
        sketchSnapshot: [{ id: "s1", kind: "node", x: 0, y: 0, width: 160, height: 64, label: "Orders", tone: "ink", seed: 1 }],
      },
    },
  });
}

function loaded(raw: string) {
  const saved = readSavedBoard(raw);
  if (saved.kind !== "board") throw new Error(`expected a board, got ${saved.kind}`);
  return saved.snapshot;
}

describe("boards already saved over the limits load back", () => {
  it("loads every element of an over-500 board", () => {
    expect(loaded(save(many(501))).elements).toEqual(many(501));
    expect(loaded(save(many(1200))).elements).toHaveLength(1200);
  });
  it("loads a board over 1 MB", () => {
    const raw = save(many(700, { label: "L".repeat(480), sublabel: "é".repeat(480) }));
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(1024 * 1024);
    expect(loaded(raw).elements).toHaveLength(700);
  });
  it("cuts over-long Morph text, which is derived, and keeps the sketch it came from", () => {
    const meta = loaded(save([longMorph("s".repeat(400), "a".repeat(300))])).elements[0].morphMeta!.groupRecord!;
    expect(meta.spec.summary).toHaveLength(160);
    expect(meta.spec.entities[0].attributes[0]).toHaveLength(120);
    expect(meta.sketchSnapshot[0].label).toBe("Orders");
  });
  it("keeps text the person wrote in full: label, note and title", () => {
    const board = loaded(save([el(1, { label: "L".repeat(900), sublabel: "N".repeat(1500) })], { boardTitle: "T".repeat(200) }));
    expect(board.elements[0].label).toHaveLength(900);
    expect(board.elements[0].sublabel).toHaveLength(1500);
    expect(board.boardTitle).toHaveLength(200);
  });
  it("keeps the original text inside a morphed group's sketch", () => {
    const morphed = longMorph("s".repeat(400), "a");
    morphed.morphMeta!.groupRecord!.sketchSnapshot[0].label = "O".repeat(700);
    expect(loaded(save([morphed])).elements[0].morphMeta!.groupRecord!.sketchSnapshot[0].label).toHaveLength(700);
  });
  it("keeps every point of a long pen stroke", () => {
    const points = Array.from({ length: 3000 }, (_, i) => ({ x: i, y: i }));
    expect(loaded(save([el(1, { kind: "freedraw", points })])).elements[0].points).toEqual(points);
  });
  it("reads a board within the limits exactly as the strict loader does", () => {
    const raw = save(many(500), { boardTitle: "Checkout", titleRev: 3 });
    expect(loaded(raw)).toEqual(parseStoredBoardSnapshot(raw));
  });
  it("knows when nothing is saved", () => {
    expect(readSavedBoard(null).kind).toBe("empty");
  });
});

describe("what can't be loaded safely is reported, never half loaded", () => {
  const bad: [string, string][] = [
    ["not JSON", '{"elements":[{"id":'],
    ["an empty value", ""],
    ["no elements list", '{"boardTitle":"x"}'],
    ["one element of an unknown kind", save([el(1), { ...el(2), kind: "script" }])],
    ["a label that is not text", save([{ ...el(1), label: { html: "<b>" } }])],
    ["a tone outside the palette", save([{ ...el(1), tone: "url(javascript:1)" }])],
    ["coordinates that are not finite", save([el(1)]).replace('"x":1', '"x":1e999')],
    ["a far off-canvas coordinate", save([el(1, { x: 5e6 })])],
    ["a bad point past the 2000th", save([el(1, { kind: "freedraw", points: [...Array.from({ length: 2400 }, () => ({ x: 1, y: 1 })), { x: "1", y: 1 } as never] })])],
    ["a prototype key", `{"elements":${JSON.stringify(many(501))},"__proto__":{"x":1}}`],
    ["a Morph record of the wrong shape", save([{ ...el(1), morphMeta: { groupId: "g", notation: "er", groupRecord: { spec: 4 } } }])],
  ];
  it.each(bad)("%s", (_name, raw) => {
    expect(readSavedBoard(raw)).toEqual({ kind: "unreadable", raw });
  });
});

describe("a save never destroys a board", () => {
  const storageWith = (value: string | null, fail = false) => {
    const box = { value, writes: 0 };
    return {
      box,
      getItem: () => box.value,
      setItem: (_key: string, next: string) => {
        if (fail) throw new Error("QuotaExceededError");
        box.writes++;
        box.value = next;
      },
    };
  };
  it("never writes over a copy it can't read", () => {
    const storage = storageWith("{broken");
    expect(writeSavedBoard(storage, "k", save([el(1)]))).toBe("kept_unreadable");
    expect(storage.box).toEqual({ value: "{broken", writes: 0 });
  });
  it("never saves what it couldn't load back", () => {
    const good = save([el(1)]);
    const storage = storageWith(good);
    expect(writeSavedBoard(storage, "k", save([el(1, { x: 5e6 })]))).toBe("would_not_load");
    expect(storage.box).toEqual({ value: good, writes: 0 });
  });
  it("saves over a board it can read, over-limit ones included", () => {
    const storage = storageWith(save(many(501)));
    const next = save(many(500));
    expect(writeSavedBoard(storage, "k", next)).toBe("saved");
    expect(storage.box.value).toBe(next);
  });
  it("saves where nothing was saved", () => {
    expect(writeSavedBoard(storageWith(null), "k", save([el(1)]))).toBe("saved");
  });
  it("says when the browser refuses the write", () => {
    expect(writeSavedBoard(storageWith(null, true), "k", save([el(1)]))).toBe("storage_failed");
  });
  it("says when storage can't be read, and writes nothing", () => {
    const storage = storageWith(null);
    storage.getItem = () => {
      throw new Error("blocked");
    };
    expect(writeSavedBoard(storage, "k", save([el(1)]))).toBe("storage_failed");
    expect(storage.box.writes).toBe(0);
  });
});

describe("only growth past 500 is refused", () => {
  it.each([
    [499, 500, false], [500, 501, true], [480, 560, true], [501, 501, false], [501, 500, false], [700, 640, false], [700, 701, true],
  ])("%i to %i elements: refused %s", (from, to, refused) => {
    expect(exceedsBoardLimit(from, to)).toBe(refused);
  });
});

describe("untrusted input stays strict", () => {
  it("a file, a link or a peer still can't bring an over-limit board", () => {
    const over = save(many(501));
    expect(parseStoredBoardSnapshot(over)).toBeNull();
    expect(parseBoardFile(over)).toBeNull();
    expect(parseStoredBoardSnapshot(save([el(1, { label: "L".repeat(501) })]))).toBeNull();
    const wire = { kind: "sync_state", peerId: "p", elements: many(501), boardTitle: "", ts: 1 };
    expect(parseWireMessage(wire)).toBeNull();
  });
});

describe("every path goes through the guards", () => {
  const SRC = join(__dirname, "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  const source = files(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));
  const workspace = source.find((f) => f.path === "components/jev/JevWorkspace.tsx")!.text;

  it("nothing deletes a saved board, 'reset' on the crash screens included", () => {
    for (const { path, text } of source) {
      if (!/boardStorageKey|BOARD_STORAGE_PREFIX/.test(text)) continue;
      expect(text, `${path}: start a new room instead; a saved board may be someone's only copy`).not.toMatch(/\.removeItem\(/);
    }
  });
  it("the workspace loads with readSavedBoard and saves through BoardSaver's writeSavedBoard only", () => {
    expect(workspace).toMatch(/readSavedBoard\(/);
    expect(workspace).toMatch(/new BoardSaver\(/);
    const saver = source.find((f) => f.path === "lib/jev/board-saver.ts")!.text;
    expect(saver).toMatch(/writeSavedBoard\(/);
    expect(saver, "save with writeSavedBoard(): setItem can overwrite the only copy").not.toMatch(/\.setItem\(/);
    expect(workspace, "save with writeSavedBoard(): setItem can overwrite the only copy").not.toMatch(/localStorage\.setItem\(/);
    expect(workspace, "load with readSavedBoard(): the strict parser is for untrusted input").not.toMatch(/parseStoredBoardSnapshot\(/);
  });
  it("local edits and both peer merges check the limit", () => {
    // updateElements (typing, tools, duplicate, packs, moves, starters, Fork, Morph), live merge, Keep peer changes.
    expect(workspace.match(/exceedsBoardLimit\(/g) ?? []).toHaveLength(3);
  });
});

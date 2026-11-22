// Found 22 Nov 2026: Morph wrote a record its own storage schema rejects, so a reload lost the whole board.
// Two 79-character labels were enough.
import { describe, expect, it } from "vitest";
import { applyMorphToBoard, morphSelectionToNotation } from "./notation-morph";
import { parseStoredBoardSnapshot } from "./sync-validation";
import type { JevElement, MorphNotation, ShapeKind } from "./types";

const SENTENCE = "Settlement reconciliation worker that replays failed captures from the ledger every night after close ".repeat(6);
const NOTATIONS: MorphNotation[] = ["sequence", "flowchart", "state", "er"];
const KINDS: ShapeKind[] = ["node", "entity", "diamond", "card"];

function board(count: number, label: number, detail: number, kind: ShapeKind): JevElement[] {
  const nodes = Array.from({ length: count }, (_, i): JevElement => ({
    id: `n${i}`, kind, x: i * 300, y: 0, width: 200, height: 100,
    label: `${i} ${SENTENCE}`.slice(0, label),
    ...(detail ? { sublabel: Array.from({ length: 12 }, () => SENTENCE.slice(0, Math.floor(detail / 12) - 1)).join("\n") } : {}),
    tone: "ink", seed: i + 1, createdAt: 1, updatedAt: 1,
  }));
  const arrows = nodes.slice(1).map((to, i): JevElement => ({
    ...to, id: `a${i}`, kind: "arrow", x: 0, y: 0, width: 0, height: 0,
    label: SENTENCE.slice(0, Math.min(label, 200)), sublabel: undefined, fromId: nodes[i].id, toId: to.id,
  }));
  return [...nodes, ...arrows];
}

describe.each(NOTATIONS)("a board morphed to %s always loads back", (notation) => {
  it.each(KINDS)("from %s shapes of every text length", (kind) => {
    for (const count of [1, 2, 3, 8, 24]) {
      for (const label of [12, 79, 88, 120, 300, 500]) {
        for (const detail of [0, 300, 492]) {
          let elements = board(count, label, detail, kind);
          for (const to of [notation, "sketch" as const, notation]) {
            const ids = elements.map((el) => el.id);
            const morph = morphSelectionToNotation(ids, elements, to, { now: 5 });
            if (!morph) break;
            elements = applyMorphToBoard(elements, morph);
            const loaded = parseStoredBoardSnapshot(JSON.stringify({ elements }));
            expect(loaded, `${count} ${kind} shapes, ${label}-character labels, ${detail} detail, to ${to}`).not.toBeNull();
          }
        }
      }
    }
  });
});

// Charles, 22 Nov 2026 (18A): "Slide labels along their arrows until clear of other labels and nodes. On a phone
// keep them on screen. Nodes never move." Seen on prod: on a busy board the label of Kafka -> Search sat on the
// label of Client -> CDN.
import { describe, expect, it } from "vitest";
import busyBoard from "./__fixtures__/busy-board.json";
import { resolveArrowEndpoints } from "./geometry";
import { arrowBounds, drawnLabelRect, layoutArrowLabels, rectsIntersect } from "./ghost-geometry";
import type { JevElement, ShapeKind } from "./types";

const T = 1_700_000_000_000;
const box = (id: string, x: number, y: number, o: Partial<JevElement> = {}): JevElement => ({
  id, kind: "node" as ShapeKind, label: id, x, y, width: 172, height: 72, tone: "ink", seed: 1, createdAt: T, updatedAt: T, ...o,
});
let made = 0;
const link = (fromId: string, toId: string, label: string, o: Partial<JevElement> = {}): JevElement => {
  made += 1;
  return {
    id: `${fromId}_${toId}`, kind: "arrow", label, x: 0, y: 0, width: 0, height: 0, tone: "ink", seed: 1, fromId, toId,
    arrowStyle: "curved", createdAt: T + made, updatedAt: T + made, ...o,
  };
};
const byId = (els: JevElement[]) => new Map(els.map((e) => [e.id, e]));
const middle = (arrow: JevElement, map: Map<string, JevElement>) => {
  const { start, control, end } = resolveArrowEndpoints(arrow, map);
  return { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y };
};
const rects = (els: JevElement[]) => {
  const map = byId(els);
  const spots = layoutArrowLabels(els, map);
  return els.filter((e) => e.kind === "arrow" && e.label).map((a) => ({ a, rect: drawnLabelRect(a.label, spots.get(a.id)!) }));
};
const clashes = (els: JevElement[]) => {
  const placed = rects(els);
  const nodes = els.filter((e) => e.kind !== "arrow");
  const out: string[] = [];
  placed.forEach((p, i) => {
    for (const q of placed.slice(i + 1)) if (rectsIntersect(p.rect, q.rect)) out.push(`${p.a.label} x ${q.a.label}`);
    for (const n of nodes) if (rectsIntersect(p.rect, n)) out.push(`${p.a.label} on ${n.label}`);
  });
  return out;
};

describe("arrow labels slide along their arrows until they are clear", () => {
  it("a label with nothing near it sits at the middle of its arrow, as before", () => {
    const els = [box("a", 0, 300), box("b", 500, 300), link("a", "b", "calls")];
    const spot = layoutArrowLabels(els, byId(els)).get("a_b")!;
    expect(spot).toEqual(middle(els[2], byId(els)));
  });

  it("two arrows that cross in the middle: the first keeps its place, the second slides clear", () => {
    const els = [
      box("a", 0, 0), box("b", 700, 500), box("c", 0, 500), box("d", 700, 0),
      link("a", "b", "writes to"), link("c", "d", "reads from"),
    ];
    const map = byId(els);
    const spots = layoutArrowLabels(els, map);
    expect(spots.get("a_b")).toEqual(middle(els[4], map));
    expect(spots.get("c_d")).not.toEqual(middle(els[5], map));
    expect(clashes(els)).toEqual([]);
  });

  it("a label whose middle would sit on a node slides off it", () => {
    // The arrow bends round "mid"; a wide node sits where the label would be at the top of the bend.
    const els = [box("a", 0, 300), box("mid", 300, 300), box("c", 600, 300), link("a", "c", "publishes to")];
    const map = byId(els);
    const at = middle(els[3], map);
    const onLabel = box("note", at.x - 40, at.y - 30, { width: 80, height: 60 });
    const withNote = [...els.slice(0, 3), onLabel, els[3]];
    expect(clashes(withNote)).toEqual([]);
  });

  it("an earlier label never moves when a later arrow is added", () => {
    const first = [box("a", 0, 0), box("b", 700, 500), box("c", 0, 500), box("d", 700, 0), link("a", "b", "writes to")];
    const before = layoutArrowLabels(first, byId(first)).get("a_b");
    const more = [...first, link("c", "d", "reads from"), link("a", "d", "calls")];
    expect(layoutArrowLabels(more, byId(more)).get("a_b")).toEqual(before);
  });

  it("is the same every time, and moves no node", () => {
    const els = [box("a", 0, 0), box("b", 700, 500), box("c", 0, 500), box("d", 700, 0), link("a", "b", "x"), link("c", "d", "y")];
    const frozen = JSON.stringify(els);
    const one = [...layoutArrowLabels(els, byId(els))];
    expect([...layoutArrowLabels(els, byId(els))]).toEqual(one);
    expect(JSON.stringify(els)).toBe(frozen);
  });

  it("with no clear spot anywhere it stays at the middle", () => {
    const els = [box("a", 0, 300), box("b", 190, 300), link("a", "b", "a label far wider than the gap between the two")];
    const map = byId(els);
    expect(layoutArrowLabels(els, map).get("a_b")).toEqual(middle(els[2], map));
  });

  it("leaves a sequence diagram's messages where they are and does not treat its lifelines as nodes", () => {
    const meta = { groupId: "g", notation: "sequence" as const };
    const els = [
      box("l1", 0, 0, { morphMeta: meta, height: 600 }), box("l2", 400, 0, { morphMeta: meta, height: 600 }), box("l3", 200, 0, { morphMeta: meta, height: 600 }),
      link("l1", "l2", "request", { morphMeta: meta, arrowStyle: "straight" }),
    ];
    const map = byId(els);
    expect(layoutArrowLabels(els, map).get("l1_l2")).toEqual(middle(els[3], map));
  });

  it("judge B's busy board with Kafka -> Search added: no label on a label, none on a node", () => {
    const board = busyBoard as JevElement[];
    const id = (label: string) => board.find((e) => e.label === label)!.id;
    const flow = link(id("Kafka"), id("Search"), "calls");
    const els = [...board, { ...flow, createdAt: 9e12 }];
    expect(clashes(els)).toEqual([]);
  });

  it("what an arrow covers follows its label to where it slid", () => {
    const els = [
      box("a", 0, 0), box("b", 700, 500), box("c", 0, 500), box("d", 700, 0),
      link("a", "b", "writes to"), link("c", "d", "reads from"),
    ];
    const map = byId(els);
    const spot = layoutArrowLabels(els, map).get("c_d")!;
    const covers = arrowBounds(els[5], map, spot);
    const rect = drawnLabelRect("reads from", spot);
    expect(covers.x).toBeLessThanOrEqual(rect.x);
    expect(covers.x + covers.width).toBeGreaterThanOrEqual(rect.x + rect.width);
  });
});

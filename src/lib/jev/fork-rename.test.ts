// Charles, 22 Nov 2026 (8A): when a Fork take renames the selected node, its arrows must stay on that node.
// Seen on prod: "API service" came back as "API functions", and the arrows it had to Email worker and Payment
// provider were also drawn from Orders DB (the rightmost new node), because no take node "was" API service.
import { describe, expect, it } from "vitest";
import recorded from "./__fixtures__/fork-renamed-node.json";
import type { ForkConstraint } from "./fork-constraint";
import {
  applyForkTakeToBoard,
  extractSelectedSubgraph,
  materializeForkTake,
  validateForkTakesPayload,
} from "./fork-engine";
import type { JevElement, ShapeKind } from "./types";

const T = 1_700_000_000_000;
const node = (id: string, label: string, kind: ShapeKind, x: number, y: number): JevElement => ({
  id, kind, label, x, y, width: 172, height: 72, tone: "ink", seed: 1, createdAt: T, updatedAt: T,
});
const arrow = (fromId: string, toId: string): JevElement => ({
  id: `a_${fromId}_${toId}`, kind: "arrow", label: "", x: 0, y: 0, width: 0, height: 0, tone: "ink", seed: 1, fromId, toId, createdAt: T, updatedAt: T,
});

const BOARD: JevElement[] = [
  node("shopper", "Shopper", "actor", 60, 260),
  node("edge", "Edge gateway", "node", 320, 260),
  node("api", "API service", "node", 590, 260),
  node("db", "Orders DB", "database", 880, 260),
  node("pay", "Payment provider", "node", 880, 440),
  node("mail", "Email worker", "node", 590, 440),
  arrow("shopper", "edge"),
  arrow("edge", "api"),
  arrow("api", "db"),
  arrow("api", "pay"),
  arrow("api", "mail"),
];
const SELECTED = ["api", "db"];

function applyRecorded() {
  const constraint = recorded.constraint as ForkConstraint;
  const valid = validateForkTakesPayload({ takes: recorded.takes }, { constraint });
  if (!valid.ok) throw new Error("the recorded takes must still validate");
  const sub = extractSelectedSubgraph(SELECTED, BOARD)!;
  return valid.takes.map((spec) => {
    const after = applyForkTakeToBoard(BOARD, sub.replacedIds, materializeForkTake(spec, sub, T));
    const label = new Map(after.map((e) => [e.id, e.label]));
    const arrows = after
      .filter((e) => e.kind === "arrow" && e.fromId && e.toId)
      .map((e) => `${label.get(e.fromId!)} -> ${label.get(e.toId!)}`);
    const drawn = new Set(spec.graph.nodes.map((n) => n.label));
    const said = new Set(
      spec.graph.edges.map((e) => {
        const name = (id: string) => spec.graph.nodes.find((n) => n.id === id)?.label;
        return `${name(e.from)} -> ${name(e.to)}`;
      })
    );
    return { title: spec.title, arrows, drawn, said, after };
  });
}

describe("a Fork take that renames the selected node", () => {
  const results = applyRecorded();

  it("the recording has the case: API service comes back as API functions and as API pool", () => {
    expect(results.map((r) => ["API service", "API functions", "API pool"].find((l) => r.drawn.has(l)))).toEqual([
      "API functions",
      "API pool",
      "API service",
    ]);
  });

  it.each([0, 1, 2])("take %i: the arrows API service had now sit on the node that replaced it", (i) => {
    const r = results[i];
    const api = ["API functions", "API pool", "API service"][i];
    expect(r.arrows).toContain(`Edge gateway -> ${api}`);
    expect(r.arrows).toContain(`${api} -> Payment provider`);
    // Take 3 moves the email onto an event queue itself; the other two keep the direct arrow.
    if (r.said.has(`${api} -> Email worker`)) expect(r.arrows).toContain(`${api} -> Email worker`);
  });

  it.each([0, 1, 2])("take %i: no arrow to an outside node that neither the board nor the take had", (i) => {
    const r = results[i];
    const api = ["API functions", "API pool", "API service"][i];
    const outside = ["Shopper", "Edge gateway", "Payment provider", "Email worker"];
    const allowed = (a: string) => r.said.has(a) || a.replace("API service", api) !== a || BOARD_ARROWS.has(a.replace(api, "API service"));
    const invented = r.arrows.filter((a) => outside.some((o) => a.startsWith(`${o} ->`) || a.endsWith(`-> ${o}`)) && !allowed(a));
    expect(invented, `${r.title}: ${r.arrows.join(", ")}`).toEqual([]);
  });

  it.each([0, 1])("take %i: the renamed node stands where API service stood", (i) => {
    const api = results[i].after.find((e) => e.label === ["API functions", "API pool"][i])!;
    const was = BOARD.find((e) => e.id === "api")!;
    expect(Math.abs(api.x + api.width / 2 - (was.x + was.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(api.y + api.height / 2 - (was.y + was.height / 2))).toBeLessThanOrEqual(1);
  });
});

const BOARD_ARROWS = new Set(
  BOARD.filter((e) => e.kind === "arrow").map((e) => {
    const name = (id?: string) => BOARD.find((n) => n.id === id)?.label;
    return `${name(e.fromId)} -> ${name(e.toId)}`;
  })
);

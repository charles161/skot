// Charles (21 Nov 2026): "I need next-action predictions. Even if it gives me an entire diagram, it should be
// 1 out of 3 options." Every AI action offers exactly three options, small to big, attached to the board.
import { describe, expect, it } from "vitest";
import {
  buildNextOptions,
  predictConcept,
  refineOptionsWithGraphs,
  structureProblems,
  type NextOptionsResult,
} from "@/lib/jev/next-options";
import type { JevElement, PredictedAction } from "@/lib/jev/types";

const el = (o: Partial<JevElement> & { id: string; label: string }): JevElement => ({
  kind: "node",
  x: 100,
  y: 100,
  width: 172,
  height: 72,
  tone: "cobalt",
  seed: 1,
  createdAt: 1,
  updatedAt: 1,
  ...o,
});
const arrow = (id: string, fromId: string, toId: string): JevElement =>
  el({ id, kind: "arrow", label: "", fromId, toId, x: 0, y: 0, width: 0, height: 0 });

const shapesOf = (a: PredictedAction) => a.addElements.filter((e) => e.kind !== "arrow");
const arrowsOf = (a: PredictedAction) => a.addElements.filter((e) => e.kind === "arrow");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Every new shape reaches an existing board node through the option's own arrows (undirected). */
function allAttached(board: JevElement[], a: PredictedAction): boolean {
  const existing = new Set(board.filter((e) => e.kind !== "arrow").map((e) => e.id));
  if (existing.size === 0) return true;
  const adj = new Map<string, string[]>();
  for (const ar of [...board.filter((e) => e.kind === "arrow"), ...arrowsOf(a)]) {
    if (!ar.fromId || !ar.toId) continue;
    adj.set(ar.fromId, [...(adj.get(ar.fromId) ?? []), ar.toId]);
    adj.set(ar.toId, [...(adj.get(ar.toId) ?? []), ar.fromId]);
  }
  const seen = new Set(existing);
  const queue = [...existing];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return shapesOf(a).every((s) => seen.has(s.id));
}

/** One connected piece: on a blank board the option must not be a scatter of islands. */
function singlePiece(a: PredictedAction): boolean {
  const shapes = shapesOf(a);
  if (shapes.length <= 1) return true;
  const adj = new Map<string, string[]>();
  for (const ar of arrowsOf(a)) {
    adj.set(ar.fromId!, [...(adj.get(ar.fromId!) ?? []), ar.toId!]);
    adj.set(ar.toId!, [...(adj.get(ar.toId!) ?? []), ar.fromId!]);
  }
  const seen = new Set([shapes[0].id]);
  const queue = [shapes[0].id];
  while (queue.length) {
    for (const n of adj.get(queue.shift()!) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return shapes.every((s) => seen.has(s.id));
}

function overlaps(a: JevElement, b: JevElement): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function expectWellFormed(board: JevElement[], res: NextOptionsResult) {
  expect(res.options).toHaveLength(3);
  expect(res.options.map((o) => o.tier)).toEqual(["minimal", "cluster", "full"]);
  const counts = res.options.map((o) => shapesOf(o).length);
  expect(counts[0]).toBeLessThan(counts[1]);
  expect(counts[1]).toBeLessThan(counts[2]);
  const boardShapes = board.filter((e) => e.kind !== "arrow");
  const boardLabels = new Set(boardShapes.map((e) => norm(e.label)));
  const ids = new Set(board.map((e) => e.id));
  for (const o of res.options) {
    expect(o.nodeCount).toBe(shapesOf(o).length);
    expect(o.subtitle.trim().length).toBeGreaterThan(0);
    const shapes = shapesOf(o);
    // Core loop (22 Nov): for typed text, (a) is the one node Enter adds: no arrow, and it may repeat a name.
    const typedNode = res.typed !== null && o === res.options[0];
    if (typedNode) {
      expect(o.addElements).toEqual([res.typed!.node]);
    } else {
      expect(allAttached(board, o)).toBe(true);
      const own = res.typed ? shapes.filter((s) => s.id !== res.typed!.node.id) : shapes;
      for (const s of own) expect(boardLabels.has(norm(s.label))).toBe(false);
    }
    if (boardShapes.length === 0) expect(singlePiece(o)).toBe(true);
    expect(new Set(shapes.map((s) => norm(s.label))).size).toBe(shapes.length);
    for (const ar of arrowsOf(o)) {
      const ends = [ar.fromId, ar.toId];
      for (const end of ends) expect(ids.has(end!) || shapes.some((s) => s.id === end)).toBe(true);
    }
    for (let i = 0; i < shapes.length; i++) {
      for (const b of boardShapes) expect(overlaps(shapes[i], b)).toBe(false);
      for (let j = i + 1; j < shapes.length; j++) expect(overlaps(shapes[i], shapes[j])).toBe(false);
    }
  }
}

const dashboard = el({ id: "cd", label: "Client Dashboard", x: 200, y: 160 });

describe("S1: board = Client Dashboard, typed 'apigateway'", () => {
  const board = [dashboard];
  const res = buildNextOptions({ elements: board, text: "apigateway" })!;

  it("offers three tiered options; the bigger two are attached to Client Dashboard", () => {
    expectWellFormed(board, res);
  });

  it("(a) is one API Gateway node right next to Client Dashboard, with no arrow: the link is offered after Enter", () => {
    const [a] = res.options;
    const [node] = shapesOf(a);
    expect(shapesOf(a)).toHaveLength(1);
    expect(node.label).toBe("API Gateway");
    expect(arrowsOf(a)).toHaveLength(0);
    const link = arrowsOf(res.options[1]).find((ar) => ar.fromId === "cd" && ar.toId === node.id)!;
    expect(link.label.trim()).not.toBe("");
    expect(node.x).toBeGreaterThan(dashboard.x + dashboard.width);
    expect(node.x - (dashboard.x + dashboard.width)).toBeLessThan(260);
    expect(Math.abs(node.y + node.height / 2 - (dashboard.y + dashboard.height / 2))).toBeLessThan(60);
  });

  it("keeps the API Gateway in the same spot in every tier, so Tab does not make the ghost jump", () => {
    const spot = (o: PredictedAction) => shapesOf(o).find((s) => s.label === "API Gateway");
    const a = spot(res.options[0])!;
    for (const o of res.options) expect(spot(o)).toMatchObject({ x: a.x, y: a.y });
  });

  it("(b) is a small cluster (2-4 nodes) and (c) the full architecture (5+), reusing Client Dashboard", () => {
    expect(shapesOf(res.options[1]).length).toBeGreaterThanOrEqual(2);
    expect(shapesOf(res.options[1]).length).toBeLessThanOrEqual(4);
    expect(shapesOf(res.options[2]).length).toBeGreaterThanOrEqual(5);
    const fullLabels = shapesOf(res.options[2]).map((s) => s.label.toLowerCase());
    expect(fullLabels.some((l) => /client|web|mobile/.test(l))).toBe(false);
  });

  it("names the concept so the Thought Bar can complete it", () => {
    expect(res.concept.label).toBe("API Gateway");
  });
});

describe("S5 type-ahead: partial text predicts the component from context", () => {
  it.each([
    ["api", "API Gateway"],
    ["apigat", "API Gateway"],
    ["red", "Redis Cache"],
    ["kaf", "Event Bus"],
    ["post", "Postgres DB"],
  ])("%s -> %s", (text, label) => {
    expect(predictConcept(text, [dashboard], dashboard)?.label).toBe(label);
  });

  it("'api' after Client Dashboard: Enter adds a node named API, and Tab completes to API Gateway", () => {
    const res = buildNextOptions({ elements: [dashboard], text: "api" })!;
    expectWellFormed([dashboard], res);
    const [a] = res.options;
    expect(shapesOf(a).map((s) => s.label)).toEqual(["API"]);
    expect(arrowsOf(a)).toHaveLength(0);
    expect(res.concept.completion).toBe("API Gateway");
  });

  it("one letter already shows the node Enter adds", () => {
    const res = buildNextOptions({ elements: [dashboard], text: "a" })!;
    expect(res.options.map((o) => o.title)).toEqual(["A"]);
  });

  it("goes beside the selected node over the most recent one", () => {
    const board = [dashboard, el({ id: "svc", label: "Order Service", x: 700, y: 160 })];
    const res = buildNextOptions({ elements: board, text: "postgres", selectedIds: ["svc"] })!;
    expect(res.typed!.anchorId).toBe("svc");
    expect(arrowsOf(res.options[1]).some((ar) => ar.fromId === "svc")).toBe(true);
  });
});

describe("S2: blank board, typed 'url shortener'", () => {
  const res = buildNextOptions({ elements: [], text: "url shortener", viewportCenter: { x: 600, y: 400 } })!;

  it("goes from the one typed node to a small start to the full HLD, each one connected piece", () => {
    expectWellFormed([], res);
    const counts = res.options.map((o) => shapesOf(o).length);
    expect(shapesOf(res.options[0]).map((s) => s.label)).toEqual(["URL Shortener"]);
    expect(counts[1]).toBeGreaterThanOrEqual(2);
    expect(counts[2]).toBeGreaterThanOrEqual(7);
  });

  it("names the nodes after the system", () => {
    const labels = shapesOf(res.options[2]).map((s) => s.label.toLowerCase()).join(" | ");
    expect(labels).toMatch(/short/);
    expect(labels).toMatch(/cache/);
  });

  it("sits around the viewport centre", () => {
    const xs = shapesOf(res.options[0]).map((s) => s.x + s.width / 2);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Math.abs(mid - 600)).toBeLessThan(400);
  });
});

describe("S3: Checkout and Inventory selected", () => {
  const board = [
    el({ id: "co", label: "Checkout", x: 100, y: 100 }),
    el({ id: "inv", label: "Inventory", x: 100, y: 360 }),
  ];
  const res = buildNextOptions({ elements: board, selectedIds: ["co", "inv"] })!;

  it("offers a link, then a connected Order Service, then a bigger build-out", () => {
    expect(res.options).toHaveLength(3);
    const [a, b, c] = res.options;
    expect(shapesOf(a)).toHaveLength(0);
    const link = arrowsOf(a)[0];
    expect(new Set([link.fromId, link.toId])).toEqual(new Set(["co", "inv"]));
    expect(link.label.trim()).not.toBe("");
    const hub = shapesOf(b).find((s) => s.label === "Order Service")!;
    expect(hub).toBeDefined();
    for (const id of ["co", "inv"]) {
      expect(arrowsOf(b).some((ar) => (ar.fromId === id && ar.toId === hub.id) || (ar.toId === id && ar.fromId === hub.id))).toBe(true);
    }
    expect(shapesOf(c).length).toBeGreaterThan(shapesOf(b).length);
    expect(shapesOf(c).some((s) => s.label === "Order Service")).toBe(true);
    for (const o of res.options) expect(allAttached(board, o)).toBe(true);
  });
});

describe("S4: Client -> API -> DB, DB selected", () => {
  const board = [
    el({ id: "c", label: "Client", x: 0, y: 200 }),
    el({ id: "api", label: "API", x: 320, y: 200 }),
    el({ id: "db", label: "DB", kind: "database", x: 640, y: 200, width: 156, height: 86 }),
    arrow("a1", "c", "api"),
    arrow("a2", "api", "db"),
  ];
  const res = buildNextOptions({ elements: board, selectedIds: ["db"] })!;

  it("names next steps after the database: replica, cache, backups", () => {
    expectWellFormed(board, res);
    const [a, b] = res.options;
    expect(shapesOf(a)).toHaveLength(1);
    expect(shapesOf(a)[0].label).toMatch(/replica/i);
    expect(arrowsOf(a)[0].fromId).toBe("db");
    const clusterLabels = shapesOf(b).map((s) => s.label.toLowerCase()).join(" | ");
    expect(clusterLabels).toMatch(/replica/);
    expect(clusterLabels).toMatch(/cache/);
    expect(clusterLabels).toMatch(/backup/);
  });

  it("puts the cache in front of the database (API reads through it), not hanging off the DB", () => {
    const cache = shapesOf(res.options[1]).find((s) => /cache/i.test(s.label))!;
    expect(arrowsOf(res.options[1]).some((ar) => ar.fromId === "api" && ar.toId === cache.id)).toBe(true);
  });
});

describe("context first: reuse, never duplicate, never float", () => {
  it("reuses an existing database instead of drawing a second one", () => {
    const board = [dashboard, el({ id: "pg", label: "Postgres", kind: "database", x: 900, y: 500 })];
    const res = buildNextOptions({ elements: board, text: "api gateway" })!;
    expectWellFormed(board, res);
    for (const o of res.options) expect(shapesOf(o).some((s) => /postgres/i.test(s.label))).toBe(false);
    expect(arrowsOf(res.options[2]).some((ar) => ar.toId === "pg")).toBe(true);
  });

  it("a name the board already has: Enter adds another one; the bigger options reuse the one that is there", () => {
    const board = [dashboard, el({ id: "gw", label: "API Gateway", x: 600, y: 160 })];
    const res = buildNextOptions({ elements: board, text: "api gateway", selectedIds: ["cd"] })!;
    expect(res.options).toHaveLength(3);
    const [a, ...bigger] = res.options;
    expect(shapesOf(a).map((s) => s.label)).toEqual(["API Gateway"]);
    expect(arrowsOf(a)).toHaveLength(0);
    for (const o of bigger) expect(shapesOf(o).some((s) => s.label === "API Gateway")).toBe(false);
  });

  it("an unknown word still gives three attached options", () => {
    const res = buildNextOptions({ elements: [dashboard], text: "zorblax" })!;
    expectWellFormed([dashboard], res);
    expect(shapesOf(res.options[0])[0].label).toBe("Zorblax");
  });

  it("explicit arrows draw exactly that flow as (a)", () => {
    const res = buildNextOptions({ elements: [], text: "app -> gateway -> server", viewportCenter: { x: 500, y: 300 } })!;
    expectWellFormed([], res);
    expect(shapesOf(res.options[0]).map((s) => s.label)).toEqual(["App", "Gateway", "Server"]);
    expect(arrowsOf(res.options[0])).toHaveLength(2);
  });

  it("a created node gets tiered next steps from its own name", () => {
    const board = [el({ id: "w", label: "Web App", x: 300, y: 300 })];
    const res = buildNextOptions({ elements: board, subjectId: "w" })!;
    expectWellFormed(board, res);
    expect(arrowsOf(res.options[0])[0].fromId).toBe("w");
  });
});

describe("LLM structures refine (b) and (c) but stay attached and deduplicated", () => {
  const board = [dashboard];
  const res = buildNextOptions({ elements: board, text: "apigateway" })!;
  const refined = refineOptionsWithGraphs(res, board, {
    cluster: {
      nodes: [
        { label: "API Gateway", kind: "lb" },
        { label: "Client Dashboard", kind: "actor" },
        { label: "Session Service", kind: "node" },
        { label: "Dashboard BFF", kind: "node" },
      ],
      edges: [
        { from: "Client Dashboard", to: "API Gateway", label: "HTTPS" },
        { from: "API Gateway", to: "Session Service", label: "verify" },
        { from: "API Gateway", to: "Dashboard BFF", label: "routes" },
      ],
    },
    full: {
      nodes: [
        { label: "Metrics Service", kind: "node" },
        { label: "Metrics DB", kind: "database" },
        { label: "Alert Queue", kind: "queue" },
        { label: "Alert Worker", kind: "node" },
        { label: "Cache", kind: "cache" },
      ],
      edges: [
        { from: "Metrics Service", to: "Metrics DB" },
        { from: "Metrics Service", to: "Alert Queue" },
        { from: "Alert Queue", to: "Alert Worker" },
        { from: "Metrics Service", to: "Cache" },
      ],
    },
  });

  it("keeps (a) untouched and swaps in the LLM names for (b) and (c)", () => {
    expect(refined.options[0]).toBe(res.options[0]);
    expect(shapesOf(refined.options[1]).map((s) => s.label)).toContain("Dashboard BFF");
    expect(refined.options[1].source).toBe("llm");
    expectWellFormed(board, refined);
  });

  it("attaches a detached LLM graph to the board instead of letting it float", () => {
    expect(allAttached(board, refined.options[2])).toBe(true);
    expect(shapesOf(refined.options[2]).some((s) => s.label === "Client Dashboard")).toBe(false);
  });
});

// Real-AI run, 21 Nov: for Checkout + Inventory the LLM drew a node literally named "Checkout + Inventory".
describe("LLM refinement for a multi-selection keeps the hub wired to both selected nodes", () => {
  const board = [
    el({ id: "co", label: "Checkout", x: 100, y: 100 }),
    el({ id: "inv", label: "Inventory", x: 100, y: 360 }),
  ];
  const res = buildNextOptions({ elements: board, selectedIds: ["co", "inv"] })!;
  const refined = refineOptionsWithGraphs(res, board, {
    cluster: {
      nodes: [
        { label: "Checkout + Inventory", kind: "node" },
        { label: "Order Service", kind: "node" },
        { label: "Orders DB", kind: "database" },
      ],
      edges: [
        { from: "Checkout", to: "Order Service" },
        { from: "Order Service", to: "Orders DB" },
      ],
    },
  });

  it("sends the deterministic names as a baseline for the LLM", () => {
    expect(res.request!.baseline.cluster[0]).toBe("Order Service");
    expect(res.request!.baseline.full.length).toBeGreaterThan(1);
  });

  it("drops combined labels and keeps Order Service connected to Checkout and Inventory", () => {
    const b = refined.options[1];
    expect(shapesOf(b).some((s) => s.label.includes("+"))).toBe(false);
    const hub = shapesOf(b).find((s) => s.label === "Order Service")!;
    for (const id of ["co", "inv"]) {
      expect(arrowsOf(b).some((ar) => (ar.fromId === id && ar.toId === hub.id) || (ar.toId === id && ar.fromId === hub.id))).toBe(true);
    }
  });
});

// Charles on prod, 21 Nov: board "App", typed "api gateway", got the generic template beside the board.
describe("board App, typed 'api gateway'", () => {
  const board = [el({ id: "app", label: "App", x: 200, y: 200 })];
  const res = buildNextOptions({ elements: board, text: "api gateway" })!;
  it("(a) is one API Gateway beside App; the bigger options link it from App, App never duplicated", () => {
    expectWellFormed(board, res);
    expect(shapesOf(res.options[0]).map((s) => s.label)).toEqual(["API Gateway"]);
    expect(res.typed!.anchorId).toBe("app");
    expect(arrowsOf(res.options[1]).some((ar) => ar.fromId === "app" && ar.toId === res.typed!.node.id)).toBe(true);
  });
});

// Judge round 2, 21 Nov: after applying the full option, the next options read "Event Queue + After API Gateway + API Gateway OK?".
describe("follow-up options after the full build-out", () => {
  const board = [dashboard];
  const full = buildNextOptions({ elements: board, text: "apigateway" })!.options[2];
  const after = [...board, ...full.addElements];
  const gw = full.addElements.find((e) => e.label === "API Gateway")!;
  const res = buildNextOptions({ elements: after, subjectId: gw.id });
  it("never offers names made from the node's own label, nor a second queue or cache", () => {
    const labels = (res?.options ?? []).flatMap((o) => shapesOf(o).map((s) => s.label));
    expect(labels.filter((l) => l.includes("?") || ["Observability", "Audit Store", "Rate Limiter"].includes(l))).toEqual([]);
    expect(labels.filter((l) => /^After |OK\?$/.test(l))).toEqual([]);
    expect(labels.filter((l) => /queue|bus|kafka|cache|redis/i.test(l))).toEqual([]);
  });
});

// Judges, 21 Nov: the LLM hung Redis off the DB ("DB -caches-> Redis"), pointed replicas at the primary, and
// renamed the same edge differently in (b) and (c). Such answers fall back to the lexicon option.
describe("LLM answers are checked for structure and label consistency", () => {
  const board = [
    el({ id: "c", label: "Client", x: 0, y: 200 }),
    el({ id: "api", label: "API", x: 320, y: 200 }),
    el({ id: "db", label: "DB", kind: "database", x: 640, y: 200, width: 156, height: 86 }),
    arrow("a1", "c", "api"),
    arrow("a2", "api", "db"),
  ];
  const res = buildNextOptions({ elements: board, selectedIds: ["db"] })!;
  const labelOf = (o: PredictedAction, id?: string) =>
    board.find((e) => e.id === id)?.label ?? o.addElements.find((e) => e.id === id)?.label;

  it("rejects a cache hung off the database and keeps the lexicon cluster", () => {
    const refined = refineOptionsWithGraphs(res, board, {
      cluster: {
        nodes: [
          { label: "Read Replica", kind: "database" },
          { label: "Redis Cache", kind: "cache" },
          { label: "Backups", kind: "blob" },
        ],
        edges: [
          { from: "DB", to: "Read Replica", label: "replicates" },
          { from: "DB", to: "Redis Cache", label: "caches" },
          { from: "DB", to: "Backups", label: "snapshots" },
        ],
      },
    });
    expect(refined.options[1]).toBe(res.options[1]);
  });

  it("never lets a replica write into the primary", () => {
    const refined = refineOptionsWithGraphs(res, board, {
      full: {
        nodes: [
          { label: "Read Replica", kind: "database" },
          { label: "Redis Cache", kind: "cache" },
          { label: "Backups", kind: "blob" },
          { label: "CDC Stream", kind: "queue" },
          { label: "Warehouse", kind: "database" },
          { label: "Failover", kind: "database" },
        ],
        edges: [
          { from: "Read Replica", to: "DB", label: "syncs" },
          { from: "API", to: "Redis Cache", label: "reads" },
          { from: "DB", to: "Backups" },
          { from: "DB", to: "CDC Stream" },
          { from: "CDC Stream", to: "Warehouse" },
          { from: "DB", to: "Failover" },
        ],
      },
    });
    const full = refined.options[2];
    const replica = full.addElements.filter((e) => /replica/i.test(e.label) && e.kind !== "arrow").map((e) => e.id);
    expect(full.addElements.some((e) => e.kind === "arrow" && replica.includes(e.fromId!) && e.toId === "db")).toBe(false);
  });

  it("structureProblems names a replica that writes into the primary", () => {
    const bad = {
      ...res.options[0],
      addElements: [
        el({ id: "r", label: "Read Replica", kind: "database", x: 900, y: 200 }),
        el({ id: "x", kind: "arrow", label: "syncs", fromId: "r", toId: "db", x: 0, y: 0, width: 0, height: 0 }),
      ],
    };
    expect(structureProblems(bad, board)).toContain("replica Read Replica writes into DB");
  });

  it("an edge between the same two nodes reads the same in every option", () => {
    const refined = refineOptionsWithGraphs(res, board, {
      cluster: {
        nodes: [
          { label: "Read Replica", kind: "database" },
          { label: "Redis Cache", kind: "cache" },
          { label: "Backups", kind: "blob" },
        ],
        edges: [
          { from: "DB", to: "Read Replica", label: "streams WAL" },
          { from: "API", to: "Redis Cache", label: "reads" },
          { from: "DB", to: "Backups", label: "nightly" },
        ],
      },
    });
    const names = new Map<string, Set<string>>();
    for (const o of refined.options) {
      for (const a of o.addElements.filter((e) => e.kind === "arrow")) {
        const key = `${labelOf(o, a.fromId)} -> ${labelOf(o, a.toId)}`;
        names.set(key, new Set([...(names.get(key) ?? []), a.label]));
      }
    }
    for (const [key, set] of names) expect([key, [...set]]).toEqual([key, [...set].slice(0, 1)]);
  });
});

// Feature check context-suggestions-multi, 21 Nov: with Payment Gateway between them, the Checkout API -> Ledger DB
// link vanished because the ghost layout dropped edges that pass a node.
describe("a link between two selected board nodes always survives", () => {
  it("is option (a) even when another node sits between them", () => {
    const board = [
      el({ id: "api", label: "Checkout API", x: 0, y: 200 }),
      el({ id: "pg", label: "Payment Gateway", x: 300, y: 200 }),
      el({ id: "led", label: "Ledger DB", kind: "database", x: 600, y: 200, width: 156, height: 86 }),
    ];
    const res = buildNextOptions({ elements: board, selectedIds: ["api", "led"] })!;
    expect(res.options[0].title).toMatch(/Checkout API.*Ledger DB|Ledger DB.*Checkout API/);
  });
});

// Re-judge, 21 Nov: the LLM cluster dropped a node that option (a) had. Since the core loop (22 Nov) a typed
// name's (a) is the one typed node, so the rule is checked where (a) still has several nodes: a typed flow.
describe("bigger options contain the smaller one", () => {
  it("rejects an LLM cluster that leaves out a node of option (a)", () => {
    const res = buildNextOptions({ elements: [], text: "client -> shortener api", viewportCenter: { x: 600, y: 400 } })!;
    expect(shapesOf(res.options[0]).map((s) => s.label)).toEqual(["Client", "Shortener API"]);
    const refined = refineOptionsWithGraphs(res, [], {
      cluster: {
        nodes: [
          { label: "URL Store", kind: "database" },
          { label: "Redirect Cache", kind: "cache" },
          { label: "Key Generator", kind: "node" },
        ],
        edges: [
          { from: "URL Store", to: "Redirect Cache" },
          { from: "URL Store", to: "Key Generator" },
        ],
      },
    });
    expect(refined.options[1]).toBe(res.options[1]);
  });

  it("lets an LLM cluster for a typed system stand without the typed node (URL Shortener is not a node of its HLD)", () => {
    const res = buildNextOptions({ elements: [], text: "url shortener", viewportCenter: { x: 600, y: 400 } })!;
    const refined = refineOptionsWithGraphs(res, [], {
      cluster: {
        nodes: [
          { label: "Client", kind: "actor" },
          { label: "Shortener API", kind: "node" },
          { label: "URL Store", kind: "database" },
          { label: "Redirect Cache", kind: "cache" },
        ],
        edges: [
          { from: "Client", to: "Shortener API" },
          { from: "Shortener API", to: "URL Store" },
          { from: "Shortener API", to: "Redirect Cache" },
        ],
      },
    });
    expect(refined.options[0]).toBe(res.options[0]);
    expect(shapesOf(refined.options[1]).map((s) => s.label)).toContain("Shortener API");
  });
});

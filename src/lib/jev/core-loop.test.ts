// Charles (22 Nov 2026): "any node i type and enter. first if its not there it should be created. second if it
// can connect with something existing we give it as a prediction. if the node is already there and the user
// still added it, we should still add it in the best possible space possible."
import { describe, expect, it } from "vitest";
import { connectionOptions, isFlowText, planTypedNode, typedNodeLabel } from "@/lib/jev/core-loop";
import { buildAfterCreateOptions, buildNextOptions, predictConcept, refineOptionsWithGraphs } from "@/lib/jev/next-options";
import type { JevElement, ShapeKind } from "@/lib/jev/types";

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
const CENTER = { x: 700, y: 400 };

const app = el({ id: "app", label: "App", x: 100, y: 300 });
const gateway = el({ id: "gw", label: "API Gateway", kind: "lb", x: 400, y: 296, width: 168, height: 80 });
const postgres = el({ id: "pg", label: "Postgres", kind: "database", x: 700, y: 293, width: 156, height: 86 });
const chain = [app, gateway, postgres, arrow("a1", "app", "gw"), arrow("a2", "gw", "pg")];

const boxesOverlap = (a: JevElement, b: JevElement, pad = 0) =>
  !(a.x + a.width + pad <= b.x || b.x + b.width + pad <= a.x || a.y + a.height + pad <= b.y || b.y + b.height + pad <= a.y);
const gapBetween = (a: JevElement, b: JevElement) => {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
};
const plan = (text: string, elements: JevElement[], extra: Partial<Parameters<typeof planTypedNode>[0]> = {}) =>
  planTypedNode({ text, elements, viewportCenter: CENTER, ...extra })!;

describe("the node is named what the user typed", () => {
  it.each([
    ["app", "App"],
    ["api gateway", "API Gateway"],
    ["apigateway", "API Gateway"],
    ["API GATEWAY", "API Gateway"],
    ["postgres", "Postgres"],
    ["api", "API"],
    ["user db", "User DB"],
    ["orders queue", "Orders Queue"],
    ["  billing   service ", "Billing Service"],
    ["iPhone app", "iPhone App"],
    ["s3", "S3"],
    ["x", "X"],
    ["Api gateway", "API Gateway"],
    ["payments with stripe and a ledger", "Payments with Stripe and a Ledger"],
    ["the cache", "The Cache"],
  ])("%s -> %s", (typed, label) => {
    expect(typedNodeLabel(typed)).toBe(label);
    expect(plan(typed, []).node.label).toBe(label);
  });

  it("never swaps the name for a catalog one (prod 22 Nov: app became Client App, postgres became Postgres DB)", () => {
    for (const typed of ["app", "postgres", "cdn", "db", "queue", "auth", "cache"]) {
      const { label } = plan(typed, chain).node;
      expect(label.toLowerCase()).toBe(typed);
    }
  });

  it("draws the usual shape for the name, a box when it does not know, a figure only for people", () => {
    const kind = (t: string): ShapeKind => plan(t, []).node.kind as ShapeKind;
    expect(kind("postgres")).toBe("database");
    expect(kind("redis")).toBe("cache");
    expect(kind("kafka")).toBe("queue");
    expect(kind("api gateway")).toBe("lb");
    expect(kind("app")).toBe("node");
    expect(kind("billing")).toBe("node");
    expect(kind("user")).toBe("actor");
    expect(kind("customer")).toBe("actor");
  });

  it("draws a whole sentence as a plain box", () => {
    expect(plan("payments with stripe and a ledger", []).node.kind).toBe("node");
  });

  it("adds the catalog's detail line only when the name is the catalog's own", () => {
    expect(plan("api gateway", []).node.sublabel).toBe("Routing, auth, rate limits");
    expect(plan("postgres", []).node.sublabel).toBeUndefined();
    expect(plan("billing", []).node.sublabel).toBeUndefined();
  });

  it("always plans a node for non-empty text, and none for empty text", () => {
    expect(planTypedNode({ text: "   ", elements: [], viewportCenter: CENTER })).toBeNull();
    for (const typed of ["a", "?", "url shortener", "design a chat app with redis and kafka", "東京"]) {
      expect(plan(typed, chain).node.label.length).toBeGreaterThan(0);
    }
  });

  it("treats arrows as a flow, everything else as one node", () => {
    expect(isFlowText("app -> api")).toBe(true);
    expect(isFlowText("app → api")).toBe(true);
    expect(isFlowText("api gateway")).toBe(false);
    expect(isFlowText("url shortener with redis")).toBe(false);
  });
});

describe("placement: free space beside the selected, related or last node", () => {
  it("puts the first node at the centre of the view", () => {
    const { node, anchorId } = plan("app", []);
    expect(anchorId).toBeNull();
    expect(node.x + node.width / 2).toBeCloseTo(CENTER.x, 0);
    expect(node.y + node.height / 2).toBeCloseTo(CENTER.y, 0);
  });

  it("puts the next node to the right of the last one, on the same row", () => {
    const first = el({ id: "alpha", label: "Alpha", x: 300, y: 300 });
    const { node, anchorId } = plan("beta", [first], { lastFocusedId: "alpha" });
    expect(anchorId).toBe("alpha");
    expect(node.x).toBe(first.x + first.width + 128);
    expect(node.y + node.height / 2).toBe(first.y + first.height / 2);
  });

  it("puts the node beside the node the user selected, wherever the last one is", () => {
    const { node, anchorId } = plan("billing", chain, { selectedIds: ["app"], lastFocusedId: "pg" });
    expect(anchorId).toBe("app");
    expect(gapBetween(node, app)).toBeLessThanOrEqual(200);
    for (const other of [app, gateway, postgres]) expect(boxesOverlap(node, other, 16)).toBe(false);
  });

  it("puts a name the board already has in the next free slot, never on its twin", () => {
    const first = plan("app", chain, { lastFocusedId: "pg" }).node;
    const second = plan("app", [...chain, first], { lastFocusedId: first.id }).node;
    for (const n of [first, second]) {
      expect(n.label).toBe("App");
      for (const other of [app, gateway, postgres]) expect(boxesOverlap(n, other, 16)).toBe(false);
    }
    expect(boxesOverlap(first, second, 16)).toBe(false);
  });

  it("places by role: a CDN goes beside the App that feeds it, not beside the last node", () => {
    const { anchorId, node } = plan("cdn", chain, { lastFocusedId: "pg" });
    expect(anchorId).toBe("app");
    expect(gapBetween(node, app)).toBeLessThan(gapBetween(node, postgres));
  });

  it("places what feeds a node on its left", () => {
    const { node, anchorId } = plan("app", [gateway], { lastFocusedId: "gw" });
    expect(anchorId).toBe("gw");
    expect(node.x + node.width).toBeLessThan(gateway.x);
  });

  it("ignores nodes that are off screen and uses the view instead", () => {
    const viewport = { x: 5000, y: 5000, width: 1400, height: 700 };
    const { node, anchorId } = plan("billing", chain, { lastFocusedId: "pg", viewportCenter: { x: 5700, y: 5350 }, viewport });
    expect(anchorId).toBeNull();
    expect(node.x).toBeGreaterThan(5000);
  });

  // Judge on prod, 22 Nov: with API Gateway selected, six new nodes piled into one tall column around Postgres.
  it("keeps a run of nodes around the selected node instead of one tall column", () => {
    let board: JevElement[] = [...chain];
    const added: JevElement[] = [];
    for (const name of ["auth", "queue", "worker", "billing", "search", "mailer"]) {
      const { node } = plan(name, board, { selectedIds: ["gw"] });
      added.push(node);
      board = [...board, node];
    }
    const centre = gateway.y + gateway.height / 2;
    const rows = added.map((n) => Math.abs(n.y + n.height / 2 - centre));
    expect(Math.max(...rows)).toBeLessThanOrEqual(2 * (86 + 56));
    expect(added.filter((n) => Math.abs(n.x - gateway.x) < 60).length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < added.length; i++) {
      for (const other of [...chain.filter((e) => e.kind !== "arrow"), ...added.slice(0, i)]) {
        expect(boxesOverlap(added[i], other, 16)).toBe(false);
      }
    }
  });

  // Judge on prod, 22 Nov: the preview said "beside App" while the node went under API Gateway.
  it("says beside only for the slot right next to the anchor, near otherwise", () => {
    const beside = buildNextOptions({ elements: [app], text: "billing", selectedIds: ["app"], viewportCenter: CENTER })!;
    expect(beside.options[0].subtitle).toBe("new node beside App");
    expect(beside.intent.detail).toBe("beside App");
    const near = buildNextOptions({ elements: chain, text: "billing", selectedIds: ["app"], viewportCenter: CENTER })!;
    expect(near.options[0].subtitle).toBe("new node near App");
    expect(near.intent.detail).toBe("near App");
  });

  it("is the same every time for the same board and text", () => {
    const a = plan("redis", chain, { lastFocusedId: "pg" }).node;
    const b = plan("redis", chain, { lastFocusedId: "pg" }).node;
    expect([a.x, a.y, a.label, a.kind, a.width, a.height]).toEqual([b.x, b.y, b.label, b.kind, b.width, b.height]);
  });

  it("never overlaps a node, however crowded the board (2000 seeded boards)", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const names = ["app", "api gateway", "postgres", "redis", "billing", "worker", "kafka", "user", "x"];
    for (let round = 0; round < 2000; round++) {
      const count = 1 + Math.floor(rand() * 40);
      const board: JevElement[] = [];
      for (let i = 0; i < count; i++) {
        board.push(el({ id: `n${i}`, label: names[i % names.length], x: Math.round(rand() * 1600), y: Math.round(rand() * 900) }));
      }
      for (let i = 1; i < count; i += 3) board.push(arrow(`a${i}`, `n${i - 1}`, `n${i}`));
      const pick = board[Math.floor(rand() * count)].id;
      const text = names[Math.floor(rand() * names.length)];
      const frozen = JSON.stringify(board);
      const { node } = plan(text, board, rand() < 0.5 ? { selectedIds: [pick] } : { lastFocusedId: pick });
      const hit = board.find((o) => o.kind !== "arrow" && boxesOverlap(node, o));
      expect(hit, `round ${round}: "${text}" landed on ${hit?.id}`).toBeUndefined();
      expect(JSON.stringify(board)).toBe(frozen);
    }
  });
});

describe("connections are offered after the node exists, never applied", () => {
  const fresh = (label: string, kind: ShapeKind, x: number, y: number) => el({ id: "new", label, kind, x, y });

  it("offers nothing on a board with one node", () => {
    expect(connectionOptions({ elements: [app], nodeId: "app" })).toEqual([]);
  });

  it("offers App -> API Gateway first, as one arrow and no shapes", () => {
    const node = fresh("API Gateway", "lb", 400, 296);
    const [first] = connectionOptions({ elements: [app, node], nodeId: "new", anchorIds: ["app"] });
    expect(first.title).toBe("App → API Gateway");
    expect(first.category).toBe("connect");
    expect(first.addElements).toHaveLength(1);
    expect(first.addElements[0]).toMatchObject({ kind: "arrow", fromId: "app", toId: "new" });
    expect(first.focusId).toBe("new");
  });

  it("orients by the usual flow: API Gateway -> Postgres even though Postgres was added last", () => {
    const node = fresh("Postgres", "database", 700, 293);
    const options = connectionOptions({ elements: [app, gateway, arrow("a1", "app", "gw"), node], nodeId: "new", anchorIds: ["gw"] });
    expect(options[0].addElements[0]).toMatchObject({ fromId: "gw", toId: "new" });
    expect(options.length).toBeLessThanOrEqual(3);
  });

  it("does not offer a link that is already on the board", () => {
    const node = fresh("Postgres", "database", 700, 293);
    const board = [app, gateway, node, arrow("a2", "gw", "new")];
    expect(connectionOptions({ elements: board, nodeId: "new", anchorIds: ["gw"] })).toEqual([]);
  });

  it("offers a link to every node that was selected when the node was added", () => {
    const board = [app, gateway, postgres, arrow("a1", "app", "gw"), arrow("a2", "gw", "pg")];
    const created = planTypedNode({ text: "billing", elements: board, selectedIds: ["app", "pg"], viewportCenter: CENTER })!;
    expect(created.anchorIds).toEqual(["app", "pg"]);
    const options = connectionOptions({ elements: [...board, created.node], nodeId: created.node.id, anchorIds: created.anchorIds });
    const ends = options.map((o) => [o.addElements[0].fromId, o.addElements[0].toId].find((id) => id !== created.node.id));
    expect(ends).toEqual(expect.arrayContaining(["app", "pg"]));
  });

  it("labels the link with the usual word for what flows into the target", () => {
    const node = fresh("Postgres", "database", 700, 293);
    const [first] = connectionOptions({ elements: [app, gateway, node], nodeId: "new", anchorIds: ["gw"] });
    expect(first.addElements[0].label).toBe("SQL");
  });

  // Judge on prod, 22 Nov: with three Postgres nodes the top two suggestions were both "Postgres → Postgres".
  it("never offers a link between two nodes with the same name", () => {
    const twin = el({ id: "new", label: "Postgres", kind: "database", x: 700, y: 500, width: 156, height: 86 });
    const third = el({ id: "pg3", label: "postgres", kind: "database", x: 950, y: 500, width: 156, height: 86 });
    const options = connectionOptions({ elements: [app, gateway, postgres, third, twin], nodeId: "new", anchorIds: ["pg"] });
    for (const o of options) {
      const [link] = o.addElements;
      expect(new Set([link.fromId, link.toId]).has("pg")).toBe(false);
      expect(new Set([link.fromId, link.toId]).has("pg3")).toBe(false);
    }
    expect(connectionOptions({ elements: [postgres, third, twin], nodeId: "new", anchorIds: ["pg"] })).toEqual([]);
  });

  it("gives the same order every time", () => {
    const node = fresh("Redis", "cache", 700, 500);
    const titles = () => connectionOptions({ elements: [...chain, node], nodeId: "new", anchorIds: ["pg"] }).map((o) => o.title);
    expect(titles()).toEqual(titles());
    expect(titles().length).toBeGreaterThan(0);
  });

  it("puts the links ahead of the usual next steps, three in all", () => {
    const node = fresh("API Gateway", "lb", 400, 296);
    const result = buildAfterCreateOptions({ elements: [app, node], nodeId: "new", anchorIds: ["app"] })!;
    expect(result.options).toHaveLength(3);
    expect(result.options[0].title).toBe("App → API Gateway");
    expect(result.options.slice(1).every((o) => o.addElements.some((e) => e.kind !== "arrow"))).toBe(true);
    expect(result.request).toBeNull();
  });

  it("never offers the same link twice", () => {
    const twin = el({ id: "new", label: "App", x: 100, y: 500 });
    const result = buildAfterCreateOptions({ elements: [app, gateway, arrow("a1", "app", "gw"), twin], nodeId: "new", anchorIds: ["gw"] })!;
    const pairs = result.options
      .filter((o) => o.addElements.every((e) => e.kind === "arrow"))
      .map((o) => `${o.addElements[0].fromId}>${o.addElements[0].toId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toEqual(["new>gw"]);
  });
});

describe("typing shows what Enter adds as option 1", () => {
  const typed = (text: string, elements: JevElement[], extra = {}) =>
    buildNextOptions({ elements, text, viewportCenter: CENTER, ...extra })!;

  it("option 1 is exactly the planned node: one shape, no arrows", () => {
    const result = typed("api gateway", [app], { subjectId: "app" });
    expect(result.options).toHaveLength(3);
    expect(result.options[0].addElements).toEqual([result.typed!.node]);
    expect(result.options[0]).toMatchObject({ title: "API Gateway", tier: "minimal", nodeCount: 1 });
    expect(result.intent.headline).toBe("Enter adds API Gateway");
  });

  it("offers the typed name again when the board already has it (prod 22 Nov: Enter did nothing)", () => {
    const result = typed("app", chain, { subjectId: "pg" });
    expect(result.options[0]).toMatchObject({ title: "App", nodeCount: 1 });
    expect(result.options[0].addElements.filter((e) => e.kind === "arrow")).toHaveLength(0);
  });

  it("offers CDN for cdn (prod 22 Nov: it offered Object Storage hung off the gateway)", () => {
    const result = typed("cdn", chain, { selectedIds: ["app"] });
    expect(result.options[0].title).toBe("CDN");
    expect(result.typed!.anchorId).toBe("app");
  });

  it("still shows the node for a one-letter name, with nothing for the server to rank", () => {
    const result = typed("q", chain, { subjectId: "pg" });
    expect(result.options).toHaveLength(1);
    expect(result.options[0].title).toBe("Q");
    expect(result.request).toBeNull();
  });

  it("never offers an option that would add nothing", () => {
    const board = [el({ id: "a", label: "App", x: 0, y: 200 }), el({ id: "g", label: "Api Gateway", kind: "lb", x: 320, y: 200 }), el({ id: "p", label: "Postgres", kind: "database", x: 640, y: 200 }), arrow("a1", "a", "g"), arrow("a2", "g", "p")];
    for (const input of [{ selectedIds: ["a"] }, { subjectId: "a" }, { text: "app" }, { text: "app", selectedIds: ["a"] }]) {
      const result = buildNextOptions({ elements: board, viewportCenter: CENTER, ...input });
      for (const o of result?.options ?? []) {
        expect(o.addElements.length, `${JSON.stringify(input)}: "${o.title}"`).toBeGreaterThan(0);
        expect(o.title.trim()).not.toBe("");
      }
    }
  });

  it("a typed sentence never stands in for a node of the bigger options (it replaced the Ledger DB)", () => {
    const result = typed("payments with stripe and a ledger", []);
    for (const o of result.options.slice(1)) {
      expect(o.addElements.some((e) => e.id === result.typed!.node.id)).toBe(false);
    }
  });

  // Judge on prod, 22 Nov: Tab turned "kaf" into Event Bus and "app" into Client App.
  it("Tab completes only to a name that starts with what was typed", () => {
    const completion = (text: string) => predictConcept(text, [], null)?.completion;
    expect(completion("api")).toBe("API Gateway");
    expect(completion("post")).toBe("Postgres DB");
    expect(completion("red")).toBe("Redis Cache");
    expect(completion("kaf")).toBeUndefined();
    expect(completion("app")).toBeUndefined();
    expect(completion("db")).toBeUndefined();
    expect(completion("api gateway")).toBeUndefined();
  });

  it("keeps bigger options bigger", () => {
    const result = typed("api gateway", [app], { subjectId: "app" });
    const sizes = result.options.map((o) => o.nodeCount ?? 0);
    expect(sizes[0]).toBe(1);
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
    expect(sizes[2]).toBeGreaterThan(sizes[1]);
  });

  it("the LLM can reshape the bigger options but never option 1", () => {
    const result = typed("api gateway", [app], { subjectId: "app" });
    const refined = refineOptionsWithGraphs(result, [app], {
      cluster: { nodes: [{ label: "API Gateway", kind: "lb" }, { label: "Auth Service", kind: "node" }, { label: "Rate Limiter", kind: "node" }], edges: [] },
      full: null,
    });
    expect(refined.options[0]).toBe(result.options[0]);
  });

  it("a typed flow is drawn as typed, with the same capitals", () => {
    const result = typed("app -> api gateway -> postgres", []);
    expect(result.typed).toBeNull();
    const shapes = result.options[0].addElements.filter((e) => e.kind !== "arrow").map((e) => e.label);
    expect(shapes).toEqual(["App", "API Gateway", "Postgres"]);
    expect(result.options[0].addElements.filter((e) => e.kind === "arrow")).toHaveLength(2);
  });
});

// Charles (22 Nov 2026): "any node i type and enter. first if its not there it should be created. second if it
// can connect with something existing we give it as a prediction. if the node is already there and the user
// still added it, we should still add it in the best possible space possible."
import { describe, expect, it } from "vitest";
import {
  connectionOptions,
  enterDefaultIndex,
  isConnectionOf,
  isFlowText,
  NO_OPTION,
  planTypedNode,
  stepOption,
  typedNodeLabel,
} from "@/lib/jev/core-loop";
import {
  appendContextOption,
  bestContextOption,
  buildAfterCreateOptions,
  buildNextOptions,
  predictConcept,
  scoreOptions,
} from "@/lib/jev/next-options";
import { arrowHitsShape, labelRect, rectsIntersect } from "@/lib/jev/ghost-geometry";
import type { PredictedAction } from "@/lib/jev/types";
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
    ["payments with stripe and a ledger", "Payments with stripe and a ledger"],
    ["user uploads a photo, a worker stores it in s3", "User uploads a photo, a worker stores it in S3"],
    ["orders read replica", "Orders Read Replica"],
    ["dynamodb", "DynamoDB"],
    ["mongodb orders", "MongoDB Orders"],
    ["graphql api", "GraphQL API"],
    ["mysql", "MySQL"],
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

  // Round-2 judge, prod: "a node added after panning lands alone in the middle of the view, far from related nodes".
  it("stays with its related node even when the view has panned away (the camera brings it back)", () => {
    const viewport = { x: 5000, y: 5000, width: 1400, height: 700 };
    const { node, anchorId } = plan("billing", chain, { lastFocusedId: "pg", viewportCenter: { x: 5700, y: 5350 }, viewport });
    expect(anchorId).toBe("gw");
    expect(gapBetween(node, gateway)).toBeLessThanOrEqual(200);
  });

  // Round-2 judges, prod: Billing landed beside the CDN and "CDN → Billing" was the default, against jev's
  // 81% for API Gateway → Billing; Kafka was offered "Kafka → Read Replica · replicates".
  it("places a node beside the node that most plausibly feeds it, not just the nearest of its kind", () => {
    const cdn = el({ id: "cdn", label: "CDN", kind: "lb", x: 100, y: 436, width: 168, height: 80 });
    const board = [...chain, cdn];
    expect(plan("billing", board, { lastFocusedId: "cdn" }).anchorId).toBe("gw");
    expect(plan("kafka", board, { lastFocusedId: "pg" }).anchorId).toBe("gw");
    expect(plan("read replica", board, { lastFocusedId: "cdn" }).anchorId).toBe("pg");
    expect(plan("zorblax", board, { lastFocusedId: "cdn" }).anchorId).toBe("cdn");
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
    const below = el({ id: "b1", label: "Below", x: 100, y: 436 });
    const above = el({ id: "b2", label: "Above", x: 100, y: 164 });
    const near = buildNextOptions({ elements: [...chain, below, above], text: "billing", selectedIds: ["app"], viewportCenter: CENTER })!;
    expect(near.options[0].subtitle).toBe("new node near App");
    expect(near.intent.detail).toBe("near App");
  });

  // Second judge on prod, 22 Nov: "near App" pointed at a node that landed under API Gateway.
  it("with the flow side taken, goes straight below the anchor before going diagonal", () => {
    const { node, adjacent } = plan("billing", chain, { selectedIds: ["app"] });
    expect(adjacent).toBe(true);
    expect(Math.abs(node.x + node.width / 2 - (app.x + app.width / 2))).toBeLessThanOrEqual(2);
    expect(node.y).toBeGreaterThan(app.y + app.height);
  });

  // Round-2 judge, prod: with the cell under its twin taken, the second Postgres went diagonal.
  it("keeps copies in one column under their twin, past a cell that is taken", () => {
    const under = el({ id: "u", label: "Billing", x: 400, y: 432 });
    const { node, anchorId } = plan("api gateway", [...chain, under], { lastFocusedId: "pg" });
    expect(anchorId).toBe("gw");
    expect(Math.abs(node.x + node.width / 2 - (gateway.x + gateway.width / 2))).toBeLessThanOrEqual(2);
    expect(node.y).toBeGreaterThan(under.y + under.height);
  });

  // Round-2 judge, prod: "email sender", typed right after "notification service", landed beside the load balancer.
  it("puts a node beside another of its own kind before a more distant feeder", () => {
    const lb = el({ id: "lb", label: "Load Balancer", kind: "lb", x: 100, y: 300, width: 168, height: 80 });
    const notify = el({ id: "ns", label: "Notification Service", x: 900, y: 300 });
    expect(plan("email sender", [lb, notify], { lastFocusedId: "ns" }).anchorId).toBe("ns");
  });

  it("puts a copy straight under its twin", () => {
    const { node, anchorId } = plan("api gateway", chain, { lastFocusedId: "pg" });
    expect(anchorId).toBe("gw");
    expect(Math.abs(node.x + node.width / 2 - (gateway.x + gateway.width / 2))).toBeLessThanOrEqual(2);
    expect(node.y).toBeGreaterThan(gateway.y + gateway.height);
    const picked = plan("api gateway", chain, { selectedIds: ["app"], lastFocusedId: "pg" });
    expect(picked.anchorId).toBe("app");
  });

  // First judge on prod, 22 Nov: on a phone the nodes went in one row and the earlier ones scrolled off screen.
  it("on a phone-sized view, goes under the last node when the next column would be off screen", () => {
    const phone = { x: 0, y: 0, width: 736, height: 1100 };
    const first = el({ id: "a", label: "Alpha", x: 100, y: 300 });
    const second = plan("beta", [first], { lastFocusedId: "a", viewport: phone, viewportCenter: { x: 368, y: 550 } }).node;
    expect(second.x).toBeGreaterThan(first.x + first.width);
    const third = plan("gamma", [first, second], { lastFocusedId: second.id, viewport: phone, viewportCenter: { x: 368, y: 550 } }).node;
    expect(third.x + third.width).toBeLessThanOrEqual(phone.width);
    expect(third.y).toBeGreaterThan(second.y + second.height);
    const desktop = { x: 0, y: 0, width: 1440, height: 650 };
    const wide = plan("gamma", [first, second], { lastFocusedId: second.id, viewport: desktop, viewportCenter: { x: 720, y: 325 } }).node;
    expect(wide.y + wide.height / 2).toBe(second.y + second.height / 2);
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

  const titlesFor = (label: string, kind: ShapeKind, board: JevElement[], extra: Partial<Parameters<typeof connectionOptions>[0]> = {}) =>
    connectionOptions({ elements: [...board, fresh(label, kind, 1000, 600)], nodeId: "new", ...extra }).map(
      (o) => `${o.title} · ${o.addElements[0].label}`
    );
  const cdnNode = el({ id: "cdn", label: "CDN", kind: "lb", x: 100, y: 436, width: 168, height: 80 });
  const replica = el({ id: "rr", label: "Read Replica", kind: "database", x: 950, y: 293, width: 156, height: 86 });

  it("puts the link that follows the usual flow first: API Gateway → Billing ahead of CDN → Billing", () => {
    const titles = titlesFor("Billing", "node", [...chain, cdnNode], { anchorIds: ["cdn"] });
    expect(titles[0]).toMatch(/^API Gateway → Billing/);
  });

  it("offers Kafka the node that publishes to it, never a replica or the database", () => {
    const titles = titlesFor("Kafka", "queue", [...chain, replica], { anchorIds: ["rr"] });
    expect(titles[0]).toBe("API Gateway → Kafka · publishes to");
    expect(titles.join(" | ")).not.toMatch(/Read Replica|Postgres/);
  });

  it("knows the catalog's own links, with their words: Postgres → Read Replica · replicates", () => {
    expect(titlesFor("Read Replica", "database", chain, { anchorIds: ["app"] })[0]).toBe("Postgres → Read Replica · replicates");
    expect(titlesFor("Redis", "cache", chain, { anchorIds: ["pg"] })[0]).toBe("Redis → Postgres · on miss");
  });

  it("drops a loose pairing when the board has a clearly better one", () => {
    const titles = titlesFor("CDN", "lb", chain, { anchorIds: ["app"] });
    expect(titles[0]).toBe("App → CDN · assets");
    expect(titles.join(" | ")).not.toMatch(/Postgres/);
  });

  // Round-2 judge, prod: "Auth Service → Queue" was offered over the Web Server the user had clicked.
  it("puts the node the user had selected first, whatever else is related", () => {
    const auth = el({ id: "auth", label: "Auth Service", x: 400, y: 500 });
    const web = el({ id: "web", label: "Web Server", x: 700, y: 500 });
    const titles = titlesFor("Queue", "queue", [auth, web], { anchorIds: ["web"], userPicked: true });
    expect(titles[0]).toMatch(/^Web Server → Queue/);
  });

  it("links a name it does not know only to the node it was placed beside, with a plain verb", () => {
    expect(titlesFor("Zorblax", "node", chain, { anchorIds: ["pg"] })).toEqual(["Zorblax → Postgres · writes to"]);
    const story = "User uploads a photo, a worker stores it in S3";
    expect(titlesFor(story, "node", chain, { anchorIds: ["gw"] })).toEqual([`API Gateway → ${story} · `]);
  });

  it("never shows two options that read the same", () => {
    const twin = el({ id: "gw2", label: "API Gateway", kind: "lb", x: 400, y: 500, width: 168, height: 80 });
    const titles = connectionOptions({ elements: [...chain, twin, fresh("Billing", "node", 700, 500)], nodeId: "new", anchorIds: [] }).map((o) => o.title);
    expect(new Set(titles).size).toBe(titles.length);
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
    expect(created.userPicked).toBe(true);
    const options = connectionOptions({ elements: [...board, created.node], nodeId: created.node.id, anchorIds: created.anchorIds, userPicked: created.userPicked });
    const ends = options.map((o) => [o.addElements[0].fromId, o.addElements[0].toId].find((id) => id !== created.node.id));
    expect(ends).toEqual(expect.arrayContaining(["app", "pg"]));
  });

  it("labels a link the catalog knows with its word, any other with a plain verb", () => {
    const [known] = connectionOptions({ elements: [app, fresh("API Gateway", "lb", 400, 296)], nodeId: "new", anchorIds: ["app"] });
    expect(known.addElements[0].label).toBe("HTTPS");
    const [loose] = connectionOptions({ elements: [app, gateway, fresh("Postgres", "database", 700, 293)], nodeId: "new", anchorIds: ["gw"] });
    expect(loose.addElements[0].label).toBe("writes to");
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

  // Second judge on prod, 22 Nov: a ghost arrow ran through the node in between, its label over that node's name.
  // Since 2A the offered arrow goes around the nodes in between, so it keeps its label, clear of them.
  it("offers a link past other nodes as an arrow that goes around them, label and all", () => {
    const far = el({ id: "new", label: "Search", x: 1000, y: 300 });
    const board = [app, gateway, postgres, far];
    const options = connectionOptions({ elements: board, nodeId: "new", anchorIds: ["app"], userPicked: true });
    const past = options.find((o) => o.addElements[0].fromId === "app" || o.addElements[0].toId === "app")!;
    const link = past.addElements[0];
    const byId = new Map(board.map((e) => [e.id, e]));
    expect(arrowHitsShape(link, byId, board, 4)).toBeNull();
    expect(link.label).not.toBe("");
    const box = labelRect(link, byId)!;
    for (const node of [gateway, postgres]) expect(rectsIntersect(box, node)).toBe(false);
  });

  it("a link that cannot get around a node is offered as a bare line, without a label on top of that node", () => {
    const far = el({ id: "new", label: "Search", x: 1000, y: 300 });
    const wall = el({ id: "wall", label: "Wall", x: 500, y: -900, width: 172, height: 2400 });
    const options = connectionOptions({ elements: [app, wall, far], nodeId: "new", anchorIds: ["app"], userPicked: true });
    expect(options[0].addElements[0].label).toBe("");
    const beside = connectionOptions({ elements: [app, { ...far, x: 400 }], nodeId: "new", anchorIds: ["app"] });
    expect(beside[0].addElements[0].label).not.toBe("");
  });

  // Caren on prod, 22 Nov: with Worker and Object Storage on the board the offer was "Object Storage → Worker,
  // publishes to". A worker writes to storage; storage does not publish to a worker.
  it("offers Worker → Object Storage (writes to), never Object Storage → Worker", () => {
    const worker = el({ id: "w", label: "Worker", x: 400, y: 100 });
    const storage = el({ id: "s", label: "Object Storage", kind: "blob", x: 400, y: 300 });
    // Whichever of the two was added last, the offer reads the same.
    for (const nodeId of ["s", "w"]) {
      const [option] = connectionOptions({ elements: [worker, storage], nodeId });
      expect(option.title).toBe("Worker → Object Storage");
      expect(option.addElements[0].label).toBe("writes to");
    }
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

  it("still shows the node for a one-letter name", () => {
    const result = typed("q", chain, { subjectId: "pg" });
    expect(result.options).toHaveLength(1);
    expect(result.options[0].title).toBe("Q");
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

  // Second judge on prod, 22 Nov: with App on the board, "worker -> queue" also drew App -> Worker.
  it("a typed flow adds only the arrows that were typed, whatever is on the board", () => {
    for (const extra of [{}, { subjectId: "app" }, { selectedIds: ["app"] }]) {
      const result = typed("worker -> queue", [app], extra);
      const [flow] = result.options;
      const shapes = flow.addElements.filter((e) => e.kind !== "arrow");
      const arrows = flow.addElements.filter((e) => e.kind === "arrow");
      expect(shapes.map((e) => e.label)).toEqual(["Worker", "Queue"]);
      expect(arrows).toHaveLength(1);
      expect(arrows[0]).toMatchObject({ fromId: shapes[0].id, toId: shapes[1].id });
      for (const shape of shapes) expect(boxesOverlap(shape, app, 16)).toBe(false);
    }
    const reuse = typed("app -> worker", [app]).options[0];
    expect(reuse.addElements.filter((e) => e.kind !== "arrow").map((e) => e.label)).toEqual(["Worker"]);
    expect(reuse.addElements.filter((e) => e.kind === "arrow")[0]).toMatchObject({ fromId: "app" });
  });

  // Third judge on prod, 22 Nov: with an uploads node on the board, "api gateway -> postgres" drew "Uploads DB".
  it("a typed flow keeps the names that were typed, whatever the board is about", () => {
    const story = el({ id: "s", label: "User Uploads a Photo, a Worker Makes Thumbnails and Stores Them in S3", x: 700, y: 300 });
    for (const extra of [{ subjectId: "s" }, { selectedIds: ["s"] }, {}]) {
      const [flow] = typed("api gateway -> postgres", [app, gateway, story], extra).options;
      const shapes = flow.addElements.filter((e) => e.kind !== "arrow");
      expect(shapes.map((e) => e.label)).toEqual(["Postgres"]);
      expect(flow.addElements.filter((e) => e.kind === "arrow")).toHaveLength(1);
      expect(flow.addElements.find((e) => e.kind === "arrow")).toMatchObject({ fromId: "gw", toId: shapes[0].id });
    }
  });

  it("a typed flow reuses a board node only by its name, never as a stand-in", () => {
    const urlDb = el({ id: "udb", label: "URL DB", kind: "database", x: 700, y: 300, width: 156, height: 86 });
    const flow = typed("client -> postgres", [app, urlDb]).options[0];
    expect(flow.addElements.filter((e) => e.kind !== "arrow").map((e) => e.label)).toEqual(["Client", "Postgres"]);
    const byName = typed("app -> url db", [app, urlDb]).options[0];
    expect(byName.addElements.filter((e) => e.kind !== "arrow")).toHaveLength(0);
    expect(byName.addElements.find((e) => e.kind === "arrow")).toMatchObject({ fromId: "app", toId: "udb" });
  });

  // Round-2 judge, prod: on a board with App and Postgres, "app -> cache -> postgres" put Cache beyond Postgres
  // and the flow read backwards.
  it("a node typed between two board nodes lands between them, below, so the flow still reads left to right", () => {
    const far = el({ id: "pg2", label: "Postgres", kind: "database", x: 700, y: 293, width: 156, height: 86 });
    const flow = typed("app -> cache -> postgres", [app, far]).options[0];
    const shapes = flow.addElements.filter((e) => e.kind !== "arrow");
    expect(shapes.map((e) => e.label)).toEqual(["Cache"]);
    const cache = shapes[0];
    const mid = cache.x + cache.width / 2;
    expect(mid).toBeGreaterThan(app.x + app.width);
    expect(mid).toBeLessThan(far.x);
    expect(cache.y).toBeGreaterThan(Math.max(app.y + app.height, far.y + far.height));
    expect(flow.addElements.filter((e) => e.kind === "arrow").map((a) => [a.fromId, a.toId])).toEqual([
      ["app", cache.id],
      [cache.id, "pg2"],
    ]);
  });

  it("a typed flow is drawn as typed, with the same capitals", () => {
    const result = typed("app -> api gateway -> postgres", []);
    expect(result.typed).toBeNull();
    const shapes = result.options[0].addElements.filter((e) => e.kind !== "arrow").map((e) => e.label);
    expect(shapes).toEqual(["App", "API Gateway", "Postgres"]);
    expect(result.options[0].addElements.filter((e) => e.kind === "arrow")).toHaveLength(2);
  });
});

// Round-3 judge, prod: "postgres⏎ api⏎ redis⏎ postgres⏎ kafka Tab Tab ⏎" put Backups on top of Worker. Rule 2
// (never on another node) holds for every option, not only for the typed node.
describe("no option ever puts a node on another node", () => {
  const grow = (names: string[]) => {
    let board: JevElement[] = [];
    let last: string | null = null;
    for (const name of names) {
      const node: JevElement = planTypedNode({ text: name, elements: board, lastFocusedId: last, viewportCenter: CENTER })!.node;
      board = [...board, node];
      last = node.id;
    }
    return { board, last: last! };
  };
  const clashes = (board: JevElement[], input: Parameters<typeof buildNextOptions>[0]) => {
    const found: string[] = [];
    for (const [i, o] of (buildNextOptions(input)?.options ?? []).entries()) {
      const shapes = o.addElements.filter((e) => e.kind !== "arrow");
      shapes.forEach((a, k) => {
        for (const b of [...board, ...shapes.slice(k + 1)]) if (boxesOverlap(a, b)) found.push(`option ${i + 1}: ${a.label} on ${b.label}`);
      });
    }
    return found;
  };

  it("the judge's board: kafka after postgres, api, redis, postgres", () => {
    const { board, last } = grow(["postgres", "api", "redis", "postgres"]);
    expect(clashes(board, { elements: board, text: "kafka", subjectId: last, viewportCenter: CENTER })).toEqual([]);
  });

  it("150 seeded boards, typed options and the options after a node is added", { timeout: 30_000 }, () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const names = ["app", "api gateway", "postgres", "redis", "kafka", "worker", "cdn", "billing", "auth", "search", "s3", "orders"];
    const pick = () => names[Math.floor(rand() * names.length)];
    for (let round = 0; round < 150; round++) {
      const { board, last } = grow(Array.from({ length: 2 + Math.floor(rand() * 9) }, pick));
      const typedClash = clashes(board, { elements: board, text: pick(), subjectId: last, viewportCenter: CENTER });
      expect(typedClash, `round ${round} typed`).toEqual([]);
      expect(clashes(board, { elements: board, subjectId: last, viewportCenter: CENTER }), `round ${round} after add`).toEqual([]);
    }
  });
});

// Charles, 22 Nov 2026 (5A): nothing is asked while typing; after a node is added or clicked, one call names a
// next node from the board (the context route) and jev scores the options.
describe("the node the AI names from the board", () => {
  const board = [app, gateway, arrow("a1", "app", "gw")];
  const local = () => buildNextOptions({ elements: board, subjectId: "gw", viewportCenter: CENTER })!.options;
  const named = (id: string, label: string) => ({ id, label, kind: "node" as const, edgeLabel: "resizes" });

  it("becomes one node beside the subject, linked from it, never on another node", () => {
    const option = bestContextOption([named("ctx_0", "Thumbnail Worker")], null, gateway, board, local())!;
    const [node, link] = option.addElements;
    expect(option).toMatchObject({ id: "ctx_0", title: "Thumbnail Worker", nodeCount: 1 });
    expect(link).toMatchObject({ kind: "arrow", fromId: "gw", toId: node.id, label: "resizes" });
    for (const other of [app, gateway]) expect(boxesOverlap(node, other, 16)).toBe(false);
    expect(gapBetween(node, gateway)).toBeLessThanOrEqual(200);
  });

  it("takes the suggestion jev scores highest, and carries that score", () => {
    const suggestions = [named("ctx_0", "Thumbnail Worker"), named("ctx_1", "Upload Scanner")];
    const option = bestContextOption(suggestions, { ctx_0: 0.1, ctx_1: 0.7 }, gateway, board, local())!;
    expect(option.title).toBe("Upload Scanner");
    expect(option.probability).toBe(0.7);
  });

  it("skips names that are generic, malformed, already on the board or already offered", () => {
    const offered = local()[0].addElements.find((e) => e.kind !== "arrow")!.label;
    const junk = [named("ctx_0", "App"), named("ctx_1", offered), named("ctx_2", "Next Step"), { id: "nope", label: "X", kind: "node" as const }];
    expect(bestContextOption(junk, null, gateway, board, local())).toBeNull();
  });

  // Prod, 22 Nov: jev's pick was a board-named "API Gateway" that option 1 already offered, so the badge fell
  // on another option at "jev pick 10%".
  it("credits jev's score for a name that is already offered to the option that offers it", () => {
    const options = buildNextOptions({ elements: [app], subjectId: "app", viewportCenter: CENTER })!.options;
    expect(options[0].title).toBe("API Gateway");
    const scores = { [options[0].id]: 0.05, [options[1].id]: 0.1, [options[2].id]: 0.05, ctx_0: 0.8 };
    const scored = scoreOptions(options, [named("ctx_0", "api gateway")], scores);
    expect(scored.map((o) => o.probability)).toEqual([0.8, 0.1, 0.05]);
    expect(scoreOptions(options, [], null).map((o) => o.probability)).toEqual([undefined, undefined, undefined]);
  });

  const opt = (id: string, nodes: number, tier?: PredictedAction["tier"]): PredictedAction => ({
    id,
    title: id,
    subtitle: "",
    category: nodes ? "extend" : "connect",
    ...(tier ? { tier } : {}),
    addElements: [
      ...Array.from({ length: nodes }, (_, i) => el({ id: `${id}_${i}`, label: `${id} ${i}` })),
      arrow(`${id}_a`, "app", "gw"),
    ],
  });
  const ctx = opt("ctx_0", 1);
  const ids = (options: PredictedAction[]) => options.map((o) => o.id);

  // Round-2 judge, prod: "api gateway⏎ postgres⏎ Tab ⏎" added Read Replica when the AI failed and Connection
  // Pooler when it had answered, because the board-named node took slot 2.
  it("is added after the options, so every key that reached an option before the AI answered still does", () => {
    const tiers = [opt("a", 1, "minimal"), opt("b", 3, "cluster"), opt("c", 7, "full")];
    const placed = appendContextOption(tiers, ctx);
    expect(ids(placed)).toEqual(["a", "b", "c", "ctx_0"]);
    for (let i = 0; i < tiers.length; i++) expect(placed[i]).toBe(tiers[i]);
    expect(ids(appendContextOption([opt("l1", 0)], ctx))).toEqual(["l1", "ctx_0"]);
    expect(ids(appendContextOption(placed, opt("ctx_1", 1)))).toEqual(["a", "b", "c", "ctx_0"]);
  });
});

// Charles, 22 Nov (1A): "Enter on the empty bar accepts only a connection of the node just added. Any other
// suggestion needs Tab first." Before: app, Enter, Enter, Enter added API Gateway and Auth Service.
describe("what Enter takes on the empty bar", () => {
  const board = [app, gateway];
  const afterAdd = (els: JevElement[], nodeId: string) => buildAfterCreateOptions({ elements: els, nodeId, viewportCenter: CENTER })!;

  it("a lone node has no connection to offer: nothing is highlighted", () => {
    const { options } = afterAdd([app], "app");
    expect(options.length).toBeGreaterThan(0);
    expect(enterDefaultIndex(options, "app")).toBe(NO_OPTION);
  });

  it("a node that can connect to the board: its connection is what Enter takes", () => {
    const { options } = afterAdd(board, "gw");
    expect(isConnectionOf(options[0], "gw")).toBe(true);
    expect(enterDefaultIndex(options, "gw")).toBe(0);
  });

  it("a connection between two other nodes, a new node, or no known node are never the default", () => {
    const { options } = afterAdd(board, "gw");
    expect(enterDefaultIndex(options, "someone-else")).toBe(NO_OPTION);
    expect(enterDefaultIndex(options, null)).toBe(NO_OPTION);
    const steps = options.filter((o) => o.addElements.some((e) => e.kind !== "arrow"));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(isConnectionOf(step, "gw")).toBe(false);
    expect(enterDefaultIndex(steps, "gw")).toBe(NO_OPTION);
  });

  it("Tab from nothing picks the first suggestion, Shift+Tab the last; then they cycle", () => {
    expect(stepOption(NO_OPTION, 4, false)).toBe(0);
    expect(stepOption(NO_OPTION, 4, true)).toBe(3);
    expect(stepOption(3, 4, false)).toBe(0);
    expect(stepOption(0, 4, true)).toBe(3);
    expect(stepOption(1, 4, false)).toBe(2);
    expect(stepOption(NO_OPTION, 0, false)).toBe(NO_OPTION);
  });
});

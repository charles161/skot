/**
 * The core loop (Charles, 22 Nov 2026): type a name, press Enter, get that node.
 *   1. Enter always creates one node with the typed name. Nothing here waits on the network or on AI.
 *   2. The node lands in free space beside the selected / related / last-touched node. It never overlaps a
 *      node and nothing on the board moves.
 *   3. Connections to the board are offered afterwards (connectionOptions); they are never applied here.
 * Everything in this file is a pure function of its input (ids aside), so the same keys on the same board
 * always give the same board.
 */
import { inferToneFromLabel } from "./colors";
import { CATALOG, componentByExactName, NEXT_ROLES, norm, roleOf, words } from "./component-catalog";
import { getElementCenter, isShapeElement, makeSeed, rectsOverlap, uid, type Rect } from "./geometry";
import { arrowHitsShape } from "./ghost-geometry";
import { DEFAULT_KIND_SIZE, isComponentShape, isContainerKind } from "./notation-kinds";
import { orientPair, relationVerb } from "./prediction-engine";
import { buildLocalSemanticGraphFromPrompt, cleanSemanticLabel } from "./semantic-graph";
import type { JevElement, Point, PredictedAction, ShapeKind } from "./types";

// ------------------------------------------------------------------ shapes

const SIZE_OVERRIDES: Partial<Record<ShapeKind, { width: number; height: number }>> = {
  node: { width: 172, height: 72 },
  database: { width: 156, height: 86 },
  lb: { width: 168, height: 80 },
  cache: { width: 156, height: 80 },
  queue: { width: 180, height: 68 },
  external: { width: 172, height: 72 },
  blob: { width: 140, height: 92 },
  actor: { width: 80, height: 112 },
};
export const sizeFor = (kind: ShapeKind) => SIZE_OVERRIDES[kind] ?? DEFAULT_KIND_SIZE[kind] ?? { width: 172, height: 72 };

export function makeShape(kind: ShapeKind, label: string, sublabel: string | undefined, at: Point): JevElement {
  const id = uid("el");
  const size = sizeFor(kind);
  const now = Date.now();
  return {
    id,
    kind,
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: size.width,
    height: size.height,
    label,
    ...(sublabel && kind !== "actor" ? { sublabel } : {}),
    tone: inferToneFromLabel(label),
    seed: makeSeed(id),
    createdAt: now,
    updatedAt: now,
  };
}

export function makeLink(fromId: string, toId: string, label: string, dashed?: boolean): JevElement {
  const id = uid("arr");
  const now = Date.now();
  return {
    id,
    kind: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    label,
    tone: "ink",
    seed: makeSeed(id),
    fromId,
    toId,
    arrowStyle: "curved",
    ...(dashed ? { dashed } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** The shape a label is usually drawn as (a database, a queue, a plain box). */
export function kindForLabel(label: string): ShapeKind {
  const comp = componentByExactName(label);
  if (comp) return comp.kind;
  const kind = buildLocalSemanticGraphFromPrompt(label.replace(/[,;]/g, " ")).graph.nodes[0]?.kind;
  return kind && kind !== "text" ? (kind as ShapeKind) : "node";
}

// ------------------------------------------------------------------ the typed name

const FLOW_ARROW = /(->|=>|→|<->|↔)/;
/** "app -> api": the user typed the connections too, so it is drawn as a flow, not as one node. */
export const isFlowText = (text: string) => FLOW_ARROW.test(text);

const ACRONYMS = new Set(
  ("api db cdn lb sql ui llm ai dns cdc jwt sso http https tcp udp url id sdk ws mq etl vm aws gcp cpu gpu ml rag kv ttl " +
    "cli ci cd s3 r2 sns ses psp bff cms iam vpc nat ssl tls ssh smtp sms otp mfa p2p rpc ip olap oltp csv json xml html css")
    .split(" ")
);
const PERSON_WORDS = new Set(
  "user users customer customers client clients actor admin person people visitor shopper buyer seller driver rider operator member guest".split(" ")
);
const SMALL_WORDS = new Set("a an and as at by for from in of on or the to via with".split(" "));
export const MAX_TYPED_LABEL = 120;

/**
 * The node is named what the user typed. Only the capitals are tidied: the catalog's own spelling when the
 * text is exactly a catalog name ("api gateway" is "API Gateway"), known acronyms upper-cased, other
 * lower-case words capitalised (small joining words inside a phrase stay small). A word the user capitalised
 * themselves is left alone.
 */
export function typedNodeLabel(text: string): string {
  const raw = text.replace(/\s+/g, " ").trim().slice(0, MAX_TYPED_LABEL).trim();
  if (!raw) return "";
  const named = CATALOG.find((c) => norm(c.label) === norm(raw));
  if (named) return named.label;
  return raw
    .split(" ")
    .map((word, i) => {
      if (/[A-Z]/.test(word) && !ACRONYMS.has(word.toLowerCase())) return word;
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      return cleanSemanticLabel(word) || word;
    })
    .join(" ");
}

/**
 * A stick figure only for people ("user", "customer"); "app" or "dashboard" is a box. A whole sentence is a
 * box too: its shape would be a guess from one of its words.
 */
function typedNodeKind(label: string): ShapeKind {
  const ws = words(label);
  if (ws.length > 3) return "node";
  if (ws.length > 0 && PERSON_WORDS.has(ws[ws.length - 1])) return "actor";
  const kind = kindForLabel(label);
  return kind === "actor" ? "node" : kind;
}

// ------------------------------------------------------------------ placement

const H_GAP = 128;
const V_GAP = 56;
const CLEARANCE = 24;

const isObstacle = (e: JevElement) => (isShapeElement(e) || e.kind === "freedraw") && !isContainerKind(e.kind) && e.kind !== "arrow";

function obstacleRect(e: JevElement): Rect {
  if (e.kind === "freedraw" && e.points && e.points.length > 0) {
    const xs = e.points.map((p) => p.x);
    const ys = e.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(24, Math.max(...xs) - x), height: Math.max(24, Math.max(...ys) - y) };
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

interface Anchor {
  id: string;
  rect: Rect;
  side: "right" | "left";
  /** Every selected node, when the anchor is a multi-selection. */
  group?: string[];
  /**
   * The new node goes straight under the anchor first: a copy under its twin, and every node on a view too
   * narrow for two columns (a phone), where a row would run off the screen.
   */
  stack?: boolean;
}

interface Slot {
  at: Point;
  /** Right next to the anchor (its flow side on the same row, or straight below / above it). */
  adjacent: boolean;
}

/**
 * The first free slot around the anchor, closest first: its flow side on the same row, straight below /
 * above the anchor, the rows just below and above on the flow side, and only then further out. A run of
 * nodes added from one anchor stays around it instead of growing one tall column. A copy of the anchor
 * (same name) starts straight under it. A slot is free when it keeps `CLEARANCE`
 * from every node; slots an existing arrow runs through are used only when nothing else is left.
 */
function freeSlotBeside(anchor: Anchor, size: { width: number; height: number }, elements: JevElement[]): Slot {
  const obstacles = elements.filter(isObstacle).map(obstacleRect);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const arrows = elements.filter((e) => e.kind === "arrow" && e.fromId && e.toId && byId.has(e.fromId) && byId.has(e.toId));
  const a = anchor.rect;
  const cy = a.y + a.height / 2;
  const pitch = Math.max(size.height, a.height) + V_GAP;
  const sideX = (side: "right" | "left", col: number) =>
    side === "right"
      ? a.x + a.width + H_GAP + (col - 1) * (size.width + H_GAP)
      : a.x - col * (size.width + H_GAP);
  const other = anchor.side === "right" ? "left" : "right";
  const at = (x: number, row: number): Point => ({ x: Math.round(x), y: Math.round(cy + row * pitch - size.height / 2) });
  const flow = sideX(anchor.side, 1);
  const own = a.x + (a.width - size.width) / 2;
  const far = sideX(anchor.side, 2);
  const back = sideX(other, 1);
  const first: Array<[x: number, rows: number[], adjacent?: boolean]> = anchor.stack
    ? [
        [own, [1, -1], true],
        [flow, [0], true],
      ]
    : [
        [flow, [0], true],
        [own, [1, -1], true],
      ];
  const ring: Array<[x: number, rows: number[], adjacent?: boolean]> = [
    ...first,
    [flow, [1, -1]],
    [flow, [2, -2]],
    [far, [0, 1, -1]],
    [back, [0, 1, -1]],
    [own, [2, -2]],
    [flow, [3, -3]],
    [far, [2, -2]],
    [back, [2, -2]],
  ];
  const slots: Slot[] = ring.flatMap(([x, rows, adjacent]) => rows.map((r) => ({ at: at(x, r), adjacent: Boolean(adjacent) })));
  const clear = (p: Point) => !obstacles.some((o) => rectsOverlap({ ...p, ...size }, o, CLEARANCE));
  const offArrows = (p: Point) => {
    const probe = { id: "__slot__", kind: "node", x: p.x, y: p.y, width: size.width, height: size.height } as JevElement;
    return !arrows.some((arrow) => arrowHitsShape(arrow, byId, [probe], 8));
  };
  const free = slots.filter((slot) => clear(slot.at));
  const best = free.find((slot) => offArrows(slot.at)) ?? free[0];
  if (best) return best;
  // A crowded corner: past everything on the board, level with the anchor. Free by construction.
  const right = Math.max(...obstacles.map((o) => o.x + o.width));
  return { at: at(right + H_GAP, 0), adjacent: false };
}

/** The closest free slot beside a board node, for a node of `size` that hangs off it. */
export function slotBeside(anchor: JevElement, size: { width: number; height: number }, elements: JevElement[]): Point {
  const rect: Rect = { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height };
  return freeSlotBeside({ id: anchor.id, rect, side: "right" }, size, elements).at;
}

function freeSpotAround(center: Point, size: { width: number; height: number }, elements: JevElement[]): Point {
  const origin: Rect = { x: center.x - 0.5, y: center.y - 0.5, width: 1, height: 1 };
  const obstacles = elements.filter(isObstacle).map(obstacleRect);
  const centred = { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2) };
  if (!obstacles.some((o) => rectsOverlap({ ...centred, ...size }, o, CLEARANCE))) return centred;
  return freeSlotBeside({ id: "", rect: origin, side: "right" }, size, elements).at;
}

export interface TypedNodeInput {
  text: string;
  elements: JevElement[];
  /** Nodes the user selected themselves. A node the app selected after creating it belongs in lastFocusedId. */
  selectedIds?: string[];
  /** The node the user touched last (added, applied, renamed). */
  lastFocusedId?: string | null;
  viewportCenter: Point;
  /** The visible part of the board, in board coordinates. Nodes outside it are not used as anchors. */
  viewport?: Rect;
}

export interface TypedNodePlan {
  node: JevElement;
  /** The node the new one was placed beside. */
  anchorId: string | null;
  /** The nodes a connection is offered to first: the anchor, or every node of a multi-selection. */
  anchorIds: string[];
  /** The node sits right next to its anchor ("beside"); false when that slot was taken ("near"). */
  adjacent: boolean;
}

function pickAnchor(input: TypedNodeInput, label: string, kind: ShapeKind): Anchor | null {
  const shapes = input.elements.filter(isObstacle).filter((e) => e.kind !== "freedraw");
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const inView = (e: JevElement) => {
    if (!input.viewport) return true;
    const c = getElementCenter(e);
    const v = input.viewport;
    return c.x >= v.x && c.x <= v.x + v.width && c.y >= v.y && c.y <= v.y + v.height;
  };
  const rectOf = (e: JevElement): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });

  const selected = (input.selectedIds ?? []).map((id) => byId.get(id)).filter((e): e is JevElement => Boolean(e));
  if (selected.length === 1) return { id: selected[0].id, rect: rectOf(selected[0]), side: "right" };
  if (selected.length > 1) {
    const x = Math.min(...selected.map((s) => s.x));
    const y = Math.min(...selected.map((s) => s.y));
    const right = Math.max(...selected.map((s) => s.x + s.width));
    const bottom = Math.max(...selected.map((s) => s.y + s.height));
    return {
      id: selected[selected.length - 1].id,
      rect: { x, y, width: right - x, height: bottom - y },
      side: "right",
      group: selected.map((s) => s.id),
    };
  }

  const visible = shapes.filter(inView);
  const twins = visible.filter((s) => norm(s.label) === norm(label));
  if (twins.length > 0) {
    const twin = twins[twins.length - 1];
    return { id: twin.id, rect: rectOf(twin), side: "right", stack: true };
  }
  const focused = input.lastFocusedId ? visible.find((s) => s.id === input.lastFocusedId) ?? null : null;
  const near = focused ? getElementCenter(focused) : input.viewportCenter;
  const nearest = (pool: JevElement[]) =>
    pool.reduce<JevElement | null>((best, s) => {
      if (!best) return s;
      const d = (e: JevElement) => Math.hypot(getElementCenter(e).x - near.x, getElementCenter(e).y - near.y);
      return d(s) < d(best) ? s : best;
    }, null);

  // Related by role: what feeds this node goes on its left, what it feeds goes on its right.
  const role = roleOf({ label, kind });
  if (role) {
    const components = visible.filter(isComponentShape);
    const feeds = components.filter((s) => {
      const r = roleOf(s);
      return r !== null && NEXT_ROLES[r].includes(role);
    });
    const upstream = (focused && feeds.includes(focused) ? focused : null) ?? nearest(feeds);
    if (upstream) return { id: upstream.id, rect: rectOf(upstream), side: "right" };
    const fed = components.filter((s) => {
      const r = roleOf(s);
      return r !== null && NEXT_ROLES[role].includes(r);
    });
    const downstream = (focused && fed.includes(focused) ? focused : null) ?? nearest(fed);
    if (downstream) return { id: downstream.id, rect: rectOf(downstream), side: "left" };
  }

  const fallback = focused ?? nearest(visible);
  return fallback ? { id: fallback.id, rect: rectOf(fallback), side: "right" } : null;
}

/**
 * On a phone-sized view (under three columns wide) a row soon runs off the screen and takes the earlier nodes
 * with it. There, when the slot on the anchor's flow side would not be fully in view, the node goes under it.
 */
function runsOffNarrowView(anchor: Anchor, size: { width: number; height: number }, viewport?: Rect): boolean {
  const column = size.width + H_GAP;
  if (!viewport || viewport.width >= 3 * column) return false;
  const a = anchor.rect;
  return anchor.side === "right" ? a.x + a.width + column > viewport.x + viewport.width : a.x - column < viewport.x;
}

/** What Enter creates for the typed text: one node, named as typed, in the best free space. Null only for empty text. */
export function planTypedNode(input: TypedNodeInput): TypedNodePlan | null {
  const label = typedNodeLabel(input.text);
  if (!label) return null;
  const kind = typedNodeKind(label);
  const size = sizeFor(kind);
  const named = CATALOG.find((c) => norm(c.label) === norm(label));
  const picked = pickAnchor(input, label, kind);
  const anchor = picked && runsOffNarrowView(picked, size, input.viewport) ? { ...picked, stack: true } : picked;
  const slot = anchor
    ? freeSlotBeside(anchor, size, input.elements)
    : { at: freeSpotAround(input.viewportCenter, size, input.elements), adjacent: false };
  return {
    node: makeShape(kind, label, named?.sublabel, slot.at),
    anchorId: anchor?.id ?? null,
    anchorIds: anchor ? anchor.group ?? [anchor.id] : [],
    adjacent: slot.adjacent,
  };
}

/** "beside App" when the node sits right next to its anchor, "near App" when that slot was taken, "" with no anchor. */
export function placedWhere(plan: TypedNodePlan, elements: JevElement[]): string {
  const anchor = plan.anchorId ? elements.find((e) => e.id === plan.anchorId)?.label : "";
  return anchor ? `${plan.adjacent ? "beside" : "near"} ${anchor}` : "";
}

/** The typed node as the first of the three options: what Enter does, shown as a ghost while typing. */
export function typedNodeOption(plan: TypedNodePlan, elements: JevElement[]): PredictedAction {
  const where = placedWhere(plan, elements);
  return {
    id: uid("pred"),
    title: plan.node.label,
    subtitle: where ? `new node ${where}` : "new node",
    category: "extend",
    tier: "minimal",
    nodeCount: 1,
    source: "board",
    feedbackKeys: ["tier:minimal"],
    addElements: [plan.node],
    focusId: plan.node.id,
  };
}

// ------------------------------------------------------------------ connections, offered after the node exists

export interface ConnectionInput {
  elements: JevElement[];
  /** The node that was just added. */
  nodeId: string;
  /** The node it was placed beside, or the nodes that were selected when it was added. */
  anchorIds?: string[];
  max?: number;
}

/**
 * Links between the new node and the board, best first: a pair that follows the usual flow (client to edge to
 * service to data), then the node it was placed beside, then the closest node. The order depends only on the
 * board, so the highlighted link is the same every time; jev's ranking is shown on top of it, never instead.
 */
export function connectionOptions(input: ConnectionInput): PredictedAction[] {
  const node = input.elements.find((e) => e.id === input.nodeId);
  if (!node || !isComponentShape(node)) return [];
  const linked = new Set(
    input.elements.flatMap((e) =>
      e.kind === "arrow" && (e.fromId === node.id || e.toId === node.id) ? [e.fromId ?? "", e.toId ?? ""] : []
    )
  );
  // A twin (another node with the same name) is a copy, not a neighbour: no link is offered between them.
  const others = input.elements.filter(
    (e) => isComponentShape(e) && e.id !== node.id && !linked.has(e.id) && norm(e.label) !== norm(node.label)
  );
  const role = roleOf(node);
  const here = getElementCenter(node);
  const byId = new Map(input.elements.map((e) => [e.id, e]));
  const solid = input.elements.filter((e) => isObstacle(e) && e.kind !== "freedraw");
  const scored = others.map((other, index) => {
    const r = roleOf(other);
    const feedsNode = Boolean(r && role && NEXT_ROLES[r].includes(role));
    const fedByNode = Boolean(r && role && NEXT_ROLES[role].includes(r));
    const distance = Math.hypot(getElementCenter(other).x - here.x, getElementCenter(other).y - here.y);
    const related = feedsNode || fedByNode;
    const isAnchor = input.anchorIds?.includes(other.id) ?? false;
    const [from, to] = feedsNode ? [other, node] : fedByNode ? [node, other] : orientPair(other, node);
    return { other, index, from, to, related, isAnchor, distance, score: (related ? 4 : 0) + (isAnchor ? 2 : 0) };
  });
  // With no related node and no anchor, an unconnected node is offered its closest neighbour.
  const closest = scored.reduce<number>((best, s) => Math.min(best, s.distance), Infinity);
  const lonely = linked.size === 0 && !scored.some((s) => s.related || s.isAnchor);
  return scored
    .filter((s) => s.related || s.isAnchor || (lonely && s.distance === closest))
    .sort((a, b) => b.score - a.score || a.distance - b.distance || a.index - b.index)
    .slice(0, input.max ?? 3)
    .map(({ from, to }) => {
      // The catalog's own word for what flows into the target ("HTTPS", "SQL"), else a plain verb.
      const verb = componentByExactName(to.label)?.inbound ?? relationVerb(from, to);
      // An arrow that has to pass another node is offered as a bare line: its label would sit on that node.
      const link = makeLink(from.id, to.id, verb);
      const crosses = arrowHitsShape(link, byId, solid, 4) !== null;
      return {
        id: uid("pred"),
        title: `${from.label || from.kind} → ${to.label || to.kind}`,
        subtitle: `connect · ${verb}`,
        category: "connect" as const,
        nodeCount: 0,
        source: "board" as const,
        feedbackKeys: ["cat:connect"],
        addElements: [crosses ? { ...link, label: "" } : link],
        focusId: node.id,
      };
    });
}

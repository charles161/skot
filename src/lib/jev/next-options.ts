/**
 * Next-action options: every AI action (typing in the Thought Bar, selecting, adding a node) offers exactly
 * three options from small to big, all attached to what is already on the board:
 *   minimal  one node (or one link) connected to the node the user is working on
 *   cluster  that node plus its closest companions
 *   full     the whole architecture around it, reusing nodes that already exist
 * The lexicon and templates here answer instantly; the Gateway LLM can rename and reshape the cluster and
 * full options later (refineOptionsWithGraphs), and jev ranks the three.
 */
import {
  BY_KEY,
  CATALOG,
  componentByExactName,
  componentForLabel,
  findBoardCounterpart,
  NEXT_ROLES,
  norm,
  roleOf,
  sameThing,
  words,
  type CatalogLink,
  type Component,
  type Role,
} from "./component-catalog";
import {
  connectionOptions,
  isFlowText,
  kindForLabel,
  makeLink,
  makeShape,
  placedWhere,
  planTypedNode,
  sizeFor,
  typedNodeLabel,
  typedNodeOption,
  type TypedNodePlan,
} from "./core-loop";
import { getElementCenter, makeSeed, uid, type Rect } from "./geometry";
import { isComponentShape } from "./notation-kinds";
import { arrowHitsShape, labelRect, rectsIntersect } from "./ghost-geometry";
import { layeredGhostLayout } from "./ghost-layout";
import {
  GENERIC_SUGGESTION_LABELS,
  groupNextNode,
  inferNextStepsForLabel,
  orientPair,
  relationVerb,
  suggestionContextFor,
  type SemanticSuggestion,
} from "./prediction-engine";
import { buildLocalSemanticGraphFromPrompt, cleanSemanticLabel } from "./semantic-graph";
import {
  OPTION_TIERS,
  type DecideSource,
  type JevElement,
  type OptionSource,
  type OptionTier,
  type Point,
  type PredictedAction,
  type ShapeKind,
  type SpatialIntent,
} from "./types";

// ------------------------------------------------------------------ catalog

const ROLE_RANK: Record<Role, number> = {
  client: 0,
  edge: 1,
  service: 2,
  worker: 2,
  external: 3,
  queue: 3,
  cache: 3,
  store: 4,
  storage: 4,
};

type SysNode = [key: string, label: string, kind: ShapeKind, sublabel: string, tier: OptionTier];
type SysEdge = [from: string, to: string, label: string, tiers?: OptionTier[]];
interface SystemDef {
  key: string;
  name: string;
  aliases: string[];
  nodes: SysNode[];
  edges: SysEdge[];
}

/** Whole systems someone names on a blank board ("url shortener"), each with its three sizes. */
const SYSTEMS: SystemDef[] = [
  {
    key: "url_shortener",
    name: "URL shortener HLD",
    aliases: ["urlshortener", "shortener", "tinyurl", "bitly", "shortlink", "linkshortener", "urlshortner"],
    nodes: [
      ["client", "Client", "actor", "Browser / app", "minimal"],
      ["api", "Shortener API", "node", "POST /shorten · GET /:code", "minimal"],
      ["urldb", "URL Store", "database", "code -> long URL", "minimal"],
      ["cache", "Redirect Cache", "cache", "Hot codes", "cluster"],
      ["keygen", "Key Generator", "node", "Base62 IDs", "cluster"],
      ["cdn", "Redirect CDN", "lb", "Edge 301s", "full"],
      ["rate", "Rate Limiter", "node", "Per-IP quota", "full"],
      ["clicks", "Click Events", "queue", "Kafka", "full"],
      ["agg", "Analytics Worker", "node", "Aggregate clicks", "full"],
      ["stats", "Click Analytics", "database", "Warehouse", "full"],
    ],
    edges: [
      ["client", "api", "shorten / redirect"],
      ["client", "cdn", "hot redirects"],
      ["cdn", "api", "on miss"],
      ["api", "urldb", "lookup / insert"],
      ["api", "cache", "read-through"],
      ["api", "keygen", "next ID"],
      ["api", "rate", "check quota"],
      ["api", "clicks", "click event"],
      ["clicks", "agg", "consume"],
      ["agg", "stats", "aggregate"],
    ],
  },
  {
    key: "chat_app",
    name: "chat system HLD",
    aliases: ["chat", "chatapp", "chatsystem", "messaging", "messenger", "whatsapp", "slack"],
    nodes: [
      ["client", "Chat Client", "actor", "Web / mobile", "minimal"],
      ["ws", "WebSocket Gateway", "lb", "Live connections", "minimal"],
      ["store", "Message Store", "database", "History", "minimal"],
      ["chat", "Chat Service", "node", "Routes messages", "cluster"],
      ["presence", "Presence Cache", "cache", "Online / typing", "cluster"],
      ["fanout", "Fan-out Queue", "queue", "Offline delivery", "full"],
      ["push", "Push Notifier", "node", "APNs / FCM", "full"],
      ["media", "Media Storage", "blob", "Attachments", "full"],
      ["users", "User DB", "database", "Members", "full"],
    ],
    edges: [
      ["client", "ws", "live socket"],
      ["ws", "store", "persist", ["minimal"]],
      ["ws", "chat", "messages"],
      ["chat", "store", "persist"],
      ["ws", "presence", "heartbeat"],
      ["chat", "fanout", "fan out"],
      ["fanout", "push", "offline users"],
      ["chat", "media", "attachments"],
      ["chat", "users", "members"],
    ],
  },
  {
    key: "news_feed",
    name: "news feed HLD",
    aliases: ["newsfeed", "feed", "timeline", "twitter", "instagram", "socialfeed", "socialmedia"],
    nodes: [
      ["client", "Client", "actor", "Web / mobile", "minimal"],
      ["api", "Feed API", "node", "Post + read", "minimal"],
      ["posts", "Posts DB", "database", "Source of truth", "minimal"],
      ["cache", "Feed Cache", "cache", "Precomputed timelines", "cluster"],
      ["fanout", "Fan-out Worker", "node", "Push to followers", "cluster"],
      ["events", "Post Events", "queue", "Kafka", "full"],
      ["graph", "Follow Graph", "database", "Who follows whom", "full"],
      ["cdn", "Media CDN", "lb", "Images / video", "full"],
      ["rank", "Ranking Service", "node", "Order the feed", "full"],
    ],
    edges: [
      ["client", "api", "HTTPS"],
      ["api", "posts", "write post"],
      ["api", "cache", "read timeline"],
      ["api", "fanout", "new post", ["cluster"]],
      ["fanout", "cache", "push"],
      ["api", "events", "post created"],
      ["events", "fanout", "consume"],
      ["fanout", "graph", "followers"],
      ["client", "cdn", "media"],
      ["api", "rank", "rank"],
    ],
  },
  {
    key: "ecommerce",
    name: "e-commerce HLD",
    aliases: ["ecommerce", "onlineshop", "onlinestore", "shop", "marketplace", "amazon", "checkoutsystem"],
    nodes: [
      ["customer", "Customer", "actor", "Web / mobile", "minimal"],
      ["api", "Storefront API", "node", "Browse + buy", "minimal"],
      ["catalog", "Catalog DB", "database", "Products", "minimal"],
      ["cart", "Cart Service", "node", "Basket", "cluster"],
      ["order", "Order Service", "node", "Coordinates the order", "cluster"],
      ["payment", "Payment Service", "node", "Charges + refunds", "full"],
      ["psp", "Payment Provider", "external", "Stripe / PSP", "full"],
      ["orders", "Orders DB", "database", "Order records", "full"],
      ["events", "Order Events", "queue", "Kafka", "full"],
      ["inventory", "Inventory Service", "node", "Stock levels", "full"],
    ],
    edges: [
      ["customer", "api", "HTTPS"],
      ["api", "catalog", "browse"],
      ["api", "cart", "add to cart"],
      ["cart", "order", "checkout"],
      ["order", "payment", "charge"],
      ["payment", "psp", "authorize"],
      ["order", "orders", "writes"],
      ["order", "events", "order placed"],
      ["events", "inventory", "reserve stock"],
    ],
  },
  {
    key: "file_storage",
    name: "file storage HLD",
    aliases: ["filestorage", "dropbox", "googledrive", "fileupload", "upload", "uploads", "filesharing", "drive"],
    nodes: [
      ["client", "Client", "actor", "Desktop / mobile", "minimal"],
      ["api", "Upload API", "node", "Presigned URLs", "minimal"],
      ["blob", "Object Storage", "blob", "S3 / R2", "minimal"],
      ["meta", "File Metadata", "database", "Owners, versions", "cluster"],
      ["cdn", "CDN", "lb", "Downloads", "cluster"],
      ["events", "Upload Events", "queue", "On new object", "full"],
      ["thumb", "Thumbnail Worker", "node", "Previews", "full"],
      ["scan", "Virus Scanner", "node", "Quarantine", "full"],
      ["search", "Search Index", "database", "File names", "full"],
    ],
    edges: [
      ["client", "api", "upload"],
      ["api", "blob", "put object"],
      ["api", "meta", "record"],
      ["client", "cdn", "download"],
      ["cdn", "blob", "origin pull"],
      ["blob", "events", "object created"],
      ["events", "thumb", "consume"],
      ["events", "scan", "consume"],
      ["thumb", "search", "index"],
    ],
  },
  {
    key: "video_streaming",
    name: "video streaming HLD",
    aliases: ["videostreaming", "youtube", "netflix", "video", "streaming", "videoplatform"],
    nodes: [
      ["viewer", "Viewer", "actor", "TV / web / mobile", "minimal"],
      ["cdn", "Video CDN", "lb", "Edge segments", "minimal"],
      ["blob", "Video Storage", "blob", "Renditions", "minimal"],
      ["api", "Video API", "node", "Catalog + playback", "cluster"],
      ["meta", "Video Metadata", "database", "Titles, views", "cluster"],
      ["upload", "Upload Service", "node", "Creators", "full"],
      ["queue", "Transcode Queue", "queue", "Jobs", "full"],
      ["transcoder", "Transcoder", "node", "HLS renditions", "full"],
      ["rec", "Recommendations", "node", "What to watch", "full"],
    ],
    edges: [
      ["viewer", "cdn", "stream"],
      ["cdn", "blob", "origin pull"],
      ["viewer", "api", "browse"],
      ["api", "meta", "lookup"],
      ["upload", "queue", "new video"],
      ["queue", "transcoder", "consume"],
      ["transcoder", "blob", "renditions"],
      ["api", "rec", "recommend"],
      ["api", "upload", "creator upload"],
    ],
  },
  {
    key: "ride_sharing",
    name: "ride sharing HLD",
    aliases: ["ridesharing", "uber", "lyft", "ridehailing", "taxi", "cabbooking"],
    nodes: [
      ["rider", "Rider App", "actor", "Request rides", "minimal"],
      ["trip", "Trip Service", "node", "Ride lifecycle", "minimal"],
      ["trips", "Trips DB", "database", "Trip records", "minimal"],
      ["location", "Location Service", "node", "Driver pings", "cluster"],
      ["match", "Matching Service", "node", "Nearest driver", "cluster"],
      ["driver", "Driver App", "actor", "Accept rides", "full"],
      ["geo", "Geo Index", "cache", "Geohash cells", "full"],
      ["payment", "Payment Service", "node", "Fares", "full"],
      ["events", "Trip Events", "queue", "Kafka", "full"],
      ["notify", "Notifications", "node", "Push / SMS", "full"],
    ],
    edges: [
      ["rider", "trip", "request ride"],
      ["trip", "trips", "writes"],
      ["trip", "match", "find driver"],
      ["match", "location", "nearby drivers"],
      ["driver", "location", "GPS pings"],
      ["location", "geo", "index"],
      ["trip", "payment", "charge fare"],
      ["trip", "events", "trip updates"],
      ["events", "notify", "consume"],
    ],
  },
];

// ------------------------------------------------------------------ matching

function aliasScore(text: string, names: string[]): number {
  let best = 0;
  for (const a of names) {
    if (!a) continue;
    if (a === text) best = Math.max(best, 3);
    else if (a.startsWith(text)) best = Math.max(best, 2 + text.length / a.length);
  }
  return best;
}

export interface PredictedConcept {
  label: string;
  /** What Tab writes into the Thought Bar when the typed text is only the start of the label. */
  completion?: string;
}

type Concept =
  | { type: "component"; comp: Component }
  | { type: "system"; sys: SystemDef }
  | { type: "flow"; text: string }
  | { type: "literal"; label: string; text: string };

function resolveConcept(text: string, anchor: JevElement | null): Concept | null {
  const raw = text.trim();
  const t = norm(raw);
  if (t.length < 2) return null;
  if (/(->|=>|→|<->|↔)/.test(raw)) return { type: "flow", text: raw };

  const anchorRole = anchor ? roleOf(anchor) : null;
  let best: { score: number; concept: Concept } | null = null;
  for (const comp of CATALOG) {
    let s = aliasScore(t, [norm(comp.label), ...comp.aliases]);
    if (s === 0) continue;
    if (anchorRole && NEXT_ROLES[anchorRole].includes(comp.role)) s += 0.5;
    if (!best || s > best.score) best = { score: s, concept: { type: "component", comp } };
  }
  if (t.length >= 3) {
    for (const sys of SYSTEMS) {
      const s = aliasScore(t, [norm(sys.name), ...sys.aliases]);
      if (s === 0) continue;
      const boosted = s === 3 ? 3.6 : s;
      if (!best || boosted > best.score) best = { score: boosted, concept: { type: "system", sys } };
    }
  }
  if (best) return best.concept;
  return { type: "literal", label: cleanSemanticLabel(raw) || raw, text: raw };
}

/** Type-ahead: what the partial Thought Bar text most likely means next to `anchor`. */
export function predictConcept(text: string, elements: JevElement[], anchor?: JevElement | null): PredictedConcept | null {
  void elements;
  const concept = resolveConcept(text, anchor ?? null);
  if (!concept) return null;
  const label =
    concept.type === "component"
      ? concept.comp.label
      : concept.type === "system"
        ? SYSTEM_LABEL(concept.sys)
        : concept.type === "literal"
          ? concept.label
          : text.trim();
  // Tab only finishes the word being typed ("api" to "API Gateway"); it never swaps it for another name
  // ("kaf" to "Event Bus").
  const completes =
    (concept.type === "component" || concept.type === "system") &&
    norm(text) !== norm(label) &&
    norm(label).startsWith(norm(text));
  return { label, ...(completes ? { completion: label } : {}) };
}

const SYSTEM_LABEL = (sys: SystemDef) => sys.name.replace(/\s+HLD$/, "").replace(/^./, (c) => c.toUpperCase());

// ------------------------------------------------------------------ drafts

interface DraftNode {
  key: string;
  label: string;
  sublabel?: string;
  kind: ShapeKind;
  /** The catalog name it was renamed from ("Postgres DB" for "Dashboard DB"), still used to reuse board nodes. */
  matchLabel?: string;
}
interface DraftEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}
interface Draft {
  tier: OptionTier;
  nodes: DraftNode[];
  edges: DraftEdge[];
  source: OptionSource;
  /** What the full option is called ("API backend", "URL shortener HLD"). */
  name: string;
  focusKey?: string;
  title?: string;
}

const ANCHOR = "@anchor";
const UPSTREAM = "@up";
const existingKey = (id: string) => `#${id}`;

const compNode = (c: Component): DraftNode => ({ key: c.key, label: c.label, sublabel: c.sublabel, kind: c.kind });

function suggestionNode(s: SemanticSuggestion, key: string): DraftNode {
  const kind: ShapeKind = s.kind === "arrow" || s.kind === "freedraw" ? "node" : (s.kind as ShapeKind);
  return { key, label: s.label, sublabel: s.sublabel, kind };
}

/** Breadth-first walk over catalog links from `root`, the shape of a "full" option. */
function expand(root: Component, rootKey: string, cap: number, skip: Set<string>): { nodes: DraftNode[]; edges: DraftEdge[] } {
  const nodes: DraftNode[] = [];
  const edges: DraftEdge[] = [];
  const seen = new Set<string>([root.key, ...skip]);
  const queue: Array<{ comp: Component; key: string; depth: number }> = [{ comp: root, key: rootKey, depth: 0 }];
  while (queue.length) {
    const { comp, key, depth } = queue.shift()!;
    if (depth >= 3) continue;
    for (const link of comp.links) {
      const next = BY_KEY.get(link.key);
      if (!next) continue;
      if (link.viaUpstream && key !== ANCHOR) continue;
      const from = link.viaUpstream ? UPSTREAM : key;
      if (seen.has(next.key)) {
        if (nodes.some((n) => n.key === next.key) || next.key === root.key) edges.push({ from, to: next.key, label: link.edge });
        else if (skip.has(next.key)) edges.push({ from, to: next.key, label: link.edge });
        continue;
      }
      if (nodes.length >= cap) continue;
      seen.add(next.key);
      nodes.push(compNode(next));
      edges.push({ from, to: next.key, label: link.edge });
      queue.push({ comp: next, key: next.key, depth: depth + 1 });
    }
  }
  return { nodes, edges };
}

function inboundEdge(anchor: JevElement | null, concept: DraftNode, comp: Component | null | undefined): DraftEdge[] {
  if (!anchor) return [];
  const anchorRole = roleOf(anchor);
  const conceptRole = comp?.role ?? null;
  const reverse = anchorRole && conceptRole && ROLE_RANK[conceptRole] < ROLE_RANK[anchorRole] && conceptRole === "client";
  const label = comp?.inbound;
  return reverse
    ? [{ from: concept.key, to: ANCHOR, label: componentForLabel(anchor.label)?.inbound ?? "uses" }]
    : [{ from: ANCHOR, to: concept.key, label }];
}

function componentDrafts(comp: Component, anchor: JevElement | null): Draft[] {
  const concept = compNode(comp);
  const inbound = inboundEdge(anchor, concept, comp);
  const companions = comp.links.slice(0, 2).map((l) => BY_KEY.get(l.key)).filter((c): c is Component => Boolean(c));
  const clusterEdges = comp.links.slice(0, 2).map((l) => ({ from: comp.key, to: l.key, label: l.edge }));
  const full = expand(comp, comp.key, 8, new Set());
  const upstreamClient: DraftNode[] = [];
  const upstreamEdges: DraftEdge[] = [];
  if (!anchor && (comp.role === "edge" || comp.role === "service")) {
    const client = BY_KEY.get("client_app")!;
    upstreamClient.push(compNode(client));
    upstreamEdges.push({ from: client.key, to: comp.key, label: comp.inbound });
  }
  return [
    { tier: "minimal", nodes: [concept], edges: inbound, source: "lexicon", name: comp.label, focusKey: comp.key },
    {
      tier: "cluster",
      nodes: [concept, ...companions.map(compNode)],
      edges: [...inbound, ...clusterEdges],
      source: "lexicon",
      name: `${comp.label} cluster`,
      focusKey: comp.key,
    },
    {
      tier: "full",
      nodes: [concept, ...full.nodes, ...upstreamClient],
      edges: [...inbound, ...full.edges, ...upstreamEdges],
      source: "template",
      name: comp.fullName,
      focusKey: comp.key,
    },
  ];
}

function systemDrafts(sys: SystemDef): Draft[] {
  const order: OptionTier[] = ["minimal", "cluster", "full"];
  return order.map((tier) => {
    const upTo = order.indexOf(tier);
    const nodes = sys.nodes
      .filter((n) => order.indexOf(n[4]) <= upTo)
      .map(([key, label, kind, sublabel]) => ({ key, label, kind, sublabel }));
    const keys = new Set(nodes.map((n) => n.key));
    const edges = sys.edges
      .filter(([f, t, , tiers]) => keys.has(f) && keys.has(t) && (!tiers || tiers.includes(tier)))
      .map(([from, to, label]) => ({ from, to, label }));
    const added = sys.nodes.filter((n) => n[4] === "cluster").map((n) => n[1]);
    return {
      tier,
      nodes,
      edges,
      source: "template" as const,
      name: tier === "full" ? sys.name : SYSTEM_LABEL(sys),
      focusKey: nodes[1]?.key ?? nodes[0]?.key,
      ...(tier === "cluster" ? { title: `${SYSTEM_LABEL(sys)} core: + ${added.join(" + ")}` } : {}),
    };
  });
}

/** Names made from a node's own label ("After X", "X OK?", "X Store") say nothing new: never offer them. */
function derivedNames(label: string): string[] {
  const clean = label.replace(/\s+/g, " ").trim() || "This";
  const name = clean.length > 22 ? `${clean.slice(0, 21).trimEnd()}…` : clean;
  return [`after ${name}`, `${name} ok?`, `${name} store`].map((x) => x.toLowerCase());
}

const ROLE_GROUPS: Array<[string, RegExp]> = [
  ["queue", /queue|kafka|\bbus\b|stream|pub\/?sub|broker|\bevents?\b/],
  ["cache", /cache|redis|memcache/],
  ["replica", /replica/],
  ["backup", /backup|snapshot/],
  ["gateway", /gateway/],
  ["cdn", /\bcdn\b/],
];
const roleGroup = (label: string) => ROLE_GROUPS.find(([, re]) => re.test(label.toLowerCase()))?.[0] ?? null;

/** A suggested role the board already has (Event Queue next to Event Bus, Redis Cache next to Redirect Cache). */
function roleOnBoard(label: string, elements: JevElement[]): boolean {
  const group = roleGroup(label);
  return Boolean(group && elements.some((e) => isBoardShape(e) && roleGroup(e.label) === group));
}

/** Lexicon names that only belong on a peer-to-peer / collaboration board. */
const P2P_ONLY = new Set(["WebRTC Peer", "STUN / Signaling", "CRDT State Sync", "Intent Engine", "Local Storage", "CRDT Sync"]);

function lexiconSteps(label: string, elements: JevElement[], anchor: JevElement | null, count: number): SemanticSuggestion[] {
  const existing = new Set(elements.filter(isBoardShape).map((e) => e.label.trim().toLowerCase()));
  const ctx = anchor ? suggestionContextFor(anchor, elements) : { neighborLabels: [] };
  const p2pBoard = elements.some((e) => /webrtc|p2p|peer|collab|crdt|whiteboard|realtime/i.test(e.label));
  const keep = (s: SemanticSuggestion) => !roleOnBoard(s.label, elements) && (p2pBoard || !P2P_ONLY.has(s.label));
  const first = inferNextStepsForLabel(label, new Set([...existing, ...derivedNames(label)]), ctx).filter(keep);
  if (first.length >= count) return first.slice(0, count);
  const more = first
    .flatMap((s) =>
      inferNextStepsForLabel(s.label, new Set([...existing, ...derivedNames(s.label), ...first.map((f) => f.label.toLowerCase())]), ctx)
    )
    .filter(keep)
    .filter((s, i, all) => all.findIndex((x) => x.label === s.label) === i && !first.some((f) => f.label === s.label));
  return [...first, ...more].slice(0, count);
}

function literalDrafts(label: string, elements: JevElement[], anchor: JevElement | null): Draft[] {
  const concept: DraftNode = { key: "concept", label, kind: kindForLabel(label) };
  const inbound = inboundEdge(anchor, concept, componentByExactName(label));
  const steps = lexiconSteps(label, elements, anchor, 3).map((s, i) => ({ s, node: suggestionNode(s, `step${i}`) }));
  const stepEdges = steps.map(({ s, node }) => ({ from: concept.key, to: node.key, label: s.edgeLabel }));
  const firstComp = steps[0] ? componentByExactName(steps[0].s.label) : null;
  const taken = new Set([norm(label), ...steps.map(({ s }) => norm(s.label))]);
  const second: SemanticSuggestion[] = firstComp
    ? firstComp.links
        .map((l) => BY_KEY.get(l.key))
        .filter((c): c is Component => Boolean(c) && !taken.has(norm(c!.label)))
        .slice(0, 2)
        .map((c) => ({ label: c.label, sublabel: c.sublabel, kind: c.kind, edgeLabel: c.inbound }))
    : steps[0]
      ? lexiconSteps(steps[0].s.label, [...elements, ...steps.map(({ s }) => fakeShape(s.label))], anchor, 2)
      : [];
  const secondNodes = second.map((s, i) => ({ s, node: suggestionNode(s, `deep${i}`) }));
  return [
    { tier: "minimal", nodes: [concept], edges: inbound, source: "lexicon", name: label, focusKey: concept.key },
    {
      tier: "cluster",
      nodes: [concept, ...steps.slice(0, 2).map((x) => x.node)],
      edges: [...inbound, ...stepEdges.slice(0, 2)],
      source: "lexicon",
      name: `${label} cluster`,
      focusKey: concept.key,
    },
    {
      tier: "full",
      nodes: [concept, ...steps.map((x) => x.node), ...secondNodes.map((x) => x.node)],
      edges: [
        ...inbound,
        ...stepEdges,
        ...secondNodes.map(({ s, node }) => ({ from: steps[0].node.key, to: node.key, label: s.edgeLabel })),
      ],
      source: "lexicon",
      name: `${label} build-out`,
      focusKey: concept.key,
    },
  ];
}

/** A described diagram ("payments with stripe and ledger"): hub, hub with neighbours, the whole graph. */
function describedDrafts(text: string, anchor: JevElement | null): Draft[] | null {
  const local = buildLocalSemanticGraphFromPrompt(text).graph;
  if (local.nodes.length < 3) return null;
  const nodes: DraftNode[] = local.nodes.map((n) => ({
    key: n.id,
    label: typedNodeLabel(n.label),
    sublabel: n.sublabel,
    kind: (n.kind === "text" ? "node" : n.kind) as ShapeKind,
  }));
  const edges: DraftEdge[] = local.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, dashed: e.dashed }));
  const hub = nodes[0];
  const inbound = inboundEdge(anchor, hub, componentForLabel(hub.label));
  const near = edges.filter((e) => e.from === hub.key || e.to === hub.key).map((e) => (e.from === hub.key ? e.to : e.from));
  const clusterKeys = new Set([hub.key, ...near.slice(0, Math.min(2, nodes.length - 2))]);
  const name = local.summary?.trim() || hub.label;
  return [
    { tier: "minimal", nodes: [hub], edges: inbound, source: "template", name: hub.label, focusKey: hub.key },
    {
      tier: "cluster",
      nodes: nodes.filter((n) => clusterKeys.has(n.key)),
      edges: [...inbound, ...edges.filter((e) => clusterKeys.has(e.from) && clusterKeys.has(e.to))],
      source: "template",
      name,
      focusKey: hub.key,
    },
    { tier: "full", nodes, edges: [...inbound, ...edges], source: "template", name, focusKey: hub.key },
  ];
}

function flowDrafts(text: string, elements: JevElement[], anchor: JevElement | null): Draft[] {
  const local = buildLocalSemanticGraphFromPrompt(text).graph;
  const nodes: DraftNode[] = local.nodes.map((n) => ({
    key: n.id,
    label: typedNodeLabel(n.label),
    sublabel: n.sublabel,
    kind: (n.kind === "text" ? "node" : n.kind) as ShapeKind,
  }));
  const edges: DraftEdge[] = local.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, dashed: e.dashed }));
  const tail = nodes[nodes.length - 1];
  const tailComp = componentForLabel(tail.label);
  const flowKeys = new Set(nodes.map((n) => n.key));
  const steps: Array<{ node: DraftNode; edge: string }> = tailComp
    ? tailComp.links
        .map((l) => BY_KEY.get(l.key))
        .filter((c): c is Component => Boolean(c) && !flowKeys.has(c!.key))
        .map((c) => ({ node: compNode(c), edge: c.inbound }))
    : [];
  for (const s of lexiconSteps(tail.label, elements, anchor, 4)) {
    if (steps.length >= 4) break;
    if (!steps.some((x) => norm(x.node.label) === norm(s.label))) steps.push({ node: suggestionNode(s, `step${steps.length}`), edge: s.edgeLabel ?? "" });
  }
  const stepEdges = steps.map((s) => ({ from: tail.key, to: s.node.key, label: s.edge }));
  const name = local.summary?.trim() || "flow";
  return [
    { tier: "minimal", nodes, edges, source: "board", name, focusKey: tail.key },
    {
      tier: "cluster",
      nodes: [...nodes, ...steps.slice(0, 1).map((s) => s.node)],
      edges: [...edges, ...stepEdges.slice(0, 1)],
      source: "lexicon",
      name,
      focusKey: tail.key,
    },
    {
      tier: "full",
      nodes: [...nodes, ...steps.slice(0, 3).map((s) => s.node)],
      edges: [...edges, ...stepEdges.slice(0, 3)],
      source: "lexicon",
      name: `${name} build-out`,
      focusKey: tail.key,
    },
  ];
}

/** Next steps for one node the user just selected, added or renamed. */
const SERVICE_HEADS = new Set(["api", "service", "server", "backend"]);

/** "Shortener API" and "Checkout API" are the domain's own services, not an API gateway. */
function subjectComponent(label: string): Component | null {
  const ws = words(label);
  const found =
    componentByExactName(label) ??
    (ws.length >= 2 && SERVICE_HEADS.has(ws[ws.length - 1]) ? BY_KEY.get("core_service") ?? null : componentForLabel(label));
  // A leaf of the catalog ("Ledger DB", "Orders DB") grows like the head of its family.
  if (found && found.links.length === 0) return BY_KEY.get(FAMILY_HEAD[found.role] ?? "") ?? found;
  return found;
}

const FAMILY_HEAD: Partial<Record<Role, string>> = {
  store: "postgres",
  cache: "redis_cache",
  queue: "event_bus",
  service: "core_service",
  worker: "worker",
};

const CLIENT_WORDS = new Set(["client", "clients", "app", "apps", "web", "mobile", "frontend", "ui", "user", "users", "browser", "the", "a", "api", "service", "server", "backend"]);

/** The board's own word for the domain ("Dashboard" from "Client Dashboard", "Shortener" from "Shortener API"). */
function domainWord(anchor: JevElement | null): string | null {
  if (!anchor) return null;
  const word = anchor.label
    .split(/[^A-Za-z0-9]+/)
    .find((w) => w && !CLIENT_WORDS.has(w.toLowerCase()) && (componentByExactName(w)?.role ?? "client") === "client");
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : null;
}

const DOMAIN_RENAMES: Record<string, (d: string) => { label: string; sublabel: string }> = {
  core_service: (d) => ({ label: `${d} Service`, sublabel: `${d} logic` }),
  postgres: (d) => ({ label: `${d} DB`, sublabel: "Primary store" }),
  worker: (d) => ({ label: `${d} Worker`, sublabel: "Background jobs" }),
};

/** Generic catalog names take the board's domain word, so the same request reads differently per board. */
function adaptDrafts(drafts: Draft[], domain: string | null): Draft[] {
  if (!domain) return drafts;
  return drafts.map((d) => ({
    ...d,
    nodes: d.nodes.map((n) => {
      const rename = DOMAIN_RENAMES[n.key];
      return rename ? { ...n, ...rename(domain), matchLabel: n.label } : n;
    }),
  }));
}

function subjectDrafts(subject: JevElement, elements: JevElement[]): Draft[] | null {
  const comp = subjectComponent(subject.label);
  const onBoard = (c: Component) => elements.some((e) => isBoardShape(e) && e.id !== subject.id && sameThing(e, compNode(c)));
  const steps: Array<{ node: DraftNode; link: CatalogLink | null; comp: Component | null; edge?: string }> = [];
  for (const l of comp?.links ?? []) {
    const c = BY_KEY.get(l.key);
    if (c && !onBoard(c) && !roleOnBoard(c.label, elements)) steps.push({ node: compNode(c), link: l, comp: c });
  }
  for (const s of lexiconSteps(subject.label, elements, subject, 6)) {
    if (steps.length >= 4) break;
    // After a build-out, the lexicon's fallbacks ("Observability", "Auth Check?") are noise, not a next step.
    if (GENERIC_SUGGESTION_LABELS.has(s.label) || s.label.includes("?")) continue;
    if (!steps.some((x) => norm(x.node.label) === norm(s.label))) {
      steps.push({ node: suggestionNode(s, `step${steps.length}`), link: null, comp: componentByExactName(s.label), edge: s.edgeLabel });
    }
  }
  const edgeFor = (s: (typeof steps)[number]): DraftEdge => ({
    from: s.link?.viaUpstream ? UPSTREAM : ANCHOR,
    to: s.node.key,
    label: s.link?.edge ?? s.edge,
  });
  if (steps.length === 0) return null;
  const first = steps[0];
  const firstLinks = first.comp?.links.slice(0, 2).filter((l) => BY_KEY.has(l.key) && !onBoard(BY_KEY.get(l.key)!)) ?? [];
  const cluster: Draft =
    firstLinks.length >= 2
      ? {
          tier: "cluster",
          nodes: [first.node, ...firstLinks.map((l) => compNode(BY_KEY.get(l.key)!))],
          edges: [edgeFor(first), ...firstLinks.map((l) => ({ from: first.node.key, to: l.key, label: l.edge }))],
          source: "lexicon",
          name: `${first.node.label} cluster`,
          focusKey: first.node.key,
        }
      : {
          tier: "cluster",
          nodes: steps.slice(0, 3).map((s) => s.node),
          edges: steps.slice(0, 3).map(edgeFor),
          source: "lexicon",
          name: `next steps from ${subject.label}`,
          focusKey: first.node.key,
        };
  let full: Draft;
  if (comp) {
    const skip = new Set(CATALOG.filter((c) => onBoard(c)).map((c) => c.key));
    const grown = expand(comp, ANCHOR, 8, skip);
    const extra =
      grown.nodes.length >= 4
        ? []
        : steps.filter((s) => !s.link && !grown.nodes.some((n) => norm(n.label) === norm(s.node.label))).slice(0, 2);
    full = {
      tier: "full",
      nodes: [...grown.nodes, ...extra.map((s) => s.node)],
      edges: [...grown.edges, ...extra.map(edgeFor)],
      source: "template",
      name: `${comp.fullName} around ${subject.label}`,
      focusKey: first.node.key,
    };
  } else {
    const deep = lexiconSteps(first.node.label, [...elements, ...steps.map((s) => fakeShape(s.node.label))], subject, 3);
    full = {
      tier: "full",
      nodes: [...steps.map((s) => s.node), ...deep.map((s, i) => suggestionNode(s, `deep${i}`))],
      edges: [...steps.map(edgeFor), ...deep.map((s, i) => ({ from: first.node.key, to: `deep${i}`, label: s.edgeLabel }))],
      source: "lexicon",
      name: `build-out around ${subject.label}`,
      focusKey: first.node.key,
    };
  }
  return [
    { tier: "minimal", nodes: [first.node], edges: [edgeFor(first)], source: "lexicon", name: first.node.label, focusKey: first.node.key },
    cluster,
    full,
  ];
}

const DOWNSTREAM_VERBS: Array<[RegExp, string]> = [
  [/inventor|stock|warehouse/, "reserves stock"],
  [/payment|billing|stripe|charge/, "charges"],
  [/ship|deliver|fulfil/, "ships"],
  [/email|notif|sms|push/, "notifies"],
  [/ledger/, "records"],
  [/\bdb\b|database|store|postgres|mysql/, "writes"],
  [/queue|kafka|bus|event/, "publishes"],
];
const downstreamVerb = (label: string) => DOWNSTREAM_VERBS.find(([re]) => re.test(label.toLowerCase()))?.[1] ?? null;

/** Several nodes selected: link them, add the node that ties them together, then that node's build-out. */
function multiDrafts(shapes: JevElement[], elements: JevElement[]): Draft[] {
  const linked = (a: string, b: string) =>
    elements.some((e) => e.kind === "arrow" && ((e.fromId === a && e.toId === b) || (e.fromId === b && e.toId === a)));
  const pairs: Array<[JevElement, JevElement]> = [];
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) if (!linked(shapes[i].id, shapes[j].id)) pairs.push([shapes[i], shapes[j]]);
  const existing = new Set(elements.filter(isBoardShape).map((e) => e.label.trim().toLowerCase()));
  const hubSuggestion = groupNextNode(shapes, existing);
  const hubComp = componentByExactName(hubSuggestion.label);
  const hub: DraftNode = hubComp ? compNode(hubComp) : suggestionNode(hubSuggestion, "hub");
  const hubEl = fakeShape(hub.label, hub.kind);
  const hubEdges: DraftEdge[] = shapes.map((s) => {
    const verb = downstreamVerb(s.label);
    if (verb) return { from: hub.key, to: existingKey(s.id), label: verb };
    return { from: existingKey(s.id), to: hub.key, label: hubComp?.inbound ?? relationVerb(s, hubEl) };
  });
  const linkEdges: DraftEdge[] = pairs.slice(0, 1).map(([a, b]) => {
    const [from, to] = downstreamVerb(a.label) && !downstreamVerb(b.label) ? [b, a] : downstreamVerb(b.label) ? [a, b] : orientPair(a, b);
    return { from: existingKey(from.id), to: existingKey(to.id), label: downstreamVerb(to.label) ?? relationVerb(from, to) };
  });
  const grown = hubComp ? expand(hubComp, hub.key, 4, new Set()) : { nodes: [], edges: [] };
  const fallbackGrowth = grown.nodes.length >= 2 ? grown : (() => {
    const steps = lexiconSteps(hub.label, elements, null, 3);
    return {
      nodes: steps.map((s, i) => suggestionNode(s, `hubstep${i}`)),
      edges: steps.map((s, i) => ({ from: hub.key, to: `hubstep${i}`, label: s.edgeLabel })),
    };
  })();
  const minimal: Draft =
    linkEdges.length > 0
      ? { tier: "minimal", nodes: [], edges: linkEdges, source: "board", name: "link", focusKey: linkEdges[0].to }
      : { tier: "minimal", nodes: [hub], edges: hubEdges.slice(0, 1), source: "lexicon", name: hub.label, focusKey: hub.key };
  const cluster: Draft =
    linkEdges.length > 0
      ? {
          tier: "cluster",
          nodes: [hub, ...fallbackGrowth.nodes.slice(0, 1)],
          edges: [...hubEdges, ...fallbackGrowth.edges.slice(0, 1)],
          source: "lexicon",
          name: hub.label,
          focusKey: hub.key,
        }
      : {
          tier: "cluster",
          nodes: [hub, ...fallbackGrowth.nodes.slice(0, 1)],
          edges: [...hubEdges, ...fallbackGrowth.edges.slice(0, 1)],
          source: "lexicon",
          name: hub.label,
          focusKey: hub.key,
        };
  return [
    minimal,
    cluster,
    {
      tier: "full",
      nodes: [hub, ...fallbackGrowth.nodes],
      edges: [...hubEdges, ...fallbackGrowth.edges],
      source: hubComp ? "template" : "lexicon",
      name: `${hub.label} build-out`,
      focusKey: hub.key,
    },
  ];
}

// ------------------------------------------------------------------ materialize: reuse, attach, place

const isBoardShape = (e: JevElement): boolean => isComponentShape(e);

function fakeShape(label: string, kind: ShapeKind = "node"): JevElement {
  return { id: `fake_${norm(label)}`, kind, label, x: 0, y: 0, width: 0, height: 0, tone: "ink", seed: 0, createdAt: 0, updatedAt: 0 };
}

interface Context {
  elements: JevElement[];
  anchor: JevElement | null;
  viewportCenter: Point;
  /** Selected nodes are what the user is working on, not something an option "reuses". */
  selectedIds?: string[];
  /** Typed text may pad with general names; follow-ups after an action may not. */
  allowGeneric?: boolean;
  /**
   * The node Enter adds for the typed text, listed in `elements` as if it were on the board already: a bigger
   * option that contains the same thing builds around it, so the ghost stays put when Tab moves to that option.
   */
  pinnedId?: string;
  /** A typed flow is drawn exactly as typed: its nodes are not also linked to the board. */
  standalone?: boolean;
  /**
   * The nodes the user named in a typed flow. Each is the board node with exactly that name, or a new node
   * with that name: never another node standing in for it ("Postgres" is not the board's "URL DB").
   */
  typedKeys?: Set<string>;
}

interface Materialized {
  shapes: JevElement[];
  arrows: JevElement[];
  /** Cross edges left out of the preview because they would run through a node. */
  dropped: JevElement[];
  reused: string[];
  attachedTo: string[];
  focusId?: string;
  /** The option builds on the pinned typed node (which is then one of its shapes). */
  pinned?: boolean;
}

function upstreamOf(anchor: JevElement, elements: JevElement[]): string | null {
  const incoming = elements.find((e) => e.kind === "arrow" && e.toId === anchor.id && e.fromId);
  return incoming?.fromId ?? null;
}

function materialize(draft: Draft, ctx: Context): Materialized {
  const { elements, anchor } = ctx;
  // The pinned typed node is matched by name only: it is never a stand-in for "the board's database".
  const pin = ctx.pinnedId ? elements.find((e) => e.id === ctx.pinnedId) ?? null : null;
  const isPin = (node: DraftNode) => {
    if (!pin) return false;
    if (norm(pin.label) === norm(node.label)) return true;
    const a = componentByExactName(pin.label);
    return a !== null && a.key === componentByExactName(node.label)?.key;
  };
  const boardShapes = elements.filter((e) => isBoardShape(e) && e.id !== pin?.id);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const resolved = new Map<string, string>();
  const fresh: Array<DraftNode & { id: string }> = [];
  const reused: string[] = [];
  let pinned = false;
  const wired = new Set(
    anchor
      ? elements.flatMap((e) => (e.kind === "arrow" && (e.fromId === anchor.id || e.toId === anchor.id) ? [e.fromId ?? "", e.toId ?? ""] : []))
      : []
  );

  for (const node of draft.nodes) {
    const probe = node.matchLabel ? { ...node, label: node.matchLabel } : node;
    const preferAnchor = anchor && sameThing(anchor, probe) ? anchor : null;
    const match = ctx.typedKeys?.has(node.key)
      ? boardShapes.find((e) => norm(e.label) === norm(node.label)) ?? null
      : preferAnchor ??
        boardShapes.find((e) => sameThing(e, probe)) ??
        (isPin(probe) ? pin : null) ??
        findBoardCounterpart(probe, boardShapes, wired);
    if (match) {
      resolved.set(node.key, match.id);
      if (match.id === ctx.pinnedId) pinned = true;
      else if (match.id !== anchor?.id && !ctx.selectedIds?.includes(match.id) && !reused.includes(match.label)) {
        reused.push(match.label);
      }
      continue;
    }
    const twin = fresh.find((f) => norm(f.label) === norm(node.label));
    if (twin) {
      resolved.set(node.key, twin.id);
      continue;
    }
    const id = uid("el");
    resolved.set(node.key, id);
    fresh.push({ ...node, id });
  }

  const resolveKey = (key: string): string | null => {
    if (key === ANCHOR) return anchor?.id ?? null;
    if (key === UPSTREAM) return anchor ? upstreamOf(anchor, elements) ?? anchor.id : null;
    if (key.startsWith("#")) return byId.has(key.slice(1)) ? key.slice(1) : null;
    return resolved.get(key) ?? null;
  };

  const linkedOnBoard = (a: string, b: string) =>
    elements.some((e) => e.kind === "arrow" && ((e.fromId === a && e.toId === b) || (e.fromId === b && e.toId === a)));
  const edges: Array<{ from: string; to: string; label?: string; dashed?: boolean }> = [];
  const addEdge = (from: string, to: string, label?: string, dashed?: boolean) => {
    if (from === to || linkedOnBoard(from, to)) return;
    if (edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;
    edges.push({ from, to, label, dashed });
  };
  for (const e of draft.edges) {
    const f = resolveKey(e.from);
    const t = resolveKey(e.to);
    if (f && t) addEdge(f, t, e.label, e.dashed);
  }

  // Context first: nothing new floats on a board that has content, and nothing is left as an island.
  const freshIds = new Set(fresh.map((f) => f.id));
  const groupOf = new Map<string, string>();
  const find = (x: string): string => {
    const p = groupOf.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    groupOf.set(x, r);
    return r;
  };
  const unite = (a: string, b: string) => groupOf.set(find(a), find(b));
  const BOARD = "__board__";
  for (const s of boardShapes) unite(s.id, BOARD);
  for (const e of edges) unite(e.from, e.to);
  const attachTo = anchor ?? nearestShape(boardShapes, ctx.viewportCenter);
  const rootFresh = fresh[0]?.id;
  for (const f of fresh) {
    if (ctx.standalone) continue;
    if (boardShapes.length > 0 && attachTo && find(f.id) !== find(BOARD)) {
      addEdge(attachTo.id, f.id);
      unite(f.id, BOARD);
    } else if (boardShapes.length === 0 && rootFresh && find(f.id) !== find(rootFresh)) {
      addEdge(rootFresh, f.id);
      unite(f.id, rootFresh);
    }
  }

  // Place: layered left to right from the board (board nodes never move), then draw the arrows.
  const created = new Map<string, JevElement>();
  const elementFor = (id: string) => created.get(id) ?? byId.get(id) ?? null;
  const freshEl = new Map(fresh.map((f) => [f.id, fakeShape(f.label, f.kind)]));
  const labelled = edges.map((e) => {
    const from = byId.get(e.from) ?? freshEl.get(e.from)!;
    const to = byId.get(e.to) ?? freshEl.get(e.to)!;
    return { ...e, label: e.label?.trim() || relationVerb(from, to) };
  });
  const { positions, treeEdges } = layeredGhostLayout({
    nodes: fresh.map((f) => ({ id: f.id, ...sizeFor(f.kind) })),
    edges: labelled.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    board: elements,
    origin: ctx.viewportCenter,
  });
  for (const f of fresh) {
    const at = positions.get(f.id) ?? ctx.viewportCenter;
    created.set(f.id, { ...makeShape(f.kind, f.label, f.sublabel, at), id: f.id, seed: makeSeed(f.id) });
  }
  const shapes = fresh.map((f) => created.get(f.id)!);
  const all = [...elements, ...shapes];
  const allById = new Map(all.map((e) => [e.id, e]));
  const solid = all.filter((e) => e.kind !== "arrow" && e.kind !== "freedraw" && e.kind !== "frame" && e.kind !== "zone");
  const arrows: JevElement[] = [];
  const dropped: JevElement[] = [];
  const isTree = (e: { from: string; to: string }) => treeEdges.has(e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`);
  // Tree edges first: their geometry is guaranteed by the layout. A cross edge that would run through a node
  // is left out of the preview; one whose label would sit on another label or a node keeps its line only.
  for (const e of [...labelled.filter(isTree), ...labelled.filter((x) => !isTree(x))]) {
    const link = makeLink(e.from, e.to, e.label, e.dashed);
    // Tree edges are clear by construction; a link between two board nodes is the user's own geometry (board
    // nodes never move), so it stays even when something sits between them.
    if (isTree(e) || (byId.has(e.from) && byId.has(e.to))) {
      arrows.push(link);
      continue;
    }
    if (arrowHitsShape(link, allById, solid, 4)) {
      dropped.push(link);
      continue;
    }
    const r = labelRect(link, allById);
    const others = arrows.map((x) => labelRect(x, allById)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const boardLabels = elements
      .filter((x) => x.kind === "arrow" && x.fromId && x.toId)
      .map((x) => labelRect(x, allById))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const clash = r && (solid.some((s) => rectsIntersect(r, s)) || [...others, ...boardLabels].some((o) => rectsIntersect(r, o)));
    arrows.push(clash ? { ...link, label: "" } : link);
  }
  void elementFor;
  const attachedTo = Array.from(
    new Set(
      edges
        .filter((e) => freshIds.has(e.from) !== freshIds.has(e.to) || (!freshIds.has(e.from) && !freshIds.has(e.to)))
        .flatMap((e) => [e.from, e.to])
        .filter((id) => !freshIds.has(id))
        .map((id) => byId.get(id)?.label ?? "")
        .filter(Boolean)
    )
  );
  const focus = draft.focusKey ? resolveKey(draft.focusKey) : null;
  const pinnedEl = pinned ? byId.get(ctx.pinnedId!) : undefined;
  return {
    shapes: pinnedEl ? [pinnedEl, ...shapes] : shapes,
    arrows,
    dropped,
    reused,
    attachedTo: pinnedEl ? attachedTo.filter((label) => label !== pinnedEl.label) : attachedTo,
    focusId: focus ?? shapes[0]?.id ?? arrows[0]?.toId,
    pinned,
  };
}

function nearestShape(shapes: JevElement[], to: Point): JevElement | null {
  let best: JevElement | null = null;
  let bestD = Infinity;
  for (const s of shapes) {
    const c = getElementCenter(s);
    const d = Math.hypot(c.x - to.x, c.y - to.y);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

// ------------------------------------------------------------------ options

const short = (s: string, max = 26) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function toOption(draft: Draft, m: Materialized, ctx: Context): PredictedAction {
  const n = m.shapes.length;
  const labelOf = (id?: string) => (id ? ctx.elements.find((e) => e.id === id)?.label ?? m.shapes.find((s) => s.id === id)?.label ?? "" : "");
  let title: string;
  if (draft.tier === "minimal") {
    title =
      n === 1
        ? m.shapes[0].label
        : n === 0 && m.arrows[0]
          ? `Link ${labelOf(m.arrows[0].fromId)} → ${labelOf(m.arrows[0].toId)}`
          : m.shapes.map((s) => s.label).join(" → ");
  } else if (draft.tier === "cluster") {
    title = m.shapes.slice(0, 3).map((s) => s.label).join(" + ") + (n > 3 ? ` +${n - 3}` : "");
  } else {
    title = `Full ${draft.name}`;
  }
  if (draft.title) title = draft.title;
  const parts: string[] = [];
  if (draft.tier === "minimal" && n <= 1 && m.arrows[0]) {
    const a = m.arrows[0];
    parts.push(`${labelOf(a.fromId)} —${a.label ? ` ${a.label} ` : " "}→ ${labelOf(a.toId)}`);
  } else if (draft.tier === "full") {
    parts.push(m.shapes.slice(0, 3).map((s) => short(s.label, 18)).join(", ") + (n > 3 ? "…" : ""));
  } else if (m.attachedTo.length > 0) {
    parts.push(`linked from ${m.attachedTo.slice(0, 2).join(", ")}`);
  } else {
    parts.push(draft.tier === "minimal" ? "smallest start" : "core pieces");
  }
  if (m.reused.length > 0) parts.push(`reuses ${m.reused.slice(0, 2).join(", ")}`);
  const category: PredictedAction["category"] = draft.tier === "full" ? "structure" : n === 0 ? "connect" : "extend";
  return {
    id: uid("pred"),
    title,
    subtitle: parts.join(" · "),
    category,
    tier: draft.tier,
    nodeCount: n,
    source: draft.source,
    feedbackKeys: [`tier:${draft.tier}`],
    addElements: [...m.shapes, ...m.arrows],
    focusId: m.focusId,
  };
}

/** Grows a draft with lexicon next steps from its focus until it adds more nodes than `atLeast`. */
function grow(draft: Draft, atLeast: number, ctx: Context): Draft {
  const focus = draft.nodes.find((n) => n.key === draft.focusKey) ?? draft.nodes[0];
  const fromKey = focus?.key ?? ANCHOR;
  const label = focus?.label ?? ctx.anchor?.label ?? "Service";
  const taken = [...ctx.elements, ...draft.nodes.map((n) => fakeShape(n.label))];
  const steps = lexiconSteps(label, taken, ctx.anchor, atLeast + 2);
  const nodes = [...draft.nodes];
  const edges = [...draft.edges];
  for (const [i, s] of steps.entries()) {
    if (nodes.some((x) => norm(x.label) === norm(s.label))) continue;
    if (!ctx.allowGeneric && (GENERIC_SUGGESTION_LABELS.has(s.label) || s.label.includes("?"))) continue;
    nodes.push(suggestionNode(s, `grow${draft.tier}${i}`));
    edges.push({ from: fromKey, to: `grow${draft.tier}${i}`, label: s.edgeLabel });
    if (nodes.length > atLeast + 1) break;
  }
  return { ...draft, nodes, edges };
}

export interface NextOptionsInput {
  elements: JevElement[];
  /** Thought Bar text. */
  text?: string;
  selectedIds?: string[];
  /** The node the user touched last (just added, applied or renamed). */
  subjectId?: string;
  viewportCenter?: Point;
  /** The visible part of the board: a typed node is placed beside something the user can see. */
  viewport?: Rect;
}

/** What the server needs to rank the options with jev and reshape (b) and (c) with the Gateway LLM. */
export interface NextOptionsRequest {
  trigger: "type" | "select" | "multi";
  text?: string;
  conceptLabel: string;
  anchorLabel?: string;
  selectedLabels: string[];
  boardLabels: string[];
  options: Array<{ id: OptionTier; title: string; description: string; nodes: number }>;
  /** The deterministic (b) and (c) node names: the LLM adapts these instead of starting from nothing. */
  baseline: { cluster: string[]; full: string[]; edges: string[] };
}

export interface NextOptionsResult {
  intent: SpatialIntent;
  options: PredictedAction[];
  concept: PredictedConcept;
  anchorId: string | null;
  /** Null when there is nothing for the server to rank (fewer than three options). */
  request: NextOptionsRequest | null;
  /** The node Enter creates for the typed text (option (a)); null for a flow, a selection or a follow-up. */
  typed: TypedNodePlan | null;
  /** Inputs to rebuild (b) and (c) in place when the LLM answers. */
  context: {
    anchorId: string | null;
    viewportCenter: Point;
    conceptKey: string | null;
    conceptLabel: string;
    selectedIds: string[];
  };
}

/** "API -> Redis Cache (read-through)": the full option's wiring, so the LLM keeps a sound structure. */
function edgeLines(o: PredictedAction, elements: JevElement[]): string[] {
  const label = (id?: string) => (elements.find((e) => e.id === id) ?? o.addElements.find((e) => e.id === id))?.label ?? "";
  return o.addElements
    .filter((e) => e.kind === "arrow")
    .map((a) => `${label(a.fromId)} -> ${label(a.toId)}${a.label ? ` (${a.label})` : ""}`.slice(0, 120));
}

const shapeLabels = (o: PredictedAction) =>
  o.addElements.filter((e) => e.kind !== "arrow").map((e) => e.label.slice(0, 80));

/** The node typed text attaches to: what Tab completion and the options both use. */
export function typingAnchor(elements: JevElement[], text: string, selectedIds: string[], subjectId?: string | null): JevElement | null {
  const shapes = elements.filter(isBoardShape);
  return pickAnchor({ elements, text, selectedIds, subjectId: subjectId ?? undefined }, shapes, resolveConcept(text, null));
}

function pickAnchor(input: NextOptionsInput, shapes: JevElement[], concept: Concept | null): JevElement | null {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const selected = (input.selectedIds ?? []).map((id) => byId.get(id)).filter((x): x is JevElement => Boolean(x));
  const pool = selected.length > 0 ? selected : shapes;
  if (selected.length === 1) return selected[0];
  if (selected.length === 0 && input.subjectId && byId.has(input.subjectId)) return byId.get(input.subjectId)!;
  if (pool.length === 0) return null;
  const conceptRole = concept?.type === "component" ? concept.comp.role : null;
  const recent = Math.max(...pool.map((s) => s.updatedAt ?? 0));
  const score = (s: JevElement) => {
    const role = roleOf(s);
    let v = 0;
    if (conceptRole && role && NEXT_ROLES[role].includes(conceptRole)) v += 2;
    if ((s.updatedAt ?? 0) === recent) v += 1;
    return v;
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

function draftsFor(input: NextOptionsInput, ctx: Context, concept: Concept | null, shapes: JevElement[]): Draft[] | null {
  const text = input.text?.trim() ?? "";
  if (text) {
    if (!concept) return null;
    if (concept.type === "component") return componentDrafts(concept.comp, ctx.anchor);
    if (concept.type === "system") return systemDrafts(concept.sys);
    if (concept.type === "flow") return flowDrafts(concept.text, ctx.elements, ctx.anchor);
    if (/\s/.test(concept.text)) {
      const described = describedDrafts(concept.text, ctx.anchor);
      if (described) return described;
    }
    return literalDrafts(concept.label, ctx.elements, ctx.anchor);
  }
  const selected = (input.selectedIds ?? []).map((id) => shapes.find((s) => s.id === id)).filter((x): x is JevElement => Boolean(x));
  if (selected.length >= 2) return multiDrafts(selected, ctx.elements);
  const subject = selected[0] ?? (input.subjectId ? shapes.find((s) => s.id === input.subjectId) : undefined);
  return subject ? subjectDrafts(subject, ctx.elements) : null;
}

const pinTypedNode = (ctx: Context, node: JevElement): Context => ({ ...ctx, elements: [...ctx.elements, node], pinnedId: node.id });

/** A bigger option builds around the typed node when it contains the same thing; otherwise it stands on its own. */
function materializeAround(draft: Draft, ctx: Context, pinnedCtx: Context | null): Materialized {
  const around = pinnedCtx ? materialize(draft, pinnedCtx) : null;
  return around?.pinned ? around : materialize(draft, ctx);
}

/**
 * `typed` is the node Enter creates for the Thought Bar text: it is option (a) as is, and the cluster and full
 * options grow from there. A typed flow ("app -> api") is exactly its own nodes and arrows, never padded.
 */
function finish(drafts: Draft[], base: Context, typed: PredictedAction | null, exact: boolean): PredictedAction[] | null {
  // A typed flow keeps to the arrows the user typed: no extra link to the board (connections are never forced).
  const ctx: Context = exact ? { ...base, standalone: true, typedKeys: new Set(drafts[0].nodes.map((n) => n.key)) } : base;
  const pinnedCtx = typed ? pinTypedNode(ctx, typed.addElements[0]) : null;
  const build = (draft: Draft, bigger: boolean): Materialized => materializeAround(draft, ctx, bigger ? pinnedCtx : null);
  const built = drafts.map((d, i) => ({ draft: d, m: build(d, i > 0) }));
  if (typed) {
    built[0] = {
      draft: built[0].draft,
      m: { shapes: typed.addElements, arrows: [], dropped: [], reused: [], attachedTo: [], focusId: typed.focusId },
    };
  } else if (!exact && built[0].m.shapes.length === 0 && built[0].m.arrows.length === 0) {
    const next = built[1].draft.nodes.find((n) => !built[0].draft.nodes.includes(n));
    if (next) {
      const base = built[0].draft;
      const draft: Draft = {
        ...base,
        nodes: [...base.nodes, next],
        edges: [...base.edges, ...built[1].draft.edges.filter((e) => e.to === next.key || e.from === next.key)],
        focusKey: next.key,
      };
      built[0] = { draft, m: materialize(draft, ctx) };
    }
  }
  for (let i = 1; i < built.length; i++) {
    let guard = 0;
    while (built[i].m.shapes.length <= built[i - 1].m.shapes.length && guard < 3) {
      const draft = grow(built[i].draft, built[i - 1].m.shapes.length, ctx);
      built[i] = { draft, m: build(draft, true) };
      guard += 1;
    }
  }
  // A follow-up that cannot grow without filler is not offered at all.
  if (!ctx.allowGeneric && built.some((b, i) => i > 0 && b.m.shapes.length <= built[i - 1].m.shapes.length)) return null;
  // Neither is an option that would add nothing (prod 22 Nov: an untitled "link only" card that did nothing).
  if (built.some((b) => b.m.shapes.length === 0 && b.m.arrows.length === 0)) return null;
  const board = pinnedCtx?.elements ?? ctx.elements;
  const options = harmonizeEdgeLabels(built.map(({ draft, m }) => toOption(draft, m, m.pinned && pinnedCtx ? pinnedCtx : ctx)), board);
  return typed ? [typed, ...options.slice(1)] : options;
}

/** Exactly three options, small to big, for the Thought Bar text, the selection, or the last-touched node. */
export function buildNextOptions(input: NextOptionsInput): NextOptionsResult | null {
  const elements = input.elements;
  const shapes = elements.filter(isBoardShape);
  const text = input.text?.trim() ?? "";
  const viewportCenter = input.viewportCenter ?? { x: 400, y: 300 };
  const flow = isFlowText(text);
  // What Enter creates for the typed text. It never depends on the catalog, the templates or the AI below.
  const plan =
    text && !flow
      ? planTypedNode({
          text,
          elements,
          selectedIds: input.selectedIds,
          lastFocusedId: input.subjectId,
          viewportCenter,
          viewport: input.viewport,
        })
      : null;
  const typed = plan ? typedNodeOption(plan, elements) : null;
  const firstPass = text ? resolveConcept(text, null) : null;
  const anchor = pickAnchor(input, shapes, firstPass);
  const concept = text ? resolveConcept(text, anchor) : null;
  const ctx: Context = { elements, anchor, viewportCenter, selectedIds: input.selectedIds, allowGeneric: Boolean(text) || (input.selectedIds ?? []).length >= 1 };
  const raw = draftsFor(input, ctx, concept, shapes);
  const subjectEl = !text && (input.selectedIds ?? []).length <= 1 ? anchor : null;
  // A typed flow keeps its names; everything else may take the board's domain word ("URL DB" on a shortener board).
  const drafts = raw && (flow ? raw : adaptDrafts(raw, domainWord(text ? anchor : subjectEl)));
  const options = drafts ? finish(drafts, ctx, typed, flow) : null;

  const selected = (input.selectedIds ?? []).map((id) => shapes.find((s) => s.id === id)).filter((x): x is JevElement => Boolean(x));
  const predicted = text ? predictConcept(text, elements, anchor) : null;
  const conceptLabel = typed?.title ?? predicted?.label ?? (selected.length >= 2 ? selected.map((s) => s.label).join(" + ") : anchor?.label ?? "");
  const context = {
    anchorId: anchor?.id ?? null,
    viewportCenter,
    conceptKey: concept?.type === "component" ? concept.comp.key : null,
    conceptLabel,
    selectedIds: input.selectedIds ?? [],
  };
  const typedIntent: SpatialIntent | null = typed && plan
    ? {
        kind: "prompt_follow_up",
        headline: `Enter adds ${typed.title}`,
        detail: placedWhere(plan, elements) || "a new node",
        subjectId: plan?.anchorId ?? undefined,
        relatedIds: [],
        timestamp: Date.now(),
      }
    : null;

  if (!options) {
    // Nothing bigger to offer (a one-letter name, an unknown word with no next steps): Enter still adds the node.
    if (!typed || !typedIntent) return null;
    return { intent: typedIntent, options: [typed], concept: { label: typed.title }, anchorId: plan?.anchorId ?? null, request: null, typed: plan, context };
  }

  const trigger: NextOptionsRequest["trigger"] = text ? "type" : selected.length >= 2 ? "multi" : "select";
  const intent: SpatialIntent =
    typedIntent ??
    (trigger === "type"
      ? {
          kind: "prompt_follow_up",
          headline: `Enter draws ${options[0].title}`,
          detail: "the flow as typed",
          subjectId: anchor?.id,
          relatedIds: [],
          timestamp: Date.now(),
        }
      : trigger === "multi"
        ? {
            kind: "domain_continue",
            headline: `Predictions for ${selected.length} selected nodes`,
            detail: selected.map((s) => s.label).filter(Boolean).slice(0, 3).join(", "),
            subjectId: selected[0].id,
            relatedIds: selected.slice(1).map((s) => s.id),
            timestamp: Date.now(),
          }
        : {
            kind: "domain_continue",
            headline: `Next from "${anchor?.label || anchor?.kind}"`,
            detail: "3 options, small to big",
            subjectId: anchor?.id,
            relatedIds: [],
            timestamp: Date.now(),
          });

  return {
    intent,
    options,
    concept: predicted ? { ...predicted, label: conceptLabel } : { label: conceptLabel },
    anchorId: anchor?.id ?? null,
    request: {
      trigger,
      ...(text ? { text: text.slice(0, 120) } : {}),
      conceptLabel: conceptLabel.slice(0, 80) || "board",
      ...(anchor ? { anchorLabel: anchor.label.slice(0, 80) } : {}),
      selectedLabels: selected.map((s) => s.label.slice(0, 80)).slice(0, 8),
      boardLabels: shapes.map((s) => s.label.trim().slice(0, 80)).filter(Boolean).slice(0, 40),
      options: options.map((o) => ({
        id: o.tier!,
        title: o.title.slice(0, 120) || "option",
        description: o.subtitle.slice(0, 140),
        nodes: o.nodeCount ?? 0,
      })),
      baseline: {
        cluster: shapeLabels(options[1]).slice(0, 12),
        full: shapeLabels(options[2]).slice(0, 16),
        edges: edgeLines(options[2], elements).slice(0, 20),
      },
    },
    typed: plan,
    context,
  };
}

/**
 * What is offered right after a node is added: its connections to the board first (never applied on their
 * own), then the usual next steps to fill up to three. With nothing to connect to, the usual three options.
 */
export function buildAfterCreateOptions(input: {
  elements: JevElement[];
  nodeId: string;
  anchorIds?: string[];
  viewportCenter?: Point;
}): NextOptionsResult | null {
  const next = buildNextOptions({ elements: input.elements, subjectId: input.nodeId, viewportCenter: input.viewportCenter });
  const links = connectionOptions({ elements: input.elements, nodeId: input.nodeId, anchorIds: input.anchorIds });
  if (links.length === 0) return next;
  // The links are already offered above: a next step that is only another link would say the same thing twice.
  const steps = (next?.options ?? []).filter((o) => o.addElements.some((e) => e.kind !== "arrow"));
  const node = input.elements.find((e) => e.id === input.nodeId)!;
  const viewportCenter = input.viewportCenter ?? { x: 400, y: 300 };
  return {
    intent: {
      kind: "domain_continue",
      headline: `Connect ${node.label || node.kind}?`,
      detail: "Enter accepts, typing skips",
      subjectId: node.id,
      relatedIds: [],
      timestamp: Date.now(),
    },
    options: [...links, ...steps].slice(0, 3),
    concept: { label: node.label },
    anchorId: node.id,
    request: null,
    typed: null,
    context: { anchorId: node.id, viewportCenter, conceptKey: null, conceptLabel: node.label, selectedIds: [] },
  };
}

// ------------------------------------------------------------------ LLM refinement

/** The server's answer to `next_options`: jev's ranking of the three tiers and the LLM's (b)/(c) graphs. */
export interface NextOptionsAnswer {
  source: DecideSource;
  model: string;
  isHeuristic?: boolean;
  latencyMs: number;
  probabilities: Partial<Record<OptionTier, number>> | null;
  graphs: { cluster?: LlmOptionGraph | null; full?: LlmOptionGraph | null } | null;
  graphModel?: string;
}

export interface LlmOptionGraph {
  nodes: Array<{ label: string; kind: string; sublabel?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

const LLM_KINDS = new Set<ShapeKind>(["node", "database", "cache", "queue", "lb", "blob", "external", "actor", "diamond"]);

function llmDraft(
  tier: OptionTier,
  graph: LlmOptionGraph,
  base: PredictedAction,
  elements: JevElement[],
  dropLabel: string | null
): Draft {
  const key = (label: string) => `llm_${norm(label)}`;
  const nodes: DraftNode[] = [];
  for (const n of graph.nodes) {
    const label = n.label.trim().slice(0, 40);
    if (!label || label.includes("+") || nodes.some((x) => x.key === key(label))) continue;
    if (dropLabel && norm(label) === norm(dropLabel)) continue;
    nodes.push({
      key: key(label),
      label,
      ...(n.sublabel ? { sublabel: n.sublabel.trim().slice(0, 48) } : {}),
      kind: LLM_KINDS.has(n.kind as ShapeKind) ? (n.kind as ShapeKind) : kindForLabel(label),
    });
  }
  const boardByLabel = new Map(elements.filter(isBoardShape).map((e) => [norm(e.label), e.id]));
  const endpoint = (label: string) =>
    nodes.some((n) => n.key === key(label)) ? key(label) : boardByLabel.has(norm(label)) ? existingKey(boardByLabel.get(norm(label))!) : null;
  const edges: DraftEdge[] = [];
  for (const e of graph.edges) {
    const from = endpoint(e.from);
    const to = endpoint(e.to);
    // The LLM extends the board; it never rewires two nodes the user already has.
    if (from && to && !(from.startsWith("#") && to.startsWith("#"))) edges.push({ from, to, label: e.label?.trim().slice(0, 24) });
  }

  // The deterministic option's main node stays where it is, wired the same way, and the LLM graph hangs
  // off it: Tab between options does not make the ghost jump, and the option stays attached to the board.
  const baseIds = new Set(base.addElements.map((e) => e.id));
  const concept = base.addElements.find((e) => e.kind !== "arrow");
  const wiring = concept
    ? base.addElements.filter(
        (e) =>
          e.kind === "arrow" &&
          ((e.fromId === concept.id && !baseIds.has(e.toId!)) || (e.toId === concept.id && !baseIds.has(e.fromId!)))
      )
    : [];
  if (concept && wiring.length > 0) {
    const conceptKey = key(concept.label);
    const at = nodes.findIndex((n) => n.key === conceptKey);
    if (at >= 0) nodes.splice(at, 1);
    nodes.unshift({ key: conceptKey, label: concept.label, sublabel: concept.sublabel, kind: concept.kind as ShapeKind });
    for (const w of wiring.reverse()) {
      edges.unshift(
        w.fromId === concept.id
          ? { from: conceptKey, to: existingKey(w.toId!), label: w.label }
          : { from: existingKey(w.fromId!), to: conceptKey, label: w.label }
      );
    }
    const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
    for (const n of nodes) if (n.key !== conceptKey && !touched.has(n.key)) edges.push({ from: conceptKey, to: n.key });
    return { tier, nodes, edges, source: "llm", name: `${concept.label} build-out`, focusKey: conceptKey };
  }
  return { tier, nodes, edges, source: "llm", name: nodes[0]?.label ?? "architecture", focusKey: nodes[0]?.key };
}

const isStoreEl = (e: JevElement) => e.kind === "database" || e.kind === "blob";
const isCacheEl = (e: JevElement) => e.kind === "cache" || /cache|redis|memcache/i.test(e.label);
const isReplicaEl = (e: JevElement) => /replica/i.test(e.label);

/**
 * Architecture mistakes an option must not make: a cache hung off the database instead of sitting on the
 * caller's read path, or a replica writing into the primary.
 */
export function structureProblems(option: PredictedAction, elements: JevElement[]): string[] {
  const all = new Map([...elements, ...option.addElements].map((e) => [e.id, e]));
  const arrows = [...elements, ...option.addElements].filter((e) => e.kind === "arrow" && e.fromId && e.toId);
  const problems: string[] = [];
  for (const a of option.addElements.filter((e) => e.kind === "arrow")) {
    const from = all.get(a.fromId!);
    const to = all.get(a.toId!);
    if (!from || !to) continue;
    if (isStoreEl(from) && !isCacheEl(from) && isCacheEl(to)) problems.push(`${from.label} feeds cache ${to.label}`);
    if (isReplicaEl(from) && isStoreEl(to) && !isReplicaEl(to)) problems.push(`replica ${from.label} writes into ${to.label}`);
  }
  const fresh = option.addElements.filter((e) => e.kind !== "arrow");
  const unfed = fresh.filter((n) => n.kind !== "actor" && !arrows.some((a) => a.toId === n.id));
  const blank = !elements.some((e) => e.kind !== "arrow" && e.kind !== "freedraw");
  for (const n of blank ? unfed.slice(1) : unfed) problems.push(`${n.label} has no input`);
  for (const cache of option.addElements.filter((e) => e.kind !== "arrow" && isCacheEl(e))) {
    const neighbours = arrows
      .filter((a) => a.fromId === cache.id || a.toId === cache.id)
      .map((a) => all.get(a.fromId === cache.id ? a.toId! : a.fromId!))
      .filter((x): x is JevElement => Boolean(x));
    if (neighbours.length > 0 && neighbours.every((n) => isStoreEl(n) || isCacheEl(n))) {
      problems.push(`cache ${cache.label} has no caller, only stores`);
    }
  }
  return problems;
}

/** A bigger option holds every node of the smaller one, so Tab only ever adds to the picture. */
/** The bigger option builds on the smaller one: each of its nodes is in the bigger option or already on the board. */
function containsNodesOf(bigger: PredictedAction, smaller: PredictedAction, elements: JevElement[]): boolean {
  const have = [...bigger.addElements, ...elements].filter((e) => e.kind !== "arrow");
  return smaller.addElements.filter((e) => e.kind !== "arrow").every((e) => have.some((h) => sameThing(h, e)));
}

/** The same two nodes get the same edge label in every option: the first option that names the edge wins. */
function harmonizeEdgeLabels(options: PredictedAction[], elements: JevElement[]): PredictedAction[] {
  const names = new Map<string, string>();
  return options.map((o) => {
    const byId = new Map([...elements, ...o.addElements].map((e) => [e.id, e]));
    const key = (a: JevElement) => `${norm(byId.get(a.fromId!)?.label ?? "")}>${norm(byId.get(a.toId!)?.label ?? "")}`;
    let changed = false;
    const addElements = o.addElements.map((e) => {
      if (e.kind !== "arrow" || !e.label) return e;
      const k = key(e);
      const seen = names.get(k);
      if (seen === undefined) {
        names.set(k, e.label);
        return e;
      }
      if (seen === e.label) return e;
      changed = true;
      return { ...e, label: seen };
    });
    return changed ? { ...o, addElements } : o;
  });
}

/** Swaps the Gateway LLM's names and structure into (b) and (c) when they keep the small-to-big order. */
export function refineOptionsWithGraphs(
  result: NextOptionsResult,
  elements: JevElement[],
  graphs: { cluster?: LlmOptionGraph | null; full?: LlmOptionGraph | null }
): NextOptionsResult {
  const request = result.request;
  if (!request || result.options.length < 3) return result;
  const anchor = result.context.anchorId ? elements.find((e) => e.id === result.context.anchorId) ?? null : null;
  const ctx: Context = {
    elements,
    anchor,
    viewportCenter: result.context.viewportCenter,
    selectedIds: result.context.selectedIds,
  };
  const [a, b, c] = result.options;
  const size = (o: PredictedAction) => o.nodeCount ?? 0;
  // The typed node (a) is its own thing, not the seed of (b): the LLM options build around it when they hold the
  // same component, and need not contain it otherwise ("URL Shortener" is not a node of its own HLD).
  const pinnedCtx = result.typed ? pinTypedNode(ctx, result.typed.node) : null;
  const builds = (candidate: PredictedAction) => Boolean(result.typed) || containsNodesOf(candidate, a, elements);
  const shape = (draft: Draft) => {
    const m = materializeAround(draft, ctx, pinnedCtx);
    const candidate = toOption(draft, m, m.pinned && pinnedCtx ? pinnedCtx : ctx);
    const sound =
      structureProblems({ ...candidate, addElements: [...candidate.addElements, ...m.dropped] }, elements).length === 0 &&
      builds(candidate);
    return { candidate, sound };
  };
  let nextB = b;
  let nextC = c;
  const dropLabel = request.trigger === "type" && !result.context.conceptKey ? result.context.conceptLabel : null;
  if (graphs.cluster && graphs.cluster.nodes.length > 0) {
    const { candidate, sound } = shape(llmDraft("cluster", graphs.cluster, b, elements, dropLabel));
    if (sound && size(candidate) > size(a) && size(candidate) <= 5 && size(candidate) >= size(b) - 1) nextB = candidate;
  }
  if (graphs.full && graphs.full.nodes.length > 0) {
    const { candidate, sound } = shape({ ...llmDraft("full", graphs.full, b, elements, dropLabel), title: c.title });
    if (sound && size(candidate) > size(nextB) && size(candidate) >= Math.max(5, size(c) - 3)) nextC = candidate;
  }
  if (nextC === c && size(c) <= size(nextB)) nextB = b;
  const options = harmonizeEdgeLabels([a, nextB, nextC], elements);
  return {
    ...result,
    options,
    request: {
      ...request,
      options: options.map((o) => ({ id: o.tier!, title: o.title.slice(0, 120), description: o.subtitle.slice(0, 140), nodes: o.nodeCount ?? 0 })),
      baseline: { ...request.baseline, edges: edgeLines(options[2], elements).slice(0, 20) },
    },
  };
}

export { OPTION_TIERS };

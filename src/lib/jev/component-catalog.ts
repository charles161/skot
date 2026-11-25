/**
 * What a node on the board is: the component catalog (Redis, Postgres, Kafka, ...) and the matchers every
 * generator uses to find the board node a proposed node already is, so nothing is drawn twice.
 */
import { isComponentShape, isLldKind, isShapeKind } from "./notation-kinds";
import type { ShapeKind } from "./types";

export interface LabeledNode {
  label: string;
  kind: string;
  sublabel?: string;
  morphMeta?: { notation: string };
}

export type Role = "client" | "edge" | "service" | "worker" | "queue" | "cache" | "store" | "storage" | "external";

export interface CatalogLink {
  key: string;
  edge: string;
  /** The link starts at whatever feeds the node (API -> cache in front of a DB), not at the node itself. */
  viaUpstream?: boolean;
}

export interface Component {
  key: string;
  label: string;
  sublabel: string;
  kind: ShapeKind;
  role: Role;
  aliases: string[];
  /** Ordered: the first two are the cluster companions, all of them the next steps when the node is selected. */
  links: CatalogLink[];
  /** Label for the arrow that leads into this component. */
  inbound: string;
  fullName: string;
}

const C = (
  key: string,
  label: string,
  sublabel: string,
  kind: ShapeKind,
  role: Role,
  aliases: string[],
  links: CatalogLink[],
  inbound: string,
  fullName = `${label} build-out`
): Component => ({ key, label, sublabel, kind, role, aliases, links, inbound, fullName });
const L = (key: string, edge: string, viaUpstream = false): CatalogLink => ({ key, edge, viaUpstream });

export const CATALOG: Component[] = [
  C("client_app", "Client App", "Browser / mobile", "actor", "client",
    ["client", "clientapp", "app", "webapp", "web", "frontend", "browser", "mobile", "mobileapp", "user", "users", "dashboard", "ui", "spa"],
    [L("api_gateway", "HTTPS"), L("cdn", "assets")], "uses", "web stack"),
  C("cdn", "CDN", "Edge cache", "lb", "edge", ["cdn", "edgecache", "cloudfront"],
    [L("object_storage", "origin pull"), L("api_gateway", "forwards")], "assets", "edge delivery"),
  C("load_balancer", "Load Balancer", "Round-robin", "lb", "edge", ["loadbalancer", "lb", "balancer", "nginx", "elb"],
    [L("core_service", "routes"), L("monitoring", "health checks")], "HTTPS", "load-balanced tier"),
  C("api_gateway", "API Gateway", "Routing, auth, rate limits", "lb", "edge", ["apigateway", "api", "gateway", "apigw", "gw"],
    [L("auth_service", "verify token"), L("core_service", "routes")], "HTTPS", "API backend"),
  C("rate_limiter", "Rate Limiter", "Token bucket", "node", "service", ["ratelimiter", "ratelimit", "throttle", "throttling"],
    [L("redis_cache", "counters")], "checks", "rate limiting"),
  C("auth_service", "Auth Service", "Sessions / JWT", "node", "service",
    ["auth", "authservice", "authentication", "login", "identity", "oauth", "sso"],
    [L("user_db", "users"), L("redis_cache", "sessions")], "verify", "auth stack"),
  C("core_service", "Core Service", "Business logic", "node", "service",
    ["service", "coreservice", "backend", "appserver", "server", "application"],
    [L("postgres", "SQL"), L("redis_cache", "read-through"), L("event_bus", "publishes")], "routes", "service backend"),
  C("order_service", "Order Service", "Coordinates the order", "node", "service", ["order", "orders", "orderservice"],
    [L("orders_db", "writes"), L("event_bus", "order events"), L("payment_service", "charges")], "creates order", "order flow"),
  C("payment_service", "Payment Service", "Charges + refunds", "node", "service",
    ["payment", "payments", "paymentservice", "billing"],
    [L("payment_provider", "charge"), L("ledger_db", "records")], "pays", "payments"),
  C("notification_service", "Notification Service", "Email / push", "node", "service",
    ["notification", "notifications", "notify", "notificationservice", "email", "push", "sms"],
    [L("delivery_queue", "enqueue"), L("email_provider", "sends")], "notifies", "notifications"),
  C("search_service", "Search Service", "Query + rank", "node", "service", ["search", "searchservice"],
    [L("search_index", "queries"), L("indexer", "reindex")], "searches", "search"),
  C("llm_service", "LLM Service", "Prompt + tools", "node", "service", ["llm", "ai", "model", "llmservice", "gpt", "agent"],
    [L("vector_db", "retrieves"), L("tool_router", "calls tools")], "prompts", "AI pipeline"),
  C("websocket_gateway", "WebSocket Gateway", "Live connections", "lb", "edge",
    ["websocket", "websockets", "ws", "socket", "realtime"],
    [L("core_service", "messages"), L("redis_cache", "presence")], "live socket", "realtime tier"),
  C("worker", "Worker", "Background jobs", "node", "worker", ["worker", "workers", "consumer", "job", "jobs", "cron"],
    [L("postgres", "writes"), L("dlq", "failed")], "consumes", "worker pool"),
  C("event_bus", "Event Bus", "Kafka / async", "queue", "queue",
    ["eventbus", "kafka", "queue", "events", "event", "bus", "pubsub", "broker", "messagequeue", "rabbitmq", "sqs", "stream"],
    [L("worker", "consumes"), L("analytics_warehouse", "streams")], "publishes", "event pipeline"),
  C("dlq", "Dead-letter Queue", "Retry later", "queue", "queue", ["dlq", "deadletter", "deadletterqueue"], [], "failed", "retries"),
  C("postgres", "Postgres DB", "Primary store", "database", "store",
    ["postgres", "postgresql", "db", "database", "sql", "primarydb", "mysql", "rds"],
    [L("read_replica", "replicates"), L("redis_cache", "read-through", true), L("backups", "snapshots"), L("cdc_stream", "change events"), L("failover_db", "fails over")],
    "SQL", "data tier"),
  C("failover_db", "Failover DB", "Other zone, promoted on failure", "database", "store", ["failover", "failoverdb"], [], "fails over"),
  C("read_replica", "Read Replica", "Low-latency reads", "database", "store", ["replica", "readreplica", "replicas"], [], "replicates"),
  C("redis_cache", "Redis Cache", "Hot keys", "cache", "cache", ["redis", "cache", "rediscache", "memcached"],
    [L("postgres", "on miss")], "read-through", "cache tier"),
  C("session_cache", "Session Cache", "Redis TTL", "cache", "cache", ["sessioncache", "sessions"], [], "sessions"),
  C("user_db", "User DB", "Accounts", "database", "store", ["userdb", "userstore", "accounts"], [], "users"),
  C("orders_db", "Orders DB", "Order records", "database", "store", ["ordersdb"], [], "writes"),
  C("ledger_db", "Ledger DB", "Double-entry", "database", "store", ["ledger", "ledgerdb"], [], "records"),
  C("backups", "Backups", "Snapshots in S3", "blob", "storage", ["backup", "backups", "snapshot", "snapshots"], [], "snapshots"),
  C("cdc_stream", "CDC Stream", "Change events", "queue", "queue", ["cdc", "changedatacapture", "debezium"],
    [L("analytics_warehouse", "loads")], "change events"),
  C("analytics_warehouse", "Analytics Warehouse", "Reporting", "database", "store",
    ["warehouse", "analytics", "olap", "bigquery", "snowflake", "clickhouse"], [], "loads"),
  C("object_storage", "Object Storage", "S3 / R2", "blob", "storage", ["s3", "blob", "objectstorage", "bucket", "storage", "r2", "files"],
    [], "stores"),
  C("search_index", "Search Index", "Inverted index", "database", "store", ["searchindex", "elasticsearch", "index", "opensearch"], [], "queries"),
  C("indexer", "Indexer Worker", "Keeps index fresh", "node", "worker", ["indexer"], [], "reindex"),
  C("vector_db", "Vector DB", "Embeddings", "database", "store", ["vectordb", "vector", "embeddings", "pinecone"], [], "retrieves"),
  C("tool_router", "Tool Router", "Function calls", "node", "service", ["toolrouter", "tools"], [], "calls tools"),
  C("payment_provider", "Payment Provider", "Stripe / PSP", "external", "external", ["stripe", "psp", "paymentprovider"], [], "charge"),
  C("email_provider", "Email Provider", "SES / SendGrid", "external", "external", ["ses", "sendgrid", "emailprovider"], [], "sends"),
  C("delivery_queue", "Delivery Queue", "Fan-out sends", "queue", "queue", ["deliveryqueue"], [L("worker", "consumes")], "enqueue"),
  C("monitoring", "Monitoring", "Metrics + alerts", "node", "service",
    ["monitoring", "metrics", "observability", "logging", "logs", "prometheus", "grafana"], [], "reports to"),
];
export const BY_KEY = new Map(CATALOG.map((c) => [c.key, c]));

/** Which roles naturally come next after a node of a role (client -> edge -> service -> data). */
export const NEXT_ROLES: Record<Role, Role[]> = {
  client: ["edge"],
  edge: ["service"],
  service: ["store", "cache", "queue", "external"],
  worker: ["store", "storage", "external"],
  queue: ["worker"],
  cache: ["store"],
  store: ["store", "cache", "storage"],
  storage: [],
  external: ["queue"],
};

const NORM_CACHE = new Map<string, string>();
const NORM_CACHE_MAX = 2048;

export const norm = (s: string): string => {
  const hit = NORM_CACHE.get(s);
  if (hit !== undefined) return hit;
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (NORM_CACHE.size >= NORM_CACHE_MAX) NORM_CACHE.clear();
  NORM_CACHE.set(s, out);
  return out;
};

export const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const EXACT_NAME_INDEX: Map<string, Component> = (() => {
  const map = new Map<string, Component>();
  for (const c of CATALOG) {
    const labelKey = norm(c.label);
    if (labelKey && !map.has(labelKey)) map.set(labelKey, c);
    for (const alias of c.aliases) {
      if (alias && !map.has(alias)) map.set(alias, c);
    }
  }
  return map;
})();

export function componentByExactName(label: string): Component | null {
  const n = norm(label);
  if (!n) return null;
  return EXACT_NAME_INDEX.get(n) ?? null;
}

/** What a board label is: the whole label first, then two-word phrases, then its words from the last (head noun). */
export function componentForLabel(label: string): Component | null {
  const exact = componentByExactName(label);
  if (exact) return exact;
  const ws = words(label);
  for (let i = ws.length - 2; i >= 0; i--) {
    const hit = componentByExactName(ws[i] + ws[i + 1]);
    if (hit) return hit;
  }
  for (let i = ws.length - 1; i >= 0; i--) {
    const hit = componentByExactName(ws[i]);
    if (hit) return hit;
  }
  return null;
}

/** The part a board node plays in the usual flow, or null when its name says nothing about it. */
export function roleOf(el: LabeledNode): Role | null {
  if (el.kind === "actor") return "client";
  return componentForLabel(el.label)?.role ?? null;
}

/** Same node by name, by catalog identity ("Postgres" is "Postgres DB"), or both being the client. */
export function sameThing(existing: LabeledNode, node: LabeledNode): boolean {
  if (norm(existing.label) === norm(node.label)) return true;
  const a = componentByExactName(existing.label);
  const b = componentByExactName(node.label);
  if (a && b && a.key === b.key) return true;
  // The primary database is whatever the board calls its database ("URL DB"), not a second "Postgres DB".
  if (b?.key === "postgres" && existing.kind === "database" && (!a || a.key === "postgres") && isPrimaryDbLabel(existing.label)) {
    return true;
  }
  return isClientish(node.label, node.kind) && isClientish(existing.label, existing.kind);
}

/** A client by shape, by exact name, or by its head noun ("Client Dashboard", "Web & Mobile"), not "Dashboard BFF". */
export function isClientish(label: string, kind: string): boolean {
  if (kind === "actor") return true;
  if (componentByExactName(label)?.role === "client") return true;
  const head = words(label).pop();
  return Boolean(head && componentByExactName(head)?.role === "client");
}

/** A database label that is not a replica, a warehouse, an index or a vector store ("URL DB", "Links"). */
function isPrimaryDbLabel(label: string): boolean {
  const head = componentForLabel(label);
  return !REPLICA_WORDS.test(label) && (!head || PRIMARY_DB_KEYS.has(head.key));
}

/** Roles a board normally has once: a second one is a duplicate, not a new idea. */
export type SingletonRole = "cache" | "primary_db" | "replica" | "edge";

const REPLICA_WORDS = /\b(replicas?|standby|follower|secondary)\b/i;
const EDGE_WORDS = /\b(cdn|gateway|load ?balancer|lb|ingress)\b/i;
const PRIMARY_DB_KEYS = new Set(["postgres", "user_db", "orders_db", "ledger_db"]);

/** An architecture component: not a note, card or container (isComponentShape), not an LLD shape or a decision, and
 * not part of a sequence, ER or state view that happens to share the label ("Redis" lifeline). */
function isComponent(node: LabeledNode): boolean {
  return (
    isShapeKind(node.kind) &&
    isComponentShape({ kind: node.kind }) &&
    !isLldKind(node.kind) &&
    node.kind !== "diamond" &&
    (!node.morphMeta || node.morphMeta.notation === "sketch")
  );
}

/** The singleton role of a node: "Read Cache" and "Redis" are both the cache, "Postgres DB" and "URL DB" the primary database. */
export function singletonRoleOf(node: LabeledNode): SingletonRole | null {
  if (!isComponent(node) || /\bshard/i.test(`${node.label} ${node.sublabel ?? ""}`)) return null;
  const comp = componentForLabel(node.label);
  if (comp?.key === "read_replica" || REPLICA_WORDS.test(node.label)) return "replica";
  if (node.kind === "cache" || comp?.role === "cache") return "cache";
  if (node.kind === "lb" || EDGE_WORDS.test(node.label)) return "edge";
  if (comp && PRIMARY_DB_KEYS.has(comp.key)) return "primary_db";
  return null;
}

/**
 * The board node a proposed node already is: the same thing by name or catalog identity first, then the one
 * board node with the same singleton role. Several candidates for a role: the one in `prefer` (the nodes wired to
 * what the user is working on) when exactly one is there, otherwise none, because guessing would merge two
 * different databases. Decisions only match a decision with the same question.
 */
export function findBoardCounterpart<T extends LabeledNode & { id: string }>(
  node: LabeledNode,
  candidates: T[],
  prefer: ReadonlySet<string> = new Set()
): T | null {
  if (node.kind === "diamond") {
    return candidates.find((c) => c.kind === "diamond" && !c.morphMeta && norm(c.label) === norm(node.label)) ?? null;
  }
  if (!isComponent(node)) return null;
  const shapes = candidates.filter(isComponent);
  const same = shapes.find((c) => sameThing(c, node));
  if (same) return same;
  const role = singletonRoleOf(node);
  if (!role) return null;
  const sameRole = shapes.filter((c) => singletonRoleOf(c) === role);
  if (sameRole.length === 1) return sameRole[0];
  const preferred = sameRole.filter((c) => prefer.has(c.id));
  return preferred.length === 1 ? preferred[0] : null;
}

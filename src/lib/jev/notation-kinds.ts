import {
  ARROW_ENDS,
  HLD_SHAPE_KINDS,
  LLD_SHAPE_KINDS,
  SHAPE_KINDS,
  type ArrowEnd,
  type ElementKind,
  type JevElement,
  type RenderStyle,
  type ShapeKind,
} from "./types";

const SHAPE_KIND_SET = new Set<string>(SHAPE_KINDS);
const LLD_KIND_SET = new Set<string>(LLD_SHAPE_KINDS);
const HLD_KIND_SET = new Set<string>(HLD_SHAPE_KINDS);
const ARROW_END_SET = new Set<string>(ARROW_ENDS);

export function isShapeKind(kind: string): kind is ShapeKind {
  return SHAPE_KIND_SET.has(kind);
}

export function isHldKind(kind: string): boolean {
  return HLD_KIND_SET.has(kind);
}

export function isLldKind(kind: string): boolean {
  return LLD_KIND_SET.has(kind);
}

export function isArrowEnd(value: unknown): value is ArrowEnd {
  return typeof value === "string" && ARROW_END_SET.has(value);
}

/** Notes, cards, containers and notation glyphs: on the board, but never a system component to suggest or link. */
const NON_COMPONENT_KINDS = new Set<string>(["frame", "zone", "text", "markdown", "card", "fragment", "activation", "initial", "final"]);

export function isComponentShape(el: Pick<JevElement, "kind">): boolean {
  return isShapeKind(el.kind) && !NON_COMPONENT_KINDS.has(el.kind);
}

/** Container kinds sit behind everything else and never take arrows by default. */
export function isContainerKind(kind: ElementKind): boolean {
  return kind === "frame" || kind === "zone" || kind === "fragment";
}

const LLD_ARROW_ENDS = new Set<ArrowEnd>([
  "triangle",
  "diamond",
  "odiamond",
  "er_one",
  "er_only_one",
  "er_zero_one",
  "er_many",
  "er_one_many",
  "er_zero_many",
]);

export function isCrowsFootEnd(end: ArrowEnd | undefined): boolean {
  return !!end && end.startsWith("er_");
}

/**
 * LLD notations (ER, UML class/sequence/state) read as engineering drawings, so they
 * render as clean vectors even on a sketch board. HLD shapes follow the board style.
 */
export function isLldElement(el: Pick<JevElement, "kind" | "startEnd" | "endEnd" | "morphMeta">): boolean {
  if (isLldKind(el.kind)) return true;
  if (el.kind === "arrow") {
    if ((el.startEnd && LLD_ARROW_ENDS.has(el.startEnd)) || (el.endEnd && LLD_ARROW_ENDS.has(el.endEnd))) {
      return true;
    }
  }
  const notation = el.morphMeta?.notation;
  return notation === "er" || notation === "sequence" || notation === "state";
}

export function resolveRenderStyle(
  el: Pick<JevElement, "kind" | "startEnd" | "endEnd" | "morphMeta">,
  boardStyle: RenderStyle
): RenderStyle {
  return isLldElement(el) ? "clean" : boardStyle;
}

/** Effective end markers, honouring legacy arrows (no explicit ends). */
export function resolveArrowEnds(
  el: Pick<JevElement, "startEnd" | "endEnd" | "bidirectional" | "morphMeta">
): { start: ArrowEnd; end: ArrowEnd } {
  if (el.morphMeta?.role === "lifeline") return { start: "none", end: "none" };
  return {
    start: el.startEnd ?? (el.bidirectional ? "arrow" : "none"),
    end: el.endEnd ?? "arrow",
  };
}

const ONE_TOKENS = new Set(["1", "one", "1..1"]);
const ZERO_ONE_TOKENS = new Set(["0..1", "0-1", "?", "zero or one", "optional"]);
const MANY_TOKENS = new Set(["n", "m", "*", "many", "0..*", "0..n", "0-n"]);
const ONE_MANY_TOKENS = new Set(["1..*", "1..n", "1-n", "+", "one or many", "1+"]);

function cardinalityTokenToEnd(token: string): ArrowEnd | null {
  const t = token.trim().toLowerCase();
  if (ONE_TOKENS.has(t)) return "er_only_one";
  if (ZERO_ONE_TOKENS.has(t)) return "er_zero_one";
  if (MANY_TOKENS.has(t)) return "er_zero_many";
  if (ONE_MANY_TOKENS.has(t)) return "er_one_many";
  return null;
}

/**
 * "1:N" style cardinality text → crow's-foot ends. Returns null for anything that
 * is not a cardinality, so ordinary labels ("reads", "1 min TTL") are left alone.
 */
export function cardinalityToEnds(text: string | undefined): { startEnd: ArrowEnd; endEnd: ArrowEnd } | null {
  if (!text) return null;
  const raw = text.trim().toLowerCase();
  if (!raw || raw.length > 24) return null;
  const words: Record<string, [string, string]> = {
    "one-to-one": ["1", "1"],
    "one to one": ["1", "1"],
    "one-to-many": ["1", "n"],
    "one to many": ["1", "n"],
    "many-to-one": ["n", "1"],
    "many to one": ["n", "1"],
    "many-to-many": ["n", "n"],
    "many to many": ["n", "n"],
  };
  const pair = words[raw] ?? (raw.includes(":") ? (raw.split(":") as [string, string]) : null);
  if (!pair || pair.length !== 2) return null;
  const startEnd = cardinalityTokenToEnd(pair[0]);
  const endEnd = cardinalityTokenToEnd(pair[1]);
  if (!startEnd || !endEnd) return null;
  return { startEnd, endEnd };
}

export interface EntityRow {
  name: string;
  type: string;
  keys: Array<"PK" | "FK" | "UK">;
}

/**
 * ER entity rows live in `sublabel`, one per line: `id uuid PK`, `user_id: uuid FK`,
 * `email text UK`. Key markers may appear anywhere on the line.
 */
export function parseEntityRows(sublabel: string | undefined): EntityRow[] {
  if (!sublabel) return [];
  return sublabel
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const keys: EntityRow["keys"] = [];
      let rest = line.replace(/\b(PK|FK|UK)\b[,]?/g, (m) => {
        const k = m.replace(",", "") as "PK" | "FK" | "UK";
        if (!keys.includes(k)) keys.push(k);
        return " ";
      });
      rest = rest.replace(/\s+/g, " ").trim();
      const [name = "", ...typeParts] = rest.replace(":", " ").split(/\s+/);
      return { name, type: typeParts.join(" "), keys };
    });
}

/** UML class compartments live in `sublabel`: attributes, a `--` line, then operations. */
export function parseClassCompartments(sublabel: string | undefined): { attributes: string[]; operations: string[] } {
  if (!sublabel) return { attributes: [], operations: [] };
  const lines = sublabel.split("\n").map((l) => l.trim());
  const sep = lines.findIndex((l) => /^-{2,}$/.test(l));
  const attrs = (sep === -1 ? lines : lines.slice(0, sep)).filter(Boolean);
  const ops = sep === -1 ? [] : lines.slice(sep + 1).filter(Boolean);
  if (sep === -1) {
    return {
      attributes: attrs.filter((l) => !/\(.*\)/.test(l)),
      operations: attrs.filter((l) => /\(.*\)/.test(l)),
    };
  }
  return { attributes: attrs, operations: ops };
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type ApiRowKey = "req" | "res" | "err" | "idem" | "note";

export interface ApiRow {
  key: ApiRowKey;
  title: string;
  text: string;
}

export interface ApiCard {
  method: HttpMethod | null;
  path: string;
  rows: ApiRow[];
}

const API_ROW_PREFIXES: Array<{ key: Exclude<ApiRowKey, "note">; title: string; re: RegExp }> = [
  { key: "req", title: "Request", re: /^(?:req|request)\s*:\s*/i },
  { key: "res", title: "Response", re: /^(?:res|resp|response)\s*:\s*/i },
  { key: "err", title: "Errors", re: /^(?:err|errs|error|errors)\s*:\s*/i },
  { key: "idem", title: "Idempotency key", re: /^(?:idem|idempotency(?:[- ]key)?)\s*:\s*/i },
];

/**
 * API card: `label` = "POST /orders" (method + path); `sublabel` lines prefixed `req:`, `res:`, `err:`,
 * `idem:` become labelled rows; any other line is kept as a note row.
 */
export function parseApiCard(label: string, sublabel: string | undefined): ApiCard {
  const head = label.trim().replace(/\s+/g, " ");
  const m = head.match(/^([A-Za-z]+)\s+(.*)$/);
  const verb = m?.[1].toUpperCase();
  const method = verb && (HTTP_METHODS as readonly string[]).includes(verb) ? (verb as HttpMethod) : null;
  const path = method ? m![2].trim() : head;
  const rows: ApiRow[] = (sublabel ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const prefix = API_ROW_PREFIXES.find((p) => p.re.test(line));
      return prefix
        ? { key: prefix.key, title: prefix.title, text: line.replace(prefix.re, "").trim() }
        : { key: "note" as const, title: "", text: line };
    });
  return { method, path, rows };
}

/** Note card bullets: one per sublabel line; a typed "-", "*" or "•" marker is dropped (the card draws its own). */
export function parseCardBullets(sublabel: string | undefined): string[] {
  if (!sublabel) return [];
  return sublabel
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

/** UML transition label: `event [guard] / action`. */
export function formatTransitionLabel(event: string, guard?: string, action?: string): string {
  let out = event.trim();
  if (guard && guard.trim()) out += ` [${guard.trim().replace(/^\[|\]$/g, "")}]`;
  if (action && action.trim()) out += ` / ${action.trim().replace(/^\//, "").trim()}`;
  return out;
}

export function parseTransitionLabel(label: string): { event: string; guard?: string; action?: string } {
  const m = label.match(/^\s*([^[/]*?)\s*(?:\[([^\]]*)\])?\s*(?:\/\s*(.*))?$/);
  if (!m) return { event: label.trim() };
  const event = (m[1] ?? "").trim();
  const guard = m[2]?.trim() || undefined;
  const action = m[3]?.trim() || undefined;
  return { event, ...(guard ? { guard } : {}), ...(action ? { action } : {}) };
}

/** Default box for a newly placed shape of each kind (world units). */
export const DEFAULT_KIND_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  node: { width: 160, height: 64 },
  diamond: { width: 140, height: 96 },
  database: { width: 132, height: 92 },
  ellipse: { width: 132, height: 76 },
  frame: { width: 360, height: 240 },
  text: { width: 160, height: 40 },
  markdown: { width: 320, height: 220 },
  queue: { width: 176, height: 64 },
  cache: { width: 140, height: 76 },
  lb: { width: 132, height: 76 },
  blob: { width: 120, height: 92 },
  external: { width: 160, height: 68 },
  actor: { width: 72, height: 104 },
  zone: { width: 420, height: 280 },
  entity: { width: 200, height: 136 },
  class: { width: 200, height: 148 },
  activation: { width: 14, height: 120 },
  fragment: { width: 360, height: 180 },
  initial: { width: 26, height: 26 },
  final: { width: 30, height: 30 },
  card: { width: 240, height: 132 },
  api: { width: 280, height: 128 },
};

export const KIND_LABELS: Record<ShapeKind, string> = {
  node: "Service",
  diamond: "Decision",
  database: "Database",
  ellipse: "Actor (oval)",
  frame: "Frame",
  text: "Text",
  markdown: "Markdown",
  queue: "Queue / stream",
  cache: "Cache",
  lb: "Load balancer / CDN",
  blob: "Blob store",
  external: "External system",
  actor: "User",
  zone: "Zone / boundary",
  entity: "ER entity",
  class: "UML class",
  activation: "Activation bar",
  fragment: "Fragment (alt/loop/opt)",
  initial: "Initial state",
  final: "Final state",
  card: "Note card",
  api: "API card",
};

interface KindRule {
  kind: ShapeKind;
  re: RegExp;
}

/**
 * Text → shape kind for HLD components. Order matters: the most specific family wins
 * (an "S3 cache" is a cache sitting in front of S3, so cache rules run before blob).
 */
const KIND_RULES: KindRule[] = [
  { kind: "external", re: /\bpayment[- ]?gateway\b/ },
  { kind: "queue", re: /\b(kafka|sqs|sns|rabbit\s?mq|rabbit|kinesis|pub\s?\/?\s?sub|pubsub|nats|event\s?bus|message\s?bus|queue|topic|stream|broker|dlq|dead[- ]letter|celery|eventbridge)\b/ },
  { kind: "cache", re: /\b(redis|memcached?|cache|caching|valkey|elasticache|dragonfly|hot\s?keys?)\b/ },
  { kind: "lb", re: /\b(nginx|haproxy|envoy|alb|elb|nlb|load\s?balancer|lb|cdn|cloudfront|akamai|fastly|cloudflare|edge|reverse\s?proxy|ingress|api\s?gateway|gateway)\b/ },
  { kind: "blob", re: /\b(s3|gcs|r2|blob|bucket|object\s?(store|storage)|media\s?store|file\s?store|azure\s?storage)\b/ },
  { kind: "external", re: /\b(stripe|paypal|twilio|sendgrid|apns|fcm|firebase|auth0|okta|google\s?maps|third[- ]party|3rd[- ]party|external|partner|webhook|bank|psp)\b/ },
  { kind: "actor", re: /^(user|users|client( app)?|(web|mobile|desktop) client|web (&|and) mobile|customer|visitor|browser|mobile( app)?|admin|driver|rider|seller|buyer|sender|recipient|end user)s?$/ },
  { kind: "database", re: /\b(db|database|postgres(ql)?|mysql|mongo(db)?|sqlite|dynamo(db)?|cassandra|spanner|cockroach(db)?|sql|table|ledger|warehouse|clickhouse|replica|vector\s?db|elastic(search)?|index)\b/ },
];

/**
 * Infer the HLD shape kind a label names, or null when nothing matches (callers keep
 * their own default: usually "node").
 */
export function inferShapeKindFromLabel(label: string): ShapeKind | null {
  const l = label.toLowerCase().trim();
  if (!l) return null;
  for (const rule of KIND_RULES) {
    if (rule.re.test(l)) return rule.kind;
  }
  return null;
}

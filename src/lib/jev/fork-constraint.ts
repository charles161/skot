import { z } from "zod";

export const FORK_PRESSURES = ["latency", "cost", "consistency", "scale", "availability"] as const;
export type ForkPressure = (typeof FORK_PRESSURES)[number];

export const FORK_PRESSURE_LABELS: Record<ForkPressure, string> = {
  latency: "Latency",
  cost: "Cost",
  consistency: "Consistency",
  scale: "Scale",
  availability: "Availability",
};

export const FORK_COST_AXES = ["latency", "money", "consistency", "complexity", "ops"] as const;
export type ForkCostAxis = (typeof FORK_COST_AXES)[number];

export const FORK_PATTERN_IDS = [
  "cache_aside",
  "cdn_edge",
  "read_replicas",
  "fanout_on_write",
  "regional_deploy",
  "sharding",
  "queue_workers",
  "fanout_on_read",
  "single_leader_sync",
  "outbox_cdc",
  "idempotency_saga",
  "serverless_batch",
  "tiered_storage",
  "autoscale",
  "multi_az_lb",
  "circuit_breaker_fallback",
  "queue_buffering",
] as const;
export type ForkPatternId = (typeof FORK_PATTERN_IDS)[number];

const CONSISTENCY_LEVELS = ["strong", "read-your-writes", "causal", "eventual"] as const;

export const forkTargetSchema = z
  .object({
    metric: z.string().trim().min(1).max(32),
    comparator: z.enum(["<", "<=", ">", ">=", "="]).optional(),
    value: z.number().finite().nonnegative().optional(),
    unit: z.string().trim().max(16).optional(),
    level: z.enum(CONSISTENCY_LEVELS).optional(),
    text: z.string().trim().min(1).max(64),
  })
  .strict();
export type ForkTarget = z.infer<typeof forkTargetSchema>;

export const forkConstraintSchema = z
  .object({
    pressure: z.enum(FORK_PRESSURES),
    target: forkTargetSchema.optional(),
    text: z.string().trim().max(120).optional(),
  })
  .strict();
export type ForkConstraint = z.infer<typeof forkConstraintSchema>;

export const forkCostLineSchema = z
  .object({
    axis: z.enum(FORK_COST_AXES),
    text: z.string().trim().min(2).max(80),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strip();
export type ForkCostLine = z.infer<typeof forkCostLineSchema>;

/** Exactly one line per cost axis, in FORK_COST_AXES order. */
export const forkCostLinesSchema = z
  .array(forkCostLineSchema)
  .length(FORK_COST_AXES.length)
  .refine((lines) => new Set(lines.map((l) => l.axis)).size === FORK_COST_AXES.length, {
    message: "costs must cover latency, money, consistency, complexity and ops once each",
  })
  .transform((lines) => FORK_COST_AXES.map((axis) => lines.find((l) => l.axis === axis)!));

export interface ForkTradeoffs {
  pressure: ForkPressure;
  buys: string;
  costs: ForkCostLine[];
  failureMode: string;
}

const MAGNITUDE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  billion: 1e9,
};

const SECONDS_PER: Record<string, number> = {
  "/s": 1,
  "/min": 60,
  "/hour": 3600,
  "/day": 86400,
  "/month": 30 * 86400,
};

function normaliseComparator(raw: string | undefined): ForkTarget["comparator"] {
  if (!raw) return undefined;
  const r = raw.trim();
  if (r === "<" || r === "under" || r === "below" || r === "less than" || r === "within") return "<";
  if (r === "<=" || r === "≤" || r === "at most" || r === "max") return "<=";
  if (r === ">") return ">";
  if (r === ">=" || r === "≥" || r === "at least") return ">=";
  if (r === "=") return "=";
  return undefined;
}

function rateUnit(raw: string): string {
  const r = raw.toLowerCase();
  if (/^(s|sec|second)$/.test(r)) return "/s";
  if (/^(min|minute)$/.test(r)) return "/min";
  if (/^(h|hr|hour)$/.test(r)) return "/hour";
  if (/^(d|day)$/.test(r)) return "/day";
  return "/month";
}

function scaleMetric(raw: string | undefined): string {
  const r = (raw ?? "").toLowerCase();
  if (/^(write|wps)/.test(r)) return "writes";
  if (/^read/.test(r)) return "reads";
  if (/^(event)/.test(r)) return "events";
  if (/^(message|msg)/.test(r)) return "messages";
  if (/^(user|dau|mau)/.test(r)) return "users";
  if (/^order/.test(r)) return "orders";
  if (/^upload/.test(r)) return "uploads";
  return "requests";
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

function parseAvailability(text: string): ForkTarget | null {
  const nines: Record<string, number> = { three: 99.9, four: 99.99, five: 99.999 };
  const named = text.match(/\b(three|four|five)\s+nines\b/);
  if (named) {
    const value = nines[named[1]];
    return { metric: "uptime", comparator: ">=", value, unit: "%", text: `${formatNumber(value)}%` };
  }
  const pct = text.match(/(\d{2}(?:\.\d+)?)\s*%/);
  if (!pct) return null;
  const value = Number(pct[1]);
  if (value < 90 || value > 100) return null;
  return { metric: "uptime", comparator: ">=", value, unit: "%", text: `${pct[1]}%` };
}

function parseCost(text: string): ForkTarget | null {
  const m = text.match(
    /\$\s*(\d+(?:\.\d+)?)\s*(k|m)?\s*(?:(?:\/|per|a)\s*(mo|month|yr|year|day|d)\b)?/
  );
  if (!m) return null;
  let value = Number(m[1]) * (m[2] ? MAGNITUDE[m[2]] : 1);
  const period = m[3] ?? "mo";
  if (period === "yr" || period === "year") value /= 12;
  if (period === "day" || period === "d") value *= 30;
  value = Math.round(value * 100) / 100;
  return { metric: "budget", comparator: "<=", value, unit: "USD/mo", text: `$${formatNumber(value)}/mo` };
}

function parseConsistency(text: string): ForkTarget | null {
  let level: ForkTarget["level"] | null = null;
  if (/\b(strong(ly)?\s+consisten\w*|linearizab\w*|serializab\w*)/.test(text)) level = "strong";
  else if (/\bread[- ]your[- ](own[- ])?writes?\b/.test(text)) level = "read-your-writes";
  else if (/\bcausal(ly)?\b/.test(text)) level = "causal";
  else if (/\beventual(ly)?\b/.test(text)) level = "eventual";
  if (!level) return null;
  return {
    metric: "consistency",
    level,
    text: level === "read-your-writes" ? "read-your-writes" : `${level} consistency`,
  };
}

function parseScale(text: string): ForkTarget | null {
  const perSecond = text.match(/(\d+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\s*(rps|qps|wps|tps)\b/);
  if (perSecond) {
    const value = Number(perSecond[1]) * (perSecond[2] ? MAGNITUDE[perSecond[2]] : 1);
    const metric = perSecond[3] === "wps" ? "writes" : "requests";
    return { metric, value, unit: "/s", text: `${perSecond[1]}${(perSecond[2] ?? "").toUpperCase().slice(0, 1)} ${perSecond[3]}` };
  }
  const rate = text.match(
    /(\d+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\s*(writes?|reads?|requests?|reqs?|events?|messages?|msgs?|users?|dau|mau|orders?|uploads?)?\s*(?:\/|per|a)\s*(s|sec|second|min|minute|h|hr|hour|d|day|mo|month)\b/
  );
  if (rate && (rate[3] || rate[2])) {
    const value = Number(rate[1]) * (rate[2] ? MAGNITUDE[rate[2]] : 1);
    const unit = rateUnit(rate[4]);
    const metric = scaleMetric(rate[3]);
    const mag = rate[2] ? (rate[2].length === 1 ? rate[2].toUpperCase() : ` ${rate[2]}`) : "";
    return { metric, value, unit, text: `${rate[1]}${mag} ${metric}${unit}` };
  }
  const users = text.match(/(\d+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)\s*(dau|mau|users)\b/);
  if (users) {
    const value = Number(users[1]) * MAGNITUDE[users[2]];
    const unit = users[3] === "mau" ? "/month" : "/day";
    return { metric: "users", value, unit, text: `${users[1]}${users[2].toUpperCase().slice(0, 1)} ${users[3]}` };
  }
  return null;
}

function parseLatency(text: string): ForkTarget | null {
  const m = text.match(
    /(?:\b(p\d{2,3}|latency|response(?:\s+time)?)\s*)?(<=|>=|<|>|≤|≥|=|under|below|less than|within|at most)?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)(?![\w/])/
  );
  if (!m) return null;
  const metric = m[1]?.startsWith("p") ? m[1] : "latency";
  const comparator = normaliseComparator(m[2]) ?? (m[1] ? "<" : undefined);
  const seconds = /^s/.test(m[4]);
  const value = Number(m[3]) * (seconds ? 1000 : 1);
  const cmpText = comparator ? ` ${comparator} ` : " ";
  return {
    metric,
    ...(comparator ? { comparator } : {}),
    value,
    unit: "ms",
    text: `${metric}${cmpText}${formatNumber(value)} ms`,
  };
}

const PRESSURE_KEYWORDS: Array<[ForkPressure, RegExp]> = [
  ["consistency", /\b(consisten\w*|correct\w*|exactly[- ]once|double[- ]charg\w*|duplicate\w*|atomic\w*)/],
  ["availability", /\b(uptime|availab\w*|outage\w*|resilien\w*|failover|downtime|fault[- ]toleran\w*|nines)\b/],
  ["cost", /\b(cheap\w*|cost\w*|budget\w*|money|spend\w*|bill\w*|expensive)\b/],
  ["scale", /\b(scal\w*|throughput|traffic|growth|load|spike\w*|viral|millions?)\b/],
  ["latency", /\b(latency|fast\w*|slow\w*|snappy|speed\w*|lag\w*|p\d{2,3})\b/],
];

/** Parses free text such as "p99 < 100 ms", "10M writes/day", "$500/mo", "99.99%" or "strong consistency". */
export function parseForkConstraint(input: string): ForkConstraint | null {
  const raw = input.trim().slice(0, 120);
  if (!raw) return null;
  const text = raw.toLowerCase();
  const parsers: Array<[ForkPressure, (t: string) => ForkTarget | null]> = [
    ["availability", parseAvailability],
    ["cost", parseCost],
    ["consistency", parseConsistency],
    ["scale", parseScale],
    ["latency", parseLatency],
  ];
  for (const [pressure, parse] of parsers) {
    const target = parse(text);
    if (target) return { pressure, target, text: raw };
  }
  for (const [pressure, re] of PRESSURE_KEYWORDS) {
    if (re.test(text)) return { pressure, text: raw };
  }
  return null;
}

/** Average rate of a scale target in events per second, or null when the target is not a rate. */
export function targetPerSecond(target: ForkTarget): number | null {
  if (target.value === undefined || !target.unit) return null;
  const secs = SECONDS_PER[target.unit];
  return secs ? target.value / secs : null;
}

export function describeForkConstraint(c: ForkConstraint): string {
  const label = FORK_PRESSURE_LABELS[c.pressure];
  return c.target ? `${label} · ${c.target.text}` : label;
}

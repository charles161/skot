import { z } from "zod";
import { logServerEvent } from "@/lib/server/logger";
import {
  parseSemanticGraphJson,
  SEMANTIC_KIND_HINTS,
  SEMANTIC_NODE_KINDS,
  type SemanticGraph,
} from "@/lib/jev/semantic-graph";
import { ARROW_ENDS } from "@/lib/jev/types";
import {
  validateForkTakesPayload,
  type ForkTakeSpec,
} from "@/lib/jev/fork-engine";
import { FORK_COST_AXES, FORK_PATTERN_IDS, type ForkConstraint } from "@/lib/jev/fork-constraint";
import {
  constrainMorphSpecToSelection,
  validateMorphSemanticSpec,
  type MorphNotation,
  type MorphSemanticSpec,
} from "@/lib/jev/notation-morph";
import { getPracticePrompt, type PracticePromptId } from "@/lib/jev/practice-prompts";
import { MAX_COMMENT_CHARS, MAX_COMMENTS, type AiReviewComment } from "@/lib/jev/practice-review";
import {
  contextSuggestionSchema,
  type ContextSuggestion,
  type RankingContext,
} from "@/lib/jev/prediction-engine";

/**
 * Server-side client for the Vercel AI Gateway's OpenAI-compatible Chat Completions API.
 * Docs: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions
 * Auth: https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc
 */
export const AI_GATEWAY_CHAT_COMPLETIONS_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
export const DEFAULT_AI_GATEWAY_MODEL = "openai/gpt-4.1-mini";
const HAIKU_MODEL = "anthropic/claude-haiku-5.5";

/**
 * The model each gateway route uses, pinned by a unit test. Haiku won the 22 Nov 2026 model eval on the short-output
 * routes; next_options, Fork and generate_graph stay on gpt-4.1-mini because Haiku overruns their length caps.
 * Env overrides: AI_GATEWAY_MODEL_<ROUTE> (e.g. AI_GATEWAY_MODEL_MORPH) for one route, AI_GATEWAY_MODEL for all.
 */
export const LLM_ROUTE_MODELS = {
  context: HAIKU_MODEL,
  practice_review: HAIKU_MODEL,
  moves: HAIKU_MODEL,
  morph: HAIKU_MODEL,
  next_options: DEFAULT_AI_GATEWAY_MODEL,
  fork: DEFAULT_AI_GATEWAY_MODEL,
  generate_graph: DEFAULT_AI_GATEWAY_MODEL,
} as const satisfies Record<string, string>;

export type LlmRoute = keyof typeof LLM_ROUTE_MODELS;
const LLM_TIMEOUT_MS = 6500;
/** Three full graphs with trade-offs take gpt-4.1-mini ~8-15 s through the gateway. */
const FORK_TIMEOUT_MS = 25000;

const KIND_UNION = SEMANTIC_NODE_KINDS.map((k) => `"${k}"`).join("|");
const END_UNION = ARROW_ENDS.map((e) => `"${e}"`).join("|");
const TONE_UNION = '"ink"|"terracotta"|"cobalt"|"teal"|"ochre"|"plum"|"slate"';
const KIND_GUIDE = `Kinds: ${SEMANTIC_NODE_KINDS.map((k) => `${k}=${SEMANTIC_KIND_HINTS[k]}`).join("; ")}.`;
const END_GUIDE =
  "Edge ends (optional): er_* = crow's-foot cardinality on ER relations (er_only_one, er_zero_many, ...), triangle = inheritance, diamond = composition, odiamond = aggregation, open = async or return.";

const GRAPH_SYSTEM_PROMPT = `Return ONLY valid JSON matching {"notation":"architecture"|"flowchart"|"sequence"|"state"|"er","summary":string,"nodes":[{"id":string,"label":string,"sublabel"?:string,"kind":${KIND_UNION},"tone"?:${TONE_UNION},"layer"?:number}],"edges":[{"from":string,"to":string,"label"?:string,"dashed"?:boolean,"bidirectional"?:boolean,"startEnd"?:${END_UNION},"endEnd"?:${END_UNION}}],"groups"?:[{"id":string,"label":string,"nodeIds":string[]}]}. ${KIND_GUIDE} ${END_GUIDE} Use groups for regions, VPCs and trust zones. Keep graphs crisp (2-10 nodes).`;

const FORK_SYSTEM_PROMPT = `Return ONLY valid JSON matching {"takes":[{"archetype":"queue_event_driven"|"cache_read_replica"|"gateway_edge_split"|"resilient_mesh","title":string,"rationale":string,"tradeoffTag":string,"graph":{"notation":"architecture","summary":string,"nodes":[{"id":string,"label":string,"sublabel"?:string,"kind":${KIND_UNION},"tone"?:${TONE_UNION}}],"edges":[{"from":string,"to":string,"label"?:string,"dashed"?:boolean}],"groups"?:[{"id":string,"label":string,"nodeIds":string[]}]}}]}. Draw queues, caches, load balancers/CDNs, blob stores, third-party systems and users with their kinds (queue, cache, lb, blob, external, actor). Produce EXACTLY 3 genuinely distinct architectural refactors tailored to the selected nodes. Anything boardGraph already has (its cache, its database, its gateway) is that node: use its exact label instead of adding a second one.`;
const COST_AXIS_UNION = FORK_COST_AXES.map((a) => `"${a}"`).join("|");
const FORK_CONSTRAINT_PROMPT = `${FORK_SYSTEM_PROMPT} The user stated a pressure in "constraint" (pressure, optional target). Make all 3 takes answer it, ranked best first, using real patterns (archetype one of ${FORK_PATTERN_IDS.map((id) => `"${id}"`).join("|")}). Each take MUST also have "buys":string (what it buys against the stated number, phrased as a typical range and marked typical, e.g. "p99 read ≈ 5-20 ms on cache hit vs 50-150 ms DB (typical)"), "costs":[{"axis":${COST_AXIS_UNION},"text":string (under 60 chars),"severity":1|2|3}] with exactly one entry per axis, and "failureMode":string (the new failure mode the take introduces).`;
const CONTEXT_TIMEOUT_MS = 2500;

export interface GatewayAuth {
  token: string;
  method: "api-key" | "oidc";
}

/**
 * AI_GATEWAY_API_KEY wins (the gateway itself gives a key precedence over OIDC). On a Vercel
 * deployment the OIDC token arrives per request in x-vercel-oidc-token and rotates within the hour,
 * so it is read from the request every time; the header is only trusted when VERCEL=1, otherwise a
 * caller could supply its own. VERCEL_OIDC_TOKEN is what `vercel env pull` writes for local runs.
 */
export function resolveGatewayAuth(source: {
  env?: Record<string, string | undefined>;
  oidcHeader?: string | null;
}): GatewayAuth | null {
  const env = source.env ?? process.env;
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (apiKey) return { token: apiKey, method: "api-key" };
  const header = env.VERCEL === "1" ? source.oidcHeader?.trim() : undefined;
  if (header) return { token: header, method: "oidc" };
  const envOidc = env.VERCEL_OIDC_TOKEN?.trim();
  if (envOidc) return { token: envOidc, method: "oidc" };
  return null;
}

function gatewayModel(route: LlmRoute): string {
  return (
    process.env[`AI_GATEWAY_MODEL_${route.toUpperCase()}`]?.trim() ||
    process.env.AI_GATEWAY_MODEL?.trim() ||
    LLM_ROUTE_MODELS[route]
  );
}

const chatCompletionSchema = z.object({
  model: z.string().min(1).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().min(1),
        }),
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

export async function requestStructuredJsonFromLlm(params: {
  auth: GatewayAuth;
  route: LlmRoute;
  systemPrompt: string;
  userPayload: Record<string, unknown>;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<{
  content: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
} | null> {
  const model = gatewayModel(params.route);
  const startedAt = performance.now();
  const elapsed = () => Math.max(1, Math.round(performance.now() - startedAt));

  let res: Response;
  try {
    res = await fetch(AI_GATEWAY_CHAT_COMPLETIONS_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${params.auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        // Every route is a capped JSON answer: hidden reasoning would spend max_tokens before the JSON starts.
        // The gateway accepts this for non-reasoning models too (gpt-4.1-mini ignores it).
        reasoning_effort: "none",
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: JSON.stringify(params.userPayload) },
        ],
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? LLM_TIMEOUT_MS),
    });
  } catch (err) {
    const errName =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: unknown }).name)
        : "Error";
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "upstream_fetch_failed",
      errorClass: errName,
      latencyMs: elapsed(),
    });
    return null;
  }

  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      // ignore stream cancel errors
    }
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "upstream_http_error",
      upstreamStatus: res.status,
      latencyMs: elapsed(),
    });
    return null;
  }

  let rawJson: unknown;
  try {
    rawJson = await res.json();
  } catch {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "upstream_json_parse_failed",
      latencyMs: elapsed(),
    });
    return null;
  }

  const parsed = chatCompletionSchema.safeParse(rawJson);
  if (!parsed.success) {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "upstream_schema_mismatch",
      latencyMs: elapsed(),
    });
    return null;
  }

  return {
    content: parsed.data.choices[0].message.content,
    model: parsed.data.model ?? model,
    latencyMs: elapsed(),
    inputTokens: parsed.data.usage?.prompt_tokens,
  };
}

/**
 * Generates a Zod-validated SemanticGraph from an upstream JSON-capable LLM when configured.
 * Returns null on any error or schema failure so callers safely fall back.
 */
export async function generateSemanticGraphWithLlm(params: {
  auth: GatewayAuth;
  prompt: string;
  boardGraph?: Record<string, unknown>;
  preferenceSummary?: Record<string, unknown> | null;
}): Promise<{
  graph: SemanticGraph;
  model: string;
  latencyMs: number;
  inputTokens?: number;
} | null> {
  const result = await requestStructuredJsonFromLlm({
    auth: params.auth,
    route: "generate_graph",
    systemPrompt: GRAPH_SYSTEM_PROMPT,
    userPayload: {
      task: "generate_semantic_graph",
      prompt: params.prompt,
      ...(params.boardGraph ? { boardGraph: params.boardGraph } : {}),
      ...(params.preferenceSummary
        ? { preferenceSummary: params.preferenceSummary }
        : {}),
    },
  });
  if (!result) return null;

  const validated = parseSemanticGraphJson(result.content);
  if (!validated.ok) {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "semantic_graph_validation_failed",
      latencyMs: result.latencyMs,
    });
    return null;
  }

  return {
    graph: validated.graph,
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
  };
}

/**
 * Generates 3 Zod-validated distinct architectural Fork takes for the selected subgraph via LLM.
 * Returns null on any error or schema failure so callers safely fall back.
 */
export async function generateForkTakesWithLlm(params: {
  auth: GatewayAuth;
  selectedIds: string[];
  boardGraph: Record<string, unknown>;
  preferenceSummary?: Record<string, unknown> | null;
  constraint?: ForkConstraint | null;
}): Promise<{
  takes: ForkTakeSpec[];
  model: string;
  latencyMs: number;
  inputTokens?: number;
} | null> {
  const result = await requestStructuredJsonFromLlm({
    auth: params.auth,
    route: "fork",
    systemPrompt: params.constraint ? FORK_CONSTRAINT_PROMPT : FORK_SYSTEM_PROMPT,
    userPayload: {
      task: "fork_architecture",
      selectedIds: params.selectedIds,
      boardGraph: params.boardGraph,
      ...(params.preferenceSummary
        ? { preferenceSummary: params.preferenceSummary }
        : {}),
      ...(params.constraint ? { constraint: params.constraint } : {}),
    },
    timeoutMs: FORK_TIMEOUT_MS,
  });
  if (!result) return null;

  let decoded: unknown;
  try {
    const trimmed = result.content.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : trimmed;
    decoded = JSON.parse(body);
  } catch {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "fork_json_parse_failed",
      latencyMs: result.latencyMs,
    });
    return null;
  }

  const validated = validateForkTakesPayload(decoded, { constraint: params.constraint });
  if (!validated.ok) {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "fork_takes_validation_failed",
      latencyMs: result.latencyMs,
    });
    return null;
  }

  return {
    takes: validated.takes,
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
  };
}

export function parseJsonBody(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : trimmed;
  return JSON.parse(body);
}

/**
 * Refines a MorphSemanticSpec via structured JSON LLM for reversible Notation Morph.
 * Returns null on any upstream error or Zod validation failure so callers safely fall back.
 */
export async function generateMorphSpecWithLlm(params: {
  auth: GatewayAuth;
  targetNotation: MorphNotation;
  selectedIds: string[];
  boardGraph: Record<string, unknown>;
  currentSpec?: MorphSemanticSpec;
  /** The selection's participants and drawn arrows; the refined spec may not add messages beyond them. */
  selection: Pick<MorphSemanticSpec, "actors" | "messages">;
}): Promise<{
  spec: MorphSemanticSpec;
  model: string;
  latencyMs: number;
  inputTokens?: number;
} | null> {
  const result = await requestStructuredJsonFromLlm({
    auth: params.auth,
    route: "morph",
    systemPrompt:
      'Return ONLY valid JSON matching {"summary":string,"actors":[{"id":string,"label":string,"kind"?:"node"|"database"|"queue"|"cache"|"lb"|"blob"|"external"|"actor"|"class"|"ellipse","tone"?:"ink"|"terracotta"|"cobalt"|"teal"|"ochre"|"plum"|"slate"}],"messages":[{"id":string,"from":string,"to":string,"label":string,"order":number,"async"?:boolean,"isReturn"?:boolean}],"fragments"?:[{"id":string,"operator":"alt"|"loop"|"opt","guard":string,"fromOrder":number,"toOrder":number,"elseFromOrder"?:number,"elseGuard"?:string}],"steps":[{"id":string,"label":string,"kind":"start"|"process"|"decision"|"end","tone"?:string,"branches"?:[{"to":string,"label"?:string,"fallback"?:boolean}]}],"states":[{"id":string,"label":string,"initial"?:boolean,"terminal"?:boolean,"tone"?:string}],"transitions":[{"id":string,"from":string,"to":string,"event":string,"guard"?:string,"action"?:string,"fallback"?:boolean}],"entities":[{"id":string,"name":string,"attributes":string[],"tone"?:string}],"relations":[{"id":string,"from":string,"to":string,"cardinality":string,"label"?:string}]}. UML rules: messages are exactly the arrows drawn between selected nodes, one message per arrow; never add a message, a return or a participant that is not drawn (isReturn only marks a drawn arrow back to its caller); fragments cover message orders fromOrder..toOrder (only alt sets elseFromOrder/elseGuard, inside that range); transition guard is the condition without brackets, action is the effect; entity attributes are rows like "id uuid PK" and "user_id uuid FK"; cardinality is "1:1", "1:N", "N:1" or "N:M". Keep semantic IDs aligned with the selected nodes so round-tripping preserves edits.',
    userPayload: {
      task: "morph_notation",
      targetNotation: params.targetNotation,
      selectedIds: params.selectedIds,
      boardGraph: params.boardGraph,
      ...(params.currentSpec ? { currentSpec: params.currentSpec } : {}),
    },
  });
  if (!result) return null;

  let decoded: unknown;
  try {
    decoded = parseJsonBody(result.content);
  } catch {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "morph_json_parse_failed",
      latencyMs: result.latencyMs,
    });
    return null;
  }

  const validated = validateMorphSemanticSpec(decoded);
  if (!validated.ok) {
    logServerEvent("warn", {
      route: "ai-gateway",
      event: "morph_spec_validation_failed",
      latencyMs: result.latencyMs,
    });
    return null;
  }

  return {
    spec: constrainMorphSpecToSelection(validated.spec, params.selection),
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
  };
}

const contextProposalSchema = z.object({
  suggestions: z
    .array(contextSuggestionSchema.omit({ id: true }).strict())
    .min(1),
});

/**
 * Proposes 1-2 context-named next nodes (label, shape, relation) for the selected node from its own
 * label, its neighbours' labels and the board title. Small and fast: short timeout and token cap.
 */
export async function proposeContextNodesWithLlm(params: {
  auth: GatewayAuth;
  context: RankingContext;
}): Promise<{
  suggestions: ContextSuggestion[];
  model: string;
  latencyMs: number;
  inputTokens?: number;
} | null> {
  const result = await requestStructuredJsonFromLlm({
    auth: params.auth,
    route: "context",
    timeoutMs: CONTEXT_TIMEOUT_MS,
    maxTokens: 200,
    systemPrompt:
      'You suggest the next component to add on a system-design whiteboard. Return ONLY JSON {"suggestions":[{"label":string (2-4 words, specific to this board, max 40 chars),"sublabel"?:string (max 48 chars),"kind":"node"|"diamond"|"database"|"ellipse","edgeLabel"?:string (verb, max 24 chars)}]} with 1 or 2 items. Name components after what is on the board (e.g. after "Checkout" and "Error Handler": "Payment Retry Queue"). Never use generic names like "Next Step", "Decision?" or "Data Store", and never repeat a label already on the board.',
    userPayload: {
      task: "propose_next_nodes",
      selected: params.context.subjectLabel,
      neighbours: params.context.neighborLabels,
      ...(params.context.boardTitle ? { boardTitle: params.context.boardTitle } : {}),
    },
  });
  if (!result) return null;

  let decoded: unknown;
  try {
    decoded = parseJsonBody(result.content);
  } catch {
    logServerEvent("warn", { route: "ai-gateway", event: "context_json_parse_failed", latencyMs: result.latencyMs });
    return null;
  }
  const validated = contextProposalSchema.safeParse(decoded);
  if (!validated.success) {
    logServerEvent("warn", { route: "ai-gateway", event: "context_validation_failed", latencyMs: result.latencyMs });
    return null;
  }

  return {
    suggestions: validated.data.suggestions.slice(0, 2).map((s, i) => ({ id: `ctx_${i}`, ...s })),
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
  };
}

const practiceReviewProposalSchema = z.object({
  comments: z
    .array(
      z.object({
        anchorId: z.string().trim().min(1).max(96).nullable(),
        text: z.string().trim().min(1).max(MAX_COMMENT_CHARS * 2),
      })
    )
    .min(1),
});

/**
 * Rewrites the rule-based practice review comments as an interviewer would, pinned to element ids on the board.
 * The score is never asked for: it stays the deterministic rubric. Anchors not on the board are dropped.
 */
export async function generatePracticeReviewWithLlm(params: {
  auth: GatewayAuth;
  promptId: PracticePromptId;
  boardGraph: Record<string, unknown> & { nodes: Array<{ id: string }> };
  rubric: Array<{ key: string; score: number; reason: string }>;
  comments: AiReviewComment[];
}): Promise<{ comments: AiReviewComment[]; model: string; latencyMs: number; inputTokens?: number } | null> {
  const prompt = getPracticePrompt(params.promptId);
  if (!prompt) return null;
  const result = await requestStructuredJsonFromLlm({
    auth: params.auth,
    route: "practice_review",
    maxTokens: 700,
    systemPrompt: `You are a senior system-design interviewer reviewing a candidate's whiteboard. Return ONLY JSON {"comments":[{"anchorId":string|null,"text":string}]} with 2 to ${MAX_COMMENTS} comments, each under ${MAX_COMMENT_CHARS} characters. anchorId is the id of the board node the comment is about (only ids from boardGraph.nodes), or null when something is missing from the board. Ask pointed questions and name concrete gaps; do not draw or hand over the full answer, and do not give a score. Keep the rule-based comments' intent; you may rephrase them, merge them or add sharper ones grounded in the board.`,
    userPayload: {
      task: "practice_review",
      problem: { title: prompt.title, brief: prompt.brief, functional: prompt.functional, nonFunctional: prompt.nonFunctional },
      rubric: params.rubric,
      ruleComments: params.comments,
      boardGraph: params.boardGraph,
    },
  });
  if (!result) return null;

  let decoded: unknown;
  try {
    decoded = parseJsonBody(result.content);
  } catch {
    logServerEvent("warn", { route: "ai-gateway", event: "review_json_parse_failed", latencyMs: result.latencyMs });
    return null;
  }
  const validated = practiceReviewProposalSchema.safeParse(decoded);
  if (!validated.success) {
    logServerEvent("warn", { route: "ai-gateway", event: "review_validation_failed", latencyMs: result.latencyMs });
    return null;
  }
  const nodeIds = new Set(params.boardGraph.nodes.map((n) => n.id));
  const comments = validated.data.comments
    .filter((c) => c.anchorId === null || nodeIds.has(c.anchorId))
    .slice(0, MAX_COMMENTS);
  if (comments.length < 2) return null;
  return { comments, model: result.model, latencyMs: result.latencyMs, inputTokens: result.inputTokens };
}

const OPTION_GRAPH_KINDS = ["node", "database", "cache", "queue", "lb", "blob", "external", "actor", "diamond"] as const;

const optionGraphSchema = z
  .object({
    nodes: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          kind: z.enum(OPTION_GRAPH_KINDS),
          sublabel: z.string().trim().max(48).optional(),
        })
      )
      .min(1)
      .max(12),
    edges: z
      .array(
        z.object({
          from: z.string().trim().min(1).max(40),
          to: z.string().trim().min(1).max(40),
          label: z.string().trim().max(24).optional(),
        })
      )
      .max(20),
  })
  .strip();

const optionGraphsSchema = z
  .object({ cluster: optionGraphSchema.optional(), full: optionGraphSchema.optional() })
  .strip()
  .refine((g) => g.cluster || g.full, "no graphs");

export type OptionGraph = z.infer<typeof optionGraphSchema>;

const OPTION_GRAPHS_PROMPT = `You extend a system-design whiteboard. Return ONLY JSON {"cluster":{"nodes":[{"label":string,"kind":${OPTION_GRAPH_KINDS.map((k) => `"${k}"`).join("|")},"sublabel"?:string}],"edges":[{"from":label,"to":label,"label"?:string}]},"full":{same shape}}. cluster = the concept plus 2-3 NEW companion nodes it talks to directly (3-4 new nodes, the anchor not counted). full = the complete architecture around the concept: 7-10 NEW nodes (services, data stores, caches, queues, workers), a real production design, not a list of generic services. Both MUST include the concept node and connect to the anchor node (use the anchor's exact label as an edge endpoint, do not add it as a new node). Reuse the exact label of any node already on the board instead of inventing a duplicate. Labels: specific, 1-3 words, max 40 chars. Edge labels: short verbs (HTTPS, reads, publishes). Kinds: lb=gateway/load balancer/CDN, cache, queue=queue/stream/bus, database, blob=object storage, external=third-party, actor=user/client, node=service. "baseline" lists the node names of a decent default for each option: start from it and adapt it to this board and what the user typed (rename to fit, swap pieces that do not fit, add what is missing); never return fewer nodes than the baseline. "baseline.edges" is a sound wiring for the full option: keep its direction and structure (a cache sits on the caller's read path, in front of the database; replicas and backups receive data FROM the primary), and give every edge a short distinct label. When several nodes are selected, the concept is the node that ties them together. When the concept is a whole system (for example "URL shortener"), its nodes are that system's components: never add a node named after the system itself, and never combine labels with "+".`;

/**
 * Names and shapes the cluster and full next-action options for a concept on the current board.
 * Returns null on any failure so the deterministic catalog options stand.
 */
export async function proposeOptionGraphsWithLlm(params: {
  auth: GatewayAuth;
  request: {
    text?: string;
    conceptLabel: string;
    anchorLabel?: string;
    selectedLabels: string[];
    boardLabels: string[];
    baseline?: { cluster: string[]; full: string[]; edges?: string[] };
  };
}): Promise<{ graphs: { cluster?: OptionGraph; full?: OptionGraph }; model: string; latencyMs: number } | null> {
  const result = await requestStructuredJsonFromLlm({
    auth: params.auth,
    route: "next_options",
    timeoutMs: 5000,
    maxTokens: 900,
    systemPrompt: OPTION_GRAPHS_PROMPT,
    userPayload: {
      task: "next_options",
      concept: params.request.conceptLabel,
      ...(params.request.text ? { typed: params.request.text } : {}),
      ...(params.request.anchorLabel ? { anchor: params.request.anchorLabel } : {}),
      selected: params.request.selectedLabels,
      board: params.request.boardLabels,
      ...(params.request.baseline ? { baseline: params.request.baseline } : {}),
    },
  });
  if (!result) return null;
  let decoded: unknown;
  try {
    decoded = parseJsonBody(result.content);
  } catch {
    logServerEvent("warn", { route: "ai-gateway", event: "option_graphs_json_parse_failed", latencyMs: result.latencyMs });
    return null;
  }
  const validated = optionGraphsSchema.safeParse(decoded);
  if (!validated.success) {
    logServerEvent("warn", { route: "ai-gateway", event: "option_graphs_validation_failed", latencyMs: result.latencyMs });
    return null;
  }
  return { graphs: validated.data, model: result.model, latencyMs: result.latencyMs };
}

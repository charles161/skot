import { NextRequest } from "next/server";
import { z } from "zod";
import {
  feedbackPreferenceSummarySchema,
} from "@/lib/jev/feedback-store";
import { forkArchetypeSchema } from "@/lib/jev/fork-engine";
import { describeForkConstraint, forkConstraintSchema } from "@/lib/jev/fork-constraint";
import {
  generateForkTakesWithLlm,
  generateMorphSpecWithLlm,
  generatePracticeReviewWithLlm,
  generateSemanticGraphWithLlm,
  proposeContextNodesWithLlm,
  resolveGatewayAuth,
} from "@/lib/jev/llm-graph-client";
import type { ContextSuggestion } from "@/lib/jev/prediction-engine";
import { PRACTICE_PROMPT_IDS } from "@/lib/jev/practice-prompts";
import { MAX_COMMENT_CHARS, MAX_COMMENTS, RUBRIC_KEYS } from "@/lib/jev/practice-review";
import {
  morphNotationSchema,
  morphSemanticSpecSchema,
  selectionSpecFromGraph,
} from "@/lib/jev/notation-morph";
import {
  buildLocalSemanticGraphFromPrompt,
  hasForbiddenObjectKeys,
  SemanticPatternHint,
  serializedBoardGraphSchema,
  validateSemanticGraph,
} from "@/lib/jev/semantic-graph";
import {
  callTypeSafeJev,
  ChoiceAnswer,
  resolveJevTransport,
  type JevTransport,
  NoulAnswer,
  SystemOneQuestion,
  TypeSafeApiError,
} from "@/lib/jev/typesafe-client";
import {
  getDecideRateLimiter,
  getDecideResponseCache,
  getDecideUpstreamBudget,
  hashDecideRequest,
} from "@/lib/server/decide-state";
import {
  jsonNoStore,
  readJsonBodyWithByteLimit,
  resolveClientIpOrMisconfigured,
} from "@/lib/server/http";
import { classifyServerError, logServerEvent } from "@/lib/server/logger";
import { buildRateLimitHeaders } from "@/lib/server/rate-limit";

const ROUTE = "/api/jev/decide";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_CANDIDATES = 18;
const MAX_STATE_SUMMARY_FOR_UPSTREAM = 6000;

const DIAGRAM_PATTERN_CRITERIA: Record<string, string> = {
  webrtc_p2p:
    "Peer-to-peer WebRTC, signaling, STUN/TURN, collaborative whiteboard, or DataChannel sync",
  auth_flow:
    "Authentication, login, OAuth, SSO, JWT, session, or credential verification",
  microservices:
    "Distributed backend, microservices, API gateway, caches, queues, and databases",
  event_driven:
    "Event-driven architecture, Kafka/RabbitMQ queues, async workers, pub/sub, or dead letter queues",
  cache_read_replica:
    "Cache-first reads, Redis read-through cache, CDN caching, or database read replicas",
  payments_ledger:
    "Payments, Stripe checkout, fraud checks, billing webhooks, or double-entry ledger storage",
  ai_rag:
    "AI agent, LLM pipeline, RAG retrieval, embeddings, vector database, or tool calling",
  ci_cd:
    "CI/CD build, test, staging, deployment, or DevOps release pipeline",
  onboarding_funnel:
    "User onboarding, checkout, conversion funnel, or product journey with drop-offs",
  comparison:
    "Comparing two options, architectures, or trade-offs side by side (X vs Y)",
  custom_flow:
    "Explicit arrow notation or custom list of arbitrary steps/entities",
};

const VALID_PATTERN_HINTS = new Set<string>(Object.keys(DIAGRAM_PATTERN_CRITERIA));

function asPatternHint(choice: string | undefined): SemanticPatternHint | null {
  if (!choice || !VALID_PATTERN_HINTS.has(choice)) return null;
  return choice as SemanticPatternHint;
}

const rankCandidateSchema = z
  .object({
    id: z.string().trim().min(1).max(48),
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().max(140).optional().default(""),
    category: z.string().max(24).optional().default("extend"),
  })
  .strict();

const rankActionsSchema = z
  .object({
    mode: z.literal("rank_actions"),
    stateSummary: z.string().max(8000).optional().default(""),
    boardGraph: serializedBoardGraphSchema.optional(),
    intentSummary: z.string().max(320).optional(),
    preferenceSummary: feedbackPreferenceSummarySchema.nullable().optional(),
    candidates: z.array(rankCandidateSchema).min(1).max(MAX_CANDIDATES),
    context: z
      .object({
        subjectLabel: z.string().trim().min(1).max(80),
        neighborLabels: z.array(z.string().trim().min(1).max(80)).max(8),
        boardTitle: z.string().trim().max(120).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const classifyPromptSchema = z
  .object({
    mode: z.literal("classify_prompt"),
    prompt: z.string().trim().min(1).max(1200),
  })
  .strict();

const placementSlotSchema = z
  .object({
    id: z.string().trim().min(1).max(48),
    label: z.string().max(80).optional(),
    description: z.string().trim().min(1).max(280),
    prior: z.number().finite().min(0).max(1).optional().default(0.4),
  })
  .strict();

const connectTargetSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    label: z.string().max(80).optional(),
    description: z.string().trim().min(1).max(280),
    prior: z.number().finite().min(0).max(1).optional().default(0.4),
  })
  .strict();

const placeDiagramSchema = z
  .object({
    mode: z.literal("place_diagram"),
    prompt: z.string().max(1200).optional(),
    stateSummary: z.string().max(8000).optional().default(""),
    boardGraph: serializedBoardGraphSchema.optional(),
    preferenceSummary: feedbackPreferenceSummarySchema.nullable().optional(),
    classifyPattern: z.boolean().optional().default(false),
    candidates: z.array(placementSlotSchema).min(1).max(10),
    connectTargets: z.array(connectTargetSchema).max(8).optional().default([]),
  })
  .strict();

const generateGraphSchema = z
  .object({
    mode: z.literal("generate_graph"),
    prompt: z.string().trim().min(1).max(1200),
    boardGraph: serializedBoardGraphSchema.optional(),
    preferenceSummary: feedbackPreferenceSummarySchema.nullable().optional(),
  })
  .strict();

const forkCandidateTakeSchema = z
  .object({
    archetype: forkArchetypeSchema,
    title: z.string().trim().min(1).max(80),
    rationale: z.string().trim().min(1).max(200),
    tradeoffTag: z.string().trim().min(1).max(48),
  })
  .strict();

const forkArchitectureSchema = z
  .object({
    mode: z.literal("fork_architecture"),
    selectedIds: z.array(z.string().trim().min(1).max(96)).min(1).max(48),
    boardGraph: serializedBoardGraphSchema,
    preferenceSummary: feedbackPreferenceSummarySchema.nullable().optional(),
    candidateTakes: z.array(forkCandidateTakeSchema).min(1).max(3).optional(),
    constraint: forkConstraintSchema.optional(),
  })
  .strict();

const morphNotationRequestSchema = z
  .object({
    mode: z.literal("morph_notation"),
    targetNotation: morphNotationSchema,
    selectedIds: z.array(z.string().trim().min(1).max(96)).min(1).max(48),
    boardGraph: serializedBoardGraphSchema,
    currentSpec: morphSemanticSpecSchema.optional(),
  })
  .strict();

const practiceReviewRequestSchema = z
  .object({
    mode: z.literal("practice_review"),
    promptId: z.enum(PRACTICE_PROMPT_IDS),
    boardGraph: serializedBoardGraphSchema,
    rubric: z
      .array(
        z
          .object({
            key: z.enum(RUBRIC_KEYS),
            score: z.number().int().min(0).max(2),
            reason: z.string().max(200),
          })
          .strict()
      )
      .length(RUBRIC_KEYS.length),
    comments: z
      .array(
        z
          .object({
            anchorId: z.string().trim().min(1).max(96).nullable(),
            text: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
          })
          .strict()
      )
      .max(MAX_COMMENTS),
  })
  .strict();

const decideRequestSchema = z.discriminatedUnion("mode", [
  rankActionsSchema,
  classifyPromptSchema,
  placeDiagramSchema,
  generateGraphSchema,
  forkArchitectureSchema,
  morphNotationRequestSchema,
  practiceReviewRequestSchema,
]);

function pickHighestPrior<T extends { id: string; prior: number }>(
  list: T[]
): T {
  let best = list[0];
  for (let i = 1; i < list.length; i += 1) {
    if (list[i].prior > best.prior) {
      best = list[i];
    }
  }
  return best;
}

/** Secret-free reason a live jev call fell back, e.g. "gateway:UPSTREAM_HTTP_ERROR:401", so one curl tells auth from bugs. */
function jevDegradedReason(
  transport: JevTransport,
  classified: { errorClass: string; errorCode?: string; upstreamStatus?: number }
): string {
  const code = classified.errorCode ?? classified.errorClass;
  return `${transport.via}:${code}${classified.upstreamStatus !== undefined ? `:${classified.upstreamStatus}` : ""}`;
}

function buildUpstreamState(params: {
  boardGraph?: z.infer<typeof serializedBoardGraphSchema>;
  stateSummary?: string;
  intentSummary?: string;
  prompt?: string;
  preferenceSummary?: z.infer<typeof feedbackPreferenceSummarySchema> | null;
}): string | Record<string, unknown> {
  if (params.boardGraph) {
    const stateObj: Record<string, unknown> = {
      boardGraph: params.boardGraph,
    };
    if (params.prompt) stateObj.prompt = params.prompt.slice(0, 600);
    if (params.intentSummary) stateObj.intent = params.intentSummary.slice(0, 320);
    if (params.preferenceSummary) {
      stateObj.userPreferences = params.preferenceSummary;
    }
    return stateObj;
  }
  const base = (params.stateSummary ?? "").slice(0, MAX_STATE_SUMMARY_FOR_UPSTREAM);
  if (params.preferenceSummary && params.preferenceSummary.preferred.length > 0) {
    return `${base}\nUser preferred patterns: ${params.preferenceSummary.preferred.join(", ")}`;
  }
  return base;
}

export async function POST(request: NextRequest) {
  const requestStartedAt = performance.now();
  const ipResult = resolveClientIpOrMisconfigured(request, {
    route: ROUTE,
    method: "POST",
  });
  if (!ipResult.ok) return ipResult.response;
  const clientIp = ipResult.ip;
  const rateLimit = getDecideRateLimiter().check(clientIp);
  const rateHeaders = buildRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    logServerEvent("warn", {
      route: ROUTE,
      method: "POST",
      event: "rate_limit_exceeded",
      status: 429,
      latencyMs: Math.max(1, Math.round(performance.now() - requestStartedAt)),
    });
    return jsonNoStore(
      {
        error: "Too many requests",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429, headers: rateHeaders }
    );
  }

  const bodyResult = await readJsonBodyWithByteLimit(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    logServerEvent("warn", {
      route: ROUTE,
      method: "POST",
      event: bodyResult.status === 413 ? "payload_too_large" : "invalid_body",
      status: bodyResult.status,
      latencyMs: Math.max(1, Math.round(performance.now() - requestStartedAt)),
    });
    return jsonNoStore(
      { error: bodyResult.error },
      { status: bodyResult.status, headers: rateHeaders }
    );
  }

  if (hasForbiddenObjectKeys(bodyResult.data)) {
    return jsonNoStore(
      { error: "Invalid request payload" },
      { status: 400, headers: rateHeaders }
    );
  }

  const parsed = decideRequestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    logServerEvent("warn", {
      route: ROUTE,
      method: "POST",
      event: "schema_validation_failed",
      status: 400,
      errorClass: "ZodError",
      latencyMs: Math.max(1, Math.round(performance.now() - requestStartedAt)),
    });
    return jsonNoStore(
      { error: "Invalid request payload" },
      { status: 400, headers: rateHeaders }
    );
  }

  const input = parsed.data;
  const cache = getDecideResponseCache();
  const gatewayAuth = resolveGatewayAuth({
    oidcHeader: request.headers.get("x-vercel-oidc-token"),
  });
  const jevTransport = resolveJevTransport(gatewayAuth);
  const liveEnabled = jevTransport !== null;
  const cacheKey = liveEnabled ? hashDecideRequest(input as Record<string, unknown>) : null;

  if (cacheKey) {
    const cachedPayload = cache.get(cacheKey);
    if (cachedPayload) {
      return jsonNoStore(
        {
          ...cachedPayload,
          latencyMs: 0,
          cached: true,
        },
        { headers: rateHeaders }
      );
    }
  }

  // MODE 1: Rank candidate next whiteboard actions & classify drag intent in parallel
  if (input.mode === "rank_actions") {
    const candidates = input.candidates;
    const upstreamState = buildUpstreamState({
      boardGraph: input.boardGraph,
      stateSummary: input.stateSummary,
      intentSummary: input.intentSummary,
      preferenceSummary: input.preferenceSummary,
    });

    let contextSuggestions: ContextSuggestion[] = [];
    if (input.context && gatewayAuth) {
      const contextBudget = getDecideUpstreamBudget().tryConsume();
      if (contextBudget.allowed) {
        const proposed = await proposeContextNodesWithLlm({
          auth: gatewayAuth,
          context: input.context,
        });
        const candidateIds = new Set(candidates.map((c) => c.id));
        contextSuggestions = (proposed?.suggestions ?? []).filter((s) => !candidateIds.has(s.id));
      } else {
        logServerEvent("warn", {
          route: ROUTE,
          method: "POST",
          mode: input.mode,
          event: "upstream_budget_exhausted",
          status: 200,
          degraded: true,
          errorClass: contextBudget.reason,
        });
      }
    }

    const buildHeuristicRankResponse = (degraded = false) => ({
      source: "heuristic" as const,
      model: "heuristic",
      isHeuristic: true,
      latencyMs: 0,
      nextActionProbabilities: null,
      nextActionConfidence: null,
      intentChoice: null,
      intentConfidence: null,
      shouldConnectProb: null,
      contextSuggestions,
      ...(degraded ? { degraded: true } : {}),
    });

    if (!jevTransport) {
      const payload = buildHeuristicRankResponse(false);
      if (cacheKey && contextSuggestions.length > 0) cache.set(cacheKey, payload);
      return jsonNoStore(payload, {
        headers: rateHeaders,
      });
    }

    const budget = getDecideUpstreamBudget().tryConsume();
    if (!budget.allowed) {
      logServerEvent("warn", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_budget_exhausted",
        status: 200,
        degraded: true,
        errorClass: budget.reason,
      });
      return jsonNoStore(buildHeuristicRankResponse(true), {
        headers: rateHeaders,
      });
    }

    try {
      const actionCriteria: Record<string, string> = {};
      for (const c of candidates) {
        actionCriteria[c.id] = `${c.title} — ${c.subtitle}`;
      }
      for (const s of contextSuggestions) {
        actionCriteria[s.id] = `Add → ${s.label} — ${s.sublabel ?? "named from this board"}`;
      }

      const { response, latencyMs, source } = await callTypeSafeJev({
        state: upstreamState,
        questions: {
          user_intent: {
            type: "choice",
            instructions:
              "Based on the structured whiteboard graph, recent edit deltas, and the user's latest gesture, what structural editing intent best describes what the user is trying to do?",
            criteria: {
              splice_into_edge:
                "Inserting a node directly into the middle of an existing arrow between two nodes",
              open_pipeline_gap:
                "Pulling a connected node away to open room for an intermediate service, cache, or check",
              align_pipeline:
                "Aligning nodes into a horizontal flow or sequential pipeline",
              branch_out:
                "Pulling a node off the main axis to create a parallel branch or decoupled subsystem",
              connect_nearby:
                "Placing a node right next to another unconnected node to link or sync them",
              decision_branch:
                "Splitting a conditional diamond or check into Yes/No or failure outcomes",
              extend_flow:
                "Continuing a system diagram by adding the next logical downstream component",
            },
          },
          next_action: {
            type: "choice",
            instructions:
              "Which concrete next whiteboard action is most helpful and natural for the user to take immediately with Tab + Enter, taking into account any user preference summary?",
            criteria: actionCriteria,
          },
          should_auto_connect: {
            type: "noul",
            instructions:
              "Does the user's latest canvas action imply connecting or rewiring an arrow right now?",
            criteria: {
              true: "The moved or newly added node should be wired with an arrow to adjacent nodes",
              false:
                "The user is likely grouping, framing, or annotating without adding a new arrow",
            },
          },
        },
      }, jevTransport);

      const actionAns = response.answers.next_action as ChoiceAnswer | undefined;
      const intentAns = response.answers.user_intent as ChoiceAnswer | undefined;
      const connectAns = response.answers.should_auto_connect as
        | NoulAnswer
        | undefined;

      const payload = {
        source,
        model: response.model,
        isHeuristic: false,
        latencyMs,
        usage: response.usage,
        nextActionProbabilities: actionAns?.probabilities ?? null,
        nextActionConfidence:
          typeof actionAns?.confidence === "number"
            ? actionAns.confidence
            : null,
        intentChoice: intentAns?.choice ?? null,
        intentConfidence:
          typeof intentAns?.confidence === "number"
            ? intentAns.confidence
            : null,
        shouldConnectProb:
          typeof connectAns?.noul === "number" ? connectAns.noul : null,
        contextSuggestions,
      };

      if (cacheKey) cache.set(cacheKey, payload);
      return jsonNoStore(payload, { headers: rateHeaders });
    } catch (err) {
      const classified = classifyServerError(err);
      const latencyMs =
        err instanceof TypeSafeApiError
          ? err.latencyMs
          : Math.max(1, Math.round(performance.now() - requestStartedAt));

      logServerEvent("error", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_fallback",
        status: 200,
        degraded: true,
        latencyMs,
        ...classified,
      });

      return jsonNoStore(
        { ...buildHeuristicRankResponse(true), degradedReason: jevDegradedReason(jevTransport, classified) },
        { headers: rateHeaders }
      );
    }
  }

  // MODE 2: Classify natural-language whiteboard prompt using Jev Choice + Noul
  if (input.mode === "classify_prompt") {
    const buildHeuristicClassifyResponse = (degraded = false) => ({
      source: "heuristic" as const,
      model: "heuristic",
      isHeuristic: true,
      latencyMs: 0,
      pattern: null,
      confidence: null,
      needsDecision: false,
      ...(degraded ? { degraded: true } : {}),
    });

    if (!jevTransport) {
      return jsonNoStore(buildHeuristicClassifyResponse(false), {
        headers: rateHeaders,
      });
    }

    const budget = getDecideUpstreamBudget().tryConsume();
    if (!budget.allowed) {
      logServerEvent("warn", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_budget_exhausted",
        status: 200,
        degraded: true,
        errorClass: budget.reason,
      });
      return jsonNoStore(buildHeuristicClassifyResponse(true), {
        headers: rateHeaders,
      });
    }

    try {
      const { response, latencyMs, source } = await callTypeSafeJev({
        state: input.prompt,
        questions: {
          diagram_pattern: {
            type: "choice",
            instructions:
              "Which whiteboard diagram archetype best matches the user's description? Choose custom_flow if the user gave explicit arrows or a custom list of steps.",
            criteria: DIAGRAM_PATTERN_CRITERIA,
          },
          needs_decision: {
            type: "noul",
            instructions:
              "Does this prompt describe a conditional check, approval, retry, or yes/no branch?",
          },
        },
      }, jevTransport);

      const patternAns = response.answers.diagram_pattern as
        | ChoiceAnswer
        | undefined;
      const decisionAns = response.answers.needs_decision as
        | NoulAnswer
        | undefined;

      const payload = {
        source,
        model: response.model,
        isHeuristic: false,
        latencyMs,
        usage: response.usage,
        pattern: patternAns?.choice ?? null,
        confidence:
          typeof patternAns?.confidence === "number"
            ? patternAns.confidence
            : null,
        needsDecision: (decisionAns?.noul ?? 0) >= 0.6,
      };

      if (cacheKey) cache.set(cacheKey, payload);
      return jsonNoStore(payload, { headers: rateHeaders });
    } catch (err) {
      const classified = classifyServerError(err);
      const latencyMs =
        err instanceof TypeSafeApiError
          ? err.latencyMs
          : Math.max(1, Math.round(performance.now() - requestStartedAt));

      logServerEvent("error", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_fallback",
        status: 200,
        degraded: true,
        latencyMs,
        ...classified,
      });

      return jsonNoStore(buildHeuristicClassifyResponse(true), {
        headers: rateHeaders,
      });
    }
  }

  // MODE 3: Generate a validated SemanticGraph from a prompt + structured board graph
  if (input.mode === "generate_graph") {
    const buildHeuristicGraphResponse = (degraded = false) => {
      const local = buildLocalSemanticGraphFromPrompt(input.prompt);
      const validated = validateSemanticGraph(local.graph);
      return {
        source: "heuristic" as const,
        model: "heuristic",
        isHeuristic: true,
        latencyMs: 0,
        confidence: null,
        archetype: local.archetype,
        graph: validated.ok ? validated.graph : local.graph,
        ...(degraded ? { degraded: true } : {}),
      };
    };

    if (!liveEnabled) {
      return jsonNoStore(buildHeuristicGraphResponse(false), {
        headers: rateHeaders,
      });
    }

    const budget = getDecideUpstreamBudget().tryConsume();
    if (!budget.allowed) {
      logServerEvent("warn", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_budget_exhausted",
        status: 200,
        degraded: true,
        errorClass: budget.reason,
      });
      return jsonNoStore(buildHeuristicGraphResponse(true), {
        headers: rateHeaders,
      });
    }

    // 3a. Direct structured JSON LLM graph generator when configured
    if (gatewayAuth) {
      const llmRes = await generateSemanticGraphWithLlm({
        auth: gatewayAuth,
        prompt: input.prompt,
        boardGraph: input.boardGraph as Record<string, unknown> | undefined,
        preferenceSummary: input.preferenceSummary ?? null,
      });
      if (llmRes) {
        const payload = {
          source: "llm-json" as const,
          model: llmRes.model,
          isHeuristic: false,
          latencyMs: llmRes.latencyMs,
          confidence: null,
          archetype: "custom_flow" as const,
          graph: llmRes.graph,
          ...(llmRes.inputTokens !== undefined
            ? { usage: { input_tokens: llmRes.inputTokens } }
            : {}),
        };
        if (cacheKey) cache.set(cacheKey, payload);
        return jsonNoStore(payload, { headers: rateHeaders });
      }
      if (!jevTransport) {
        return jsonNoStore(buildHeuristicGraphResponse(true), {
          headers: rateHeaders,
        });
      }
    }

    // 3b. TypeSafe System One archetype classification + validated semantic graph synthesis
    try {
      const state = buildUpstreamState({
        boardGraph: input.boardGraph,
        stateSummary: input.prompt,
        prompt: input.prompt,
        preferenceSummary: input.preferenceSummary,
      });
      const { response, latencyMs, source } = await callTypeSafeJev({
        state,
        questions: {
          diagram_pattern: {
            type: "choice",
            instructions:
              "Select the best semantic graph archetype for this whiteboard prompt given the current board graph and preferences.",
            criteria: DIAGRAM_PATTERN_CRITERIA,
          },
          needs_decision: {
            type: "noul",
            instructions:
              "Does this prompt require a conditional diamond decision check?",
          },
        },
      }, jevTransport);

      const patternAns = response.answers.diagram_pattern as
        | ChoiceAnswer
        | undefined;
      const patternHint = asPatternHint(patternAns?.choice);
      const built = buildLocalSemanticGraphFromPrompt(input.prompt, patternHint);
      const validated = validateSemanticGraph(built.graph);
      if (!validated.ok) {
        return jsonNoStore(buildHeuristicGraphResponse(true), {
          headers: rateHeaders,
        });
      }

      const payload = {
        source,
        model: response.model,
        isHeuristic: false,
        latencyMs,
        usage: response.usage,
        confidence:
          typeof patternAns?.confidence === "number"
            ? patternAns.confidence
            : null,
        archetype: patternHint ?? built.archetype,
        graph: validated.graph,
      };

      if (cacheKey) cache.set(cacheKey, payload);
      return jsonNoStore(payload, { headers: rateHeaders });
    } catch (err) {
      const classified = classifyServerError(err);
      const latencyMs =
        err instanceof TypeSafeApiError
          ? err.latencyMs
          : Math.max(1, Math.round(performance.now() - requestStartedAt));

      logServerEvent("error", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_fallback",
        status: 200,
        degraded: true,
        latencyMs,
        ...classified,
      });
      return jsonNoStore(buildHeuristicGraphResponse(true), {
        headers: rateHeaders,
      });
    }
  }

  // MODE 4: FORK IT — 3 distinct architectural takes over selected subgraph
  if (input.mode === "fork_architecture") {
    const buildHeuristicForkResponse = (degraded = false) => ({
      source: "heuristic" as const,
      model: "heuristic",
      isHeuristic: true,
      latencyMs: 0,
      recommendedArchetype: null,
      confidence: null,
      takeProbabilities: null,
      takes: null,
      ...(degraded ? { degraded: true } : {}),
    });

    if (!liveEnabled) {
      return jsonNoStore(buildHeuristicForkResponse(false), {
        headers: rateHeaders,
      });
    }

    const budget = getDecideUpstreamBudget().tryConsume();
    if (!budget.allowed) {
      logServerEvent("warn", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_budget_exhausted",
        status: 200,
        degraded: true,
        errorClass: budget.reason,
      });
      return jsonNoStore(buildHeuristicForkResponse(true), {
        headers: rateHeaders,
      });
    }

    // 4a. Direct structured JSON LLM generates 3 full validated SemanticGraph takes
    if (gatewayAuth) {
      const llmTakes = await generateForkTakesWithLlm({
        auth: gatewayAuth,
        selectedIds: input.selectedIds,
        boardGraph: input.boardGraph as Record<string, unknown>,
        preferenceSummary: input.preferenceSummary ?? null,
        constraint: input.constraint ?? null,
      });
      if (llmTakes) {
        const payload = {
          source: "llm-json" as const,
          model: llmTakes.model,
          isHeuristic: false,
          latencyMs: llmTakes.latencyMs,
          recommendedArchetype: llmTakes.takes[0]?.archetype ?? null,
          confidence: null,
          takeProbabilities: null,
          takes: llmTakes.takes,
          ...(llmTakes.inputTokens !== undefined
            ? { usage: { input_tokens: llmTakes.inputTokens } }
            : {}),
        };
        if (cacheKey) cache.set(cacheKey, payload);
        return jsonNoStore(payload, { headers: rateHeaders });
      }
      if (!jevTransport) {
        return jsonNoStore(buildHeuristicForkResponse(true), {
          headers: rateHeaders,
        });
      }
    }

    // 4b. TypeSafe System One scores/ranks the 3 architectural takes over the structured board graph
    const candidateTakes = input.candidateTakes ?? [
      {
        archetype: "queue_event_driven" as const,
        title: "Queue / Event-Driven",
        rationale: "Decouples synchronous hops via an async queue, worker pool, and DLQ",
        tradeoffTag: "Eventual consistency",
      },
      {
        archetype: "cache_read_replica" as const,
        title: "Cache-First / Read Replica",
        rationale: "Serves hot reads from Redis cache-aside with read replica fallback",
        tradeoffTag: "Cache invalidation",
      },
      {
        archetype: "gateway_edge_split" as const,
        title: "Gateway / Edge-Split",
        rationale: "Centralizes auth, rate limits, and split read/write routing at edge",
        tradeoffTag: "Extra network hop",
      },
    ];

    try {
      const criteria: Record<string, string> = {};
      for (const take of candidateTakes) {
        criteria[take.archetype] = `${take.title}: ${take.rationale} (Trade-off: ${take.tradeoffTag})`;
      }

      const { response, latencyMs, source } = await callTypeSafeJev({
        state: {
          boardGraph: input.boardGraph,
          selectedIds: input.selectedIds,
          ...(input.preferenceSummary
            ? { userPreferences: input.preferenceSummary }
            : {}),
        },
        questions: {
          best_fork_take: {
            type: "choice",
            instructions: input.constraint
              ? `Given the selected subgraph on the whiteboard and the stated pressure (${describeForkConstraint(input.constraint)}), which architectural take best answers that pressure for what it costs?`
              : "Given the selected subgraph on the whiteboard, recent edit deltas, and user preferences, which architectural refactor take is the highest-leverage recommendation?",
            criteria,
          },
        },
      }, jevTransport);

      const ans = response.answers.best_fork_take as ChoiceAnswer | undefined;
      const validChoice =
        ans?.choice && candidateTakes.some((t) => t.archetype === ans.choice)
          ? ans.choice
          : null;

      const payload = {
        source,
        model: response.model,
        isHeuristic: false,
        latencyMs,
        usage: response.usage,
        recommendedArchetype: validChoice,
        confidence: typeof ans?.confidence === "number" ? ans.confidence : null,
        takeProbabilities: ans?.probabilities ?? null,
        takes: null,
      };

      if (cacheKey) cache.set(cacheKey, payload);
      return jsonNoStore(payload, { headers: rateHeaders });
    } catch (err) {
      const classified = classifyServerError(err);
      const latencyMs =
        err instanceof TypeSafeApiError
          ? err.latencyMs
          : Math.max(1, Math.round(performance.now() - requestStartedAt));

      logServerEvent("error", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_fallback",
        status: 200,
        degraded: true,
        latencyMs,
        ...classified,
      });

      return jsonNoStore(buildHeuristicForkResponse(true), {
        headers: rateHeaders,
      });
    }
  }

  // MODE 4c: NOTATION MORPH — refine shared semantic spec via structured LLM JSON
  if (input.mode === "morph_notation") {
    const buildHeuristicMorphResponse = (degraded = false) => ({
      source: "heuristic" as const,
      model: "heuristic",
      isHeuristic: true,
      latencyMs: 0,
      spec: null,
      ...(degraded ? { degraded: true } : {}),
    });

    if (!gatewayAuth) {
      return jsonNoStore(buildHeuristicMorphResponse(false), {
        headers: rateHeaders,
      });
    }

    const budget = getDecideUpstreamBudget().tryConsume();
    if (!budget.allowed) {
      logServerEvent("warn", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_budget_exhausted",
        status: 200,
        degraded: true,
        errorClass: budget.reason,
      });
      return jsonNoStore(buildHeuristicMorphResponse(true), {
        headers: rateHeaders,
      });
    }

    const llmRes = await generateMorphSpecWithLlm({
      auth: gatewayAuth,
      targetNotation: input.targetNotation,
      selectedIds: input.selectedIds,
      boardGraph: input.boardGraph as Record<string, unknown>,
      currentSpec: input.currentSpec,
      selection: input.currentSpec ?? selectionSpecFromGraph(input.boardGraph),
    });
    if (!llmRes) {
      return jsonNoStore(buildHeuristicMorphResponse(true), {
        headers: rateHeaders,
      });
    }

    const payload = {
      source: "llm-json" as const,
      model: llmRes.model,
      isHeuristic: false,
      latencyMs: llmRes.latencyMs,
      spec: llmRes.spec,
      ...(llmRes.inputTokens !== undefined
        ? { usage: { input_tokens: llmRes.inputTokens } }
        : {}),
    };
    if (cacheKey) cache.set(cacheKey, payload);
    return jsonNoStore(payload, { headers: rateHeaders });
  }

  // MODE 4d: PRACTICE REVIEW — interviewer-style comments via the AI Gateway; the score stays client-side rules
  if (input.mode === "practice_review") {
    const ruleBased = (degraded = false) => ({
      source: "heuristic" as const,
      model: "heuristic",
      isHeuristic: true,
      latencyMs: 0,
      comments: null,
      ...(degraded ? { degraded: true } : {}),
    });

    if (!gatewayAuth) {
      return jsonNoStore(ruleBased(false), { headers: rateHeaders });
    }

    const budget = getDecideUpstreamBudget().tryConsume();
    if (!budget.allowed) {
      logServerEvent("warn", {
        route: ROUTE,
        method: "POST",
        mode: input.mode,
        event: "upstream_budget_exhausted",
        status: 200,
        degraded: true,
        errorClass: budget.reason,
      });
      return jsonNoStore(ruleBased(true), { headers: rateHeaders });
    }

    const llmRes = await generatePracticeReviewWithLlm({
      auth: gatewayAuth,
      promptId: input.promptId,
      boardGraph: input.boardGraph,
      rubric: input.rubric,
      comments: input.comments,
    });
    if (!llmRes) {
      return jsonNoStore(ruleBased(true), { headers: rateHeaders });
    }

    const payload = {
      source: "llm-json" as const,
      model: llmRes.model,
      isHeuristic: false,
      latencyMs: llmRes.latencyMs,
      comments: llmRes.comments,
      ...(llmRes.inputTokens !== undefined ? { usage: { input_tokens: llmRes.inputTokens } } : {}),
    };
    if (cacheKey) cache.set(cacheKey, payload);
    return jsonNoStore(payload, { headers: rateHeaders });
  }

  // MODE 5: Predict the most probable spatial placement on the whiteboard via Jev
  const upstreamState = buildUpstreamState({
    boardGraph: input.boardGraph,
    stateSummary: input.stateSummary,
    prompt: input.prompt,
    preferenceSummary: input.preferenceSummary,
  });
  const { classifyPattern, candidates: slots, connectTargets } = input;

  const buildHeuristicPlacementResponse = (degraded = false) => {
    const bestSlot = pickHighestPrior(slots);
    const bestConnect =
      connectTargets.length > 0 ? pickHighestPrior(connectTargets) : null;
    return {
      source: "heuristic" as const,
      model: "heuristic",
      isHeuristic: true,
      latencyMs: 0,
      chosenSlotId: bestSlot.id,
      slotProbabilities: null,
      slotConfidence: null,
      isFlowIterationProb: null,
      connectTargetId: bestConnect ? bestConnect.id : null,
      connectProbabilities: null,
      connectConfidence: null,
      shouldConnectProb: null,
      pattern: null,
      needsDecision: false,
      ...(degraded ? { degraded: true } : {}),
    };
  };

  if (!jevTransport) {
    return jsonNoStore(buildHeuristicPlacementResponse(false), {
      headers: rateHeaders,
    });
  }

  const budget = getDecideUpstreamBudget().tryConsume();
  if (!budget.allowed) {
    logServerEvent("warn", {
      route: ROUTE,
      method: "POST",
      mode: input.mode,
      event: "upstream_budget_exhausted",
      status: 200,
      degraded: true,
      errorClass: budget.reason,
    });
    return jsonNoStore(buildHeuristicPlacementResponse(true), {
      headers: rateHeaders,
    });
  }

  try {
    const slotCriteria: Record<string, string> = {};
    for (const s of slots) {
      slotCriteria[s.id] = s.description;
    }

    const questions: Record<string, SystemOneQuestion> = {
      placement_slot: {
        type: "choice",
        instructions:
          "Choose the single most probable, predictable, non-overlapping placement slot on the whiteboard for this new diagram. When the user types sequential flows or refines an earlier flow (e.g. 'app -> server' followed by 'app -> gateway -> server'), strongly prefer stacking cleanly below the previous flow so rows align and stay easy to compare. When the visible area is empty, prefer viewport_center.",
        criteria: slotCriteria,
      },
      is_flow_iteration: {
        type: "noul",
        instructions:
          "Is the new prompt a variation, refinement, or next sequential row of the previous flow in view (making vertical stacking below the previous flow the most predictable placement)?",
        criteria: {
          true: "New flow repeats/refines components from the previous flow or is the next sequential row to compare vertically",
          false:
            "New flow is unrelated, or directly continues horizontally from the right end of an existing node",
        },
      },
    };

    if (connectTargets.length > 0) {
      const connectCriteria: Record<string, string> = {};
      for (const ct of connectTargets) {
        connectCriteria[ct.id] = ct.description;
      }
      questions.connect_target = {
        type: "choice",
        instructions:
          "The user is adding a single new component to the whiteboard (e.g. added 'app', then pressed Enter and typed 'server'). Which existing node should it automatically connect from with a thin, cleanly spaced arrow? Strongly prefer the CURRENTLY FOCUSED node when it makes architectural sense, or the most probable upstream node on canvas. Choose 'none' only if the new component is clearly unrelated.",
        criteria: connectCriteria,
      };
      questions.should_connect = {
        type: "noul",
        instructions:
          "Should this newly typed single component automatically connect with an arrow to an existing node on the board right when the user presses Enter?",
        criteria: {
          true: "The component naturally connects downstream from the focused or most probable node on the canvas",
          false: "The component is completely unrelated and should float standalone",
        },
      };
    }

    if (classifyPattern) {
      questions.diagram_pattern = {
        type: "choice",
        instructions:
          "Which whiteboard diagram archetype best matches the user's description? Choose custom_flow if the user gave explicit arrows or a custom list of steps.",
        criteria: DIAGRAM_PATTERN_CRITERIA,
      };
      questions.needs_decision = {
        type: "noul",
        instructions:
          "Does this prompt describe a conditional check, approval, retry, or yes/no branch?",
      };
    }

    const { response, latencyMs, source } = await callTypeSafeJev({
      state: upstreamState,
      questions,
    }, jevTransport);

    const slotAns = response.answers.placement_slot as ChoiceAnswer | undefined;
    const iterAns = response.answers.is_flow_iteration as
      | NoulAnswer
      | undefined;
    const connectAns = response.answers.connect_target as
      | ChoiceAnswer
      | undefined;
    const shouldConnAns = response.answers.should_connect as
      | NoulAnswer
      | undefined;
    const patternAns = response.answers.diagram_pattern as
      | ChoiceAnswer
      | undefined;
    const decisionAns = response.answers.needs_decision as
      | NoulAnswer
      | undefined;

    const probs = slotAns?.probabilities ?? null;
    let chosenSlotId =
      slotAns?.choice && slots.some((s) => s.id === slotAns.choice)
        ? slotAns.choice
        : pickHighestPrior(slots).id;

    // Reinforce vertical predictability when Jev strongly detects a flow iteration
    // and below_previous is available with meaningful probability
    const isIterProb = typeof iterAns?.noul === "number" ? iterAns.noul : null;
    if (
      isIterProb !== null &&
      isIterProb >= 0.72 &&
      slots.some((s) => s.id === "below_previous") &&
      (probs?.below_previous ?? 0) >= 0.22
    ) {
      chosenSlotId = "below_previous";
    }

    let connectTargetId: string | null = null;
    let connectProbabilities: Record<string, number> | null = null;
    let connectConfidence: number | null = null;
    const shouldConnectProb =
      typeof shouldConnAns?.noul === "number" ? shouldConnAns.noul : null;

    if (connectTargets.length > 0) {
      connectProbabilities = connectAns?.probabilities ?? null;
      connectTargetId =
        connectAns?.choice &&
        connectTargets.some((c) => c.id === connectAns.choice)
          ? connectAns.choice
          : pickHighestPrior(connectTargets).id;

      if (shouldConnectProb !== null && shouldConnectProb < 0.35) {
        connectTargetId = "none";
      }
      const rawConnectConf =
        connectProbabilities?.[connectTargetId] ?? connectAns?.confidence;
      connectConfidence =
        typeof rawConnectConf === "number" ? rawConnectConf : null;
    }

    const rawSlotConf = probs?.[chosenSlotId] ?? slotAns?.confidence;
    const payload = {
      source,
      model: response.model,
      isHeuristic: false,
      latencyMs,
      usage: response.usage,
      chosenSlotId,
      slotProbabilities: probs,
      slotConfidence: typeof rawSlotConf === "number" ? rawSlotConf : null,
      isFlowIterationProb: isIterProb,
      connectTargetId,
      connectProbabilities,
      connectConfidence,
      shouldConnectProb,
      pattern: patternAns?.choice ?? null,
      needsDecision: (decisionAns?.noul ?? 0) >= 0.6,
    };

    if (cacheKey) cache.set(cacheKey, payload);
    return jsonNoStore(payload, { headers: rateHeaders });
  } catch (err) {
    const classified = classifyServerError(err);
    const latencyMs =
      err instanceof TypeSafeApiError
        ? err.latencyMs
        : Math.max(1, Math.round(performance.now() - requestStartedAt));

    logServerEvent("error", {
      route: ROUTE,
      method: "POST",
      mode: input.mode,
      event: "upstream_fallback",
      status: 200,
      degraded: true,
      latencyMs,
      ...classified,
    });

    return jsonNoStore(buildHeuristicPlacementResponse(true), {
      headers: rateHeaders,
    });
  }
}

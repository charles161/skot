import { NextRequest } from "next/server";
import { parseJsonBody, requestStructuredJsonFromLlm, resolveGatewayAuth, type GatewayAuth } from "@/lib/jev/llm-graph-client";
import { hasForbiddenObjectKeys } from "@/lib/jev/semantic-graph";
import {
  ENRICH_SERVER_TIMEOUT_MS,
  enrichRequestSchema,
  mergeEnriched,
  type EnrichRequest,
  type EnrichResponse,
  type MoveFinding,
} from "@/lib/jev/sd-moves/enrich";
import { getDecideRateLimiter, getDecideUpstreamBudget } from "@/lib/server/decide-state";
import { jsonNoStore, readJsonBodyWithByteLimit, resolveClientIpOrMisconfigured } from "@/lib/server/http";
import { logServerEvent } from "@/lib/server/logger";
import { buildRateLimitHeaders } from "@/lib/server/rate-limit";

const ROUTE = "/api/jev/moves";
const MAX_BODY_BYTES = 24 * 1024;

const SYSTEM_PROMPT =
  'You are a senior system-design interviewer annotating a whiteboard. You get rule-based findings and the board. Rewrite each finding so it names this board\'s components and is concrete: title at most 60 characters, 1 to 4 lines of at most 140 characters, keep "Why:" and "Fix:" prefixes where given and keep fixes actionable. Never add a finding, never change an id, never state a problem the finding does not state. Return ONLY JSON {"findings":[{"id":string,"title":string,"lines":string[]}]}.';

/** Gateway rewrite of rule findings; null on any upstream, parse or validation failure so the caller keeps the rule text. */
async function enrichWithLlm(auth: GatewayAuth, request: EnrichRequest): Promise<{ findings: MoveFinding[]; model: string; latencyMs: number } | null> {
  const result = await requestStructuredJsonFromLlm({
    auth,
    route: "moves",
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 700,
    timeoutMs: ENRICH_SERVER_TIMEOUT_MS,
    userPayload: { task: `sd_move_${request.move}`, findings: request.findings, board: request.board },
  });
  if (!result) return null;
  let decoded: unknown;
  try {
    decoded = parseJsonBody(result.content);
  } catch {
    logServerEvent("warn", { route: ROUTE, event: "move_json_parse_failed", latencyMs: result.latencyMs });
    return null;
  }
  const findings = mergeEnriched(request.findings, decoded);
  if (!findings) {
    logServerEvent("warn", { route: ROUTE, event: "move_validation_failed", latencyMs: result.latencyMs });
    return null;
  }
  return { findings, model: result.model, latencyMs: result.latencyMs };
}

/**
 * AI rewrite of a move's rule-based findings through the AI Gateway. Without gateway auth, on any upstream
 * failure, or when the output fails validation, the answer is `source: "rule-based"` and the client keeps its text.
 */
export async function POST(request: NextRequest) {
  const ipResult = resolveClientIpOrMisconfigured(request, { route: ROUTE, method: "POST" });
  if (!ipResult.ok) return ipResult.response;
  const rateLimit = getDecideRateLimiter().check(ipResult.ip);
  const headers = buildRateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return jsonNoStore({ error: "Too many requests", retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429, headers });
  }

  const body = await readJsonBodyWithByteLimit(request, MAX_BODY_BYTES);
  if (!body.ok) return jsonNoStore({ error: body.error }, { status: body.status, headers });
  if (hasForbiddenObjectKeys(body.data)) return jsonNoStore({ error: "Invalid request payload" }, { status: 400, headers });
  const parsed = enrichRequestSchema.safeParse(body.data);
  if (!parsed.success) return jsonNoStore({ error: "Invalid request payload" }, { status: 400, headers });

  const reply = (body: EnrichResponse) => jsonNoStore(body, { headers });
  const auth = resolveGatewayAuth({ oidcHeader: request.headers.get("x-vercel-oidc-token") });
  if (!auth) return reply({ source: "rule-based" });

  const budget = getDecideUpstreamBudget().tryConsume();
  if (!budget.allowed) {
    logServerEvent("warn", { route: ROUTE, method: "POST", event: "upstream_budget_exhausted", status: 200, degraded: true, errorClass: budget.reason });
    return reply({ source: "rule-based", degraded: true });
  }

  const enriched = await enrichWithLlm(auth, parsed.data);
  if (!enriched) return reply({ source: "rule-based", degraded: true });
  return reply({ source: "ai", model: enriched.model, latencyMs: enriched.latencyMs, findings: enriched.findings });
}

// The moves route sends rule findings to the AI Gateway for wording only. The key stays in a server-side header,
// and anything the gateway returns that fails validation leaves the rule text in place ("rule-based").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/jev/moves/route";
import { ENRICH_SERVER_TIMEOUT_MS, enrichResponseSchema } from "@/lib/jev/sd-moves/enrich";
import { resetDecideStateForTests } from "@/lib/server/decide-state";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const GW_KEY = "gw-test-key-91c2";
const ENV = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "VERCEL", "TYPESAFE_API_KEY", "JEV_UPSTREAM_MAX_PER_MINUTE", "AI_GATEWAY_MODEL", "AI_GATEWAY_MODEL_MOVES"];

const body = {
  move: "break",
  findings: [{ id: "break", title: "Orders DB takes every read and write", lines: ["Why: one primary", "Fix: add a cache"] }],
  board: { nodes: [{ id: "db", label: "Orders DB", kind: "database" }], edges: [] },
};

let ip = 0;
function req(payload: unknown, extra: Record<string, string> = {}): NextRequest {
  ip += 1;
  return new NextRequest("http://localhost/api/jev/moves", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip}`, ...extra },
    body: JSON.stringify(payload),
  });
}

const gatewayOk = (content: unknown) =>
  new Response(JSON.stringify({ model: "openai/gpt-4.1-mini", choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
  });

describe("POST /api/jev/moves", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetDecideStateForTests();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("without gateway auth answers rule-based and calls nothing, even with a TypeSafe key", async () => {
    process.env.TYPESAFE_API_KEY = "ts-key";
    const json = await (await POST(req(body))).json();
    expect(json).toEqual({ source: "rule-based" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a gateway key returns the validated AI wording; the key is only in the Authorization header", async () => {
    process.env.AI_GATEWAY_API_KEY = GW_KEY;
    fetchSpy.mockResolvedValue(
      gatewayOk({ findings: [{ id: "break", title: "Orders DB is the 10× wall", lines: ["Fix: Redis in front of /orders reads"] }] })
    );
    const res = await POST(req(body));
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.source).toBe("ai");
    expect(json.model).toBe("openai/gpt-4.1-mini");
    expect(json.findings).toEqual([{ id: "break", title: "Orders DB is the 10× wall", lines: ["Fix: Redis in front of /orders reads"] }]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GATEWAY_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GW_KEY}`);
    expect(String(init.body)).not.toContain(GW_KEY);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "anthropic/claude-haiku-5.5", reasoning_effort: "none" });
    expect(text).not.toContain(GW_KEY);
  });

  // Fork lesson (21 Nov): the server reshaped validated output and the client re-validated it against the raw
  // model schema, so every AI answer silently fell back. Every answer this route sends must parse on the client.
  it("every answer the route sends parses with the client's schema, AI or rule-based", async () => {
    const answers: unknown[] = [await (await POST(req(body))).json()];
    process.env.AI_GATEWAY_API_KEY = GW_KEY;
    fetchSpy.mockResolvedValueOnce(gatewayOk({ findings: [{ id: "break", title: "Orders DB is the wall", lines: ["Fix: cache reads"] }] }));
    answers.push(await (await POST(req(body))).json());
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    answers.push(await (await POST(req(body))).json());
    expect(answers.map((a) => (a as { source: string }).source)).toEqual(["rule-based", "ai", "rule-based"]);
    for (const a of answers) expect(enrichResponseSchema.safeParse(a).success).toBe(true);
  });

  it("gives the gateway a timeout sized for the rewrite, above the 6.5 s graph default", async () => {
    process.env.AI_GATEWAY_API_KEY = GW_KEY;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchSpy.mockResolvedValue(gatewayOk({ findings: [{ id: "break", title: "t", lines: ["x"] }] }));
    await POST(req(body));
    expect(timeout).toHaveBeenCalledWith(ENRICH_SERVER_TIMEOUT_MS);
    expect(ENRICH_SERVER_TIMEOUT_MS).toBeGreaterThan(6500);
    timeout.mockRestore();
  });

  it.each([
    ["an invented finding", gatewayOk({ findings: [{ id: "kafka", title: "Kafka melts", lines: ["x"] }] })],
    ["malformed JSON", new Response(JSON.stringify({ choices: [{ message: { content: "{not json" } }] }), { status: 200 })],
    ["a 503", new Response("{}", { status: 503 })],
  ])("falls back to rule-based on %s", async (_name, response) => {
    process.env.AI_GATEWAY_API_KEY = GW_KEY;
    fetchSpy.mockResolvedValue(response);
    const json = await (await POST(req(body))).json();
    expect(json).toEqual({ source: "rule-based", degraded: true });
  });

  it("ignores an injected OIDC header off Vercel", async () => {
    const json = await (await POST(req(body, { "x-vercel-oidc-token": "attacker" }))).json();
    expect(json.source).toBe("rule-based");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects moves that are not AI-enrichable and malformed findings", async () => {
    process.env.AI_GATEWAY_API_KEY = GW_KEY;
    expect((await POST(req({ ...body, move: "schema" }))).status).toBe(400);
    expect((await POST(req({ ...body, findings: [] }))).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

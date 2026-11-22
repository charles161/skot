import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_GATEWAY_CHAT_COMPLETIONS_URL,
  DEFAULT_AI_GATEWAY_MODEL,
  generateForkTakesWithLlm,
  generateMorphSpecWithLlm,
  generatePracticeReviewWithLlm,
  generateSemanticGraphWithLlm,
  LLM_ROUTE_MODELS,
  proposeContextNodesWithLlm,
  proposeOptionGraphsWithLlm,
  requestStructuredJsonFromLlm,
  resolveGatewayAuth,
  type GatewayAuth,
} from "@/lib/jev/llm-graph-client";
import { SEMANTIC_KIND_HINTS, SEMANTIC_NODE_KINDS } from "@/lib/jev/semantic-graph";

const TEST_AUTH: GatewayAuth = { token: "gw-test-token", method: "api-key" };
const GATEWAY_ENV = [
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "VERCEL",
  "AI_GATEWAY_MODEL",
  ...Object.keys(LLM_ROUTE_MODELS).map((route) => `AI_GATEWAY_MODEL_${route.toUpperCase()}`),
];

function completion(content: string, model = "openai/gpt-4.1-mini"): Response {
  return new Response(
    JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 20 } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("llm-graph-client: Vercel AI Gateway auth", () => {
  // https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc
  it("prefers AI_GATEWAY_API_KEY over any OIDC token", () => {
    expect(
      resolveGatewayAuth({ env: { AI_GATEWAY_API_KEY: " key-1 ", VERCEL: "1", VERCEL_OIDC_TOKEN: "env-oidc" }, oidcHeader: "hdr-oidc" })
    ).toEqual({ token: "key-1", method: "api-key" });
  });

  it("uses the per-request x-vercel-oidc-token header on a Vercel deployment", () => {
    expect(resolveGatewayAuth({ env: { VERCEL: "1", VERCEL_OIDC_TOKEN: "stale" }, oidcHeader: "hdr-oidc" })).toEqual({
      token: "hdr-oidc",
      method: "oidc",
    });
  });

  it("ignores an x-vercel-oidc-token header off Vercel, so callers cannot inject a token", () => {
    expect(resolveGatewayAuth({ env: {}, oidcHeader: "attacker" })).toBeNull();
  });

  it("falls back to VERCEL_OIDC_TOKEN (vercel env pull) when there is no header", () => {
    expect(resolveGatewayAuth({ env: { VERCEL_OIDC_TOKEN: "env-oidc" }, oidcHeader: null })).toEqual({
      token: "env-oidc",
      method: "oidc",
    });
  });

  it("returns null with no credential at all, and blank values count as missing", () => {
    expect(resolveGatewayAuth({ env: {}, oidcHeader: null })).toBeNull();
    expect(resolveGatewayAuth({ env: { AI_GATEWAY_API_KEY: "  ", VERCEL_OIDC_TOKEN: " " }, oidcHeader: " " })).toBeNull();
  });
});

describe("llm-graph-client: structured JSON graph generation & safe fallback", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of GATEWAY_ENV) saved[k] = process.env[k];
    for (const k of GATEWAY_ENV) delete process.env[k];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of GATEWAY_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the AI Gateway chat completions endpoint with the bearer token, a JSON response format and the default model", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(completion(JSON.stringify({ suggestions: [] })));
    vi.stubGlobal("fetch", fetchSpy);
    await proposeContextNodesWithLlm({ auth: { token: "oidc-abc", method: "oidc" }, context: { subjectLabel: "Error Handler", neighborLabels: ["Checkout"] } });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AI_GATEWAY_CHAT_COMPLETIONS_URL);
    expect(AI_GATEWAY_CHAT_COMPLETIONS_URL).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer oidc-abc");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(LLM_ROUTE_MODELS.context);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(String(init.body)).not.toContain("oidc-abc");
  });

  it("lets AI_GATEWAY_MODEL override the model id", async () => {
    process.env.AI_GATEWAY_MODEL = "google/gemini-2.5-flash-lite";
    const fetchSpy = vi.fn().mockResolvedValue(completion(JSON.stringify({ suggestions: [] })));
    vi.stubGlobal("fetch", fetchSpy);
    await proposeContextNodesWithLlm({ auth: TEST_AUTH, context: { subjectLabel: "A", neighborLabels: [] } });
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).model).toBe("google/gemini-2.5-flash-lite");
  });

  for (const [label, failure] of [
    ["401", () => Promise.resolve(new Response("{}", { status: 401 }))],
    ["402 budget", () => Promise.resolve(new Response("{}", { status: 402 }))],
    ["503", () => Promise.resolve(new Response("{}", { status: 503 }))],
    ["timeout", () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))],
  ] as const) {
    it(`returns null on a gateway ${label} so callers fall back`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(failure));
      expect(await generateSemanticGraphWithLlm({ auth: TEST_AUTH, prompt: "x" })).toBeNull();
      expect(await proposeContextNodesWithLlm({ auth: TEST_AUTH, context: { subjectLabel: "A", neighborLabels: [] } })).toBeNull();
    });
  }

  it("validates context node proposals: 1-2 items, strict shape, ids assigned in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion(
          JSON.stringify({
            suggestions: [
              { label: "Payment Retry Worker", sublabel: "Backoff", kind: "node", edgeLabel: "retry" },
              { label: "Refund Check?", kind: "diamond" },
              { label: "Third", kind: "node" },
            ],
          })
        )
      )
    );
    const res = await proposeContextNodesWithLlm({ auth: TEST_AUTH, context: { subjectLabel: "Error Handler", neighborLabels: ["Checkout"], boardTitle: "Shop" } });
    expect(res?.suggestions).toEqual([
      { id: "ctx_0", label: "Payment Retry Worker", sublabel: "Backoff", kind: "node", edgeLabel: "retry" },
      { id: "ctx_1", label: "Refund Check?", kind: "diamond" },
    ]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(JSON.stringify({ suggestions: [{ label: "", kind: "blob" }] }))));
    expect(await proposeContextNodesWithLlm({ auth: TEST_AUTH, context: { subjectLabel: "A", neighborLabels: [] } })).toBeNull();
  });

  it("validates structured SemanticGraph JSON from upstream LLM and falls back to null on invalid/poisoned JSON", async () => {

    const validGraphJson = JSON.stringify({
      notation: "architecture",
      summary: "Search Indexing Pipeline",
      nodes: [
        { id: "doc", label: "Doc API", kind: "node" },
        { id: "q", label: "Index Queue", kind: "node" },
        { id: "es", label: "Search Index", kind: "database" },
      ],
      edges: [
        { from: "doc", to: "q", label: "enqueue", dashed: true },
        { from: "q", to: "es", label: "index" },
      ],
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ message: { content: validGraphJson } }],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ));

    const okRes = await generateSemanticGraphWithLlm({ auth: TEST_AUTH,
      prompt: "search indexing pipeline",
    });
    expect(okRes).not.toBeNull();
    expect(okRes!.graph.nodes).toHaveLength(3);
    expect(okRes!.model).toBe("gpt-4o-mini");

    // Malformed / invalid schema JSON -> returns null safely without throwing
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ message: { content: '{"nodes": "not-an-array"}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ));

    const badRes = await generateSemanticGraphWithLlm({ auth: TEST_AUTH,
      prompt: "bad response",
    });
    expect(badRes).toBeNull();
  });

  it("validates 3 structured Fork takes from upstream LLM and rejects partial/invalid payloads", async () => {

    const validTakes = {
      takes: [
        {
          archetype: "queue_event_driven",
          title: "Async Queue",
          rationale: "Decouples bursts via durable queue",
          tradeoffTag: "Eventual consistency",
          graph: {
            notation: "architecture",
            summary: "Async Queue",
            nodes: [
              { id: "a", label: "API", kind: "node" },
              { id: "q", label: "Queue", kind: "node" },
            ],
            edges: [{ from: "a", to: "q", label: "publish", dashed: true }],
          },
        },
        {
          archetype: "cache_read_replica",
          title: "Cache-First",
          rationale: "Cuts read p99 latency with Redis",
          tradeoffTag: "Cache invalidation",
          graph: {
            notation: "architecture",
            summary: "Cache-First",
            nodes: [
              { id: "a", label: "API", kind: "node" },
              { id: "c", label: "Redis", kind: "database" },
            ],
            edges: [{ from: "a", to: "c", label: "read" }],
          },
        },
        {
          archetype: "gateway_edge_split",
          title: "Edge Gateway",
          rationale: "Isolates edge auth and rate limits",
          tradeoffTag: "Extra hop",
          graph: {
            notation: "architecture",
            summary: "Edge Gateway",
            nodes: [
              { id: "g", label: "Gateway", kind: "node" },
              { id: "a", label: "API", kind: "node" },
            ],
            edges: [{ from: "g", to: "a", label: "route" }],
          },
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ message: { content: JSON.stringify(validTakes) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ));

    const okFork = await generateForkTakesWithLlm({ auth: TEST_AUTH,
      selectedIds: ["sel_1"],
      boardGraph: { version: 1 },
    });
    expect(okFork).not.toBeNull();
    expect(okFork!.takes).toHaveLength(3);

    // Non-2xx upstream status -> drains body and returns null
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      body: { cancel: cancelSpy },
    }));

    const failedFork = await generateForkTakesWithLlm({ auth: TEST_AUTH,
      selectedIds: ["sel_1"],
      boardGraph: { version: 1 },
    });
    expect(failedFork).toBeNull();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("validates structured MorphSemanticSpec JSON", async () => {

    const validMorphSpec = {
      summary: "Checkout ER Model",
      actors: [
        { id: "n1", label: "Order", kind: "node" },
        { id: "n2", label: "Payment", kind: "database" },
      ],
      messages: [
        { id: "m1", from: "n1", to: "n2", label: "settle", order: 1 },
      ],
      steps: [
        { id: "n1", label: "Order", kind: "process", branches: [{ to: "n2" }] },
        { id: "n2", label: "Payment", kind: "end" },
      ],
      states: [
        { id: "n1", label: "Pending", initial: true },
        { id: "n2", label: "Paid", terminal: true },
      ],
      transitions: [{ id: "t1", from: "n1", to: "n2", event: "settle" }],
      entities: [
        { id: "n1", name: "Order", attributes: ["PK id: uuid", "total_cents: int"] },
        { id: "n2", name: "Payment", attributes: ["PK id: uuid", "FK order_id: uuid"] },
      ],
      relations: [{ id: "r1", from: "n1", to: "n2", cardinality: "1:N", label: "settled_by" }],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ message: { content: JSON.stringify(validMorphSpec) } }],
          usage: { prompt_tokens: 90 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ));

    const morphRes = await generateMorphSpecWithLlm({ auth: TEST_AUTH,
      targetNotation: "er",
      selectedIds: ["a", "b"],
      boardGraph: { version: 1 },
      selection: { actors: validMorphSpec.actors.map(({ id, label }) => ({ id, label })), messages: validMorphSpec.messages },
    });
    expect(morphRes).not.toBeNull();
    expect(morphRes!.spec.entities).toHaveLength(2);
    expect(morphRes!.spec.messages.map((m) => m.label)).toEqual(["settle"]);
  });

  it("drops refined messages that are not arrows in the selection and never asks for synthesized returns", async () => {
    const actors = [
      { id: "n1", label: "API" },
      { id: "n2", label: "URL DB" },
    ];
    const invented = {
      summary: "Create link",
      actors: [...actors, { id: "n3", label: "Redis" }],
      messages: [
        { id: "m1", from: "n1", to: "n2", label: "INSERT", order: 1 },
        { id: "m2", from: "n2", to: "n1", label: "rows", order: 2, isReturn: true },
        { id: "m3", from: "n1", to: "n3", label: "ack / result", order: 3 },
      ],
      steps: [],
      states: [],
      transitions: [],
      entities: [],
      relations: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify(invented) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const res = await generateMorphSpecWithLlm({ auth: TEST_AUTH,
      targetNotation: "sequence",
      selectedIds: ["n1", "n2"],
      boardGraph: { version: 1 },
      selection: { actors, messages: [{ id: "a1", from: "n1", to: "n2", label: "INSERT", order: 1 }] },
    });
    expect(res!.spec.messages.map((m) => m.label)).toEqual(["INSERT"]);
    expect(res!.spec.actors.map((a) => a.id)).toEqual(["n1", "n2"]);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).not.toContain("every sync call gets an isReturn");

  });
});

describe("llm-graph-client: notation kinds offered to the model", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function systemPromptOf(fetchSpy: ReturnType<typeof vi.fn>): string {
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    return body.messages.find((m) => m.role === "system")?.content ?? "";
  }

  it("generate_graph prompt lists every semantic kind with its meaning, plus arrow end markers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(completion("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await generateSemanticGraphWithLlm({ auth: TEST_AUTH, prompt: "url shortener" });
    const prompt = systemPromptOf(fetchSpy);
    for (const kind of SEMANTIC_NODE_KINDS) {
      expect(prompt).toContain(`"${kind}"`);
      expect(prompt).toContain(`${kind}=${SEMANTIC_KIND_HINTS[kind]}`);
    }
    expect(prompt).toContain('"startEnd"?');
    expect(prompt).toContain("er_zero_many");
    expect(prompt.length).toBeLessThan(2400);
  });

  it("fork prompt offers the HLD kinds", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(completion("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await generateForkTakesWithLlm({ auth: TEST_AUTH, selectedIds: ["a"], boardGraph: {} });
    const prompt = systemPromptOf(fetchSpy);
    for (const kind of ["queue", "cache", "lb", "blob", "external", "actor"]) {
      expect(prompt).toContain(`"${kind}"`);
    }
  });

  it("accepts a model graph that uses HLD/LLD kinds and end markers, and rejects an unknown kind", async () => {
    const graph = {
      notation: "architecture",
      summary: "Shortener",
      nodes: [
        { id: "u", label: "User", kind: "actor" },
        { id: "cdn", label: "CloudFront", kind: "lb" },
        { id: "api", label: "Shorten API", kind: "node" },
        { id: "c", label: "Redis", kind: "cache" },
        { id: "q", label: "Click Stream", kind: "queue" },
        { id: "t", label: "urls", sublabel: "code text PK\nlong_url text", kind: "entity" },
      ],
      edges: [
        { from: "u", to: "cdn" },
        { from: "cdn", to: "api" },
        { from: "api", to: "c" },
        { from: "api", to: "q", dashed: true, endEnd: "open" },
        { from: "api", to: "t" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(JSON.stringify(graph))));
    const ok = await generateSemanticGraphWithLlm({ auth: TEST_AUTH, prompt: "url shortener" });
    expect(ok?.graph.nodes.map((n) => n.kind)).toEqual(["actor", "lb", "node", "cache", "queue", "entity"]);
    expect(ok?.graph.edges[3].endEnd).toBe("open");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(completion(JSON.stringify({ ...graph, nodes: [...graph.nodes, { id: "x", label: "X", kind: "hexagon" }] })))
    );
    expect(await generateSemanticGraphWithLlm({ auth: TEST_AUTH, prompt: "url shortener" })).toBeNull();
  });
});

describe("llm-graph-client: constraint-driven Fork", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function requestOf(fetchSpy: ReturnType<typeof vi.fn>) {
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    return {
      system: body.messages.find((m) => m.role === "system")?.content ?? "",
      user: body.messages.find((m) => m.role === "user")?.content ?? "",
    };
  }

  const graph = {
    notation: "architecture",
    summary: "Cache-aside",
    nodes: [
      { id: "a", label: "API", kind: "node" },
      { id: "c", label: "Redis", kind: "cache" },
    ],
    edges: [{ from: "a", to: "c", label: "get" }],
  };
  const costs = ["latency", "money", "consistency", "complexity", "ops"].map((axis) => ({
    axis,
    text: `${axis} line`,
    severity: 2,
  }));
  const take = {
    archetype: "cache_aside",
    title: "Cache-aside",
    rationale: "Serves hot reads from Redis",
    tradeoffTag: "Stale reads",
    buys: "p99 read ≈ 5-20 ms on hit vs 50-150 ms DB (typical)",
    costs,
    failureMode: "Stampede when hot keys expire together",
    graph,
  };

  it("sends the constraint and asks for buys, costs on all five axes and a failure mode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(completion(JSON.stringify({ takes: [take, take, take] })));
    vi.stubGlobal("fetch", fetchSpy);
    const constraint = {
      pressure: "latency" as const,
      target: { metric: "p99", comparator: "<" as const, value: 100, unit: "ms", text: "p99 < 100 ms" },
    };
    const res = await generateForkTakesWithLlm({ auth: TEST_AUTH, selectedIds: ["a"], boardGraph: {}, constraint });
    const { system, user } = requestOf(fetchSpy);
    for (const field of ['"buys"', '"costs"', '"failureMode"', '"severity"', "typical"]) {
      expect(system).toContain(field);
    }
    for (const axis of ["latency", "money", "consistency", "complexity", "ops"]) expect(system).toContain(`"${axis}"`);
    expect(JSON.parse(user).constraint).toEqual(constraint);
    expect(res?.takes[0].tradeoffs?.pressure).toBe("latency");
    expect(res?.takes[0].tradeoffs?.costs).toHaveLength(5);
  });

  it("returns null when a constrained answer leaves out the trade-offs, so the catalogue runs instead", async () => {
    const bare = { ...take, buys: undefined, costs: undefined, failureMode: undefined };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(JSON.stringify({ takes: [bare, bare, bare] }))));
    expect(
      await generateForkTakesWithLlm({
        auth: TEST_AUTH,
        selectedIds: ["a"],
        boardGraph: {},
        constraint: { pressure: "latency" },
      })
    ).toBeNull();
  });

  it("keeps the classic prompt when no constraint is stated", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(completion("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await generateForkTakesWithLlm({ auth: TEST_AUTH, selectedIds: ["a"], boardGraph: {} });
    const { system, user } = requestOf(fetchSpy);
    expect(system).not.toContain('"failureMode"');
    expect(JSON.parse(user).constraint).toBeUndefined();
  });
});

describe("generation budgets (real gateway: 3 fork takes timed out at the 6.5 s default)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives fork take generation a long enough budget for three full graphs", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await generateForkTakesWithLlm({ auth: TEST_AUTH, selectedIds: ["a"], boardGraph: {} });
    const budgets = timeoutSpy.mock.calls.map((c) => c[0]);
    expect(Math.max(...budgets)).toBeGreaterThanOrEqual(20000);
  });
});

describe("llm-graph-client: per-route model selection", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of GATEWAY_ENV) saved[k] = process.env[k];
    for (const k of GATEWAY_ENV) delete process.env[k];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of GATEWAY_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Model eval 22 Nov 2026 (evals/models/RESULTS.md on branch model-eval): Haiku 5.5 wins context, practice review,
  // moves and morph. Fork is not 100% valid on Haiku, as 86ec8d5 said from its first 20 calls: on answers generated
  // after the validator fix it is 67/70 valid vs 68/70 for gpt-4.1-mini, judge 8.1 vs 5.3. Charles kept Haiku and
  // waived "at least as valid" (decision 7A, 22 Nov 2026). next_options and generate keep gpt-4.1-mini.
  // Changing a route's model needs a re-run of that eval, then this pin.
  it("pins the model every gateway route uses", () => {
    expect(DEFAULT_AI_GATEWAY_MODEL).toBe("openai/gpt-4.1-mini");
    expect(LLM_ROUTE_MODELS).toEqual({
      context: "anthropic/claude-haiku-5.5",
      practice_review: "anthropic/claude-haiku-5.5",
      moves: "anthropic/claude-haiku-5.5",
      morph: "anthropic/claude-haiku-5.5",
      next_options: "openai/gpt-4.1-mini",
      fork: "anthropic/claude-haiku-5.5",
      generate_graph: "openai/gpt-4.1-mini",
    });
  });

  const sentBody = (fetchSpy: ReturnType<typeof vi.fn>) =>
    JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { model: string; reasoning_effort?: string };

  const callers: Array<[string, () => Promise<unknown>]> = [
    ["context", () => proposeContextNodesWithLlm({ auth: TEST_AUTH, context: { subjectLabel: "A", neighborLabels: [] } })],
    [
      "practice_review",
      () =>
        generatePracticeReviewWithLlm({ auth: TEST_AUTH, promptId: "url-shortener", boardGraph: { nodes: [] }, rubric: [], comments: [] }),
    ],
    [
      "morph",
      () =>
        generateMorphSpecWithLlm({
          auth: TEST_AUTH,
          targetNotation: "sequence",
          selectedIds: ["a"],
          boardGraph: {},
          selection: { actors: [], messages: [] },
        }),
    ],
    [
      "next_options",
      () => proposeOptionGraphsWithLlm({ auth: TEST_AUTH, request: { conceptLabel: "Cache", selectedLabels: [], boardLabels: [] } }),
    ],
    ["fork", () => generateForkTakesWithLlm({ auth: TEST_AUTH, selectedIds: ["a"], boardGraph: {} })],
    ["generate_graph", () => generateSemanticGraphWithLlm({ auth: TEST_AUTH, prompt: "url shortener" })],
  ];

  for (const [route, call] of callers) {
    it(`${route} sends its pinned model with reasoning_effort "none"`, async () => {
      const fetchSpy = vi.fn().mockResolvedValue(completion("{}"));
      vi.stubGlobal("fetch", fetchSpy);
      await call();
      expect(sentBody(fetchSpy).model).toBe(LLM_ROUTE_MODELS[route as keyof typeof LLM_ROUTE_MODELS]);
      expect(sentBody(fetchSpy).reasoning_effort).toBe("none");
    });
  }

  it("AI_GATEWAY_MODEL overrides every route; AI_GATEWAY_MODEL_<ROUTE> overrides one route and wins over it", async () => {
    process.env.AI_GATEWAY_MODEL = "google/gemini-3.5-flash-lite";
    process.env.AI_GATEWAY_MODEL_MORPH = " openai/gpt-6-luna ";
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(completion("{}")));
    vi.stubGlobal("fetch", fetchSpy);
    for (const route of ["context", "morph", "fork"] as const) {
      await requestStructuredJsonFromLlm({ auth: TEST_AUTH, route, systemPrompt: "s", userPayload: {} });
    }
    const models = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).model);
    expect(models).toEqual(["google/gemini-3.5-flash-lite", "openai/gpt-6-luna", "google/gemini-3.5-flash-lite"]);
  });

  it("a blank override counts as unset", async () => {
    process.env.AI_GATEWAY_MODEL = " ";
    process.env.AI_GATEWAY_MODEL_CONTEXT = "";
    const fetchSpy = vi.fn().mockResolvedValue(completion("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await requestStructuredJsonFromLlm({ auth: TEST_AUTH, route: "context", systemPrompt: "s", userPayload: {} });
    expect(sentBody(fetchSpy).model).toBe("anthropic/claude-haiku-5.5");
  });
});

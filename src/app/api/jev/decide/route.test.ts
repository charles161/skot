import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCallTypeSafeJev = vi.fn();
const mockResolveJevTransport = vi.fn();
const LIVE_TRANSPORT = { via: "direct", url: "https://api.typesafe.ai/v1/systemone", token: "t", model: "jev-latest" };

const { resolveJevTransport: realResolveJevTransport } = await vi.importActual<
  typeof import("@/lib/jev/typesafe-client")
>("@/lib/jev/typesafe-client");

vi.mock("@/lib/jev/typesafe-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/jev/typesafe-client")>();
  return {
    ...actual,
    callTypeSafeJev: (...args: unknown[]) => mockCallTypeSafeJev(...args),
    resolveJevTransport: (...args: unknown[]) => mockResolveJevTransport(...args),
  };
});

import { POST } from "@/app/api/jev/decide/route";
import { resetDecideStateForTests } from "@/lib/server/decide-state";

function makeDecideRequest(body: unknown, ip = "198.51.100.50"): NextRequest {
  return new NextRequest("http://localhost/api/jev/decide", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/jev/decide (Blockers 7 & 8 + M1 guardrails)", () => {
  beforeEach(() => {
    mockCallTypeSafeJev.mockReset();
    mockResolveJevTransport.mockReset();
    mockResolveJevTransport.mockImplementation(realResolveJevTransport);
    resetDecideStateForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Blocker 8: labels heuristic fallback honestly and omits fake model probabilities", async () => {
    mockResolveJevTransport.mockReturnValue(null);

    // rank_actions
    const rankRes = await POST(
      makeDecideRequest({
        mode: "rank_actions",
        stateSummary: "Nodes: App",
        candidates: [
          {
            id: "c1",
            title: "Add API Gateway",
            subtitle: "Route traffic",
            category: "extend",
          },
          {
            id: "c2",
            title: "Add Postgres",
            subtitle: "Store data",
            category: "extend",
          },
        ],
      })
    );
    expect(rankRes.status).toBe(200);
    expect(rankRes.headers.get("cache-control")).toBe("no-store");
    const rankJson = (await rankRes.json()) as Record<string, unknown>;
    expect(rankJson.source).toBe("heuristic");
    expect(rankJson.isHeuristic).toBe(true);
    expect(rankJson.nextActionProbabilities).toBeNull();
    expect(rankJson.nextActionConfidence).toBeNull();
    expect(rankJson.shouldConnectProb).toBeNull();

    // place_diagram
    const placeRes = await POST(
      makeDecideRequest({
        mode: "place_diagram",
        prompt: "server",
        stateSummary: "Nodes: App",
        classifyPattern: false,
        candidates: [
          {
            id: "viewport_center",
            label: "Center",
            description: "Center slot",
            prior: 0.8,
          },
        ],
        connectTargets: [
          {
            id: "node_app",
            label: "Connect to App",
            description: "Connect App -> server",
            prior: 0.9,
          },
          {
            id: "none",
            label: "Standalone",
            description: "Place independently",
            prior: 0.2,
          },
        ],
      })
    );
    expect(placeRes.status).toBe(200);
    const placeJson = (await placeRes.json()) as Record<string, unknown>;
    expect(placeJson.source).toBe("heuristic");
    expect(placeJson.isHeuristic).toBe(true);
    expect(placeJson.chosenSlotId).toBe("viewport_center");
    expect(placeJson.connectTargetId).toBe("node_app");
    expect(placeJson.slotProbabilities).toBeNull();
    expect(placeJson.slotConfidence).toBeNull();
    expect(placeJson.connectProbabilities).toBeNull();
    expect(placeJson.connectConfidence).toBeNull();
    expect(placeJson.shouldConnectProb).toBeNull();
    expect(placeJson.isFlowIterationProb).toBeNull();

    // classify_prompt
    const classifyRes = await POST(
      makeDecideRequest({
        mode: "classify_prompt",
        prompt: "auth flow",
      })
    );
    expect(classifyRes.status).toBe(200);
    const classifyJson = (await classifyRes.json()) as Record<string, unknown>;
    expect(classifyJson.source).toBe("heuristic");
    expect(classifyJson.isHeuristic).toBe(true);
    expect(classifyJson.confidence).toBeNull();
  });

  it("Blocker 7: caches live TypeSafe responses by normalized request hash to prevent repeat cost burn", async () => {
    mockResolveJevTransport.mockReturnValue(LIVE_TRANSPORT);
    mockCallTypeSafeJev.mockResolvedValue({
      latencyMs: 42,
      source: "typesafe-jev",
      response: {
        model: "jev-latest",
        answers: {
          diagram_pattern: {
            type: "choice",
            choice: "auth_flow",
            confidence: 0.91,
            probabilities: { auth_flow: 0.91, custom_flow: 0.09 },
          },
          needs_decision: {
            type: "noul",
            noul: 0.85,
          },
        },
      },
    });

    const res1 = await POST(
      makeDecideRequest(
        { mode: "classify_prompt", prompt: "OAuth   login flow" },
        "198.51.100.60"
      )
    );
    expect(res1.status).toBe(200);
    const json1 = (await res1.json()) as Record<string, unknown>;
    expect(json1.source).toBe("typesafe-jev");
    expect(json1.isHeuristic).toBe(false);
    expect(json1.pattern).toBe("auth_flow");
    expect(json1.confidence).toBe(0.91);
    expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(1);

    // Equivalent prompt with different spacing/casing hits bounded response cache
    const res2 = await POST(
      makeDecideRequest(
        { mode: "classify_prompt", prompt: "  oauth login   flow " },
        "198.51.100.61"
      )
    );
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as Record<string, unknown>;
    expect(json2.source).toBe("typesafe-jev");
    expect(json2.pattern).toBe("auth_flow");
    expect(json2.cached).toBe(true);
    expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(1);
  });

  it("Blocker 7 + M1: enforces per-IP rate limits (429 + Retry-After) and UTF-8 byte caps (413)", async () => {
    mockResolveJevTransport.mockReturnValue(null);

    // Multi-byte UTF-8 > 32 KB (UTF-16 char length < 32768) -> 413
    const hugeUtf8 = JSON.stringify({
      mode: "classify_prompt",
      prompt: "🚀".repeat(10_000),
    });
    const oversizedRes = await POST(
      makeDecideRequest(hugeUtf8, "198.51.100.70")
    );
    expect(oversizedRes.status).toBe(413);
    expect(oversizedRes.headers.get("cache-control")).toBe("no-store");

    // Per-IP burst triggers 429 + Retry-After
    const burstIp = "198.51.100.71";
    let rateLimitedRes: Response | null = null;
    for (let i = 0; i < 35; i++) {
      const res = await POST(
        makeDecideRequest(
          { mode: "classify_prompt", prompt: `flow ${i}` },
          burstIp
        )
      );
      if (res.status === 429) {
        rateLimitedRes = res;
        break;
      }
    }
    expect(rateLimitedRes).not.toBeNull();
    expect(Number(rateLimitedRes?.headers.get("retry-after"))).toBeGreaterThan(
      0
    );
    expect(rateLimitedRes?.headers.get("cache-control")).toBe("no-store");
  });

  it("Review (c): stops calling TypeSafe upstream once global spend cap is reached and returns honest heuristic fallback", async () => {
    const origMin = process.env.JEV_UPSTREAM_MAX_PER_MINUTE;
    const origDay = process.env.JEV_UPSTREAM_MAX_PER_DAY;
    process.env.JEV_UPSTREAM_MAX_PER_MINUTE = "2";
    process.env.JEV_UPSTREAM_MAX_PER_DAY = "10";

    try {
      mockResolveJevTransport.mockReturnValue(LIVE_TRANSPORT);
      mockCallTypeSafeJev.mockResolvedValue({
        latencyMs: 30,
        source: "typesafe-jev",
        response: {
          model: "jev-latest",
          answers: {
            diagram_pattern: {
              type: "choice",
              choice: "microservices",
              confidence: 0.89,
              probabilities: { microservices: 0.89, custom_flow: 0.11 },
            },
            needs_decision: { type: "noul", noul: 0.2 },
          },
        },
      });

      // Call 1 & 2 hit upstream (distinct prompts so cache doesn't intercept)
      const r1 = await POST(
        makeDecideRequest({ mode: "classify_prompt", prompt: "budget prompt 1" })
      );
      const r2 = await POST(
        makeDecideRequest({ mode: "classify_prompt", prompt: "budget prompt 2" })
      );
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(2);

      // Call 3 exceeds global per-minute cap -> skips upstream, returns honest heuristic fallback
      const r3 = await POST(
        makeDecideRequest({ mode: "classify_prompt", prompt: "budget prompt 3" })
      );
      expect(r3.status).toBe(200);
      expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(2);
      const json3 = (await r3.json()) as Record<string, unknown>;
      expect(json3.source).toBe("heuristic");
      expect(json3.isHeuristic).toBe(true);
      expect(json3.confidence).toBeNull();
    } finally {
      if (origMin === undefined) delete process.env.JEV_UPSTREAM_MAX_PER_MINUTE;
      else process.env.JEV_UPSTREAM_MAX_PER_MINUTE = origMin;
      if (origDay === undefined) delete process.env.JEV_UPSTREAM_MAX_PER_DAY;
      else process.env.JEV_UPSTREAM_MAX_PER_DAY = origDay;
    }
  });

  it("Chunk 5a: accepts compact structured boardGraph + preferenceSummary in rank_actions and passes structured state upstream", async () => {
    mockResolveJevTransport.mockReturnValue(LIVE_TRANSPORT);
    mockCallTypeSafeJev.mockResolvedValue({
      latencyMs: 38,
      source: "typesafe-jev",
      response: {
        model: "jev-latest",
        answers: {
          user_intent: {
            type: "choice",
            choice: "open_pipeline_gap",
            confidence: 0.88,
            probabilities: { open_pipeline_gap: 0.88, extend_flow: 0.12 },
          },
          next_action: {
            type: "choice",
            choice: "c1",
            confidence: 0.82,
            probabilities: { c1: 0.82, c2: 0.18 },
          },
          should_auto_connect: { type: "noul", noul: 0.9 },
        },
      },
    });

    const boardGraph = {
      version: 1 as const,
      notation: "architecture" as const,
      boardTitle: "Checkout",
      stats: { totalNodes: 2, totalEdges: 1, totalGroups: 0, truncated: false },
      nodes: [
        { id: "n1", label: "API", kind: "node" as const, tone: "cobalt" as const, x: 0, y: 0 },
        { id: "n2", label: "Postgres", kind: "database" as const, tone: "teal" as const, x: 400, y: 0 },
      ],
      edges: [{ id: "a1", from: "n1", to: "n2", label: "sql" }],
      groups: [],
      selectedIds: ["n2"],
      recentDeltas: [{ op: "move" as const, summary: "Moved Postgres right", elementIds: ["n2"], dx: 180, dy: 0 }],
      canonicalHash: "abc12345",
    };

    const res = await POST(
      makeDecideRequest({
        mode: "rank_actions",
        boardGraph,
        intentSummary: "Opened gap between API and Postgres",
        preferenceSummary: {
          preferred: ["cat:extend", "fork:cache_read_replica"],
          avoided: ["cat:structure"],
          totalAccepted: 5,
          totalRejected: 2,
        },
        candidates: [
          { id: "c1", title: "Insert Redis Cache", subtitle: "Cache-aside", category: "extend" },
          { id: "c2", title: "Frame pipeline", subtitle: "Group", category: "structure" },
        ],
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.source).toBe("typesafe-jev");
    expect(json.isHeuristic).toBe(false);
    expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(1);

    // Passes structured object state rather than raw 6k text dump
    const callArg = mockCallTypeSafeJev.mock.calls[0][0] as { state: unknown };
    expect(typeof callArg.state).toBe("object");
    expect(callArg.state).toMatchObject({
      boardGraph: expect.objectContaining({ canonicalHash: "abc12345" }),
    });
  });

  it("Chunk 5a: generate_graph returns validated heuristic semantic graph when key unset and caches live upstream graph responses", async () => {
    mockResolveJevTransport.mockReturnValue(null);

    const heuristicRes = await POST(
      makeDecideRequest({
        mode: "generate_graph",
        prompt: "event-driven order pipeline with kafka and postgres",
      })
    );
    expect(heuristicRes.status).toBe(200);
    const hJson = (await heuristicRes.json()) as Record<string, unknown>;
    expect(hJson.source).toBe("heuristic");
    expect(hJson.isHeuristic).toBe(true);
    expect(hJson.confidence).toBeNull();
    expect(hJson.graph).toBeDefined();
    expect(Array.isArray((hJson.graph as { nodes: unknown[] }).nodes)).toBe(true);

    // Live TypeSafe mode scores archetype + caches by canonical hash
    mockResolveJevTransport.mockReturnValue(LIVE_TRANSPORT);
    mockCallTypeSafeJev.mockResolvedValue({
      latencyMs: 44,
      source: "typesafe-jev",
      response: {
        model: "jev-latest",
        answers: {
          diagram_pattern: {
            type: "choice",
            choice: "microservices",
            confidence: 0.9,
            probabilities: { microservices: 0.9, custom_flow: 0.1 },
          },
          needs_decision: { type: "noul", noul: 0.3 },
        },
      },
    });

    const liveRes1 = await POST(
      makeDecideRequest(
        {
          mode: "generate_graph",
          prompt: "Distributed SaaS backend",
        },
        "198.51.100.81"
      )
    );
    expect(liveRes1.status).toBe(200);
    const liveJson1 = (await liveRes1.json()) as Record<string, unknown>;
    expect(liveJson1.source).toBe("typesafe-jev");
    expect(liveJson1.isHeuristic).toBe(false);
    expect(liveJson1.confidence).toBe(0.9);
    expect(liveJson1.graph).toBeDefined();
    expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(1);

    const liveRes2 = await POST(
      makeDecideRequest(
        {
          mode: "generate_graph",
          prompt: "  distributed   saas backend ",
        },
        "198.51.100.82"
      )
    );
    expect(liveRes2.status).toBe(200);
    const liveJson2 = (await liveRes2.json()) as Record<string, unknown>;
    expect(liveJson2.cached).toBe(true);
    expect(mockCallTypeSafeJev).toHaveBeenCalledTimes(1);
  });

  it("Chunk 5a: fork_architecture returns 3 validated takes honestly labeled Heuristic without key and ranks via TypeSafe when configured", async () => {
    const baseForkPayload = {
      mode: "fork_architecture" as const,
      selectedIds: ["sel_api", "sel_db"],
      boardGraph: {
        version: 1 as const,
        notation: "architecture" as const,
        stats: { totalNodes: 2, totalEdges: 1, totalGroups: 0, truncated: false },
        nodes: [
          { id: "sel_api", label: "Billing API", kind: "node" as const, tone: "cobalt" as const, x: 100, y: 100 },
          { id: "sel_db", label: "Billing DB", kind: "database" as const, tone: "teal" as const, x: 380, y: 100 },
        ],
        edges: [{ id: "a1", from: "sel_api", to: "sel_db", label: "write" }],
        groups: [],
        selectedIds: ["sel_api", "sel_db"],
        recentDeltas: [],
        canonicalHash: "forkhash01",
      },
      candidateTakes: [
        {
          archetype: "queue_event_driven" as const,
          title: "Queue / Event-Driven",
          rationale: "Buffers Billing API writes via an async event queue",
          tradeoffTag: "Eventual consistency",
        },
        {
          archetype: "cache_read_replica" as const,
          title: "Cache-First / Read Replica",
          rationale: "Adds Redis cache-aside and read replica for Billing DB",
          tradeoffTag: "Cache invalidation",
        },
        {
          archetype: "gateway_edge_split" as const,
          title: "Gateway / Edge-Split",
          rationale: "Fronts Billing API with auth and rate-limiting gateway",
          tradeoffTag: "Extra network hop",
        },
      ],
    };

    mockResolveJevTransport.mockReturnValue(null);
    const hRes = await POST(makeDecideRequest(baseForkPayload, "198.51.100.90"));
    expect(hRes.status).toBe(200);
    const hJson = (await hRes.json()) as Record<string, unknown>;
    expect(hJson.source).toBe("heuristic");
    expect(hJson.isHeuristic).toBe(true);
    expect(hJson.confidence).toBeNull();
    expect(hJson.takeProbabilities).toBeNull();

    // Live TypeSafe ranking of the 3 takes
    mockResolveJevTransport.mockReturnValue(LIVE_TRANSPORT);
    mockCallTypeSafeJev.mockResolvedValue({
      latencyMs: 52,
      source: "typesafe-jev",
      response: {
        model: "jev-latest",
        answers: {
          best_fork_take: {
            type: "choice",
            choice: "cache_read_replica",
            confidence: 0.76,
            probabilities: {
              cache_read_replica: 0.76,
              queue_event_driven: 0.16,
              gateway_edge_split: 0.08,
            },
          },
        },
      },
    });

    const liveRes = await POST(makeDecideRequest(baseForkPayload, "198.51.100.91"));
    expect(liveRes.status).toBe(200);
    const liveJson = (await liveRes.json()) as Record<string, unknown>;
    expect(liveJson.source).toBe("typesafe-jev");
    expect(liveJson.isHeuristic).toBe(false);
    expect(liveJson.recommendedArchetype).toBe("cache_read_replica");
    expect(liveJson.confidence).toBe(0.76);
    expect(liveJson.takeProbabilities).toEqual({
      cache_read_replica: 0.76,
      queue_event_driven: 0.16,
      gateway_edge_split: 0.08,
    });
  });

  it("Chunk 5b: morph_notation returns honest Heuristic fallback without gateway auth and validates/caches live gateway spec", async () => {
    const origLlmKey = process.env.AI_GATEWAY_API_KEY;
    const origFetch = globalThis.fetch;
    delete process.env.AI_GATEWAY_API_KEY;

    const morphPayload = {
      mode: "morph_notation" as const,
      targetNotation: "sequence" as const,
      selectedIds: ["n1", "n2"],
      boardGraph: {
        version: 1 as const,
        notation: "sketch" as const,
        stats: { totalNodes: 2, totalEdges: 1, totalGroups: 0, truncated: false },
        nodes: [
          { id: "n1", label: "Order API", kind: "node" as const, tone: "cobalt" as const, x: 100, y: 100 },
          { id: "n2", label: "Postgres", kind: "database" as const, tone: "teal" as const, x: 380, y: 100 },
        ],
        edges: [{ id: "a1", from: "n1", to: "n2", label: "insert" }],
        groups: [],
        selectedIds: ["n1", "n2"],
        recentDeltas: [],
        canonicalHash: "morphhash01",
      },
    };

    try {
      const heuristicRes = await POST(
        makeDecideRequest(morphPayload, "198.51.100.110")
      );
      expect(heuristicRes.status).toBe(200);
      const hJson = (await heuristicRes.json()) as Record<string, unknown>;
      expect(hJson.source).toBe("heuristic");
      expect(hJson.isHeuristic).toBe(true);
      expect(hJson.spec).toBeNull();

      // Live structured LLM refinement + response cache
      process.env.AI_GATEWAY_API_KEY = "dummy-morph";
      const validSpec = {
        summary: "Order persistence sequence",
        actors: [
          { id: "n1", label: "Order API", kind: "node", tone: "cobalt" },
          { id: "n2", label: "Postgres", kind: "database", tone: "teal" },
        ],
        messages: [
          { id: "m1", from: "n1", to: "n2", label: "INSERT order", order: 1 },
          { id: "m2", from: "n2", to: "n1", label: "order_id", order: 2, isReturn: true },
        ],
        steps: [
          { id: "s1", label: "Start", kind: "start" },
          { id: "s2", label: "Order API", kind: "process" },
          { id: "s3", label: "Done", kind: "end" },
        ],
        states: [
          { id: "st1", label: "Order Received", initial: true },
          { id: "st2", label: "Persisted", terminal: true },
        ],
        transitions: [
          { id: "t1", from: "st1", to: "st2", event: "insert" },
        ],
        entities: [
          { id: "e1", name: "Order", attributes: ["PK id: uuid", "status: text"] },
        ],
        relations: [],
      };

      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "gpt-4o-mini",
            choices: [{ message: { content: JSON.stringify(validSpec) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const live1 = await POST(
        makeDecideRequest(morphPayload, "198.51.100.111")
      );
      expect(live1.status).toBe(200);
      const l1Json = (await live1.json()) as Record<string, unknown>;
      expect(l1Json.source).toBe("llm-json");
      expect(l1Json.isHeuristic).toBe(false);
      expect(l1Json.spec).toBeDefined();
      // The model's "order_id" return has no arrow in the selection (only n1 -> n2 "insert"), so it is dropped.
      const refinedMessages = (l1Json.spec as { messages: Array<{ label: string }> }).messages;
      expect(refinedMessages.map((m) => m.label)).toEqual(["INSERT order"]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const live2 = await POST(
        makeDecideRequest(morphPayload, "198.51.100.112")
      );
      expect(live2.status).toBe(200);
      const l2Json = (await live2.json()) as Record<string, unknown>;
      expect(l2Json.cached).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (origLlmKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = origLlmKey;
      globalThis.fetch = origFetch;
    }
  });

  it("generate_graph passes HLD/LLD kinds and end markers from the gateway through, and falls back on an unknown kind", async () => {
    const origLlmKey = process.env.AI_GATEWAY_API_KEY;
    const origFetch = globalThis.fetch;
    process.env.AI_GATEWAY_API_KEY = "dummy-kinds";
    const graph = {
      notation: "architecture",
      summary: "Shortener",
      nodes: [
        { id: "u", label: "User", kind: "actor" },
        { id: "lb", label: "ALB", kind: "lb" },
        { id: "api", label: "Shorten API", kind: "node" },
        { id: "q", label: "Kafka", kind: "queue" },
        { id: "c", label: "Redis", kind: "cache" },
        { id: "b", label: "S3", kind: "blob" },
        { id: "s", label: "Stripe", kind: "external" },
        { id: "e", label: "urls", sublabel: "code text PK", kind: "entity" },
        { id: "k", label: "Url", sublabel: "- code\n--\n+ resolve()", kind: "class" },
      ],
      edges: [
        { from: "u", to: "lb" },
        { from: "lb", to: "api" },
        { from: "api", to: "q", endEnd: "open", dashed: true },
        { from: "e", to: "k", startEnd: "er_only_one", endEnd: "er_zero_many" },
      ],
    };
    const reply = (g: unknown) =>
      new Response(JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify(g) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      globalThis.fetch = vi.fn().mockResolvedValue(reply(graph)) as unknown as typeof fetch;
      const ok = await POST(makeDecideRequest({ mode: "generate_graph", prompt: "url shortener kinds" }, "198.51.100.130"));
      expect(ok.status).toBe(200);
      const okJson = (await ok.json()) as { source: string; graph: { nodes: Array<{ kind: string }>; edges: Array<{ endEnd?: string }> } };
      expect(okJson.source).toBe("llm-json");
      expect(okJson.graph.nodes.map((n) => n.kind)).toEqual(["actor", "lb", "node", "queue", "cache", "blob", "external", "entity", "class"]);
      expect(okJson.graph.edges.map((e) => e.endEnd)).toEqual([undefined, undefined, "open", "er_zero_many"]);

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(reply({ ...graph, nodes: [{ id: "x", label: "X", kind: "pentagon" }] })) as unknown as typeof fetch;
      const bad = await POST(makeDecideRequest({ mode: "generate_graph", prompt: "url shortener garbage" }, "198.51.100.131"));
      expect(bad.status).toBe(200);
      const badJson = (await bad.json()) as { source: string; isHeuristic: boolean; graph: { nodes: Array<{ kind: string }> } };
      expect(badJson.source).toBe("heuristic");
      expect(badJson.isHeuristic).toBe(true);
      expect(badJson.graph.nodes.some((n) => n.kind === "pentagon")).toBe(false);
    } finally {
      if (origLlmKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = origLlmKey;
      globalThis.fetch = origFetch;
    }
  });

  it("rejects the removed talk_to_draw mode as an invalid request", async () => {
    const res = await POST(
      makeDecideRequest(
        { mode: "talk_to_draw", utterance: "this caches the reads", boardGraph: { version: 1 } },
        "198.51.100.120"
      )
    );
    expect(res.status).toBe(400);
  });

  it("fork_architecture takes a stated constraint: model takes carry trade-offs, a bad model answer falls back to the catalogue", async () => {
    const origLlmKey = process.env.AI_GATEWAY_API_KEY;
    const origFetch = globalThis.fetch;
    mockCallTypeSafeJev.mockRejectedValue(new Error("ranker unavailable"));
    const payload = {
      mode: "fork_architecture" as const,
      selectedIds: ["sel_api", "sel_db"],
      boardGraph: {
        version: 1 as const,
        notation: "architecture" as const,
        stats: { totalNodes: 2, totalEdges: 1, totalGroups: 0, truncated: false },
        nodes: [
          { id: "sel_api", label: "Billing API", kind: "node" as const, tone: "cobalt" as const, x: 100, y: 100 },
          { id: "sel_db", label: "Billing DB", kind: "database" as const, tone: "teal" as const, x: 380, y: 100 },
        ],
        edges: [{ id: "a1", from: "sel_api", to: "sel_db", label: "write" }],
        groups: [],
        selectedIds: ["sel_api", "sel_db"],
        recentDeltas: [],
        canonicalHash: "forkconstraint01",
      },
      constraint: {
        pressure: "latency" as const,
        target: { metric: "p99", comparator: "<" as const, value: 100, unit: "ms", text: "p99 < 100 ms" },
        text: "p99 < 100 ms",
      },
      candidateTakes: [
        { archetype: "cache_aside" as const, title: "Cache-aside", rationale: "Hot reads from cache", tradeoffTag: "Stale reads" },
      ],
    };
    const graph = {
      notation: "architecture",
      summary: "Cache-aside",
      nodes: [
        { id: "a", label: "Billing API", kind: "node" },
        { id: "c", label: "Billing Cache", kind: "cache" },
      ],
      edges: [{ from: "a", to: "c", label: "get" }],
    };
    const costs = ["latency", "money", "consistency", "complexity", "ops"].map((axis) => ({ axis, text: `${axis} line`, severity: 1 }));
    const take = {
      archetype: "cache_aside",
      title: "Cache-aside",
      rationale: "Serves hot reads from a cache",
      tradeoffTag: "Stale reads",
      buys: "p99 ≈ 5-20 ms on hit (typical)",
      costs,
      failureMode: "Stampede on expiry",
      graph,
    };
    const reply = (body: unknown) =>
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [{ message: { content: JSON.stringify(body) } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    try {
      delete process.env.AI_GATEWAY_API_KEY;
      const h = (await (await POST(makeDecideRequest(payload, "198.51.100.120"))).json()) as Record<string, unknown>;
      expect(h.source).toBe("heuristic");

      process.env.AI_GATEWAY_API_KEY = "dummy-fork";
      globalThis.fetch = reply({ takes: [take, take, take] }) as unknown as typeof fetch;
      const live = (await (await POST(makeDecideRequest(payload, "198.51.100.121"))).json()) as {
        source: string;
        takes: Array<{ tradeoffs?: { pressure: string; costs: unknown[] } }>;
      };
      expect(live.source).toBe("llm-json");
      expect(live.takes[0].tradeoffs?.pressure).toBe("latency");
      expect(live.takes[0].tradeoffs?.costs).toHaveLength(5);

      const noTradeoffs = { ...take, buys: undefined, costs: undefined, failureMode: undefined };
      globalThis.fetch = reply({ takes: [noTradeoffs, noTradeoffs, noTradeoffs] }) as unknown as typeof fetch;
      const other = { ...payload, boardGraph: { ...payload.boardGraph, canonicalHash: "forkconstraint02" } };
      const degraded = (await (await POST(makeDecideRequest(other, "198.51.100.122"))).json()) as Record<string, unknown>;
      expect(degraded.source).toBe("heuristic");
      expect(degraded.degraded).toBe(true);

      const bad = { ...payload, constraint: { pressure: "vibes" } };
      expect((await POST(makeDecideRequest(bad, "198.51.100.123"))).status).toBe(400);
    } finally {
      if (origLlmKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = origLlmKey;
      globalThis.fetch = origFetch;
    }
  });
});

describe("/api/jev/decide morph_notation on a full board", () => {
  const savedKey = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => {
    resetDecideStateForTests();
    mockResolveJevTransport.mockReturnValue(null);
    process.env.AI_GATEWAY_API_KEY = "dummy-morph";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = savedKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Prod 22 Nov 2026: select-all + Sequence on the checkout starter fell back to the heuristic 10 of 10 times.
  // Haiku answers in 4-7 s (over the old 6.5 s cap) and often omits the arrays of the other notations.
  it("refines the 6-node checkout board to a sequence when the model returns only the sequence arrays", async () => {
    const fixture = (await import("@/lib/jev/__fixtures__/checkout-morph-sequence.json")).default;
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ model: "anthropic/claude-haiku-5.5", choices: [{ message: { content: JSON.stringify(fixture.haikuAnswer) } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const res = await POST(makeDecideRequest(fixture.request, "198.51.100.130"));
    const json = (await res.json()) as { source: string; model: string; spec: Record<string, unknown[]> | null };

    expect(json.source).toBe("llm-json");
    expect(json.model).toBe("anthropic/claude-haiku-5.5");
    expect(fixture.haikuAnswer.summary.length).toBeGreaterThan(160);
    expect(String(json.spec?.summary).length).toBeLessThanOrEqual(160);
    expect(json.spec?.actors).toHaveLength(6);
    expect(json.spec?.messages).toHaveLength(5);
    for (const key of ["steps", "states", "transitions", "entities", "relations"]) expect(json.spec?.[key]).toEqual([]);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    const sent = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages[0].content).toContain("Fill only the arrays of targetNotation");
  });

  it("still falls back when the model omits the arrays the target notation needs", async () => {
    const fixture = (await import("@/lib/jev/__fixtures__/checkout-morph-sequence.json")).default;
    const { messages: _omitted, ...withoutMessages } = fixture.haikuAnswer;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify(withoutMessages) } }] }), { status: 200 })
      )
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const json = (await (await POST(makeDecideRequest(fixture.request, "198.51.100.131"))).json()) as { source: string };
    expect(json.source).toBe("heuristic");
  });
});


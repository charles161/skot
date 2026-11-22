// Charles, 22 Nov 2026 (4A): the per-keystroke next_options mode is dead (5A: nothing is asked while typing) and
// is deleted: its handler, its request schema, its client mode and its entry in the model map.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/jev/decide/route";
import { DECIDE_MODES } from "@/lib/jev/ai-quiet";
import { LLM_ROUTE_MODELS } from "@/lib/jev/llm-graph-client";

const body = {
  mode: "next_options",
  trigger: "type",
  text: "apigateway",
  conceptLabel: "API Gateway",
  anchorLabel: "Client Dashboard",
  selectedLabels: [],
  boardLabels: ["Client Dashboard"],
  options: [
    { id: "minimal", title: "API Gateway", description: "Client Dashboard — HTTPS → API Gateway", nodes: 1 },
    { id: "cluster", title: "API Gateway + Auth Service + Core Service", description: "linked from Client Dashboard", nodes: 3 },
    { id: "full", title: "Full API backend", description: "API Gateway, Auth Service, Core Service…", nodes: 9 },
  ],
};

describe("the per-keystroke next_options mode is removed", () => {
  it("the server rejects it as an unknown mode", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/jev/decide", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
        body: JSON.stringify(body),
      })
    );
    expect(res.status).toBe(400);
  });

  it("the client cannot ask for it and no model is pinned for it", () => {
    expect(DECIDE_MODES as readonly string[]).not.toContain("next_options");
    expect(Object.keys(LLM_ROUTE_MODELS)).not.toContain("next_options");
    expect(Object.keys(LLM_ROUTE_MODELS).sort()).toEqual(["context", "fork", "generate_graph", "morph", "moves", "practice_review"]);
  });
});

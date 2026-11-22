import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FORK_COST_AXES, forkCostLineSchema, FORK_PATTERN_IDS, type ForkConstraint } from "./fork-constraint";
import {
  rawConstrainedForkTakeSpecSchema,
  rawConstrainedForkTakesPayloadSchema,
  rawForkTakeSpecSchema,
  validateForkTakesPayload,
} from "./fork-engine";
import { generateForkTakesWithLlm } from "./llm-graph-client";
import { semanticEdgeSchema, semanticGraphSchema, semanticGroupSchema, semanticNodeSchema } from "./semantic-graph";

const CONSTRAINT: ForkConstraint = { pressure: "latency" };
const VARIANTS = [
  ["no pressure", null],
  ["stated pressure", CONSTRAINT],
] as const;

interface Limits {
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}
/** Reads the bounds off the schema itself, so no number is repeated in this test. */
const limitsOf = (field: z.ZodType) => z.toJSONSchema(field, { io: "input" }) as Limits;
const maxOf = (field: z.ZodType) => limitsOf(field).maxLength!;

const answer = (content: unknown) => answerText(JSON.stringify(content));

function answerText(content: string) {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const fork = (constraint: ForkConstraint | null) =>
  generateForkTakesWithLlm({ auth: { token: "test", method: "api-key" }, selectedIds: ["a"], boardGraph: {}, constraint });

async function promptFor(constraint: ForkConstraint | null): Promise<string> {
  const fetchSpy = answer({});
  await fork(constraint);
  return JSON.parse(String(fetchSpy.mock.calls[0][1].body)).messages[0].content;
}

const validTake = () => ({
  archetype: "cache_aside",
  title: "Cache-aside",
  rationale: "Serves hot reads from a cache",
  tradeoffTag: "Stale reads",
  buys: "p99 5-20 ms on a hit (typical)",
  costs: FORK_COST_AXES.map((axis) => ({ axis, text: `${axis} cost`, severity: 2 })),
  failureMode: "Stampede on expiry",
  graph: {
    notation: "architecture",
    summary: "Cache in front of the DB",
    nodes: [
      { id: "api", label: "API", sublabel: "Go", role: "service", kind: "node" },
      { id: "cache", label: "Redis", kind: "cache" },
    ],
    edges: [{ from: "api", to: "cache", label: "reads" }],
    groups: [{ id: "zone", label: "VPC", nodeIds: ["api"] }],
  },
});
type Take = ReturnType<typeof validTake>;
const payload = (edit?: (take: Take) => void) => {
  const takes = [validTake(), validTake(), validTake()];
  if (edit) edit(takes[1]);
  return { takes };
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Fork prompt", () => {
  for (const [name, constraint] of VARIANTS) {
    it(`states every limit the schema enforces on the fields it asks for (${name})`, async () => {
      const prompt = await promptFor(constraint);
      const section = (key: string) => prompt.match(new RegExp(`"${key}"\\??:\\[\\{([^{}]*)\\}\\]`))?.[1] ?? "";
      const asked: Array<[string, z.ZodObject]> = [
        [prompt, constraint ? rawConstrainedForkTakeSpecSchema : rawForkTakeSpecSchema],
        [prompt, semanticGraphSchema],
        [section("nodes"), semanticNodeSchema],
        [section("edges"), semanticEdgeSchema],
        [section("groups"), semanticGroupSchema],
        ...(constraint ? [[section("costs"), forkCostLineSchema] as [string, z.ZodObject]] : []),
      ];
      const missing: string[] = [];
      for (const [text, schema] of asked) {
        for (const [key, field] of Object.entries(schema.shape) as Array<[string, z.ZodType]>) {
          if (key === "graph") continue;
          const required = !field.safeParse(undefined).success;
          if (!required && !text.includes(`"${key}"`)) continue;
          const { minLength = 0, maxLength, minItems = 0, maxItems } = limitsOf(field);
          if (maxLength !== undefined) {
            const range = minLength ? `${minLength}-${maxLength}` : `max ${maxLength}`;
            if (!new RegExp(`"${key}"\\??:string \\(${range} chars`).test(text)) missing.push(`${key}: ${range} chars`);
          }
          if (maxItems !== undefined) {
            const range = minItems === maxItems ? `exactly ${maxItems}` : minItems ? `${minItems}-${maxItems}` : `max ${maxItems}`;
            if (!prompt.includes(`(${key}: ${range} items)`)) missing.push(`${key}: ${range} items`);
          }
        }
      }
      expect(missing).toEqual([]);
      expect(prompt).toContain(`(takes: exactly ${limitsOf(rawConstrainedForkTakesPayloadSchema.shape.takes).maxItems} items)`);
      expect(prompt, "every string in the JSON shape carries its limit").not.toMatch(/\bstring\b(?! \()/);
    });
  }

  // Haiku closed the take after "graph" and wrote buys/costs/failureMode beside it, or left them out.
  it("with a pressure, puts every trade-off field inside the take, before the nested graph", async () => {
    const prompt = await promptFor(CONSTRAINT);
    for (const field of ["buys", "costs", "failureMode"]) {
      const at = prompt.indexOf(`"${field}":`);
      expect(at, field).toBeGreaterThan(prompt.indexOf('"takes":'));
      expect(at, field).toBeLessThan(prompt.indexOf('"graph":'));
    }
  });

  it("with a pressure, offers one archetype list: the pressure patterns", async () => {
    const prompt = await promptFor(CONSTRAINT);
    expect(prompt).toContain(`"archetype":${FORK_PATTERN_IDS.map((id) => `"${id}"`).join("|")}`);
    expect(prompt).not.toContain('"resilient_mesh"');
  });
});

describe("Fork answers with over-long text", () => {
  const { shape: take } = rawConstrainedForkTakeSpecSchema;
  const cosmetic: Array<[string, z.ZodType, (t: Take, v: string) => void, (t: Take) => string]> = [
    ["title", take.title, (t, v) => (t.title = v), (t) => t.title],
    ["rationale", take.rationale, (t, v) => (t.rationale = v), (t) => t.rationale],
    ["tradeoffTag", take.tradeoffTag, (t, v) => (t.tradeoffTag = v), (t) => t.tradeoffTag],
    ["buys", take.buys, (t, v) => (t.buys = v), (t) => t.buys],
    ["failureMode", take.failureMode, (t, v) => (t.failureMode = v), (t) => t.failureMode],
    ["cost text", forkCostLineSchema.shape.text, (t, v) => (t.costs[0].text = v), (t) => t.costs[0].text],
    ["graph summary", semanticGraphSchema.shape.summary, (t, v) => (t.graph.summary = v), (t) => t.graph.summary],
    ["node label", semanticNodeSchema.shape.label, (t, v) => (t.graph.nodes[0].label = v), (t) => t.graph.nodes[0].label],
    ["node sublabel", semanticNodeSchema.shape.sublabel, (t, v) => (t.graph.nodes[0].sublabel = v), (t) => t.graph.nodes[0].sublabel!],
    ["node role", semanticNodeSchema.shape.role, (t, v) => (t.graph.nodes[0].role = v), (t) => t.graph.nodes[0].role!],
    ["edge label", semanticEdgeSchema.shape.label, (t, v) => (t.graph.edges[0].label = v), (t) => t.graph.edges[0].label],
    ["group label", semanticGroupSchema.shape.label, (t, v) => (t.graph.groups[0].label = v), (t) => t.graph.groups[0].label],
  ];

  for (const [name, field, write, read] of cosmetic) {
    it(`shortens an over-long ${name} instead of discarding the answer`, async () => {
      const max = maxOf(field);
      answer(payload((t) => write(t, "reads stay fast ".repeat(max))));
      const result = await fork(CONSTRAINT);
      expect(result, "answer kept").not.toBeNull();
      const got = result!.takes[1];
      const text = read({ ...got, ...got.tradeoffs } as unknown as Take);
      expect(text.length).toBeLessThanOrEqual(max);
      expect(text).toMatch(/^reads.*(reads|stay|fast)…$/);
      expect(validateForkTakesPayload({ takes: result!.takes }, { constraint: CONSTRAINT }), "the browser re-validates it unchanged").toEqual({
        ok: true,
        takes: result!.takes,
      });
    });
  }

  it("shortens without a pressure too", async () => {
    answer(payload((t) => (t.rationale = "x".repeat(maxOf(take.rationale) + 1))));
    expect((await fork(null))?.takes[1].rationale).toHaveLength(maxOf(take.rationale));
  });

  // zod counts code points, so cutting by UTF-16 units would drop half the text and could split an emoji.
  it("counts characters as the schema does and never splits an emoji", () => {
    const max = maxOf(take.rationale);
    const res = validateForkTakesPayload(payload((t) => (t.rationale = "😀".repeat(max + 1))));
    expect(res.ok && res.takes[1].rationale).toBe(`${"😀".repeat(max - 1)}…`);
  });

  it("keeps text that is exactly at the limit", () => {
    const text = "x".repeat(maxOf(take.rationale));
    const res = validateForkTakesPayload(payload((t) => (t.rationale = text)));
    expect(res.ok && res.takes[1].rationale).toBe(text);
  });

  const broken: Array<[string, (t: Take) => void]> = [
    ["an over-long node id", (t) => (t.graph.nodes[0].id = "n".repeat(maxOf(semanticNodeSchema.shape.id) + 1))],
    ["an over-long edge endpoint", (t) => (t.graph.edges[0].from = "n".repeat(maxOf(semanticEdgeSchema.shape.from) + 1))],
    ["an over-long group member", (t) => (t.graph.groups[0].nodeIds = ["n".repeat(maxOf(semanticNodeSchema.shape.id) + 1)])],
    ["a too-short rationale", (t) => (t.rationale = "x")],
    ["a missing cost axis", (t) => t.costs.pop()],
    [
      "a missing cost axis beside an over-long title",
      (t) => {
        t.title = "x".repeat(maxOf(take.title) + 1);
        t.costs.pop();
      },
    ],
  ];
  for (const [name, edit] of broken) {
    it(`still rejects ${name}`, () => {
      expect(validateForkTakesPayload(payload(edit), { constraint: CONSTRAINT }).ok).toBe(false);
    });
  }
});

// Real Haiku answers to a six-node checkout board, 22 Nov 2026: each was thrown away over a slip like these.
describe("Fork answers with harmless slips", () => {
  it("drops an unknown tone (Haiku writes \"ocher\") and keeps the node", async () => {
    answer(payload((t) => Object.assign(t.graph.nodes[0], { tone: "ocher" })));
    const node = (await fork(CONSTRAINT))?.takes[1].graph.nodes[0];
    expect(node?.label).toBe("API");
    expect(node?.tone).toBeUndefined();
  });

  it("keeps a valid tone", async () => {
    answer(payload((t) => Object.assign(t.graph.nodes[0], { tone: "ochre" })));
    expect((await fork(CONSTRAINT))?.takes[1].graph.nodes[0].tone).toBe("ochre");
  });

  it("ignores a stray key in a cost line", async () => {
    answer(payload((t) => Object.assign(t.costs[3], { archetype: "multi_az_lb" })));
    expect((await fork(CONSTRAINT))?.takes[1].tradeoffs?.costs[3]).toEqual(validTake().costs[3]);
  });

  for (const [name, wrap] of [
    ["a code fence that never closes", (json: string) => `\`\`\`json\n${json}`],
    ["a closed code fence", (json: string) => `\`\`\`json\n${json}\n\`\`\``],
    ["a sentence before the JSON", (json: string) => `Here are the takes:\n${json}`],
  ] as const) {
    it(`reads an answer with ${name}`, async () => {
      answerText(wrap(JSON.stringify(payload())));
      expect((await fork(CONSTRAINT))?.takes).toHaveLength(3);
    });
  }

  it("still rejects takes without their own graph", async () => {
    answer(payload((t) => Reflect.deleteProperty(t, "graph")));
    expect(await fork(CONSTRAINT)).toBeNull();
  });
});

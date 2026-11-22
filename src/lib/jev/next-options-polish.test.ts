// Final judge round, 21 Nov: blank-board cluster read right to left; S3 had two edges meaning "reserves stock";
// follow-ups drifted off topic (WebRTC Peer, generic Auth); the full template was identical for every anchor.
import { describe, expect, it } from "vitest";
import { buildNextOptions, refineOptionsWithGraphs, structureProblems } from "@/lib/jev/next-options";
import type { JevElement, PredictedAction } from "@/lib/jev/types";

const el = (o: Partial<JevElement> & { id: string; label: string }): JevElement => ({
  kind: "node", x: 100, y: 100, width: 172, height: 72, tone: "cobalt", seed: 1, createdAt: 1, updatedAt: 1, ...o,
});
const shapes = (o: PredictedAction) => o.addElements.filter((e) => e.kind !== "arrow");
const arrows = (o: PredictedAction) => o.addElements.filter((e) => e.kind === "arrow");

describe("blank board: the flow reads left to right", () => {
  const res = buildNextOptions({ elements: [], text: "url shortener", viewportCenter: { x: 600, y: 400 } })!;
  const refined = refineOptionsWithGraphs(res, [], {
    cluster: {
      nodes: [
        { label: "Shortener API", kind: "node" },
        { label: "Client", kind: "actor" },
        { label: "URL Store", kind: "database" },
        { label: "Redirect Cache", kind: "cache" },
      ],
      edges: [
        { from: "Client", to: "Shortener API", label: "shorten / redirect" },
        { from: "Shortener API", to: "URL Store" },
        { from: "Shortener API", to: "Redirect Cache" },
      ],
    },
  });
  // Option (a) is the one typed node ("URL Shortener"); the flow is in the two bigger options.
  for (const o of [...res.options.slice(1), ...refined.options.slice(1)]) {
    it(`${o.tier} (${o.source}): Client sits left of Shortener API`, () => {
      const client = shapes(o).find((s) => s.label === "Client")!;
      const api = shapes(o).find((s) => s.label === "Shortener API")!;
      expect(client.x + client.width).toBeLessThan(api.x);
    });
  }
});

describe("S3: one meaning per edge, everything fed", () => {
  const board = [el({ id: "co", label: "Checkout", x: 100, y: 100 }), el({ id: "inv", label: "Inventory", x: 100, y: 360 })];
  const res = buildNextOptions({ elements: board, selectedIds: ["co", "inv"] })!;
  it("no option has two arrows into the same node with the same label", () => {
    for (const o of res.options) {
      const keys = arrows(o).map((a) => `${a.toId}|${a.label}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it("cluster and full never re-link the two selected nodes directly", () => {
    for (const o of res.options.slice(1)) {
      expect(arrows(o).some((a) => [a.fromId, a.toId].sort().join() === ["co", "inv"].sort().join())).toBe(false);
    }
  });
  it("every new node in the full option has an incoming edge", () => {
    expect(structureProblems(res.options[2], board).filter((p) => p.includes("no input"))).toEqual([]);
  });
  it("an LLM answer with an unfed node or a direct re-link of the selection is not used", () => {
    const refined = refineOptionsWithGraphs(res, board, {
      full: {
        nodes: [
          { label: "Order Service", kind: "node" },
          { label: "Orders DB", kind: "database" },
          { label: "Event Bus", kind: "queue" },
          { label: "Worker", kind: "node" },
          { label: "Payment Service", kind: "node" },
          { label: "Audit DB", kind: "database" },
        ],
        edges: [
          { from: "Checkout", to: "Order Service" },
          { from: "Order Service", to: "Inventory", label: "reserves stock" },
          { from: "Checkout", to: "Inventory", label: "reserves stock" },
          { from: "Order Service", to: "Orders DB" },
          { from: "Order Service", to: "Event Bus" },
          { from: "Worker", to: "Audit DB" },
          { from: "Order Service", to: "Payment Service" },
        ],
      },
    });
    const full = refined.options[2];
    expect(arrows(full).some((a) => [a.fromId, a.toId].sort().join() === ["co", "inv"].sort().join())).toBe(false);
    expect(structureProblems(full, board).filter((p) => p.includes("no input"))).toEqual([]);
  });
});

describe("follow-ups stay on the board's topic", () => {
  it("after the full API backend, nothing about WebRTC", () => {
    const board = [el({ id: "cd", label: "Client Dashboard", x: 200, y: 160 })];
    const full = buildNextOptions({ elements: board, text: "apigateway" })!.options[2];
    const after = [...board, ...full.addElements];
    for (const s of shapes(full)) {
      const res = buildNextOptions({ elements: after, subjectId: s.id });
      const labels = (res?.options ?? []).flatMap((o) => shapes(o).map((x) => x.label));
      expect(labels.filter((l) => /webrtc|stun|crdt|peer/i.test(l)), s.label).toEqual([]);
    }
  });
  it("a URL shortener's API is followed by shortener things, not Auth", () => {
    const res = buildNextOptions({ elements: [], text: "url shortener", viewportCenter: { x: 600, y: 400 } })!;
    const cluster = res.options[1];
    const after = cluster.addElements;
    const api = shapes(cluster).find((s) => s.label === "Shortener API")!;
    const next = buildNextOptions({ elements: after, subjectId: api.id });
    const labels = (next?.options ?? []).flatMap((o) => shapes(o).map((x) => x.label));
    expect(labels.filter((l) => /auth/i.test(l))).toEqual([]);
  });
});

describe("the full option is shaped by the anchor and the domain", () => {
  const full = (anchor: string) =>
    buildNextOptions({ elements: [el({ id: "a", label: anchor, x: 200, y: 160 })], text: "api gateway" })!.options[2];
  const names = (o: PredictedAction) => shapes(o).map((s) => s.label).sort().join("|");
  it("App and Client Dashboard get different full designs", () => {
    expect(names(full("App"))).not.toBe(names(full("Client Dashboard")));
  });
  it("rate limiting lives in the gateway, not as a floating service", () => {
    expect(shapes(full("App")).some((s) => /rate limit/i.test(s.label))).toBe(false);
    expect(shapes(full("App")).find((s) => s.label === "API Gateway")?.sublabel).toMatch(/rate/i);
  });
});

// Feature checks context-suggestions-single and no-emoji-icons, 21 Nov: clicking Ledger DB offered nothing.
describe("clicking a leaf node still offers three on-topic options", () => {
  it("Ledger DB grows like a database", () => {
    const board = [
      el({ id: "api", label: "Checkout API", x: 0, y: 200 }),
      el({ id: "led", label: "Ledger DB", kind: "database", x: 400, y: 200, width: 156, height: 86 }),
      { ...el({ id: "a1", label: "", x: 0, y: 0, width: 0, height: 0 }), kind: "arrow" as const, fromId: "api", toId: "led" },
    ];
    const res = buildNextOptions({ elements: board, selectedIds: ["led"] })!;
    expect(res.options).toHaveLength(3);
    expect(shapes(res.options[0])[0].label).toMatch(/replica/i);
  });
});

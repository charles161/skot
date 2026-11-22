import { z } from "zod";
import { inferToneFromLabel } from "./colors";
import {
  computeBounds,
  getElementRect,
  isShapeElement,
  makeSeed,
  Rect,
  rectContainsCenter,
  rectsOverlap,
  uid,
} from "./geometry";
import {
  hasForbiddenObjectKeys,
  isSemanticNodeKind,
  layoutSemanticGraphToElements,
  SemanticEdge,
  semanticEdgeToArrow,
  SemanticGraph,
  semanticGraphSchema,
  SemanticNode,
  validateSemanticGraph,
} from "./semantic-graph";
import {
  FORK_PATTERN_IDS,
  forkCostLinesSchema,
  type ForkConstraint,
  type ForkTradeoffs,
} from "./fork-constraint";
import { findBoardCounterpart, norm, sameThing, words } from "./component-catalog";
import { isContainerKind } from "./notation-kinds";
import { resolveNonOverlappingTopLeft } from "./placement-engine";
import type { ColorTone, JevElement } from "./types";

const CLASSIC_FORK_ARCHETYPES = [
  "queue_event_driven",
  "cache_read_replica",
  "gateway_edge_split",
  "resilient_mesh",
] as const;

export const forkArchetypeSchema = z.enum([...CLASSIC_FORK_ARCHETYPES, ...FORK_PATTERN_IDS]);

export type ForkArchetype = z.infer<typeof forkArchetypeSchema>;

export interface ForkTakeSpec {
  archetype: ForkArchetype;
  title: string;
  rationale: string;
  tradeoffTag: string;
  graph: SemanticGraph;
  /** Set for takes generated against a stated constraint: what the take buys and what it costs. */
  tradeoffs?: ForkTradeoffs;
  /** Draw the graph's groups as zones (regions / availability zones) instead of frames. */
  groupsAsZones?: boolean;
}

export interface ForkTake extends ForkTakeSpec {
  id: string;
  /** Materialized elements anchored at the selection bounds with external arrows rewired (used on Enter accept). */
  elements: JevElement[];
  /** Non-overlapping ghost preview elements placed beside (or below) the selection for before -> after comparison. */
  previewElements: JevElement[];
  previewPlacement: "right" | "below";
  entryElementId: string;
  exitElementId: string;
  feedbackKeys: string[];
  /** Only set when returned by a live calibrated model; always undefined in heuristic mode. */
  probability?: number;
}

export interface SelectedSubgraph {
  selectedShapes: JevElement[];
  selectedFrames: JevElement[];
  internalArrows: JevElement[];
  incomingExternal: JevElement[];
  outgoingExternal: JevElement[];
  replacedIds: string[];
  bounds: Rect;
  entryNode: JevElement;
  exitNode: JevElement;
  /** Everything on the board outside the selection: what a take reuses, wires into and must not cover. */
  surroundings: JevElement[];
}

export interface ForkGenerationResult {
  subgraph: SelectedSubgraph;
  replacedIds: string[];
  takes: ForkTake[];
  source: "typesafe-jev" | "llm-json" | "heuristic";
  model: string;
  isHeuristic: boolean;
  constraint?: ForkConstraint;
  confidence: number | null;
}

/**
 * Extracts the selected shapes, contained shapes if a frame was selected,
 * internal arrows, and external incoming/outgoing boundary arrows for seamless rewiring.
 */
export function extractSelectedSubgraph(
  selectedIds: string[],
  allElements: JevElement[]
): SelectedSubgraph | null {
  if (selectedIds.length === 0 || allElements.length === 0) return null;

  const explicitSet = new Set(selectedIds);
  const selectedFrames = allElements.filter(
    (e) => explicitSet.has(e.id) && e.kind === "frame"
  );

  const shapeIdSet = new Set<string>();
  for (const el of allElements) {
    if (!isShapeElement(el) || el.kind === "frame") continue;
    if (explicitSet.has(el.id)) {
      shapeIdSet.add(el.id);
      continue;
    }
    // Include shapes geometrically inside any selected frame
    for (const frame of selectedFrames) {
      if (rectContainsCenter(getElementRect(frame), getElementRect(el))) {
        shapeIdSet.add(el.id);
        break;
      }
    }
  }

  const selectedShapes = allElements
    .filter((e) => shapeIdSet.has(e.id))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  if (selectedShapes.length === 0) return null;

  const internalArrows: JevElement[] = [];
  const incomingExternal: JevElement[] = [];
  const outgoingExternal: JevElement[] = [];

  for (const el of allElements) {
    if (el.kind !== "arrow") continue;
    const fromIn = Boolean(el.fromId && shapeIdSet.has(el.fromId));
    const toIn = Boolean(el.toId && shapeIdSet.has(el.toId));
    if (fromIn && toIn) {
      internalArrows.push(el);
    } else if (!fromIn && toIn && el.fromId) {
      incomingExternal.push(el);
    } else if (fromIn && !toIn && el.toId) {
      outgoingExternal.push(el);
    }
  }

  // Compute in/out degree inside the selected subgraph to identify entry & exit nodes
  const internalInDeg = new Map<string, number>();
  const internalOutDeg = new Map<string, number>();
  for (const s of selectedShapes) {
    internalInDeg.set(s.id, 0);
    internalOutDeg.set(s.id, 0);
  }
  for (const arr of internalArrows) {
    if (arr.fromId && internalOutDeg.has(arr.fromId)) {
      internalOutDeg.set(arr.fromId, (internalOutDeg.get(arr.fromId) ?? 0) + 1);
    }
    if (arr.toId && internalInDeg.has(arr.toId)) {
      internalInDeg.set(arr.toId, (internalInDeg.get(arr.toId) ?? 0) + 1);
    }
  }

  const entryNode =
    selectedShapes.find((s) => (internalInDeg.get(s.id) ?? 0) === 0) ??
    selectedShapes[0];
  const exitNode =
    [...selectedShapes]
      .reverse()
      .find((s) => (internalOutDeg.get(s.id) ?? 0) === 0) ??
    selectedShapes[selectedShapes.length - 1];

  const bounds = computeBounds([...selectedFrames, ...selectedShapes]) ?? {
    x: entryNode.x,
    y: entryNode.y,
    width: entryNode.width,
    height: entryNode.height,
  };

  const replacedIdSet = new Set<string>([
    ...selectedShapes.map((s) => s.id),
    ...selectedFrames.map((f) => f.id),
    ...internalArrows.map((a) => a.id),
    ...incomingExternal.map((a) => a.id),
    ...outgoingExternal.map((a) => a.id),
  ]);

  return {
    selectedShapes,
    selectedFrames,
    internalArrows,
    incomingExternal,
    outgoingExternal,
    replacedIds: Array.from(replacedIdSet),
    bounds,
    entryNode,
    exitNode,
    surroundings: allElements.filter((e) => !replacedIdSet.has(e.id)),
  };
}

const PRONOUN_AND_STOPWORDS = new Set([
  "you",
  "your",
  "yours",
  "we",
  "our",
  "ours",
  "us",
  "me",
  "my",
  "mine",
  "they",
  "their",
  "them",
  "he",
  "she",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "via",
  "vs",
  "into",
  "as",
  "is",
  "are",
  "be",
  "peers",
  "peer",
  "user",
  "users",
  "client",
  "clients",
  "customer",
  "customers",
  "browser",
  "mobile",
  "visitor",
  "visitors",
  "people",
  "team",
  "actor",
  "human",
  "end",
  "frontend",
  "ui",
]);

const GENERIC_INFRA_WORDS = new Set([
  "api",
  "service",
  "services",
  "server",
  "servers",
  "db",
  "database",
  "postgres",
  "postgresql",
  "mysql",
  "mongo",
  "mongodb",
  "sqlite",
  "redis",
  "cache",
  "queue",
  "node",
  "nodes",
  "worker",
  "workers",
  "app",
  "core",
  "main",
  "system",
  "store",
  "storage",
  "layer",
  "tier",
  "step",
  "new",
  "box",
  "canvas",
  "mesh",
  "engine",
  "hub",
  "module",
  "component",
  "backend",
  "cluster",
  "instance",
  "primary",
  "replica",
]);

const SECONDARY_ARCH_SUBJECTS = new Set([
  "gateway",
  "edge",
  "proxy",
  "broker",
  "ledger",
  "search",
  "index",
  "webhook",
  "session",
  "stream",
  "sync",
]);

function shapeSubjectPriority(shape: JevElement): number {
  switch (shape.kind) {
    case "node":
      return 4;
    case "database":
      return 3;
    case "diamond":
      return 2;
    case "ellipse":
      return 0;
    default:
      return 1;
  }
}

function tokenizeLabel(label: string): string[] {
  return (label || "")
    .replace(/[&/+→>-]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
}

/**
 * Extracts a clean domain subject (e.g. "Orders", "Checkout", "Auth", "Sync", "Gateway")
 * from the selected shapes while stripping pronouns, stopwords, and generic actor names.
 * Returns `null` when only pronouns/generic labels exist so callers use crisp role defaults.
 */
export function deriveDomainSubject(shapes: JevElement[]): string | null {
  const prioritized = [...shapes].sort(
    (a, b) => shapeSubjectPriority(b) - shapeSubjectPriority(a)
  );

  // Pass 1: Concrete domain noun (e.g. Orders, Checkout, Auth, Payments, Sync, WebRTC)
  for (const s of prioritized) {
    const tokens = tokenizeLabel(s.label);
    const domainToken = tokens.find((tok) => {
      const lower = tok.toLowerCase();
      return (
        !PRONOUN_AND_STOPWORDS.has(lower) &&
        !GENERIC_INFRA_WORDS.has(lower) &&
        !SECONDARY_ARCH_SUBJECTS.has(lower)
      );
    });
    if (domainToken) return domainToken;
  }

  // Pass 2: Architectural domain keyword (e.g. Gateway, Sync, Ledger, Webhook, Search)
  for (const s of prioritized) {
    const tokens = tokenizeLabel(s.label);
    const archToken = tokens.find((tok) =>
      SECONDARY_ARCH_SUBJECTS.has(tok.toLowerCase())
    );
    if (archToken) return archToken;
  }

  return null;
}

function joinDomainRole(
  domain: string | null,
  role: string,
  fallbackRole: string
): string {
  if (!domain) return fallbackRole;
  const dLower = domain.toLowerCase();
  if (role.toLowerCase().includes(dLower)) return fallbackRole;
  return `${domain} ${role}`;
}

function describeSelectionFocus(subgraph: SelectedSubgraph, domain: string | null): string {
  const prioritized = [...subgraph.selectedShapes].sort(
    (a, b) => shapeSubjectPriority(b) - shapeSubjectPriority(a)
  );
  const meaningfulNode = prioritized.find((s) => {
    const tokens = tokenizeLabel(s.label);
    return tokens.some((t) => !PRONOUN_AND_STOPWORDS.has(t.toLowerCase()));
  });
  if (meaningfulNode?.label.trim()) return meaningfulNode.label.trim();
  return domain ?? "this flow";
}

function toSemanticKind(kind: JevElement["kind"]): SemanticNode["kind"] {
  return isSemanticNodeKind(kind) ? kind : "node";
}

export function baseNodesAndEdges(subgraph: SelectedSubgraph): {
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  idToSemId: Map<string, string>;
} {
  const idToSemId = new Map<string, string>();
  const nodes: SemanticNode[] = subgraph.selectedShapes.map((s, idx) => {
    const semId = `sel_${idx}`;
    idToSemId.set(s.id, semId);
    return {
      id: semId,
      label: s.label || `Step ${idx + 1}`,
      ...(s.sublabel ? { sublabel: s.sublabel } : {}),
      kind: toSemanticKind(s.kind),
      tone: s.tone,
    };
  });

  const edges: SemanticEdge[] = [];
  for (const arr of subgraph.internalArrows) {
    if (!arr.fromId || !arr.toId) continue;
    const from = idToSemId.get(arr.fromId);
    const to = idToSemId.get(arr.toId);
    if (!from || !to || from === to) continue;
    edges.push({
      from,
      to,
      ...(arr.label ? { label: arr.label } : {}),
      ...(arr.dashed ? { dashed: true } : {}),
      ...(arr.bidirectional ? { bidirectional: true } : {}),
    });
  }

  // If user selected disconnected nodes, chain them left-to-right so architectural transforms connect cleanly
  if (edges.length === 0 && nodes.length > 1) {
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ from: nodes[i].id, to: nodes[i + 1].id, kind: "flow" });
    }
  }

  return { nodes, edges, idToSemId };
}

function buildQueueEventDrivenSpec(subgraph: SelectedSubgraph): ForkTakeSpec {
  const { nodes, edges, idToSemId } = baseNodesAndEdges(subgraph);
  const domain = deriveDomainSubject(subgraph.selectedShapes);
  const focusLabel = describeSelectionFocus(subgraph, domain);
  const entrySemId = idToSemId.get(subgraph.entryNode.id) ?? nodes[0].id;

  const queueId = "fork_queue";
  const workerId = "fork_worker";
  const dlqId = "fork_dlq";

  const outNodes: SemanticNode[] = nodes.map((n) => ({ ...n }));
  const outEdges: SemanticEdge[] = [];
  const queueLabel = joinDomainRole(domain, "Queue", "Ingest Queue");
  const workerLabel = joinDomainRole(domain, "Worker", "Async Worker");

  if (nodes.length === 1) {
    const sole = outNodes[0];
    outNodes.push(
      {
        id: queueId,
        label: joinDomainRole(domain, "Event Queue", "Ingest Queue"),
        sublabel: "Async buffer",
        kind: "node",
        tone: "ochre",
      },
      {
        id: workerId,
        label: workerLabel,
        sublabel: "Idempotent consumer",
        kind: "node",
        tone: "cobalt",
      },
      {
        id: dlqId,
        label: "Dead-Letter Queue",
        sublabel: "Retry / inspect",
        kind: "node",
        tone: "terracotta",
      }
    );
    outEdges.push(
      { from: sole.id, to: queueId, label: "publish", dashed: true, kind: "async" },
      { from: queueId, to: workerId, label: "consume", kind: "async" },
      { from: workerId, to: dlqId, label: "failed", dashed: true, kind: "fallback" }
    );
  } else {
    // Decouple the first outgoing hop from entry -> queue -> worker -> downstream
    const primaryEdgeIdx = edges.findIndex((e) => e.from === entrySemId);
    const splitEdge = primaryEdgeIdx >= 0 ? edges[primaryEdgeIdx] : edges[0];

    outNodes.push(
      {
        id: queueId,
        label: queueLabel,
        sublabel: "Kafka / Async topic",
        kind: "node",
        tone: "ochre",
      },
      {
        id: workerId,
        label: workerLabel,
        sublabel: "Consumer pool",
        kind: "node",
        tone: "cobalt",
      },
      {
        id: dlqId,
        label: "Dead-Letter Queue",
        sublabel: "Poison-pill retry",
        kind: "node",
        tone: "terracotta",
      }
    );

    edges.forEach((e, idx) => {
      if (splitEdge && idx === (primaryEdgeIdx >= 0 ? primaryEdgeIdx : 0)) {
        outEdges.push(
          { from: e.from, to: queueId, label: "publish", dashed: true, kind: "async" },
          { from: queueId, to: workerId, label: "consume", kind: "async" },
          { from: workerId, to: e.to, label: e.label || "apply", kind: "sync" },
          { from: workerId, to: dlqId, label: "retry fail", dashed: true, kind: "fallback" }
        );
      } else {
        outEdges.push({ ...e });
      }
    });
  }

  return {
    archetype: "queue_event_driven",
    title: "Queue / Event-Driven",
    rationale: `Decouples ${focusLabel} via ${queueLabel}, ${workerLabel}, and DLQ backpressure.`,
    tradeoffTag: "Eventual consistency",
    graph: {
      notation: "architecture",
      summary: domain ? `${domain} Event-Driven Fork` : "Event-Driven Fork",
      nodes: outNodes,
      edges: outEdges,
      groups: [
        {
          id: "grp_async",
          label: domain ? `${domain} Async Backbone` : "Async Backbone",
          nodeIds: [queueId, workerId, dlqId],
          tone: "ochre",
        },
      ],
    },
  };
}

function buildCacheReadReplicaSpec(subgraph: SelectedSubgraph): ForkTakeSpec {
  const { nodes, edges, idToSemId } = baseNodesAndEdges(subgraph);
  const domain = deriveDomainSubject(subgraph.selectedShapes);
  const dbShape =
    subgraph.selectedShapes.find((s) => s.kind === "database") ??
    subgraph.exitNode;
  const dbSemId = idToSemId.get(dbShape.id) ?? nodes[nodes.length - 1].id;

  const hitId = "fork_cache_hit";
  const cacheId = "fork_redis";
  const replicaId = "fork_replica";

  const outNodes: SemanticNode[] = nodes.map((n) => ({ ...n }));
  const outEdges: SemanticEdge[] = [];
  const cacheLabel = joinDomainRole(domain, "Read Cache", "Read Cache");
  const dbLabelHasSubject = tokenizeLabel(dbShape.label).some(
    (t) => !PRONOUN_AND_STOPWORDS.has(t.toLowerCase())
  );
  const replicaLabel =
    dbShape.kind === "database" && dbLabelHasSubject
      ? `${dbShape.label} Replica`
      : joinDomainRole(domain, "Read Replica", "Read Replica");

  if (nodes.length === 1) {
    const sole = outNodes[0];
    const primaryId = sole.kind === "database" ? sole.id : "fork_primary";
    if (primaryId !== sole.id) {
      outNodes.push({ id: primaryId, label: "Postgres DB", sublabel: "Primary store", kind: "database", tone: "teal" });
      outEdges.push({ from: sole.id, to: primaryId, label: "write", kind: "sync" });
    }
    outEdges.push({ from: primaryId, to: replicaId, label: "replicate", dashed: true, kind: "async" });
    outNodes.push(
      {
        id: hitId,
        label: "Cache Hit?",
        sublabel: "TTL check",
        kind: "diamond",
        tone: "plum",
      },
      {
        id: cacheId,
        label: cacheLabel,
        sublabel: "Sub-ms hot keys",
        kind: "database",
        tone: "teal",
      },
      {
        id: replicaId,
        label: replicaLabel,
        sublabel: "Origin fallback",
        kind: "database",
        tone: "teal",
      }
    );
    outEdges.push(
      { from: sole.id, to: hitId, label: "read", kind: "flow" },
      { from: hitId, to: cacheId, label: "Hit", kind: "sync" },
      { from: hitId, to: replicaId, label: "Miss", dashed: true, kind: "fallback" }
    );
  } else {
    const targetEdgeIdx = edges.findIndex((e) => e.to === dbSemId);
    const chosenIdx = targetEdgeIdx >= 0 ? targetEdgeIdx : edges.length - 1;

    outNodes.push(
      {
        id: hitId,
        label: "Cache Hit?",
        sublabel: "Read-through",
        kind: "diamond",
        tone: "plum",
      },
      {
        id: cacheId,
        label: cacheLabel,
        sublabel: "Hot read tier",
        kind: "database",
        tone: "teal",
      },
      {
        id: replicaId,
        label: replicaLabel,
        sublabel: "Read scaling",
        kind: "database",
        tone: "teal",
      }
    );

    edges.forEach((e, idx) => {
      if (idx === chosenIdx) {
        outEdges.push(
          { from: e.from, to: hitId, label: "read", kind: "flow" },
          { from: hitId, to: cacheId, label: "Hit", kind: "sync" },
          { from: hitId, to: replicaId, label: "Miss", dashed: true, kind: "fallback" },
          { from: e.from, to: e.to, label: "write", kind: "sync" },
          { from: e.to, to: replicaId, label: "replicate", dashed: true, kind: "async" }
        );
      } else {
        outEdges.push({ ...e });
      }
    });
  }

  return {
    archetype: "cache_read_replica",
    title: "Cache-First / Read Replica",
    rationale: domain
      ? `Serves hot ${domain} reads from Redis cache-aside and offloads misses onto a read replica.`
      : "Serves hot reads from a Redis cache-aside tier and offloads misses onto a read replica.",
    tradeoffTag: "Cache invalidation",
    graph: {
      notation: "architecture",
      summary: domain ? `${domain} Cache-First Fork` : "Cache-First Fork",
      nodes: outNodes,
      edges: outEdges,
      groups: [
        {
          id: "grp_read_tier",
          label: "Low-Latency Read Tier",
          nodeIds: [hitId, cacheId, replicaId],
          tone: "teal",
        },
      ],
    },
  };
}

function buildGatewayOrMeshSpec(subgraph: SelectedSubgraph): ForkTakeSpec {
  const { nodes, edges, idToSemId } = baseNodesAndEdges(subgraph);
  const domain = deriveDomainSubject(subgraph.selectedShapes);
  const focusLabel = describeSelectionFocus(subgraph, domain);
  const entrySemId = idToSemId.get(subgraph.entryNode.id) ?? nodes[0].id;
  const exitSemId =
    idToSemId.get(subgraph.exitNode.id) ?? nodes[nodes.length - 1].id;

  const alreadyHasGateway = subgraph.selectedShapes.some((s) =>
    /(gateway|edge|cdn|proxy|balancer)/i.test(s.label)
  );

  if (alreadyHasGateway) {
    // Offer Circuit-Breaker / Resilient Mesh split instead of duplicating an existing Gateway
    const breakerId = "fork_breaker";
    const fallbackId = "fork_fallback";
    const obsId = "fork_telemetry";

    const outNodes: SemanticNode[] = [
      ...nodes.map((n) => ({ ...n })),
      {
        id: breakerId,
        label: "Circuit Breaker?",
        sublabel: "Timeout + retry cap",
        kind: "diamond",
        tone: "plum",
      },
      {
        id: fallbackId,
        label: joinDomainRole(domain, "Fallback", "Graceful Fallback"),
        sublabel: "Degraded response",
        kind: "node",
        tone: "terracotta",
      },
      {
        id: obsId,
        label: "Trace & Metrics",
        sublabel: "SLO alerts",
        kind: "node",
        tone: "slate",
      },
    ];

    const outEdges: SemanticEdge[] = [];
    if (edges.length > 0) {
      edges.forEach((e, idx) => {
        if (idx === 0) {
          outEdges.push(
            { from: e.from, to: breakerId, label: "guard", kind: "flow" },
            { from: breakerId, to: e.to, label: "Healthy", kind: "sync" },
            { from: breakerId, to: fallbackId, label: "Tripped", dashed: true, kind: "fallback" },
            { from: e.to, to: obsId, label: "spans", dashed: true, kind: "async" }
          );
        } else {
          outEdges.push({ ...e });
        }
      });
    } else {
      outEdges.push(
        { from: entrySemId, to: breakerId, label: "guard", kind: "flow" },
        { from: breakerId, to: fallbackId, label: "Tripped", dashed: true, kind: "fallback" },
        { from: entrySemId, to: obsId, label: "spans", dashed: true, kind: "async" }
      );
    }

    return {
      archetype: "resilient_mesh",
      title: "Circuit-Breaker / Resilient Mesh",
      rationale: `Guards ${focusLabel} with a circuit breaker, graceful fallback, and trace telemetry.`,
      tradeoffTag: "Ops complexity",
      graph: {
        notation: "architecture",
        summary: domain ? `${domain} Resilient Mesh Fork` : "Resilient Mesh Fork",
        nodes: outNodes,
        edges: outEdges,
        groups: [
          {
            id: "grp_resilience",
            label: "Resilience Guardrails",
            nodeIds: [breakerId, fallbackId, obsId],
            tone: "plum",
          },
        ],
      },
    };
  }

  // Standard Gateway / Edge-Split take
  const gwId = "fork_gateway";
  const authId = "fork_guard";
  const readSvcId = "fork_read_svc";

  const outNodes: SemanticNode[] = [
    {
      id: gwId,
      label: joinDomainRole(domain, "Edge Gateway", "Edge Gateway"),
      sublabel: "Routing + TLS",
      kind: "node",
      tone: "cobalt",
      layer: 0,
    },
    {
      id: authId,
      label: "Auth & Rate Limit?",
      sublabel: "Edge policy",
      kind: "diamond",
      tone: "plum",
      layer: 1,
    },
    ...nodes.map((n) => ({ ...n })),
    {
      id: readSvcId,
      label: joinDomainRole(domain, "Read Edge", "Read Edge"),
      sublabel: "CQRS query path",
      kind: "node",
      tone: inferToneFromLabel("Edge Service"),
    },
  ];

  const outEdges: SemanticEdge[] = [
    { from: gwId, to: authId, label: "inspect", kind: "flow" },
    { from: authId, to: entrySemId, label: "write", kind: "sync" },
    { from: authId, to: readSvcId, label: "read", kind: "flow" },
    ...edges.map((e) => ({ ...e })),
  ];

  if (exitSemId !== entrySemId) {
    outEdges.push({
      from: readSvcId,
      to: exitSemId,
      label: "query",
      dashed: true,
      kind: "sync",
    });
  }

  return {
    archetype: "gateway_edge_split",
    title: "Gateway / Edge-Split",
    rationale: `Fronts ${focusLabel} with an Edge Gateway, auth/rate guard, and split read path.`,
    tradeoffTag: "Extra network hop",
    graph: {
      notation: "architecture",
      summary: domain ? `${domain} Gateway Edge-Split Fork` : "Gateway Edge-Split Fork",
      nodes: outNodes,
      edges: outEdges,
      groups: [
        {
          id: "grp_edge",
          label: "Edge Ingress",
          nodeIds: [gwId, authId],
          tone: "cobalt",
        },
      ],
    },
  };
}

const FORK_PREVIEW_GAP_PX = 120;

function shiftElementsForForkPreview(
  elements: JevElement[],
  selectionBounds: Rect
): { previewElements: JevElement[]; placement: "right" | "below" } {
  const genBounds = computeBounds(elements);
  if (!genBounds) {
    return { previewElements: elements, placement: "right" };
  }

  const aspectRatio = selectionBounds.width / Math.max(1, selectionBounds.height);
  const placeBelow = selectionBounds.width >= 820 && aspectRatio >= 3.5;

  let dx: number;
  let dy: number;
  if (placeBelow) {
    const selCenterX = selectionBounds.x + selectionBounds.width / 2;
    const genCenterX = genBounds.x + genBounds.width / 2;
    dx = Math.round(selCenterX - genCenterX);
    dy = Math.round(
      selectionBounds.y + selectionBounds.height + FORK_PREVIEW_GAP_PX - genBounds.y
    );
  } else {
    const selCenterY = selectionBounds.y + selectionBounds.height / 2;
    const genCenterY = genBounds.y + genBounds.height / 2;
    dx = Math.round(
      selectionBounds.x + selectionBounds.width + FORK_PREVIEW_GAP_PX - genBounds.x
    );
    dy = Math.round(selCenterY - genCenterY);
  }

  const previewElements = elements.map((el) => {
    if (el.kind === "arrow") {
      return {
        ...el,
        ...(el.fromPoint
          ? { fromPoint: { x: el.fromPoint.x + dx, y: el.fromPoint.y + dy } }
          : {}),
        ...(el.toPoint
          ? { toPoint: { x: el.toPoint.x + dx, y: el.toPoint.y + dy } }
          : {}),
      };
    }
    if (el.kind === "freedraw" && el.points) {
      return {
        ...el,
        x: el.x + dx,
        y: el.y + dy,
        points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    }
    return {
      ...el,
      x: el.x + dx,
      y: el.y + dy,
    };
  });

  return {
    previewElements,
    placement: placeBelow ? "below" : "right",
  };
}

const ZONE_PAD = { left: 32, top: 44, right: 32, bottom: 28 };
const ZONE_GAP_PX = 40;

/**
 * Turns group frames into zones that hold only their own members: every zone after the first
 * moves its members below everything drawn so far, then each zone is fitted to its members.
 */
function stackZones(
  elements: JevElement[],
  graph: SemanticGraph,
  nodeIdMap: Map<string, string>
): JevElement[] {
  const groups = graph.groups ?? [];
  const memberIds = groups.map(
    (g) => new Set(g.nodeIds.map((id) => nodeIdMap.get(id)).filter((id): id is string => Boolean(id)))
  );
  const shapes = new Map(
    elements.filter((e) => isShapeElement(e) && e.kind !== "frame").map((e) => [e.id, { ...e }])
  );

  memberIds.forEach((members, idx) => {
    if (idx === 0 || members.size === 0) return;
    const placed = computeBounds([...shapes.values()].filter((e) => !members.has(e.id)));
    const own = computeBounds([...shapes.values()].filter((e) => members.has(e.id)));
    if (!placed || !own) return;
    const dy = placed.y + placed.height + ZONE_PAD.bottom + ZONE_GAP_PX + ZONE_PAD.top - own.y;
    for (const id of members) {
      const el = shapes.get(id);
      if (el) el.y = Math.round(el.y + dy);
    }
  });

  const frames = elements.filter((e) => e.kind === "frame");
  const zones = groups.flatMap((g, idx) => {
    const frame = frames[idx];
    const b = computeBounds([...memberIds[idx]].map((id) => shapes.get(id)).filter((e): e is JevElement => Boolean(e)));
    if (!frame || !b) return [];
    return [
      {
        ...frame,
        kind: "zone" as const,
        x: Math.round(b.x - ZONE_PAD.left),
        y: Math.round(b.y - ZONE_PAD.top),
        width: Math.round(b.width + ZONE_PAD.left + ZONE_PAD.right),
        height: Math.round(b.height + ZONE_PAD.top + ZONE_PAD.bottom),
      },
    ];
  });

  return [
    ...zones,
    ...elements.filter((e) => e.kind !== "frame").map((e) => shapes.get(e.id) ?? e),
  ];
}

/**
 * Which take nodes are already on the board. Heuristic takes name a selected shape's stand-in `sel_<i>`; a take
 * from the model stands in for a selected shape when it matches one that has no stand-in yet. A node that is a board
 * node outside the selection ("Postgres DB" for the board's only database "URL DB", "Read Cache" for "Redis cache")
 * is not drawn again, and its edges become arrows to that board node.
 */
interface ReusePlan {
  /** The nodes still to draw, the edges between them and the groups that still have members. */
  graph: SemanticGraph;
  /** Edges with at least one end on a reused board node, as element ids (board) or semantic ids (drawn). */
  boardEdges: Array<{ edge: SemanticEdge; from: string; to: string; fromBoard: boolean; toBoard: boolean }>;
  /** Selected shape id -> semantic id of the take node that stands for it. */
  standIns: Map<string, string>;
}

/**
 * A selected shape the take kept under a new name ("API service" -> "API functions") matches no take node by
 * name. Its stand-in is then the new node that took its place in the graph: the one the take wires to the same
 * neighbours, in the same direction, as the shape was wired on the board. Without it the shape's arrows to the
 * rest of the board would be handed to whichever new node happens to sit leftmost or rightmost.
 */
function adoptRenamed(
  graph: SemanticGraph,
  subgraph: SelectedSubgraph,
  standIns: Map<string, string>,
  boardFor: Map<string, string>,
  drawn: SemanticNode[]
): void {
  const boardArrows = [...subgraph.incomingExternal, ...subgraph.outgoingExternal, ...subgraph.internalArrows];
  for (const shape of subgraph.selectedShapes) {
    if (standIns.has(shape.id)) continue;
    // Which board node a take node is: an outside node it reuses, or the selected shape it stands in for.
    const boardIdOf = new Map(boardFor);
    for (const [selId, semId] of standIns) boardIdOf.set(semId, selId);
    const taken = new Set(standIns.values());
    const score = (n: SemanticNode): number => {
      let shared = 0;
      for (const a of boardArrows) {
        const out = a.fromId === shape.id;
        if (!out && a.toId !== shape.id) continue;
        const neighbour = out ? a.toId : a.fromId;
        if (graph.edges.some((e) => (out ? e.from === n.id && boardIdOf.get(e.to) === neighbour : e.to === n.id && boardIdOf.get(e.from) === neighbour))) {
          shared += 1;
        }
      }
      if (shared === 0) return 0;
      const sharedWords = words(n.label).filter((w) => words(shape.label).includes(w)).length;
      return shared + (n.kind === shape.kind ? 0.5 : 0) + Math.min(sharedWords, 1) * 0.25;
    };
    let best: { node: SemanticNode; score: number } | null = null;
    for (const n of drawn) {
      if (taken.has(n.id)) continue;
      const sc = score(n);
      if (sc > 0 && (!best || sc > best.score)) best = { node: n, score: sc };
    }
    if (best) standIns.set(shape.id, best.node.id);
  }
}

function planReuse(graph: SemanticGraph, subgraph: SelectedSubgraph, groupsAsZones: boolean): ReusePlan {
  const kept = subgraph.surroundings.filter((e) => isShapeElement(e) && !isContainerKind(e.kind));
  const wiredToSelection = new Set(
    [...subgraph.incomingExternal.map((a) => a.fromId), ...subgraph.outgoingExternal.map((a) => a.toId)].filter(
      (id): id is string => Boolean(id)
    )
  );
  const selectedBySemId = new Map(subgraph.selectedShapes.map((s, idx) => [`sel_${idx}`, s]));
  const standIns = new Map<string, string>();
  for (const n of graph.nodes) {
    const sel = selectedBySemId.get(n.id);
    if (sel && !standIns.has(sel.id)) standIns.set(sel.id, n.id);
  }

  const boardFor = new Map<string, string>();
  const claimedByRole = new Set<string>();
  const drawn: SemanticNode[] = [];
  const counterpart = <T extends JevElement>(n: SemanticNode, candidates: T[], prefer?: Set<string>): T | null => {
    const match = findBoardCounterpart(n, candidates, prefer);
    if (!match || sameThing(match, n)) return match;
    if (claimedByRole.has(match.id)) return null;
    claimedByRole.add(match.id);
    return match;
  };

  for (const n of graph.nodes) {
    const sel = selectedBySemId.get(n.id);
    if (sel && standIns.get(sel.id) === n.id) {
      drawn.push(n);
      continue;
    }
    const unclaimed = subgraph.selectedShapes.filter((s) => !standIns.has(s.id));
    const selected = counterpart(n, unclaimed);
    if (selected) {
      standIns.set(selected.id, n.id);
      drawn.push(n);
      continue;
    }
    const onBoard = counterpart(n, kept, wiredToSelection);
    if (onBoard) boardFor.set(n.id, onBoard.id);
    else drawn.push(n);
  }
  adoptRenamed(graph, subgraph, standIns, boardFor, drawn);

  const boardLabel = new Map<string, string>();
  for (const n of graph.nodes) {
    const board = kept.find((e) => e.id === boardFor.get(n.id));
    if (board) boardLabel.set(norm(n.label), board.label);
  }
  const renamed = drawn.map((n) => {
    const label = boardLabel.get(norm(n.label));
    return label ? { ...n, label } : n;
  });

  const resolve = (id: string): { id: string; board: boolean } => {
    const board = boardFor.get(id);
    return board ? { id: board, board: true } : { id, board: false };
  };

  const edges: SemanticEdge[] = [];
  const boardEdges: ReusePlan["boardEdges"] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const from = resolve(e.from);
    const to = resolve(e.to);
    const pair = [from.id, to.id].sort().join("|");
    if (from.id === to.id || seen.has(pair)) continue;
    seen.add(pair);
    if (from.board || to.board) {
      boardEdges.push({ edge: e, from: from.id, to: to.id, fromBoard: from.board, toBoard: to.board });
    } else {
      edges.push({ ...e, from: from.id, to: to.id });
    }
  }

  const drawnIds = new Set(renamed.map((n) => n.id));
  const minMembers = groupsAsZones ? 1 : 2;
  const groups = (graph.groups ?? []).flatMap((g) => {
    const nodeIds = Array.from(new Set(g.nodeIds.map((id) => resolve(id)).filter((r) => !r.board && drawnIds.has(r.id)).map((r) => r.id)));
    return nodeIds.length >= minMembers ? [{ ...g, nodeIds }] : [];
  });

  return { graph: { ...graph, nodes: renamed, edges, groups }, boardEdges, standIns };
}

const BOARD_CLEARANCE_PX = 32;

function translate(el: JevElement, dx: number, dy: number): JevElement {
  if (dx === 0 && dy === 0) return el;
  if (el.kind === "arrow") {
    return {
      ...el,
      ...(el.fromPoint ? { fromPoint: { x: el.fromPoint.x + dx, y: el.fromPoint.y + dy } } : {}),
      ...(el.toPoint ? { toPoint: { x: el.toPoint.x + dx, y: el.toPoint.y + dy } } : {}),
    };
  }
  return {
    ...el,
    x: Math.round(el.x + dx),
    y: Math.round(el.y + dy),
    ...(el.points ? { points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}),
  };
}

function spotBelow(rect: Rect, obstacles: Rect[]): { x: number; y: number } {
  return resolveNonOverlappingTopLeft(rect, rect, obstacles, "down", BOARD_CLEARANCE_PX);
}

const SPIRAL_STEP = { x: 96, y: 76 };
const SPIRAL_RINGS = 12;

/** Candidate top-left spots around `rect`: itself, then rings below, right, above and left (nearest first). */
function* spiralSpots(rect: Rect): Generator<{ x: number; y: number }> {
  yield { x: rect.x, y: rect.y };
  for (let ring = 1; ring <= SPIRAL_RINGS; ring++) {
    const offsets: Array<[number, number]> = [];
    for (let dx = -ring; dx <= ring; dx++) offsets.push([dx, ring]);
    for (let dy = -ring + 1; dy <= ring - 1; dy++) offsets.push([ring, dy]);
    for (let dx = -ring; dx <= ring; dx++) offsets.push([dx, -ring]);
    for (let dy = -ring + 1; dy <= ring - 1; dy++) offsets.push([-ring, dy]);
    for (const [ox, oy] of offsets) yield { x: rect.x + ox * SPIRAL_STEP.x, y: rect.y + oy * SPIRAL_STEP.y };
  }
}

const centerOf = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Whether the straight line between two centres runs through `r` (where its arrow and label would be drawn). */
function lineCrosses(a: Rect, b: Rect, r: Rect): boolean {
  const p = centerOf(a);
  const q = centerOf(b);
  for (let t = 0.1; t <= 0.9; t += 0.05) {
    const x = p.x + (q.x - p.x) * t;
    const y = p.y + (q.y - p.y) * t;
    if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return true;
  }
  return false;
}

interface Placed {
  id: string;
  rect: Rect;
}

/**
 * Moves each group (its zone or frame with its members) and each loose shape, in order, to the nearest spot that
 * is clear of the board and of everything placed before it, preferring a spot where no arrow it takes part in
 * (`links`) runs through another shape and it does not sit on another arrow, so labels stay readable. The selected
 * shapes' stand-ins (`firstIds`) keep their spot whenever it is free.
 */
function settleClear(
  elements: JevElement[],
  groupMembers: string[][],
  board: Placed[],
  links: Array<[string, string]>,
  firstIds: ReadonlySet<string>
): JevElement[] {
  const containers = elements.filter((e) => isContainerKind(e.kind));
  const shapes = elements.filter((e) => isShapeElement(e) && !isContainerKind(e.kind));
  const assigned = new Set<string>();
  const units: string[][] = [];
  groupMembers.forEach((members, idx) => {
    const frame = containers[idx];
    const own = members.filter((id) => !assigned.has(id));
    own.forEach((id) => assigned.add(id));
    if (frame) units.push([frame.id, ...own]);
    else own.forEach((id) => units.push([id]));
  });
  containers.slice(groupMembers.length).forEach((c) => units.push([c.id]));
  for (const s of shapes) if (!assigned.has(s.id)) units.push([s.id]);
  units.sort((a, b) => Number(b.some((id) => firstIds.has(id))) - Number(a.some((id) => firstIds.has(id))));

  const byId = new Map(elements.map((e) => [e.id, e]));
  const placed: Placed[] = [...board];
  const where = new Map(board.map((p) => [p.id, p.rect]));
  const shapeIds = new Set(shapes.map((e) => e.id));
  for (const unit of units) {
    const members = unit.map((id) => byId.get(id)).filter((e): e is JevElement => Boolean(e));
    const rect = computeBounds(members);
    if (!rect) continue;
    const inUnit = new Set(unit);
    const ownLinks = links.filter(([a, b]) => inUnit.has(a) !== inUnit.has(b) && where.has(inUnit.has(a) ? b : a));
    const otherLinks = links.filter(([a, b]) => !inUnit.has(a) && !inUnit.has(b) && where.has(a) && where.has(b));
    const crossings = (dx: number, dy: number): number => {
      const moved = (id: string) => {
        const r = getElementRect(byId.get(id)!);
        return { ...r, x: r.x + dx, y: r.y + dy };
      };
      const box = { ...rect, x: rect.x + dx, y: rect.y + dy };
      let n = 0;
      for (const [a, b] of ownLinks) {
        const mine = moved(inUnit.has(a) ? a : b);
        const other = where.get(inUnit.has(a) ? b : a)!;
        n += placed.filter((p) => p.rect !== other && lineCrosses(mine, other, p.rect)).length;
      }
      for (const [a, b] of otherLinks) if (lineCrosses(where.get(a)!, where.get(b)!, box)) n++;
      return n;
    };
    let best: { x: number; y: number; n: number } | null = null;
    for (const spot of spiralSpots(rect)) {
      const box = { ...rect, ...spot };
      if (placed.some((p) => rectsOverlap(box, p.rect, BOARD_CLEARANCE_PX))) continue;
      const stays = spot.x === rect.x && spot.y === rect.y && unit.some((id) => firstIds.has(id));
      const n = stays ? 0 : crossings(spot.x - rect.x, spot.y - rect.y);
      if (!best || n < best.n) best = { ...spot, n };
      if (n === 0) break;
    }
    const spot = best ?? resolveNonOverlappingTopLeft(rect, rect, placed.map((p) => p.rect), "down", BOARD_CLEARANCE_PX);
    const dx = Math.round(spot.x - rect.x);
    const dy = Math.round(spot.y - rect.y);
    for (const m of members) {
      const next = translate(m, dx, dy);
      byId.set(m.id, next);
      if (shapeIds.has(m.id)) where.set(m.id, getElementRect(next));
    }
    placed.push({ id: unit[0], rect: { ...rect, x: rect.x + dx, y: rect.y + dy } });
  }
  return elements.map((e) => byId.get(e.id) ?? e);
}

const obstacleRects = (elements: JevElement[]): Rect[] =>
  elements.filter((e) => isShapeElement(e) && !isContainerKind(e.kind)).map(getElementRect);

function forkArrow(source: JevElement, fromId: string, toId: string, now: number): JevElement {
  const id = uid("fka");
  return {
    id,
    kind: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    label: source.label,
    tone: source.tone as ColorTone,
    seed: makeSeed(id),
    fromId,
    toId,
    arrowStyle: source.arrowStyle ?? "curved",
    ...(source.dashed ? { dashed: true } : {}),
    ...(source.bidirectional ? { bidirectional: true } : {}),
    createdAt: now,
    updatedAt: now,
    rev: 1,
  };
}

/** Each selected shape's stand-in sits where the user drew that shape, centred on it. */
function snapStandIns(elements: JevElement[], selected: JevElement[], standInEl: Map<string, string>): JevElement[] {
  const target = new Map<string, JevElement>();
  for (const s of selected) {
    const id = standInEl.get(s.id);
    if (id) target.set(id, s);
  }
  return elements.map((e) => {
    const s = target.get(e.id);
    if (!s) return e;
    return { ...e, x: Math.round(s.x + s.width / 2 - e.width / 2), y: Math.round(s.y + s.height / 2 - e.height / 2) };
  });
}

/** Refits every group's frame or zone around its members after they moved. */
function fitContainers(elements: JevElement[], groupMembers: string[][]): JevElement[] {
  const containers = elements.filter((e) => isContainerKind(e.kind));
  const byId = new Map(elements.map((e) => [e.id, e]));
  const fitted = new Map<string, JevElement>();
  groupMembers.forEach((members, idx) => {
    const frame = containers[idx];
    const b = computeBounds(members.map((id) => byId.get(id)).filter((e): e is JevElement => Boolean(e)));
    if (!frame || !b) return;
    fitted.set(frame.id, {
      ...frame,
      x: Math.round(b.x - ZONE_PAD.left),
      y: Math.round(b.y - ZONE_PAD.top),
      width: Math.round(b.width + ZONE_PAD.left + ZONE_PAD.right),
      height: Math.round(b.height + ZONE_PAD.top + ZONE_PAD.bottom),
    });
  });
  return elements.map((e) => fitted.get(e.id) ?? e);
}

/**
 * Materializes a validated ForkTakeSpec (heuristic, pattern or LLM) onto the board: nodes the board already has
 * are reused, the selected shapes' stand-ins sit where those shapes were, new nodes go to free space, and every
 * arrow that touched the selection is rewired to the stand-in of the shape it touched. `previewElements` is the
 * same take as one ghost block beside the selection, moved down until it covers nothing on the board.
 */
export function materializeForkTake(
  spec: ForkTakeSpec,
  subgraph: SelectedSubgraph,
  now = Date.now()
): ForkTake {
  const plan = planReuse(spec.graph, subgraph, Boolean(spec.groupsAsZones));
  const layout = layoutSemanticGraphToElements(plan.graph, {
    anchorBounds: subgraph.bounds,
    idPrefix: "fk",
    colGap: 236,
    rowGap: 112,
    now,
  });
  const stacked = spec.groupsAsZones ? stackZones(layout.elements, plan.graph, layout.nodeIdMap) : layout.elements;

  const standInEl = new Map<string, string>();
  for (const [selId, semId] of plan.standIns) {
    const elId = layout.nodeIdMap.get(semId);
    if (elId) standInEl.set(selId, elId);
  }
  const byId = new Map(stacked.map((e) => [e.id, e]));
  const offsets = subgraph.selectedShapes.flatMap((s) => {
    const el = byId.get(standInEl.get(s.id) ?? "");
    return el ? [{ dx: s.x + s.width / 2 - (el.x + el.width / 2), dy: s.y + s.height / 2 - (el.y + el.height / 2) }] : [];
  });
  const dx = offsets.length ? offsets.reduce((sum, o) => sum + o.dx, 0) / offsets.length : 0;
  const dy = offsets.length ? offsets.reduce((sum, o) => sum + o.dy, 0) / offsets.length : 0;
  const groupMembers = (plan.graph.groups ?? []).map((g) =>
    g.nodeIds.map((id) => layout.nodeIdMap.get(id)).filter((id): id is string => Boolean(id))
  );
  const anchored = fitContainers(
    snapStandIns(
      stacked.map((e) => translate(e, dx, dy)),
      subgraph.selectedShapes,
      standInEl
    ),
    groupMembers
  );
  const boardObstacles = obstacleRects(subgraph.surroundings);
  const boardPlaced = subgraph.surroundings
    .filter((e) => isShapeElement(e) && !isContainerKind(e.kind))
    .map((e) => ({ id: e.id, rect: getElementRect(e) }));
  const links: Array<[string, string]> = [
    ...anchored.flatMap((e): Array<[string, string]> => (e.kind === "arrow" && e.fromId && e.toId ? [[e.fromId, e.toId]] : [])),
    ...plan.boardEdges.map((b): [string, string] => [
      b.fromBoard ? b.from : layout.nodeIdMap.get(b.from) ?? "",
      b.toBoard ? b.to : layout.nodeIdMap.get(b.to) ?? "",
    ]),
    ...subgraph.incomingExternal.map((a): [string, string] => [a.fromId ?? "", standInEl.get(a.toId ?? "") ?? ""]),
    ...subgraph.outgoingExternal.map((a): [string, string] => [standInEl.get(a.fromId ?? "") ?? "", a.toId ?? ""]),
  ].filter(([a, b]) => a && b);
  const laidOut = settleClear(anchored, groupMembers, boardPlaced, links, new Set(standInEl.values()));

  const shapeEls = laidOut.filter((e) => isShapeElement(e) && !isContainerKind(e.kind));
  const leftmost = [...shapeEls].sort((a, b) => a.x - b.x || a.y - b.y)[0];
  const rightmost = [...shapeEls].sort((a, b) => b.x + b.width - (a.x + a.width) || a.y - b.y)[0];
  const entryElementId = leftmost?.id ?? laidOut[0]?.id ?? "";
  const exitElementId = rightmost?.id ?? entryElementId;

  const linked = new Set(
    [...subgraph.surroundings, ...laidOut]
      .filter((e) => e.kind === "arrow" && e.fromId && e.toId)
      .map((e) => [e.fromId, e.toId].sort().join("|"))
  );
  const link = (arrow: JevElement, into: JevElement[]) => {
    const pair = [arrow.fromId, arrow.toId].sort().join("|");
    if (!arrow.fromId || !arrow.toId || arrow.fromId === arrow.toId || linked.has(pair)) return;
    linked.add(pair);
    into.push(arrow);
  };

  // An arrow of a selected shape the take dropped goes to the take's entry or exit, so its outside node is not
  // left alone. When the take wires that outside node itself, the take has said who talks to it: nothing is added.
  const wiredByTake = new Set(plan.boardEdges.flatMap((b) => [b.fromBoard ? b.from : "", b.toBoard ? b.to : ""]));
  const rewiredArrows: JevElement[] = [];
  for (const inc of subgraph.incomingExternal) {
    const standIn = standInEl.get(inc.toId ?? "");
    const toId = standIn ?? (wiredByTake.has(inc.fromId ?? "") ? "" : entryElementId);
    if (inc.fromId && toId) link(forkArrow(inc, inc.fromId, toId, now), rewiredArrows);
  }
  for (const out of subgraph.outgoingExternal) {
    const standIn = standInEl.get(out.fromId ?? "");
    const fromId = standIn ?? (wiredByTake.has(out.toId ?? "") ? "" : exitElementId);
    if (out.toId && fromId) link(forkArrow(out, fromId, out.toId, now), rewiredArrows);
  }

  const reuseArrows: JevElement[] = [];
  for (const b of plan.boardEdges) {
    const from = b.fromBoard ? b.from : layout.nodeIdMap.get(b.from);
    const to = b.toBoard ? b.to : layout.nodeIdMap.get(b.to);
    if (from && to) link(semanticEdgeToArrow(b.edge, from, to, now), reuseArrows);
  }

  const { previewElements: shifted, placement } = shiftElementsForForkPreview(laidOut, subgraph.bounds);
  const previewBlock = computeBounds(shifted.filter((e) => e.kind !== "arrow"));
  const previewSpot = previewBlock
    ? spotBelow(previewBlock, [...boardObstacles, ...obstacleRects(subgraph.selectedShapes)])
    : null;
  const previewShapes =
    previewBlock && previewSpot
      ? shifted.map((e) => translate(e, previewSpot.x - previewBlock.x, previewSpot.y - previewBlock.y))
      : shifted;
  const reusedIds = new Set(plan.boardEdges.flatMap((b) => [b.fromBoard ? b.from : "", b.toBoard ? b.to : ""]));
  const previewReuseArrows = reuseArrows.filter((a) => reusedIds.has(a.fromId ?? "") || reusedIds.has(a.toId ?? ""));

  return {
    ...spec,
    id: uid("fork"),
    elements: [...laidOut, ...rewiredArrows, ...reuseArrows],
    previewElements: [...previewShapes, ...previewReuseArrows],
    previewPlacement: placement,
    entryElementId,
    exitElementId,
    feedbackKeys: [`fork:${spec.archetype}`, "cat:fork"],
  };
}

/**
 * Generates 3 genuinely distinct local heuristic architectural takes for the selected subgraph.
 * Always honestly labeled `isHeuristic: true` with `confidence: null` and no fabricated probabilities.
 */
export function buildLocalForkTakes(
  selectedIds: string[],
  allElements: JevElement[],
  now = Date.now()
): ForkGenerationResult | null {
  const subgraph = extractSelectedSubgraph(selectedIds, allElements);
  if (!subgraph) return null;

  const specs: ForkTakeSpec[] = [
    buildQueueEventDrivenSpec(subgraph),
    buildCacheReadReplicaSpec(subgraph),
    buildGatewayOrMeshSpec(subgraph),
  ];

  const takes = specs.map((spec) => materializeForkTake(spec, subgraph, now));

  return {
    subgraph,
    replacedIds: subgraph.replacedIds,
    takes,
    source: "heuristic",
    model: "heuristic",
    isHeuristic: true,
    confidence: null,
  };
}

/**
 * Atomically produces the next board element array replacing `replacedIds` with the chosen Fork take.
 * Caller passes this into `updateElements` -> `applyLocalElementsChange` so replaced IDs receive
 * bumped tombstones and new elements receive bumped revisions for WebRTC sync + single-step Undo.
 */
export function applyForkTakeToBoard(
  currentElements: JevElement[],
  replacedIds: string[],
  take: ForkTake
): JevElement[] {
  const removeSet = new Set(replacedIds);
  const selectionBounds = computeBounds(
    currentElements.filter((el) => removeSet.has(el.id) && el.kind !== "arrow")
  );
  const kept = makeRoomForSwap(
    currentElements.filter((el) => !removeSet.has(el.id)),
    take.elements,
    selectionBounds
  );
  const framesToAdd = take.elements.filter((e) => isContainerKind(e.kind));
  const othersToAdd = take.elements.filter((e) => !isContainerKind(e.kind));
  return [...framesToAdd, ...kept, ...othersToAdd];
}

const SWAP_CLEARANCE_PX = 32;

type PushDirection = "left" | "right" | "up" | "down";

function isPushableShape(el: JevElement): boolean {
  return el.kind !== "arrow" && el.kind !== "freedraw" && el.kind !== "frame";
}

function pushDirectionFor(rect: Rect, selection: Rect): PushDirection {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const right = selection.x + selection.width;
  const bottom = selection.y + selection.height;
  const outX = cx < selection.x ? selection.x - cx : cx > right ? cx - right : 0;
  const outY = cy < selection.y ? selection.y - cy : cy > bottom ? cy - bottom : 0;
  if (outX === 0 && outY === 0) return "down";
  if (outX >= outY) return cx < selection.x ? "left" : "right";
  return cy < selection.y ? "up" : "down";
}

function clearOf(rect: Rect, obstacles: Rect[], dir: PushDirection): Rect {
  const next = { ...rect };
  for (let guard = 0; guard <= obstacles.length; guard++) {
    const hit = obstacles.find((o) => rectsOverlap(next, o, SWAP_CLEARANCE_PX));
    if (!hit) break;
    if (dir === "left") next.x = hit.x - SWAP_CLEARANCE_PX - next.width - 1;
    if (dir === "right") next.x = hit.x + hit.width + SWAP_CLEARANCE_PX + 1;
    if (dir === "up") next.y = hit.y - SWAP_CLEARANCE_PX - next.height - 1;
    if (dir === "down") next.y = hit.y + hit.height + SWAP_CLEARANCE_PX + 1;
  }
  return next;
}

/**
 * Pushes kept shapes out of the area the accepted take occupies (and cascades to the
 * shapes they bump into), moving each away from the original selection.
 */
function makeRoomForSwap(
  kept: JevElement[],
  added: JevElement[],
  selection: Rect | null
): JevElement[] {
  const obstacles: Rect[] = added
    .filter((e) => e.kind !== "arrow" && e.kind !== "freedraw")
    .map(getElementRect);
  if (!selection || obstacles.length === 0) return kept;

  const moved = new Map<string, Rect>();
  let changed = true;
  for (let pass = 0; changed && pass <= kept.length; pass++) {
    changed = false;
    for (const el of kept) {
      if (!isPushableShape(el) || moved.has(el.id)) continue;
      const rect = getElementRect(el);
      if (!obstacles.some((o) => rectsOverlap(rect, o, SWAP_CLEARANCE_PX))) continue;
      const cleared = clearOf(rect, obstacles, pushDirectionFor(rect, selection));
      moved.set(el.id, cleared);
      obstacles.push(cleared);
      changed = true;
    }
  }

  if (moved.size === 0) return kept;
  return kept.map((el) => {
    const r = moved.get(el.id);
    return r ? { ...el, x: Math.round(r.x), y: Math.round(r.y) } : el;
  });
}

export const rawForkTakeSpecSchema = z.object({
  archetype: forkArchetypeSchema.optional().default("queue_event_driven"),
  title: z.string().trim().min(2).max(80),
  rationale: z.string().trim().min(6).max(200),
  tradeoffTag: z.string().trim().min(2).max(48),
  graph: z.unknown(),
});

export const rawForkTakesPayloadSchema = z.object({
  takes: z.array(rawForkTakeSpecSchema).length(3),
});

export const rawConstrainedForkTakeSpecSchema = rawForkTakeSpecSchema.extend({
  buys: z.string().trim().min(4).max(180),
  costs: forkCostLinesSchema,
  failureMode: z.string().trim().min(4).max(160),
});

export const rawConstrainedForkTakesPayloadSchema = z.object({
  takes: z.array(rawConstrainedForkTakeSpecSchema).length(3),
});

/** Text that is only displayed. Ids, edge endpoints and enums are never shortened: that would rewire the graph. */
const DISPLAY_TEXT_KEYS = new Set<PropertyKey>([
  "title", "rationale", "tradeoffTag", "buys", "failureMode", "text", "summary", "label", "sublabel", "role",
]);

function shorten(text: string, max: number): string {
  // By code point, as zod measures max().
  const head = Array.from(text).slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  const kept = space >= max / 2 ? head.slice(0, space) : head;
  return `${kept.replace(/[\s,;:]+$/, "")}…`;
}

/**
 * Repairs what is only cosmetic: display text over the maximum `schema` reports is shortened, an unknown tone is
 * dropped. Every other violation is left to the validator.
 */
function repairCosmeticFields(schema: z.ZodType, raw: unknown): unknown {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return raw;
  const copy = structuredClone(raw);
  for (const issue of parsed.error.issues) {
    const key = issue.path[issue.path.length - 1];
    const tooLong = issue.code === "too_big" && issue.origin === "string" && DISPLAY_TEXT_KEYS.has(key);
    const unknownTone = issue.code === "invalid_value" && key === "tone";
    if (!tooLong && !unknownTone) continue;
    const parent = issue.path
      .slice(0, -1)
      .reduce<unknown>((node, step) => (node as Record<PropertyKey, unknown>)[step], copy) as Record<PropertyKey, string>;
    if (issue.code === "too_big") parent[key] = shorten(parent[key].trim(), Number(issue.maximum));
    else delete parent[key];
  }
  return copy;
}

/**
 * The model returns trade-offs flat on each take; validated takes (what the decide route
 * sends to the client) carry them nested under `tradeoffs`. Accept both shapes.
 */
function flattenValidatedTradeoffs(raw: object): unknown {
  const takes = (raw as { takes?: unknown }).takes;
  if (!Array.isArray(takes)) return raw;
  return {
    ...raw,
    takes: takes.map((t) => {
      if (!t || typeof t !== "object" || !("tradeoffs" in t)) return t;
      const { tradeoffs, ...rest } = t as { tradeoffs?: unknown } & Record<string, unknown>;
      if (!tradeoffs || typeof tradeoffs !== "object") return rest;
      const { buys, costs, failureMode } = tradeoffs as Record<string, unknown>;
      return { ...rest, buys, costs, failureMode };
    }),
  };
}

/**
 * Validates model-generated takes. With a stated constraint every take must also carry
 * `buys`, one cost line per axis and a `failureMode`; they land on `take.tradeoffs`.
 * Cosmetic slips are repaired: they are no reason to discard three otherwise valid takes.
 */
export function validateForkTakesPayload(
  raw: unknown,
  opts: { constraint?: ForkConstraint | null } = {}
): { ok: true; takes: ForkTakeSpec[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || hasForbiddenObjectKeys(raw)) {
    return { ok: false, error: "Invalid or unsafe fork takes payload" };
  }
  const pressure = opts.constraint?.pressure;
  const flat = flattenValidatedTradeoffs(raw);
  const payloadSchema = pressure ? rawConstrainedForkTakesPayloadSchema : rawForkTakesPayloadSchema;
  const parsed = payloadSchema.safeParse(repairCosmeticFields(payloadSchema, flat));
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid fork takes payload",
    };
  }

  const validatedTakes: ForkTakeSpec[] = [];
  for (const item of parsed.data.takes as Array<
    z.infer<typeof rawForkTakeSpecSchema> & Partial<z.infer<typeof rawConstrainedForkTakeSpecSchema>>
  >) {
    const graphCheck = validateSemanticGraph(repairCosmeticFields(semanticGraphSchema, item.graph));
    if (!graphCheck.ok) {
      return { ok: false, error: `Invalid take graph: ${graphCheck.error}` };
    }
    const { buys, costs, failureMode } = item;
    validatedTakes.push({
      archetype: item.archetype,
      title: item.title,
      rationale: item.rationale,
      tradeoffTag: item.tradeoffTag,
      graph: graphCheck.graph,
      ...(pressure && buys && costs && failureMode
        ? { tradeoffs: { pressure, buys, costs, failureMode } }
        : {}),
    });
  }

  return { ok: true, takes: validatedTakes };
}

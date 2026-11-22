import { z } from "zod";
import { inferToneFromLabel } from "./colors";
import { extractSelectedSubgraph } from "./fork-engine";
import {
  computeBounds,
  getElementRect,
  isShapeElement,
  makeSeed,
  Rect,
  rectsOverlap,
  uid,
} from "./geometry";
import {
  cardinalityToEnds,
  formatTransitionLabel,
  isContainerKind,
  parseEntityRows,
  parseTransitionLabel,
} from "./notation-kinds";
import { hasForbiddenObjectKeys, type SerializedBoardGraph } from "./semantic-graph";
import { fragmentLayout } from "./shape-layout";
import {
  isValidFragmentRange,
  MAX_LABEL_LENGTH,
  MAX_MORPH_SNAPSHOT_ELEMENTS,
  MAX_MORPH_SNAPSHOT_POINTS,
  MORPH_ACTOR_KINDS,
  MORPH_FRAGMENT_OPERATORS,
  MAX_SUBLABEL_LENGTH,
  MORPH_FRAGMENT_RANGE_ERROR,
} from "./sync-validation";
import type {
  ArrowEnd,
  ElementMorphMeta,
  JevElement,
  MorphActorSpec,
  MorphEntitySpec,
  MorphFragmentSpec,
  MorphGroupRecord,
  MorphMessageSpec,
  MorphNotation,
  MorphRelationSpec,
  MorphSemanticSpec,
  MorphStateSpec,
  MorphStepSpec,
  MorphTransitionSpec,
  Point,
  ShapeKind,
  SketchSnapshotElement,
} from "./types";

export type { MorphNotation, MorphSemanticSpec, MorphGroupRecord };

export const ALL_MORPH_NOTATIONS: readonly MorphNotation[] = [
  "sketch",
  "sequence",
  "flowchart",
  "state",
  "er",
] as const;

export const MORPH_NOTATION_LABELS: Record<MorphNotation, string> = {
  sketch: "Sketch",
  sequence: "Sequence",
  flowchart: "Flowchart",
  state: "State",
  er: "ER",
};

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafeKey(value: string): boolean {
  return !FORBIDDEN_KEYS.has(value);
}

const safeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .refine(isSafeKey, "Unsafe identifier");

const colorToneSchema = z.enum([
  "ink",
  "terracotta",
  "cobalt",
  "teal",
  "ochre",
  "plum",
  "slate",
]);

export const morphNotationSchema = z.enum([
  "sketch",
  "sequence",
  "flowchart",
  "state",
  "er",
]);

export const morphSemanticSpecSchema = z.object({
  summary: z.string().trim().min(1).transform((text) => text.slice(0, 160)),
  actors: z
    .array(
      z.object({
        id: safeIdSchema,
        label: z.string().trim().min(1).max(160),
        kind: z.enum(MORPH_ACTOR_KINDS).optional(),
        tone: colorToneSchema.optional(),
      })
    )
    .max(32)
    .default([]),
  messages: z
    .array(
      z.object({
        id: safeIdSchema,
        from: safeIdSchema,
        to: safeIdSchema,
        label: z.string().trim().min(1).max(140),
        order: z.number().int().min(0).max(200),
        async: z.boolean().optional(),
        isReturn: z.boolean().optional(),
      })
    )
    .max(48)
    .default([]),
  steps: z
    .array(
      z.object({
        id: safeIdSchema,
        label: z.string().trim().min(1).max(160),
        kind: z.enum(["start", "process", "decision", "end"]),
        tone: colorToneSchema.optional(),
        branches: z
          .array(
            z.object({
              to: safeIdSchema,
              label: z.string().trim().max(80).optional(),
              fallback: z.boolean().optional(),
            })
          )
          .max(8)
          .optional(),
      })
    )
    .max(40)
    .default([]),
  states: z
    .array(
      z.object({
        id: safeIdSchema,
        label: z.string().trim().min(1).max(140),
        initial: z.boolean().optional(),
        terminal: z.boolean().optional(),
        tone: colorToneSchema.optional(),
      })
    )
    .max(32)
    .default([]),
  transitions: z
    .array(
      z.object({
        id: safeIdSchema,
        from: safeIdSchema,
        to: safeIdSchema,
        event: z.string().trim().min(1).max(100),
        guard: z.string().trim().max(100).optional(),
        action: z.string().trim().max(100).optional(),
        fallback: z.boolean().optional(),
      })
    )
    .max(48)
    .default([]),
  entities: z
    .array(
      z.object({
        id: safeIdSchema,
        name: z.string().trim().min(1).max(120),
        attributes: z.array(z.string().trim().min(1).max(120)).max(16),
        tone: colorToneSchema.optional(),
      })
    )
    .max(24)
    .default([]),
  relations: z
    .array(
      z.object({
        id: safeIdSchema,
        from: safeIdSchema,
        to: safeIdSchema,
        cardinality: z.string().trim().min(1).max(24),
        label: z.string().trim().max(80).optional(),
      })
    )
    .max(48)
    .default([]),
  fragments: z
    .array(
      z
        .object({
          id: safeIdSchema,
          operator: z.enum(MORPH_FRAGMENT_OPERATORS),
          guard: z.string().trim().max(100),
          fromOrder: z.number().int().min(0).max(200),
          toOrder: z.number().int().min(0).max(200),
          elseFromOrder: z.number().int().min(0).max(200).optional(),
          elseGuard: z.string().trim().max(100).optional(),
        })
        .refine(isValidFragmentRange, MORPH_FRAGMENT_RANGE_ERROR)
    )
    .max(16)
    .optional(),
});

/** The arrays a morph to each notation draws from; a spec for that notation must carry them. */
export const MORPH_NOTATION_ARRAYS = {
  sequence: ["actors", "messages"],
  flowchart: ["steps"],
  state: ["states", "transitions"],
  er: ["entities", "relations"],
} as const satisfies Record<Exclude<MorphNotation, "sketch">, ReadonlyArray<keyof MorphSemanticSpec>>;

/**
 * Arrays of the notations not being drawn default to empty: models answering a sequence morph omit states, steps
 * and so on. With `target`, the arrays that notation draws from must be present.
 */
export function validateMorphSemanticSpec(
  raw: unknown,
  target?: Exclude<MorphNotation, "sketch">
): { ok: true; spec: MorphSemanticSpec } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || hasForbiddenObjectKeys(raw)) {
    return { ok: false, error: "Invalid or unsafe morph semantic spec" };
  }
  const missing = target ? MORPH_NOTATION_ARRAYS[target].find((key) => !Array.isArray((raw as Record<string, unknown>)[key])) : undefined;
  if (missing) return { ok: false, error: `A ${target} morph needs a "${missing}" array` };
  const parsed = morphSemanticSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Morph semantic spec schema mismatch",
    };
  }
  return { ok: true, spec: parsed.data };
}

/**
 * Holds a refined (AI) spec to the selection. `selection` is the deterministic spec of the selection, whose
 * messages are exactly the arrows drawn between selected shapes. A refined message survives only if it matches
 * one of those arrows (same participants, each arrow used once); a participant only if it is a selected shape.
 * Fragments follow the surviving messages.
 */
export function constrainMorphSpecToSelection(
  refined: MorphSemanticSpec,
  selection: Pick<MorphSemanticSpec, "actors" | "messages">
): MorphSemanticSpec {
  const norm = (text: string) => text.trim().toLowerCase();
  const selectionActorIds = new Set(selection.actors.map((a) => a.id));
  const selectionActorByLabel = new Map(selection.actors.map((a) => [norm(a.label), a.id]));
  const resolved = new Map<string, string>();
  for (const actor of refined.actors) {
    const match = selectionActorIds.has(actor.id) ? actor.id : selectionActorByLabel.get(norm(actor.label));
    if (match) resolved.set(actor.id, match);
  }

  const unused = selection.messages.map((m) => `${m.from}>${m.to}`);
  const kept = [...refined.messages]
    .sort((a, b) => a.order - b.order)
    .filter((m) => {
      const idx = unused.indexOf(`${resolved.get(m.from)}>${resolved.get(m.to)}`);
      if (idx < 0) return false;
      unused.splice(idx, 1);
      return true;
    });
  const newOrder = new Map(kept.map((m, idx) => [m.order, idx + 1]));
  const fragments = refined.fragments?.flatMap((f) => {
    const fromOrder = newOrder.get(f.fromOrder);
    const toOrder = newOrder.get(f.toOrder);
    const elseFromOrder = f.elseFromOrder === undefined ? undefined : newOrder.get(f.elseFromOrder);
    if (fromOrder === undefined || toOrder === undefined) return [];
    if (f.elseFromOrder !== undefined && elseFromOrder === undefined) return [];
    return [{ ...f, fromOrder, toOrder, ...(elseFromOrder !== undefined ? { elseFromOrder } : {}) }];
  });

  return {
    ...refined,
    actors: refined.actors.filter((a) => resolved.has(a.id)),
    messages: kept.map((m) => ({ ...m, order: newOrder.get(m.order)! })),
    ...(fragments ? { fragments } : {}),
  };
}

/** The deterministic sequence of a serialized selection: its selected shapes and the arrows between them. */
export function selectionSpecFromGraph(
  graph: Pick<SerializedBoardGraph, "nodes" | "edges" | "selectedIds">
): Pick<MorphSemanticSpec, "actors" | "messages"> {
  const selected = new Set(graph.selectedIds);
  return {
    actors: graph.nodes.filter((n) => selected.has(n.id)).map((n) => ({ id: n.id, label: n.label || n.id })),
    messages: graph.edges
      .filter((e) => selected.has(e.from) && selected.has(e.to))
      .map((e, idx) => ({ id: e.id, from: e.from, to: e.to, label: e.label || e.id, order: idx + 1 })),
  };
}

export interface SelectionMorphState {
  notation: MorphNotation;
  groupId: string | null;
  groupElements: JevElement[];
  groupRecord: MorphGroupRecord | null;
}

export interface MorphOperationResult {
  groupId: string;
  notation: MorphNotation;
  spec: MorphSemanticSpec;
  replacedIds: string[];
  addedElements: JevElement[];
  nextSelectedIds: string[];
  entryElementId: string;
  exitElementId: string;
  isHeuristic: boolean;
}

/**
 * Inspects the current selection to detect if it belongs to an existing reversible
 * Notation Morph group, returning its active notation, full member list, and shared record.
 */
export function detectSelectionMorphState(
  selectedIds: string[],
  allElements: JevElement[]
): SelectionMorphState {
  if (selectedIds.length === 0 || allElements.length === 0) {
    return {
      notation: "sketch",
      groupId: null,
      groupElements: [],
      groupRecord: null,
    };
  }

  const selSet = new Set(selectedIds);
  let foundGroupId: string | null = null;
  let foundNotation: MorphNotation = "sketch";

  for (const el of allElements) {
    if (!selSet.has(el.id)) continue;
    if (el.morphMeta?.groupId) {
      foundGroupId = el.morphMeta.groupId;
      foundNotation = el.morphMeta.notation;
      break;
    }
  }

  if (!foundGroupId) {
    return {
      notation: "sketch",
      groupId: null,
      groupElements: [],
      groupRecord: null,
    };
  }

  const groupElements = allElements.filter(
    (e) => e.morphMeta?.groupId === foundGroupId
  );
  const recordHolder = groupElements.find((e) => e.morphMeta?.groupRecord);
  const groupRecord = recordHolder?.morphMeta?.groupRecord ?? null;

  return {
    notation: foundNotation,
    groupId: foundGroupId,
    groupElements,
    groupRecord,
  };
}

function downsamplePoints(points: Point[] | undefined): Point[] | undefined {
  if (!points || points.length === 0) return undefined;
  if (points.length <= MAX_MORPH_SNAPSHOT_POINTS) {
    return points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  }
  const stride = (points.length - 1) / (MAX_MORPH_SNAPSHOT_POINTS - 1);
  const out: Point[] = [];
  for (let i = 0; i < MAX_MORPH_SNAPSHOT_POINTS; i++) {
    const pt = points[Math.min(points.length - 1, Math.round(i * stride))];
    out.push({ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 });
  }
  return out;
}

function toEntityName(label: string): string {
  const cleaned = label
    .replace(/\?/g, "")
    .replace(/\b(service|api|server|gateway|db|database|store|cache|queue|check|engine|worker|layer|system)\b/gi, "")
    .trim();
  const base = cleaned || label.replace(/\?/g, "").trim() || "Record";
  return base
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function inferEntityAttributes(rawLabel: string, entityName: string): string[] {
  const l = `${rawLabel} ${entityName}`.toLowerCase();
  const attrs: string[] = ["id uuid PK"];

  if (/(user|account|customer|client|browser|auth|member)/.test(l)) {
    attrs.push("email text UK", "role text", "created_at timestamptz");
  } else if (/(order|checkout|cart|invoice|payment|billing|ledger)/.test(l)) {
    attrs.push("status text", "amount_cents int", "created_at timestamptz");
  } else if (/(stock|inventory|item|product|catalog)/.test(l)) {
    attrs.push("sku text UK", "qty_available int", "updated_at timestamptz");
  } else if (/(cache|redis|session|token|jwt)/.test(l)) {
    attrs.push("cache_key text UK", "ttl_seconds int", "expires_at timestamptz");
  } else if (/(event|queue|kafka|message|job|worker|webhook)/.test(l)) {
    attrs.push("topic text", "payload jsonb", "processed_at timestamptz");
  } else {
    attrs.push("status text", "payload jsonb", "updated_at timestamptz");
  }
  return attrs;
}

const MANY_ENDS = new Set<ArrowEnd>(["er_many", "er_one_many", "er_zero_many"]);
const DEFAULT_CARDINALITY = "1:N";

/** Crow's-foot ends for a relation; unparseable cardinality falls back to 1:N and reports it. */
export function resolveRelationEnds(cardinality: string): {
  startEnd: ArrowEnd;
  endEnd: ArrowEnd;
  assumed: boolean;
} {
  const parsed = cardinalityToEnds(cardinality);
  if (parsed) return { ...parsed, assumed: false };
  return { ...cardinalityToEnds(DEFAULT_CARDINALITY)!, assumed: true };
}

function foreignKeyName(entityName: string): string {
  const stem = entityName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const singular = stem.length > 3 && /[^s]s$/.test(stem) ? stem.slice(0, -1) : stem;
  return `${singular || "parent"}_id`;
}

/**
 * Entity rows with keys made explicit: every entity gets an `id uuid PK` row unless it
 * already has a PK, and the many side of each relation gets `<one>_id uuid FK`
 * (FK UK on the dependent side of a 1:1). Many-to-many adds no FK: that needs a join table.
 */
export function buildEntityRows(
  entities: MorphEntitySpec[],
  relations: MorphRelationSpec[]
): Map<string, string[]> {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const rows = new Map<string, string[]>();
  for (const ent of entities) {
    const own = [...ent.attributes];
    if (!parseEntityRows(own.join("\n")).some((r) => r.keys.includes("PK"))) {
      own.unshift("id uuid PK");
    }
    rows.set(ent.id, own);
  }
  for (const rel of relations) {
    const from = byId.get(rel.from);
    const to = byId.get(rel.to);
    if (!from || !to || from.id === to.id) continue;
    const { startEnd, endEnd } = resolveRelationEnds(rel.cardinality);
    const fromMany = MANY_ENDS.has(startEnd);
    const toMany = MANY_ENDS.has(endEnd);
    if (fromMany && toMany) continue;
    const [child, parent, unique] = fromMany
      ? [from, to, false]
      : toMany
        ? [to, from, false]
        : [to, from, true];
    const fk = foreignKeyName(parent.name);
    const childRows = rows.get(child.id)!;
    if (parseEntityRows(childRows.join("\n")).some((r) => r.name === fk)) continue;
    childRows.push(`${fk} uuid FK${unique ? " UK" : ""}`);
  }
  return rows;
}

function toActorKind(kind: JevElement["kind"]): ShapeKind {
  return (MORPH_ACTOR_KINDS as readonly string[]).includes(kind) ? (kind as ShapeKind) : "node";
}

/**
 * Sketch arrow label → UML transition parts. Only a `[guard]` or a spaced ` / ` marks UML
 * syntax, so HTTP labels like "POST /orders" stay whole events.
 */
function parseSketchTransition(label: string): { event: string; guard?: string; action?: string } {
  if (!/\[[^\]]*\]/.test(label) && !/\s\/\s/.test(label)) return { event: label };
  return parseTransitionLabel(label);
}

function inferEdgeVerb(fromLabel: string, toLabel: string, rawLabel?: string): string {
  if (rawLabel && rawLabel.trim().length > 0) return rawLabel.trim();
  const toL = toLabel.toLowerCase();
  if (/(db|database|postgres|mysql|mongo|store|ledger|replica)/.test(toL)) {
    return "persist";
  }
  if (/(cache|redis)/.test(toL)) return "lookup";
  if (/(queue|kafka|event|bus|topic|worker)/.test(toL)) return "publish";
  if (/(\?|check|valid|stock|auth|verify|guard|gate)/.test(toL)) return "validate";
  return `call ${toLabel.split(/\s+/)[0] || "next"}`.slice(0, 28);
}

function inferCardinality(fromLabel: string, toLabel: string, edgeLabel?: string): string {
  const combined = `${fromLabel} ${toLabel} ${edgeLabel ?? ""}`.toLowerCase();
  if (/(tag|role|group|permission|many|link|join|mesh)/.test(combined)) {
    return "N:M";
  }
  if (/(profile|session|token|config|setting|check|auth)/.test(combined)) {
    return "1:1";
  }
  return "1:N";
}

function isDecisionShape(el: JevElement): boolean {
  return (
    el.kind === "diamond" ||
    /(\?|\bcheck\b|\bvalid|\bin stock|\bapproved|\bauthorized|\bhit\b|\bif\b)/i.test(
      el.label
    )
  );
}

function isStartLikeShape(el: JevElement): boolean {
  return (
    el.kind === "ellipse" &&
    /^(start|begin|user|client|browser|customer|visitor)$/i.test(el.label.trim())
  );
}

function topoOrderShapes(
  shapes: JevElement[],
  internalArrows: JevElement[]
): JevElement[] {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const inDeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const s of shapes) {
    inDeg.set(s.id, 0);
    out.set(s.id, []);
  }
  for (const a of internalArrows) {
    if (a.fromId && a.toId && byId.has(a.fromId) && byId.has(a.toId) && a.fromId !== a.toId) {
      out.get(a.fromId)!.push(a.toId);
      inDeg.set(a.toId, (inDeg.get(a.toId) ?? 0) + 1);
    }
  }

  const ordered: JevElement[] = [];
  const visited = new Set<string>();
  const sortGeo = (a: JevElement, b: JevElement) => a.x - b.x || a.y - b.y;
  const queue = shapes
    .filter((s) => (inDeg.get(s.id) ?? 0) === 0)
    .sort(sortGeo);

  while (ordered.length < shapes.length) {
    if (queue.length === 0) {
      const remaining = shapes.filter((s) => !visited.has(s.id)).sort(sortGeo);
      if (remaining.length === 0) break;
      queue.push(remaining[0]);
    }
    const curr = queue.shift()!;
    if (visited.has(curr.id)) continue;
    visited.add(curr.id);
    ordered.push(curr);

    const nextIds = out.get(curr.id) ?? [];
    for (const nid of nextIds) {
      if (visited.has(nid)) continue;
      const d = (inDeg.get(nid) ?? 1) - 1;
      inDeg.set(nid, d);
      if (d <= 0) {
        const nextEl = byId.get(nid);
        if (nextEl) {
          queue.push(nextEl);
          queue.sort(sortGeo);
        }
      }
    }
  }
  return ordered;
}

function extractSelectionWithSemanticIds(
  selectedIds: string[],
  allElements: JevElement[]
): {
  orderedShapes: JevElement[];
  selectedFrames: JevElement[];
  internalArrows: JevElement[];
  incomingExternal: JevElement[];
  outgoingExternal: JevElement[];
  replacedIds: string[];
  bounds: Rect;
  idToSemId: Map<string, string>;
  entryNode: JevElement;
  exitNode: JevElement;
} | null {
  const subgraph = extractSelectedSubgraph(selectedIds, allElements);
  if (!subgraph) return null;

  const orderedShapes = topoOrderShapes(
    subgraph.selectedShapes,
    subgraph.internalArrows
  );
  const idToSemId = new Map<string, string>();
  orderedShapes.forEach((shape, idx) => {
    idToSemId.set(shape.id, shape.morphMeta?.semanticId ?? `sem_${idx}`);
  });

  return {
    orderedShapes,
    selectedFrames: subgraph.selectedFrames,
    internalArrows: subgraph.internalArrows,
    incomingExternal: subgraph.incomingExternal,
    outgoingExternal: subgraph.outgoingExternal,
    replacedIds: subgraph.replacedIds,
    bounds: subgraph.bounds,
    idToSemId,
    entryNode: orderedShapes[0] ?? subgraph.entryNode,
    exitNode: orderedShapes[orderedShapes.length - 1] ?? subgraph.exitNode,
  };
}

/**
 * Deterministically extracts a complete, shared MorphSemanticSpec covering
 * Sequence (actors/messages), Flowchart (steps/decisions), State (states/transitions),
 * and ER (entities/relations) from any 1+ selected canvas elements.
 */
export function extractMorphSemanticSpec(
  selectedIds: string[],
  allElements: JevElement[]
): MorphSemanticSpec | null {
  const extracted = extractSelectionWithSemanticIds(selectedIds, allElements);
  if (!extracted) return null;

  const { orderedShapes, internalArrows, idToSemId } = extracted;
  const bySemId = new Map<string, JevElement>();
  for (const s of orderedShapes) {
    bySemId.set(idToSemId.get(s.id)!, s);
  }

  // The user's arrows with both ends selected; arrows reaching outside the selection never count.
  const arrowEdges: Array<{
    from: string;
    to: string;
    label: string;
    dashed?: boolean;
  }> = [];
  const MAX_MESSAGES = 48;

  for (const arr of internalArrows) {
    if (!arr.fromId || !arr.toId) continue;
    const from = idToSemId.get(arr.fromId);
    const to = idToSemId.get(arr.toId);
    if (!from || !to || from === to) continue;
    const fromEl = bySemId.get(from)!;
    const toEl = bySemId.get(to)!;
    arrowEdges.push({
      from,
      to,
      label: inferEdgeVerb(fromEl.label, toEl.label, arr.label),
      dashed: arr.dashed,
    });
  }

  // Flowchart, state and ER chain an arrowless selection in topological order; sequence never does.
  const normEdges = [...arrowEdges];
  if (normEdges.length === 0 && orderedShapes.length > 1) {
    for (let i = 0; i < orderedShapes.length - 1; i++) {
      const fromEl = orderedShapes[i];
      const toEl = orderedShapes[i + 1];
      normEdges.push({
        from: idToSemId.get(fromEl.id)!,
        to: idToSemId.get(toEl.id)!,
        label: inferEdgeVerb(fromEl.label, toEl.label),
      });
    }
  }

  const summary =
    orderedShapes.length === 1
      ? orderedShapes[0].label || "Diagram"
      : `${orderedShapes[0].label} → ${orderedShapes[orderedShapes.length - 1].label}`;

  // 1) SEQUENCE: one participant per selected shape, one message per arrow the user drew.
  const actors: MorphActorSpec[] = orderedShapes.map((s) => ({
    id: idToSemId.get(s.id)!,
    label: s.label || "Actor",
    kind: toActorKind(s.kind),
    tone: s.tone,
  }));
  const messages: MorphMessageSpec[] = [];
  // An arrow back to a caller whose sync call is still open is that call's drawn return.
  const callStack: Array<{ from: string; to: string }> = [];
  const openCallReturnedBy = (edge: { from: string; to: string }): number => {
    for (let i = callStack.length - 1; i >= 0; i--) {
      if (callStack[i].from !== edge.to) continue;
      if (callStack.slice(i).some((call) => call.to === edge.from)) return i;
    }
    return -1;
  };
  for (const edge of arrowEdges.slice(0, MAX_MESSAGES)) {
    const base = { id: `msg_${messages.length + 1}`, order: messages.length + 1, from: edge.from, to: edge.to, label: edge.label };
    const returned = openCallReturnedBy(edge);
    if (returned >= 0) {
      callStack.length = returned;
      messages.push({ ...base, isReturn: true });
      continue;
    }
    while (callStack.length > 0 && callStack[callStack.length - 1].to !== edge.from) callStack.pop();
    messages.push(edge.dashed ? { ...base, async: true } : base);
    if (!edge.dashed) callStack.push({ from: edge.from, to: edge.to });
  }

  // 2) FLOWCHART: start pill, process boxes, decision diamonds (Yes/No), end pill
  const steps: MorphStepSpec[] = [];
  const startId = "flow_start";
  const endId = "flow_end";
  const firstIsStart =
    orderedShapes.length > 0 && isStartLikeShape(orderedShapes[0]);

  if (!firstIsStart) {
    steps.push({
      id: startId,
      label: "Start",
      kind: "start",
      tone: "teal",
      branches: orderedShapes[0]
        ? [{ to: idToSemId.get(orderedShapes[0].id)! }]
        : [{ to: endId }],
    });
  }

  const outgoingBySem = new Map<string, typeof normEdges>();
  for (const e of normEdges) {
    const arr = outgoingBySem.get(e.from) ?? [];
    arr.push(e);
    outgoingBySem.set(e.from, arr);
  }

  let hasDecisionStep = false;
  orderedShapes.forEach((shape, idx) => {
    const semId = idToSemId.get(shape.id)!;
    const outEdges = outgoingBySem.get(semId) ?? [];
    const decision = isDecisionShape(shape) || outEdges.length >= 2;
    if (decision) hasDecisionStep = true;

    const nextDefaultId =
      idx + 1 < orderedShapes.length
        ? idToSemId.get(orderedShapes[idx + 1].id)!
        : endId;

    const branches: NonNullable<MorphStepSpec["branches"]> = [];
    if (outEdges.length > 0) {
      outEdges.forEach((oe, bIdx) => {
        const isFallback =
          Boolean(oe.dashed) ||
          /^(no|fail|error|retry|reject|miss|fallback)$/i.test(oe.label);
        branches.push({
          to: oe.to,
          label: decision
            ? oe.label || (bIdx === 0 ? "Yes" : "No")
            : oe.label,
          fallback: isFallback,
        });
      });
    } else {
      branches.push({
        to: nextDefaultId,
        ...(decision ? { label: "Yes" } : {}),
      });
    }

    if (decision && !branches.some((b) => b.fallback || /^no$/i.test(b.label ?? ""))) {
      const retryId = `flow_retry_${idx}`;
      steps.push({
        id: semId,
        label: shape.label.endsWith("?") ? shape.label : `${shape.label}?`,
        kind: "decision",
        tone: "plum",
        branches: [
          ...branches.map((b, i) => ({
            ...b,
            label: b.label || (i === 0 ? "Yes" : "Next"),
          })),
          { to: retryId, label: "No", fallback: true },
        ],
      });
      steps.push({
        id: retryId,
        label: "Handle Error",
        kind: "process",
        tone: "terracotta",
        branches: [{ to: endId, label: "abort", fallback: true }],
      });
      return;
    }

    steps.push({
      id: semId,
      label: shape.label || `Step ${idx + 1}`,
      kind: idx === 0 && firstIsStart ? "start" : decision ? "decision" : "process",
      tone: decision ? "plum" : shape.tone,
      branches,
    });
  });

  // If no decision existed in a multi-step flow, keep it crisp; if single node, add a validation diamond
  if (!hasDecisionStep && orderedShapes.length === 1) {
    const soleSemId = idToSemId.get(orderedShapes[0].id)!;
    const soleStep = steps.find((s) => s.id === soleSemId);
    if (soleStep) {
      soleStep.branches = [{ to: "flow_valid" }];
      steps.push(
        {
          id: "flow_valid",
          label: "Success?",
          kind: "decision",
          tone: "plum",
          branches: [
            { to: endId, label: "Yes" },
            { to: "flow_retry", label: "No", fallback: true },
          ],
        },
        {
          id: "flow_retry",
          label: "Retry / Fallback",
          kind: "process",
          tone: "terracotta",
          branches: [{ to: endId, label: "done", fallback: true }],
        }
      );
    }
  }

  steps.push({
    id: endId,
    label: "Done",
    kind: "end",
    tone: "slate",
  });

  // 3) STATE MACHINE: states & event transitions
  const states: MorphStateSpec[] = [];
  const transitions: MorphTransitionSpec[] = [];

  if (orderedShapes.length === 1) {
    const sole = orderedShapes[0];
    const soleSemId = idToSemId.get(sole.id)!;
    states.push(
      { id: soleSemId, label: sole.label || "Idle", initial: true, tone: sole.tone },
      { id: "st_processing", label: "Processing", tone: "cobalt" },
      { id: "st_completed", label: "Completed", terminal: true, tone: "teal" }
    );
    transitions.push(
      { id: "tr_1", from: soleSemId, to: "st_processing", event: "start" },
      { id: "tr_2", from: "st_processing", to: "st_completed", event: "succeed" },
      { id: "tr_3", from: "st_processing", to: soleSemId, event: "retry", fallback: true }
    );
  } else {
    orderedShapes.forEach((shape, idx) => {
      const semId = idToSemId.get(shape.id)!;
      states.push({
        id: semId,
        label: shape.label.replace(/\?$/, "") || `State ${idx + 1}`,
        initial: idx === 0,
        terminal: idx === orderedShapes.length - 1,
        tone: shape.tone,
      });
    });

    normEdges.forEach((edge, idx) => {
      const isFallback =
        Boolean(edge.dashed) ||
        /^(no|fail|error|retry|miss|fallback)$/i.test(edge.label);
      const parts = parseSketchTransition(edge.label);
      transitions.push({
        id: `tr_${idx + 1}`,
        from: edge.from,
        to: edge.to,
        event: parts.event || `on_step_${idx + 1}`,
        ...(parts.guard ? { guard: parts.guard } : {}),
        ...(parts.action ? { action: parts.action } : {}),
        ...(isFallback ? { fallback: true } : {}),
      });
    });
  }

  // 4) ER DIAGRAM: entities with PK/FK rows & crow's-foot relations
  const entities: MorphEntitySpec[] = [];
  const relations: MorphRelationSpec[] = [];

  const entitySourceShapes = orderedShapes.filter((s) => !isDecisionShape(s));
  const effectiveEntityShapes =
    entitySourceShapes.length > 0 ? entitySourceShapes : orderedShapes;

  const entitySemIdSet = new Set(
    effectiveEntityShapes.map((s) => idToSemId.get(s.id)!)
  );

  // Map entity names first
  const entityNameBySemId = new Map<string, string>();
  for (const s of effectiveEntityShapes) {
    const semId = idToSemId.get(s.id)!;
    entityNameBySemId.set(semId, toEntityName(s.label));
  }

  // Collapse edges through skipped decision diamonds so ER entities stay connected
  const collapsedRelations: Array<{ from: string; to: string; label?: string }> = [];
  for (const edge of normEdges) {
    if (entitySemIdSet.has(edge.from) && entitySemIdSet.has(edge.to)) {
      collapsedRelations.push({ from: edge.from, to: edge.to, label: edge.label });
    } else if (entitySemIdSet.has(edge.from) && !entitySemIdSet.has(edge.to)) {
      // Follow 1 hop through decision node
      const nextHops = normEdges.filter((n) => n.from === edge.to);
      for (const nh of nextHops) {
        if (entitySemIdSet.has(nh.to) && nh.to !== edge.from) {
          collapsedRelations.push({
            from: edge.from,
            to: nh.to,
            label: edge.label || nh.label,
          });
        }
      }
    }
  }

  if (collapsedRelations.length === 0 && effectiveEntityShapes.length > 1) {
    for (let i = 0; i < effectiveEntityShapes.length - 1; i++) {
      collapsedRelations.push({
        from: idToSemId.get(effectiveEntityShapes[i].id)!,
        to: idToSemId.get(effectiveEntityShapes[i + 1].id)!,
        label: "links",
      });
    }
  }

  for (const s of effectiveEntityShapes) {
    const semId = idToSemId.get(s.id)!;
    const name = entityNameBySemId.get(semId) ?? toEntityName(s.label);
    entities.push({
      id: semId,
      name,
      attributes: inferEntityAttributes(s.label, name),
      tone: s.tone === "slate" ? "cobalt" : s.tone,
    });
  }

  if (entities.length === 1) {
    const primary = entities[0];
    const childId = "er_child_event";
    const childName = `${primary.name.split(/\s+/)[0] || "Domain"} Record`;
    entities.push({
      id: childId,
      name: childName,
      attributes: inferEntityAttributes(childName, childName),
      tone: "teal",
    });
    relations.push({
      id: "rel_1",
      from: primary.id,
      to: childId,
      cardinality: "1:N",
      label: "owns",
    });
  } else {
    const seenRel = new Set<string>();
    collapsedRelations.forEach((r, idx) => {
      const key = `${r.from}->${r.to}`;
      if (seenRel.has(key) || r.from === r.to) return;
      seenRel.add(key);
      const fromName = entityNameBySemId.get(r.from) ?? "";
      const toName = entityNameBySemId.get(r.to) ?? "";
      relations.push({
        id: `rel_${idx + 1}`,
        from: r.from,
        to: r.to,
        cardinality: inferCardinality(fromName, toName, r.label),
        ...(r.label ? { label: r.label } : {}),
      });
    });
  }

  const keyedRows = buildEntityRows(entities, relations);
  const keyedEntities = entities.map((e) => ({
    ...e,
    attributes: keyedRows.get(e.id)!.slice(0, 16),
  }));

  return {
    summary,
    actors,
    messages,
    steps,
    states,
    transitions,
    entities: keyedEntities,
    relations,
  };
}

function getExpectedLabelForNotation(
  record: MorphGroupRecord,
  notation: MorphNotation,
  semId: string
): string | null {
  if (notation === "sequence") {
    return record.spec.actors.find((a) => a.id === semId)?.label ?? null;
  }
  if (notation === "flowchart") {
    return record.spec.steps.find((s) => s.id === semId)?.label ?? null;
  }
  if (notation === "state") {
    return record.spec.states.find((s) => s.id === semId)?.label ?? null;
  }
  if (notation === "er") {
    return record.spec.entities.find((e) => e.id === semId)?.name ?? null;
  }
  return record.sketchSnapshot.find((s) => s.semanticId === semId)?.label ?? null;
}

function syncEditedLabelsIntoGroupRecord(
  groupElements: JevElement[],
  record: MorphGroupRecord
): MorphGroupRecord {
  const editedBySemId = new Map<string, string>();
  for (const el of groupElements) {
    const semId = el.morphMeta?.semanticId;
    const notation = el.morphMeta?.notation;
    if (!semId || !notation || !isShapeElement(el)) continue;
    const trimmed = el.label.trim();
    if (!trimmed) continue;
    const expected = getExpectedLabelForNotation(record, notation, semId);
    if (expected !== null && trimmed === expected.trim()) {
      continue;
    }
    editedBySemId.set(semId, trimmed);
  }
  const editedTransitions = new Map<string, Pick<MorphTransitionSpec, "event" | "guard" | "action">>();
  for (const el of groupElements) {
    const semId = el.morphMeta?.semanticId;
    if (el.kind !== "arrow" || el.morphMeta?.notation !== "state" || !semId) continue;
    const tr = record.spec.transitions.find((t) => t.id === semId);
    const label = el.label.trim();
    if (!tr || !label || label === formatTransitionLabel(tr.event, tr.guard, tr.action)) continue;
    const parts = parseTransitionLabel(label);
    if (parts.event) editedTransitions.set(semId, parts);
  }
  if (editedBySemId.size === 0 && editedTransitions.size === 0) return record;

  const updatedSpec: MorphSemanticSpec = {
    ...record.spec,
    actors: record.spec.actors.map((a) =>
      editedBySemId.has(a.id) ? { ...a, label: editedBySemId.get(a.id)! } : a
    ),
    steps: record.spec.steps.map((s) =>
      editedBySemId.has(s.id) ? { ...s, label: editedBySemId.get(s.id)! } : s
    ),
    states: record.spec.states.map((s) =>
      editedBySemId.has(s.id) ? { ...s, label: editedBySemId.get(s.id)! } : s
    ),
    transitions: record.spec.transitions.map((t) => {
      const edit = editedTransitions.get(t.id);
      if (!edit) return t;
      return {
        id: t.id,
        from: t.from,
        to: t.to,
        ...(t.fallback ? { fallback: true } : {}),
        ...edit,
      };
    }),
    entities: record.spec.entities.map((e) =>
      editedBySemId.has(e.id) ? { ...e, name: editedBySemId.get(e.id)! } : e
    ),
  };

  const updatedSnapshot = record.sketchSnapshot.map((item) => {
    if (item.semanticId && editedBySemId.has(item.semanticId)) {
      return { ...item, label: editedBySemId.get(item.semanticId)! };
    }
    return item;
  });

  return {
    ...record,
    spec: updatedSpec,
    sketchSnapshot: updatedSnapshot,
  };
}

function resolveShapeOverlaps(shapes: JevElement[], minGap = 20): void {
  for (let pass = 0; pass < 14; pass++) {
    let moved = false;
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i];
        const b = shapes[j];
        if (rectsOverlap(getElementRect(a), getElementRect(b), minGap)) {
          const targetY = Math.round(a.y + a.height + minGap + 8);
          if (b.y < targetY) {
            b.y = targetY;
          } else {
            b.x = Math.round(a.x + a.width + minGap + 8);
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function shiftElementsToAnchorCenter(
  elements: JevElement[],
  anchorBounds: Rect
): void {
  const shapes = elements.filter((e) => isShapeElement(e));
  const curBounds = computeBounds(shapes.length > 0 ? shapes : elements);
  if (!curBounds) return;
  const targetCx = anchorBounds.x + anchorBounds.width / 2;
  const targetCy = anchorBounds.y + anchorBounds.height / 2;
  const curCx = curBounds.x + curBounds.width / 2;
  const curCy = curBounds.y + curBounds.height / 2;
  const dx = Math.round(targetCx - curCx);
  const dy = Math.round(targetCy - curCy);

  for (const el of elements) {
    if (el.kind === "arrow") {
      if (el.fromPoint) {
        el.fromPoint = { x: el.fromPoint.x + dx, y: el.fromPoint.y + dy };
      }
      if (el.toPoint) {
        el.toPoint = { x: el.toPoint.x + dx, y: el.toPoint.y + dy };
      }
      if (!el.fromId && !el.toId) {
        el.x += dx;
        el.y += dy;
      }
    } else if (el.kind === "freedraw" && el.points) {
      el.x += dx;
      el.y += dy;
      el.points = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      el.x += dx;
      el.y += dy;
    }
  }
}

interface SequenceActivation {
  actorId: string;
  startRow: number;
  endRow: number;
  openedByRow: number;
}

/**
 * Activation spans from message order: a participant activates when it receives a call (or
 * sends the first one) and deactivates on its return; an unreturned activation ends at the
 * participant's last message.
 */
export function computeSequenceActivations(messages: MorphMessageSpec[]): {
  activations: SequenceActivation[];
  callEndRow: number[];
} {
  const open = new Map<string, SequenceActivation>();
  const done: SequenceActivation[] = [];
  const lastRow = new Map<string, number>();
  const callEndRow = messages.map((_, r) => r);

  messages.forEach((m, r) => {
    lastRow.set(m.from, r);
    lastRow.set(m.to, r);
    if (m.isReturn) {
      const act = open.get(m.from);
      if (act) {
        act.endRow = r;
        callEndRow[act.openedByRow] = r;
        open.delete(m.from);
        done.push(act);
      }
      return;
    }
    if (!open.has(m.from)) {
      open.set(m.from, { actorId: m.from, startRow: r, endRow: r, openedByRow: -1 });
    }
    if (!open.has(m.to)) {
      open.set(m.to, { actorId: m.to, startRow: r, endRow: r, openedByRow: r });
    }
  });
  for (const act of open.values()) {
    act.endRow = Math.max(act.startRow, lastRow.get(act.actorId) ?? act.startRow);
    done.push(act);
  }
  return { activations: done, callEndRow };
}

interface ResolvedFragment {
  operator: MorphFragmentSpec["operator"];
  guard: string;
  fromRow: number;
  toRow: number;
  elseRow?: number;
  elseGuard?: string;
}

const LOOP_LABEL = /\b(retry|retries|retrying|poll|polling|for each \w+|foreach|repeat)\b/i;
const OPT_LABEL = /\b(optional(?:ly)?|if enabled|when enabled|if configured)\b/i;
const IF_LABEL = /^if\s+(.+)$/i;
const ELSE_LABEL = /^(?:(else|otherwise)\b|on\s+(miss|failure|error)\b|if\s+(not\b.*))/i;

function stripGuardWord(text: string): string {
  return text.replace(/^(if|when)\s+/i, "").trim();
}

/**
 * Conservative fragment inference from message labels: a "retry/poll/for each" call is a
 * loop, an "if X" call followed by the same sender's "else/on miss" call is an alt, and an
 * "optional/if enabled" (or lone "if X") call is an opt. Anything else infers nothing.
 */
export function inferSequenceFragments(messages: MorphMessageSpec[], callEndRow: number[]): ResolvedFragment[] {
  const out: ResolvedFragment[] = [];
  const used = new Set<number>();
  const nextFromSameSender = (r: number) => {
    for (let s = r + 1; s < messages.length; s++) {
      if (messages[s].isReturn) continue;
      return messages[s].from === messages[r].from ? s : -1;
    }
    return -1;
  };
  messages.forEach((m, r) => {
    if (m.isReturn || used.has(r)) return;
    const label = m.label.trim();
    const loop = label.match(LOOP_LABEL);
    if (loop) {
      out.push({ operator: "loop", guard: loop[1].toLowerCase(), fromRow: r, toRow: callEndRow[r] });
      used.add(r);
      return;
    }
    const ifMatch = label.match(IF_LABEL);
    if (ifMatch && !OPT_LABEL.test(label)) {
      const s = nextFromSameSender(r);
      const elseMatch = s >= 0 ? messages[s].label.trim().match(ELSE_LABEL) : null;
      if (elseMatch) {
        const elseGuard = elseMatch[1] ? "else" : (elseMatch[2] ?? elseMatch[3]).trim().toLowerCase();
        out.push({
          operator: "alt",
          guard: ifMatch[1].trim(),
          fromRow: r,
          elseRow: s,
          toRow: Math.max(s, callEndRow[s]),
          elseGuard,
        });
        used.add(r);
        used.add(s);
        return;
      }
      out.push({ operator: "opt", guard: ifMatch[1].trim(), fromRow: r, toRow: callEndRow[r] });
      used.add(r);
      return;
    }
    const opt = label.match(OPT_LABEL);
    if (opt) {
      out.push({ operator: "opt", guard: stripGuardWord(opt[1].toLowerCase()), fromRow: r, toRow: callEndRow[r] });
      used.add(r);
    }
  });
  return out;
}

function resolveSpecFragments(fragments: MorphFragmentSpec[], messages: MorphMessageSpec[]): ResolvedFragment[] {
  const out: ResolvedFragment[] = [];
  for (const f of fragments) {
    const fromRow = messages.findIndex((m) => m.order >= f.fromOrder);
    let toRow = -1;
    messages.forEach((m, r) => {
      if (m.order <= f.toOrder) toRow = r;
    });
    if (fromRow < 0 || toRow < fromRow) continue;
    const elseRow =
      f.operator === "alt" && f.elseFromOrder !== undefined
        ? messages.findIndex((m) => m.order >= f.elseFromOrder!)
        : -1;
    out.push({
      operator: f.operator,
      guard: f.guard,
      fromRow,
      toRow,
      ...(elseRow > fromRow && elseRow <= toRow ? { elseRow, elseGuard: f.elseGuard || "else" } : {}),
    });
  }
  return out;
}

function bracketGuard(guard: string): string {
  const g = guard.trim().replace(/^\[|\]$/g, "").trim();
  return `[${g || "else"}]`;
}

function fragmentSublabel(f: ResolvedFragment): string {
  if (f.elseRow !== undefined) return `${bracketGuard(f.guard)}\n${bracketGuard(f.elseGuard ?? "else")}`;
  return f.guard.trim() ? bracketGuard(f.guard) : "";
}

const SEQ_ACTOR_W = 156;
const SEQ_PERSON_W = 88;
const SEQ_ACTOR_H = 64;
const SEQ_COL_SPACING = 224;
const SEQ_FIRST_ROW_Y = SEQ_ACTOR_H + 46;
const SEQ_ROW_STEP = 54;
const SEQ_BAR_W = 14;
const SEQ_BAR_PAD = 10;
const FRAG_HEAD = 30;
const FRAG_TOP_INSET = 24;
const FRAG_TAIL = 16;
const FRAG_ELSE_GAP = 22;
const FRAG_SIDE = 64;
const FRAG_NEST_INSET = 10;
/** Mono 11 px advance, as shape-layout lays out guard text. */
const GUARD_CHAR_W = 6.6;

function layoutSequenceNotation(
  spec: MorphSemanticSpec,
  groupId: string,
  anchorBounds: Rect,
  now: number
): { elements: JevElement[]; entryId: string; exitId: string; selectableIds: string[] } {
  const actors: MorphActorSpec[] =
    spec.actors.length > 0
      ? spec.actors
      : [{ id: "act_0", label: "Service", kind: "node", tone: "cobalt" }];

  const meta = (role: ElementMorphMeta["role"], semanticId?: string): ElementMorphMeta => ({
    groupId,
    notation: "sequence",
    ...(semanticId ? { semanticId } : {}),
    role,
  });
  const base = (prefix: string) => {
    const id = uid(prefix);
    return { id, seed: makeSeed(id), createdAt: now, updatedAt: now, rev: 1 };
  };

  const actorEls: JevElement[] = [];
  const actorCenterX = new Map<string, number>();
  actors.forEach((actor, idx) => {
    const isPerson = actor.kind === "actor";
    const width = isPerson ? SEQ_PERSON_W : SEQ_ACTOR_W;
    const cx = idx * SEQ_COL_SPACING + SEQ_ACTOR_W / 2;
    actorEls.push({
      ...base("mseq"),
      kind: isPerson ? "actor" : "node",
      x: cx - width / 2,
      y: 0,
      width,
      height: SEQ_ACTOR_H,
      label: actor.label,
      tone: actor.tone ?? inferToneFromLabel(actor.label),
      morphMeta: meta("actor", actor.id),
    });
    actorCenterX.set(actor.id, cx);
  });

  const orderedMsgs = [...spec.messages]
    .filter((m) => actorCenterX.has(m.from) && actorCenterX.has(m.to) && m.from !== m.to)
    .sort((a, b) => a.order - b.order);
  const { activations, callEndRow } = computeSequenceActivations(orderedMsgs);
  const fragments = (
    spec.fragments ? resolveSpecFragments(spec.fragments, orderedMsgs) : inferSequenceFragments(orderedMsgs, callEndRow)
  ).sort((a, b) => a.fromRow - b.fromRow || b.toRow - a.toRow);

  const contains = (outer: ResolvedFragment, inner: ResolvedFragment) =>
    fragments.indexOf(outer) < fragments.indexOf(inner) &&
    outer.fromRow <= inner.fromRow &&
    outer.toRow >= inner.toRow;
  const innerStartingWith = (f: ResolvedFragment) =>
    fragments.filter((g) => g.fromRow === f.fromRow && contains(f, g)).length;

  const rowCount = orderedMsgs.length;
  const gapBefore = new Array<number>(rowCount + 1).fill(0);
  const gapAfter = new Array<number>(rowCount + 1).fill(0);
  for (const f of fragments) {
    gapBefore[f.fromRow] += FRAG_HEAD;
    gapAfter[f.toRow] += FRAG_TAIL;
    if (f.elseRow !== undefined) gapBefore[f.elseRow] += FRAG_ELSE_GAP;
  }

  let rowY: number[] = [];
  const computeRows = () => {
    rowY = [];
    let y = SEQ_FIRST_ROW_Y;
    for (let r = 0; r < rowCount; r++) {
      y += gapBefore[r];
      rowY.push(y);
      y += SEQ_ROW_STEP + gapAfter[r];
    }
    return y;
  };
  const fragTop = (f: ResolvedFragment) => rowY[f.fromRow] - FRAG_TOP_INSET - FRAG_HEAD * innerStartingWith(f);
  const extraBottom = new Map<ResolvedFragment, number>();
  const fragBottom = (f: ResolvedFragment): number => {
    const own = rowY[f.toRow] + SEQ_BAR_PAD + FRAG_TAIL - 4 + (extraBottom.get(f) ?? 0);
    const inner = fragments.filter((g) => g.toRow === f.toRow && contains(f, g)).map((g) => fragBottom(g) + FRAG_TAIL);
    return Math.max(own, ...inner);
  };
  const elseDivider = (f: ResolvedFragment) => rowY[f.elseRow!] - FRAG_ELSE_GAP - 6;

  // The renderer splits an alt evenly by operand count, so pad the shorter operand until the
  // midpoint lands on the else boundary.
  let contentBottom = computeRows();
  for (let pass = 0; pass < 4; pass++) {
    let adjusted = false;
    for (const f of fragments) {
      if (f.elseRow === undefined) continue;
      const delta = fragBottom(f) + fragTop(f) - 2 * elseDivider(f);
      if (Math.abs(delta) < 1) continue;
      if (delta > 0) gapBefore[f.elseRow] += delta;
      else {
        extraBottom.set(f, (extraBottom.get(f) ?? 0) - delta);
        gapAfter[f.toRow] += -delta;
      }
      adjusted = true;
    }
    contentBottom = computeRows();
    if (!adjusted) break;
  }

  const lifelineTop = SEQ_ACTOR_H + 4;
  const lifelineBottomY = Math.max(contentBottom, SEQ_FIRST_ROW_Y + SEQ_ROW_STEP) + 20;
  const lifelineEls: JevElement[] = actors.map((actor) => {
    const cx = actorCenterX.get(actor.id)!;
    return {
      ...base("mlife"),
      kind: "arrow",
      x: cx,
      y: lifelineTop,
      width: 0,
      height: lifelineBottomY - lifelineTop,
      fromPoint: { x: cx, y: lifelineTop },
      toPoint: { x: cx, y: lifelineBottomY },
      label: "",
      tone: "slate",
      arrowStyle: "straight",
      dashed: true,
      startEnd: "none",
      endEnd: "none",
      morphMeta: meta("lifeline", actor.id),
    };
  });

  const barEls = activations.map((act) => {
    const cx = actorCenterX.get(act.actorId)!;
    const top = rowY[act.startRow] - SEQ_BAR_PAD;
    const bottom = act.endRow > act.startRow ? rowY[act.endRow] + SEQ_BAR_PAD : rowY[act.startRow] + 2 * SEQ_BAR_PAD + 4;
    const el: JevElement = {
      ...base("mact"),
      kind: "activation",
      x: cx - SEQ_BAR_W / 2,
      y: top,
      width: SEQ_BAR_W,
      height: bottom - top,
      label: "",
      tone: actors.find((a) => a.id === act.actorId)?.tone ?? "slate",
      morphMeta: meta("activation"),
    };
    return { act, el };
  });

  const edgeX = (actorId: string, row: number, towardX: number): number => {
    const cx = actorCenterX.get(actorId)!;
    const bar = barEls.find((b) => b.act.actorId === actorId && b.act.startRow <= row && b.act.endRow >= row);
    if (!bar) return cx;
    return towardX > cx ? bar.el.x + bar.el.width : bar.el.x;
  };

  const messageEls: JevElement[] = orderedMsgs.map((msg, idx) => {
    const fromCx = actorCenterX.get(msg.from)!;
    const toCx = actorCenterX.get(msg.to)!;
    const fromX = edgeX(msg.from, idx, toCx);
    const toX = edgeX(msg.to, idx, fromCx);
    const y = rowY[idx];
    return {
      ...base("mmsg"),
      kind: "arrow",
      x: fromX,
      y,
      width: toX - fromX,
      height: 0,
      fromPoint: { x: fromX, y },
      toPoint: { x: toX, y },
      label: `${idx + 1}. ${msg.label}`,
      tone: msg.isReturn ? "slate" : msg.async ? "ochre" : "cobalt",
      arrowStyle: "straight",
      ...(msg.isReturn ? { dashed: true } : {}),
      startEnd: "none",
      endEnd: msg.isReturn || msg.async ? "open" : "arrow",
      morphMeta: meta("message", msg.id),
    };
  });

  const depthOf = (f: ResolvedFragment) => fragments.filter((g) => contains(g, f)).length;
  const fragmentEls: JevElement[] = fragments.map((f) => {
    const involved = orderedMsgs
      .slice(f.fromRow, f.toRow + 1)
      .flatMap((m) => [actorCenterX.get(m.from)!, actorCenterX.get(m.to)!]);
    const inset = depthOf(f) * FRAG_NEST_INSET;
    const sublabel = fragmentSublabel(f);
    const layout = fragmentLayout({ label: f.operator, sublabel, height: 1 });
    const top = fragTop(f);
    const height = fragBottom(f) - top;
    const bands = layout.operands.map((op, i) => ({
      y: top + (i * height) / layout.operands.length,
      width: (i === 0 ? layout.tagWidth + 8 : 10) + op.guard.length * GUARD_CHAR_W + 6,
    }));
    let left = Math.min(...involved) - FRAG_SIDE + inset;
    for (let pass = 0; pass <= barEls.length; pass++) {
      const hit = barEls.find(({ el: bar }) =>
        bands.some((b) => left < bar.x + bar.width && bar.x < left + b.width && b.y < bar.y + bar.height && bar.y < b.y + 20)
      );
      if (!hit) break;
      const band = Math.max(...bands.map((b) => b.width));
      left = Math.min(left - 1, hit.el.x - band - 4);
    }
    const right = Math.max(...involved) + FRAG_SIDE - inset;
    return {
      ...base("mfrag"),
      kind: "fragment",
      x: left,
      y: top,
      width: right - left,
      height,
      label: f.operator,
      sublabel,
      tone: "slate",
      morphMeta: meta("fragment"),
    };
  });

  const all = [...fragmentEls, ...lifelineEls, ...actorEls, ...barEls.map((b) => b.el), ...messageEls];
  shiftElementsToAnchorCenter(all, anchorBounds);

  return {
    elements: all,
    entryId: actorEls[0].id,
    exitId: actorEls[actorEls.length - 1].id,
    selectableIds: actorEls.map((e) => e.id),
  };
}

function layoutFlowchartNotation(
  spec: MorphSemanticSpec,
  groupId: string,
  anchorBounds: Rect,
  now: number
): { elements: JevElement[]; entryId: string; exitId: string; selectableIds: string[] } {
  const steps =
    spec.steps.length > 0
      ? spec.steps
      : [
          { id: "fs", label: "Start", kind: "start" as const, branches: [{ to: "fe" }] },
          { id: "fe", label: "Done", kind: "end" as const },
        ];

  // Identify fallback branch targets so they lay out cleanly to the right column
  const fallbackTargets = new Set<string>();
  for (const s of steps) {
    for (const b of s.branches ?? []) {
      if (b.fallback && b.to !== "flow_end") {
        fallbackTargets.add(b.to);
      }
    }
  }

  const shapeEls: JevElement[] = [];
  const stepIdToElId = new Map<string, string>();
  const rowYByStepId = new Map<string, number>();

  let mainRow = 0;
  for (const step of steps) {
    if (fallbackTargets.has(step.id)) continue;
    const id = uid("mflw");
    const kind =
      step.kind === "start" || step.kind === "end"
        ? "ellipse"
        : step.kind === "decision"
          ? "diamond"
          : "node";
    const width =
      kind === "ellipse"
        ? Math.max(126, Math.min(188, step.label.length * 8.5 + 48))
        : kind === "diamond"
          ? Math.max(154, Math.min(204, step.label.length * 8.4 + 54))
          : Math.max(166, Math.min(220, step.label.length * 8.5 + 48));
    const height = kind === "diamond" ? 96 : kind === "ellipse" ? 56 : 68;
    const x = Math.round(-width / 2);
    const y = mainRow * 128;

    const el: JevElement = {
      id,
      kind,
      x,
      y,
      width: Math.round(width),
      height,
      label: step.label,
      tone:
        step.tone ??
        (step.kind === "start"
          ? "teal"
          : step.kind === "end"
            ? "slate"
            : step.kind === "decision"
              ? "plum"
              : inferToneFromLabel(step.label)),
      seed: makeSeed(id),
      morphMeta: {
        groupId,
        notation: "flowchart",
        semanticId: step.id,
        role: step.kind === "decision" ? "decision" : "step",
      },
      createdAt: now,
      updatedAt: now,
      rev: 1,
    };
    shapeEls.push(el);
    stepIdToElId.set(step.id, id);
    rowYByStepId.set(step.id, y);
    mainRow += 1;
  }

  // Place fallback side-branch steps neatly to the right of their parent decision
  let fallbackIndex = 0;
  for (const step of steps) {
    if (!fallbackTargets.has(step.id)) continue;
    const parentStep = steps.find((s) =>
      (s.branches ?? []).some((b) => b.to === step.id)
    );
    const parentY = parentStep ? (rowYByStepId.get(parentStep.id) ?? fallbackIndex * 128) : fallbackIndex * 128;
    const id = uid("mflw");
    const width = Math.max(156, Math.min(210, step.label.length * 8.5 + 44));
    const height = 66;
    const el: JevElement = {
      id,
      kind: "node",
      x: 184,
      y: parentY + 14,
      width: Math.round(width),
      height,
      label: step.label,
      tone: step.tone ?? "terracotta",
      seed: makeSeed(id),
      morphMeta: {
        groupId,
        notation: "flowchart",
        semanticId: step.id,
        role: "step",
      },
      createdAt: now,
      updatedAt: now,
      rev: 1,
    };
    shapeEls.push(el);
    stepIdToElId.set(step.id, id);
    fallbackIndex += 1;
  }

  resolveShapeOverlaps(shapeEls, 22);

  const arrowEls: JevElement[] = [];
  const seenEdge = new Set<string>();
  for (const step of steps) {
    const fromReal = stepIdToElId.get(step.id);
    if (!fromReal) continue;
    for (const branch of step.branches ?? []) {
      const toReal = stepIdToElId.get(branch.to);
      if (!toReal || fromReal === toReal) continue;
      const key = `${fromReal}->${toReal}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      const arrId = uid("mfa");
      arrowEls.push({
        id: arrId,
        kind: "arrow",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fromId: fromReal,
        toId: toReal,
        label: branch.label ?? "",
        tone: branch.fallback ? "terracotta" : "ink",
        seed: makeSeed(arrId),
        arrowStyle: "curved",
        ...(branch.fallback ? { dashed: true } : {}),
        morphMeta: {
          groupId,
          notation: "flowchart",
          role: "transition",
        },
        createdAt: now,
        updatedAt: now,
        rev: 1,
      });
    }
  }

  const all = [...shapeEls, ...arrowEls];
  shiftElementsToAnchorCenter(all, anchorBounds);

  return {
    elements: all,
    entryId: shapeEls[0].id,
    exitId: shapeEls[shapeEls.length - 1].id,
    selectableIds: shapeEls.map((e) => e.id),
  };
}

const LABEL_CHAR_W = 7.4;

/** Horizontal room an arrow label needs between two columns, plus fixed room for end markers. */
function labelGap(labels: string[], markerRoom: number, min: number, max: number): number {
  const longest = Math.max(0, ...labels.map((l) => l.length));
  return Math.round(Math.max(min, Math.min(max, longest * LABEL_CHAR_W + markerRoom)));
}

const STATE_W_MIN = 158;
const STATE_H = 74;
const INITIAL_SIZE = 26;
const FINAL_SIZE = 30;

function layoutStateNotation(
  spec: MorphSemanticSpec,
  groupId: string,
  anchorBounds: Rect,
  now: number
): { elements: JevElement[]; entryId: string; exitId: string; selectableIds: string[] } {
  const states: MorphStateSpec[] =
    spec.states.length > 0
      ? spec.states
      : [{ id: "st_0", label: "Active", initial: true, terminal: true }];

  const base = (prefix: string) => {
    const id = uid(prefix);
    return { id, seed: makeSeed(id), createdAt: now, updatedAt: now, rev: 1 };
  };
  const meta = (role: ElementMorphMeta["role"], semanticId?: string): ElementMorphMeta => ({
    groupId,
    notation: "state",
    ...(semanticId ? { semanticId } : {}),
    role,
  });

  const initialPseudo: JevElement = {
    ...base("mst_init"),
    kind: "initial",
    x: 0,
    y: Math.round((STATE_H - INITIAL_SIZE) / 2),
    width: INITIAL_SIZE,
    height: INITIAL_SIZE,
    label: "",
    tone: "ink",
    morphMeta: meta("pseudo_state"),
  };

  const stateWidth = (st: MorphStateSpec) =>
    Math.round(Math.max(STATE_W_MIN, Math.min(212, st.label.length * 8.6 + 48)));
  const perRow = Math.min(4, Math.max(2, states.length));
  const colGap =
    Math.max(...states.map(stateWidth)) +
    labelGap(spec.transitions.map((t) => formatTransitionLabel(t.event, t.guard, t.action)), 40, 90, 240);
  const rowGap = 152;
  const stateEls: JevElement[] = [];
  const stateIdToElId = new Map<string, string>();
  states.forEach((st, idx) => {
    const col = idx % perRow;
    const row = Math.floor(idx / perRow);
    const el: JevElement = {
      ...base("mst"),
      kind: "node",
      x: 96 + col * colGap,
      y: row * rowGap,
      width: stateWidth(st),
      height: STATE_H,
      label: st.label,
      tone: st.tone ?? (st.initial ? "cobalt" : st.terminal ? "teal" : inferToneFromLabel(st.label)),
      morphMeta: meta("state", st.id),
    };
    stateEls.push(el);
    stateIdToElId.set(st.id, el.id);
  });

  const terminalStates = states.some((s) => s.terminal) ? states.filter((s) => s.terminal) : [states[states.length - 1]];
  const terminalEls = terminalStates.map((s) => stateEls.find((e) => e.id === stateIdToElId.get(s.id))!);
  const rightmost = terminalEls.reduce((a, b) => (b.x + b.width > a.x + a.width ? b : a));
  const finalPseudo: JevElement = {
    ...base("mst_end"),
    kind: "final",
    x: rightmost.x + rightmost.width + 64,
    y: rightmost.y + Math.round((STATE_H - FINAL_SIZE) / 2),
    width: FINAL_SIZE,
    height: FINAL_SIZE,
    label: "",
    tone: "ink",
    morphMeta: meta("pseudo_state"),
  };

  const shapeEls = [initialPseudo, ...stateEls, finalPseudo];
  resolveShapeOverlaps(shapeEls, 24);

  const arrow = (fromId: string, toId: string, extra: Partial<JevElement>): JevElement => ({
    ...base("mtr"),
    kind: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fromId,
    toId,
    label: "",
    tone: "ink",
    arrowStyle: "straight",
    startEnd: "none",
    endEnd: "arrow",
    morphMeta: meta("transition"),
    ...extra,
  });

  const initialState = states.find((s) => s.initial) ?? states[0];
  const initialRealId = stateIdToElId.get(initialState.id)!;
  const arrowEls: JevElement[] = [arrow(initialPseudo.id, initialRealId, {})];

  for (const tr of spec.transitions) {
    const fromReal = stateIdToElId.get(tr.from);
    const toReal = stateIdToElId.get(tr.to);
    if (!fromReal || !toReal || fromReal === toReal) continue;
    arrowEls.push(
      arrow(fromReal, toReal, {
        label: formatTransitionLabel(tr.event, tr.guard, tr.action),
        tone: tr.fallback ? "terracotta" : "plum",
        arrowStyle: "curved",
        morphMeta: meta("transition", tr.id),
      })
    );
  }
  for (const term of terminalEls) {
    arrowEls.push(arrow(term.id, finalPseudo.id, {}));
  }

  const all = [...shapeEls, ...arrowEls];
  shiftElementsToAnchorCenter(all, anchorBounds);

  return {
    elements: all,
    entryId: initialRealId,
    exitId: terminalEls[terminalEls.length - 1].id,
    selectableIds: shapeEls.map((e) => e.id),
  };
}

function layoutErNotation(
  spec: MorphSemanticSpec,
  groupId: string,
  anchorBounds: Rect,
  now: number
): { elements: JevElement[]; entryId: string; exitId: string; selectableIds: string[] } {
  const entities: MorphEntitySpec[] =
    spec.entities.length > 0
      ? spec.entities
      : [{ id: "ent_0", name: "Entity", attributes: ["created_at timestamptz"] }];
  const rowsById = buildEntityRows(entities, spec.relations);

  const entityWidth = (ent: MorphEntitySpec) => {
    const rows = rowsById.get(ent.id)!;
    const maxLineLen = Math.max(ent.name.length + 2, ...rows.map((a) => a.length));
    return Math.max(204, Math.min(264, Math.round(maxLineLen * 7.6 + 38)));
  };
  const relationLabels = spec.relations.map((rel) => {
    const verb = rel.label?.trim() ?? "";
    const note = resolveRelationEnds(rel.cardinality).assumed ? `(${DEFAULT_CARDINALITY} assumed)` : "";
    return [verb, note].filter(Boolean).join(" ");
  });
  const perRow = Math.min(3, Math.max(2, entities.length));
  const colGap = Math.max(...entities.map(entityWidth)) + labelGap(relationLabels, 64, 110, 260);
  const rowGap = 204;
  const meta = (role: ElementMorphMeta["role"], semanticId: string): ElementMorphMeta => ({
    groupId,
    notation: "er",
    semanticId,
    role,
  });

  const entityEls: JevElement[] = [];
  const entityIdToElId = new Map<string, string>();
  entities.forEach((ent, idx) => {
    const id = uid("mer");
    const rows = rowsById.get(ent.id)!;
    entityEls.push({
      id,
      kind: "entity",
      x: (idx % perRow) * colGap,
      y: Math.floor(idx / perRow) * rowGap,
      width: entityWidth(ent),
      height: Math.max(114, 48 + rows.length * 20),
      label: ent.name,
      sublabel: rows.join("\n"),
      tone: ent.tone ?? inferToneFromLabel(ent.name),
      seed: makeSeed(id),
      morphMeta: meta("entity", ent.id),
      createdAt: now,
      updatedAt: now,
      rev: 1,
    });
    entityIdToElId.set(ent.id, id);
  });

  resolveShapeOverlaps(entityEls, 28);

  const relEls: JevElement[] = [];
  spec.relations.forEach((rel, idx) => {
    const fromReal = entityIdToElId.get(rel.from);
    const toReal = entityIdToElId.get(rel.to);
    if (!fromReal || !toReal || fromReal === toReal) return;
    const { startEnd, endEnd } = resolveRelationEnds(rel.cardinality);
    const arrId = uid("mrel");
    relEls.push({
      id: arrId,
      kind: "arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      fromId: fromReal,
      toId: toReal,
      label: relationLabels[idx],
      tone: "teal",
      seed: makeSeed(arrId),
      arrowStyle: "straight",
      startEnd,
      endEnd,
      morphMeta: meta("relation", rel.id),
      createdAt: now,
      updatedAt: now,
      rev: 1,
    });
  });

  const all = [...entityEls, ...relEls];
  shiftElementsToAnchorCenter(all, anchorBounds);

  return {
    elements: all,
    entryId: entityEls[0].id,
    exitId: entityEls[entityEls.length - 1].id,
    selectableIds: entityEls.map((e) => e.id),
  };
}

function restoreSketchFromGroupRecord(
  record: MorphGroupRecord,
  now: number
): { elements: JevElement[]; entryId: string; exitId: string; selectableIds: string[] } {
  const restored: JevElement[] = record.sketchSnapshot.map((snap) => ({
    id: snap.id,
    kind: snap.kind,
    x: snap.x,
    y: snap.y,
    width: snap.width,
    height: snap.height,
    label: snap.label,
    ...(snap.sublabel !== undefined ? { sublabel: snap.sublabel } : {}),
    tone: snap.tone,
    seed: snap.seed,
    ...(snap.fromId ? { fromId: snap.fromId } : {}),
    ...(snap.toId ? { toId: snap.toId } : {}),
    ...(snap.fromPoint ? { fromPoint: { ...snap.fromPoint } } : {}),
    ...(snap.toPoint ? { toPoint: { ...snap.toPoint } } : {}),
    ...(snap.arrowStyle ? { arrowStyle: snap.arrowStyle } : {}),
    ...(snap.dashed ? { dashed: true } : {}),
    ...(snap.bidirectional ? { bidirectional: true } : {}),
    ...(snap.startEnd ? { startEnd: snap.startEnd } : {}),
    ...(snap.endEnd ? { endEnd: snap.endEnd } : {}),
    ...(snap.points ? { points: snap.points.map((p) => ({ ...p })) } : {}),
    morphMeta: {
      groupId: record.groupId,
      notation: "sketch",
      ...(snap.semanticId ? { semanticId: snap.semanticId } : {}),
      role: "sketch_item",
    },
    createdAt: now,
    updatedAt: now,
    rev: 1,
  }));

  const shapeEls = restored.filter((e) => isShapeElement(e) && e.kind !== "frame");
  const entryId =
    (record.entrySketchId &&
      restored.some((e) => e.id === record.entrySketchId) &&
      record.entrySketchId) ||
    shapeEls[0]?.id ||
    restored[0]?.id ||
    "";
  const exitId =
    (record.exitSketchId &&
      restored.some((e) => e.id === record.exitSketchId) &&
      record.exitSketchId) ||
    shapeEls[shapeEls.length - 1]?.id ||
    entryId;

  return {
    elements: restored,
    entryId,
    exitId,
    selectableIds:
      shapeEls.length > 0 ? shapeEls.map((e) => e.id) : restored.map((e) => e.id),
  };
}

interface BoundarySource {
  elementsById: Map<string, JevElement>;
  semanticIdOf: (el: JevElement) => string | undefined;
}

/**
 * Re-creates an arrow that crosses the selection boundary. Its unselected end never moves; its selected end
 * stays on the morphed element of the same shape (same semantic id), or is pinned where that shape was.
 */
function keepBoundaryArrow(
  arrow: JevElement,
  insideEnd: "from" | "to",
  source: BoundarySource,
  morphed: JevElement[],
  now: number
): JevElement {
  const insideEl = source.elementsById.get((insideEnd === "from" ? arrow.fromId : arrow.toId) ?? "");
  const semId = insideEl ? source.semanticIdOf(insideEl) : undefined;
  const target = semId
    ? morphed.find(
        (e) =>
          isShapeElement(e) &&
          !isContainerKind(e.kind) &&
          e.kind !== "activation" &&
          e.morphMeta?.semanticId === semId
      )
    : undefined;
  const rect = insideEl ? getElementRect(insideEl) : null;
  const pinned = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined;
  const id = uid("mext");
  const { fromId, toId, fromPoint, toPoint } = arrow;
  const rest: JevElement = { ...arrow };
  delete rest.fromId;
  delete rest.toId;
  delete rest.fromPoint;
  delete rest.toPoint;
  delete rest.points;
  return {
    ...rest,
    id,
    seed: makeSeed(id),
    ...(insideEnd === "from"
      ? {
          ...(target ? { fromId: target.id } : pinned ? { fromPoint: pinned } : {}),
          ...(toId ? { toId } : toPoint ? { toPoint } : {}),
        }
      : {
          ...(fromId ? { fromId } : fromPoint ? { fromPoint } : {}),
          ...(target ? { toId: target.id } : pinned ? { toPoint: pinned } : {}),
        }),
    arrowStyle: arrow.arrowStyle ?? "curved",
    createdAt: now,
    updatedAt: now,
    rev: 1,
  };
}

/**
 * Morphs the selected elements (or their existing morph group) in place to `targetNotation`,
 * preserving a full reversible `MorphGroupRecord` (including original `sketchSnapshot`)
 * on the anchor element. Arrows crossing the selection boundary stay on their own shapes.
 */
/** Cuts a spec to what storage accepts (morphSemanticSpecSyncSchema): a board that saves must load back. */
export function clampSpecForStorage(spec: MorphSemanticSpec): MorphSemanticSpec {
  const cut = (text: string, max: number) => text.slice(0, max);
  const maybe = (text: string | undefined, max: number) => text?.slice(0, max);
  return {
    ...spec,
    summary: cut(spec.summary, 160),
    actors: spec.actors.slice(0, 32).map((a) => ({ ...a, label: cut(a.label, 160) })),
    messages: spec.messages.slice(0, 48).map((m) => ({ ...m, label: cut(m.label, 140) })),
    steps: spec.steps.slice(0, 40).map((s) => ({
      ...s,
      label: cut(s.label, 160),
      ...(s.branches
        ? { branches: s.branches.slice(0, 8).map((b) => (b.label === undefined ? b : { ...b, label: cut(b.label, 80) })) }
        : {}),
    })),
    states: spec.states.slice(0, 32).map((s) => ({ ...s, label: cut(s.label, 140) })),
    transitions: spec.transitions.slice(0, 48).map((t) => ({
      ...t,
      event: cut(t.event, 100),
      ...(t.guard === undefined ? {} : { guard: maybe(t.guard, 100) }),
      ...(t.action === undefined ? {} : { action: maybe(t.action, 100) }),
    })),
    entities: spec.entities.slice(0, 24).map((e) => ({
      ...e,
      name: cut(e.name, 120),
      attributes: e.attributes.slice(0, 16).map((row) => cut(row, 120)),
    })),
    relations: spec.relations.slice(0, 48).map((r) => ({
      ...r,
      cardinality: cut(r.cardinality, 24),
      ...(r.label === undefined ? {} : { label: maybe(r.label, 80) }),
    })),
    ...(spec.fragments
      ? {
          fragments: spec.fragments.slice(0, 16).map((f) => ({
            ...f,
            guard: cut(f.guard, 100),
            ...(f.elseGuard === undefined ? {} : { elseGuard: maybe(f.elseGuard, 100) }),
          })),
        }
      : {}),
  };
}

export function morphSelectionToNotation(
  selectedIds: string[],
  allElements: JevElement[],
  targetNotation: MorphNotation,
  opts?: {
    specOverride?: MorphSemanticSpec;
    now?: number;
    isHeuristic?: boolean;
  }
): MorphOperationResult | null {
  if (selectedIds.length === 0 || allElements.length === 0) return null;
  const now = opts?.now ?? Date.now();

  const existing = detectSelectionMorphState(selectedIds, allElements);

  let groupRecord: MorphGroupRecord;
  let replacedIds: string[];
  let incomingExternal: JevElement[];
  let outgoingExternal: JevElement[];
  let boundarySource: BoundarySource;

  if (existing.groupId && existing.groupRecord) {
    // Sync any label edits made by the user in the current notation back into the shared spec & sketch snapshot
    groupRecord = syncEditedLabelsIntoGroupRecord(
      existing.groupElements,
      existing.groupRecord
    );
    if (opts?.specOverride) {
      groupRecord = {
        ...groupRecord,
        spec: opts.specOverride,
      };
    }

    const memberIdSet = new Set(existing.groupElements.map((e) => e.id));
    incomingExternal = [];
    outgoingExternal = [];
    for (const el of allElements) {
      if (el.kind !== "arrow" || memberIdSet.has(el.id)) continue;
      const fromIn = Boolean(el.fromId && memberIdSet.has(el.fromId));
      const toIn = Boolean(el.toId && memberIdSet.has(el.toId));
      if (!fromIn && toIn && el.fromId) {
        incomingExternal.push(el);
      } else if (fromIn && !toIn && el.toId) {
        outgoingExternal.push(el);
      }
    }

    boundarySource = {
      elementsById: new Map(existing.groupElements.map((e) => [e.id, e])),
      semanticIdOf: (el) => el.morphMeta?.semanticId,
    };

    replacedIds = Array.from(
      new Set([
        ...existing.groupElements.map((e) => e.id),
        ...incomingExternal.map((a) => a.id),
        ...outgoingExternal.map((a) => a.id),
      ])
    );
  } else {
    // First morph of an unmorphed sketch selection: snapshot original elements & extract shared semantic spec
    const extracted = extractSelectionWithSemanticIds(selectedIds, allElements);
    if (!extracted) return null;

    const baseSpec =
      opts?.specOverride ?? extractMorphSemanticSpec(selectedIds, allElements);
    if (!baseSpec) return null;

    const groupId = uid("mg");
    const snapshotSource: JevElement[] = [
      ...extracted.selectedFrames,
      ...extracted.orderedShapes,
      ...extracted.internalArrows,
    ].slice(0, MAX_MORPH_SNAPSHOT_ELEMENTS);

    const sketchSnapshot: SketchSnapshotElement[] = snapshotSource.map((el) => ({
      id: el.id,
      kind: el.kind,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      label: el.label,
      ...(el.sublabel !== undefined ? { sublabel: el.sublabel } : {}),
      tone: el.tone,
      seed: el.seed,
      ...(el.fromId ? { fromId: el.fromId } : {}),
      ...(el.toId ? { toId: el.toId } : {}),
      ...(el.fromPoint ? { fromPoint: { ...el.fromPoint } } : {}),
      ...(el.toPoint ? { toPoint: { ...el.toPoint } } : {}),
      ...(el.arrowStyle ? { arrowStyle: el.arrowStyle } : {}),
      ...(el.dashed ? { dashed: true } : {}),
      ...(el.bidirectional ? { bidirectional: true } : {}),
      ...(el.startEnd ? { startEnd: el.startEnd } : {}),
      ...(el.endEnd ? { endEnd: el.endEnd } : {}),
      ...(el.points ? { points: downsamplePoints(el.points) } : {}),
      ...(extracted.idToSemId.has(el.id)
        ? { semanticId: extracted.idToSemId.get(el.id) }
        : {}),
    }));

    groupRecord = {
      groupId,
      anchorBounds: { ...extracted.bounds },
      entrySketchId: extracted.entryNode.id,
      exitSketchId: extracted.exitNode.id,
      spec: baseSpec,
      sketchSnapshot,
    };

    boundarySource = {
      elementsById: new Map(extracted.orderedShapes.map((e) => [e.id, e])),
      semanticIdOf: (el) => extracted.idToSemId.get(el.id),
    };
    replacedIds = extracted.replacedIds;
    incomingExternal = extracted.incomingExternal;
    outgoingExternal = extracted.outgoingExternal;
  }

  groupRecord = { ...groupRecord, spec: clampSpecForStorage(groupRecord.spec) };

  let layoutOut: {
    elements: JevElement[];
    entryId: string;
    exitId: string;
    selectableIds: string[];
  };

  switch (targetNotation) {
    case "sequence":
      layoutOut = layoutSequenceNotation(
        groupRecord.spec,
        groupRecord.groupId,
        groupRecord.anchorBounds,
        now
      );
      break;
    case "flowchart":
      layoutOut = layoutFlowchartNotation(
        groupRecord.spec,
        groupRecord.groupId,
        groupRecord.anchorBounds,
        now
      );
      break;
    case "state":
      layoutOut = layoutStateNotation(
        groupRecord.spec,
        groupRecord.groupId,
        groupRecord.anchorBounds,
        now
      );
      break;
    case "er":
      layoutOut = layoutErNotation(
        groupRecord.spec,
        groupRecord.groupId,
        groupRecord.anchorBounds,
        now
      );
      break;
    case "sketch":
    default:
      layoutOut = restoreSketchFromGroupRecord(groupRecord, now);
      break;
  }

  // Attach the shared reversible MorphGroupRecord cleanly to the primary anchor shape element
  const anchorIdx = layoutOut.elements.findIndex(
    (e) =>
      isShapeElement(e) &&
      !isContainerKind(e.kind) &&
      e.kind !== "activation" &&
      e.kind !== "initial" &&
      e.kind !== "final"
  );
  const attachIdx = anchorIdx >= 0 ? anchorIdx : 0;
  const withRecord: JevElement[] = layoutOut.elements.map((laidOut, idx) => {
    const el = { ...laidOut, label: laidOut.label.slice(0, MAX_LABEL_LENGTH) };
    if (el.sublabel !== undefined) el.sublabel = el.sublabel.slice(0, MAX_SUBLABEL_LENGTH);
    const baseMeta: ElementMorphMeta = el.morphMeta ?? {
      groupId: groupRecord.groupId,
      notation: targetNotation,
    };
    if (idx === attachIdx) {
      return {
        ...el,
        morphMeta: {
          ...baseMeta,
          groupRecord,
        },
      };
    }
    return {
      ...el,
      morphMeta: baseMeta,
    };
  });

  const keptBoundary = [
    ...incomingExternal.map((arrow) => keepBoundaryArrow(arrow, "to", boundarySource, withRecord, now)),
    ...outgoingExternal.map((arrow) => keepBoundaryArrow(arrow, "from", boundarySource, withRecord, now)),
  ];

  return {
    groupId: groupRecord.groupId,
    notation: targetNotation,
    spec: groupRecord.spec,
    replacedIds,
    addedElements: [...withRecord, ...keptBoundary],
    nextSelectedIds: layoutOut.selectableIds,
    entryElementId: layoutOut.entryId,
    exitElementId: layoutOut.exitId,
    isHeuristic: opts?.isHeuristic ?? !opts?.specOverride,
  };
}

/**
 * Atomically produces the next board elements array swapping a morphed group in place.
 * Pass into `updateElements` so replaced IDs receive tombstones and new elements receive bumped revs.
 */
export function applyMorphToBoard(
  currentElements: JevElement[],
  morph: MorphOperationResult
): JevElement[] {
  const removeSet = new Set(morph.replacedIds);
  const kept = currentElements.filter((el) => !removeSet.has(el.id));
  const framesToAdd = morph.addedElements.filter((e) => e.kind === "frame");
  const othersToAdd = morph.addedElements.filter((e) => e.kind !== "frame");
  return [...framesToAdd, ...kept, ...othersToAdd];
}

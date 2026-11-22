/**
 * Every element kind, single-sourced: validators (sync-validation, svg-export,
 * semantic-graph) build their enums from these arrays so a new kind cannot be
 * rendered locally but rejected on the wire.
 */
export const BASE_SHAPE_KINDS = ["node", "diamond", "database", "ellipse", "frame", "text"] as const;
/**
 * HLD building blocks (Sensei feedback §2): queue, cache, LB/CDN, blob, external system, user/actor, zone/boundary,
 * and the note card (requirements, numbers, "breaks at 10×"; label = title, sublabel = one bullet per line).
 */
export const HLD_SHAPE_KINDS = ["queue", "cache", "lb", "blob", "external", "actor", "zone", "card"] as const;
/**
 * LLD notation shapes: ER entity, UML class, sequence activation bar + combined fragment, state pseudo-states,
 * and the API card (label = "POST /orders", sublabel lines prefixed req: / res: / err: / idem:).
 */
export const LLD_SHAPE_KINDS = ["entity", "class", "activation", "fragment", "initial", "final", "api"] as const;
export const SHAPE_KINDS = [...BASE_SHAPE_KINDS, ...HLD_SHAPE_KINDS, ...LLD_SHAPE_KINDS] as const;
export const ELEMENT_KINDS = [...SHAPE_KINDS, "arrow", "freedraw"] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/**
 * Arrow end markers. "arrow" = filled/closed sync head (default end), "open" = open
 * head (async / return), "triangle" = hollow UML inheritance, "diamond" = filled UML
 * composition, "odiamond" = hollow aggregation, er_* = crow's-foot cardinality ends.
 */
export const ARROW_ENDS = [
  "none",
  "arrow",
  "open",
  "triangle",
  "diamond",
  "odiamond",
  "er_one",
  "er_only_one",
  "er_zero_one",
  "er_many",
  "er_one_many",
  "er_zero_many",
] as const;
export type ArrowEnd = (typeof ARROW_ENDS)[number];

export type ColorTone =
  | "ink"
  | "terracotta"
  | "cobalt"
  | "teal"
  | "ochre"
  | "plum"
  | "slate";

export type RenderStyle = "sketch" | "clean";
export type BoardTheme = "vellum" | "midnight";

/** Every shape kind is placeable; the dock shows the base kinds, the More shapes flyout the rest. */
export type ToolType = "select" | "hand" | "arrow" | "freedraw" | ShapeKind;

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type MorphNotation = "sketch" | "sequence" | "flowchart" | "state" | "er";

export type MorphElementRole =
  | "actor"
  | "lifeline"
  | "message"
  | "step"
  | "decision"
  | "state"
  | "transition"
  | "entity"
  | "relation"
  | "activation"
  | "fragment"
  | "pseudo_state"
  | "sketch_item";

export interface MorphActorSpec {
  id: string;
  label: string;
  kind?: ShapeKind;
  tone?: ColorTone;
}

export interface MorphMessageSpec {
  id: string;
  from: string;
  to: string;
  label: string;
  order: number;
  async?: boolean;
  isReturn?: boolean;
}

export interface MorphStepBranchSpec {
  to: string;
  label?: string;
  fallback?: boolean;
}

export interface MorphStepSpec {
  id: string;
  label: string;
  kind: "start" | "process" | "decision" | "end";
  tone?: ColorTone;
  branches?: MorphStepBranchSpec[];
}

export interface MorphStateSpec {
  id: string;
  label: string;
  initial?: boolean;
  terminal?: boolean;
  tone?: ColorTone;
}

export interface MorphTransitionSpec {
  id: string;
  from: string;
  to: string;
  event: string;
  /** UML `event [guard] / action`: optional guard condition and effect. */
  guard?: string;
  action?: string;
  fallback?: boolean;
}

export interface MorphEntitySpec {
  id: string;
  name: string;
  attributes: string[];
  tone?: ColorTone;
}

export interface MorphRelationSpec {
  id: string;
  from: string;
  to: string;
  cardinality: string;
  label?: string;
}

/** UML combined fragment over a contiguous range of message orders (inclusive). */
export interface MorphFragmentSpec {
  id: string;
  operator: "alt" | "loop" | "opt";
  guard: string;
  fromOrder: number;
  toOrder: number;
  /** alt only: the else operand starts at this order, with its own guard. */
  elseFromOrder?: number;
  elseGuard?: string;
}

export interface MorphSemanticSpec {
  summary: string;
  actors: MorphActorSpec[];
  messages: MorphMessageSpec[];
  steps: MorphStepSpec[];
  states: MorphStateSpec[];
  transitions: MorphTransitionSpec[];
  entities: MorphEntitySpec[];
  relations: MorphRelationSpec[];
  fragments?: MorphFragmentSpec[];
}

export interface SketchSnapshotElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sublabel?: string;
  tone: ColorTone;
  seed: number;
  fromId?: string;
  toId?: string;
  fromPoint?: Point;
  toPoint?: Point;
  arrowStyle?: "curved" | "straight";
  dashed?: boolean;
  bidirectional?: boolean;
  startEnd?: ArrowEnd;
  endEnd?: ArrowEnd;
  points?: Point[];
  semanticId?: string;
}

export interface MorphGroupRecord {
  groupId: string;
  anchorBounds: ElementBox;
  entrySketchId?: string;
  exitSketchId?: string;
  spec: MorphSemanticSpec;
  sketchSnapshot: SketchSnapshotElement[];
}

export interface ElementMorphMeta {
  groupId: string;
  notation: MorphNotation;
  semanticId?: string;
  role?: MorphElementRole;
  /** Stored on the anchor element of a morphed group for reversible round-trip across Undo, localStorage & P2P sync. */
  groupRecord?: MorphGroupRecord;
}

export interface JevElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sublabel?: string;
  tone: ColorTone;
  seed: number;
  /** For arrows */
  fromId?: string;
  toId?: string;
  fromPoint?: Point;
  toPoint?: Point;
  arrowStyle?: "curved" | "straight";
  dashed?: boolean;
  bidirectional?: boolean;
  /** Arrow end markers. Unset = legacy behaviour: endEnd "arrow", startEnd "arrow" only when bidirectional. */
  startEnd?: ArrowEnd;
  endEnd?: ArrowEnd;
  /** For freedraw */
  points?: Point[];
  /** Reversible Notation Morph group metadata */
  morphMeta?: ElementMorphMeta;
  /** Metadata */
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  rev?: number;
}

export interface ElementTombstone {
  deletedAt: number;
  rev: number;
  deletedBy?: string;
}

export type TombstoneMap = Record<string, ElementTombstone>;

export type SpatialIntentKind =
  | "splice_into_edge"
  | "open_pipeline_gap"
  | "align_pipeline"
  | "align_column"
  | "branch_out"
  | "connect_nearby"
  | "encapsulate_group"
  | "domain_continue"
  | "decision_branch"
  | "prompt_follow_up";

export interface SpatialIntent {
  kind: SpatialIntentKind;
  headline: string;
  detail: string;
  subjectId?: string;
  delta?: { dx: number; dy: number; distance: number };
  relatedIds: string[];
  timestamp: number;
  /**
   * Set when the suggestions start with a connection: true while Enter takes it, false once it needs Tab. The
   * panel words the hint from this and from what is highlighted, so the text can never promise a dead key.
   */
  offersEnter?: boolean;
}

export interface ElementPatch {
  id: string;
  kind?: ElementKind;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fromId?: string;
  toId?: string;
  fromPoint?: Point;
  toPoint?: Point;
  label?: string;
  sublabel?: string;
  tone?: ColorTone;
  dashed?: boolean;
  startEnd?: ArrowEnd;
  endEnd?: ArrowEnd;
  morphMeta?: ElementMorphMeta;
}

export interface PredictedAction {
  id: string;
  title: string;
  subtitle: string;
  category: "extend" | "connect" | "structure" | "layout";
  /** Optional pattern keys for adaptive suggestion feedback ranking */
  feedbackKeys?: string[];
  /** Calibrated probability from TypeSafe Jev (or local prior fallback), 0..1 */
  probability?: number;
  /** New elements that will materialize on Enter (shown as translucent ghosts) */
  addElements: JevElement[];
  /** Existing elements that will be repositioned/rewired on Enter */
  patchElements?: ElementPatch[];
  /** Existing element IDs removed on Enter (e.g. old edge when splicing) */
  removeIds?: string[];
  /** Select these IDs after committing so chaining works seamlessly */
  focusId?: string;
  /** Size tier of a next-action option: one node, a small cluster, or the full architecture. */
  tier?: OptionTier;
  /** How many new shapes Enter adds (0 = only arrows to existing nodes). */
  nodeCount?: number;
  /** Who named and shaped this option: the local lexicon, a local template, the Gateway LLM, or the board itself. */
  source?: OptionSource;
  /** An offered connection only: false when it is a guess, not a usual arrow for the pair. Enter never takes a guess. */
  usual?: boolean;
}

export const OPTION_TIERS = ["minimal", "cluster", "full"] as const;
export type OptionTier = (typeof OPTION_TIERS)[number];
export type OptionSource = "lexicon" | "template" | "llm" | "board";

/** Where a jev decision came from: TypeSafe directly, or the AI Gateway with the model id ("gateway:typesafe-ai/jev"). */
export type JevModelSource = "typesafe-jev" | `gateway:${string}`;
export type DecideSource = JevModelSource | "llm-json" | "heuristic";

export function isJevModelSource(source: string | null | undefined): source is JevModelSource {
  return source === "typesafe-jev" || (typeof source === "string" && source.startsWith("gateway:"));
}

export interface JevTelemetry {
  source: DecideSource;
  model: string;
  isHeuristic?: boolean;
  latencyMs: number;
  inputTokens?: number;
  intentChoice?: string | null;
  intentConfidence?: number | null;
  shouldConnectProb?: number | null;
  evaluating?: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PeerCursor {
  peerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  selectedId?: string | null;
  transport: "webrtc" | "broadcast" | "simulated";
  lastSeen: number;
  rttMs?: number;
}

export interface BoardSnapshot {
  elements: JevElement[];
  boardTitle: string;
  titleRev?: number;
  titleUpdatedBy?: string;
  titleUpdatedAt?: number;
  tombstones?: TombstoneMap;
  tombstoneHorizonRev?: number;
  tombstoneHorizonAt?: number;
  boardEpoch?: string;
  boardEpochCreatedAt?: number;
  baseTimestamp?: number;
  hasLocalEdits?: boolean;
}

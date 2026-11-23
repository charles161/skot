import { inferToneFromLabel } from "./colors";
import { makeSeed } from "./geometry";
import { DEFAULT_KIND_SIZE, isContainerKind, isShapeKind } from "./notation-kinds";
import {
  HLD_SHAPE_KINDS,
  LLD_SHAPE_KINDS,
  type JevElement,
  type Point,
  type ShapeKind,
  type ToolType,
} from "./types";

export type MoreShapeKind = (typeof HLD_SHAPE_KINDS)[number] | (typeof LLD_SHAPE_KINDS)[number];

export interface ShapeGroup<K extends ShapeKind = ShapeKind> {
  title: string;
  kinds: readonly K[];
}

export const MORE_SHAPE_GROUPS: readonly ShapeGroup<MoreShapeKind>[] = [
  { title: "System design", kinds: HLD_SHAPE_KINDS },
  { title: "LLD notation", kinds: LLD_SHAPE_KINDS },
];

const MORE_SHAPE_SET = new Set<string>([...HLD_SHAPE_KINDS, ...LLD_SHAPE_KINDS]);

export function isShapeTool(tool: ToolType): tool is ShapeKind {
  return isShapeKind(tool);
}

export function isMoreShapeKind(kind: string): kind is MoreShapeKind {
  return MORE_SHAPE_SET.has(kind);
}

interface ShapeSeed {
  width: number;
  height: number;
  label: string;
  sublabel?: string;
}

/** Dock tools keep their original placement sizes; flyout kinds use the contract defaults. */
const SHAPE_SEEDS: Record<ShapeKind, ShapeSeed> = {
  node: { width: 172, height: 72, label: "Service" },
  diamond: { width: 148, height: 96, label: "Condition?" },
  database: { width: 156, height: 86, label: "Database" },
  ellipse: { width: 152, height: 74, label: "User" },
  frame: { width: 340, height: 220, label: "System Zone" },
  text: { width: 180, height: 42, label: "Note" },
  markdown: { width: 320, height: 220, label: "Markdown Note" },
  queue: { ...DEFAULT_KIND_SIZE.queue, label: "Queue" },
  cache: { ...DEFAULT_KIND_SIZE.cache, label: "Cache" },
  lb: { ...DEFAULT_KIND_SIZE.lb, label: "Load balancer" },
  blob: { ...DEFAULT_KIND_SIZE.blob, label: "Blob store" },
  external: { ...DEFAULT_KIND_SIZE.external, label: "External API" },
  actor: { ...DEFAULT_KIND_SIZE.actor, label: "User" },
  zone: { ...DEFAULT_KIND_SIZE.zone, label: "VPC" },
  entity: { ...DEFAULT_KIND_SIZE.entity, label: "users", sublabel: "id uuid PK\nemail text UK\ncreated_at timestamptz" },
  class: { ...DEFAULT_KIND_SIZE.class, label: "Order", sublabel: "- id: UUID\n- status: Status\n--\n+ pay(): Receipt" },
  activation: { ...DEFAULT_KIND_SIZE.activation, label: "" },
  fragment: { ...DEFAULT_KIND_SIZE.fragment, label: "alt", sublabel: "[cache hit]\n[miss]" },
  initial: { ...DEFAULT_KIND_SIZE.initial, label: "" },
  final: { ...DEFAULT_KIND_SIZE.final, label: "" },
  card: { ...DEFAULT_KIND_SIZE.card, label: "Requirements", sublabel: "Functional: …\nNon-functional: p99 < 100 ms\nOut of scope: …" },
  api: {
    ...DEFAULT_KIND_SIZE.api,
    label: "POST /orders",
    sublabel: "req: {item_id, qty}\nres: 201 {order_id}\nerr: 409 duplicate\nidem: Idempotency-Key",
  },
};

const MIN_DRAG = { width: 30, height: 24 };

function placeBox(kind: ShapeKind, start: Point, end: Point, seed: ShapeSeed) {
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const centred = (width: number, height: number) => ({
    x: Math.round(start.x - width / 2),
    y: Math.round(start.y - height / 2),
    width,
    height,
  });

  if (kind === "initial" || kind === "final") return centred(seed.width, seed.height);
  if (kind === "activation") {
    if (h <= MIN_DRAG.height) return centred(seed.width, seed.height);
    return {
      x: Math.round((start.x + end.x) / 2 - seed.width / 2),
      y: Math.round(top),
      width: seed.width,
      height: Math.round(h),
    };
  }
  if (w > MIN_DRAG.width && h > MIN_DRAG.height) {
    return { x: Math.round(left), y: Math.round(top), width: Math.round(w), height: Math.round(h) };
  }
  return centred(seed.width, seed.height);
}

export interface PlacedShape {
  element: JevElement;
  /** Open the inline label editor right after placing. */
  editLabel: boolean;
  /** Insert at the back of the z-order (containers). */
  behind: boolean;
}

/**
 * A shape placed by a tool: a click (start == end) drops the default box centred on
 * the pointer, a drag sizes it.
 */
export function shapeFromTool(kind: ShapeKind, start: Point, end: Point, id: string, now: number): PlacedShape {
  const seed = SHAPE_SEEDS[kind];
  const container = isContainerKind(kind);
  const element: JevElement = {
    id,
    kind,
    ...placeBox(kind, start, end, seed),
    label: seed.label,
    ...(seed.sublabel ? { sublabel: seed.sublabel } : {}),
    tone: kind === "frame" || kind === "zone" ? "slate" : inferToneFromLabel(seed.label),
    seed: makeSeed(id),
    createdAt: now,
    updatedAt: now,
  };
  return { element, editLabel: seed.label !== "", behind: container };
}

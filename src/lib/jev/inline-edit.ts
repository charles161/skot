import { makeSeed } from "./geometry";
import { fitMarkdownNodeSize } from "./markdown";
import type { ElementKind, JevElement, Point } from "./types";

export type EditField = "label" | "sublabel";

export interface LabelEditSession {
  id: string;
  field: EditField;
  draft: string;
  /** True when the element was created by the double-click itself (empty canvas -> text). */
  createdForEdit: boolean;
}

const SUBLABEL_ZONE_START = 0.6;
export const TEXT_DEFAULT_SIZE = { width: 180, height: 42 } as const;

/** ER entity rows, UML class compartments, fragment guards, API card rows, note bullets, markdown body. */
const MULTILINE_SUBLABEL_KINDS = new Set<ElementKind>(["entity", "class", "fragment", "api", "card", "markdown"]);
const HEADER_BAND = { max: 32, ratio: 0.35 };

export function isMultilineField(kind: ElementKind, field: EditField): boolean {
  return field === "sublabel" && MULTILINE_SUBLABEL_KINDS.has(kind);
}

/** Height of the name band at the top of a multi-row shape; everything below it is rows. */
export function headerBandHeight(el: Pick<JevElement, "height">): number {
  return Math.min(HEADER_BAND.max, el.height * HEADER_BAND.ratio);
}

/** Which field a double-click at a world point edits: the sublabel sits in the lower part of a shape. */
export function pickEditField(el: JevElement, world: Point): EditField {
  if (MULTILINE_SUBLABEL_KINDS.has(el.kind)) {
    return world.y - el.y > headerBandHeight(el) ? "sublabel" : "label";
  }
  if (el.kind === "arrow" || !el.sublabel) return "label";
  return world.y - el.y > el.height * SUBLABEL_ZONE_START ? "sublabel" : "label";
}

function normalizeSublabel(draft: string): string {
  return draft
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function beginLabelEdit(el: JevElement, field: EditField): LabelEditSession | null {
  if (el.kind === "freedraw") return null;
  const draft = field === "sublabel" ? el.sublabel ?? "" : el.label;
  return { id: el.id, field, draft, createdForEdit: false };
}

export function editKeyAction(e: { key: string; shiftKey: boolean }): "commit" | "cancel" | "type" {
  if (e.key === "Escape") return "cancel";
  if (e.key === "Enter" && !e.shiftKey) return "commit";
  return "type";
}

export function createTextAt(
  world: Point,
  now: number,
  id: string
): { element: JevElement; session: LabelEditSession } {
  const { width, height } = TEXT_DEFAULT_SIZE;
  const element: JevElement = {
    id,
    kind: "text",
    x: Math.round(world.x - width / 2),
    y: Math.round(world.y - height / 2),
    width,
    height,
    label: "",
    tone: "ink",
    seed: makeSeed(id),
    createdAt: now,
    updatedAt: now,
  };
  return { element, session: { id, field: "label", draft: "", createdForEdit: true } };
}

/** Applies the draft. Returns the same array when nothing changes so callers skip undo + broadcast. */
/** Rough advance of the 14px label font and its wrapped line height, with the label box's padding. */
const NOTE_CHAR_W = 8;
const NOTE_LINE_H = 18;
const NOTE_PAD_X = 20;
const NOTE_PAD_Y = 12;
const NOTE_MAX_W = 480;

/** A text note's size for its label: never smaller than the default, wide up to a cap, then wrapped. */
export function fitTextNoteSize(label: string): { width: number; height: number } {
  const lines = label.split("\n");
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const width = Math.max(TEXT_DEFAULT_SIZE.width, Math.min(NOTE_MAX_W, longest * NOTE_CHAR_W + NOTE_PAD_X + 8));
  const inner = width - NOTE_PAD_X;
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * NOTE_CHAR_W) / inner)), 0);
  const height = Math.max(TEXT_DEFAULT_SIZE.height, rows * NOTE_LINE_H + NOTE_PAD_Y + 6);
  return { width: Math.round(width), height: Math.round(height) };
}

export function commitLabelEdit(
  elements: JevElement[],
  session: LabelEditSession,
  now: number
): JevElement[] {
  const target = elements.find((e) => e.id === session.id);
  if (!target) return elements;
  const next = isMultilineField(target.kind, session.field) ? normalizeSublabel(session.draft) : session.draft.trim();

  if (session.createdForEdit && !next) {
    return elements.filter((e) => e.id !== session.id);
  }

  let updated: JevElement;
  if (session.field === "sublabel") {
    if ((target.sublabel ?? "") === next) return elements;
    const { sublabel: _drop, ...rest } = target;
    void _drop;
    if (target.kind === "markdown") {
      const fitted = next ? fitMarkdownNodeSize(next, { width: target.width, height: target.height }) : {};
      updated = next ? { ...target, sublabel: next, ...fitted, updatedAt: now } : { ...rest, updatedAt: now };
    } else {
      updated = next ? { ...target, sublabel: next, updatedAt: now } : { ...rest, updatedAt: now };
    }
  } else {
    const label = next || (target.kind === "arrow" ? "" : target.label || "Node");
    if (label === target.label) return elements;
    updated =
      target.kind === "text"
        ? { ...target, label, ...fitTextNoteSize(label), updatedAt: now }
        : { ...target, label, updatedAt: now };
  }
  return elements.map((e) => (e.id === session.id ? updated : e));
}

export function cancelLabelEdit(elements: JevElement[], session: LabelEditSession): JevElement[] {
  return session.createdForEdit ? elements.filter((e) => e.id !== session.id) : elements;
}

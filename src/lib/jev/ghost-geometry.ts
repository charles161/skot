/**
 * Geometry of arrows exactly as the canvas draws them (resolveArrowEndpoints: boundary to boundary, a gentle
 * quadratic bend, the label at the curve's midpoint), so layout and tests judge what the user sees.
 */
import { resolveArrowEndpoints, type Rect } from "./geometry";
import type { JevElement, Point } from "./types";

const SAMPLES = 24;
export const LABEL_CHAR_W = 6.4;
export const LABEL_PAD_X = 14;
export const LABEL_H = 18;

export function curvePoints(arrow: JevElement, byId: Map<string, JevElement>): Point[] {
  const { start, end, control } = resolveArrowEndpoints(arrow, byId);
  const pts: Point[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    pts.push({ x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y });
  }
  return pts;
}

export function labelWidth(text: string): number {
  return text ? text.length * LABEL_CHAR_W + LABEL_PAD_X : 0;
}

/** The label's box, centred where the canvas centres it (t = 0.5 on the curve). */
export function labelRect(arrow: JevElement, byId: Map<string, JevElement>): Rect | null {
  if (!arrow.label?.trim()) return null;
  const { start, end, control } = resolveArrowEndpoints(arrow, byId);
  const x = 0.25 * start.x + 0.5 * control.x + 0.25 * end.x;
  const y = 0.25 * start.y + 0.5 * control.y + 0.25 * end.y;
  const w = labelWidth(arrow.label.trim());
  return { x: x - w / 2, y: y - LABEL_H / 2, width: w, height: LABEL_H };
}

/** Everything an arrow covers as drawn: its curve and its label. */
export function arrowBounds(arrow: JevElement, byId: Map<string, JevElement>): Rect {
  const pts = curvePoints(arrow, byId);
  let minX = Math.min(...pts.map((p) => p.x));
  let maxX = Math.max(...pts.map((p) => p.x));
  let minY = Math.min(...pts.map((p) => p.y));
  let maxY = Math.max(...pts.map((p) => p.y));
  const label = labelRect(arrow, byId);
  if (label) {
    minX = Math.min(minX, label.x);
    maxX = Math.max(maxX, label.x + label.width);
    minY = Math.min(minY, label.y);
    maxY = Math.max(maxY, label.y + label.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect, pad = 0): boolean {
  return !(a.x + a.width + pad <= b.x || b.x + b.width + pad <= a.x || a.y + a.height + pad <= b.y || b.y + b.height + pad <= a.y);
}

function inside(p: Point, r: Rect, pad: number): boolean {
  return p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
}

/** True when the drawn arrow passes through a shape other than the two it connects. */
export function arrowHitsShape(arrow: JevElement, byId: Map<string, JevElement>, shapes: JevElement[], pad = 4): JevElement | null {
  const pts = curvePoints(arrow, byId).slice(1, -1);
  for (const s of shapes) {
    if (s.id === arrow.fromId || s.id === arrow.toId) continue;
    if (pts.some((p) => inside(p, s, pad))) return s;
  }
  return null;
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Pairs of arrows whose drawn curves cross (arrows sharing an end never count). */
export function countCrossings(arrows: JevElement[], byId: Map<string, JevElement>): number {
  const curves = arrows.map((a) => ({ a, pts: curvePoints(a, byId) }));
  let n = 0;
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const A = curves[i];
      const B = curves[j];
      const shared = [A.a.fromId, A.a.toId].some((id) => id === B.a.fromId || id === B.a.toId);
      if (shared) continue;
      let crossed = false;
      for (let p = 0; p < A.pts.length - 1 && !crossed; p++) {
        for (let q = 0; q < B.pts.length - 1 && !crossed; q++) {
          if (segmentsCross(A.pts[p], A.pts[p + 1], B.pts[q], B.pts[q + 1])) crossed = true;
        }
      }
      if (crossed) n += 1;
    }
  }
  return n;
}

export interface GhostClarity {
  edgeThroughShape: Array<[string, string]>;
  labelOverlaps: Array<[string, string]>;
  labelOnShape: Array<[string, string]>;
  crossings: number;
}

/** Everything that makes a preview hard to read, for the board plus one option's ghost elements. */
export function ghostClarity(board: JevElement[], ghost: JevElement[]): GhostClarity {
  const all = [...board, ...ghost];
  const byId = new Map(all.map((e) => [e.id, e]));
  const shapes = all.filter((e) => e.kind !== "arrow" && e.kind !== "freedraw" && e.kind !== "frame" && e.kind !== "zone");
  const ghostArrows = ghost.filter((e) => e.kind === "arrow");
  const allArrows = all.filter((e) => e.kind === "arrow" && e.fromId && e.toId);
  const name = (id?: string) => byId.get(id ?? "")?.label ?? id ?? "?";
  const edgeThroughShape: Array<[string, string]> = [];
  for (const a of ghostArrows) {
    const hit = arrowHitsShape(a, byId, shapes);
    if (hit) edgeThroughShape.push([`${name(a.fromId)} -> ${name(a.toId)}`, hit.label]);
  }
  const labels = allArrows.map((a) => ({ a, r: labelRect(a, byId) })).filter((x): x is { a: JevElement; r: Rect } => Boolean(x.r));
  const labelOverlaps: Array<[string, string]> = [];
  const labelOnShape: Array<[string, string]> = [];
  const ghostIds = new Set(ghost.map((e) => e.id));
  for (let i = 0; i < labels.length; i++) {
    const li = labels[i];
    if (ghostIds.has(li.a.id)) {
      for (const s of shapes) if (rectsIntersect(li.r, s)) labelOnShape.push([li.a.label, s.label]);
    }
    for (let j = i + 1; j < labels.length; j++) {
      if (!ghostIds.has(li.a.id) && !ghostIds.has(labels[j].a.id)) continue;
      if (rectsIntersect(li.r, labels[j].r)) labelOverlaps.push([li.a.label, labels[j].a.label]);
    }
  }
  return { edgeThroughShape, labelOverlaps, labelOnShape, crossings: countCrossings(allArrows, byId) };
}

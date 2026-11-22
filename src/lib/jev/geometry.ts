import { isContainerKind, isShapeKind } from "./notation-kinds";
import { lbInset } from "./shape-layout";
import { JevElement, Point, Viewport } from "./types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface ViewportFitOptions {
  screenWidth: number;
  screenHeight: number;
  margins?: ViewportMargins;
  minZoom?: number;
  maxZoom?: number;
}

export function isShapeElement(el: JevElement): boolean {
  return isShapeKind(el.kind);
}

export function getElementCenter(el: JevElement): Point {
  return {
    x: el.x + el.width / 2,
    y: el.y + el.height / 2,
  };
}

export function getElementRect(el: JevElement): Rect {
  return {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  };
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distanceBetween(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return distanceBetween(p, proj);
}

export function rectsOverlap(a: Rect, b: Rect, padding = 0): boolean {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

export function rectContainsCenter(outer: Rect, inner: Rect): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return (
    cx >= outer.x &&
    cx <= outer.x + outer.width &&
    cy >= outer.y &&
    cy <= outer.y + outer.height
  );
}

export interface ArrowGeometry {
  start: Point;
  end: Point;
  /** Control point of the quadratic curve the arrow is drawn as. */
  control: Point;
}

/** How close an arrow may pass a node it does not connect before it is routed around it. */
export const ARROW_CLEARANCE = 10;
/** The closest an arrow squeezing through a narrow gap may pass a node. */
const ARROW_CLEARANCE_TIGHT = 6;
/** How far the curve's control point may be pushed off the straight line, smallest first. */
const ROUTE_OFFSETS = [70, 100, 130, 160, 190, 220, 250, 280, 320, 370, 430, 520];
/** Where along the arrow the bend sits (0 = one end, 1 = the other). */
const ROUTE_ALONG = [0.5, 0.3, 0.7];

const isSketch = (el: JevElement) => !el.morphMeta || el.morphMeta.notation === "sketch";

function quadraticAt(g: ArrowGeometry, t: number): Point {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return { x: a * g.start.x + b * g.control.x + c * g.end.x, y: a * g.start.y + b * g.control.y + c * g.end.y };
}

/** True when the curve passes within `clearance` of one of the rectangles. */
function curveHits(g: ArrowGeometry, all: Rect[], clearance = ARROW_CLEARANCE): boolean {
  // The curve stays inside the triangle of its three points: only rectangles reaching into that box can be hit.
  const minX = Math.min(g.start.x, g.control.x, g.end.x) - clearance;
  const maxX = Math.max(g.start.x, g.control.x, g.end.x) + clearance;
  const minY = Math.min(g.start.y, g.control.y, g.end.y) - clearance;
  const maxY = Math.max(g.start.y, g.control.y, g.end.y) + clearance;
  const rects = all.filter((r) => r.x < maxX && r.x + r.width > minX && r.y < maxY && r.y + r.height > minY);
  if (rects.length === 0) return false;
  const samples = Math.min(96, Math.max(24, Math.ceil(Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) / 16)));
  for (let i = 1; i < samples; i += 1) {
    const p = quadraticAt(g, i / samples);
    for (const r of rects) {
      if (p.x > r.x - clearance && p.x < r.x + r.width + clearance && p.y > r.y - clearance && p.y < r.y + r.height + clearance) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Bends an arrow around the nodes between its two ends (Charles, 22 Nov 2026: "route arrows around nodes, never
 * move nodes to do it"). The arrow stays one curve: its control point is pushed off the straight line, away from
 * what is in the way, by the smallest step that clears everything; both directions of a pair take the same way
 * round. With no clear way round the arrow is left as it was.
 */
function routeAroundNodes(
  base: ArrowGeometry,
  fromEl: JevElement,
  toEl: JevElement,
  elementsById: Map<string, JevElement>
): ArrowGeometry {
  const fc = getElementCenter(fromEl);
  const tc = getElementCenter(toEl);
  // The same chord for a -> b and b -> a, so both bend the same way.
  const swap = fc.x > tc.x || (fc.x === tc.x && fc.y > tc.y);
  const p = swap ? tc : fc;
  const q = swap ? fc : tc;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 60) return base;
  // A bend may be about as deep as the arrow is long, and always deep enough to get past one node's width
  // (a stack of nodes: the arrow leaves by the side and comes back in by the side).
  const offsets = ROUTE_OFFSETS.filter((m) => m <= Math.max(280, dist * 0.9));
  const nodesWithin = (reach: number): Rect[] => {
    const minX = Math.min(p.x, q.x) - reach;
    const maxX = Math.max(p.x, q.x) + reach;
    const minY = Math.min(p.y, q.y) - reach;
    const maxY = Math.max(p.y, q.y) + reach;
    const found: Rect[] = [];
    for (const el of elementsById.values()) {
      if (el.x > maxX || el.x + el.width < minX || el.y > maxY || el.y + el.height < minY) continue;
      if (el.id === fromEl.id || el.id === toEl.id) continue;
      if (!isShapeKind(el.kind) || isContainerKind(el.kind) || !isSketch(el)) continue;
      found.push({ x: el.x, y: el.y, width: el.width, height: el.height });
    }
    return found;
  };
  // Most arrows have nothing in their way: that is settled with the few nodes beside the straight line.
  if (!curveHits(base, nodesWithin(40 + ARROW_CLEARANCE))) return base;
  const near = nodesWithin(offsets[offsets.length - 1] + ARROW_CLEARANCE);
  // The search below depends only on the two nodes and the nodes around them: a board where nothing near this
  // arrow changed (another node is being dragged, say) reuses the answer.
  const key = [fromEl, toEl]
    .map((el) => `${el.kind},${el.x},${el.y},${el.width},${el.height}`)
    .concat(near.map((r) => `${r.x},${r.y},${r.width},${r.height}`))
    .join("|");
  const known = routeCache.get(key);
  if (known) return known;
  const routed = searchRoute(base, fromEl, toEl, near, { p, dx, dy, dist, swap, offsets });
  if (routeCache.size >= ROUTE_CACHE_SIZE) routeCache.clear();
  routeCache.set(key, routed);
  return routed;
}

const ROUTE_CACHE_SIZE = 4000;
const routeCache = new Map<string, ArrowGeometry>();

function searchRoute(
  base: ArrowGeometry,
  fromEl: JevElement,
  toEl: JevElement,
  near: Rect[],
  chord: { p: Point; dx: number; dy: number; dist: number; swap: boolean; offsets: number[] }
): ArrowGeometry {
  const { p, dx, dy, dist, swap, offsets } = chord;

  // Which side the nodes in the way lie on: positive is the side the normal points to.
  const nx = -dy / dist;
  const ny = dx / dist;
  let side = 0;
  for (const r of near) {
    if (!curveHits(base, [r])) continue;
    side += (r.x + r.width / 2 - p.x) * nx + (r.y + r.height / 2 - p.y) * ny;
  }
  const away = side > 2 ? -1 : side < -2 ? 1 : -1;
  // The bend sits over the middle of the arrow first; over one end when a node near the other blocks that.
  for (const m of offsets) {
    for (const along of ROUTE_ALONG) {
      for (const sign of [away, -away]) {
        const control = { x: p.x + dx * along + nx * sign * m, y: p.y + dy * along + ny * sign * m };
        const candidate = { start: getBoundaryPoint(fromEl, control), end: getBoundaryPoint(toEl, control), control };
        if (!curveHits(candidate, near)) return candidate;
      }
    }
  }
  return routeByElbow(fromEl, toEl, swap, near) ?? base;
}

/** The eight places an elbow may leave or reach a node: the middle of each side and each corner, just outside it. */
function anchorsOf(el: JevElement): Point[] {
  const gap = 4;
  const xs = [el.x - gap, el.x + el.width / 2, el.x + el.width + gap];
  const ys = [el.y - gap, el.y + el.height / 2, el.y + el.height + gap];
  const out: Point[] = [];
  for (const x of xs) for (const y of ys) if (x !== xs[1] || y !== ys[1]) out.push({ x, y });
  return out;
}

/**
 * When no single arc gets round (both columns between two nodes are full, say), the arrow takes a rounded
 * elbow instead: out of one node, along the gap beside the nodes in the way, and into the other from its side.
 * The shortest elbow that clears every node, the two it joins included, wins.
 */
function routeByElbow(fromEl: JevElement, toEl: JevElement, swap: boolean, near: Rect[]): ArrowGeometry | null {
  // Built for the same pair of nodes in the same order whichever way the arrow points, then turned round.
  const a = swap ? toEl : fromEl;
  const b = swap ? fromEl : toEl;
  const own: Rect[] = [a, b].map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));
  const candidates: Array<{ geom: ArrowGeometry; length: number }> = [];
  for (const start of anchorsOf(a)) {
    for (const end of anchorsOf(b)) {
      for (const control of [{ x: start.x, y: end.y }, { x: end.x, y: start.y }]) {
        const length = Math.hypot(control.x - start.x, control.y - start.y) + Math.hypot(end.x - control.x, end.y - control.y);
        candidates.push({ geom: { start, end, control }, length });
      }
    }
  }
  candidates.sort((u, v) => u.length - v.length);
  // A gap between two columns can be narrower than twice the usual clearance: then a closer pass is allowed.
  for (const clearance of [ARROW_CLEARANCE, ARROW_CLEARANCE_TIGHT]) {
    for (const { geom } of candidates) {
      if (curveHits(geom, own, 2) || curveHits(geom, near, clearance)) continue;
      return swap ? { start: geom.end, end: geom.start, control: geom.control } : geom;
    }
  }
  return null;
}

/**
 * Where an arrow is drawn: from the boundary of one shape to the boundary of the other, as one gentle curve,
 * bent around any node that lies between them.
 */
export function resolveArrowEndpoints(
  arrow: JevElement,
  elementsById: Map<string, JevElement>
): ArrowGeometry {
  const fromEl = arrow.fromId ? elementsById.get(arrow.fromId) : undefined;
  const toEl = arrow.toId ? elementsById.get(arrow.toId) : undefined;

  let start: Point = arrow.fromPoint ?? { x: arrow.x, y: arrow.y };
  let end: Point = arrow.toPoint ?? {
    x: arrow.x + arrow.width,
    y: arrow.y + arrow.height,
  };

  if (fromEl && toEl) {
    const fc = getElementCenter(fromEl);
    const tc = getElementCenter(toEl);
    start = getBoundaryPoint(fromEl, tc);
    end = getBoundaryPoint(toEl, fc);
  } else if (fromEl) {
    start = getBoundaryPoint(fromEl, end);
  } else if (toEl) {
    end = getBoundaryPoint(toEl, start);
  }

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);

  // Subtle architectural curve when arrow is diagonal
  let offset = 0;
  if (arrow.arrowStyle !== "straight" && dist > 40) {
    const isNearlyAxisAligned =
      Math.abs(dx) < 18 || Math.abs(dy) < 18;
    offset = isNearlyAxisAligned ? 0 : Math.min(28, dist * 0.1);
  }

  const nx = dist > 0 ? -dy / dist : 0;
  const ny = dist > 0 ? dx / dist : 0;

  const base: ArrowGeometry = {
    start,
    end,
    control: {
      x: midX + nx * offset,
      y: midY + ny * offset,
    },
  };
  const routable =
    fromEl && toEl && fromEl.id !== toEl.id && arrow.arrowStyle !== "straight" && isSketch(arrow) && isSketch(fromEl) && isSketch(toEl);
  return routable ? routeAroundNodes(base, fromEl, toEl, elementsById) : base;
}

/** Distance from a point to an arrow as drawn (its curve, not the straight line between its ends). */
export function pointToArrowDistance(pt: Point, geom: ArrowGeometry): number {
  const SEGMENTS = 16;
  let best = Infinity;
  let prev = geom.start;
  for (let i = 1; i <= SEGMENTS; i += 1) {
    const next = quadraticAt(geom, i / SEGMENTS);
    best = Math.min(best, pointToSegmentDistance(pt, prev, next));
    prev = next;
  }
  return best;
}

export function getBoundaryPoint(el: JevElement, toward: Point): Point {
  const c = getElementCenter(el);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;

  const hw = el.width / 2 + 4;
  const hh = el.height / 2 + 4;

  if (el.kind === "ellipse") {
    const angle = Math.atan2(dy, dx);
    return {
      x: c.x + Math.cos(angle) * hw,
      y: c.y + Math.sin(angle) * hh,
    };
  }

  if (el.kind === "initial" || el.kind === "final") {
    const r = Math.min(el.width, el.height) / 2 + 3;
    const len = Math.hypot(dx, dy);
    return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
  }

  if (el.kind === "lb") {
    const i = lbInset(el.width);
    const w = el.width;
    const h = el.height;
    const hex: Point[] = [
      { x: i, y: 0 },
      { x: w - i, y: 0 },
      { x: w, y: h / 2 },
      { x: w - i, y: h },
      { x: i, y: h },
      { x: 0, y: h / 2 },
    ].map((p) => ({ x: el.x + p.x, y: el.y + p.y }));
    const t = rayPolygonDistance(c, dx, dy, hex);
    const len = Math.hypot(dx, dy);
    const reach = t * len + 4;
    return { x: c.x + (dx / len) * reach, y: c.y + (dy / len) * reach };
  }

  if (el.kind === "diamond") {
    const scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return {
      x: c.x + dx * scale,
      y: c.y + dy * scale,
    };
  }

  // Rectangle / database / node / frame
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx / hw > absDy / hh) {
    const sign = dx >= 0 ? 1 : -1;
    return {
      x: c.x + sign * hw,
      y: c.y + (dy * hw) / Math.max(absDx, 0.001),
    };
  } else {
    const sign = dy >= 0 ? 1 : -1;
    return {
      x: c.x + (dx * hh) / Math.max(absDy, 0.001),
      y: c.y + sign * hh,
    };
  }
}

/** Smallest t > 0 with origin + t·(dx, dy) on the polygon outline (origin inside a convex polygon). */
function rayPolygonDistance(origin: Point, dx: number, dy: number, poly: Point[]): number {
  let best = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const t = (ax * ey - ay * ex) / denom;
    const u = (ax * dy - ay * dx) / denom;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

export function getEdgeHandles(el: JevElement): Array<{ side: "top" | "right" | "bottom" | "left"; point: Point }> {
  return [
    { side: "top", point: { x: el.x + el.width / 2, y: el.y } },
    { side: "right", point: { x: el.x + el.width, y: el.y + el.height / 2 } },
    { side: "bottom", point: { x: el.x + el.width / 2, y: el.y + el.height } },
    { side: "left", point: { x: el.x, y: el.y + el.height / 2 } },
  ];
}

export const EDGE_HANDLE_RADIUS = 5;
export const EDGE_HANDLE_STROKE = 2;
export const EDGE_HANDLE_HOVER_SCALE = 1.25;
export const EDGE_HANDLE_HIT_RADIUS = 10;

export function pointOnEdgeHandle(
  el: JevElement,
  pt: Point
): "top" | "right" | "bottom" | "left" | null {
  for (const h of getEdgeHandles(el)) {
    if (Math.hypot(pt.x - h.point.x, pt.y - h.point.y) <= EDGE_HANDLE_HIT_RADIUS) return h.side;
  }
  return null;
}

/** The smallest rectangle around all the given ones; null when there are none. */
export function unionRects(rects: Array<Rect | null>): Rect | null {
  const real = rects.filter((r): r is Rect => r !== null);
  if (real.length === 0) return null;
  const x = Math.min(...real.map((r) => r.x));
  const y = Math.min(...real.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...real.map((r) => r.x + r.width)) - x,
    height: Math.max(...real.map((r) => r.y + r.height)) - y,
  };
}

export function computeBounds(elements: JevElement[]): Rect | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (el.kind === "arrow") {
      if (el.fromPoint) {
        minX = Math.min(minX, el.fromPoint.x);
        minY = Math.min(minY, el.fromPoint.y);
        maxX = Math.max(maxX, el.fromPoint.x);
        maxY = Math.max(maxY, el.fromPoint.y);
      }
      if (el.toPoint) {
        minX = Math.min(minX, el.toPoint.x);
        minY = Math.min(minY, el.toPoint.y);
        maxX = Math.max(maxX, el.toPoint.x);
        maxY = Math.max(maxY, el.toPoint.y);
      }
      continue;
    }
    if (el.kind === "freedraw" && el.points && el.points.length > 0) {
      for (const p of el.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      continue;
    }
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }

  if (!Number.isFinite(minX)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function makeSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 2147483640) + 1;
}

export function uid(prefix = "el"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Finds a free non-overlapping spot near a preferred point. */
export function findFreeSpot(
  preferred: Rect,
  elements: JevElement[],
  stepX = 40,
  stepY = 96
): Rect {
  const shapes = elements.filter((e) => isShapeElement(e) && !isContainerKind(e.kind));
  let candidate = { ...preferred };
  for (let attempt = 0; attempt < 12; attempt++) {
    const collides = shapes.some((s) => rectsOverlap(candidate, getElementRect(s), 16));
    if (!collides) return candidate;
    if (attempt % 2 === 0) {
      candidate = { ...candidate, y: candidate.y + stepY };
    } else {
      candidate = { ...candidate, x: candidate.x + stepX, y: preferred.y - Math.ceil(attempt / 2) * stepY };
    }
  }
  return candidate;
}

function resolveHudMargins(
  screenWidth: number,
  screenHeight: number,
  margins?: ViewportMargins
): { top: number; right: number; bottom: number; left: number } {
  const responsiveSide = screenWidth < 640 ? Math.min(20, Math.round(screenWidth * 0.05)) : 72;
  const rawLeft = margins?.left ?? responsiveSide;
  const rawRight = margins?.right ?? responsiveSide;
  const rawTop = margins?.top ?? (screenWidth < 640 ? 118 : 104);
  const rawBottom = margins?.bottom ?? (screenHeight < 720 ? 190 : 230);

  // Clamp margins so available area always stays positive on compact viewports
  const maxHorizontal = Math.max(0, Math.floor((screenWidth - 140) / 2));
  const maxVerticalSum = Math.max(0, screenHeight - 160);
  const left = Math.min(rawLeft, maxHorizontal);
  const right = Math.min(rawRight, maxHorizontal);

  let top = rawTop;
  let bottom = rawBottom;
  if (top + bottom > maxVerticalSum && top + bottom > 0) {
    const scale = maxVerticalSum / (top + bottom);
    top = Math.floor(top * scale);
    bottom = Math.floor(bottom * scale);
  }
  return { top, right, bottom, left };
}

/**
 * Fits a world-space bounding rect cleanly inside the HUD-safe viewport frame.
 */
export function computeViewportFit(
  bounds: Rect,
  opts: ViewportFitOptions
): Viewport {
  const screenW = Math.max(240, opts.screenWidth);
  const screenH = Math.max(240, opts.screenHeight);
  const { top, right, bottom, left } = resolveHudMargins(
    screenW,
    screenH,
    opts.margins
  );
  const availW = Math.max(120, screenW - left - right);
  const availH = Math.max(120, screenH - top - bottom);

  const minZoom = opts.minZoom ?? 0.35;
  const maxZoom = opts.maxZoom ?? 1.1;
  const rawZoom = Math.min(
    availW / Math.max(1, bounds.width),
    availH / Math.max(1, bounds.height)
  );
  const zoom = Math.min(
    maxZoom,
    Math.max(minZoom, Math.round(rawZoom * 1000) / 1000)
  );

  const x = Math.round(left + (availW - bounds.width * zoom) / 2 - bounds.x * zoom);
  const y = Math.round(top + (availH - bounds.height * zoom) / 2 - bounds.y * zoom);
  return { x, y, zoom };
}

/**
 * Ensures `targetBounds` is completely visible inside the HUD-safe viewport frame:
 * - If already visible, returns `viewport` unchanged.
 * - If it fits at the current zoom, pans minimally while preserving exact zoom.
 * - If wider/taller than the safe area at current zoom, smoothly zooms out to fit.
 */
export function computeViewportEnsureVisible(
  viewport: Viewport,
  targetBounds: Rect,
  opts: ViewportFitOptions
): Viewport {
  const screenW = Math.max(240, opts.screenWidth);
  const screenH = Math.max(240, opts.screenHeight);
  const { top, right, bottom, left } = resolveHudMargins(
    screenW,
    screenH,
    opts.margins
  );
  const safeRight = screenW - right;
  const safeBottom = screenH - bottom;
  const availW = Math.max(120, safeRight - left);
  const availH = Math.max(120, safeBottom - top);

  const sx1 = viewport.x + targetBounds.x * viewport.zoom;
  const sy1 = viewport.y + targetBounds.y * viewport.zoom;
  const sx2 = sx1 + targetBounds.width * viewport.zoom;
  const sy2 = sy1 + targetBounds.height * viewport.zoom;

  if (sx1 >= left && sx2 <= safeRight && sy1 >= top && sy2 <= safeBottom) {
    return viewport;
  }

  const fitsAtCurrentZoom =
    targetBounds.width * viewport.zoom <= availW &&
    targetBounds.height * viewport.zoom <= availH;

  if (fitsAtCurrentZoom) {
    let dx = 0;
    let dy = 0;
    if (sx2 > safeRight) {
      dx = safeRight - sx2;
    } else if (sx1 < left) {
      dx = left - sx1;
    }
    if (sy2 > safeBottom) {
      dy = safeBottom - sy2;
    } else if (sy1 < top) {
      dy = top - sy1;
    }
    return {
      x: Math.round(viewport.x + dx),
      y: Math.round(viewport.y + dy),
      zoom: viewport.zoom,
    };
  }

  return computeViewportFit(targetBounds, {
    ...opts,
    margins: { top, right, bottom, left },
    maxZoom: Math.min(opts.maxZoom ?? 1.1, viewport.zoom),
  });
}

/**
 * Brings `target` into view without touching the zoom: the smallest pan that shows it, or centred when it is
 * bigger than the view.
 */
export function computeViewportPanTo(viewport: Viewport, target: Rect, opts: ViewportFitOptions): Viewport {
  const screenW = Math.max(240, opts.screenWidth);
  const screenH = Math.max(240, opts.screenHeight);
  const { top, right, bottom, left } = resolveHudMargins(screenW, screenH, opts.margins);
  const safeRight = screenW - right;
  const safeBottom = screenH - bottom;
  const z = viewport.zoom;
  const pan = (start: number, size: number, lo: number, hi: number): number => {
    const from = start;
    const to = start + size;
    if (size > hi - lo) return (lo + hi) / 2 - (from + to) / 2;
    if (to > hi) return hi - to;
    if (from < lo) return lo - from;
    return 0;
  };
  const dx = pan(viewport.x + target.x * z, target.width * z, left, safeRight);
  const dy = pan(viewport.y + target.y * z, target.height * z, top, safeBottom);
  if (dx === 0 && dy === 0) return viewport;
  return { x: Math.round(viewport.x + dx), y: Math.round(viewport.y + dy), zoom: z };
}

/** The whole board stays readable down to this zoom; past it the view follows the newest node instead. */
export const WHOLE_BOARD_MIN_ZOOM = 0.5;
const PHONE_WIDTH = 640;

/**
 * Keeps `target` in view the gentle way. Nothing moves while it is already visible. When it is not, the view
 * zooms out to show the whole board, as long as that stays readable (never zooming in, never under
 * `WHOLE_BOARD_MIN_ZOOM`), so earlier nodes do not scroll away as a diagram grows. Only a board too big
 * for that pans to the target.
 *
 * A phone never zooms out: the text keeps its size and the view pans to the target (Charles, 22 Nov 2026).
 */
export function computeViewportKeepBoard(
  viewport: Viewport,
  target: Rect,
  board: Rect | null,
  opts: ViewportFitOptions
): Viewport {
  if (opts.screenWidth < PHONE_WIDTH) return computeViewportPanTo(viewport, target, opts);
  const toTarget = computeViewportEnsureVisible(viewport, target, opts);
  if (toTarget === viewport || !board) return toTarget;
  const x = Math.min(board.x, target.x);
  const y = Math.min(board.y, target.y);
  const all: Rect = {
    x,
    y,
    width: Math.max(board.x + board.width, target.x + target.width) - x,
    height: Math.max(board.y + board.height, target.y + target.height) - y,
  };
  const whole = computeViewportFit(all, { ...opts, minZoom: 0.01, maxZoom: Math.min(opts.maxZoom ?? 1.1, viewport.zoom) });
  return whole.zoom >= WHOLE_BOARD_MIN_ZOOM ? whole : toTarget;
}

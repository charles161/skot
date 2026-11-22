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

/** Computes clean connection anchor points on the boundary of two shapes. */
export function resolveArrowEndpoints(
  arrow: JevElement,
  elementsById: Map<string, JevElement>
): { start: Point; end: Point; control: Point } {
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

  return {
    start,
    end,
    control: {
      x: midX + nx * offset,
      y: midY + ny * offset,
    },
  };
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

/** The whole board stays readable down to this zoom; past it the view follows the newest node instead. */
export const WHOLE_BOARD_MIN_ZOOM = 0.5;

/**
 * Keeps `target` in view the gentle way. Nothing moves while it is already visible. When it is not, the view
 * zooms out to show the whole board, as long as that stays readable (never zooming in, never under
 * `WHOLE_BOARD_MIN_ZOOM`), so earlier nodes do not scroll away as a diagram grows. Only a board too big
 * for that pans to the target.
 */
export function computeViewportKeepBoard(
  viewport: Viewport,
  target: Rect,
  board: Rect | null,
  opts: ViewportFitOptions
): Viewport {
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

import { resolveArrowMarkers, type ArrowEndMarker, type MarkerFill } from "./arrow-ends";
import { getTonePalette, type TonePalette } from "./colors";
import {
  computeBounds,
  EDGE_HANDLE_RADIUS,
  EDGE_HANDLE_STROKE,
  getEdgeHandles,
  getElementCenter,
  isShapeElement,
  resolveArrowEndpoints,
  type ArrowGeometry,
} from "./geometry";
import { isContainerKind, resolveRenderStyle } from "./notation-kinds";
import {
  computeArrowHeadPath,
  generateArrowPath,
  generateShapePaths,
  smoothFreedrawPath,
  type ShapePath,
} from "./rough-paths";
import {
  BOARD_PAPER,
  layoutShapeGlyphs,
  shapeLabelBox,
  type LabelBox,
  type ShapeGlyphs,
} from "./shape-layout";
import type {
  BoardTheme,
  ElementBox,
  JevElement,
  PeerCursor,
  Point,
  PredictedAction,
  RenderStyle,
  ToolType,
  Viewport,
} from "./types";

const GRID_DOT_COLOR: Record<BoardTheme, string> = {
  vellum: "#cfc8ba",
  midnight: "#293245",
};

const MAX_OFFSCREEN_DIM = 2048;
const PATH2D_CACHE_MAX = 2048;
const path2dCache = new Map<string, Path2D>();

function getPath2D(d: string): Path2D {
  const hit = path2dCache.get(d);
  if (hit) return hit;
  const p = new Path2D(d);
  if (path2dCache.size >= PATH2D_CACHE_MAX) path2dCache.clear();
  path2dCache.set(d, p);
  return p;
}

export interface CanvasFonts {
  sans: string;
  sketch: string;
  mono: string;
}

const DEFAULT_FONTS: CanvasFonts = {
  sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  sketch: 'Caveat, "Comic Sans MS", cursive',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

export function resolveCanvasFonts(): CanvasFonts {
  if (typeof window === "undefined" || typeof document === "undefined") return DEFAULT_FONTS;
  const cs = getComputedStyle(document.documentElement);
  const read = (v: string, fallback: string) => {
    const raw = cs.getPropertyValue(v).trim();
    return raw ? `${raw}, ${fallback}` : fallback;
  };
  return {
    sans: read("--font-sans", DEFAULT_FONTS.sans),
    sketch: read("--font-sketch", DEFAULT_FONTS.sketch),
    mono: read("--font-mono", DEFAULT_FONTS.mono),
  };
}

function markerFillColor(fill: MarkerFill, stroke: string, paper: string): string {
  return fill === "stroke" ? stroke : fill === "paper" ? paper : "none";
}

function parseDash(dash?: string): number[] {
  if (!dash) return [];
  return dash
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawShapePaths(
  ctx: CanvasRenderingContext2D,
  paths: ShapePath[],
  el: JevElement,
  renderStyle: RenderStyle,
  isGhost = false
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of paths) {
    if (!p.d) continue;
    const p2d = getPath2D(p.d);
    if (p.fill && p.fill !== "none") {
      ctx.save();
      if (p.fillOpacity !== undefined) ctx.globalAlpha *= p.fillOpacity;
      ctx.fillStyle = p.fill;
      ctx.fill(p2d);
      ctx.restore();
    }
    if (p.stroke && p.stroke !== "none" && (p.strokeWidth ?? 1) > 0) {
      ctx.save();
      if (p.strokeOpacity !== undefined) ctx.globalAlpha *= p.strokeOpacity;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth ?? 1.5;
      const dashStr = isGhost
        ? "7 5"
        : (p.dash ?? (el.kind === "frame" && renderStyle === "clean" ? "8 6" : undefined));
      if (dashStr) ctx.setLineDash(parseDash(dashStr));
      ctx.stroke(p2d);
      ctx.restore();
    }
  }
}

function drawShapeGlyphs(
  ctx: CanvasRenderingContext2D,
  glyphs: ShapeGlyphs,
  pal: TonePalette,
  labelFont: string,
  monoFont: string,
  color?: string
): void {
  for (const b of glyphs.badges) {
    ctx.save();
    ctx.globalAlpha *= 0.16;
    ctx.fillStyle = color ?? pal.stroke;
    drawRoundedRectPath(ctx, b.x, b.y, b.w, b.h, 3);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = color ?? pal.stroke;
    ctx.font = `700 8.5px ${monoFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h - 3.5);
    ctx.restore();
  }

  for (const t of glyphs.texts) {
    ctx.save();
    const family = t.font === "mono" ? monoFont : labelFont;
    const style = t.italic ? "italic " : "";
    ctx.font = `${style}${t.weight} ${t.size}px ${family}`;
    ctx.fillStyle =
      color ?? (t.tone === "text" ? pal.text : t.tone === "subtext" ? pal.subtext : pal.stroke);
    ctx.textAlign = t.anchor === "middle" ? "center" : t.anchor === "end" ? "right" : "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t.text, t.x, t.y);
    if (t.underline) {
      const m = ctx.measureText(t.text);
      const w = m.width;
      const startX =
        t.anchor === "middle" ? t.x - w / 2 : t.anchor === "end" ? t.x - w : t.x;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(startX, t.y + 1.5);
      ctx.lineTo(startX + w, t.y + 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const safeMax = Math.max(20, maxWidth);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${line} ${words[i]}`;
    if (ctx.measureText(candidate).width <= safeMax) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "…";
}

function drawLabelBox(
  ctx: CanvasRenderingContext2D,
  el: JevElement,
  box: LabelBox,
  labelColor: string,
  sublabelColor: string,
  labelFont: string,
  monoFont: string,
  fontSize = 14,
  subOpacity = 1
): void {
  const maxW = Math.max(20, box.width);
  ctx.save();
  ctx.font = `600 ${fontSize}px ${labelFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelLines = el.label ? wrapTextLines(ctx, el.label, maxW) : [];
  const lineHeight = fontSize * 1.2;
  const subHeight = el.sublabel ? 12 : 0;
  const subGap = el.sublabel && labelLines.length > 0 ? 3 : 0;
  const totalHeight = labelLines.length * lineHeight + subGap + subHeight;

  const cx = box.x + box.width / 2;
  let curY = box.y + box.height / 2 - totalHeight / 2;

  ctx.fillStyle = labelColor;
  for (const line of labelLines) {
    ctx.fillText(line, cx, curY + lineHeight / 2);
    curY += lineHeight;
  }

  if (el.sublabel) {
    curY += subGap;
    ctx.globalAlpha *= subOpacity;
    ctx.font = `500 9.5px ${monoFont}`;
    ctx.fillStyle = sublabelColor;
    const clipped = truncateText(ctx, el.sublabel, maxW);
    ctx.fillText(clipped, cx, curY + subHeight / 2);
  }
  ctx.restore();
}

function drawArrowMarkers(
  ctx: CanvasRenderingContext2D,
  start: ArrowEndMarker,
  end: ArrowEndMarker,
  stroke: string,
  paper: string,
  strokeWidth: number
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  for (const marker of [end, start]) {
    for (const p of marker.paths) {
      const p2d = getPath2D(p.d);
      const fill = markerFillColor(p.fill, stroke, paper);
      if (fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fill(p2d);
      }
      ctx.stroke(p2d);
    }
  }
  ctx.restore();
}

function drawArrowPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  theme: BoardTheme,
  stroke: string,
  textColor: string,
  monoFont: string,
  opts?: { isGhost?: boolean; solidBg?: string; solidText?: string }
): void {
  const pillW = opts?.solidBg
    ? Math.max(48, label.length * 7.2 + 22)
    : opts?.isGhost
      ? label.length * 7 + 16
      : label.length * 7.2 + 18;
  const pillH = opts?.solidBg ? 22 : opts?.isGhost ? 18 : 20;
  const rx = opts?.solidBg ? 7 : opts?.isGhost ? 5 : 6;
  ctx.save();
  drawRoundedRectPath(ctx, x - pillW / 2, y - pillH / 2 - 1, pillW, pillH, rx);
  ctx.fillStyle = opts?.solidBg ?? (theme === "midnight" ? "#151A24" : "#FAF8F2");
  ctx.fill();
  if (!opts?.solidBg) {
    ctx.save();
    ctx.globalAlpha *= opts?.isGhost ? 0.35 : 0.2;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = opts?.solidText ?? textColor;
  ctx.font = `${opts?.solidBg ? 600 : 500} ${opts?.isGhost ? 10 : 10.5}px ${monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
  ctx.restore();
}

/** Excalidraw-style per-element offscreen bitmap cache keyed by element reference. */
interface CachedElementBitmap {
  canvas: HTMLCanvasElement;
  /** Padding around element local (0, 0) in world coordinates. */
  padLeft: number;
  padTop: number;
  /** World width/height covered by the offscreen bitmap. */
  worldWidth: number;
  worldHeight: number;
  zoomValue: number;
  dpr: number;
  cacheKey: string;
}

export class ElementBitmapCache {
  private map = new WeakMap<JevElement, CachedElementBitmap>();
  private generation = 0;
  dragBackdropCanvas: HTMLCanvasElement | null = null;
  dragBackdropKey = "";

  /** Invalidate all cached bitmaps (e.g. after web fonts finish loading). */
  invalidateAll(): void {
    this.generation += 1;
    this.dragBackdropKey = "";
  }

  clearDragBackdrop(): void {
    this.dragBackdropKey = "";
  }

  getOrCreateShape(
    el: JevElement,
    opts: {
      theme: BoardTheme;
      paper: string;
      accentColor: string;
      renderStyle: RenderStyle;
      isSelected: boolean;
      isBeingReplaced: boolean;
      isEditing: boolean;
      forkActive: boolean;
      zoom: number;
      dpr: number;
      shouldCacheIgnoreZoom: boolean;
      fonts: CanvasFonts;
    }
  ): CachedElementBitmap | null {
    const key = `${this.generation}|${opts.theme}|${opts.renderStyle}|${opts.isSelected ? 1 : 0}|${opts.isBeingReplaced ? 1 : 0}|${opts.isEditing ? 1 : 0}|${opts.forkActive ? 1 : 0}|${el.width}x${el.height}`;
    const prev = this.map.get(el);
    const shouldRegenerateZoom =
      prev &&
      Math.abs(prev.zoomValue - opts.zoom) > 1e-4 &&
      !opts.shouldCacheIgnoreZoom;

    if (
      prev &&
      prev.cacheKey === key &&
      prev.dpr === opts.dpr &&
      !shouldRegenerateZoom
    ) {
      return prev;
    }

    const padLeft = el.kind === "actor" ? 36 : 16;
    const padRight = el.kind === "actor" ? 36 : 16;
    const padTop = 16;
    const padBottom = el.kind === "actor" ? 28 : 16;
    const worldWidth = Math.max(20, el.width) + padLeft + padRight;
    const worldHeight = Math.max(20, el.height) + padTop + padBottom;

    const rawScale = opts.zoom * opts.dpr;
    const maxDim = Math.max(worldWidth, worldHeight);
    const effectiveScale = Math.min(rawScale, MAX_OFFSCREEN_DIM / Math.max(1, maxDim));
    const pxW = Math.max(1, Math.ceil(worldWidth * effectiveScale));
    const pxH = Math.max(1, Math.ceil(worldHeight * effectiveScale));

    const canvas = prev?.canvas ?? document.createElement("canvas");
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.setTransform(effectiveScale, 0, 0, effectiveScale, padLeft * effectiveScale, padTop * effectiveScale);

    const pal = getTonePalette(el.tone, opts.theme);
    const elStyle = resolveRenderStyle(el, opts.renderStyle);
    const stroke = opts.isSelected ? opts.accentColor : pal.stroke;
    const labelFont = elStyle === "sketch" ? opts.fonts.sketch : opts.fonts.sans;

    if (opts.isBeingReplaced) {
      ctx.globalAlpha = opts.forkActive ? 0.34 : isContainerKind(el.kind) ? 0.22 : 0.25;
    }

    if (el.kind !== "text") {
      const paths = generateShapePaths(el, stroke, pal.fill, elStyle, false, opts.paper);
      drawShapePaths(ctx, paths, el, elStyle, false);
    }

    if (!opts.isEditing && el.kind !== "markdown") {
      if (el.kind === "frame") {
        ctx.save();
        ctx.fillStyle = pal.subtext;
        ctx.font = `500 11px ${opts.fonts.mono}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText((el.label ?? "").toUpperCase(), 16, 24);
        ctx.restore();
      } else {
        const glyphs = layoutShapeGlyphs(el);
        if (glyphs) {
          drawShapeGlyphs(ctx, glyphs, pal, labelFont, opts.fonts.mono);
        } else {
          const box = shapeLabelBox(el);
          if (box) {
            drawLabelBox(ctx, el, box, pal.text, pal.subtext, labelFont, opts.fonts.mono, 14);
          }
        }
      }
    }

    const entry: CachedElementBitmap = {
      canvas,
      padLeft,
      padTop,
      worldWidth,
      worldHeight,
      zoomValue: opts.zoom,
      dpr: opts.dpr,
      cacheKey: key,
    };
    this.map.set(el, entry);
    return entry;
  }

  getOrCreateFreedraw(
    dr: JevElement,
    opts: {
      theme: BoardTheme;
      accentColor: string;
      isSelected: boolean;
      zoom: number;
      dpr: number;
      shouldCacheIgnoreZoom: boolean;
    }
  ): CachedElementBitmap | null {
    if (!dr.points || dr.points.length < 2) return null;
    const key = `${this.generation}|fd|${opts.theme}|${opts.isSelected ? 1 : 0}|${dr.points.length}`;
    const prev = this.map.get(dr);
    const shouldRegenerateZoom =
      prev &&
      Math.abs(prev.zoomValue - opts.zoom) > 1e-4 &&
      !opts.shouldCacheIgnoreZoom;

    if (prev && prev.cacheKey === key && prev.dpr === opts.dpr && !shouldRegenerateZoom) {
      return prev;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of dr.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    const pad = 8;
    const worldWidth = Math.max(4, maxX - minX) + pad * 2;
    const worldHeight = Math.max(4, maxY - minY) + pad * 2;
    const rawScale = opts.zoom * opts.dpr;
    const effectiveScale = Math.min(rawScale, MAX_OFFSCREEN_DIM / Math.max(1, worldWidth, worldHeight));

    const canvas = prev?.canvas ?? document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(worldWidth * effectiveScale));
    canvas.height = Math.max(1, Math.ceil(worldHeight * effectiveScale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.setTransform(
      effectiveScale,
      0,
      0,
      effectiveScale,
      (-minX + pad) * effectiveScale,
      (-minY + pad) * effectiveScale
    );
    const pal = getTonePalette(dr.tone, opts.theme);
    ctx.strokeStyle = opts.isSelected ? opts.accentColor : pal.stroke;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(getPath2D(smoothFreedrawPath(dr.points)));

    const entry: CachedElementBitmap = {
      canvas,
      padLeft: -minX + pad,
      padTop: -minY + pad,
      worldWidth,
      worldHeight,
      zoomValue: opts.zoom,
      dpr: opts.dpr,
      cacheKey: key,
    };
    this.map.set(dr, entry);
    return entry;
  }
}

export interface StaticSceneState {
  width: number;
  height: number;
  dpr: number;
  viewport: Viewport;
  theme: BoardTheme;
  renderStyle: RenderStyle;
  frames: JevElement[];
  arrows: JevElement[];
  freedraws: JevElement[];
  shapes: JevElement[];
  elementsById: Map<string, JevElement>;
  arrowGeometries: Map<string, ArrowGeometry>;
  labelSpots: Map<string, Point>;
  selectedSet: Set<string>;
  removedGhostSet: Set<string>;
  editingId: string | null;
  forkActive: boolean;
  shouldCacheIgnoreZoom: boolean;
  dragOverrides: Map<string, ElementBox> | null;
  fonts: CanvasFonts;
  cache: ElementBitmapCache;
}

interface CachedArrowRender {
  key: string;
  markers: ReturnType<typeof resolveArrowMarkers>;
  paths: ReturnType<typeof generateArrowPath>;
}

const arrowRenderCache = new WeakMap<JevElement, CachedArrowRender>();

/**
 * Adaptive Figma/Excalidraw-style dot grid:
 * Keeps on-screen dot spacing in a comfortable ~20-40px band via power-of-2 world multiples,
 * and draws every dot in a single batched `ctx.rect` + `ctx.fill()` pass (zero scaled CanvasPattern shader,
 * zero stepping/jitter, 100% continuous sub-pixel flow locked to the canvas transform).
 */
function drawDotGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  theme: BoardTheme
): void {
  // World-locked 28px base grid: never halves when zooming in (1x..8x stays
  // pinned to exact world points), and smoothly cross-fades minor dots on zoom-out
  // so there is zero popping or stepping at any zoom level.
  let majorStep = 28;
  while (majorStep * viewport.zoom < 18 && majorStep < 448) majorStep *= 2;

  const majorSpacing = majorStep * viewport.zoom;
  if (majorSpacing < 8) return;

  const size = Math.max(1.5, Math.min(2.6, 1.75 * Math.sqrt(viewport.zoom)));
  const half = size / 2;

  const ox = ((viewport.x % majorSpacing) + majorSpacing) % majorSpacing;
  const oy = ((viewport.y % majorSpacing) + majorSpacing) % majorSpacing;

  ctx.fillStyle = GRID_DOT_COLOR[theme];
  ctx.beginPath();
  for (let x = ox; x < width + majorSpacing; x += majorSpacing) {
    const rx = x - half;
    for (let y = oy; y < height + majorSpacing; y += majorSpacing) {
      ctx.rect(rx, y - half, size, size);
    }
  }
  ctx.fill();

  // Smoothly cross-fade intermediate half-step dots when zooming out past 0.64x
  if (majorStep > 28) {
    const minorSpacing = majorSpacing / 2;
    const fade = Math.max(0, Math.min(1, (minorSpacing - 10) / 8));
    if (fade > 0.02) {
      const mOx = ((viewport.x % minorSpacing) + minorSpacing) % minorSpacing;
      const mOy = ((viewport.y % minorSpacing) + minorSpacing) % minorSpacing;
      const startXi = Math.round((mOx - viewport.x) / minorSpacing);
      const startYi = Math.round((mOy - viewport.y) / minorSpacing);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.beginPath();
      for (let x = mOx, xi = startXi; x < width + minorSpacing; x += minorSpacing, xi++) {
        const rx = x - half;
        const xEven = (xi & 1) === 0;
        for (let y = mOy, yi = startYi; y < height + minorSpacing; y += minorSpacing, yi++) {
          if (xEven && (yi & 1) === 0) continue; // already drawn in major pass
          ctx.rect(rx, y - half, size, size);
        }
      }
      ctx.fill();
      ctx.restore();
    }
  }
}

function resolveWithOverride(
  el: JevElement,
  overrides: Map<string, ElementBox> | null
): JevElement {
  const ov = overrides?.get(el.id);
  if (!ov) return el;
  return { ...el, x: ov.x, y: ov.y, width: ov.width, height: ov.height };
}

function isBoxVisible(
  x: number,
  y: number,
  w: number,
  h: number,
  viewLeft: number,
  viewTop: number,
  viewRight: number,
  viewBottom: number,
  margin = 80
): boolean {
  return (
    x + w >= viewLeft - margin &&
    x <= viewRight + margin &&
    y + h >= viewTop - margin &&
    y <= viewBottom + margin
  );
}

/**
 * Excalidraw-grade StaticCanvas painter:
 * Clears once, draws pixel-locked dot grid, frustum-culls elements, and blits per-element cached offscreen canvases.
 * During active drag/resize, caches all unaffected elements in an offscreen backdrop so pointermove only blits
 * the 1 backdrop + the dragged element(s) and their directly connected arrows.
 */
export function renderStaticScene(ctx: CanvasRenderingContext2D, st: StaticSceneState): void {
  const { width, height, dpr, viewport, theme, renderStyle, fonts, cache } = st;
  const paper = BOARD_PAPER[theme];
  const accentColor = theme === "midnight" ? "#F0643E" : "#D94E28";

  const viewLeft = -viewport.x / viewport.zoom;
  const viewTop = -viewport.y / viewport.zoom;
  const viewRight = viewLeft + width / viewport.zoom;
  const viewBottom = viewTop + height / viewport.zoom;

  const isDragging = Boolean(st.dragOverrides && st.dragOverrides.size > 0);

  const blitShapeTo = (targetCtx: CanvasRenderingContext2D, rawEl: JevElement) => {
    const ov = st.dragOverrides?.get(rawEl.id);
    const drawX = ov ? ov.x : rawEl.x;
    const drawY = ov ? ov.y : rawEl.y;
    const drawW = ov ? ov.width : rawEl.width;
    const drawH = ov ? ov.height : rawEl.height;
    if (!isBoxVisible(drawX, drawY, drawW, drawH, viewLeft, viewTop, viewRight, viewBottom)) {
      return;
    }
    const elForRender =
      ov && (ov.width !== rawEl.width || ov.height !== rawEl.height)
        ? { ...rawEl, width: ov.width, height: ov.height }
        : rawEl;

    const bmp = cache.getOrCreateShape(elForRender, {
      theme,
      paper,
      accentColor,
      renderStyle,
      isSelected: st.selectedSet.has(rawEl.id),
      isBeingReplaced: st.removedGhostSet.has(rawEl.id),
      isEditing: st.editingId === rawEl.id,
      forkActive: st.forkActive,
      zoom: viewport.zoom,
      dpr,
      shouldCacheIgnoreZoom: st.shouldCacheIgnoreZoom,
      fonts,
    });
    if (!bmp) return;
    targetCtx.drawImage(
      bmp.canvas,
      drawX - bmp.padLeft,
      drawY - bmp.padTop,
      bmp.worldWidth,
      bmp.worldHeight
    );
  };

  let effectiveMap = st.elementsById;
  if (isDragging && st.dragOverrides) {
    effectiveMap = new Map(st.elementsById);
    for (const [id, ov] of st.dragOverrides) {
      const base = effectiveMap.get(id);
      if (base) effectiveMap.set(id, { ...base, ...ov });
    }
  }

  const drawArrowTo = (targetCtx: CanvasRenderingContext2D, arrow: JevElement, dynamic: boolean) => {
    const geom = dynamic
      ? resolveArrowEndpoints(arrow, effectiveMap)
      : (st.arrowGeometries.get(arrow.id) ?? resolveArrowEndpoints(arrow, effectiveMap));
    const { start, end, control } = geom;
    const minX = Math.min(start.x, end.x, control.x);
    const minY = Math.min(start.y, end.y, control.y);
    const maxX = Math.max(start.x, end.x, control.x);
    const maxY = Math.max(start.y, end.y, control.y);
    if (!isBoxVisible(minX, minY, maxX - minX, maxY - minY, viewLeft, viewTop, viewRight, viewBottom, 120)) {
      return;
    }

    const pal = getTonePalette(arrow.tone, theme);
    const isSelected = st.selectedSet.has(arrow.id);
    const isBeingReplaced = st.removedGhostSet.has(arrow.id);
    const stroke = isSelected ? accentColor : pal.stroke;
    const arrowStyle = resolveRenderStyle(arrow, renderStyle);
    const arrowCacheKey = `${start.x.toFixed(1)},${start.y.toFixed(1)}|${control.x.toFixed(1)},${control.y.toFixed(1)}|${end.x.toFixed(1)},${end.y.toFixed(1)}|${stroke}|${arrowStyle}|${arrow.dashed ? 1 : 0}`;
    let cachedArrow = arrowRenderCache.get(arrow);
    if (!cachedArrow || cachedArrow.key !== arrowCacheKey) {
      const markers = resolveArrowMarkers(arrow, { start, control, end });
      const paths = generateArrowPath(
        markers.lineStart,
        control,
        markers.lineEnd,
        arrow.seed,
        stroke,
        arrowStyle,
        arrow.dashed
      );
      cachedArrow = { key: arrowCacheKey, markers, paths };
      arrowRenderCache.set(arrow, cachedArrow);
    }
    const { markers, paths } = cachedArrow;

    targetCtx.save();
    if (isBeingReplaced) targetCtx.globalAlpha = st.forkActive ? 0.34 : 0.25;
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    for (const p of paths) {
      if (!p.d) continue;
      targetCtx.strokeStyle = p.stroke;
      targetCtx.lineWidth = isSelected ? 1.9 : (p.strokeWidth ?? 1.4);
      if (arrow.dashed && arrowStyle === "clean") targetCtx.setLineDash([6, 5]);
      else targetCtx.setLineDash([]);
      targetCtx.stroke(getPath2D(p.d));
    }
    targetCtx.setLineDash([]);
    drawArrowMarkers(targetCtx, markers.start, markers.end, stroke, paper, isSelected ? 1.85 : 1.45);
    if (arrow.label) {
      const spot = !dynamic ? st.labelSpots.get(arrow.id) : undefined;
      const lx = spot?.x ?? 0.25 * start.x + 0.5 * control.x + 0.25 * end.x;
      const ly = spot?.y ?? 0.25 * start.y + 0.5 * control.y + 0.25 * end.y;
      drawArrowPill(targetCtx, arrow.label, lx, ly, theme, stroke, pal.subtext, fonts.mono);
    }
    targetCtx.restore();
  };

  const drawFreedrawsTo = (targetCtx: CanvasRenderingContext2D) => {
    for (const dr of st.freedraws) {
      const bmp = cache.getOrCreateFreedraw(dr, {
        theme,
        accentColor,
        isSelected: st.selectedSet.has(dr.id),
        zoom: viewport.zoom,
        dpr,
        shouldCacheIgnoreZoom: st.shouldCacheIgnoreZoom,
      });
      if (!bmp) continue;
      const worldX = -bmp.padLeft;
      const worldY = -bmp.padTop;
      if (!isBoxVisible(worldX, worldY, bmp.worldWidth, bmp.worldHeight, viewLeft, viewTop, viewRight, viewBottom)) {
        continue;
      }
      targetCtx.drawImage(bmp.canvas, worldX, worldY, bmp.worldWidth, bmp.worldHeight);
    }
  };

  if (isDragging && st.dragOverrides && typeof document !== "undefined") {
    const moving = st.dragOverrides;
    const isMovingArrow = (a: JevElement) =>
      Boolean((a.fromId && moving.has(a.fromId)) || (a.toId && moving.has(a.toId)));

    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    const movingKey = Array.from(moving.keys()).sort().join(",");
    const selectedKey = Array.from(st.selectedSet).sort().join(",");
    const backdropKey = `${pw}x${ph}|${viewport.x.toFixed(2)},${viewport.y.toFixed(2)},${viewport.zoom.toFixed(4)}|${theme}|${renderStyle}|${st.editingId ?? ""}|${st.forkActive ? 1 : 0}|${st.frames.length}:${st.arrows.length}:${st.shapes.length}|${selectedKey}|${movingKey}`;

    if (!cache.dragBackdropCanvas) {
      cache.dragBackdropCanvas = document.createElement("canvas");
    }
    const backdrop = cache.dragBackdropCanvas;
    if (backdrop.width !== pw) backdrop.width = pw;
    if (backdrop.height !== ph) backdrop.height = ph;

    if (cache.dragBackdropKey !== backdropKey) {
      const bctx = backdrop.getContext("2d", { alpha: false });
      if (bctx) {
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bctx.fillStyle = paper;
        bctx.fillRect(0, 0, width, height);
        drawDotGrid(bctx, width, height, viewport, theme);

        bctx.save();
        bctx.translate(viewport.x, viewport.y);
        bctx.scale(viewport.zoom, viewport.zoom);
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = "high";
        for (const el of st.frames) {
          if (!moving.has(el.id)) blitShapeTo(bctx, el);
        }
        for (const arrow of st.arrows) {
          if (!isMovingArrow(arrow)) drawArrowTo(bctx, arrow, false);
        }
        drawFreedrawsTo(bctx);
        for (const el of st.shapes) {
          if (!moving.has(el.id)) blitShapeTo(bctx, el);
        }
        bctx.restore();
        cache.dragBackdropKey = backdropKey;
      }
    }

    // 1-call pixel-aligned blit of all unaffected elements + dot grid
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);

    // Draw ONLY the moving elements and their attached arrows
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    for (const el of st.frames) {
      if (moving.has(el.id)) blitShapeTo(ctx, el);
    }
    for (const arrow of st.arrows) {
      if (isMovingArrow(arrow)) drawArrowTo(ctx, arrow, true);
    }
    for (const el of st.shapes) {
      if (moving.has(el.id)) blitShapeTo(ctx, el);
    }
    ctx.restore();
    return;
  }

  cache.clearDragBackdrop();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  drawDotGrid(ctx, width, height, viewport, theme);

  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = st.shouldCacheIgnoreZoom ? "low" : "high";

  // 1. Containers (frames, zones, fragments)
  for (const el of st.frames) blitShapeTo(ctx, el);

  // 2. Arrows
  for (const arrow of st.arrows) drawArrowTo(ctx, arrow, false);

  // 3. Freedraw strokes
  drawFreedrawsTo(ctx);

  // 4. Shapes
  for (const el of st.shapes) blitShapeTo(ctx, el);

  ctx.restore();
}

export interface InteractiveSceneState {
  width: number;
  height: number;
  dpr: number;
  viewport: Viewport;
  theme: BoardTheme;
  tool: ToolType;
  frames: JevElement[];
  shapes: JevElement[];
  elements: JevElement[];
  elementsById: Map<string, JevElement>;
  ghostElementsMap: Map<string, JevElement>;
  ghostLabelSpots: Map<string, Point> | null;
  selectedIds: string[];
  selectedSet: Set<string>;
  primarySelectedId: string | null;
  hoveredId: string | null;
  forkActive: boolean;
  activePrediction: PredictedAction | null;
  snapGuides: Array<{ orientation: "h" | "v"; pos: number }>;
  peers: PeerCursor[];
  drag: {
    mode: string;
    startWorld: Point;
    currentWorld: Point;
    hoverTargetId?: string | null;
    freedrawPoints?: Point[];
  } | null;
  dragOverrides: Map<string, ElementBox> | null;
  fonts: CanvasFonts;
}

/**
 * Excalidraw-style InteractiveCanvas painter:
 * Renders selection overlays, handles, snap guides, ghost predictions, live drag previews, and peer cursors.
 */
export function renderInteractiveScene(ctx: CanvasRenderingContext2D, st: InteractiveSceneState): void {
  const { width, height, dpr, viewport, theme, fonts } = st;
  const paper = BOARD_PAPER[theme];
  const accentColor = theme === "midnight" ? "#F0643E" : "#D94E28";
  const ghostStroke = theme === "midnight" ? "#38BDF8" : "#2563EB";
  const ghostBadgeText = theme === "midnight" ? "#0F172A" : "#FFFFFF";
  const ghostFill =
    theme === "midnight" ? "rgba(56, 189, 248, 0.12)" : "rgba(37, 99, 235, 0.085)";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.zoom, viewport.zoom);

  // 1. Alignment snap guides
  if (st.snapGuides.length > 0) {
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const g of st.snapGuides) {
      ctx.beginPath();
      if (g.orientation === "h") {
        ctx.moveTo(-4000, g.pos);
        ctx.lineTo(4000, g.pos);
      } else {
        ctx.moveTo(g.pos, -4000);
        ctx.lineTo(g.pos, 4000);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 2. Container resize handles
  for (const rawEl of st.frames) {
    if (!st.selectedSet.has(rawEl.id)) continue;
    const el = resolveWithOverride(rawEl, st.dragOverrides);
    ctx.save();
    ctx.fillStyle = accentColor;
    drawRoundedRectPath(ctx, el.x + el.width - 6, el.y + el.height - 6, 12, 12, 3);
    ctx.fill();
    ctx.restore();
  }

  // 3. Shape selection rings, connect glows, resize handles, edge handles
  for (const rawEl of st.shapes) {
    const isSelected = st.selectedSet.has(rawEl.id);
    const isHovered = rawEl.id === st.hoveredId;
    const isConnectTarget = st.drag?.hoverTargetId === rawEl.id;
    if (!isSelected && !isHovered && !isConnectTarget) continue;

    const el = resolveWithOverride(rawEl, st.dragOverrides);

    if (isConnectTarget) {
      ctx.save();
      ctx.strokeStyle = ghostStroke;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      drawRoundedRectPath(ctx, el.x - 7, el.y - 7, el.width + 14, el.height + 14, 16);
      ctx.stroke();
      ctx.restore();
    }

    if (isSelected && !st.forkActive) {
      ctx.save();
      ctx.strokeStyle = accentColor;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      drawRoundedRectPath(ctx, el.x - 5, el.y - 5, el.width + 10, el.height + 10, 14);
      ctx.stroke();
      ctx.restore();

      if (st.primarySelectedId === el.id) {
        ctx.save();
        ctx.fillStyle = accentColor;
        ctx.strokeStyle = theme === "midnight" ? "#11151D" : "#FFFFFF";
        ctx.lineWidth = 1.5;
        drawRoundedRectPath(ctx, el.x + el.width - 5, el.y + el.height - 5, 11, 11, 3);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    if ((isSelected || isHovered) && !st.forkActive && st.tool === "select" && el.kind !== "text") {
      const handleFill = theme === "midnight" ? "#181D28" : "#FFFDF8";
      ctx.save();
      ctx.fillStyle = handleFill;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = EDGE_HANDLE_STROKE;
      for (const h of getEdgeHandles(el)) {
        ctx.beginPath();
        ctx.arc(h.point.x, h.point.y, EDGE_HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 4. Ghost predictions
  if (st.activePrediction) {
    const ghostItems = st.activePrediction.addElements ?? [];
    const ghostFrames = ghostItems.filter((e) => isContainerKind(e.kind));
    const ghostArrows = ghostItems.filter((e) => e.kind === "arrow");
    const ghostShapes = ghostItems.filter((e) => isShapeElement(e) && !isContainerKind(e.kind));

    ctx.save();
    ctx.globalAlpha = 0.9;

    for (const el of ghostFrames) {
      ctx.save();
      ctx.translate(el.x, el.y);
      const paths = generateShapePaths(el, ghostStroke, ghostFill, "clean", true, paper);
      drawShapePaths(ctx, paths, el, "clean", true);
      if (el.kind === "frame") {
        ctx.fillStyle = ghostStroke;
        ctx.font = `500 11px ${fonts.mono}`;
        ctx.fillText(`${el.label} · ghost`.toUpperCase(), 16, 24);
      } else {
        const glyphs = layoutShapeGlyphs(el);
        if (glyphs) {
          drawShapeGlyphs(ctx, glyphs, getTonePalette(el.tone, theme), fonts.sans, fonts.mono, ghostStroke);
        }
      }
      ctx.restore();
    }

    for (const patch of st.activePrediction.patchElements ?? []) {
      const target = st.elementsById.get(patch.id);
      if (!target) continue;
      const hasMove = patch.x !== undefined || patch.y !== undefined;
      const hasLabel =
        typeof patch.label === "string" &&
        patch.label.trim().length > 0 &&
        patch.label.trim() !== target.label.trim();
      if (!hasMove && !hasLabel) continue;

      if (!hasMove && hasLabel) {
        if (target.kind === "arrow") {
          const patchedArrow: JevElement = {
            ...target,
            ...(patch.toId !== undefined ? { toId: patch.toId } : {}),
            ...(patch.fromId !== undefined ? { fromId: patch.fromId } : {}),
          };
          const { start, end, control } = resolveArrowEndpoints(patchedArrow, st.ghostElementsMap);
          const lx = 0.25 * start.x + 0.5 * control.x + 0.25 * end.x;
          const ly = 0.25 * start.y + 0.5 * control.y + 0.25 * end.y;
          ctx.save();
          ctx.strokeStyle = ghostStroke;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.stroke(getPath2D(`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`));
          ctx.setLineDash([]);
          drawArrowPill(ctx, patch.label!.trim(), lx, ly, theme, ghostStroke, ghostStroke, fonts.mono, {
            solidBg: ghostStroke,
            solidText: ghostBadgeText,
          });
          ctx.restore();
        } else {
          ctx.save();
          ctx.fillStyle = ghostFill;
          ctx.strokeStyle = ghostStroke;
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          drawRoundedRectPath(ctx, target.x - 4, target.y - 4, target.width + 8, target.height + 8, 13);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
          drawArrowPill(
            ctx,
            patch.label!.trim(),
            target.x + target.width / 2,
            target.y - 16,
            theme,
            ghostStroke,
            ghostStroke,
            fonts.mono,
            { solidBg: ghostStroke, solidText: ghostBadgeText }
          );
          ctx.restore();
        }
        continue;
      }

      const px = patch.x ?? target.x;
      const py = patch.y ?? target.y;
      const tc = getElementCenter(target);
      const pc = { x: px + target.width / 2, y: py + target.height / 2 };
      ctx.save();
      ctx.strokeStyle = ghostStroke;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(tc.x, tc.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.stroke();
      ctx.fillStyle = ghostFill;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      drawRoundedRectPath(ctx, px, py, target.width, target.height, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    for (const arrow of ghostArrows) {
      const { start, end, control } = resolveArrowEndpoints(arrow, st.ghostElementsMap);
      const isLegacyHead = arrow.endEnd === undefined && arrow.startEnd === undefined;
      const markers = resolveArrowMarkers(arrow, { start, control, end });
      const lineStart = isLegacyHead ? start : markers.lineStart;
      const lineEnd = isLegacyHead ? end : markers.lineEnd;
      const d = `M ${lineStart.x} ${lineStart.y} Q ${control.x} ${control.y} ${lineEnd.x} ${lineEnd.y}`;

      ctx.save();
      ctx.strokeStyle = ghostStroke;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([6, 5]);
      ctx.stroke(getPath2D(d));
      ctx.setLineDash([]);
      if (isLegacyHead) {
        ctx.stroke(getPath2D(computeArrowHeadPath(control, end, 8)));
      } else {
        drawArrowMarkers(ctx, markers.start, markers.end, ghostStroke, paper, 1.5);
      }
      if (arrow.label) {
        const spot = st.ghostLabelSpots?.get(arrow.id);
        const lx = spot?.x ?? 0.25 * start.x + 0.5 * control.x + 0.25 * end.x;
        const ly = spot?.y ?? 0.25 * start.y + 0.5 * control.y + 0.25 * end.y;
        drawArrowPill(ctx, arrow.label, lx, ly, theme, ghostStroke, ghostStroke, fonts.mono, {
          isGhost: true,
        });
      }
      ctx.restore();
    }

    ghostShapes.forEach((el, idx) => {
      ctx.save();
      ctx.translate(el.x, el.y);
      const paths = generateShapePaths(el, ghostStroke, ghostFill, "clean", true, paper);
      drawShapePaths(ctx, paths, el, "clean", true);
      const glyphs = layoutShapeGlyphs(el);
      if (glyphs) {
        drawShapeGlyphs(ctx, glyphs, getTonePalette(el.tone, theme), fonts.sans, fonts.mono, ghostStroke);
      } else {
        const box = shapeLabelBox(el);
        if (box) {
          drawLabelBox(ctx, el, box, ghostStroke, ghostStroke, fonts.sans, fonts.mono, 13.5, 0.8);
        }
      }
      if (idx === 0) {
        const bx = Math.max(0, el.width - 62);
        const by = -11;
        ctx.fillStyle = ghostStroke;
        drawRoundedRectPath(ctx, bx, by, 62, 19, 6);
        ctx.fill();
        ctx.fillStyle = ghostBadgeText;
        ctx.font = `600 9.5px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Enter ↵", bx + 31, by + 9.5);
      }
      ctx.restore();
    });

    ctx.restore();
  }

  // 5. Live drag previews (freedraw, connect, draw_shape, marquee)
  if (st.drag?.mode === "freedraw" && st.drag.freedrawPoints && st.drag.freedrawPoints.length > 1) {
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(getPath2D(smoothFreedrawPath(st.drag.freedrawPoints)));
    ctx.restore();
  }

  if (st.drag?.mode === "connect") {
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(st.drag.startWorld.x, st.drag.startWorld.y);
    ctx.lineTo(st.drag.currentWorld.x, st.drag.currentWorld.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.stroke(getPath2D(computeArrowHeadPath(st.drag.startWorld, st.drag.currentWorld, 10)));
    ctx.restore();
  }

  if (st.drag?.mode === "draw_shape") {
    ctx.save();
    ctx.fillStyle = ghostFill;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    drawRoundedRectPath(
      ctx,
      Math.min(st.drag.startWorld.x, st.drag.currentWorld.x),
      Math.min(st.drag.startWorld.y, st.drag.currentWorld.y),
      Math.max(4, Math.abs(st.drag.currentWorld.x - st.drag.startWorld.x)),
      Math.max(4, Math.abs(st.drag.currentWorld.y - st.drag.startWorld.y)),
      10
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (st.drag?.mode === "marquee") {
    ctx.save();
    ctx.fillStyle = ghostFill;
    ctx.strokeStyle = ghostStroke;
    ctx.lineWidth = 1.4 / viewport.zoom;
    drawRoundedRectPath(
      ctx,
      Math.min(st.drag.startWorld.x, st.drag.currentWorld.x),
      Math.min(st.drag.startWorld.y, st.drag.currentWorld.y),
      Math.max(1, Math.abs(st.drag.currentWorld.x - st.drag.startWorld.x)),
      Math.max(1, Math.abs(st.drag.currentWorld.y - st.drag.startWorld.y)),
      4
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 6. Multi-selection group bounding box
  if (st.selectedIds.length > 1) {
    const selectedEls = st.elements
      .filter((e) => st.selectedSet.has(e.id))
      .map((e) => resolveWithOverride(e, st.dragOverrides));
    const groupBounds = computeBounds(selectedEls);
    if (groupBounds) {
      ctx.save();
      ctx.strokeStyle = st.forkActive ? accentColor : ghostStroke;
      ctx.globalAlpha = st.forkActive ? 0.35 : 0.55;
      ctx.lineWidth = 1.4 / viewport.zoom;
      ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
      drawRoundedRectPath(
        ctx,
        groupBounds.x - 10,
        groupBounds.y - 10,
        groupBounds.width + 20,
        groupBounds.height + 20,
        14
      );
      ctx.stroke();
      ctx.restore();

      if (st.forkActive) {
        const bx = groupBounds.x - 6;
        const by = groupBounds.y - 26;
        ctx.save();
        ctx.fillStyle = theme === "midnight" ? "#1E2432" : "#EDE8DD";
        drawRoundedRectPath(ctx, bx, by, 64, 18, 5);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = accentColor;
        ctx.font = `600 9.5px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("CURRENT", bx + 32, by + 9);
        ctx.restore();
      }
    }
  }

  // 7. Live remote peer cursors
  for (const peer of st.peers) {
    ctx.save();
    ctx.translate(peer.x, peer.y);
    ctx.fillStyle = peer.color;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    const arrow = getPath2D("M 0 0 L 4 17 L 8.5 11.5 L 15 10.5 Z");
    ctx.fill(arrow);
    ctx.stroke(arrow);

    const tag = `${peer.name}${peer.transport === "webrtc" ? " · P2P" : ""}`;
    const tagW = Math.max(66, peer.name.length * 7.2 + 26);
    drawRoundedRectPath(ctx, 13, 14, tagW, 22, 7);
    ctx.fillStyle = peer.color;
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `500 11px ${fonts.sans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, 22, 25);
    ctx.restore();
  }

  ctx.restore();
}

/** Read-only snapshot exposed for Playwright verification & accessibility tooling (no DOM overhead). */
export interface SkotRenderedElementSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sublabel?: string;
  paths: Array<{ d: string; stroke?: string; dash?: string; end?: "start" | "end" }>;
  texts: Array<{ text: string; y: number }>;
  labelPill?: { text: string; x: number; y: number; width: number; height: number };
  arrowPoints?: Array<[number, number]>;
}

export interface SkotSceneSnapshot {
  viewport: Viewport;
  elements: SkotRenderedElementSnapshot[];
  ghostShapes: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }>;
  ghostArrows: Array<{
    id: string;
    fromId?: string;
    toId?: string;
    label: string;
    points: Array<[number, number]>;
    labelPill?: { text: string; x: number; y: number; width: number; height: number };
  }>;
}

function sampleQuadCurve(start: Point, control: Point, end: Point, steps = 20): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push([
      mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    ]);
  }
  return pts;
}

export function buildSceneSnapshot(st: {
  viewport: Viewport;
  theme: BoardTheme;
  renderStyle: RenderStyle;
  elements: JevElement[];
  elementsById: Map<string, JevElement>;
  arrowGeometries: Map<string, ArrowGeometry>;
  labelSpots: Map<string, Point>;
  activePrediction: PredictedAction | null;
  ghostElementsMap: Map<string, JevElement>;
  ghostLabelSpots: Map<string, Point> | null;
  dragOverrides: Map<string, ElementBox> | null;
}): SkotSceneSnapshot {
  const paper = BOARD_PAPER[st.theme];
  const elements: SkotRenderedElementSnapshot[] = st.elements.map((rawEl) => {
    const el = resolveWithOverride(rawEl, st.dragOverrides);
    const pal = getTonePalette(el.tone, st.theme);
    const elStyle = resolveRenderStyle(el, st.renderStyle);

    if (el.kind === "arrow") {
      const geom = st.arrowGeometries.get(el.id) ?? resolveArrowEndpoints(el, st.elementsById);
      const markers = resolveArrowMarkers(el, geom);
      const shaftPaths = generateArrowPath(
        markers.lineStart,
        geom.control,
        markers.lineEnd,
        el.seed,
        pal.stroke,
        elStyle,
        el.dashed
      ).map((p) => ({
        d: p.d,
        stroke: p.stroke,
        dash: el.dashed && elStyle === "clean" ? "6 5" : undefined,
      }));
      const endPaths = markers.end.paths.map((p) => ({ d: p.d, stroke: pal.stroke, end: "end" as const }));
      const startPaths = markers.start.paths.map((p) => ({ d: p.d, stroke: pal.stroke, end: "start" as const }));
      const spot = st.labelSpots.get(el.id);
      const lx = spot?.x ?? 0.25 * geom.start.x + 0.5 * geom.control.x + 0.25 * geom.end.x;
      const ly = spot?.y ?? 0.25 * geom.start.y + 0.5 * geom.control.y + 0.25 * geom.end.y;
      const pillW = el.label ? el.label.length * 7.2 + 18 : 0;
      return {
        id: el.id,
        kind: el.kind,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        label: el.label,
        sublabel: el.sublabel,
        paths: [...shaftPaths, ...endPaths, ...startPaths],
        texts: el.label ? [{ text: el.label, y: 3 }] : [],
        arrowPoints: sampleQuadCurve(markers.lineStart, geom.control, markers.lineEnd),
        ...(el.label
          ? { labelPill: { text: el.label, x: lx, y: ly, width: pillW, height: 20 } }
          : {}),
      };
    }

    if (el.kind === "freedraw") {
      const d = el.points && el.points.length >= 2 ? smoothFreedrawPath(el.points) : "";
      return {
        id: el.id,
        kind: el.kind,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        label: el.label,
        paths: d ? [{ d, stroke: pal.stroke }] : [],
        texts: [],
      };
    }

    const paths =
      el.kind === "text"
        ? []
        : generateShapePaths(el, pal.stroke, pal.fill, elStyle, false, paper).map((p) => ({
            d: p.d,
            stroke: p.stroke,
            dash: p.dash ?? (el.kind === "frame" && elStyle === "clean" ? "8 6" : undefined),
          }));
    const glyphs = el.kind === "frame" ? null : layoutShapeGlyphs(el);
    const texts = glyphs
      ? [
          ...glyphs.texts.map((t) => ({ text: t.text, y: t.y })),
          ...glyphs.badges.map((b) => ({ text: b.text, y: b.y + b.h })),
        ]
      : el.kind === "frame"
        ? [{ text: el.label, y: 24 }]
        : el.label
          ? [{ text: el.label, y: el.height / 2 }]
          : [];

    return {
      id: el.id,
      kind: el.kind,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      label: el.label,
      sublabel: el.sublabel,
      paths,
      texts,
    };
  });

  const ghostItems = st.activePrediction?.addElements ?? [];
  const ghostShapes = ghostItems
    .filter((e) => isShapeElement(e))
    .map((e) => ({ id: e.id, label: e.label, x: e.x, y: e.y, width: e.width, height: e.height }));
  const ghostArrows = ghostItems
    .filter((e) => e.kind === "arrow")
    .map((arrow) => {
      const geom = resolveArrowEndpoints(arrow, st.ghostElementsMap);
      const isLegacy = arrow.endEnd === undefined && arrow.startEnd === undefined;
      const markers = resolveArrowMarkers(arrow, geom);
      const lineStart = isLegacy ? geom.start : markers.lineStart;
      const lineEnd = isLegacy ? geom.end : markers.lineEnd;
      const spot = st.ghostLabelSpots?.get(arrow.id);
      const lx = spot?.x ?? 0.25 * geom.start.x + 0.5 * geom.control.x + 0.25 * geom.end.x;
      const ly = spot?.y ?? 0.25 * geom.start.y + 0.5 * geom.control.y + 0.25 * geom.end.y;
      return {
        id: arrow.id,
        fromId: arrow.fromId,
        toId: arrow.toId,
        label: arrow.label,
        points: sampleQuadCurve(lineStart, geom.control, lineEnd),
        ...(arrow.label
          ? { labelPill: { text: arrow.label, x: lx, y: ly, width: arrow.label.length * 7 + 16, height: 18 } }
          : {}),
      };
    });

  return {
    viewport: { ...st.viewport },
    elements,
    ghostShapes,
    ghostArrows,
  };
}

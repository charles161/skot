import { resolveArrowMarkers, type MarkerFill } from "./arrow-ends";
import { getTonePalette, type TonePalette } from "./colors";
import { isShapeElement, Rect, resolveArrowEndpoints } from "./geometry";
import { isContainerKind, resolveRenderStyle } from "./notation-kinds";
import {
  generateArrowPath,
  generateShapePaths,
  smoothFreedrawPath,
  type ShapePath,
} from "./rough-paths";
import { BOARD_PAPER, layoutShapeGlyphs, shapeLabelBox, type ShapeGlyphs } from "./shape-layout";
import { layoutArrowLabels } from "./ghost-geometry";
import { BoardTheme, ELEMENT_KINDS, ElementKind, JevElement, Point, RenderStyle } from "./types";

export type SvgAttrValue = string | number | boolean | undefined | null;

export interface SvgNode {
  tag: string;
  attrs?: Record<string, SvgAttrValue>;
  children?: Array<SvgNode | string>;
}

export interface ExportSvgOptions {
  theme?: BoardTheme;
  renderStyle?: RenderStyle;
  title?: string;
  padding?: number;
  includeBackground?: boolean;
  backgroundColor?: string;
}

const ALLOWED_SVG_TAGS = new Set([
  "svg",
  "title",
  "desc",
  "defs",
  "g",
  "rect",
  "path",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "text",
  "tspan",
]);

const VALID_ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:_-]*$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGBA_COLOR_RE =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)$/;

const SANS_FONT_STACK =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SKETCH_FONT_STACK =
  "'Architects Daughter', 'Comic Sans MS', 'Bradley Hand', cursive, sans-serif";
const MONO_FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const DEFAULT_PADDING = 48;
const DEFAULT_EMPTY_WIDTH = 640;
const DEFAULT_EMPTY_HEIGHT = 360;

const KNOWN_ELEMENT_KINDS = new Set<ElementKind>(ELEMENT_KINDS);

/**
 * Strips XML 1.0 illegal control characters and unpaired UTF-16 surrogates.
 * When `preserveNewlines` is false (attribute values), normalizes tabs/newlines to spaces.
 */
export function sanitizeXmlText(value: string, preserveNewlines = true): string {
  const input = typeof value === "string" ? value : String(value ?? "");
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    // Handle UTF-16 surrogate pairs cleanly, dropping unpaired surrogates
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    // Reject XML 1.0 forbidden control characters and non-characters
    if (
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      continue;
    }

    if (!preserveNewlines && (code === 0x09 || code === 0x0a || code === 0x0d)) {
      out += " ";
      continue;
    }

    out += input[i];
  }
  return out;
}

/**
 * Strictly escapes all five XML special characters after stripping illegal control chars.
 */
export function escapeXml(value: string, preserveNewlines = true): string {
  const clean = sanitizeXmlText(value, preserveNewlines);
  return clean
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite numeric SVG attribute value: ${String(value)}`);
  }
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Serializes a structured SvgNode AST into well-formed, escaping-safe SVG XML.
 * Enforces a strict tag allowlist and blocks event handlers, hrefs, and data-* attributes.
 */
export function serializeSvgNode(node: SvgNode): string {
  if (!ALLOWED_SVG_TAGS.has(node.tag)) {
    throw new Error(`Disallowed SVG tag: ${node.tag}`);
  }

  let attrBuffer = "";
  if (node.attrs) {
    for (const [name, rawVal] of Object.entries(node.attrs)) {
      if (rawVal === undefined || rawVal === null || rawVal === false) {
        continue;
      }
      if (!VALID_ATTR_NAME_RE.test(name)) {
        throw new Error(`Invalid SVG attribute name: ${name}`);
      }
      const lower = name.toLowerCase();
      if (
        lower.startsWith("on") ||
        lower === "href" ||
        lower === "xlink:href" ||
        lower.startsWith("data-")
      ) {
        throw new Error(`Disallowed SVG attribute: ${name}`);
      }

      let serializedVal: string;
      if (typeof rawVal === "number") {
        serializedVal = formatSvgNumber(rawVal);
      } else if (typeof rawVal === "boolean") {
        serializedVal = "true";
      } else {
        serializedVal = escapeXml(rawVal, false);
      }
      attrBuffer += ` ${name}="${serializedVal}"`;
    }
  }

  const children = node.children ?? [];
  if (children.length === 0) {
    return `<${node.tag}${attrBuffer} />`;
  }

  let inner = "";
  for (const child of children) {
    if (typeof child === "string") {
      inner += escapeXml(child, true);
    } else {
      inner += serializeSvgNode(child);
    }
  }

  return `<${node.tag}${attrBuffer}>${inner}</${node.tag}>`;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizePoint(pt: Point | undefined): Point | undefined {
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
    return undefined;
  }
  return { x: pt.x, y: pt.y };
}

function toHexByte(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

/**
 * Splits CSS rgba()/rgb() colors into SVG 1.1 hex color + separate opacity attribute
 * so Illustrator, Inkscape, Figma, and macOS Preview render fills identically to browsers.
 */
function splitSvgColor(
  raw: string | undefined,
  fallback: string
): { color: string; opacity?: number } {
  if (!raw || typeof raw !== "string") {
    return { color: fallback };
  }
  const trimmed = raw.trim();
  if (trimmed === "none") {
    return { color: "none" };
  }
  if (HEX_COLOR_RE.test(trimmed)) {
    return { color: trimmed };
  }
  const match = RGBA_COLOR_RE.exec(trimmed);
  if (match) {
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    const hex = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
    if (match[4] !== undefined) {
      const alpha = Math.max(0, Math.min(1, Number(match[4])));
      if (Number.isFinite(alpha) && alpha < 1) {
        return { color: hex, opacity: Math.round(alpha * 1000) / 1000 };
      }
    }
    return { color: hex };
  }
  return { color: fallback };
}

function sanitizeElement(el: JevElement): JevElement | null {
  if (!el || typeof el !== "object" || !KNOWN_ELEMENT_KINDS.has(el.kind)) {
    return null;
  }
  const isShape = isShapeElement(el);
  const x = finiteOr(el.x, 0);
  const y = finiteOr(el.y, 0);
  const width = isShape
    ? Math.max(20, finiteOr(el.width, 160))
    : finiteOr(el.width, 0);
  const height = isShape
    ? Math.max(20, finiteOr(el.height, 74))
    : finiteOr(el.height, 0);
  const seed = Math.max(1, Math.floor(Math.abs(finiteOr(el.seed, 1))));
  const label = typeof el.label === "string" ? el.label : "";

  const sanitizedPoints = Array.isArray(el.points)
    ? el.points.filter(
        (p): p is Point =>
          Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y)
      )
    : undefined;

  return {
    ...el,
    x,
    y,
    width,
    height,
    seed,
    label,
    fromPoint: sanitizePoint(el.fromPoint),
    toPoint: sanitizePoint(el.toPoint),
    points: sanitizedPoints,
  };
}

/**
 * Word-wraps text (preserving explicit newlines) to fit comfortably within `maxWidth`.
 */
export function wrapSvgText(
  text: string,
  maxWidth: number,
  fontSize = 14
): string[] {
  const clean = sanitizeXmlText(text, true).replace(/\r\n?/g, "\n");
  if (!clean.trim()) return [];

  const safeWidth = Math.max(24, finiteOr(maxWidth, 140));
  const avgCharWidth = Math.max(5, fontSize * 0.56);
  const maxChars = Math.max(4, Math.floor(safeWidth / avgCharWidth));

  const paragraphs = clean.split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      if (lines.length > 0) lines.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = "";

    for (const word of words) {
      if (word.length > maxChars) {
        if (current) {
          lines.push(current);
          current = "";
        }
        for (let i = 0; i < word.length; i += maxChars) {
          const chunk = word.slice(i, i + maxChars);
          if (i + maxChars < word.length) {
            lines.push(chunk);
          } else {
            current = chunk;
          }
        }
        continue;
      }

      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function getArrowLabelMetrics(label: string): {
  lines: string[];
  width: number;
  height: number;
} | null {
  const clean = sanitizeXmlText(label, true).replace(/\r\n?/g, "\n").trim();
  if (!clean) return null;
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const maxLen = Math.max(...lines.map((l) => l.length));
  const width = Math.max(28, maxLen * 7.2 + 18);
  const height = Math.max(20, lines.length * 14 + 6);
  return { lines, width, height };
}

function expandBounds(
  acc: { minX: number; minY: number; maxX: number; maxY: number },
  x1: number,
  y1: number,
  x2: number = x1,
  y2: number = y1
): void {
  if (
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return;
  }
  acc.minX = Math.min(acc.minX, x1, x2);
  acc.minY = Math.min(acc.minY, y1, y2);
  acc.maxX = Math.max(acc.maxX, x1, x2);
  acc.maxY = Math.max(acc.maxY, y1, y2);
}

function expandQuadraticBezierBounds(
  acc: { minX: number; minY: number; maxX: number; maxY: number },
  p0: Point,
  p1: Point,
  p2: Point,
  margin: number
): void {
  expandBounds(acc, p0.x - margin, p0.y - margin, p0.x + margin, p0.y + margin);
  expandBounds(acc, p2.x - margin, p2.y - margin, p2.x + margin, p2.y + margin);

  // Exact extrema of B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
  const denomX = p0.x - 2 * p1.x + p2.x;
  if (Math.abs(denomX) > 1e-6) {
    const tx = (p0.x - p1.x) / denomX;
    if (tx > 0 && tx < 1) {
      const omt = 1 - tx;
      const bx = omt * omt * p0.x + 2 * omt * tx * p1.x + tx * tx * p2.x;
      const by = omt * omt * p0.y + 2 * omt * tx * p1.y + tx * tx * p2.y;
      expandBounds(acc, bx - margin, by - margin, bx + margin, by + margin);
    }
  }
  const denomY = p0.y - 2 * p1.y + p2.y;
  if (Math.abs(denomY) > 1e-6) {
    const ty = (p0.y - p1.y) / denomY;
    if (ty > 0 && ty < 1) {
      const omt = 1 - ty;
      const bx = omt * omt * p0.x + 2 * omt * ty * p1.x + ty * ty * p2.x;
      const by = omt * omt * p0.y + 2 * omt * ty * p1.y + ty * ty * p2.y;
      expandBounds(acc, bx - margin, by - margin, bx + margin, by + margin);
    }
  }
}

/**
 * Computes tight world-space bounds covering all renderable elements,
 * including curved arrow extrema, arrow label pills, freedraw strokes, and sketch stroke jitter.
 */
export function computeExportBounds(
  elements: readonly JevElement[],
  options?: { renderStyle?: RenderStyle }
): Rect | null {
  const sanitized: JevElement[] = [];
  for (const el of elements) {
    const clean = sanitizeElement(el);
    if (clean) sanitized.push(clean);
  }
  if (sanitized.length === 0) return null;

  const elementsById = new Map(sanitized.map((el) => [el.id, el]));
  const labelSpots = layoutArrowLabels(sanitized, elementsById);
  const sketchMargin = options?.renderStyle === "sketch" ? 4 : 0;

  const acc = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  for (const el of sanitized) {
    if (el.kind === "arrow") {
      const { start, end, control } = resolveArrowEndpoints(el, elementsById);
      expandQuadraticBezierBounds(acc, start, control, end, 9);
      const labelMetrics = getArrowLabelMetrics(el.label);
      if (labelMetrics) {
        const spot = labelSpots.get(el.id);
        const lx = spot?.x ?? 0.25 * start.x + 0.5 * control.x + 0.25 * end.x;
        const ly = spot?.y ?? 0.25 * start.y + 0.5 * control.y + 0.25 * end.y;
        expandBounds(
          acc,
          lx - labelMetrics.width / 2,
          ly - labelMetrics.height / 2,
          lx + labelMetrics.width / 2,
          ly + labelMetrics.height / 2
        );
      }
      continue;
    }

    if (el.kind === "freedraw") {
      if (!el.points || el.points.length === 0) continue;
      for (const p of el.points) {
        expandBounds(acc, p.x - 2, p.y - 2, p.x + 2, p.y + 2);
      }
      continue;
    }

    const m = el.kind === "text" ? 0 : sketchMargin;
    expandBounds(acc, el.x - m, el.y - m, el.x + el.width + m, el.y + el.height + m);
  }

  if (!Number.isFinite(acc.minX)) return null;
  return {
    x: acc.minX,
    y: acc.minY,
    width: Math.max(1, acc.maxX - acc.minX),
    height: Math.max(1, acc.maxY - acc.minY),
  };
}

function buildMultilineCenteredTextNode(
  lines: string[],
  centerX: number,
  centerY: number,
  opts: {
    fill: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    letterSpacing?: string;
    lineHeightRatio?: number;
  }
): SvgNode {
  const lineHeight = opts.fontSize * (opts.lineHeightRatio ?? 1.25);
  const firstBaselineY =
    centerY - ((lines.length - 1) * lineHeight) / 2 + opts.fontSize * 0.35;

  const tspans: SvgNode[] = lines.map((line, idx) => ({
    tag: "tspan",
    attrs: {
      x: centerX,
      dy: idx === 0 ? 0 : lineHeight,
    },
    children: [line || " "],
  }));

  return {
    tag: "text",
    attrs: {
      x: centerX,
      y: firstBaselineY,
      "text-anchor": "middle",
      fill: opts.fill,
      "font-family": opts.fontFamily,
      "font-size": opts.fontSize,
      "font-weight": opts.fontWeight,
      "letter-spacing": opts.letterSpacing,
    },
    children: tspans,
  };
}

function combineOpacity(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.round(a * b * 1000) / 1000;
}

function renderPathInfoNodes(paths: ShapePath[], opts?: { strokeDasharray?: string }): SvgNode[] {
  const nodes: SvgNode[] = [];
  for (const p of paths) {
    if (!p.d || p.d.includes("NaN") || p.d.includes("Infinity")) continue;
    const strokeParts = splitSvgColor(p.stroke, "none");
    const fillParts = splitSvgColor(p.fill, "none");
    nodes.push({
      tag: "path",
      attrs: {
        d: p.d,
        stroke: strokeParts.color,
        "stroke-opacity": combineOpacity(strokeParts.opacity, p.strokeOpacity),
        "stroke-width": finiteOr(p.strokeWidth, 1.5),
        fill: fillParts.color,
        "fill-opacity": combineOpacity(fillParts.opacity, p.fillOpacity),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-dasharray": p.dash ?? opts?.strokeDasharray,
      },
    });
  }
  return nodes;
}

function buildGlyphNodes(
  glyphs: ShapeGlyphs,
  pal: TonePalette,
  labelFont: string
): SvgNode[] {
  const nodes: SvgNode[] = [];
  const strokeParts = splitSvgColor(pal.stroke, "#1F232B");
  for (const b of glyphs.badges) {
    nodes.push(
      {
        tag: "rect",
        attrs: {
          x: b.x,
          y: b.y,
          width: b.w,
          height: b.h,
          rx: 3,
          fill: strokeParts.color,
          "fill-opacity": 0.16,
        },
      },
      {
        tag: "text",
        attrs: {
          x: b.x + b.w / 2,
          y: b.y + b.h - 3.5,
          "text-anchor": "middle",
          fill: strokeParts.color,
          "fill-opacity": strokeParts.opacity,
          "font-family": MONO_FONT_STACK,
          "font-size": 8.5,
          "font-weight": 700,
        },
        children: [b.text],
      }
    );
  }
  for (const t of glyphs.texts) {
    const color = splitSvgColor(t.tone === "text" ? pal.text : t.tone === "subtext" ? pal.subtext : pal.stroke, "#181B22");
    nodes.push({
      tag: "text",
      attrs: {
        x: t.x,
        y: t.y,
        "text-anchor": t.anchor === "start" ? undefined : t.anchor,
        fill: color.color,
        "fill-opacity": color.opacity,
        "font-family": t.font === "mono" ? MONO_FONT_STACK : labelFont,
        "font-size": t.size,
        "font-weight": t.weight,
        "font-style": t.italic ? "italic" : undefined,
        "text-decoration": t.underline ? "underline" : undefined,
      },
      children: [t.text],
    });
  }
  return nodes;
}

function markerFillColor(fill: MarkerFill, stroke: string, theme: BoardTheme): string {
  if (fill === "stroke") return stroke;
  if (fill === "paper") return BOARD_PAPER[theme];
  return "none";
}

function buildContainerNode(
  el: JevElement,
  theme: BoardTheme,
  boardStyle: RenderStyle
): SvgNode {
  if (el.kind === "frame") return buildFrameNode(el, theme, boardStyle);
  const renderStyle = resolveRenderStyle(el, boardStyle);
  const pal = getTonePalette(el.tone, theme);
  const paths = generateShapePaths(el, pal.stroke, pal.fill, renderStyle, false, BOARD_PAPER[theme]);
  const children: SvgNode[] = renderPathInfoNodes(paths);
  const glyphs = layoutShapeGlyphs(el);
  if (glyphs) {
    children.push(...buildGlyphNodes(glyphs, pal, renderStyle === "sketch" ? SKETCH_FONT_STACK : SANS_FONT_STACK));
  }
  return {
    tag: "g",
    attrs: {
      transform: `translate(${formatSvgNumber(el.x)}, ${formatSvgNumber(el.y)})`,
    },
    children,
  };
}

function buildFrameNode(
  el: JevElement,
  theme: BoardTheme,
  renderStyle: RenderStyle
): SvgNode {
  const pal = getTonePalette(el.tone, theme);
  const paths = generateShapePaths(el, pal.stroke, pal.fill, renderStyle, false);
  const children: SvgNode[] = renderPathInfoNodes(paths, {
    strokeDasharray: renderStyle === "clean" ? "8 6" : undefined,
  });

  const cleanLabel = sanitizeXmlText(el.label, true).replace(/\r\n?/g, "\n").trim();
  if (cleanLabel) {
    const upperLines = cleanLabel
      .toUpperCase()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const subtextColor = splitSvgColor(pal.subtext, "#5C6370");
    children.push({
      tag: "text",
      attrs: {
        x: 16,
        y: 24,
        fill: subtextColor.color,
        "fill-opacity": subtextColor.opacity,
        "font-family": MONO_FONT_STACK,
        "font-size": 11,
        "font-weight": 500,
        "letter-spacing": "0.09em",
      },
      children: upperLines.map((line, idx) => ({
        tag: "tspan",
        attrs: {
          x: 16,
          dy: idx === 0 ? 0 : 15,
        },
        children: [line],
      })),
    });
  }

  return {
    tag: "g",
    attrs: {
      transform: `translate(${formatSvgNumber(el.x)}, ${formatSvgNumber(el.y)})`,
    },
    children,
  };
}

function buildArrowNode(
  arrow: JevElement,
  elementsById: Map<string, JevElement>,
  theme: BoardTheme,
  boardStyle: RenderStyle,
  labelSpot?: Point
): SvgNode {
  const renderStyle = resolveRenderStyle(arrow, boardStyle);
  const pal = getTonePalette(arrow.tone, theme);
  const { start, end, control } = resolveArrowEndpoints(arrow, elementsById);
  const markers = resolveArrowMarkers(arrow, { start, control, end });
  const paths = generateArrowPath(
    markers.lineStart,
    control,
    markers.lineEnd,
    arrow.seed,
    pal.stroke,
    renderStyle,
    arrow.dashed,
    false
  );

  const strokeParts = splitSvgColor(pal.stroke, "#1F232B");
  const children: SvgNode[] = renderPathInfoNodes(paths, {
    strokeDasharray: arrow.dashed && renderStyle === "clean" ? "6 5" : undefined,
  });

  for (const p of [...markers.end.paths, ...markers.start.paths]) {
    const fill = splitSvgColor(markerFillColor(p.fill, pal.stroke, theme), "none");
    children.push({
      tag: "path",
      attrs: {
        d: p.d,
        stroke: strokeParts.color,
        "stroke-opacity": strokeParts.opacity,
        "stroke-width": 1.45,
        fill: fill.color,
        "fill-opacity": p.fill === "stroke" ? strokeParts.opacity : undefined,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    });
  }

  const labelMetrics = getArrowLabelMetrics(arrow.label);
  if (labelMetrics) {
    const labelX = labelSpot?.x ?? 0.25 * start.x + 0.5 * control.x + 0.25 * end.x;
    const labelY = labelSpot?.y ?? 0.25 * start.y + 0.5 * control.y + 0.25 * end.y;
    const pillFill = theme === "midnight" ? "#151A24" : "#FAF8F2";
    const subtextColor = splitSvgColor(pal.subtext, "#5C6370");

    children.push({
      tag: "g",
      attrs: {
        transform: `translate(${formatSvgNumber(labelX)}, ${formatSvgNumber(labelY)})`,
      },
      children: [
        {
          tag: "rect",
          attrs: {
            x: -labelMetrics.width / 2,
            y: -labelMetrics.height / 2,
            width: labelMetrics.width,
            height: labelMetrics.height,
            rx: 6,
            fill: pillFill,
            stroke: strokeParts.color,
            "stroke-opacity": 0.2,
            "stroke-width": 1,
          },
        },
        buildMultilineCenteredTextNode(labelMetrics.lines, 0, 0, {
          fill: subtextColor.color,
          fontFamily: MONO_FONT_STACK,
          fontSize: 10.5,
          fontWeight: 500,
          lineHeightRatio: 1.33,
        }),
      ],
    });
  }

  return {
    tag: "g",
    children,
  };
}

function buildFreedrawNode(el: JevElement, theme: BoardTheme): SvgNode | null {
  const pts = el.points ?? [];
  if (pts.length === 0) return null;
  const pal = getTonePalette(el.tone, theme);
  const strokeParts = splitSvgColor(pal.stroke, "#1F232B");

  if (pts.length === 1) {
    return {
      tag: "circle",
      attrs: {
        cx: pts[0].x,
        cy: pts[0].y,
        r: 1.4,
        fill: strokeParts.color,
        "fill-opacity": strokeParts.opacity,
      },
    };
  }

  const d = smoothFreedrawPath(pts);
  if (!d || d.includes("NaN") || d.includes("Infinity")) return null;

  return {
    tag: "path",
    attrs: {
      d,
      stroke: strokeParts.color,
      "stroke-opacity": strokeParts.opacity,
      "stroke-width": 2.4,
      fill: "none",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
  };
}

function buildShapeNode(
  el: JevElement,
  theme: BoardTheme,
  boardStyle: RenderStyle
): SvgNode {
  const renderStyle = resolveRenderStyle(el, boardStyle);
  const pal = getTonePalette(el.tone, theme);
  const children: SvgNode[] = [];
  const labelFont = renderStyle === "sketch" ? SKETCH_FONT_STACK : SANS_FONT_STACK;

  if (el.kind !== "text") {
    const paths = generateShapePaths(el, pal.stroke, pal.fill, renderStyle, false, BOARD_PAPER[theme]);
    children.push(...renderPathInfoNodes(paths));
  }

  const glyphs = layoutShapeGlyphs(el);
  const box = glyphs ? null : shapeLabelBox(el);
  if (glyphs) {
    children.push(...buildGlyphNodes(glyphs, pal, labelFont));
  } else if (box) {
    const fontSize = 14;
    const lines = wrapSvgText(el.label, Math.max(20, box.width), fontSize);
    const hasSublabel =
      typeof el.sublabel === "string" && el.sublabel.trim().length > 0;

    if (lines.length > 0) {
      const centerX = box.x + box.width / 2;
      const baseCenterY = box.y + Math.max(20, box.height) / 2;
      const centerY = hasSublabel ? baseCenterY - 7 : baseCenterY;
      const textColor = splitSvgColor(pal.text, "#181B22");

      children.push(
        buildMultilineCenteredTextNode(lines, centerX, centerY, {
          fill: textColor.color,
          fontFamily: labelFont,
          fontSize,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        })
      );

      if (hasSublabel) {
        const subtextColor = splitSvgColor(pal.subtext, "#5C6370");
        children.push(
          buildMultilineCenteredTextNode(
            [sanitizeXmlText(el.sublabel!, false).trim().slice(0, 32)],
            centerX,
            baseCenterY + 11,
            {
              fill: subtextColor.color,
              fontFamily: MONO_FONT_STACK,
              fontSize: 9.5,
              fontWeight: 500,
            }
          )
        );
      }
    }
  }

  return {
    tag: "g",
    attrs: {
      transform: `translate(${formatSvgNumber(el.x)}, ${formatSvgNumber(el.y)})`,
    },
    children,
  };
}

/**
 * Builds the pure standalone SVG AST for a Skot whiteboard without touching the DOM.
 */
export function buildBoardSvgTree(
  elements: readonly JevElement[],
  options: ExportSvgOptions = {}
): SvgNode {
  const theme: BoardTheme = options.theme === "midnight" ? "midnight" : "vellum";
  const renderStyle: RenderStyle =
    options.renderStyle === "clean" ? "clean" : "sketch";
  const padding = Math.max(0, finiteOr(options.padding, DEFAULT_PADDING));
  const includeBackground = options.includeBackground !== false;

  const defaultBg = theme === "midnight" ? "#11151D" : "#F7F4ED";
  const bgParts = splitSvgColor(options.backgroundColor, defaultBg);

  const sanitized: JevElement[] = [];
  for (const el of elements) {
    const clean = sanitizeElement(el);
    if (clean) sanitized.push(clean);
  }

  const elementsById = new Map(sanitized.map((el) => [el.id, el]));
  // The export draws each label where the canvas does: slid along its arrow when the middle is taken.
  const labelSpots = layoutArrowLabels(sanitized, elementsById);
  const bounds = computeExportBounds(sanitized, { renderStyle });

  const vbX = bounds ? bounds.x - padding : 0;
  const vbY = bounds ? bounds.y - padding : 0;
  const vbW = bounds ? bounds.width + padding * 2 : DEFAULT_EMPTY_WIDTH;
  const vbH = bounds ? bounds.height + padding * 2 : DEFAULT_EMPTY_HEIGHT;

  const children: SvgNode[] = [];

  const trimmedTitle =
    typeof options.title === "string"
      ? sanitizeXmlText(options.title, false).trim()
      : "";
  if (trimmedTitle) {
    children.push({
      tag: "title",
      children: [trimmedTitle],
    });
  }

  if (includeBackground && bgParts.color !== "none") {
    children.push({
      tag: "rect",
      attrs: {
        x: vbX,
        y: vbY,
        width: vbW,
        height: vbH,
        fill: bgParts.color,
        "fill-opacity": bgParts.opacity,
      },
    });
  }

  // Layer order matches JevCanvas: containers -> arrows -> freedraw -> shapes
  const containers = sanitized.filter((e) => isContainerKind(e.kind));
  const arrows = sanitized.filter((e) => e.kind === "arrow");
  const freedraws = sanitized.filter((e) => e.kind === "freedraw");
  const shapes = sanitized.filter(
    (e) => isShapeElement(e) && !isContainerKind(e.kind)
  );

  for (const container of containers) {
    children.push(buildContainerNode(container, theme, renderStyle));
  }
  for (const arrow of arrows) {
    children.push(buildArrowNode(arrow, elementsById, theme, renderStyle, labelSpots.get(arrow.id)));
  }
  for (const draw of freedraws) {
    const node = buildFreedrawNode(draw, theme);
    if (node) children.push(node);
  }
  for (const shape of shapes) {
    children.push(buildShapeNode(shape, theme, renderStyle));
  }

  return {
    tag: "svg",
    attrs: {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `${formatSvgNumber(vbX)} ${formatSvgNumber(vbY)} ${formatSvgNumber(vbW)} ${formatSvgNumber(vbH)}`,
      width: vbW,
      height: vbH,
      role: "img",
      "aria-label": trimmedTitle || "Skot Whiteboard Diagram",
    },
    children,
  };
}

/**
 * Serializes a Skot whiteboard into a self-contained, escaping-safe standalone SVG document.
 */
export function exportBoardToSvg(
  elements: readonly JevElement[],
  options: ExportSvgOptions = {}
): string {
  const tree = buildBoardSvgTree(elements, options);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeSvgNode(tree)}`;
}

/**
 * Sanitizes a user-provided board title into a safe download filename.
 */
export function sanitizeExportFilename(
  boardTitle: string,
  extension = "svg"
): string {
  const cleanExt =
    extension
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || "svg";
  const cleanStem = sanitizeXmlText(boardTitle, false)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleanStem || "skot-board"}.${cleanExt}`;
}

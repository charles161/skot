import rough from "roughjs";
import type { Options, PathInfo } from "roughjs/bin/core";
import {
  ACTOR_LABEL_HEIGHT,
  apiLayout,
  blobRimRadius,
  cardLayout,
  classLayout,
  entityLayout,
  fragmentLayout,
  lbInset,
  queueCapRadius,
  renderKindOf,
} from "./shape-layout";
import { JevElement, Point, RenderStyle } from "./types";

const gen = rough.generator();

/** A rendered shape path. `dash` is an SVG stroke-dasharray; opacities apply on top of the colours. */
export interface ShapePath extends PathInfo {
  dash?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
}

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string {
  const radius = Math.min(r, w / 2, h / 2);
  return [
    `M ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h - radius}`,
    `Q ${x + w} ${y + h} ${x + w - radius} ${y + h}`,
    `L ${x + radius} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - radius}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    "Z",
  ].join(" ");
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

function hline(y: number, x1: number, x2: number): string {
  return `M ${x1} ${y} L ${x2} ${y}`;
}

type PartFill = "fill" | "stroke" | "paper" | "none";

/** Geometry of an HLD shape, shared by the clean and the hand-drawn renderers. */
interface ShapePart {
  d: string;
  fill: PartFill;
  strokeWidth?: number;
  dash?: string;
}

const ZONE_DASH = "12 5 2 5";

function hldParts(el: JevElement, kind: string, w: number, h: number): ShapePart[] | null {
  switch (kind) {
    case "queue": {
      const rx = queueCapRadius(w);
      const ry = h / 2;
      const slots = [10, 18, 26].map((k) => {
        const x = w - rx - k;
        return { d: `M ${x} ${h * 0.24} L ${x} ${h * 0.76}`, fill: "none" as const, strokeWidth: 1.25 };
      });
      return [
        {
          d: `M ${rx} 0 L ${w - rx} 0 A ${rx} ${ry} 0 0 1 ${w - rx} ${h} L ${rx} ${h} A ${rx} ${ry} 0 0 1 ${rx} 0 Z`,
          fill: "fill",
        },
        { d: `M ${w - rx} 0 A ${rx} ${ry} 0 0 0 ${w - rx} ${h}`, fill: "none", strokeWidth: 1.5 },
        ...slots,
      ];
    }
    case "cache": {
      const bx = w - 22;
      const by = 7;
      return [
        { d: roundedRectPath(0, 0, w, h, 10), fill: "fill" },
        {
          d: `M ${bx + 9} ${by} L ${bx + 2} ${by + 10} L ${bx + 7} ${by + 10} L ${bx + 4} ${by + 18} L ${bx + 12} ${by + 7} L ${bx + 7} ${by + 7} Z`,
          fill: "stroke",
          strokeWidth: 1,
        },
      ];
    }
    case "lb": {
      const i = lbInset(w);
      const cy = h / 2;
      const gx = w / 2;
      const gy = h - 13;
      const fan = [-6, 0, 6].map((dy) => ({
        d: `M ${gx - 9} ${gy} L ${gx + 9} ${gy + dy}`,
        fill: "none" as const,
        strokeWidth: 1.25,
      }));
      return [
        { d: `M ${i} 0 L ${w - i} 0 L ${w} ${cy} L ${w - i} ${h} L ${i} ${h} L 0 ${cy} Z`, fill: "fill" },
        ...fan,
        { d: circlePath(gx - 10, gy, 2), fill: "stroke", strokeWidth: 1 },
      ];
    }
    case "blob": {
      const ry = blobRimRadius(h);
      const taper = w * 0.1;
      const botRy = ry * 0.8;
      return [
        {
          d: `M 0 ${ry} L ${taper} ${h - botRy} A ${w / 2 - taper} ${botRy} 0 0 0 ${w - taper} ${h - botRy} L ${w} ${ry} A ${w / 2} ${ry} 0 0 0 0 ${ry} Z`,
          fill: "fill",
        },
        { d: `M 0 ${ry} A ${w / 2} ${ry} 0 0 0 ${w} ${ry}`, fill: "none", strokeWidth: 1.5 },
      ];
    }
    case "external":
      return [
        { d: roundedRectPath(0, 0, w, h, 3), fill: "fill" },
        { d: roundedRectPath(4, 4, w - 8, h - 8, 2), fill: "none", strokeWidth: 1.1 },
      ];
    case "actor": {
      const fh = Math.max(24, h - ACTOR_LABEL_HEIGHT);
      const cx = w / 2;
      const r = Math.min(w * 0.14, fh * 0.12);
      const headCy = r + 2;
      const neckY = headCy + r;
      const hipY = neckY + (fh - neckY) * 0.5;
      const armY = neckY + (hipY - neckY) * 0.35;
      const span = Math.min(w * 0.42, fh * 0.3);
      return [
        { d: circlePath(cx, headCy, r), fill: "fill" },
        { d: `M ${cx} ${neckY} L ${cx} ${hipY}`, fill: "none" },
        { d: hline(armY, cx - span, cx + span), fill: "none" },
        { d: `M ${cx - span * 0.8} ${fh - 2} L ${cx} ${hipY} L ${cx + span * 0.8} ${fh - 2}`, fill: "none" },
      ];
    }
    case "zone":
      return [{ d: roundedRectPath(0, 0, w, h, 10), fill: "fill", strokeWidth: 1.5, dash: ZONE_DASH }];
    case "card": {
      const l = cardLayout({ label: el.label, sublabel: el.sublabel, width: w, height: h });
      const f = l.fold;
      const parts: ShapePart[] = [
        { d: `M 0 0 L ${w - f} 0 L ${w} ${f} L ${w} ${h} L 0 ${h} Z`, fill: "fill" },
        { d: `M ${w - f} 0 L ${w - f} ${f} L ${w} ${f}`, fill: "none", strokeWidth: 1.25 },
      ];
      if (l.titleHeight > 0) parts.push({ d: hline(l.titleHeight, 10, w - 10), fill: "none", strokeWidth: 1.1 });
      return parts;
    }
    case "markdown": {
      const r = 12;
      const headerH = Math.min(34, Math.max(24, h * 0.25));
      return [
        { d: roundedRectPath(0, 0, w, h, r), fill: "fill" },
        { d: hline(headerH, 10, w - 10), fill: "none", strokeWidth: 1 },
      ];
    }
    default:
      return null;
  }
}

function lldPaths(
  el: JevElement,
  kind: string,
  w: number,
  h: number,
  stroke: string,
  fill: string,
  paper: string,
  strokeWidth: number
): ShapePath[] | null {
  switch (kind) {
    case "entity": {
      const l = entityLayout({ sublabel: el.sublabel, height: h });
      const r = 4;
      const out: ShapePath[] = [
        { d: roundedRectPath(0, 0, w, h, r), stroke: "none", strokeWidth: 0, fill },
        {
          d: `M 0 ${l.headerHeight} L 0 ${r} Q 0 0 ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${l.headerHeight} Z`,
          stroke: "none",
          strokeWidth: 0,
          fill: stroke,
          fillOpacity: 0.13,
        },
        { d: hline(l.headerHeight, 0, w), stroke, strokeWidth: 1.25, fill: "none" },
      ];
      if (l.keyColWidth > 0) {
        out.push({
          d: `M ${l.keyColWidth} ${l.headerHeight} L ${l.keyColWidth} ${h}`,
          stroke,
          strokeWidth: 1,
          fill: "none",
          strokeOpacity: 0.45,
        });
      }
      if (l.pkDividerY !== null) {
        out.push({ d: hline(l.pkDividerY, 0, w), stroke, strokeWidth: 1, fill: "none", strokeOpacity: 0.6 });
      }
      out.push({ d: roundedRectPath(0, 0, w, h, r), stroke, strokeWidth, fill: "none" });
      return out;
    }
    case "class": {
      const l = classLayout({ label: el.label, sublabel: el.sublabel, height: h });
      return [
        { d: roundedRectPath(0, 0, w, h, 2), stroke, strokeWidth, fill },
        { d: hline(l.attrsTop, 0, w), stroke, strokeWidth: 1.25, fill: "none" },
        { d: hline(l.opsTop, 0, w), stroke, strokeWidth: 1.25, fill: "none" },
      ];
    }
    case "activation":
      return [
        { d: roundedRectPath(0, 0, w, h, 1), stroke: "none", strokeWidth: 0, fill: paper },
        { d: roundedRectPath(0, 0, w, h, 1), stroke, strokeWidth: 1.5, fill },
      ];
    case "fragment": {
      const l = fragmentLayout({ label: el.label, sublabel: el.sublabel, height: h });
      const tw = Math.min(l.tagWidth, w);
      const th = l.tagHeight;
      return [
        { d: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`, stroke, strokeWidth: 1.5, fill: "none" },
        { d: `M 0 0 L ${tw} 0 L ${tw} ${th - 6} L ${tw - 6} ${th} L 0 ${th} Z`, stroke, strokeWidth: 1.25, fill },
        ...l.operands.slice(1).map((op) => ({
          d: hline(op.top, 0, w),
          stroke,
          strokeWidth: 1.25,
          fill: "none",
          dash: "6 4",
        })),
      ];
    }
    case "api": {
      const l = apiLayout({ label: el.label, sublabel: el.sublabel, width: w, height: h });
      const r = 4;
      return [
        { d: roundedRectPath(0, 0, w, h, r), stroke: "none", strokeWidth: 0, fill },
        {
          d: `M 0 ${l.headerHeight} L 0 ${r} Q 0 0 ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${l.headerHeight} Z`,
          stroke: "none",
          strokeWidth: 0,
          fill: stroke,
          fillOpacity: 0.13,
        },
        { d: hline(l.headerHeight, 0, w), stroke, strokeWidth: 1.25, fill: "none" },
        {
          d: `M ${l.keyColWidth} ${l.headerHeight} L ${l.keyColWidth} ${h}`,
          stroke,
          strokeWidth: 1,
          fill: "none",
          strokeOpacity: 0.45,
        },
        { d: roundedRectPath(0, 0, w, h, r), stroke, strokeWidth, fill: "none" },
      ];
    }
    case "initial": {
      const r = Math.min(w, h) / 2 - 1;
      return [{ d: circlePath(w / 2, h / 2, r), stroke, strokeWidth: 1, fill: stroke }];
    }
    case "final": {
      const r = Math.min(w, h) / 2 - 1;
      return [
        { d: circlePath(w / 2, h / 2, r), stroke, strokeWidth: 1.5, fill: paper },
        { d: circlePath(w / 2, h / 2, r * 0.55), stroke, strokeWidth: 1, fill: stroke },
      ];
    }
    default:
      return null;
  }
}

function partFill(part: PartFill, stroke: string, fill: string, paper: string): string {
  if (part === "fill") return fill;
  if (part === "stroke") return stroke;
  if (part === "paper") return paper;
  return "none";
}

export function generateShapePaths(
  el: JevElement,
  stroke: string,
  fill: string,
  renderStyle: RenderStyle,
  isGhost = false,
  paper: string = fill
): ShapePath[] {
  const w = Math.max(20, el.width);
  const h = Math.max(20, el.height);
  const kind = renderKindOf(el);
  const outline = isGhost ? 1.8 : 1.75;

  const lld = lldPaths(el, kind, w, h, stroke, fill, paper, outline);
  if (lld) return lld;

  const parts = hldParts(el, kind, w, h);
  if (parts) {
    if (renderStyle === "clean" || isGhost) {
      return parts.map((p) => ({
        d: p.d,
        stroke,
        strokeWidth: p.strokeWidth ?? outline,
        fill: partFill(p.fill, stroke, fill, paper),
        ...(p.dash ? { dash: p.dash } : {}),
      }));
    }
    const isZone = kind === "zone";
    return parts.flatMap((p, i) => {
      const f = partFill(p.fill, stroke, fill, paper);
      const drawable = gen.path(p.d, {
        seed: el.seed + i,
        roughness: isZone ? 0.9 : p.strokeWidth !== undefined && p.strokeWidth <= 1.25 ? 0.35 : p.strokeWidth ? 0.8 : 1.2,
        bowing: 1.1,
        stroke,
        strokeWidth: (p.strokeWidth ?? 1.85) * (isZone ? 0.9 : 1),
        ...(f === "none" ? {} : { fill: f, fillStyle: "solid" as const }),
      });
      return gen.toPaths(drawable).map((info) => (p.dash ? { ...info, dash: p.dash } : info));
    });
  }

  if (renderStyle === "clean" || isGhost) {
    if (el.kind === "node") {
      return [
        {
          d: roundedRectPath(0, 0, w, h, 12),
          stroke,
          strokeWidth: isGhost ? 1.8 : 1.75,
          fill,
        },
      ];
    }
    if (el.kind === "frame") {
      return [
        {
          d: roundedRectPath(0, 0, w, h, 16),
          stroke,
          strokeWidth: 1.5,
          fill,
        },
      ];
    }
    if (el.kind === "diamond") {
      return [
        {
          d: `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`,
          stroke,
          strokeWidth: isGhost ? 1.8 : 1.75,
          fill,
        },
      ];
    }
    if (el.kind === "ellipse") {
      const rx = w / 2;
      const ry = h / 2;
      return [
        {
          d: `M ${rx} 0 A ${rx} ${ry} 0 1 0 ${rx} ${h} A ${rx} ${ry} 0 1 0 ${rx} 0 Z`,
          stroke,
          strokeWidth: isGhost ? 1.8 : 1.75,
          fill,
        },
      ];
    }
    if (el.kind === "database") {
      const ry = Math.min(13, h * 0.18);
      const rx = w / 2;
      const body = [
        `M 0 ${ry}`,
        `A ${rx} ${ry} 0 0 1 ${w} ${ry}`,
        `L ${w} ${h - ry}`,
        `A ${rx} ${ry} 0 0 1 0 ${h - ry}`,
        `Z`,
      ].join(" ");
      const topCap = `M 0 ${ry} A ${rx} ${ry} 0 0 0 ${w} ${ry}`;
      return [
        { d: body, stroke, strokeWidth: 1.75, fill },
        { d: topCap, stroke, strokeWidth: 1.5, fill: "none" },
      ];
    }
    return [];
  }

  // Hand-drafted RoughJS sketch rendering
  const baseOpts: Options = {
    seed: el.seed,
    roughness: el.kind === "frame" ? 0.9 : 1.35,
    bowing: 1.15,
    stroke,
    strokeWidth: el.kind === "frame" ? 1.35 : 1.85,
    fill,
    fillStyle: el.kind === "frame" ? "solid" : "hachure",
    fillWeight: 0.75,
    hachureGap: 7.5,
    hachureAngle: -41,
  };

  if (el.kind === "node") {
    const drawable = gen.path(roundedRectPath(0, 0, w, h, 11), {
      ...baseOpts,
      fillStyle: "solid",
    });
    const hatchOverlay = gen.rectangle(3, 3, w - 6, h - 6, {
      ...baseOpts,
      stroke: "none",
      fill,
      fillStyle: "hachure",
      hachureGap: 9,
      fillWeight: 0.55,
    });
    return [...gen.toPaths(drawable), ...gen.toPaths(hatchOverlay)];
  }

  if (el.kind === "frame") {
    const drawable = gen.path(roundedRectPath(0, 0, w, h, 14), {
      ...baseOpts,
      strokeLineDash: [8, 6],
      fillStyle: "solid",
    });
    return gen.toPaths(drawable);
  }

  if (el.kind === "diamond") {
    const drawable = gen.polygon(
      [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ],
      {
        ...baseOpts,
        fillStyle: "solid",
      }
    );
    return gen.toPaths(drawable);
  }

  if (el.kind === "ellipse") {
    const drawable = gen.ellipse(w / 2, h / 2, w, h, {
      ...baseOpts,
      fillStyle: "solid",
    });
    return gen.toPaths(drawable);
  }

  if (el.kind === "database") {
    const ry = Math.min(13, h * 0.18);
    const rx = w / 2;
    const bodyD = [
      `M 0 ${ry}`,
      `A ${rx} ${ry} 0 0 1 ${w} ${ry}`,
      `L ${w} ${h - ry}`,
      `A ${rx} ${ry} 0 0 1 0 ${h - ry}`,
      "Z",
    ].join(" ");
    const body = gen.path(bodyD, { ...baseOpts, fillStyle: "solid" });
    const topRim = gen.ellipse(w / 2, ry, w, ry * 2, {
      ...baseOpts,
      fill: "none",
      roughness: 1.0,
    });
    return [...gen.toPaths(body), ...gen.toPaths(topRim)];
  }

  return [];
}

export function generateArrowPath(
  start: Point,
  control: Point,
  end: Point,
  seed: number,
  stroke: string,
  renderStyle: RenderStyle,
  dashed?: boolean,
  isGhost = false
): PathInfo[] {
  const d = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  if (renderStyle === "clean" || isGhost) {
    return [
      {
        d,
        stroke,
        strokeWidth: isGhost ? 1.5 : 1.35,
        fill: "none",
      },
    ];
  }
  const drawable = gen.path(d, {
    seed,
    roughness: 0.65,
    bowing: 0.55,
    stroke,
    strokeWidth: 1.4,
    strokeLineDash: dashed ? [6, 5] : undefined,
  });
  return gen.toPaths(drawable);
}

export function computeArrowHeadPath(from: Point, to: Point, size = 8.5): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const a1 = angle - Math.PI / 6.2;
  const a2 = angle + Math.PI / 6.2;
  const x1 = to.x - size * Math.cos(a1);
  const y1 = to.y - size * Math.sin(a1);
  const x2 = to.x - size * Math.cos(a2);
  const y2 = to.y - size * Math.sin(a2);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

export function smoothFreedrawPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

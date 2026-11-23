import {
  parseApiCard,
  parseCardBullets,
  parseClassCompartments,
  parseEntityRows,
  type ApiRow,
  type EntityRow,
  type HttpMethod,
} from "./notation-kinds";
import { markdownToPlainLines } from "./markdown";
import type { BoardTheme, ElementKind, JevElement } from "./types";

/** Board paper colour per theme (globals.css --jev-paper); hollow markers and activation bars are filled with it. */
export const BOARD_PAPER: Record<BoardTheme, string> = {
  vellum: "#F7F4ED",
  midnight: "#11151D",
};

export type GlyphTone = "text" | "subtext" | "stroke";

/** One SVG text run, positioned in the shape's local coordinates (y = baseline). */
export interface GlyphText {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  size: number;
  weight: number;
  font: "label" | "mono";
  tone: GlyphTone;
  italic?: boolean;
  underline?: boolean;
}

export interface GlyphBadge {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface ShapeGlyphs {
  texts: GlyphText[];
  badges: GlyphBadge[];
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Old morph ER cards are `node`s with the entity role; they draw as entity tables. */
export function renderKindOf(el: Pick<JevElement, "kind" | "sublabel" | "morphMeta">): ElementKind {
  if (el.kind === "node" && el.morphMeta?.role === "entity" && el.sublabel && el.sublabel.trim()) {
    return "entity";
  }
  return el.kind;
}

const MONO_CHAR = 6.6;

function clip(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

function charsFor(width: number, size: number, mono: boolean): number {
  const per = mono ? (MONO_CHAR * size) / 11 : size * 0.58;
  return Math.max(1, Math.floor(width / per));
}

export function queueCapRadius(w: number): number {
  return Math.min(14, w * 0.1);
}

export function lbInset(w: number): number {
  return Math.min(18, w * 0.16);
}

export function blobRimRadius(h: number): number {
  return Math.min(10, h * 0.12);
}

export const ACTOR_LABEL_HEIGHT = 24;

/** Region for the generic centred label, or null when the kind lays out its own text (or has none). */
export function shapeLabelBox(el: Pick<JevElement, "kind" | "width" | "height" | "sublabel" | "morphMeta">): LabelBox | null {
  const w = el.width;
  const h = el.height;
  switch (renderKindOf(el)) {
    case "diamond":
      return { x: 18, y: 6, width: w - 36, height: h - 12 };
    case "database":
      return { x: 10, y: 16, width: w - 20, height: h - 22 };
    case "queue": {
      const rx = queueCapRadius(w);
      return { x: rx + 6, y: 6, width: w - 2 * rx - 38, height: h - 12 };
    }
    case "cache":
      return { x: 10, y: 6, width: w - 36, height: h - 12 };
    case "lb": {
      const i = lbInset(w);
      return { x: i, y: 4, width: w - 2 * i, height: h - 26 };
    }
    case "blob": {
      const ry = blobRimRadius(h);
      return { x: w * 0.12, y: 2 * ry + 2, width: w * 0.76, height: h - 2 * ry - 10 };
    }
    case "external":
      return { x: 12, y: 8, width: w - 24, height: h - 16 };
    case "actor":
      return { x: -24, y: h - ACTOR_LABEL_HEIGHT, width: w + 48, height: ACTOR_LABEL_HEIGHT };
    case "initial":
    case "final":
    case "activation":
    case "entity":
    case "class":
    case "fragment":
    case "zone":
    case "frame":
    case "api":
    case "card":
    case "markdown":
      return null;
    default:
      return { x: 10, y: 6, width: w - 20, height: h - 12 };
  }
}

export interface EntityLayout {
  rows: EntityRow[];
  headerHeight: number;
  rowHeight: number;
  padTop: number;
  keyColWidth: number;
  visibleRows: number;
  /** Divider under a leading block of primary-key rows, or null. */
  pkDividerY: number | null;
}

const BADGE_STEP = 24;

export function entityLayout(el: Pick<JevElement, "sublabel" | "height">): EntityLayout {
  const headerHeight = 30;
  const rowHeight = 18;
  const padTop = 5;
  const rows = parseEntityRows(el.sublabel);
  const maxKeys = rows.reduce((m, r) => Math.max(m, r.keys.length), 0);
  const keyColWidth = maxKeys > 0 ? 8 + maxKeys * BADGE_STEP : 0;
  const capacity = Math.max(0, Math.floor((el.height - headerHeight - padTop - 4) / rowHeight));
  const visibleRows = rows.length > capacity ? Math.max(0, capacity - 1) : rows.length;
  let leadingPk = 0;
  while (leadingPk < rows.length && rows[leadingPk].keys.includes("PK")) leadingPk++;
  const pkDividerY =
    leadingPk > 0 && leadingPk < visibleRows ? headerHeight + padTop + leadingPk * rowHeight : null;
  return { rows, headerHeight, rowHeight, padTop, keyColWidth, visibleRows, pkDividerY };
}

export interface ClassLayout {
  stereotype: string | null;
  name: string;
  italic: boolean;
  nameHeight: number;
  attrsTop: number;
  opsTop: number;
  rowHeight: number;
  attributes: string[];
  operations: string[];
}

export function classLayout(el: Pick<JevElement, "label" | "sublabel" | "height">): ClassLayout {
  const lines = el.label.split("\n").map((l) => l.trim()).filter(Boolean);
  const st = lines[0]?.match(/^(?:«(.+)»|<<(.+)>>)$/);
  const stereotype = st ? `«${(st[1] ?? st[2]).trim()}»` : null;
  const name = (st ? lines.slice(1) : lines).join(" ");
  const nameHeight = stereotype ? 40 : 30;
  const rowHeight = 16;
  const { attributes, operations } = parseClassCompartments(el.sublabel);
  const attrsTop = nameHeight;
  const attrsHeight = attributes.length > 0 ? 6 + attributes.length * rowHeight : 12;
  const opsTop = Math.min(attrsTop + attrsHeight, Math.max(attrsTop + 6, el.height - 12));
  return {
    stereotype,
    name,
    italic: stereotype === "«abstract»",
    nameHeight,
    attrsTop,
    opsTop,
    rowHeight,
    attributes,
    operations,
  };
}

export interface FragmentLayout {
  operator: string;
  tagWidth: number;
  tagHeight: number;
  operands: Array<{ guard: string; top: number }>;
}

export function fragmentLayout(el: Pick<JevElement, "label" | "sublabel" | "height">): FragmentLayout {
  const operator = el.label.trim() || "alt";
  const tagHeight = 20;
  const tagWidth = Math.max(44, Math.round(operator.length * 7.5 + 22));
  const guards = (el.sublabel ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((g) => (g.startsWith("[") ? g : `[${g}]`));
  const n = Math.max(1, guards.length);
  const operands = Array.from({ length: n }, (_, i) => ({ guard: guards[i] ?? "", top: (i * el.height) / n }));
  return { operator, tagWidth, tagHeight, operands };
}

export interface ApiLayout {
  method: HttpMethod | null;
  path: string;
  rows: ApiRow[];
  headerHeight: number;
  rowHeight: number;
  padTop: number;
  keyColWidth: number;
  visibleRows: number;
  badgeWidth: number;
}

export function apiLayout(el: Pick<JevElement, "label" | "sublabel" | "width" | "height">): ApiLayout {
  const { method, path, rows } = parseApiCard(el.label, el.sublabel);
  const headerHeight = 30;
  const rowHeight = 18;
  const padTop = 5;
  const keyColWidth = Math.min(118, Math.round(el.width * 0.4));
  const capacity = Math.max(0, Math.floor((el.height - headerHeight - padTop - 4) / rowHeight));
  const visibleRows = rows.length > capacity ? Math.max(0, capacity - 1) : rows.length;
  const badgeWidth = method ? Math.round(method.length * 6.4 + 12) : 0;
  return { method, path, rows, headerHeight, rowHeight, padTop, keyColWidth, visibleRows, badgeWidth };
}

function apiGlyphs(el: JevElement): ShapeGlyphs {
  const l = apiLayout(el);
  const w = el.width;
  const texts: GlyphText[] = [];
  const badges: GlyphBadge[] = [];
  let pathX = 10;
  if (l.method) {
    badges.push({ x: 8, y: 8, w: l.badgeWidth, h: 14, text: l.method });
    pathX = 8 + l.badgeWidth + 8;
  }
  texts.push({
    x: pathX,
    y: 19.5,
    text: clip(l.path, charsFor(w - pathX - 8, 12, true)),
    anchor: "start",
    size: 12,
    weight: 700,
    font: "mono",
    tone: "text",
  });
  const valueX = l.keyColWidth + 8;
  l.rows.slice(0, l.visibleRows).forEach((row, i) => {
    const baseline = l.headerHeight + l.padTop + i * l.rowHeight + 13;
    if (row.key === "note") {
      texts.push({ x: 10, y: baseline, text: clip(row.text, charsFor(w - 20, 11, true)), anchor: "start", size: 11, weight: 400, font: "mono", tone: "subtext", italic: true });
      return;
    }
    if (i === 0 || l.rows[i - 1].key !== row.key) {
      texts.push({ x: 10, y: baseline, text: clip(row.title, charsFor(l.keyColWidth - 14, 9.5, false)), anchor: "start", size: 9.5, weight: 600, font: "label", tone: "subtext" });
    }
    texts.push({ x: valueX, y: baseline, text: clip(row.text, charsFor(w - valueX - 8, 11, true)), anchor: "start", size: 11, weight: 500, font: "mono", tone: "text" });
  });
  const hidden = l.rows.length - l.visibleRows;
  if (hidden > 0) {
    texts.push({
      x: valueX,
      y: l.headerHeight + l.padTop + l.visibleRows * l.rowHeight + 13,
      text: `+${hidden} more`,
      anchor: "start",
      size: 10,
      weight: 500,
      font: "mono",
      tone: "subtext",
    });
  }
  return { texts, badges };
}

export interface CardLine {
  text: string;
  bullet: boolean;
}

export interface CardLayout {
  title: string;
  fold: number;
  titleHeight: number;
  top: number;
  rowHeight: number;
  lines: CardLine[];
  visibleLines: number;
  hiddenBullets: number;
}

const CARD_TEXT_X = 24;

function wrapWords(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = word.length > maxChars ? clip(word, maxChars) : word;
  }
  if (line) out.push(line);
  return out;
}

export function cardLayout(el: Pick<JevElement, "label" | "sublabel" | "width" | "height">): CardLayout {
  const title = el.label.split("\n")[0]?.trim() ?? "";
  const fold = Math.round(Math.min(16, el.width * 0.12, el.height * 0.2));
  const titleHeight = title ? 30 : 0;
  const top = title ? titleHeight + 5 : 6;
  const rowHeight = 16;
  const maxChars = charsFor(el.width - CARD_TEXT_X - 10, 11, true);
  const lines = parseCardBullets(el.sublabel).flatMap((b) =>
    wrapWords(b, maxChars).map((text, i) => ({ text, bullet: i === 0 }))
  );
  const capacity = Math.max(0, Math.floor((el.height - top - 4) / rowHeight));
  let visibleLines = lines.length > capacity ? Math.max(0, capacity - 1) : lines.length;
  while (visibleLines > 0 && visibleLines < lines.length && !lines[visibleLines].bullet) visibleLines--;
  const hiddenBullets = lines.slice(visibleLines).filter((l) => l.bullet).length;
  return { title, fold, titleHeight, top, rowHeight, lines, visibleLines, hiddenBullets };
}

function cardGlyphs(el: JevElement): ShapeGlyphs {
  const l = cardLayout(el);
  const texts: GlyphText[] = [];
  if (l.title) {
    texts.push({ x: 12, y: 20, text: clip(l.title, charsFor(el.width - 24 - l.fold, 13, false)), anchor: "start", size: 13, weight: 700, font: "label", tone: "text" });
  }
  l.lines.slice(0, l.visibleLines).forEach((line, i) => {
    const baseline = l.top + i * l.rowHeight + 12;
    if (line.bullet) {
      texts.push({ x: 12, y: baseline, text: "•", anchor: "start", size: 12, weight: 700, font: "label", tone: "stroke" });
    }
    texts.push({ x: CARD_TEXT_X, y: baseline, text: line.text, anchor: "start", size: 11, weight: 500, font: "mono", tone: "text" });
  });
  if (l.hiddenBullets > 0) {
    texts.push({ x: CARD_TEXT_X, y: l.top + l.visibleLines * l.rowHeight + 12, text: `+${l.hiddenBullets} more`, anchor: "start", size: 10, weight: 500, font: "mono", tone: "subtext" });
  }
  return { texts, badges: [] };
}

function entityGlyphs(el: JevElement): ShapeGlyphs {
  const l = entityLayout(el);
  const w = el.width;
  const texts: GlyphText[] = [];
  const badges: GlyphBadge[] = [];
  const title = el.label.split("\n")[0]?.trim() ?? "";
  texts.push({
    x: w / 2,
    y: l.headerHeight / 2 + 4.5,
    text: clip(title, charsFor(w - 16, 13, false)),
    anchor: "middle",
    size: 13,
    weight: 700,
    font: "label",
    tone: "text",
  });
  const nameX = l.keyColWidth > 0 ? l.keyColWidth + 8 : 10;
  const maxChars = charsFor(w - nameX - 10, 11, true);
  l.rows.slice(0, l.visibleRows).forEach((row, i) => {
    const top = l.headerHeight + l.padTop + i * l.rowHeight;
    const baseline = top + 13;
    row.keys.forEach((k, ki) => {
      badges.push({ x: 6 + ki * BADGE_STEP, y: top + 2.5, w: 20, h: 13, text: k });
    });
    let type = row.type;
    let name = row.name;
    if (name.length + 1 + type.length > maxChars) {
      const room = maxChars - name.length - 1;
      type = room >= 3 ? clip(type, room) : "";
      name = clip(name, maxChars);
    }
    texts.push({
      x: nameX,
      y: baseline,
      text: name,
      anchor: "start",
      size: 11,
      weight: row.keys.includes("PK") ? 700 : 500,
      font: "mono",
      tone: "text",
      ...(row.keys.includes("PK") ? { underline: true } : {}),
    });
    if (type) {
      texts.push({ x: w - 10, y: baseline, text: type, anchor: "end", size: 10.5, weight: 400, font: "mono", tone: "subtext" });
    }
  });
  const hidden = l.rows.length - l.visibleRows;
  if (hidden > 0) {
    texts.push({
      x: nameX,
      y: l.headerHeight + l.padTop + l.visibleRows * l.rowHeight + 13,
      text: `+${hidden} more`,
      anchor: "start",
      size: 10,
      weight: 500,
      font: "mono",
      tone: "subtext",
    });
  }
  return { texts, badges };
}

function classGlyphs(el: JevElement): ShapeGlyphs {
  const l = classLayout(el);
  const w = el.width;
  const texts: GlyphText[] = [];
  if (l.stereotype) {
    texts.push({ x: w / 2, y: 15, text: l.stereotype, anchor: "middle", size: 10, weight: 500, font: "label", tone: "subtext" });
  }
  texts.push({
    x: w / 2,
    y: l.stereotype ? 31 : 19.5,
    text: clip(l.name, charsFor(w - 16, 13, false)),
    anchor: "middle",
    size: 13,
    weight: 700,
    font: "label",
    tone: "text",
    ...(l.italic ? { italic: true } : {}),
  });
  const maxChars = charsFor(w - 16, 11, true);
  const rowsInto = (items: string[], top: number, bottom: number) => {
    const fit = Math.max(0, Math.floor((bottom - top - 4) / l.rowHeight));
    const shown = items.length > fit ? [...items.slice(0, Math.max(0, fit - 1)), "…"] : items;
    shown.forEach((text, i) => {
      texts.push({
        x: 8,
        y: top + 3 + i * l.rowHeight + 12,
        text: clip(text, maxChars),
        anchor: "start",
        size: 11,
        weight: 500,
        font: "mono",
        tone: "text",
      });
    });
  };
  rowsInto(l.attributes, l.attrsTop, l.opsTop);
  rowsInto(l.operations, l.opsTop, el.height);
  return { texts, badges: [] };
}

function fragmentGlyphs(el: JevElement): ShapeGlyphs {
  const l = fragmentLayout(el);
  const texts: GlyphText[] = [
    { x: 9, y: 14, text: l.operator, anchor: "start", size: 12, weight: 700, font: "label", tone: "text" },
  ];
  l.operands.forEach((op, i) => {
    if (!op.guard) return;
    const x = i === 0 ? l.tagWidth + 8 : 10;
    texts.push({
      x,
      y: op.top + 14,
      text: clip(op.guard, charsFor(el.width - x - 8, 11, true)),
      anchor: "start",
      size: 11,
      weight: 500,
      font: "mono",
      tone: "subtext",
    });
  });
  return { texts, badges: [] };
}

/** Self-laid-out text for kinds that do not use the generic centred label. */
export function layoutShapeGlyphs(el: JevElement): ShapeGlyphs | null {
  switch (renderKindOf(el)) {
    case "entity":
      return entityGlyphs(el);
    case "class":
      return classGlyphs(el);
    case "fragment":
      return fragmentGlyphs(el);
    case "api":
      return apiGlyphs(el);
    case "card":
      return cardGlyphs(el);
    case "markdown": {
      const texts: GlyphText[] = [];
      const headerH = Math.min(34, Math.max(24, el.height * 0.25));
      const title = el.label.trim();
      if (title) {
        texts.push({
          x: 12,
          y: Math.round(headerH * 0.68),
          text: clip(title, charsFor(el.width - 52, 12, false)),
          anchor: "start",
          size: 12,
          weight: 700,
          font: "label",
          tone: "text",
        });
      }
      const lines = markdownToPlainLines(el.sublabel);
      const rowH = 16;
      const cap = Math.max(0, Math.floor((el.height - headerH - 12) / rowH));
      const maxChars = charsFor(el.width - 24, 11, false);
      lines.slice(0, cap).forEach((line, idx) => {
        texts.push({
          x: 12,
          y: Math.round(headerH + 16 + idx * rowH),
          text: clip(line, maxChars),
          anchor: "start",
          size: 11,
          weight: 500,
          font: "label",
          tone: "subtext",
        });
      });
      return { texts, badges: [] };
    }
    case "zone": {
      const text = el.label.split("\n")[0]?.trim() ?? "";
      return {
        texts: text
          ? [{ x: 12, y: 20, text: clip(text, charsFor(el.width - 24, 12, false)), anchor: "start", size: 12, weight: 600, font: "label", tone: "stroke" }]
          : [],
        badges: [],
      };
    }
    default:
      return null;
  }
}

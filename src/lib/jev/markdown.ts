/**
 * Pure Markdown parser, Notion/rich-HTML -> Markdown paste converter, checkbox toggler,
 * and plain-line flattener (for standalone SVG export). Zero external dependencies,
 * deterministic across Node/Vitest and browsers, and strict protocol allowlisting (no XSS).
 */

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; tokens: InlineToken[] }
  | { type: "italic"; tokens: InlineToken[] }
  | { type: "strike"; tokens: InlineToken[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export interface MarkdownListItem {
  tokens: InlineToken[];
  checked?: boolean;
  lineIndex: number;
  indent: number;
}

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; tokens: InlineToken[] }
  | { type: "paragraph"; tokens: InlineToken[] }
  | { type: "code"; lang: string; code: string }
  | { type: "blockquote"; tokens: InlineToken[] }
  | { type: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { type: "table"; headers: InlineToken[][]; rows: InlineToken[][][] }
  | { type: "hr" };

const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:)/i;

export function isSafeMarkdownHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || /[\u0000-\u001f]/.test(trimmed)) return false;
  return SAFE_LINK_RE.test(trimmed);
}

// ---------------------------------------------------------------------------
// Minimal safe HTML tree parser (handles Notion, Google Docs, GitHub, Slack)
// ---------------------------------------------------------------------------

interface HtmlNode {
  type: "text" | "el";
  text?: string;
  tag?: string;
  attrs?: Record<string, string>;
  children?: HtmlNode[];
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "col", "area", "base", "embed", "source", "wbr"]);
const SKIP_CONTENT_TAGS = new Set(["script", "style", "noscript", "template", "head", "title"]);

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = decodeHtmlEntities(val);
  }
  return attrs;
}

function parseHtmlTree(html: string): HtmlNode {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const root: HtmlNode = { type: "el", tag: "root", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const tokenRe = /<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>|([^<]+)/g;
  let skipDepth = 0;
  let skipTag = "";
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(cleaned)) !== null) {
    const [, closing, rawTag, rawAttrs, rawText] = m;
    if (rawText !== undefined) {
      if (skipDepth === 0) {
        stack[stack.length - 1].children!.push({ type: "text", text: decodeHtmlEntities(rawText) });
      }
      continue;
    }

    const tag = rawTag.toLowerCase();
    const selfClosing = /\/\s*$/.test(rawAttrs) || VOID_TAGS.has(tag);

    if (skipDepth > 0) {
      if (tag === skipTag) {
        if (closing) skipDepth -= 1;
        else if (!selfClosing) skipDepth += 1;
      }
      continue;
    }

    if (!closing && SKIP_CONTENT_TAGS.has(tag)) {
      if (!selfClosing) {
        skipDepth = 1;
        skipTag = tag;
      }
      continue;
    }

    if (closing) {
      for (let i = stack.length - 1; i >= 1; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: HtmlNode = {
      type: "el",
      tag,
      attrs: parseAttrs(rawAttrs.replace(/\/\s*$/, "")),
      children: [],
    };
    stack[stack.length - 1].children!.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root;
}

function rawTextContent(node: HtmlNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.children ?? []).map(rawTextContent).join("");
}

function collapseInlineSpaces(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ");
}

function wrapInline(marker: string, inner: string): string {
  const lead = inner.match(/^\s*/)?.[0] ?? "";
  const trail = inner.match(/\s*$/)?.[0] ?? "";
  const core = inner.trim();
  if (!core) return inner;
  return `${lead}${marker}${core}${marker}${trail}`;
}

function findCheckboxState(node: HtmlNode): boolean | null {
  if (node.type === "el") {
    if (node.tag === "input" && (node.attrs?.type ?? "").toLowerCase() === "checkbox") {
      return Object.prototype.hasOwnProperty.call(node.attrs ?? {}, "checked") && node.attrs?.checked !== "false";
    }
    if (node.attrs?.role === "checkbox" && node.attrs["aria-checked"] !== undefined) {
      return node.attrs["aria-checked"] === "true";
    }
  }
  for (const child of node.children ?? []) {
    if (child.tag === "ul" || child.tag === "ol") continue;
    const found = findCheckboxState(child);
    if (found !== null) return found;
  }
  return null;
}

function renderTable(node: HtmlNode): string {
  const rows: string[][] = [];
  const collectRows = (n: HtmlNode) => {
    if (n.type !== "el") return;
    if (n.tag === "tr") {
      const cells: string[] = [];
      for (const c of n.children ?? []) {
        if (c.type === "el" && (c.tag === "th" || c.tag === "td")) {
          const text = renderChildren(c, { inPre: false, listDepth: 0 }).replace(/\n+/g, " ").trim().replace(/\|/g, "\\|");
          cells.push(text);
        }
      }
      if (cells.length > 0) rows.push(cells);
      return;
    }
    for (const c of n.children ?? []) collectRows(c);
  };
  collectRows(node);
  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const padRow = (r: string[]) => Array.from({ length: colCount }, (_, i) => r[i] ?? "");
  const header = padRow(rows[0]);
  const sep = Array.from({ length: colCount }, () => "---");
  const body = rows.slice(1).map(padRow);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

interface RenderCtx {
  inPre: boolean;
  listDepth: number;
}

function renderList(node: HtmlNode, ordered: boolean, ctx: RenderCtx): string {
  const indent = "  ".repeat(ctx.listDepth);
  let idx = 1;
  const lines: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "el" || child.tag !== "li") continue;
    const checked = findCheckboxState(child);
    const nestedLists: string[] = [];
    const inlineParts: string[] = [];
    for (const grand of child.children ?? []) {
      if (grand.type === "el" && (grand.tag === "ul" || grand.tag === "ol")) {
        nestedLists.push(renderList(grand, grand.tag === "ol", { ...ctx, listDepth: ctx.listDepth + 1 }));
      } else {
        inlineParts.push(renderHtmlNode(grand, ctx));
      }
    }
    const text = inlineParts
      .join("")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\n{2,}/g, "\n");
    const bullet = checked !== null ? `- [${checked ? "x" : " "}] ` : ordered ? `${idx}. ` : "- ";
    idx += 1;
    if (text || checked !== null) {
      lines.push(`${indent}${bullet}${text}`);
    }
    for (const nested of nestedLists) {
      if (nested.trim()) lines.push(nested.replace(/^\n+|\n+$/g, ""));
    }
  }
  const block = lines.join("\n");
  return ctx.listDepth === 0 ? `\n\n${block}\n\n` : `\n${block}`;
}

function renderChildren(node: HtmlNode, ctx: RenderCtx): string {
  return (node.children ?? []).map((c) => renderHtmlNode(c, ctx)).join("");
}

function renderHtmlNode(node: HtmlNode, ctx: RenderCtx): string {
  if (node.type === "text") {
    const raw = node.text ?? "";
    return ctx.inPre ? raw : collapseInlineSpaces(raw);
  }
  const tag = node.tag ?? "";
  const attrs = node.attrs ?? {};

  if (tag === "input" && (attrs.type ?? "").toLowerCase() === "checkbox") return "";
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n\n---\n\n";

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(6, Math.max(1, Number(tag[1])));
    const inner = renderChildren(node, ctx).trim();
    return inner ? `\n\n${"#".repeat(level)} ${inner}\n\n` : "";
  }

  if (tag === "pre") {
    const codeChild = (node.children ?? []).find((c) => c.type === "el" && c.tag === "code");
    const cls = codeChild?.attrs?.class ?? attrs.class ?? "";
    const langMatch = /(?:^|\s)(?:language|lang)-([a-zA-Z0-9_+#-]+)/.exec(cls);
    const lang = langMatch?.[1] ?? "";
    const code = rawTextContent(codeChild ?? node).replace(/^\n+|\n+$/g, "");
    return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  }

  if (tag === "code") {
    if (ctx.inPre) return rawTextContent(node);
    const raw = rawTextContent(node).replace(/\n+/g, " ").trim();
    if (!raw) return "";
    const fence = raw.includes("`") ? "``" : "`";
    return `${fence}${raw}${fence}`;
  }

  if (tag === "strong" || tag === "b") {
    return wrapInline("**", renderChildren(node, ctx));
  }
  if (tag === "em" || tag === "i") {
    return wrapInline("*", renderChildren(node, ctx));
  }
  if (tag === "s" || tag === "del" || tag === "strike") {
    return wrapInline("~~", renderChildren(node, ctx));
  }

  if (tag === "span") {
    let out = renderChildren(node, ctx);
    const style = (attrs.style ?? "").toLowerCase();
    if (/font-weight\s*:\s*(?:bold|[6-9]00)/.test(style)) out = wrapInline("**", out);
    if (/font-style\s*:\s*italic/.test(style)) out = wrapInline("*", out);
    if (/text-decoration[^;]*line-through/.test(style)) out = wrapInline("~~", out);
    return out;
  }

  if (tag === "a") {
    const label = renderChildren(node, ctx).trim();
    const href = (attrs.href ?? "").trim();
    if (!label) return "";
    if (!isSafeMarkdownHref(href)) return label;
    return `[${label}](${href})`;
  }

  if (tag === "blockquote") {
    const inner = renderChildren(node, ctx).trim();
    if (!inner) return "";
    const quoted = inner
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
    return `\n\n${quoted}\n\n`;
  }

  if (tag === "ul") return renderList(node, false, ctx);
  if (tag === "ol") return renderList(node, true, ctx);
  if (tag === "table") return renderTable(node);

  if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "header" || tag === "footer") {
    const checked = (attrs.class ?? "").includes("notion-to_do") ? findCheckboxState(node) : null;
    const inner = renderChildren(node, ctx).trim();
    if (!inner) return "";
    if (checked !== null) return `\n- [${checked ? "x" : " "}] ${inner}\n`;
    return `\n\n${inner}\n\n`;
  }

  return renderChildren(node, ctx);
}

/** Converts rich HTML (Notion, Docs, GitHub, Slack) into clean, safe Markdown. */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  const tree = parseHtmlTree(html);
  const raw = renderChildren(tree, { inPre: false, listDepth: 0 });
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const RICH_HTML_TAG_RE =
  /<(?:h[1-6]|strong|b|em|i|s|del|strike|ul|ol|li|pre|code|blockquote|a|table|hr|input)\b|font-weight\s*:\s*(?:bold|[6-9]00)|font-style\s*:\s*italic/i;

/**
 * Picks the best Markdown representation from a clipboard paste event:
 * converts rich HTML (Notion, Docs, browsers) when semantic formatting tags are present,
 * and preserves plain text when pasting raw Markdown from code editors.
 */
export function resolveClipboardMarkdown(plain: string, html: string): string {
  const normalizedPlain = (plain ?? "").replace(/\r\n?/g, "\n");
  if (!html || !RICH_HTML_TAG_RE.test(html)) {
    return normalizedPlain;
  }
  const converted = htmlToMarkdown(html);
  return converted || normalizedPlain;
}

// ---------------------------------------------------------------------------
// Safe Markdown AST parser (for canvas rendering + SVG plain-line fallback)
// ---------------------------------------------------------------------------

export function parseInlineMarkdown(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;

  const pushText = (s: string) => {
    if (!s) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === "text") last.text += s;
    else tokens.push({ type: "text", text: s });
  };

  while (i < input.length) {
    // Inline code `...`
    if (input[i] === "`") {
      const double = input[i + 1] === "`";
      const delim = double ? "``" : "`";
      const end = input.indexOf(delim, i + delim.length);
      if (end !== -1) {
        tokens.push({ type: "code", text: input.slice(i + delim.length, end) });
        i = end + delim.length;
        continue;
      }
    }

    // Link [text](href)
    if (input[i] === "[") {
      const closeBracket = input.indexOf("]", i + 1);
      if (closeBracket !== -1 && input[closeBracket + 1] === "(") {
        const closeParen = input.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = input.slice(i + 1, closeBracket);
          const href = input.slice(closeBracket + 2, closeParen).trim();
          if (label && isSafeMarkdownHref(href)) {
            tokens.push({ type: "link", text: label, href });
          } else {
            pushText(label || input.slice(i, closeParen + 1));
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold **...** or __...__
    if (input.startsWith("**", i) || input.startsWith("__", i)) {
      const delim = input.slice(i, i + 2);
      const end = input.indexOf(delim, i + 2);
      if (end > i + 2) {
        tokens.push({ type: "bold", tokens: parseInlineMarkdown(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Strikethrough ~~...~~
    if (input.startsWith("~~", i)) {
      const end = input.indexOf("~~", i + 2);
      if (end > i + 2) {
        tokens.push({ type: "strike", tokens: parseInlineMarkdown(input.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Italic *...* (not followed by space)
    if (input[i] === "*" && input[i + 1] !== "*" && input[i + 1] !== " ") {
      const end = input.indexOf("*", i + 1);
      if (end > i + 1 && input[end - 1] !== " ") {
        tokens.push({ type: "italic", tokens: parseInlineMarkdown(input.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    pushText(input[i]);
    i += 1;
  }

  return tokens;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const UNORDERED_ITEM_RE = /^(\s*)[-*•+]\s+(.*)$/;
const ORDERED_ITEM_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const CHECKBOX_PREFIX_RE = /^\[([ xX])\]\s+(.*)$/;

export function parseMarkdownBlocks(md: string): MarkdownBlock[] {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = /^```([a-zA-Z0-9_+#-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Heading
    const headMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headMatch) {
      const level = Math.min(3, headMatch[1].length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, tokens: parseInlineMarkdown(headMatch[2].trim()) });
      i += 1;
      continue;
    }

    // Table (header row + separator row)
    if (trimmed.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headers = splitTableRow(trimmed).map(parseInlineMarkdown);
      i += 2;
      const rows: InlineToken[][][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && !lines[i].trim().startsWith("```")) {
        rows.push(splitTableRow(lines[i]).map(parseInlineMarkdown));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", tokens: parseInlineMarkdown(quoteLines.join(" ")) });
      continue;
    }

    // Unordered or ordered list
    const uMatch = UNORDERED_ITEM_RE.exec(line);
    const oMatch = ORDERED_ITEM_RE.exec(line);
    if (uMatch || oMatch) {
      const ordered = Boolean(oMatch);
      const items: MarkdownListItem[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = ordered ? ORDERED_ITEM_RE.exec(cur) : UNORDERED_ITEM_RE.exec(cur);
        if (!m) break;
        const indent = Math.min(3, Math.floor((m[1]?.length ?? 0) / 2));
        let body = m[2];
        let checked: boolean | undefined;
        if (!ordered) {
          const cb = CHECKBOX_PREFIX_RE.exec(body);
          if (cb) {
            checked = cb[1].toLowerCase() === "x";
            body = cb[2];
          }
        }
        items.push({ tokens: parseInlineMarkdown(body), checked, lineIndex: i, indent });
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: collect contiguous plain lines
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrim = next.trim();
      if (
        !nextTrim ||
        nextTrim.startsWith("```") ||
        /^#{1,6}\s+/.test(nextTrim) ||
        nextTrim.startsWith(">") ||
        /^(?:-{3,}|\*{3,}|_{3,})$/.test(nextTrim) ||
        UNORDERED_ITEM_RE.test(next) ||
        ORDERED_ITEM_RE.test(next) ||
        (nextTrim.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(nextTrim);
      i += 1;
    }
    blocks.push({ type: "paragraph", tokens: parseInlineMarkdown(paraLines.join(" ")) });
  }

  return blocks;
}

/** Toggles a `- [ ]` / `- [x]` checkbox on `lineIndex` (0-based) without touching other lines. */
export function toggleMarkdownCheckbox(md: string, lineIndex: number): string {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return md;
  lines[lineIndex] = lines[lineIndex].replace(/^(\s*[-*•+]\s+)\[([ xX])\](\s+)/, (_, pre, state, sp) => {
    const next = state.toLowerCase() === "x" ? " " : "x";
    return `${pre}[${next}]${sp}`;
  });
  return lines.join("\n");
}

function tokensToPlain(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case "text":
        case "code":
          return t.text;
        case "link":
          return t.text;
        case "bold":
        case "italic":
        case "strike":
          return tokensToPlain(t.tokens);
      }
    })
    .join("");
}

/** Flattens Markdown into crisp plain lines for standalone SVG export. */
export function markdownToPlainLines(md: string | undefined): string[] {
  if (!md) return [];
  const blocks = parseMarkdownBlocks(md);
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
      case "paragraph":
        out.push(tokensToPlain(b.tokens));
        break;
      case "blockquote":
        out.push(`│ ${tokensToPlain(b.tokens)}`);
        break;
      case "code":
        for (const l of b.code.split("\n")) out.push(`  ${l}`);
        break;
      case "list":
        b.items.forEach((item, idx) => {
          const pad = "  ".repeat(item.indent);
          const prefix =
            item.checked !== undefined ? (item.checked ? "[x] " : "[ ] ") : b.ordered ? `${idx + 1}. ` : "• ";
          out.push(`${pad}${prefix}${tokensToPlain(item.tokens)}`);
        });
        break;
      case "table":
        out.push(b.headers.map(tokensToPlain).join(" | "));
        for (const row of b.rows) out.push(row.map(tokensToPlain).join(" | "));
        break;
      case "hr":
        out.push("────────");
        break;
    }
  }
  return out.filter((l) => l.length > 0);
}

/** Suggests a comfortable bounding box when a Markdown node is freshly populated or pasted into. */
export function fitMarkdownNodeSize(
  md: string,
  current: { width: number; height: number }
): { width: number; height: number } {
  const lines = (md ?? "").split("\n");
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const desiredW = Math.max(current.width, Math.min(440, Math.max(300, Math.round(longest * 7.2 + 44))));
  const estLines = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil((l.length * 7.2) / Math.max(200, desiredW - 36))), 0);
  const desiredH = Math.max(current.height, Math.min(480, Math.max(180, estLines * 20 + 64)));
  return { width: desiredW, height: desiredH };
}

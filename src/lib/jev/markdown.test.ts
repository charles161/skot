import { describe, expect, it } from "vitest";
import {
  htmlToMarkdown,
  markdownToPlainLines,
  parseMarkdownBlocks,
  resolveClipboardMarkdown,
  toggleMarkdownCheckbox,
} from "./markdown";
import { jevElementSchema, MAX_MARKDOWN_LENGTH, MAX_SUBLABEL_LENGTH, parseStoredBoardSnapshot } from "./sync-validation";
import type { JevElement } from "./types";

describe("htmlToMarkdown — Notion & rich-text paste", () => {
  it("converts Notion-style headings, emphasis, links, code, lists, and checkboxes", () => {
    const html = `
      <div>
        <h1>API Launch Checklist</h1>
        <p>Ship <strong>payments</strong> with <em>idempotency</em> and <code>Idempotency-Key</code>. See <a href="https://docs.example.com/pay">spec</a>.</p>
        <ul>
          <li><input type="checkbox" checked /> Wire webhook verification</li>
          <li><input type="checkbox" /> Run load test</li>
        </ul>
        <pre><code class="language-ts">const ok = verify(sig);</code></pre>
        <blockquote><p>Never double-charge on retry.</p></blockquote>
      </div>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("# API Launch Checklist");
    expect(md).toContain("Ship **payments** with *idempotency* and `Idempotency-Key`. See [spec](https://docs.example.com/pay).");
    expect(md).toContain("- [x] Wire webhook verification");
    expect(md).toContain("- [ ] Run load test");
    expect(md).toContain("```ts\nconst ok = verify(sig);\n```");
    expect(md).toContain("> Never double-charge on retry.");
  });

  it("converts HTML tables into GFM pipe tables", () => {
    const html = `
      <table>
        <thead><tr><th>Service</th><th>p99</th></tr></thead>
        <tbody>
          <tr><td>Gateway</td><td>18ms</td></tr>
          <tr><td>Ledger</td><td>42ms</td></tr>
        </tbody>
      </table>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("| Service | p99 |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Gateway | 18ms |");
    expect(md).toContain("| Ledger | 42ms |");
  });

  it("strips script tags and rejects unsafe javascript: link protocols", () => {
    const html = `<p><script>alert(1)</script><a href="javascript:alert(1)">click me</a> and <a href="https://safe.dev">safe</a></p>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("alert(1)");
    expect(md).not.toContain("javascript:");
    expect(md).toContain("click me");
    expect(md).toContain("[safe](https://safe.dev)");
  });
});

describe("resolveClipboardMarkdown", () => {
  it("uses HTML conversion when Notion provides rich HTML formatting", () => {
    const html = `<h2>Spec</h2><p>Keep <strong>latency</strong> low</p>`;
    const plain = "Spec\nKeep latency low";
    expect(resolveClipboardMarkdown(plain, html)).toBe("## Spec\n\nKeep **latency** low");
  });

  it("keeps plain text when copied from a code editor without semantic HTML tags", () => {
    const html = `<div style="font-family: monospace"><span># Heading</span><br><span>**bold**</span></div>`;
    const plain = "# Heading\n**bold**";
    expect(resolveClipboardMarkdown(plain, html)).toBe(plain);
  });
});

describe("parseMarkdownBlocks & checkbox toggling", () => {
  it("parses headings, inline formatting, lists, code, quotes, tables, and safe links only", () => {
    const md = [
      "# Overview",
      "",
      "Check **bold**, *italic*, ~~old~~, `code`, [ok](https://skot.app), and [bad](javascript:alert(1)).",
      "",
      "- [ ] First task",
      "- [x] Second task",
      "",
      "```sql",
      "SELECT 1;",
      "```",
      "",
      "| Col | Val |",
      "| --- | --- |",
      "| A | 1 |",
    ].join("\n");

    const blocks = parseMarkdownBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "code", "table"]);
    const para = blocks[1];
    expect(para.type).toBe("paragraph");
    if (para.type === "paragraph") {
      const links = para.tokens.filter((t) => t.type === "link");
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ type: "link", href: "https://skot.app", text: "ok" });
    }
    const list = blocks[2];
    expect(list.type).toBe("list");
    if (list.type === "list") {
      expect(list.items[0]).toMatchObject({ checked: false, lineIndex: 4 });
      expect(list.items[1]).toMatchObject({ checked: true, lineIndex: 5 });
    }
  });

  it("toggles checkboxes at the exact line without altering other lines", () => {
    const md = "- [ ] Alpha\n- [x] Beta\n- [ ] Gamma";
    expect(toggleMarkdownCheckbox(md, 0)).toBe("- [x] Alpha\n- [x] Beta\n- [ ] Gamma");
    expect(toggleMarkdownCheckbox(md, 1)).toBe("- [ ] Alpha\n- [ ] Beta\n- [ ] Gamma");
  });

  it("flattens markdown cleanly for SVG export", () => {
    const lines = markdownToPlainLines("# Title\n- [x] Done\nUse **TLS** & `mTLS`");
    expect(lines).toEqual(["Title", "[x] Done", "Use TLS & mTLS"]);
  });
});

describe("markdown element persistence & validation", () => {
  const baseEl: JevElement = {
    id: "md_1",
    kind: "markdown",
    x: 100,
    y: 100,
    width: 340,
    height: 240,
    label: "PRD Notes",
    sublabel: "# Architecture\n\n" + "a".repeat(2500),
    tone: "ink",
    seed: 7,
    createdAt: 10,
    updatedAt: 20,
  };

  it("accepts long markdown notes up to MAX_MARKDOWN_LENGTH while keeping MAX_SUBLABEL_LENGTH for regular shapes", () => {
    expect(MAX_MARKDOWN_LENGTH).toBeGreaterThanOrEqual(16000);
    expect(jevElementSchema.safeParse(baseEl).success).toBe(true);
    const parsed = parseStoredBoardSnapshot(JSON.stringify({ elements: [baseEl], boardTitle: "Docs" }));
    expect(parsed?.elements[0]?.sublabel?.length).toBe(baseEl.sublabel?.length);

    const tooLongNode = { ...baseEl, kind: "node" as const, sublabel: "x".repeat(MAX_SUBLABEL_LENGTH + 1) };
    expect(jevElementSchema.safeParse(tooLongNode).success).toBe(false);
  });
});

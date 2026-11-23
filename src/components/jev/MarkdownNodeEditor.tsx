"use client";

import React, { useMemo, useRef, useState } from "react";
import { parseMarkdownBlocks, resolveClipboardMarkdown } from "@/lib/jev/markdown";
import type { TonePalette } from "@/lib/jev/colors";
import type { BoardTheme, JevElement, Viewport } from "@/lib/jev/types";
import { MarkdownNodeView } from "./MarkdownNodeView";

interface MarkdownNodeEditorProps {
  element: JevElement;
  viewport: Viewport;
  palette: TonePalette;
  theme: BoardTheme;
  initialTitle: string;
  initialBody: string;
  onRegisterCommit?: (fn: (() => void) | null) => void;
  onCommit: (next: { label: string; sublabel: string }) => void;
  onCancel: () => void;
}

export function MarkdownNodeEditor({
  element,
  viewport,
  palette,
  theme,
  initialTitle,
  initialBody,
  onRegisterCommit,
  onCommit,
  onCancel,
}: MarkdownNodeEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [pasteNotice, setPasteNotice] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closedRef = useRef(false);

  const commitNow = (nextTitle = title, nextBody = body) => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCommit({ label: nextTitle.trim() || "Markdown Note", sublabel: nextBody });
  };

  React.useEffect(() => {
    if (!onRegisterCommit) return;
    onRegisterCommit(() => commitNow(title, body));
    return () => {
      onRegisterCommit(null);
    };
  });

  const cancelNow = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCancel();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    const plain = e.clipboardData.getData("text/plain");
    if (!html) return; // let browser handle normal plain-text paste natively
    const resolved = resolveClipboardMarkdown(plain, html);
    if (!resolved || resolved === plain) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const updated = body.slice(0, start) + resolved + body.slice(end);
    setBody(updated);
    setPasteNotice(true);
    window.setTimeout(() => setPasteNotice(false), 2400);
    // Auto-fill title from first heading if user hasn't renamed the default note yet
    if (!title.trim() || title.trim() === "Markdown Note") {
      const heading = /^#\s+(.+)$/m.exec(resolved)?.[1]?.trim();
      if (heading) setTitle(heading.slice(0, 80));
    }
    requestAnimationFrame(() => {
      const caret = start + resolved.length;
      ta.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancelNow();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commitNow();
      return;
    }
    if (e.key === "Tab" && e.target === textareaRef.current) {
      e.preventDefault();
      const ta = textareaRef.current!;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const updated = `${body.slice(0, start)}  ${body.slice(end)}`;
      setBody(updated);
      requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2));
    }
  };

  const previewElement = useMemo<JevElement>(
    () => ({ ...element, label: title || "Markdown Note", sublabel: body }),
    [element, title, body]
  );

  const width = Math.max(340, Math.min(520, element.width * viewport.zoom));
  const minHeight = Math.max(240, Math.min(480, element.height * viewport.zoom));
  const rawLeft = viewport.x + element.x * viewport.zoom;
  const rawTop = viewport.y + element.y * viewport.zoom;
  const maxLeft = typeof window !== "undefined" ? Math.max(12, window.innerWidth - width - 12) : rawLeft;
  const maxTop = typeof window !== "undefined" ? Math.max(68, window.innerHeight - minHeight - 24) : rawTop;
  const left = Math.max(12, Math.min(rawLeft, maxLeft));
  const top = Math.max(68, Math.min(rawTop, maxTop));
  const blockCount = useMemo(() => parseMarkdownBlocks(body).length, [body]);

  return (
    <div
      ref={containerRef}
      data-testid="markdown-editor"
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const nextFocus = e.relatedTarget as Node | null;
        if (!nextFocus || !containerRef.current?.contains(nextFocus)) {
          commitNow();
        }
      }}
      onKeyDown={handleKeyDown}
      style={{ left, top, width }}
      className="jev-glass absolute z-30 flex flex-col overflow-hidden rounded-2xl border border-[#D94E28]/50 bg-card/98 shadow-[0_18px_48px_-14px_rgba(15,23,42,0.42)]"
    >
      {/* Header: Title + Edit/Preview + Done */}
      <div className="flex items-center gap-1.5 border-b border-border/80 px-2.5 py-1.5">
        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
          MD
        </span>
        <input
          type="text"
          aria-label="Markdown note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title"
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-semibold text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex shrink-0 items-center rounded-lg bg-secondary/80 p-0.5 text-[10.5px] font-semibold">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={`rounded-md px-2 py-0.5 transition-colors ${
              tab === "edit" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`rounded-md px-2 py-0.5 transition-colors ${
              tab === "preview" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Preview
          </button>
        </div>
        <button
          type="button"
          onClick={() => commitNow()}
          className="shrink-0 rounded-lg bg-[#D94E28] px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#C0411E]"
        >
          Done
        </button>
      </div>

      {/* Body: Editor or Live Preview */}
      {tab === "edit" ? (
        <textarea
          ref={textareaRef}
          autoFocus
          aria-label="Markdown content"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={handlePaste}
          placeholder={"Paste from Notion or write Markdown…\n\n# Heading\n**bold** · *italic* · `code`\n- [ ] Task item"}
          style={{ minHeight: `${Math.max(168, minHeight - 76)}px` }}
          className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12px] leading-[1.55] text-foreground caret-[#D94E28] outline-none placeholder:text-muted-foreground/60"
        />
      ) : (
        <div style={{ height: `${Math.max(180, minHeight - 76)}px` }} className="overflow-y-auto">
          <MarkdownNodeView
            element={previewElement}
            palette={palette}
            theme={theme}
            isSelected={false}
            onToggleCheckbox={() => {}}
            onRequestEdit={() => setTab("edit")}
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border/70 bg-secondary/40 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
        <span className="truncate">
          {pasteNotice
            ? "✓ Pasted with Notion/HTML formatting"
            : "Paste from Notion keeps headings, lists, links & tasks"}
        </span>
        <span className="shrink-0">
          {blockCount > 0 ? `${blockCount} blocks · ` : ""}⌘↵ Save · Esc
        </span>
      </div>
    </div>
  );
}

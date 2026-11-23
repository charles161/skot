"use client";

import React, { useMemo } from "react";
import { parseMarkdownBlocks, type InlineToken, type MarkdownBlock } from "@/lib/jev/markdown";
import type { TonePalette } from "@/lib/jev/colors";
import type { BoardTheme, JevElement } from "@/lib/jev/types";

interface MarkdownNodeViewProps {
  element: JevElement;
  palette: TonePalette;
  theme: BoardTheme;
  isSelected: boolean;
  onToggleCheckbox: (lineIndex: number) => void;
  onRequestEdit: () => void;
}

function renderTokens(tokens: InlineToken[], accent: string): React.ReactNode {
  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case "text":
        return <React.Fragment key={idx}>{tok.text}</React.Fragment>;
      case "bold":
        return (
          <strong key={idx} className="font-semibold">
            {renderTokens(tok.tokens, accent)}
          </strong>
        );
      case "italic":
        return (
          <em key={idx} className="italic">
            {renderTokens(tok.tokens, accent)}
          </em>
        );
      case "strike":
        return (
          <del key={idx} className="line-through opacity-70">
            {renderTokens(tok.tokens, accent)}
          </del>
        );
      case "code":
        return (
          <code
            key={idx}
            className="rounded px-1 py-0.5 font-mono text-[10.5px]"
            style={{ backgroundColor: "rgba(127, 127, 127, 0.16)" }}
          >
            {tok.text}
          </code>
        );
      case "link":
        return (
          <a
            key={idx}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="underline decoration-current/60 underline-offset-2 hover:decoration-current"
            style={{ color: accent }}
          >
            {tok.text}
          </a>
        );
    }
  });
}

function renderBlock(
  block: MarkdownBlock,
  idx: number,
  opts: {
    textColor: string;
    subtextColor: string;
    accentColor: string;
    codeBg: string;
    borderColor: string;
    onToggleCheckbox: (lineIndex: number) => void;
  }
): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const cls =
        block.level === 1
          ? "text-[14.5px] font-bold leading-snug tracking-[-0.015em]"
          : block.level === 2
            ? "text-[13px] font-bold leading-snug tracking-[-0.01em]"
            : "text-[12px] font-semibold leading-snug";
      return (
        <div key={idx} className={cls} style={{ color: opts.textColor }}>
          {renderTokens(block.tokens, opts.accentColor)}
        </div>
      );
    }
    case "paragraph":
      return (
        <p key={idx} className="text-[11.5px] leading-[1.48] break-words" style={{ color: opts.textColor }}>
          {renderTokens(block.tokens, opts.accentColor)}
        </p>
      );
    case "blockquote":
      return (
        <blockquote
          key={idx}
          className="border-l-2 pl-2.5 text-[11.5px] italic leading-[1.45]"
          style={{ borderColor: opts.accentColor, color: opts.subtextColor }}
        >
          {renderTokens(block.tokens, opts.accentColor)}
        </blockquote>
      );
    case "code":
      return (
        <div
          key={idx}
          className="overflow-x-auto rounded-lg border px-2 py-1.5 font-mono text-[10.5px] leading-[1.45]"
          style={{ backgroundColor: opts.codeBg, borderColor: opts.borderColor, color: opts.textColor }}
        >
          {block.lang && (
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider opacity-60">{block.lang}</div>
          )}
          <pre className="m-0 whitespace-pre-wrap break-words">{block.code}</pre>
        </div>
      );
    case "list":
      return (
        <ul key={idx} className="flex flex-col gap-0.5 text-[11.5px] leading-[1.45]" style={{ color: opts.textColor }}>
          {block.items.map((item, itemIdx) => (
            <li
              key={itemIdx}
              className="flex items-start gap-1.5"
              style={{ paddingLeft: `${item.indent * 12}px` }}
            >
              {item.checked !== undefined ? (
                <button
                  type="button"
                  aria-label={item.checked ? "Mark task incomplete" : "Mark task complete"}
                  aria-pressed={item.checked}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    opts.onToggleCheckbox(item.lineIndex);
                  }}
                  className="mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px] font-bold transition-colors"
                  style={{
                    borderColor: item.checked ? opts.accentColor : opts.subtextColor,
                    backgroundColor: item.checked ? opts.accentColor : "transparent",
                    color: item.checked ? "#ffffff" : "transparent",
                  }}
                >
                  ✓
                </button>
              ) : (
                <span className="shrink-0 select-none opacity-65" style={{ minWidth: block.ordered ? "14px" : "8px" }}>
                  {block.ordered ? `${itemIdx + 1}.` : "•"}
                </span>
              )}
              <span className={item.checked ? "line-through opacity-65 break-words min-w-0" : "break-words min-w-0"}>
                {renderTokens(item.tokens, opts.accentColor)}
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div
          key={idx}
          className="overflow-x-auto rounded-md border text-[10.5px]"
          style={{ borderColor: opts.borderColor }}
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr style={{ backgroundColor: opts.codeBg }}>
                {block.headers.map((cell, ci) => (
                  <th
                    key={ci}
                    className="border-b px-1.5 py-1 font-semibold"
                    style={{ borderColor: opts.borderColor, color: opts.textColor }}
                  >
                    {renderTokens(cell, opts.accentColor)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="border-t px-1.5 py-1"
                      style={{ borderColor: opts.borderColor, color: opts.textColor }}
                    >
                      {renderTokens(cell, opts.accentColor)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={idx} className="my-1 border-0 border-t" style={{ borderColor: opts.borderColor }} />;
  }
}

export function MarkdownNodeView({
  element,
  palette,
  theme,
  isSelected,
  onToggleCheckbox,
  onRequestEdit,
}: MarkdownNodeViewProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(element.sublabel ?? ""), [element.sublabel]);
  const headerH = Math.min(34, Math.max(24, element.height * 0.25));
  const isDark = theme === "midnight";
  const accentColor = isDark ? "#FF8562" : "#C2411D";
  const codeBg = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.045)";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(15, 23, 42, 0.14)";

  return (
    <div
      data-testid={`markdown-node-${element.id}`}
      className="flex h-full w-full flex-col overflow-hidden text-left select-none"
    >
      {/* Header strip */}
      <div
        className="flex shrink-0 items-center justify-between gap-1.5 px-3"
        style={{ height: `${headerH}px` }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="shrink-0 rounded px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: codeBg, color: palette.subtext }}
          >
            MD
          </span>
          <span
            className="truncate text-[12px] font-bold tracking-[-0.01em]"
            style={{ color: palette.text }}
          >
            {element.label || "Markdown Note"}
          </span>
        </div>
        {isSelected && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequestEdit();
            }}
            className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9.5px] font-semibold transition-opacity hover:opacity-100 opacity-80"
            style={{ backgroundColor: codeBg, color: accentColor }}
          >
            Edit
          </button>
        )}
      </div>

      {/* Rendered Markdown body */}
      <div
        data-markdown-scroll={isSelected ? "1" : undefined}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2"
      >
        {blocks.length === 0 ? (
          <p className="text-[11px] italic opacity-60" style={{ color: palette.subtext }}>
            Double-click to write Markdown or paste from Notion…
          </p>
        ) : (
          blocks.map((block, idx) =>
            renderBlock(block, idx, {
              textColor: palette.text,
              subtextColor: palette.subtext,
              accentColor,
              codeBg,
              borderColor,
              onToggleCheckbox,
            })
          )
        )}
      </div>
    </div>
  );
}

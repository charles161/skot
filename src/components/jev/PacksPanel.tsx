"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  IconActor,
  IconBox,
  IconClose,
  IconDatabase,
  IconDiamond,
  IconFrame,
  IconMarkdown,
  IconPacks,
  IconPlus,
  IconText,
  type IconComponent,
} from "@/brand/icons";
import { KIND_LABELS } from "@/lib/jev/notation-kinds";
import { PACKS, type PackId, type PackItem, type PaletteCommand } from "@/lib/jev/notation-packs";
import type { Point, ShapeKind } from "@/lib/jev/types";
import { MORE_SHAPE_ICONS } from "./MoreShapesMenu";

export const PACK_ITEM_ICONS: Record<ShapeKind, IconComponent> = {
  ...MORE_SHAPE_ICONS,
  node: IconBox,
  diamond: IconDiamond,
  database: IconDatabase,
  ellipse: IconActor,
  frame: IconFrame,
  text: IconText,
  markdown: IconMarkdown,
};

const DRAG_THRESHOLD = 6;

interface PacksPanelProps {
  pack: PackId;
  onPackChange: (pack: PackId) => void;
  onClose: () => void;
  /** Click places at the view centre (screen = null); a drag drops the shape where it is released on the canvas. */
  onPlace: (item: PackItem, screen: Point | null) => void;
  onStarter: (command: PaletteCommand) => void;
}

function overCanvas(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  return Boolean(el?.closest("[role=application]"));
}

/** Browsing fallback for notation packs: a closable side panel; each pack lists its shapes and a starter. */
export function PacksPanel({ pack, onPackChange, onClose, onPlace, onStarter }: PacksPanelProps) {
  const active = PACKS.find((p) => p.id === pack) ?? PACKS[0];
  const press = useRef<{ item: PackItem; x: number; y: number; dragging: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ item: PackItem; x: number; y: number } | null>(null);

  const onItemPointerDown = (item: PackItem) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { item, x: e.clientX, y: e.clientY, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onItemPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.dragging = true;
    setGhost({ item: p.item, x: e.clientX, y: e.clientY });
  };
  const onItemPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    setGhost(null);
    if (!p) return;
    if (!p.dragging) onPlace(p.item, null);
    else if (overCanvas(e.clientX, e.clientY)) onPlace(p.item, { x: e.clientX, y: e.clientY });
  };
  const onItemKeyDown = (item: PackItem) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPlace(item, null);
    }
  };

  const GhostIcon = ghost ? PACK_ITEM_ICONS[ghost.item.kind] : null;

  return (
    <>
      <aside
        aria-label="Notation packs"
        onPointerDown={(e) => e.stopPropagation()}
        className="pointer-events-auto fixed right-3 top-[118px] border border-border bg-card z-30 flex max-h-[calc(100dvh-300px)] min-h-[220px] w-[min(304px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl shadow-[0_18px_44px_-16px_rgba(15,23,42,0.34)] sm:right-4 sm:top-[76px] sm:max-h-[calc(100dvh-240px)]"
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <IconPacks className="h-4 w-4 shrink-0 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
          <h2 className="flex-1 text-[12.5px] font-semibold text-foreground">Packs</h2>
          <button
            type="button"
            aria-label="Close packs"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:w-7"
          >
            <IconClose className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div role="tablist" aria-label="Pack" className="grid grid-cols-3 gap-1 px-2 pt-2">
          {PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === active.id}
              onClick={() => onPackChange(p.id)}
              className={`min-h-9 rounded-lg px-2 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 ${
                p.id === active.id
                  ? "bg-[#1C2028] text-[#F8F6F1] dark:bg-[#F1EDE4] dark:text-[#11151D]"
                  : "text-foreground/80 hover:bg-secondary hover:text-foreground"
              }`}
            >
              {p.title}
            </button>
          ))}
        </div>

        <div role="tabpanel" aria-label={`${active.title} pack`} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          <p className="px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Click to add · drag onto the canvas
          </p>
          <div className="grid grid-cols-2 gap-1">
            {active.items.map((item) => {
              const Icon = PACK_ITEM_ICONS[item.kind];
              const name = item.label ?? KIND_LABELS[item.kind];
              return (
                <button
                  key={`${item.kind}-${name}`}
                  type="button"
                  aria-label={`Add ${name}`}
                  onPointerDown={onItemPointerDown(item)}
                  onPointerMove={onItemPointerMove}
                  onPointerUp={onItemPointerUp}
                  onPointerCancel={() => {
                    press.current = null;
                    setGhost(null);
                  }}
                  onKeyDown={onItemKeyDown(item)}
                  className="flex min-h-10 touch-none select-none items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5 text-left text-[11.5px] leading-tight text-foreground/90 transition-colors hover:border-[#D94E28]/45 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{name}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onStarter(active.starter)}
            className="mt-auto flex min-h-10 items-center gap-2 rounded-xl bg-[#D94E28] px-3 py-2 text-left text-white shadow-xs transition-colors hover:bg-[#C1411E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
          >
            <IconPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold">{active.starterLabel}</span>
              <span className="block font-mono text-[10px] opacity-85">/{active.starter}</span>
            </span>
          </button>
        </div>
      </aside>

      {ghost && GhostIcon && (
        <div
          aria-hidden="true"
          style={{ transform: `translate3d(${ghost.x + 10}px, ${ghost.y + 10}px, 0)` }}
          className="jev-glass pointer-events-none fixed left-0 top-0 z-50 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-foreground shadow-md"
        >
          <GhostIcon className="h-3.5 w-3.5" />
          {ghost.item.label ?? KIND_LABELS[ghost.item.kind]}
        </div>
      )}
    </>
  );
}

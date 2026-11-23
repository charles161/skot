"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconActor, IconArrowLeftRight, IconBox, IconCopy, IconDatabase, IconDiamond, IconEdit, IconFork, IconShapes, IconTrash } from "@/brand/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { arrowEndPatch, bidirectionalTogglePatch, isBidirectional } from "@/lib/jev/arrow-end-options";
import { ALL_TONES, getTonePalette } from "@/lib/jev/colors";
import type { EditField } from "@/lib/jev/inline-edit";
import { KIND_LABELS, isLldKind, resolveArrowEnds } from "@/lib/jev/notation-kinds";
import { computeSmartPopoverPlacement } from "@/lib/jev/popover-placement";
import { isMoreShapeKind } from "@/lib/jev/shape-tools";
import {
  BoardTheme,
  ColorTone,
  ElementKind,
  JevElement,
  MorphNotation,
  Viewport,
} from "@/lib/jev/types";
import { ArrowEndPicker } from "./ArrowEndPicker";
import { KIND_SWAP_GROUPS, MORE_SHAPE_ICONS, MoreShapesPanel } from "./MoreShapesMenu";
import { NotationMorphBar } from "./NotationMorphBar";

interface SelectionInspectorProps {
  element: JevElement | null;
  allElements: JevElement[];
  ghostElements: JevElement[];
  viewport: Viewport;
  theme: BoardTheme;
  hasPredictionHud: boolean;
  hiddenWhileInteracting?: boolean;
  activeNotation?: MorphNotation;
  isMorphedGroup?: boolean;
  morphEvaluating?: boolean;
  morphIsHeuristic?: boolean;
  onPatch: (id: string, patch: Partial<JevElement>) => void;
  onStartInlineEdit: (id: string, field?: EditField) => void;
  onFork?: () => void;
  onMorphNotation?: (notation: MorphNotation) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

const SHAPE_KINDS: Array<{
  kind: ElementKind;
  label: string;
  icon: React.ReactNode;
}> = [
  { kind: "node", label: "Box", icon: <IconBox className="h-3 w-3" /> },
  { kind: "diamond", label: "Decision", icon: <IconDiamond className="h-3 w-3" /> },
  { kind: "database", label: "Store", icon: <IconDatabase className="h-3 w-3" /> },
  { kind: "ellipse", label: "Actor", icon: <IconActor className="h-3 w-3" /> },
];

const SWAPPABLE_KINDS = new Set<ElementKind>([
  ...SHAPE_KINDS.map((sk) => sk.kind),
  ...KIND_SWAP_GROUPS.flatMap((g) => g.kinds),
]);

/** Shapes with no text: activation bars and state pseudo-states. */
const UNLABELLED_KINDS = new Set<ElementKind>(["activation", "initial", "final"]);

const ROWS_EDIT: Partial<Record<ElementKind, { label: string; short: string }>> = {
  entity: { label: "Edit rows", short: "Rows" },
  class: { label: "Edit members", short: "Members" },
  fragment: { label: "Edit guards", short: "Guards" },
  api: { label: "Edit request, response, errors", short: "Rows" },
  card: { label: "Edit bullets", short: "Bullets" },
};

function KindSwapMore({ element, onPatch }: { element: JevElement; onPatch: SelectionInspectorProps["onPatch"] }) {
  const [open, setOpen] = useState(false);
  const current = isMoreShapeKind(element.kind) ? element.kind : null;
  const TriggerIcon = current ? MORE_SHAPE_ICONS[current] : IconShapes;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="More shape types"
            aria-pressed={Boolean(current)}
            title={current ? KIND_LABELS[current] : "More shape types"}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6 ${
              current
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          />
        }
      >
        <TriggerIcon className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent side="bottom" sideOffset={8} className="w-[22rem] max-w-[calc(100vw-24px)] rounded-2xl p-2">
        <MoreShapesPanel
          groups={KIND_SWAP_GROUPS}
          activeKind={element.kind}
          onPick={(kind) => {
            onPatch(element.id, { kind });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function SelectionInspector({
  element,
  allElements,
  ghostElements,
  viewport,
  theme,
  hasPredictionHud,
  hiddenWhileInteracting = false,
  activeNotation = "sketch",
  isMorphedGroup = false,
  morphEvaluating = false,
  morphIsHeuristic = true,
  onPatch,
  onStartInlineEdit,
  onFork,
  onMorphNotation,
  onDuplicate,
  onDelete,
}: SelectionInspectorProps) {
  const pillRef = useRef<HTMLDivElement | null>(null);
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pillSize, setPillSize] = useState({ width: 296, height: 36 });
  const [screenSize, setScreenSize] = useState({ width: 1280, height: 800 });

  useEffect(() => {
    const syncScreen = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    syncScreen();
    window.addEventListener("resize", syncScreen);
    return () => window.removeEventListener("resize", syncScreen);
  }, []);

  useLayoutEffect(() => {
    const node = pillRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setPillSize((prev) =>
          Math.abs(prev.width - rect.width) > 2 ||
          Math.abs(prev.height - rect.height) > 2
            ? { width: Math.round(rect.width), height: Math.round(rect.height) }
            : prev
        );
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [element?.id, element?.kind]);

  const placement = useMemo(() => {
    if (!element) return null;
    return computeSmartPopoverPlacement({
      element,
      allElements,
      ghostElements,
      viewport,
      screenWidth: screenSize.width,
      screenHeight: screenSize.height,
      popoverWidth: pillSize.width,
      popoverHeight: pillSize.height,
      hasPredictionHud,
    });
  }, [
    element,
    allElements,
    ghostElements,
    viewport,
    screenSize.width,
    screenSize.height,
    pillSize.width,
    pillSize.height,
    hasPredictionHud,
  ]);

  if (!element || !placement || hiddenWhileInteracting) return null;

  const isShape = SWAPPABLE_KINDS.has(element.kind);
  const forkable = isShape && !isLldKind(element.kind) && element.kind !== "card" && element.kind !== "markdown";
  const arrowEnds = element.kind === "arrow" ? resolveArrowEnds(element) : null;
  const rowsEdit = ROWS_EDIT[element.kind];

  const handleSwatchKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number
  ) => {
    if (
      e.key === "ArrowRight" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowUp"
    ) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const nextIdx = (idx + delta + ALL_TONES.length) % ALL_TONES.length;
      const nextTone = ALL_TONES[nextIdx];
      onPatch(element.id, { tone: nextTone });
      swatchRefs.current[nextIdx]?.focus();
    }
  };

  const safeY =
    screenSize.width < 640 ? Math.max(118, placement.y) : placement.y;

  return (
    <div
      ref={pillRef}
      role="toolbar"
      aria-label="Selected element controls"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        transform: `translate3d(${placement.x}px, ${safeY}px, 0)`,
      }}
      className="fixed left-0 top-0 z-30 flex max-w-[calc(100vw-28px)] flex-wrap items-center gap-1 rounded-2xl border border-border/90 bg-card/95 px-2 py-1 shadow-[0_8px_24px_-10px_rgba(15,23,42,0.28)] backdrop-blur-md transition-transform duration-150 ease-out"
    >
      {/* Keyboard-navigable color dots (← / → arrows) */}
      <div
        role="radiogroup"
        aria-label="Color (use Left and Right arrow keys)"
        className="flex items-center gap-0.5 pr-0.5 sm:gap-1"
      >
        {ALL_TONES.map((tone: ColorTone, idx) => {
          const palette = getTonePalette(tone, theme);
          const swatch = palette.stroke;
          const active = element.tone === tone;
          return (
            <button
              key={tone}
              ref={(node) => {
                swatchRefs.current[idx] = node;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Color: ${palette.label}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onPatch(element.id, { tone })}
              onKeyDown={(e) => handleSwatchKeyDown(e, idx)}
              title={`${palette.label} (← / → keys)`}
              className="flex h-7 w-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5 sm:w-5"
            >
              <span
                className={`h-4 w-4 rounded-full transition-transform hover:scale-115 ${
                  active
                    ? "scale-110 ring-2 ring-ring ring-offset-1 ring-offset-card"
                    : "opacity-85 hover:opacity-100"
                }`}
                style={{ backgroundColor: swatch }}
              />
            </button>
          );
        })}
      </div>

      {/* Shape kind icons (no clipped text!) */}
      {isShape && (
        <>
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          <div className="flex items-center gap-0.5" role="group" aria-label="Shape type">
            {SHAPE_KINDS.map((sk) => {
              const active = element.kind === sk.kind;
              return (
                <button
                  key={sk.kind}
                  type="button"
                  aria-label={`Shape: ${sk.label}`}
                  aria-pressed={active}
                  onClick={() => onPatch(element.id, { kind: sk.kind })}
                  title={sk.label}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6 ${
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {sk.icon}
                </button>
              );
            })}
            <KindSwapMore element={element} onPatch={onPatch} />
          </div>
        </>
      )}

      {/* Arrow quick toggles */}
      {element.kind === "arrow" && (
        <>
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={Boolean(element.dashed)}
            onClick={() => onPatch(element.id, { dashed: !element.dashed })}
            title="Toggle dashed"
            className={`min-h-[36px] rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2 sm:text-[10.5px] ${
              element.dashed
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            Dashed
          </button>
          <button
            type="button"
            aria-label="Toggle bidirectional arrow"
            aria-pressed={isBidirectional(element)}
            onClick={() => onPatch(element.id, bidirectionalTogglePatch(element))}
            title="Toggle bidirectional"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6 ${
              isBidirectional(element)
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <IconArrowLeftRight className="h-3 w-3" aria-hidden="true" />
          </button>
          {arrowEnds && (
            <div className="flex items-center" role="group" aria-label="Arrow ends">
              <ArrowEndPicker
                side="start"
                value={arrowEnds.start}
                onPick={(end) => onPatch(element.id, arrowEndPatch(element, "start", end))}
              />
              <ArrowEndPicker
                side="end"
                value={arrowEnds.end}
                onPick={(end) => onPatch(element.id, arrowEndPatch(element, "end", end))}
              />
            </div>
          )}
        </>
      )}

      {/* Fork It trigger for shapes & frames */}
      {(forkable || element.kind === "frame") && onFork && (
        <>
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={onFork}
            title="Fork into 3 architectural takes (Alt+F)"
            className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[#D94E28]/12 px-2.5 py-0.5 text-[11px] font-semibold text-[#C2411D] transition-colors hover:bg-[#D94E28] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[#FF8562] dark:hover:text-white sm:min-h-0 sm:px-2"
          >
            <IconFork className="h-3 w-3" aria-hidden="true" />
            <span>Fork it</span>
          </button>
        </>
      )}

      {/* Reversible Notation Morph pill switcher */}
      {onMorphNotation && element.kind !== "freedraw" && (
        <>
          <span className="h-3.5 w-px bg-border" aria-hidden="true" />
          <NotationMorphBar
            activeNotation={activeNotation}
            isMorphedGroup={isMorphedGroup}
            evaluating={morphEvaluating}
            isHeuristic={morphIsHeuristic}
            compact
            onSelectNotation={onMorphNotation}
          />
        </>
      )}

      {/* Rename in-place, copy, delete */}
      <span className="h-3.5 w-px bg-border" aria-hidden="true" />
      <div className="flex items-center gap-0.5">
        {rowsEdit && (
          <button
            type="button"
            aria-label={rowsEdit.label}
            onClick={() => onStartInlineEdit(element.id, "sublabel")}
            title={`${rowsEdit.label} (Shift+Enter adds a line)`}
            className="min-h-[36px] rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2 sm:text-[10.5px]"
          >
            {rowsEdit.short}
          </button>
        )}
        {element.kind !== "freedraw" && !UNLABELLED_KINDS.has(element.kind) && (
          <button
            type="button"
            aria-label="Edit label in place"
            onClick={() => onStartInlineEdit(element.id)}
            title="Edit title in place (double-click or Enter)"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6"
          >
            <IconEdit className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          aria-label="Duplicate element"
          onClick={() => onDuplicate(element.id)}
          title="Duplicate (⌘D)"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6"
        >
          <IconCopy className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Delete element"
          onClick={() => onDelete(element.id)}
          title="Delete"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-6 sm:w-6"
        >
          <IconTrash className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

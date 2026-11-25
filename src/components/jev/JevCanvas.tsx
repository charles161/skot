"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAdditiveSelectClick } from "@/lib/jev/selection-trigger";
import { resolvePointerCancelDecision } from "@/lib/jev/board-history";
import { getTonePalette } from "@/lib/jev/colors";
import { wheelViewport, zoomToScale } from "@/lib/jev/viewport-zoom";
import {
  beginLabelEdit,
  cancelLabelEdit,
  commitLabelEdit,
  createTextAt,
  editKeyAction,
  type EditField,
  isMultilineField,
  type LabelEditSession,
  pickEditField,
} from "@/lib/jev/inline-edit";
import { isShapeTool, shapeFromTool } from "@/lib/jev/shape-tools";
import { MultilineSublabelEditor } from "@/components/jev/MultilineSublabelEditor";
import { MarkdownNodeEditor } from "@/components/jev/MarkdownNodeEditor";
import { MarkdownNodeView } from "@/components/jev/MarkdownNodeView";
import { fitMarkdownNodeSize, toggleMarkdownCheckbox } from "@/lib/jev/markdown";
import { shouldCaptureOnMove, type DragMode } from "@/lib/jev/pointer-capture";
import {
  distanceBetween,
  getEdgeHandles,
  getElementCenter,
  getElementRect,
  isShapeElement,
  makeSeed,
  pointOnEdgeHandle,
  pointToArrowDistance,
  rectsOverlap,
  resolveArrowEndpoints,
  uid,
  type ArrowGeometry,
} from "@/lib/jev/geometry";
import { layoutArrowLabels } from "@/lib/jev/ghost-geometry";
import { DEFAULT_KIND_SIZE, isContainerKind, isShapeKind } from "@/lib/jev/notation-kinds";
import {
  buildSceneSnapshot,
  ElementBitmapCache,
  renderInteractiveScene,
  renderStaticScene,
  resolveCanvasFonts,
  type CanvasFonts,
  type SkotSceneSnapshot,
} from "@/lib/jev/canvas-renderer";
import {
  BoardTheme,
  ElementBox,
  JevElement,
  PeerCursor,
  Point,
  PredictedAction,
  RenderStyle,
  ToolType,
  Viewport,
} from "@/lib/jev/types";

interface SafariGestureEvent extends Event {
  scale: number;
  clientX?: number;
  clientY?: number;
}

declare global {
  interface Window {
    __skotDebug?: {
      getSceneSnapshot: () => SkotSceneSnapshot;
      getViewport: () => Viewport;
    };
  }
}

interface JevCanvasProps {
  svgRef?: React.RefObject<SVGSVGElement | null>;
  startEditRef?: React.MutableRefObject<((id: string, field?: EditField) => void) | null>;
  remoteSyncGenerationRef?: React.RefObject<number>;
  elements: JevElement[];
  selectedIds: string[];
  tool: ToolType;
  theme: BoardTheme;
  renderStyle: RenderStyle;
  viewport: Viewport;
  activePrediction: PredictedAction | null;
  peers: PeerCursor[];
  forkActive?: boolean;
  onViewportChange: (vp: Viewport) => void;
  onSelectIds: (ids: string[]) => void;
  onToolChange: (tool: ToolType) => void;
  onElementsChange: (
    updater: (prev: JevElement[]) => JevElement[],
    opts?: {
      recordUndo?: boolean;
      undoSnapshot?: JevElement[];
      expectedRemoteSyncGeneration?: number;
      throttleBroadcast?: boolean;
      flushBroadcast?: boolean;
    }
  ) => JevElement[];
  onElementMoved: (moved: JevElement, dragStart: ElementBox) => void;
  /** `via: "arrow"`: an arrow was drawn onto this existing element; no element was added. */
  onElementCreated: (created: JevElement, via?: "arrow") => void;
  onStrokeCreated: (stroke: JevElement) => void;
  onElementLabelEdited: (edited: JevElement) => void;
  onCursorMove?: (worldPoint: Point) => void;
  onInteractingChange?: (busy: boolean) => void;
}

interface DragState {
  mode: DragMode;
  startScreen: Point;
  startWorld: Point;
  startViewport: Viewport;
  targetId?: string;
  originBox?: ElementBox;
  originBoxes?: Record<string, ElementBox>;
  preDragElements?: JevElement[];
  dragStartSyncGeneration?: number;
  initialSelectedIds?: string[];
  currentWorld: Point;
  hoverTargetId?: string | null;
  draftId?: string;
  freedrawPoints?: Point[];
  movedEnough?: boolean;
}

interface SnapGuide {
  orientation: "h" | "v";
  pos: number;
}

const ZOOM_SHARPEN_DELAY_MS = 260;
const REACT_VIEWPORT_SYNC_DELAY_MS = 160;

export const JevCanvas = React.memo(function JevCanvas({
  startEditRef,
  remoteSyncGenerationRef,
  elements,
  selectedIds,
  tool,
  theme,
  renderStyle,
  viewport,
  activePrediction,
  peers,
  forkActive = false,
  onViewportChange,
  onSelectIds,
  onToolChange,
  onElementsChange,
  onElementMoved,
  onElementCreated,
  onStrokeCreated,
  onElementLabelEdited,
  onCursorMove,
  onInteractingChange,
}: JevCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markdownLayerRef = useRef<HTMLDivElement | null>(null);

  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 1440,
    height: 900,
    dpr: 1,
  });
  const fontsRef = useRef<CanvasFonts>(resolveCanvasFonts());
  const cacheRef = useRef<ElementBitmapCache | null>(null);
  if (!cacheRef.current) cacheRef.current = new ElementBitmapCache();

  // Live viewport (single source of truth for canvas rendering & hit-testing — zero React commits during pan/zoom)
  const liveViewportRef = useRef<Viewport>(viewport);
  const viewportDirtyRef = useRef(false);
  const shouldCacheIgnoreZoomRef = useRef(false);
  const sharpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRectRef = useRef<{ left: number; top: number; ts: number } | null>(null);
  const lastPointerClientRef = useRef<Point>({ x: 0, y: 0 });
  const gestureInitialScaleRef = useRef<number | null>(null);

  // Zero-React-commit interactive refs (drag, hover, snap guides, live drag boxes)
  const dragRef = useRef<DragState | null>(null);
  const dragOverridesRef = useRef<Map<string, ElementBox> | null>(null);
  const snapGuidesRef = useRef<SnapGuide[]>([]);
  const hoveredIdRef = useRef<string | null>(null);
  const isInteractingRef = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onInteractingChangeRef = useRef(onInteractingChange);
  onInteractingChangeRef.current = onInteractingChange;

  const [editState, setEditState] = useState<{
    session: LabelEditSession;
    undoSnapshot?: JevElement[];
  } | null>(null);
  const editSession = editState?.session ?? null;
  const editingId = editSession?.id ?? null;
  const startEdit = useCallback(
    (session: LabelEditSession | null, undoSnapshot?: JevElement[]) => {
      setEditState(session ? { session, ...(undoSnapshot ? { undoSnapshot } : {}) } : null);
    },
    []
  );
  const setEditDraft = useCallback((draft: string) => {
    setEditState((prev) => (prev ? { ...prev, session: { ...prev.session, draft } } : prev));
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const primarySelectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const elementsById = useMemo(
    () => new Map(elements.map((e) => [e.id, e])),
    [elements]
  );

  const ghostElementsMap = useMemo(() => {
    const map = new Map(elementsById);
    if (activePrediction) {
      if (activePrediction.patchElements) {
        for (const patch of activePrediction.patchElements) {
          const base = map.get(patch.id);
          if (base) map.set(patch.id, { ...base, ...patch });
        }
      }
      for (const ge of activePrediction.addElements) {
        map.set(ge.id, ge);
      }
    }
    return map;
  }, [elementsById, activePrediction]);

  const arrowGeometries = useMemo(() => {
    const computed = new Map<string, ArrowGeometry>();
    for (const el of elements) {
      if (el.kind === "arrow") computed.set(el.id, resolveArrowEndpoints(el, elementsById));
    }
    return computed;
  }, [elements, elementsById]);

  const arrowGeometry = useCallback(
    (arrow: JevElement): ArrowGeometry =>
      arrowGeometries.get(arrow.id) ?? resolveArrowEndpoints(arrow, elementsById),
    [arrowGeometries, elementsById]
  );

  const labelSpots = useMemo(() => layoutArrowLabels(elements, elementsById), [elements, elementsById]);
  const ghostLabelSpots = useMemo(() => {
    const ghosts = (activePrediction?.addElements ?? []).filter((e) => e.kind === "arrow");
    return ghosts.length > 0 ? layoutArrowLabels([...elements, ...ghosts], ghostElementsMap) : null;
  }, [elements, activePrediction, ghostElementsMap]);

  const removedGhostKey = useMemo(
    () => (activePrediction?.removeIds?.length ? activePrediction.removeIds.join(",") : ""),
    [activePrediction]
  );

  const removedGhostSet = useMemo(
    () => new Set(activePrediction?.removeIds ?? []),
    [removedGhostKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { frames, arrows, freedraws, shapes, markdownNodes } = useMemo(() => {
    const f: JevElement[] = [];
    const a: JevElement[] = [];
    const d: JevElement[] = [];
    const s: JevElement[] = [];
    const m: JevElement[] = [];
    for (const e of elements) {
      if (isContainerKind(e.kind)) f.push(e);
      else if (e.kind === "arrow") a.push(e);
      else if (e.kind === "freedraw") d.push(e);
      else if (isShapeElement(e)) {
        s.push(e);
        if (e.kind === "markdown") m.push(e);
      }
    }
    return { frames: f, arrows: a, freedraws: d, shapes: s, markdownNodes: m };
  }, [elements]);

  // Keep latest scene props in a ref so the RAF paint loop reads fresh data with zero closure churn
  const scenePropsRef = useRef({
    elements,
    frames,
    arrows,
    freedraws,
    shapes,
    elementsById,
    arrowGeometries,
    labelSpots,
    ghostElementsMap,
    ghostLabelSpots,
    removedGhostSet,
    selectedIds,
    selectedSet,
    primarySelectedId,
    editingId,
    theme,
    renderStyle,
    tool,
    forkActive,
    activePrediction,
    peers,
  });
  scenePropsRef.current = {
    elements,
    frames,
    arrows,
    freedraws,
    shapes,
    elementsById,
    arrowGeometries,
    labelSpots,
    ghostElementsMap,
    ghostLabelSpots,
    removedGhostSet,
    selectedIds,
    selectedSet,
    primarySelectedId,
    editingId,
    theme,
    renderStyle,
    tool,
    forkActive,
    activePrediction,
    peers,
  };

  // Unified RAF paint scheduler (static + interactive canvases + markdown overlay)
  const dirtyStaticRef = useRef(true);
  const dirtyInteractiveRef = useRef(true);
  const interactiveHadContentRef = useRef(false);
  const paintRafRef = useRef<number | null>(null);

  const syncDomViewportMeta = useCallback((vp: Viewport) => {
    const container = containerRef.current;
    if (container) {
      const nextAttr = `${vp.x},${vp.y},${vp.zoom}`;
      if (container.getAttribute("data-viewport") !== nextAttr) {
        container.setAttribute("data-viewport", nextAttr);
      }
    }
    const mdLayer = markdownLayerRef.current;
    if (mdLayer) {
      mdLayer.style.transform = `translate3d(${vp.x}px, ${vp.y}px, 0) scale(${vp.zoom})`;
    }
  }, []);

  const paintNow = useCallback(() => {
    paintRafRef.current = null;
    const { width, height, dpr } = sizeRef.current;
    if (width <= 0 || height <= 0) return;

    const vp = liveViewportRef.current;
    const sp = scenePropsRef.current;
    syncDomViewportMeta(vp);

    if (dirtyStaticRef.current) {
      dirtyStaticRef.current = false;
      const staticCanvas = staticCanvasRef.current;
      const ctx = staticCanvas?.getContext("2d", { alpha: false });
      if (ctx && cacheRef.current) {
        renderStaticScene(ctx, {
          width,
          height,
          dpr,
          viewport: vp,
          theme: sp.theme,
          renderStyle: sp.renderStyle,
          frames: sp.frames,
          arrows: sp.arrows,
          freedraws: sp.freedraws,
          shapes: sp.shapes,
          elementsById: sp.elementsById,
          arrowGeometries: sp.arrowGeometries,
          labelSpots: sp.labelSpots,
          selectedSet: sp.selectedSet,
          removedGhostSet: sp.removedGhostSet,
          editingId: sp.editingId,
          forkActive: sp.forkActive,
          shouldCacheIgnoreZoom: shouldCacheIgnoreZoomRef.current,
          dragOverrides: dragOverridesRef.current,
          fonts: fontsRef.current,
          cache: cacheRef.current,
        });
      }
    }

    if (dirtyInteractiveRef.current) {
      dirtyInteractiveRef.current = false;
      const hasInteractive =
        sp.selectedIds.length > 0 ||
        Boolean(hoveredIdRef.current) ||
        Boolean(sp.activePrediction) ||
        snapGuidesRef.current.length > 0 ||
        sp.peers.length > 0 ||
        Boolean(dragRef.current);

      if (hasInteractive || interactiveHadContentRef.current) {
        interactiveHadContentRef.current = hasInteractive;
        const interactiveCanvas = interactiveCanvasRef.current;
        const ctx = interactiveCanvas?.getContext("2d");
        if (ctx) {
          renderInteractiveScene(ctx, {
            width,
            height,
            dpr,
            viewport: vp,
            theme: sp.theme,
            tool: sp.tool,
            frames: sp.frames,
            shapes: sp.shapes,
            elements: sp.elements,
            elementsById: sp.elementsById,
            ghostElementsMap: sp.ghostElementsMap,
            ghostLabelSpots: sp.ghostLabelSpots,
            selectedIds: sp.selectedIds,
            selectedSet: sp.selectedSet,
            primarySelectedId: sp.primarySelectedId,
            hoveredId: hoveredIdRef.current,
            forkActive: sp.forkActive,
            activePrediction: sp.activePrediction,
            snapGuides: snapGuidesRef.current,
            peers: sp.peers,
            drag: dragRef.current,
            dragOverrides: dragOverridesRef.current,
            fonts: fontsRef.current,
          });
        }
      }
    }
  }, [syncDomViewportMeta]);

  const schedulePaint = useCallback(
    (staticDirty: boolean, interactiveDirty: boolean) => {
      if (staticDirty) dirtyStaticRef.current = true;
      if (interactiveDirty) dirtyInteractiveRef.current = true;
      if (paintRafRef.current === null && typeof window !== "undefined") {
        paintRafRef.current = window.requestAnimationFrame(paintNow);
      }
    },
    [paintNow]
  );

  // Sync canvas pixel dimensions to container size & devicePixelRatio
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const resize = () => {
      const rect = node.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      sizeRef.current = { width, height, dpr };
      for (const c of [staticCanvasRef.current, interactiveCanvasRef.current]) {
        if (!c) continue;
        const pw = Math.round(width * dpr);
        const ph = Math.round(height * dpr);
        if (c.width !== pw) c.width = pw;
        if (c.height !== ph) c.height = ph;
      }
      containerRectRef.current = { left: rect.left, top: rect.top, ts: performance.now() };
      schedulePaint(true, true);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(node);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [schedulePaint]);

  // Refresh typography & element bitmap cache once web fonts load (Sketch / Mono)
  useEffect(() => {
    fontsRef.current = resolveCanvasFonts();
    let active = true;
    document.fonts?.ready.then(() => {
      if (!active) return;
      fontsRef.current = resolveCanvasFonts();
      cacheRef.current?.invalidateAll();
      schedulePaint(true, true);
    });
    return () => {
      active = false;
    };
  }, [schedulePaint]);

  // Repaint StaticCanvas ONLY when static board content/styling changes (never on Thought Bar typing / ghost / peer / tool changes)
  useEffect(() => {
    schedulePaint(true, false);
  }, [
    elements,
    selectedIds,
    theme,
    renderStyle,
    editingId,
    forkActive,
    removedGhostKey,
    schedulePaint,
  ]);

  // Repaint InteractiveCanvas when ghosts, selection overlays, peers, or tool change
  useEffect(() => {
    schedulePaint(false, true);
  }, [
    elements,
    selectedIds,
    theme,
    renderStyle,
    forkActive,
    activePrediction,
    peers,
    tool,
    schedulePaint,
  ]);

  // Sync external viewport updates (Fit-to-view, +/- buttons, Fork auto-fit) when no live gesture owns viewport
  useEffect(() => {
    if (!viewportDirtyRef.current) {
      liveViewportRef.current = viewport;
      schedulePaint(true, true);
    }
  }, [viewport, schedulePaint]);

  // Cleanup pending timers / RAF on unmount
  useEffect(() => {
    return () => {
      if (paintRafRef.current !== null) window.cancelAnimationFrame(paintRafRef.current);
      if (sharpenTimerRef.current !== null) clearTimeout(sharpenTimerRef.current);
      if (reactSyncTimerRef.current !== null) clearTimeout(reactSyncTimerRef.current);
    };
  }, []);

  // Expose read-only scene snapshot for Playwright verification & accessibility tooling
  useEffect(() => {
    window.__skotDebug = {
      getViewport: () => ({ ...liveViewportRef.current }),
      getSceneSnapshot: () => {
        const sp = scenePropsRef.current;
        return buildSceneSnapshot({
          viewport: liveViewportRef.current,
          theme: sp.theme,
          renderStyle: sp.renderStyle,
          elements: sp.elements,
          elementsById: sp.elementsById,
          arrowGeometries: sp.arrowGeometries,
          labelSpots: sp.labelSpots,
          activePrediction: sp.activePrediction,
          ghostElementsMap: sp.ghostElementsMap,
          ghostLabelSpots: sp.ghostLabelSpots,
          dragOverrides: dragOverridesRef.current,
        });
      },
    };
    return () => {
      delete window.__skotDebug;
    };
  }, []);

  const flushViewportToReact = useCallback(() => {
    if (reactSyncTimerRef.current !== null) {
      clearTimeout(reactSyncTimerRef.current);
      reactSyncTimerRef.current = null;
    }
    if (!viewportDirtyRef.current) return;
    viewportDirtyRef.current = false;
    onViewportChangeRef.current({ ...liveViewportRef.current });
  }, []);

  const scheduleLiveViewport = useCallback(
    (next: Viewport, zoomChanged: boolean, syncDelayMs: number) => {
      liveViewportRef.current = next;
      viewportDirtyRef.current = true;
      if (zoomChanged) {
        shouldCacheIgnoreZoomRef.current = true;
        if (sharpenTimerRef.current !== null) clearTimeout(sharpenTimerRef.current);
        sharpenTimerRef.current = setTimeout(() => {
          sharpenTimerRef.current = null;
          shouldCacheIgnoreZoomRef.current = false;
          schedulePaint(true, false);
        }, ZOOM_SHARPEN_DELAY_MS);
      }
      schedulePaint(true, true);

      if (reactSyncTimerRef.current !== null) {
        clearTimeout(reactSyncTimerRef.current);
        reactSyncTimerRef.current = null;
      }
      if (syncDelayMs > 0) {
        reactSyncTimerRef.current = setTimeout(() => {
          reactSyncTimerRef.current = null;
          flushViewportToReact();
        }, syncDelayMs);
      }
    },
    [schedulePaint, flushViewportToReact]
  );

  const updateInteracting = useCallback((busy: boolean) => {
    if (isInteractingRef.current !== busy) {
      isInteractingRef.current = busy;
      onInteractingChangeRef.current?.(busy);
    }
  }, []);

  useEffect(() => {
    if (editingId) updateInteracting(true);
    else if (!dragRef.current) updateInteracting(false);
  }, [editingId, updateInteracting]);

  const getContainerOrigin = useCallback(() => {
    const node = containerRef.current;
    if (!node) return { left: 0, top: 0 };
    const now = performance.now();
    const cached = containerRectRef.current;
    if (cached && now - cached.ts < 250) return cached;
    const rect = node.getBoundingClientRect();
    const fresh = { left: rect.left, top: rect.top, ts: now };
    containerRectRef.current = fresh;
    return fresh;
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const origin = getContainerOrigin();
      const vp = liveViewportRef.current;
      return {
        x: (clientX - origin.left - vp.x) / vp.zoom,
        y: (clientY - origin.top - vp.y) / vp.zoom,
      };
    },
    [getContainerOrigin]
  );

  // Track Spacebar for quick Hand panning
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const findShapeAtPoint = useCallback(
    (pt: Point, ignoreId?: string): JevElement | null => {
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el.id === ignoreId || !isShapeElement(el) || isContainerKind(el.kind)) continue;
        if (
          pt.x >= el.x - 4 &&
          pt.x <= el.x + el.width + 4 &&
          pt.y >= el.y - 4 &&
          pt.y <= el.y + el.height + 4
        ) {
          return el;
        }
      }
      for (let i = elements.length - 1; i >= 0; i--) {
        const arr = elements[i];
        if (arr.id === ignoreId || arr.kind !== "arrow") continue;
        if (pointToArrowDistance(pt, arrowGeometry(arr)) < 12) return arr;
      }
      for (let i = elements.length - 1; i >= 0; i--) {
        const dr = elements[i];
        if (dr.id === ignoreId || dr.kind !== "freedraw" || !dr.points) continue;
        if (dr.points.some((p) => distanceBetween(p, pt) < 14)) return dr;
      }
      for (let i = elements.length - 1; i >= 0; i--) {
        const f = elements[i];
        if (f.id === ignoreId || !isContainerKind(f.kind)) continue;
        const inOuter =
          pt.x >= f.x - 6 &&
          pt.x <= f.x + f.width + 6 &&
          pt.y >= f.y - 6 &&
          pt.y <= f.y + f.height + 6;
        const inInner =
          pt.x >= f.x + 16 &&
          pt.x <= f.x + f.width - 16 &&
          pt.y >= f.y + 34 &&
          pt.y <= f.y + f.height - 16;
        if (inOuter && !inInner) return f;
      }
      return null;
    },
    [elements, arrowGeometry]
  );

  const findResizeHandleAtPoint = useCallback(
    (pt: Point): JevElement | null => {
      if (forkActive) return null;
      if (primarySelectedId) {
        const el = elementsById.get(primarySelectedId);
        if (el && isShapeElement(el) && !isContainerKind(el.kind)) {
          if (
            pt.x >= el.x + el.width - 7 &&
            pt.x <= el.x + el.width + 9 &&
            pt.y >= el.y + el.height - 7 &&
            pt.y <= el.y + el.height + 9
          ) {
            return el;
          }
        }
      }
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = frames[i];
        if (!selectedSet.has(f.id)) continue;
        if (
          pt.x >= f.x + f.width - 8 &&
          pt.x <= f.x + f.width + 8 &&
          pt.y >= f.y + f.height - 8 &&
          pt.y <= f.y + f.height + 8
        ) {
          return f;
        }
      }
      return null;
    },
    [elementsById, forkActive, frames, primarySelectedId, selectedSet]
  );

  const findEdgeHandleAtPoint = useCallback(
    (pt: Point): { el: JevElement; point: Point } | null => {
      if (forkActive || tool !== "select") return null;
      const candidates = new Set<string>(selectedIds);
      if (hoveredIdRef.current) candidates.add(hoveredIdRef.current);
      for (const id of candidates) {
        const el = elementsById.get(id);
        if (!el || !isShapeElement(el) || isContainerKind(el.kind) || el.kind === "text") continue;
        const side = pointOnEdgeHandle(el, pt);
        if (side) {
          const match = getEdgeHandles(el).find((h) => h.side === side);
          if (match) return { el, point: match.point };
        }
      }
      return null;
    },
    [elementsById, forkActive, selectedIds, tool]
  );

  useEffect(() => {
    if (!startEditRef) return;
    startEditRef.current = (id: string, field: EditField = "label") => {
      const target = elementsById.get(id);
      if (!target) return;
      if (viewportDirtyRef.current) flushViewportToReact();
      startEdit(beginLabelEdit(target, field));
    };
    return () => {
      startEditRef.current = null;
    };
  }, [startEditRef, elementsById, startEdit, flushViewportToReact]);

  const markdownCommitRef = useRef<(() => void) | null>(null);
  const registerMarkdownCommit = useCallback((fn: (() => void) | null) => {
    markdownCommitRef.current = fn;
  }, []);

  const commitMarkdownEdit = useCallback(
    (id: string, next: { label: string; sublabel: string }) => {
      const undoSnapshot = editState?.undoSnapshot;
      startEdit(null);
      const target = elements.find((el) => el.id === id);
      if (!target) return;
      const nextLabel = next.label.trim() || target.label || "Markdown Note";
      const nextSub = next.sublabel.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
      if (nextLabel === target.label && nextSub === (target.sublabel ?? "")) return;
      const now = Date.now();
      const fitted = nextSub ? fitMarkdownNodeSize(nextSub, { width: target.width, height: target.height }) : {};
      const nextElements = onElementsChange(
        (prev) =>
          prev.map((el) => {
            if (el.id !== id) return el;
            const { sublabel: _drop, ...rest } = el;
            void _drop;
            return nextSub
              ? { ...el, label: nextLabel, sublabel: nextSub, ...fitted, updatedAt: now }
              : { ...rest, label: nextLabel, updatedAt: now };
          }),
        { recordUndo: true, flushBroadcast: true, ...(undoSnapshot ? { undoSnapshot } : {}) }
      );
      const updatedEl = nextElements.find((el) => el.id === id);
      if (updatedEl) onElementLabelEdited(updatedEl);
    },
    [editState, elements, onElementsChange, onElementLabelEdited, startEdit]
  );

  const toggleMarkdownTask = useCallback(
    (id: string, lineIndex: number) => {
      const now = Date.now();
      onElementsChange(
        (prev) =>
          prev.map((el) => {
            if (el.id !== id || el.kind !== "markdown") return el;
            const nextSub = toggleMarkdownCheckbox(el.sublabel ?? "", lineIndex);
            if (nextSub === (el.sublabel ?? "")) return el;
            return { ...el, sublabel: nextSub, updatedAt: now };
          }),
        { recordUndo: true, flushBroadcast: true }
      );
    },
    [onElementsChange]
  );

  const commitInlineEdit = useCallback(() => {
    if (!editState) return;
    const { session, undoSnapshot } = editState;
    startEdit(null);
    const now = Date.now();
    if (commitLabelEdit(elements, session, now) === elements) return;
    const removesNewText = session.createdForEdit && !session.draft.trim();
    const nextElements = onElementsChange(
      (prev) => commitLabelEdit(prev, session, now),
      removesNewText
        ? { recordUndo: false, flushBroadcast: true }
        : { recordUndo: true, flushBroadcast: true, ...(undoSnapshot ? { undoSnapshot } : {}) }
    );
    const updatedEl = nextElements.find((el) => el.id === session.id);
    if (updatedEl) onElementLabelEdited(updatedEl);
  }, [editState, elements, onElementsChange, onElementLabelEdited, startEdit]);

  const cancelInlineEdit = useCallback(() => {
    const session = editState?.session;
    if (!session) return;
    startEdit(null);
    if (session.createdForEdit) {
      onElementsChange((prev) => cancelLabelEdit(prev, session), {
        recordUndo: false,
        flushBroadcast: true,
      });
    }
  }, [editState, onElementsChange, startEdit]);

  const createTextAtWorld = useCallback(
    (world: Point) => {
      if (viewportDirtyRef.current) flushViewportToReact();
      const { element, session } = createTextAt(world, Date.now(), uid("txt"));
      onElementsChange((prev) => [...prev, element], { recordUndo: false });
      onSelectIds([element.id]);
      startEdit(session, elements);
    },
    [elements, flushViewportToReact, onElementsChange, onSelectIds, startEdit]
  );

  // Single stable wheel + Safari gesture listener (Excalidraw App.wheel.ts + App.tsx gesturestart/change/end)
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="markdown-editor"]')) return;
      const mdScroll = target?.closest('[data-markdown-scroll="1"]') as HTMLElement | null;
      if (mdScroll && mdScroll.scrollHeight > mdScroll.clientHeight) return;
      e.preventDefault();

      const origin = getContainerOrigin();
      const prev = liveViewportRef.current;
      const next = wheelViewport(prev, e, {
        x: e.clientX - origin.left,
        y: e.clientY - origin.top,
      });
      if (next === prev) return;
      const zoomChanged = Math.abs(next.zoom - prev.zoom) > 1e-6;
      scheduleLiveViewport(next, zoomChanged, REACT_VIEWPORT_SYNC_DELAY_MS);
    };

    // Safari desktop trackpad pinch sends gesturestart/gesturechange/gestureend instead of ctrl+wheel
    const onGestureStart = (raw: Event) => {
      const e = raw as SafariGestureEvent;
      e.preventDefault();
      gestureInitialScaleRef.current = liveViewportRef.current.zoom;
    };

    const onGestureChange = (raw: Event) => {
      const e = raw as SafariGestureEvent;
      e.preventDefault();
      const initialScale = gestureInitialScaleRef.current;
      if (!initialScale || !Number.isFinite(e.scale) || e.scale <= 0) return;
      const origin = getContainerOrigin();
      const cx = (e.clientX ?? lastPointerClientRef.current.x) - origin.left;
      const cy = (e.clientY ?? lastPointerClientRef.current.y) - origin.top;
      const next = zoomToScale(liveViewportRef.current, initialScale * e.scale, { x: cx, y: cy });
      scheduleLiveViewport(next, true, REACT_VIEWPORT_SYNC_DELAY_MS);
    };

    const onGestureEnd = (raw: Event) => {
      raw.preventDefault();
      gestureInitialScaleRef.current = null;
    };

    const invalidateRect = () => {
      containerRectRef.current = null;
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    node.addEventListener("gesturestart", onGestureStart, { passive: false });
    node.addEventListener("gesturechange", onGestureChange, { passive: false });
    node.addEventListener("gestureend", onGestureEnd, { passive: false });
    window.addEventListener("resize", invalidateRect);
    return () => {
      node.removeEventListener("wheel", handleWheel);
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("resize", invalidateRect);
    };
  }, [getContainerOrigin, scheduleLiveViewport]);

  const setContainerCursor = useCallback((cursor: string) => {
    const node = containerRef.current;
    if (node && node.style.cursor !== cursor) node.style.cursor = cursor;
  }, []);

  const defaultCursorForTool = useCallback(() => {
    if (dragRef.current?.mode === "pan") return "grabbing";
    if (tool === "hand" || spacePressed) return "grab";
    if (tool === "select") return "default";
    return "crosshair";
  }, [spacePressed, tool]);

  useEffect(() => {
    setContainerCursor(defaultCursorForTool());
  }, [defaultCursorForTool, setContainerCursor]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, button, [role='dialog']")) return;

    lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
    if (viewportDirtyRef.current) flushViewportToReact();

    if (editingId) {
      if (elementsById.get(editingId)?.kind === "markdown" && markdownCommitRef.current) {
        markdownCommitRef.current();
      } else {
        commitInlineEdit();
      }
    }

    const world = screenToWorld(e.clientX, e.clientY);
    const screen = { x: e.clientX, y: e.clientY };
    const currentViewport = liveViewportRef.current;

    // Middle mouse or Hand tool or Spacebar => Pan
    if (e.button === 1 || tool === "hand" || spacePressed) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "pan",
        startScreen: screen,
        startWorld: world,
        startViewport: { ...currentViewport },
        currentWorld: world,
      };
      setContainerCursor("grabbing");
      return;
    }

    if (e.button !== 0) return;

    // Freedraw tool
    if (tool === "freedraw") {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "freedraw",
        startScreen: screen,
        startWorld: world,
        startViewport: { ...currentViewport },
        currentWorld: world,
        draftId: uid("ink"),
        freedrawPoints: [world],
      };
      updateInteracting(true);
      schedulePaint(false, true);
      return;
    }

    // Arrow tool
    if (tool === "arrow") {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const hit = findShapeAtPoint(world);
      const startPt = hit ? getElementCenter(hit) : world;
      const fromId = hit && isShapeElement(hit) ? hit.id : undefined;
      dragRef.current = {
        mode: "connect",
        startScreen: screen,
        startWorld: startPt,
        startViewport: { ...currentViewport },
        targetId: fromId,
        draftId: uid("stk"),
        currentWorld: world,
      };
      updateInteracting(true);
      schedulePaint(false, true);
      return;
    }

    // Shape creation tools
    if (isShapeTool(tool)) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "draw_shape",
        startScreen: screen,
        startWorld: world,
        startViewport: { ...currentViewport },
        draftId: uid("stk"),
        currentWorld: world,
      };
      updateInteracting(true);
      schedulePaint(false, true);
      return;
    }

    // Select tool: check resize handle -> edge handle -> shape hit -> marquee
    const resizeTarget = findResizeHandleAtPoint(world);
    if (resizeTarget) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "resize",
        startScreen: screen,
        startWorld: world,
        startViewport: { ...currentViewport },
        targetId: resizeTarget.id,
        originBox: {
          x: resizeTarget.x,
          y: resizeTarget.y,
          width: resizeTarget.width,
          height: resizeTarget.height,
        },
        preDragElements: elements.map((item) => ({ ...item })),
        dragStartSyncGeneration: remoteSyncGenerationRef?.current ?? 0,
        currentWorld: world,
        movedEnough: false,
      };
      updateInteracting(true);
      return;
    }

    const edgeHit = findEdgeHandleAtPoint(world);
    if (edgeHit) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "connect",
        startScreen: screen,
        startWorld: edgeHit.point,
        startViewport: { ...currentViewport },
        targetId: edgeHit.el.id,
        draftId: uid("stk"),
        currentWorld: edgeHit.point,
      };
      updateInteracting(true);
      schedulePaint(false, true);
      return;
    }

    const hit = findShapeAtPoint(world);
    if (hit) {
      let activeIds: string[];
      if (isAdditiveSelectClick(e)) {
        activeIds = selectedSet.has(hit.id)
          ? selectedIds.filter((id) => id !== hit.id)
          : [...selectedIds, hit.id];
        onSelectIds(activeIds);
      } else if (selectedSet.has(hit.id) && selectedIds.length > 1) {
        activeIds = selectedIds;
      } else {
        activeIds = [hit.id];
        onSelectIds(activeIds);
      }

      if (isShapeElement(hit) && activeIds.includes(hit.id)) {
        const originBoxes: Record<string, ElementBox> = {};
        for (const id of activeIds) {
          const item = elementsById.get(id);
          if (item && isShapeElement(item)) {
            originBoxes[id] = {
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            };
          }
        }
        dragRef.current = {
          mode: "move",
          startScreen: screen,
          startWorld: world,
          startViewport: { ...currentViewport },
          targetId: hit.id,
          originBox: {
            x: hit.x,
            y: hit.y,
            width: hit.width,
            height: hit.height,
          },
          originBoxes,
          preDragElements: elements.map((el) => ({ ...el })),
          dragStartSyncGeneration: remoteSyncGenerationRef?.current ?? 0,
          currentWorld: world,
          movedEnough: false,
        };
      }
    } else {
      const baseSelection = e.shiftKey ? selectedIds : [];
      if (!e.shiftKey) onSelectIds([]);
      dragRef.current = {
        mode: "marquee",
        startScreen: screen,
        startWorld: world,
        startViewport: { ...currentViewport },
        initialSelectedIds: baseSelection,
        currentWorld: world,
      };
      updateInteracting(true);
      schedulePaint(false, true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
    const drag = dragRef.current;
    const container = e.currentTarget as HTMLElement;
    if (shouldCaptureOnMove(drag?.mode ?? null, e.buttons, container.hasPointerCapture(e.pointerId))) {
      container.setPointerCapture(e.pointerId);
    }

    const world = screenToWorld(e.clientX, e.clientY);
    onCursorMove?.(world);

    if (!drag) {
      if (tool === "select" && !spacePressed) {
        if (findResizeHandleAtPoint(world)) {
          setContainerCursor("nwse-resize");
          return;
        }
        const hovered = hoveredIdRef.current ? elementsById.get(hoveredIdRef.current) : undefined;
        if (hovered && isShapeElement(hovered) && hovered.kind !== "text" && pointOnEdgeHandle(hovered, world)) {
          setContainerCursor("crosshair");
          return;
        }
        if (findEdgeHandleAtPoint(world)) {
          setContainerCursor("crosshair");
          return;
        }
        setContainerCursor("default");
      }
      const hit = findShapeAtPoint(world);
      const nextHovered = hit?.id ?? null;
      if (hoveredIdRef.current !== nextHovered) {
        hoveredIdRef.current = nextHovered;
        schedulePaint(false, true);
      }
      return;
    }

    if (drag.mode === "pan") {
      const dx = e.clientX - drag.startScreen.x;
      const dy = e.clientY - drag.startScreen.y;
      scheduleLiveViewport(
        {
          ...drag.startViewport,
          x: drag.startViewport.x + dx,
          y: drag.startViewport.y + dy,
        },
        false,
        0
      );
      return;
    }

    if (drag.mode === "marquee") {
      drag.currentWorld = world;
      const marqueeRect = {
        x: Math.min(drag.startWorld.x, world.x),
        y: Math.min(drag.startWorld.y, world.y),
        width: Math.abs(world.x - drag.startWorld.x),
        height: Math.abs(world.y - drag.startWorld.y),
      };

      const matched = new Set<string>(drag.initialSelectedIds ?? []);
      if (marqueeRect.width > 4 || marqueeRect.height > 4) {
        for (const el of elements) {
          if (isShapeElement(el)) {
            if (rectsOverlap(marqueeRect, getElementRect(el), 0)) matched.add(el.id);
          } else if (el.kind === "arrow") {
            const { start, end } = arrowGeometry(el);
            const arrowRect = {
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              width: Math.max(1, Math.abs(end.x - start.x)),
              height: Math.max(1, Math.abs(end.y - start.y)),
            };
            if (rectsOverlap(marqueeRect, arrowRect, 0)) matched.add(el.id);
          } else if (el.kind === "freedraw" && el.points && el.points.length > 0) {
            if (
              el.points.some(
                (p) =>
                  p.x >= marqueeRect.x &&
                  p.x <= marqueeRect.x + marqueeRect.width &&
                  p.y >= marqueeRect.y &&
                  p.y <= marqueeRect.y + marqueeRect.height
              )
            ) {
              matched.add(el.id);
            }
          }
        }
      }
      const nextIds = Array.from(matched);
      const sameSel =
        nextIds.length === selectedIds.length && nextIds.every((id, i) => id === selectedIds[i]);
      if (!sameSel) onSelectIds(nextIds);
      schedulePaint(false, true);
      return;
    }

    if (drag.mode === "move" && drag.targetId && drag.originBox) {
      const rawDx = world.x - drag.startWorld.x;
      const rawDy = world.y - drag.startWorld.y;
      const originBoxes = drag.originBoxes ?? { [drag.targetId]: drag.originBox };
      const movingIds = new Set(Object.keys(originBoxes));
      const isGroupMove = movingIds.size > 1;

      let snapDx = Math.round(rawDx);
      let snapDy = Math.round(rawDy);
      const movedEnough = drag.movedEnough || Math.hypot(rawDx, rawDy) > 6;

      const guides: SnapGuide[] = [];
      if (!isGroupMove) {
        const nextX = Math.round(drag.originBox.x + rawDx);
        const nextY = Math.round(drag.originBox.y + rawDy);
        const cx = nextX + drag.originBox.width / 2;
        const cy = nextY + drag.originBox.height / 2;

        for (const other of elements) {
          if (movingIds.has(other.id) || !isShapeElement(other) || isContainerKind(other.kind)) continue;
          const oc = getElementCenter(other);
          if (Math.abs(cy - oc.y) < 10) {
            snapDy = Math.round(oc.y - drag.originBox.height / 2 - drag.originBox.y);
            guides.push({ orientation: "h", pos: oc.y });
          }
          if (Math.abs(cx - oc.x) < 10) {
            snapDx = Math.round(oc.x - drag.originBox.width / 2 - drag.originBox.x);
            guides.push({ orientation: "v", pos: oc.x });
          }
        }
      }

      const overrides = new Map<string, ElementBox>();
      for (const [id, orig] of Object.entries(originBoxes)) {
        overrides.set(id, {
          x: Math.round(orig.x + snapDx),
          y: Math.round(orig.y + snapDy),
          width: orig.width,
          height: orig.height,
        });
      }
      dragOverridesRef.current = overrides;
      snapGuidesRef.current = guides.slice(0, 2);
      drag.currentWorld = world;
      drag.movedEnough = movedEnough;
      if (movedEnough) updateInteracting(true);
      schedulePaint(true, true);
      return;
    }

    if (drag.mode === "resize" && drag.targetId && drag.originBox) {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      const target = elementsById.get(drag.targetId);
      const kindMin = target && isShapeKind(target.kind) ? DEFAULT_KIND_SIZE[target.kind] : null;
      const nextW = Math.max(Math.min(88, kindMin?.width ?? 88), Math.round(drag.originBox.width + dx));
      const nextH = Math.max(Math.min(48, kindMin?.height ?? 48), Math.round(drag.originBox.height + dy));
      const overrides = new Map<string, ElementBox>();
      overrides.set(drag.targetId, {
        x: drag.originBox.x,
        y: drag.originBox.y,
        width: nextW,
        height: nextH,
      });
      dragOverridesRef.current = overrides;
      drag.currentWorld = world;
      drag.movedEnough = true;
      schedulePaint(true, true);
      return;
    }

    if (drag.mode === "connect") {
      const hit = findShapeAtPoint(world, drag.targetId);
      drag.currentWorld = world;
      drag.hoverTargetId = hit && isShapeElement(hit) && !isContainerKind(hit.kind) ? hit.id : null;
      schedulePaint(false, true);
      return;
    }

    if (drag.mode === "draw_shape") {
      drag.currentWorld = world;
      schedulePaint(false, true);
      return;
    }

    if (drag.mode === "freedraw") {
      const pts = drag.freedrawPoints ?? [];
      const last = pts[pts.length - 1];
      if (!last || distanceBetween(last, world) > 3) {
        pts.push(world);
        drag.freedrawPoints = pts;
        drag.currentWorld = world;
        schedulePaint(false, true);
      }
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const overrides = dragOverridesRef.current;
    dragRef.current = null;
    dragOverridesRef.current = null;
    snapGuidesRef.current = [];
    setContainerCursor(defaultCursorForTool());
    if (!editingId) updateInteracting(false);

    if (drag.mode === "pan") {
      flushViewportToReact();
      return;
    }

    const currentSyncGen = remoteSyncGenerationRef?.current ?? 0;
    const remoteChangedMidDrag =
      drag.dragStartSyncGeneration !== undefined &&
      drag.dragStartSyncGeneration !== currentSyncGen;

    if (drag.mode === "move" && drag.targetId && drag.originBox && drag.movedEnough && overrides) {
      const origin = drag.originBox;
      const now = Date.now();
      const nextElements = onElementsChange(
        (prev) =>
          prev.map((el) => {
            const ov = overrides.get(el.id);
            if (!ov) return el;
            return { ...el, x: ov.x, y: ov.y, updatedAt: now };
          }),
        {
          recordUndo: !remoteChangedMidDrag,
          undoSnapshot: remoteChangedMidDrag ? undefined : drag.preDragElements,
          expectedRemoteSyncGeneration: drag.dragStartSyncGeneration,
          flushBroadcast: true,
        }
      );
      const movedFinal = nextElements.find((el) => el.id === drag.targetId);
      if (movedFinal) onElementMoved(movedFinal, origin);
      schedulePaint(true, true);
      return;
    }

    if (drag.mode === "resize" && drag.targetId && drag.originBox && drag.movedEnough && overrides) {
      const ov = overrides.get(drag.targetId);
      if (ov) {
        const now = Date.now();
        onElementsChange(
          (prev) =>
            prev.map((el) =>
              el.id === drag.targetId
                ? { ...el, width: ov.width, height: ov.height, updatedAt: now }
                : el
            ),
          {
            recordUndo: !remoteChangedMidDrag,
            undoSnapshot: remoteChangedMidDrag ? undefined : drag.preDragElements,
            expectedRemoteSyncGeneration: drag.dragStartSyncGeneration,
            flushBroadcast: true,
          }
        );
      }
      schedulePaint(true, true);
      return;
    }

    if (drag.mode === "connect") {
      const dist = distanceBetween(drag.startWorld, drag.currentWorld);
      if (dist > 24) {
        const fromId = drag.targetId;
        const toId = drag.hoverTargetId ?? undefined;
        const now = Date.now();

        if (fromId && toId && fromId !== toId) {
          const arrowId = uid("arr");
          const arrow: JevElement = {
            id: arrowId,
            kind: "arrow",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            label: "",
            tone: "ink",
            seed: makeSeed(arrowId),
            fromId,
            toId,
            arrowStyle: "curved",
            createdAt: now,
            updatedAt: now,
          };
          onElementsChange((prev) => [...prev, arrow], { recordUndo: true });
          const targetEl = elementsById.get(toId);
          if (targetEl) onElementCreated(targetEl, "arrow");
        } else if (fromId && !toId) {
          const newNodeId = uid("el");
          const newNode: JevElement = {
            id: newNodeId,
            kind: "node",
            x: Math.round(drag.currentWorld.x - 84),
            y: Math.round(drag.currentWorld.y - 36),
            width: 168,
            height: 72,
            label: "New Step",
            tone: "cobalt",
            seed: makeSeed(newNodeId),
            createdAt: now,
            updatedAt: now,
          };
          const arrowId = uid("arr");
          const arrow: JevElement = {
            id: arrowId,
            kind: "arrow",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            label: "",
            tone: "ink",
            seed: makeSeed(arrowId),
            fromId,
            toId: newNodeId,
            arrowStyle: "curved",
            createdAt: now,
            updatedAt: now,
          };
          onElementsChange((prev) => [...prev, newNode, arrow], { recordUndo: true });
          onSelectIds([newNodeId]);
          startEdit({ id: newNodeId, field: "label", draft: "New Step", createdForEdit: false });
          onElementCreated(newNode);
        } else {
          const arrowId = uid("arr");
          const arrow: JevElement = {
            id: arrowId,
            kind: "arrow",
            x: drag.startWorld.x,
            y: drag.startWorld.y,
            width: drag.currentWorld.x - drag.startWorld.x,
            height: drag.currentWorld.y - drag.startWorld.y,
            fromPoint: drag.startWorld,
            toPoint: drag.currentWorld,
            label: "",
            tone: "ink",
            seed: makeSeed(arrowId),
            arrowStyle: "curved",
            createdAt: now,
            updatedAt: now,
          };
          onElementsChange((prev) => [...prev, arrow], { recordUndo: true });
        }
        if (tool === "arrow") onToolChange("select");
      }
      schedulePaint(true, true);
      return;
    }

    if (drag.mode === "draw_shape" && isShapeTool(tool)) {
      const id = uid(tool === "frame" ? "frm" : "el");
      const { element: created, editLabel, behind } = shapeFromTool(
        tool,
        drag.startWorld,
        drag.currentWorld,
        id,
        Date.now()
      );
      onElementsChange((prev) => (behind ? [created, ...prev] : [...prev, created]), { recordUndo: true });
      onSelectIds([id]);
      if (created.kind === "markdown") {
        startEdit({ id, field: "sublabel", draft: created.sublabel ?? "", createdForEdit: false });
      } else if (editLabel) {
        startEdit({ id, field: "label", draft: created.label, createdForEdit: false });
      }
      onElementCreated(created);
      onToolChange("select");
      schedulePaint(true, true);
      return;
    }

    if (drag.mode === "freedraw" && drag.freedrawPoints && drag.freedrawPoints.length > 2) {
      const id = drag.draftId ?? uid("ink");
      const now = Date.now();
      const ink: JevElement = {
        id,
        kind: "freedraw",
        x: drag.freedrawPoints[0].x,
        y: drag.freedrawPoints[0].y,
        width: 0,
        height: 0,
        label: "",
        tone: "ink",
        seed: makeSeed(id),
        points: drag.freedrawPoints,
        createdAt: now,
        updatedAt: now,
      };
      onElementsChange((prev) => [...prev, ink], { recordUndo: true });
      onStrokeCreated(ink);
    }

    schedulePaint(true, true);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    try {
      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture release errors
    }

    const drag = dragRef.current;
    dragRef.current = null;
    dragOverridesRef.current = null;
    snapGuidesRef.current = [];
    setContainerCursor(defaultCursorForTool());
    if (!editingId) updateInteracting(false);
    if (!drag) return;

    const decision = resolvePointerCancelDecision({
      mode: drag.mode,
      movedEnough: drag.movedEnough,
      hasPreDragElements: Boolean(drag.preDragElements),
      dragStartSyncGeneration: drag.dragStartSyncGeneration,
      currentSyncGeneration: remoteSyncGenerationRef?.current ?? 0,
    });

    if (decision.shouldRestorePreDrag && drag.preDragElements) {
      const restoreSnapshot = drag.preDragElements;
      onElementsChange(() => restoreSnapshot, { recordUndo: false, flushBroadcast: true });
    }
    schedulePaint(true, true);
  };

  const startDoubleClickEdit = useCallback(
    (el: JevElement, ev?: React.MouseEvent) => {
      if (viewportDirtyRef.current) flushViewportToReact();
      const field = ev ? pickEditField(el, screenToWorld(ev.clientX, ev.clientY)) : "label";
      const session = beginLabelEdit(el, field);
      if (!session) return;
      onSelectIds([el.id]);
      startEdit(session);
    },
    [flushViewportToReact, onSelectIds, screenToWorld, startEdit]
  );

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (tool !== "select" || editState) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, button, [role='dialog']")) return;
    if (viewportDirtyRef.current) flushViewportToReact();
    const world = screenToWorld(e.clientX, e.clientY);
    const hit =
      findShapeAtPoint(world) ??
      [...frames]
        .reverse()
        .find(
          (f) =>
            f.kind === "fragment" &&
            world.x >= f.x &&
            world.x <= f.x + f.width &&
            world.y >= f.y &&
            world.y <= f.y + f.height
        ) ??
      null;
    if (hit && hit.kind !== "freedraw") {
      startDoubleClickEdit(hit, e);
      return;
    }
    createTextAtWorld(world);
  };

  const labelFontClass = renderStyle === "sketch" ? "font-sketch" : "font-sans";
  const editingElement = editingId ? elementsById.get(editingId) : null;
  const activeVp = viewportDirtyRef.current ? liveViewportRef.current : viewport;

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Skot collaborative whiteboard canvas"
      aria-roledescription="interactive whiteboard canvas"
      data-viewport={`${activeVp.x},${activeVp.y},${activeVp.zoom}`}
      tabIndex={0}
      onDoubleClick={handleCanvasDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="relative h-full w-full select-none overflow-hidden touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{
        touchAction: "none",
        backgroundColor: "var(--jev-paper)",
      }}
    >
      {/* Layer 1: Excalidraw-style StaticCanvas (dot grid + cached per-element bitmaps) */}
      <canvas
        ref={staticCanvasRef}
        data-canvas-layer="static"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Layer 2: Excalidraw-style InteractiveCanvas (selection, handles, ghosts, live drag, peer cursors) */}
      <canvas
        ref={interactiveCanvasRef}
        data-canvas-layer="interactive"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Layer 3: Lightweight HTML overlay ONLY for interactive Markdown cards (0 DOM nodes on standard boards) */}
      {markdownNodes.length > 0 && (
        <div
          ref={markdownLayerRef}
          className="pointer-events-none absolute inset-0"
          style={{
            transformOrigin: "0 0",
            transform: `translate3d(${activeVp.x}px, ${activeVp.y}px, 0) scale(${activeVp.zoom})`,
          }}
        >
          {markdownNodes.map((el) => {
            if (editingId === el.id) return null;
            const pal = getTonePalette(el.tone, theme);
            return (
              <div
                key={el.id}
                data-element-id={el.id}
                data-kind="markdown"
                className="pointer-events-auto absolute"
                style={{
                  left: el.x,
                  top: el.y,
                  width: Math.max(40, el.width),
                  height: Math.max(40, el.height),
                }}
              >
                <MarkdownNodeView
                  element={el}
                  palette={pal}
                  theme={theme}
                  isSelected={selectedSet.has(el.id)}
                  onToggleCheckbox={(lineIdx) => toggleMarkdownTask(el.id, lineIdx)}
                  onRequestEdit={() =>
                    startEdit({ id: el.id, field: "sublabel", draft: el.sublabel ?? "", createdForEdit: false })
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Layer 4: Seamless in-place label / markdown editor */}
      {editingElement && (() => {
        const editPal = getTonePalette(editingElement.tone, theme);
        const vp = liveViewportRef.current;
        if (editingElement.kind === "markdown") {
          return (
            <MarkdownNodeEditor
              element={editingElement}
              viewport={vp}
              palette={editPal}
              theme={theme}
              initialTitle={editingElement.label}
              initialBody={editingElement.sublabel ?? ""}
              onRegisterCommit={registerMarkdownCommit}
              onCommit={(next) => commitMarkdownEdit(editingElement.id, next)}
              onCancel={cancelInlineEdit}
            />
          );
        }
        if (editSession && isMultilineField(editingElement.kind, editSession.field)) {
          return (
            <MultilineSublabelEditor
              element={editingElement}
              viewport={vp}
              draft={editSession.draft}
              textColor={editPal.text}
              onChange={setEditDraft}
              onCommit={commitInlineEdit}
              onCancel={cancelInlineEdit}
            />
          );
        }
        const isArrow = editingElement.kind === "arrow";
        const isFrame = isContainerKind(editingElement.kind);
        const isActor = editingElement.kind === "actor";
        const arrowMid = isArrow ? resolveArrowEndpoints(editingElement, elementsById) : null;
        const editSpot = isArrow ? labelSpots.get(editingElement.id) : undefined;
        const width = isArrow
          ? 128
          : isFrame
            ? Math.max(130, 180 * vp.zoom)
            : Math.max(96, (editingElement.width - 20) * vp.zoom);
        const left =
          isArrow && arrowMid
            ? vp.x +
              (editSpot?.x ?? 0.25 * arrowMid.start.x + 0.5 * arrowMid.control.x + 0.25 * arrowMid.end.x) *
                vp.zoom -
              64
            : isFrame
              ? vp.x + (editingElement.x + 12) * vp.zoom
              : isActor
                ? vp.x + (editingElement.x + editingElement.width / 2) * vp.zoom - width / 2
                : vp.x + (editingElement.x + 10) * vp.zoom;
        const top =
          isArrow && arrowMid
            ? vp.y +
              (editSpot?.y ?? 0.25 * arrowMid.start.y + 0.5 * arrowMid.control.y + 0.25 * arrowMid.end.y) *
                vp.zoom -
              14
            : isFrame
              ? vp.y + (editingElement.y + 6) * vp.zoom
              : vp.y +
                (editingElement.y +
                  (isActor
                    ? editSession?.field === "sublabel"
                      ? editingElement.height - 6
                      : editingElement.height - 16
                    : editSession?.field === "sublabel"
                      ? editingElement.height * 0.74
                      : editingElement.kind === "database"
                        ? editingElement.height * 0.54
                        : editingElement.height / 2)) *
                  vp.zoom -
                Math.max(12, 11 * vp.zoom);
        const fontSize = isArrow
          ? 11.5
          : isFrame
            ? Math.max(10, Math.round(11 * vp.zoom))
            : Math.max(11, Math.round(14 * vp.zoom));

        return (
          <div className="absolute z-30" style={{ left, top, width }}>
            <input
              key={`${editingElement.id}:${editSession?.field ?? "label"}`}
              autoFocus
              aria-label={editSession?.field === "sublabel" ? "Edit element sublabel" : "Edit element label"}
              value={editSession?.draft ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setEditDraft(e.target.value)}
              onBlur={(e) => {
                if (e.currentTarget.dataset.closed !== "1") commitInlineEdit();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                const action = editKeyAction(e);
                if (action === "commit") {
                  e.preventDefault();
                  e.currentTarget.dataset.closed = "1";
                  commitInlineEdit();
                } else if (action === "cancel") {
                  e.preventDefault();
                  e.currentTarget.dataset.closed = "1";
                  cancelInlineEdit();
                }
              }}
              style={{
                fontSize: `${fontSize}px`,
                color: isArrow ? undefined : editPal.text,
              }}
              className={`w-full outline-none ${
                isArrow
                  ? "rounded-md border border-[#D94E28]/60 bg-card/95 px-2 py-0.5 text-center font-mono font-medium text-foreground shadow-sm"
                  : isFrame
                    ? "rounded bg-card/90 px-1.5 py-0.5 font-mono font-semibold uppercase tracking-[0.08em] ring-1 ring-[#D94E28]/50"
                    : `${labelFontClass} rounded-md bg-transparent px-1 py-0.5 text-center font-semibold tracking-[-0.01em] caret-[#D94E28] ring-1 ring-[#D94E28]/35`
              }`}
            />
          </div>
        );
      })()}
    </div>
  );
});

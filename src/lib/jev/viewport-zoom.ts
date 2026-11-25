import type { Point, Viewport } from "./types";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8.0;
export const ZOOM_STEP_IN = 1.14;
export const ZOOM_STEP_OUT = 1 / ZOOM_STEP_IN;

/** Chromium synthesizes trackpad pinch as ctrl+wheel where native scale = exp(-deltaY / 100). */
const PINCH_SENSITIVITY = 0.01;
/** Discrete mouse Ctrl/Cmd+wheel (~100px per notch -> ~17% smooth zoom step). */
const WHEEL_ZOOM_SENSITIVITY = 0.0016;
const WHEEL_DELTA_CLAMP = 100;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

function normalizeWheelDelta(delta: number, deltaMode?: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 400;
  return delta;
}

/** Scales the viewport to an exact target `nextZoom`, keeping the world point under screen `anchor` fixed. */
export function zoomToScale(v: Viewport, nextZoom: number, anchor: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / v.zoom;
  return {
    zoom,
    x: anchor.x - (anchor.x - v.x) * ratio,
    y: anchor.y - (anchor.y - v.y) * ratio,
  };
}

/** Scales the viewport by `factor`, keeping the world point under the screen `anchor` fixed. */
export function zoomAroundPoint(v: Viewport, factor: number, anchor: Point): Viewport {
  return zoomToScale(v, v.zoom * factor, anchor);
}

/**
 * Classifies a ctrl/meta+wheel event into trackpad pinch vs discrete mouse wheel notch.
 * Trackpad pinches (including coalesced frames like -66) use Chromium's exact additive exp(-dy / 100);
 * discrete mouse notches (whole multiples >= 100, line/page mode, or Cmd+wheel) use a gentle step.
 */
function isDiscreteMouseWheelZoom(
  rawDy: number,
  e: { deltaMode?: number; ctrlKey: boolean; metaKey: boolean }
): boolean {
  if (e.metaKey) return true;
  if (e.deltaMode && e.deltaMode !== 0) return true;
  const abs = Math.abs(rawDy);
  if (!Number.isInteger(rawDy) || abs < 50) return false;
  // Standard physical mouse wheel notches arrive as 100/120px at 1x DPR or 50/60px at 2x DPR
  return abs >= 100 || abs % 50 === 0 || abs % 60 === 0;
}

/**
 * Excalidraw-compatible wheel handler:
 * - Ctrl/Cmd + wheel (and trackpad pinch) zooms around the cursor (unless Shift is held).
 * - Shift + wheel pans horizontally (Ctrl/Cmd + Shift + wheel pans vertically).
 * - Plain wheel pans smoothly in x and y.
 */
export function wheelViewport(
  v: Viewport,
  e: {
    deltaX: number;
    deltaY: number;
    deltaMode?: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey?: boolean;
  },
  cursor: Point
): Viewport {
  const dx = normalizeWheelDelta(e.deltaX, e.deltaMode);
  const dy = normalizeWheelDelta(e.deltaY, e.deltaMode);
  if (!dx && !dy) return v;

  const hasZoomModifier = e.ctrlKey || e.metaKey;
  if (hasZoomModifier && !e.shiftKey && dy !== 0) {
    const factor = isDiscreteMouseWheelZoom(e.deltaY, e)
      ? Math.exp(-Math.max(-WHEEL_DELTA_CLAMP, Math.min(WHEEL_DELTA_CLAMP, dy)) * WHEEL_ZOOM_SENSITIVITY)
      : Math.exp(-dy * PINCH_SENSITIVITY);
    return zoomAroundPoint(v, factor, cursor);
  }

  if (e.shiftKey) {
    const delta = dy || dx;
    return hasZoomModifier
      ? { ...v, y: v.y - delta }
      : { ...v, x: v.x - delta };
  }

  return { ...v, x: v.x - dx, y: v.y - dy };
}

export type ZoomKeyAction = "in" | "out" | "reset" | "fit";

export function zoomKeyAction(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ZoomKeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "=" || e.key === "+")) return "in";
  if (mod && (e.key === "-" || e.key === "_")) return "out";
  if (mod && e.key === "0") return "reset";
  if (!mod && e.shiftKey && e.code === "Digit1") return "fit";
  return null;
}

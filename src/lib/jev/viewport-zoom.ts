import type { Point, Viewport } from "./types";

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 4.0;
export const ZOOM_STEP_IN = 1.14;
export const ZOOM_STEP_OUT = 1 / ZOOM_STEP_IN;

/** Chromium synthesizes trackpad pinch as ctrl+wheel where native scale = exp(-deltaY / 100). */
const PINCH_SENSITIVITY = 0.01;
/** Discrete mouse Ctrl/Cmd+wheel (~100px per notch -> ~28% zoom step). */
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const WHEEL_DELTA_CLAMP = 120;
const PINCH_DELTA_THRESHOLD = 50;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

function normalizeWheelDelta(delta: number, deltaMode?: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 400;
  return delta;
}

/** Scales the viewport by `factor`, keeping the world point under the screen `anchor` fixed. */
export function zoomAroundPoint(v: Viewport, factor: number, anchor: Point): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const ratio = zoom / v.zoom;
  return {
    zoom,
    x: anchor.x - (anchor.x - v.x) * ratio,
    y: anchor.y - (anchor.y - v.y) * ratio,
  };
}

/** Ctrl/Cmd + wheel (trackpad pinch arrives as ctrl+wheel) zooms around the cursor; a plain wheel pans. */
export function wheelViewport(
  v: Viewport,
  e: { deltaX: number; deltaY: number; deltaMode?: number; ctrlKey: boolean; metaKey: boolean },
  cursor: Point
): Viewport {
  const dx = normalizeWheelDelta(e.deltaX, e.deltaMode);
  const dy = normalizeWheelDelta(e.deltaY, e.deltaMode);
  if (e.ctrlKey || e.metaKey) {
    const isTrackpadPinch = e.ctrlKey && !e.metaKey && Math.abs(dy) < PINCH_DELTA_THRESHOLD;
    const factor = isTrackpadPinch
      ? Math.exp(-dy * PINCH_SENSITIVITY)
      : Math.exp(-Math.max(-WHEEL_DELTA_CLAMP, Math.min(WHEEL_DELTA_CLAMP, dy)) * WHEEL_ZOOM_SENSITIVITY);
    return zoomAroundPoint(v, factor, cursor);
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

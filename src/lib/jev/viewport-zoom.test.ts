import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  wheelViewport,
  zoomAroundPoint,
  zoomKeyAction,
  zoomToScale,
} from "@/lib/jev/viewport-zoom";

const worldAt = (v: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({
  x: (p.x - v.x) / v.zoom,
  y: (p.y - v.y) / v.zoom,
});

describe("viewport zoom (wheel, pinch, keys, buttons)", () => {
  it("zoomAroundPoint keeps the world point under the anchor fixed and clamps", () => {
    const v = { x: 80, y: 40, zoom: 1 };
    const p = { x: 700, y: 450 };
    const zin = zoomAroundPoint(v, 1.25, p);
    expect(zin.zoom).toBeCloseTo(1.25);
    expect(worldAt(zin, p).x).toBeCloseTo(worldAt(v, p).x);
    expect(worldAt(zin, p).y).toBeCloseTo(worldAt(v, p).y);
    expect(zoomAroundPoint(v, 100, p).zoom).toBe(ZOOM_MAX);
    expect(zoomAroundPoint(v, 0.001, p).zoom).toBe(ZOOM_MIN);
  });

  it("ctrl/cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms around the cursor", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const cursor = { x: 300, y: 200 };
    const zin = wheelViewport(v, { deltaX: 0, deltaY: -40, ctrlKey: true, metaKey: false }, cursor);
    expect(zin.zoom).toBeGreaterThan(1);
    expect(worldAt(zin, cursor).x).toBeCloseTo(300);
    const zout = wheelViewport(v, { deltaX: 0, deltaY: 40, ctrlKey: false, metaKey: true }, cursor);
    expect(zout.zoom).toBeLessThan(1);
  });

  it("trackpad pinch (small ctrl+wheel deltas) tracks native Chromium finger scale (~exp(-deltaY/100))", () => {
    let v = { x: 80, y: 40, zoom: 0.532 };
    const cursor = { x: 800, y: 480 };
    for (let i = 0; i < 90; i++) {
      v = wheelViewport(v, { deltaX: 0, deltaY: -1.5, ctrlKey: true, metaKey: false }, cursor);
    }
    const ratio = v.zoom / 0.532;
    const nativeChromiumScale = Math.exp(135 / 100); // ~3.857
    expect(ratio).toBeGreaterThan(nativeChromiumScale * 0.9);
    expect(ratio).toBeLessThan(nativeChromiumScale * 1.1);
  });

  it("discrete mouse ctrl+wheel notches zoom in smooth controlled steps (1x and 2x HiDPI) and normalize deltaMode", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const cursor = { x: 400, y: 300 };
    const oneNotch = wheelViewport(v, { deltaX: 0, deltaY: -100, ctrlKey: true, metaKey: false }, cursor);
    expect(oneNotch.zoom).toBeGreaterThan(1.15);
    expect(oneNotch.zoom).toBeLessThan(1.4);
    const hidpiNotch = wheelViewport(v, { deltaX: 0, deltaY: -50, ctrlKey: true, metaKey: false }, cursor);
    expect(hidpiNotch.zoom).toBeGreaterThan(1.05);
    expect(hidpiNotch.zoom).toBeLessThan(1.2);
    const lineMode = wheelViewport(v, { deltaX: 0, deltaY: -3, deltaMode: 1, ctrlKey: false, metaKey: false }, cursor);
    expect(lineMode.y).toBeGreaterThan(20);
  });

  it("supports wide enough zoom range for large interview diagrams (0.15x to 4x)", () => {
    expect(ZOOM_MIN).toBeLessThanOrEqual(0.2);
    expect(ZOOM_MAX).toBeGreaterThanOrEqual(3.5);
  });

  it("a slow frame loses no pinch: one coalesced event of -66 equals twelve of -5.5", () => {
    const start = { x: 80, y: 40, zoom: 1 };
    const cursor = { x: 640, y: 360 };
    let stepped = start;
    for (let i = 0; i < 12; i++) {
      stepped = wheelViewport(stepped, { deltaX: 0, deltaY: -5.5, ctrlKey: true, metaKey: false }, cursor);
    }
    const coalesced = wheelViewport(start, { deltaX: 0, deltaY: -66, ctrlKey: true, metaKey: false }, cursor);
    expect(coalesced.zoom).toBeCloseTo(stepped.zoom, 5);
    expect(coalesced.x).toBeCloseTo(stepped.x, 3);
    expect(coalesced.y).toBeCloseTo(stepped.y, 3);
  });

  it("zoomToScale supports Safari desktop gesturechange anchored at the cursor", () => {
    const v = { x: 120, y: 80, zoom: 1.0 };
    const cursor = { x: 500, y: 350 };
    const z = zoomToScale(v, 1.85, cursor);
    expect(z.zoom).toBeCloseTo(1.85, 5);
    expect(worldAt(z, cursor).x).toBeCloseTo(worldAt(v, cursor).x, 4);
    expect(worldAt(z, cursor).y).toBeCloseTo(worldAt(v, cursor).y, 4);
  });

  it("a plain wheel pans by the deltas, and Shift+wheel pans horizontally like Excalidraw", () => {
    expect(
      wheelViewport({ x: 10, y: 20, zoom: 1.5 }, { deltaX: 5, deltaY: -7, ctrlKey: false, metaKey: false }, { x: 0, y: 0 })
    ).toEqual({ x: 5, y: 27, zoom: 1.5 });
    expect(
      wheelViewport({ x: 10, y: 20, zoom: 1.5 }, { deltaX: 0, deltaY: 40, ctrlKey: false, metaKey: false, shiftKey: true }, { x: 0, y: 0 })
    ).toEqual({ x: -30, y: 20, zoom: 1.5 });
  });

  it("maps Ctrl/Cmd + = / + / - / 0 and Shift+1 to zoom actions, and leaves other keys alone", () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string }> = {}) =>
      zoomKeyAction({ key, code: mods.code ?? "", ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
    expect(k("=", { ctrlKey: true })).toBe("in");
    expect(k("+", { metaKey: true, shiftKey: true })).toBe("in");
    expect(k("-", { ctrlKey: true })).toBe("out");
    expect(k("0", { metaKey: true })).toBe("reset");
    expect(k("!", { shiftKey: true, code: "Digit1" })).toBe("fit");
    expect(k("1")).toBeNull();
    expect(k("=")).toBeNull();
    expect(k("0")).toBeNull();
  });
});

describe("wheel listener & canvas performance wiring", () => {
  it("registers a single stable { passive: false } wheel listener (never re-bound per viewport change) and memoizes arrows/freedraws", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../../components/jev");
    const hits = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /onWheel=/.test(readFileSync(path.join(dir, f), "utf8")));
    expect(hits).toEqual([]);
    const canvas = readFileSync(path.join(dir, "JevCanvas.tsx"), "utf8");
    expect(canvas).toMatch(/addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
    // Regression check (25 Nov interview lag): wheel listener must never read stale viewport closure or tear down on viewport changes
    expect(canvas).not.toMatch(/wheelViewport\(\s*viewport\s*,/);
    expect(canvas).toMatch(/liveViewportRef/);
    // Excalidraw-grade dual HTML5 <canvas> 2D engine + Safari gesture support + per-element offscreen bitmap cache
    expect(canvas).toMatch(/ElementBitmapCache/);
    expect(canvas).toMatch(/shouldCacheIgnoreZoomRef/);
    expect(canvas).toMatch(/addEventListener\("gesturestart"/);
    expect(canvas).toMatch(/addEventListener\("gesturechange"/);
    // Background dot grid must not mutate backgroundImage radial-gradient string on every zoom tick
    expect(canvas).not.toMatch(/backgroundImage:\s*`radial-gradient\([^`]*viewport\.zoom/);
  });
});

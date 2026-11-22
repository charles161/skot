import { describe, expect, it } from "vitest";
import {
  computeBounds,
  computeViewportEnsureVisible,
  computeViewportKeepBoard,
  computeViewportPanTo,
  computeViewportFit,
  distanceBetween,
  findFreeSpot,
  getBoundaryPoint,
  getEdgeHandles,
  getElementCenter,
  getElementRect,
  isShapeElement,
  makeSeed,
  pointToSegmentDistance,
  rectContainsCenter,
  rectsOverlap,
  resolveArrowEndpoints,
  uid,
} from "@/lib/jev/geometry";
import type { ElementKind, JevElement } from "@/lib/jev/types";

function makeEl(overrides: Partial<JevElement> = {}): JevElement {
  return {
    id: overrides.id ?? "el_1",
    kind: overrides.kind ?? "node",
    x: overrides.x ?? 100,
    y: overrides.y ?? 200,
    width: overrides.width ?? 160,
    height: overrides.height ?? 80,
    label: overrides.label ?? "Node",
    tone: overrides.tone ?? "ink",
    seed: overrides.seed ?? 42,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("geometry utilities", () => {
  it("classifies shape vs non-shape element kinds accurately", () => {
    const shapeKinds: ElementKind[] = [
      "node",
      "diamond",
      "database",
      "ellipse",
      "frame",
      "text",
    ];
    const nonShapeKinds: ElementKind[] = ["arrow", "freedraw"];

    for (const kind of shapeKinds) {
      expect(isShapeElement(makeEl({ kind }))).toBe(true);
    }
    for (const kind of nonShapeKinds) {
      expect(isShapeElement(makeEl({ kind }))).toBe(false);
    }
  });

  it("computes centers, rects, and 4 cardinal edge handles including negative/extreme coordinates", () => {
    const el = makeEl({ x: -10000, y: 25000, width: 200, height: 100 });
    expect(getElementCenter(el)).toEqual({ x: -9900, y: 25050 });
    expect(getElementRect(el)).toEqual({
      x: -10000,
      y: 25000,
      width: 200,
      height: 100,
    });
    expect(getEdgeHandles(el)).toEqual([
      { side: "top", point: { x: -9900, y: 25000 } },
      { side: "right", point: { x: -9800, y: 25050 } },
      { side: "bottom", point: { x: -9900, y: 25100 } },
      { side: "left", point: { x: -10000, y: 25050 } },
    ]);
  });

  it("computes Euclidean distances and point-to-segment distances including degenerate segments", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceBetween({ x: -5, y: 7 }, { x: -5, y: 7 })).toBe(0);

    // Degenerate zero-length segment falls back to endpoint distance
    expect(
      pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    ).toBe(5);

    // Perpendicular projection onto middle of segment
    expect(
      pointToSegmentDistance({ x: 5, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    ).toBeCloseTo(10, 6);

    // Projection clamped past start and past end
    expect(
      pointToSegmentDistance({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    ).toBeCloseTo(5, 6);
    expect(
      pointToSegmentDistance({ x: 13, y: -4 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    ).toBeCloseTo(5, 6);
  });

  it("evaluates rect overlap with padding and center containment", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const touching = { x: 100, y: 0, width: 100, height: 50 };
    const separated = { x: 120, y: 0, width: 100, height: 50 };

    expect(rectsOverlap(a, touching, 0)).toBe(true);
    expect(rectsOverlap(a, separated, 0)).toBe(false);
    expect(rectsOverlap(a, separated, 20)).toBe(true);
    expect(rectsOverlap(a, separated, 19)).toBe(false);

    const outer = { x: 10, y: 20, width: 200, height: 100 };
    expect(rectContainsCenter(outer, { x: 50, y: 40, width: 20, height: 20 })).toBe(true);
    // Center exactly on boundary counts as contained
    expect(rectContainsCenter(outer, { x: 0, y: 10, width: 20, height: 20 })).toBe(true);
    // Center outside outer rect
    expect(rectContainsCenter(outer, { x: 205, y: 40, width: 20, height: 20 })).toBe(false);
  });

  it("computes shape boundary anchor points for rectangles, ellipses, diamonds, and coincident points", () => {
    const rect = makeEl({ kind: "node", x: 0, y: 0, width: 100, height: 60 });
    // Center is (50, 30), hw = 54, hh = 34
    expect(getBoundaryPoint(rect, { x: 50, y: 30 })).toEqual({ x: 50, y: 30 });
    expect(getBoundaryPoint(rect, { x: 500, y: 30 })).toEqual({ x: 104, y: 30 });
    expect(getBoundaryPoint(rect, { x: -500, y: 30 })).toEqual({ x: -4, y: 30 });
    expect(getBoundaryPoint(rect, { x: 50, y: 500 })).toEqual({ x: 50, y: 64 });
    expect(getBoundaryPoint(rect, { x: 50, y: -500 })).toEqual({ x: 50, y: -4 });

    const ellipse = makeEl({ kind: "ellipse", x: 0, y: 0, width: 100, height: 60 });
    const ellipseRight = getBoundaryPoint(ellipse, { x: 200, y: 30 });
    expect(ellipseRight.x).toBeCloseTo(104, 5);
    expect(ellipseRight.y).toBeCloseTo(30, 5);
    const ellipseDiag = getBoundaryPoint(ellipse, { x: 150, y: 130 });
    // Point lies on padded ellipse ((x-cx)/hw)^2 + ((y-cy)/hh)^2 = 1
    const normEllipse =
      ((ellipseDiag.x - 50) / 54) ** 2 + ((ellipseDiag.y - 30) / 34) ** 2;
    expect(normEllipse).toBeCloseTo(1, 5);

    const diamond = makeEl({ kind: "diamond", x: 0, y: 0, width: 100, height: 60 });
    const diamondDiag = getBoundaryPoint(diamond, { x: 150, y: 130 });
    // Point lies on padded L1 diamond |x-cx|/hw + |y-cy|/hh = 1
    const normDiamond =
      Math.abs(diamondDiag.x - 50) / 54 + Math.abs(diamondDiag.y - 30) / 34;
    expect(normDiamond).toBeCloseTo(1, 5);
  });

  it("anchors arrows on the visible outline of circular pseudo-states and the load-balancer hexagon", () => {
    for (const kind of ["initial", "final"] as const) {
      const dot = makeEl({ kind, x: 0, y: 0, width: 30, height: 30 });
      for (const toward of [{ x: 300, y: 15 }, { x: 200, y: 200 }, { x: -100, y: -40 }]) {
        const p = getBoundaryPoint(dot, toward);
        expect(Math.hypot(p.x - 15, p.y - 15)).toBeCloseTo(15 + 3, 5);
      }
    }

    const lb = makeEl({ kind: "lb", x: 0, y: 0, width: 132, height: 76 });
    // Straight right hits the hexagon's pointy vertex, padded like a rectangle
    const right = getBoundaryPoint(lb, { x: 1000, y: 38 });
    expect(right.x).toBeCloseTo(136, 5);
    expect(right.y).toBeCloseTo(38, 5);
    // Straight up hits the flat top edge
    expect(getBoundaryPoint(lb, { x: 66, y: -500 }).y).toBeCloseTo(-4, 5);
    // Toward the bounding-box corner the hexagon is cut away, so the anchor sits well inside the box corner
    const corner = getBoundaryPoint(lb, { x: 132 + 66, y: -38 });
    const rectCorner = getBoundaryPoint(makeEl({ kind: "node", x: 0, y: 0, width: 132, height: 76 }), { x: 132 + 66, y: -38 });
    expect(Math.hypot(corner.x - 66, corner.y - 38)).toBeLessThan(Math.hypot(rectCorner.x - 66, rectCorner.y - 38) - 6);
  });

  it("resolves arrow endpoints for bound, half-bound, unbound, straight, and diagonal curved arrows", () => {
    const a = makeEl({ id: "a", x: 0, y: 0, width: 100, height: 60 });
    const b = makeEl({ id: "b", x: 300, y: 200, width: 100, height: 60 });
    const c = makeEl({ id: "c", x: 300, y: 0, width: 100, height: 60 });
    const map = new Map([
      [a.id, a],
      [b.id, b],
      [c.id, c],
    ]);

    // Diagonal curved arrow gets perpendicular curve offset
    const diagArrow = makeEl({
      id: "arr_diag",
      kind: "arrow",
      fromId: a.id,
      toId: b.id,
      arrowStyle: "curved",
    });
    const diagRes = resolveArrowEndpoints(diagArrow, map);
    const diagMidX = (diagRes.start.x + diagRes.end.x) / 2;
    const diagMidY = (diagRes.start.y + diagRes.end.y) / 2;
    expect(
      distanceBetween(diagRes.control, { x: diagMidX, y: diagMidY })
    ).toBeGreaterThan(5);

    // Axis-aligned horizontal arrow stays straight (offset 0)
    const horizArrow = makeEl({
      id: "arr_horiz",
      kind: "arrow",
      fromId: a.id,
      toId: c.id,
      arrowStyle: "curved",
    });
    const horizRes = resolveArrowEndpoints(horizArrow, map);
    expect(horizRes.start).toEqual({ x: 104, y: 30 });
    expect(horizRes.end).toEqual({ x: 296, y: 30 });
    expect(horizRes.control).toEqual({ x: 200, y: 30 });

    // Explicit straight style disables curve even when diagonal
    const straightDiag = resolveArrowEndpoints(
      { ...diagArrow, arrowStyle: "straight" },
      map
    );
    expect(straightDiag.control.x).toBeCloseTo(
      (straightDiag.start.x + straightDiag.end.x) / 2,
      5
    );
    expect(straightDiag.control.y).toBeCloseTo(
      (straightDiag.start.y + straightDiag.end.y) / 2,
      5
    );

    // Half-bound arrow (only fromId resolves)
    const halfFrom = resolveArrowEndpoints(
      makeEl({
        kind: "arrow",
        fromId: a.id,
        toId: "missing",
        toPoint: { x: 400, y: 30 },
      }),
      map
    );
    expect(halfFrom.start).toEqual({ x: 104, y: 30 });
    expect(halfFrom.end).toEqual({ x: 400, y: 30 });

    // Half-bound arrow (only toId resolves)
    const halfTo = resolveArrowEndpoints(
      makeEl({
        kind: "arrow",
        fromPoint: { x: 0, y: 30 },
        toId: c.id,
      }),
      map
    );
    expect(halfTo.start).toEqual({ x: 0, y: 30 });
    expect(halfTo.end).toEqual({ x: 296, y: 30 });

    // Unbound arrow without fromPoint/toPoint falls back to x/y/width/height
    const fallbackArrow = resolveArrowEndpoints(
      makeEl({ kind: "arrow", x: 10, y: 20, width: 30, height: 10 }),
      map
    );
    expect(fallbackArrow.start).toEqual({ x: 10, y: 20 });
    expect(fallbackArrow.end).toEqual({ x: 40, y: 30 });
  });

  it("computes bounding boxes across shapes, freedraw strokes, unbound arrows, and empty inputs", () => {
    expect(computeBounds([])).toBeNull();

    // Bound arrows with no explicit points have no intrinsic bounds
    const boundArrowOnly = makeEl({
      kind: "arrow",
      fromId: "a",
      toId: "b",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(computeBounds([boundArrowOnly])).toBeNull();

    // Unbound arrow with fromPoint / toPoint
    const freeArrow = makeEl({
      kind: "arrow",
      fromPoint: { x: -50, y: 10 },
      toPoint: { x: 30, y: 90 },
    });
    expect(computeBounds([freeArrow])).toEqual({
      x: -50,
      y: 10,
      width: 80,
      height: 80,
    });

    // Freedraw with points and degenerate single-point freedraw (width/height clamped >= 1)
    const stroke = makeEl({
      kind: "freedraw",
      points: [
        { x: 12, y: 18 },
        { x: 44, y: 62 },
        { x: 20, y: -5 },
      ],
    });
    expect(computeBounds([stroke])).toEqual({
      x: 12,
      y: -5,
      width: 32,
      height: 67,
    });

    const singleDot = makeEl({
      kind: "freedraw",
      points: [{ x: 100, y: 200 }],
    });
    expect(computeBounds([singleDot])).toEqual({
      x: 100,
      y: 200,
      width: 1,
      height: 1,
    });

    // Degenerate empty-points freedraw falls back to el rect
    const emptyFreedraw = makeEl({
      kind: "freedraw",
      x: 5,
      y: 6,
      width: 40,
      height: 20,
      points: [],
    });
    expect(computeBounds([emptyFreedraw])).toEqual({
      x: 5,
      y: 6,
      width: 40,
      height: 20,
    });
  });

  it("generates deterministic positive FNV-1a seeds and unique prefixed IDs", () => {
    const inputs = ["", "el_1", "starter_user", "🚀 unicode 中文", "x".repeat(500)];
    for (const input of inputs) {
      const s1 = makeSeed(input);
      const s2 = makeSeed(input);
      expect(s1).toBe(s2);
      expect(Number.isInteger(s1)).toBe(true);
      expect(s1).toBeGreaterThanOrEqual(1);
      expect(s1).toBeLessThanOrEqual(2147483640);
    }
    expect(makeSeed("alpha")).not.toBe(makeSeed("beta"));

    const ids = new Set(Array.from({ length: 100 }, () => uid("node")));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id.startsWith("node_")).toBe(true);
    }
  });

  it("finds collision-free spots while ignoring frames and arrows", () => {
    const preferred = { x: 100, y: 100, width: 160, height: 72 };
    const frame = makeEl({ id: "frm", kind: "frame", x: 50, y: 50, width: 400, height: 300 });
    const arrow = makeEl({ id: "arr", kind: "arrow", x: 100, y: 100, width: 100, height: 100 });

    // Frames and arrows do not block placement
    expect(findFreeSpot(preferred, [frame, arrow])).toEqual(preferred);

    // Colliding shape shifts candidate to a non-overlapping position
    const blocker = makeEl({ id: "blk", kind: "node", x: 100, y: 100, width: 160, height: 72 });
    const spot = findFreeSpot(preferred, [blocker]);
    expect(rectsOverlap(spot, getElementRect(blocker), 16)).toBe(false);
  });

  it("computes HUD-aware viewport fit so wide diagrams never clip off-canvas at 1440px or 390px", () => {
    const wideBounds = { x: 100, y: 180, width: 1500, height: 320 };
    const margins = { top: 104, right: 72, bottom: 240, left: 72 };
    const vp = computeViewportFit(wideBounds, {
      screenWidth: 1440,
      screenHeight: 900,
      margins,
    });

    const sx1 = vp.x + wideBounds.x * vp.zoom;
    const sy1 = vp.y + wideBounds.y * vp.zoom;
    const sx2 = sx1 + wideBounds.width * vp.zoom;
    const sy2 = sy1 + wideBounds.height * vp.zoom;

    expect(sx1).toBeGreaterThanOrEqual(margins.left - 1);
    expect(sx2).toBeLessThanOrEqual(1440 - margins.right + 1);
    expect(sy1).toBeGreaterThanOrEqual(margins.top - 1);
    expect(sy2).toBeLessThanOrEqual(900 - margins.bottom + 1);

    // Mobile 390x844 fits safely without clipping
    const mobileVp = computeViewportFit(wideBounds, {
      screenWidth: 390,
      screenHeight: 844,
      minZoom: 0.2,
    });
    const mx1 = mobileVp.x + wideBounds.x * mobileVp.zoom;
    const mx2 = mx1 + wideBounds.width * mobileVp.zoom;
    expect(mx1).toBeGreaterThanOrEqual(0);
    expect(mx2).toBeLessThanOrEqual(390);
  });

  it("ensures ghost/target bounds stay visible by preserving zoom when panning suffices and zooming out when wider than viewport", () => {
    const margins = { top: 100, right: 64, bottom: 240, left: 64 };
    const baseVp = { x: 80, y: 40, zoom: 1 };

    // Already completely inside safe area -> returns exact same viewport
    const insideBounds = { x: 120, y: 150, width: 400, height: 180 };
    const unchanged = computeViewportEnsureVisible(baseVp, insideBounds, {
      screenWidth: 1440,
      screenHeight: 900,
      margins,
    });
    expect(unchanged).toEqual(baseVp);

    // Extends off the right edge at 1440px, but fits at zoom=1 -> pans gently, keeps zoom=1
    const rightSpill = { x: 1100, y: 200, width: 420, height: 120 };
    const panned = computeViewportEnsureVisible(baseVp, rightSpill, {
      screenWidth: 1440,
      screenHeight: 900,
      margins,
    });
    expect(panned.zoom).toBe(1);
    expect(panned.x + (rightSpill.x + rightSpill.width) * panned.zoom).toBeLessThanOrEqual(
      1440 - margins.right + 1
    );
    expect(panned.x + rightSpill.x * panned.zoom).toBeGreaterThanOrEqual(
      margins.left - 1
    );

    // Combined selection + fork preview wider than 1440px -> zooms out so nothing clips
    const hugeForkBounds = { x: 80, y: 160, width: 1750, height: 340 };
    const zoomedOut = computeViewportEnsureVisible(baseVp, hugeForkBounds, {
      screenWidth: 1440,
      screenHeight: 900,
      margins,
    });
    expect(zoomedOut.zoom).toBeLessThan(1);
    expect(zoomedOut.x + hugeForkBounds.x * zoomedOut.zoom).toBeGreaterThanOrEqual(
      margins.left - 1
    );
    expect(
      zoomedOut.x + (hugeForkBounds.x + hugeForkBounds.width) * zoomedOut.zoom
    ).toBeLessThanOrEqual(1440 - margins.right + 1);
  });
});

// Judges on prod, 22 Nov: as a row of nodes grew, the view followed the newest and the first ones scrolled away.
describe("computeViewportKeepBoard: a growing diagram stays whole", () => {
  const screen = { screenWidth: 1440, screenHeight: 900, margins: { top: 104, right: 64, bottom: 255, left: 64 } };
  const vp = { x: 0, y: 0, zoom: 1 };
  const node = (x: number) => ({ x, y: 300, width: 172, height: 72 });
  const onScreen = (v: { x: number; y: number; zoom: number }, r: { x: number; y: number; width: number; height: number }) =>
    v.x + r.x * v.zoom >= 62 && v.x + (r.x + r.width) * v.zoom <= 1440 - 62 && v.y + r.y * v.zoom >= 102 && v.y + (r.y + r.height) * v.zoom <= 900 - 253;

  it("does not move while the new node is already in view", () => {
    expect(computeViewportKeepBoard(vp, node(600), { x: 100, y: 300, width: 400, height: 72 }, screen)).toBe(vp);
  });

  it("zooms out to show the first node and the new one when the new one is off screen", () => {
    const board = { x: 100, y: 300, width: 1272, height: 72 };
    const next = computeViewportKeepBoard(vp, node(1500), board, screen);
    expect(next.zoom).toBeLessThan(1);
    expect(next.zoom).toBeGreaterThanOrEqual(0.5);
    expect(onScreen(next, node(100))).toBe(true);
    expect(onScreen(next, node(1500))).toBe(true);
  });

  it("never zooms in, and pans to the new node once the whole board would be unreadable", () => {
    const small = { x: 100, y: 300, width: 172, height: 72 };
    expect(computeViewportKeepBoard({ x: 0, y: 0, zoom: 0.8 }, node(2000), small, screen).zoom).toBeLessThanOrEqual(0.8);
    const huge = { x: 100, y: 300, width: 6000, height: 72 };
    const next = computeViewportKeepBoard(vp, node(6400), huge, screen);
    expect(next.zoom).toBe(1);
    expect(onScreen(next, node(6400))).toBe(true);
  });

  // Charles, 22 Nov (5A): "on a phone keep text readable and pan to the newest node, instead of zooming out to fit
  // the whole board." Before: nine typed names took a phone from zoom 1 to 0.68.
  describe("on a phone", () => {
    const phone = { screenWidth: 390, screenHeight: 844, margins: { top: 104, right: 16, bottom: 150, left: 16 } };
    const start = { x: 30, y: 150, zoom: 1 };
    const inView = (v: { x: number; y: number; zoom: number }, r: { x: number; y: number; width: number; height: number }) =>
      v.x + r.x * v.zoom >= 15 && v.x + (r.x + r.width) * v.zoom <= 390 - 15 && v.y + r.y * v.zoom >= 103 && v.y + (r.y + r.height) * v.zoom <= 844 - 149;

    it("a new node off screen pans the view to it and leaves the zoom alone", () => {
      const board = { x: 60, y: 100, width: 172, height: 900 };
      const newest = { x: 60, y: 1100, width: 172, height: 72 };
      const next = computeViewportKeepBoard(start, newest, board, phone);
      expect(next.zoom).toBe(1);
      expect(inView(next, newest)).toBe(true);
    });

    it("keeps whatever zoom the user chose, in or out", () => {
      const newest = { x: 900, y: 1100, width: 172, height: 72 };
      for (const zoom of [0.53, 0.8, 1.4]) {
        const next = computeViewportKeepBoard({ x: 30, y: 150, zoom }, newest, { x: 0, y: 0, width: 600, height: 600 }, phone);
        expect(next.zoom).toBe(zoom);
        expect(inView(next, newest)).toBe(true);
      }
    });

    it("does not move while the new node is already in view", () => {
      const view = { x: 0, y: 0, zoom: 1 };
      expect(computeViewportKeepBoard(view, { x: 60, y: 300, width: 172, height: 72 }, null, phone)).toBe(view);
    });

    it("a block bigger than the screen is centred, still at the same zoom", () => {
      const block = { x: 0, y: 0, width: 900, height: 300 };
      const next = computeViewportPanTo({ x: 0, y: 0, zoom: 1 }, block, phone);
      expect(next.zoom).toBe(1);
      expect(next.x + 450).toBe((16 + 390 - 16) / 2);
    });
  });
});

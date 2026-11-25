import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EdgeHandles } from "@/components/jev/EdgeHandles";
import {
  EDGE_HANDLE_HIT_RADIUS,
  EDGE_HANDLE_HOVER_SCALE,
  EDGE_HANDLE_RADIUS,
  EDGE_HANDLE_STROKE,
  getEdgeHandles,
  pointOnEdgeHandle,
} from "@/lib/jev/geometry";
import type { JevElement } from "@/lib/jev/types";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function makeNode(overrides: Partial<JevElement> = {}): JevElement {
  return {
    id: "n1",
    kind: "node",
    x: 300,
    y: 120,
    width: 190,
    height: 91,
    label: "Server",
    tone: "slate",
    seed: 42,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as JevElement;
}

const render = (el: JevElement) =>
  renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(EdgeHandles, {
        el,
        fill: "#FFFDF8",
        stroke: "#D94E28",
        onHandlePointerDown: () => {},
      }),
    ),
  );

const attrs = (markup: string, cls: string) =>
  [...markup.matchAll(new RegExp(`<circle[^>]*class="${cls}"[^>]*>`, "g"))].map((m) => m[0]);
const num = (tag: string, name: string) => Number(tag.match(new RegExp(` ${name}="([^"]+)"`))?.[1]);

describe("edge connection handles: stable under hover (no shaking)", () => {
  it("renders identical markup across re-renders (position and shape are stable)", () => {
    const el = makeNode();
    const first = render(el);
    for (let i = 0; i < 5; i++) expect(render(makeNode())).toBe(first);
  });

  it("places each dot and its hit circle exactly on the node edge midpoints, in node-local coords", () => {
    const el = makeNode();
    const markup = render(el);
    const dots = attrs(markup, "jev-edge-handle__dot");
    const hits = attrs(markup, "jev-edge-handle__hit");
    const expected = getEdgeHandles(el).map((h) => ({ x: h.point.x - el.x, y: h.point.y - el.y }));
    expect(dots.map((d) => ({ x: num(d, "cx"), y: num(d, "cy") }))).toEqual(expected);
    expect(hits.map((d) => ({ x: num(d, "cx"), y: num(d, "cy") }))).toEqual(expected);
  });

  it("is plain SVG with no rough.js randomness (no generated paths) and no SMIL animation", () => {
    const markup = render(makeNode());
    expect(markup).not.toMatch(/<path/);
    expect(markup).not.toMatch(/<animate/);
    expect(markup).not.toMatch(/animate-|jev-ghost-pulse/);
  });

  it("the visual dot never takes pointer events; only the unscaled hit circle does", () => {
    const markup = render(makeNode());
    for (const dot of attrs(markup, "jev-edge-handle__dot")) {
      expect(dot).toMatch(/pointer-events="none"/);
    }
    for (const hit of attrs(markup, "jev-edge-handle__hit")) {
      expect(hit).toMatch(/pointer-events="all"/);
      expect(num(hit, "r")).toBe(EDGE_HANDLE_HIT_RADIUS);
    }
  });

  it("the hit circle fully contains the dot even at its hover scale", () => {
    expect(EDGE_HANDLE_HIT_RADIUS).toBeGreaterThanOrEqual(
      EDGE_HANDLE_RADIUS * EDGE_HANDLE_HOVER_SCALE + EDGE_HANDLE_STROKE,
    );
  });
});

describe("node hover zone includes its handles (moving node -> handle keeps hover)", () => {
  it("every point of every handle's hit circle counts as being on that node's handle", () => {
    const el = makeNode();
    for (const h of getEdgeHandles(el)) {
      for (let a = 0; a < 360; a += 15) {
        const r = EDGE_HANDLE_HIT_RADIUS - 0.01;
        const pt = {
          x: h.point.x + r * Math.cos((a * Math.PI) / 180),
          y: h.point.y + r * Math.sin((a * Math.PI) / 180),
        };
        expect(pointOnEdgeHandle(el, pt), `${h.side} @${a}deg`).toBe(h.side);
      }
    }
  });

  it("the outer half of the left handle (outside the node's padded rect) is still on the handle", () => {
    const el = makeNode();
    expect(pointOnEdgeHandle(el, { x: el.x - EDGE_HANDLE_RADIUS - 1, y: el.y + el.height / 2 })).toBe("left");
  });

  it("points away from the handles are not on a handle", () => {
    const el = makeNode();
    expect(pointOnEdgeHandle(el, { x: el.x - 40, y: el.y + el.height / 2 })).toBeNull();
    expect(pointOnEdgeHandle(el, { x: el.x + el.width / 2, y: el.y + el.height / 2 })).toBeNull();
  });

  it("JevCanvas keeps the hovered node while the pointer is on one of its handles", () => {
    const src = read("src/components/jev/JevCanvas.tsx");
    const move = src.slice(src.indexOf("const handlePointerMove"), src.indexOf("if (drag.mode === \"pan\")"));
    expect(move).toMatch(/pointOnEdgeHandle\(/);
  });

  it("renders edge handles through one shared geometry helper (getEdgeHandles in canvas-renderer)", () => {
    const renderer = read("src/lib/jev/canvas-renderer.ts");
    expect(renderer).toMatch(/getEdgeHandles\(/);
  });
});

describe("handle CSS: hover feedback cannot move the hit area or loop", () => {
  const css = read("src/app/globals.css");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const handleRules = rules.filter((r) => r.sel.includes("jev-edge-handle"));

  it("the dot scales about its own centre, not the node's origin", () => {
    const dot = handleRules.find((r) => /^\.jev-edge-handle__dot$/.test(r.sel));
    expect(dot, ".jev-edge-handle__dot rule").toBeTruthy();
    expect(dot!.body).toMatch(/transform-box:\s*fill-box/);
    expect(dot!.body).toMatch(/transform-origin:\s*center/);
  });

  it("no handle rule uses a CSS animation (only a one-shot transition)", () => {
    expect(handleRules.length).toBeGreaterThan(0);
    for (const r of handleRules) expect(r.body, r.sel).not.toMatch(/animation/);
  });

  it("the hover scale in CSS matches EDGE_HANDLE_HOVER_SCALE", () => {
    const hover = handleRules.find((r) => r.sel.includes(":hover"));
    expect(hover?.body).toMatch(new RegExp(`scale\\(${EDGE_HANDLE_HOVER_SCALE}\\)`));
  });

  it("prefers-reduced-motion turns off the handle hover transition", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}\n", start));
    expect(block).toMatch(/\.jev-edge-handle__dot\s*\{[^}]*transition:\s*none/);
  });
});

const SVG_TAGS = new Set(["circle", "rect", "path", "g", "ellipse", "line", "polygon", "polyline", "text"]);
const TRANSFORM_UTILITY = /(^|\s)(?:[a-z-]+:)*-?(?:scale|translate|rotate|skew)-/;

describe("lint: no Tailwind transform utilities on SVG elements in the canvas", () => {
  for (const rel of ["src/components/jev/JevCanvas.tsx", "src/components/jev/EdgeHandles.tsx"]) {
    it(`${rel} has none`, () => {
      const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const offenders: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(sf);
          if (SVG_TAGS.has(tag)) {
            for (const a of node.attributes.properties) {
              if (ts.isJsxAttribute(a) && a.name.getText(sf) === "className" && a.initializer) {
                const text = a.initializer.getText(sf);
                if (TRANSFORM_UTILITY.test(text.replace(/["'`{}]/g, " "))) {
                  const { line } = sf.getLineAndCharacterOfPosition(a.getStart(sf));
                  offenders.push(`${rel}:${line + 1} <${tag} className=${text}>`);
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      expect(
        offenders,
        "SVG transform utilities scale/translate around the parent group's origin and move the hit area out from " +
          "under the pointer (the handle shake). Put hover feedback on a pointer-events:none child styled in " +
          "globals.css with transform-box: fill-box; transform-origin: center.",
      ).toEqual([]);
    });
  }
});

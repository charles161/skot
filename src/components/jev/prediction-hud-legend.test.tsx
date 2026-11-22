// Judges, 21 Nov: with partial text Tab completes the word first, but the legend only said "Tab cycle".
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PredictionHud } from "@/components/jev/PredictionHud";
import type { PredictedAction } from "@/lib/jev/types";

const pred = (id: string): PredictedAction => ({ id, title: id, subtitle: "s", category: "extend", addElements: [], tier: "minimal", nodeCount: 1 });
const base = { intent: null, predictions: [pred("a"), pred("b"), pred("c")], activeIndex: 0, telemetry: null, onHoverIndex: () => {}, onApply: () => {}, onDismiss: () => {} };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Core loop, 22 Nov: the legend names what Enter and Tab do right now, Enter first.
const node = (id: string): PredictedAction => ({ ...pred(id), addElements: [{ id, kind: "node", label: id, x: 0, y: 0, width: 10, height: 10, tone: "ink", seed: 1, createdAt: 1, updatedAt: 1 }] });
const link: PredictedAction = { id: "l", title: "App → API", subtitle: "connect · calls", category: "connect", nodeCount: 0, addElements: [{ id: "arr", kind: "arrow", label: "", x: 0, y: 0, width: 0, height: 0, tone: "ink", seed: 1, fromId: "a", toId: "b", createdAt: 1, updatedAt: 1 }] };
const legend = (html: string) => text(html.match(/<div data-key-legend[^>]*>(.*?)<\/div>/)?.[1] ?? "").trim();

describe("the key legend says what Enter and Tab will do", () => {
  const typed = { ...base, predictions: [node("a"), node("b"), node("c")], typing: true };
  it("while typing a partial word: Enter adds the node, Tab completes the word", () => {
    expect(legend(renderToStaticMarkup(<PredictionHud {...typed} completion="API Gateway" />))).toBe("Enter ↵ add node · Tab complete to API Gateway");
  });
  it("while typing a full name: Enter adds the node, Tab reaches the bigger options", () => {
    expect(legend(renderToStaticMarkup(<PredictionHud {...typed} />))).toBe("Enter ↵ add node · Tab bigger options");
  });
  it("after Tab moved to a bigger option: Enter draws that option", () => {
    expect(legend(renderToStaticMarkup(<PredictionHud {...typed} activeIndex={2} />))).toBe("Enter ↵ draw option 3 · Tab bigger options");
  });
  it("on an offered connection: Enter connects, Tab moves on, Esc dismisses", () => {
    const html = renderToStaticMarkup(<PredictionHud {...base} predictions={[link, node("b"), node("c")]} />);
    expect(legend(html)).toBe("Enter ↵ connect · Tab next option · Esc dismiss");
    expect(text(html)).toMatch(/Connect or grow/);
  });
  // Round-2 judge, prod: with option 2 highlighted the hint still said "Connect API Gateway? Enter accepts".
  it("the hint above the panel follows the highlighted option", () => {
    const intent = { kind: "domain_continue" as const, headline: "Connect API Gateway?", detail: "Enter accepts, typing skips", relatedIds: [], timestamp: 1 };
    const panel = { ...base, intent, predictions: [link, { ...node("Auth Service"), title: "Auth Service" }, node("c")] };
    expect(text(renderToStaticMarkup(<PredictionHud {...panel} />))).toMatch(/Connect API Gateway\?/);
    const moved = text(renderToStaticMarkup(<PredictionHud {...panel} activeIndex={1} />));
    expect(moved).toMatch(/Enter adds Auth Service/);
    expect(moved).not.toMatch(/Connect API Gateway\?/);
  });

  // Charles, 22 Nov (1A): Enter on the empty bar takes only a connection of the node just added. With nothing
  // picked, no option is highlighted and the legend does not promise Enter.
  it("with no suggestion picked: nothing is highlighted and the legend starts with Tab", () => {
    const intent = { kind: "domain_continue" as const, headline: 'Next from "App"', detail: "small to big", relatedIds: [], timestamp: 1 };
    const html = renderToStaticMarkup(<PredictionHud {...base} intent={intent} predictions={[node("a"), node("b"), node("c")]} activeIndex={-1} />);
    expect(legend(html)).toBe("Tab pick a suggestion · Esc dismiss");
    expect(html.match(/aria-pressed="true"/g)).toBeNull();
    expect(text(html)).toMatch(/Next from &quot;App&quot;/);
  });
  it("after Tab picked the first suggestion: Enter adds it, and the hint says so", () => {
    const panel = { ...base, predictions: [{ ...node("API Gateway"), title: "API Gateway" }, node("b"), node("c")] };
    const html = renderToStaticMarkup(<PredictionHud {...panel} activeIndex={0} />);
    expect(legend(html)).toBe("Enter ↵ add · Tab next option · Esc dismiss");
    expect(text(html)).toMatch(/Enter adds API Gateway/);
  });

  // Both judges, round 4 (third round): after a click on another node the pill still read "Connect Redis? ·
  // Enter accepts" with nothing highlighted, while Enter edited the clicked node's name.
  it("a connection hint says Enter accepts only while the connection is highlighted", () => {
    const intent = { kind: "domain_continue" as const, headline: "Connect Redis?", detail: "Enter accepts, typing skips", offersEnter: true, relatedIds: [], timestamp: 1 };
    const panel = { ...base, intent, predictions: [link, node("b"), node("c")] };
    expect(text(renderToStaticMarkup(<PredictionHud {...panel} activeIndex={0} />))).toMatch(/Enter accepts, typing skips/);
    const afterClick = text(renderToStaticMarkup(<PredictionHud {...panel} activeIndex={-1} />));
    expect(afterClick).not.toMatch(/Enter/);
    expect(afterClick).toMatch(/Tab picks one, typing skips/);
  });

  // Round-3 judge, prod: when the AI's fourth option arrived, options 1-3 slid over 100 px to the left and a
  // click aimed at option 2 hit option 3.
  it("keeps the suggestion panel in four columns from the start, so nothing moves when the AI adds one", () => {
    const classes = (html: string) => html.match(/class="grid [^"]*"/)?.[0] ?? "";
    const three = renderToStaticMarkup(<PredictionHud {...base} predictions={[link, node("b"), node("c")]} />);
    const four = renderToStaticMarkup(<PredictionHud {...base} predictions={[link, node("b"), node("c"), node("d")]} />);
    expect(classes(three)).toMatch(/sm:grid-cols-4/);
    expect(classes(three)).toBe(classes(four));
    expect(three.match(/max-w-\[min\(\d+px/)?.[0]).toBe(four.match(/max-w-\[min\(\d+px/)?.[0]);
    const typed = renderToStaticMarkup(<PredictionHud {...base} typing predictions={[node("a"), node("b"), node("c")]} />);
    expect(classes(typed)).toMatch(/sm:grid-cols-3/);
  });

  it("lays four options out in four columns when the AI has added one", () => {
    const html = renderToStaticMarkup(<PredictionHud {...base} predictions={[node("a"), node("b"), node("c"), node("d")]} />);
    expect(html).toMatch(/sm:grid-cols-4/);
    expect(html.match(/aria-pressed/g)).toHaveLength(4);
  });

  // Judge on prod, 22 Nov: the chip said "ranked by jev" while jev's pick sat second.
  it("says jev scored the options, not that it ranked them: the order is the board's", () => {
    const scored = [node("a"), { ...node("b"), probability: 0.63 }, node("c")];
    const telemetry = { source: "gateway:typesafe-ai/jev" as const, model: "typesafe-ai/jev", isHeuristic: false, latencyMs: 90, evaluating: false };
    const t = text(renderToStaticMarkup(<PredictionHud {...base} predictions={scored} telemetry={telemetry} />));
    expect(t).toMatch(/scored by jev/);
    expect(t).not.toMatch(/ranked by jev/);
    expect(t).toMatch(/jev pick 63%/);
  });

  it("never shows where an option came from (lexicon, template, LLM)", () => {
    const sourced = { ...node("a"), source: "lexicon" as const };
    expect(text(renderToStaticMarkup(<PredictionHud {...typed} predictions={[sourced, node("b"), node("c")]} />))).not.toMatch(/lexicon|template|LLM/);
  });
});

// Final judge, 21 Nov: subtitles were cut off ("HTTPS → A", "Auth Service, Cor"), hiding what option 3 holds.
describe("option subtitles are never cut off", () => {
  it("the subtitle wraps instead of truncating, and the full text is the card's tooltip", () => {
    const long = { ...pred("x"), subtitle: "API Gateway, Auth Service, Core Service, Postgres DB, Redis Cache, Event Bus" };
    const html = renderToStaticMarkup(<PredictionHud {...base} predictions={[long, pred("b"), pred("c")]} />);
    const span = html.match(/<span class="([^"]*)">API Gateway, Auth Service/);
    expect(span?.[1]).not.toMatch(/truncate|line-clamp/);
    expect(html).toContain(`title="${long.subtitle}"`);
  });
});

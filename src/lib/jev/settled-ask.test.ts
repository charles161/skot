// Caren (22 Nov 2026): drawing a 6-node, 5-arrow board with the tools fired 19 rank_actions requests in 12 s on
// prod and Fork fell back to the catalogue. The AI is asked once, after the board settles; an aborted request is
// not refunded by the server, so a request that will be replaced must never leave the browser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_SETTLE_MS, SettledAsk } from "./settled-ask";

describe("SettledAsk", () => {
  let sent: string[];
  let ask: SettledAsk<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    ask = new SettledAsk<string>({ send: (job) => sent.push(job) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The user does something (a key or the pointer goes down), then the app asks about it. */
  const act = (job: string) => {
    ask.touch();
    ask.request(job);
  };

  it("sends nothing until the board has been quiet for the settle time", () => {
    act("app");
    vi.advanceTimersByTime(ASK_SETTLE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["app"]);
  });

  it("sends only the latest of several requests made in a row", () => {
    for (const job of ["app", "api", "db", "cache", "queue", "cdn"]) {
      act(job);
      vi.advanceTimersByTime(300);
    }
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(ASK_SETTLE_MS);
    expect(sent).toEqual(["cdn"]);
  });

  it("a key or pointer press restarts the wait", () => {
    act("app");
    vi.advanceTimersByTime(800);
    ask.touch();
    vi.advanceTimersByTime(800);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(sent).toEqual(["app"]);
  });

  it("holds the request while something is in progress, then waits the full settle time", () => {
    ask.setBusy(true);
    act("new shape");
    vi.advanceTimersByTime(10 * ASK_SETTLE_MS);
    expect(sent).toEqual([]);
    ask.request("named shape");
    ask.setBusy(false);
    vi.advanceTimersByTime(ASK_SETTLE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["named shape"]);
  });

  it("going busy after the request stops the clock", () => {
    act("app");
    vi.advanceTimersByTime(500);
    ask.setBusy(true);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    ask.setBusy(false);
    vi.advanceTimersByTime(ASK_SETTLE_MS);
    expect(sent).toEqual(["app"]);
  });

  it("a cancelled request is never sent", () => {
    act("app");
    ask.cancel();
    vi.advanceTimersByTime(5 * ASK_SETTLE_MS);
    expect(sent).toEqual([]);
    expect(ask.pending).toBe(false);
  });

  it("a request about suggestions that are no longer on screen is dropped", () => {
    act("options for app");
    ask.dropUnless((job) => job === "options for app");
    expect(ask.pending).toBe(true);
    ask.dropUnless((job) => job === "what the user typed next");
    vi.advanceTimersByTime(5 * ASK_SETTLE_MS);
    expect(sent).toEqual([]);
  });

  it("a request made long after the last press is sent at once (the board already settled)", () => {
    ask.touch();
    vi.advanceTimersByTime(5000);
    ask.request("clicked node");
    vi.advanceTimersByTime(0);
    expect(sent).toEqual(["clicked node"]);
  });

  it("a board drawn quickly (6 nodes named, 5 arrows) costs one request", () => {
    for (let i = 0; i < 6; i += 1) {
      ask.touch();
      ask.setBusy(true); // tool in hand, then the label editor
      ask.request(`shape ${i}`);
      vi.advanceTimersByTime(700);
      ask.request(`named ${i}`);
      ask.setBusy(false);
      vi.advanceTimersByTime(300);
    }
    for (let i = 0; i < 5; i += 1) {
      ask.touch();
      ask.setBusy(true);
      vi.advanceTimersByTime(400);
      ask.request(`arrow ${i}`);
      ask.setBusy(false);
      vi.advanceTimersByTime(300);
    }
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(ASK_SETTLE_MS);
    expect(sent).toEqual(["arrow 4"]);
  });
});

describe("rank_actions wiring", () => {
  const workspace = readFileSync(path.join(process.cwd(), "src/components/jev/JevWorkspace.tsx"), "utf8");

  it("the workspace posts rank_actions from one function, and only the settled gate calls it", () => {
    expect(workspace.match(/mode: "rank_actions"/g)).toHaveLength(1);
    expect(workspace.match(/\brankWithTypeSafeJev\(/g) ?? [], "only the SettledAsk send callback sends").toHaveLength(1);
    expect(workspace).toMatch(
      /new SettledAsk<RankJob>\(\{\s*send: \(job\) => void rankWithTypeSafeJev\(job\.intent, job\.els, job\.pool, job\.opts\)/
    );
  });

  it("every presenter asks through the gate, and replaced suggestions drop the waiting request", () => {
    expect(workspace.match(/\baskWhenSettled\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workspace).toMatch(/rankAskRef\.current\?\.dropUnless\(\(job\) => job\.shown === predictions\)/);
  });

  it("a key or pointer press, and anything in progress, reaches the gate", () => {
    expect(workspace).toMatch(/addEventListener\("pointerdown", touch, true\)/);
    expect(workspace).toMatch(/addEventListener\("keydown", touch, true\)/);
    expect(workspace).toMatch(/rankAskRef\.current\?\.setBusy\(\s*canvasInteracting \|\| tool !== "select" \|\| Boolean\(forkSession\)/);
  });
});

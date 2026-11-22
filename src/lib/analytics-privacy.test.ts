import { describe, expect, it, vi, afterEach } from "vitest";
import { hideBoardInPath, scrubAnalyticsUrl } from "./analytics-privacy";

const ID = "Vq3nJ0sXq1mJH0cYwN2b7A";
afterEach(() => vi.unstubAllEnvs());

describe("analytics never record a board id", () => {
  it.each([
    [`/b/${ID}`, "/b/[id]"],
    [`/b/${ID}/`, "/b/[id]/"],
    [`/skot/b/${ID}`, "/skot/b/[id]"],
    ["/b/anything%20at-all", "/b/[id]"],
    ["/", "/"],
    ["/icons", "/icons"],
  ])("%s → %s", (from, to) => expect(hideBoardInPath(from)).toBe(to));

  it.each(["pageview", "event", "vital"])("%s urls lose the id, the query and the fragment", (type) => {
    const url = `https://skot.lightslips.ai/b/${ID}?room=${ID}#k=secret`;
    expect(scrubAnalyticsUrl({ type, url })).toEqual({ type, url: "https://skot.lightslips.ai/b/[id]" });
  });
});

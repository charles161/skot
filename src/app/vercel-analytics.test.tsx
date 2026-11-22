import { readFileSync } from "node:fs";
import path from "node:path";
import { inject } from "@vercel/analytics";
import { afterEach, describe, expect, it } from "vitest";
import { buildCspHeader } from "@/proxy";
import { scrubAnalyticsUrl } from "@/lib/analytics-privacy";
import { VercelAnalytics, isVercelDeployment } from "./vercel-analytics";
import { SkotAnalytics } from "./vercel-analytics-client";

describe("Vercel Web Analytics only loads on a Vercel deployment", () => {
  it("is off on the VPC build and in local dev (no VERCEL system env var)", () => {
    expect(isVercelDeployment({})).toBe(false);
    expect(isVercelDeployment({ NEXT_PUBLIC_BASE_PATH: "/skot" })).toBe(false);
    expect(isVercelDeployment({ VERCEL: "" })).toBe(false);
    expect(VercelAnalytics({ env: {} })).toBeNull();
  });

  it("renders the analytics client (wrapping @vercel/analytics/react) when VERCEL=1", () => {
    expect(isVercelDeployment({ VERCEL: "1" })).toBe(true);
    const element = VercelAnalytics({ env: { VERCEL: "1" } });
    expect(element?.type).toBe(SkotAnalytics);
  });

  it("never sends the query or fragment: they can carry the room id and E2E key (#room=…&k=…)", () => {
    const view = { type: "pageview" as const, url: "https://skot.app/?x=1#room=abc&k=SECRETKEY" };
    expect(scrubAnalyticsUrl(view)).toEqual({ type: "pageview", url: "https://skot.app/" });
    expect(scrubAnalyticsUrl({ type: "event", url: "https://skot.app/#k=SECRET" })?.url).toBe("https://skot.app/");
    expect(scrubAnalyticsUrl({ type: "pageview", url: "https://skot.app/board" })?.url).toBe("https://skot.app/board");
  });

  it("wires scrubAnalyticsUrl as beforeSend on <Analytics />", () => {
    const client = readFileSync(path.join(__dirname, "vercel-analytics-client.tsx"), "utf8");
    expect(client.startsWith('"use client";')).toBe(true);
    expect(client).toMatch(/<Analytics \{\.\.\.VERCEL_NEXT\} route=\{route\} path=\{route\} beforeSend=\{scrubAnalyticsUrl\} \/>/);
  });

  it("keeps what the /next wrapper passed: the framework and Vercel's per-deploy endpoints", () => {
    const client = readFileSync(path.join(__dirname, "vercel-analytics-client.tsx"), "utf8");
    expect(client).toMatch(/framework: "next"/);
    expect(client).toMatch(/configString: process\.env\.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG/);
    expect(client).toMatch(/basePath: process\.env\.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH/);
  });

  it("is rendered once from the root layout", () => {
    const layout = readFileSync(path.join(__dirname, "layout.tsx"), "utf8");
    expect(layout).toMatch(/import \{ VercelAnalytics \} from "\.\/vercel-analytics";/);
    expect(layout.match(/<VercelAnalytics \/>/g)).toHaveLength(1);
  });
});

type FakeScript = { src: string; defer?: boolean; dataset: Record<string, string> };

function injectWithFakeDom(props: Parameters<typeof inject>[0], confString?: string): FakeScript {
  const appended: FakeScript[] = [];
  const g = globalThis as Record<string, unknown>;
  g.window = {};
  g.document = {
    head: {
      querySelector: () => null,
      appendChild: (s: FakeScript) => appended.push(s),
    },
    createElement: () => ({ src: "", dataset: {} }),
  };
  inject(props, confString);
  expect(appended).toHaveLength(1);
  return appended[0];
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources] as const;
    })
  );
}

const NONCE = "TESTNONCE";

describe("the CSP lets Vercel Web Analytics load and report, and nothing else changed", () => {
  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.window;
    delete g.document;
    delete g.va;
    delete g.vam;
  });

  it("pins every production directive exactly", () => {
    expect(buildCspHeader(NONCE, false).split("; ")).toEqual([
      "default-src 'self'",
      `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
  });

  it("pins every development directive exactly", () => {
    expect(buildCspHeader(NONCE, true).split("; ")).toEqual([
      "default-src 'self'",
      `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-eval'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
  });

  it.each([
    ["no Vercel config (fallback path)", {}, undefined],
    [
      "Vercel v2 dynamic config (Resilient Intake unique path)",
      {},
      JSON.stringify({
        analytics: {
          scriptSrc: "/a1b2c3/script.js",
          eventEndpoint: "/a1b2c3/event",
          viewEndpoint: "/a1b2c3/view",
        },
      }),
    ],
    ["observability basePath", { basePath: "/_vercel" }, undefined],
  ])("%s: the injected script and its beacons are same-origin paths", (_label, extra, conf) => {
    const script = injectWithFakeDom({ mode: "production", framework: "next", ...extra }, conf);
    const urls = [script.src, ...Object.entries(script.dataset)
      .filter(([k]) => /endpoint$/i.test(k))
      .map(([, v]) => v)];
    for (const url of urls) {
      expect(url, `${url} must be same-origin so connect-src 'self' covers it`).toMatch(/^\/(?!\/)/);
    }
    if (!conf && !("basePath" in extra)) expect(script.src).toBe("/_vercel/insights/script.js");
  });

  it("allows the injected script via 'strict-dynamic' (it is created by a nonced Next.js chunk) and the beacon via connect-src 'self'", () => {
    const d = directives(buildCspHeader(NONCE, false));
    expect(d.get("script-src")).toContain("'strict-dynamic'");
    expect(d.get("script-src")).toContain(`'nonce-${NONCE}'`);
    expect(d.get("connect-src")).toContain("'self'");
    for (const [name, sources] of d) {
      expect(sources, `${name} must not allow 'unsafe-inline' for scripts`).not.toContain(
        name === "script-src" ? "'unsafe-inline'" : "__n/a__"
      );
      for (const s of sources) {
        expect(s, `${name} must not use wildcard or remote hosts`).not.toMatch(/\*|^https?:/);
      }
    }
  });
});

describe("Vercel Speed Insights (Charles, 21 Nov 2026)", () => {
  it("renders <SpeedInsights /> with the same fragment scrubbing, next to <Analytics />", () => {
    const client = readFileSync(path.join(__dirname, "vercel-analytics-client.tsx"), "utf8");
    expect(client).toMatch(/import \{ SpeedInsights \} from "@vercel\/speed-insights\/react";/);
    expect(client).toMatch(/<SpeedInsights \{\.\.\.VERCEL_NEXT\} route=\{route\} beforeSend=\{scrubAnalyticsUrl\} \/>/);
  });
});

describe("Speed Insights vitals never carry the fragment", () => {
  it("scrubs a vital event's url", () => {
    const vital = { type: "vital" as const, url: "https://skot.app/#room=a&k=SECRET", route: "/" };
    expect(scrubAnalyticsUrl(vital)).toEqual({ type: "vital", url: "https://skot.app/", route: "/" });
  });
});

describe("a shared #import= board never reaches Analytics or Speed Insights", () => {
  it("scrubs the whole board payload from pageviews, events and vitals", () => {
    const url = "https://skot.lightslips.ai/#import=H4sIAAAAAAAAA6tWSs3LTEksyczPU7KqVsrJT0wpVrKKjq0FAMPGPu8XAAAA";
    for (const type of ["pageview", "event", "vital"] as const) {
      expect(scrubAnalyticsUrl({ type, url }).url).toBe("https://skot.lightslips.ai/");
    }
  });
});

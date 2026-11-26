// Charles (21 Nov 2026): WhatsApp showed the link preview without an image. Platforms ignore SVG favicons and
// need an absolute og:image, PNG icons, a favicon.ico and a web manifest. Also: a visible "Beta" badge.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSiteMetadata, DEFAULT_SITE_URL, resolveSiteUrl } from "@/brand/brand";
import { BrandWordmark } from "@/brand/BrandWordmark";
import { BasePathFaviconLink } from "@/brand/BasePathFaviconLink";
import manifest from "@/app/manifest";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");
const APP = path.join(ROOT, "src", "app");

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function icoSizes(file: string): number[] {
  const buf = readFileSync(file);
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256).sort((a, b) => a - b);
}

describe("site URL", () => {
  it("prefers SITE_URL, then the request host, then production", () => {
    expect(resolveSiteUrl({ env: { SITE_URL: "https://skot.lightslips.ai/" } })).toBe("https://skot.lightslips.ai");
    expect(resolveSiteUrl({ env: {}, host: "preview-123.vercel.app", proto: "https" })).toBe("https://preview-123.vercel.app");
    expect(resolveSiteUrl({ env: {}, host: "localhost:3000", proto: "http" })).toBe("http://localhost:3000");
    expect(resolveSiteUrl({ env: {} })).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe("https://skot.lightslips.ai");
  });

  it("ignores a malformed host or SITE_URL", () => {
    expect(resolveSiteUrl({ env: { SITE_URL: "not a url" }, host: "bad host/x", proto: "https" })).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl({ env: {}, host: "evil.com", proto: "javascript" })).toBe("https://evil.com");
  });

  it("uses https for any public host even when Next reports http behind a proxy", () => {
    expect(resolveSiteUrl({ env: {}, host: "skot.lightslips.ai", proto: "http" })).toBe("https://skot.lightslips.ai");
    expect(resolveSiteUrl({ env: {}, host: "127.0.0.1:3000", proto: "http" })).toBe("http://127.0.0.1:3000");
  });
});

describe("link preview metadata", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["", "https://skot.lightslips.ai/og.png"],
    ["/skot", "https://skot.lightslips.ai/skot/og.png"],
  ])("base %j: absolute og:image and a large Twitter card", (basePath, expected) => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
    const meta = buildSiteMetadata("https://skot.lightslips.ai");
    expect(meta.metadataBase?.toString()).toBe("https://skot.lightslips.ai/");
    const og = (meta.openGraph?.images as Array<{ url: string; width: number; height: number; type: string; alt: string }>)[0];
    expect(og).toMatchObject({ url: expected, width: 1200, height: 630, type: "image/png" });
    expect(og.alt).toContain("Skot");
    expect(meta.openGraph?.url).toBe(`https://skot.lightslips.ai${basePath}/`);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect((meta.twitter?.images as Array<{ url: string }>)[0].url).toBe(expected);
  });

  it("says (beta) in the page description", () => {
    const meta = buildSiteMetadata("https://skot.lightslips.ai");
    expect(meta.description).toMatch(/\(beta\)$/);
    expect(meta.openGraph?.description).toMatch(/\(beta\)$/);
  });
});

describe("platform images", () => {
  it("ships a 1200x630 PNG link preview image", () => {
    expect(pngSize(path.join(PUBLIC, "og.png"))).toEqual({ width: 1200, height: 630 });
  });

  it("keeps the bright Skot hero wordmark inside the center 630x630 WhatsApp square safe crop", () => {
    const buf = readFileSync(path.join(PUBLIC, "og.png"));
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf[24];
    const colorType = buf[25];
    expect(bitDepth).toBe(8);
    expect([2, 6]).toContain(colorType);
    const bpp = colorType === 6 ? 4 : 3;

    // Collect IDAT chunks and decode PNG scanlines
    const idats: Buffer[] = [];
    let pos = 8;
    while (pos < buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
      if (type === "IDAT") idats.push(buf.subarray(pos + 8, pos + 8 + len));
      pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idats));
    const stride = width * bpp;
    const pixels = Buffer.alloc(height * stride);
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const srcOff = y * (stride + 1) + 1;
      const dstOff = y * stride;
      for (let i = 0; i < stride; i++) {
        const x = raw[srcOff + i];
        const a = i >= bpp ? pixels[dstOff + i - bpp] : 0;
        const b = y > 0 ? pixels[dstOff - stride + i] : 0;
        const c = y > 0 && i >= bpp ? pixels[dstOff - stride + i - bpp] : 0;
        let val = x;
        if (filter === 1) val = (x + a) & 0xff;
        else if (filter === 2) val = (x + b) & 0xff;
        else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
        else if (filter === 4) val = (x + paeth(a, b, c)) & 0xff;
        pixels[dstOff + i] = val;
      }
    }

    // Bright wordmark pixels (luminance > 210) must sit inside the center 630x630 crop (x in [295, 905])
    let minBrightX = width;
    let maxBrightX = 0;
    let brightCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * stride + x * bpp;
        const lum = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
        if (lum > 210) {
          brightCount++;
          if (x < minBrightX) minBrightX = x;
          if (x > maxBrightX) maxBrightX = x;
        }
      }
    }
    expect(brightCount).toBeGreaterThan(500);
    expect(minBrightX, `bright hero pixels start at x=${minBrightX}, clipped by WhatsApp square crop (left edge 285)`).toBeGreaterThanOrEqual(295);
    expect(maxBrightX, `bright hero pixels end at x=${maxBrightX}, clipped by WhatsApp square crop (right edge 915)`).toBeLessThanOrEqual(905);
  });

  it("ships PNG icons: apple-touch 180 (file convention), 192 and 512", () => {
    expect(pngSize(path.join(APP, "apple-icon.png"))).toEqual({ width: 180, height: 180 });
    expect(pngSize(path.join(PUBLIC, "icon-192.png"))).toEqual({ width: 192, height: 192 });
    expect(pngSize(path.join(PUBLIC, "icon-512.png"))).toEqual({ width: 512, height: 512 });
  });

  it("ships favicon.ico with 16, 32 and 48 px images (file convention)", () => {
    expect(icoSizes(path.join(APP, "favicon.ico"))).toEqual([16, 32, 48]);
  });
});

describe("favicon.ico link under a base path", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds the base-path favicon link only when a base path is set (Next omits it then)", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    expect(renderToStaticMarkup(<BasePathFaviconLink />)).toBe("");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/skot");
    expect(renderToStaticMarkup(<BasePathFaviconLink />)).toBe('<link rel="icon" href="/skot/favicon.ico" sizes="48x48" type="image/x-icon"/>');
  });

  it("the root layout renders it in <head>", () => {
    const layout = readFileSync(path.join(APP, "layout.tsx"), "utf8");
    expect(layout).toMatch(/<head>[\s\S]*<BasePathFaviconLink \/>[\s\S]*<\/head>/);
  });
});

describe("web manifest", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["", "/skot"])("base %j: valid manifest whose icons exist at the declared sizes", (basePath) => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
    const m = manifest();
    expect(m.name).toContain("Skot");
    expect(m.short_name).toBe("Skot");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe(`${basePath}/`);
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith(`${basePath}/`)).toBe(true);
      const file = path.join(PUBLIC, icon.src.slice(basePath.length));
      expect(existsSync(file)).toBe(true);
      const { width, height } = pngSize(file);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });
});

describe("Beta badge", () => {
  it("renders a visible Beta pill next to the Skot name", () => {
    const html = renderToStaticMarkup(<BrandWordmark />);
    expect(html).toMatch(/>Skot</);
    const pill = html.match(/<span[^>]*data-beta-badge[^>]*>([^<]*)<\/span>/);
    expect(pill?.[1]).toBe("Beta");
    expect(pill?.[0]).not.toMatch(/sr-only|hidden|opacity-0|aria-hidden="true"/);
    expect(html.indexOf(">Skot<")).toBeLessThan(html.indexOf("data-beta-badge"));
  });

  it("the app header uses the wordmark with the badge", () => {
    const src = readFileSync(path.join(ROOT, "src", "components", "jev", "JevWorkspace.tsx"), "utf8");
    expect(src).toMatch(/<BrandWordmark\b/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

const src = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");

describe("board routes", () => {
  it.each(["app/b/[id]/page.tsx", "app/new/page.tsx"])("%s is the same nonced page as /", (file) => {
    expect(src(file)).toMatch(/export \{ default \} from "(\.\.\/)+page";/);
  });

  it.each(["app/error.tsx", "app/global-error.tsx", "components/jev/UnreadableBoard.tsx"])(
    "%s starts a new board at /new: the current path is now an existing board",
    (file) => {
      expect(src(file), 'use appUrl("/new"): location.pathname reopens the same board').not.toMatch(
        /assign\(window\.location\.pathname\)/
      );
      expect(src(file)).toMatch(/appUrl\("\/new"\)/);
    }
  );

  it("a Copy share link is built on the app's root, never on the sender's board id", () => {
    expect(src("components/jev/BoardFileMenu.tsx")).not.toMatch(
      /new URL\(window\.location\.href\);\s*url\.hash = hash;/
    );
  });

  it("referrers carry the origin only, so no request hands a board id on", async () => {
    const all = (await nextConfig.headers!()).find((h) => h.source === "/:path*")!.headers;
    expect(all.find((h) => h.key === "Referrer-Policy")?.value).toBe("strict-origin");
  });
});

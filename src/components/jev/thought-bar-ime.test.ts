// Core loop, 22 Nov: Enter always adds the typed node, so an Enter that only confirms an IME composition
// (Japanese, Chinese, Korean input) must never reach the submit handler.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Thought Bar keys during an IME composition", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/jev/ThoughtBar.tsx"), "utf8");
  const handler = src.slice(src.indexOf("const handleKeyDown"), src.indexOf("return (", src.indexOf("const handleKeyDown")));

  it("bails out before Enter, Tab or Escape are handled", () => {
    const guard = handler.indexOf("if (e.nativeEvent.isComposing) return;");
    expect(guard).toBeGreaterThan(-1);
    for (const key of ['e.key === "Enter"', 'e.key === "Tab"', 'e.key === "Escape"', "handleCommandKeyDown(e)"]) {
      expect(handler.indexOf(key)).toBeGreaterThan(guard);
    }
  });
});

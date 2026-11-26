import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKSPACE_PATH = path.resolve(__dirname, "JevWorkspace.tsx");
const workspace = readFileSync(WORKSPACE_PATH, "utf8");

describe("UX feedback pass: menu affordance, top-bar Practice pill, and blank-board suggestion modes", () => {
  it("separates the explicit hamburger Board menu button from the Skot wordmark", () => {
    expect(workspace).toMatch(/data-testid="topbar-menu-btn"/);
    expect(workspace).toMatch(/<IconMenu\b/);
    // BrandWordmark must no longer be the DropdownMenuTrigger child
    expect(workspace).not.toMatch(/<DropdownMenuTrigger[\s\S]{0,300}<BrandWordmark/);
  });

  it("surfaces a dedicated Practice button in the top bar", () => {
    expect(workspace).toMatch(/data-testid="topbar-practice-btn"/);
  });

  it("renders a Suggestions mode switch in the top bar wired to suggestionMode", () => {
    expect(workspace).toMatch(/data-testid="suggestions-mode-btn"/);
    expect(workspace).toMatch(/allowsProactiveSuggestions\(/);
    expect(workspace).toMatch(/allowsTypedCompletion\(/);
    expect(workspace).toMatch(/allowsOnDemandSuggestions\(/);
  });
});

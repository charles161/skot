import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(path.join(__dirname, "JevWorkspace.tsx"), "utf8");

describe("#import= is resolved before the workspace creates its room", () => {
  it("the room/P2P mount effect waits while an import is pending, and reruns when it resolves", () => {
    expect(workspace).toMatch(/if \(importPending\) return;\s*const creds = boardPage\.open\(\);/);
    expect(workspace).toMatch(/\}, \[importPending, boardPage, fitToView, rankWithTypeSafeJev, getHistory, restorePractice, showBoardNotice\]\);/);
  });

  it("the Board menu carries the board file entries", () => {
    expect(workspace).toMatch(/<BoardFileMenuItems actions=\{boardFile\} \/>/);
    expect(workspace.match(/\{boardFile\.fileInput\}/g)).toHaveLength(1);
  });
});

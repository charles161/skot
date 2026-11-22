// Charles (21 Nov 2026): pen strokes reach the prediction panel, a stroke never also fires selection predictions,
// Esc keeps the stroke (a late server rank must not re-open the panel), and Enter applies through the one pure
// applyPredictionToElements.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start, `missing ${from}`).toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf(to, start + from.length));
};

describe("pen stroke wiring", () => {
  const canvas = read("src/components/jev/JevCanvas.tsx");
  const workspace = read("src/components/jev/JevWorkspace.tsx");

  it("the canvas reports a committed freedraw stroke through onStrokeCreated", () => {
    const commit = between(canvas, 'if (drag.mode === "freedraw" && drag.freedrawPoints', "setDrag(null)");
    expect(commit).toMatch(/onElementsChange\([\s\S]*onStrokeCreated\(ink\)/);
    expect(workspace).toMatch(/onStrokeCreated=\{handleStrokeCreated\}/);
  });

  it("a stroke consumes the selection trigger and shows its own reading in order, with no LLM nodes or re-ranking", () => {
    const handler = between(workspace, "const handleStrokeCreated", "const handleElementLabelEdited");
    expect(handler).toMatch(/selectionTriggerRef\.current\?\.consume\(\)/);
    expect(handler).toMatch(/generateStrokePredictions\(/);
    expect(handler).toMatch(/setPredictions\(selectTopSuggestions\(res\.pool\)\)/);
    expect(handler).not.toMatch(/rankWithTypeSafeJev|presentPool|rankCandidatesWithFeedback/);
  });

  it("dismiss aborts the in-flight rank so Esc keeps the panel closed and the stroke on the board", () => {
    const dismiss = between(workspace, "const dismissPredictions", "const handleElementMoved");
    expect(dismiss).toMatch(/decideAbortRef\.current\?\.abort\(\)/);
    expect(dismiss).not.toMatch(/updateElements|removeIds/);
  });

  it("Enter applies through applyPredictionToElements (one implementation)", () => {
    const apply = between(workspace, "const applyAction = useCallback", "pushEditDelta(");
    expect(apply).toMatch(/updateElements\(\(prev\) => applyPredictionToElements\(prev, pred\)\)/);
    expect(workspace).not.toMatch(/const removeSet = new Set\(pred\.removeIds/);
  });
});

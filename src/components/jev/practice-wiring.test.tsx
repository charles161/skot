// Sensei feedback 21 Nov 2026 (§2 #1, §4 #3): in practice mode the learner draws first; the AI is silent until
// Review. One aiQuiet flag drives every AI surface. Each surface's gate is pinned here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PredictionHud } from "@/components/jev/PredictionHud";
import { AiQuietContext } from "@/lib/jev/ai-quiet";
import type { PredictedAction, SpatialIntent } from "@/lib/jev/types";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  expect(start, `missing ${from}`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(to, start + from.length);
  expect(end, `missing ${to} after ${from}`).toBeGreaterThan(start);
  return src.slice(start, end);
};
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });

const QUIET_RETURN = /if \(aiQuietRef\.current\) return/;

describe("practice mode: every AI surface reads the one aiQuiet flag", () => {
  const workspace = read("src/components/jev/JevWorkspace.tsx");

  it("client code reaches /api/jev/decide only through postDecide, which refuses AI modes while quiet", () => {
    const direct = files(path.join(process.cwd(), "src"))
      .filter((f) => !f.endsWith(path.join("lib", "jev", "ai-quiet.ts")))
      .filter((f) => /fetch\(\s*appUrl\(\s*["'`]\/api\/jev\/decide/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    expect(direct, "call postDecide(body, { aiQuiet: aiQuietRef.current }) from @/lib/jev/ai-quiet instead").toEqual([]);
    expect(workspace.match(/postDecide\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    for (const call of workspace.matchAll(/postDecide\(\s*\{[\s\S]*?\},\s*\{([^}]*)\}/g)) {
      expect(call[1]).toMatch(/aiQuiet: aiQuietRef\.current/);
    }
  });

  it("pack chips stay hidden while a ghost preview is on the canvas", () => {
    expect(workspace).toMatch(/chipsEnabled: packChips && !aiQuiet && predictions\.length === 0/);
  });

  it("the workspace derives aiQuiet from the practice session and provides it to the tree", () => {
    expect(workspace).toMatch(/const aiQuiet = practice !== null;/);
    expect(workspace).toMatch(/<AiQuietContext value=\{aiQuiet\}>/);
  });

  it("Tab/Enter ghost predictions: presentPool and selection predictions return before computing anything", () => {
    expect(between(workspace, "const presentPool = useCallback", "const refreshPredictions")).toMatch(QUIET_RETURN);
    expect(between(workspace, "showSelectionPredictionsRef.current = (key, signal) => {", "const dismissPredictions")).toMatch(QUIET_RETURN);
    expect(between(workspace, "const presentNextOptions = useCallback", "const completion = useMemo")).toMatch(QUIET_RETURN);
    expect(between(workspace, "const rankWithTypeSafeJev = useCallback", "const boardNotice")).toMatch(QUIET_RETURN);
  });

  it("a restored room in practice shows no predictions on load", () => {
    expect(between(workspace, "if (initialEls.length > 0) {", "setJoiningSharedRoom(!creds.createdNew)")).toMatch(
      /if \(anchor && !restoredPractice\)/
    );
  });

  it("the canvas gets no ghost preview and the prediction HUD is not rendered", () => {
    expect(workspace).toMatch(/activePrediction=\{aiQuiet \? null : activePrediction\}/);
    expect(workspace).toMatch(/ghostElements=\{aiQuiet \? \[\] : activePrediction\?\.addElements \?\? \[\]\}/);
    expect(workspace).toMatch(/text\.startsWith\("\/"\) \|\| forkSession \|\| aiQuiet/);
    const intent: SpatialIntent = { kind: "domain_continue", headline: "Next", detail: "d", subjectId: "a", relatedIds: [], timestamp: 0 };
    const pred: PredictedAction = { id: "p", title: "Add cache", subtitle: "s", category: "extend", addElements: [] };
    const props = { intent, predictions: [pred], activeIndex: 0, telemetry: null, onHoverIndex: () => {}, onApply: () => {}, onDismiss: () => {} };
    expect(renderToStaticMarkup(<PredictionHud {...props} />)).toContain("Predictive drafting suggestions");
    expect(
      renderToStaticMarkup(
        <AiQuietContext value={true}>
          <PredictionHud {...props} />
        </AiQuietContext>
      )
    ).toBe("");
  });

  it("Fork is off: the handler refuses, Alt+F falls through to the frame tool, and no Fork button or HUD renders", () => {
    expect(between(workspace, "const startForkSelection = useCallback", "const applyForkTake")).toMatch(QUIET_RETURN);
    expect(workspace).toMatch(/altLetter\(e\) === "F" && selectedIds\.length > 0 && !aiQuiet/);
    expect(workspace).toMatch(/onFork=\{aiQuiet \? undefined : \(\) => (void )?startForkSelection\(\)\}/);
    expect(workspace).toMatch(/\{!aiQuiet && \(\s*<button[^>]*?\s*type="button"\s*onClick=\{\(\) => (void )?startForkSelection\(\)\}/);
    expect(workspace).toMatch(/\{forkSession && !aiQuiet && forkSession\.phase === "pressure" \? \(\s*<ForkPressureStep/);
    expect(workspace).toMatch(/\) : forkSession && !aiQuiet \? \(\s*<ForkHud/);
    expect(between(workspace, "const generateForkTakes = useCallback", "const returnToForkPressure")).toMatch(
      /if \(!forkSession \|\| aiQuietRef\.current\) return;/
    );
  });

  it("Notation Morph stays (the learner's tool) but the AI refinement call is skipped", () => {
    const morph = between(workspace, "const handleMorphNotation = useCallback", "const handleUndo");
    expect(morph).toMatch(/applyMorphToBoard\(prev, morph\)/);
    expect(morph).toMatch(/if \(targetNotation === "sketch" \|\| aiQuietRef\.current\) \{\s*setMorphEvaluating\(false\);\s*return;/);
  });

  it("the Thought Bar (text to diagram, LLM generation, live placement) is hidden and / does not focus it", () => {
    expect(workspace).toMatch(/\{!aiQuiet && \(\s*<ThoughtBar/);
    expect(workspace).toMatch(/if \(e\.key === "\/" && !aiQuiet\)/);
  });

  it("inferred pack chips are off: never inferred and never rendered", () => {
    expect(workspace).toMatch(/chipsEnabled: packChips && !aiQuiet( && predictions\.length === 0)?,/);
    expect(workspace).toMatch(/\{packs\.chip && !aiQuiet && /);
  });

  it("the first-run empty state (with its Fork starter) gives way to the practice HUD", () => {
    expect(between(workspace, "const showFirstRunEmptyState =", ";")).toMatch(/!aiQuiet/);
  });
});

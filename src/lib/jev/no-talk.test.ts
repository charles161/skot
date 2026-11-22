import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { toolForShortcut } from "@/lib/jev/shortcuts";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

const rel = (f: string) => path.relative(ROOT, f);

const TALK_PATTERN =
  /SpeechRecognition|speechSynthesis|getUserMedia|talk[-_]?to[-_]?draw|TalkToDraw|\bMicOff\b|\bMic\b|microphone|Talk-to-Draw/i;

describe("Talk-to-Draw is removed (no talk/mic control, no V shortcut)", () => {
  it("the Talk feature files are gone", () => {
    for (const f of [
      "src/components/jev/TalkToDrawBar.tsx",
      "src/lib/jev/talk-to-draw.ts",
      "src/lib/jev/talk-to-draw.test.ts",
    ]) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(false);
    }
  });

  it("no source under src/ references speech, microphone or Talk-to-Draw code", () => {
    const hits = sourceFiles(SRC).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => TALK_PATTERN.test(line))
        .map(({ line, i }) => `${rel(f)}:${i + 1} ${line.trim().slice(0, 90)}`)
    );
    expect(hits).toEqual([]);
  });

  it("README no longer documents Talk-to-Draw or a V shortcut", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(readme).not.toMatch(TALK_PATTERN);
    expect(readme).not.toMatch(/\|\s*`V`\s*\|/);
  });

  it("no visible UI text or aria label offers Talk", () => {
    const hits: string[] = [];
    for (const f of sourceFiles(SRC)) {
      const text = readFileSync(f, "utf8");
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          /^\s*talk\b/i.test(node.text)
        ) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          hits.push(`${rel(f)}:${line + 1} ${node.text.trim()}`);
        }
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(sf) === "kbd" &&
          /^\s*V\s*$/.test(node.children.map((c) => c.getText(sf)).join(""))
        ) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          hits.push(`${rel(f)}:${line + 1} <kbd>V</kbd> hint`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });

  it("V is not a shortcut: the keymap ignores it and no handler compares a key with 'v'", () => {
    expect(toolForShortcut({ key: "v", code: "KeyV", altKey: true, ctrlKey: false, metaKey: false })).toBeNull();
    expect(toolForShortcut({ key: "V", code: "KeyV", altKey: false, ctrlKey: false, metaKey: false })).toBeNull();
    const hits: string[] = [];
    for (const f of sourceFiles(SRC)) {
      const text = readFileSync(f, "utf8");
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (
          ts.isBinaryExpression(node) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
        ) {
          const sides = [node.left, node.right];
          const lit = sides.find((s) => ts.isStringLiteral(s) && /^[vV]$/.test(s.text));
          const key = sides.find((s) => /\bkey\b|\bcode\b/.test(s.getText(sf)));
          if (lit && key) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            hits.push(`${rel(f)}:${line + 1} ${node.getText(sf)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });

  it("the tool keymap still covers every drawing tool", () => {
    expect(
      ["S", "H", "R", "D", "O", "C", "A", "Z", "P", "T"].map((k) =>
        toolForShortcut({ key: k.toLowerCase(), code: `Key${k}`, altKey: true, ctrlKey: false, metaKey: false })
      )
    ).toEqual(["select", "hand", "node", "diamond", "database", "ellipse", "arrow", "frame", "freedraw", "text"]);
  });
});

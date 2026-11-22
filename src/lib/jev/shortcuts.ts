import type { HLD_SHAPE_KINDS, LLD_SHAPE_KINDS, ToolType } from "./types";

export type DockTool = Exclude<ToolType, (typeof HLD_SHAPE_KINDS)[number] | (typeof LLD_SHAPE_KINDS)[number]>;

/**
 * Tool shortcuts for the dock: Alt + the letter. A bare letter typed on the board is the start of a node name
 * and goes to the Thought Bar (Charles, 22 Nov 2026). Flyout kinds have no key.
 */
export const TOOL_SHORTCUT_KEYS: Readonly<Record<DockTool, string>> = {
  select: "S",
  hand: "H",
  node: "R",
  diamond: "D",
  database: "O",
  ellipse: "C",
  arrow: "A",
  frame: "F",
  freedraw: "P",
  text: "T",
};

const KEY_TO_TOOL = new Map<string, DockTool>(
  (Object.entries(TOOL_SHORTCUT_KEYS) as Array<[DockTool, string]>).map(([tool, key]) => [key, tool])
);

interface KeyLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** "Alt+R": how a tool's shortcut is written in the UI. */
export const toolShortcutLabel = (tool: DockTool) => `Alt+${TOOL_SHORTCUT_KEYS[tool]}`;

/**
 * The letter of an Alt+letter chord, read from the physical key: on a Mac, Option+R types "®", so `key` is no use.
 */
export function altLetter(e: KeyLike): string | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1] : null;
}

export function toolForShortcut(e: KeyLike): ToolType | null {
  const letter = altLetter(e);
  return letter ? KEY_TO_TOOL.get(letter) ?? null : null;
}

/** A bare printable letter (any script), no Ctrl / Cmd / Alt: text for the Thought Bar, not a command. */
export function isTypedLetter(e: KeyLike): boolean {
  return !e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1 && /\p{L}/u.test(e.key);
}

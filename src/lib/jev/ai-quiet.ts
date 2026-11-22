"use client";

import { createContext, useContext } from "react";
import { appUrl } from "@/lib/base-path";

/**
 * True while a practice session runs: every AI surface (ghost previews, prediction HUD, Fork, AI morph
 * refinement, context suggestions, Thought Bar generation, inferred pack chips) stays silent.
 */
export const AiQuietContext = createContext(false);

export function useAiQuiet(): boolean {
  return useContext(AiQuietContext);
}

export const DECIDE_MODES = [
  "rank_actions",
  "classify_prompt",
  "place_diagram",
  "generate_graph",
  "fork_architecture",
  "morph_notation",
  "practice_review",
] as const;
export type DecideMode = (typeof DECIDE_MODES)[number];

export const AI_QUIET_ALLOWED_MODES: ReadonlySet<DecideMode> = new Set<DecideMode>(["practice_review"]);

/** Posts to /api/jev/decide, or returns null without a request when the AI is quiet for this mode. */
export async function postDecide(
  body: { mode: DecideMode } & Record<string, unknown>,
  opts: { aiQuiet: boolean; signal?: AbortSignal }
): Promise<Response | null> {
  if (opts.aiQuiet && !AI_QUIET_ALLOWED_MODES.has(body.mode)) return null;
  return fetch(appUrl("/api/jev/decide"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify(body),
  });
}

import type { StorageLike } from "./recovery-buffer";

export type SuggestionMode = "type-only" | "full" | "off";

export const DEFAULT_SUGGESTION_MODE: SuggestionMode = "type-only";
export const SUGGESTION_MODE_STORAGE_KEY = "skot_suggestion_mode_v1";

export const SUGGESTION_MODE_META: Record<
  SuggestionMode,
  { label: string; shortLabel: string; description: string }
> = {
  "type-only": {
    label: "Type only",
    shortLabel: "Type only",
    description: "Complete the element you type; no unsolicited next boxes (Tab asks on demand)",
  },
  full: {
    label: "Full",
    shortLabel: "Full",
    description: "Auto-suggest next components and connections as you draw",
  },
  off: {
    label: "Off",
    shortLabel: "Off",
    description: "Quiet canvas — no suggestions or inline word completions (/commands still work)",
  },
};

export function parseSuggestionMode(raw: string | null | undefined): SuggestionMode {
  if (raw === "type-only" || raw === "full" || raw === "off") return raw;
  return DEFAULT_SUGGESTION_MODE;
}

export function loadSuggestionMode(storage: StorageLike | null | undefined): SuggestionMode {
  if (!storage) return DEFAULT_SUGGESTION_MODE;
  try {
    return parseSuggestionMode(storage.getItem(SUGGESTION_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_SUGGESTION_MODE;
  }
}

const listeners = new Set<() => void>();

export function subscribeSuggestionMode(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SUGGESTION_MODE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getSuggestionModeSnapshot(): SuggestionMode {
  if (typeof window === "undefined") return DEFAULT_SUGGESTION_MODE;
  return loadSuggestionMode(window.localStorage);
}

export function getSuggestionModeServerSnapshot(): SuggestionMode {
  return DEFAULT_SUGGESTION_MODE;
}

export function saveSuggestionMode(storage: StorageLike | null | undefined, mode: SuggestionMode): void {
  if (!storage) return;
  try {
    storage.setItem(SUGGESTION_MODE_STORAGE_KEY, mode);
    listeners.forEach((fn) => fn());
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

/** Proactive next-box / selection / move / stroke ghost suggestions run ONLY in Full mode (never during Practice). */
export function allowsProactiveSuggestions(mode: SuggestionMode, aiQuiet: boolean): boolean {
  return !aiQuiet && mode === "full";
}

/** Multi-option expansion while typing (options 2 & 3 beyond the exact typed node) runs ONLY in Full mode. */
export function allowsTypedMultiOptions(mode: SuggestionMode, aiQuiet: boolean): boolean {
  return !aiQuiet && mode === "full";
}

/** Inline element-name completion ("api" -> "API Gateway") runs in Type only and Full, never in Off or Practice. */
export function allowsTypedCompletion(mode: SuggestionMode, aiQuiet: boolean): boolean {
  return !aiQuiet && mode !== "off";
}

/** Explicit Tab on an empty Thought Bar can request next-step suggestions on demand in Type only and Full. */
export function allowsOnDemandSuggestions(mode: SuggestionMode, aiQuiet: boolean): boolean {
  return !aiQuiet && mode !== "off";
}

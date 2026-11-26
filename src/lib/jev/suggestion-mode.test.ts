import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUGGESTION_MODE,
  SUGGESTION_MODE_STORAGE_KEY,
  allowsOnDemandSuggestions,
  allowsProactiveSuggestions,
  allowsTypedCompletion,
  allowsTypedMultiOptions,
  loadSuggestionMode,
  saveSuggestionMode,
  type SuggestionMode,
} from "./suggestion-mode";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("suggestion-mode", () => {
  it("defaults blank boards to type-only so HLD learners draw without spoilers", () => {
    expect(DEFAULT_SUGGESTION_MODE).toBe("type-only");
    expect(loadSuggestionMode(memoryStorage())).toBe("type-only");
    expect(loadSuggestionMode(null)).toBe("type-only");
  });

  it("persists and restores valid modes and falls back cleanly on unknown values", () => {
    const s = memoryStorage();
    for (const mode of ["type-only", "full", "off"] as SuggestionMode[]) {
      saveSuggestionMode(s, mode);
      expect(s.getItem(SUGGESTION_MODE_STORAGE_KEY)).toBe(mode);
      expect(loadSuggestionMode(s)).toBe(mode);
    }
    s.setItem(SUGGESTION_MODE_STORAGE_KEY, "invalid-value");
    expect(loadSuggestionMode(s)).toBe("type-only");
  });

  it("enforces exact capability boundaries for each mode and always yields to Practice aiQuiet", () => {
    // Type only (default on blank boards): element typing + Tab on demand, zero unsolicited next boxes
    expect(allowsProactiveSuggestions("type-only", false)).toBe(false);
    expect(allowsTypedMultiOptions("type-only", false)).toBe(false);
    expect(allowsTypedCompletion("type-only", false)).toBe(true);
    expect(allowsOnDemandSuggestions("type-only", false)).toBe(true);

    // Full: all proactive suggestions + multi-option typing previews
    expect(allowsProactiveSuggestions("full", false)).toBe(true);
    expect(allowsTypedMultiOptions("full", false)).toBe(true);
    expect(allowsTypedCompletion("full", false)).toBe(true);
    expect(allowsOnDemandSuggestions("full", false)).toBe(true);

    // Off: quiet canvas — no proactive ghosts, no Tab demand, no inline typing completion
    expect(allowsProactiveSuggestions("off", false)).toBe(false);
    expect(allowsTypedMultiOptions("off", false)).toBe(false);
    expect(allowsTypedCompletion("off", false)).toBe(false);
    expect(allowsOnDemandSuggestions("off", false)).toBe(false);

    // Practice mode (aiQuiet = true) overrides EVERY mode
    for (const mode of ["type-only", "full", "off"] as SuggestionMode[]) {
      expect(allowsProactiveSuggestions(mode, true)).toBe(false);
      expect(allowsTypedMultiOptions(mode, true)).toBe(false);
      expect(allowsTypedCompletion(mode, true)).toBe(false);
      expect(allowsOnDemandSuggestions(mode, true)).toBe(false);
    }
  });
});

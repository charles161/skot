// Judge B, round 5: for about a second after a click the panel still held the previous node's options, so
// "click, Tab, Enter" gave two results depending on the pause. With no delay the trigger fires in the same turn.
import { describe, expect, it } from "vitest";
import { SelectionSuggestTrigger } from "./selection-trigger";

describe("SelectionSuggestTrigger with no delay", () => {
  it("fires as part of the selection itself, not on a timer", () => {
    const fired: string[] = [];
    const trigger = new SelectionSuggestTrigger({ delayMs: 0, onFire: (key) => fired.push(key) });
    trigger.select(["a"]);
    expect(fired).toEqual(["a"]);
    trigger.select(["a"]);
    expect(fired).toEqual(["a"]);
    trigger.select(["b", "a"]);
    expect(fired).toEqual(["a", "a|b"]);
  });

  it("still stays quiet while the canvas is busy and for a selection the app adopted", () => {
    const fired: string[] = [];
    const trigger = new SelectionSuggestTrigger({ delayMs: 0, onFire: (key) => fired.push(key) });
    trigger.setBusy(true);
    trigger.select(["a"]);
    expect(fired).toEqual([]);
    trigger.adopt(["b"]);
    trigger.setBusy(false);
    expect(fired).toEqual([]);
  });
});

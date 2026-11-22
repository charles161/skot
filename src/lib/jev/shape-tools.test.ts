import { describe, expect, it } from "vitest";
import { DEFAULT_KIND_SIZE, KIND_LABELS } from "@/lib/jev/notation-kinds";
import {
  MORE_SHAPE_GROUPS,
  isMoreShapeKind,
  isShapeTool,
  shapeFromTool,
} from "@/lib/jev/shape-tools";
import { altLetter, isTypedLetter, TOOL_SHORTCUT_KEYS, toolForShortcut } from "@/lib/jev/shortcuts";
import { HLD_SHAPE_KINDS, LLD_SHAPE_KINDS, SHAPE_KINDS, type ShapeKind } from "@/lib/jev/types";

const at = { x: 500, y: 300 };
const place = (kind: ShapeKind, end = at) => shapeFromTool(kind, at, end, "el_t", 1000);

describe("More shapes flyout groups", () => {
  it("offers every HLD kind under System design and every LLD kind under LLD notation, in contract order", () => {
    expect(MORE_SHAPE_GROUPS.map((g) => g.title)).toEqual(["System design", "LLD notation"]);
    expect(MORE_SHAPE_GROUPS[0].kinds).toEqual([...HLD_SHAPE_KINDS]);
    expect(MORE_SHAPE_GROUPS[1].kinds).toEqual([...LLD_SHAPE_KINDS]);
  });

  it("labels each entry with the contract KIND_LABELS", () => {
    for (const group of MORE_SHAPE_GROUPS) {
      for (const kind of group.kinds) expect(KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("classifies tools: every shape kind is a shape tool, flyout kinds are exactly HLD + LLD", () => {
    for (const kind of SHAPE_KINDS) expect(isShapeTool(kind)).toBe(true);
    expect(isShapeTool("select")).toBe(false);
    expect(isShapeTool("arrow")).toBe(false);
    expect(isShapeTool("freedraw")).toBe(false);
    expect(SHAPE_KINDS.filter(isMoreShapeKind)).toEqual([...HLD_SHAPE_KINDS, ...LLD_SHAPE_KINDS]);
  });
});

describe("keyboard: new kinds steal no keys", () => {
  it("keeps the dock keymap byte-for-byte", () => {
    expect(TOOL_SHORTCUT_KEYS).toEqual({
      select: "S",
      hand: "H",
      node: "R",
      diamond: "D",
      database: "O",
      ellipse: "C",
      arrow: "A",
      frame: "Z",
      freedraw: "P",
      text: "T",
    });
  });

  it("no letter resolves to a flyout kind", () => {
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const tool = toolForShortcut({ key: c.toLowerCase(), code: `Key${c}`, altKey: true, ctrlKey: false, metaKey: false });
      if (tool) expect(isMoreShapeKind(tool)).toBe(false);
    }
  });
});

// Charles, 22 Nov 2026 (1A): a letter typed on the board is the start of a node name; tools are on Alt+letter.
describe("keyboard: bare letters are text, Alt+letter is a tool", () => {
  const key = (k: string, code: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
    key: k,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
  });

  it("a bare letter never picks a tool", () => {
    for (const c of "shrdocafpt") expect(toolForShortcut(key(c, `Key${c.toUpperCase()}`))).toBeNull();
  });

  it("Alt+letter picks the tool by the physical key, whatever the Option key types on a Mac", () => {
    expect(toolForShortcut(key("®", "KeyR", { altKey: true }))).toBe("node");
    expect(toolForShortcut(key("ß", "KeyS", { altKey: true }))).toBe("select");
    expect(altLetter(key("ƒ", "KeyF", { altKey: true }))).toBe("F");
    expect(toolForShortcut(key("r", "KeyR", { altKey: true, metaKey: true }))).toBeNull();
  });

  // Round-2 judges, prod: Alt+F meant Fork It with a selection and the Zone Frame tool without.
  it("Alt+F is Fork It only: no tool listens on F, the frame tool is Alt+Z", () => {
    expect(toolForShortcut(key("ƒ", "KeyF", { altKey: true }))).toBeNull();
    expect(toolForShortcut(key("Ω", "KeyZ", { altKey: true }))).toBe("frame");
  });

  it("letters of any script are text for the Thought Bar; digits, symbols and chords are not", () => {
    for (const c of ["a", "Z", "é", "ñ", "日", "ж"]) expect(isTypedLetter(key(c, "KeyA"))).toBe(true);
    // Judge A, round 4: "2" on the board picked suggestion 2 while "2" in the bar typed. A digit is text everywhere.
    for (const c of ["1", "2", "9", "0"]) expect(isTypedLetter(key(c, "Digit1"))).toBe(true);
    for (const c of ["/", " ", "[", "Enter", "Tab", "Backspace", "F2"]) expect(isTypedLetter(key(c, "X"))).toBe(false);
    expect(isTypedLetter(key("a", "KeyA", { ctrlKey: true }))).toBe(false);
    expect(isTypedLetter(key("a", "KeyA", { metaKey: true }))).toBe(false);
    expect(isTypedLetter(key("å", "KeyA", { altKey: true }))).toBe(false);
  });
});

describe("shapeFromTool: click places the default box centred on the pointer", () => {
  it.each([...HLD_SHAPE_KINDS, ...LLD_SHAPE_KINDS])("%s uses DEFAULT_KIND_SIZE", (kind) => {
    const { element } = place(kind);
    const size = DEFAULT_KIND_SIZE[kind];
    expect(element).toMatchObject({ kind, width: size.width, height: size.height });
    expect(element.x).toBe(Math.round(at.x - size.width / 2));
    expect(element.y).toBe(Math.round(at.y - size.height / 2));
    expect(element.createdAt).toBe(1000);
  });

  it("keeps the legacy defaults for the dock tools", () => {
    expect(place("node").element).toMatchObject({ width: 172, height: 72, label: "Service" });
    expect(place("diamond").element).toMatchObject({ width: 148, height: 96, label: "Condition?" });
    expect(place("database").element).toMatchObject({ width: 156, height: 86, label: "Database" });
    expect(place("ellipse").element).toMatchObject({ width: 152, height: 74, label: "User" });
    expect(place("frame").element).toMatchObject({ width: 340, height: 220, label: "System Zone", tone: "slate" });
    expect(place("text").element).toMatchObject({ width: 180, height: 42, label: "Note" });
  });

  it("seeds LLD shapes with editable notation rows", () => {
    expect(place("entity").element).toMatchObject({
      label: "users",
      sublabel: "id uuid PK\nemail text UK\ncreated_at timestamptz",
    });
    expect(place("class").element).toMatchObject({
      label: "Order",
      sublabel: "- id: UUID\n- status: Status\n--\n+ pay(): Receipt",
    });
    expect(place("fragment").element).toMatchObject({ label: "alt", sublabel: "[cache hit]\n[miss]" });
  });

  it("names HLD shapes after what they are", () => {
    const labels = Object.fromEntries(HLD_SHAPE_KINDS.map((k) => [k, place(k).element.label]));
    expect(labels).toEqual({
      queue: "Queue",
      cache: "Cache",
      lb: "Load balancer",
      blob: "Blob store",
      external: "External API",
      actor: "User",
      zone: "VPC",
      card: "Requirements",
    });
  });

  it("leaves activation bars and pseudo-states unlabelled and does not open the label editor for them", () => {
    for (const kind of ["activation", "initial", "final"] as const) {
      const placed = place(kind);
      expect(placed.element.label).toBe("");
      expect(placed.element.sublabel).toBeUndefined();
      expect(placed.editLabel).toBe(false);
    }
    expect(place("queue").editLabel).toBe(true);
    expect(place("entity").editLabel).toBe(true);
  });

  it("sends containers (frame, zone, fragment) behind other shapes", () => {
    expect(place("frame").behind).toBe(true);
    expect(place("zone").behind).toBe(true);
    expect(place("fragment").behind).toBe(true);
    expect(place("queue").behind).toBe(false);
    expect(place("zone").element.tone).toBe("slate");
  });
});

describe("shapeFromTool: drag sizes the shape", () => {
  it("uses the dragged box once it is big enough, from either corner", () => {
    const { element } = shapeFromTool("queue", { x: 400, y: 260 }, { x: 200, y: 100 }, "el_d", 1);
    expect(element).toMatchObject({ x: 200, y: 100, width: 200, height: 160 });
  });

  it("ignores a tiny jitter and falls back to the default size", () => {
    const { element } = shapeFromTool("cache", at, { x: at.x + 6, y: at.y + 4 }, "el_j", 1);
    expect(element).toMatchObject(DEFAULT_KIND_SIZE.cache);
  });

  it("activation bars keep their narrow width and take the dragged height", () => {
    const { element } = shapeFromTool("activation", { x: 300, y: 100 }, { x: 304, y: 260 }, "el_a", 1);
    expect(element).toMatchObject({ width: DEFAULT_KIND_SIZE.activation.width, height: 160, y: 100 });
    expect(element.x).toBe(Math.round(302 - DEFAULT_KIND_SIZE.activation.width / 2));
  });

  it("pseudo-states stay at their fixed size however far you drag", () => {
    const { element } = shapeFromTool("final", { x: 0, y: 0 }, { x: 300, y: 300 }, "el_f", 1);
    expect(element).toMatchObject(DEFAULT_KIND_SIZE.final);
  });
});

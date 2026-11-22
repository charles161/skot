import { clampSpecForStorage } from "./notation-morph";
import {
  hasForbiddenOwnKeys,
  jevElementSchema,
  MAX_BOARD_ELEMENTS,
  MAX_BOARD_TITLE_LENGTH,
  MAX_FREEDRAW_POINTS,
  MAX_LABEL_LENGTH,
  MAX_SUBLABEL_LENGTH,
  parseStoredBoardSnapshot,
  storedBoardSnapshotSchema,
  type StoredBoardSnapshot,
} from "./sync-validation";
import type { JevElement } from "./types";

/*
 * The only way this browser's own saved boards are loaded and saved. A saved board is often someone's only copy:
 * it is never written over unless it can be read, and nothing is saved that could not be read back.
 *
 * Reading relaxes sizes only, for boards saved past the limits: how many elements and bytes, how long text and
 * strokes are. Shapes, types, enums, coordinates and keys get the strict schema. Files, links and peers are
 * untrusted and keep parseStoredBoardSnapshot and parseWireMessage, limits included.
 */

export type SavedBoard =
  | { kind: "empty" }
  | { kind: "board"; snapshot: StoredBoardSnapshot }
  | { kind: "unreadable"; raw: string };

export function exceedsBoardLimit(fromCount: number, toCount: number): boolean {
  return toCount > MAX_BOARD_ELEMENTS && toCount > fromCount;
}

const within = <T>(value: T, max: number): T =>
  typeof value === "string" && value.length > max ? (value.slice(0, max) as T) : value;

function textWithinLimits<T extends { label: string; sublabel?: string }>(item: T): T {
  return {
    ...item,
    label: within(item.label, MAX_LABEL_LENGTH),
    ...(item.sublabel !== undefined ? { sublabel: within(item.sublabel, MAX_SUBLABEL_LENGTH) } : {}),
  };
}

/** Validates a size-limited copy with the strict schema, then puts the person's own text and points back. */
function readElement(saved: JevElement): JevElement | null {
  const probe = textWithinLimits(saved);
  const group = saved.morphMeta?.groupRecord;
  if (saved.morphMeta && group) {
    probe.morphMeta = {
      ...saved.morphMeta,
      groupRecord: {
        ...group,
        spec: clampSpecForStorage(group.spec), // derived text, so it is cut
        sketchSnapshot: group.sketchSnapshot.map(textWithinLimits),
      },
    };
  }
  const points = Array.isArray(saved.points) ? saved.points : null;
  if (points) probe.points = points.slice(0, MAX_FREEDRAW_POINTS);

  const parsed = jevElementSchema.safeParse(probe);
  if (!parsed.success) return null;
  const element = { ...parsed.data, label: saved.label };
  if (saved.sublabel !== undefined) element.sublabel = saved.sublabel;
  if (points && points.length > MAX_FREEDRAW_POINTS) {
    const all = [...(parsed.data.points ?? [])];
    for (let i = MAX_FREEDRAW_POINTS; i < points.length; i += MAX_FREEDRAW_POINTS) {
      const part = jevElementSchema.safeParse({ ...probe, points: points.slice(i, i + MAX_FREEDRAW_POINTS) });
      if (!part.success) return null;
      all.push(...(part.data.points ?? []));
    }
    element.points = all;
  }
  element.morphMeta?.groupRecord?.sketchSnapshot.forEach((item, i) => {
    const original = group!.sketchSnapshot[i];
    item.label = original.label;
    if (original.sublabel !== undefined) item.sublabel = original.sublabel;
  });
  return element;
}

export function readSavedBoard(raw: string | null): SavedBoard {
  if (raw === null) return { kind: "empty" };
  const withinLimits = parseStoredBoardSnapshot(raw);
  if (withinLimits) return { kind: "board", snapshot: withinLimits };

  const unreadable: SavedBoard = { kind: "unreadable", raw };
  try {
    const saved = JSON.parse(raw) as StoredBoardSnapshot;
    if (!Array.isArray(saved?.elements) || hasForbiddenOwnKeys(saved)) return unreadable;
    const rest = storedBoardSnapshotSchema.safeParse({
      ...saved,
      elements: [],
      boardTitle: within(saved.boardTitle, MAX_BOARD_TITLE_LENGTH),
    });
    if (!rest.success) return unreadable;

    const elements: JevElement[] = [];
    for (const item of saved.elements) {
      const element = readElement(item);
      // All or nothing: a board loaded in part would be saved in part.
      if (!element) return unreadable;
      elements.push(element);
    }
    return { kind: "board", snapshot: { ...rest.data, elements, boardTitle: saved.boardTitle } };
  } catch {
    return unreadable; // not JSON, or a record of the wrong shape
  }
}

export type SaveOutcome = "saved" | "kept_unreadable" | "would_not_load" | "storage_failed";

/** The last value known to load, so a save does not re-validate what it wrote itself. */
let knownReadable: string | null = null;

export function writeSavedBoard(storage: Pick<Storage, "getItem" | "setItem">, key: string, json: string): SaveOutcome {
  try {
    const current = storage.getItem(key);
    if (current !== null && current !== knownReadable && readSavedBoard(current).kind !== "board") return "kept_unreadable";
    if (readSavedBoard(json).kind !== "board") return "would_not_load";
    storage.setItem(key, json);
    knownReadable = json;
    return "saved";
  } catch {
    return "storage_failed";
  }
}

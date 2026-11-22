import { elementsContentEqual } from "./board-sync";
import { readSavedBoard } from "./saved-board";
import {
  boardRecoveryEntrySchema,
  hasForbiddenOwnKeys,
  MAX_RECOVERY_SNAPSHOTS,
  type BoardRecoveryEntry,
  type StoredBoardSnapshot,
} from "./sync-validation";

/*
 * Earlier copies of this browser's boards, read with the same tolerant loader as the board itself. A copy that
 * can't be read is carried along untouched: it is never counted, trimmed or deleted. The fullest copy (the newest
 * of equally full ones) is never dropped either: not for age, for space or by restoring it.
 *
 * Boards replaced by "Restore earlier copy" have their own short list, so restoring can't push one of the 8 out.
 */

export { MAX_RECOVERY_SNAPSHOTS };
export type { BoardRecoveryEntry };

const MAX_BEFORE_RESTORE_COPIES = 3;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getRecoveryStorageKey(roomId: string): string {
  return `jev_recovery_${roomId}`;
}

export function getBeforeRestoreStorageKey(roomId: string): string {
  return `jev_before_restore_${roomId}`;
}

interface StoredCopy {
  stored: unknown;
  entry: BoardRecoveryEntry | null;
}

const entryDetailsSchema = boardRecoveryEntrySchema.omit({ snapshot: true });

function readEntry(stored: unknown): BoardRecoveryEntry | null {
  if (hasForbiddenOwnKeys(stored)) return null;
  const details = entryDetailsSchema.safeParse(stored);
  if (!details.success) return null;
  const board = readSavedBoard(JSON.stringify((stored as BoardRecoveryEntry).snapshot) ?? null);
  return board.kind === "board" ? { ...details.data, snapshot: board.snapshot } : null;
}

/** Throws when storage can't be read, so that a writer never takes that for "no copies". */
function readCopies(storage: StorageLike, key: string): StoredCopy[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const items: unknown = JSON.parse(raw);
    if (Array.isArray(items)) return items.map((stored) => ({ stored, entry: readEntry(stored) }));
  } catch {
    // not JSON: the whole value is one copy that can't be read
  }
  return [{ stored: raw, entry: null }];
}

const readable = (copies: StoredCopy[]) => copies.flatMap(({ entry }) => (entry ? [entry] : []));
const serialize = (copies: StoredCopy[]) => JSON.stringify(copies.map(({ stored }) => stored));

function fullestOf(entries: BoardRecoveryEntry[]): BoardRecoveryEntry | undefined {
  return entries.reduce<BoardRecoveryEntry | undefined>(
    (best, entry) => (!best || entry.snapshot.elements.length > best.snapshot.elements.length ? entry : best),
    undefined
  );
}

/** Drops the oldest readable copies until `max` are left, but never the newest or the fullest. */
function trimOldest(copies: StoredCopy[], max: number): StoredCopy[] {
  const next = [...copies];
  const entries = readable(next);
  const kept = new Set([entries[0], fullestOf(entries)]);
  let count = entries.length;
  for (let i = next.length - 1; i >= 0 && count > max; i -= 1) {
    const { entry } = next[i];
    if (!entry || kept.has(entry)) continue;
    next.splice(i, 1);
    count -= 1;
  }
  return next;
}

/** The same board as a person sees it: revisions and timestamps don't count. */
export function sameBoard(a: StoredBoardSnapshot, b: StoredBoardSnapshot): boolean {
  if (a.boardTitle !== undefined && b.boardTitle !== undefined && a.boardTitle !== b.boardTitle) return false;
  return a.elements.length === b.elements.length && a.elements.every((el, i) => elementsContentEqual(el, b.elements[i]));
}

function isSaved(storage: StorageLike, roomId: string, board: StoredBoardSnapshot): boolean {
  return [getRecoveryStorageKey(roomId), getBeforeRestoreStorageKey(roomId)].some((key) =>
    readable(readCopies(storage, key)).some(({ snapshot }) => sameBoard(snapshot, board))
  );
}

/** The board a peer's change replaced, when there was no room to save it: "Restore previous board" still needs it. */
const unsavedReplaced = new WeakMap<StorageLike, { key: string; entry: BoardRecoveryEntry }>();

export function loadRecoverySnapshots(
  storage: StorageLike | null | undefined,
  roomId: string
): BoardRecoveryEntry[] {
  if (!storage || !roomId) return [];
  try {
    return readable(readCopies(storage, getRecoveryStorageKey(roomId)));
  } catch {
    return [];
  }
}

/**
 * Prepends a pre-change board snapshot into the room's bounded 8-snapshot ring buffer
 * (newest first; oldest but the fullest evicted beyond MAX_RECOVERY_SNAPSHOTS).
 * The 2-minute save skips a board that is already saved: it would only push an older one out.
 */
export function pushRecoverySnapshot(
  storage: StorageLike | null | undefined,
  roomId: string,
  entry: BoardRecoveryEntry
): BoardRecoveryEntry[] {
  if (!storage || !roomId) return [];
  try {
    const added = readEntry(entry);
    if (!added || (added.reason === "periodic" && isSaved(storage, roomId, added.snapshot))) {
      return loadRecoverySnapshots(storage, roomId);
    }
    const key = getRecoveryStorageKey(roomId);
    let next = trimOldest([{ stored: added, entry: added }, ...readCopies(storage, key)], MAX_RECOVERY_SNAPSHOTS);
    const replacedByPeer = added.reason !== "periodic";
    for (;;) {
      try {
        storage.setItem(key, serialize(next));
        if (replacedByPeer) unsavedReplaced.delete(storage);
        return readable(next);
      } catch {
        // QuotaExceededError: retry without the oldest that may go
        const fewer = trimOldest(next, readable(next).length - 1);
        if (fewer.length === next.length) break;
        next = fewer;
      }
    }
    if (replacedByPeer) unsavedReplaced.set(storage, { key, entry: added });
  } catch {
    // storage can't be read, so it is not written
  }
  return [];
}

/**
 * Returns the board most recently replaced or saved, and takes its copy off the list unless it is the fullest.
 */
export function popRecoverySnapshot(
  storage: StorageLike | null | undefined,
  roomId: string
): { entry: BoardRecoveryEntry | null; remaining: BoardRecoveryEntry[] } {
  if (!storage || !roomId) return { entry: null, remaining: [] };
  try {
    const key = getRecoveryStorageKey(roomId);
    const copies = readCopies(storage, key);
    const entries = readable(copies);
    const unsaved = unsavedReplaced.get(storage);
    if (unsaved?.key === key) {
      unsavedReplaced.delete(storage);
      return { entry: unsaved.entry, remaining: entries };
    }
    const latest = copies.find((copy) => copy.entry);
    if (!latest) return { entry: null, remaining: [] };
    if (latest.entry === fullestOf(entries)) return { entry: latest.entry, remaining: entries };
    const rest = copies.filter((copy) => copy !== latest);
    try {
      storage.setItem(key, serialize(rest));
    } catch {
      // the copy stays saved
    }
    return { entry: latest.entry, remaining: readable(rest) };
  } catch {
    return { entry: null, remaining: [] };
  }
}

/** False means the board is not saved, and must not be replaced. */
export function saveBeforeRestore(
  storage: StorageLike | null | undefined,
  roomId: string,
  board: StoredBoardSnapshot,
  now: number
): boolean {
  if (board.elements.length === 0) return true; // nothing to lose, and undo still returns to it
  if (!storage || !roomId) return false;
  try {
    if (isSaved(storage, roomId, board)) return true;
    const added = readEntry({
      id: `before_${now.toString(36)}`,
      savedAt: now,
      reason: "manual",
      removedCount: 0,
      previousElementCount: board.elements.length,
      snapshot: board,
    });
    if (!added) return false;
    const key = getBeforeRestoreStorageKey(roomId);
    const next = [{ stored: added, entry: added }, ...readCopies(storage, key)];
    storage.setItem(key, serialize(trimOldest(next, MAX_BEFORE_RESTORE_COPIES)));
    return true;
  } catch {
    return false;
  }
}

export type ListedCopy =
  | { kind: "copy"; entry: BoardRecoveryEntry; newest: boolean; fullest: boolean }
  | { kind: "unreadable"; raw: string };

/** Newest first, then any that can't be read. Reads only. */
export function listSavedCopies(storage: StorageLike | null | undefined, roomId: string): ListedCopy[] {
  if (!storage || !roomId) return [];
  try {
    const all = [getRecoveryStorageKey(roomId), getBeforeRestoreStorageKey(roomId)].flatMap((key) =>
      readCopies(storage, key)
    );
    const entries = readable(all).sort((a, b) => b.savedAt - a.savedAt);
    const fullest = fullestOf(entries);
    return [
      ...entries.map((entry, i): ListedCopy => ({ kind: "copy", entry, newest: i === 0, fullest: entry === fullest })),
      ...all.flatMap(({ stored, entry }): ListedCopy[] =>
        entry ? [] : [{ kind: "unreadable", raw: typeof stored === "string" ? stored : JSON.stringify(stored) }]
      ),
    ];
  } catch {
    return [];
  }
}

/** Cheap enough for every opening of the Board menu: it doesn't parse the copies. */
export function hasSavedCopies(storage: StorageLike | null | undefined, roomId: string): boolean {
  if (!storage || !roomId) return false;
  try {
    return [getRecoveryStorageKey(roomId), getBeforeRestoreStorageKey(roomId)].some((key) => {
      const raw = storage.getItem(key);
      return Boolean(raw) && raw !== "[]";
    });
  } catch {
    return false;
  }
}

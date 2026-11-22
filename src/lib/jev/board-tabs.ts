import { pruneTombstonesWithHorizon } from "./board-sync";
import { isContainerKind } from "./notation-kinds";
import type { StoredBoardSnapshot } from "./sync-validation";
import type { JevElement, TombstoneMap } from "./types";

/*
 * One person's tabs share one storage and one clock, so their boards merge without the peer rules of board-sync
 * (epochs, 24 hours, revision clamps, the bulk-change guard), each of which can refuse a tab its own work.
 *
 * Per element the last change wins: an edit by its updatedAt, a delete by its tombstone. applyLocalElementsChange
 * stamps both later than what they replace. An element that is only missing was not deleted: it is kept.
 */

function deletedIn(board: StoredBoardSnapshot, element: JevElement): boolean {
  const gone = board.tombstones?.[element.id];
  if (gone) return gone.deletedAt >= element.updatedAt;
  // Past the tombstone limit (a board over 500 cleared) only the horizon remembers the delete.
  return (board.tombstoneHorizonAt ?? 0) >= element.updatedAt;
}

function newer(mine: JevElement, stored: JevElement): JevElement {
  const later = mine.updatedAt - stored.updatedAt || (mine.rev ?? 0) - (stored.rev ?? 0);
  return later > 0 ? mine : stored;
}

export interface TabMerge {
  board: StoredBoardSnapshot;
  /** Storage already holds it, so there is nothing to write. */
  isStored: boolean;
}

export function mergeWithStored(
  mine: StoredBoardSnapshot,
  stored: StoredBoardSnapshot,
  changedHere: { content: boolean; title: boolean }
): TabMerge {
  const mineById = new Map(mine.elements.map((element) => [element.id, element]));
  const storedById = new Map(stored.elements.map((element) => [element.id, element]));
  const kept = new Map<string, JevElement>();
  for (const id of new Set([...storedById.keys(), ...mineById.keys()])) {
    const here = mineById.get(id);
    const there = storedById.get(id);
    if (here && there) kept.set(id, newer(here, there));
    else if (here && !deletedIn(stored, here)) kept.set(id, here);
    else if (there && !deletedIn(mine, there)) kept.set(id, there);
  }

  // Drawing order is the changed tab's. A tab that changed nothing takes the stored one, so all end the same.
  const [first, second] = changedHere.content ? [mine, stored] : [stored, mine];
  const firstIds = new Set(first.elements.map((element) => element.id));
  const inFirst = first.elements.flatMap((element) => kept.get(element.id) ?? []);
  const added = second.elements.flatMap((element) =>
    firstIds.has(element.id) ? [] : (kept.get(element.id) ?? [])
  );
  const elements = [
    ...added.filter((element) => isContainerKind(element.kind)),
    ...inFirst,
    ...added.filter((element) => !isContainerKind(element.kind)),
  ];

  const tombstones: TombstoneMap = { ...stored.tombstones };
  for (const [id, gone] of Object.entries(mine.tombstones ?? {})) {
    if (!tombstones[id] || gone.deletedAt > tombstones[id].deletedAt) tombstones[id] = gone;
  }
  for (const id of kept.keys()) delete tombstones[id];
  const pruned = pruneTombstonesWithHorizon(
    tombstones,
    Math.max(mine.tombstoneHorizonRev ?? 0, stored.tombstoneHorizonRev ?? 0),
    { currentHorizonAt: Math.max(mine.tombstoneHorizonAt ?? 0, stored.tombstoneHorizonAt ?? 0) }
  );

  const titled = changedHere.title || stored.boardTitle === undefined ? mine : stored;
  const isStored =
    titled.boardTitle === (stored.boardTitle ?? mine.boardTitle) &&
    elements.length === stored.elements.length &&
    elements.every((element, i) => element === stored.elements[i]);

  return {
    isStored,
    board: {
      elements,
      boardTitle: titled.boardTitle,
      titleRev: Math.max(mine.titleRev ?? 0, stored.titleRev ?? 0),
      titleUpdatedBy: titled.titleUpdatedBy,
      ...pruned,
      boardEpoch: stored.boardEpoch ?? mine.boardEpoch,
      boardEpochCreatedAt: stored.boardEpochCreatedAt ?? mine.boardEpochCreatedAt,
      baseTimestamp: Math.max(mine.baseTimestamp ?? 0, stored.baseTimestamp ?? 0),
      hasLocalEdits: Boolean(mine.hasLocalEdits || stored.hasLocalEdits || stored.elements.length),
    },
  };
}

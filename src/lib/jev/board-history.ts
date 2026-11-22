import type { JevElement } from "./types";

const MAX_HISTORY_ENTRIES = 40;

export interface CommitLocalOptions {
  recordUndo?: boolean;
  undoSnapshot?: JevElement[];
  /**
   * Remote sync generation recorded when the drag/resize began.
   * If a remote sync incremented `remoteSyncGeneration` before `pointerup`,
   * the stale pre-drag undo snapshot is dropped so Undo never wipes a peer's change.
   */
  expectedRemoteSyncGeneration?: number;
  /** For a step that also renames the board, so one undo takes both back. */
  title?: { before: string; after: string };
}

interface HistoryStep {
  elements: JevElement[];
  title?: CommitLocalOptions["title"];
}

export type CanvasDragMode =
  | "pan"
  | "move"
  | "resize"
  | "connect"
  | "draw_shape"
  | "freedraw"
  | "marquee";

export function resolvePointerCancelDecision(params: {
  mode: CanvasDragMode;
  movedEnough?: boolean;
  hasPreDragElements: boolean;
  dragStartSyncGeneration?: number;
  currentSyncGeneration: number;
}): { shouldRestorePreDrag: boolean } {
  const isTransform = params.mode === "move" || params.mode === "resize";
  const remoteChangedMidDrag =
    params.dragStartSyncGeneration !== undefined &&
    params.dragStartSyncGeneration !== params.currentSyncGeneration;

  if (
    isTransform &&
    params.movedEnough &&
    params.hasPreDragElements &&
    !remoteChangedMidDrag
  ) {
    return { shouldRestorePreDrag: true };
  }
  return { shouldRestorePreDrag: false };
}

/**
 * Pure, synchronous undo/redo history controller that keeps all stack mutations
 * outside React state updaters, supports explicit pre-drag snapshots, and clears
 * local history when remote peer changes arrive so Undo never clobbers a peer.
 */
export class BoardHistoryController {
  private _current: JevElement[];
  private _remoteSyncGeneration = 0;
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private _steppedTitle: string | undefined;

  constructor(initialElements: JevElement[]) {
    this._current = initialElements;
  }

  get current(): JevElement[] {
    return this._current;
  }

  get remoteSyncGeneration(): number {
    return this._remoteSyncGeneration;
  }

  /** The title the last undo or redo moved to, if that step changed it. */
  get steppedTitle(): string | undefined {
    return this._steppedTitle;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  snapshotForDrag(): JevElement[] {
    return this._current.map((el) => ({ ...el }));
  }

  replaceWithoutHistory(next: JevElement[]): void {
    this._current = next;
  }

  commitLocal(next: JevElement[], opts?: CommitLocalOptions): void {
    const recordUndo = opts?.recordUndo ?? true;
    const stalePreDrag =
      opts?.expectedRemoteSyncGeneration !== undefined &&
      opts.expectedRemoteSyncGeneration !== this._remoteSyncGeneration;

    if (recordUndo && !stalePreDrag) {
      const snapshot = opts?.undoSnapshot ?? this._current;
      this.undoStack = [
        ...this.undoStack.slice(-(MAX_HISTORY_ENTRIES - 1)),
        { elements: snapshot, title: opts?.title },
      ];
      this.redoStack = [];
    }
    this._current = next;
  }

  applyRemote(
    next: JevElement[],
    opts?: { clearHistory?: boolean }
  ): void {
    this._current = next;
    this._remoteSyncGeneration += 1;
    if (opts?.clearHistory ?? true) {
      this.undoStack = [];
      this.redoStack = [];
    }
  }

  undo(): JevElement[] | null {
    if (this.undoStack.length === 0) return null;
    const previous = this.undoStack[this.undoStack.length - 1];
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [
      ...this.redoStack.slice(-(MAX_HISTORY_ENTRIES - 1)),
      { elements: this._current, title: previous.title },
    ];
    this._current = previous.elements;
    this._steppedTitle = previous.title?.before;
    return previous.elements;
  }

  redo(): JevElement[] | null {
    if (this.redoStack.length === 0) return null;
    const next = this.redoStack[this.redoStack.length - 1];
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [
      ...this.undoStack.slice(-(MAX_HISTORY_ENTRIES - 1)),
      { elements: this._current, title: next.title },
    ];
    this._current = next.elements;
    this._steppedTitle = next.title?.after;
    return next.elements;
  }
}

/**
 * Leading + trailing throttler for active drag/resize broadcasts (~60ms cadence)
 * with guaranteed immediate flush on pointerup.
 */
export class BroadcastThrottler<T> {
  private readonly send: (payload: T) => void;
  private readonly intervalMs: number;
  private lastSentAt = -Infinity;
  private pending: T | null = null;
  private hasPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(send: (payload: T) => void, intervalMs = 60) {
    this.send = send;
    this.intervalMs = intervalMs;
  }

  schedule(payload: T): void {
    const now = Date.now();
    const elapsed = now - this.lastSentAt;

    if (elapsed >= this.intervalMs && this.timer === null) {
      this.lastSentAt = now;
      this.pending = null;
      this.hasPending = false;
      this.send(payload);
      return;
    }

    this.pending = payload;
    this.hasPending = true;

    if (this.timer === null) {
      const waitMs = Math.max(0, this.intervalMs - elapsed);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.hasPending && this.pending !== null) {
          const toSend = this.pending;
          this.pending = null;
          this.hasPending = false;
          this.lastSentAt = Date.now();
          this.send(toSend);
        }
      }, waitMs);
    }
  }

  flushNow(payload?: T): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const toSend =
      payload !== undefined ? payload : this.hasPending ? this.pending : null;
    this.pending = null;
    this.hasPending = false;
    if (toSend !== null) {
      this.lastSentAt = Date.now();
      this.send(toSend);
    }
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.hasPending = false;
  }
}

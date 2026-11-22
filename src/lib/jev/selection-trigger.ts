/**
 * Decides WHEN selection-based predictions appear: on a settled selection (at once with `delayMs: 0`, which is
 * how the workspace runs it: the suggestions are local and instant), never
 * while the canvas is busy (drag, marquee, inline edit), never for a selection that was just moved or
 * edited (those flows refresh predictions themselves), and not again after Esc until the selection
 * changes. Each fire gets an AbortSignal that aborts as soon as the selection changes.
 */
export const SELECTION_SUGGEST_DELAY_MS = 500;

export function selectionKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join("|");
}

export class SelectionSuggestTrigger {
  private readonly delayMs: number;
  private readonly onFire: (key: string, signal: AbortSignal) => void;
  private key = "";
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done = new Set<string>();
  private inflight: AbortController | null = null;

  constructor(opts: { delayMs?: number; onFire: (key: string, signal: AbortSignal) => void }) {
    this.delayMs = opts.delayMs ?? SELECTION_SUGGEST_DELAY_MS;
    this.onFire = opts.onFire;
  }

  select(ids: readonly string[]): void {
    const next = selectionKey(ids);
    if (next === this.key) return;
    this.key = next;
    this.done.clear();
    this.abortInflight();
    this.schedule();
  }

  /** A selection the app set itself (new node, applied prediction): remember it, never fire for it. */
  adopt(ids: readonly string[]): void {
    const next = selectionKey(ids);
    if (next === this.key) return;
    this.key = next;
    this.done.clear();
    this.abortInflight();
    this.markDone();
  }

  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    if (busy) this.cancelTimer();
    else this.schedule();
  }

  /** The current selection was moved or edited; its own flow shows predictions. */
  consume(): void {
    this.markDone();
  }

  /** Esc: hide and stay hidden for this selection until it changes. */
  dismiss(): void {
    this.markDone();
    this.abortInflight();
  }

  reset(): void {
    this.cancelTimer();
    this.abortInflight();
    this.key = "";
    this.done.clear();
    this.busy = false;
  }

  private markDone(): void {
    if (this.key) this.done.add(this.key);
    this.cancelTimer();
  }

  private schedule(): void {
    this.cancelTimer();
    if (!this.key || this.busy || this.done.has(this.key)) return;
    const key = this.key;
    const fire = () => {
      this.timer = null;
      if (this.key !== key || this.busy || this.done.has(key)) return;
      this.done.add(key);
      this.abortInflight();
      this.inflight = new AbortController();
      this.onFire(key, this.inflight.signal);
    };
    // No delay: fire now, in the same turn as the click, so nothing can be pressed against the old suggestions.
    if (this.delayMs <= 0) fire();
    else this.timer = setTimeout(fire, this.delayMs);
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private abortInflight(): void {
    this.inflight?.abort();
    this.inflight = null;
  }
}

/** Shift-click toggles a node in the selection (existing); Cmd/Ctrl-click does the same. */
export function isAdditiveSelectClick(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey;
}

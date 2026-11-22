/**
 * Decides WHEN the AI is asked about the suggestions on screen: once, after the board has settled.
 *
 * Every add, click, rename, arrow and drag wants the AI's opinion. Sending each one drains the server's
 * per-minute budget (an aborted request is not refunded), so a request waits here until no key or pointer was
 * pressed for `delayMs` and nothing is in progress (a drag, a label being typed, a drawing tool in hand, Fork).
 * A newer request replaces the waiting one: only the latest is ever sent.
 */
export const ASK_SETTLE_MS = 1000;

type Timer = ReturnType<typeof setTimeout>;

export class SettledAsk<T> {
  private readonly delayMs: number;
  private readonly send: (job: T) => void;
  private readonly now: () => number;
  private waiting: T | null = null;
  private busy = false;
  private lastActivity = Number.NEGATIVE_INFINITY;
  private timer: Timer | null = null;

  constructor(opts: { delayMs?: number; send: (job: T) => void; now?: () => number }) {
    this.delayMs = opts.delayMs ?? ASK_SETTLE_MS;
    this.send = opts.send;
    this.now = opts.now ?? Date.now;
  }

  /** Ask about this once the board settles; replaces whatever was waiting. */
  request(job: T): void {
    this.waiting = job;
    this.arm();
  }

  /** The user pressed a key or the pointer: the board is not settled yet. */
  touch(): void {
    this.lastActivity = this.now();
    if (this.waiting !== null) this.arm();
  }

  /** Something is in progress (drag, label edit, drawing tool, Fork): hold the waiting request until it ends. */
  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.lastActivity = this.now();
    this.arm();
  }

  /** The suggestions the waiting request was about are gone: never send it. */
  cancel(): void {
    this.waiting = null;
    this.clearTimer();
  }

  /** Keeps the waiting request only while it is still about what is on screen. */
  dropUnless(keep: (job: T) => boolean): void {
    if (this.waiting !== null && !keep(this.waiting)) this.cancel();
  }

  get pending(): boolean {
    return this.waiting !== null;
  }

  private arm(): void {
    this.clearTimer();
    if (this.waiting === null || this.busy) return;
    const wait = Math.max(0, this.lastActivity + this.delayMs - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      const job = this.waiting;
      this.waiting = null;
      if (job !== null) this.send(job);
    }, wait);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

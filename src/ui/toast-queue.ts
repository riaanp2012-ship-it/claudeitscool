import type { ToastKind } from './ui-types';

export interface ToastEntry {
  id: number;
  text: string;
  kind: ToastKind;
  /** Time (ms, caller's clock) when the toast auto-dismisses. */
  expires: number;
}

export interface ToastPush {
  entry: ToastEntry;
  /** Toasts removed to respect the stack limit (oldest first). */
  evicted: ToastEntry[];
  /** True when an identical visible toast was refreshed instead of stacking a duplicate. */
  refreshed: boolean;
}

export const TOAST_LIFETIME: Readonly<Record<ToastKind, number>> = { info: 4000, warn: 6500, success: 4500 };

/** Bounded toast stack (ZD-J12): at most `max` visible, duplicates refresh, oldest evicted first. */
export class ToastQueue {
  private list: ToastEntry[] = [];
  private nextId = 1;

  constructor(
    readonly max = 3,
    private readonly lifetime: Readonly<Record<ToastKind, number>> = TOAST_LIFETIME,
  ) {}

  get items(): readonly ToastEntry[] {
    return this.list;
  }

  push(text: string, kind: ToastKind, now: number): ToastPush {
    const expires = now + this.lifetime[kind];
    const same = this.list.find((t) => t.text === text && t.kind === kind);
    if (same) {
      same.expires = expires;
      return { entry: same, evicted: [], refreshed: true };
    }
    const entry: ToastEntry = { id: this.nextId++, text, kind, expires };
    this.list.push(entry);
    const evicted: ToastEntry[] = [];
    while (this.list.length > this.max) evicted.push(this.list.shift()!);
    return { entry, evicted, refreshed: false };
  }

  /** Removes and returns every toast whose time is up. */
  expire(now: number): ToastEntry[] {
    const gone = this.list.filter((t) => t.expires <= now);
    if (gone.length) this.list = this.list.filter((t) => t.expires > now);
    return gone;
  }

  remove(id: number): boolean {
    const n = this.list.length;
    this.list = this.list.filter((t) => t.id !== id);
    return this.list.length !== n;
  }

  /** Earliest expiry time, or null when empty. */
  nextExpiry(): number | null {
    let best: number | null = null;
    for (const t of this.list) if (best === null || t.expires < best) best = t.expires;
    return best;
  }

  clear(): void {
    this.list = [];
  }
}

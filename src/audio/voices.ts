/**
 * Voice bookkeeping with no Web Audio dependency (unit-tested in Node): per-category voice caps with
 * priority stealing, per-sound rate limiting, and the audible-set selection for looping voices.
 * Everything uses typed arrays sized at construction, so steady-state use never allocates.
 */

export interface AllocResult {
  /** Slot of the new voice, or -1 when the request was rejected. */
  voice: number;
  /** Slot that was stolen to make room (the caller must fade it out), or -1. */
  stolen: number;
}

/**
 * Fixed-capacity voice allocator. Each category has a cap; the whole pool has a global cap. When a cap is
 * reached, the lowest-priority voice (oldest on ties) in the full scope is stolen if the new voice's priority
 * is at least as high; otherwise the request is rejected.
 */
export class VoiceAllocator {
  private readonly category: Int16Array;
  private readonly priority: Float32Array;
  private readonly start: Float64Array;
  private readonly used: Uint8Array;
  private readonly counts: Int32Array;
  private liveCount = 0;
  private readonly result: AllocResult = { voice: -1, stolen: -1 };

  constructor(
    private readonly limits: readonly number[],
    readonly capacity: number,
  ) {
    this.category = new Int16Array(capacity);
    this.priority = new Float32Array(capacity);
    this.start = new Float64Array(capacity);
    this.used = new Uint8Array(capacity);
    this.counts = new Int32Array(limits.length);
  }

  get live(): number {
    return this.liveCount;
  }

  count(category: number): number {
    return this.counts[category] ?? 0;
  }

  isUsed(voice: number): boolean {
    return this.used[voice] === 1;
  }

  /** The returned object is reused by the next call; read it immediately. */
  acquire(category: number, priority: number, now: number): AllocResult {
    const r = this.result;
    r.voice = -1;
    r.stolen = -1;
    const limit = this.limits[category] ?? 0;
    if (limit <= 0 || Number.isNaN(priority)) return r;
    const catFull = (this.counts[category] ?? 0) >= limit;
    const globalFull = this.liveCount >= this.capacity;
    if (catFull || globalFull) {
      let victim = -1;
      for (let i = 0; i < this.capacity; i++) {
        if (this.used[i] !== 1) continue;
        if (catFull && this.category[i] !== category) continue;
        if (
          victim < 0 ||
          this.priority[i]! < this.priority[victim]! ||
          (this.priority[i] === this.priority[victim] && this.start[i]! < this.start[victim]!)
        ) {
          victim = i;
        }
      }
      if (victim < 0 || this.priority[victim]! > priority) return r;
      this.release(victim);
      r.stolen = victim;
    }
    for (let i = 0; i < this.capacity; i++) {
      if (this.used[i] === 1) continue;
      this.used[i] = 1;
      this.category[i] = category;
      this.priority[i] = priority;
      this.start[i] = now;
      this.counts[category] = (this.counts[category] ?? 0) + 1;
      this.liveCount++;
      r.voice = i;
      return r;
    }
    return r;
  }

  release(voice: number): void {
    if (voice < 0 || voice >= this.capacity || this.used[voice] !== 1) return;
    this.used[voice] = 0;
    const c = this.category[voice]!;
    this.counts[c] = Math.max(0, (this.counts[c] ?? 0) - 1);
    this.liveCount--;
  }

  releaseAll(): void {
    this.used.fill(0);
    this.counts.fill(0);
    this.liveCount = 0;
  }
}

/**
 * Per-key trigger limiter (ZD-I08). Triggers closer than `minInterval` are rejected; accepted triggers that
 * follow each other within `window` get progressively quieter (decay^streak, floored), and the streak resets
 * after a pause, so fast hovering never machine-guns and repeated sounds never pile up in level.
 */
export class RateLimiter {
  private readonly last: Float64Array;
  private readonly streak: Int32Array;

  constructor(readonly size: number) {
    this.last = new Float64Array(size).fill(-Infinity);
    this.streak = new Int32Array(size);
  }

  /** Returns the gain scale for an accepted trigger, or 0 when rejected. */
  acquire(key: number, now: number, minInterval: number, window: number, decay = 0.78, floor = 0.4): number {
    if (key < 0 || key >= this.size) return 0;
    const dt = now - this.last[key]!;
    if (dt < minInterval) return 0;
    const s = dt < window ? this.streak[key]! + 1 : 0;
    this.streak[key] = s;
    this.last[key] = now;
    return Math.max(floor, Math.pow(decay, s));
  }

  reset(): void {
    this.last.fill(-Infinity);
    this.streak.fill(0);
  }
}

/**
 * Chooses the loudest `k` looping voices (engines, AI guns) to keep audible. Voices already audible get a
 * hysteresis bonus so the set does not flicker when two voices have similar scores.
 */
export class AudibleSelector {
  private scores: Float32Array;
  private picked: Uint8Array;

  constructor(capacity = 32) {
    this.scores = new Float32Array(capacity);
    this.picked = new Uint8Array(capacity);
  }

  /**
   * `scores[i]` is the estimated loudness of voice i; `selected[i]` is 1 when it is currently audible and is
   * overwritten with the new selection. Returns the number selected.
   */
  select(
    scores: ArrayLike<number>,
    count: number,
    k: number,
    threshold: number,
    hysteresis: number,
    selected: Uint8Array,
  ): number {
    if (count > this.scores.length) {
      const cap = Math.max(count, this.scores.length * 2);
      this.scores = new Float32Array(cap);
      this.picked = new Uint8Array(cap);
    }
    for (let i = 0; i < count; i++) {
      const s = scores[i] ?? 0;
      this.scores[i] = selected[i] === 1 ? s * hysteresis : s;
      this.picked[i] = 0;
    }
    let n = 0;
    for (let round = 0; round < k; round++) {
      let best = -1;
      let bestScore = threshold;
      for (let i = 0; i < count; i++) {
        if (this.picked[i] === 1) continue;
        const s = this.scores[i]!;
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      }
      if (best < 0) break;
      this.picked[best] = 1;
      n++;
    }
    for (let i = 0; i < count; i++) selected[i] = this.picked[i]!;
    return n;
  }
}

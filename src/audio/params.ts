/**
 * AudioParam helpers. Rules (ZD-I02): gains never jump; every change is a ramp of at least MIN_RAMP, and
 * continuous controls are only re-scheduled when they change meaningfully (keeps the automation timeline
 * short and the per-frame cost near zero).
 */

/** Shortest gain ramp anywhere in the audio module (s). */
export const MIN_RAMP = 0.005;

/** Freezes a param at its current value, removing future automation, without a jump. */
export function holdParam(p: AudioParam, now: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(now);
  } else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
}

/** Smoothly moves a param to `target` with time constant `tc` (reaches ~99% after 5·tc). */
export function glide(p: AudioParam, target: number, now: number, tc: number): void {
  holdParam(p, now);
  p.setTargetAtTime(target, now, Math.max(tc, MIN_RAMP / 3));
}

/**
 * A continuously controlled AudioParam. `set` only schedules a new target when the value moved by more than
 * the absolute or relative epsilon since the last scheduled target, so calling it every frame is cheap.
 */
export class SmoothParam {
  private last = Number.NaN;

  constructor(
    readonly param: AudioParam,
    private readonly tc: number,
    private readonly absEps = 1e-3,
    private readonly relEps = 0.01,
  ) {}

  get value(): number {
    return this.last;
  }

  set(v: number, now: number): void {
    if (!Number.isFinite(v)) return;
    const last = this.last;
    if (!Number.isNaN(last)) {
      const d = Math.abs(v - last);
      if (d <= this.absEps || d <= Math.abs(last) * this.relEps) return;
    }
    this.last = v;
    this.param.setTargetAtTime(v, now, this.tc);
  }

  /** Starts from `v` now (used when a graph is first built, before any sound flows). */
  init(v: number, now: number): void {
    if (!Number.isFinite(v)) return;
    this.last = v;
    this.param.cancelScheduledValues(now);
    this.param.setValueAtTime(v, now);
  }

  /** `init` on the first write of a freshly built graph, `set` afterwards. */
  put(v: number, now: number, first: boolean): void {
    if (first) this.init(v, now);
    else this.set(v, now);
  }

  /** Forget the last target so the next `set` always schedules. */
  invalidate(): void {
    this.last = Number.NaN;
  }
}

/**
 * Attack/decay envelope: linear rise from 0 to `peak` over `attack` (≥ MIN_RAMP), exponential fall to -80 dB
 * over `decay`, then a final linear ramp to exactly 0. Returns the time the envelope reaches 0.
 */
export function envAD(p: AudioParam, t0: number, attack: number, peak: number, decay: number): number {
  const a = Math.max(attack, MIN_RAMP);
  const d = Math.max(decay, 0.01);
  const pk = Math.max(peak, 1e-6);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(pk, t0 + a);
  p.exponentialRampToValueAtTime(pk * 1e-4, t0 + a + d);
  p.linearRampToValueAtTime(0, t0 + a + d + MIN_RAMP);
  return t0 + a + d + MIN_RAMP;
}

/**
 * Attack/hold/release envelope: linear rise to `peak`, hold, exponential release to -80 dB over `release`,
 * then linear to 0. Returns the end time.
 */
export function envAHR(
  p: AudioParam,
  t0: number,
  attack: number,
  peak: number,
  hold: number,
  release: number,
): number {
  const a = Math.max(attack, MIN_RAMP);
  const r = Math.max(release, 0.01);
  const pk = Math.max(peak, 1e-6);
  const h = Math.max(0, hold);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(pk, t0 + a);
  if (h > 0) p.setValueAtTime(pk, t0 + a + h);
  p.exponentialRampToValueAtTime(pk * 1e-4, t0 + a + h + r);
  p.linearRampToValueAtTime(0, t0 + a + h + r + MIN_RAMP);
  return t0 + a + h + r + MIN_RAMP;
}

/** Linear attack, linear release trapezoid (for gated tones). Returns the end time. */
export function envTrap(
  p: AudioParam,
  t0: number,
  attack: number,
  peak: number,
  hold: number,
  release: number,
): number {
  const a = Math.max(attack, MIN_RAMP);
  const r = Math.max(release, MIN_RAMP);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + a);
  p.setValueAtTime(peak, t0 + a + Math.max(0, hold));
  p.linearRampToValueAtTime(0, t0 + a + Math.max(0, hold) + r);
  return t0 + a + Math.max(0, hold) + r;
}

/** Exponential sweep of a positive param (frequency) from `from` to `to` over `dur`. */
export function sweep(p: AudioParam, t0: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(from, 1e-3), t0);
  p.exponentialRampToValueAtTime(Math.max(to, 1e-3), t0 + Math.max(dur, 0.001));
}

/** Stops a scheduled source, tolerating sources that already stopped or had a stop scheduled. */
export function safeStop(src: AudioScheduledSourceNode, when: number): void {
  try {
    src.stop(when);
  } catch {
    // Already stopped: nothing left to do.
  }
}

/** Disconnects a node, tolerating nodes that are not connected. */
export function safeDisconnect(node: AudioNode | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // Not connected.
  }
}

/** Pure value helpers for steppers, sliders and option selectors. */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Number of decimals needed to represent `step` exactly (0.05 -> 2). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const e = s.indexOf('e-');
  if (e >= 0) return Number(s.slice(e + 2));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Snaps `v` to the grid min + k * step, clamps it to [min, max] and removes float noise. */
export function snap(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const k = Math.round((v - min) / step);
  const d = decimalsOf(step) + decimalsOf(min);
  const snapped = Number((min + k * step).toFixed(d));
  return clamp(snapped, min, max);
}

/**
 * One stepper increment. Off-grid values first snap in the direction of travel, so pressing
 * right on 0.83 with a 0.05 step goes to 0.85, never back to 0.80.
 */
export function stepRange(value: number, dir: 1 | -1, min: number, max: number, step: number): number {
  const d = decimalsOf(step) + decimalsOf(min);
  const k = (value - min) / step;
  const kr = Number(k.toFixed(6));
  const next = dir > 0 ? Math.floor(kr) + 1 : Math.ceil(kr) - 1;
  return clamp(Number((min + next * step).toFixed(d)), min, max);
}

/** Maps a 0..1 pointer fraction on a slider track to a snapped value. */
export function valueFromFraction(fraction: number, min: number, max: number, step: number): number {
  return snap(min + clamp(fraction, 0, 1) * (max - min), min, max, step);
}

/** 0..1 position of `value` inside [min, max]. */
export function fractionOf(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/**
 * Next option in a list, skipping disabled options. Without `wrap` it stops at the ends
 * (returning the current value). An unknown current value moves to the first enabled option.
 */
export function stepChoice<T>(
  options: readonly T[],
  current: T,
  dir: 1 | -1,
  isEnabled: (option: T) => boolean = () => true,
  wrap = false,
): T {
  const n = options.length;
  if (n === 0) return current;
  const at = options.indexOf(current);
  if (at < 0) {
    for (const o of options) if (isEnabled(o)) return o;
    return current;
  }
  let i = at;
  for (let k = 0; k < n; k++) {
    i += dir;
    if (i < 0 || i >= n) {
      if (!wrap) return current;
      i = (i + n) % n;
    }
    const o = options[i]!;
    if (isEnabled(o)) return o;
  }
  return current;
}

/** Stepper over an explicit ascending list of values (for example time limits 0, 5, 10, 15 ...). */
export function stepList(values: readonly number[], current: number, dir: 1 | -1): number {
  if (values.length === 0) return current;
  if (dir > 0) {
    for (const v of values) if (v > current) return v;
    return values[values.length - 1]!;
  }
  for (let i = values.length - 1; i >= 0; i--) if (values[i]! < current) return values[i]!;
  return values[0]!;
}

/** True when a step in `dir` would not change the value (used to play the error cue at a limit). */
export function atLimit(value: number, dir: 1 | -1, min: number, max: number): boolean {
  return dir > 0 ? value >= max : value <= min;
}

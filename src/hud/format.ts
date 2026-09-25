import { FEET_PER_M, KMH_PER_MS, KNOTS_PER_MS, RAD } from '../core/math';

/**
 * Pure unit conversion and number formatting for the HUD. Every per-frame string goes through a
 * `StringCache` keyed by the rounded display value, so a steady frame builds no strings (spec §10.3).
 */

export type HudUnits = 'imperial' | 'metric';

export const FPM_PER_MS = FEET_PER_M * 60;
export const M_PER_NM = 1852;

/** Airspeed in knots (imperial) or km/h (metric). */
export function speedIn(ms: number, units: HudUnits): number {
  return units === 'imperial' ? ms * KNOTS_PER_MS : ms * KMH_PER_MS;
}

/** Closure rate in the airspeed unit (knots or km/h). */
export function closureIn(ms: number, units: HudUnits): number {
  return speedIn(ms, units);
}

/** Altitude in feet (imperial) or meters (metric). */
export function altitudeIn(m: number, units: HudUnits): number {
  return units === 'imperial' ? m * FEET_PER_M : m;
}

/** Vertical speed in ft/min (imperial) or m/s (metric). */
export function verticalSpeedIn(ms: number, units: HudUnits): number {
  return units === 'imperial' ? ms * FPM_PER_MS : ms;
}

/** Target and radar ranges in nautical miles (imperial) or kilometers (metric). */
export function distanceIn(m: number, units: HudUnits): number {
  return units === 'imperial' ? m / M_PER_NM : m / 1000;
}

export function speedUnitLabel(units: HudUnits): string {
  return units === 'imperial' ? 'KT' : 'KM/H';
}

export function altitudeUnitLabel(units: HudUnits): string {
  return units === 'imperial' ? 'FT' : 'M';
}

export function distanceUnitLabel(units: HudUnits): string {
  return units === 'imperial' ? 'NM' : 'KM';
}

/**
 * Bounded memo from an integer key to its display string. Lookups never allocate; a miss formats once.
 * When the table fills (a pathological sweep through values) it is cleared rather than grown.
 */
export class StringCache {
  private readonly map = new Map<number, string>();

  constructor(
    private readonly format: (key: number) => string,
    private readonly capacity = 4096,
  ) {}

  get(key: number): string {
    let s = this.map.get(key);
    if (s === undefined) {
      if (this.map.size >= this.capacity) this.map.clear();
      s = this.format(key);
      this.map.set(key, s);
    }
    return s;
  }

  get size(): number {
    return this.map.size;
  }
}

/** Rounds to an integer key, mapping NaN/Infinity to 0 so the HUD never shows NaN (ZD-J03). */
export function roundKey(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/** Fixed-point text for an integer key holding value × 10^digits, without a '-0' artifact. */
export function fixedFromKey(key: number, digits: number): string {
  const scale = Math.pow(10, digits);
  const v = key / scale;
  const s = v.toFixed(digits);
  return key === 0 ? (0).toFixed(digits) : s;
}

/** Integer with thousands separators: 12480 → '12,480', -1200 → '-1,200'. */
export function thousands(n: number): string {
  const neg = n < 0;
  let a = Math.abs(Math.trunc(n));
  if (a < 1000) return neg ? '-' + a : String(a);
  let out = '';
  while (a >= 1000) {
    const rem = a % 1000;
    out = ',' + (rem < 10 ? '00' : rem < 100 ? '0' : '') + rem + out;
    a = Math.floor(a / 1000);
  }
  return (neg ? '-' : '') + a + out;
}

/** Explicit sign for rates: '+2400', '-300', '0'. */
export function signed(n: number): string {
  if (n > 0) return '+' + n;
  if (n < 0) return String(n);
  return '0';
}

/** Whole heading degrees 0..359 from radians clockwise from north. */
export function headingDegrees(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const d = Math.round(rad * RAD) % 360;
  return d < 0 ? d + 360 : d;
}

/** '005', '274'. */
export function pad3(n: number): string {
  const a = Math.abs(Math.trunc(n)) % 1000;
  return a < 10 ? '00' + a : a < 100 ? '0' + a : String(a);
}

/** Compass card label for a heading tape major tick (every 10°): N/E/S/W or the tens, '03', '33'. */
export function compassLabel(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  if (d === 0) return 'N';
  if (d === 90) return 'E';
  if (d === 180) return 'S';
  if (d === 270) return 'W';
  const tens = Math.round(d / 10);
  return tens < 10 ? '0' + tens : String(tens);
}

/** 'm:ss' for a whole number of seconds (negative clamps to 0). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

/**
 * Range key with adaptive precision in the display unit: < 1 → two decimals, < 10 → one decimal,
 * otherwise whole units. Each displayed string maps to exactly one key.
 */
export function rangeKey(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v < 0.995) return Math.round(v * 100);
  if (v < 9.95) return 1000 + Math.round(v * 10);
  return 100000 + Math.round(Math.min(v, 99999));
}

export function rangeText(key: number): string {
  if (key < 1000) return (key / 100).toFixed(2);
  if (key < 100000) return ((key - 1000) / 10).toFixed(1);
  return String(key - 100000);
}

/** Radar range label: whole units above 10, one decimal below ('2.5', '20'). */
export function radarRangeKey(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v < 9.95 ? Math.round(v * 10) : 1000 + Math.round(v);
}

export function radarRangeText(key: number): string {
  if (key < 1000) return key % 10 === 0 ? String(key / 10) : (key / 10).toFixed(1);
  return String(key - 1000);
}

/** Tape drum split: `prefix` is the static leading part, `roll` the continuously rolling fraction. */
export interface DrumSplit {
  /** floor(value / modulus), the digits left of the drum. */
  prefix: number;
  /** Drum position in steps, 0 ≤ roll < modulus/step (fractional; e.g. 2.6 = between '2' and '3'). */
  roll: number;
  /** 0..1 carry progress: how far the prefix is rolling toward prefix + 1 (last step before a carry). */
  carry: number;
}

/** Fraction of each drum step spent rolling; the rest of the step the digit rests centered (detent). */
export const DRUM_ROLL_SPAN = 0.25;

/** Detent easing: 0 while frac < 1 - span, then a smooth roll to 1. */
export function detent(frac: number, span = DRUM_ROLL_SPAN): number {
  const t = (frac - (1 - span)) / span;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Splits a non-negative value for a rolling-digit counter. `modulus` is the drum span (10 for a ones
 * drum, 100 for a two-digit altitude drum) and `step` its increment (1, 10 or 20). The drum rests on
 * each digit and rolls only through the last part of a step, so a still frame always reads cleanly.
 */
export function drumSplit(value: number, modulus: number, step: number, out: DrumSplit): DrumSplit {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  const prefix = Math.floor(v / modulus);
  const rem = v - prefix * modulus;
  const steps = modulus / step;
  const raw = Math.min(rem / step, steps - 1e-9);
  const whole = Math.floor(raw);
  const roll = whole + detent(raw - whole);
  out.prefix = prefix;
  out.roll = roll;
  out.carry = roll > steps - 1 ? roll - (steps - 1) : 0;
  return out;
}

/** Drum digit strings for one column: ['0'..'9'] or ['00','20',...,'80']. */
export function drumLabels(modulus: number, step: number): string[] {
  const n = Math.round(modulus / step);
  const width = String(modulus - step).length;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let s = String(i * step);
    while (s.length < width) s = '0' + s;
    out.push(s);
  }
  return out;
}

/** Altitude drum prefix text: hundreds with the thousands separator ('12,4' for 124 → 12,4xx). */
export function altitudePrefix(hundreds: number): string {
  if (hundreds <= 0) return '';
  if (hundreds < 10) return String(hundreds);
  const t = Math.floor(hundreds / 10);
  return thousands(t) + ',' + (hundreds % 10);
}

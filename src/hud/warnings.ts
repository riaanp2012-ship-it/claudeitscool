import type { HudWarning } from '../core/types';

/** Highest priority first (spec §8.6): only the first active warning flashes. */
export const WARNING_PRIORITY: readonly HudWarning[] = [
  'MISSILE',
  'PULL UP',
  'STALL',
  'OVER-G',
  'ENGINE FIRE',
  'OUT OF BOUNDS',
  'BINGO',
];

/** 0 = most critical. Unknown strings rank last. */
export function warningRank(w: HudWarning): number {
  const i = WARNING_PRIORITY.indexOf(w);
  return i < 0 ? WARNING_PRIORITY.length : i;
}

/** Master warnings (red) versus cautions (amber). */
export function isCritical(w: HudWarning): boolean {
  return w === 'MISSILE' || w === 'PULL UP' || w === 'STALL' || w === 'OVER-G' || w === 'ENGINE FIRE';
}

/**
 * Writes the active warnings into `out` in priority order without duplicates and returns the count.
 * `out` must hold at least WARNING_PRIORITY.length entries. Allocation-free.
 */
export function prioritizeWarnings(active: readonly HudWarning[], out: HudWarning[]): number {
  let n = 0;
  for (let p = 0; p < WARNING_PRIORITY.length; p++) {
    const w = WARNING_PRIORITY[p]!;
    for (let i = 0; i < active.length; i++) {
      if (active[i] === w) {
        out[n++] = w;
        break;
      }
    }
  }
  return n;
}

/** Flash rate of the top warning. Kept well under 3 Hz (spec §8.9) and never a hard strobe. */
export const WARNING_FLASH_HZ = 1.6;
const FLASH_LOW = 0.35;

/**
 * Opacity of the flashing warning at time t (s): a square wave softened at the edges, alternating
 * between full and 35 % so the text stays legible in the low phase.
 */
export function flashAlpha(t: number, hz = WARNING_FLASH_HZ): number {
  const phase = t * hz - Math.floor(t * hz); // 0..1
  // Smoothed square: high for the first 60 % of the cycle, 60 ms-ish ramps.
  const edge = 0.08;
  let high: number;
  if (phase < edge) high = phase / edge;
  else if (phase < 0.6) high = 1;
  else if (phase < 0.6 + edge) high = 1 - (phase - 0.6) / edge;
  else high = 0;
  return FLASH_LOW + (1 - FLASH_LOW) * high;
}

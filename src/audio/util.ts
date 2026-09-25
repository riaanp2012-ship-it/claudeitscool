/**
 * Pure audio math shared by the mixer, spatializer and voices. No Web Audio types are touched here, so
 * everything in this file runs (and is unit-tested) in Node.
 */

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Speed of sound at sea level (m/s), used for doppler and propagation delay. */
export const SPEED_OF_SOUND = 343;
/** Quietest non-zero volume step (dB); below it the slider fades linearly to silence. */
export const MIN_DB = -60;
/** Slider value that maps to exactly MIN_DB on the 10·log2(v) curve. */
const FLOOR_VOLUME = Math.pow(2, MIN_DB / 10);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

const clampRange = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Volume slider (0..1) to decibels on a perceptual curve. Perceived loudness roughly doubles every +10 dB,
 * so a slider that feels linear follows 10·log2(v): 0.5 is -10 dB, 0.25 is -20 dB, 1/64 is -60 dB.
 * Returns -Infinity for 0 (silent).
 */
export function volumeToDb(v: number): number {
  if (!(v > 0)) return -Infinity;
  if (v >= 1) return 0;
  if (v <= FLOOR_VOLUME) return gainToDb(volumeToGain(v));
  return 10 * Math.log2(v);
}

/**
 * Volume slider (0..1) to linear gain (ZD-I09). Follows `volumeToDb` down to -60 dB and then fades linearly
 * to exactly 0, so the mapping is continuous, strictly increasing and silent at 0.
 */
export function volumeToGain(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  if (v < FLOOR_VOLUME) return dbToGain(MIN_DB) * (v / FLOOR_VOLUME);
  return dbToGain(10 * Math.log2(v));
}

/**
 * Doppler frequency ratio heard at the listener, computed from both velocities (manual doppler: Web Audio
 * removed PannerNode doppler). f' = f · (c + v_listener→source) / (c − v_source→listener).
 * The result is clamped to [minF, maxF] so supersonic geometry never yields infinities or negative rates.
 */
export function dopplerFactor(
  sourcePos: Vec3Like,
  sourceVel: Vec3Like,
  listenerPos: Vec3Like,
  listenerVel: Vec3Like,
  c = SPEED_OF_SOUND,
  minF = 0.4,
  maxF = 3,
): number {
  const dx = listenerPos.x - sourcePos.x;
  const dy = listenerPos.y - sourcePos.y;
  const dz = listenerPos.z - sourcePos.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > 1e-3)) return 1;
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  // Source speed along source→listener (positive = approaching); listener speed toward the source.
  const vs = sourceVel.x * ux + sourceVel.y * uy + sourceVel.z * uz;
  const vl = -(listenerVel.x * ux + listenerVel.y * uy + listenerVel.z * uz);
  const num = c + vl;
  const den = c - vs;
  if (!(num > 0)) return minF;
  if (!(den > c / maxF)) return maxF;
  const f = num / den;
  return Number.isFinite(f) ? clampRange(f, minF, maxF) : 1;
}

/** Doppler ratio to detune cents. */
export const ratioToCents = (ratio: number): number => (ratio > 0 ? 1200 * Math.log2(ratio) : 0);

/**
 * Distance attenuation: inverse-distance law beyond `ref` (flat inside it), faded smoothly to silence
 * between 75% and 100% of `maxDistance` so far voices can be culled without an audible step.
 */
export function distanceGain(d: number, ref: number, rolloff: number, maxDistance: number): number {
  if (!(d >= 0)) return 0;
  const g = d <= ref ? 1 : ref / (ref + rolloff * (d - ref));
  const f0 = maxDistance * 0.75;
  if (d <= f0) return g;
  if (d >= maxDistance) return 0;
  const t = (d - f0) / (maxDistance - f0);
  return g * (1 - t * t * (3 - 2 * t));
}

/**
 * Air absorption modelled as a lowpass cutoff that falls with distance: ~20 kHz close, ~6 kHz at 1 km,
 * ~1.7 kHz at 2 km, bottoming out at a distant rumble.
 */
export function airAbsorptionCutoff(d: number): number {
  if (!(d > 0)) return 20000;
  return clampRange(20000 * Math.exp(-d / 850), 380, 20000);
}

/** Wet level of the shared outdoor reverb: close sounds are dry, distant ones mostly echo. */
export function reverbSend(d: number): number {
  if (!(d > 0)) return 0.04;
  return clampRange(0.04 + d / 5000, 0.04, 0.55);
}

/**
 * How much the listener is in front of a jet (+1 ahead of the nose, -1 behind the nozzle), using the velocity
 * as the nose direction. Returns 0 when either vector is degenerate.
 */
export function frontness(sourcePos: Vec3Like, noseDir: Vec3Like, listenerPos: Vec3Like): number {
  const dx = listenerPos.x - sourcePos.x;
  const dy = listenerPos.y - sourcePos.y;
  const dz = listenerPos.z - sourcePos.z;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const nl = Math.sqrt(noseDir.x * noseDir.x + noseDir.y * noseDir.y + noseDir.z * noseDir.z);
  if (!(dl > 1e-3) || !(nl > 1e-3)) return 0;
  return clampRange((dx * noseDir.x + dy * noseDir.y + dz * noseDir.z) / (dl * nl), -1, 1);
}

/** Distance between two points without allocating. */
export function distance(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Random pitch variation factor in [1 - amount, 1 + amount] from a uniform [0, 1) sample. */
export const pitchVariation = (u: number, amount = 0.03): number => 1 + (u * 2 - 1) * amount;

/** MIDI note number to frequency (A4 = 69 = 440 Hz). */
export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

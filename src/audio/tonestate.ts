import type { CockpitTones } from '../core/types';

/** Bits returned by `ToneTracker.update` for the fields that changed. */
export const TONE_SEEKER = 1;
export const TONE_RADAR = 2;
export const TONE_RWR = 4;
export const TONE_MAW = 8;
export const TONE_STALL = 16;
export const TONE_PULLUP = 32;
export const TONE_G = 64;

/** G is tracked in 0.1 G steps; smaller wobbles are not a change. */
const G_STEP = 0.1;

/**
 * Change detection for cockpit tones. The game calls setCockpitTones every frame with the full state;
 * this keeps the previous state and reports only what changed, so tones react to edges, not to frames.
 */
export class ToneTracker {
  seeker: CockpitTones['seeker'] = 'off';
  radarLock = false;
  rwr: CockpitTones['rwr'] = 'off';
  missileWarning = false;
  stall = false;
  pullUp = false;
  /** Last reported G (quantized to G_STEP). */
  g = 1;

  update(t: CockpitTones): number {
    let changed = 0;
    if (t.seeker !== this.seeker) {
      this.seeker = t.seeker;
      changed |= TONE_SEEKER;
    }
    const radar = t.radarLock === true;
    if (radar !== this.radarLock) {
      this.radarLock = radar;
      changed |= TONE_RADAR;
    }
    if (t.rwr !== this.rwr) {
      this.rwr = t.rwr;
      changed |= TONE_RWR;
    }
    const maw = t.missileWarning === true;
    if (maw !== this.missileWarning) {
      this.missileWarning = maw;
      changed |= TONE_MAW;
    }
    const stall = t.stall === true;
    if (stall !== this.stall) {
      this.stall = stall;
      changed |= TONE_STALL;
    }
    const pullUp = t.pullUp === true;
    if (pullUp !== this.pullUp) {
      this.pullUp = pullUp;
      changed |= TONE_PULLUP;
    }
    const g = Number.isFinite(t.g) ? Math.round(t.g / G_STEP) * G_STEP : this.g;
    if (Math.abs(g - this.g) >= G_STEP * 0.5) {
      this.g = g;
      changed |= TONE_G;
    }
    return changed;
  }

  /** Back to the all-off state (the next update reports everything that is on). */
  reset(): void {
    this.seeker = 'off';
    this.radarLock = false;
    this.rwr = 'off';
    this.missileWarning = false;
    this.stall = false;
    this.pullUp = false;
    this.g = 1;
  }
}

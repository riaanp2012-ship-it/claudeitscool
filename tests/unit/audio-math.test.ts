import { describe, expect, it } from 'vitest';
import {
  MIN_DB,
  SPEED_OF_SOUND,
  airAbsorptionCutoff,
  dbToGain,
  distanceGain,
  dopplerFactor,
  frontness,
  gainToDb,
  pitchVariation,
  ratioToCents,
  volumeToDb,
  volumeToGain,
} from '../../src/audio/util';
import { strainLevel } from '../../src/audio/strain';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const ZERO = v(0, 0, 0);

describe('volume mapping (ZD-I09)', () => {
  it('is silent at 0 and unity at 1', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(2)).toBe(1);
  });

  it('follows a perceptual dB curve: half the slider is -10 dB, a quarter is -20 dB', () => {
    expect(volumeToDb(0.5)).toBeCloseTo(-10, 6);
    expect(volumeToDb(0.25)).toBeCloseTo(-20, 6);
    expect(gainToDb(volumeToGain(0.5))).toBeCloseTo(-10, 6);
    expect(volumeToDb(0)).toBe(-Infinity);
  });

  it('is strictly increasing and continuous down to silence', () => {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const g = volumeToGain(i / 1000);
      expect(g).toBeGreaterThan(prev);
      if (i > 0) expect(g - prev).toBeLessThan(0.02);
      prev = g;
    }
    const floor = Math.pow(2, MIN_DB / 10);
    expect(volumeToGain(floor)).toBeCloseTo(dbToGain(MIN_DB), 9);
    expect(volumeToGain(floor * 0.999)).toBeCloseTo(dbToGain(MIN_DB), 5);
  });
});

describe('doppler factor', () => {
  it('is 1 when nothing moves along the line of sight', () => {
    expect(dopplerFactor(v(100, 0, 0), ZERO, ZERO, ZERO)).toBe(1);
    expect(dopplerFactor(v(100, 0, 0), v(0, 0, 200), ZERO, v(0, 50, 0))).toBeCloseTo(1, 9);
  });

  it('rises for an approaching source and falls for a receding one', () => {
    const approach = dopplerFactor(v(1000, 0, 0), v(-100, 0, 0), ZERO, ZERO);
    const recede = dopplerFactor(v(1000, 0, 0), v(100, 0, 0), ZERO, ZERO);
    expect(approach).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND - 100), 9);
    expect(recede).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND + 100), 9);
  });

  it('accounts for listener motion', () => {
    const toward = dopplerFactor(v(1000, 0, 0), ZERO, ZERO, v(50, 0, 0));
    expect(toward).toBeCloseTo((SPEED_OF_SOUND + 50) / SPEED_OF_SOUND, 9);
  });

  it('stays finite and clamped for supersonic and degenerate geometry', () => {
    expect(dopplerFactor(v(1000, 0, 0), v(-500, 0, 0), ZERO, ZERO)).toBe(3);
    expect(dopplerFactor(v(1000, 0, 0), ZERO, ZERO, v(-400, 0, 0))).toBe(0.4);
    expect(dopplerFactor(ZERO, v(300, 0, 0), ZERO, ZERO)).toBe(1);
    expect(ratioToCents(2)).toBeCloseTo(1200, 9);
    expect(ratioToCents(0)).toBe(0);
  });
});

describe('distance, air absorption and orientation', () => {
  it('attenuates by the inverse law beyond ref and fades to 0 at max distance', () => {
    expect(distanceGain(10, 60, 1, 7000)).toBe(1);
    expect(distanceGain(120, 60, 1, 7000)).toBeCloseTo(0.5, 9);
    expect(distanceGain(7000, 60, 1, 7000)).toBe(0);
    expect(distanceGain(Number.NaN, 60, 1, 7000)).toBe(0);
    let prev = 2;
    for (let d = 0; d <= 7000; d += 50) {
      const g = distanceGain(d, 60, 1, 7000);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });

  it('closes the air-absorption lowpass with distance', () => {
    expect(airAbsorptionCutoff(0)).toBe(20000);
    expect(airAbsorptionCutoff(1000)).toBeLessThan(airAbsorptionCutoff(500));
    expect(airAbsorptionCutoff(1e6)).toBeGreaterThan(300);
  });

  it('reports whether the listener is ahead of or behind the nose', () => {
    expect(frontness(ZERO, v(0, 0, -1), v(0, 0, -50))).toBeCloseTo(1, 9);
    expect(frontness(ZERO, v(0, 0, -1), v(0, 0, 50))).toBeCloseTo(-1, 9);
    expect(frontness(ZERO, ZERO, v(0, 0, 50))).toBe(0);
  });

  it('varies pitch within ±3%', () => {
    expect(pitchVariation(0)).toBeCloseTo(0.97, 9);
    expect(pitchVariation(0.5)).toBeCloseTo(1, 9);
    expect(pitchVariation(0.999999)).toBeLessThanOrEqual(1.03);
  });

  it('starts G-strain breathing above 6.5 G', () => {
    expect(strainLevel(1)).toBe(0);
    expect(strainLevel(6.5)).toBe(0);
    expect(strainLevel(7.5)).toBeGreaterThan(0);
    expect(strainLevel(9.5)).toBe(1);
    expect(strainLevel(Number.NaN)).toBe(0);
  });
});

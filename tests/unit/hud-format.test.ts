import { describe, expect, it } from 'vitest';
import {
  StringCache,
  altitudeIn,
  altitudePrefix,
  clock,
  compassLabel,
  detent,
  distanceIn,
  drumLabels,
  drumSplit,
  fixedFromKey,
  headingDegrees,
  pad3,
  radarRangeKey,
  radarRangeText,
  rangeKey,
  rangeText,
  roundKey,
  signed,
  speedIn,
  thousands,
  verticalSpeedIn,
  type DrumSplit,
} from '../../src/hud/format';

describe('hud units', () => {
  it('converts speed, altitude, vertical speed and range per unit system', () => {
    expect(speedIn(100, 'imperial')).toBeCloseTo(194.3844, 3);
    expect(speedIn(100, 'metric')).toBeCloseTo(360, 6);
    expect(altitudeIn(1000, 'imperial')).toBeCloseTo(3280.84, 2);
    expect(altitudeIn(1000, 'metric')).toBe(1000);
    expect(verticalSpeedIn(10, 'imperial')).toBeCloseTo(1968.504, 2);
    expect(verticalSpeedIn(10, 'metric')).toBe(10);
    expect(distanceIn(1852, 'imperial')).toBeCloseTo(1, 9);
    expect(distanceIn(2500, 'metric')).toBeCloseTo(2.5, 9);
  });
});

describe('hud number formatting', () => {
  it('formats thousands, signs and padded headings', () => {
    expect(thousands(0)).toBe('0');
    expect(thousands(999)).toBe('999');
    expect(thousands(12480)).toBe('12,480');
    expect(thousands(1000005)).toBe('1,000,005');
    expect(thousands(-1200)).toBe('-1,200');
    expect(signed(2400)).toBe('+2400');
    expect(signed(-300)).toBe('-300');
    expect(signed(0)).toBe('0');
    expect(pad3(5)).toBe('005');
    expect(pad3(274)).toBe('274');
  });

  it('wraps headings to 0..359 and labels the compass card', () => {
    expect(headingDegrees(0)).toBe(0);
    expect(headingDegrees(Math.PI)).toBe(180);
    expect(headingDegrees(-Math.PI / 2)).toBe(270);
    expect(headingDegrees(2 * Math.PI - 0.001)).toBe(0);
    expect(headingDegrees(Number.NaN)).toBe(0);
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(90)).toBe('E');
    expect(compassLabel(180)).toBe('S');
    expect(compassLabel(270)).toBe('W');
    expect(compassLabel(30)).toBe('03');
    expect(compassLabel(330)).toBe('33');
    expect(compassLabel(360)).toBe('N');
  });

  it('never produces NaN or -0 text', () => {
    expect(roundKey(Number.NaN)).toBe(0);
    expect(roundKey(Number.POSITIVE_INFINITY)).toBe(0);
    expect(fixedFromKey(0, 1)).toBe('0.0');
    expect(fixedFromKey(-0, 2)).toBe('0.00');
    expect(fixedFromKey(84, 2)).toBe('0.84');
    expect(fixedFromKey(-5, 1)).toBe('-0.5');
    expect(clock(7.9)).toBe('0:07');
    expect(clock(125)).toBe('2:05');
    expect(clock(-3)).toBe('0:00');
  });

  it('formats ranges with adaptive precision and a unique key per string', () => {
    expect(rangeText(rangeKey(0.347))).toBe('0.35');
    expect(rangeText(rangeKey(0.996))).toBe('1.0');
    expect(rangeText(rangeKey(4.24))).toBe('4.2');
    expect(rangeText(rangeKey(9.96))).toBe('10');
    expect(rangeText(rangeKey(123.4))).toBe('123');
    expect(rangeText(rangeKey(Number.NaN))).toBe('0.00');
    expect(radarRangeText(radarRangeKey(20))).toBe('20');
    expect(radarRangeText(radarRangeKey(2.5))).toBe('2.5');
    expect(radarRangeText(radarRangeKey(5))).toBe('5');
    // Keys are injective over displayed strings.
    const seen = new Map<number, string>();
    for (let v = 0.01; v < 300; v *= 1.013) {
      const k = rangeKey(v);
      const s = rangeText(k);
      const prev = seen.get(k);
      if (prev !== undefined) expect(prev).toBe(s);
      seen.set(k, s);
    }
  });
});

describe('StringCache', () => {
  it('formats once per key and returns the same string instance', () => {
    let calls = 0;
    const cache = new StringCache((k) => {
      calls++;
      return 'v' + k;
    });
    const a = cache.get(42);
    const b = cache.get(42);
    expect(a).toBe('v42');
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });

  it('stays bounded', () => {
    const cache = new StringCache((k) => String(k), 16);
    for (let i = 0; i < 100; i++) cache.get(i);
    expect(cache.size).toBeLessThanOrEqual(16);
    expect(cache.get(99)).toBe('99');
  });
});

describe('rolling digit drums', () => {
  const out: DrumSplit = { prefix: 0, roll: 0, carry: 0 };

  it('builds drum label columns', () => {
    expect(drumLabels(10, 1)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(drumLabels(100, 20)).toEqual(['00', '20', '40', '60', '80']);
    expect(drumLabels(100, 10)).toHaveLength(10);
  });

  it('rests on a digit and only rolls in the last part of a step', () => {
    expect(detent(0)).toBe(0);
    expect(detent(0.6)).toBe(0);
    expect(detent(0.85)).toBeGreaterThan(0);
    expect(detent(0.85)).toBeLessThan(1);
    expect(detent(1)).toBe(1);
    drumSplit(452.4, 10, 1, out);
    expect(out.prefix).toBe(45);
    expect(out.roll).toBe(2);
    expect(out.carry).toBe(0);
  });

  it('rolls the prefix only during the last step before a carry', () => {
    drumSplit(459.95, 10, 1, out);
    expect(out.prefix).toBe(45);
    expect(out.carry).toBeCloseTo(detent(0.95), 6);
    expect(out.carry).toBeGreaterThan(0.5);
    drumSplit(8563, 100, 20, out);
    expect(out.prefix).toBe(85);
    expect(out.roll).toBe(3);
    expect(out.carry).toBe(0);
    drumSplit(-50, 100, 20, out);
    expect(out.prefix).toBe(0);
    expect(out.roll).toBe(0);
  });

  it('formats the altitude prefix with the thousands separator', () => {
    expect(altitudePrefix(0)).toBe('');
    expect(altitudePrefix(4)).toBe('4');
    expect(altitudePrefix(12)).toBe('1,2');
    expect(altitudePrefix(124)).toBe('12,4');
    expect(altitudePrefix(1240)).toBe('124,0');
  });
});

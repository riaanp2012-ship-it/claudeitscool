import { describe, expect, it } from 'vitest';
import {
  atLimit,
  clamp,
  decimalsOf,
  fractionOf,
  snap,
  stepChoice,
  stepList,
  stepRange,
  valueFromFraction,
} from '../../src/ui/values';
import {
  EMPTY,
  formatClock,
  formatFixed,
  formatHours,
  formatInt,
  formatLapTime,
  formatMach,
  formatPercent,
  formatRatio,
  formatSigned,
  pad,
} from '../../src/ui/format';

describe('steppers and clamping', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('counts decimals of a step', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.05)).toBe(2);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(1e-7)).toBe(7);
  });

  it('steps without float noise and clamps at the limits', () => {
    expect(stepRange(0.8, 1, 0.8, 1.4, 0.05)).toBe(0.85);
    expect(stepRange(0.1, 1, 0, 1, 0.05)).toBe(0.15);
    expect(stepRange(0.7, 1, 0.2, 3, 0.1)).toBe(0.8);
    expect(stepRange(1.4, 1, 0.8, 1.4, 0.05)).toBe(1.4);
    expect(stepRange(0.5, -1, 0.5, 1, 0.05)).toBe(0.5);
    expect(stepRange(70, -1, 60, 100, 1)).toBe(69);
  });

  it('snaps off-grid values in the direction of travel', () => {
    expect(stepRange(0.83, 1, 0, 1, 0.05)).toBe(0.85);
    expect(stepRange(0.83, -1, 0, 1, 0.05)).toBe(0.8);
    expect(stepRange(0.12, 1, 0, 0.4, 0.01)).toBe(0.13);
  });

  it('snaps and maps slider fractions', () => {
    expect(snap(0.8349, 0, 1, 0.05)).toBe(0.85);
    expect(snap(Number.NaN, 0.2, 3, 0.1)).toBe(0.2);
    expect(valueFromFraction(0.5, 60, 100, 1)).toBe(80);
    expect(valueFromFraction(1.2, 0, 1, 0.05)).toBe(1);
    expect(fractionOf(80, 60, 100)).toBe(0.5);
    expect(fractionOf(5, 5, 5)).toBe(0);
  });

  it('cycles options, skipping disabled ones, with and without wrap', () => {
    const maps = ['kessel', 'mesa', 'norrdal', 'varen', 'typhoon'];
    const ok = (m: string) => m !== 'varen' && m !== 'typhoon';
    expect(stepChoice(maps, 'kessel', 1, ok)).toBe('mesa');
    expect(stepChoice(maps, 'norrdal', 1, ok)).toBe('norrdal');
    expect(stepChoice(maps, 'norrdal', 1, ok, true)).toBe('kessel');
    expect(stepChoice(maps, 'kessel', -1, ok, true)).toBe('norrdal');
    expect(stepChoice(maps, 'unknown', 1, ok)).toBe('kessel');
    expect(stepChoice([], 'x', 1)).toBe('x');
  });

  it('steps through explicit value lists', () => {
    const limits = [0, 5, 10, 15, 20, 30];
    expect(stepList(limits, 0, 1)).toBe(5);
    expect(stepList(limits, 30, 1)).toBe(30);
    expect(stepList(limits, 0, -1)).toBe(0);
    expect(stepList(limits, 12, 1)).toBe(15);
    expect(stepList(limits, 12, -1)).toBe(10);
  });

  it('reports limits', () => {
    expect(atLimit(1, 1, 0, 1)).toBe(true);
    expect(atLimit(1, -1, 0, 1)).toBe(false);
    expect(atLimit(0, -1, 0, 1)).toBe(true);
  });
});

describe('formatting', () => {
  it('pads indices', () => {
    expect(pad(3)).toBe('03');
    expect(pad(12)).toBe('12');
    expect(pad(7, 3)).toBe('007');
    expect(pad(Number.NaN)).toBe(EMPTY);
  });

  it('formats integers with thousands separators and a real minus', () => {
    expect(formatInt(12400)).toBe('12,400');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1234567.4)).toBe('1,234,567');
    expect(formatInt(-2500)).toBe('−2,500');
    expect(formatInt(Number.POSITIVE_INFINITY)).toBe(EMPTY);
  });

  it('formats clocks and lap times', () => {
    expect(formatClock(734)).toBe('12:14');
    expect(formatClock(59.9)).toBe('00:59');
    expect(formatClock(3700)).toBe('1:01:40');
    expect(formatClock(-4)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe(EMPTY);
    expect(formatLapTime(102.364)).toBe('1:42.36');
    expect(formatLapTime(59.999)).toBe('1:00.00');
    expect(formatLapTime(null)).toBe(EMPTY);
  });

  it('formats signed deltas, fixed values, percents, hours and ratios', () => {
    expect(formatSigned(0.2, 2)).toBe('+0.20');
    expect(formatSigned(-1, 2)).toBe('−1.00');
    expect(formatSigned(-0.001, 2)).toBe('0.00');
    expect(formatFixed(-0.001, 2)).toBe('0.00');
    expect(formatFixed(-1.5, 1)).toBe('−1.5');
    expect(formatPercent(0.345)).toBe('35%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatHours(66780)).toBe('18.6');
    expect(formatRatio(118, 31)).toBe('3.81');
    expect(formatRatio(4, 0)).toBe('4.00');
    expect(formatMach(2.3)).toBe('M 2.30');
  });

  it('never prints NaN or undefined', () => {
    const outputs = [
      formatInt(Number.NaN),
      formatFixed(Number.NaN, 2),
      formatSigned(Number.NaN, 1),
      formatPercent(Number.NaN),
      formatHours(Number.NaN),
      formatRatio(Number.NaN, 1),
    ];
    for (const o of outputs) {
      expect(o).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

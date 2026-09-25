import { describe, expect, it } from 'vitest';
import { buildXpSegments, easeOutCubic, sampleXp, xpDuration } from '../../src/ui/xp';

const p = (rank: number, xp: number, xpIntoRank: number, xpForRank: number) => ({
  rank,
  xp,
  xpIntoRank,
  xpForRank,
});

describe('XP count-up', () => {
  it('fills within one rank', () => {
    const segs = buildXpSegments(p(4, 5000, 1000, 3000), p(4, 6500, 2500, 3000));
    expect(segs).toEqual([{ rank: 4, from: 1000, to: 2500, size: 3000 }]);
    expect(sampleXp(segs, 0)).toMatchObject({ rank: 4, into: 1000 });
    expect(sampleXp(segs, 0.5)).toMatchObject({ rank: 4, into: 1750 });
    const end = sampleXp(segs, 1);
    expect(end.into).toBe(2500);
    expect(end.fraction).toBeCloseTo(2500 / 3000);
  });

  it('fills to the top, then continues in the new rank after a promotion', () => {
    const segs = buildXpSegments(p(7, 14250, 1250, 3000), p(8, 16800, 800, 3400));
    expect(segs).toHaveLength(2);
    // 1750 XP to finish rank 7, then 800 into rank 8: 2550 in total.
    const atTop = sampleXp(segs, 1750 / 2550);
    expect(atTop.rank).toBe(7);
    expect(atTop.fraction).toBeCloseTo(1);
    const after = sampleXp(segs, 2000 / 2550);
    expect(after.rank).toBe(8);
    expect(after.into).toBeCloseTo(250);
    expect(after.segment).toBe(1);
    expect(sampleXp(segs, 1)).toMatchObject({ rank: 8, into: 800, size: 3400 });
  });

  it('splits unknown intermediate ranks evenly', () => {
    const segs = buildXpSegments(p(2, 1000, 500, 1000), p(5, 6000, 500, 2000));
    expect(segs.map((s) => s.rank)).toEqual([2, 3, 4, 5]);
    // 5000 total: 500 to finish rank 2, 500 into rank 5, 4000 across ranks 3 and 4.
    expect(segs[1]).toEqual({ rank: 3, from: 0, to: 2000, size: 2000 });
    expect(segs[2]).toEqual({ rank: 4, from: 0, to: 2000, size: 2000 });
  });

  it('shows the final state when the data goes backwards', () => {
    const segs = buildXpSegments(p(5, 9000, 2000, 3000), p(5, 8000, 1000, 3000));
    expect(segs).toHaveLength(1);
    expect(sampleXp(segs, 0).into).toBe(1000);
    expect(sampleXp(segs, 1).into).toBe(1000);
  });

  it('never divides by zero', () => {
    const segs = buildXpSegments(p(1, 0, 0, 0), p(1, 0, 0, 0));
    const f = sampleXp(segs, 0.5);
    expect(Number.isFinite(f.fraction)).toBe(true);
    expect(sampleXp([], 0.5).fraction).toBe(0);
  });

  it('eases out and caps the duration', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
    const many = buildXpSegments(p(1, 0, 0, 100), p(20, 99999, 10, 100));
    expect(xpDuration(many)).toBeLessThanOrEqual(2400);
    expect(xpDuration([{ rank: 1, from: 0, to: 1, size: 1 }])).toBe(900);
  });
});

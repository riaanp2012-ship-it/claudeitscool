import { describe, expect, it } from 'vitest';
import type { HudWarning } from '../../src/core/types';
import { buildPalette, damageBand, hexToRgb, rgba } from '../../src/hud/palette';
import { selectFeed } from '../../src/hud/panels';
import {
  ELLIPSIS,
  fitText,
  killFeedAlpha,
  messageAlpha,
  subtitleAlpha,
  subtitleHold,
  wrapText,
} from '../../src/hud/text';
import {
  WARNING_PRIORITY,
  WARNING_FLASH_HZ,
  flashAlpha,
  isCritical,
  prioritizeWarnings,
  warningRank,
} from '../../src/hud/warnings';

/** Fixed-width measure: 10 px per character. */
const measure = (s: string): number => s.length * 10;

describe('warnings', () => {
  it('orders by priority MISSILE > PULL UP > STALL > OVER-G > ENGINE FIRE > OUT OF BOUNDS > BINGO', () => {
    expect(WARNING_PRIORITY).toEqual([
      'MISSILE',
      'PULL UP',
      'STALL',
      'OVER-G',
      'ENGINE FIRE',
      'OUT OF BOUNDS',
      'BINGO',
    ]);
    const out: HudWarning[] = WARNING_PRIORITY.slice();
    const n = prioritizeWarnings(['BINGO', 'STALL', 'MISSILE', 'STALL', 'OUT OF BOUNDS'], out);
    expect(n).toBe(4);
    expect(out.slice(0, n)).toEqual(['MISSILE', 'STALL', 'OUT OF BOUNDS', 'BINGO']);
    expect(prioritizeWarnings([], out)).toBe(0);
    expect(warningRank('MISSILE')).toBeLessThan(warningRank('PULL UP'));
    expect(isCritical('PULL UP')).toBe(true);
    expect(isCritical('BINGO')).toBe(false);
  });

  it('flashes at ≤ 2 Hz and never fully disappears', () => {
    expect(WARNING_FLASH_HZ).toBeLessThanOrEqual(2);
    let min = 1;
    let max = 0;
    let transitions = 0;
    let prevHigh = flashAlpha(0) > 0.7;
    for (let t = 0; t < 10; t += 0.001) {
      const a = flashAlpha(t);
      min = Math.min(min, a);
      max = Math.max(max, a);
      const high = a > 0.7;
      if (high && !prevHigh) transitions++;
      prevHigh = high;
    }
    expect(min).toBeGreaterThanOrEqual(0.35 - 1e-9);
    expect(max).toBeCloseTo(1, 6);
    expect(transitions).toBeLessThanOrEqual(20); // ≤ 2 rising edges per second over 10 s
  });
});

describe('text fitting', () => {
  it('truncates with an ellipsis only when needed', () => {
    expect(fitText('SPLASH', 100, measure)).toBe('SPLASH');
    const fitted = fitText('LANCER 2 SPLASHED BORZOI', 100, measure);
    expect(fitted.endsWith(ELLIPSIS)).toBe(true);
    expect(measure(fitted)).toBeLessThanOrEqual(100);
  });

  it('wraps words into at most N lines and cuts the rest', () => {
    const lines = wrapText('Lancer One, missile launch, your six. Break left, flares.', 200, 2, measure);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(200);
    expect(lines[0]).toBe('Lancer One, missile');
    expect(lines[1]!.endsWith(ELLIPSIS)).toBe(true);
    expect(wrapText('Fox two.', 200, 2, measure)).toEqual(['Fox two.']);
  });
});

describe('fades', () => {
  it('fades subtitles in, holds by length and fades out', () => {
    expect(subtitleAlpha(0, 20)).toBe(0);
    expect(subtitleAlpha(1, 20)).toBe(1);
    expect(subtitleHold(10)).toBe(2.5);
    expect(subtitleHold(1000)).toBe(8);
    expect(subtitleAlpha(subtitleHold(20) + 1, 20)).toBe(0);
    expect(subtitleAlpha(Number.NaN, 20)).toBe(0);
  });

  it('fades kill feed lines by age', () => {
    expect(killFeedAlpha(1)).toBe(1);
    expect(killFeedAlpha(6.75)).toBeCloseTo(0.5, 6);
    expect(killFeedAlpha(9)).toBe(0);
  });

  it('fades the center message in and out', () => {
    expect(messageAlpha(0, 3)).toBe(0);
    expect(messageAlpha(0.125, 3)).toBeCloseTo(0.5, 6);
    expect(messageAlpha(1, 3)).toBe(1);
    expect(messageAlpha(1, 0.25)).toBeCloseTo(0.5, 6);
    expect(messageAlpha(1, 0)).toBe(0);
  });
});

describe('kill feed selection', () => {
  it('keeps the 5 youngest visible lines, oldest first', () => {
    const feed = [
      { age: 3 },
      { age: 0.5 },
      { age: 20 }, // faded out
      { age: 5 },
      { age: 1 },
      { age: 2 },
      { age: 4 },
      { age: 0.2 },
    ];
    const idx = new Int32Array(8);
    const n = selectFeed(feed, idx);
    expect(n).toBe(5);
    const ages = Array.from(idx.subarray(0, n)).map((i) => feed[i]!.age);
    expect(ages).toEqual([3, 2, 1, 0.5, 0.2]);
  });

  it('handles short and empty feeds', () => {
    const idx = new Int32Array(8);
    expect(selectFeed([], idx)).toBe(0);
    expect(selectFeed([{ age: 1 }, { age: 2 }], idx)).toBe(2);
    expect(idx[0]).toBe(1);
    expect(idx[1]).toBe(0);
  });
});

describe('palette', () => {
  it('uses the §8.2 HUD tokens', () => {
    expect(buildPalette('green', 'off').primary).toBe('#9DF2B4');
    expect(buildPalette('amber', 'off').primary).toBe('#FFC24B');
    expect(buildPalette('white', 'off').primary).toBe('#EAF2EE');
    expect(buildPalette('green', 'off').friend).toBe('#5AB8FF');
    expect(buildPalette('green', 'off').foe).toBe('#FF4D3D');
  });

  it('changes friend/foe colors per colorblind mode', () => {
    const off = buildPalette('green', 'off');
    for (const mode of ['protan', 'deutan', 'tritan'] as const) {
      const p = buildPalette('green', mode);
      expect(p.friend !== off.friend || p.foe !== off.foe).toBe(true);
      expect(p.friend).not.toBe(p.foe);
    }
  });

  it('builds rgba strings and damage bands', () => {
    expect(hexToRgb('#9DF2B4')).toEqual([157, 242, 180]);
    expect(rgba('#FFFFFF', 0.5)).toBe('rgba(255,255,255,0.5)');
    expect(damageBand(0)).toBe(-1);
    expect(damageBand(0.2)).toBe(0);
    expect(damageBand(0.5)).toBe(1);
    expect(damageBand(0.9)).toBe(2);
    expect(damageBand(1)).toBe(3);
    expect(damageBand(Number.NaN)).toBe(-1);
  });
});

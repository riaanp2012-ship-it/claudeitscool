import { describe, expect, it } from 'vitest';
import type { CockpitTones } from '../../src/core/types';
import { TONE_G, TONE_MAW, TONE_RADAR, TONE_RWR, TONE_SEEKER, ToneTracker } from '../../src/audio/tonestate';
import { AudibleSelector, RateLimiter, VoiceAllocator } from '../../src/audio/voices';

describe('VoiceAllocator', () => {
  it('allocates until the category cap, then steals the lowest priority', () => {
    const a = new VoiceAllocator([2, 4], 8);
    const v1 = a.acquire(0, 5, 0).voice;
    const v2 = a.acquire(0, 3, 1).voice;
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v2).toBeGreaterThanOrEqual(0);
    expect(a.count(0)).toBe(2);
    const r = a.acquire(0, 4, 2);
    expect(r.stolen).toBe(v2);
    expect(r.voice).toBeGreaterThanOrEqual(0);
    expect(a.count(0)).toBe(2);
  });

  it('rejects a request quieter than everything playing', () => {
    const a = new VoiceAllocator([1], 4);
    a.acquire(0, 9, 0);
    const r = a.acquire(0, 2, 1);
    expect(r.voice).toBe(-1);
    expect(r.stolen).toBe(-1);
  });

  it('steals the oldest voice on equal priority', () => {
    const a = new VoiceAllocator([2], 4);
    const first = a.acquire(0, 5, 0).voice;
    a.acquire(0, 5, 1);
    expect(a.acquire(0, 5, 2).stolen).toBe(first);
  });

  it('enforces the global cap across categories', () => {
    const a = new VoiceAllocator([4, 4], 3);
    a.acquire(0, 1, 0);
    a.acquire(0, 2, 0);
    a.acquire(1, 3, 0);
    expect(a.live).toBe(3);
    const r = a.acquire(1, 5, 1);
    expect(r.stolen).toBeGreaterThanOrEqual(0);
    expect(a.live).toBe(3);
    expect(a.count(0)).toBe(1);
  });

  it('releases slots and ignores bad input', () => {
    const a = new VoiceAllocator([2], 2);
    const v = a.acquire(0, 1, 0).voice;
    a.release(v);
    a.release(v);
    a.release(99);
    expect(a.live).toBe(0);
    expect(a.acquire(5, 1, 0).voice).toBe(-1);
    expect(a.acquire(0, Number.NaN, 0).voice).toBe(-1);
    a.acquire(0, 1, 0);
    a.releaseAll();
    expect(a.live).toBe(0);
  });
});

describe('RateLimiter (ZD-I08)', () => {
  it('drops triggers closer than the minimum interval', () => {
    const r = new RateLimiter(2);
    let accepted = 0;
    for (let i = 0; i < 50; i++) if (r.acquire(0, i * 0.02, 0.06, 0.3) > 0) accepted++;
    expect(accepted).toBeLessThanOrEqual(17);
    expect(accepted).toBeGreaterThanOrEqual(15);
  });

  it('attenuates rapid repeats and recovers after a pause', () => {
    const r = new RateLimiter(1);
    const g0 = r.acquire(0, 0, 0.05, 0.3);
    const g1 = r.acquire(0, 0.1, 0.05, 0.3);
    const g2 = r.acquire(0, 0.2, 0.05, 0.3);
    expect(g0).toBe(1);
    expect(g1).toBeLessThan(g0);
    expect(g2).toBeLessThan(g1);
    for (let i = 3; i < 30; i++) expect(r.acquire(0, i * 0.1, 0.05, 0.3)).toBeGreaterThanOrEqual(0.4);
    expect(r.acquire(0, 10, 0.05, 0.3)).toBe(1);
  });

  it('keys independently and rejects unknown keys', () => {
    const r = new RateLimiter(2);
    expect(r.acquire(0, 0, 1, 1)).toBe(1);
    expect(r.acquire(1, 0, 1, 1)).toBe(1);
    expect(r.acquire(0, 0.5, 1, 1)).toBe(0);
    expect(r.acquire(7, 0, 1, 1)).toBe(0);
  });
});

describe('AudibleSelector', () => {
  it('keeps the k loudest above the threshold', () => {
    const s = new AudibleSelector(4);
    const sel = new Uint8Array(8);
    const n = s.select([0.1, 0.9, 0.5, 0.0001, 0.7, 0.2], 6, 3, 1e-3, 1, sel);
    expect(n).toBe(3);
    expect(Array.from(sel.slice(0, 6))).toEqual([0, 1, 1, 0, 1, 0]);
  });

  it('applies hysteresis so a close challenger does not flip the set', () => {
    const s = new AudibleSelector();
    const sel = new Uint8Array([1, 0]);
    s.select([0.5, 0.55], 2, 1, 1e-3, 1.3, sel);
    expect(Array.from(sel)).toEqual([1, 0]);
    s.select([0.5, 0.7], 2, 1, 1e-3, 1.3, sel);
    expect(Array.from(sel)).toEqual([0, 1]);
  });
});

describe('ToneTracker', () => {
  const base: CockpitTones = {
    seeker: 'off',
    radarLock: false,
    rwr: 'off',
    missileWarning: false,
    stall: false,
    pullUp: false,
    g: 1,
  };

  it('reports only changes', () => {
    const t = new ToneTracker();
    expect(t.update(base)).toBe(0);
    expect(t.update({ ...base, seeker: 'search' })).toBe(TONE_SEEKER);
    expect(t.update({ ...base, seeker: 'search' })).toBe(0);
    expect(t.update({ ...base, seeker: 'locked', rwr: 'spike' })).toBe(TONE_SEEKER | TONE_RWR);
    expect(t.update({ ...base, seeker: 'locked', rwr: 'spike', missileWarning: true, radarLock: true })).toBe(
      TONE_MAW | TONE_RADAR,
    );
  });

  it('ignores G jitter below 0.1 G and ignores non-finite G', () => {
    const t = new ToneTracker();
    expect(t.update({ ...base, g: 1.03 })).toBe(0);
    expect(t.update({ ...base, g: 7 })).toBe(TONE_G);
    expect(t.update({ ...base, g: 7.02 })).toBe(0);
    expect(t.update({ ...base, g: Number.NaN })).toBe(0);
    expect(t.g).toBeCloseTo(7, 6);
  });

  it('resets to all-off', () => {
    const t = new ToneTracker();
    t.update({ ...base, stall: true });
    t.reset();
    expect(t.update({ ...base, stall: true })).not.toBe(0);
  });
});

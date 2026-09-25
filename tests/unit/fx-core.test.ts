import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../../src/fx/particles';
import { RadixSorter, farFirstKey } from '../../src/fx/sort';
import { FlashPool } from '../../src/fx/flashes';
import { buildAtlas, buildNoise } from '../../src/fx/atlas';
import { ATLAS_LAYERS, ATLAS_SIZE, NOISE_SIZE, STYLE } from '../../src/fx/tuning';

const ground = (): number => 0;

describe('fx sort', () => {
  it('orders farther particles first and is stable for ties', () => {
    const d = [5, 100, 5, 2000, 0.5, 100, 7];
    const n = d.length;
    const keys = new Uint16Array(n);
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      keys[i] = farFirstKey(d[i]! * d[i]!);
      idx[i] = i;
    }
    new RadixSorter(16).sort(keys, idx, n);
    expect(Array.from(idx)).toEqual([3, 1, 5, 6, 0, 2, 4]);
  });

  it('keys are monotonic in distance', () => {
    let prev = farFirstKey(0.01);
    for (let dist = 0.2; dist < 50000; dist *= 1.01) {
      const k = farFirstKey(dist * dist);
      expect(k).toBeLessThanOrEqual(prev);
      prev = k;
    }
  });

  it('matches a reference sort on random data', () => {
    const n = 3000;
    const keys = new Uint16Array(n);
    const idx = new Int32Array(n);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      keys[i] = s & 0xffff;
      idx[i] = i;
    }
    const ref = Array.from(idx).sort((a, b) => keys[a]! - keys[b]! || a - b);
    const k2 = keys.slice();
    new RadixSorter(n).sort(k2, idx, n);
    expect(Array.from(idx)).toEqual(ref);
  });
});

describe('fx particle store', () => {
  it('returns -1 when the live limit is reached and reuses freed slots', () => {
    const ps = new ParticleStore(8);
    ps.limit = 4;
    const got: number[] = [];
    for (let i = 0; i < 6; i++) got.push(ps.spawn(STYLE.SMOKE, 0, 10, 0, 0, 0, 0, 1, 1, 2));
    expect(got.slice(0, 4).every((v) => v >= 0)).toBe(true);
    expect(got[4]).toBe(-1);
    expect(got[5]).toBe(-1);
    expect(ps.live).toBe(4);
    ps.kill(got[1]!);
    expect(ps.live).toBe(3);
    expect(ps.spawn(STYLE.SMOKE, 0, 10, 0, 0, 0, 0, 1, 1, 2)).toBe(got[1]);
  });

  it('rejects non-finite input', () => {
    const ps = new ParticleStore(4);
    expect(ps.spawn(STYLE.SMOKE, NaN, 0, 0, 0, 0, 0, 1, 1, 1)).toBe(-1);
    expect(ps.spawn(STYLE.SMOKE, 0, 0, 0, Infinity, 0, 0, 1, 1, 1)).toBe(-1);
    expect(ps.spawn(STYLE.SMOKE, 0, 0, 0, 0, 0, 0, 0, 1, 1)).toBe(-1);
    expect(ps.live).toBe(0);
  });

  it('keeps delayed particles hidden until born and expires them on time', () => {
    const ps = new ParticleStore(4);
    const i = ps.spawn(STYLE.FIRE, 0, 100, 0, 0, 0, 0, 0.5, 1, 2);
    ps.age[i] = -0.25;
    ps.update(0.2, ground, 0, 0, 0);
    expect(ps.age[i]!).toBeLessThan(0);
    for (let k = 0; k < 20; k++) ps.update(0.05, ground, 0, 0, 0);
    expect(ps.live).toBe(0);
    expect(ps.high).toBe(0);
  });

  it('never sinks below the ground and never produces NaN over a long run', () => {
    const ps = new ParticleStore(512);
    for (let i = 0; i < 400; i++) {
      const style = [STYLE.SMOKE, STYLE.DIRT, STYLE.SPARK, STYLE.SPRAY][i % 4]!;
      const k = ps.spawn(style, i % 7, 5, i % 5, (i % 11) - 5, 30 - (i % 50), (i % 13) - 6, 20, 1, 3);
      ps.age[k] = -(i % 10) * 0.1;
    }
    for (let f = 0; f < 3000; f++) ps.update(1 / 120, ground, 3, 0, -1);
    for (let i = 0; i < ps.high; i++) {
      if (!ps.alive[i]) continue;
      expect(Number.isFinite(ps.px[i]!) && Number.isFinite(ps.py[i]!) && Number.isFinite(ps.pz[i]!)).toBe(
        true,
      );
      expect(ps.py[i]!).toBeGreaterThanOrEqual(-1e-3);
    }
  });

  it('fades particles that land instead of snapping them out', () => {
    const ps = new ParticleStore(4);
    const i = ps.spawn(STYLE.DIRT, 0, 1, 0, 0, -10, 0, 10, 1, 1);
    ps.update(0.2, ground, 0, 0, 0);
    expect(ps.alive[i]).toBe(1);
    expect(ps.fade[i]!).toBeGreaterThan(0);
    for (let k = 0; k < 10; k++) ps.update(0.05, ground, 0, 0, 0);
    expect(ps.alive[i]).toBe(0);
  });

  it('clear() frees everything', () => {
    const ps = new ParticleStore(16);
    for (let i = 0; i < 10; i++) ps.spawn(STYLE.SMOKE, 0, 0, 0, 0, 0, 0, 5, 1, 1);
    ps.clear();
    expect(ps.live).toBe(0);
    expect(ps.high).toBe(0);
    let n = 0;
    while (ps.spawn(STYLE.SMOKE, 0, 0, 0, 0, 0, 0, 5, 1, 1) >= 0) n++;
    expect(n).toBe(16);
  });
});

describe('fx flash pool', () => {
  it('rises, peaks and returns to zero', () => {
    const fp = new FlashPool(4);
    expect(fp.add(0, 0, 0, 1, 0.7, 0.4, 5, 100, 0.5)).toBe(0);
    let peak = 0;
    for (let k = 0; k < 60; k++) {
      fp.update(1 / 60);
      peak = Math.max(peak, fp.env[0]!);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(fp.active[0]).toBe(0);
    expect(fp.env[0]).toBe(0);
  });

  it('replaces the weakest flash and drops weaker newcomers', () => {
    const fp = new FlashPool(2);
    fp.add(0, 0, 0, 1, 1, 1, 10, 500, 2);
    fp.add(0, 0, 0, 1, 1, 1, 1, 100, 2);
    expect(fp.add(0, 0, 0, 1, 1, 1, 0.1, 10, 2)).toBe(-1);
    expect(fp.add(0, 0, 0, 1, 1, 1, 5, 300, 2)).toBe(1);
  });

  it('reduced flashes dim the light', () => {
    const fp = new FlashPool(4);
    fp.reduce = true;
    const i = fp.add(0, 0, 0, 1, 1, 1, 10, 100, 1);
    expect(fp.intensity[i]!).toBeLessThan(10);
    expect(fp.add(NaN, 0, 0, 1, 1, 1, 10, 100, 1)).toBe(-1);
  });
});

describe('fx procedural textures', () => {
  it('builds sprite layers that fade to zero at the cell edge', () => {
    const atlas = buildAtlas();
    expect(atlas.length).toBe(ATLAS_LAYERS * ATLAS_SIZE * ATLAS_SIZE * 4);
    for (let layer = 0; layer < ATLAS_LAYERS; layer++) {
      const base = layer * ATLAS_SIZE * ATLAS_SIZE * 4;
      // Corners are empty so mipmaps and rotation never show a hard square.
      expect(atlas[base]).toBe(0);
      let sum = 0;
      for (let p = 0; p < ATLAS_SIZE * ATLAS_SIZE; p++) sum += atlas[base + p * 4]!;
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('builds a tileable noise texture', () => {
    const n = buildNoise();
    expect(n.length).toBe(NOISE_SIZE * NOISE_SIZE * 4);
    // Left and right edges continue each other (difference similar to neighbouring columns).
    let edge = 0;
    for (let y = 0; y < NOISE_SIZE; y++) {
      edge += Math.abs(n[y * NOISE_SIZE * 4]! - n[(y * NOISE_SIZE + NOISE_SIZE - 1) * 4]!);
    }
    expect(edge / NOISE_SIZE).toBeLessThan(20);
  });
});

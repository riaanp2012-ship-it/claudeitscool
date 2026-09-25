import { describe, expect, it } from 'vitest';
import { EMITTING, FADING, FREE, PT, P_AGE, P_X, TrailStore } from '../../src/fx/trailStore';
import { RIBBON, RIBBON_DEFS } from '../../src/fx/tuning';

const SLOTS = 6;
const POINTS = 32;

function buffers(slots = SLOTS, points = POINTS) {
  const verts = slots * points * 2;
  return {
    center: new Float32Array(verts * 3),
    side: new Float32Array(verts * 3),
    data: new Float32Array(verts * 4),
  };
}

describe('fx trail slots', () => {
  it('allocates the lowest free slot in a region and returns -1 when full', () => {
    const t = new TrailStore(SLOTS, POINTS);
    expect(t.allocate(RIBBON.MISSILE, 0, 2, 0.1)).toBe(0);
    expect(t.allocate(RIBBON.MISSILE, 0, 2, 0.1)).toBe(1);
    expect(t.allocate(RIBBON.MISSILE, 0, 2, 0.1)).toBe(-1);
    expect(t.allocate(RIBBON.FIRE, 2, SLOTS, 0.1)).toBe(2);
    expect(t.active).toBe(3);
  });

  it('release fades out, then frees the slot and bumps its generation', () => {
    const t = new TrailStore(SLOTS, POINTS);
    const s = t.allocate(RIBBON.VORTEX, 0, SLOTS, 0.5);
    const gen = t.gen[s]!;
    for (let i = 0; i < 20; i++) {
      t.push(s, i * 10, 0, 0, 1);
      t.update(1 / 60);
    }
    expect(t.owns(s, gen)).toBe(true);
    t.release(s);
    expect(t.state[s]).toBe(FADING);
    expect(t.owns(s, gen)).toBe(false);
    const life = RIBBON_DEFS[RIBBON.VORTEX]!.life;
    for (let i = 0; i < Math.ceil((life + 0.5) * 60); i++) t.update(1 / 60);
    expect(t.state[s]).toBe(FREE);
    expect(t.gen[s]).not.toBe(gen);
    expect(t.active).toBe(0);
  });

  it('keeps the head at index 0 with ages increasing along a contiguous strip', () => {
    const t = new TrailStore(SLOTS, POINTS);
    const s = t.allocate(RIBBON.MISSILE, 0, SLOTS, 0.2);
    for (let i = 0; i < 400; i++) {
      t.push(s, i * 6, Math.sin(i * 0.05) * 30, 0, 1);
      t.update(1 / 120);
    }
    const n = t.count[s]!;
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(POINTS);
    const base = s * POINTS * PT;
    expect(t.pts[base + P_X]).toBeCloseTo(399 * 6, 3);
    for (let i = 1; i < n; i++) {
      expect(t.pts[base + i * PT + P_AGE]!).toBeGreaterThanOrEqual(t.pts[base + (i - 1) * PT + P_AGE]!);
    }
  });

  it('writes indices only for the slot, skipping gaps', () => {
    const t = new TrailStore(SLOTS, POINTS);
    const s = t.allocate(RIBBON.VORTEX, 0, SLOTS, 0.3);
    t.push(s, 0, 0, 0, 1);
    for (let i = 1; i <= 12; i++) {
      t.update(0.05);
      t.push(s, i * 10, 0, 0, i >= 5 && i <= 8 ? 0 : 1);
    }
    const n = t.count[s]!;
    const out = new Uint16Array(POINTS * 6 * SLOTS);
    const written = t.writeIndices(s, { x: 0, y: 100, z: 0 }, out, 0);
    expect(written % 6).toBe(0);
    expect(written / 6).toBeLessThan(n - 1);
    const lo = s * POINTS * 2;
    const hi = lo + n * 2;
    for (let i = 0; i < written; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(lo);
      expect(out[i]!).toBeLessThan(hi);
    }
  });

  it('builds unit side vectors that never flip, even viewed end-on', () => {
    const t = new TrailStore(SLOTS, POINTS);
    const s = t.allocate(RIBBON.MISSILE, 0, SLOTS, 0.4);
    // A straight line along -Z; the camera sits on the line looking down it.
    for (let i = 0; i < 200; i++) {
      t.push(s, Math.sin(i * 0.3) * 0.01, 0, -i * 12, 1);
      t.update(1 / 60);
    }
    const out = buffers();
    t.buildRibbon(s, { x: 0, y: 0, z: 50 }, { x: 1, y: 0, z: 0 }, RIBBON.MISSILE, out);
    const n = t.count[s]!;
    const v0 = s * POINTS * 2;
    let prev: number[] | null = null;
    for (let i = 0; i < n; i++) {
      const o = (v0 + i * 2) * 3;
      const sx = out.side[o]!;
      const sy = out.side[o + 1]!;
      const sz = out.side[o + 2]!;
      expect(Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)).toBe(true);
      expect(Math.hypot(sx, sy, sz)).toBeCloseTo(1, 3);
      if (prev) expect(sx * prev[0]! + sy * prev[1]! + sz * prev[2]!).toBeGreaterThan(0);
      prev = [sx, sy, sz];
      const d = (v0 + i * 2) * 4;
      expect(Number.isFinite(out.data[d]!) && Number.isFinite(out.data[d + 1]!)).toBe(true);
      expect(out.data[d + 3]!).toBeGreaterThan(0);
    }
  });

  it('never exceeds its point capacity and never produces NaN in a long run', () => {
    const t = new TrailStore(SLOTS, POINTS);
    const s = t.allocate(RIBBON.CONTRAIL, 0, SLOTS, 0.6);
    const out = buffers();
    for (let i = 0; i < 20000; i++) {
      const a = i * 0.01;
      t.push(s, Math.cos(a) * 3000, 9000 + Math.sin(a * 3) * 50, Math.sin(a) * 3000, 1);
      t.update(1 / 120);
      if (i % 500 === 0)
        t.buildRibbon(s, { x: 0, y: 9000, z: 0 }, { x: 1, y: 0, z: 0 }, RIBBON.CONTRAIL, out);
      expect(t.count[s]!).toBeLessThanOrEqual(POINTS);
    }
    expect(t.state[s]).toBe(EMITTING);
    for (const v of out.center) expect(Number.isFinite(v)).toBe(true);
    for (const v of out.data) expect(Number.isFinite(v)).toBe(true);
  });

  it('releases trails whose owner stopped pushing', () => {
    const t = new TrailStore(SLOTS, POINTS);
    const s = t.allocate(RIBBON.MISSILE, 0, SLOTS, 0.7);
    t.push(s, 0, 0, 0, 1);
    for (let i = 0; i < 60 * 20; i++) t.update(1 / 60);
    expect(t.state[s]).toBe(FREE);
  });
});

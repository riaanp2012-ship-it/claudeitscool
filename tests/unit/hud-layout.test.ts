import { describe, expect, it } from 'vitest';
import { ellipseEdge, rectEdge, screenAngle, clampBox } from '../../src/hud/edge';
import {
  MIN_UNITS_H,
  MIN_UNITS_W,
  clampScale,
  computeLayout,
  createLayout,
  snap,
  snapOffset,
  unitSize,
} from '../../src/hud/layout';
import { createRungBuffer, createTickBuffer, ladderRungs, tapeTicks } from '../../src/hud/tape';

const RESOLUTIONS: [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1024, 768], // 4:3
  [1600, 1200], // 4:3
  [1920, 1200], // 16:10
  [2560, 1080], // 21:9
  [3440, 1440], // 21:9
  [5120, 1440], // 32:9
];

describe('hud layout', () => {
  it('clamps the HUD scale to 0.8..1.4', () => {
    expect(clampScale(0.5)).toBe(0.8);
    expect(clampScale(2)).toBe(1.4);
    expect(clampScale(1.1)).toBe(1.1);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('always leaves at least 1280×720 layout units in the safe area (no overlap, ZD-J01)', () => {
    const L = createLayout();
    for (const [w, h] of RESOLUTIONS) {
      for (const scale of [0.8, 1, 1.4]) {
        for (const dpr of [1, 1.5, 2]) {
          computeLayout(w, h, dpr, scale, L);
          expect(L.unitsW).toBeGreaterThanOrEqual(MIN_UNITS_W - 1e-6);
          expect(L.unitsH).toBeGreaterThanOrEqual(MIN_UNITS_H - 1e-6);
          expect(L.W).toBe(Math.round(w * dpr));
          expect(L.S).toBeCloseTo(L.u * dpr, 9);
        }
      }
    }
  });

  it('keeps a 16:9 safe area centered on ultrawide screens (ZD-J02)', () => {
    const L = computeLayout(5120, 1440, 1, 1, createLayout());
    expect(L.safeW).toBe(2560);
    expect(L.safeX).toBe(1280);
    expect(L.left).toBeGreaterThan(L.safeX);
    expect(L.right).toBeLessThan(L.safeX + L.safeW);
    const narrow = computeLayout(1024, 768, 1, 1, createLayout());
    expect(narrow.safeW).toBe(1024);
    expect(narrow.safeX).toBe(0);
  });

  it('grows the unit with resolution and scale, never shrinking text below 1080p at 100 %', () => {
    expect(unitSize(1920, 1080, 1)).toBe(1);
    expect(unitSize(3840, 2160, 1)).toBe(2);
    expect(unitSize(1920, 1080, 1.4)).toBeCloseTo(1.4, 9);
    expect(unitSize(1280, 720, 1.4)).toBe(1); // capped by the 1280×720 fit
    expect(unitSize(1280, 720, 0.8)).toBeCloseTo(0.8, 9);
  });

  it('uses integer stroke widths and snaps odd widths to pixel centers (ZD-B31)', () => {
    for (const [w, h] of RESOLUTIONS) {
      const L = computeLayout(w, h, 1.25, 1.2, createLayout());
      expect(Number.isInteger(L.line)).toBe(true);
      expect(Number.isInteger(L.thin)).toBe(true);
      expect(Number.isInteger(L.bold)).toBe(true);
      expect(L.thin).toBeGreaterThanOrEqual(1);
    }
    expect(snapOffset(1)).toBe(0.5);
    expect(snapOffset(2)).toBe(0);
    expect(snap(10.3, 1)).toBe(10.5);
    expect(snap(10.3, 2)).toBe(10);
    expect(snap(10.8, 2)).toBe(11);
  });
});

describe('tapes', () => {
  it('lists ticks around the value with majors every label step', () => {
    const buf = createTickBuffer(64);
    const n = tapeTicks(452, { minor: 10, major: 50, unitsPerValue: 1.2 }, 150, buf, 0, 0);
    expect(n).toBeGreaterThan(20);
    const values = Array.from(buf.value.subarray(0, n));
    expect(values).toContain(450);
    expect(values).toContain(500);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(buf.offset[i]!)).toBeLessThanOrEqual(150 + 1e-6);
      expect(buf.major[i]).toBe(buf.value[i]! % 50 === 0 ? 1 : 0);
      expect(buf.offset[i]).toBeCloseTo((buf.value[i]! - 452) * 1.2, 4);
    }
  });

  it('drops ticks below the floor (no negative airspeed)', () => {
    const buf = createTickBuffer(64);
    const n = tapeTicks(20, { minor: 10, major: 50, unitsPerValue: 1.2 }, 150, buf, 0, 0);
    for (let i = 0; i < n; i++) expect(buf.value[i]).toBeGreaterThanOrEqual(0);
  });

  it('wraps the heading tape through north', () => {
    const buf = createTickBuffer(64);
    const n = tapeTicks(355, { minor: 5, major: 10, unitsPerValue: 5 }, 60, buf, 360);
    const values = Array.from(buf.value.subarray(0, n));
    expect(values).toContain(0);
    expect(values).toContain(350);
    expect(values).toContain(5);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(360);
    }
  });
});

describe('pitch ladder', () => {
  it('places rungs conformally: tan projection around the current pitch', () => {
    const buf = createRungBuffer(40);
    const k = 935;
    const pitch = (3 * Math.PI) / 180;
    const n = ladderRungs(pitch, k, 400, 5, buf);
    const idx = Array.from(buf.deg.subarray(0, n)).indexOf(0);
    expect(idx).toBeGreaterThanOrEqual(0);
    // Horizon is 3° below the view center.
    expect(buf.offset[idx]).toBeCloseTo(k * Math.tan(-pitch), 3);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(buf.deg[i]! % 5)).toBe(0);
      expect(Math.abs(buf.offset[i]!)).toBeLessThanOrEqual(400);
    }
  });

  it('never returns rungs beyond ±90° or across the singularity', () => {
    const buf = createRungBuffer(40);
    const n = ladderRungs((88 * Math.PI) / 180, 935, 2000, 5, buf);
    for (let i = 0; i < n; i++) {
      expect(buf.deg[i]).toBeLessThanOrEqual(90);
      expect(buf.deg[i]).toBeGreaterThanOrEqual(-90);
      expect(Number.isFinite(buf.offset[i]!)).toBe(true);
    }
    expect(Array.from(buf.deg.subarray(0, n))).toContain(90);
  });
});

describe('off-screen arrows', () => {
  it('places points on the ellipse in the given direction', () => {
    const out = { x: 0, y: 0 };
    ellipseEdge(0, 500, 300, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(-300, 9);
    ellipseEdge(Math.PI / 2, 500, 300, out);
    expect(out.x).toBeCloseTo(500, 9);
    expect(out.y).toBeCloseTo(0, 9);
    ellipseEdge(Math.PI, 500, 300, out);
    expect(out.y).toBeCloseTo(300, 9);
    for (let a = -Math.PI; a < Math.PI; a += 0.1) {
      ellipseEdge(a, 500, 300, out);
      expect((out.x / 500) ** 2 + (out.y / 300) ** 2).toBeCloseTo(1, 9);
      expect(screenAngle(out.x, out.y)).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 9);
    }
  });

  it('places points on the rectangle edge', () => {
    const out = { x: 0, y: 0 };
    rectEdge(Math.PI / 4, 400, 200, out);
    expect(out.y).toBeCloseTo(-200, 9);
    expect(out.x).toBeCloseTo(200, 9);
    rectEdge(-Math.PI / 2, 400, 200, out);
    expect(out.x).toBeCloseTo(-400, 9);
  });

  it('keeps label boxes inside bounds', () => {
    const out = { x: 0, y: 0 };
    clampBox(-10, 50, 100, 20, 0, 0, 800, 600, out);
    expect(out.x).toBe(0);
    clampBox(750, 590, 100, 20, 0, 0, 800, 600, out);
    expect(out.x).toBe(700);
    expect(out.y).toBe(580);
  });
});

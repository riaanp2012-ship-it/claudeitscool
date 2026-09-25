import { describe, expect, it } from 'vitest';
import {
  makeDomain,
  MinMaxPyramid,
  mirrorCoord,
  sampleClamped,
  TerrainBounds,
  TerrainHeights,
  type HeightGrid,
} from '../../src/world/heightfield';

function grid(extent: number, size: number, f: (x: number, z: number) => number): HeightGrid {
  const dom = makeDomain(extent, size);
  const data = new Float32Array(size * size);
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++)
      data[iz * size + ix] = f(dom.originX + ix * dom.cell, dom.originZ + iz * dom.cell);
  }
  return { ...dom, data };
}

describe('heightfield sampling', () => {
  it('reproduces planes exactly (bilinear)', () => {
    const plane = (x: number, z: number) => 3 + 0.25 * x - 0.5 * z;
    const g = grid(1000, 64, plane);
    for (const [gx, gz] of [
      [0, 0],
      [10.5, 3.25],
      [62.9, 1.1],
      [31, 31],
    ] as const) {
      const x = g.originX + gx * g.cell;
      const z = g.originZ + gz * g.cell;
      expect(sampleClamped(g, gx, gz)).toBeCloseTo(plane(x, z), 3);
    }
  });

  it('bilinear interpolates between four samples and clamps outside', () => {
    const g: HeightGrid = {
      originX: 0,
      originZ: 0,
      cell: 1,
      size: 2,
      data: new Float32Array([0, 10, 20, 30]),
    };
    expect(sampleClamped(g, 0.5, 0)).toBeCloseTo(5);
    expect(sampleClamped(g, 0, 0.5)).toBeCloseTo(10);
    expect(sampleClamped(g, 0.5, 0.5)).toBeCloseTo(15);
    expect(sampleClamped(g, 0.25, 0.75)).toBeCloseTo(0.25 * 10 + 0.75 * 20);
    expect(sampleClamped(g, -5, -5)).toBe(0);
    expect(sampleClamped(g, 9, 9)).toBe(30);
  });

  it('mirrors coordinates continuously beyond the grid', () => {
    const n = 11;
    expect(mirrorCoord(3, n)).toBe(3);
    expect(mirrorCoord(-3, n)).toBe(3);
    expect(mirrorCoord(12, n)).toBe(8);
    expect(mirrorCoord(20, n)).toBe(0);
    expect(mirrorCoord(23, n)).toBe(3);
    for (let g = -40; g < 40; g += 0.37) {
      const a = mirrorCoord(g, n);
      const b = mirrorCoord(g + 0.01, n);
      expect(Math.abs(a - b)).toBeLessThan(0.0101);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(n - 1);
    }
  });

  it('blends the near and far maps continuously at the domain edge', () => {
    const f = (x: number, z: number) => 100 + 30 * Math.sin(x / 700) + 20 * Math.cos(z / 900);
    const near = grid(40960, 256, f);
    const far = grid(163840, 256, (x, z) => f(x, z) + 5);
    const t = new TerrainHeights(near, far, 18400, 20200);
    expect(t.heightAt(0, 0)).toBeCloseTo(t.nearAt(0, 0), 5);
    expect(t.heightAt(30000, 0)).toBeCloseTo(t.farAt(30000, 0), 5);
    let prev = t.heightAt(17000, 1234);
    for (let x = 17000; x < 22000; x += 5) {
      const h = t.heightAt(x, 1234);
      expect(Math.abs(h - prev)).toBeLessThan(2);
      prev = h;
    }
  });

  it('pyramid and terrain bounds contain every sampled height', () => {
    const f = (x: number, z: number) => 500 * Math.sin(x / 1300) * Math.cos(z / 1700) + 0.01 * x;
    const near = grid(40960, 256, f);
    const far = grid(163840, 256, f);
    const pyr = new MinMaxPyramid(near);
    const out = new Float32Array(2);
    pyr.query(10, 20, 60, 90, out);
    for (let gz = 20; gz <= 90; gz += 0.5) {
      for (let gx = 10; gx <= 60; gx += 0.5) {
        const h = sampleClamped(near, gx, gz);
        expect(h).toBeGreaterThanOrEqual(out[0]! - 1e-3);
        expect(h).toBeLessThanOrEqual(out[1]! + 1e-3);
      }
    }
    const t = new TerrainHeights(near, far, 18400, 20200);
    const b = new TerrainBounds(t);
    for (const [x0, z0, s] of [
      [-640, 1280, 640],
      [17920, -2560, 2560],
      [90000, 90000, 20480],
      [-200000, 5000, 40960],
    ] as const) {
      b.bounds(x0, z0, x0 + s, z0 + s, out);
      for (let i = 0; i <= 16; i++) {
        for (let j = 0; j <= 16; j++) {
          const h = t.heightAt(x0 + (s * i) / 16, z0 + (s * j) / 16);
          expect(h).toBeGreaterThanOrEqual(out[0]! - 1e-2);
          expect(h).toBeLessThanOrEqual(out[1]! + 1e-2);
        }
      }
    }
  });
});

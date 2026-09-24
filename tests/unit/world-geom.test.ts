import { describe, expect, it } from 'vitest';
import {
  arcLengths,
  catmullRom,
  dirHeading,
  fromLocal,
  headingDir,
  pointAt,
  polylineDistance,
  rasterizeDistance,
  runwayDesignators,
  runwayNumber,
  segmentDistance,
  toLocal,
} from '../../src/world/geom2d';
import { buildGridGeometry } from '../../src/world/terrain';

const DEG = Math.PI / 180;

describe('runway helpers', () => {
  it('numbers runways from their heading', () => {
    expect(runwayNumber(70 * DEG)).toBe('07');
    expect(runwayNumber(250 * DEG)).toBe('25');
    expect(runwayNumber(0)).toBe('36');
    expect(runwayNumber(4 * DEG)).toBe('36');
    expect(runwayNumber(356 * DEG)).toBe('36');
    expect(runwayDesignators(130 * DEG)).toEqual(['13', '31']);
  });

  it('converts between world and runway-local frames', () => {
    const [dx, dz] = headingDir(0);
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeCloseTo(-1);
    expect(dirHeading(1, 0)).toBeCloseTo(Math.PI / 2);
    for (const h of [0, 0.4, 2.2, 4.9]) {
      const [x, z] = fromLocal(100, -50, h, 300, -20);
      const [u, v] = toLocal(100, -50, h, x, z);
      expect(u).toBeCloseTo(300);
      expect(v).toBeCloseTo(-20);
    }
    // Right of a north heading is east.
    const [ex] = fromLocal(0, 0, 0, 0, 10);
    expect(ex).toBeCloseTo(10);
  });
});

describe('splines and distances', () => {
  it('segment and polyline distances', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0).d).toBeCloseTo(3);
    expect(segmentDistance(-4, 3, 0, 0, 10, 0).d).toBeCloseTo(5);
    const poly: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const len = arcLengths(poly);
    expect(len[2]).toBeCloseTo(200);
    const r = polylineDistance(poly, len, 110, 50);
    expect(r.d).toBeCloseTo(10);
    expect(r.s).toBeCloseTo(150);
    const [x, z] = pointAt(poly, len, 150);
    expect(x).toBeCloseTo(100);
    expect(z).toBeCloseTo(50);
  });

  it('catmull-rom passes through its control points', () => {
    const pts: [number, number][] = [
      [0, 0],
      [1000, 300],
      [2000, -200],
      [3000, 0],
    ];
    const s = catmullRom(pts, 50);
    for (const p of pts) {
      const best = Math.min(...s.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
      expect(best).toBeLessThan(1e-6);
    }
    for (let i = 1; i < s.length; i++) {
      expect(Math.hypot(s[i]![0] - s[i - 1]![0], s[i]![1] - s[i - 1]![1])).toBeLessThan(80);
    }
  });

  it('rasterizes distance fields near polylines', () => {
    const n = 32;
    const dist = new Float32Array(n * n).fill(1e9);
    rasterizeDistance(
      dist,
      n,
      0,
      0,
      10,
      [
        [
          [0, 155],
          [310, 155],
        ],
      ],
      40,
    );
    expect(dist[15 * n + 10]).toBeCloseTo(5);
    expect(dist[16 * n + 10]).toBeCloseTo(5);
    expect(dist[2 * n + 10]).toBe(1e9);
  });
});

describe('terrain grid mesh', () => {
  it('has upward-facing triangles plus a skirt ring', () => {
    const n = 8;
    const { positions, index } = buildGridGeometry(n);
    const grid = n * n * 2;
    for (let t = 0; t < grid; t++) {
      const a = index[t * 3]!;
      const b = index[t * 3 + 1]!;
      const c = index[t * 3 + 2]!;
      const ax = positions[a * 3]!;
      const az = positions[a * 3 + 2]!;
      const bx = positions[b * 3]!;
      const bz = positions[b * 3 + 2]!;
      const cx = positions[c * 3]!;
      const cz = positions[c * 3 + 2]!;
      // y component of (b - a) x (c - a); grid vertices all have y = 0.
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(ny).toBeGreaterThan(0);
    }
    expect(index.length / 3).toBe(grid + 4 * n * 2);
  });
});

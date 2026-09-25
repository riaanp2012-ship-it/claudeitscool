import { describe, expect, it } from 'vitest';
import { CdlodSelector, lodRanges, morphFactor, morphParams, type CdlodConfig } from '../../src/world/cdlod';
import { TERRAIN_QUALITY } from '../../src/world/constants';
import { makeDomain, TerrainBounds, TerrainHeights, type HeightGrid } from '../../src/world/heightfield';
import { Rng } from '../../src/core/rng';

/** Harsh synthetic terrain: steep ridges up to ~2.4 km relief. */
function synthetic(extent: number, size: number, seed: number): HeightGrid {
  const dom = makeDomain(extent, size);
  const data = new Float32Array(size * size);
  const rng = new Rng(seed);
  const waves = Array.from({ length: 6 }, () => ({
    kx: rng.range(-1, 1) / rng.range(800, 6000),
    kz: rng.range(-1, 1) / rng.range(800, 6000),
    a: rng.range(100, 450),
    p: rng.range(0, 6.28),
  }));
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const x = dom.originX + ix * dom.cell;
      const z = dom.originZ + iz * dom.cell;
      let h = 0;
      for (const w of waves) h += w.a * Math.abs(Math.sin(x * w.kx * 6.28 + z * w.kz * 6.28 + w.p));
      data[iz * size + ix] = h;
    }
  }
  return { ...dom, data };
}

function makeSelector(rangeFactor: number) {
  const near = synthetic(40960, 256, 3);
  const far = synthetic(163840, 256, 5);
  const heights = new TerrainHeights(near, far, 18400, 20200);
  const bounds = new TerrainBounds(heights);
  const q = TERRAIN_QUALITY.medium;
  const cfg: CdlodConfig = {
    leafSize: q.leafSize,
    levels: 8,
    grid: q.grid,
    rangeFactor,
    morphStart: q.morphStart,
    rootOrigin: -20480 - 3 * 81920,
    rootCount: 7,
    maxNodes: 4096,
  };
  const sel = new CdlodSelector(cfg, (x0, z0, x1, z1, out) => bounds.bounds(x0, z0, x1, z1, out));
  return { sel, heights, cfg };
}

interface Node {
  x: number;
  z: number;
  size: number;
  level: number;
  partial: boolean;
}

function nodes(sel: CdlodSelector): Node[] {
  const s = sel.selection;
  const out: Node[] = [];
  for (let i = 0; i < s.fullCount; i++) {
    out.push({
      x: s.full[i * 4]!,
      z: s.full[i * 4 + 1]!,
      size: s.full[i * 4 + 2]!,
      level: s.full[i * 4 + 3]!,
      partial: false,
    });
  }
  for (let i = 0; i < s.partialCount; i++) {
    out.push({
      x: s.partial[i * 4]!,
      z: s.partial[i * 4 + 1]!,
      size: s.partial[i * 4 + 2]!,
      level: s.partial[i * 4 + 3]!,
      partial: true,
    });
  }
  return out;
}

/** Grid spacing of the mesh a node is drawn with. */
function spacing(n: Node, grid: number): number {
  return n.partial ? n.size / (grid / 2) : n.size / grid;
}

describe('CDLOD selection', () => {
  it('uses doubling ranges and morph windows inside each band', () => {
    const cfg = makeSelector(4.6).cfg;
    const r = lodRanges(cfg);
    const m = morphParams(cfg);
    for (let i = 1; i < cfg.levels; i++) expect(r[i]! / r[i - 1]!).toBeCloseTo(2);
    for (let i = 0; i < cfg.levels; i++) {
      expect(m[i * 2]!).toBeLessThan(r[i]!);
      expect(morphFactor(m, i, r[i]!)).toBeCloseTo(1);
      expect(morphFactor(m, i, m[i * 2]! - 1)).toBe(0);
    }
  });

  it('culls nodes outside the frustum', () => {
    const { sel } = makeSelector(4.6);
    sel.select(0, 3000, 0, null);
    const all = sel.selection.fullCount + sel.selection.partialCount;
    // A frustum that only keeps x > 0 (plane normal +x through the origin).
    const planes = new Float32Array(24);
    for (let i = 0; i < 6; i++) planes[i * 4 + 3] = 1e9;
    planes[0] = 1;
    planes[3] = 0;
    sel.select(0, 3000, 0, planes);
    const half = sel.selection.fullCount + sel.selection.partialCount;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(all);
    for (let i = 0; i < sel.selection.fullCount; i++) {
      expect(sel.selection.full[i * 4]! + sel.selection.full[i * 4 + 2]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('covers the terrain without overlaps and neighbours differ by at most one level, crack free', () => {
    const { sel, heights, cfg } = makeSelector(TERRAIN_QUALITY.medium.rangeFactor);
    const morph = morphParams(cfg);
    const rng = new Rng(11);
    let checked = 0;
    let worstFine = 1;
    let worstCoarse = 0;
    for (let trial = 0; trial < 12; trial++) {
      const cx = rng.range(-16000, 16000);
      const cz = rng.range(-16000, 16000);
      const cy = heights.heightAt(cx, cz) + rng.range(20, 9000);
      sel.select(cx, cy, cz, null);
      const list = nodes(sel);
      expect(list.length).toBeGreaterThan(0);
      // Map fine cells (leaf/2) to the node that owns them over a window around the camera.
      const cell = cfg.leafSize / 2;
      const win = 12000;
      // Window origin aligned to the node grid.
      const wx = cfg.rootOrigin + Math.floor((cx - win - cfg.rootOrigin) / cell) * cell;
      const wz = cfg.rootOrigin + Math.floor((cz - win - cfg.rootOrigin) / cell) * cell;
      const owner = new Map<number, Node>();
      const key = (i: number, j: number) => i * 100000 + j;
      for (const n of list) {
        const i0 = Math.max(Math.round((n.x - wx) / cell), 0);
        const j0 = Math.max(Math.round((n.z - wz) / cell), 0);
        const i1 = Math.min(Math.round((n.x + n.size - wx) / cell), (2 * win) / cell);
        const j1 = Math.min(Math.round((n.z + n.size - wz) / cell), (2 * win) / cell);
        for (let i = i0; i < i1; i++) {
          for (let j = j0; j < j1; j++) {
            expect(owner.has(key(i, j))).toBe(false);
            owner.set(key(i, j), n);
          }
        }
      }
      // Every cell inside the window is covered.
      for (let i = 0; i < (2 * win) / cell; i += 7) {
        for (let j = 0; j < (2 * win) / cell; j += 7) expect(owner.has(key(i, j))).toBe(true);
      }
      // Shared edges: level difference <= 1; the finer side is fully morphed and the coarser side not at all.
      const dist = (x: number, z: number) => Math.hypot(x - cx, heights.heightAt(x, z) - cy, z - cz);
      for (const [k, n] of owner) {
        const i = Math.floor(k / 100000);
        const j = k % 100000;
        for (const [di, dj] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const m = owner.get(key(i + di, j + dj));
          if (!m || m === n) continue;
          const sn = spacing(n, cfg.grid);
          const sm = spacing(m, cfg.grid);
          const ratio = Math.max(sn, sm) / Math.min(sn, sm);
          expect(ratio).toBeLessThanOrEqual(2 + 1e-6);
          if (ratio < 1.5) continue;
          const fine = sn < sm ? n : m;
          const coarse = sn < sm ? m : n;
          // Points on the shared edge.
          const ex = wx + (i + di) * cell;
          const ez = wz + (j + dj) * cell;
          for (let t = 0; t <= 4; t++) {
            const px = di ? ex : ex + (cell * t) / 4;
            const pz = di ? ez + (cell * t) / 4 : ez;
            const d = dist(px, pz);
            checked++;
            worstFine = Math.min(worstFine, morphFactor(morph, fine.level, d));
            worstCoarse = Math.max(worstCoarse, morphFactor(morph, coarse.level, d));
            expect(morphFactor(morph, fine.level, d)).toBeGreaterThan(0.999);
            expect(morphFactor(morph, coarse.level, d)).toBeLessThan(0.001);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worstFine).toBeGreaterThan(0.999);
    expect(worstCoarse).toBeLessThan(0.001);
  });
});

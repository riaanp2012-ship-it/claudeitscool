/**
 * CPU side of the terrain heightmaps. Every query here mirrors the GLSL in `glsl/terrainSample.ts` exactly,
 * so collision, line of sight and placement agree with what the GPU draws.
 */

export interface GridDomain {
  /** World x/z of sample (0, 0). */
  originX: number;
  originZ: number;
  /** Meters between samples. */
  cell: number;
  /** Samples per side. */
  size: number;
}

/** Square grid of heights, row-major with rows along +z: data[iz * size + ix]. */
export interface HeightGrid extends GridDomain {
  data: Float32Array;
}

export function makeDomain(extent: number, size: number): GridDomain {
  const cell = extent / size;
  return { originX: -extent / 2, originZ: -extent / 2, cell, size };
}

/** Reflects a grid coordinate into [0, n - 1] (mirrored repeat about the first and last sample). */
export function mirrorCoord(g: number, n: number): number {
  const p = 2 * (n - 1);
  const m = g - p * Math.floor(g / p);
  return m > n - 1 ? p - m : m;
}

/** Bilinear sample with clamped edges. gx/gz in grid units. */
export function sampleClamped(grid: HeightGrid, gx: number, gz: number): number {
  const n = grid.size;
  const max = n - 1;
  const cx = gx < 0 ? 0 : gx > max ? max : gx;
  const cz = gz < 0 ? 0 : gz > max ? max : gz;
  let ix = Math.floor(cx);
  let iz = Math.floor(cz);
  if (ix > max - 1) ix = max - 1;
  if (iz > max - 1) iz = max - 1;
  const fx = cx - ix;
  const fz = cz - iz;
  const d = grid.data;
  const i = iz * n + ix;
  const h00 = d[i]!;
  const h10 = d[i + 1]!;
  const h01 = d[i + n]!;
  const h11 = d[i + n + 1]!;
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

/** Bilinear sample with mirrored repeat beyond the grid (used for the far map). */
export function sampleMirrored(grid: HeightGrid, gx: number, gz: number): number {
  return sampleClamped(grid, mirrorCoord(gx, grid.size), mirrorCoord(gz, grid.size));
}

export function smoothstep01(a: number, b: number, v: number): number {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * Near + far heightmaps blended in a band at the edge of the near domain (Chebyshev distance), exactly as
 * the vertex shader does it.
 */
export class TerrainHeights {
  constructor(
    readonly near: HeightGrid,
    readonly far: HeightGrid,
    readonly blendStart: number,
    readonly blendEnd: number,
  ) {}

  nearAt(x: number, z: number): number {
    const g = this.near;
    return sampleClamped(g, (x - g.originX) / g.cell, (z - g.originZ) / g.cell);
  }

  farAt(x: number, z: number): number {
    const g = this.far;
    return sampleMirrored(g, (x - g.originX) / g.cell, (z - g.originZ) / g.cell);
  }

  /** Weight of the far map at x/z (0 inside the near domain core). */
  farWeight(x: number, z: number): number {
    const ax = x < 0 ? -x : x;
    const az = z < 0 ? -z : z;
    return smoothstep01(this.blendStart, this.blendEnd, ax > az ? ax : az);
  }

  heightAt(x: number, z: number): number {
    const w = this.farWeight(x, z);
    if (w <= 0) return this.nearAt(x, z);
    if (w >= 1) return this.farAt(x, z);
    const n = this.nearAt(x, z);
    return n + (this.farAt(x, z) - n) * w;
  }
}

/**
 * Min/max mip pyramid over a height grid for conservative bounds of any rectangle (CDLOD culling,
 * line-of-sight early outs). Level 0 is the grid itself; level l stores 2^l x 2^l blocks (including the
 * shared edge sample so bilinear interpolation stays inside the bounds).
 */
export class MinMaxPyramid {
  readonly levels: { size: number; min: Float32Array; max: Float32Array }[] = [];
  readonly globalMin: number;
  readonly globalMax: number;

  constructor(readonly grid: HeightGrid) {
    const n = grid.size;
    // Level 0: each cell covers samples [i, i + 1] so a block bound contains every bilinear value inside it.
    let size = n;
    let min = new Float32Array(size * size);
    let max = new Float32Array(size * size);
    const d = grid.data;
    for (let z = 0; z < n; z++) {
      const z1 = z + 1 < n ? z + 1 : z;
      for (let x = 0; x < n; x++) {
        const x1 = x + 1 < n ? x + 1 : x;
        const a = d[z * n + x]!;
        const b = d[z * n + x1]!;
        const c = d[z1 * n + x]!;
        const e = d[z1 * n + x1]!;
        const lo = Math.min(a, b, c, e);
        const hi = Math.max(a, b, c, e);
        min[z * n + x] = lo;
        max[z * n + x] = hi;
      }
    }
    this.levels.push({ size, min, max });
    while (size > 1) {
      const ns = size >> 1;
      const nmin = new Float32Array(ns * ns);
      const nmax = new Float32Array(ns * ns);
      for (let z = 0; z < ns; z++) {
        for (let x = 0; x < ns; x++) {
          const i0 = 2 * z * size + 2 * x;
          const i1 = i0 + size;
          nmin[z * ns + x] = Math.min(min[i0]!, min[i0 + 1]!, min[i1]!, min[i1 + 1]!);
          nmax[z * ns + x] = Math.max(max[i0]!, max[i0 + 1]!, max[i1]!, max[i1 + 1]!);
        }
      }
      size = ns;
      min = nmin;
      max = nmax;
      this.levels.push({ size, min, max });
    }
    this.globalMin = min[0]!;
    this.globalMax = max[0]!;
  }

  /**
   * Bounds of heights over grid-coordinate rectangle [gx0, gx1] x [gz0, gz1] (clamped to the grid).
   * Writes [min, max] into out. Zero allocation.
   */
  query(gx0: number, gz0: number, gx1: number, gz1: number, out: Float32Array): void {
    const n = this.grid.size;
    const max = n - 1;
    let x0 = Math.floor(gx0 < 0 ? 0 : gx0 > max ? max : gx0);
    let z0 = Math.floor(gz0 < 0 ? 0 : gz0 > max ? max : gz0);
    let x1 = Math.floor(gx1 < 0 ? 0 : gx1 > max ? max : gx1);
    let z1 = Math.floor(gz1 < 0 ? 0 : gz1 > max ? max : gz1);
    // Pick the level where the rectangle spans at most ~3 cells per axis.
    const span = Math.max(x1 - x0, z1 - z0) + 1;
    let level = 0;
    while (level < this.levels.length - 1 && span >> level > 3) level++;
    x0 >>= level;
    z0 >>= level;
    x1 >>= level;
    z1 >>= level;
    const L = this.levels[level]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = z * L.size + x;
        const a = L.min[i]!;
        const b = L.max[i]!;
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      }
    }
    out[0] = lo;
    out[1] = hi;
  }
}

/** Mirrors a world-space interval [a, b] of a mirrored grid axis into grid coordinates; returns false if it spans a fold. */
function mirrorInterval(a: number, b: number, n: number, out: Float32Array, o: number): boolean {
  const p = 2 * (n - 1);
  const ka = Math.floor(a / (n - 1));
  const kb = Math.floor(b / (n - 1));
  if (ka !== kb) return false;
  const ma = mirrorCoord(a, n);
  const mb = mirrorCoord(b, n);
  out[o] = Math.min(ma, mb);
  out[o + 1] = Math.max(ma, mb);
  return p > 0;
}

/** Conservative height bounds of world rectangles over the blended near/far terrain. */
export class TerrainBounds {
  private readonly nearPyr: MinMaxPyramid;
  private readonly farPyr: MinMaxPyramid;
  private readonly tmp = new Float32Array(4);
  private readonly res = new Float32Array(2);

  constructor(readonly heights: TerrainHeights) {
    this.nearPyr = new MinMaxPyramid(heights.near);
    this.farPyr = new MinMaxPyramid(heights.far);
  }

  get globalMin(): number {
    return Math.min(this.nearPyr.globalMin, this.farPyr.globalMin);
  }

  get globalMax(): number {
    return Math.max(this.nearPyr.globalMax, this.farPyr.globalMax);
  }

  /** Writes [min, max] of terrain heights over the world rectangle into out. */
  bounds(x0: number, z0: number, x1: number, z1: number, out: Float32Array): void {
    const h = this.heights;
    const maxAbs = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1));
    const minCheb = Math.max(x0 > 0 ? x0 : x1 < 0 ? -x1 : 0, z0 > 0 ? z0 : z1 < 0 ? -z1 : 0);
    let lo = Infinity;
    let hi = -Infinity;
    const needNear = minCheb < h.blendEnd;
    const needFar = maxAbs > h.blendStart;
    if (needNear) {
      const g = h.near;
      this.nearPyr.query(
        (x0 - g.originX) / g.cell,
        (z0 - g.originZ) / g.cell,
        (x1 - g.originX) / g.cell,
        (z1 - g.originZ) / g.cell,
        this.res,
      );
      lo = this.res[0]!;
      hi = this.res[1]!;
    }
    if (needFar) {
      const g = h.far;
      const t = this.tmp;
      const okX = mirrorInterval((x0 - g.originX) / g.cell, (x1 - g.originX) / g.cell, g.size, t, 0);
      const okZ = mirrorInterval((z0 - g.originZ) / g.cell, (z1 - g.originZ) / g.cell, g.size, t, 2);
      if (okX && okZ) {
        this.farPyr.query(t[0]!, t[2]!, t[1]!, t[3]!, this.res);
        if (this.res[0]! < lo) lo = this.res[0]!;
        if (this.res[1]! > hi) hi = this.res[1]!;
      } else {
        if (this.farPyr.globalMin < lo) lo = this.farPyr.globalMin;
        if (this.farPyr.globalMax > hi) hi = this.farPyr.globalMax;
      }
    }
    out[0] = lo;
    out[1] = hi;
  }
}

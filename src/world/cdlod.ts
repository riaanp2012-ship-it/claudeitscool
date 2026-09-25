/**
 * CDLOD quadtree selection (Strugar 2009), CPU side. Pure and allocation-free per call.
 *
 * Level 0 is the finest. A node at level L has size leafSize * 2^L and is drawn with `grid` quads per side.
 * Level L covers camera distances up to ranges[L] = rangeFactor * size(L). Vertices of a level-L node morph
 * toward the level-(L+1) grid between morphStart[L] and ranges[L], so LOD transitions never pop (ZD-B05) and
 * neighbouring nodes never crack (ZD-B06): with rangeFactor >= ~4.5 a node's neighbours differ by at most one
 * level and the finer side is fully morphed along every shared edge.
 *
 * Quadrants of a subdivided node that fall outside the child range are emitted as "partial" nodes: they use
 * the parent's level and are drawn with a half-resolution grid (grid / 2), which matches the parent's density.
 */

export interface CdlodConfig {
  leafSize: number;
  levels: number;
  /** Quads per full node side (even). */
  grid: number;
  rangeFactor: number;
  /** Fraction of the level's range band where morphing starts (0..1). */
  morphStart: number;
  /** World x/z of the first root node corner (roots tile a square). */
  rootOrigin: number;
  /** Root nodes per side. */
  rootCount: number;
  maxNodes: number;
}

/** Height bounds provider: writes [min, max] for the world rectangle into out. */
export type BoundsFn = (x0: number, z0: number, x1: number, z1: number, out: Float32Array) => void;

export interface CdlodSelection {
  /** Full nodes: x0, z0, size, level per node. */
  full: Float32Array;
  fullCount: number;
  /** Partial quadrants (drawn with grid / 2 at the parent's level): x0, z0, size, level. */
  partial: Float32Array;
  partialCount: number;
}

export function lodRanges(cfg: CdlodConfig): Float32Array {
  const r = new Float32Array(cfg.levels);
  for (let i = 0; i < cfg.levels; i++) r[i] = cfg.rangeFactor * cfg.leafSize * 2 ** i;
  return r;
}

/** Per level: [morphStart, 1 / (morphEnd - morphStart)] as used by the vertex shader. */
export function morphParams(cfg: CdlodConfig): Float32Array {
  const ranges = lodRanges(cfg);
  const out = new Float32Array(cfg.levels * 2);
  for (let i = 0; i < cfg.levels; i++) {
    const prev = i === 0 ? 0 : ranges[i - 1]!;
    const end = ranges[i]!;
    const start = prev + (end - prev) * cfg.morphStart;
    out[i * 2] = start;
    out[i * 2 + 1] = 1 / Math.max(end - start, 1e-3);
  }
  return out;
}

/** Morph factor of a vertex at distance d for level L (same formula as the vertex shader). */
export function morphFactor(params: Float32Array, level: number, d: number): number {
  const k = (d - params[level * 2]!) * params[level * 2 + 1]!;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

export class CdlodSelector {
  readonly ranges: Float32Array;
  readonly selection: CdlodSelection;
  private readonly bb = new Float32Array(2);
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private planes: Float32Array | null = null;
  /** Extra downward extent for boxes (horizon curvature), as a function of horizontal distance. */
  private dropFn: ((dist: number) => number) | null = null;

  constructor(
    readonly cfg: CdlodConfig,
    private readonly boundsFn: BoundsFn,
  ) {
    this.ranges = lodRanges(cfg);
    this.selection = {
      full: new Float32Array(cfg.maxNodes * 4),
      fullCount: 0,
      partial: new Float32Array(cfg.maxNodes * 4),
      partialCount: 0,
    };
  }

  setDropFunction(fn: ((dist: number) => number) | null): void {
    this.dropFn = fn;
  }

  /**
   * Select nodes for a camera. planes: 6 frustum planes (nx, ny, nz, d) with inside where n.p + d >= 0,
   * or null to skip culling.
   */
  select(camX: number, camY: number, camZ: number, planes: Float32Array | null): CdlodSelection {
    this.camX = camX;
    this.camY = camY;
    this.camZ = camZ;
    this.planes = planes;
    const s = this.selection;
    s.fullCount = 0;
    s.partialCount = 0;
    const top = this.cfg.levels - 1;
    const rootSize = this.cfg.leafSize * 2 ** top;
    for (let j = 0; j < this.cfg.rootCount; j++) {
      for (let i = 0; i < this.cfg.rootCount; i++) {
        this.selectNode(
          this.cfg.rootOrigin + i * rootSize,
          this.cfg.rootOrigin + j * rootSize,
          rootSize,
          top,
        );
      }
    }
    return s;
  }

  /** Returns false if the node is beyond its level's range (the caller then draws that area coarser). */
  private selectNode(x0: number, z0: number, size: number, level: number): boolean {
    const bb = this.bb;
    this.boundsFn(x0, z0, x0 + size, z0 + size, bb);
    const minY = bb[0]!;
    const maxY = bb[1]!;
    if (!this.boxInSphere(x0, z0, size, minY, maxY, this.ranges[level]!)) return false;
    if (!this.boxInFrustum(x0, z0, size, minY, maxY)) return true;
    if (level === 0) {
      this.emit(this.selection.full, 0, x0, z0, size, level);
      return true;
    }
    if (!this.boxInSphere(x0, z0, size, minY, maxY, this.ranges[level - 1]!)) {
      this.emit(this.selection.full, 0, x0, z0, size, level);
      return true;
    }
    const half = size * 0.5;
    for (let q = 0; q < 4; q++) {
      const cx = x0 + (q & 1) * half;
      const cz = z0 + (q >> 1) * half;
      if (!this.selectNode(cx, cz, half, level - 1)) {
        // Child out of its range: draw this quadrant at this node's level (culled separately).
        this.boundsFn(cx, cz, cx + half, cz + half, bb);
        if (this.boxInFrustum(cx, cz, half, bb[0]!, bb[1]!)) {
          this.emit(this.selection.partial, 1, cx, cz, half, level);
        }
      }
    }
    return true;
  }

  private emit(arr: Float32Array, which: 0 | 1, x0: number, z0: number, size: number, level: number): void {
    const s = this.selection;
    const count = which === 0 ? s.fullCount : s.partialCount;
    if (count >= this.cfg.maxNodes) return;
    const o = count * 4;
    arr[o] = x0;
    arr[o + 1] = z0;
    arr[o + 2] = size;
    arr[o + 3] = level;
    if (which === 0) s.fullCount++;
    else s.partialCount++;
  }

  private boxInSphere(x0: number, z0: number, size: number, minY: number, maxY: number, r: number): boolean {
    const cx = this.camX;
    const cy = this.camY;
    const cz = this.camZ;
    const dx = cx < x0 ? x0 - cx : cx > x0 + size ? cx - x0 - size : 0;
    const dy = cy < minY ? minY - cy : cy > maxY ? cy - maxY : 0;
    const dz = cz < z0 ? z0 - cz : cz > z0 + size ? cz - z0 - size : 0;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }

  private boxInFrustum(x0: number, z0: number, size: number, minY: number, maxY: number): boolean {
    const p = this.planes;
    if (!p) return true;
    let lo = minY;
    if (this.dropFn) {
      // Farthest horizontal corner distance bounds the horizon drop inside the box.
      const fx = Math.max(Math.abs(x0 - this.camX), Math.abs(x0 + size - this.camX));
      const fz = Math.max(Math.abs(z0 - this.camZ), Math.abs(z0 + size - this.camZ));
      lo -= this.dropFn(Math.sqrt(fx * fx + fz * fz));
    }
    const x1 = x0 + size;
    const z1 = z0 + size;
    for (let i = 0; i < 6; i++) {
      const nx = p[i * 4]!;
      const ny = p[i * 4 + 1]!;
      const nz = p[i * 4 + 2]!;
      const d = p[i * 4 + 3]!;
      const px = nx >= 0 ? x1 : x0;
      const py = ny >= 0 ? maxY : lo;
      const pz = nz >= 0 ? z1 : z0;
      if (nx * px + ny * py + nz * pz + d < 0) return false;
    }
    return true;
  }
}

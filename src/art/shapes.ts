import { fanCap, gridSurface, MeshBuilder } from './builder';

/**
 * Cross-section of a lofted body: a superellipse with independent half-widths (left/right), half-heights
 * (top/bottom) and one exponent per quadrant (2 = ellipse, higher = boxier, lower = pointier).
 */
export interface Section {
  cx: number;
  cy: number;
  wl: number;
  wr: number;
  ht: number;
  hb: number;
  nTL: number;
  nTR: number;
  nBL: number;
  nBR: number;
}

export const SECTION_KEYS = ['cx', 'cy', 'wl', 'wr', 'ht', 'hb', 'nTL', 'nTR', 'nBL', 'nBR'] as const;

export function makeSection(): Section {
  return { cx: 0, cy: 0, wl: 0, wr: 0, ht: 0, hb: 0, nTL: 2, nTR: 2, nBL: 2, nBR: 2 };
}

/** Symmetric section shorthand: half-width, top and bottom half-heights, top and bottom exponents. */
export function sym(cy: number, hw: number, ht: number, hb: number, nt = 2, nb = 2): Section {
  return { cx: 0, cy, wl: hw, wr: hw, ht, hb, nTL: nt, nTR: nt, nBL: nb, nBR: nb };
}

/** Point on the section at t in [0,1): 0 = top, 0.25 = right (+x), 0.5 = bottom, 0.75 = left. */
export function sectionPoint(s: Section, t: number, out: Float64Array, o: number): void {
  const a = t * Math.PI * 2;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const right = sa >= 0;
  const top = ca >= 0;
  const n = top ? (right ? s.nTR : s.nTL) : right ? s.nBR : s.nBL;
  const e = 2 / n;
  const px = Math.pow(Math.abs(sa), e) * (right ? s.wr : -s.wl);
  const py = Math.pow(Math.abs(ca), e) * (top ? s.ht : -s.hb);
  out[o] = s.cx + px;
  out[o + 1] = s.cy + py;
}

/** Fritsch-Carlson monotone cubic interpolation (no overshoot between control values). */
export class Monotone {
  private readonly m: Float64Array;
  constructor(
    private readonly xs: readonly number[],
    private readonly ys: readonly number[],
  ) {
    const n = xs.length;
    const d = new Float64Array(Math.max(n - 1, 1));
    const m = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1]! - ys[i]!) / Math.max(xs[i + 1]! - xs[i]!, 1e-9);
    if (n > 1) {
      m[0] = d[0]!;
      m[n - 1] = d[n - 2]!;
    }
    for (let i = 1; i < n - 1; i++) {
      const a = d[i - 1]!;
      const b = d[i]!;
      m[i] = a * b <= 0 ? 0 : (a + b) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      const di = d[i]!;
      if (Math.abs(di) < 1e-12) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i]! / di;
      const b = m[i + 1]! / di;
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        m[i] = t * a * di;
        m[i + 1] = t * b * di;
      }
    }
    this.m = m;
  }

  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (n === 1 || x <= xs[0]!) return this.ys[0]!;
    if (x >= xs[n - 1]!) return this.ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.ys[i]! +
      (t3 - 2 * t2 + t) * h * this.m[i]! +
      (-2 * t3 + 3 * t2) * this.ys[i + 1]! +
      (t3 - t2) * h * this.m[i + 1]!
    );
  }
}

/** A station of a lofted body: longitudinal position (z, aft positive) and its section. */
export interface Station {
  z: number;
  s: Section;
}

/** Smoothly interpolated body profile through control stations (each section field is splined). */
export class Profile {
  private readonly splines: Monotone[];
  readonly z0: number;
  readonly z1: number;
  constructor(readonly stations: readonly Station[]) {
    const zs = stations.map((s) => s.z);
    this.splines = SECTION_KEYS.map(
      (k) =>
        new Monotone(
          zs,
          stations.map((s) => s.s[k]),
        ),
    );
    this.z0 = zs[0]!;
    this.z1 = zs[zs.length - 1]!;
  }

  at(z: number, out: Section): Section {
    for (let i = 0; i < SECTION_KEYS.length; i++) out[SECTION_KEYS[i]!] = this.splines[i]!.at(z);
    return out;
  }
}

/** Samples positions from z0 to z1 with spacing `step`, refined to `fine` within `fineLen` of each end. */
export function stationList(
  z0: number,
  z1: number,
  step: number,
  fine = step,
  fineStart = 0,
  fineEnd = 0,
): number[] {
  const out: number[] = [z0];
  let z = z0;
  while (z < z1 - 1e-6) {
    const nearStart = z - z0 < fineStart;
    const nearEnd = z1 - z < fineEnd;
    const h = nearStart || nearEnd ? fine : step;
    z = Math.min(z + h, z1);
    if (z1 - z < h * 0.35) z = z1;
    out.push(z);
  }
  return out;
}

/** Inserts extra stations (sorted, deduplicated) so key features land exactly on a ring. */
export function withStations(list: number[], extra: readonly number[]): number[] {
  const all = [...list, ...extra.filter((e) => e > list[0]! && e < list[list.length - 1]!)].sort(
    (a, b) => a - b,
  );
  const out: number[] = [];
  for (const z of all) if (out.length === 0 || z - out[out.length - 1]! > 0.02) out.push(z);
  return out;
}

export type RingFn = (z: number, out: Float64Array) => void;

export interface LoftOptions {
  zs: readonly number[];
  nU: number;
  ring: RingFn;
  /** Open ring (not wrapped), e.g. a partial skin. */
  open?: boolean;
  creases?: readonly number[];
  /** Per ring point z offset (raked lips): returns the z to use for point (x, y) at station z. */
  zOf?: (z: number, x: number, y: number) => number;
  capStart?: 'none' | 'flat' | 'point';
  capEnd?: 'none' | 'flat' | 'point';
  flip?: boolean;
  /** Panel uv: body = (station, arc length from top centerline). */
  uv?: 'body' | 'none';
  aoAt?: (i: number, j: number) => number;
  weightAt?: (i: number, j: number) => number;
}

/** Lofts rings along z into a smooth skin. Returns the ring point grid for callers that need it. */
export function loft(b: MeshBuilder, o: LoftOptions): Float64Array {
  const nI = o.zs.length;
  const nJ = o.nU;
  const P = new Float64Array(nI * nJ * 3);
  const ring = new Float64Array(nJ * 2);
  const arc = new Float64Array(nI * nJ);
  for (let i = 0; i < nI; i++) {
    const z = o.zs[i]!;
    o.ring(z, ring);
    for (let j = 0; j < nJ; j++) {
      const x = ring[j * 2]!;
      const y = ring[j * 2 + 1]!;
      const k = (i * nJ + j) * 3;
      P[k] = x;
      P[k + 1] = y;
      P[k + 2] = o.zOf ? o.zOf(z, x, y) : z;
    }
    // arc length from point 0 in both directions; body uv uses the shorter way (symmetric panel lines).
    let fwd = 0;
    arc[i * nJ] = 0;
    for (let j = 1; j < nJ; j++) {
      fwd += Math.hypot(ring[j * 2]! - ring[(j - 1) * 2]!, ring[j * 2 + 1]! - ring[(j - 1) * 2 + 1]!);
      arc[i * nJ + j] = fwd;
    }
    if (!o.open) {
      const total = fwd + Math.hypot(ring[0]! - ring[(nJ - 1) * 2]!, ring[1]! - ring[(nJ - 1) * 2 + 1]!);
      for (let j = 1; j < nJ; j++) arc[i * nJ + j] = Math.min(arc[i * nJ + j]!, total - arc[i * nJ + j]!);
    }
  }
  const useUv = o.uv !== 'none';
  gridSurface(b, P, nI, nJ, {
    wrap: !o.open,
    creases: o.creases,
    flip: o.flip,
    aoAt: o.aoAt,
    weightAt: o.weightAt,
    uvAt: (i, j, out) => {
      out[0] = useUv ? P[(i * nJ + j) * 3 + 2]! : 0;
      out[1] = useUv ? arc[i * nJ + j]! : 0;
    },
  });
  const capRing = (i: number, mode: 'flat' | 'point', dir: number) => {
    const pts = new Float64Array(nJ * 3);
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let j = 0; j < nJ; j++) {
      const k = (i * nJ + j) * 3;
      pts[j * 3] = P[k]!;
      pts[j * 3 + 1] = P[k + 1]!;
      pts[j * 3 + 2] = P[k + 2]!;
      cx += P[k]!;
      cy += P[k + 1]!;
      cz += P[k + 2]!;
    }
    cx /= nJ;
    cy /= nJ;
    cz /= nJ;
    let r = 0;
    for (let j = 0; j < nJ; j++) r = Math.max(r, Math.hypot(pts[j * 3]! - cx, pts[j * 3 + 1]! - cy));
    const apexZ = mode === 'point' ? cz + dir * Math.max(r * 0.6, 0.004) : cz;
    capFan(b, pts, nJ, [cx, cy, apexZ], [0, 0, dir * (o.flip ? -1 : 1)]);
  };
  if (o.capStart && o.capStart !== 'none' && !o.open) capRing(0, o.capStart, -1);
  if (o.capEnd && o.capEnd !== 'none' && !o.open) capRing(nI - 1, o.capEnd, 1);
  return P;
}

/** Ring function for a superellipse profile sampled at nU points starting at the top, going right. */
export function superRing(profile: Profile, nU: number, t0 = 0, t1 = 1, open = false): RingFn {
  const s = makeSection();
  return (z, out) => {
    profile.at(z, s);
    const n = open ? nU - 1 : nU;
    for (let j = 0; j < nU; j++) sectionPoint(s, t0 + ((t1 - t0) * j) / n, out, j * 2);
  };
}

/** Samples a closed polygon (corner list) with `per` points per edge; returns ring and crease indices. */
export function polygonRing(
  corners: readonly (readonly [number, number])[],
  per: number,
  out: Float64Array,
): void {
  const n = corners.length;
  for (let c = 0; c < n; c++) {
    const a = corners[c]!;
    const b = corners[(c + 1) % n]!;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      out[(c * per + k) * 2] = a[0] + (b[0] - a[0]) * t;
      out[(c * per + k) * 2 + 1] = a[1] + (b[1] - a[1]) * t;
    }
  }
}

/** Surface of revolution around the z axis through (cx, cy). profile: [z, r] pairs from front to back. */
export function lathe(
  b: MeshBuilder,
  profile: readonly (readonly [number, number])[],
  seg: number,
  o: {
    cx?: number;
    cy?: number;
    flip?: boolean;
    rowCreases?: readonly number[];
    capStart?: boolean;
    capEnd?: boolean;
    uv?: boolean;
    aoAt?: (i: number) => number;
    weightAt?: (i: number) => number;
    phase?: number;
    ellipse?: number;
  } = {},
): void {
  const nI = profile.length;
  const P = new Float64Array(nI * seg * 3);
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  const ell = o.ellipse ?? 1;
  for (let i = 0; i < nI; i++) {
    const [z, r] = profile[i]!;
    for (let j = 0; j < seg; j++) {
      const a = ((j + (o.phase ?? 0)) / seg) * Math.PI * 2;
      const k = (i * seg + j) * 3;
      P[k] = cx + Math.sin(a) * r;
      P[k + 1] = cy + Math.cos(a) * r * ell;
      P[k + 2] = z;
    }
  }
  gridSurface(b, P, nI, seg, {
    wrap: true,
    flip: o.flip,
    rowCreases: o.rowCreases,
    aoAt: o.aoAt ? (i) => o.aoAt!(i) : undefined,
    weightAt: o.weightAt ? (i) => o.weightAt!(i) : undefined,
    uvAt: (i, j, out) => {
      out[0] = o.uv ? profile[i]![0] : 0;
      out[1] = o.uv ? (j / seg) * Math.PI * 2 * Math.max(profile[i]![1], 0.01) : 0;
    },
  });
  const cap = (i: number, dir: number) => {
    const pts = new Float64Array(seg * 3);
    for (let j = 0; j < seg * 3; j++) pts[j] = P[i * seg * 3 + j]!;
    const z = profile[i]![0];
    capFan(b, pts, seg, [cx, cy, z], [0, 0, dir * (o.flip ? -1 : 1)]);
  };
  if (o.capStart && profile[0]![1] > 1e-4) cap(0, -1);
  if (o.capEnd && profile[nI - 1]![1] > 1e-4) cap(nI - 1, 1);
}

/** A round tube along a polyline (parallel-transport frames), optional per-point radius. */
export function tube(
  b: MeshBuilder,
  path: readonly (readonly [number, number, number])[],
  radius: number | readonly number[],
  seg: number,
  caps = true,
): void {
  const n = path.length;
  const P = new Float64Array(n * seg * 3);
  // initial normal: any vector perpendicular to the first tangent
  let tx = path[1]![0] - path[0]![0],
    ty = path[1]![1] - path[0]![1],
    tz = path[1]![2] - path[0]![2];
  let tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  let nx = 0,
    ny = 1,
    nz = 0;
  if (Math.abs(ty) > 0.9) {
    nx = 1;
    ny = 0;
  }
  // make n perpendicular
  let d = nx * tx + ny * ty + nz * tz;
  nx -= d * tx;
  ny -= d * ty;
  nz -= d * tz;
  let nl = Math.hypot(nx, ny, nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  for (let i = 0; i < n; i++) {
    const p = path[i]!;
    // tangent: average of adjacent segments
    const a = path[Math.max(i - 1, 0)]!;
    const c = path[Math.min(i + 1, n - 1)]!;
    let ux = c[0] - a[0],
      uy = c[1] - a[1],
      uz = c[2] - a[2];
    tl = Math.hypot(ux, uy, uz) || 1;
    ux /= tl;
    uy /= tl;
    uz /= tl;
    d = nx * ux + ny * uy + nz * uz;
    nx -= d * ux;
    ny -= d * uy;
    nz -= d * uz;
    nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const bx = uy * nz - uz * ny,
      by = uz * nx - ux * nz,
      bz = ux * ny - uy * nx;
    const r = typeof radius === 'number' ? radius : radius[i]!;
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      const cs = Math.cos(ang) * r;
      const sn = Math.sin(ang) * r;
      const k = (i * seg + j) * 3;
      P[k] = p[0] + nx * cs + bx * sn;
      P[k + 1] = p[1] + ny * cs + by * sn;
      P[k + 2] = p[2] + nz * cs + bz * sn;
    }
  }
  // orientation: rows along the path, columns around; with (n, b) right-handed around t the normal
  // cross(dP/di, dP/dj) points inward, so flip.
  gridSurface(b, P, n, seg, { wrap: true, flip: true });
  if (caps) {
    for (const i of [0, n - 1]) {
      const pts = new Float64Array(seg * 3);
      for (let j = 0; j < seg * 3; j++) pts[j] = P[i * seg * 3 + j]!;
      const p = path[i]!;
      const q = path[i === 0 ? 1 : n - 2]!;
      const ex = p[0] - q[0],
        ey = p[1] - q[1],
        ez = p[2] - q[2];
      const el = Math.hypot(ex, ey, ez) || 1;
      capFan(b, pts, seg, p, [ex / el, ey / el, ez / el]);
    }
  }
}

/** Fan cap whose winding is chosen so its front face looks along `normal`. */
export function capFan(
  b: MeshBuilder,
  pts: Float64Array,
  n: number,
  center: readonly [number, number, number],
  normal: readonly [number, number, number],
): void {
  // winding test using the first two ring points
  const ax = pts[0]! - center[0],
    ay = pts[1]! - center[1],
    az = pts[2]! - center[2];
  const bx = pts[3]! - center[0],
    by = pts[4]! - center[1],
    bz = pts[5]! - center[2];
  const cx = ay * bz - az * by,
    cy = az * bx - ax * bz,
    cz = ax * by - ay * bx;
  const flip = cx * normal[0] + cy * normal[1] + cz * normal[2] < 0;
  fanCap(b, pts, n, center, normal, flip);
}

/** Axis-aligned box with flat faces, centred at c with half extents h. */
export function box(
  b: MeshBuilder,
  c: readonly [number, number, number],
  h: readonly [number, number, number],
): void {
  const faces: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (const [nx, ny, nz] of faces) {
    // two tangent axes
    const ux = ny !== 0 ? 1 : 0,
      uy = nz !== 0 ? 1 : 0,
      uz = nx !== 0 ? 1 : 0;
    const vx = ny * uz - nz * uy,
      vy = nz * ux - nx * uz,
      vz = nx * uy - ny * ux;
    const ids: number[] = [];
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      ids.push(
        b.vertex(
          c[0] + (nx + ux * su + vx * sv) * h[0],
          c[1] + (ny + uy * su + vy * sv) * h[1],
          c[2] + (nz + uz * su + vz * sv) * h[2],
          nx,
          ny,
          nz,
        ),
      );
    }
    b.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
  }
}

import type { HardpointKind } from '../core/types';
import { gridSurface, MeshBuilder, PAINT, PANEL, PART, rotation } from './builder';
import type { BuildContext } from './context';
import { FX } from './fxgeo';
import { buildOrdnance, ORDNANCE_SIZE } from './ordnance';
import { normalize, ROOT_BONE, type Vec3 } from './rig';
import {
  capFan,
  lathe,
  loft,
  makeSection,
  Monotone,
  Profile,
  sectionPoint,
  stationList,
  tube,
  type Section,
} from './shapes';
import { buildSurface, type SurfaceDef } from './surfaces';

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

// ───────────────────────────────────────────────────────────── intakes

export interface IntakeDef {
  /** Lip station at the section centre. */
  z0: number;
  /** Station where the outer shell has sunk into the fuselage. */
  z1: number;
  lip: Section;
  end: Section;
  /** z offset of the lip per metre of lateral / vertical distance from the lip centre (raked lips). */
  rakeX: number;
  rakeY: number;
  wall: number;
  depth: number;
  /** Inner section at the fan face (absolute). */
  fan: Section;
  mirror: boolean;
  /** Superellipse ring resolution. */
  nU?: number;
  /** Sharp-edged (caret) intake: creases at the four section extremes. */
  sharp?: boolean;
  /** Boundary-layer splitter plate on the inboard side. */
  splitter?: boolean;
  /** Lip paint: livery or dark. */
  lipDark?: boolean;
}

function ringNormal2d(ring: Float64Array, n: number, j: number, out: number[]): void {
  const a = (j - 1 + n) % n;
  const c = (j + 1) % n;
  const tx = ring[c * 2]! - ring[a * 2]!;
  const ty = ring[c * 2 + 1]! - ring[a * 2 + 1]!;
  const l = Math.hypot(tx, ty) || 1;
  // the ring runs clockwise (top -> right) in x-right/y-up, so the outward normal is the tangent turned CCW
  out[0] = -ty / l;
  out[1] = tx / l;
}

function lerpSection(a: Section, b: Section, t: number, out: Section): Section {
  out.cx = lerp(a.cx, b.cx, t);
  out.cy = lerp(a.cy, b.cy, t);
  out.wl = lerp(a.wl, b.wl, t);
  out.wr = lerp(a.wr, b.wr, t);
  out.ht = lerp(a.ht, b.ht, t);
  out.hb = lerp(a.hb, b.hb, t);
  out.nTL = lerp(a.nTL, b.nTL, t);
  out.nTR = lerp(a.nTR, b.nTR, t);
  out.nBL = lerp(a.nBL, b.nBL, t);
  out.nBR = lerp(a.nBR, b.nBR, t);
  return out;
}

/** Intake with a rounded lip, an outer shell fairing into the fuselage and a deep duct to a fan face. */
export function intake(ctx: BuildContext, d: IntakeDef): void {
  const b = ctx.body;
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  const nU = ctx.lod === 0 ? (d.nU ?? 28) : 12;
  const creases = d.sharp ? [0, nU / 4, nU / 2, (3 * nU) / 4] : [];
  const sec = makeSection();
  const rake = (x: number, y: number) => d.rakeX * (x - d.lip.cx) + d.rakeY * (y - d.lip.cy);
  const len = d.z1 - d.z0;
  const zs = stationList(d.z0, d.z1, ctx.lod === 0 ? 0.3 : 1.2, ctx.lod === 0 ? 0.08 : 0.5, 0.4, 0);
  b.style(PAINT.livery, 0xffffff, PANEL.body);
  b.part = PART.fuselage;
  b.bone = ROOT_BONE;
  loft(b, {
    zs,
    nU,
    creases,
    ring: (z, out) => {
      lerpSection(d.lip, d.end, smooth(Math.min(Math.max((z - d.z0) / len, 0), 1)), sec);
      for (let j = 0; j < nU; j++) sectionPoint(sec, j / nU, out, j * 2);
    },
    zOf: (z, x, y) => z + rake(x, y) * Math.max(0, 1 - (z - d.z0) / len),
  });
  // lip ring (outer at the lip, inner offset by the wall)
  const outer = new Float64Array(nU * 2);
  for (let j = 0; j < nU; j++) sectionPoint(d.lip, j / nU, outer, j * 2);
  const inner = new Float64Array(nU * 2);
  const nrm = [0, 0];
  for (let j = 0; j < nU; j++) {
    ringNormal2d(outer, nU, j, nrm);
    inner[j * 2] = outer[j * 2]! - nrm[0]! * d.wall;
    inner[j * 2 + 1] = outer[j * 2 + 1]! - nrm[1]! * d.wall;
  }
  // rounded rim: rows sweep from the outer lip point, forward, to the inner lip point
  const rimRows = ctx.lod === 0 ? 5 : 2;
  const R = new Float64Array((rimRows + 1) * nU * 3);
  for (let k = 0; k <= rimRows; k++) {
    const phi = (Math.PI * k) / rimRows;
    for (let j = 0; j < nU; j++) {
      const ox = outer[j * 2]!,
        oy = outer[j * 2 + 1]!;
      const ix = inner[j * 2]!,
        iy = inner[j * 2 + 1]!;
      const mx = (ox + ix) / 2;
      const my = (oy + iy) / 2;
      const c = Math.cos(phi);
      const x = mx + (ox - mx) * c;
      const y = my + (oy - my) * c;
      const zLip = d.z0 + rake(x, y);
      const o = (k * nU + j) * 3;
      R[o] = x;
      R[o + 1] = y;
      R[o + 2] = zLip - Math.sin(phi) * d.wall * 0.55;
    }
  }
  if (d.lipDark) b.style(PAINT.dark, 0x3a3d40, PANEL.plain);
  else b.panel = PANEL.plain;
  gridSurface(b, R, rimRows + 1, nU, { wrap: true, creases, flip: true });
  // duct
  b.style(PAINT.interior, 0xb8bab6, PANEL.plain);
  const ductZs = stationList(0, 1, ctx.lod === 0 ? 0.2 : 0.5);
  const ductP = new Float64Array(ductZs.length * nU * 3);
  const fanRing = new Float64Array(nU * 2);
  for (let j = 0; j < nU; j++) sectionPoint(d.fan, j / nU, fanRing, j * 2);
  for (let i = 0; i < ductZs.length; i++) {
    const t = ductZs[i]!;
    const e = smooth(t);
    for (let j = 0; j < nU; j++) {
      const x = lerp(inner[j * 2]!, fanRing[j * 2]!, e);
      const y = lerp(inner[j * 2 + 1]!, fanRing[j * 2 + 1]!, e);
      const zLip = d.z0 + rake(inner[j * 2]!, inner[j * 2 + 1]!);
      const o = (i * nU + j) * 3;
      ductP[o] = x;
      ductP[o + 1] = y;
      ductP[o + 2] = lerp(zLip, d.z0 + d.depth, t);
    }
  }
  gridSurface(b, ductP, ductZs.length, nU, {
    wrap: true,
    creases,
    flip: true,
    aoAt: (i) => lerp(1, 0.12, Math.pow(ductZs[i]!, 0.6)),
  });
  // fan face
  const last = (ductZs.length - 1) * nU * 3;
  const pts = new Float64Array(nU * 3);
  for (let j = 0; j < nU * 3; j++) pts[j] = ductP[last + j]!;
  b.style(PAINT.metal, 0x55585a, PANEL.plain);
  b.ao = 0.15;
  capFan(b, pts, nU, [d.fan.cx, d.fan.cy, d.z0 + d.depth - 0.08], [0, 0, -1]);
  b.ao = 1;
  if (d.splitter && ctx.lod === 0) {
    // thin splitter plate standing off the fuselage on the inboard side of the lip
    const inb = d.lip.cx - d.lip.wl - 0.05;
    b.style(PAINT.livery, 0xffffff, PANEL.plain);
    const sp: SurfaceDef = {
      x: inb,
      y: d.lip.cy - d.lip.hb * 0.9,
      vertical: true,
      angle: 0,
      stations: [
        { s: 0, le: d.z0 - 0.06, chord: 0.9, t: 0.03 },
        { s: d.lip.hb * 0.9 + d.lip.ht * 0.9, le: d.z0 - 0.02 + d.rakeY * d.lip.ht, chord: 0.85, t: 0.03 },
      ],
      part: PART.fuselage,
      bone: ROOT_BONE,
      mirror: false,
      k: 4,
    };
    buildSurface(b, ctx.rig, sp, 1);
  }
  if (d.mirror) b.mirror(v0, i0, ctx.rig.mirrorFn, (p) => p);
}

// ───────────────────────────────────────────────────────────── nozzles

export interface RoundNozzleDef {
  x: number;
  y: number;
  /** Petal hinge station and radius. */
  z0: number;
  r0: number;
  /** Exit station and radius at rest. */
  z1: number;
  r1: number;
  petals: number;
  mirror: boolean;
  index: number;
}

/** Convergent-divergent nozzle with overlapping petals that open with throttle, a hot liner and a flame. */
export function roundNozzle(ctx: BuildContext, d: RoundNozzleDef): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const pivot: Vec3 = [d.x, d.y, d.z1];
  const bones = d.mirror
    ? rig.addPair({ role: 'nozzle', pivot, axis: [0, 0, 1], param: d.index })
    : ([rig.add({ role: 'nozzle', pivot, axis: [0, 0, 1], param: d.index }), -1] as [number, number]);
  const nb = bones[0];
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  b.part = PART.engine;
  const L = d.z1 - d.z0;
  if (ctx.lod === 0) {
    b.bone = ROOT_BONE;
    b.bone2 = nb;
    const N = d.petals;
    const rows = 4;
    b.style(PAINT.metal, 0x77736c, PANEL.plain);
    for (let p = 0; p < N; p++) {
      const off = p % 2 === 1 ? 0.007 : 0;
      const a0 = ((p - 0.08) / N) * Math.PI * 2;
      const a1 = ((p + 1.08) / N) * Math.PI * 2;
      const P = new Float64Array((rows + 1) * 3 * 3);
      for (let i = 0; i <= rows; i++) {
        const u = i / rows;
        const r = lerp(d.r0, d.r1, u) + Math.sin(u * Math.PI) * 0.02 + off;
        for (let j = 0; j < 3; j++) {
          const a = lerp(a0, a1, j / 2);
          const o = (i * 3 + j) * 3;
          P[o] = d.x + Math.sin(a) * r;
          P[o + 1] = d.y + Math.cos(a) * r;
          P[o + 2] = d.z0 + L * u;
        }
      }
      gridSurface(b, P, rows + 1, 3, { weightAt: (i) => i / rows });
    }
    // exit rim and inner liner (hot)
    b.style(PAINT.nozzle, 0x6a6660, PANEL.plain);
    const liner: [number, number][] = [
      [d.z1 - L * 1.25, d.r1 * 0.72],
      [d.z1 - L * 0.55, d.r1 * 0.82],
      [d.z1 - 0.005, d.r1 - 0.035],
      [d.z1 + 0.002, d.r1 - 0.012],
      [d.z1 + 0.002, d.r1 + 0.012],
    ];
    lathe(b, liner, 20, {
      cx: d.x,
      cy: d.y,
      flip: true,
      rowCreases: [2, 3],
      weightAt: (i) => [0, 0.35, 1, 1, 1][i]!,
      aoAt: (i) => [0.3, 0.6, 1, 1, 1][i]!,
    });
    b.weight2 = 0;
    // flame holder / turbine face
    const zf = d.z1 - L * 1.25;
    b.ao = 0.4;
    lathe(
      b,
      [
        [zf, d.r1 * 0.72],
        [zf - 0.02, d.r1 * 0.2],
        [zf + 0.18, 0.02],
      ],
      16,
      { cx: d.x, cy: d.y },
    );
    b.ao = 1;
    ctx.fx.flame([d.x, d.y, d.z1 + 0.03], d.r1 - 0.03, 1, d.index, ROOT_BONE);
    ctx.fx.glow([d.x, d.y, d.z1], d.r1 * 0.8, 1, L * 1.1, d.index, ROOT_BONE);
    if (d.mirror) {
      ctx.fx.flame([-d.x, d.y, d.z1 + 0.03], d.r1 - 0.03, 1, d.index + 1, ROOT_BONE);
      ctx.fx.glow([-d.x, d.y, d.z1], d.r1 * 0.8, 1, L * 1.1, d.index + 1, ROOT_BONE);
    }
  } else {
    b.bone = ROOT_BONE;
    b.style(PAINT.metal, 0x77736c, PANEL.plain);
    lathe(
      b,
      [
        [d.z0, d.r0],
        [d.z1, d.r1],
      ],
      10,
      { cx: d.x, cy: d.y },
    );
    b.style(PAINT.nozzle, 0x4a4844, PANEL.plain);
    lathe(
      b,
      [
        [d.z1 - L * 0.8, d.r1 * 0.75],
        [d.z1, d.r1 - 0.02],
      ],
      10,
      { cx: d.x, cy: d.y, flip: true, capStart: true },
    );
  }
  if (d.mirror) b.mirror(v0, i0, rig.mirrorFn, (p) => p);
  b.bone = ROOT_BONE;
  b.bone2 = ROOT_BONE;
  ctx.meta.nozzles.push([d.x, d.y, d.z1]);
  ctx.meta.soot.push([d.x, d.y, d.z1, d.r0]);
  if (d.mirror) {
    ctx.meta.nozzles.push([-d.x, d.y, d.z1]);
    ctx.meta.soot.push([-d.x, d.y, d.z1, d.r0]);
  }
}

export interface RectNozzleDef {
  x: number;
  y: number;
  z0: number;
  z1: number;
  /** Exit half-width and half-height. */
  hw: number;
  hh: number;
  mirror: boolean;
  index: number;
}

function slab(b: MeshBuilder, zs: readonly number[], at: (z: number, s: Section) => void, nU: number): void {
  const sec = makeSection();
  loft(b, {
    zs,
    nU,
    creases: [nU / 8, (3 * nU) / 8, (5 * nU) / 8, (7 * nU) / 8],
    ring: (z, out) => {
      at(z, sec);
      for (let j = 0; j < nU; j++) sectionPoint(sec, (j + 0.5) / nU, out, j * 2);
    },
    capStart: 'flat',
    capEnd: 'flat',
    uv: 'none',
  });
}

/** Two-dimensional thrust-vectoring nozzle: hinged upper/lower flaps between fixed side walls. */
export function rectNozzle(ctx: BuildContext, d: RectNozzleDef): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const up: Vec3 = [d.x, d.y + d.hh, d.z0];
  const lo: Vec3 = [d.x, d.y - d.hh, d.z0];
  const pair = (pivot: Vec3, param: number) =>
    d.mirror
      ? rig.addPair({ role: 'nozzleFlap', pivot, axis: [1, 0, 0], param, param2: d.index })[0]
      : rig.add({ role: 'nozzleFlap', pivot, axis: [1, 0, 0], param, param2: d.index });
  const ub = pair(up, 1);
  const lb = pair(lo, -1);
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  b.part = PART.engine;
  const L = d.z1 - d.z0;
  const zs = [d.z0, d.z0 + L * 0.5, d.z1];
  const nU = ctx.lod === 0 ? 16 : 8;
  const th = 0.035;
  b.style(PAINT.livery, 0xffffff, PANEL.plain);
  // upper and lower flaps: converge slightly toward the exit
  for (const [sgn, bone] of [
    [1, ub],
    [-1, lb],
  ] as const) {
    b.bone = ctx.lod === 0 ? bone : ROOT_BONE;
    slab(
      b,
      zs,
      (z, s) => {
        const u = (z - d.z0) / L;
        s.cx = d.x;
        s.cy = d.y + sgn * (d.hh * lerp(1.04, 0.86, u) + th);
        s.wl = s.wr = d.hw + 0.05;
        s.ht = s.hb = th;
        s.nTL = s.nTR = s.nBL = s.nBR = 8;
      },
      nU,
    );
  }
  b.bone = ROOT_BONE;
  // side walls with a raked trailing edge
  for (const sx of [1, -1]) {
    slab(
      b,
      [d.z0 - 0.05, d.z0 + L * 0.45, d.z1 - L * 0.3],
      (z, s) => {
        const u = (z - d.z0) / L;
        s.cx = d.x + sx * (d.hw + 0.03);
        s.cy = d.y + lerp(0, 0.05, u);
        s.wl = s.wr = 0.03;
        s.ht = d.hh * lerp(1.2, 0.95, u) + th;
        s.hb = d.hh * lerp(1.2, 0.8, u) + th;
        s.nTL = s.nTR = s.nBL = s.nBR = 8;
      },
      nU,
    );
  }
  // hot duct interior
  b.style(PAINT.nozzle, 0x5c5954, PANEL.plain);
  const sec = makeSection();
  loft(b, {
    zs: [d.z0 - 1.2, d.z0 - 0.4, d.z1 - L * 0.1],
    nU: nU,
    flip: true,
    ring: (z, out) => {
      const u = Math.min(Math.max((z - (d.z0 - 1.2)) / (L + 1.1), 0), 1);
      sec.cx = d.x;
      sec.cy = d.y;
      sec.wl = sec.wr = d.hw * lerp(0.8, 0.98, u);
      sec.ht = sec.hb = d.hh * lerp(0.9, 0.84, u);
      sec.nTL = sec.nTR = sec.nBL = sec.nBR = 6;
      for (let j = 0; j < nU; j++) sectionPoint(sec, j / nU, out, j * 2);
    },
    capStart: 'flat',
    uv: 'none',
    aoAt: (i) => [0.3, 0.7, 1][i]!,
  });
  if (d.mirror) b.mirror(v0, i0, rig.mirrorFn, (p) => p);
  if (ctx.lod === 0) {
    const aspect = d.hw / d.hh;
    const r = d.hh * 0.84;
    ctx.fx.flame([d.x, d.y, d.z1 - 0.05], r, aspect, d.index, ROOT_BONE);
    ctx.fx.glow([d.x, d.y, d.z1 - L * 0.1], r, aspect, 1.0, d.index, ROOT_BONE);
    if (d.mirror) {
      ctx.fx.flame([-d.x, d.y, d.z1 - 0.05], r, aspect, d.index + 1, ROOT_BONE);
      ctx.fx.glow([-d.x, d.y, d.z1 - L * 0.1], r, aspect, 1.0, d.index + 1, ROOT_BONE);
    }
  }
  ctx.meta.nozzles.push([d.x, d.y, d.z1]);
  ctx.meta.soot.push([d.x, d.y, d.z1, Math.max(d.hw, d.hh)]);
  if (d.mirror) {
    ctx.meta.nozzles.push([-d.x, d.y, d.z1]);
    ctx.meta.soot.push([-d.x, d.y, d.z1, Math.max(d.hw, d.hh)]);
  }
}

// ───────────────────────────────────────────────────────────── canopy

export interface CanopyDef {
  zFront: number;
  /** Windscreen / canopy split (front bow). */
  zBow: number;
  zRear: number;
  /** Extra frame bows on the moving canopy (tandem mid bow). */
  bows: number[];
  /** [z, height above sill] control points. */
  height: [number, number][];
  /** Ring parameter of the sill on the fuselage section. */
  sillT: number;
  /** Canopy section exponent (2 = round bubble, higher = flatter top). */
  n: number;
  /** Width scale relative to the fuselage sill (1 = sits on the sill). */
  widthScale?: number;
  frameless?: boolean;
  /** Flat armoured panels (creased ring). */
  facet?: boolean;
  tint: number;
  maxOpen: number;
}

/** Sill point of the fuselage at station z (right side). */
export function sillAt(profile: Profile, z: number, t: number): [number, number] {
  const s = profile.at(z, makeSection());
  const out = new Float64Array(2);
  sectionPoint(s, t, out, 0);
  return [out[0]!, out[1]!];
}

export function canopy(ctx: BuildContext, d: CanopyDef): void {
  const rig = ctx.rig;
  const [, ysRear] = sillAt(ctx.fuselage, d.zRear, d.sillT);
  const cb = rig.add({ role: 'canopy', pivot: [0, ysRear, d.zRear], axis: [1, 0, 0], max: d.maxOpen * DEG });
  const hz = d.height.map((p) => p[0]);
  const hs = new Monotone(
    hz,
    d.height.map((p) => p[1]),
  );
  const nArc = ctx.lod === 0 ? (d.facet ? 13 : 19) : 7;
  const pointAt = (z: number, u: number, out: number[], lift = 0) => {
    const [xs0, ys] = sillAt(ctx.fuselage, z, d.sillT);
    const xs = xs0 * (d.widthScale ?? 1);
    const h = Math.max(hs.at(z), 0);
    const a = Math.PI * (u - 0.5);
    let sx: number;
    let sy: number;
    if (d.facet) {
      // flat side panels and a flat top: piecewise linear profile
      const k = Math.abs(u - 0.5) * 2;
      const topW = 0.55;
      sx = Math.sign(u - 0.5) * (k < topW ? (k / topW) * 0.7 : 0.7 + ((k - topW) / (1 - topW)) * 0.3);
      sy = k < topW ? 1 : 1 - (k - topW) / (1 - topW);
    } else {
      const e = 2 / d.n;
      sx = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), e);
      sy = Math.pow(Math.abs(Math.cos(a)), e);
    }
    out[0] = sx * (xs + lift);
    out[1] = ys + sy * (h + lift);
    out[2] = z;
  };
  const creases = d.facet ? [3, 4, 8, 9] : [];
  const buildGlass = (b: MeshBuilder, z0: number, z1: number, lod: number) => {
    const zs = stationList(z0, z1, lod === 0 ? 0.12 : 0.6, lod === 0 ? 0.05 : 0.3, 0.3, 0.3);
    const P = new Float64Array(zs.length * nArc * 3);
    const tmp = [0, 0, 0];
    for (let i = 0; i < zs.length; i++) {
      for (let j = 0; j < nArc; j++) {
        pointAt(zs[i]!, j / (nArc - 1), tmp);
        const o = (i * nArc + j) * 3;
        P[o] = tmp[0]!;
        P[o + 1] = tmp[1]!;
        P[o + 2] = tmp[2]!;
      }
    }
    gridSurface(b, P, zs.length, nArc, { creases });
  };
  if (ctx.lod === 0) {
    const g = ctx.glass;
    g.setTint(d.tint);
    g.bone = ROOT_BONE;
    buildGlass(g, d.zFront, d.zBow, 0);
    g.bone = cb;
    buildGlass(g, d.zBow, d.zRear, 0);
    // frame: bows and sill rails in body colour
    const b = ctx.body;
    b.style(PAINT.livery, 0xffffff, PANEL.plain);
    b.part = PART.fuselage;
    const tmp = [0, 0, 0];
    const bow = (z: number, bone: number, r: number) => {
      b.bone = bone;
      const path: [number, number, number][] = [];
      for (let j = 0; j <= 16; j++) {
        pointAt(z, 0.02 + (0.96 * j) / 16, tmp, r * 0.4);
        path.push([tmp[0]!, tmp[1]!, tmp[2]!]);
      }
      tube(b, path, r, 6);
    };
    if (!d.frameless) {
      bow(d.zBow, ROOT_BONE, 0.032);
      for (const z of d.bows) bow(z, cb, 0.026);
    }
    // sill rails on the moving canopy
    b.bone = cb;
    for (const u of [0.015, 0.985]) {
      const path: [number, number, number][] = [];
      for (const z of stationList(d.zBow + 0.02, d.zRear - 0.04, 0.2)) {
        pointAt(z, u, tmp, 0.012);
        path.push([tmp[0]!, tmp[1]!, tmp[2]!]);
      }
      if (path.length >= 2) tube(b, path, 0.022, 5);
    }
    b.bone = ROOT_BONE;
  } else {
    const b = ctx.body;
    b.style(PAINT.glassLod, d.tint, PANEL.plain);
    b.bone = ROOT_BONE;
    buildGlass(b, d.zFront, d.zRear, 1);
  }
}

// ───────────────────────────────────────────────────────────── cockpit interior and pilot

/** Ejection seat, pilot (torso, helmet, visor) and a glareshield, positioned from the eye point. */
export function pilot(
  ctx: BuildContext,
  eye: Vec3,
  coaming: { z: number; w: number; y: number } | null,
): void {
  if (ctx.lod !== 0) return;
  const b = ctx.body;
  b.bone = ROOT_BONE;
  b.part = PART.fuselage;
  const [ex, ey, ez] = eye;
  // seat: headrest block and back
  b.style(PAINT.fabric, 0x35383a, PANEL.plain);
  const sec = makeSection();
  loft(b, {
    zs: [ez + 0.19, ez + 0.23, ez + 0.33, ez + 0.37],
    nU: 12,
    ring: (z, out) => {
      const u = (z - ez - 0.19) / 0.18;
      const k = Math.sin(Math.PI * Math.min(Math.max(u, 0.05), 0.95));
      sec.cx = ex;
      sec.cy = ey - 0.2;
      sec.wl = sec.wr = 0.17 * (0.7 + 0.3 * k);
      sec.ht = 0.3 * (0.8 + 0.2 * k);
      sec.hb = 0.45;
      sec.nTL = sec.nTR = 3.2;
      sec.nBL = sec.nBR = 4;
      for (let j = 0; j < 12; j++) sectionPoint(sec, j / 12, out, j * 2);
    },
    capStart: 'flat',
    capEnd: 'flat',
    uv: 'none',
  });
  // torso
  b.style(PAINT.fabric, 0x4a5236, PANEL.plain);
  const torso = new Profile([
    {
      z: ey - 0.62,
      s: { ...sec, cx: ex, cy: 0, wl: 0.2, wr: 0.2, ht: 0.13, hb: 0.13, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    },
    {
      z: ey - 0.3,
      s: {
        ...sec,
        cx: ex,
        cy: 0,
        wl: 0.23,
        wr: 0.23,
        ht: 0.13,
        hb: 0.12,
        nTL: 2.2,
        nTR: 2.2,
        nBL: 2,
        nBR: 2,
      },
    },
    {
      z: ey - 0.2,
      s: { ...sec, cx: ex, cy: 0.0, wl: 0.2, wr: 0.2, ht: 0.11, hb: 0.1, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    },
    {
      z: ey - 0.12,
      s: { ...sec, cx: ex, cy: 0.01, wl: 0.07, wr: 0.07, ht: 0.06, hb: 0.06, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    },
  ]);
  // loft along y: build along z then rotate so the axis is vertical
  const v0 = b.vertexCount;
  loft(b, {
    zs: [ey - 0.62, ey - 0.45, ey - 0.33, ey - 0.25, ey - 0.19, ey - 0.12],
    nU: 12,
    ring: (z, out) => {
      torso.at(z, sec);
      for (let j = 0; j < 12; j++) sectionPoint(sec, j / 12, out, j * 2);
    },
    capEnd: 'flat',
    uv: 'none',
  });
  // rotate: loft z -> world y (up); ring y -> world z (depth)
  for (let v = v0; v < b.vertexCount; v++) {
    const x = b.pos[v * 3]!;
    const y = b.pos[v * 3 + 1]!;
    const z = b.pos[v * 3 + 2]!;
    b.pos[v * 3] = x;
    b.pos[v * 3 + 1] = z;
    b.pos[v * 3 + 2] = ez + 0.06 - y;
    const nx = b.nrm[v * 3]!;
    const ny = b.nrm[v * 3 + 1]!;
    const nz = b.nrm[v * 3 + 2]!;
    b.nrm[v * 3] = nx;
    b.nrm[v * 3 + 1] = nz;
    b.nrm[v * 3 + 2] = -ny;
  }
  // helmet
  b.style(PAINT.fabric, 0xc9ccc8, PANEL.plain);
  const hc: Vec3 = [ex, ey + 0.05, ez + 0.05];
  const hr = 0.135;
  const helmet: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    helmet.push([hc[1] + Math.cos(a) * hr * 1.05, Math.max(Math.sin(a) * hr, 0.004)]);
  }
  const hv = b.vertexCount;
  const hi = b.idx.length;
  lathe(b, helmet.reverse(), 12, { cx: ex, cy: hc[2] });
  // lathe axis is z; rotate so it runs along y
  for (let v = hv; v < b.vertexCount; v++) {
    const x = b.pos[v * 3]!;
    const y = b.pos[v * 3 + 1]!;
    const z = b.pos[v * 3 + 2]!;
    b.pos[v * 3 + 1] = z;
    b.pos[v * 3 + 2] = y;
    b.pos[v * 3] = x;
    const ny = b.nrm[v * 3 + 1]!;
    b.nrm[v * 3 + 1] = b.nrm[v * 3 + 2]!;
    b.nrm[v * 3 + 2] = ny;
  }
  // the y/z swap is a reflection: reverse winding
  flipWinding(b, hi);
  // visor: dark gloss shell over the front of the helmet
  b.style(PAINT.gloss, 0x2b2a22, PANEL.plain);
  const vis: [number, number, number][] = [];
  for (let j = 0; j <= 8; j++) {
    const a = -1.1 + (2.2 * j) / 8;
    vis.push([ex + Math.sin(a) * hr * 1.06, hc[1] - 0.005, hc[2] - Math.cos(a) * hr * 1.06]);
  }
  tube(b, vis, 0.045, 6);
  if (coaming) {
    b.style(PAINT.dark, 0x2c2e30, PANEL.plain);
    const c = makeSection();
    loft(b, {
      zs: [coaming.z - 0.25, coaming.z - 0.1, coaming.z + 0.15, coaming.z + 0.3],
      nU: 12,
      ring: (z, out) => {
        const u = (z - coaming.z + 0.25) / 0.55;
        c.cx = 0;
        c.cy = coaming.y;
        c.wl = c.wr = coaming.w * (0.6 + 0.4 * Math.sin(Math.PI * u));
        c.ht = 0.13 * Math.sin(Math.PI * Math.min(u * 1.3, 1));
        c.hb = 0.1;
        c.nTL = c.nTR = 2.5;
        c.nBL = c.nBR = 2;
        for (let j = 0; j < 12; j++) sectionPoint(c, j / 12, out, j * 2);
      },
      uv: 'none',
    });
  }
}

// ───────────────────────────────────────────────────────────── landing gear

export interface DoorDef {
  z0: number;
  z1: number;
  /** Fuselage ring parameters of the door edges (right side); the hinge is at t0. */
  t0: number;
  t1: number;
  /** Rotation about the hinge (deg) when open; axis along +z (right side). */
  angle: number;
  /** Door closes again when the gear is down (main bay doors). */
  sequenced?: boolean;
  /** Use a separate profile (e.g. a nacelle) instead of the fuselage. */
  profile?: Profile;
}

export interface GearDef {
  pivot: Vec3;
  length: number;
  wheelR: number;
  wheelW: number;
  twin?: boolean;
  /** Retraction rotation axis (right side) and angle (deg) from extended to stowed. */
  axis: Vec3;
  angle: number;
  mirror: boolean;
  doors: DoorDef[];
  strutR: number;
  /** Lateral offset of the wheel centre from the strut axis (+ outboard). */
  offset?: number;
  /** Strut rake (deg, positive = axle aft of the pivot). */
  rake?: number;
}

function wheel(b: MeshBuilder, c: Vec3, R: number, W: number, seg: number): void {
  const v0 = b.vertexCount;
  const hw = W / 2;
  b.style(PAINT.rubber, 0x1d1e1f, PANEL.plain);
  lathe(
    b,
    [
      [-hw, R * 0.62],
      [-hw, R * 0.86],
      [-hw * 0.82, R * 0.97],
      [-hw * 0.4, R],
      [hw * 0.4, R],
      [hw * 0.82, R * 0.97],
      [hw, R * 0.86],
      [hw, R * 0.62],
    ],
    seg,
  );
  b.style(PAINT.metal, 0x8d9296, PANEL.plain);
  lathe(
    b,
    [
      [-hw * 0.92, 0.02],
      [-hw * 0.92, R * 0.45],
      [-hw * 0.98, R * 0.62],
    ],
    seg,
  );
  lathe(
    b,
    [
      [hw * 0.98, R * 0.62],
      [hw * 0.92, R * 0.45],
      [hw * 0.92, 0.02],
    ],
    seg,
  );
  // axle along x
  b.transform(v0, rotation([0, 1, 0], Math.PI / 2), [0, 0, 0], c);
}

/** Landing gear leg (strut, oleo, wheel) plus bay doors, rigged to retract with state.gear. */
export function gear(ctx: BuildContext, d: GearDef): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const axis = normalize(d.axis);
  const [gb] = d.mirror
    ? rig.addPair({ role: 'gear', pivot: [...d.pivot], axis, max: d.angle * DEG })
    : [rig.add({ role: 'gear', pivot: [...d.pivot], axis, max: d.angle * DEG })];
  const doorBones: number[] = [];
  for (const door of d.doors) {
    const prof = door.profile ?? ctx.fuselage;
    const zm = (door.z0 + door.z1) / 2;
    const s = prof.at(zm, makeSection());
    const h = new Float64Array(2);
    sectionPoint(s, door.t0, h, 0);
    const reg = {
      role: 'door' as const,
      pivot: [h[0]!, h[1]!, zm] as Vec3,
      axis: [0, 0, 1] as Vec3,
      max: door.angle * DEG,
      param: door.sequenced ? 1 : 0,
    };
    doorBones.push(h[0]! > 0.01 ? rig.addPair(reg)[0] : rig.add(reg));
  }
  const rake = (d.rake ?? 0) * DEG;
  const axle: Vec3 = [
    d.pivot[0] + (d.offset ?? 0),
    d.pivot[1] - d.length * Math.cos(rake),
    d.pivot[2] + d.length * Math.sin(rake),
  ];
  ctx.meta.gearContactY = Math.min(ctx.meta.gearContactY, axle[1] - d.wheelR);
  if (ctx.lod !== 0) return;
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  b.part = PART.fuselage;
  b.bone = gb;
  // strut: upper cylinder (body grey) and chromed oleo
  b.style(PAINT.metal, 0xa9adb0, PANEL.plain);
  const top: Vec3 = [d.pivot[0], d.pivot[1], d.pivot[2]];
  const mid: Vec3 = [
    lerp(top[0], axle[0] - (d.offset ?? 0), 0.55),
    lerp(top[1], axle[1], 0.55),
    lerp(top[2], axle[2], 0.55),
  ];
  tube(b, [top, mid], d.strutR, 8);
  b.style(PAINT.metal, 0xd6d9db, PANEL.plain);
  const low: Vec3 = [axle[0] - (d.offset ?? 0), axle[1] + d.wheelR * 0.15, axle[2]];
  tube(b, [mid, low], d.strutR * 0.7, 8);
  // torque link and drag brace
  b.style(PAINT.metal, 0x8d9296, PANEL.plain);
  tube(
    b,
    [
      [mid[0], mid[1] - 0.05, mid[2] + d.strutR * 1.6],
      [lerp(mid[0], low[0], 0.5), lerp(mid[1], low[1], 0.5), mid[2] + d.strutR * 2.4],
      [low[0], low[1] + 0.06, low[2] + d.strutR * 1.4],
    ],
    0.018,
    4,
  );
  tube(
    b,
    [
      [mid[0], mid[1] + 0.1, mid[2]],
      [top[0], top[1] - 0.05, top[2] + d.length * 0.45],
    ],
    d.strutR * 0.45,
    6,
  );
  if (d.offset) {
    tube(b, [low, [axle[0], axle[1], axle[2]]], d.strutR * 0.55, 6);
  }
  const seg = 16;
  if (d.twin) {
    wheel(b, [axle[0] - d.wheelW * 0.6, axle[1], axle[2]], d.wheelR, d.wheelW, seg);
    wheel(b, [axle[0] + d.wheelW * 0.6, axle[1], axle[2]], d.wheelR, d.wheelW, seg);
  } else wheel(b, axle, d.wheelR, d.wheelW, seg);
  b.bone = ROOT_BONE;
  if (d.mirror) b.mirror(v0, i0, rig.mirrorFn, (p) => p);
  // doors: skin patch offset outward, livery outside, interior colour inside; off-centre doors come in pairs
  const sec = makeSection();
  d.doors.forEach((door, k) => {
    const dv0 = b.vertexCount;
    const di0 = b.idx.length;
    const prof = door.profile ?? ctx.fuselage;
    b.bone = doorBones[k]!;
    const zs = stationList(door.z0, door.z1, 0.25);
    const nJ = 6;
    for (const face of [1, -1]) {
      const P = new Float64Array(zs.length * nJ * 3);
      const tmp = new Float64Array(2);
      const tmp2 = new Float64Array(2);
      for (let i = 0; i < zs.length; i++) {
        prof.at(zs[i]!, sec);
        for (let j = 0; j < nJ; j++) {
          const t = lerp(door.t0, door.t1, j / (nJ - 1));
          sectionPoint(sec, t, tmp, 0);
          sectionPoint(sec, t + 0.002, tmp2, 0);
          const tx = tmp2[0]! - tmp[0]!;
          const ty = tmp2[1]! - tmp[1]!;
          const l = Math.hypot(tx, ty) || 1;
          const off = face > 0 ? 0.012 : -0.008;
          const o = (i * nJ + j) * 3;
          P[o] = tmp[0]! + (-ty / l) * off;
          P[o + 1] = tmp[1]! + (tx / l) * off;
          P[o + 2] = zs[i]!;
        }
      }
      if (face > 0) b.style(PAINT.livery, 0xffffff, PANEL.plain);
      else b.style(PAINT.interior, 0x9a9d98, PANEL.plain);
      gridSurface(b, P, zs.length, nJ, { flip: face < 0 });
    }
    if (rig.mirror(doorBones[k]!) !== doorBones[k]!) b.mirror(dv0, di0, rig.mirrorFn, (p) => p);
  });
  b.bone = ROOT_BONE;
}

/** Reverses the winding of triangles [i0, end). */
export function flipWinding(b: MeshBuilder, i0: number): void {
  for (let i = i0; i < b.idx.length; i += 3) {
    const t = b.idx[i + 1]!;
    b.idx[i + 1] = b.idx[i + 2]!;
    b.idx[i + 2] = t;
  }
}

// ───────────────────────────────────────────────────────────── small details

/** Pitot boom from `base` forward to `tip` (z decreasing). */
export function pitot(ctx: BuildContext, base: Vec3, tip: Vec3, r: number): void {
  const b = ctx.body;
  b.bone = ROOT_BONE;
  b.part = PART.fuselage;
  b.style(PAINT.metal, 0x9ea3a6, PANEL.plain);
  const n = ctx.lod === 0 ? 8 : 4;
  lathe(
    b,
    [
      [tip[2], r * 0.35],
      [tip[2] + 0.08, r * 0.6],
      [lerp(tip[2], base[2], 0.55), r * 0.8],
      [lerp(tip[2], base[2], 0.6), r * 1.3],
      [base[2], r * 1.9],
    ],
    n,
    { cx: tip[0], cy: tip[1], capStart: true, capEnd: true },
  );
}

/** Blade antenna: small swept fin; down = true hangs under the fuselage. */
export function blade(
  ctx: BuildContext,
  x: number,
  y: number,
  z: number,
  h: number,
  chord: number,
  down: boolean,
): void {
  if (ctx.lod !== 0) return;
  const b = ctx.body;
  b.style(PAINT.dark, 0x3b3e40, PANEL.plain);
  buildSurface(
    b,
    ctx.rig,
    {
      x,
      y: y + (down ? 0.02 : -0.02),
      vertical: true,
      angle: down ? 180 : 0,
      stations: [
        { s: 0, le: z - chord / 2, chord, t: 0.12 },
        { s: h, le: z - chord / 2 + h * 0.8, chord: chord * 0.45, t: 0.12 },
      ],
      part: PART.fuselage,
      bone: ROOT_BONE,
      mirror: false,
      k: 4,
      rootCap: false,
    },
    1,
  );
}

/** Store station: registers the hardpoint, a store bone, and builds the visible store. */
export function store(
  ctx: BuildContext,
  kind: HardpointKind,
  pos: Vec3,
  parentBone: number,
  internal: boolean,
  index: number,
): void {
  const bone = ctx.rig.add({ role: 'store', pivot: [...pos], parent: parentBone, param: index });
  ctx.meta.hardpoints.push({ position: [...pos], kind, internal });
  if (internal) return;
  const b = ctx.body;
  const v0 = b.vertexCount;
  b.bone = bone;
  b.part = PART.fuselage;
  buildOrdnance(b, kind, ctx.lod);
  b.translate(v0, pos[0], pos[1], pos[2]);
  b.bone = ROOT_BONE;
}

/**
 * Pylon from a store's top up to `topY` (inside the wing/fuselage) with a dark launch rail for missiles.
 * The store hangs below at `pos`.
 */
export function pylon(
  ctx: BuildContext,
  kind: HardpointKind,
  pos: Vec3,
  topY: number,
  bone: number,
  opts: { chord?: number; rail?: boolean; side?: boolean } = {},
): void {
  const b = ctx.body;
  const r = ORDNANCE_SIZE[kind].radius;
  const rail = opts.rail ?? (kind === 'srm' || kind === 'mrm' || kind === 'lraam');
  const bottom = pos[1] + r + (rail ? 0.07 : 0.015);
  const chord = opts.chord ?? Math.min(ORDNANCE_SIZE[kind].length * 0.55, 2.1);
  b.part = pos[0] > 0.3 ? PART.wingR : pos[0] < -0.3 ? PART.wingL : PART.fuselage;
  b.style(PAINT.livery, 0xffffff, PANEL.plain);
  const h = topY - bottom;
  if (h > 0.02) {
    buildSurface(
      b,
      ctx.rig,
      {
        x: pos[0],
        y: bottom,
        vertical: true,
        angle: 0,
        stations: [
          { s: 0, le: pos[2] - chord * 0.5, chord, t: 0.085 },
          { s: h + 0.05, le: pos[2] - chord * 0.5 - 0.1, chord: chord * 1.1, t: 0.08 },
        ],
        part: b.part,
        bone,
        mirror: false,
        k: ctx.lod === 0 ? 6 : 3,
        tipCap: false,
      },
      ctx.lod === 0 ? 0 : 1,
    );
  }
  if (rail) {
    b.style(PAINT.dark, 0x404346, PANEL.plain);
    b.bone = bone;
    const sec = makeSection();
    const len = Math.min(ORDNANCE_SIZE[kind].length * 0.7, 2.6);
    loft(b, {
      zs: [pos[2] - len / 2, pos[2] - len / 2 + 0.08, pos[2] + len / 2 - 0.05, pos[2] + len / 2],
      nU: ctx.lod === 0 ? 8 : 4,
      ring: (z, out) => {
        const u = (z - (pos[2] - len / 2)) / len;
        const k = Math.min(u / 0.03, (1 - u) / 0.02, 1);
        sec.cx = pos[0];
        sec.cy = pos[1] + r + 0.04;
        sec.wl = sec.wr = 0.045 * (0.6 + 0.4 * k);
        sec.ht = 0.035;
        sec.hb = 0.035 * (0.5 + 0.5 * k);
        sec.nTL = sec.nTR = sec.nBL = sec.nBR = 4;
        const n = ctx.lod === 0 ? 8 : 4;
        for (let j = 0; j < n; j++) sectionPoint(sec, (j + 0.5) / n, out, j * 2);
      },
      capStart: 'flat',
      capEnd: 'flat',
      uv: 'none',
    });
    b.bone = ROOT_BONE;
  }
}

/** Nav and anti-collision lights (built once per jet type). */
export function light(
  ctx: BuildContext,
  pos: Vec3,
  kind: 'red' | 'green' | 'white' | 'strobe' | 'beacon',
  part: number,
  bone: number,
): void {
  if (ctx.lod !== 0) return;
  const col: Record<typeof kind, [number, number, number]> = {
    red: [1, 0.06, 0.03],
    green: [0.1, 1, 0.3],
    white: [1, 0.95, 0.85],
    strobe: [0.95, 0.97, 1],
    beacon: [1, 0.1, 0.05],
  };
  const fxKind = kind === 'strobe' ? FX.strobe : kind === 'beacon' ? FX.beacon : FX.nav;
  const size = kind === 'strobe' ? 0.22 : kind === 'beacon' ? 0.2 : 0.14;
  ctx.fx.light(pos, fxKind, col[kind], size, part, bone);
}

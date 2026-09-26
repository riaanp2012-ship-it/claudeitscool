import { gridSurface, PAINT, PANEL, PART } from '../builder';
import { blade, canopy, gear, intake, pilot, rectNozzle, store } from '../components';
import type { JetDesign } from '../airframe';
import type { BuildContext } from '../context';
import { ROOT_BONE, type Vec3 } from '../rig';
import { loft, makeSection, Profile, sectionPoint, sym, type RingFn } from '../shapes';
import { buildSurface, type SurfaceDef } from '../surfaces';
import { bay, capsule, facetRing, gunPort, lightsAt, markings, skin, surfaceCapsules } from './common';

const DEG = Math.PI / 180;

/**
 * X-50 Nightjar: low-observable air-dominance fighter. Chined, faceted fuselage (flat panels, hard edges),
 * frameless gold-tinted canopy, caret intakes, diamond wing with aligned edges, outward-canted twin tails,
 * all-moving stabilators, two-dimensional nozzles and closed internal bay doors with sawtooth edges.
 */
const fuselage = new Profile([
  { z: 0.02, s: sym(-0.05, 0.03, 0.02, 0.02, 1.7, 1.7) },
  { z: 0.6, s: sym(-0.05, 0.22, 0.15, 0.13, 1.7, 1.7) },
  { z: 1.6, s: sym(-0.03, 0.46, 0.32, 0.26, 1.7, 1.7) },
  { z: 2.8, s: sym(0.0, 0.66, 0.46, 0.38, 1.7, 1.7) },
  { z: 4.0, s: sym(0.04, 0.8, 0.56, 0.46, 1.7, 1.7) },
  { z: 5.5, s: sym(0.04, 0.98, 0.6, 0.54, 1.7, 1.7) },
  { z: 7.0, s: sym(0.02, 1.45, 0.62, 0.6, 1.8, 1.8) },
  { z: 9.0, s: sym(0.0, 1.6, 0.62, 0.6, 1.8, 1.8) },
  { z: 12.0, s: sym(0.0, 1.6, 0.56, 0.55, 1.8, 1.8) },
  { z: 14.5, s: sym(0.0, 1.45, 0.42, 0.45, 1.8, 1.8) },
  { z: 16.4, s: sym(0.0, 1.25, 0.34, 0.36, 1.8, 1.8) },
  { z: 17.0, s: sym(0.0, 1.15, 0.24, 0.28, 1.8, 1.8) },
]);

const CORNERS = [0, 0.08, 0.25, 0.42, 0.5, 0.58, 0.75, 0.92];

const WING_Y = 0.05;

const wing: SurfaceDef = {
  x: 1.1,
  y: WING_Y,
  angle: -3,
  stations: [
    { s: 0, le: 8.4, chord: 7.2, t: 0.04 },
    { s: 5.7, le: 8.4 + 5.7 * Math.tan(42 * DEG), chord: 0.95, t: 0.035, twist: -1.5 },
  ],
  controls: [
    { role: 'flap', s0: 0.5, s1: 2.9, hinge: 0.8, max: 30 },
    { role: 'aileron', s0: 3.0, s1: 5.2, hinge: 0.8, max: 22 },
  ],
  detach: 3.0,
  part: PART.wingR,
  bone: ROOT_BONE,
  mirror: true,
  k: 12,
};

const fin: SurfaceDef = {
  x: 1.55,
  y: 0.35,
  vertical: true,
  angle: 28,
  stations: [
    { s: 0, le: 13.3, chord: 3.5, t: 0.04 },
    { s: 2.9, le: 13.3 + 2.9 * Math.tan(42 * DEG), chord: 1.25, t: 0.035 },
  ],
  controls: [{ role: 'rudder', s0: 0.3, s1: 2.6, hinge: 0.72, max: 25, brake: true }],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 10,
};

const stab: SurfaceDef = {
  x: 1.35,
  y: -0.05,
  angle: 0,
  stations: [
    { s: 0, le: 15.6, chord: 3.0, t: 0.04 },
    { s: 2.7, le: 15.6 + 2.7 * Math.tan(42 * DEG), chord: 0.85, t: 0.035 },
  ],
  allMoving: { role: 'stab', pivot: 0.45, max: 22 },
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 10,
};

/** Closed bay door lying on a facet between ring indices j0..j1, with sawtooth fore/aft edges. */
function facetDoor(
  ctx: BuildContext,
  ring: RingFn,
  nU: number,
  z0: number,
  z1: number,
  j0: number,
  j1: number,
): void {
  if (ctx.lod !== 0) return;
  const b = ctx.body;
  b.bone = ROOT_BONE;
  b.part = PART.fuselage;
  b.style(PAINT.livery, 0xffffff, PANEL.plain);
  const out = new Float64Array(nU * 2);
  const nI = 5;
  const nJ = 9;
  const P = new Float64Array(nI * nJ * 3);
  for (let i = 0; i < nI; i++) {
    for (let j = 0; j < nJ; j++) {
      const edge = i === 0 ? 1 : i === nI - 1 ? -1 : 0;
      const z = z0 + ((z1 - z0) * i) / (nI - 1) + (j % 2 === 1 ? 0.14 * edge : 0);
      ring(z, out);
      const f = j0 + ((j1 - j0) * j) / (nJ - 1);
      const a = Math.floor(f);
      const t = f - a;
      const x0 = out[a * 2]!;
      const y0 = out[a * 2 + 1]!;
      const x1 = out[((a + 1) % nU) * 2]!;
      const y1 = out[((a + 1) % nU) * 2 + 1]!;
      // outward offset from the facet normal (ring runs clockwise: outward = tangent turned CCW)
      const tx = x1 - x0;
      const ty = y1 - y0;
      const l = Math.hypot(tx, ty) || 1;
      const o = (i * nJ + j) * 3;
      P[o] = x0 + tx * t - (ty / l) * 0.007;
      P[o + 1] = y0 + ty * t + (tx / l) * 0.007;
      P[o + 2] = z;
    }
  }
  gridSurface(b, P, nI, nJ);
}

function build(ctx: BuildContext): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const tail = rig.add({ role: 'tail', pivot: [0, 0.5, 15.0] });
  const per = ctx.lod === 0 ? 5 : 2;
  const nU = CORNERS.length * per;
  const ring = facetRing(fuselage, CORNERS, per);
  skin(ctx, fuselage, 0.02, 17.0, {
    nU: CORNERS.length * 5,
    ring: () => ring,
    creases: () => CORNERS.map((_, c) => c * per),
    fine: 0.6,
  });
  // engine casings between the tail booms, feeding the 2D nozzles
  const sec = makeSection();
  b.style(PAINT.livery, 0xffffff, PANEL.body);
  b.part = PART.engine;
  const cv0 = b.vertexCount;
  const ci0 = b.idx.length;
  const cn = ctx.lod === 0 ? 16 : 8;
  loft(b, {
    zs: [15.6, 16.4, 17.0],
    nU: cn,
    ring: (z, out) => {
      const u = (z - 15.6) / 1.4;
      sec.cx = 0.62;
      sec.cy = 0.0;
      sec.wl = sec.wr = 0.5 - 0.04 * u;
      sec.ht = 0.38 - 0.05 * u;
      sec.hb = 0.36 - 0.03 * u;
      sec.nTL = sec.nTR = sec.nBL = sec.nBR = 4;
      for (let j = 0; j < cn; j++) sectionPoint(sec, j / cn, out, j * 2);
    },
    creases: [],
  });
  b.mirror(cv0, ci0, rig.mirrorFn, (p) => p);
  intake(ctx, {
    z0: 5.8,
    z1: 9.6,
    lip: {
      cx: 1.18,
      cy: -0.14,
      wl: 0.36,
      wr: 0.4,
      ht: 0.46,
      hb: 0.44,
      nTL: 1.35,
      nTR: 1.35,
      nBL: 1.35,
      nBR: 1.35,
    },
    end: {
      cx: 0.95,
      cy: -0.1,
      wl: 0.32,
      wr: 0.34,
      ht: 0.38,
      hb: 0.38,
      nTL: 1.8,
      nTR: 1.8,
      nBL: 1.8,
      nBR: 1.8,
    },
    rakeX: 0.42,
    rakeY: 0.3,
    wall: 0.03,
    depth: 2.4,
    fan: { cx: 0.9, cy: -0.1, wl: 0.3, wr: 0.3, ht: 0.3, hb: 0.3, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    mirror: true,
    sharp: true,
    nU: 24,
    lipDark: false,
  });
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  const w = buildSurface(b, rig, wing, ctx.lod);
  const tipR = w.detachBone;
  const tipL = rig.mirror(tipR);
  buildSurface(b, rig, { ...fin, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...stab, bone: tail }, ctx.lod);
  rectNozzle(ctx, { x: 0.62, y: 0.0, z0: 16.95, z1: 17.95, hw: 0.4, hh: 0.26, mirror: true, index: 0 });
  canopy(ctx, {
    zFront: 3.1,
    zBow: 3.7,
    zRear: 6.6,
    bows: [],
    height: [
      [3.1, 0],
      [3.4, 0.3],
      [3.7, 0.46],
      [4.4, 0.6],
      [5.2, 0.58],
      [6.0, 0.38],
      [6.6, 0.04],
    ],
    sillT: 0.08,
    n: 2,
    frameless: true,
    tint: 0xcbb98a,
    maxOpen: 40,
  });
  const eye: Vec3 = [0, 1.1, 4.6];
  pilot(ctx, eye, { z: 3.75, w: 0.28, y: 0.63 });
  ctx.meta.cockpitEye = eye;
  gear(ctx, {
    pivot: [0, -0.2, 4.2],
    length: 1.71,
    wheelR: 0.28,
    wheelW: 0.15,
    axis: [1, 0, 0],
    angle: -90,
    mirror: false,
    strutR: 0.055,
    rake: 3,
    doors: [{ z0: 4.15, z1: 5.95, t0: 0.465, t1: 0.499, angle: 88 }],
  });
  gear(ctx, {
    pivot: [1.2, -0.05, 11.6],
    length: 1.74,
    wheelR: 0.4,
    wheelW: 0.22,
    axis: [1, 0, 0],
    angle: 88,
    mirror: true,
    strutR: 0.075,
    doors: [{ z0: 9.95, z1: 11.7, t0: 0.36, t1: 0.42, angle: 95 }],
  });
  // closed internal bays: main bay (two doors) and side bays in the intake trunks
  facetDoor(ctx, ring, nU, 7.9, 11.6, 3 * per + 0.15 * per, 4 * per);
  facetDoor(ctx, ring, nU, 7.9, 11.6, 4 * per, 5 * per - 0.15 * per);
  facetDoor(ctx, ring, nU, 6.5, 8.3, 2 * per + 0.25 * per, 3 * per - 0.1 * per);
  facetDoor(ctx, ring, nU, 6.5, 8.3, 5 * per + 0.1 * per, 6 * per - 0.25 * per);
  blade(ctx, 0, 0.56, 9.0, 0.12, 0.3, false);
  gunPort(ctx, [1.22, 0.36, 8.3], 0.03, 0.2);
  // internal stores (hidden): side-bay SRMs, main-bay MRMs
  store(ctx, 'srm', [-1.25, -0.3, 7.4], ROOT_BONE, true, 0);
  store(ctx, 'srm', [1.25, -0.3, 7.4], ROOT_BONE, true, 1);
  store(ctx, 'mrm', [-0.28, -0.3, 9.6], ROOT_BONE, true, 2);
  store(ctx, 'mrm', [0.28, -0.3, 9.6], ROOT_BONE, true, 3);
  store(ctx, 'mrm', [-0.72, -0.25, 9.9], ROOT_BONE, true, 4);
  store(ctx, 'mrm', [0.72, -0.25, 9.9], ROOT_BONE, true, 5);
  const tipX = wing.x + 5.7 * Math.cos(3 * DEG);
  lightsAt(ctx, [tipX - 0.05, WING_Y - 0.3, 13.7], tipR, tipL, [2.9, 2.9, 16.9], tail, [[0, -0.5, 11.0]]);
  ctx.meta.wingtips = [
    [-tipX, WING_Y - 0.3, 14.4],
    [tipX, WING_Y - 0.3, 14.4],
  ];
  ctx.meta.radomeZ = 2.6;
  ctx.meta.antiGlare = [0, 0, 0, 0];
  capsule(ctx, 'fuselage', [0, 0, 1.4], [0, 0, 16.5], 0.6);
  capsule(ctx, 'cockpit', [0, 0.68, 3.5], [0, 0.8, 6.2], 0.42);
  capsule(ctx, 'engine', [0, 0, 13.0], [0, 0, 17.8], 0.7);
  surfaceCapsules(ctx, wing, 'wingR', true, 0.3);
  surfaceCapsules(ctx, fin, 'tail', true, 0.2);
  surfaceCapsules(ctx, stab, 'tail', true, 0.2);
  markings(ctx, {
    wingInsignia: [4.3, WING_Y - 0.1, 13.2],
    wingInsigniaSize: 0.42,
    bodyInsignia: [1.6, 0.0, 10.4],
    bodyInsigniaSize: 0.26,
    fins: [
      { center: [2.25, 1.6, 14.9], face: 'right' },
      { center: [-2.25, 1.6, 14.9], face: 'left' },
    ],
    finNumberH: 0.3,
    nose: [0.62, 0.02, 2.6],
    rescue: [0.8, 0.4, 6.4],
    danger: null,
    noStep: [2.3, WING_Y, 13.6],
    flash: null,
  });
  bay(ctx, 'bottom', [0, -0.45, 5.05], 0.1, 0.9);
  bay(ctx, 'bottom', [1.2, -0.5, 10.82], 0.2, 0.85);
  bay(ctx, 'bottom', [-1.2, -0.5, 10.82], 0.2, 0.85);
  bay(ctx, 'top', [0, 0.65, 4.8], 0.36, 1.4);
}

export const nightjar: JetDesign = { id: 'nightjar', cgZ: 11.0, fuselage, build };

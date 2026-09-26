import { PAINT, PANEL, PART } from '../builder';
import { blade, canopy, gear, intake, pilot, pitot, pylon, roundNozzle, store } from '../components';
import type { JetDesign } from '../airframe';
import type { BuildContext } from '../context';
import { ROOT_BONE, type Vec3 } from '../rig';
import {
  loft,
  makeSection,
  Profile,
  sectionPoint,
  stationList,
  superRing,
  sym,
  type Section,
} from '../shapes';
import { buildSurface, type SurfaceDef } from '../surfaces';
import {
  airbrakePanel,
  bay,
  capsule,
  gunPort,
  lightsAt,
  markings,
  skin,
  surfaceCapsules,
  wingStore,
} from './common';

const DEG = Math.PI / 180;

/**
 * Kv-40 Borzoi: heavy interceptor. Long drooped nose, big blended LERX, widely spaced nacelles with a
 * tunnel between them, raked ventral intakes under the LERX, swept wing with tip rails, twin fins on the
 * nacelles, ventral fins and a long tail stinger between the nozzles.
 */
const fuselage = new Profile([
  { z: 0.5, s: sym(-0.3, 0.03, 0.03, 0.03) },
  { z: 1.0, s: sym(-0.26, 0.17, 0.17, 0.18) },
  { z: 2.0, s: sym(-0.18, 0.33, 0.34, 0.35) },
  { z: 3.2, s: sym(-0.08, 0.45, 0.47, 0.48, 2.2, 2.2) },
  { z: 4.4, s: sym(0.0, 0.52, 0.55, 0.55, 2.8, 2.4) },
  { z: 5.6, s: sym(0.02, 0.56, 0.58, 0.58, 3.0, 2.5) },
  { z: 7.0, s: sym(0.02, 0.66, 0.66, 0.56, 2.6, 2.5) },
  { z: 9.0, s: sym(0.05, 0.82, 0.62, 0.42, 2.6, 2.6) },
  { z: 12.0, s: sym(0.1, 0.96, 0.52, 0.35, 3.0, 2.8) },
  { z: 16.0, s: sym(0.1, 0.96, 0.46, 0.32, 3.2, 3.0) },
  { z: 19.0, s: sym(0.1, 0.62, 0.36, 0.3, 2.5, 2.5) },
  { z: 20.5, s: sym(0.08, 0.3, 0.27, 0.25) },
  { z: 21.97, s: sym(0.06, 0.07, 0.07, 0.07) },
]);

const NX = 1.25;

function nacelleSection(z: number): Section {
  const u = Math.min(Math.max((z - 11.5) / 8.1, 0), 1);
  const n = 3.5 - 1.3 * u;
  return {
    cx: NX,
    cy: -0.5 + 0.12 * u,
    wl: 0.58 + 0.04 * u,
    wr: 0.58 + 0.04 * u,
    ht: 0.58 + 0.04 * u,
    hb: 0.55 + 0.07 * u,
    nTL: n,
    nTR: n,
    nBL: n,
    nBR: n,
  };
}

const nacelle = new Profile([11.5, 14, 17, 19.6].map((z) => ({ z, s: nacelleSection(z) })));

const WING_Y = 0.05;

const wing: SurfaceDef = {
  x: 1.6,
  y: WING_Y,
  angle: -2,
  stations: [
    { s: 0, le: 11.2, chord: 5.0, t: 0.045 },
    { s: 5.7, le: 11.2 + 5.7 * Math.tan(42 * DEG), chord: 1.35, t: 0.035, twist: -2 },
  ],
  controls: [
    { role: 'flap', s0: 0.3, s1: 3.0, hinge: 0.78, max: 30 },
    { role: 'aileron', s0: 3.0, s1: 5.4, hinge: 0.76, max: 22 },
  ],
  detach: 3.0,
  part: PART.wingR,
  bone: ROOT_BONE,
  mirror: true,
  k: 11,
};

const lerx: SurfaceDef = {
  x: 0.5,
  y: 0.06,
  angle: 0,
  stations: [
    { s: 0, le: 5.3, chord: 7.6, t: 0.022 },
    { s: 0.9, le: 7.6, chord: 5.4, t: 0.025 },
    { s: 1.62, le: 10.9, chord: 2.6, t: 0.03 },
  ],
  part: PART.fuselage,
  bone: ROOT_BONE,
  mirror: true,
  k: 8,
};

const fin: SurfaceDef = {
  x: 1.9,
  y: 0.08,
  vertical: true,
  angle: 0,
  stations: [
    { s: 0, le: 16.2, chord: 3.4, t: 0.045 },
    { s: 3.43, le: 16.2 + 3.43 * Math.tan(42 * DEG), chord: 1.1, t: 0.04 },
  ],
  controls: [{ role: 'rudder', s0: 0.4, s1: 3.0, hinge: 0.72, max: 25 }],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 10,
};

const ventral: SurfaceDef = {
  x: 1.55,
  y: -0.98,
  vertical: true,
  angle: 172,
  stations: [
    { s: 0, le: 16.9, chord: 1.4, t: 0.06 },
    { s: 0.55, le: 17.45, chord: 0.8, t: 0.06 },
  ],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 6,
  rootCap: false,
};

const stab: SurfaceDef = {
  x: 1.95,
  y: -0.4,
  angle: -2,
  stations: [
    { s: 0, le: 18.3, chord: 2.9, t: 0.045 },
    { s: 2.5, le: 18.3 + 2.5 * Math.tan(45 * DEG), chord: 1.0, t: 0.04 },
  ],
  allMoving: { role: 'stab', pivot: 0.42, max: 20 },
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 10,
};

function build(ctx: BuildContext): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const tail = rig.add({ role: 'tail', pivot: [0, 0.5, 18.0] });
  skin(ctx, fuselage, 0.5, 21.97, { nU: 32, capEnd: 'point' });
  // intakes under the LERX feed the nacelles
  const lip: Section = {
    cx: NX,
    cy: -0.56,
    wl: 0.46,
    wr: 0.46,
    ht: 0.5,
    hb: 0.44,
    nTL: 6,
    nTR: 6,
    nBL: 6,
    nBR: 6,
  };
  intake(ctx, {
    z0: 7.6,
    z1: 11.5,
    lip,
    end: nacelleSection(11.5),
    rakeX: 0.12,
    rakeY: -0.45,
    wall: 0.04,
    depth: 2.4,
    fan: { cx: NX, cy: -0.5, wl: 0.4, wr: 0.4, ht: 0.4, hb: 0.4, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    mirror: true,
    sharp: false,
    nU: 24,
  });
  // nacelle body from the intake trunk to the nozzle
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  b.style(PAINT.livery, 0xffffff, PANEL.body);
  b.part = PART.engine;
  const nU = ctx.lod === 0 ? 28 : 10;
  loft(b, {
    zs: stationList(11.5, 19.6, ctx.lod === 0 ? 0.4 : 2.0),
    nU,
    ring: superRing(nacelle, nU),
  });
  b.mirror(v0, i0, rig.mirrorFn, (p) => p);
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  buildSurface(b, rig, lerx, ctx.lod);
  const w = buildSurface(b, rig, wing, ctx.lod);
  const tipR = w.detachBone;
  const tipL = rig.mirror(tipR);
  buildSurface(b, rig, { ...fin, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...ventral, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...stab, bone: tail }, ctx.lod);
  // wingtip launch rails
  const tipX = wing.x + 5.7;
  b.bone = tipR;
  b.part = PART.wingR;
  b.style(PAINT.livery, 0xffffff, PANEL.plain);
  const r0 = b.vertexCount;
  const ri0 = b.idx.length;
  const sec = makeSection();
  const rn = ctx.lod === 0 ? 10 : 6;
  loft(b, {
    zs: stationList(16.0, 18.4, ctx.lod === 0 ? 0.3 : 1.2, ctx.lod === 0 ? 0.06 : 0.6, 0.2, 0.12),
    nU: rn,
    ring: (z, out) => {
      const u = (z - 16.0) / 2.4;
      const k = Math.min(Math.sqrt(Math.min(u / 0.1, 1)), Math.sqrt(Math.min((1 - u) / 0.06, 1)));
      sec.cx = tipX + 0.03;
      sec.cy = WING_Y - 0.2 - 0.04;
      sec.wl = sec.wr = 0.045 * Math.max(k, 0.15);
      sec.ht = 0.05 * Math.max(k, 0.15);
      sec.hb = 0.07 * Math.max(k, 0.15);
      sec.nTL = sec.nTR = sec.nBL = sec.nBR = 2.6;
      for (let j = 0; j < rn; j++) sectionPoint(sec, j / rn, out, j * 2);
    },
    uv: 'none',
    capStart: 'point',
    capEnd: 'point',
  });
  b.mirror(r0, ri0, rig.mirrorFn, (p) => (p === PART.wingR ? PART.wingL : p));
  b.bone = ROOT_BONE;
  roundNozzle(ctx, {
    x: NX,
    y: -0.38,
    z0: 19.6,
    r0: 0.62,
    z1: 20.9,
    r1: 0.56,
    petals: 18,
    mirror: true,
    index: 0,
  });
  canopy(ctx, {
    zFront: 3.8,
    zBow: 4.3,
    zRear: 6.7,
    bows: [],
    height: [
      [3.8, 0],
      [4.1, 0.28],
      [4.3, 0.44],
      [5.0, 0.62],
      [5.7, 0.64],
      [6.3, 0.45],
      [6.7, 0.05],
    ],
    sillT: 0.115,
    n: 2.1,
    tint: 0xbcc2bd,
    maxOpen: 40,
  });
  const eye: Vec3 = [0, 0.9, 5.1];
  pilot(ctx, eye, { z: 4.35, w: 0.28, y: 0.53 });
  ctx.meta.cockpitEye = eye;
  pitot(ctx, [0, -0.3, 0.58], [0, -0.3, 0], 0.018);
  gear(ctx, {
    pivot: [0, -0.15, 5.0],
    length: 1.92,
    wheelR: 0.33,
    wheelW: 0.16,
    twin: true,
    axis: [1, 0, 0],
    angle: 90,
    mirror: false,
    strutR: 0.06,
    rake: -3,
    doors: [{ z0: 3.0, z1: 5.05, t0: 0.46, t1: 0.499, angle: 88 }],
  });
  gear(ctx, {
    pivot: [NX, -0.55, 14.0],
    length: 1.39,
    wheelR: 0.46,
    wheelW: 0.26,
    axis: [1, 0, 0],
    angle: 90,
    mirror: true,
    strutR: 0.085,
    doors: [{ z0: 12.3, z1: 14.05, t0: 0.47, t1: 0.53, angle: 70, profile: nacelle }],
  });
  airbrakePanel(ctx, fuselage, { z0: 7.2, z1: 8.8, t0: 0.955, t1: 1.045, dir: -1, max: 45 });
  blade(ctx, 0, 0.68, 10.0, 0.22, 0.32, false);
  blade(ctx, 0, -0.2, 13.0, 0.18, 0.28, true);
  gunPort(ctx, [0.98, 0.14, 8.1], 0.042, 0.35);
  // stores: tip SRMs, underwing MRMs, tandem LRAAMs in the tunnel
  store(ctx, 'srm', [-(tipX + 0.03), WING_Y - 0.4, 17.1], tipL, false, 0);
  store(ctx, 'srm', [tipX + 0.03, WING_Y - 0.4, 17.1], tipR, false, 1);
  wingStore(ctx, wing, 2.3, 14.4, 0.34, 'mrm', [2, 3]);
  for (const [i, z] of [
    [4, 10.9],
    [5, 15.1],
  ] as const) {
    const pos: Vec3 = [0, -0.72, z];
    pylon(ctx, 'lraam', pos, -0.2, ROOT_BONE, { chord: 1.6 });
    store(ctx, 'lraam', pos, ROOT_BONE, false, i);
  }
  lightsAt(ctx, [tipX + 0.03, WING_Y - 0.2, 15.95], tipR, tipL, [1.9, 3.55, 19.6], tail, [
    [0, 0.74, 9.5],
    [0, -0.22, 12.4],
  ]);
  ctx.meta.wingtips = [
    [-tipX, WING_Y - 0.2, 17.9],
    [tipX, WING_Y - 0.2, 17.9],
  ];
  ctx.meta.radomeZ = 3.1;
  ctx.meta.antiGlare = [3.0, 3.8, 0.34, 0.25];
  capsule(ctx, 'fuselage', [0, 0, 1.4], [0, 0, 20.5], 0.62);
  capsule(ctx, 'cockpit', [0, 0.62, 4.1], [0, 0.78, 6.5], 0.4);
  capsule(ctx, 'engine', [NX, -0.45, 9.0], [NX, -0.4, 20.8], 0.62);
  capsule(ctx, 'engine', [-NX, -0.45, 9.0], [-NX, -0.4, 20.8], 0.62);
  surfaceCapsules(ctx, wing, 'wingR', true, 0.3);
  surfaceCapsules(ctx, fin, 'tail', true, 0.2);
  surfaceCapsules(ctx, stab, 'tail', true, 0.2);
  markings(ctx, {
    wingInsignia: [5.4, WING_Y - 0.02, 15.6],
    wingInsigniaSize: 0.6,
    bodyInsignia: [1.82, -0.4, 13.2],
    bodyInsigniaSize: 0.38,
    fins: [
      { center: [1.95, 2.0, 17.8], face: 'right' },
      { center: [-1.95, 2.0, 17.8], face: 'left' },
    ],
    finNumberH: 0.4,
    nose: [0.47, -0.15, 3.2],
    rescue: [0.58, 0.36, 6.9],
    danger: [1.72, -0.35, 8.1],
    noStep: [3.0, WING_Y + 0.05, 15.6],
    flash: { z0: 18.4, z1: 20.4, y0: 3.05, y1: 3.5 },
  });
  bay(ctx, 'bottom', [0, -0.5, 4.0], 0.1, 1.0);
  bay(ctx, 'bottom', [NX, -1.05, 13.07], 0.24, 0.95);
  bay(ctx, 'bottom', [-NX, -1.05, 13.07], 0.24, 0.95);
  bay(ctx, 'top', [0, 0.6, 5.3], 0.38, 1.35);
}

export const borzoi: JetDesign = { id: 'borzoi', cgZ: 14.0, fuselage, build };

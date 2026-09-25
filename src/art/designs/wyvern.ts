import { PAINT, PANEL, PART } from '../builder';
import { blade, canopy, gear, intake, pilot, pitot, pylon, roundNozzle, store } from '../components';
import type { JetDesign } from '../airframe';
import type { BuildContext } from '../context';
import { ROOT_BONE, type Vec3 } from '../rig';
import { loft, makeSection, Profile, sectionPoint, stationList, sym } from '../shapes';
import { buildSurface, skinPoint, type SurfaceDef } from '../surfaces';
import {
  airbrakePanel,
  bay,
  capsule,
  casing,
  gunPort,
  lightsAt,
  markings,
  skin,
  surfaceCapsules,
  wingStore,
} from './common';

const DEG = Math.PI / 180;

/**
 * MR-31 Wyvern: canard-delta multirole. Slender drooping nose, blended canopy, all-moving canards just aft
 * of the cockpit, split ventral intake with a protruding lower lip, cranked delta with elevons, single fin,
 * twin nozzles close together.
 */
const fuselage = new Profile([
  { z: 0.55, s: sym(-0.06, 0.028, 0.028, 0.028) },
  { z: 0.9, s: sym(-0.05, 0.14, 0.14, 0.15) },
  { z: 1.6, s: sym(-0.03, 0.27, 0.28, 0.3) },
  { z: 2.6, s: sym(0.0, 0.38, 0.42, 0.42, 2.2, 2.3) },
  { z: 3.4, s: sym(0.04, 0.43, 0.47, 0.5, 2.8, 2.4) },
  { z: 4.4, s: sym(0.05, 0.47, 0.48, 0.58, 3.0, 2.6) },
  { z: 5.5, s: sym(0.05, 0.53, 0.57, 0.62, 2.6, 2.8) },
  { z: 7.0, s: sym(0.0, 0.64, 0.55, 0.62, 2.6, 3.0) },
  { z: 9.0, s: sym(0.0, 0.8, 0.5, 0.58, 2.7, 3.0) },
  { z: 11.5, s: sym(0.0, 0.88, 0.48, 0.52, 2.8, 2.8) },
  { z: 13.5, s: sym(0.0, 0.85, 0.44, 0.46, 2.6, 2.6) },
  { z: 14.25, s: sym(0.0, 0.8, 0.3, 0.3, 2.4, 2.4) },
]);

const WING_Y = -0.12;

const wing: SurfaceDef = {
  x: 0.55,
  y: WING_Y,
  angle: -1.5,
  stations: [
    { s: 0, le: 6.3, chord: 7.0, t: 0.045 },
    { s: 1.7, le: 6.3 + 1.7 * Math.tan(56 * DEG), chord: 4.48, t: 0.04 },
    {
      s: 4.9,
      le: 6.3 + 1.7 * Math.tan(56 * DEG) + 3.2 * Math.tan(48 * DEG),
      chord: 0.9,
      t: 0.035,
      twist: -1.5,
    },
  ],
  controls: [
    { role: 'elevon', s0: 0.35, s1: 2.3, hinge: 0.8, max: 25 },
    { role: 'elevon', s0: 2.4, s1: 4.7, hinge: 0.78, max: 25 },
  ],
  detach: 2.35,
  part: PART.wingR,
  bone: ROOT_BONE,
  mirror: true,
  k: 12,
};

const canard: SurfaceDef = {
  x: 0.45,
  y: 0.28,
  angle: 4,
  stations: [
    { s: 0, le: 4.55, chord: 1.45, t: 0.05 },
    { s: 1.35, le: 4.55 + 1.35 * Math.tan(52 * DEG), chord: 0.5, t: 0.045 },
  ],
  allMoving: { role: 'canard', pivot: 0.45, max: 22 },
  part: PART.fuselage,
  bone: ROOT_BONE,
  mirror: true,
  k: 8,
};

const fin: SurfaceDef = {
  x: 0,
  y: 0.45,
  vertical: true,
  angle: 0,
  stations: [
    { s: 0, le: 10.5, chord: 3.6, t: 0.05 },
    { s: 2.95, le: 10.5 + 2.95 * Math.tan(50 * DEG), chord: 1.15, t: 0.045 },
  ],
  controls: [{ role: 'rudder', s0: 0.35, s1: 2.6, hinge: 0.74, max: 25 }],
  part: PART.tail,
  bone: 0,
  mirror: false,
  k: 10,
};

function build(ctx: BuildContext): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const tail = rig.add({ role: 'tail', pivot: [0, 0.5, 11.5] });
  skin(ctx, fuselage, 0.55, 14.25, { nU: 40 });
  casing(
    ctx,
    0.46,
    -0.04,
    [
      [12.0, 0.4],
      [13.2, 0.47],
      [14.25, 0.46],
    ],
    true,
  );
  // split ventral intake: two ducts either side of a central splitter, lower lip protruding
  intake(ctx, {
    z0: 4.6,
    z1: 8.5,
    lip: { cx: 0.31, cy: -0.63, wl: 0.24, wr: 0.3, ht: 0.26, hb: 0.3, nTL: 5, nTR: 3, nBL: 3, nBR: 2.2 },
    end: { cx: 0.28, cy: -0.3, wl: 0.2, wr: 0.24, ht: 0.24, hb: 0.24, nTL: 3, nTR: 3, nBL: 3, nBR: 3 },
    rakeX: 0,
    rakeY: 0.5,
    wall: 0.035,
    depth: 2.0,
    fan: { cx: 0.26, cy: -0.4, wl: 0.18, wr: 0.18, ht: 0.18, hb: 0.18, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    mirror: true,
  });
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  const w = buildSurface(b, rig, wing, ctx.lod);
  const tipR = w.detachBone;
  const tipL = rig.mirror(tipR);
  buildSurface(b, rig, canard, ctx.lod);
  buildSurface(b, rig, { ...fin, bone: tail }, ctx.lod);
  // wingtip electronic-warfare pods
  const tipX = wing.x + 4.9;
  b.bone = tipR;
  b.part = PART.wingR;
  b.style(PAINT.livery, 0xffffff, PANEL.plain);
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  const sec = makeSection();
  const n = ctx.lod === 0 ? 10 : 6;
  loft(b, {
    zs: stationList(11.75, 13.75, ctx.lod === 0 ? 0.25 : 1, ctx.lod === 0 ? 0.06 : 0.5, 0.25, 0.15),
    nU: n,
    ring: (z, out) => {
      const u = (z - 11.75) / 2.0;
      const k = Math.min(Math.sqrt(Math.min(u / 0.14, 1)), Math.sqrt(Math.min((1 - u) / 0.08, 1)));
      sec.cx = tipX + 0.02;
      sec.cy = WING_Y - 0.13;
      sec.wl = sec.wr = 0.07 * Math.max(k, 0.12);
      sec.ht = sec.hb = 0.07 * Math.max(k, 0.12);
      sec.nTL = sec.nTR = sec.nBL = sec.nBR = 2;
      for (let j = 0; j < n; j++) sectionPoint(sec, j / n, out, j * 2);
    },
    uv: 'none',
    capStart: 'point',
    capEnd: 'point',
  });
  b.mirror(v0, i0, rig.mirrorFn, (p) => (p === PART.wingR ? PART.wingL : p));
  b.bone = ROOT_BONE;
  roundNozzle(ctx, {
    x: 0.46,
    y: -0.04,
    z0: 14.25,
    r0: 0.46,
    z1: 15.28,
    r1: 0.4,
    petals: 16,
    mirror: true,
    index: 0,
  });
  canopy(ctx, {
    zFront: 2.95,
    zBow: 3.45,
    zRear: 5.6,
    bows: [],
    height: [
      [2.95, 0],
      [3.2, 0.24],
      [3.45, 0.4],
      [4.0, 0.53],
      [4.6, 0.52],
      [5.2, 0.34],
      [5.6, 0.04],
    ],
    sillT: 0.115,
    n: 2.3,
    tint: 0xc0c6c2,
    maxOpen: 38,
  });
  const eye: Vec3 = [0, 0.86, 4.05];
  pilot(ctx, eye, { z: 3.4, w: 0.25, y: 0.5 });
  ctx.meta.cockpitEye = eye;
  pitot(ctx, [0, -0.06, 0.62], [0, -0.06, 0], 0.017);
  gear(ctx, {
    pivot: [0, -0.1, 3.2],
    length: 1.56,
    wheelR: 0.24,
    wheelW: 0.13,
    axis: [1, 0, 0],
    angle: 90,
    mirror: false,
    strutR: 0.045,
    rake: -3,
    doors: [{ z0: 1.6, z1: 3.25, t0: 0.462, t1: 0.499, angle: 88 }],
  });
  gear(ctx, {
    pivot: [0.95, -0.15, 9.6],
    length: 1.42,
    wheelR: 0.33,
    wheelW: 0.19,
    axis: [1, 0, 0],
    angle: 88,
    mirror: true,
    strutR: 0.065,
    offset: 0.08,
    doors: [{ z0: 8.15, z1: 9.7, t0: 0.37, t1: 0.44, angle: 95 }],
  });
  airbrakePanel(ctx, fuselage, { z0: 5.7, z1: 6.9, t0: 0.955, t1: 1.045, dir: -1, max: 50 });
  blade(ctx, 0, 0.62, 7.6, 0.18, 0.28, false);
  blade(ctx, 0, -0.62, 10.0, 0.16, 0.26, true);
  gunPort(ctx, [0.76, -0.12, 6.7], 0.04, 0.3);
  // stores: outer and mid SRM pylons, semi-recessed MRMs, rocket pod left, laser bomb right
  wingStore(ctx, wing, 4.05, 11.9, 0.3, 'srm', [0, 1], [tipL, tipR]);
  wingStore(ctx, wing, 3.05, 11.1, 0.3, 'srm', [2, 3], [tipL, tipR]);
  for (const [i, sx] of [
    [4, -1],
    [5, 1],
  ] as const) {
    const pos: Vec3 = [sx * 0.5, -0.78, 9.8];
    pylon(ctx, 'mrm', pos, -0.55, ROOT_BONE, { chord: 1.1 });
    store(ctx, 'mrm', pos, ROOT_BONE, false, i);
  }
  const inner: Vec3 = [0, 0, 0];
  skinPoint(wing, 1.35, 0.45, -1, inner);
  const pod: Vec3 = [-inner[0], inner[1] - 0.45, 9.5];
  pylon(ctx, 'rocketPod', pod, inner[1] + 0.04, ROOT_BONE);
  store(ctx, 'rocketPod', pod, ROOT_BONE, false, 6);
  const bomb: Vec3 = [inner[0], inner[1] - 0.42, 9.6];
  pylon(ctx, 'bomb', bomb, inner[1] + 0.04, ROOT_BONE);
  store(ctx, 'bomb', bomb, ROOT_BONE, false, 7);
  lightsAt(ctx, [tipX + 0.02, WING_Y - 0.13, 11.72], tipR, tipL, [0, 3.35, 15.1], tail, [
    [0, 0.62, 8.4],
    [0, -0.64, 8.8],
  ]);
  ctx.meta.wingtips = [
    [-tipX, WING_Y - 0.1, 13.3],
    [tipX, WING_Y - 0.1, 13.3],
  ];
  ctx.meta.radomeZ = 2.3;
  ctx.meta.antiGlare = [2.3, 2.95, 0.26, 0.28];
  capsule(ctx, 'fuselage', [0, 0, 1.2], [0, 0, 13.6], 0.58);
  capsule(ctx, 'cockpit', [0, 0.62, 3.2], [0, 0.72, 5.3], 0.36);
  capsule(ctx, 'engine', [0, 0, 11.5], [0, 0, 15.0], 0.62);
  surfaceCapsules(ctx, wing, 'wingR', true, 0.3);
  surfaceCapsules(ctx, fin, 'tail', false, 0.2);
  markings(ctx, {
    wingInsignia: [3.9, WING_Y + 0.02, 11.6],
    wingInsigniaSize: 0.46,
    bodyInsignia: [0.7, 0.05, 8.3],
    bodyInsigniaSize: 0.3,
    fins: [
      { center: [0, 1.75, 12.7], face: 'right' },
      { center: [0, 1.75, 12.7], face: 'left' },
    ],
    finNumberH: 0.32,
    nose: [0.4, -0.05, 2.4],
    rescue: [0.46, 0.34, 5.0],
    danger: null,
    noStep: [1.9, WING_Y + 0.07, 11.9],
    flash: { z0: 12.6, z1: 15.1, y0: 3.0, y1: 3.4 },
  });
  bay(ctx, 'bottom', [0, -0.3, 2.42], 0.08, 0.8);
  bay(ctx, 'bottom', [0.95, -0.55, 8.92], 0.2, 0.75);
  bay(ctx, 'bottom', [-0.95, -0.55, 8.92], 0.2, 0.75);
  bay(ctx, 'top', [0, 0.52, 4.3], 0.32, 1.2);
}

export const wyvern: JetDesign = { id: 'wyvern', cgZ: 9.5, fuselage, build };

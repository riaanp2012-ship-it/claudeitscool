import { PAINT, PANEL, PART } from '../builder';
import { blade, canopy, gear, intake, pilot, pitot, pylon, roundNozzle, store } from '../components';
import type { JetDesign } from '../airframe';
import type { BuildContext } from '../context';
import { ROOT_BONE } from '../rig';
import { loft, makeSection, Profile, sectionPoint, stationList, superRing, sym } from '../shapes';
import { buildSurface, skinPoint, type SurfaceDef } from '../surfaces';
import { airbrakePanel, bay, capsule, gunPort, lightsAt, markings, surfaceCapsules } from './common';

/**
 * T/F-9 Kestrel: slim area-ruled single-engine trainer-fighter. Pointed nose, tandem bubble canopy,
 * D-shaped side intakes under small LERX, low trapezoid wing with tip rails, tall fin, all-moving stabs.
 */
const fuselage = new Profile([
  { z: 0.55, s: sym(-0.02, 0.028, 0.028, 0.028) },
  { z: 0.75, s: sym(-0.02, 0.1, 0.1, 0.1) },
  { z: 1.2, s: sym(-0.01, 0.2, 0.2, 0.21) },
  { z: 1.9, s: sym(0.01, 0.3, 0.31, 0.33, 2.1, 2.1) },
  { z: 2.6, s: sym(0.03, 0.38, 0.4, 0.4, 2.2, 2.3) },
  { z: 3.3, s: sym(0.04, 0.44, 0.46, 0.44, 2.6, 2.5) },
  { z: 4.2, s: sym(0.05, 0.47, 0.45, 0.47, 3.2, 2.6) },
  { z: 5.4, s: sym(0.05, 0.49, 0.46, 0.5, 3.2, 2.7) },
  { z: 6.4, s: sym(0.04, 0.52, 0.56, 0.52, 2.6, 2.8) },
  { z: 7.4, s: sym(0.02, 0.55, 0.62, 0.54, 2.5, 2.8) },
  { z: 8.4, s: sym(0.0, 0.57, 0.62, 0.55, 2.5, 2.8) },
  { z: 9.6, s: sym(0.0, 0.56, 0.6, 0.54, 2.4, 2.6) },
  { z: 11.0, s: sym(0.0, 0.53, 0.56, 0.52, 2.3, 2.4) },
  { z: 12.3, s: sym(0.0, 0.5, 0.51, 0.49, 2.2, 2.2) },
  { z: 13.15, s: sym(0.0, 0.47, 0.47, 0.47, 2.05, 2.05) },
]);

const WING_Y = -0.2;

const wing: SurfaceDef = {
  x: 0.38,
  y: WING_Y,
  angle: 0,
  stations: [
    { s: 0, le: 6.55, chord: 3.95, t: 0.05 },
    { s: 4.22, le: 6.55 + 4.22 * Math.tan((28 * Math.PI) / 180), chord: 1.12, t: 0.04, twist: -1.5 },
  ],
  controls: [
    { role: 'flap', s0: 0.62, s1: 2.35, hinge: 0.76, max: 30 },
    { role: 'aileron', s0: 2.35, s1: 3.95, hinge: 0.77, max: 22 },
  ],
  detach: 2.35,
  part: PART.wingR,
  bone: ROOT_BONE,
  mirror: true,
  k: 12,
};

const lerx: SurfaceDef = {
  x: 0.42,
  y: 0.1,
  angle: -4,
  stations: [
    { s: 0, le: 4.3, chord: 3.7, t: 0.022 },
    { s: 0.36, le: 6.45, chord: 1.6, t: 0.03 },
  ],
  part: PART.fuselage,
  bone: ROOT_BONE,
  mirror: true,
  k: 8,
  tipCap: true,
};

const fin: SurfaceDef = {
  x: 0,
  y: 0.5,
  vertical: true,
  angle: 0,
  stations: [
    { s: 0, le: 9.75, chord: 3.1, t: 0.05 },
    { s: 0.6, le: 10.45, chord: 2.55, t: 0.048 },
    { s: 2.42, le: 12.2, chord: 0.95, t: 0.045 },
  ],
  controls: [{ role: 'rudder', s0: 0.4, s1: 2.2, hinge: 0.72, max: 25 }],
  part: PART.tail,
  bone: 0,
  mirror: false,
  k: 10,
};

const stab: SurfaceDef = {
  x: 0.42,
  y: -0.02,
  angle: -7,
  stations: [
    { s: 0, le: 11.75, chord: 1.95, t: 0.045 },
    { s: 2.35, le: 11.75 + 2.35 * Math.tan((40 * Math.PI) / 180), chord: 0.62, t: 0.04 },
  ],
  allMoving: { role: 'stab', pivot: 0.42, max: 20 },
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 10,
};

const ventral: SurfaceDef = {
  x: 0.3,
  y: -0.42,
  vertical: true,
  angle: 150,
  stations: [
    { s: 0, le: 11.4, chord: 1.2, t: 0.06 },
    { s: 0.42, le: 11.95, chord: 0.55, t: 0.06 },
  ],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 6,
  rootCap: false,
};

function build(ctx: BuildContext): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const tail = rig.add({ role: 'tail', pivot: [0, 0.4, 10.8] });
  // fuselage skin
  b.style(PAINT.livery, 0xffffff, PANEL.body);
  b.part = PART.fuselage;
  b.bone = ROOT_BONE;
  const zs = stationList(0.55, 13.15, ctx.lod === 0 ? 0.2 : 0.75, ctx.lod === 0 ? 0.06 : 0.3, 1.2, 0.2);
  loft(b, {
    zs,
    nU: ctx.lod === 0 ? 40 : 14,
    ring: superRing(fuselage, ctx.lod === 0 ? 40 : 14),
    capStart: 'point',
  });
  // intakes (D-shaped, flat inboard wall)
  intake(ctx, {
    z0: 5.35,
    z1: 8.6,
    lip: { cx: 0.76, cy: -0.2, wl: 0.19, wr: 0.25, ht: 0.33, hb: 0.36, nTL: 7, nBL: 7, nTR: 2.3, nBR: 2.3 },
    end: { cx: 0.36, cy: -0.12, wl: 0.12, wr: 0.18, ht: 0.26, hb: 0.28, nTL: 5, nBL: 5, nTR: 2.3, nBR: 2.3 },
    rakeX: 0,
    rakeY: 0.32,
    wall: 0.035,
    depth: 1.7,
    fan: { cx: 0.5, cy: -0.13, wl: 0.15, wr: 0.15, ht: 0.2, hb: 0.2, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    mirror: true,
    splitter: true,
  });
  // LERX, wing, tail surfaces
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  buildSurface(b, rig, lerx, ctx.lod);
  const w = buildSurface(b, rig, wing, ctx.lod);
  const tipBoneR = w.detachBone;
  const tipBoneL = rig.mirror(tipBoneR);
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  buildSurface(b, rig, { ...fin, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...stab, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...ventral, bone: tail }, ctx.lod);
  // wingtip launch rails
  b.bone = tipBoneR;
  b.part = PART.wingR;
  b.style(PAINT.livery, 0xffffff, PANEL.plain);
  const railX = wing.x + 4.22 + 0.045;
  const sec = makeSection();
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  loft(b, {
    zs: stationList(8.05, 10.65, ctx.lod === 0 ? 0.25 : 1.3, ctx.lod === 0 ? 0.06 : 0.6, 0.2, 0.12),
    nU: ctx.lod === 0 ? 12 : 6,
    ring: (z, out) => {
      const u = (z - 8.05) / 2.6;
      const k = Math.min(Math.sqrt(Math.min(u / 0.08, 1)), Math.sqrt(Math.min((1 - u) / 0.05, 1)));
      sec.cx = railX;
      sec.cy = WING_Y - 0.01;
      sec.wl = sec.wr = 0.05 * Math.max(k, 0.15);
      sec.ht = 0.055 * Math.max(k, 0.15);
      sec.hb = 0.075 * Math.max(k, 0.15);
      sec.nTL = sec.nTR = sec.nBL = sec.nBR = 2.6;
      const n = ctx.lod === 0 ? 12 : 6;
      for (let j = 0; j < n; j++) sectionPoint(sec, j / n, out, j * 2);
    },
    uv: 'none',
    capStart: 'point',
    capEnd: 'point',
  });
  b.mirror(v0, i0, rig.mirrorFn, (p) => (p === PART.wingR ? PART.wingL : p));
  b.bone = ROOT_BONE;
  // nozzle
  roundNozzle(ctx, {
    x: 0,
    y: 0,
    z0: 13.12,
    r0: 0.465,
    z1: 14.07,
    r1: 0.4,
    petals: 16,
    mirror: false,
    index: 0,
  });
  // canopy (tandem), pilots, pitot
  canopy(ctx, {
    zFront: 3.25,
    zBow: 3.85,
    zRear: 6.45,
    bows: [5.05],
    height: [
      [3.25, 0.0],
      [3.5, 0.22],
      [3.85, 0.42],
      [4.4, 0.51],
      [5.0, 0.56],
      [5.6, 0.58],
      [6.05, 0.44],
      [6.45, 0.06],
    ],
    sillT: 0.115,
    n: 2.3,
    tint: 0xb9c4c8,
    maxOpen: 38,
  });
  pilot(ctx, [0, 0.78, 4.45], { z: 3.85, w: 0.26, y: 0.47 });
  pilot(ctx, [0, 0.86, 5.55], null);
  ctx.meta.cockpitEye = [0, 0.78, 4.45];
  pitot(ctx, [0, -0.02, 0.62], [0, -0.02, 0.0], 0.018);
  // gear: nose gear retracts aft, mains retract inward under the fuselage
  gear(ctx, {
    pivot: [0, -0.2, 3.55],
    length: 1.17,
    wheelR: 0.23,
    wheelW: 0.13,
    axis: [1, 0, 0],
    angle: -92,
    mirror: false,
    strutR: 0.045,
    rake: 6,
    doors: [{ z0: 3.5, z1: 4.95, t0: 0.462, t1: 0.499, angle: 88 }],
  });
  gear(ctx, {
    pivot: [0.74, -0.33, 8.75],
    length: 1.02,
    wheelR: 0.3,
    wheelW: 0.19,
    axis: [0, 0, 1],
    angle: -90,
    mirror: true,
    strutR: 0.06,
    offset: 0.08,
    doors: [{ z0: 8.3, z1: 9.25, t0: 0.4, t1: 0.47, angle: 95 }],
  });
  airbrakePanel(ctx, fuselage, { z0: 9.9, z1: 11.0, t0: 0.455, t1: 0.545, dir: 1, max: 55 });
  // antennas
  blade(ctx, 0, 0.66, 7.2, 0.18, 0.28, false);
  blade(ctx, 0, -0.52, 6.2, 0.16, 0.26, true);
  // gun in the left LERX root
  gunPort(ctx, [-0.52, 0.16, 4.75], 0.032, 0.25);
  // stores: wingtip SRMs, underwing MRMs
  store(ctx, 'srm', [-railX, WING_Y - 0.155, 9.25], tipBoneL, false, 0);
  store(ctx, 'srm', [railX, WING_Y - 0.155, 9.25], tipBoneR, false, 1);
  const pyS = 2.05;
  const pz = 9.05;
  const top = [0, 0, 0] as [number, number, number];
  skinPoint(wing, pyS, 0.5, -1, top);
  for (const [i, sx] of [
    [2, -1],
    [3, 1],
  ] as const) {
    const pos: [number, number, number] = [sx * (wing.x + pyS), top[1] - 0.34, pz];
    pylon(ctx, 'mrm', pos, top[1] + 0.03, ROOT_BONE);
    store(ctx, 'mrm', pos, ROOT_BONE, false, i);
  }
  // lights
  const tipR: [number, number, number] = [railX, WING_Y + 0.02, 8.15];
  lightsAt(ctx, tipR, tipBoneR, tipBoneL, [0, 2.75, 12.95], tail, [
    [0, 0.72, 7.9],
    [0, -0.56, 7.2],
  ]);
  // metadata
  ctx.meta.wingtips = [
    [-railX, WING_Y, 10.4],
    [railX, WING_Y, 10.4],
  ];
  ctx.meta.radomeZ = 2.25;
  ctx.meta.antiGlare = [2.35, 3.3, 0.27, 0.28];
  capsule(ctx, 'fuselage', [0, 0, 1.0], [0, 0, 12.4], 0.52);
  capsule(ctx, 'cockpit', [0, 0.62, 3.7], [0, 0.72, 6.0], 0.36);
  capsule(ctx, 'engine', [0, 0, 11.0], [0, 0, 13.9], 0.48);
  surfaceCapsules(ctx, wing, 'wingR', true, 0.4);
  surfaceCapsules(ctx, { ...fin }, 'tail', false, 0.2);
  surfaceCapsules(ctx, stab, 'tail', true, 0.2);
  // markings
  markings(ctx, {
    wingInsignia: [wing.x + 2.9, WING_Y + 0.02, 9.35],
    wingInsigniaSize: 0.42,
    bodyInsignia: [0.55, 0.12, 9.9],
    bodyInsigniaSize: 0.3,
    fins: [
      { center: [0, 1.55, 11.6], face: 'right' },
      { center: [0, 1.55, 11.6], face: 'left' },
    ],
    finNumberH: 0.3,
    nose: [0.4, -0.05, 2.75],
    rescue: [0.43, 0.3, 5.9],
    danger: [0.98, -0.02, 5.6],
    noStep: [wing.x + 1.2, WING_Y + 0.05, 9.2],
    flash: { z0: 11.4, z1: 13.3, y0: 2.55, y1: 2.9 },
  });
  bay(ctx, 'bottom', [0, -0.45, 4.22], 0.08, 0.7);
  bay(ctx, 'bottom', [0.5, -0.42, 8.78], 0.28, 0.45);
  bay(ctx, 'bottom', [-0.5, -0.42, 8.78], 0.28, 0.45);
  bay(ctx, 'top', [0, 0.5, 4.95], 0.3, 1.45);
}

export const kestrel: JetDesign = { id: 'kestrel', cgZ: 8.35, fuselage, build };

import { PAINT, PANEL, PART } from '../builder';
import { blade, canopy, gear, intake, pilot, roundNozzle } from '../components';
import type { JetDesign } from '../airframe';
import type { BuildContext } from '../context';
import { ROOT_BONE, type Vec3 } from '../rig';
import { lathe, loft, makeSection, Profile, sectionPoint, stationList, sym, tube } from '../shapes';
import { buildSurface, type SurfaceDef } from '../surfaces';
import { bay, capsule, casing, lightsAt, markings, skin, surfaceCapsules, wingStore } from './common';

/**
 * GA-6 Mule: subsonic armoured ground-attack jet. Deep slab-sided fuselage, flat-plate armoured canopy,
 * long straight wing with split decelerons and many pylons, gear fairings under the wing, engine pods
 * high on the aft fuselage, twin fins on the tips of the tailplane, heavy rotary cannon under the nose.
 */
const fuselage = new Profile([
  { z: 0.42, s: sym(-0.22, 0.12, 0.12, 0.12) },
  { z: 0.75, s: sym(-0.16, 0.36, 0.38, 0.4, 2.4, 2.6) },
  { z: 1.5, s: sym(-0.08, 0.6, 0.58, 0.68, 2.8, 3.2) },
  { z: 2.6, s: sym(0.0, 0.73, 0.62, 0.8, 3.2, 3.6) },
  { z: 3.8, s: sym(0.02, 0.77, 0.62, 0.82, 3.4, 3.8) },
  { z: 5.0, s: sym(0.0, 0.79, 0.72, 0.84, 3.2, 3.8) },
  { z: 7.0, s: sym(0.0, 0.77, 0.7, 0.82, 3.0, 3.6) },
  { z: 9.5, s: sym(0.06, 0.68, 0.62, 0.68, 2.8, 3.0) },
  { z: 12.0, s: sym(0.14, 0.54, 0.5, 0.5, 2.6, 2.6) },
  { z: 14.0, s: sym(0.22, 0.4, 0.4, 0.37, 2.4, 2.4) },
  { z: 15.8, s: sym(0.26, 0.22, 0.26, 0.24) },
  { z: 16.25, s: sym(0.26, 0.05, 0.05, 0.05) },
]);

const WING_Y = -0.55;
const NX = 1.38;
const NY = 0.98;

const wing: SurfaceDef = {
  x: 0.6,
  y: WING_Y,
  angle: 3,
  stations: [
    { s: 0, le: 5.9, chord: 3.0, t: 0.16 },
    { s: 3.9, le: 6.1, chord: 2.6, t: 0.15 },
    { s: 8.15, le: 6.6, chord: 1.55, t: 0.13, twist: -2 },
  ],
  controls: [
    { role: 'flap', s0: 0.55, s1: 3.9, hinge: 0.72, max: 35 },
    { role: 'aileron', s0: 4.3, s1: 7.8, hinge: 0.72, max: 25, split: true },
  ],
  detach: 4.3,
  camber: 0.02,
  part: PART.wingR,
  bone: ROOT_BONE,
  mirror: true,
  k: 10,
  density: 0.45,
};

const tailplane: SurfaceDef = {
  x: 0.2,
  y: 0.32,
  angle: 0,
  stations: [
    { s: 0, le: 13.85, chord: 2.1, t: 0.1 },
    { s: 2.95, le: 14.05, chord: 1.7, t: 0.09 },
  ],
  controls: [{ role: 'elevator', s0: 0.3, s1: 2.8, hinge: 0.7, max: 22 }],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 8,
};

const fin: SurfaceDef = {
  x: 3.15,
  y: -0.6,
  vertical: true,
  angle: 0,
  stations: [
    { s: 0, le: 13.7, chord: 2.2, t: 0.09 },
    { s: 2.9, le: 13.85, chord: 2.0, t: 0.09 },
    { s: 3.43, le: 14.2, chord: 1.4, t: 0.09 },
  ],
  controls: [{ role: 'rudder', s0: 0.35, s1: 2.95, hinge: 0.7, max: 25 }],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 8,
};

const podPylon: SurfaceDef = {
  x: 0.45,
  y: 0.32,
  vertical: true,
  angle: 52,
  stations: [
    { s: 0, le: 10.4, chord: 2.5, t: 0.12 },
    { s: 0.95, le: 10.6, chord: 2.2, t: 0.12 },
  ],
  part: PART.engine,
  bone: ROOT_BONE,
  mirror: true,
  k: 6,
  tipCap: false,
};

function build(ctx: BuildContext): void {
  const b = ctx.body;
  const rig = ctx.rig;
  const tail = rig.add({ role: 'tail', pivot: [0, 0.4, 14.5] });
  skin(ctx, fuselage, 0.42, 16.25, { nU: 36, capStart: 'flat', capEnd: 'point' });
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  const w = buildSurface(b, rig, wing, ctx.lod);
  const tipR = w.detachBone;
  const tipL = rig.mirror(tipR);
  buildSurface(b, rig, { ...tailplane, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...fin, bone: tail }, ctx.lod);
  buildSurface(b, rig, podPylon, ctx.lod);
  // engine pods high on the aft fuselage
  intake(ctx, {
    z0: 10.0,
    z1: 10.35,
    lip: { cx: NX, cy: NY, wl: 0.53, wr: 0.53, ht: 0.53, hb: 0.53, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    end: { cx: NX, cy: NY, wl: 0.57, wr: 0.57, ht: 0.57, hb: 0.57, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    rakeX: 0,
    rakeY: 0,
    wall: 0.07,
    depth: 0.75,
    fan: { cx: NX, cy: NY, wl: 0.42, wr: 0.42, ht: 0.42, hb: 0.42, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    mirror: true,
    nU: 24,
  });
  casing(
    ctx,
    NX,
    NY,
    [
      [10.35, 0.57],
      [11.0, 0.62],
      [12.6, 0.6],
      [13.4, 0.51],
      [13.62, 0.48],
    ],
    true,
  );
  if (ctx.lod === 0) {
    // fan spinner
    b.style(PAINT.metal, 0x5d6062, PANEL.plain);
    for (const sx of [1, -1]) {
      lathe(
        b,
        [
          [10.56, 0.02],
          [10.62, 0.1],
          [10.72, 0.15],
        ],
        12,
        { cx: sx * NX, cy: NY },
      );
    }
  }
  roundNozzle(ctx, {
    x: NX,
    y: NY,
    z0: 13.62,
    r0: 0.47,
    z1: 14.12,
    r1: 0.43,
    petals: 12,
    mirror: true,
    index: 0,
  });
  // main gear fairings under the wing
  const podX = 1.85;
  b.style(PAINT.livery, 0xffffff, PANEL.body);
  b.part = PART.wingR;
  b.bone = ROOT_BONE;
  const pv0 = b.vertexCount;
  const pi0 = b.idx.length;
  const sec = makeSection();
  const pn = ctx.lod === 0 ? 16 : 6;
  loft(b, {
    zs: stationList(5.2, 8.6, ctx.lod === 0 ? 0.3 : 1.2, ctx.lod === 0 ? 0.08 : 0.5, 0.4, 0.4),
    nU: pn,
    ring: (z, out) => {
      const u = (z - 5.2) / 3.4;
      const k = Math.min(Math.sqrt(Math.min(u / 0.2, 1)), Math.pow(Math.min((1 - u) / 0.3, 1), 0.7));
      sec.cx = podX;
      sec.cy = WING_Y - 0.28 + 0.2 * (1 - k);
      sec.wl = sec.wr = 0.3 * Math.max(k, 0.1);
      sec.ht = 0.3 * Math.max(k, 0.1);
      sec.hb = 0.3 * Math.max(k, 0.1);
      sec.nTL = sec.nTR = sec.nBL = sec.nBR = 2.2;
      for (let j = 0; j < pn; j++) sectionPoint(sec, j / pn, out, j * 2);
    },
    capStart: 'point',
    capEnd: 'point',
  });
  b.mirror(pv0, pi0, rig.mirrorFn, (p) => (p === PART.wingR ? PART.wingL : p));
  canopy(ctx, {
    zFront: 1.8,
    zBow: 2.3,
    zRear: 4.3,
    bows: [3.5],
    height: [
      [1.8, 0],
      [2.05, 0.3],
      [2.3, 0.5],
      [3.0, 0.62],
      [3.7, 0.6],
      [4.1, 0.35],
      [4.3, 0.08],
    ],
    sillT: 0.13,
    n: 2,
    facet: true,
    tint: 0xa9b3b0,
    maxOpen: 40,
  });
  const eye: Vec3 = [0, 0.93, 2.95];
  pilot(ctx, eye, { z: 2.3, w: 0.32, y: 0.52 });
  ctx.meta.cockpitEye = eye;
  // rotary cannon: seven barrels in a shroud under the nose, offset left
  const muzzle: Vec3 = [-0.08, -0.3, 0];
  ctx.meta.gunMuzzle = muzzle;
  if (ctx.lod === 0) {
    b.style(PAINT.metal, 0x3c3e40, PANEL.plain);
    b.part = PART.fuselage;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      tube(
        b,
        [
          [muzzle[0] + Math.cos(a) * 0.07, muzzle[1] + Math.sin(a) * 0.07, 0],
          [muzzle[0] + Math.cos(a) * 0.07, muzzle[1] + Math.sin(a) * 0.07, 0.62],
        ],
        0.024,
        6,
      );
    }
    b.style(PAINT.dark, 0x2d2f31, PANEL.plain);
    lathe(
      b,
      [
        [0.3, 0.1],
        [0.36, 0.12],
        [0.7, 0.13],
      ],
      12,
      { cx: muzzle[0], cy: muzzle[1], capStart: true },
    );
  }
  gear(ctx, {
    pivot: [0.3, -0.5, 1.9],
    length: 1.15,
    wheelR: 0.3,
    wheelW: 0.17,
    axis: [1, 0, 0],
    angle: -90,
    mirror: false,
    strutR: 0.06,
    doors: [{ z0: 1.85, z1: 3.3, t0: 0.44, t1: 0.49, angle: 88 }],
  });
  gear(ctx, {
    pivot: [podX, WING_Y - 0.25, 7.1],
    length: 0.77,
    wheelR: 0.38,
    wheelW: 0.22,
    axis: [1, 0, 0],
    angle: 90,
    mirror: true,
    strutR: 0.08,
    doors: [],
  });
  blade(ctx, 0, 0.68, 7.5, 0.22, 0.32, false);
  blade(ctx, 0, -0.82, 9.0, 0.2, 0.3, true);
  // ten wing stations: SRM, rocket pod, bomb, AGM, bomb (outboard to inboard), left/right alternating
  wingStore(ctx, wing, 7.4, 7.2, 0.3, 'srm', [0, 1], [tipL, tipR]);
  wingStore(ctx, wing, 6.3, 7.1, 0.44, 'rocketPod', [2, 3], [tipL, tipR]);
  wingStore(ctx, wing, 5.15, 7.1, 0.42, 'bomb', [4, 5], [tipL, tipR]);
  wingStore(ctx, wing, 3.3, 7.0, 0.4, 'agm', [6, 7]);
  wingStore(ctx, wing, 2.35, 7.0, 0.44, 'bomb', [8, 9]);
  const tipX = wing.x + 8.15;
  lightsAt(ctx, [tipX, WING_Y + 0.42, 6.7], tipR, tipL, [3.15, 2.85, 15.6], tail, [
    [0, 0.72, 8.3],
    [0, -0.84, 8.6],
  ]);
  ctx.meta.wingtips = [
    [-tipX, WING_Y + 0.43, 8.1],
    [tipX, WING_Y + 0.43, 8.1],
  ];
  ctx.meta.radomeZ = 0.9;
  ctx.meta.antiGlare = [1.1, 1.8, 0.42, 0.25];
  capsule(ctx, 'fuselage', [0, -0.05, 0.9], [0, 0.1, 15.4], 0.74);
  capsule(ctx, 'cockpit', [0, 0.62, 2.0], [0, 0.72, 4.1], 0.45);
  capsule(ctx, 'engine', [NX, NY, 10.3], [NX, NY, 13.8], 0.58);
  capsule(ctx, 'engine', [-NX, NY, 10.3], [-NX, NY, 13.8], 0.58);
  surfaceCapsules(ctx, wing, 'wingR', true, 0.3);
  surfaceCapsules(ctx, tailplane, 'tail', true, 0.2);
  surfaceCapsules(ctx, fin, 'tail', true, 0.2);
  markings(ctx, {
    wingInsignia: [5.8, WING_Y + 0.4, 7.4],
    wingInsigniaSize: 0.62,
    bodyInsignia: [0.7, 0.05, 8.2],
    bodyInsigniaSize: 0.4,
    fins: [
      { center: [3.26, 1.5, 14.8], face: 'right' },
      { center: [-3.26, 1.5, 14.8], face: 'left' },
    ],
    finNumberH: 0.36,
    nose: [0.62, -0.15, 1.5],
    rescue: [0.72, 0.42, 4.5],
    danger: [1.9, 1.0, 10.3],
    noStep: [2.4, WING_Y + 0.3, 7.6],
    flash: { z0: 13.9, z1: 16.0, y0: 2.45, y1: 2.85 },
  });
  bay(ctx, 'bottom', [0.3, -0.8, 2.58], 0.12, 0.72);
  bay(ctx, 'top', [0, 0.62, 3.05], 0.46, 1.2);
}

export const mule: JetDesign = { id: 'mule', cgZ: 7.3, fuselage, build };

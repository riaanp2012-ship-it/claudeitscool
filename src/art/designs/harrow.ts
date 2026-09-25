import { PAINT, PANEL, PART } from '../builder';
import { blade, canopy, gear, intake, pilot, pylon, roundNozzle, store } from '../components';
import type { JetDesign } from '../airframe';
import type { BuildContext } from '../context';
import { ROOT_BONE, type Vec3 } from '../rig';
import { Profile, sym } from '../shapes';
import { buildSurface, type SurfaceDef } from '../surfaces';
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

/**
 * F-24 Harrow: heavy twin-engine air superiority fighter. Broad flat fuselage between box intake trunks,
 * raised single-seat bubble canopy, raked rectangular intakes, shoulder cropped-delta wing, twin fins with
 * slight outward cant, side-by-side nozzles, large stabilators.
 */
const fuselage = new Profile([
  { z: 0.05, s: sym(-0.06, 0.03, 0.03, 0.03) },
  { z: 0.35, s: sym(-0.06, 0.19, 0.19, 0.19) },
  { z: 1.1, s: sym(-0.03, 0.38, 0.38, 0.39) },
  { z: 2.1, s: sym(0.0, 0.51, 0.52, 0.52, 2.1, 2.1) },
  { z: 3.1, s: sym(0.05, 0.6, 0.6, 0.58, 2.4, 2.3) },
  { z: 4.2, s: sym(0.12, 0.65, 0.64, 0.6, 3.0, 2.6) },
  { z: 5.4, s: sym(0.12, 0.7, 0.64, 0.62, 3.0, 2.8) },
  { z: 6.7, s: sym(0.1, 0.92, 0.74, 0.62, 2.7, 3.0) },
  { z: 8.1, s: sym(0.05, 1.26, 0.66, 0.6, 3.1, 3.4) },
  { z: 10.0, s: sym(0.02, 1.4, 0.6, 0.58, 3.5, 3.6) },
  { z: 13.0, s: sym(0.0, 1.38, 0.55, 0.55, 3.6, 3.6) },
  { z: 15.4, s: sym(0.0, 1.3, 0.46, 0.5, 3.6, 3.4) },
  { z: 16.9, s: sym(-0.02, 1.12, 0.2, 0.25, 3.0, 3.0) },
  { z: 17.6, s: sym(-0.02, 0.9, 0.07, 0.09, 2.5, 2.5) },
]);

const WING_Y = 0.3;

const wing: SurfaceDef = {
  x: 1.2,
  y: WING_Y,
  angle: -1,
  stations: [
    { s: 0, le: 7.7, chord: 6.1, t: 0.05 },
    { s: 5.3, le: 7.7 + 5.3 * Math.tan((42 * Math.PI) / 180), chord: 1.45, t: 0.035, twist: -2 },
  ],
  controls: [
    { role: 'flap', s0: 0.35, s1: 2.7, hinge: 0.8, max: 30 },
    { role: 'aileron', s0: 2.7, s1: 4.9, hinge: 0.78, max: 22 },
  ],
  detach: 2.7,
  part: PART.wingR,
  bone: ROOT_BONE,
  mirror: true,
  k: 12,
};

const fin: SurfaceDef = {
  x: 1.32,
  y: 0.45,
  vertical: true,
  angle: 4,
  stations: [
    { s: 0, le: 14.3, chord: 3.3, t: 0.045 },
    { s: 3.3, le: 14.3 + 3.3 * Math.tan((36 * Math.PI) / 180), chord: 1.15, t: 0.04 },
  ],
  controls: [{ role: 'rudder', s0: 0.3, s1: 2.8, hinge: 0.72, max: 25 }],
  part: PART.tail,
  bone: 0,
  mirror: true,
  k: 10,
};

const stab: SurfaceDef = {
  x: 1.2,
  y: -0.05,
  angle: 0,
  stations: [
    { s: 0, le: 15.9, chord: 2.75, t: 0.045 },
    { s: 3.0, le: 15.9 + 3.0 * Math.tan((40 * Math.PI) / 180), chord: 0.95, t: 0.04 },
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
  const tail = rig.add({ role: 'tail', pivot: [0, 0.5, 15.5] });
  skin(ctx, fuselage, 0.05, 17.6, { nU: 40 });
  casing(
    ctx,
    0.62,
    -0.02,
    [
      [13.4, 0.5],
      [15.0, 0.6],
      [17.4, 0.62],
      [18.25, 0.6],
    ],
    true,
  );
  intake(ctx, {
    z0: 5.2,
    z1: 10.5,
    lip: { cx: 1.14, cy: -0.1, wl: 0.42, wr: 0.48, ht: 0.62, hb: 0.5, nTL: 7, nTR: 6, nBL: 7, nBR: 6 },
    end: { cx: 0.86, cy: -0.05, wl: 0.4, wr: 0.44, ht: 0.48, hb: 0.48, nTL: 5, nTR: 5, nBL: 5, nBR: 5 },
    rakeX: 0,
    rakeY: -0.55,
    wall: 0.04,
    depth: 2.2,
    fan: { cx: 0.85, cy: -0.1, wl: 0.36, wr: 0.36, ht: 0.38, hb: 0.38, nTL: 2, nTR: 2, nBL: 2, nBR: 2 },
    mirror: true,
    sharp: false,
  });
  b.style(PAINT.livery, 0xffffff, PANEL.wing);
  const w = buildSurface(b, rig, wing, ctx.lod);
  const tipR = w.detachBone;
  const tipL = rig.mirror(tipR);
  buildSurface(b, rig, { ...fin, bone: tail }, ctx.lod);
  buildSurface(b, rig, { ...stab, bone: tail }, ctx.lod);
  roundNozzle(ctx, {
    x: 0.62,
    y: -0.02,
    z0: 18.25,
    r0: 0.6,
    z1: 19.38,
    r1: 0.53,
    petals: 18,
    mirror: true,
    index: 0,
  });
  canopy(ctx, {
    zFront: 3.55,
    zBow: 4.1,
    zRear: 6.9,
    bows: [],
    height: [
      [3.55, 0],
      [3.8, 0.25],
      [4.1, 0.45],
      [4.8, 0.64],
      [5.5, 0.66],
      [6.2, 0.5],
      [6.9, 0.05],
    ],
    sillT: 0.11,
    n: 2.2,
    tint: 0xbcc6c9,
    maxOpen: 40,
  });
  const eye: Vec3 = [0, 1.1, 4.95];
  pilot(ctx, eye, { z: 4.2, w: 0.3, y: 0.76 });
  ctx.meta.cockpitEye = eye;
  gear(ctx, {
    pivot: [0, -0.25, 4.5],
    length: 1.39,
    wheelR: 0.28,
    wheelW: 0.16,
    axis: [1, 0, 0],
    angle: 90,
    mirror: false,
    strutR: 0.055,
    rake: -4,
    doors: [{ z0: 3.0, z1: 4.55, t0: 0.462, t1: 0.499, angle: 88 }],
  });
  gear(ctx, {
    pivot: [1.15, -0.25, 11.9],
    length: 1.29,
    wheelR: 0.38,
    wheelW: 0.22,
    axis: [1, 0, 0],
    angle: 88,
    mirror: true,
    strutR: 0.075,
    offset: 0.1,
    doors: [{ z0: 10.3, z1: 11.95, t0: 0.35, t1: 0.42, angle: 95 }],
  });
  airbrakePanel(ctx, fuselage, { z0: 7.3, z1: 9.4, t0: 0.955, t1: 1.045, dir: -1, max: 45 });
  blade(ctx, 0, 0.72, 9.8, 0.2, 0.3, false);
  blade(ctx, 0, -0.6, 7.0, 0.18, 0.28, true);
  gunPort(ctx, [1.5, 0.28, 8.1], 0.035, 0.3);
  // stores: outer SRM pylons, mid SRM pylons, inner LRAAM pylons, conformal MRMs on the fuselage corners
  wingStore(ctx, wing, 3.9, 12.1, 0.3, 'srm', [0, 1], [tipL, tipR]);
  wingStore(ctx, wing, 2.35, 11.2, 0.32, 'srm', [2, 3]);
  wingStore(ctx, wing, 1.25, 10.6, 0.78, 'lraam', [6, 7]);
  for (const [i, sx] of [
    [4, -1],
    [5, 1],
  ] as const) {
    const pos: Vec3 = [sx * 1.2, -0.72, 10.4];
    pylon(ctx, 'mrm', pos, -0.5, ROOT_BONE, { chord: 1.2 });
    store(ctx, 'mrm', pos, ROOT_BONE, false, i);
  }
  lightsAt(ctx, [6.47, WING_Y - 0.08, 12.55], tipR, tipL, [1.56, 3.72, 17.9], tail, [
    [0, 0.8, 9.6],
    [0, -0.62, 9.0],
  ]);
  ctx.meta.wingtips = [
    [-6.5, WING_Y - 0.09, 13.7],
    [6.5, WING_Y - 0.09, 13.7],
  ];
  ctx.meta.radomeZ = 2.9;
  ctx.meta.antiGlare = [2.75, 3.55, 0.36, 0.3];
  capsule(ctx, 'fuselage', [0, 0, 1.2], [0, 0, 16.6], 0.72);
  capsule(ctx, 'cockpit', [0, 0.82, 3.9], [0, 0.95, 6.5], 0.42);
  capsule(ctx, 'engine', [0, 0, 14.2], [0, 0, 19.0], 0.78);
  surfaceCapsules(ctx, wing, 'wingR', true, 0.3);
  surfaceCapsules(ctx, fin, 'tail', true, 0.2);
  surfaceCapsules(ctx, stab, 'tail', true, 0.2);
  markings(ctx, {
    wingInsignia: [4.6, WING_Y + 0.03, 12.2],
    wingInsigniaSize: 0.55,
    bodyInsignia: [1.5, 0.05, 8.2],
    bodyInsigniaSize: 0.34,
    fins: [
      { center: [1.47, 2.1, 16.2], face: 'right' },
      { center: [-1.47, 2.1, 16.2], face: 'left' },
    ],
    finNumberH: 0.36,
    nose: [0.55, -0.05, 2.9],
    rescue: [0.62, 0.42, 6.6],
    danger: [1.62, 0.2, 5.6],
    noStep: [2.3, WING_Y + 0.08, 12.7],
    flash: { z0: 16.6, z1: 18.4, y0: 3.3, y1: 3.75 },
  });
  bay(ctx, 'bottom', [0, -0.56, 3.78], 0.1, 0.78);
  bay(ctx, 'bottom', [1.12, -0.55, 11.12], 0.2, 0.82);
  bay(ctx, 'bottom', [-1.12, -0.55, 11.12], 0.2, 0.82);
  bay(ctx, 'top', [0, 0.77, 5.2], 0.42, 1.5);
}

export const harrow: JetDesign = { id: 'harrow', cgZ: 10.8, fuselage, build };

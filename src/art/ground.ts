import { Group, Mesh, type BufferGeometry, type Material, type Object3D } from 'three';
import type { GroundTargetKind } from '../core/types';
import { gridSurface, MeshBuilder, PAINT, PANEL, rotation } from './builder';
import {
  box,
  capFan,
  lathe,
  loft,
  makeSection,
  Profile,
  sectionPoint,
  stationList,
  sym,
  tube,
  type Section,
} from './shapes';
import type { Vec3 } from './rig';

/**
 * Procedural ground targets at real scale: SAM launcher, twin-barrel AAA, radar, arched hangar, fuel farm,
 * command bunker, concrete bunker and a ~110 m frigate. Front toward -Z, origin at the ground contact centre
 * (ship: waterline). Geometry is built once per (kind, climate) and shared; every unit uses the shared
 * airframe program (paint modes + vertex tints, patched atmosphere), and wrecks swap to a scorched variant.
 */

interface Palette {
  body: number;
  body2: number;
  concrete: number;
  tank: number;
}

const TEMPERATE: Palette = { body: 0x4d5538, body2: 0x3a4030, concrete: 0x76746c, tank: 0xa9a79f };
const DESERT: Palette = { body: 0x9a845f, body2: 0x7a6749, concrete: 0x948a76, tank: 0xb0a489 };
const METAL = 0x3b3d3f;
const GLASS = 0x1c2227;
const DARK = 0x1b1d1e;

type B = MeshBuilder;

function paint(b: B, mode: number, tint: number): void {
  b.style(mode, tint, PANEL.plain);
}

/** Box rotated about the vertical axis (yaw) and then pitched about x, both around its centre. */
function rbox(b: B, c: Vec3, h: Vec3, pitch = 0, yaw = 0): void {
  const v0 = b.vertexCount;
  box(b, [0, 0, 0], h);
  if (pitch !== 0) b.transform(v0, rotation([1, 0, 0], pitch), [0, 0, 0]);
  if (yaw !== 0) b.transform(v0, rotation([0, 1, 0], yaw), [0, 0, 0]);
  b.translate(v0, c[0], c[1], c[2]);
}

/** Cylinder of revolution with profile [z, r] built along z, re-oriented to `axis`, then moved to `c`. */
function solid(
  b: B,
  c: Vec3,
  profile: [number, number][],
  seg: number,
  axis: 'x' | 'y' | 'z',
  caps = true,
): void {
  const v0 = b.vertexCount;
  lathe(b, profile, seg, { capStart: caps, capEnd: caps });
  if (axis === 'y') b.transform(v0, rotation([1, 0, 0], -Math.PI / 2), [0, 0, 0]);
  else if (axis === 'x') b.transform(v0, rotation([0, 1, 0], Math.PI / 2), [0, 0, 0]);
  b.translate(v0, c[0], c[1], c[2]);
}

function cylinder(b: B, c: Vec3, r: number, len: number, axis: 'x' | 'y' | 'z', seg = 14): void {
  solid(
    b,
    c,
    [
      [-len / 2, r],
      [len / 2, r],
    ],
    seg,
    axis,
  );
}

function wheel(b: B, c: Vec3, r: number, w: number): void {
  paint(b, PAINT.rubber, 0x1d1e1f);
  solid(
    b,
    c,
    [
      [-w / 2, r * 0.55],
      [-w / 2, r * 0.9],
      [-w * 0.35, r],
      [w * 0.35, r],
      [w / 2, r * 0.9],
      [w / 2, r * 0.55],
    ],
    14,
    'x',
    false,
  );
  paint(b, PAINT.dark, 0x3d4035);
  cylinder(b, c, r * 0.56, w * 0.9, 'x', 10);
}

/** Lofted body along z with boxy superellipse sections (rounded vehicle hulls, bunkers, superstructure). */
function hull(
  b: B,
  stations: { z: number; s: Section }[],
  nU: number,
  step: number,
  capStart = true,
  capEnd = true,
): void {
  const prof = new Profile(stations);
  const sec = makeSection();
  loft(b, {
    zs: stationList(prof.z0, prof.z1, step),
    nU,
    ring: (z, out) => {
      prof.at(z, sec);
      for (let j = 0; j < nU; j++) sectionPoint(sec, (j + 0.5) / nU, out, j * 2);
    },
    capStart: capStart ? 'flat' : 'none',
    capEnd: capEnd ? 'flat' : 'none',
    uv: 'none',
  });
}

const boxy = (cy: number, hw: number, ht: number, hb: number, n = 7): Section => ({
  ...sym(cy, hw, ht, hb, n, n),
});

// ───────────────────────────────────────────────────────────── units

function sam(b: B, p: Palette): void {
  paint(b, PAINT.dark, p.body);
  rbox(b, [0, 1.25, 0.2], [1.25, 0.32, 5.1]);
  // cab with windscreen
  hull(
    b,
    [
      { z: -5.5, s: boxy(2.05, 1.2, 0.72, 0.72) },
      { z: -4.4, s: boxy(2.05, 1.25, 0.78, 0.78) },
      { z: -3.3, s: boxy(2.05, 1.25, 0.78, 0.78) },
    ],
    16,
    0.6,
  );
  paint(b, PAINT.gloss, GLASS);
  rbox(b, [0, 2.4, -5.5], [1.0, 0.28, 0.02], -0.25);
  for (const z of [-3.9, -2.3, 1.7, 3.3]) {
    for (const sx of [-1, 1]) wheel(b, [sx * 1.25, 0.62, z], 0.62, 0.42);
  }
  // equipment lockers and generator
  paint(b, PAINT.dark, p.body2);
  rbox(b, [0, 1.95, -2.4], [1.15, 0.4, 0.55]);
  rbox(b, [1.05, 1.8, 0.5], [0.2, 0.25, 1.2]);
  // erector with four canisters, pitched up around the rear pivot
  const v0 = b.vertexCount;
  paint(b, PAINT.dark, p.body);
  for (const [x, y] of [
    [-0.42, 0.42],
    [0.42, 0.42],
    [-0.42, 1.22],
    [0.42, 1.22],
  ] as const) {
    solid(
      b,
      [x, y, -3.6],
      [
        [-3.6, 0.38],
        [-3.5, 0.4],
        [3.5, 0.4],
        [3.6, 0.38],
      ],
      14,
      'z',
    );
  }
  paint(b, PAINT.interior, DARK);
  for (const [x, y] of [
    [-0.42, 0.42],
    [0.42, 0.42],
    [-0.42, 1.22],
    [0.42, 1.22],
  ] as const) {
    cylinder(b, [x, y, -7.21], 0.33, 0.02, 'z', 12);
  }
  paint(b, PAINT.dark, p.body2);
  rbox(b, [0, 0.0, -3.6], [0.95, 0.1, 3.4]);
  b.transform(v0, rotation([1, 0, 0], 0.5), [0, 0, 0], [0, 1.72, 4.9]);
  // radar mast behind the cab
  paint(b, PAINT.metal, METAL);
  cylinder(b, [0, 4.6, -3.1], 0.1, 4.2, 'y', 8);
  paint(b, PAINT.dark, p.body2);
  rbox(b, [0, 6.9, -3.1], [0.95, 0.65, 0.09], 0.2);
}

function aaa(b: B, p: Palette): void {
  paint(b, PAINT.dark, p.body);
  hull(
    b,
    [
      { z: -3.5, s: boxy(1.05, 1.55, 0.2, 0.45) },
      { z: -2.7, s: boxy(1.15, 1.6, 0.55, 0.5) },
      { z: 3.2, s: boxy(1.15, 1.6, 0.55, 0.5) },
      { z: 3.5, s: boxy(1.15, 1.6, 0.45, 0.45) },
    ],
    16,
    0.8,
  );
  paint(b, PAINT.dark, p.body2);
  for (const sx of [-1, 1]) rbox(b, [sx * 1.62, 0.95, 0], [0.12, 0.35, 3.3]);
  for (const z of [-2.6, -1.3, 0, 1.3, 2.6]) {
    for (const sx of [-1, 1]) wheel(b, [sx * 1.4, 0.42, z], 0.36, 0.3);
  }
  paint(b, PAINT.rubber, 0x252624);
  for (const sx of [-1, 1]) rbox(b, [sx * 1.4, 0.08, 0], [0.24, 0.07, 3.1]);
  // turret
  paint(b, PAINT.dark, p.body);
  hull(
    b,
    [
      { z: -1.3, s: boxy(2.15, 1.0, 0.35, 0.45, 4) },
      { z: -0.6, s: boxy(2.2, 1.25, 0.55, 0.45, 5) },
      { z: 1.2, s: boxy(2.2, 1.25, 0.55, 0.45, 5) },
      { z: 1.6, s: boxy(2.15, 1.1, 0.45, 0.45, 5) },
    ],
    14,
    0.5,
  );
  // twin cannons on the turret cheeks, slightly elevated
  const v0 = b.vertexCount;
  paint(b, PAINT.metal, METAL);
  for (const sx of [-1, 1]) {
    cylinder(b, [sx * 1.42, 0, -1.2], 0.2, 1.4, 'z', 10);
    cylinder(b, [sx * 1.42, 0, -3.4], 0.07, 3.2, 'z', 8);
    cylinder(b, [sx * 1.42, 0, -5.0], 0.11, 0.3, 'z', 8);
  }
  b.transform(v0, rotation([1, 0, 0], 0.26), [0, 0, 0], [0, 2.3, 0]);
  // search radar dish on a post at the turret rear
  paint(b, PAINT.dark, p.body2);
  cylinder(b, [0, 3.05, 1.2], 0.07, 0.8, 'y', 8);
  dish(b, [0, 3.55, 1.25], 0.65, 0.18, 2.9);
}

/** Paraboloid dish (open, both faces) facing along -z, then pitched up by `pitch` rad. */
function dish(b: B, c: Vec3, r: number, depth: number, pitch: number): void {
  const v0 = b.vertexCount;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    prof.push([-depth * (1 - u) * (1 - u), Math.max(r * (1 - u), 0.01)]);
  }
  lathe(b, prof, 16, {});
  lathe(
    b,
    prof.map(([z, rr]) => [z + 0.02, rr] as [number, number]),
    16,
    { flip: true },
  );
  b.transform(v0, rotation([1, 0, 0], pitch), [0, 0, 0]);
  b.translate(v0, c[0], c[1], c[2]);
}

function radar(b: B, p: Palette): void {
  paint(b, PAINT.dark, p.body);
  hull(
    b,
    [
      { z: -3.1, s: boxy(2.0, 1.25, 1.25, 1.1, 9) },
      { z: 3.1, s: boxy(2.0, 1.25, 1.25, 1.1, 9) },
    ],
    16,
    3,
  );
  paint(b, PAINT.dark, p.body2);
  rbox(b, [0, 0.72, 0.3], [1.1, 0.2, 2.9]);
  for (const z of [1.4, 2.5]) for (const sx of [-1, 1]) wheel(b, [sx * 1.2, 0.5, z], 0.5, 0.36);
  for (const [x, z] of [
    [-1.3, -2.6],
    [1.3, -2.6],
  ] as const) {
    paint(b, PAINT.metal, METAL);
    cylinder(b, [x, 0.45, z], 0.08, 0.9, 'y', 6);
    rbox(b, [x, 0.03, z], [0.25, 0.03, 0.25]);
  }
  paint(b, PAINT.gloss, GLASS);
  rbox(b, [1.26, 2.5, -1.8], [0.02, 0.3, 0.5]);
  // pedestal and dish with feed horn
  paint(b, PAINT.metal, 0x55585a);
  cylinder(b, [0, 3.75, -0.6], 0.38, 1.1, 'y', 12);
  paint(b, PAINT.dark, 0xb9b8b0);
  dish(b, [0, 5.6, -0.8], 2.6, 0.9, 0.38);
  paint(b, PAINT.metal, METAL);
  tube(
    b,
    [
      [0, 5.6, -0.8],
      [0, 5.6 + 0.55, -0.8 - 1.45],
    ],
    0.06,
    6,
  );
  for (const [x, y] of [
    [-1.9, 5.0],
    [1.9, 5.0],
    [0, 7.5],
  ] as const) {
    tube(
      b,
      [
        [x, y + 0.2, -0.8 + 0.4],
        [0, 5.6 + 0.55, -0.8 - 1.45],
      ],
      0.03,
      4,
    );
  }
}

function hangar(b: B, p: Palette): void {
  const W = 18;
  const H = 12.5;
  const L = 23;
  const nU = 24;
  const sec = sym(0, W, H, 0.01, 2.2, 2.2);
  const ring = (lift: number) => (_z: number, out: Float64Array) => {
    for (let j = 0; j < nU; j++) {
      sectionPoint(
        { ...sec, wl: W + lift, wr: W + lift, ht: H + lift },
        -0.25 + (0.5 * j) / (nU - 1),
        out,
        j * 2,
      );
    }
  };
  paint(b, PAINT.dark, p.concrete);
  const P = loft(b, { zs: stationList(-L, L, 4), nU, ring: ring(0), open: true, uv: 'none' });
  paint(b, PAINT.interior, 0x3a3b3a);
  loft(b, {
    zs: stationList(-L + 0.3, L - 0.3, 6),
    nU,
    ring: ring(-0.5),
    open: true,
    flip: true,
    uv: 'none',
  });
  // rear wall and front wall
  const nI = P.length / (nU * 3);
  paint(b, PAINT.dark, p.concrete);
  for (const [i, dir] of [
    [nI - 1, 1],
    [0, -1],
  ] as const) {
    const pts = new Float64Array(nU * 3);
    for (let j = 0; j < nU * 3; j++) pts[j] = P[i * nU * 3 + j]!;
    capFan(b, pts, nU, [0, 0, dir * L], [0, 0, dir]);
  }
  // doorway (dark recess face) and door rails
  paint(b, PAINT.interior, 0x16181a);
  rbox(b, [0, 5.0, -L - 0.06], [13.5, 5.0, 0.05]);
  paint(b, PAINT.metal, 0x575a5c);
  rbox(b, [0, 10.15, -L - 0.2], [14.5, 0.18, 0.18]);
  // arch ribs
  paint(b, PAINT.dark, p.concrete);
  const tmp = new Float64Array(2);
  for (const z of [-L + 0.4, -12, 0, 12, L - 0.4]) {
    const path: [number, number, number][] = [];
    for (let j = 0; j <= 16; j++) {
      sectionPoint({ ...sec, wl: W + 0.2, wr: W + 0.2, ht: H + 0.2 }, -0.25 + (0.5 * j) / 16, tmp, 0);
      path.push([tmp[0]!, tmp[1]!, z]);
    }
    tube(b, path, 0.3, 6);
  }
}

function fuel(b: B, p: Palette): void {
  const tanks: [number, number][] = [
    [-8.5, -6],
    [8.5, -6],
    [0, 8],
  ];
  for (const [x, z] of tanks) {
    paint(b, PAINT.dark, p.tank);
    solid(
      b,
      [x, 0, z],
      [
        [0, 6],
        [8.4, 6],
        [8.6, 5.9],
        [9.6, 0.6],
        [9.7, 0.01],
      ],
      24,
      'y',
      false,
    );
    paint(b, PAINT.dark, 0x6f6f6a);
    cylinder(b, [x, 4.2, z], 6.03, 0.4, 'y', 24);
    paint(b, PAINT.metal, METAL);
    tube(
      b,
      [
        [x + 6.02, 0.2, z],
        [x + 6.02, 8.6, z],
      ],
      0.08,
      5,
    );
  }
  // bund walls
  paint(b, PAINT.dark, p.concrete);
  rbox(b, [0, 0.6, -15.5], [19, 0.6, 0.35]);
  rbox(b, [0, 0.6, 17.5], [19, 0.6, 0.35]);
  rbox(b, [-19, 0.6, 1], [0.35, 0.6, 16.5]);
  rbox(b, [19, 0.6, 1], [0.35, 0.6, 16.5]);
  // manifold pipes and pump house
  paint(b, PAINT.metal, 0x5c5f58);
  tube(
    b,
    [
      [-8.5, 0.5, -6],
      [0, 0.5, -1],
      [8.5, 0.5, -6],
    ],
    0.3,
    8,
  );
  tube(
    b,
    [
      [0, 0.5, -1],
      [0, 0.5, 8],
    ],
    0.3,
    8,
  );
  tube(
    b,
    [
      [0, 0.5, -1],
      [0, 0.5, -19],
    ],
    0.3,
    8,
  );
  paint(b, PAINT.dark, p.body2);
  rbox(b, [14, 1.4, -11], [2.2, 1.4, 1.8]);
}

function command(b: B, p: Palette): void {
  paint(b, PAINT.dark, p.concrete);
  hull(
    b,
    [
      { z: -8, s: { ...sym(0, 7.5, 3.6, 0.05, 3.2, 3), wl: 7.5, wr: 7.5 } },
      { z: -6.5, s: { ...sym(0, 8.5, 4.4, 0.05, 3.4, 3), wl: 8.5, wr: 8.5 } },
      { z: 6.5, s: { ...sym(0, 8.5, 4.4, 0.05, 3.4, 3), wl: 8.5, wr: 8.5 } },
      { z: 8, s: { ...sym(0, 7.5, 3.6, 0.05, 3.2, 3), wl: 7.5, wr: 7.5 } },
    ],
    24,
    1.5,
  );
  paint(b, PAINT.interior, DARK);
  rbox(b, [0, 1.3, -8.02], [1.6, 1.3, 0.05]);
  paint(b, PAINT.dark, p.concrete);
  rbox(b, [-3.2, 1.2, -9.5], [0.35, 1.2, 1.6]);
  rbox(b, [3.2, 1.2, -9.5], [0.35, 1.2, 1.6]);
  // masts with yards and a satellite dish
  paint(b, PAINT.metal, 0x6a6d6f);
  for (const [x, z, h] of [
    [-4, 3, 17],
    [5, -2, 13],
  ] as const) {
    tube(
      b,
      [
        [x, 3.8, z],
        [x, 3.8 + h, z],
      ],
      [0.16, 0.07],
      6,
    );
    tube(
      b,
      [
        [x - 1.4, 3.8 + h * 0.8, z],
        [x + 1.4, 3.8 + h * 0.8, z],
      ],
      0.05,
      4,
    );
  }
  for (const [x, z] of [
    [2, 5],
    [-6, -4],
    [6.5, 4],
  ] as const) {
    tube(
      b,
      [
        [x, 4.2, z],
        [x, 8.5, z],
      ],
      0.035,
      4,
    );
  }
  paint(b, PAINT.dark, 0xb8b7b0);
  cylinder(b, [0.5, 4.6, 3.5], 0.12, 0.9, 'y', 8);
  dish(b, [0.5, 5.4, 3.5], 1.3, 0.35, 0.75);
}

function bunker(b: B, p: Palette): void {
  paint(b, PAINT.dark, p.concrete);
  hull(
    b,
    [
      { z: -6, s: { ...sym(0, 5.0, 3.0, 0.05, 2.6, 3), wl: 5.0, wr: 5.0 } },
      { z: -5.4, s: { ...sym(0, 5.6, 3.4, 0.05, 2.8, 3), wl: 5.6, wr: 5.6 } },
      { z: 5.4, s: { ...sym(0, 5.6, 3.4, 0.05, 2.8, 3), wl: 5.6, wr: 5.6 } },
      { z: 6, s: { ...sym(0, 5.0, 3.0, 0.05, 2.6, 3), wl: 5.0, wr: 5.0 } },
    ],
    20,
    1.5,
  );
  paint(b, PAINT.interior, DARK);
  rbox(b, [0, 1.75, -5.98], [1.9, 0.22, 0.05]);
  paint(b, PAINT.dark, p.concrete);
  rbox(b, [-4.0, 1.0, -7.2], [0.4, 1.0, 1.3], 0, 0.35);
  rbox(b, [4.0, 1.0, -7.2], [0.4, 1.0, 1.3], 0, -0.35);
  rbox(b, [0, 0.12, 0], [6.2, 0.12, 6.6]);
}

function ship(b: B): void {
  const GREY = 0x636b72;
  const hullStations = [
    { z: -55, hw: 0.35, deck: 7.0, draft: 2.6, nb: 1.2 },
    { z: -50, hw: 2.4, deck: 6.7, draft: 3.6, nb: 1.3 },
    { z: -40, hw: 4.8, deck: 6.1, draft: 4.0, nb: 1.5 },
    { z: -25, hw: 6.5, deck: 5.5, draft: 4.2, nb: 1.9 },
    { z: 0, hw: 7.0, deck: 5.1, draft: 4.3, nb: 2.4 },
    { z: 30, hw: 6.8, deck: 5.0, draft: 3.8, nb: 2.6 },
    { z: 50, hw: 6.1, deck: 5.1, draft: 2.2, nb: 3.0 },
    { z: 55, hw: 5.7, deck: 5.2, draft: 1.3, nb: 3.2 },
  ];
  const upper = new Profile(
    hullStations.map((h) => ({ z: h.z, s: { ...sym(0, h.hw, h.deck, h.draft, 7, h.nb) } })),
  );
  const nU = 18;
  const sec = makeSection();
  const zs = stationList(-55, 55, 3, 1, 8, 0);
  // topsides (grey) and underwater hull (anti-fouling red), split exactly at the waterline
  for (const [t0, t1, tint] of [
    [-0.25, 0.25, GREY],
    [0.25, 0.75, 0x6a2d25],
  ] as const) {
    paint(b, PAINT.dark, tint);
    loft(b, {
      zs,
      nU,
      open: true,
      uv: 'none',
      ring: (z, out) => {
        upper.at(z, sec);
        for (let j = 0; j < nU; j++) sectionPoint(sec, t0 + ((t1 - t0) * j) / (nU - 1), out, j * 2);
      },
    });
  }
  // transom
  paint(b, PAINT.dark, GREY);
  const tr = new Float64Array(nU * 2 * 3);
  upper.at(55, sec);
  const tmp = new Float64Array(2);
  for (let j = 0; j < nU * 2; j++) {
    sectionPoint(sec, j / (nU * 2), tmp, 0);
    tr[j * 3] = tmp[0]!;
    tr[j * 3 + 1] = tmp[1]!;
    tr[j * 3 + 2] = 55;
  }
  capFan(b, tr, nU * 2, [0, 1.5, 55], [0, 0, 1]);
  // deck plating (darker non-skid) just above the hull top
  paint(b, PAINT.dark, 0x4a4f54);
  const D = new Float64Array(zs.length * 2 * 3);
  zs.forEach((z, i) => {
    upper.at(z, sec);
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      D[o] = (k === 0 ? -1 : 1) * sec.wr * 0.86;
      D[o + 1] = sec.ht + 0.04;
      D[o + 2] = z;
    }
  });
  gridSurface(b, D, zs.length, 2);
  // superstructure: bridge block, hangar block
  paint(b, PAINT.dark, GREY);
  hull(
    b,
    [
      { z: -16, s: boxy(8.0, 5.2, 3.0, 3.0, 8) },
      { z: -2, s: boxy(8.0, 6.0, 3.0, 3.0, 8) },
    ],
    16,
    7,
  );
  hull(
    b,
    [
      { z: -13, s: boxy(12.3, 4.2, 1.4, 1.4, 8) },
      { z: -5, s: boxy(12.3, 4.6, 1.4, 1.4, 8) },
    ],
    16,
    4,
  );
  hull(
    b,
    [
      { z: 6, s: boxy(8.2, 5.8, 3.2, 3.2, 8) },
      { z: 24, s: boxy(8.2, 5.8, 3.2, 3.2, 8) },
    ],
    16,
    9,
  );
  paint(b, PAINT.gloss, GLASS);
  rbox(b, [0, 12.6, -13.05], [3.9, 0.55, 0.05], 0.2);
  // mast, yard, radar
  paint(b, PAINT.dark, 0x8b9299);
  const mv = b.vertexCount;
  hull(
    b,
    [
      { z: 13.6, s: boxy(0, 1.4, 1.4, 1.4, 5) },
      { z: 26, s: boxy(0, 0.55, 0.55, 0.55, 5) },
    ],
    12,
    6,
  );
  fixMast(b, mv, b.vertexCount);
  paint(b, PAINT.metal, 0x5e6468);
  tube(
    b,
    [
      [-4.5, 21.5, -8],
      [4.5, 21.5, -8],
    ],
    0.12,
    5,
  );
  paint(b, PAINT.dark, 0x9aa1a7);
  rbox(b, [0, 27.2, -8], [1.6, 0.9, 0.15]);
  // funnel
  paint(b, PAINT.dark, GREY);
  hull(
    b,
    [
      { z: 2, s: boxy(15.5, 1.7, 3.2, 3.2, 3) },
      { z: 7.5, s: boxy(15.0, 1.5, 2.8, 2.8, 3) },
    ],
    12,
    3,
  );
  paint(b, PAINT.interior, 0x202224);
  rbox(b, [0, 18.35, 4.6], [1.35, 0.1, 2.3]);
  // main gun
  paint(b, PAINT.dark, GREY);
  solid(
    b,
    [0, 6.1, -38],
    [
      [0, 1.8],
      [1.2, 1.6],
      [1.9, 0.9],
      [2.0, 0.01],
    ],
    16,
    'y',
    false,
  );
  paint(b, PAINT.metal, METAL);
  const gv = b.vertexCount;
  cylinder(b, [0, 0, -2.9], 0.14, 5.2, 'z', 8);
  b.transform(gv, rotation([1, 0, 0], 0.08), [0, 0, 0], [0, 7.1, -38.6]);
  // vertical launch cells
  paint(b, PAINT.dark, 0x60666b);
  rbox(b, [0, 6.3, -27], [2.6, 0.25, 2.6]);
  paint(b, PAINT.interior, 0x2b2e31);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) rbox(b, [-1.8 + i * 1.2, 6.56, -28.8 + j * 1.2], [0.48, 0.02, 0.48]);
  }
  // close-in weapon system on the hangar roof and a flight-deck marking circle
  paint(b, PAINT.dark, 0xd9dcdc);
  cylinder(b, [0, 12.2, 20], 0.9, 1.4, 'y', 12);
  solid(
    b,
    [0, 12.9, 20],
    [
      [0, 0.9],
      [0.8, 0.6],
      [1.2, 0.01],
    ],
    12,
    'y',
    false,
  );
  paint(b, PAINT.dark, 0xc9ccc4);
  rbox(b, [0, 5.18, 40], [0.12, 0.02, 9]);
}

/** Turns geometry lofted along z (used as height) upright over the bridge: (x, y, z) -> (x, z, -8 - y). */
function fixMast(b: B, from: number, to: number): void {
  for (let v = from; v < to; v++) {
    const x = b.pos[v * 3]!;
    const y = b.pos[v * 3 + 1]!;
    const z = b.pos[v * 3 + 2]!;
    b.pos[v * 3] = x;
    b.pos[v * 3 + 1] = z;
    b.pos[v * 3 + 2] = -8 - y;
    const ny = b.nrm[v * 3 + 1]!;
    const nz = b.nrm[v * 3 + 2]!;
    b.nrm[v * 3 + 1] = nz;
    b.nrm[v * 3 + 2] = -ny;
  }
}

const BUILDERS: Record<GroundTargetKind, (b: B, p: Palette) => void> = {
  sam,
  aaa,
  radar,
  hangar,
  fuel,
  command,
  bunker,
  ship: (b) => ship(b),
};

export function buildGroundGeometry(kind: GroundTargetKind, desert: boolean): MeshBuilder {
  const b = new MeshBuilder();
  BUILDERS[kind](b, desert ? DESERT : TEMPERATE);
  return b;
}

const geoCache = new Map<string, BufferGeometry>();

export function groundGeometry(kind: GroundTargetKind, desert: boolean): BufferGeometry {
  const key = `${kind}|${desert ? 'd' : 't'}`;
  let g = geoCache.get(key);
  if (!g) {
    g = buildGroundGeometry(kind, desert).toGeometry({ skin: false });
    geoCache.set(key, g);
  }
  return g;
}

export function disposeGroundCache(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}

export function makeGroundUnit(kind: GroundTargetKind, desert: boolean, material: Material): Object3D {
  const root = new Group();
  root.name = `ground-${kind}`;
  const mesh = new Mesh(groundGeometry(kind, desert), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.userData.groundKind = kind;
  return root;
}

/** Turns a unit into its wreck: scorched material, slumped and tilted pose. Idempotent. */
export function wreckGroundUnit(obj: Object3D, wreckMaterial: Material): void {
  if (obj.userData.wrecked === true) return;
  obj.userData.wrecked = true;
  const kind = obj.userData.groundKind as GroundTargetKind | undefined;
  obj.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).material = wreckMaterial;
  });
  const first = obj.children[0];
  if (!first) return;
  if (kind === 'ship') {
    first.position.y -= 3.2;
    first.rotation.z += 0.14;
    first.rotation.x -= 0.03;
  } else if (kind === 'hangar' || kind === 'fuel' || kind === 'command' || kind === 'bunker') {
    first.scale.y *= 0.55;
  } else {
    first.position.y -= 0.25;
    first.rotation.z += 0.09;
    first.rotation.x -= 0.05;
  }
}

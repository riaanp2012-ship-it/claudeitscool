import { Vector2, Vector3, Vector4 } from 'three';
import { Rng } from '../../core/rng';
import { catmullRom, fromLocal, type P2 } from '../geom2d';
import { srgb, type StructureBuilder } from '../structures';
import type { AirbaseDef, FlatRect, MapDef, TargetDef, TaxiwayDef } from './types';

/**
 * Kessel Strait: chalk-cliffed mainland to the north with an airbase on the downs, a harbor town where a river
 * valley breaks the cliffs, a lighthouse on the headland, green islands across the strait and a far southern
 * shore. 15:00, fair weather, scattered cumulus.
 */

const DEG = Math.PI / 180;

// Mainland coastline (west to east), land to the north (smaller z).
const COAST: P2[] = [
  [-60000, -1500],
  [-30000, -1800],
  [-20000, -2300],
  [-15000, -3400],
  [-11500, -2500],
  [-8500, -3200],
  [-5000, -3650],
  [-2500, -3000],
  [-600, -2550],
  [500, -2150],
  [1500, -2650],
  [3500, -3350],
  [5100, -3850],
  [5900, -4550],
  [6800, -4380],
  [7800, -3650],
  [10000, -3050],
  [13000, -2350],
  [16000, -2800],
  [20000, -3500],
  [30000, -4400],
  [60000, -5200],
];

// River valley behind the harbor (coast to inland).
const VALLEY: P2[] = [
  [6300, -3900],
  [6450, -5600],
  [6900, -7600],
  [6700, -9800],
  [6100, -12500],
  [5200, -15500],
  [4600, -19000],
];

// Islands: center, radii, rotation (deg), peak (m), cliffiness.
const ISLANDS: [number, number, number, number, number, number, number][] = [
  [2800, 5200, 2700, 1300, 20, 310, 0.7],
  [-8600, 3000, 1350, 820, -30, 175, 0.5],
  [-3800, 9500, 820, 660, 0, 115, 0.3],
  [10100, 2500, 1150, 700, 45, 150, 0.6],
  [12600, 9300, 2300, 1350, -15, 245, 0.5],
  [-13200, 11100, 1850, 1100, 10, 195, 0.4],
  [-600, 12600, 1000, 620, 70, 95, 0.2],
  [-1850, -1650, 170, 140, 0, 64, 1.0],
  [1350, -1480, 130, 110, 30, 48, 1.0],
  [7300, 1500, 230, 170, 60, 72, 0.9],
];

const AIR_ELEV = 92;
const MAIN = { x: -6300, z: -8400, heading: 70 * DEG, length: 2900, width: 45 };
const CROSS_C = fromLocal(MAIN.x, MAIN.z, MAIN.heading, 620, 0);
const CROSS_H = 130 * DEG;
const CROSS = {
  x: CROSS_C[0] + Math.sin(CROSS_H) * 560,
  z: CROSS_C[1] - Math.cos(CROSS_H) * 560,
  heading: CROSS_H,
  length: 2100,
  width: 45,
};

const L = (u: number, v: number): P2 => fromLocal(MAIN.x, MAIN.z, MAIN.heading, u, v);
const LC = (u: number, v: number): P2 => fromLocal(CROSS.x, CROSS.z, CROSS.heading, u, v);

const APRON = { c: L(-420, -330), length: 700, width: 150 };
const TAXIWAYS: TaxiwayDef[] = [
  {
    points: [L(-1440, 0), L(-1440, -175), L(-420, -175), L(600, -175), L(1440, -175), L(1440, 0)],
    width: 23,
  },
  { points: [L(-420, -175), L(-420, -255)], width: 23 },
  { points: [L(250, -175), L(250, -255)], width: 23 },
  { points: [L(-1000, -175), L(-1000, 0)], width: 23 },
  { points: [L(700, -175), L(700, 0)], width: 23 },
  { points: [LC(-1050, 0), LC(-1050, -160), LC(-420, -160)], width: 23 },
  { points: [LC(1050, 0), LC(1050, 160), LC(400, 160), LC(400, 0)], width: 23 },
  // Dispersal loop with shelters at the west end.
  { points: [L(-1440, -175), L(-1700, -420), L(-1500, -700), L(-1150, -640), L(-900, -330)], width: 18 },
];

const AIRBASE: AirbaseDef = {
  name: 'Kessel Air Base',
  elevation: AIR_ELEV,
  runways: [
    { id: 'kessel-07', ...MAIN },
    { id: 'kessel-13', ...CROSS },
  ],
  taxiways: TAXIWAYS,
  aprons: [
    { x: APRON.c[0], z: APRON.c[1], heading: MAIN.heading, length: APRON.length, width: APRON.width },
    { x: L(-1180, -520)[0], z: L(-1180, -520)[1], heading: MAIN.heading, length: 160, width: 60 },
  ],
  grounds: {
    x: L(-150, -150)[0],
    z: L(-150, -150)[1],
    heading: MAIN.heading,
    halfLength: 1850,
    halfWidth: 1050,
    falloff: 250,
    elevation: AIR_ELEV,
  },
};

const HARBOR = { x: 6250, z: -4380 };

const FLATS: FlatRect[] = [
  {
    x: MAIN.x,
    z: MAIN.z,
    heading: MAIN.heading,
    halfLength: 1700,
    halfWidth: 330,
    falloff: 520,
    elevation: AIR_ELEV,
  },
  {
    x: CROSS.x,
    z: CROSS.z,
    heading: CROSS.heading,
    halfLength: 1250,
    halfWidth: 260,
    falloff: 520,
    elevation: AIR_ELEV,
  },
  {
    x: L(-1150, -520)[0],
    z: L(-1150, -520)[1],
    heading: MAIN.heading,
    halfLength: 650,
    halfWidth: 420,
    falloff: 450,
    elevation: AIR_ELEV,
  },
  {
    x: HARBOR.x,
    z: HARBOR.z - 170,
    heading: 8 * DEG,
    halfLength: 250,
    halfWidth: 520,
    falloff: 260,
    elevation: 3.2,
  },
];

const road = (pts: P2[]): P2[] => catmullRom(pts, 60);

const ROADS: P2[][] = [
  // Coast road: harbor to the lighthouse headland.
  road([
    [6150, -4750],
    [4900, -4450],
    [3300, -4000],
    [1700, -3300],
    [700, -2560],
  ]),
  // Valley road north.
  road([
    [6200, -4700],
    [6650, -6000],
    [7050, -7800],
    [6850, -9900],
    [6300, -12400],
    [5500, -15600],
    [5000, -19500],
  ]),
  // Downs road to the airbase gate.
  road([
    [3300, -4000],
    [1600, -5400],
    [-1000, -6500],
    [-2200, -7050],
    [-3900, -8200],
    L(260, -900),
    L(-200, -700),
  ]),
  // Village road north.
  road([
    [-2200, -7050],
    [-2600, -9400],
    [-1900, -12000],
    [-1500, -14500],
    [-2300, -19500],
  ]),
  // West coast lane past the base.
  road([L(-1300, -1000), [-9300, -8500], [-10400, -6200], [-11900, -4300], [-14800, -4200], [-19500, -3900]]),
  // East coast road.
  road([
    [7050, -7800],
    [9200, -5600],
    [12500, -4000],
    [16000, -4600],
    [20000, -5200],
  ]),
];

const VILLAGES: [number, number, number, number][] = [
  // x, z, radius, houses
  [-2250, -7150, 260, 18],
  [6950, -9150, 230, 14],
  [-11850, -4550, 200, 10],
  [-1750, -13700, 220, 12],
  [12500, -4150, 220, 12],
];

const KESSEL_GLSL = /* glsl */ `
uniform vec2 uCoast[${COAST.length}];
uniform vec2 uValley[${VALLEY.length}];
uniform vec4 uIsleA[${ISLANDS.length}];
uniform vec4 uIsleB[${ISLANDS.length}];

// Signed distance to the mainland coast: positive inland (north).
float coastSd(vec2 p) {
  float d = 1e9;
  float cz = p.x < uCoast[0].x ? uCoast[0].y : uCoast[${COAST.length - 1}].y;
  for (int i = 0; i < ${COAST.length - 1}; i++) {
    vec2 a = uCoast[i];
    vec2 b = uCoast[i + 1];
    d = min(d, nzSdSegment(p, a, b));
    if (p.x >= a.x && p.x < b.x) cz = mix(a.y, b.y, (p.x - a.x) / (b.x - a.x));
  }
  return p.y < cz ? d : -d;
}

vec2 valleyDist(vec2 p) {
  float d = 1e9;
  float s = 0.0;
  float acc = 0.0;
  for (int i = 0; i < ${VALLEY.length - 1}; i++) {
    vec2 a = uValley[i];
    vec2 b = uValley[i + 1];
    vec2 ba = b - a;
    float l = length(ba);
    float h = clamp(dot(p - a, ba) / (l * l), 0.0, 1.0);
    float di = length(p - a - ba * h);
    if (di < d) { d = di; s = acc + h * l; }
    acc += l;
  }
  return vec2(d, s);
}

// Coastal profile: d meters inland (negative offshore), H land height, cliff 0..1.
float coastProfile(float d, float H, float cliff, float n) {
  if (d < 0.0) {
    float shelf = mix(0.02, 0.2, cliff);
    float near = d * shelf;
    float deep = -4.0 - 58.0 * (1.0 - exp(d / 1700.0)) + n * 6.0;
    return max(min(near, -0.6), deep);
  }
  float plat = mix(70.0, 26.0, cliff);
  if (d < plat) return mix(-0.6, 1.4, d / plat);
  float x = d - plat;
  float w = mix(900.0, 58.0, cliff);
  float t = smoothstep(0.0, w, x);
  t = mix(t, sqrt(t), cliff);
  return mix(1.4, H, t);
}

vec4 mapSample(vec2 p) {
  vec2 pw = p + nzWarp(p / 3400.0, 420.0, 4) + nzWarp(p / 650.0, 55.0, 3);
  float n = nzFbm(p / 1300.0 + 9.0, 4);

  // Mainland.
  vec2 vd = valleyDist(p + nzWarp(p / 1500.0, 160.0, 3));
  float dMain = coastSd(pw);
  float inland = max(dMain, 0.0);
  // Chalk downs: broad swells cut by a network of dry valleys (coombes), rising to hills in the north.
  vec3 hillsD = nzFbmD(p / 5200.0 + 5.0, 6);
  float downs = hillsD.x * 0.5 + 0.5;
  float eroded = nzEroded(p / 2400.0 - 3.0, 8);
  vec2 cw = p + nzWarp(p / 2600.0, 520.0, 3);
  float coombe = pow(nzRidged(cw / 3900.0 + 7.0, 3), 2.4);
  float north = smoothstep(7000.0, 21000.0, inland);
  float ridges = nzRidged(pw / 8500.0 + 1.7, 7);
  float Hm = 52.0 + 22.0 * n + inland * 0.006 + downs * 150.0 + eroded * 48.0
    - coombe * 62.0 * smoothstep(150.0, 900.0, inland) + north * (ridges * 620.0 + 120.0);
  // The airfield sits on a naturally level stretch of the downs.
  float fieldMask = smoothstep(2900.0, 1100.0, distance(p, vec2(${(MAIN.x + 300).toFixed(1)}, ${(MAIN.z - 150).toFixed(1)})));
  Hm = mix(Hm, ${AIR_ELEV.toFixed(1)} + eroded * 10.0 + downs * 12.0 - 6.0, fieldMask);
  // Drainage gullies aligned with the downhill direction.
  vec2 grad = hillsD.yz * (150.0 * 0.5 / 5200.0) + vec2(0.0, 0.006);
  float gs = length(grad);
  vec2 flow = -grad / max(gs, 1e-5);
  float gully = nzGully(p / 190.0, flow).x * 0.7 + nzGully(p / 75.0, flow).x * 0.3;
  Hm += gully * 9.0 * smoothstep(0.004, 0.05, gs) * (0.5 + north);
  // River valley: carve a broad floor rising inland, and break the cliffs at its mouth.
  float vfloor = 2.0 + vd.y * 0.0042 + max(vd.y - 6000.0, 0.0) * 0.004;
  float vw = mix(260.0, 700.0, smoothstep(0.0, 9000.0, vd.y));
  float vcarve = 1.0 - smoothstep(vw * 0.35, vw * 1.6, vd.x);
  Hm = mix(Hm, min(Hm, vfloor + vd.x * 0.05), vcarve);
  float cliffM = smoothstep(0.38, 0.62, nzFbm(vec2(pw.x / 5200.0, 3.3), 3) * 0.5 + 0.62);
  cliffM *= smoothstep(500.0, 1500.0, distance(p, vec2(6250.0, -4450.0)));
  Hm *= mix(smoothstep(0.0, 1600.0, inland) * 0.6 + 0.4, 1.0, cliffM);

  // Far southern shore.
  float southZ = 17800.0 + 1300.0 * sin(pw.x / 6400.0 + 0.7) + 600.0 * sin(pw.x / 2100.0);
  float dSouth = pw.y - southZ;
  float Hs = 20.0 + max(dSouth, 0.0) * 0.012 + (nzEroded(p / 3100.0 + 17.0, 6) * 0.5 + 0.5) * 140.0
    + nzRidged(p / 7000.0, 5) * smoothstep(3000.0, 12000.0, dSouth) * 380.0;

  // Islands.
  float dIsle = -1e9;
  float Hi = 0.0;
  float cliffI = 0.0;
  vec2 pi = pw + nzWarp(p / 900.0, 170.0, 3);
  for (int i = 0; i < ${ISLANDS.length}; i++) {
    vec4 a = uIsleA[i];
    vec4 b = uIsleB[i];
    vec2 r = pi - a.xy;
    float ca = cos(b.x);
    float sa = sin(b.x);
    vec2 lp = vec2(ca * r.x + sa * r.y, -sa * r.x + ca * r.y);
    float e = length(lp / a.zw);
    float di = (1.0 - e) * min(a.z, a.w);
    if (di > dIsle) {
      dIsle = di;
      float core = clamp(1.0 - e, 0.0, 1.0);
      float lumps = nzEroded(p / 1400.0 + a.xy / 997.0, 7) * 0.5 + 0.5;
      float spine = nzRidged(pw / 1900.0 + a.xy / 1733.0, 5);
      Hi = b.y * pow(smoothstep(0.0, 1.0, core), 0.55) * (0.45 + 0.55 * lumps + 0.35 * spine) + 6.0;
      cliffI = b.z;
    }
  }

  // The landmass this point is most inside of wins; the sea floor follows the nearest coast.
  float d = dMain;
  float H = Hm;
  float cliff = cliffM;
  if (dSouth > d) { d = dSouth; H = Hs; cliff = 0.25; }
  if (dIsle > d) { d = dIsle; H = Hi; cliff = cliffI; }
  float h = coastProfile(d, H, cliff, n);
  // Small-scale roughness on land.
  h += nzFbm(p / 160.0, 4) * 2.2 * smoothstep(0.0, 60.0, d);
  vec2 fl = applyFlats(p, h);
  h = fl.x;

  // Forest potential: clustered woods, more inland, none on the salt-blown coast.
  float forest = 0.46 + 0.55 * nzFbm(p / 1500.0 + 11.0, 5) + 0.25 * north - 0.2 * fl.y;
  forest *= smoothstep(120.0, 650.0, d);
  forest += vcarve * 0.22 * smoothstep(1200.0, 3000.0, vd.y);
  // Farmland: the gentle downs and the southern shore, under 330 m.
  float farm = smoothstep(180.0, 700.0, d) * (1.0 - smoothstep(260.0, 360.0, h));
  farm *= smoothstep(-0.25, 0.1, nzFbm(p / 6500.0 + 23.0, 3));
  farm *= dIsle > d - 1.0 ? 0.25 : 1.0;
  return vec4(h, clamp(forest, 0.0, 1.0), clamp(farm, 0.0, 1.0), 0.0);
}
`;

function kesselUniforms() {
  return {
    uCoast: { value: COAST.map(([x, z]) => new Vector2(x, z)) },
    uValley: { value: VALLEY.map(([x, z]) => new Vector2(x, z)) },
    uIsleA: { value: ISLANDS.map((i) => new Vector4(i[0], i[1], i[2], i[3])) },
    uIsleB: { value: ISLANDS.map((i) => new Vector4(i[4] * DEG, i[5], i[6], 0)) },
  };
}

function build(b: StructureBuilder, heightAt: (x: number, z: number) => number): TargetDef[] {
  const targets: TargetDef[] = [];
  const rng = new Rng(4417);
  const hdg = MAIN.heading;

  // ── Airbase ──────────────────────────────────────────────────────────
  b.setRegion('airbase');
  const hangarShell = srgb(0x5d6660);
  const hangarDoor = srgb(0x3e4441);
  // Hangars along the north edge of the apron, doors facing the runway.
  for (let i = 0; i < 4; i++) {
    const [x, z] = L(-720 + i * 150, -455);
    b.archHangar(x, z, 44, 60, hdg + Math.PI / 2, hangarShell, hangarDoor);
    targets.push({ kind: 'hangar', x, z, heading: hdg + Math.PI, group: 'kessel-hangars' });
  }
  // Maintenance sheds.
  for (let i = 0; i < 3; i++) {
    const [x, z] = L(-160 + i * 70, -470);
    b.house(x, z, 40, 9, 26, hdg, srgb(0x7c7a70), srgb(0x4b4f4c), 0.15);
  }
  // Control tower: base block, shaft and glass cab.
  {
    const [x, z] = L(120, -380);
    const top = b.building(x, z, 16, 8, 16, hdg, srgb(0xb9b3a4));
    b.box(x, top, z, 7, 14, 7, hdg, srgb(0xc4bfb1));
    b.box(x, top + 14, z, 10, 4.2, 10, hdg, srgb(0x1c2a33));
    b.box(x, top + 18.2, z, 11, 0.8, 11, hdg, srgb(0x9a968c));
    b.cylinder(x + 2, top + 19, z, 0.15, 6, srgb(0x9a968c), 4);
    targets.push({ kind: 'command', x, z, heading: hdg, group: 'kessel-airbase' });
  }
  // Fuel farm: tanks inside an earth bund.
  {
    const [cx, cz] = L(-950, -760);
    for (let i = 0; i < 4; i++) {
      const [x, z] = fromLocal(cx, cz, hdg, (i % 2) * 38 - 19, Math.floor(i / 2) * 38 - 19);
      const y = heightAt(x, z) - 0.5;
      b.cylinder(x, y, z, 12, 11, srgb(0xc9c6bb), 20);
      b.dome(x, y + 11, z, 12, srgb(0xb8b5aa), 20, 0.18);
      targets.push({ kind: 'fuel', x, z, heading: 0, group: 'kessel-fuel' });
    }
    b.building(cx, cz, 104, 1.6, 104, hdg, srgb(0x6b6a4e));
  }
  // Hardened aircraft shelters on the dispersal loop.
  for (let i = 0; i < 4; i++) {
    const [x, z] = L(-1620 + i * 150, -760 + (i % 2) * 40);
    b.archHangar(x, z, 24, 34, hdg + Math.PI / 2 + (i % 2 ? 0.2 : -0.15), srgb(0x6f7466), srgb(0x3b3f3a));
    targets.push({ kind: 'hangar', x, z, heading: hdg + Math.PI / 2, group: 'kessel-shelters' });
  }
  // Barracks and admin blocks near the gate.
  for (let i = 0; i < 6; i++) {
    const [x, z] = L(200 + (i % 3) * 70, -640 - Math.floor(i / 3) * 55);
    b.house(x, z, 34, 7, 12, hdg + (i % 2) * 0.02, srgb(0xa29c8c), srgb(0x5a4a40), 0.25);
  }
  // Windsock and approach light bars at both ends of the main runway.
  for (const s of [-1, 1]) {
    for (let k = 1; k <= 8; k++) {
      const [x, z] = L(s * (MAIN.length / 2 + k * 30), 0);
      b.box(x, heightAt(x, z) - 0.5, z, 14, 1.8, 0.6, hdg + Math.PI / 2, srgb(0x3a3a38));
    }
  }
  b.box(...lift(L(-1250, 90), heightAt), 0.3, 7, 0.3, 0, srgb(0x9a9a9a));
  // Radar dome on the ridge north of the field.
  {
    const x = -7900;
    const z = -11600;
    const y = heightAt(x, z);
    b.building(x, z, 14, 5, 14, 0, srgb(0xa8a293));
    b.sphere(x, y + 12, z, 8.5, srgb(0xe4e2dc), 18);
    targets.push({ kind: 'radar', x, z, heading: 0, group: 'kessel-radar' });
  }
  // Air defence around the base.
  const sams: P2[] = [L(-2300, 900), L(1900, -1200), L(300, 1500)];
  sams.forEach(([x, z], i) => {
    samSite(b, x, z, heightAt);
    targets.push({ kind: 'sam', x, z, heading: i * 2.1, group: 'kessel-airbase-sams' });
  });
  const aaa: P2[] = [L(-1600, 420), L(1600, 420), L(-1650, -1000), L(1500, -800)];
  aaa.forEach(([x, z], i) => {
    const y = heightAt(x, z);
    b.cylinder(x, y - 0.5, z, 7, 2.2, srgb(0x6a6a52), 14);
    targets.push({ kind: 'aaa', x, z, heading: i * 1.6, group: 'kessel-airbase-aaa' });
  });

  // ── Harbor town ──────────────────────────────────────────────────────
  b.setRegion('town');
  const walls = [0xd8d2c4, 0xcfc6b2, 0xe6e1d6, 0xbfb6a3, 0xd9cdb8, 0xa9a08e];
  const roofs = [0x6e3b2e, 0x5a3328, 0x4a4b4f, 0x7a4a36, 0x3f4247];
  // Quay: a straight stone wall along the harbor front, and two breakwater arms enclosing the basin.
  const quayH = 3.2;
  b.box(HARBOR.x - 20, -6, HARBOR.z + 120, 440, quayH + 6, 24, 8 * DEG, srgb(0x8c877c));
  breakwater(b, [
    [HARBOR.x - 330, HARBOR.z + 60],
    [HARBOR.x - 380, HARBOR.z + 420],
    [HARBOR.x - 150, HARBOR.z + 640],
  ]);
  breakwater(b, [
    [HARBOR.x + 260, HARBOR.z + 90],
    [HARBOR.x + 330, HARBOR.z + 480],
    [HARBOR.x + 120, HARBOR.z + 700],
  ]);
  // Harbor light at the end of the east arm.
  b.cylinder(HARBOR.x + 120, 2, HARBOR.z + 700, 2.2, 9, srgb(0xc23a2a), 12);
  // Warehouses on the quay.
  for (let i = 0; i < 5; i++) {
    const x = HARBOR.x - 170 + i * 80;
    const z = HARBOR.z + 60 + (i % 2) * 12;
    b.house(x, z, 30, 9, 50, 8 * DEG, srgb(walls[(i + 2) % walls.length]!), srgb(0x55595a), 0.2);
  }
  targets.push({ kind: 'fuel', x: HARBOR.x + 330, z: HARBOR.z - 60, heading: 0, group: 'kessel-harbor' });
  for (let i = 0; i < 3; i++) {
    const x = HARBOR.x + 300 + i * 30;
    const z = HARBOR.z - 40 - (i % 2) * 30;
    const y = heightAt(x, z) - 0.5;
    b.cylinder(x, y, z, 11, 10, srgb(0xd0cdc2), 18);
  }
  // Moored boats in the basin.
  for (let i = 0; i < 9; i++) {
    const x = HARBOR.x - 250 + i * 55 + rng.range(-8, 8);
    const z = HARBOR.z + 175 + rng.range(0, 40);
    const len = rng.range(12, 26);
    const hh = rng.range(0, Math.PI * 0.1);
    b.box(x, -0.6, z, len * 0.32, 2.2, len, hh, srgb(rng.pick([0x2f4f6f, 0xe8e4dc, 0x8a2f25, 0x2c3a2f])));
    b.box(x, 1.6, z + len * 0.1, len * 0.22, 2.2, len * 0.3, hh, srgb(0xe6e2d8));
  }
  // Streets of terraced houses following the coast and climbing the valley.
  townAlong(
    b,
    rng,
    heightAt,
    road([
      [HARBOR.x - 460, HARBOR.z - 40],
      [HARBOR.x - 250, HARBOR.z - 30],
      [HARBOR.x + 260, HARBOR.z - 10],
      [HARBOR.x + 520, HARBOR.z + 30],
    ]),
    walls,
    roofs,
    2,
  );
  townAlong(b, rng, heightAt, ROADS[1]!.slice(0, 26), walls, roofs, 1);
  townAlong(b, rng, heightAt, ROADS[0]!.slice(0, 16), walls, roofs, 1);
  // Church with a spire on the valley side.
  {
    const x = HARBOR.x - 260;
    const z = HARBOR.z - 330;
    const top = b.building(x, z, 12, 11, 30, 8 * DEG, srgb(0xbdb6a6));
    b.gable(x, top, z, 12.8, 6, 30.8, 8 * DEG, srgb(0x4a4b4f));
    const [tx, tz] = fromLocal(x, z, 8 * DEG + Math.PI, 18, 0);
    const tt = b.building(tx, tz, 7, 20, 7, 8 * DEG, srgb(0xbdb6a6));
    b.cone(tx, tt, tz, 4.6, 16, srgb(0x3d3f42), 4);
  }
  targets.push({ kind: 'aaa', x: HARBOR.x - 520, z: HARBOR.z - 250, heading: 0, group: 'kessel-harbor' });
  targets.push({ kind: 'aaa', x: HARBOR.x + 600, z: HARBOR.z - 200, heading: 0, group: 'kessel-harbor' });

  // ── Villages and farms ──────────────────────────────────────────────
  b.setRegion('villages');
  for (const [vx, vz, vr, count] of VILLAGES) {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * vr;
      const x = vx + Math.cos(a) * r;
      const z = vz + Math.sin(a) * r;
      const heading = a + rng.pick([0, Math.PI / 2]) + rng.range(-0.1, 0.1);
      b.house(
        x,
        z,
        rng.range(7, 10),
        rng.range(5, 7),
        rng.range(9, 15),
        heading,
        srgb(rng.pick(walls)),
        srgb(rng.pick(roofs)),
      );
    }
  }
  // Farmsteads: house + barn pairs scattered over the downs near the roads.
  for (let i = 0; i < 26; i++) {
    const poly = ROADS[rng.int(0, ROADS.length - 1)]!;
    const pt = poly[rng.int(0, poly.length - 1)]!;
    const off = rng.range(90, 320) * rng.sign();
    const x = pt[0] + off;
    const z = pt[1] + rng.range(-150, 150);
    if (heightAt(x, z) < 8) continue;
    const heading = rng.range(0, Math.PI);
    b.house(x, z, 8, 5.5, 13, heading, srgb(rng.pick(walls)), srgb(rng.pick(roofs)));
    const [bx, bz] = fromLocal(x, z, heading, 4, 24);
    b.house(bx, bz, 12, 6, 24, heading + Math.PI / 2, srgb(0x6b5a48), srgb(0x3f3d3a), 0.3);
  }

  // ── Lighthouse on the headland ──────────────────────────────────────
  b.setRegion('lighthouse');
  {
    const x = 470;
    const z = -2330;
    const y = heightAt(x, z) - 1;
    b.cylinder(x, y, z, 4.2, 6, srgb(0xe8e6e0), 20, 3.9);
    b.cylinder(x, y + 6, z, 3.9, 7, srgb(0xb3302a), 20, 3.6);
    b.cylinder(x, y + 13, z, 3.6, 7, srgb(0xe8e6e0), 20, 3.3);
    b.cylinder(x, y + 20, z, 3.3, 5, srgb(0xb3302a), 20, 3.1);
    b.cylinder(x, y + 25, z, 4.2, 0.7, srgb(0x2e2f31), 20);
    b.cylinder(x, y + 25.7, z, 2.6, 3.2, srgb(0x33413f), 12);
    b.cone(x, y + 28.9, z, 3.0, 2.4, srgb(0x2e2f31), 12);
    b.house(x - 16, z - 14, 8, 4.5, 14, 0.4, srgb(0xe2ddd0), srgb(0x4a4b4f));
  }
  // Coastal radar and island air defence.
  b.setRegion('islands');
  {
    const x = 12900;
    const z = 9100;
    b.building(x, z, 10, 4, 10, 0.3, srgb(0x9d998d));
    b.dish(x, z + 30, 7, 0.4, 12 * DEG, srgb(0xd9d7d0), srgb(0x6d6c66));
    targets.push({ kind: 'radar', x, z, heading: 0, group: 'island-radar' });
    targets.push({ kind: 'command', x: x + 60, z: z - 40, heading: 0, group: 'island-radar' });
  }
  const isleSams: P2[] = [
    [2400, 5000],
    [3600, 5700],
    [-8500, 2900],
  ];
  isleSams.forEach(([x, z], i) => {
    samSite(b, x, z, heightAt);
    targets.push({ kind: 'sam', x, z, heading: i, group: 'island-sams' });
  });
  // Naval group slots in the strait (ships are mission entities).
  const ships: P2[] = [
    [-4200, 2600],
    [-2400, 3400],
    [-5600, 4200],
    [-3000, 5600],
  ];
  ships.forEach(([x, z], i) =>
    targets.push({ kind: 'ship', x, z, y: 0, heading: 95 * DEG + i * 0.05, group: 'strait-convoy' }),
  );
  return targets;
}

function lift(p: P2, heightAt: (x: number, z: number) => number): [number, number, number] {
  return [p[0], heightAt(p[0], p[1]) - 0.3, p[1]];
}

function samSite(
  b: StructureBuilder,
  x: number,
  z: number,
  heightAt: (x: number, z: number) => number,
): void {
  const y = heightAt(x, z);
  // Hexagonal revetment with launcher pads.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.box(x + Math.cos(a) * 34, y - 1, z + Math.sin(a) * 34, 16, 2.6, 3, Math.PI / 2 - a, srgb(0x6c6a4f));
    b.box(x + Math.cos(a) * 26, y - 0.3, z + Math.sin(a) * 26, 6, 1.1, 8, Math.PI / 2 - a, srgb(0x55594a));
  }
  b.box(x, y - 0.3, z, 6, 3.2, 10, 0.3, srgb(0x4f5546));
}

function breakwater(b: StructureBuilder, pts: P2[]): void {
  const poly = catmullRom(pts, 20);
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const c = poly[i]!;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const heading = Math.atan2(c[0] - a[0], -(c[1] - a[1]));
    b.box((a[0] + c[0]) / 2, -8, (a[1] + c[1]) / 2, 16, 10.5, len + 1, heading, srgb(0x77746c));
    b.box((a[0] + c[0]) / 2, 2.5, (a[1] + c[1]) / 2, 7, 1.4, len + 1, heading, srgb(0x9b978c));
  }
}

/** Rows of houses on both sides of a street polyline. */
function townAlong(
  b: StructureBuilder,
  rng: Rng,
  heightAt: (x: number, z: number) => number,
  poly: readonly P2[],
  walls: number[],
  roofs: number[],
  rows: number,
): void {
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const c = poly[i]!;
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const heading = Math.atan2(dx, -dz);
    const nx = -dz / len;
    const nz = dx / len;
    const n = Math.floor(len / 13);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      for (const side of [-1, 1]) {
        for (let r = 0; r < rows; r++) {
          if (rng.next() < 0.18) continue;
          const off = side * (13 + r * 17 + rng.range(-1, 1));
          const x = a[0] + dx * t + nx * off;
          const z = a[1] + dz * t + nz * off;
          if (heightAt(x, z) < 1.5) continue;
          b.house(
            x,
            z,
            rng.range(9, 12),
            rng.range(6, 9.5),
            rng.range(7, 9),
            heading,
            srgb(rng.pick(walls)),
            srgb(rng.pick(roofs)),
            0.4,
          );
        }
      }
    }
  }
}

export const KESSEL: MapDef = {
  id: 'kessel',
  seed: [173, 911],
  waterLevel: 0,
  atmosphere: () => ({
    sunDirection: new Vector3(-0.593, 0.545, 0.593),
    sunColor: srgb(0xfff4e6).multiplyScalar(3.3),
    zenithColor: srgb(0x1b4d9e),
    horizonColor: srgb(0xa6bcd4),
    groundHazeColor: srgb(0x9aa8b6),
    ambientSky: srgb(0x9fb4d0).multiplyScalar(0.85),
    ambientGround: srgb(0x5a5a4a).multiplyScalar(0.6),
    fogDensity: 1 / 52000,
    fogFalloff: 1 / 1900,
    mieStrength: 0.32,
    mieG: 0.8,
  }),
  glsl: KESSEL_GLSL,
  uniforms: kesselUniforms,
  flats: FLATS,
  airbases: [AIRBASE],
  roads: ROADS,
  roadWidth: 6,
  urban: [
    [HARBOR.x, HARBOR.z - 280, 620],
    [HARBOR.x + 450, HARBOR.z - 1600, 380],
    ...VILLAGES.map(([x, z, r]) => [x, z, r * 1.1] as [number, number, number]),
  ],
  palette: () => ({
    grass: srgb(0x5d7040),
    grassDry: srgb(0x8c8656),
    forest: srgb(0x2f4226),
    rock: srgb(0x8b8577),
    cliff: srgb(0xd9d5c9),
    sand: srgb(0xc4b48c),
    snow: srgb(0xf2f4f7),
    dirt: srgb(0x7a6446),
    field0: srgb(0x6a7e3d),
    field1: srgb(0xb8a66c),
    field2: srgb(0x6e5a43),
    field3: srgb(0x7d9646),
    urban: srgb(0x75706a),
    seabed: srgb(0x7d7b66),
    snowLine: 9000,
    snowFade: 100,
    beachHeight: 2.6,
    rockSlope: 0.36,
    cliffSlope: 0.42,
    fieldSize: 190,
    fieldMode: 0,
    strata: 0.15,
  }),
  forest: {
    valley: 0.55,
    slope: 0.85,
    maxSlope: 0.62,
    maxHeight: 950,
    minHeight: 2,
    threshold: 0.58,
    softness: 0.22,
  },
  vegetation: () => ({
    species: [
      { kind: 'broadleaf', weight: 0.62, color: srgb(0x3f5a2c), height: [11, 21] },
      { kind: 'conifer', weight: 0.38, color: srgb(0x2c4228), height: [14, 26] },
    ],
    density: 2600,
    scatter: 60,
  }),
  clouds: {
    count: 72,
    base: [1350, 1600],
    radius: [650, 1500],
    height: [380, 1000],
    spread: 34000,
    brightness: 1,
    darkBase: 0.5,
  },
  deck: null,
  spawns: {
    blue: { x: 0, z: 5500, heading: 0 },
    red: { x: 0, z: -5500, heading: Math.PI },
    altitude: [1500, 3500],
  },
  build,
};

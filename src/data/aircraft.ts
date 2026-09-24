import type { AircraftId, HardpointKind } from '../core/types';

export interface HardpointDef {
  kind: HardpointKind;
  /** Carried inside a weapons bay (not visible when closed). */
  internal: boolean;
}

/** Visual design brief for the procedural model generator (src/art). Dimensions in meters. */
export interface AirframeDesign {
  length: number;
  span: number;
  height: number;
  engines: 1 | 2;
  /** 'side' box/D intakes, 'chin' under the nose, 'ventral' under the fuselage, 'caret' stealth side intakes, 'nacelle' podded. */
  intakes: 'side' | 'chin' | 'ventral' | 'caret' | 'nacelle';
  wing: 'trapezoid' | 'swept' | 'delta' | 'straight' | 'diamond';
  wingSweepDeg: number;
  tails: 1 | 2;
  /** Outward cant of twin tails in degrees (0 = vertical). */
  tailCantDeg: number;
  canards: boolean;
  /** Round nozzles, or 2D rectangular thrust vectoring nozzles. */
  nozzle: 'round' | 'rect';
  notes: string;
}

export interface AircraftDef {
  id: AircraftId;
  name: string;
  role: string;
  description: string;
  unlockRank: number;
  design: AirframeDesign;
  // Flight model (SI units)
  massEmpty: number;
  fuelMax: number;
  wingArea: number;
  thrustDry: number; // N at sea level, total
  thrustAB: number; // N at sea level, total
  clAlpha: number; // per rad
  clMax: number;
  alphaStall: number; // rad
  cd0: number;
  oswald: number;
  /** Mach where transonic drag rise starts. */
  machCrit: number;
  /** Peak wave drag multiplier on cd0 near Mach 1.05. */
  waveDragPeak: number;
  gLimit: number;
  gMin: number;
  /** Maximum body rates at corner speed, rad/s. */
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  cornerSpeed: number; // m/s
  fuelBurnDry: number; // kg/s at full dry thrust
  fuelBurnAB: number; // kg/s at full afterburner
  gun: 'gun25' | 'gun30';
  gunAmmo: number;
  hardpoints: readonly HardpointDef[];
  flares: number;
  chaff: number;
  /** Hit points by part. */
  hp: { fuselage: number; cockpit: number; engine: number; wing: number; tail: number };
  /** Relative radar signature; lower = detected and locked later. */
  rcs: number;
  radarRange: number; // m
  /** Published stats for menus (tuned to match the flight model within 5%). */
  stats: { topSpeedMach: number; thrustToWeight: number; rollRateDeg: number };
}

const hp = (kind: HardpointKind, internal = false): HardpointDef => ({ kind, internal });

export const AIRCRAFT: Record<AircraftId, AircraftDef> = {
  kestrel: {
    id: 'kestrel',
    name: 'T/F-9 Kestrel',
    role: 'Lightweight trainer-fighter',
    description:
      'Single-engine lead-in fighter. Forgiving at low speed, quick in roll, short on range. The aircraft every pilot at Kessel learns on.',
    unlockRank: 1,
    design: {
      length: 14.1,
      span: 9.4,
      height: 4.5,
      engines: 1,
      intakes: 'side',
      wing: 'trapezoid',
      wingSweepDeg: 28,
      tails: 1,
      tailCantDeg: 0,
      canards: false,
      nozzle: 'round',
      notes:
        'Slim area-ruled fuselage, pointed nose, bubble canopy with a tandem two-seat frame, low-mounted trapezoid wing with wingtip missile rails, D-shaped side intakes, single tall fin, all-moving stabilators.',
    },
    massEmpty: 6800,
    fuelMax: 2400,
    wingArea: 27.9,
    thrustDry: 48000,
    thrustAB: 76000,
    clAlpha: 4.6,
    clMax: 1.45,
    alphaStall: 0.31,
    cd0: 0.021,
    oswald: 0.82,
    machCrit: 0.9,
    waveDragPeak: 2.6,
    gLimit: 8,
    gMin: -3,
    rollRate: 4.0,
    pitchRate: 0.5,
    yawRate: 0.2,
    cornerSpeed: 165,
    fuelBurnDry: 0.9,
    fuelBurnAB: 3.2,
    gun: 'gun25',
    gunAmmo: 510,
    hardpoints: [hp('srm'), hp('srm'), hp('mrm'), hp('mrm')],
    flares: 48,
    chaff: 48,
    hp: { fuselage: 70, cockpit: 30, engine: 40, wing: 35, tail: 30 },
    rcs: 0.8,
    radarRange: 18000,
    stats: { topSpeedMach: 1.3, thrustToWeight: 0.95, rollRateDeg: 230 },
  },
  harrow: {
    id: 'harrow',
    name: 'F-24 Harrow',
    role: 'Air superiority fighter',
    description:
      'Twin-engine heavyweight built around a big radar and a bigger engine bay. Wins by energy: climb, extend and come back on its own terms.',
    unlockRank: 3,
    design: {
      length: 19.4,
      span: 13.0,
      height: 5.6,
      engines: 2,
      intakes: 'side',
      wing: 'swept',
      wingSweepDeg: 42,
      tails: 2,
      tailCantDeg: 4,
      canards: false,
      nozzle: 'round',
      notes:
        'Broad flat fuselage with a raised single-seat bubble canopy, large rectangular raked side intakes, shoulder-mounted cropped-delta swept wing, twin vertical tails, twin nozzles side by side, large stabilators.',
    },
    massEmpty: 13200,
    fuelMax: 5200,
    wingArea: 56.5,
    thrustDry: 130000,
    thrustAB: 210000,
    clAlpha: 4.4,
    clMax: 1.5,
    alphaStall: 0.34,
    cd0: 0.022,
    oswald: 0.8,
    machCrit: 0.92,
    waveDragPeak: 2.4,
    gLimit: 9,
    gMin: -3,
    rollRate: 3.7,
    pitchRate: 0.52,
    yawRate: 0.18,
    cornerSpeed: 175,
    fuelBurnDry: 2.2,
    fuelBurnAB: 8,
    gun: 'gun25',
    gunAmmo: 940,
    hardpoints: [hp('srm'), hp('srm'), hp('srm'), hp('srm'), hp('mrm'), hp('mrm'), hp('lraam'), hp('lraam')],
    flares: 60,
    chaff: 60,
    hp: { fuselage: 110, cockpit: 35, engine: 60, wing: 50, tail: 40 },
    rcs: 1.3,
    radarRange: 30000,
    stats: { topSpeedMach: 2.3, thrustToWeight: 1.15, rollRateDeg: 212 },
  },
  wyvern: {
    id: 'wyvern',
    name: 'MR-31 Wyvern',
    role: 'Canard-delta multirole',
    description:
      'Close-coupled canards and a relaxed-stability delta give it the best nose authority in the fleet. It turns hard and bleeds speed doing it.',
    unlockRank: 6,
    design: {
      length: 15.3,
      span: 10.9,
      height: 5.3,
      engines: 2,
      intakes: 'ventral',
      wing: 'delta',
      wingSweepDeg: 50,
      tails: 1,
      tailCantDeg: 0,
      canards: true,
      nozzle: 'round',
      notes:
        'Slender nose, blended canopy, all-moving canards just behind the cockpit, split ventral intake under the forward fuselage, large cranked delta wing with elevons (no horizontal tail), single fin, twin nozzles close together.',
    },
    massEmpty: 10000,
    fuelMax: 4000,
    wingArea: 45,
    thrustDry: 100000,
    thrustAB: 150000,
    clAlpha: 3.9,
    clMax: 1.6,
    alphaStall: 0.42,
    cd0: 0.023,
    oswald: 0.75,
    machCrit: 0.93,
    waveDragPeak: 2.2,
    gLimit: 9,
    gMin: -3.2,
    rollRate: 4.2,
    pitchRate: 0.6,
    yawRate: 0.2,
    cornerSpeed: 160,
    fuelBurnDry: 1.7,
    fuelBurnAB: 6,
    gun: 'gun30',
    gunAmmo: 180,
    hardpoints: [
      hp('srm'),
      hp('srm'),
      hp('srm'),
      hp('srm'),
      hp('mrm'),
      hp('mrm'),
      hp('rocketPod'),
      hp('bomb'),
    ],
    flares: 56,
    chaff: 56,
    hp: { fuselage: 90, cockpit: 30, engine: 50, wing: 45, tail: 30 },
    rcs: 0.9,
    radarRange: 24000,
    stats: { topSpeedMach: 1.9, thrustToWeight: 1.1, rollRateDeg: 240 },
  },
  borzoi: {
    id: 'borzoi',
    name: 'Kv-40 Borzoi',
    role: 'Heavy interceptor',
    description:
      'Long, fast and heavily armed. Built to run down bombers at altitude, it would rather shoot from forty kilometers than turn with anyone.',
    unlockRank: 10,
    design: {
      length: 22.0,
      span: 14.7,
      height: 5.9,
      engines: 2,
      intakes: 'ventral',
      wing: 'swept',
      wingSweepDeg: 42,
      tails: 2,
      tailCantDeg: 0,
      canards: false,
      nozzle: 'round',
      notes:
        'Long drooped nose, large blended leading-edge extensions, widely spaced engine nacelles with a tunnel between them, angled ventral intakes under the LERX, swept wing, twin vertical tails outboard on the nacelles, long tail stinger between the nozzles.',
    },
    massEmpty: 17000,
    fuelMax: 7000,
    wingArea: 62,
    thrustDry: 150000,
    thrustAB: 245000,
    clAlpha: 4.3,
    clMax: 1.45,
    alphaStall: 0.33,
    cd0: 0.021,
    oswald: 0.8,
    machCrit: 0.92,
    waveDragPeak: 2.2,
    gLimit: 7.5,
    gMin: -3,
    rollRate: 3.1,
    pitchRate: 0.42,
    yawRate: 0.16,
    cornerSpeed: 185,
    fuelBurnDry: 2.6,
    fuelBurnAB: 9.5,
    gun: 'gun30',
    gunAmmo: 150,
    hardpoints: [hp('srm'), hp('srm'), hp('mrm'), hp('mrm'), hp('lraam'), hp('lraam')],
    flares: 60,
    chaff: 60,
    hp: { fuselage: 130, cockpit: 35, engine: 65, wing: 55, tail: 45 },
    rcs: 1.5,
    radarRange: 36000,
    stats: { topSpeedMach: 2.5, thrustToWeight: 1.05, rollRateDeg: 178 },
  },
  mule: {
    id: 'mule',
    name: 'GA-6 Mule',
    role: 'Ground attack',
    description:
      'Subsonic, armored and carrying enough ordnance for three sorties. Slow in everything except getting home with holes in it.',
    unlockRank: 14,
    design: {
      length: 16.3,
      span: 17.5,
      height: 4.8,
      engines: 2,
      intakes: 'nacelle',
      wing: 'straight',
      wingSweepDeg: 6,
      tails: 2,
      tailCantDeg: 0,
      canards: false,
      nozzle: 'round',
      notes:
        'Deep armored fuselage with a flat-plate armored canopy, long straight wing with many pylons, twin engines in pods on the fuselage sides above the wing trailing edge, twin fins on a high tailplane, heavy gun muzzle under the nose.',
    },
    massEmpty: 11500,
    fuelMax: 4800,
    wingArea: 47,
    thrustDry: 80000,
    thrustAB: 80000,
    clAlpha: 5.2,
    clMax: 1.7,
    alphaStall: 0.3,
    cd0: 0.03,
    oswald: 0.87,
    machCrit: 0.75,
    waveDragPeak: 3.2,
    gLimit: 6.5,
    gMin: -2.5,
    rollRate: 2.2,
    pitchRate: 0.4,
    yawRate: 0.2,
    cornerSpeed: 130,
    fuelBurnDry: 1.3,
    fuelBurnAB: 1.3,
    gun: 'gun30',
    gunAmmo: 1150,
    hardpoints: [
      hp('srm'),
      hp('srm'),
      hp('rocketPod'),
      hp('rocketPod'),
      hp('bomb'),
      hp('bomb'),
      hp('agm'),
      hp('agm'),
      hp('bomb'),
      hp('bomb'),
    ],
    flares: 120,
    chaff: 60,
    hp: { fuselage: 170, cockpit: 60, engine: 70, wing: 70, tail: 55 },
    rcs: 1.4,
    radarRange: 12000,
    stats: { topSpeedMach: 0.8, thrustToWeight: 0.55, rollRateDeg: 126 },
  },
  nightjar: {
    id: 'nightjar',
    name: 'X-50 Nightjar',
    role: 'Low-observable air dominance',
    description:
      'Faceted, quiet on radar and carried internally. Enemy radars lock it at little more than half their usual range.',
    unlockRank: 20,
    design: {
      length: 18.9,
      span: 13.6,
      height: 5.1,
      engines: 2,
      intakes: 'caret',
      wing: 'diamond',
      wingSweepDeg: 42,
      tails: 2,
      tailCantDeg: 28,
      canards: false,
      nozzle: 'rect',
      notes:
        'Chined faceted forebody with sharp edges, frameless canopy, caret side intakes, diamond wing with aligned edges, twin outward-canted tails, all-moving stabilators, two rectangular 2D nozzles, internal bays (closed doors visible underneath).',
    },
    massEmpty: 19000,
    fuelMax: 8200,
    wingArea: 78,
    thrustDry: 170000,
    thrustAB: 280000,
    clAlpha: 4.2,
    clMax: 1.6,
    alphaStall: 0.4,
    cd0: 0.019,
    oswald: 0.78,
    machCrit: 0.94,
    waveDragPeak: 2.0,
    gLimit: 9,
    gMin: -3,
    rollRate: 3.6,
    pitchRate: 0.56,
    yawRate: 0.2,
    cornerSpeed: 170,
    fuelBurnDry: 2.8,
    fuelBurnAB: 10,
    gun: 'gun25',
    gunAmmo: 480,
    hardpoints: [
      hp('srm', true),
      hp('srm', true),
      hp('mrm', true),
      hp('mrm', true),
      hp('mrm', true),
      hp('mrm', true),
    ],
    flares: 48,
    chaff: 48,
    hp: { fuselage: 120, cockpit: 35, engine: 60, wing: 55, tail: 40 },
    rcs: 0.4,
    radarRange: 32000,
    stats: { topSpeedMach: 2.0, thrustToWeight: 1.2, rollRateDeg: 206 },
  },
};

export const AIRCRAFT_IDS: readonly AircraftId[] = [
  'kestrel',
  'harrow',
  'wyvern',
  'borzoi',
  'mule',
  'nightjar',
];

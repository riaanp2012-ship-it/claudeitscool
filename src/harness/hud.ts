import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/ibm-plex-sans/500.css';
import {
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { DEG } from '../core/math';
import { hash2 } from '../core/rng';
import type {
  HudContact,
  HudPoint,
  HudRadarBlip,
  HudState,
  HudThreat,
  HudWarning,
  Team,
} from '../core/types';
import { createHud } from '../hud';
import { ATMOSPHERE_GLSL, atmoUniforms, patchAtmosphere } from '../render/atmosphere';
import { createHarness } from './common';

/**
 * HUD visual harness: draws the real HUD over a three.js sky/terrain rendered by the shared pipeline,
 * with mocked HudState scenarios. The camera uses the scenario attitude, so the pitch ladder's horizon
 * must line up with the rendered horizon (conformal check).
 *
 * Query: ?scenario=cruise|dogfight|lock|missile|pullup|cockpit|ground|training|metric-amber|
 *        debrief-message|ultrawide|furball  &color=green|amber|white  &scale=0.8..1.4  &cb=off|protan|deutan|tritan
 *        &units=imperial|metric  &backdrop=day|snow  &lock=0..1  &anim=1  &bench=1 (HUD timing only)
 */

const params = new URLSearchParams(location.search);
const scenarioName = params.get('scenario') ?? 'cruise';
const bench = params.get('bench') === '1';
const animate = params.get('anim') === '1' || bench;
const FOV = 60;

// ───────────────────────────────────────────────────────────── scenario data

interface ContactSpec {
  id: number;
  az: number; // deg, right positive (camera frame)
  el: number; // deg, up positive
  dist: number; // m
  closure: number; // m/s
  team: Team;
  label: string;
  kind: HudContact['kind'];
  selected?: boolean;
  lock?: number;
  health?: number;
  inRange?: boolean;
  heading?: number; // deg, relative, for radar arrows
}

interface Scenario {
  view: HudState['view'];
  units: HudState['units'];
  color: 'green' | 'amber' | 'white';
  backdrop: 'day' | 'snow';
  alt: number;
  agl: number;
  speed: number;
  vs: number;
  pitch: number;
  roll: number;
  heading: number;
  aoa: number;
  g: number;
  maxG: number;
  throttle: number;
  ab: boolean;
  fuel: number;
  gear?: boolean;
  flaps?: boolean;
  brake?: boolean;
  damage?: Partial<HudState['aircraft']['damage']>;
  aim?: { az: number; el: number } | null;
  weapon: {
    name: string;
    count: number;
    gunAmmo: number;
    seeker?: { az: number; el: number; radius: number; locked: boolean };
    lead?: { az: number; el: number };
    envelope?: { min: number; max: number; noEscape: number; range: number };
    ccip?: { az: number; el: number };
    reloading?: number;
  };
  cm: { flares: number; chaff: number };
  contacts: ContactSpec[];
  threats: HudThreat[];
  radarRange: number;
  blips?: HudRadarBlip[];
  warnings?: HudWarning[];
  message?: { text: string; sub: string; time: number } | null;
  killFeed?: { text: string; age: number; friendly: boolean }[];
  objectives?: { text: string; done: boolean; failed: boolean }[];
  subtitle?: { speaker: string; text: string; age: number } | null;
  hitMarker?: number;
  outOfBounds?: number | null;
  spawnProtection?: number;
  score?: { left: string; right: string; timer: string } | null;
  hint?: string | null;
}

const WINGMAN: ContactSpec = {
  id: 2,
  az: -14,
  el: -3,
  dist: 1400,
  closure: -4,
  team: 'blue',
  label: 'LANCER 2',
  kind: 'aircraft',
  heading: 8,
};

const base: Scenario = {
  view: 'chase',
  units: 'imperial',
  color: 'green',
  backdrop: 'day',
  alt: 4270,
  agl: 3900,
  speed: 231,
  vs: 3.2,
  pitch: 3,
  roll: -9,
  heading: 274,
  aoa: 3.1,
  g: 1.1,
  maxG: 3.4,
  throttle: 0.74,
  ab: false,
  fuel: 0.64,
  aim: { az: -2.5, el: 2.5 },
  weapon: { name: 'SRM', count: 4, gunAmmo: 510 },
  cm: { flares: 60, chaff: 60 },
  contacts: [
    WINGMAN,
    {
      id: 3,
      az: 150,
      el: 0,
      dist: 5200,
      closure: 12,
      team: 'blue',
      label: 'LANCER 3',
      kind: 'aircraft',
      heading: -30,
    },
  ],
  threats: [],
  radarRange: 20 * 1852,
  objectives: [
    { text: 'Patrol the Kessel Strait corridor', done: true, failed: false },
    { text: 'Intercept the inbound flight', done: false, failed: false },
  ],
  subtitle: {
    speaker: 'LANCER 2',
    text: 'Lancer One, Two. Picture clean, holding your left wing.',
    age: 1.2,
  },
};

const SCENARIOS: Record<string, Scenario> = {
  cruise: base,
  dogfight: {
    ...base,
    alt: 2610,
    agl: 2280,
    speed: 178,
    vs: 14,
    pitch: 11,
    roll: 52,
    heading: 132,
    aoa: 13.5,
    g: 6.2,
    maxG: 7.4,
    throttle: 1,
    ab: true,
    fuel: 0.47,
    aim: { az: 3, el: 9 },
    damage: { wingL: 0.42, hull: 0.18 },
    weapon: { name: 'GUN', count: 0, gunAmmo: 312, lead: { az: 1.8, el: 6.4 } },
    cm: { flares: 38, chaff: 44 },
    contacts: [
      {
        id: 10,
        az: 2.8,
        el: 7.4,
        dist: 640,
        closure: 38,
        team: 'red',
        label: 'BORZOI',
        kind: 'aircraft',
        selected: true,
        health: 0.55,
        inRange: true,
        heading: 40,
      },
      {
        id: 11,
        az: -21,
        el: 12,
        dist: 2900,
        closure: -20,
        team: 'red',
        label: 'BORZOI',
        kind: 'aircraft',
        heading: 120,
      },
      {
        id: 12,
        az: 130,
        el: -10,
        dist: 4100,
        closure: 60,
        team: 'red',
        label: 'WYVERN',
        kind: 'aircraft',
        heading: -60,
      },
      {
        id: 13,
        az: -95,
        el: 4,
        dist: 3300,
        closure: 10,
        team: 'red',
        label: 'WYVERN',
        kind: 'aircraft',
        heading: 90,
      },
      { ...WINGMAN, az: 16, el: -8, dist: 1900 },
    ],
    threats: [
      { bearing: 130 * DEG, kind: 'lock', distance: 4100 },
      { bearing: -95 * DEG, kind: 'search', distance: 3300 },
      { bearing: -21 * DEG, kind: 'search', distance: 2900 },
    ],
    radarRange: 10 * 1852,
    killFeed: [
      { text: 'LANCER 2 SPLASHED WYVERN', age: 9.5, friendly: true },
      { text: 'LANCER 3 SHOT DOWN BY BORZOI', age: 4.2, friendly: false },
      { text: 'LANCER 1 SPLASHED BORZOI', age: 1.1, friendly: true },
    ],
    objectives: [{ text: 'Destroy all hostile fighters (3/6)', done: false, failed: false }],
    subtitle: null,
    hitMarker: 0.8,
    score: { left: 'BLUE  4', right: '3  RED', timer: '8:42' },
  },
  lock: {
    ...base,
    alt: 5480,
    agl: 5100,
    speed: 262,
    pitch: 4,
    roll: 14,
    heading: 36,
    aoa: 4.2,
    g: 1.8,
    maxG: 5.1,
    throttle: 0.92,
    aim: { az: 4, el: 4 },
    weapon: {
      name: 'SRM',
      count: 3,
      gunAmmo: 510,
      seeker: { az: 5.5, el: 3.4, radius: 26, locked: true },
      envelope: { min: 300, max: 5000, noEscape: 2400, range: 3150 },
    },
    contacts: [
      {
        id: 20,
        az: 5.5,
        el: 3.4,
        dist: 3150,
        closure: 120,
        team: 'red',
        label: 'WYVERN',
        kind: 'aircraft',
        selected: true,
        lock: 1,
        health: 1,
        inRange: true,
        heading: 170,
      },
      {
        id: 21,
        az: 18,
        el: 6,
        dist: 6800,
        closure: 90,
        team: 'red',
        label: 'WYVERN',
        kind: 'aircraft',
        heading: 175,
      },
      WINGMAN,
    ],
    threats: [{ bearing: 5.5 * DEG, kind: 'search', distance: 3150 }],
    radarRange: 20 * 1852,
    subtitle: { speaker: 'LANCER 1', text: 'Fox two.', age: 0.6 },
    score: null,
  },
  missile: {
    ...base,
    alt: 3350,
    agl: 2900,
    speed: 244,
    vs: -22,
    pitch: -6,
    roll: -68,
    heading: 311,
    aoa: 9,
    g: 5.4,
    maxG: 6.8,
    throttle: 1,
    ab: true,
    fuel: 0.39,
    aim: { az: -8, el: 3 },
    weapon: { name: 'MRM', count: 2, gunAmmo: 404, reloading: 0.55 },
    cm: { flares: 12, chaff: 0 },
    contacts: [
      {
        id: 30,
        az: 155,
        el: -5,
        dist: 6100,
        closure: 110,
        team: 'red',
        label: 'HARROW',
        kind: 'aircraft',
        heading: 10,
      },
      {
        id: 31,
        az: -100,
        el: 8,
        dist: 8400,
        closure: 30,
        team: 'red',
        label: 'WYVERN',
        kind: 'aircraft',
        heading: 70,
      },
    ],
    threats: [
      { bearing: 150 * DEG, kind: 'missile', distance: 2600 },
      { bearing: -104 * DEG, kind: 'missile', distance: 4900 },
      { bearing: 155 * DEG, kind: 'lock', distance: 6100 },
    ],
    blips: [
      { x: 1300, y: -2250, team: 'red', kind: 'missile', selected: false, heading: -30 * DEG },
      { x: -4750, y: -1200, team: 'red', kind: 'missile', selected: false, heading: 76 * DEG },
    ],
    radarRange: 10 * 1852,
    warnings: ['BINGO', 'MISSILE', 'OVER-G'],
    subtitle: {
      speaker: 'LANCER 2',
      text: 'Lancer One, missile launch, your six. Break left, flares.',
      age: 0.9,
    },
    objectives: [],
  },
  pullup: {
    ...base,
    alt: 402,
    agl: 186,
    speed: 292,
    vs: -86,
    pitch: -24,
    roll: 21,
    heading: 208,
    aoa: 2.2,
    g: 1.4,
    maxG: 6.1,
    throttle: 0.55,
    fuel: 0.11,
    aim: { az: 0, el: 12 },
    weapon: { name: 'GUN', count: 0, gunAmmo: 96 },
    contacts: [],
    warnings: ['PULL UP', 'BINGO'],
    subtitle: null,
    objectives: [],
    outOfBounds: 7.4,
  },
  cockpit: {
    ...base,
    view: 'cockpit',
    contacts: [
      {
        id: 40,
        az: 6,
        el: 2,
        dist: 7400,
        closure: 140,
        team: 'red',
        label: 'HARROW',
        kind: 'aircraft',
        selected: true,
        lock: 0.62,
        health: 1,
        heading: 190,
      },
      WINGMAN,
    ],
    weapon: {
      name: 'MRM',
      count: 4,
      gunAmmo: 510,
      envelope: { min: 1500, max: 20000, noEscape: 9000, range: 7400 },
    },
  },
  ground: {
    ...base,
    alt: 1420,
    agl: 1180,
    speed: 205,
    vs: -34,
    pitch: -17,
    roll: 4,
    heading: 88,
    aoa: 2.6,
    g: 0.9,
    maxG: 4.2,
    throttle: 0.6,
    aim: { az: 1, el: -12 },
    weapon: { name: 'RKT', count: 19, gunAmmo: 510, ccip: { az: 2.2, el: -15.5 }, reloading: 0.35 },
    contacts: [
      {
        id: 50,
        az: 2.5,
        el: -15,
        dist: 4300,
        closure: 205,
        team: 'red',
        label: 'SAM',
        kind: 'ground',
        selected: true,
        health: 0.8,
        inRange: false,
        heading: 0,
      },
      {
        id: 51,
        az: -9,
        el: -12,
        dist: 5600,
        closure: 200,
        team: 'red',
        label: 'AAA',
        kind: 'ground',
        heading: 0,
      },
      {
        id: 52,
        az: 24,
        el: -9,
        dist: 7900,
        closure: 190,
        team: 'red',
        label: 'CORVETTE',
        kind: 'ship',
        heading: 60,
      },
    ],
    threats: [{ bearing: 2.5 * DEG, kind: 'lock', distance: 4300 }],
    blips: [{ x: 900, y: 9000, team: 'blue', kind: 'objective', selected: false, heading: 0 }],
    radarRange: 10 * 1852,
    objectives: [
      { text: 'Destroy the SAM site at Kessel Point', done: false, failed: false },
      { text: 'Destroy the radar station', done: true, failed: false },
      { text: 'Keep the tanker alive', done: false, failed: true },
    ],
    subtitle: null,
    backdrop: 'snow',
  },
  training: {
    ...base,
    alt: 850,
    agl: 610,
    speed: 128,
    vs: -3,
    pitch: 2,
    roll: -4,
    heading: 90,
    aoa: 7.5,
    g: 1,
    maxG: 2.1,
    throttle: 0.48,
    fuel: 0.9,
    gear: true,
    flaps: true,
    brake: true,
    aim: null,
    weapon: { name: 'GUN', count: 0, gunAmmo: 510 },
    contacts: [
      {
        id: 60,
        az: -3,
        el: 1,
        dist: 700,
        closure: 128,
        team: 'blue',
        label: 'RING 3',
        kind: 'checkpoint',
        selected: true,
      },
      { id: 61, az: 58, el: 2, dist: 2200, closure: 60, team: 'blue', label: 'RING 4', kind: 'checkpoint' },
    ],
    radarRange: 5 * 1852,
    objectives: [
      { text: 'Fly through the rings (2/8)', done: false, failed: false },
      { text: 'Stay above 500 ft', done: false, failed: false },
    ],
    subtitle: {
      speaker: 'INSTRUCTOR',
      text: 'Gear and flaps down. Keep your speed under one-fifty.',
      age: 2,
    },
    hint: 'Fly through the ring. Press L for gear, K for flaps.',
    spawnProtection: 0,
  },
  'metric-amber': {
    ...base,
    units: 'metric',
    color: 'amber',
    alt: 6120,
    agl: 5700,
    speed: 286,
    vs: -5.5,
    pitch: -2,
    roll: 30,
    heading: 18,
    aoa: 5.1,
    g: 2.4,
    maxG: 5.6,
    weapon: {
      name: 'MRM',
      count: 4,
      gunAmmo: 510,
      envelope: { min: 1500, max: 20000, noEscape: 9000, range: 12600 },
    },
    contacts: [
      {
        id: 70,
        az: -7,
        el: 1.5,
        dist: 12600,
        closure: 310,
        team: 'red',
        label: 'NIGHTJAR',
        kind: 'aircraft',
        selected: true,
        lock: 0.35,
        health: 1,
        inRange: true,
        heading: 170,
      },
      WINGMAN,
    ],
    threats: [{ bearing: -7 * DEG, kind: 'search', distance: 12600 }],
    radarRange: 40000,
    score: { left: 'BLUE  1', right: '0  RED', timer: '2:15' },
    spawnProtection: 3.2,
  },
  'debrief-message': {
    ...base,
    message: { text: 'SPLASH ONE', sub: 'BORZOI DESTROYED  +150', time: 2.2 },
    killFeed: [
      { text: 'LANCER 2 SPLASHED WYVERN', age: 12, friendly: true },
      { text: 'LANCER 1 SPLASHED BORZOI', age: 0.4, friendly: true },
    ],
    subtitle: { speaker: 'LANCER 2', text: 'Splash one. Good kill.', age: 0.8 },
    score: { left: 'BLUE  5', right: '3  RED', timer: '9:58' },
  },
};
// A furball: several bandits and friendlies packed within a few degrees (label decluttering check).
SCENARIOS.furball = {
  ...SCENARIOS.dogfight!,
  contacts: [
    {
      id: 80,
      az: 2.8,
      el: 7.4,
      dist: 640,
      closure: 38,
      team: 'red',
      label: 'BORZOI',
      kind: 'aircraft',
      selected: true,
      lock: 0.4,
      health: 0.55,
      inRange: true,
      heading: 40,
    },
    {
      id: 81,
      az: 4.6,
      el: 8.2,
      dist: 900,
      closure: 20,
      team: 'red',
      label: 'BORZOI',
      kind: 'aircraft',
      heading: 60,
    },
    {
      id: 82,
      az: 1.2,
      el: 5.9,
      dist: 1150,
      closure: -12,
      team: 'red',
      label: 'WYVERN',
      kind: 'aircraft',
      heading: 10,
    },
    {
      id: 83,
      az: 5.9,
      el: 5.1,
      dist: 1800,
      closure: 44,
      team: 'red',
      label: 'WYVERN',
      kind: 'aircraft',
      heading: 90,
    },
    {
      id: 84,
      az: 3.4,
      el: 10.1,
      dist: 2300,
      closure: 5,
      team: 'red',
      label: 'HARROW',
      kind: 'aircraft',
      heading: 120,
    },
    {
      id: 85,
      az: -0.8,
      el: 8.8,
      dist: 2700,
      closure: -30,
      team: 'red',
      label: 'BORZOI',
      kind: 'aircraft',
      heading: 0,
    },
    {
      id: 86,
      az: 6.8,
      el: 9.0,
      dist: 1500,
      closure: 15,
      team: 'blue',
      label: 'LANCER 2',
      kind: 'aircraft',
      heading: 30,
    },
    {
      id: 87,
      az: 0.2,
      el: 4.4,
      dist: 2100,
      closure: 8,
      team: 'blue',
      label: 'LANCER 4',
      kind: 'aircraft',
      heading: 45,
    },
    {
      id: 88,
      az: -40,
      el: 2,
      dist: 3900,
      closure: 20,
      team: 'red',
      label: 'NIGHTJAR',
      kind: 'aircraft',
      heading: 80,
    },
  ],
};
SCENARIOS.ultrawide = { ...SCENARIOS.dogfight!, score: { left: 'BLUE  4', right: '3  RED', timer: '8:42' } };

const scenario: Scenario = SCENARIOS[scenarioName] ?? base;
const colorParam = params.get('color');
const color =
  colorParam === 'amber' || colorParam === 'white' || colorParam === 'green' ? colorParam : scenario.color;
const unitsParam = params.get('units');
const units = unitsParam === 'metric' || unitsParam === 'imperial' ? unitsParam : scenario.units;
const backdrop =
  params.get('backdrop') === 'snow' ? 'snow' : params.get('backdrop') === 'day' ? 'day' : scenario.backdrop;
const lockParam = params.get('lock');

// ───────────────────────────────────────────────────────────── HudState from the scenario

function point(): HudPoint {
  return { x: 0, y: 0, visible: false };
}

const state: HudState = {
  viewport: { width: 1, height: 1 },
  view: scenario.view,
  units,
  camera: { pitch: 0, roll: 0, heading: 0, pxPerRad: 1, center: { x: 0, y: 0 } },
  boresight: point(),
  flightPath: point(),
  aimReticle: scenario.aim ? point() : null,
  aircraft: {
    heading: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    mach: 0,
    altitude: 0,
    radarAltitude: 0,
    verticalSpeed: 0,
    g: 1,
    maxG: 1,
    aoa: 0,
    throttle: 0,
    afterburner: false,
    fuel: 1,
    gearDown: scenario.gear ?? false,
    flaps: scenario.flaps ?? false,
    airbrake: scenario.brake ?? false,
    damage: { engine: 0, wingL: 0, wingR: 0, tail: 0, hull: 0, ...scenario.damage },
  },
  weapon: {
    name: scenario.weapon.name,
    count: scenario.weapon.count,
    gunAmmo: scenario.weapon.gunAmmo,
    seeker: scenario.weapon.seeker
      ? { point: point(), radius: 0, locked: scenario.weapon.seeker.locked }
      : null,
    leadPip: scenario.weapon.lead ? point() : null,
    envelope: scenario.weapon.envelope ? { ...scenario.weapon.envelope } : null,
    ccip: scenario.weapon.ccip ? point() : null,
    reloading: scenario.weapon.reloading ?? 0,
  },
  countermeasures: { ...scenario.cm },
  contacts: scenario.contacts.map((c) => ({
    id: c.id,
    screen: point(),
    offscreenAngle: 0,
    onScreen: false,
    distance: c.dist,
    closure: c.closure,
    team: c.team,
    label: c.label,
    kind: c.kind,
    selected: c.selected ?? false,
    lock: c.selected && lockParam !== null ? Number(lockParam) : (c.lock ?? 0),
    health: c.health ?? 1,
    inRange: c.inRange ?? false,
  })),
  threats: scenario.threats,
  radar: { range: scenario.radarRange, blips: [] },
  warnings: scenario.warnings ?? [],
  message: scenario.message ?? null,
  killFeed: scenario.killFeed ?? [],
  objectives: scenario.objectives ?? [],
  subtitle: scenario.subtitle ?? null,
  hitMarker: scenario.hitMarker ?? 0,
  outOfBounds: scenario.outOfBounds ?? null,
  spawnProtection: scenario.spawnProtection ?? 0,
  score: scenario.score ?? null,
  hint: scenario.hint ?? null,
};

const blips: HudRadarBlip[] = scenario.contacts.map((c) => ({
  x: c.dist * Math.sin(c.az * DEG) * Math.cos(c.el * DEG),
  y: c.dist * Math.cos(c.az * DEG) * Math.cos(c.el * DEG),
  team: c.team,
  kind: c.kind === 'drone' ? 'aircraft' : c.kind,
  selected: c.selected ?? false,
  heading: (c.heading ?? 0) * DEG,
}));
state.radar = { range: scenario.radarRange, blips: blips.concat(scenario.blips ?? []) };

/** Pinhole projection of a camera-frame direction (az/el in degrees) into a HudPoint. */
function project(az: number, el: number, out: HudPoint, f: number, cx: number, cy: number): number {
  const a = az * DEG;
  const e = el * DEG;
  const dx = Math.sin(a) * Math.cos(e);
  const dy = Math.sin(e);
  const dz = Math.cos(a) * Math.cos(e);
  const w = state.viewport.width;
  const h = state.viewport.height;
  if (dz <= 1e-3) {
    out.visible = false;
    return Math.atan2(dx, dy);
  }
  out.x = cx + (f * dx) / dz;
  out.y = cy - (f * dy) / dz;
  out.visible = true;
  const margin = 12;
  if (out.x < margin || out.x > w - margin || out.y < margin || out.y > h - margin) return Math.atan2(dx, dy);
  return NaN;
}

function updateState(t: number): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  state.viewport.width = w;
  state.viewport.height = h;
  const f = h / 2 / Math.tan((FOV / 2) * DEG);
  const cx = w / 2;
  const cy = h / 2;
  const wob = animate ? Math.sin(t * 0.7) : 0;
  const pitch = scenario.pitch + wob * 1.5;
  const roll = scenario.roll + wob * 6;
  const heading = scenario.heading + (animate ? t * 3 : 0);
  state.camera.pitch = pitch * DEG;
  state.camera.roll = roll * DEG;
  state.camera.heading = heading * DEG;
  state.camera.pxPerRad = f;
  state.camera.center.x = cx;
  state.camera.center.y = cy;

  const a = state.aircraft;
  a.heading = heading * DEG;
  a.pitch = pitch * DEG;
  a.roll = roll * DEG;
  a.speed = scenario.speed + (animate ? Math.sin(t * 0.9) * 12 : 0);
  a.mach = a.speed / 330;
  a.altitude = scenario.alt + (animate ? t * scenario.vs : 0);
  a.radarAltitude = scenario.agl + (animate ? t * scenario.vs : 0);
  a.verticalSpeed = scenario.vs;
  a.g = scenario.g + (animate ? Math.sin(t * 1.3) * 0.4 : 0);
  a.maxG = scenario.maxG;
  a.aoa = scenario.aoa * DEG;
  a.throttle = scenario.throttle;
  a.afterburner = scenario.ab;
  a.fuel = scenario.fuel;

  project(0, 0, state.boresight, f, cx, cy);
  project(0.4, -scenario.aoa, state.flightPath, f, cx, cy);
  if (state.aimReticle && scenario.aim)
    project(scenario.aim.az, scenario.aim.el, state.aimReticle, f, cx, cy);
  const wpn = scenario.weapon;
  if (state.weapon.seeker && wpn.seeker) {
    project(wpn.seeker.az, wpn.seeker.el, state.weapon.seeker.point, f, cx, cy);
    state.weapon.seeker.radius = wpn.seeker.radius;
  }
  if (state.weapon.leadPip && wpn.lead) project(wpn.lead.az, wpn.lead.el, state.weapon.leadPip, f, cx, cy);
  if (state.weapon.ccip && wpn.ccip) project(wpn.ccip.az, wpn.ccip.el, state.weapon.ccip, f, cx, cy);

  const cs = state.contacts as HudContact[];
  for (let i = 0; i < cs.length; i++) {
    const spec = scenario.contacts[i]!;
    const c = cs[i]!;
    const off = project(spec.az, spec.el, c.screen, f, cx, cy);
    c.onScreen = Number.isNaN(off);
    c.offscreenAngle = Number.isNaN(off) ? 0 : off;
  }
  if (animate && state.subtitle) state.subtitle.age = 1 + (t % 5);
  if (animate) state.hitMarker = Math.max(0, 1 - (t % 2));
}

// ───────────────────────────────────────────────────────────── backdrop

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function terrainHeight(x: number, z: number): number {
  let h = 0;
  let amp = 1;
  let freq = 1 / 9000;
  for (let o = 0; o < 6; o++) {
    h += (valueNoise(x * freq, z * freq, 11 + o) - 0.5) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  const ridge = Math.max(0, h + 0.15);
  return 40 + ridge * ridge * 5200;
}

function buildBackdrop(h: ReturnType<typeof createHarness>): void {
  const snow = backdrop === 'snow';
  const skyMat = new ShaderMaterial({
    uniforms: atmoUniforms,
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vRay;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vRay = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${ATMOSPHERE_GLSL}
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vRay;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 dir = normalize(vRay);
        vec3 col = atmoSky(dir);
        float s = smoothstep(0.99955, 0.9998, dot(dir, uSunDir));
        col += uSunColor * s * 6.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new Mesh(new SphereGeometry(140000, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  h.scene.add(sky);

  const size = 240000;
  const seg = 360;
  const geo = new PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new Color(0.16, 0.2, 0.1);
  const field = new Color(0.33, 0.3, 0.17);
  const rock = new Color(0.3, 0.28, 0.25);
  const snowC = new Color(0.86, 0.88, 0.92);
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const patch = valueNoise(x / 700, z / 700, 99);
    tmp.copy(grass).lerp(field, patch > 0.55 ? 0.8 : patch * 0.6);
    if (y > 700) tmp.lerp(rock, Math.min(1, (y - 700) / 500));
    const snowLine = snow ? 0 : 1500;
    if (y > snowLine) tmp.lerp(snowC, Math.min(1, (y - snowLine) / 300 + (snow ? 0.85 : 0)));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = patchAtmosphere(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
  );
  const ground = new Mesh(geo, mat);
  h.scene.add(ground);

  const sun = new DirectionalLight(0xffffff, 2.6);
  sun.position.copy(atmoUniforms.uSunDir.value).multiplyScalar(1000);
  h.scene.add(sun, new HemisphereLight(0x9fb4d8, 0x3a3428, 0.9));

  h.camera.fov = FOV;
  h.camera.near = 1;
  h.camera.updateProjectionMatrix();
  h.camera.rotation.order = 'YXZ';
  h.frame(() => {
    const a = state.aircraft;
    h.camera.position.set(0, Math.max(a.altitude, terrainHeight(0, 0) + 30), 0);
    h.camera.rotation.set(state.camera.pitch, -state.camera.heading, -state.camera.roll);
    sky.position.copy(h.camera.position);
  });
}

// ───────────────────────────────────────────────────────────── run

async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load('600 16px "Barlow Condensed"'),
    document.fonts.load('700 28px "Barlow Condensed"'),
    document.fonts.load('500 16px "JetBrains Mono"'),
    document.fonts.load('500 16px "IBM Plex Sans"'),
  ]);
  await document.fonts.ready;
}

const times = new Float64Array(2000);
let timeCount = 0;
/** Steady-state cost from a tight loop (immune to the coarse per-call timer resolution). */
let loopMs = 0;

function report(): void {
  const n = Math.min(timeCount, times.length);
  const sorted = Array.from(times.subarray(0, n)).sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const p = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
  window.__HARNESS_INFO__ = {
    scenario: scenarioName,
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    frames: n,
    drawMsMean: Number(mean.toFixed(4)),
    drawMsP50: Number(p(0.5).toFixed(4)),
    drawMsP95: Number(p(0.95).toFixed(4)),
    drawMsMax: Number((sorted[n - 1] ?? 0).toFixed(4)),
    loopMsPerDraw: Number(loopMs.toFixed(4)),
  };
}

async function main(): Promise<void> {
  await loadFonts();
  const hud = createHud();
  hud.setColor(color);
  const scaleParam = Number(params.get('scale') ?? '1');
  hud.setScale(Number.isFinite(scaleParam) ? scaleParam : 1);
  const cb = params.get('cb');
  if (cb === 'protan' || cb === 'deutan' || cb === 'tritan') hud.setColorblind(cb);
  const syncSize = (): void =>
    hud.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  window.addEventListener('resize', syncSize);
  syncSize();

  let elapsed = 0;
  const step = (dt: number): void => {
    elapsed += dt;
    updateState(animate ? elapsed : 0);
    const t0 = performance.now();
    hud.draw(state, dt);
    const t1 = performance.now();
    times[timeCount % times.length] = t1 - t0;
    timeCount++;
    if (timeCount % 30 === 0) report();
  };

  if (bench) {
    // HUD-only timing: a CSS sky gradient instead of WebGL so the measurement is the HUD alone.
    document.body.style.cssText =
      'margin:0;background:linear-gradient(#3d6fb0 0%,#9ab8d8 48%,#6b6a58 52%,#3b4030 100%);';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;inset:0;';
    holder.appendChild(hud.canvas);
    document.body.appendChild(holder);
    let last = performance.now();
    let frames = 0;
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      frames++;
      if (frames === 240) {
        // 600 back-to-back draws with a changing state: the average is the steady-state HUD cost.
        const t0 = performance.now();
        for (let i = 0; i < 600; i++) {
          elapsed += 1 / 60;
          updateState(elapsed);
          hud.draw(state, 1 / 60);
        }
        loopMs = (performance.now() - t0) / 600;
        report();
        window.__HARNESS_READY__ = true;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return;
  }

  const h = createHarness({ readyAfterFrames: 20 });
  h.renderer.domElement.parentElement?.appendChild(hud.canvas);
  buildBackdrop(h);
  const draw = (dt: number): void => step(dt);
  const prev = h.pipeline.render.bind(h.pipeline);
  // Draw the HUD after the composer, like the game (frame order: ... → render → HUD overlay).
  h.pipeline.render = (dt: number): void => {
    prev(dt);
    draw(dt);
  };
}

void main();

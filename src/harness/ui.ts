/**
 * UI harness (spec §2.6): renders any menu screen with realistic data over a stand-in 3D backdrop.
 * URL: ?screen=title|menu|instant|free|training|campaign|hangar|settings|credits|briefing|loading|pause|
 *      debrief|resume|fatal|toasts  [&tab=graphics|controls|audio|gameplay|accessibility]
 *      [&keys=ArrowDown,Enter] [&scale=1.2] [&device=gamepad] [&outcome=failure]
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  type Scene,
} from 'three';
import { settings } from '../core/settings';
import type {
  AircraftSummary,
  DebriefData,
  LessonSummary,
  MapSummary,
  MissionSummary,
  PilotProfileView,
} from '../core/types';
import { AIRCRAFT, AIRCRAFT_IDS } from '../data/aircraft';
import { MAP_IDS, MAPS } from '../data/maps';
import { patchAtmosphere } from '../render/atmosphere';
import { createUi, loadFonts } from '../ui';
import type { SettingsSection } from '../ui/settings-fields';
import { createHarness } from './common';

const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') ?? 'menu';
const SKY_SCREENS = new Set(['title', 'loading', 'pause', 'resume', 'toasts', 'debrief', 'briefing']);

// ─────────────────────────────────────────────────────────────── Backdrop

const h = createHarness({ readyAfterFrames: Number.POSITIVE_INFINITY });

function metal(color: number, roughness: number, metalness: number): MeshStandardMaterial {
  return patchAtmosphere(new MeshStandardMaterial({ color, roughness, metalness }));
}

/** A faceted jet-shaped stand-in for the game's procedural aircraft (nose toward -Z). */
function standInJet(): Group {
  const g = new Group();
  const skin = metal(0x6d7378, 0.5, 0.35);
  const dark = metal(0x2b2f33, 0.6, 0.2);
  const profile = [
    [0, -7.4],
    [0.28, -6.6],
    [0.55, -5.2],
    [0.78, -3.4],
    [0.9, -1],
    [0.92, 2.5],
    [0.86, 4.8],
    [0.7, 6.4],
    [0.55, 6.9],
  ].map(([r, z]) => new Vector2(r!, z!));
  const body = new Mesh(new LatheGeometry(profile, 24), skin);
  body.rotation.x = -Math.PI / 2;
  body.scale.set(1, 1, 0.82);
  g.add(body);
  const wingShape = new Shape();
  wingShape.moveTo(0, -1.6);
  wingShape.lineTo(4.7, 2.4);
  wingShape.lineTo(4.7, 3.3);
  wingShape.lineTo(0, 3.9);
  wingShape.closePath();
  const wingGeo = new ExtrudeGeometry(wingShape, { depth: 0.14, bevelEnabled: false });
  for (const side of [1, -1]) {
    const w = new Mesh(wingGeo, skin);
    w.rotation.x = Math.PI / 2;
    w.scale.set(side, 1, 1);
    w.position.set(0, -0.1, 0);
    g.add(w);
    const tail = new Mesh(wingGeo, skin);
    tail.rotation.x = Math.PI / 2;
    tail.scale.set(side * 0.42, 0.42, 1);
    tail.position.set(0, 0, 5.2);
    g.add(tail);
  }
  const finShape = new Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(2.4, 2.8);
  finShape.lineTo(3.4, 2.8);
  finShape.lineTo(3.2, 0);
  finShape.closePath();
  const fin = new Mesh(new ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: false }), skin);
  fin.rotation.y = -Math.PI / 2;
  fin.position.set(0.06, 0.5, 3.4);
  g.add(fin);
  const canopy = new Mesh(new SphereGeometry(1, 20, 12), metal(0x14191d, 0.12, 0.6));
  canopy.scale.set(0.5, 0.42, 1.7);
  canopy.position.set(0, 0.62, -3.3);
  g.add(canopy);
  const nozzle = new Mesh(new CylinderGeometry(0.52, 0.6, 0.9, 20, 1, true), dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0, 7.1);
  g.add(nozzle);
  return g;
}

function floorTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#5b5f62';
  x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(20,22,24,0.55)';
  x.lineWidth = 3;
  for (let i = 0; i <= 512; i += 128) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, 512);
    x.moveTo(0, i);
    x.lineTo(512, i);
    x.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function hangar(scene: Scene): Group {
  scene.background = new Color(0.006, 0.007, 0.008);
  const floorMat = metal(0xffffff, 0.82, 0);
  floorMat.map = floorTexture();
  const floor = new Mesh(new PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const line = new Mesh(new PlaneGeometry(0.25, 40), metal(0xc9c3b0, 0.7, 0));
  line.rotation.x = -Math.PI / 2;
  line.position.set(-7, 0.01, 0);
  scene.add(line);
  const wall = metal(0x1c2023, 0.9, 0.1);
  const back = new Mesh(new BoxGeometry(80, 22, 1), wall);
  back.position.set(0, 11, -22);
  scene.add(back);
  for (let i = -8; i <= 8; i++) {
    const rib = new Mesh(new BoxGeometry(0.5, 22, 1.2), metal(0x2a2f33, 0.8, 0.2));
    rib.position.set(i * 4.5, 11, -21.2);
    scene.add(rib);
  }
  const jet = standInJet();
  jet.position.set(0, 1.7, 0);
  jet.rotation.y = 2.25;
  scene.add(jet);
  const key = new SpotLight(0xfff1dc, 900, 60, 0.55, 0.6, 1.6);
  key.position.set(4, 18, 6);
  key.target = jet;
  const rim = new SpotLight(0xcfe0ff, 400, 60, 0.5, 0.7, 1.6);
  rim.position.set(-10, 12, -12);
  rim.target = jet;
  scene.add(key, rim, new HemisphereLight(0x3c4652, 0x141210, 0.25));
  h.camera.position.set(-3, 4.6, 19);
  h.camera.lookAt(0.5, 1.4, 0);
  return jet;
}

function skyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#16202b');
  g.addColorStop(0.22, '#3a4250');
  g.addColorStop(0.34, '#8a7466');
  g.addColorStop(0.4, '#e0a070');
  g.addColorStop(0.42, '#f3c48c');
  g.addColorStop(0.44, '#6d5446');
  g.addColorStop(0.6, '#262322');
  g.addColorStop(1, '#121212');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function sky(scene: Scene): Group {
  scene.background = skyTexture();
  const sun = new DirectionalLight(0xffb27a, 6);
  sun.position.set(-40, 10, -60);
  scene.add(sun, new HemisphereLight(0x8090a4, 0x2a211c, 1.1));
  const sea = new Mesh(new PlaneGeometry(4000, 4000), metal(0x1d2a33, 0.25, 0.1));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -60;
  scene.add(sea);
  const cloudMat = metal(0xc9bcb0, 1, 0);
  for (let i = 0; i < 14; i++) {
    const c = new Mesh(new SphereGeometry(1, 14, 10), cloudMat);
    const a = i * 2.39996;
    c.scale.set(40 + (i % 3) * 18, 6 + (i % 2) * 3, 26 + (i % 4) * 8);
    c.position.set(Math.cos(a) * (120 + i * 22), -40, -140 - Math.sin(a) * 80 - i * 30);
    scene.add(c);
  }
  const jet = standInJet();
  jet.position.set(4, 0, -30);
  jet.rotation.set(0.05, -0.6, 0.35);
  scene.add(jet);
  h.camera.position.set(-6, 2.4, -8);
  h.camera.lookAt(6, -1.5, -36);
  return jet;
}

const jet = SKY_SCREENS.has(screen) ? sky(h.scene) : hangar(h.scene);
// A fixed pose keeps screenshots comparable between critique passes.
h.frame(() => {
  jet.updateMatrixWorld();
});

// ─────────────────────────────────────────────────────────────── Mock data (realistic, not placeholder)

const RANK = 7;
const profileBefore: PilotProfileView = {
  callsign: 'SHRIKE',
  rank: RANK,
  rankName: 'Flight Lieutenant',
  xp: 14250,
  xpIntoRank: 1250,
  xpForRank: 3000,
  stats: { kills: 118, deaths: 31, sorties: 64, flightSeconds: 66780, accuracy: 0.34 },
};
const profileAfter: PilotProfileView = {
  ...profileBefore,
  rank: 8,
  rankName: 'Squadron Leader',
  xp: 16800,
  xpIntoRank: 800,
  xpForRank: 3400,
  stats: { kills: 124, deaths: 31, sorties: 65, flightSeconds: 67514, accuracy: 0.35 },
};

const maps: MapSummary[] = MAP_IDS.map((id) => {
  const m = MAPS[id];
  return { ...m, available: m.tier === 1 };
});

const aircraft: AircraftSummary[] = AIRCRAFT_IDS.map((id) => {
  const a = AIRCRAFT[id];
  return {
    id,
    name: a.name,
    role: a.role,
    description: a.description,
    unlocked: a.unlockRank <= RANK,
    unlockRank: a.unlockRank,
    stats: {
      topSpeedMach: a.stats.topSpeedMach,
      thrustToWeight: a.stats.thrustToWeight,
      gLimit: a.gLimit,
      rollRateDeg: a.stats.rollRateDeg,
      hardpoints: a.hardpoints.length,
      gun: a.gun === 'gun30' ? '30 mm' : '25 mm',
    },
  };
});

const lessons: LessonSummary[] = [
  [
    'basic',
    'Basic flight',
    'Pitch, roll and yaw. Fly the ring course over the strait without missing a gate.',
    'gold',
    102.36,
  ],
  [
    'energy',
    'Energy and throttle',
    'Afterburner, speed management, the stall and the recovery.',
    'silver',
    188.4,
  ],
  [
    'landing',
    'Takeoff and landing',
    'Runway takeoff, the circuit, a glide slope approach, touchdown and braking.',
    'none',
    null,
  ],
  [
    'gunnery',
    'Gunnery',
    'A towed target and slow drones. Put the lead pip on them and fire short bursts.',
    'bronze',
    241.9,
  ],
  [
    'missiles',
    'Missiles',
    'IR lock and launch inside visual range, then a radar lock beyond it.',
    'none',
    null,
  ],
  [
    'defensive',
    'Defensive flying',
    'Beat incoming missiles with flares, chaff, break turns and beaming.',
    'none',
    null,
  ],
  [
    'bfm',
    'Basic fighter maneuvers',
    'One against one with a Rookie from offensive, neutral and defensive setups.',
    'none',
    null,
  ],
  ['ground', 'Ground attack', 'Rockets with CCIP, laser-guided bombs and SAM avoidance.', 'none', null],
].map(([id, title, description, medal, best], i) => ({
  id: id as string,
  number: i + 1,
  title: title as string,
  description: description as string,
  available: i !== 2 && i !== 7,
  medal: medal as LessonSummary['medal'],
  bestTime: best as number | null,
}));

const missions: MissionSummary[] = [
  [
    'First light',
    'kessel',
    'Combat air patrol over the Kessel median line. Two flights of Varen trainers have been probing the strait since 0500. Turn them back or shoot them down.',
  ],
  [
    'Tanker track',
    'kessel',
    'Four Borzoi interceptors crossed the median line at 0612, heading for the tanker track. Intercept and prevent them from reaching it. Tanker call sign is SHEPHERD.',
  ],
  [
    'Canyon run',
    'mesa',
    'Radar sites along the Mesa Roja canyon rim cover the southern approach. Stay under 150 meters through the canyon and destroy all three.',
  ],
  [
    'Dust line',
    'mesa',
    'Escort a four-ship strike package to the dry-lake airstrip. Varen fighters are expected on the second leg. Bingo fuel is 1,200 kg.',
  ],
  [
    'Cold water',
    'norrdal',
    'The Norrdal dam is ringed by surface-to-air sites under the cloud deck. Take down the network so the strike can go in.',
  ],
  [
    'Above the deck',
    'norrdal',
    'A Veteran squadron patrols above the overcast. Engage above and below the layer and hold the valley.',
  ],
  [
    'Lights out',
    'varen',
    'Night strike on the Port Varen command center through the SAM belt and flak batteries.',
  ],
  ['Typhoon', 'typhoon', 'Defend the carrier group against an anti-ship strike at the edge of the storm.'],
  ['Splash one', 'kessel', 'Dawn over Kessel Strait. The Varen ace squadron is airborne. Four Aces. Engage.'],
].map(([title, map, briefing], i) => ({
  id: `m${i + 1}`,
  number: i + 1,
  title: title!,
  map: map as MissionSummary['map'],
  briefing: briefing!,
  available: i < 4,
  completed: i < 3,
  medal: (['gold', 'silver', 'bronze'] as const)[i] ?? 'none',
}));

const debrief = (outcome: 'success' | 'failure'): DebriefData => ({
  outcome,
  title: outcome === 'success' ? 'Mission complete' : 'Shot down',
  subtitle: 'Instant action · Kessel Strait · 6 bandits, Veteran',
  time: 734,
  stats: [
    { label: 'Kills', value: outcome === 'success' ? '6' : '3' },
    { label: 'SRM kills', value: '3' },
    { label: 'MRM kills', value: '1' },
    { label: 'Gun kills', value: '2' },
    { label: 'Missiles fired', value: '9' },
    { label: 'Rounds fired', value: '412' },
    { label: 'Accuracy', value: '31%' },
    { label: 'Damage taken', value: outcome === 'success' ? '18%' : '100%' },
    { label: 'Flares used', value: '14 / 60' },
  ],
  timeline: [
    { time: 41, text: 'Merged with Red 2 over the northern islands' },
    { time: 74, text: 'Splash: Borzoi, SRM from the rear quarter' },
    { time: 139, text: 'Defeated an SRM launch with flares' },
    { time: 188, text: 'Splash: Wyvern, gun kill at 420 m' },
    { time: 262, text: 'Wingman Viper 2 shot down' },
    { time: 318, text: 'Splash: Harrow, MRM at 14 km' },
    { time: 455, text: 'Splash: Wyvern, SRM' },
    { time: 590, text: 'Splash: Borzoi, gun kill' },
    { time: 701, text: 'Splash: Harrow, SRM. Airspace clear' },
  ],
  xpGained: 2550,
  medal: outcome === 'success' ? 'silver' : 'none',
  profileBefore,
  profileAfter: outcome === 'success' ? profileAfter : profileBefore,
  unlocks: outcome === 'success' ? ['Rank 08: Squadron Leader', 'Callsign plate: brushed steel'] : [],
});

// ─────────────────────────────────────────────────────────────── Mount UI

const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;z-index:1;';
document.body.appendChild(host);

const scale = Number(params.get('scale'));
if (Number.isFinite(scale) && scale > 0) settings.update((s) => (s.accessibility.uiScale = scale));

const noop = (): void => undefined;
const ui = createUi(host);
const played: string[] = [];
ui.onSound = (id) => played.push(id);

async function run(): Promise<void> {
  await loadFonts();
  switch (screen) {
    case 'title':
      ui.showTitle(noop);
      break;
    case 'menu':
      ui.showMainMenu(profileBefore, {
        onCampaign: noop,
        onInstantAction: noop,
        onFreeFlight: noop,
        onTraining: noop,
        onSurvival: noop,
        onHangar: noop,
        onSettings: noop,
        onCredits: noop,
      });
      break;
    case 'instant':
      ui.showInstantAction(
        {
          map: 'kessel',
          aircraft: 'harrow',
          enemies: 6,
          allies: 3,
          skill: 'veteran',
          weapons: 'standard',
          respawn: true,
          timeLimit: 10,
          scoreLimit: 15,
        },
        maps,
        aircraft,
        noop,
        noop,
      );
      break;
    case 'free':
      ui.showFreeFlight(
        { map: 'mesa', aircraft: 'wyvern', start: 'air', drones: true, rings: false },
        maps,
        aircraft,
        noop,
        noop,
      );
      break;
    case 'training':
      ui.showTraining(lessons, noop, noop);
      break;
    case 'campaign':
      ui.showCampaign(missions, noop, noop);
      break;
    case 'hangar':
      ui.showHangar(aircraft, 'harrow', noop, noop);
      break;
    case 'settings':
      ui.showSettings(noop, (params.get('tab') ?? 'graphics') as SettingsSection);
      break;
    case 'credits':
      ui.showCredits(noop);
      break;
    case 'briefing':
      ui.showBriefing(
        'Tanker track',
        maps[0]!,
        'Four Borzoi interceptors crossed the Kessel median line at 0612, heading for the tanker track. Intercept and prevent them from reaching it.\n\nWeapons are free once hostile intent is confirmed. Tanker call sign is SHEPHERD. Bingo fuel is 1,200 kg.',
        [
          'Intercept the Borzoi flight before it reaches the tanker track',
          'SHEPHERD must survive',
          'Return to Kessel before bingo fuel',
        ],
        noop,
        noop,
      );
      break;
    case 'loading':
      ui.showLoading('Kessel Strait', 'Instant action · 6 bandits');
      ui.setLoadingProgress(0.64, 'Compiling shaders');
      break;
    case 'pause':
      ui.showPause({ onResume: noop, onRestart: noop, onSettings: noop, onQuit: noop });
      break;
    case 'debrief':
      ui.showDebrief(debrief(params.get('outcome') === 'failure' ? 'failure' : 'success'), noop, noop);
      break;
    case 'resume':
      ui.showGame();
      ui.showClickToResume(noop);
      break;
    case 'fatal':
      ui.showFatal(
        'WebGL 2 unavailable',
        'This browser could not create a WebGL 2 context, so the 3D view cannot start.\nUpdate the browser or graphics driver, turn on hardware acceleration in the browser settings, then reload the page.',
      );
      break;
    case 'toasts':
      ui.showGame();
      break;
    default:
      ui.showFatal('Unknown harness screen', `No screen named "${screen}". Check the screen parameter.`);
  }

  const device = params.get('device');
  const keys = (params.get('keys') ?? '').split(',').filter(Boolean);
  await wait(400);
  if (device === 'gamepad') ui.root.dataset.device = 'gamepad';
  for (const code of keys) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    await wait(260);
  }
  await wait(screen === 'debrief' ? 3200 : 700);
  if (screen === 'toasts') {
    // Four toasts: the stack keeps the newest three (ZD-J12). Pushed last so none expire before capture.
    ui.toast('Settings could not be saved. Storage is unavailable in this window.', 'warn');
    ui.toast('Controller connected: standard layout.', 'info');
    ui.toast('Graphics settings restored to their defaults.', 'success');
    ui.toast('Rank 08 reached. Kv-40 Borzoi unlocks at rank 10.', 'info');
    // Capture can take seconds under SwiftShader: refreshing the visible three keeps them on screen.
    window.setInterval(() => {
      ui.toast('Controller connected: standard layout.', 'info');
      ui.toast('Graphics settings restored to their defaults.', 'success');
      ui.toast('Rank 08 reached. Kv-40 Borzoi unlocks at rank 10.', 'info');
    }, 1000);
    await wait(300);
  }
  // SwiftShader renders slowly; let every finite UI transition and animation settle before capture.
  const finite = document
    .getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
  await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  window.__HARNESS_INFO__ = { screen, capturing: ui.capturingInput, sounds: played.length, ...audit() };
  window.__HARNESS_READY__ = true;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Layout audit for ZD-J01: anything outside the viewport, and every scrolled container. */
function audit(): { offscreen: string[]; scrolled: string[]; clipped: string[] } {
  const offscreen: string[] = [];
  const scrolled: string[] = [];
  const clipped: string[] = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const name = (e: Element): string => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
  for (const e of ui.root.querySelectorAll('.s1-screen.is-in *, .s1-toasts *')) {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Content inside a UI scroll container may extend past the fold by design (it scrolls).
    const inScroller = e.parentElement?.closest('.s1-scroll') !== null;
    const out = r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1;
    if (out && !inScroller) offscreen.push(name(e));
    if (e instanceof HTMLElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowY !== 'visible' && e.scrollHeight > e.clientHeight + 1) scrolled.push(name(e));
      const leaf = e.children.length === 0 && Boolean(e.textContent) && cs.display !== 'inline';
      const control = e.matches('.s1-seg, .s1-select, .s1-step, .s1-foot__actions, .s1-hints, .s1-tabs');
      if ((leaf || control) && e.scrollWidth > e.clientWidth + 1) clipped.push(name(e));
    }
  }
  return { offscreen: offscreen.slice(0, 8), scrolled: scrolled.slice(0, 8), clipped: clipped.slice(0, 8) };
}

void run();

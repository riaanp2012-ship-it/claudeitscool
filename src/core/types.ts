/**
 * FROZEN CONTRACTS between modules (spec §2.4). Parallel workstreams implement or consume these.
 * Changing anything here requires the orchestrator's approval; propose changes instead of editing.
 *
 * Conventions for every module:
 *  - Units: meters, seconds, kilograms, newtons, radians. 1 world unit = 1 m.
 *  - World axes: +Y up, -Z north, +X east. Headings are radians clockwise from north (-Z).
 *  - Aircraft local axes: nose toward -Z, up +Y, right wing +X, origin at the center of gravity.
 *  - No per-frame allocations in update()/draw() paths. Everything created must be freed in dispose().
 */
import type {
  Color,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';

export type QualityLevel = 'low' | 'medium' | 'high';
export type MapId = 'kessel' | 'mesa' | 'norrdal' | 'varen' | 'typhoon';
export type AircraftId = 'kestrel' | 'harrow' | 'wyvern' | 'borzoi' | 'mule' | 'nightjar';
export type Team = 'blue' | 'red';
export type HardpointKind = 'srm' | 'mrm' | 'lraam' | 'rocketPod' | 'bomb' | 'agm' | 'tank';

// ─────────────────────────────────────────────────────────────── World (src/world)

export interface WorldQuality {
  terrain: QualityLevel;
  clouds: QualityLevel;
  water: QualityLevel;
  /** 0..1 vegetation and props density. */
  vegetation: number;
}

export interface WorldOptions {
  map: MapId;
  quality: WorldQuality;
}

export interface RunwayInfo {
  id: string;
  /** Center of the runway surface (y = surface height). */
  center: Vector3;
  /** Direction of the runway centerline, radians clockwise from north. */
  heading: number;
  length: number;
  width: number;
}

export interface SpawnPoint {
  position: Vector3;
  heading: number;
}

export type GroundTargetKind = 'sam' | 'aaa' | 'radar' | 'hangar' | 'fuel' | 'ship' | 'command' | 'bunker';

export interface GroundTargetSlot {
  id: string;
  kind: GroundTargetKind;
  position: Vector3;
  heading: number;
  /** Named cluster, for mission scripting (for example 'dam-sams'). */
  group: string;
}

export interface World {
  readonly map: MapId;
  /** Add to the scene. Contains terrain, water, sky, clouds, vegetation, structures and lights. */
  readonly root: Object3D;
  /** The map's sun. Its direction always equals atmoUniforms.uSunDir. */
  readonly sun: DirectionalLight;
  /** Prefiltered environment map of this map's sky for PBR reflections (scene.environment). */
  readonly environment: Texture | null;
  /** Half-extent of the playable square in meters; the combat area is |x|,|z| < boundary. */
  readonly boundary: number;
  readonly waterLevel: number;
  /** Altitude (m) of the main cloud deck if the map has one, otherwise null. */
  readonly cloudDeck: { base: number; top: number } | null;
  readonly runways: readonly RunwayInfo[];
  readonly airSpawns: { readonly blue: readonly SpawnPoint[]; readonly red: readonly SpawnPoint[] };
  readonly groundTargets: readonly GroundTargetSlot[];
  /** Terrain height at x/z. Bilinear on the exact data the GPU renders. Must be cheap (called thousands of times per frame). */
  heightAt(x: number, z: number): number;
  /** max(heightAt, waterLevel). */
  surfaceAt(x: number, z: number): number;
  normalAt(x: number, z: number, out: Vector3): Vector3;
  /** True if terrain blocks the straight segment from a to b. */
  lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
  /** 0..1 cloud density at a point (used for the in-cloud whiteout and AI visibility). */
  cloudDensityAt(p: Vector3): number;
  /** Per frame, after the camera is placed: LOD selection, sorting, animation. */
  update(camera: PerspectiveCamera, dt: number, elapsed: number): void;
  dispose(): void;
}

export type WorldFactory = (
  renderer: WebGLRenderer,
  options: WorldOptions,
  onProgress: (fraction: number, label: string) => void,
) => Promise<World>;

// ─────────────────────────────────────────────────────────────── Aircraft art (src/art)

export interface AircraftVisualState {
  /** -1..1, positive rolls right. */
  aileron: number;
  /** -1..1, positive pitches nose up. */
  elevator: number;
  /** -1..1, positive yaws nose right. */
  rudder: number;
  flaps: number; // 0..1
  airbrake: number; // 0..1
  gear: number; // 0 retracted .. 1 down and locked
  throttle: number; // 0..1
  afterburner: number; // 0..1
  canopy: number; // 0 closed .. 1 open
  /** 0 intact .. 1 destroyed, per part. A part at 1 may be visually detached. */
  damage: { engine: number; wingL: number; wingR: number; tail: number };
  navLights: boolean;
  /** Same length and order as AircraftDef.hardpoints; false hides the store on that station. */
  stores: readonly boolean[];
}

export interface HardpointMount {
  /** Local position where the store hangs (store origin = its center of mass). */
  position: Vector3;
  kind: HardpointKind;
  internal: boolean;
}

export interface HitCapsule {
  a: Vector3;
  b: Vector3;
  radius: number;
  part: 'fuselage' | 'cockpit' | 'engine' | 'wingL' | 'wingR' | 'tail';
}

export interface AircraftModel {
  /** Nose -Z, up +Y, right +X, origin at CG, meters. */
  readonly root: Object3D;
  readonly length: number;
  readonly span: number;
  readonly radius: number;
  /** Pilot eye position (local) for the cockpit camera. */
  readonly cockpitEye: Vector3;
  /** Local nozzle exit centers (1 or 2). */
  readonly nozzles: readonly Vector3[];
  /** Local wingtip positions [left, right] for vortex trails. */
  readonly wingtips: readonly [Vector3, Vector3];
  /** Same order and kinds as AircraftDef.hardpoints. */
  readonly hardpoints: readonly HardpointMount[];
  /** Local muzzle position of the gun. */
  readonly gunMuzzle: Vector3;
  /** Local Y of the wheel contact points with gear down (negative). */
  readonly gearContactY: number;
  readonly hitCapsules: readonly HitCapsule[];
  /** 0 = full detail with moving parts, 1 = merged low detail, 2 = hidden (the effects system draws a dot). */
  setLod(level: 0 | 1 | 2): void;
  update(state: AircraftVisualState, dt: number, time: number): void;
  dispose(): void;
}

export interface AircraftModelOptions {
  livery: number;
  team: Team;
  /** Painted on the tail, for example '412'. */
  tailNumber: string;
}

export type AircraftModelFactory = (id: AircraftId, options: AircraftModelOptions) => AircraftModel;

/** A weapon in flight or on a pylon. Origin at the center, nose -Z. Shared geometry, cheap to create. */
export type OrdnanceModelFactory = (kind: HardpointKind) => Object3D;

// ─────────────────────────────────────────────────────────────── Effects (src/fx)

export type ExplosionKind = 'air-small' | 'air-large' | 'ground' | 'water' | 'aircraft';
export type ImpactKind = 'metal' | 'ground' | 'water';
export type TrailKind = 'missile' | 'contrail' | 'vortex' | 'damage-smoke' | 'fire' | 'flare';

export interface TrailHandle {
  /** Add the current emitter position. intensity 0..1 scales width/opacity; 0 leaves a gap. */
  push(position: Vector3, intensity: number): void;
  /** Stop emitting; the trail fades out and its slot is recycled automatically. */
  release(): void;
}

export interface Fx {
  readonly root: Object3D;
  explosion(position: Vector3, kind: ExplosionKind, velocity?: Vector3): void;
  impact(position: Vector3, normal: Vector3, kind: ImpactKind): void;
  /** Tumbling debris pieces with smoke. */
  debris(position: Vector3, velocity: Vector3, count: number): void;
  /** Returns null when the pool is exhausted (callers must handle it). */
  trail(kind: TrailKind): TrailHandle | null;
  /** Immediate mode, cleared after each render: additive glow sprite (lights, afterburner glow, flares). */
  glow(position: Vector3, color: Color, size: number, intensity: number): void;
  /** Immediate mode: bullet tracer segment. */
  tracer(from: Vector3, to: Vector3, color: Color, width: number): void;
  /** Immediate mode: distant aircraft marker, always at least 2 px so aircraft never vanish (ZD-B36). */
  dot(position: Vector3, color: Color): void;
  /** Short explosion light; drives atmoUniforms.uFlash* for terrain/water and pooled scene lights. */
  flash(position: Vector3, color: Color, intensity: number, radius: number, duration: number): void;
  /** Muzzle flash at a world position with direction. */
  muzzle(position: Vector3, direction: Vector3, scale: number): void;
  setQuality(level: QualityLevel, reduceFlashes: boolean): void;
  /** Compile every effect shader and upload buffers so first use never hitches (ZD-C02). */
  warmup(renderer: WebGLRenderer, camera: PerspectiveCamera): Promise<void>;
  update(dt: number, camera: PerspectiveCamera, surfaceAt: (x: number, z: number) => number): void;
  stats(): { particles: number; trails: number; glows: number };
  /** Remove all live effects (restart/quit) without disposing GPU resources. */
  clear(): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────── Audio (src/audio)

export type SfxId =
  | 'missileLaunch'
  | 'rocketLaunch'
  | 'bombRelease'
  | 'explosionSmall'
  | 'explosionLarge'
  | 'explosionGround'
  | 'explosionWater'
  | 'hitMetal'
  | 'hitTaken'
  | 'flare'
  | 'chaff'
  | 'gearMove'
  | 'canopy'
  | 'sonicBoom'
  | 'touchdown'
  | 'crash'
  | 'checkpoint'
  | 'medal'
  | 'killConfirm'
  | 'uiHover'
  | 'uiConfirm'
  | 'uiBack'
  | 'uiError'
  | 'uiToggle';

export interface EngineParams {
  throttle: number; // 0..1 (spooled value)
  afterburner: number; // 0..1
  speed: number; // m/s airspeed
  mach: number;
  g: number;
  aoa: number; // rad
  position: Vector3;
  velocity: Vector3;
  /** Inside the cockpit view (muffled, adds cockpit layers). Only meaningful for the player. */
  cockpit: boolean;
  damaged: number; // 0..1 engine damage (adds rough sputter)
}

export interface EngineVoice {
  set(params: EngineParams): void;
  dispose(): void;
}

export interface GunVoice {
  setFiring(firing: boolean, position: Vector3, velocity: Vector3): void;
  dispose(): void;
}

export interface CockpitTones {
  /** IR seeker: off, growl while searching, high steady tone when locked. */
  seeker: 'off' | 'search' | 'locked';
  /** Radar lock acquired on our target. */
  radarLock: boolean;
  /** Radar warning receiver: someone is locked on us, or a radar missile is guiding. */
  rwr: 'off' | 'spike' | 'launch';
  missileWarning: boolean;
  stall: boolean;
  pullUp: boolean;
  /** Current G, for strain breathing above ~6.5 G. */
  g: number;
}

export interface AudioVolumes {
  master: number;
  music: number;
  effects: number;
  radio: number;
  ui: number;
}

export interface AudioSystem {
  readonly unlocked: boolean;
  /** Must be called from a user gesture (key/click). Safe to call repeatedly. */
  unlock(): Promise<void>;
  setVolumes(v: AudioVolumes): void;
  setListener(position: Vector3, quaternion: Quaternion, velocity: Vector3): void;
  /** Pause all game audio (not UI). */
  setPaused(paused: boolean): void;
  /** Mute everything (tab hidden). */
  setMuted(muted: boolean): void;
  createEngine(isPlayer: boolean): EngineVoice;
  createGun(kind: 'gun25' | 'gun30', isPlayer: boolean): GunVoice;
  play(
    id: SfxId,
    options?: { position?: Vector3; velocity?: Vector3; volume?: number; pitch?: number },
  ): void;
  setCockpitTones(tones: CockpitTones): void;
  /** Radio squelch click at the start/end of a subtitle line. */
  radio(): void;
  setMenuMusic(on: boolean): void;
  update(dt: number): void;
  /** Stop all game voices (quit/restart) but keep the context alive. */
  stopAll(): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────── HUD (src/hud)

export interface HudPoint {
  x: number; // CSS pixels from the left of the viewport
  y: number; // CSS pixels from the top
  visible: boolean; // false when behind the camera
}

export interface HudContact {
  id: number;
  screen: HudPoint;
  /** Direction of the contact on screen when off-screen: angle (rad) from screen up, clockwise. */
  offscreenAngle: number;
  onScreen: boolean;
  distance: number; // m
  closure: number; // m/s, positive when closing
  team: Team;
  label: string; // callsign or type
  kind: 'aircraft' | 'ground' | 'ship' | 'drone' | 'checkpoint';
  selected: boolean;
  /** 0..1 lock progress on the selected target, 1 = locked. */
  lock: number;
  /** 0..1 remaining health, shown for the selected target. */
  health: number;
  /** In range of the selected weapon. */
  inRange: boolean;
}

export interface HudThreat {
  /** Bearing relative to the aircraft nose, radians clockwise, 0 = ahead. */
  bearing: number;
  kind: 'search' | 'lock' | 'missile';
  distance: number;
}

export interface HudRadarBlip {
  /** Position relative to the player, rotated so +y = aircraft heading, in meters. */
  x: number;
  y: number;
  team: Team;
  kind: 'aircraft' | 'ground' | 'ship' | 'missile' | 'checkpoint' | 'objective';
  selected: boolean;
  /** Heading relative to the player's heading (rad), for aircraft arrows. */
  heading: number;
}

export type HudWarning =
  'PULL UP' | 'STALL' | 'MISSILE' | 'BINGO' | 'OUT OF BOUNDS' | 'OVER-G' | 'ENGINE FIRE';

export interface HudState {
  viewport: { width: number; height: number };
  /** 'chase' draws a full-screen HUD; 'cockpit' clips to the HUD glass area; 'hidden' draws nothing but messages. */
  view: 'chase' | 'cockpit' | 'hidden';
  units: 'imperial' | 'metric';
  /** Camera attitude used for the conformal pitch ladder. */
  camera: {
    pitch: number;
    roll: number;
    heading: number;
    pxPerRad: number;
    center: { x: number; y: number };
  };
  /** Where the aircraft nose points (gun cross). */
  boresight: HudPoint;
  /** Flight path marker (velocity vector). */
  flightPath: HudPoint;
  /** Mouse-aim reticle (where the pilot wants to go); null when not in mouse aim. */
  aimReticle: HudPoint | null;
  aircraft: {
    heading: number; // rad
    pitch: number;
    roll: number;
    speed: number; // m/s indicated
    mach: number;
    altitude: number; // m MSL
    radarAltitude: number; // m AGL
    verticalSpeed: number; // m/s
    g: number;
    maxG: number;
    aoa: number; // rad
    throttle: number; // 0..1
    afterburner: boolean;
    fuel: number; // 0..1
    gearDown: boolean;
    flaps: boolean;
    airbrake: boolean;
    damage: { engine: number; wingL: number; wingR: number; tail: number; hull: number }; // 0..1
  };
  weapon: {
    name: string; // 'GUN', 'SRM', 'MRM', ...
    count: number;
    gunAmmo: number;
    /** Seeker circle for IR missiles (screen) and its radius in px. */
    seeker: { point: HudPoint; radius: number; locked: boolean } | null;
    /** Lead pip for guns (where to put the target). */
    leadPip: HudPoint | null;
    /** Launch envelope for the selected missile: min/max range (m) and the target's current range. */
    envelope: { min: number; max: number; noEscape: number; range: number } | null;
    /** CCIP pipper for unguided ground weapons. */
    ccip: HudPoint | null;
    reloading: number; // 0..1 cooldown remaining, 0 = ready
  };
  countermeasures: { flares: number; chaff: number };
  contacts: readonly HudContact[];
  threats: readonly HudThreat[];
  radar: { range: number; blips: readonly HudRadarBlip[] };
  warnings: readonly HudWarning[];
  /** Big center message (e.g., 'SPLASH ONE', 'MISSION COMPLETE'), with seconds remaining. */
  message: { text: string; sub: string; time: number } | null;
  killFeed: readonly { text: string; age: number; friendly: boolean }[];
  objectives: readonly { text: string; done: boolean; failed: boolean }[];
  subtitle: { speaker: string; text: string; age: number } | null;
  /** 0..1 fade of the hit marker after scoring a hit. */
  hitMarker: number;
  /** Seconds left before the out-of-bounds timer destroys/turns the player; null when inside. */
  outOfBounds: number | null;
  spawnProtection: number; // seconds left, 0 = none
  score: { left: string; right: string; timer: string } | null;
  /** Transient hints in training (e.g., 'Press T to lock the target'). */
  hint: string | null;
}

export interface Hud {
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number, dpr: number): void;
  setColor(color: 'green' | 'amber' | 'white'): void;
  setScale(scale: number): void;
  setColorblind(mode: 'off' | 'protan' | 'deutan' | 'tritan'): void;
  draw(state: HudState, dt: number): void;
  clear(): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────── UI (src/ui)

export interface PilotProfileView {
  callsign: string;
  rank: number;
  rankName: string;
  xp: number;
  xpIntoRank: number;
  xpForRank: number;
  stats: { kills: number; deaths: number; sorties: number; flightSeconds: number; accuracy: number };
}

export interface MapSummary {
  id: MapId;
  name: string;
  region: string;
  timeOfDay: string;
  weather: string;
  description: string;
  available: boolean;
}

export interface AircraftSummary {
  id: AircraftId;
  name: string;
  role: string;
  description: string;
  unlocked: boolean;
  unlockRank: number;
  /** Real-unit stats for the hangar. */
  stats: {
    topSpeedMach: number;
    thrustToWeight: number;
    gLimit: number;
    rollRateDeg: number;
    hardpoints: number;
    gun: string;
  };
}

export interface InstantActionOptions {
  map: MapId;
  aircraft: AircraftId;
  enemies: number; // 1..12
  allies: number; // 0..7
  skill: 'rookie' | 'veteran' | 'ace';
  weapons: 'guns' | 'standard' | 'unlimited';
  respawn: boolean;
  timeLimit: number; // minutes, 0 = none
  scoreLimit: number; // kills, 0 = none
}

export interface FreeFlightOptions {
  map: MapId;
  aircraft: AircraftId;
  start: 'air' | 'runway';
  drones: boolean;
  rings: boolean;
}

export interface LessonSummary {
  id: string;
  number: number;
  title: string;
  description: string;
  available: boolean;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
  bestTime: number | null;
}

export interface MissionSummary {
  id: string;
  number: number;
  title: string;
  map: MapId;
  briefing: string;
  available: boolean;
  completed: boolean;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
}

export interface DebriefData {
  outcome: 'success' | 'failure' | 'ended';
  title: string; // 'MISSION COMPLETE', 'SHOT DOWN', ...
  subtitle: string; // mode and map
  time: number; // seconds
  stats: readonly { label: string; value: string }[];
  timeline: readonly { time: number; text: string }[];
  xpGained: number;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
  profileBefore: PilotProfileView;
  profileAfter: PilotProfileView;
  unlocks: readonly string[];
}

export interface MainMenuHandlers {
  onCampaign(): void;
  onInstantAction(): void;
  onFreeFlight(): void;
  onTraining(): void;
  onSurvival?(): void;
  onHangar(): void;
  onSettings(): void;
  onCredits(): void;
}

export interface PauseHandlers {
  onResume(): void;
  onRestart(): void;
  onSettings(): void;
  onQuit(): void;
}

export interface Ui {
  readonly root: HTMLElement;
  /** Title screen. `onContinue` fires once on any key/click/gamepad button. */
  showTitle(onContinue: () => void): void;
  showMainMenu(profile: PilotProfileView, handlers: MainMenuHandlers): void;
  showInstantAction(
    defaults: InstantActionOptions,
    maps: readonly MapSummary[],
    aircraft: readonly AircraftSummary[],
    onStart: (o: InstantActionOptions) => void,
    onBack: () => void,
  ): void;
  showFreeFlight(
    defaults: FreeFlightOptions,
    maps: readonly MapSummary[],
    aircraft: readonly AircraftSummary[],
    onStart: (o: FreeFlightOptions) => void,
    onBack: () => void,
  ): void;
  showTraining(lessons: readonly LessonSummary[], onStart: (id: string) => void, onBack: () => void): void;
  showCampaign(missions: readonly MissionSummary[], onStart: (id: string) => void, onBack: () => void): void;
  /** Hangar: the 3D turntable is rendered by the game behind the UI; this is the overlay. */
  showHangar(
    aircraft: readonly AircraftSummary[],
    selected: AircraftId,
    onSelect: (id: AircraftId) => void,
    onBack: () => void,
  ): void;
  showSettings(onBack: () => void): void;
  showCredits(onBack: () => void): void;
  showBriefing(
    title: string,
    map: MapSummary,
    text: string,
    objectives: readonly string[],
    onBegin: () => void,
    onBack: () => void,
  ): void;
  showLoading(title: string, subtitle: string): void;
  setLoadingProgress(fraction: number, label: string): void;
  /** In-game: hides all menus (HUD only). */
  showGame(): void;
  showPause(handlers: PauseHandlers): void;
  showDebrief(data: DebriefData, onRetry: () => void, onContinue: () => void): void;
  /** Overlay shown when pointer lock is lost mid-flight. */
  showClickToResume(onResume: () => void): void;
  hideClickToResume(): void;
  showFatal(title: string, message: string): void;
  toast(text: string, kind?: 'info' | 'warn' | 'success'): void;
  /** True while any modal/menu wants keyboard input (the game ignores flight input then). */
  readonly capturingInput: boolean;
}

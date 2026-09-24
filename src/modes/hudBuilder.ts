import { Vector3, type PerspectiveCamera } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import { envelope, missileDefFor, weaponHudName } from '../combat/targeting';
import { G0, clamp, clamp01 } from '../core/math';
import { settings } from '../core/settings';
import type { HudContact, HudPoint, HudRadarBlip, HudState, HudThreat, HudWarning } from '../core/types';
import type { Session } from './session';

/**
 * Builds the HUD state from the session every frame (spec §8.6) without allocating in steady state:
 * contact/blip/threat objects are pooled and arrays are resized in place.
 */
const _v = new Vector3();
const _c = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _lead = new Vector3();
const _rel = new Vector3();

const point = (): HudPoint => ({ x: 0, y: 0, visible: false });

export function createHudState(): HudState {
  return {
    viewport: { width: 1, height: 1 },
    view: 'chase',
    units: 'imperial',
    camera: { pitch: 0, roll: 0, heading: 0, pxPerRad: 1, center: { x: 0, y: 0 } },
    boresight: point(),
    flightPath: point(),
    aimReticle: point(),
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
      gearDown: false,
      flaps: false,
      airbrake: false,
      damage: { engine: 0, wingL: 0, wingR: 0, tail: 0, hull: 0 },
    },
    weapon: {
      name: 'GUN',
      count: 0,
      gunAmmo: 0,
      seeker: null,
      leadPip: null,
      envelope: null,
      ccip: null,
      reloading: 0,
    },
    countermeasures: { flares: 0, chaff: 0 },
    contacts: [],
    threats: [],
    radar: { range: 20000, blips: [] },
    warnings: [],
    message: null,
    killFeed: [],
    objectives: [],
    subtitle: null,
    hitMarker: 0,
    outOfBounds: null,
    spawnProtection: 0,
    score: null,
    hint: null,
  };
}

/** Projects a world point into CSS pixels. Returns false when the point is behind the camera. */
export function projectToScreen(
  p: Vector3,
  camera: PerspectiveCamera,
  w: number,
  h: number,
  out: HudPoint,
): boolean {
  _c.copy(p).applyMatrix4(camera.matrixWorldInverse);
  const behind = _c.z > -0.05;
  _v.copy(p).project(camera);
  out.x = (_v.x * 0.5 + 0.5) * w;
  out.y = (-_v.y * 0.5 + 0.5) * h;
  out.visible = !behind;
  return !behind;
}

const contactPool: HudContact[] = [];
const blipPool: HudRadarBlip[] = [];
const threatPool: HudThreat[] = [];
const seekerState = { point: point(), radius: 0, locked: false };
const leadPip = point();
const ccip = point();
const envelopeState = { min: 0, max: 0, noEscape: 0, range: 0 };
const checkpointLabel = 'WAYPOINT';

export function buildHudState(s: Session, st: HudState): void {
  const p = s.player;
  const cam = s.camera;
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const cfg = settings.value;
  st.viewport.width = w;
  st.viewport.height = h;
  st.units = cfg.gameplay.units;
  st.view = !s.hudVisible || !p?.alive ? 'hidden' : s.rig.view === 'cockpit' ? 'cockpit' : 'chase';
  st.message = s.message;
  st.killFeed = s.killFeed;
  st.subtitle = cfg.gameplay.subtitles ? s.subtitle : null;
  st.objectives = s.rules.objectives(s);
  st.score = s.rules.score(s);
  st.hint = s.rules.hint?.(s) ?? null;
  st.hitMarker = s.hitMarker;
  st.outOfBounds = s.outOfBounds;
  if (!p) return;
  st.spawnProtection = p.spawnProtection;

  // Camera attitude for the conformal ladder
  cam.getWorldDirection(_fwd);
  _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  const camUp = _v.set(0, 1, 0).applyQuaternion(cam.quaternion);
  st.camera.pitch = Math.asin(clamp(_fwd.y, -1, 1));
  st.camera.roll = Math.atan2(-_right.y, camUp.y);
  st.camera.heading = Math.atan2(_fwd.x, -_fwd.z);
  st.camera.pxPerRad = s.rig.pxPerRad(h);
  st.camera.center.x = w / 2;
  st.camera.center.y = h / 2;

  const b = p.body;
  // Boresight (nose) and flight path marker, projected far ahead.
  b.forward(_fwd);
  _lead.copy(p.renderPosition).addScaledVector(_fwd, 3000);
  projectToScreen(_lead, cam, w, h, st.boresight);
  if (b.airspeed > 5) {
    _lead.copy(b.velocity).normalize().multiplyScalar(3000).add(p.renderPosition);
    projectToScreen(_lead, cam, w, h, st.flightPath);
  } else st.flightPath.visible = false;
  if (s.rig.mouseAim && st.aimReticle) {
    _lead.copy(p.renderPosition).addScaledVector(s.rig.aimDir, 3000);
    projectToScreen(_lead, cam, w, h, st.aimReticle);
  } else if (st.aimReticle) st.aimReticle.visible = false;

  const a = st.aircraft;
  a.heading = b.heading;
  a.pitch = b.pitchAngle;
  a.roll = b.bankAngle;
  a.speed = b.airspeed;
  a.mach = b.mach;
  a.altitude = b.position.y;
  a.radarAltitude = b.position.y - s.world.surfaceAt(b.position.x, b.position.z);
  a.verticalSpeed = b.velocity.y;
  a.g = b.g;
  a.maxG = Math.max(a.maxG, b.g);
  a.aoa = b.aoa;
  a.throttle = b.throttle;
  a.afterburner = b.afterburner > 0.2;
  a.fuel = s.options.unlimitedFuel ? 1 : b.fuel / p.def.fuelMax;
  a.gearDown = b.gear > 0.5;
  a.flaps = b.flaps > 0.5;
  a.airbrake = b.airbrake > 0.3;
  a.damage.engine = p.visual.damage.engine;
  a.damage.wingL = p.visual.damage.wingL;
  a.damage.wingR = p.visual.damage.wingR;
  a.damage.tail = p.visual.damage.tail;
  a.damage.hull = clamp01(1 - p.hp.fuselage / p.maxHp.fuselage);

  // Weapons
  const kind = p.selectedKind();
  const def = missileDefFor(kind);
  const wpn = st.weapon;
  wpn.name = weaponHudName(kind);
  wpn.count = kind ? p.roundsOf(kind) : 0;
  wpn.gunAmmo = p.gunAmmo;
  wpn.reloading = kind ? clamp01((p.cooldowns.get(kind) ?? 0) / (def?.cooldown ?? 1)) : 0;
  st.countermeasures.flares = p.flares;
  st.countermeasures.chaff = p.chaff;
  const t = p.target?.alive ? p.target : null;
  // Seeker circle: on the target when tracking, otherwise at the boresight.
  if (def && def.seeker === 'ir' && wpn.count > 0) {
    const onTarget = t && p.lockProgress > 0.05;
    if (onTarget) projectToScreen(t.position, cam, w, h, seekerState.point);
    else {
      seekerState.point.x = st.boresight.x;
      seekerState.point.y = st.boresight.y;
      seekerState.point.visible = st.boresight.visible;
    }
    seekerState.radius = Math.max(18, def.lockCone * 0.25 * st.camera.pxPerRad);
    seekerState.locked = p.locked;
    wpn.seeker = seekerState;
  } else wpn.seeker = null;
  // Gun lead pip for the target inside gun range.
  if (t && t.position.distanceTo(b.position) < p.gun.range * 1.5) {
    const d = t.position.distanceTo(b.position);
    const tof = d / p.gun.muzzleVelocity;
    _rel.subVectors(t.velocity, b.velocity);
    _lead.copy(t.position).addScaledVector(_rel, tof);
    _lead.y += 0.5 * G0 * tof * tof;
    // Where the nose must point: project the lead relative to our position, then add our position back.
    _lead.sub(b.position).normalize().multiplyScalar(3000).add(p.renderPosition);
    wpn.leadPip = projectToScreen(_lead, cam, w, h, leadPip) ? leadPip : null;
  } else wpn.leadPip = null;
  const env = envelope(p);
  if (env) {
    envelopeState.min = env.min;
    envelopeState.max = env.max;
    envelopeState.noEscape = env.noEscape;
    envelopeState.range = env.range;
    wpn.envelope = envelopeState;
  } else wpn.envelope = null;
  // CCIP for unguided ground weapons: predicted impact point of a bomb/rocket.
  if (kind === 'bomb' || kind === 'rocketPod') {
    const impact = predictImpact(p, kind === 'rocketPod', s);
    wpn.ccip = impact && projectToScreen(impact, cam, w, h, ccip) ? ccip : null;
  } else wpn.ccip = null;

  // Contacts
  let n = 0;
  const list = contactPool;
  for (const tgt of s.sim.targets) {
    if (!tgt.alive || (tgt as unknown) === p) continue;
    const d = tgt.position.distanceTo(b.position);
    if (d > 30000) continue;
    const c = (list[n] ??= {
      id: 0,
      screen: point(),
      offscreenAngle: 0,
      onScreen: false,
      distance: 0,
      closure: 0,
      team: 'red',
      label: '',
      kind: 'aircraft',
      selected: false,
      lock: 0,
      health: 1,
      inRange: false,
    });
    n++;
    fillContact(c, tgt.uid, tgt.position, tgt.velocity, tgt.team, tgt.label, tgt.kind, s, w, h);
    c.selected = tgt === p.target;
    c.lock = c.selected ? p.lockProgress : 0;
    c.health = tgt.health();
    c.inRange = !!(def && c.selected && d <= def.maxRange && d >= def.minRange);
  }
  const checkpoints = s.rules.checkpoints?.(s);
  if (checkpoints) {
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i]!;
      const c = (list[n] ??= {
        id: 0,
        screen: point(),
        offscreenAngle: 0,
        onScreen: false,
        distance: 0,
        closure: 0,
        team: 'blue',
        label: '',
        kind: 'checkpoint',
        selected: false,
        lock: 0,
        health: 1,
        inRange: false,
      });
      n++;
      fillContact(c, -1 - i, cp, _v.set(0, 0, 0), 'blue', checkpointLabel, 'checkpoint', s, w, h);
      c.selected = i === 0;
      c.lock = 0;
      c.health = 1;
      c.inRange = false;
    }
  }
  list.length = n;
  st.contacts = list;

  // Threats (RWR) and missile warnings
  let tn = 0;
  const threats = threatPool;
  for (const ac of s.sim.aircraft) {
    if (!ac.alive || ac.team === p.team || ac.target !== (p as unknown)) continue;
    const k = ac.selectedKind();
    if (k !== 'mrm' && k !== 'lraam') continue;
    const th = (threats[tn++] ??= { bearing: 0, kind: 'search', distance: 0 });
    th.bearing = relativeBearing(p, ac.body.position);
    th.kind = ac.locked ? 'lock' : 'search';
    th.distance = ac.body.position.distanceTo(b.position);
  }
  for (const g of s.sim.grounds) {
    if (!g.alive || g.tracking !== p) continue;
    const th = (threats[tn++] ??= { bearing: 0, kind: 'search', distance: 0 });
    th.bearing = relativeBearing(p, g.position);
    th.kind = g.trackTime > 4 ? 'lock' : 'search';
    th.distance = g.position.distanceTo(b.position);
  }
  let missileClose = false;
  for (const m of s.sim.combat.missiles.items) {
    if (m.isGuidedAt !== p) continue;
    const d = m.position.distanceTo(b.position);
    const th = (threats[tn++] ??= { bearing: 0, kind: 'missile', distance: 0 });
    th.bearing = relativeBearing(p, m.position);
    th.kind = 'missile';
    th.distance = d;
    if (d < 6000) missileClose = true;
  }
  threats.length = tn;
  st.threats = threats;

  // Radar (heading-up)
  const range = cfg.gameplay.units === 'metric' ? 20000 : 18520;
  st.radar.range = range;
  const hdg = b.heading;
  const sinH = Math.sin(hdg);
  const cosH = Math.cos(hdg);
  let bn = 0;
  const blips = blipPool;
  for (const tgt of s.sim.targets) {
    if (!tgt.alive || (tgt as unknown) === p) continue;
    const dx = tgt.position.x - b.position.x;
    const dz = tgt.position.z - b.position.z;
    if (dx * dx + dz * dz > range * range * 1.2) continue;
    const bl = (blips[bn++] ??= { x: 0, y: 0, team: 'red', kind: 'aircraft', selected: false, heading: 0 });
    bl.x = dx * cosH + dz * sinH;
    bl.y = dx * sinH - dz * cosH;
    bl.team = tgt.team;
    bl.kind = tgt.kind === 'drone' ? 'aircraft' : tgt.kind;
    bl.selected = tgt === p.target;
    bl.heading = Math.atan2(tgt.velocity.x, -tgt.velocity.z) - hdg;
  }
  for (const m of s.sim.combat.missiles.items) {
    if (!m.active || !m.guided) continue;
    const dx = m.position.x - b.position.x;
    const dz = m.position.z - b.position.z;
    if (dx * dx + dz * dz > range * range) continue;
    const bl = (blips[bn++] ??= { x: 0, y: 0, team: 'red', kind: 'missile', selected: false, heading: 0 });
    bl.x = dx * cosH + dz * sinH;
    bl.y = dx * sinH - dz * cosH;
    bl.team = m.team;
    bl.kind = 'missile';
    bl.selected = false;
    bl.heading = Math.atan2(m.velocity.x, -m.velocity.z) - hdg;
  }
  blips.length = bn;
  st.radar.blips = blips;

  // Warnings
  const warnings = st.warnings as HudWarning[];
  warnings.length = 0;
  if (p.alive) {
    if (missileClose) warnings.push('MISSILE');
    if (pullUpNeeded(p, s)) warnings.push('PULL UP');
    if (b.stalled && !b.onGround) warnings.push('STALL');
    if (b.overG) warnings.push('OVER-G');
    if (p.hp.engine <= 0) warnings.push('ENGINE FIRE');
    if (s.outOfBounds !== null) warnings.push('OUT OF BOUNDS');
    if (!s.options.unlimitedFuel && b.fuel / p.def.fuelMax < 0.15) warnings.push('BINGO');
  }
}

function fillContact(
  c: HudContact,
  id: number,
  pos: Vector3,
  vel: Vector3,
  team: 'blue' | 'red',
  label: string,
  kind: 'aircraft' | 'ground' | 'ship' | 'drone' | 'checkpoint',
  s: Session,
  w: number,
  h: number,
): void {
  const p = s.player;
  const cam = s.camera;
  c.id = id;
  c.team = team;
  c.label = label;
  c.kind = kind;
  c.distance = pos.distanceTo(p.body.position);
  _rel.subVectors(pos, p.body.position);
  const closingVel = _v.subVectors(p.body.velocity, vel);
  c.closure = c.distance > 1 ? closingVel.dot(_rel) / c.distance : 0;
  const front = projectToScreen(pos, cam, w, h, c.screen);
  c.onScreen = front && c.screen.x >= 0 && c.screen.x <= w && c.screen.y >= 0 && c.screen.y <= h;
  // Direction on screen for off-screen arrows: camera-space x/y.
  _c.copy(pos).applyMatrix4(cam.matrixWorldInverse);
  c.offscreenAngle = Math.atan2(_c.x, _c.y);
}

/** Bearing of a point relative to the aircraft's nose, clockwise radians. */
function relativeBearing(p: Aircraft, pos: Vector3): number {
  const dx = pos.x - p.body.position.x;
  const dz = pos.z - p.body.position.z;
  const bearing = Math.atan2(dx, -dz);
  let rel = bearing - p.body.heading;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  return rel;
}

/** Ground proximity: predicted terrain conflict within ~5 s along the flight path. */
function pullUpNeeded(p: Aircraft, s: Session): boolean {
  const b = p.body;
  if (b.onGround || b.gear > 0.9) return false;
  for (let i = 1; i <= 5; i++) {
    _v.copy(b.position).addScaledVector(b.velocity, i);
    if (_v.y < s.world.surfaceAt(_v.x, _v.z) + 40) return true;
  }
  return false;
}

/** Predicts the impact point of a bomb (ballistic) or rocket (near-straight) released now. */
function predictImpact(p: Aircraft, rocket: boolean, s: Session): Vector3 | null {
  const b = p.body;
  _v.copy(b.position);
  _rel.copy(b.velocity);
  if (rocket) {
    b.forward(_fwd);
    _rel.addScaledVector(_fwd, 500);
  }
  const dt = 0.1;
  for (let i = 0; i < 400; i++) {
    _rel.y -= 9.81 * dt * (rocket ? 0.3 : 1);
    _v.addScaledVector(_rel, dt);
    if (_v.y <= s.world.surfaceAt(_v.x, _v.z)) return _lead.copy(_v);
  }
  return null;
}

import { Color, Quaternion, Vector3 } from 'three';
import type { DamagePart, DamageSource, Shooter, Targetable } from '../combat/targetable';
import { clamp, clamp01, dampFactor } from '../core/math';
import { cosmetic } from '../core/rng';
import type {
  AircraftModel,
  AircraftVisualState,
  EngineVoice,
  GunVoice,
  HardpointKind,
  Team,
  TrailHandle,
} from '../core/types';
import type { AircraftDef } from '../data/aircraft';
import { GUNS, roundsFor, type GunDef } from '../data/weapons';
import { FlightBody, neutralInputs, type ControlInputs, type FlightEvent } from '../flight/flightModel';

export type LoadoutRule = 'guns' | 'standard' | 'unlimited';

export interface Station {
  kind: HardpointKind;
  rounds: number;
  capacity: number;
  /** Local mount position (from the model, or estimated when no model). */
  mount: Vector3;
  internal: boolean;
}

export interface DamageRecord {
  source: DamageSource;
  /** Seconds since the damage was dealt. */
  age: number;
  amount: number;
}

const PARTS: readonly DamagePart[] = ['fuselage', 'cockpit', 'engine', 'wingL', 'wingR', 'tail'];
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _qInv = new Quaternion();
const _seg = new Vector3();
const _pa = new Vector3();
const _closest = new Vector3();
const _dq = new Quaternion();
const _afterburnerColor = new Color(1.0, 0.55, 0.25);

let nextUid = 1;

/**
 * A single aircraft: flight body, systems, stores, damage and its visual/audio presentation.
 * Implements Targetable so weapons can lock and hit it and DamageSource so it can be credited.
 */
export class Aircraft implements Targetable, Shooter {
  readonly uid = nextUid++;
  readonly kind: 'aircraft' | 'drone';
  readonly team: Team;
  readonly def: AircraftDef;
  readonly body: FlightBody;
  readonly controls: ControlInputs = neutralInputs();
  readonly isPlayer: boolean;
  label: string;
  alive = true;
  /** True once the wreck has hit the ground or been fully destroyed. */
  finished = false;
  deathTime = -1;

  readonly hp: Record<DamagePart, number>;
  readonly maxHp: Record<DamagePart, number>;
  readonly stations: Station[] = [];
  readonly rule: LoadoutRule;
  gunAmmo: number;
  readonly gun: GunDef;
  flares: number;
  chaff: number;
  /** Index into weaponKinds(). */
  selectedWeapon = 0;
  gunTrigger = false;
  gunAccumulator = 0;
  roundCounter = 0;
  readonly cooldowns = new Map<string, number>();
  decoyCooldown = 0;

  target: Targetable | null = null;
  lockProgress = 0;
  locked = false;
  /** Who has damaged us recently (for kill credit and assists). */
  readonly damageLog: DamageRecord[] = [];
  spawnProtection = 0;
  /** Seconds since the last hit taken (HUD flash, AI reaction). */
  lastHitTime = -100;

  // Scoring
  kills = 0;
  deaths = 0;
  shotsFired = 0;
  shotsHit = 0;
  missilesFired = 0;

  // Presentation
  model: AircraftModel | null = null;
  readonly visual: AircraftVisualState;
  private readonly storesVisible: boolean[] = [];
  engineVoice: EngineVoice | null = null;
  gunVoice: GunVoice | null = null;
  private trails: {
    contrail: (TrailHandle | null)[];
    vortex: (TrailHandle | null)[];
    smoke: TrailHandle | null;
    fire: TrailHandle | null;
  } = {
    contrail: [null, null],
    vortex: [null, null],
    smoke: null,
    fire: null,
  };
  readonly renderPosition = new Vector3();
  readonly renderQuaternion = new Quaternion();
  private readonly prevPosition = new Vector3();
  private readonly prevQuaternion = new Quaternion();
  /** Wreck tumble after death. */
  private readonly tumble = new Vector3();
  lod: 0 | 1 | 2 = 0;
  readonly strobePhase = cosmetic.next();
  /** Local points tested against terrain (nose, wingtips, tail). */
  readonly collisionPoints: Vector3[];
  gearContactY: number;

  constructor(options: {
    def: AircraftDef;
    team: Team;
    label: string;
    isPlayer: boolean;
    rule: LoadoutRule;
    model: AircraftModel | null;
    drone?: boolean;
  }) {
    const { def } = options;
    this.def = def;
    this.team = options.team;
    this.label = options.label;
    this.isPlayer = options.isPlayer;
    this.kind = options.drone ? 'drone' : 'aircraft';
    this.rule = options.rule;
    this.body = new FlightBody(def);
    this.gun = GUNS[def.gun];
    this.gunAmmo = def.gunAmmo;
    this.flares = def.flares;
    this.chaff = def.chaff;
    this.model = options.model;
    this.hp = {
      fuselage: def.hp.fuselage,
      cockpit: def.hp.cockpit,
      engine: def.hp.engine,
      wingL: def.hp.wing,
      wingR: def.hp.wing,
      tail: def.hp.tail,
    };
    this.maxHp = { ...this.hp };
    const halfL = def.design.length / 2;
    const halfS = def.design.span / 2;
    this.collisionPoints = [
      new Vector3(0, 0, -halfL),
      new Vector3(-halfS, 0, halfL * 0.2),
      new Vector3(halfS, 0, halfL * 0.2),
      new Vector3(0, -def.design.height * 0.25, halfL * 0.8),
    ];
    this.gearContactY = options.model?.gearContactY ?? -def.design.height * 0.45;
    def.hardpoints.forEach((hp, i) => {
      const mount = options.model?.hardpoints[i]?.position.clone() ?? estimateMount(def, i);
      const capacity = roundsFor(hp.kind);
      const rounds = options.rule === 'guns' ? 0 : capacity;
      this.stations.push({ kind: hp.kind, rounds, capacity, mount, internal: hp.internal });
    });
    this.body.storesMass = this.storesMass();
    this.visual = {
      aileron: 0,
      elevator: 0,
      rudder: 0,
      flaps: 0,
      airbrake: 0,
      gear: 0,
      throttle: 0,
      afterburner: 0,
      canopy: 0,
      damage: { engine: 0, wingL: 0, wingR: 0, tail: 0 },
      navLights: true,
      stores: this.storesVisible,
    };
    for (const s of this.stations) this.storesVisible.push(s.rounds > 0);
    if (options.model) this.radius = options.model.radius;
    else this.radius = Math.max(def.design.length, def.design.span) * 0.55;
  }

  readonly radius: number;

  get position(): Vector3 {
    return this.body.position;
  }

  get velocity(): Vector3 {
    return this.body.velocity;
  }

  get rcs(): number {
    return this.def.rcs;
  }

  launchForward(out: Vector3): Vector3 {
    return this.body.forward(out);
  }

  heat(): number {
    return 1 + this.body.afterburner * 1.6 + this.body.throttle * 0.3;
  }

  health(): number {
    let sum = 0;
    let max = 0;
    for (const p of PARTS) {
      sum += Math.max(0, this.hp[p]);
      max += this.maxHp[p];
    }
    return max > 0 ? sum / max : 0;
  }

  /** Distinct weapon kinds this aircraft carries (excluding the gun and fuel tanks). */
  weaponKinds(): HardpointKind[] {
    const kinds: HardpointKind[] = [];
    for (const s of this.stations) if (s.kind !== 'tank' && !kinds.includes(s.kind)) kinds.push(s.kind);
    return kinds;
  }

  selectedKind(): HardpointKind | null {
    const kinds = this.weaponKinds();
    if (kinds.length === 0) return null;
    return kinds[this.selectedWeapon % kinds.length] ?? null;
  }

  roundsOf(kind: HardpointKind): number {
    let n = 0;
    for (const s of this.stations) if (s.kind === kind) n += s.rounds;
    return n;
  }

  cycleWeapon(): void {
    const kinds = this.weaponKinds();
    if (kinds.length < 2) return;
    for (let i = 1; i <= kinds.length; i++) {
      const idx = (this.selectedWeapon + i) % kinds.length;
      const k = kinds[idx];
      if (k && this.roundsOf(k) > 0) {
        this.selectedWeapon = idx;
        this.lockProgress = 0;
        this.locked = false;
        return;
      }
    }
  }

  /** Takes one round of `kind` from the best station (alternating sides). Returns the local mount or null. */
  takeRound(kind: HardpointKind): Vector3 | null {
    let best: Station | null = null;
    let bestIndex = -1;
    for (let i = 0; i < this.stations.length; i++) {
      const s = this.stations[i]!;
      if (s.kind !== kind || s.rounds <= 0) continue;
      // Prefer the side opposite to the last shot so launches alternate.
      if (!best || (this.missilesFired % 2 === 0 ? s.mount.x < best.mount.x : s.mount.x > best.mount.x)) {
        best = s;
        bestIndex = i;
      }
    }
    if (!best) return null;
    if (this.rule !== 'unlimited') {
      best.rounds--;
      // Rocket pods stay on the pylon when empty; everything else leaves the rail.
      this.storesVisible[bestIndex] = best.rounds > 0 || best.kind === 'rocketPod';
      this.body.storesMass = this.storesMass();
    }
    this.missilesFired++;
    return best.mount;
  }

  private storesMass(): number {
    let m = 0;
    for (const s of this.stations) {
      const per =
        s.kind === 'srm'
          ? 90
          : s.kind === 'mrm'
            ? 160
            : s.kind === 'lraam'
              ? 230
              : s.kind === 'bomb'
                ? 500
                : s.kind === 'agm'
                  ? 300
                  : s.kind === 'rocketPod'
                    ? 12
                    : 0;
      m += per * s.rounds + (s.kind === 'rocketPod' ? 60 : 0);
    }
    return m;
  }

  /** Converts a local point to world space using the simulation (not interpolated) transform. */
  localToWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).applyQuaternion(this.body.quaternion).add(this.body.position);
  }

  // ───────────────────────────────────────── Damage

  hitSegment(a: Vector3, b: Vector3): DamagePart | null {
    if (!this.alive) return null;
    // Broad phase: segment vs bounding sphere.
    _seg.subVectors(b, a);
    const len2 = _seg.lengthSq();
    const t = len2 > 0 ? clamp(_pa.subVectors(this.body.position, a).dot(_seg) / len2, 0, 1) : 0;
    _closest.copy(a).addScaledVector(_seg, t);
    if (_closest.distanceToSquared(this.body.position) > this.radius * this.radius) return null;
    // Narrow phase: capsules in local space.
    _qInv.copy(this.body.quaternion).invert();
    _a.subVectors(a, this.body.position).applyQuaternion(_qInv);
    _b.subVectors(b, this.body.position).applyQuaternion(_qInv);
    const caps = this.model?.hitCapsules;
    if (!caps || caps.length === 0) {
      // Without a model, the bounding sphere hit counts as a fuselage hit.
      return 'fuselage';
    }
    let bestPart: DamagePart | null = null;
    let bestD = Infinity;
    for (const c of caps) {
      const d = segmentSegmentDistance(_a, _b, c.a, c.b);
      if (d <= c.radius && d < bestD) {
        bestD = d;
        bestPart =
          c.part === 'wingL' ||
          c.part === 'wingR' ||
          c.part === 'tail' ||
          c.part === 'engine' ||
          c.part === 'cockpit'
            ? c.part
            : 'fuselage';
      }
    }
    return bestPart;
  }

  applyDamage(
    amount: number,
    part: DamagePart | null,
    source: DamageSource | null,
    blastCenter?: Vector3,
  ): void {
    if (!this.alive || amount <= 0) return;
    if (this.spawnProtection > 0) return;
    if (part) {
      this.hp[part] -= amount;
    } else {
      // Blast: spread over parts, weighted toward the parts nearest the blast.
      const caps = this.model?.hitCapsules;
      if (blastCenter && caps && caps.length > 0) {
        _qInv.copy(this.body.quaternion).invert();
        _a.subVectors(blastCenter, this.body.position).applyQuaternion(_qInv);
        let wsum = 0;
        const weights: number[] = [];
        for (const c of caps) {
          const d = pointSegmentDistance(_a, c.a, c.b);
          const w = 1 / (1 + d * d * 0.02);
          weights.push(w);
          wsum += w;
        }
        caps.forEach((c, i) => {
          const p: DamagePart = c.part;
          this.hp[p] -= (amount * (weights[i] ?? 0)) / wsum;
        });
      } else {
        this.hp.fuselage -= amount * 0.6;
        this.hp.engine -= amount * 0.25;
        this.hp.tail -= amount * 0.15;
      }
    }
    if (source) {
      this.damageLog.push({ source, age: 0, amount });
      if (this.damageLog.length > 8) this.damageLog.shift();
    }
    this.lastHitTime = 0;
    this.applyDamageEffects();
  }

  /** Updates flight-model penalties and visuals from part health. */
  private applyDamageEffects(): void {
    const d = (p: DamagePart) => clamp01(1 - this.hp[p] / this.maxHp[p]);
    const engine = d('engine');
    const wingL = d('wingL');
    const wingR = d('wingR');
    const tail = d('tail');
    this.body.thrustFactor = engine >= 1 ? 0 : 1 - engine * 0.55;
    this.body.liftFactor = 1 - (wingL + wingR) * 0.22;
    this.body.rollBias = (wingR - wingL) * 0.9; // losing lift on one side rolls toward it
    this.body.controlFactor = 1 - tail * 0.5;
    this.visual.damage.engine = engine;
    this.visual.damage.wingL = wingL;
    this.visual.damage.wingR = wingR;
    this.visual.damage.tail = tail;
  }

  /** Restores full health (training checkpoints). */
  repair(): void {
    for (const p of PARTS) this.hp[p] = this.maxHp[p];
    this.damageLog.length = 0;
    this.applyDamageEffects();
  }

  /** Critical failure check: returns true if the aircraft has just been destroyed. */
  checkDestroyed(): boolean {
    if (!this.alive) return false;
    return (
      this.hp.fuselage <= 0 ||
      this.hp.cockpit <= 0 ||
      this.hp.wingL <= 0 ||
      this.hp.wingR <= 0 ||
      this.hp.tail <= -this.maxHp.tail * 0.5
    );
  }

  /** Marks the aircraft dead and turns it into a tumbling wreck. */
  kill(time: number, rngValues: [number, number, number]): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathTime = time;
    this.deaths++;
    this.gunTrigger = false;
    this.target = null;
    this.locked = false;
    this.lockProgress = 0;
    this.tumble.set((rngValues[0] - 0.5) * 3, (rngValues[1] - 0.5) * 2, (rngValues[2] - 0.5) * 6);
    for (const p of PARTS) this.hp[p] = Math.min(this.hp[p], 0);
    this.applyDamageEffects();
    this.visual.damage.engine = 1;
    this.visual.navLights = false;
    this.gunVoice?.setFiring(false, this.body.position, this.body.velocity);
  }

  // ───────────────────────────────────────── Simulation

  /** Saves the pre-step transform for render interpolation. Call before step(). */
  beginStep(): void {
    this.prevPosition.copy(this.body.position);
    this.prevQuaternion.copy(this.body.quaternion);
  }

  /** Advances one fixed step. Returns the flight event (crash etc). */
  step(dt: number, env: { heightAt(x: number, z: number): number; waterLevel: number }): FlightEvent {
    if (this.spawnProtection > 0) this.spawnProtection = Math.max(0, this.spawnProtection - dt);
    for (const rec of this.damageLog) rec.age += dt;
    this.lastHitTime += dt;
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - dt);
    if (this.decoyCooldown > 0) this.decoyCooldown -= dt;

    if (!this.alive) {
      if (this.finished) return 'none';
      // Wreck: ballistic fall with drag and tumble.
      const b = this.body;
      b.velocity.y -= 9.81 * dt;
      b.velocity.multiplyScalar(1 - 0.12 * dt);
      b.position.addScaledVector(b.velocity, dt);
      _v.copy(this.tumble).multiplyScalar(dt);
      const angle = _v.length();
      if (angle > 0) {
        _a.copy(_v).normalize();
        b.quaternion.multiply(_dq.setFromAxisAngle(_a, angle)).normalize();
      }
      const ground = env.heightAt(b.position.x, b.position.z);
      if (b.position.y <= Math.max(ground, env.waterLevel) + 1) {
        this.finished = true;
        return env.waterLevel >= ground ? 'crash-water' : 'crash-ground';
      }
      return 'none';
    }
    const engineOnFire = this.hp.engine <= 0;
    if (engineOnFire) {
      this.hp.fuselage -= 1.5 * dt; // a fire slowly eats the airframe
      this.hp.engine = Math.min(this.hp.engine, 0);
    }
    return this.body.step(dt, this.controls, {
      heightAt: env.heightAt,
      waterLevel: env.waterLevel,
      collisionPoints: this.collisionPoints,
      gearContactY: this.gearContactY,
    });
  }

  // ───────────────────────────────────────── Presentation (per frame)

  interpolate(alpha: number): void {
    this.renderPosition.lerpVectors(this.prevPosition, this.body.position, alpha);
    this.renderQuaternion.slerpQuaternions(this.prevQuaternion, this.body.quaternion, alpha);
  }

  /** Pushes state into the model, trails and sounds. Called once per rendered frame. */
  present(
    dt: number,
    time: number,
    cameraPos: Vector3,
    fx: {
      trail(kind: 'contrail' | 'vortex' | 'damage-smoke' | 'fire'): TrailHandle | null;
      glow(p: Vector3, c: Color, size: number, intensity: number): void;
      dot(p: Vector3, c: Color): void;
    } | null,
    dotColor: Color,
  ): void {
    const b = this.body;
    const v = this.visual;
    const k = dampFactor(10, dt);
    v.aileron = b.surfaces.aileron;
    v.elevator = b.surfaces.elevator;
    v.rudder = b.surfaces.rudder;
    v.flaps = b.flaps;
    v.airbrake = b.airbrake;
    v.gear = b.gear;
    v.throttle += (b.throttle - v.throttle) * k;
    v.afterburner += (b.afterburner - v.afterburner) * k;

    const dist = this.renderPosition.distanceTo(cameraPos);
    const lod: 0 | 1 | 2 = this.isPlayer || dist < 1400 ? 0 : dist < 6500 ? 1 : 2;
    const model = this.model;
    if (model) {
      if (lod !== this.lod) model.setLod(lod);
      model.root.position.copy(this.renderPosition);
      model.root.quaternion.copy(this.renderQuaternion);
      model.root.visible = !(this.finished && time - this.deathTime > 0.2);
      if (lod < 2) model.update(v, dt, time);
    }
    this.lod = lod;
    if (!fx) return;
    if (lod === 2 && !this.finished) fx.dot(this.renderPosition, dotColor);

    // Afterburner glow sprite (the model draws the flame; this adds the bloom halo).
    if (this.alive && v.afterburner > 0.05 && model) {
      for (const n of model.nozzles) {
        _v.copy(n).applyQuaternion(this.renderQuaternion).add(this.renderPosition);
        fx.glow(_v, _afterburnerColor, 3 + this.def.design.span * 0.12, 2.5 * v.afterburner);
      }
    }

    // Trails: contrails at altitude, wingtip vortices at high G / AoA.
    const tips = model?.wingtips;
    const alt = this.renderPosition.y;
    const contrailIntensity = this.alive ? clamp01((alt - 7500) / 1200) : 0;
    const vortexIntensity = this.alive
      ? clamp01((Math.abs(b.g) - 4.5) / 3) * clamp01((b.airspeed - 90) / 60)
      : 0;
    for (let side = 0; side < 2; side++) {
      const tip = tips?.[side];
      if (!tip) continue;
      _v.copy(tip).applyQuaternion(this.renderQuaternion).add(this.renderPosition);
      if (contrailIntensity > 0 && !this.trails.contrail[side])
        this.trails.contrail[side] = fx.trail('contrail');
      const ct = this.trails.contrail[side];
      if (ct) {
        ct.push(_v, contrailIntensity);
        if (contrailIntensity <= 0) {
          ct.release();
          this.trails.contrail[side] = null;
        }
      }
      if (vortexIntensity > 0 && !this.trails.vortex[side]) this.trails.vortex[side] = fx.trail('vortex');
      const vt = this.trails.vortex[side];
      if (vt) {
        vt.push(_v, vortexIntensity);
        if (vortexIntensity <= 0) {
          vt.release();
          this.trails.vortex[side] = null;
        }
      }
    }
    // Damage smoke and fire from the engine area.
    const smokeAmount = this.finished
      ? 0
      : Math.max(v.damage.engine > 0.35 ? v.damage.engine : 0, this.alive ? 0 : 1);
    const nozzle = model?.nozzles[0];
    if (smokeAmount > 0) {
      if (!this.trails.smoke) this.trails.smoke = fx.trail('damage-smoke');
      if (nozzle) _v.copy(nozzle).applyQuaternion(this.renderQuaternion).add(this.renderPosition);
      else _v.copy(this.renderPosition);
      this.trails.smoke?.push(_v, smokeAmount);
      const burning = !this.alive || this.hp.engine <= 0;
      if (burning && !this.trails.fire) this.trails.fire = fx.trail('fire');
      this.trails.fire?.push(_v, burning ? 1 : 0);
    } else {
      this.releaseSmoke();
    }
  }

  private releaseSmoke(): void {
    this.trails.smoke?.release();
    this.trails.smoke = null;
    this.trails.fire?.release();
    this.trails.fire = null;
  }

  /** Releases trails and voices (on removal). The model is disposed by the owner. */
  releasePresentation(): void {
    for (const t of this.trails.contrail) t?.release();
    for (const t of this.trails.vortex) t?.release();
    this.trails.contrail = [null, null];
    this.trails.vortex = [null, null];
    this.releaseSmoke();
    this.engineVoice?.dispose();
    this.engineVoice = null;
    this.gunVoice?.dispose();
    this.gunVoice = null;
  }
}

/** Mount estimate used when no model is present (tests, headless). */
function estimateMount(def: AircraftDef, index: number): Vector3 {
  const n = def.hardpoints.length;
  const side = index % 2 === 0 ? -1 : 1;
  const row = Math.floor(index / 2);
  const x = side * (def.design.span / 2) * (1 - row / Math.max(1, Math.ceil(n / 2)));
  return new Vector3(x * 0.9, -0.6, 0.5);
}

/** Distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentSegmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const d1x = q1.x - p1.x,
    d1y = q1.y - p1.y,
    d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x,
    d2y = q2.y - p2.y,
    d2z = q2.z - p2.z;
  const rx = p1.x - p2.x,
    ry = p1.y - p2.y,
    rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const cx = p1.x + d1x * s - (p2.x + d2x * t);
  const cy = p1.y + d1y * s - (p2.y + d2y * t);
  const cz = p1.z + d1z * s - (p2.z + d2z * t);
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

export function pointSegmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2, 0, 1) : 0;
  const dx = a.x + abx * t - p.x,
    dy = a.y + aby * t - p.y,
    dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

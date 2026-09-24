import { Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import type { Combat } from '../combat/combat';
import type { Missile } from '../combat/missiles';
import { angleOffNose, missileDefFor } from '../combat/targeting';
import { G0, clamp, clamp01, lerp, safeNormalize } from '../core/math';
import { Rng } from '../core/rng';
import { Instructor, type InstructorGains } from '../flight/instructor';

/**
 * AI pilots (spec §5.6): perception → utility decision (10 Hz, staggered) → maneuver → the same instructor
 * "virtual stick" and flight model the player uses. Terrain avoidance and area limits override everything.
 */
export type AiSkill = 'rookie' | 'veteran' | 'ace';

export interface SkillProfile {
  reaction: number; // s before reacting to a new threat
  aimError: number; // rad (1 sigma, smoothly varying)
  stick: number; // max stick deflection (limits G)
  flareRange: [number, number]; // missile distance window for countermeasures
  visualRange: number;
  useRadar: boolean;
  energy: number; // 0..1 use of energy tactics
  /** Fraction of the missile's max range the AI will launch at. */
  launchRange: number;
  missileInterval: number; // s between own missile launches
  maxAttackers: number; // fairness: max AI of this skill attacking the player at once
}

export const SKILLS: Record<AiSkill, SkillProfile> = {
  rookie: {
    reaction: 0.9,
    aimError: 0.018,
    stick: 0.72,
    flareRange: [250, 3200],
    visualRange: 3000,
    useRadar: false,
    energy: 0,
    launchRange: 1.1,
    missileInterval: 9,
    maxAttackers: 1,
  },
  veteran: {
    reaction: 0.45,
    aimError: 0.008,
    stick: 0.88,
    flareRange: [700, 2200],
    visualRange: 6000,
    useRadar: true,
    energy: 0.5,
    launchRange: 0.75,
    missileInterval: 11,
    maxAttackers: 2,
  },
  ace: {
    reaction: 0.2,
    aimError: 0.003,
    stick: 1,
    flareRange: [1000, 1700],
    visualRange: 10000,
    useRadar: true,
    energy: 1,
    launchRange: 0.5,
    missileInterval: 12,
    maxAttackers: 3,
  },
};

export type AiState =
  | 'patrol'
  | 'engage'
  | 'defend-missile'
  | 'defend-guns'
  | 'extend'
  | 'avoid-terrain'
  | 'return'
  | 'formation'
  | 'drone';

export interface AiWorld {
  heightAt(x: number, z: number): number;
  waterLevel: number;
  boundary: number;
  lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
}

export interface AiContext {
  readonly aircraft: readonly Aircraft[];
  readonly world: AiWorld;
  readonly combat: Combat;
  readonly time: number;
  /** Number of AI currently attacking this aircraft (for fairness limits on the player). */
  attackersOf(target: Aircraft): number;
}

const _toT = new Vector3();
const _lead = new Vector3();
const _dir = new Vector3();
const _tmp = new Vector3();
const _vel = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _avoid = new Vector3();

export class AiPilot {
  readonly ac: Aircraft;
  readonly skill: AiSkill;
  readonly profile: SkillProfile;
  state: AiState = 'patrol';
  target: Aircraft | null = null;
  readonly desired = new Vector3(0, 0, -1);
  throttle = 0.8;
  afterburner = false;
  private readonly instructor = new Instructor();
  private readonly gains: InstructorGains;
  private readonly rng: Rng;
  private thinkTimer: number;
  private readonly aggression: number;
  private readonly preferVertical: boolean;
  private threat: Missile | null = null;
  private threatSeen = 0;
  private burstTimer = 0;
  private burstPause = 0;
  private lastMissile = -100;
  private stalemate = 0;
  private extendTimer = 0;
  private jinkTimer = 0;
  private jinkSign = 1;
  private readonly aimNoise = new Vector3();
  private readonly aimNoiseTarget = new Vector3();
  private noiseTimer = 0;
  private flareCooldown = 0;
  readonly patrolPoint = new Vector3();
  /** Formation: leader and offset in the leader's frame (x right, y up, z back). */
  leader: Aircraft | null = null;
  readonly slot = new Vector3(-60, 0, 40);
  /** Drone behavior: fly a fixed course (training). */
  droneSpeed = 0;
  /** Wingman order from the player. */
  order: 'engage' | 'attack-target' | 'cover' | 'form' = 'engage';
  orderTarget: Aircraft | null = null;

  constructor(ac: Aircraft, skill: AiSkill, seed: number) {
    this.ac = ac;
    this.skill = skill;
    this.profile = SKILLS[skill];
    this.rng = new Rng(seed);
    this.thinkTimer = this.rng.range(0, 0.1);
    this.aggression = this.rng.range(0.3, 1);
    this.preferVertical = this.rng.chance(0.5);
    this.gains = {
      roll: 2.2,
      rollDamp: 0.32,
      pitch: 4.5,
      pitchDamp: 1.2,
      yaw: 2.4,
      yawDamp: 1.2,
      levelAngle: 0.18,
      maxStick: this.profile.stick,
    };
    this.patrolPoint.copy(ac.body.position);
  }

  /** Called every simulation step. */
  update(dt: number, ctx: AiContext): void {
    const ac = this.ac;
    if (!ac.alive) {
      ac.gunTrigger = false;
      return;
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.1;
      this.think(ctx);
    }
    if (this.flareCooldown > 0) this.flareCooldown -= dt;
    this.updateAimNoise(dt);
    this.maneuver(dt, ctx);
    this.avoidCollisions(ctx);
    this.terrainAndBounds(ctx);
    this.fly();
    this.weapons(dt, ctx);
  }

  // ───────────────────────────────────────── Decision (10 Hz)

  private think(ctx: AiContext): void {
    const ac = this.ac;
    if (this.state === 'drone') return;
    // Incoming missile? (perceived after the reaction delay)
    const incoming = this.findIncomingMissile(ctx);
    if (incoming) {
      if (this.threat !== incoming) {
        this.threat = incoming;
        this.threatSeen = 0;
      }
      this.threatSeen += 0.1;
      if (this.threatSeen >= this.profile.reaction) {
        this.state = 'defend-missile';
        return;
      }
    } else {
      this.threat = null;
    }
    if (this.state === 'defend-missile' && !incoming) this.state = 'engage';
    if (this.state === 'extend') {
      this.extendTimer -= 0.1;
      if (this.extendTimer > 0) return;
      this.state = 'engage';
      this.stalemate = 0;
    }
    if (this.leader && this.leader.alive && this.order === 'form') {
      this.state = 'formation';
      return;
    }
    // Guns defense: someone close behind us pointing at us.
    for (const other of ctx.aircraft) {
      if (!other.alive || other.team === ac.team) continue;
      const d = other.body.position.distanceTo(ac.body.position);
      if (d > 1300) continue;
      if (angleOffNose(other, ac.body.position) < 0.2 && angleOffNose(ac, other.body.position) > 2.2) {
        this.state = 'defend-guns';
        return;
      }
    }
    if (this.state === 'defend-guns') this.state = 'engage';
    this.chooseTarget(ctx);
    if (this.target) {
      this.state = 'engage';
      // Stalemate detector: long fights without a shot switch tactics (ZD-F03).
      const offNose = angleOffNose(ac, this.target.body.position);
      const d = this.target.body.position.distanceTo(ac.body.position);
      if (offNose < 0.35 && d < 2500) this.stalemate = Math.max(0, this.stalemate - 0.3);
      else this.stalemate += 0.1;
      if (this.stalemate > 28 + this.aggression * 12) {
        this.state = 'extend';
        this.extendTimer = 7 + this.rng.range(0, 5);
        this.stalemate = 0;
      }
    } else {
      this.state = this.leader?.alive ? 'formation' : 'patrol';
    }
  }

  private chooseTarget(ctx: AiContext): void {
    const ac = this.ac;
    if (this.order === 'attack-target' && this.orderTarget?.alive) {
      this.target = this.orderTarget;
      return;
    }
    if (this.order === 'cover' && this.leader?.alive) {
      // Attack whoever is closest to the leader.
      let best: Aircraft | null = null;
      let bestD = 5000;
      for (const o of ctx.aircraft) {
        if (!o.alive || o.team === ac.team) continue;
        const d = o.body.position.distanceTo(this.leader.body.position);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      this.target = best;
      return;
    }
    // Keep the current target unless it died or a much better one appears.
    const current = this.target?.alive ? this.target : null;
    let best: Aircraft | null = null;
    let bestScore = Infinity;
    const detection = this.profile.useRadar
      ? Math.max(this.profile.visualRange, ac.def.radarRange)
      : this.profile.visualRange * 2.5;
    for (const o of ctx.aircraft) {
      if (!o.alive || o.team === ac.team || o.kind === 'drone') continue;
      const d = o.body.position.distanceTo(ac.body.position);
      if (d > detection * 1.5) continue;
      if (o.isPlayer && o !== current && ctx.attackersOf(o) >= this.profile.maxAttackers) continue;
      const score = d / 1000 + angleOffNose(ac, o.body.position) * 2 + (o === current ? -3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    // With nothing detected, head toward the nearest enemy anyway (the fight must happen).
    if (!best) {
      let bestD = Infinity;
      for (const o of ctx.aircraft) {
        if (!o.alive || o.team === ac.team || o.kind === 'drone') continue;
        if (o.isPlayer && ctx.attackersOf(o) >= this.profile.maxAttackers && o !== current) continue;
        const d = o.body.position.distanceTo(ac.body.position);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
    }
    this.target = best;
  }

  private findIncomingMissile(ctx: AiContext): Missile | null {
    let best: Missile | null = null;
    let bestD = 6000;
    for (const m of ctx.combat.missiles.items) {
      if (!m.active || m.isGuidedAt !== this.ac) continue;
      const d = m.position.distanceTo(this.ac.body.position);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  // ───────────────────────────────────────── Maneuvering (every step)

  private maneuver(dt: number, ctx: AiContext): void {
    const ac = this.ac;
    const b = ac.body;
    b.forward(_fwd);
    this.afterburner = false;
    this.throttle = 0.85;
    switch (this.state) {
      case 'drone': {
        this.desired.copy(_fwd);
        this.desired.y = clamp((this.patrolPoint.y - b.position.y) / 1500, -0.15, 0.15);
        safeNormalize(this.desired, _fwd);
        this.throttle = clamp(0.55 + (this.droneSpeed - b.airspeed) / 60, 0.2, 1);
        return;
      }
      case 'patrol': {
        _dir.subVectors(this.patrolPoint, b.position);
        _dir.y = clamp(_dir.y / 2000, -0.2, 0.2) * _dir.length();
        if (_dir.lengthSq() < 800 * 800) {
          // Orbit the patrol point.
          _dir.crossVectors(_tmp.subVectors(b.position, this.patrolPoint), _up.set(0, 1, 0));
        }
        this.desired.copy(safeNormalize(_dir, _fwd));
        this.throttle = 0.72;
        return;
      }
      case 'formation': {
        const lead = this.leader;
        if (!lead?.alive) {
          this.state = 'patrol';
          return;
        }
        _tmp.copy(this.slot).applyQuaternion(lead.body.quaternion).add(lead.body.position);
        _tmp.addScaledVector(lead.body.velocity, 1.5);
        _dir.subVectors(_tmp, b.position);
        const along = _dir.dot(_fwd);
        this.desired.copy(safeNormalize(_dir, _fwd));
        this.throttle = clamp(lead.body.throttle + along / 400, 0.2, 1);
        this.afterburner = along > 600;
        return;
      }
      case 'extend': {
        // Unload and run away from the target, then come back fresh.
        if (this.target) _dir.subVectors(b.position, this.target.body.position);
        else _dir.copy(_fwd);
        _dir.y = 0;
        safeNormalize(_dir, _fwd);
        _dir.y = -0.08;
        this.desired.copy(_dir.normalize());
        this.throttle = 1;
        this.afterburner = true;
        return;
      }
      case 'defend-missile': {
        const m = this.threat;
        if (!m?.active) {
          this.state = 'engage';
          return;
        }
        _toT.subVectors(m.position, b.position);
        const d = _toT.length();
        _toT.multiplyScalar(1 / Math.max(d, 1));
        // Beam the missile (fly perpendicular to its line of sight), breaking hard when it gets close.
        _right.crossVectors(_toT, _up.set(0, 1, 0));
        safeNormalize(_right, _fwd);
        if (_right.dot(_fwd) < 0) _right.multiplyScalar(-1);
        const close = d < 1800;
        this.desired.copy(_right);
        this.desired.y = close ? -0.15 : -0.05;
        if (close) this.desired.addScaledVector(_toT, this.skill === 'rookie' ? -0.4 : 0.25);
        safeNormalize(this.desired, _fwd);
        this.throttle = 1;
        this.afterburner = !(m.guided?.seeker === 'ir' && d < 3000); // cut the burner against heat seekers
        const [lo, hi] = this.profile.flareRange;
        if (d > lo && d < hi && this.flareCooldown <= 0) {
          const kind = m.guided?.seeker === 'radar' ? 'chaff' : 'flare';
          if (ctx.combat.dropCountermeasure(ac, kind)) this.flareCooldown = this.skill === 'ace' ? 0.5 : 0.8;
        }
        return;
      }
      case 'defend-guns': {
        this.jinkTimer -= dt;
        if (this.jinkTimer <= 0) {
          this.jinkTimer = this.rng.range(1.2, 2.4);
          this.jinkSign = -this.jinkSign;
        }
        b.right(_right);
        b.up(_up);
        this.desired
          .copy(_fwd)
          .addScaledVector(_right, this.jinkSign * 1.4)
          .addScaledVector(_up, this.rng.range(-0.3, 0.8));
        safeNormalize(this.desired, _fwd);
        this.throttle = 1;
        this.afterburner = b.airspeed < ac.def.cornerSpeed * 1.2;
        return;
      }
      case 'engage':
      default: {
        const t = this.target;
        if (!t?.alive) {
          this.state = 'patrol';
          return;
        }
        this.engage(t);
      }
    }
  }

  private engage(t: Aircraft): void {
    const ac = this.ac;
    const b = ac.body;
    _toT.subVectors(t.body.position, b.position);
    const d = _toT.length();
    _vel.subVectors(t.body.velocity, b.velocity);
    const closure = -_toT.dot(_vel) / Math.max(d, 1);
    if (d < 1800) {
      // Lead pursuit with the gun solution (+ smooth aim error).
      const tof = d / (ac.gun.muzzleVelocity + Math.max(0, closure) * 0.5);
      _lead.copy(t.body.position).addScaledVector(_vel, tof);
      _lead.y += 0.5 * G0 * tof * tof;
      _lead.addScaledVector(this.aimNoise, d);
      // Overshoot protection: fast closure at short range → lag pursuit / high yo-yo.
      if (closure > 120 && d < 700 && angleOffNose(ac, t.body.position) > 0.5) {
        _lead.copy(t.body.position).addScaledVector(t.body.velocity, -1.2);
        _lead.y += 250 * this.profile.energy;
      }
      _dir.subVectors(_lead, b.position);
    } else {
      // Intercept: aim where the target will be.
      const tInt = clamp(d / Math.max(closure + 150, 200), 0, 12);
      _dir
        .copy(t.body.position)
        .addScaledVector(t.body.velocity, tInt * 0.6)
        .sub(b.position);
      // Energy fighters climb for position when far and slow.
      if (this.preferVertical && this.profile.energy > 0.4 && b.airspeed < ac.def.cornerSpeed * 1.4)
        _dir.y += d * 0.12;
    }
    safeNormalize(_dir, _fwd);
    this.desired.copy(_dir);
    // Energy management: unload when slow.
    const slow = b.airspeed < ac.def.cornerSpeed * 0.75;
    if (slow && this.profile.energy > 0) {
      this.desired.y -= 0.12 * this.profile.energy;
      safeNormalize(this.desired, _fwd);
    }
    this.throttle = 1;
    this.afterburner = slow || d > 5000 || (closure < -20 && d > 1500);
  }

  private updateAimNoise(dt: number): void {
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = this.rng.range(0.6, 1.4);
      const e = this.profile.aimError;
      this.aimNoiseTarget.set(this.rng.gauss() * e, this.rng.gauss() * e, this.rng.gauss() * e);
    }
    this.aimNoise.lerp(this.aimNoiseTarget, clamp01(dt * 2));
  }

  /** Deconfliction bubble so AI never collide in furballs (ZD-F02). */
  private avoidCollisions(ctx: AiContext): void {
    const b = this.ac.body;
    _avoid.set(0, 0, 0);
    for (const o of ctx.aircraft) {
      if (o === this.ac || !o.alive) continue;
      _tmp.subVectors(o.body.position, b.position);
      const d = _tmp.length();
      if (d > 400) continue;
      _vel.subVectors(o.body.velocity, b.velocity);
      const tClosest = clamp(-_tmp.dot(_vel) / Math.max(_vel.lengthSq(), 1), 0, 3);
      const miss = _dir.copy(_tmp).addScaledVector(_vel, tClosest).length();
      const bubble = o.team === this.ac.team ? 70 : 45;
      if (miss < bubble) {
        // Steer away from the predicted closest point.
        _avoid.addScaledVector(_dir.normalize(), -(bubble - miss) / bubble);
        if (Math.abs(_avoid.y) < 0.2) _avoid.y += this.ac.uid % 2 === 0 ? 0.3 : -0.3;
      }
    }
    if (_avoid.lengthSq() > 0) {
      this.desired.addScaledVector(_avoid, 1.5);
      safeNormalize(this.desired, b.forward(_fwd));
    }
  }

  /** Terrain look-ahead and combat-area limits. Returns true when overriding (ZD-F01, ZD-F06). */
  private terrainAndBounds(ctx: AiContext): boolean {
    const b = this.ac.body;
    const w = ctx.world;
    const speed = Math.max(b.airspeed, 60);
    const margin = 180 + speed * 0.6;
    let danger = 0;
    for (let i = 1; i <= 5; i++) {
      const t = i * 0.9;
      _tmp.copy(b.position).addScaledVector(b.velocity, t);
      const ground = Math.max(w.heightAt(_tmp.x, _tmp.z), w.waterLevel);
      const clearance = _tmp.y - ground;
      if (clearance < margin) danger = Math.max(danger, 1 - clearance / margin);
    }
    const agl = b.position.y - Math.max(w.heightAt(b.position.x, b.position.z), w.waterLevel);
    if (agl < 350) danger = Math.max(danger, 1 - agl / 350);
    let override = false;
    if (danger > 0) {
      // Pull up: blend the desired direction toward a climbing heading.
      _dir.copy(b.velocity);
      _dir.y = 0;
      safeNormalize(_dir, _fwd.set(0, 0, -1));
      _dir.y = lerp(0.35, 1.2, clamp01(danger));
      _dir.normalize();
      this.desired.lerp(_dir, clamp01(danger * 1.6)).normalize();
      this.throttle = 1;
      this.afterburner = danger > 0.6 || b.airspeed < 150;
      override = danger > 0.5;
    }
    const r = Math.max(Math.abs(b.position.x), Math.abs(b.position.z));
    if (r > w.boundary * 0.9) {
      _dir.set(-b.position.x, 0, -b.position.z).normalize();
      _dir.y = this.desired.y;
      this.desired.lerp(_dir, clamp01((r - w.boundary * 0.9) / (w.boundary * 0.08))).normalize();
    }
    // Never dive steeply at low altitude.
    if (agl < 900 && this.desired.y < -0.2) {
      this.desired.y = lerp(-0.2, this.desired.y, clamp01((agl - 400) / 500));
      this.desired.normalize();
    }
    return override;
  }

  private fly(): void {
    const c = this.ac.controls;
    this.instructor.update(this.ac.body, this.desired, this.gains, c);
    c.throttle = this.throttle;
    c.afterburner = this.afterburner;
    c.gearDown = false;
    c.flaps = false;
    c.brake = false;
  }

  // ───────────────────────────────────────── Weapons

  private weapons(dt: number, ctx: AiContext): void {
    const ac = this.ac;
    ac.gunTrigger = false;
    if (this.state === 'drone' || this.state === 'formation' || this.state === 'patrol') return;
    const t = this.target;
    if (!t?.alive) return;
    const d = t.body.position.distanceTo(ac.body.position);
    // Pick a weapon for the range.
    const kinds = ac.weaponKinds();
    let want = -1;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      const def = missileDefFor(k);
      if (!def || def.surface || ac.roundsOf(k) <= 0) continue;
      if (d >= def.minRange && d <= def.maxRange * this.profile.launchRange) {
        if (want < 0 || def.maxRange < (missileDefFor(kinds[want]!)?.maxRange ?? Infinity)) want = i;
      }
    }
    if (want >= 0 && ac.selectedWeapon !== want) {
      ac.selectedWeapon = want;
      ac.lockProgress = 0;
    }
    ac.target = t;
    // Missiles: only when locked, in envelope, not recently fired, and nobody else is already shooting at it.
    const def = missileDefFor(ac.selectedKind());
    if (
      def &&
      ac.locked &&
      ctx.time - this.lastMissile > this.profile.missileInterval &&
      d <= def.maxRange * this.profile.launchRange &&
      d >= def.minRange &&
      ctx.combat.missiles.countThreats(t) === 0 &&
      this.state === 'engage'
    ) {
      if (ctx.combat.fireSelected(ac)) this.lastMissile = ctx.time;
    }
    // Guns: short bursts when the lead is on.
    if (this.burstPause > 0) {
      this.burstPause -= dt;
      return;
    }
    if (d < ac.gun.range && this.state === 'engage') {
      const tof = d / ac.gun.muzzleVelocity;
      _lead.copy(t.body.position).addScaledVector(_vel.subVectors(t.body.velocity, ac.body.velocity), tof);
      _lead.y += 0.5 * G0 * tof * tof;
      const off = angleOffNose(ac, _lead);
      const tolerance = 0.012 + this.profile.aimError * 1.5 + Math.min(0.02, 8 / Math.max(d, 1));
      if (off < tolerance) {
        ac.gunTrigger = true;
        this.burstTimer += dt;
        if (this.burstTimer > this.rng.range(0.6, 1.4)) {
          this.burstTimer = 0;
          this.burstPause = this.rng.range(0.4, 1.2);
        }
      }
    }
  }
}

import { Vector3, type Object3D } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { GroundTargetKind, Team } from '../core/types';
import type { Combat } from './combat';
import type { DamagePart, DamageSource, Shooter, Targetable } from './targetable';

/**
 * Destructible surface units (spec §5.9, §5.1 ground attack): SAM sites, flak (AAA), radars, hangars,
 * fuel tanks, command posts, bunkers and ships. SAMs and flak engage enemy aircraft with the same missile
 * and bullet systems aircraft use, obeying line of sight (ZD-F11).
 */
export interface GroundTargetStats {
  hp: number;
  radius: number;
  label: string;
  /** Surface-to-air missile engagement range (m); 0 = none. */
  samRange: number;
  /** Flak/CIWS gun range (m); 0 = none. */
  gunRange: number;
  rcs: number;
}

export const GROUND_STATS: Record<GroundTargetKind, GroundTargetStats> = {
  sam: { hp: 120, radius: 9, label: 'SAM', samRange: 11000, gunRange: 0, rcs: 1 },
  aaa: { hp: 90, radius: 6, label: 'AAA', samRange: 0, gunRange: 3200, rcs: 0.8 },
  radar: { hp: 100, radius: 10, label: 'RADAR', samRange: 0, gunRange: 0, rcs: 2 },
  hangar: { hp: 260, radius: 22, label: 'HANGAR', samRange: 0, gunRange: 0, rcs: 3 },
  fuel: { hp: 90, radius: 12, label: 'FUEL', samRange: 0, gunRange: 0, rcs: 1.5 },
  command: { hp: 420, radius: 18, label: 'COMMAND', samRange: 0, gunRange: 0, rcs: 3 },
  bunker: { hp: 380, radius: 12, label: 'BUNKER', samRange: 0, gunRange: 0, rcs: 1 },
  ship: { hp: 950, radius: 60, label: 'FRIGATE', samRange: 13000, gunRange: 2400, rcs: 8 },
};

const _to = new Vector3();
const _dir = new Vector3();
const _lead = new Vector3();
const _seg = new Vector3();
const _pa = new Vector3();

let nextGroundUid = 50000;

export class GroundTarget implements Targetable, Shooter {
  readonly uid = nextGroundUid++;
  readonly type: GroundTargetKind;
  readonly kind: 'ground' | 'ship';
  readonly team: Team;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly radius: number;
  readonly rcs: number;
  label: string;
  readonly group: string;
  readonly isPlayer = false;
  alive = true;
  hp: number;
  readonly maxHp: number;
  shotsHit = 0;
  model: Object3D | null = null;
  readonly damageLog: { source: DamageSource; age: number; amount: number }[] = [];
  /** Aircraft currently tracked by this site's radar (for RWR). */
  tracking: Aircraft | null = null;
  trackTime = 0;
  private samCooldown = 0;
  private samRounds: number;
  private gunBurst = 0;
  private gunPause = 0;
  private readonly rng: Rng;
  /** Ship heading/speed (ships move slowly along their heading). */
  heading = 0;
  speed = 0;

  constructor(
    type: GroundTargetKind,
    team: Team,
    position: Vector3,
    heading: number,
    group: string,
    seed: number,
  ) {
    this.type = type;
    this.kind = type === 'ship' ? 'ship' : 'ground';
    this.team = team;
    this.position.copy(position);
    this.heading = heading;
    const st = GROUND_STATS[type];
    this.radius = st.radius;
    this.rcs = st.rcs;
    this.label = st.label;
    this.group = group;
    this.hp = this.maxHp = st.hp;
    this.samRounds = type === 'ship' ? 8 : 4;
    this.rng = new Rng(seed);
    this.samCooldown = this.rng.range(2, 6);
  }

  heat(): number {
    return this.type === 'fuel' || this.type === 'ship' ? 1.2 : 0.8;
  }

  health(): number {
    return clamp(this.hp / this.maxHp, 0, 1);
  }

  launchForward(out: Vector3): Vector3 {
    // Missiles leave the rails nearly vertically, then turn toward the target.
    if (this.tracking) {
      out.subVectors(this.tracking.body.position, this.position).normalize();
      out.y = Math.max(out.y, 0.6);
      return out.normalize();
    }
    return out.set(0, 1, 0);
  }

  hitSegment(a: Vector3, b: Vector3): DamagePart | null {
    if (!this.alive) return null;
    _seg.subVectors(b, a);
    const len2 = _seg.lengthSq();
    const t = len2 > 0 ? clamp(_pa.subVectors(this.position, a).dot(_seg) / len2, 0, 1) : 0;
    _pa.copy(a).addScaledVector(_seg, t);
    return _pa.distanceToSquared(this.position) <= this.radius * this.radius ? 'fuselage' : null;
  }

  applyDamage(amount: number, _part: DamagePart | null, source: DamageSource | null): void {
    if (!this.alive || amount <= 0) return;
    this.hp -= amount;
    if (source) {
      this.damageLog.push({ source, age: 0, amount });
      if (this.damageLog.length > 8) this.damageLog.shift();
    }
  }

  /** One fixed step: aging, ship motion and weapons. */
  step(
    dt: number,
    aircraft: readonly Aircraft[],
    combat: Combat,
    lineOfSightBlocked: (a: Vector3, b: Vector3) => boolean,
  ): void {
    for (const r of this.damageLog) r.age += dt;
    if (!this.alive) return;
    if (this.speed > 0) {
      this.velocity.set(Math.sin(this.heading) * this.speed, 0, -Math.cos(this.heading) * this.speed);
      this.position.addScaledVector(this.velocity, dt);
    }
    const st = GROUND_STATS[this.type];
    if (st.samRange <= 0 && st.gunRange <= 0) return;
    // Pick the nearest enemy aircraft in range with a clear line of sight (checked at a low rate).
    this.samCooldown -= dt;
    let best: Aircraft | null = null;
    let bestD = Math.max(st.samRange, st.gunRange);
    for (const ac of aircraft) {
      if (!ac.alive || ac.team === this.team || ac.kind === 'drone') continue;
      const d = ac.body.position.distanceTo(this.position);
      if (d < bestD) {
        bestD = d;
        best = ac;
      }
    }
    if (best !== this.tracking) {
      this.tracking = best;
      this.trackTime = 0;
    }
    if (!best) return;
    this.trackTime += dt;
    // Radar needs a few seconds of track; low-flying aircraft behind terrain are masked.
    if (Math.floor(this.trackTime * 5) !== Math.floor((this.trackTime - dt) * 5)) {
      _to.copy(this.position);
      _to.y += 8;
      if (lineOfSightBlocked(_to, best.body.position)) {
        this.tracking = null;
        this.trackTime = 0;
        return;
      }
    }
    if (
      st.samRange > 0 &&
      bestD < st.samRange &&
      this.trackTime > 4 &&
      this.samCooldown <= 0 &&
      this.samRounds > 0
    ) {
      const agl = best.body.position.y - this.position.y;
      if (agl > 60 && combat.missiles.countThreats(best) === 0) {
        _to.copy(this.position);
        _to.y += 6;
        const m = combat.missiles.launch(this, 'mrm', _to, best, null, combat.fx);
        if (m) {
          this.samRounds--;
          this.samCooldown = this.type === 'ship' ? 10 : 14;
          combat.audio?.play('missileLaunch', { position: this.position, volume: 1 });
          combat.events?.onMissileLaunch(this, 'mrm', m);
        }
      }
    }
    if (st.gunRange > 0 && bestD < st.gunRange && this.trackTime > 1.2) {
      this.gunPause -= dt;
      if (this.gunPause <= 0) {
        this.gunBurst += dt;
        // Lead the target; flak is inaccurate by design so it is dangerous but survivable.
        const tof = bestD / 1000;
        _lead.copy(best.body.position).addScaledVector(best.body.velocity, tof);
        _lead.y += 0.5 * 9.81 * tof * tof;
        _dir.subVectors(_lead, this.position).normalize();
        _to.copy(this.position);
        _to.y += 4;
        if (this.rng.chance(dt * 18)) combat.bullets.fire(this, _to, _dir, 1000, 0.012, 3.5, 7, true);
        if (this.gunBurst > 1.6) {
          this.gunBurst = 0;
          this.gunPause = this.rng.range(1, 2.4);
        }
      }
    }
  }
}

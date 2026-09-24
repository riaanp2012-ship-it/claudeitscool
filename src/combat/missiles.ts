import { Color, Group, Object3D, Quaternion, Vector3 } from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import { rng } from '../core/rng';
import type { HardpointKind, OrdnanceModelFactory, Team, TrailHandle } from '../core/types';
import { MISSILES, UNGUIDED, type MissileDef, type MissileKind, type UnguidedDef } from '../data/weapons';
import type { Decoy } from './decoys';
import type { Shooter, Targetable } from './targetable';

/**
 * Guided missiles, rockets and bombs (spec §5.3). Guidance is true proportional navigation with gravity
 * compensation, G limits, seeker gimbal limits, terrain line-of-sight, decoys and notching (ZD-D07..D11).
 */
export type DetonationKind = 'air' | 'ground' | 'water';

export interface MissileWorld {
  heightAt(x: number, z: number): number;
  waterLevel: number;
  lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
}

export interface MissileCallbacks {
  onDetonate(m: Missile, position: Vector3, kind: DetonationKind): void;
  /** A target lost the missile (flares, notch, gimbal); used for callouts and training feedback. */
  onDefeated?(m: Missile, reason: 'decoy' | 'notch' | 'gimbal' | 'terrain' | 'energy'): void;
}

export class Missile {
  active = false;
  kind: HardpointKind = 'srm';
  guided: MissileDef | null = null;
  unguided: UnguidedDef | null = null;
  owner: Shooter | null = null;
  team: Team = 'blue';
  target: Targetable | null = null;
  decoy: Decoy | null = null;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly guidePoint = new Vector3();
  hasGuidePoint = false;
  age = 0;
  lifetime = 10;
  motorTime = 0;
  motorAccel = 0;
  dragK = 5e-5;
  negClosing = 0;
  losTimer = 0;
  notchTimer = 0;
  visual: Object3D | null = null;
  trail: TrailHandle | null = null;
  /** Distance to target at the last step (for HUD/RWR). */
  range = Infinity;

  get isGuidedAt(): Targetable | null {
    return this.active && this.guided && !this.decoy ? this.target : null;
  }
}

const _r = new Vector3();
const _vr = new Vector3();
const _omega = new Vector3();
const _acc = new Vector3();
const _vhat = new Vector3();
const _p0 = new Vector3();
const _rel0 = new Vector3();
const _relD = new Vector3();
const _hit = new Vector3();
const _tmp = new Vector3();
const _fwd = new Vector3(0, 0, -1);
const _q = new Quaternion();
const MOTOR_GLOW = new Color(2.6, 1.7, 0.9);
const G = 9.81;

export class MissileSystem {
  readonly items: Missile[] = [];
  readonly root = new Group();
  private readonly visualPools = new Map<HardpointKind, Object3D[]>();
  private readonly factory: OrdnanceModelFactory | null;

  constructor(factory: OrdnanceModelFactory | null, capacity = 64) {
    this.factory = factory;
    this.root.name = 'missiles';
    for (let i = 0; i < capacity; i++) this.items.push(new Missile());
  }

  /** Pre-creates visuals so launches never allocate (ZD-C04). */
  prewarm(kinds: Iterable<HardpointKind>, perKind = 8): void {
    if (!this.factory) return;
    for (const kind of kinds) {
      if (kind === 'tank') continue;
      const pool = this.visualPools.get(kind) ?? [];
      while (pool.length < perKind) {
        const obj = this.factory(kind === 'rocketPod' ? 'srm' : kind);
        if (kind === 'rocketPod') obj.scale.setScalar(0.45);
        obj.visible = false;
        this.root.add(obj);
        pool.push(obj);
      }
      this.visualPools.set(kind, pool);
    }
  }

  private takeVisual(kind: HardpointKind): Object3D | null {
    const pool = this.visualPools.get(kind);
    if (!pool) return null;
    for (const obj of pool) if (!obj.visible) return obj;
    return null;
  }

  launch(
    owner: Shooter,
    kind: HardpointKind,
    origin: Vector3,
    target: Targetable | null,
    guidePoint: Vector3 | null,
    fx: { trail(kind: 'missile'): TrailHandle | null } | null,
  ): Missile | null {
    const m = this.items.find((x) => !x.active);
    if (!m) return null;
    m.active = true;
    m.kind = kind;
    m.owner = owner;
    m.team = owner.team;
    m.decoy = null;
    m.age = 0;
    m.negClosing = 0;
    m.losTimer = 0;
    m.notchTimer = 0;
    m.range = Infinity;
    m.position.copy(origin);
    owner.launchForward(_vhat);
    m.velocity.copy(owner.velocity);
    m.hasGuidePoint = guidePoint !== null;
    if (guidePoint) m.guidePoint.copy(guidePoint);
    if (kind === 'rocketPod' || kind === 'bomb') {
      const def = UNGUIDED[kind];
      m.guided = null;
      m.unguided = def;
      m.target = kind === 'bomb' ? target : null;
      m.lifetime = kind === 'bomb' ? 60 : 8;
      m.motorTime = kind === 'rocketPod' ? 0.7 : 0;
      m.motorAccel = kind === 'rocketPod' ? 650 : 0;
      m.dragK = kind === 'rocketPod' ? 9e-5 : 1.2e-5;
      if (kind === 'rocketPod') m.velocity.addScaledVector(_vhat, 60);
      else m.velocity.y -= 3; // ejector push
    } else {
      const def = MISSILES[kind as MissileKind];
      m.guided = def;
      m.unguided = null;
      m.target = target;
      m.lifetime = def.lifetime;
      m.motorTime = def.motorTime;
      m.motorAccel = def.motorAccel;
      m.dragK = def.dragK;
      m.velocity.addScaledVector(_vhat, 25); // rail/eject
      m.velocity.y -= 2;
    }
    m.visual = this.takeVisual(kind);
    if (m.visual) m.visual.visible = true;
    m.trail = kind === 'bomb' ? null : (fx?.trail('missile') ?? null);
    return m;
  }

  /** Flare/chaff release: missiles guiding on that aircraft may be seduced. */
  onDecoyReleased(decoy: Decoy): void {
    for (const m of this.items) {
      if (!m.active || !m.guided || m.decoy || m.target !== (decoy.owner as unknown as Targetable)) continue;
      const def = m.guided;
      const matches =
        (decoy.kind === 'flare' && def.seeker === 'ir') || (decoy.kind === 'chaff' && def.seeker === 'radar');
      if (!matches) continue;
      const target = m.target;
      if (!target) continue;
      const d = m.position.distanceTo(target.position);
      _tmp.subVectors(m.position, target.position).normalize();
      _vhat.copy(target.velocity).normalize();
      const aspectDot = _tmp.dot(_vhat); // +1 missile ahead of the target, -1 behind it
      let aspect: number;
      if (def.seeker === 'ir') aspect = lerp(0.55, 1.1, (aspectDot + 1) / 2);
      else aspect = lerp(1, 0.4, Math.abs(aspectDot)); // chaff works best at the beam
      const timing =
        d < 350
          ? 0.25
          : d < 800
            ? lerp(0.25, 1, (d - 350) / 450)
            : d < 2500
              ? 1
              : d < 4000
                ? lerp(1, 0.4, (d - 2500) / 1500)
                : 0.3;
      const p = Math.min(0.85, (1 - def.resist) * aspect * timing);
      if (rng.chance(p)) m.decoy = decoy;
    }
  }

  step(dt: number, targets: readonly Targetable[], world: MissileWorld, cb: MissileCallbacks): void {
    for (const m of this.items) {
      if (!m.active) continue;
      m.age += dt;
      _p0.copy(m.position);
      const speed = m.velocity.length();
      _vhat.copy(m.velocity).multiplyScalar(1 / Math.max(speed, 1));
      _acc.set(0, -G, 0);

      // Guidance
      const def = m.guided;
      let aimAt: Vector3 | null = null;
      let aimVel: Vector3 | null = null;
      if (m.decoy) {
        if (m.decoy.active) {
          aimAt = m.decoy.position;
          aimVel = m.decoy.velocity;
        } else {
          m.decoy = null;
          m.target = null; // decoy burned out: the seeker has lost everything
        }
      } else if (m.target && def) {
        if (!m.target.alive) m.target = null;
        else {
          aimAt = m.target.position;
          aimVel = m.target.velocity;
        }
      } else if (m.unguided?.guided && m.hasGuidePoint) {
        aimAt = m.target?.alive ? m.target.position : m.guidePoint;
        aimVel = m.target?.alive ? m.target.velocity : null;
      }

      if (aimAt && def && m.age > 0.15) {
        _r.subVectors(aimAt, m.position);
        const dist = _r.length();
        m.range = dist;
        // Seeker gimbal limit
        const offBore = Math.acos(clamp(_r.dot(_vhat) / Math.max(dist, 1e-3), -1, 1));
        if (offBore > def.gimbal) {
          this.lose(m, cb, 'gimbal');
        } else {
          // Terrain masking check at 5 Hz
          m.losTimer -= dt;
          if (m.losTimer <= 0) {
            m.losTimer = 0.2;
            if (!m.decoy && world.lineOfSightBlocked(m.position, aimAt)) {
              this.lose(m, cb, 'terrain');
            }
          }
          // Notching radar missiles: a beaming target low over terrain can break track.
          if (m.target && !m.decoy && def.seeker === 'radar') {
            m.notchTimer -= dt;
            if (m.notchTimer <= 0) {
              m.notchTimer = 0.25;
              const t = m.target;
              _tmp.copy(_r).multiplyScalar(1 / Math.max(dist, 1));
              const radial = Math.abs(t.velocity.dot(_tmp));
              const agl = t.position.y - world.heightAt(t.position.x, t.position.z);
              if (radial < 45 && agl < 2500 && dist < 12000 && rng.chance(0.18 * (1 - def.resist)))
                this.lose(m, cb, 'notch');
            }
          }
        }
        if (m.target || m.decoy) {
          // Proportional navigation: a = N * Vc * (Omega x r_hat)
          _vr.copy(aimVel ?? _tmp.set(0, 0, 0)).sub(m.velocity);
          const d2 = Math.max(_r.lengthSq(), 1);
          _omega.crossVectors(_r, _vr).multiplyScalar(1 / d2);
          const closing = -_r.dot(_vr) / Math.max(dist, 1e-3);
          m.negClosing = closing < 0 && m.age > def.motorTime ? m.negClosing + dt : 0;
          _tmp.copy(_r).multiplyScalar(1 / Math.max(dist, 1e-3));
          const cmd = _omega.cross(_tmp).multiplyScalar(def.navGain * Math.max(closing, 60));
          cmd.y += G; // gravity compensation
          cmd.addScaledVector(_vhat, -cmd.dot(_vhat)); // lateral only
          const maxA = def.maxG * G * clamp(speed / 350, 0.3, 1);
          const len = cmd.length();
          if (len > maxA) cmd.multiplyScalar(maxA / len);
          _acc.add(cmd);
        }
      } else if (aimAt && m.unguided?.guided) {
        // Laser-guided bomb: steer the fall line toward the point with a few G.
        _r.subVectors(aimAt, m.position);
        const t = Math.max(0.5, _r.length() / Math.max(speed, 50));
        _tmp
          .copy(_r)
          .multiplyScalar(1 / t)
          .sub(m.velocity)
          .multiplyScalar(1.5 / t);
        _tmp.addScaledVector(_vhat, -_tmp.dot(_vhat));
        const len = _tmp.length();
        if (len > 3 * G) _tmp.multiplyScalar((3 * G) / len);
        _acc.add(_tmp).add(_vr.set(0, G * 0.85, 0)); // fins provide lift
      }

      // Motor and drag along the velocity
      const rhoRatio = Math.exp(-Math.max(0, m.position.y) / 8500);
      const latA = Math.sqrt(Math.max(0, _acc.lengthSq() - _acc.dot(_vhat) ** 2));
      const thrust = m.age < m.motorTime ? m.motorAccel : 0;
      const drag = m.dragK * rhoRatio * speed * speed + (0.2 * latA * latA) / Math.max(speed, 150);
      _acc.addScaledVector(_vhat, thrust - drag);
      m.velocity.addScaledVector(_acc, dt);
      m.position.addScaledVector(m.velocity, dt);

      // Proximity / contact fuse (swept, relative motion)
      let detonated = false;
      const armed = m.age > 0.4;
      if (armed) {
        const fuse = m.guided ? m.guided.fuse : 3;
        for (const t of targets) {
          if (!t.alive || t.team === m.team) continue;
          const reach = fuse + t.radius + speed * dt + 40;
          if (t.position.distanceToSquared(m.position) > reach * reach) continue;
          // Relative segment: missile relative to target over this step.
          _rel0.copy(_p0).sub(t.position).addScaledVector(t.velocity, dt);
          _relD.copy(m.position).sub(t.position).sub(_rel0);
          const dd = _relD.lengthSq();
          const s = dd > 0 ? clamp(-_rel0.dot(_relD) / dd, 0, 1) : 0;
          const closest = _tmp.copy(_rel0).addScaledVector(_relD, s).length();
          const threshold = m.guided ? fuse + t.radius * 0.35 : t.radius * 0.6;
          if (closest <= threshold) {
            _hit.copy(_p0).lerp(m.position, s);
            m.position.copy(_hit);
            cb.onDetonate(m, _hit, 'air');
            detonated = true;
            break;
          }
        }
      }
      if (!detonated) {
        const ground = world.heightAt(m.position.x, m.position.z);
        if (m.position.y <= ground || m.position.y <= world.waterLevel) {
          const water = world.waterLevel >= ground;
          m.position.y = water ? world.waterLevel : ground;
          cb.onDetonate(m, m.position, water ? 'water' : 'ground');
          detonated = true;
        } else if (
          m.age > m.lifetime ||
          m.negClosing > 1.5 ||
          (m.guided && speed < 140 && m.age > m.motorTime)
        ) {
          if (m.guided && m.target) cb.onDefeated?.(m, 'energy');
          cb.onDetonate(m, m.position, 'air'); // self-destruct
          detonated = true;
        }
      }
      if (detonated) this.retire(m);
    }
  }

  private lose(
    m: Missile,
    cb: MissileCallbacks,
    reason: 'decoy' | 'notch' | 'gimbal' | 'terrain' | 'energy',
  ): void {
    if (m.target) cb.onDefeated?.(m, reason);
    m.target = null;
    m.decoy = null;
  }

  /** Per-frame visuals: orientation, smoke trail and motor glow. */
  present(fx: { glow(p: Vector3, c: Color, size: number, intensity: number): void } | null): void {
    for (const m of this.items) {
      if (!m.active) continue;
      const speed = m.velocity.length();
      if (m.visual && speed > 1) {
        m.visual.position.copy(m.position);
        _vhat.copy(m.velocity).multiplyScalar(1 / speed);
        m.visual.quaternion.copy(_q.setFromUnitVectors(_fwd, _vhat));
      }
      const burning = m.age < m.motorTime;
      m.trail?.push(m.position, burning ? 1 : smoothstep(m.motorTime + 0.6, m.motorTime, m.age) * 0.6);
      if (burning && fx) {
        _tmp
          .copy(m.velocity)
          .multiplyScalar(-1.8 / Math.max(speed, 1))
          .add(m.position);
        fx.glow(_tmp, MOTOR_GLOW, 2.2, 3.5);
      }
    }
  }

  private retire(m: Missile): void {
    m.active = false;
    m.target = null;
    m.decoy = null;
    m.owner = null;
    if (m.visual) m.visual.visible = false;
    m.visual = null;
    m.trail?.release();
    m.trail = null;
  }

  /** Active guided missiles homing on `target` (for RWR and missile warnings). */
  countThreats(target: Targetable): number {
    let n = 0;
    for (const m of this.items) if (m.active && m.isGuidedAt === target) n++;
    return n;
  }

  clear(): void {
    for (const m of this.items) if (m.active) this.retire(m);
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.visualPools.clear();
  }
}

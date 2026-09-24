import { Color, Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import { rng } from '../core/rng';
import type { DamagePart, Targetable } from './targetable';

/**
 * Pooled cannon rounds in typed arrays (spec §5.3). Each step every round is tested along its swept
 * segment against target spheres/capsules, so 1,000 m/s rounds never tunnel (ZD-D04).
 */
export interface BulletCallbacks {
  onHit(target: Targetable, part: DamagePart, position: Vector3, shooter: Aircraft, damage: number): void;
  onImpact(position: Vector3, kind: 'ground' | 'water'): void;
}

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _tmp = new Vector3();
const TRACER = new Color(1.6, 1.05, 0.45);
const GRAVITY = 9.81;

export class BulletSystem {
  readonly capacity: number;
  count = 0;
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly damage: Float32Array;
  private readonly tracer: Uint8Array;
  private readonly shooter: (Aircraft | null)[];
  friendlyFire = false;

  constructor(capacity = 2400) {
    this.capacity = capacity;
    this.px = new Float64Array(capacity);
    this.py = new Float64Array(capacity);
    this.pz = new Float64Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.tracer = new Uint8Array(capacity);
    this.shooter = new Array<Aircraft | null>(capacity).fill(null);
  }

  /** Fires one round from `origin` along `dir` (unit) with dispersion; inherits the shooter's velocity. */
  fire(
    shooter: Aircraft,
    origin: Vector3,
    dir: Vector3,
    speed: number,
    dispersion: number,
    life: number,
    damage: number,
    tracer: boolean,
  ): void {
    if (this.count >= this.capacity) return; // pool exhausted: drop the round rather than allocate
    const i = this.count++;
    _dir.copy(dir);
    _dir.x += rng.gauss() * dispersion;
    _dir.y += rng.gauss() * dispersion;
    _dir.z += rng.gauss() * dispersion;
    _dir.normalize();
    const v = shooter.body.velocity;
    this.px[i] = origin.x;
    this.py[i] = origin.y;
    this.pz[i] = origin.z;
    this.vx[i] = v.x + _dir.x * speed;
    this.vy[i] = v.y + _dir.y * speed;
    this.vz[i] = v.z + _dir.z * speed;
    this.life[i] = life;
    this.damage[i] = damage;
    this.tracer[i] = tracer ? 1 : 0;
    this.shooter[i] = shooter;
  }

  step(
    dt: number,
    targets: readonly Targetable[],
    world: { heightAt(x: number, z: number): number; waterLevel: number },
    cb: BulletCallbacks,
  ): void {
    let i = 0;
    while (i < this.count) {
      const x0 = this.px[i]!;
      const y0 = this.py[i]!;
      const z0 = this.pz[i]!;
      this.vy[i] = this.vy[i]! - GRAVITY * dt;
      const x1 = x0 + this.vx[i]! * dt;
      const y1 = y0 + this.vy[i]! * dt;
      const z1 = z0 + this.vz[i]! * dt;
      this.life[i] = this.life[i]! - dt;
      let dead = this.life[i]! <= 0;
      const shooter = this.shooter[i]!;
      if (!dead) {
        _a.set(x0, y0, z0);
        _b.set(x1, y1, z1);
        const segLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        for (let t = 0; t < targets.length; t++) {
          const target = targets[t]!;
          if (!target.alive || target === (shooter as unknown as Targetable)) continue;
          if (!this.friendlyFire && target.team === shooter.team) continue;
          const reach = target.radius + segLen;
          const dx = target.position.x - x0;
          const dy = target.position.y - y0;
          const dz = target.position.z - z0;
          if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
          const part = target.hitSegment(_a, _b);
          if (part) {
            // Report the hit at the point of closest approach to the target center.
            _tmp.subVectors(_b, _a);
            const len2 = _tmp.lengthSq();
            const s =
              len2 > 0 ? Math.min(1, Math.max(0, (dx * _tmp.x + dy * _tmp.y + dz * _tmp.z) / len2)) : 0;
            _tmp.multiplyScalar(s).add(_a);
            cb.onHit(target, part, _tmp, shooter, this.damage[i]!);
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        const ground = world.heightAt(x1, z1);
        if (y1 <= ground || y1 <= world.waterLevel) {
          const water = world.waterLevel >= ground;
          _tmp.set(x1, water ? world.waterLevel : ground, z1);
          cb.onImpact(_tmp, water ? 'water' : 'ground');
          dead = true;
        }
      }
      if (dead) {
        this.removeAt(i);
        continue;
      }
      this.px[i] = x1;
      this.py[i] = y1;
      this.pz[i] = z1;
      i++;
    }
  }

  /** Draws tracer rounds as short streaks. */
  present(fx: { tracer(from: Vector3, to: Vector3, color: Color, width: number): void }): void {
    for (let i = 0; i < this.count; i++) {
      if (!this.tracer[i]) continue;
      _b.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      _a.set(this.vx[i]!, this.vy[i]!, this.vz[i]!).multiplyScalar(-0.022).add(_b);
      fx.tracer(_a, _b, TRACER, 0.35);
    }
  }

  clear(): void {
    this.count = 0;
    this.shooter.fill(null);
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last]!;
      this.py[i] = this.py[last]!;
      this.pz[i] = this.pz[last]!;
      this.vx[i] = this.vx[last]!;
      this.vy[i] = this.vy[last]!;
      this.vz[i] = this.vz[last]!;
      this.life[i] = this.life[last]!;
      this.damage[i] = this.damage[last]!;
      this.tracer[i] = this.tracer[last]!;
      this.shooter[i] = this.shooter[last]!;
    }
    this.shooter[last] = null;
  }
}

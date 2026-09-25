/**
 * Short explosion lights. A fixed pool of MAX_FLASHES slots animates the shared atmosphere uniforms
 * (uFlashPos / uFlashColor, read by terrain, water and particles). Pure data here; the effects system copies
 * the result into the uniforms and into two always-present PointLights (the light count never changes, so
 * no shader ever recompiles).
 */
import { FLASH_ATTACK, FLASH_ATTACK_REDUCED, FLASH_REDUCED_SCALE, FLASH_REDUCED_WINDOW } from './tuning';

export class FlashPool {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly intensity: Float32Array;
  readonly radius: Float32Array;
  readonly duration: Float32Array;
  readonly age: Float32Array;
  readonly attack: Float32Array;
  readonly active: Uint8Array;
  /** Current envelope (0..1) per slot, valid after update(). */
  readonly env: Float32Array;
  reduce = false;
  /** Brightness multiplier (quality, reduced flashes). */
  scale = 1;
  private time = 0;
  private lastStart = -1e9;

  constructor(readonly size: number) {
    const f = () => new Float32Array(size);
    this.x = f();
    this.y = f();
    this.z = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.intensity = f();
    this.radius = f();
    this.duration = f();
    this.age = f();
    this.attack = f();
    this.env = f();
    this.active = new Uint8Array(size);
  }

  /** Remaining light energy of a slot (for choosing which slot a new flash replaces). */
  energy(i: number): number {
    if (this.active[i] === 0) return 0;
    const left = 1 - this.age[i]! / this.duration[i]!;
    return this.intensity[i]! * this.radius[i]! * (left > 0 ? left : 0);
  }

  /** Returns the slot used, or -1 if the flash was dropped (weaker than every live flash). */
  add(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    intensity: number,
    radius: number,
    duration: number,
  ): number {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return -1;
    if (!(intensity > 0) || !(radius > 0) || !(duration > 0)) return -1;
    if (!Number.isFinite(intensity) || !Number.isFinite(radius) || !Number.isFinite(duration)) return -1;
    let inten = intensity;
    let dur = duration;
    if (this.reduce) {
      inten *= FLASH_REDUCED_SCALE;
      if (this.time - this.lastStart < FLASH_REDUCED_WINDOW) inten *= FLASH_REDUCED_SCALE;
      dur *= 1.3;
    }
    let slot = -1;
    let weakest = Infinity;
    for (let i = 0; i < this.size; i++) {
      if (this.active[i] === 0) {
        slot = i;
        break;
      }
      const e = this.energy(i);
      if (e < weakest) {
        weakest = e;
        slot = i;
      }
    }
    if (slot < 0) return -1;
    if (this.active[slot] === 1 && weakest > inten * radius) return -1;
    this.x[slot] = x;
    this.y[slot] = y;
    this.z[slot] = z;
    this.r[slot] = Math.max(0, r);
    this.g[slot] = Math.max(0, g);
    this.b[slot] = Math.max(0, b);
    this.intensity[slot] = inten;
    this.radius[slot] = radius;
    this.duration[slot] = dur;
    this.age[slot] = 0;
    this.attack[slot] = Math.min(dur * 0.4, this.reduce ? FLASH_ATTACK_REDUCED : FLASH_ATTACK);
    this.active[slot] = 1;
    this.env[slot] = 0;
    this.lastStart = this.time;
    return slot;
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.size; i++) {
      if (this.active[i] === 0) {
        this.env[i] = 0;
        continue;
      }
      const a = this.age[i]! + dt;
      this.age[i] = a;
      const d = this.duration[i]!;
      if (a >= d) {
        this.active[i] = 0;
        this.env[i] = 0;
        continue;
      }
      const atk = this.attack[i]!;
      if (a < atk) {
        const t = a / atk;
        this.env[i] = t * t * (3 - 2 * t);
      } else {
        const u = 1 - (a - atk) / (d - atk);
        this.env[i] = u * u * u;
      }
    }
  }

  clear(): void {
    this.active.fill(0);
    this.env.fill(0);
  }
}

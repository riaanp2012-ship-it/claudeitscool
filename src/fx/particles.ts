/**
 * CPU particle simulation in structure-of-arrays typed arrays. Fixed capacity, free-list slots, no
 * allocations after construction. Rendering reads these arrays (see batches.ts); this file has no three.js
 * dependency so it runs in unit tests.
 *
 * A slot keeps its index for the particle's whole life, which makes sorting ties stable (ZD-B07).
 * When the live limit is reached `spawn` returns -1: live particles are never recycled early, so nothing
 * ever snaps out of existence (ZD-B34).
 */
import { CONTACT_FADE, COLLIDE_BOUNCE, COLLIDE_FADE, COLLIDE_SLIDE, STYLES } from './tuning';

const STYLE_COUNT = STYLES.length;
const styleWind = new Float32Array(STYLE_COUNT);
const styleCollide = new Uint8Array(STYLE_COUNT);
const styleGrow = new Uint8Array(STYLE_COUNT);
for (let s = 0; s < STYLE_COUNT; s++) {
  const def = STYLES[s]!;
  styleWind[s] = def.wind;
  styleCollide[s] = def.collide;
  styleGrow[s] = def.grow;
}

/** Eased 0..1 growth of a particle's size for its style at normalized age t. */
export function growth(style: number, t: number): number {
  const g = styleGrow[style]!;
  if (g === 1) return t;
  const u = 1 - t;
  return g === 2 ? 1 - u * u : 1 - u * u * u;
}

export type SurfaceFn = (x: number, z: number) => number;

export class ParticleStore {
  /** Live particles allowed (quality); never above `max`. */
  limit: number;
  live = 0;
  /** One past the highest slot that may be alive (iteration bound). */
  high = 0;
  private frame = 0;
  private readonly free: Int32Array;
  private freeTop: number;

  readonly alive: Uint8Array;
  readonly style: Uint8Array;
  readonly layer: Uint8Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Seconds since birth; negative while a delayed spawn waits. */
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly rot: Float32Array;
  readonly rotVel: Float32Array;
  readonly drag: Float32Array;
  readonly accelY: Float32Array;
  readonly cr: Float32Array;
  readonly cg: Float32Array;
  readonly cb: Float32Array;
  readonly alpha: Float32Array;
  readonly heat: Float32Array;
  readonly emissive: Float32Array;
  readonly seed: Float32Array;
  /** Cached ground height under the particle (NaN = unknown). */
  readonly ground: Float32Array;
  /** Seconds left of a forced fade-out after touching the ground (0 = none). */
  readonly fade: Float32Array;

  constructor(readonly max: number) {
    this.limit = max;
    this.free = new Int32Array(max);
    for (let i = 0; i < max; i++) this.free[i] = max - 1 - i;
    this.freeTop = max;
    this.alive = new Uint8Array(max);
    this.style = new Uint8Array(max);
    this.layer = new Uint8Array(max);
    const f = () => new Float32Array(max);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.size1 = f();
    this.rot = f();
    this.rotVel = f();
    this.drag = f();
    this.accelY = f();
    this.cr = f();
    this.cg = f();
    this.cb = f();
    this.alpha = f();
    this.heat = f();
    this.emissive = f();
    this.seed = f();
    this.ground = f();
    this.fade = f();
  }

  /**
   * Starts a particle and returns its slot, or -1 when the live limit is reached or an input is not finite.
   * Style defaults (drag, buoyancy, layer) are applied; callers override fields directly afterwards.
   */
  spawn(
    style: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
  ): number {
    if (this.live >= this.limit || this.freeTop === 0) return -1;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return -1;
    if (!(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz))) return -1;
    if (!(life > 0) || !Number.isFinite(life) || !(size0 >= 0) || !(size1 >= 0)) return -1;
    const def = STYLES[style];
    if (!def) return -1;
    const i = this.free[--this.freeTop]!;
    this.alive[i] = 1;
    this.live++;
    if (i >= this.high) this.high = i + 1;
    this.style[i] = style;
    this.layer[i] = def.layer;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.rot[i] = 0;
    this.rotVel[i] = 0;
    this.drag[i] = def.drag;
    this.accelY[i] = def.accelY;
    this.cr[i] = 1;
    this.cg[i] = 1;
    this.cb[i] = 1;
    this.alpha[i] = 1;
    this.heat[i] = 0;
    this.emissive[i] = 0;
    this.seed[i] = 0;
    this.ground[i] = NaN;
    this.fade[i] = 0;
    return i;
  }

  kill(i: number): void {
    if (this.alive[i] !== 1) return;
    this.alive[i] = 0;
    this.live--;
    this.free[this.freeTop++] = i;
    if (i === this.high - 1) {
      let h = i;
      while (h > 0 && this.alive[h - 1] === 0) h--;
      this.high = h;
    }
  }

  clear(): void {
    for (let i = 0; i < this.high; i++) this.alive[i] = 0;
    for (let i = 0; i < this.max; i++) this.free[i] = this.max - 1 - i;
    this.freeTop = this.max;
    this.live = 0;
    this.high = 0;
  }

  /** Current size (m) of particle i. */
  sizeOf(i: number): number {
    const t = this.age[i]! / this.life[i]!;
    const s0 = this.size0[i]!;
    return s0 + (this.size1[i]! - s0) * growth(this.style[i]!, t < 0 ? 0 : t > 1 ? 1 : t);
  }

  update(dt: number, surfaceAt: SurfaceFn, windX: number, windY: number, windZ: number): void {
    this.frame++;
    const frameMod = this.frame & 7;
    const { alive, style, px, py, pz, vx, vy, vz, age, life, drag, accelY, rot, rotVel, ground, fade } = this;
    for (let i = 0; i < this.high; i++) {
      if (alive[i] === 0) continue;
      const a = age[i]! + dt;
      age[i] = a;
      if (a < 0) continue;
      if (a >= life[i]!) {
        this.kill(i);
        continue;
      }
      let f = fade[i]!;
      if (f > 0) {
        f -= dt;
        if (f <= 0) {
          this.kill(i);
          continue;
        }
        fade[i] = f;
      }
      const s = style[i]!;
      const wf = styleWind[s]!;
      const k = Math.min(1, drag[i]! * dt);
      let x = vx[i]!;
      let y = vy[i]!;
      let z = vz[i]!;
      x += (windX * wf - x) * k;
      y += (windY * wf - y) * k + accelY[i]! * dt;
      z += (windZ * wf - z) * k;
      const nx = px[i]! + x * dt;
      let ny = py[i]! + y * dt;
      const nz = pz[i]! + z * dt;
      rot[i] = rot[i]! + rotVel[i]! * dt;
      const c = styleCollide[s]!;
      if (c !== 0) {
        let g = ground[i]!;
        if (Number.isNaN(g) || (i & 7) === frameMod || x * x + z * z > 900) {
          g = surfaceAt(nx, nz);
          if (!Number.isFinite(g)) g = -1e9;
          ground[i] = g;
        }
        const floor = c === COLLIDE_SLIDE ? g + this.sizeOf(i) * 0.2 : g;
        if (ny < floor) {
          ny = floor;
          if (c === COLLIDE_SLIDE) {
            if (y < 0) y = 0;
          } else if (c === COLLIDE_BOUNCE) {
            y = -y * 0.35;
            x *= 0.6;
            z *= 0.6;
          } else if (c === COLLIDE_FADE) {
            y = 0;
            x *= 0.2;
            z *= 0.2;
            if (fade[i] === 0) fade[i] = CONTACT_FADE;
          }
        }
      }
      if (!(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz))) {
        this.kill(i);
        continue;
      }
      vx[i] = x;
      vy[i] = y;
      vz[i] = z;
      px[i] = nx;
      py[i] = ny;
      pz[i] = nz;
    }
  }
}

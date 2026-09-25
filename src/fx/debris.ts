/**
 * Tumbling debris pieces: ballistic flight with drag, quaternion spin, ground bounce/settle, and smoke/fire
 * emission along the path (burning pieces leave the classic falling black smoke streaks). Fixed pool, no
 * allocations; rendering reads `write()` output into an instanced chunk mesh.
 */
import { DEBRIS, GRAVITY } from './tuning';
import type { SurfaceFn } from './particles';

export interface DebrisEmitter {
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, strength: number): void;
  fire(x: number, y: number, z: number, vx: number, vy: number, vz: number): void;
  /** Continues the piece's smoke ribbon (slot/generation assigned at spawn). */
  trail(slot: number, gen: number, x: number, y: number, z: number, intensity: number): void;
  trailEnd(slot: number, gen: number): void;
}

export class DebrisSystem {
  live = 0;
  high = 0;
  /** Emission interval multiplier (1 / quality detail). */
  intervalScale = 1;
  readonly alive: Uint8Array;
  readonly landed: Uint8Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly qx: Float32Array;
  readonly qy: Float32Array;
  readonly qz: Float32Array;
  readonly qw: Float32Array;
  readonly wx: Float32Array;
  readonly wy: Float32Array;
  readonly wz: Float32Array;
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly sz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly burn: Float32Array;
  /** Seconds since the last smoke puff, and meters travelled since the last puff / flame. */
  readonly smokeT: Float32Array;
  readonly smokeD: Float32Array;
  readonly fireD: Float32Array;
  readonly tint: Float32Array;
  /** Smoke ribbon slot (-1 = none) and its generation. */
  readonly ribbon: Int32Array;
  readonly ribbonGen: Uint32Array;
  private emitter: DebrisEmitter | null = null;

  constructor(readonly max: number) {
    const f = () => new Float32Array(max);
    this.alive = new Uint8Array(max);
    this.landed = new Uint8Array(max);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.qx = f();
    this.qy = f();
    this.qz = f();
    this.qw = f();
    this.wx = f();
    this.wy = f();
    this.wz = f();
    this.sx = f();
    this.sy = f();
    this.sz = f();
    this.age = f();
    this.life = f();
    this.burn = f();
    this.smokeT = f();
    this.smokeD = f();
    this.fireD = f();
    this.tint = f();
    this.ribbon = new Int32Array(max).fill(-1);
    this.ribbonGen = new Uint32Array(max);
  }

  /**
   * Starts a piece. `r` are six random numbers in [0,1) supplied by the caller (keeps this file RNG-free).
   * Returns the slot or -1 when the pool is full.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    burning: boolean,
    r0: number,
    r1: number,
    r2: number,
  ): number {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return -1;
    if (!(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz))) return -1;
    if (!(size > 0 && life > 0 && Number.isFinite(size) && Number.isFinite(life))) return -1;
    let i = -1;
    for (let k = 0; k < this.max; k++) {
      if (this.alive[k] === 0) {
        i = k;
        break;
      }
    }
    if (i < 0) return -1;
    this.alive[i] = 1;
    this.landed[i] = 0;
    this.live++;
    if (i >= this.high) this.high = i + 1;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    // Random orientation from three numbers (uniform quaternion).
    const s1 = Math.sqrt(1 - r0);
    const s2 = Math.sqrt(r0);
    const a1 = Math.PI * 2 * r1;
    const a2 = Math.PI * 2 * r2;
    this.qx[i] = s1 * Math.sin(a1);
    this.qy[i] = s1 * Math.cos(a1);
    this.qz[i] = s2 * Math.sin(a2);
    this.qw[i] = s2 * Math.cos(a2);
    const spin = DEBRIS.spin / Math.max(0.4, size);
    this.wx[i] = (r1 * 2 - 1) * spin;
    this.wy[i] = (r2 * 2 - 1) * spin;
    this.wz[i] = (r0 * 2 - 1) * spin;
    // Irregular shard proportions.
    this.sx[i] = size;
    this.sy[i] = size * (0.25 + 0.3 * r2);
    this.sz[i] = size * (0.55 + 0.6 * r1);
    this.age[i] = 0;
    this.life[i] = life;
    this.burn[i] = burning ? 1 : 0;
    this.smokeT[i] = 0;
    this.smokeD[i] = 0;
    this.fireD[i] = 0;
    this.tint[i] = r0;
    this.ribbon[i] = -1;
    return i;
  }

  /** Attaches a smoke ribbon to piece i. */
  attachRibbon(i: number, slot: number, gen: number): void {
    this.ribbon[i] = slot;
    this.ribbonGen[i] = gen;
  }

  clear(): void {
    this.alive.fill(0);
    this.ribbon.fill(-1);
    this.live = 0;
    this.high = 0;
  }

  private endRibbon(i: number): void {
    const slot = this.ribbon[i]!;
    if (slot >= 0) this.emitter?.trailEnd(slot, this.ribbonGen[i]!);
    this.ribbon[i] = -1;
  }

  private kill(i: number): void {
    this.endRibbon(i);
    this.alive[i] = 0;
    this.live--;
    if (i === this.high - 1) {
      let h = i;
      while (h > 0 && this.alive[h - 1] === 0) h--;
      this.high = h;
    }
  }

  update(dt: number, surfaceAt: SurfaceFn, emit: DebrisEmitter): void {
    this.emitter = emit;
    const drag = Math.max(0, 1 - DEBRIS.drag * dt);
    for (let i = 0; i < this.high; i++) {
      if (this.alive[i] === 0) continue;
      const age = this.age[i]! + dt;
      this.age[i] = age;
      if (age >= this.life[i]!) {
        this.kill(i);
        continue;
      }
      let x = this.px[i]!;
      let y = this.py[i]!;
      let z = this.pz[i]!;
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      let vz = this.vz[i]!;
      const landed = this.landed[i] === 1;
      if (!landed) {
        vy -= GRAVITY * dt;
        vx *= drag;
        vy *= drag;
        vz *= drag;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        // Spin: q += 0.5 * (w, 0) * q * dt, then renormalize.
        const wx = this.wx[i]!;
        const wy = this.wy[i]!;
        const wz = this.wz[i]!;
        let qx = this.qx[i]!;
        let qy = this.qy[i]!;
        let qz = this.qz[i]!;
        let qw = this.qw[i]!;
        const h = 0.5 * dt;
        const nx = qx + h * (wx * qw + wy * qz - wz * qy);
        const ny = qy + h * (wy * qw + wz * qx - wx * qz);
        const nz = qz + h * (wz * qw + wx * qy - wy * qx);
        const nw = qw - h * (wx * qx + wy * qy + wz * qz);
        const ql = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
        qx = nx / ql;
        qy = ny / ql;
        qz = nz / ql;
        qw = nw / ql;
        this.qx[i] = qx;
        this.qy[i] = qy;
        this.qz[i] = qz;
        this.qw[i] = qw;
        let g = surfaceAt(x, z);
        if (!Number.isFinite(g)) g = -1e9;
        const rest = g + this.sy[i]! * 0.5;
        if (y < rest) {
          y = rest;
          if (vy < -4) {
            vy = -vy * DEBRIS.bounce;
            vx *= 0.5;
            vz *= 0.5;
            this.wx[i] = wx * 0.5;
            this.wy[i] = wy * 0.5;
            this.wz[i] = wz * 0.5;
          } else {
            this.landed[i] = 1;
            vx = 0;
            vy = 0;
            vz = 0;
          }
        }
      }
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) {
        this.kill(i);
        continue;
      }
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;

      const burn = Math.max(0, this.burn[i]! - dt * 0.12);
      this.burn[i] = burn;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const inv = speed > 1e-3 ? 1 / speed : 0;
      const fadeLeft = Math.min(1, (this.life[i]! - age) / 1.5);
      const strength = (burn > 0 ? 1 : 0.55) * fadeLeft;
      const ribbon = this.ribbon[i]!;
      if (ribbon >= 0) {
        if (landed) this.endRibbon(i);
        else emit.trail(ribbon, this.ribbonGen[i]!, x, y, z, strength);
      }
      // Smoke: one puff per `smokeSpacing` meters (placed back along the path), with a time fallback.
      const spacing = DEBRIS.smokeSpacing * this.intervalScale;
      let sd = this.smokeD[i]! + speed * dt;
      let st = this.smokeT[i]! + dt;
      let emitted = 0;
      while (sd >= spacing && emitted < DEBRIS.maxPerFrame) {
        sd -= spacing;
        const back = sd * inv;
        emit.smoke(x - vx * back, y - vy * back, z - vz * back, vx, vy, vz, strength);
        emitted++;
        st = 0;
      }
      if (sd >= spacing) sd = 0;
      const interval = (landed ? DEBRIS.smoulderInterval : DEBRIS.smokeInterval) * this.intervalScale;
      if (st >= interval) {
        st = 0;
        emit.smoke(x, y, z, vx, vy, vz, strength);
      }
      this.smokeD[i] = sd;
      this.smokeT[i] = st;
      if (burn > 0.25 && !landed) {
        const fs = DEBRIS.fireSpacing * this.intervalScale;
        let fd = this.fireD[i]! + speed * dt;
        emitted = 0;
        while (fd >= fs && emitted < DEBRIS.maxPerFrame) {
          fd -= fs;
          const back = fd * inv;
          emit.fire(x - vx * back, y - vy * back, z - vz * back, vx, vy, vz);
          emitted++;
        }
        this.fireD[i] = fd >= fs ? 0 : fd;
      }
    }
  }

  /** Writes instance data (pos+burn, quaternion, scale+tint) and returns the instance count. */
  write(pos: Float32Array, quat: Float32Array, scale: Float32Array): number {
    let n = 0;
    for (let i = 0; i < this.high; i++) {
      if (this.alive[i] === 0) continue;
      const left = this.life[i]! - this.age[i]!;
      const k = left < DEBRIS.shrink ? Math.max(0, left / DEBRIS.shrink) : 1;
      const o = n * 4;
      pos[o] = this.px[i]!;
      pos[o + 1] = this.py[i]!;
      pos[o + 2] = this.pz[i]!;
      pos[o + 3] = this.burn[i]!;
      quat[o] = this.qx[i]!;
      quat[o + 1] = this.qy[i]!;
      quat[o + 2] = this.qz[i]!;
      quat[o + 3] = this.qw[i]!;
      scale[o] = this.sx[i]! * k;
      scale[o + 1] = this.sy[i]! * k;
      scale[o + 2] = this.sz[i]! * k;
      scale[o + 3] = this.tint[i]!;
      n++;
    }
    return n;
  }
}

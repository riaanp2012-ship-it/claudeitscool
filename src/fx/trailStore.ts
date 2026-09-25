/**
 * Ribbon trails in fixed slots (pure data, no three.js). Each slot holds up to `points` points in one
 * contiguous run with the live head at index 0. Committing a point shifts the run by one (copyWithin), so
 * the strip never wraps and never shows ring-buffer slivers. The head follows the emitter every push; a new
 * point is committed only after enough distance, time, bending or an intensity gap edge, so the ribbon stays
 * smooth at 120 Hz sampling while one buffer still covers the trail's whole life.
 */
import { RIBBON_DEFS, TRAIL_ORPHAN_SECONDS, WIND, type TrailKindDef } from './tuning';

/** Floats per point: position, drift velocity, age, intensity, odometer. */
export const PT = 9;
export const P_X = 0;
export const P_Y = 1;
export const P_Z = 2;
export const P_VX = 3;
export const P_VY = 4;
export const P_VZ = 5;
export const P_AGE = 6;
export const P_INT = 7;
export const P_ODO = 8;

export const FREE = 0;
export const EMITTING = 1;
export const FADING = 2;

/** Points near the end of the buffer fade out so dropping the oldest point is never visible. */
const TAIL_FADE_POINTS = 8;

export interface RibbonTarget {
  /** 3 floats per vertex: ribbon center (both vertices of a point share it). */
  center: Float32Array;
  /** 3 floats per vertex: unit side vector (expansion happens in the vertex shader). */
  side: Float32Array;
  /** 4 floats per vertex: texture u, opacity, ribbon kind, half width (m). */
  data: Float32Array;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const smooth01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class TrailStore {
  readonly state: Uint8Array;
  readonly kind: Uint8Array;
  readonly count: Uint16Array;
  readonly gen: Uint32Array;
  readonly odo: Float64Array;
  /** Distance the emitter moved since the last update, and the smoothed emitter speed. */
  readonly moved: Float32Array;
  readonly speed: Float32Array;
  readonly seed: Float32Array;
  readonly pts: Float32Array;
  active = 0;

  constructor(
    readonly slots: number,
    readonly points: number,
    readonly kinds: readonly TrailKindDef[] = RIBBON_DEFS,
  ) {
    this.state = new Uint8Array(slots);
    this.kind = new Uint8Array(slots);
    this.count = new Uint16Array(slots);
    this.gen = new Uint32Array(slots);
    this.odo = new Float64Array(slots);
    this.moved = new Float32Array(slots);
    this.speed = new Float32Array(slots);
    this.seed = new Float32Array(slots);
    this.pts = new Float32Array(slots * points * PT);
  }

  /** Lowest free slot in [from, to), or -1. */
  allocate(kind: number, from: number, to: number, seed: number): number {
    const end = Math.min(to, this.slots);
    for (let s = Math.max(0, from); s < end; s++) {
      if (this.state[s] !== FREE) continue;
      this.state[s] = EMITTING;
      this.kind[s] = kind;
      this.count[s] = 0;
      this.gen[s] = (this.gen[s]! + 1) >>> 0;
      this.odo[s] = 0;
      this.moved[s] = 0;
      this.speed[s] = 0;
      this.seed[s] = seed;
      this.active++;
      return s;
    }
    return -1;
  }

  /** True while the slot still belongs to the handle that allocated it with generation `gen`. */
  owns(slot: number, gen: number): boolean {
    return this.state[slot] === EMITTING && this.gen[slot] === gen;
  }

  push(slot: number, x: number, y: number, z: number, intensity: number): void {
    if (this.state[slot] !== EMITTING) return;
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
    const inten = intensity > 0 ? (intensity < 1 ? intensity : 1) : 0;
    const k = this.kinds[this.kind[slot]!]!;
    const pts = this.pts;
    const base = slot * this.points * PT;
    const n = this.count[slot]!;
    if (n === 0) {
      this.writePoint(base, x, y, z, inten, 0, 0, 0, 0);
      this.writePoint(base + PT, x, y, z, inten, 0, 0, 0, 0);
      this.setDrift(slot, base + PT, k);
      this.count[slot] = 2;
      return;
    }
    const dx = x - pts[base + P_X]!;
    const dy = y - pts[base + P_Y]!;
    const dz = z - pts[base + P_Z]!;
    const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.moved[slot] = this.moved[slot]! + step;
    const odo = this.odo[slot]! + step;
    this.odo[slot] = odo;
    this.writePoint(base, x, y, z, inten, 0, 0, 0, odo);

    const p1 = base + PT;
    const ax = x - pts[p1 + P_X]!;
    const ay = y - pts[p1 + P_Y]!;
    const az = z - pts[p1 + P_Z]!;
    const d1 = Math.sqrt(ax * ax + ay * ay + az * az);
    // Spacing that lets the buffer cover the whole life at the current speed.
    const seg = Math.max(k.segLen, (this.speed[slot]! * k.life) / (this.points - TAIL_FADE_POINTS - 4));
    const crossing = inten > 0 !== pts[p1 + P_INT]! > 0;
    let commit = d1 >= seg || pts[p1 + P_AGE]! >= k.maxSegTime || crossing;
    if (!commit && n >= 3 && d1 > seg * 0.2) {
      const p2 = base + 2 * PT;
      const bx = pts[p1 + P_X]! - pts[p2 + P_X]!;
      const by = pts[p1 + P_Y]! - pts[p2 + P_Y]!;
      const bz = pts[p1 + P_Z]! - pts[p2 + P_Z]!;
      const bl = Math.sqrt(bx * bx + by * by + bz * bz);
      if (bl > 1e-4) commit = (ax * bx + ay * by + az * bz) / (d1 * bl) < k.bendCos;
    }
    if (commit && d1 > 1e-4) {
      const keep = n < this.points ? n : this.points - 1;
      pts.copyWithin(base + PT, base, base + keep * PT);
      this.count[slot] = keep + 1;
      this.setDrift(slot, p1, k);
    }
  }

  release(slot: number): void {
    if (this.state[slot] === EMITTING) this.state[slot] = FADING;
  }

  clear(): void {
    for (let s = 0; s < this.slots; s++) {
      if (this.state[s] !== FREE) this.gen[s] = (this.gen[s]! + 1) >>> 0;
      this.state[s] = FREE;
      this.count[s] = 0;
    }
    this.active = 0;
  }

  /** Ages and drifts every point, trims expired tails and frees finished slots. */
  update(dt: number): void {
    const pts = this.pts;
    const inv = dt > 1e-6 ? 1 / dt : 0;
    for (let s = 0; s < this.slots; s++) {
      const st = this.state[s]!;
      if (st === FREE) continue;
      const k = this.kinds[this.kind[s]!]!;
      const base = s * this.points * PT;
      let n = this.count[s]!;
      if (inv > 0) {
        const measured = this.moved[s]! * inv;
        this.speed[s] = this.speed[s]! + (measured - this.speed[s]!) * 0.25;
        this.moved[s] = 0;
      }
      const damp = Math.exp(-k.drag * dt);
      const wx = WIND.x * k.wind;
      const wy = WIND.y * k.wind;
      const wz = WIND.z * k.wind;
      const first = st === EMITTING ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const o = base + i * PT;
        pts[o + P_AGE] = pts[o + P_AGE]! + dt;
        if (i < first) continue;
        const vx = pts[o + P_VX]!;
        const vy = pts[o + P_VY]!;
        const vz = pts[o + P_VZ]!;
        pts[o + P_X] = pts[o + P_X]! + (vx + wx) * dt;
        pts[o + P_Y] = pts[o + P_Y]! + (vy + wy) * dt;
        pts[o + P_Z] = pts[o + P_Z]! + (vz + wz) * dt;
        pts[o + P_VX] = vx * damp;
        pts[o + P_VY] = vy * damp;
        pts[o + P_VZ] = vz * damp;
      }
      // Drop the last point only once the one before it has faded too, so no visible segment vanishes.
      while (n > 2 && pts[base + (n - 2) * PT + P_AGE]! >= k.life) n--;
      this.count[s] = n;
      const headAge = pts[base + P_AGE]!;
      if (st === EMITTING && headAge > TRAIL_ORPHAN_SECONDS) this.state[s] = FADING;
      if (this.state[s] === FADING && (n === 0 || (n <= 2 && headAge >= k.life))) {
        this.state[s] = FREE;
        this.count[s] = 0;
        this.gen[s] = (this.gen[s]! + 1) >>> 0;
        this.active--;
      }
    }
  }

  /**
   * Writes camera-facing ribbon vertices for one slot (two vertices per point, starting at vertex
   * slot * points * 2). The side vector stays continuous along the strip and falls back to the previous
   * point's side when a segment points at the camera, so the ribbon never twists or flips end-on.
   */
  buildRibbon(slot: number, cam: Vec3Like, camRight: Vec3Like, kindIndex: number, out: RibbonTarget): void {
    const n = this.count[slot]!;
    if (n < 2) return;
    const k = this.kinds[kindIndex]!;
    const pts = this.pts;
    const base = slot * this.points * PT;
    const vbase = slot * this.points * 2;
    const { center, side, data } = out;
    // Fractional progress of the head toward its next commit, so the capacity fade moves smoothly.
    const hx = pts[base + P_X]! - pts[base + PT + P_X]!;
    const hy = pts[base + P_Y]! - pts[base + PT + P_Y]!;
    const hz = pts[base + P_Z]! - pts[base + PT + P_Z]!;
    const seg = Math.max(k.segLen, (this.speed[slot]! * k.life) / (this.points - TAIL_FADE_POINTS - 4));
    const frac = Math.min(1, Math.sqrt(hx * hx + hy * hy + hz * hz) / seg);
    let tx = 0;
    let ty = 0;
    let tz = 1;
    let psx = camRight.x;
    let psy = camRight.y;
    let psz = camRight.z;
    const texScale = 1 / k.texScale;
    const seedU = this.seed[slot]! * 17;
    for (let i = 0; i < n; i++) {
      const o = base + i * PT;
      const px = pts[o + P_X]!;
      const py = pts[o + P_Y]!;
      const pz = pts[o + P_Z]!;
      // Tangent (toward the head) from the neighbours.
      const oa = base + (i > 0 ? i - 1 : 0) * PT;
      const ob = base + (i < n - 1 ? i + 1 : n - 1) * PT;
      let ax = pts[oa + P_X]! - pts[ob + P_X]!;
      let ay = pts[oa + P_Y]! - pts[ob + P_Y]!;
      let az = pts[oa + P_Z]! - pts[ob + P_Z]!;
      let al = Math.sqrt(ax * ax + ay * ay + az * az);
      if (al < 1e-4 && i === 0 && n > 2) {
        const oc = base + 2 * PT;
        ax = px - pts[oc + P_X]!;
        ay = py - pts[oc + P_Y]!;
        az = pz - pts[oc + P_Z]!;
        al = Math.sqrt(ax * ax + ay * ay + az * az);
      }
      if (al > 1e-4) {
        tx = ax / al;
        ty = ay / al;
        tz = az / al;
      }
      // Direction to the camera.
      let vx = cam.x - px;
      let vy = cam.y - py;
      let vz = cam.z - pz;
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vl > 1e-6) {
        vx /= vl;
        vy /= vl;
        vz /= vl;
      } else {
        vx = 0;
        vy = 1;
        vz = 0;
      }
      // Previous side projected perpendicular to this tangent (the fallback direction).
      const pd = psx * tx + psy * ty + psz * tz;
      let qx = psx - tx * pd;
      let qy = psy - ty * pd;
      let qz = psz - tz * pd;
      let ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (ql < 1e-5) {
        // The previous side is parallel to the tangent: use any perpendicular.
        qx = ty * vz - tz * vy;
        qy = tz * vx - tx * vz;
        qz = tx * vy - ty * vx;
        ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (ql < 1e-5) {
          qx = Math.abs(tx) < 0.9 ? 0 : 1;
          qy = 0;
          qz = Math.abs(tx) < 0.9 ? 1 : 0;
          const d2 = qx * tx + qz * tz;
          qx -= tx * d2;
          qy -= ty * d2;
          qz -= tz * d2;
          ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
        }
      }
      qx /= ql;
      qy /= ql;
      qz /= ql;
      // Camera-facing side = tangent × view, kept on the same side as the previous one.
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl > 1e-6) {
        sx /= sl;
        sy /= sl;
        sz /= sl;
        if (sx * qx + sy * qy + sz * qz < 0) {
          sx = -sx;
          sy = -sy;
          sz = -sz;
        }
      }
      // Near end-on the cross product is unstable: blend toward the fallback.
      const w = smooth01((sl - 0.03) / 0.17);
      sx = qx + (sx - qx) * w;
      sy = qy + (sy - qy) * w;
      sz = qz + (sz - qz) * w;
      let fl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (fl < 1e-5) {
        sx = qx;
        sy = qy;
        sz = qz;
        fl = 1;
      }
      sx /= fl;
      sy /= fl;
      sz /= fl;
      psx = sx;
      psy = sy;
      psz = sz;

      // Width and opacity over the point's life.
      const age = pts[o + P_AGE]!;
      const inten = pts[o + P_INT]!;
      const g = age / (age + k.growTau);
      let width = (k.width0 + (k.width1 - k.width0) * g) * (0.55 + 0.45 * inten);
      if (!(width > 0)) width = 0;
      const a01 = age / k.life;
      let op = k.opacity * inten;
      if (k.fadeIn > 0 && age < k.fadeIn) op *= smooth01(age / k.fadeIn);
      if (a01 >= 1) op = 0;
      else if (a01 > k.fadeOut) op *= 1 - smooth01((a01 - k.fadeOut) / (1 - k.fadeOut));
      if (k.thin > 0 && width > 1e-4) op *= 1 - k.thin * (1 - Math.min(1, k.width0 / width));
      const room = this.points - 1 - (i + (i > 0 ? frac : 0));
      if (room < TAIL_FADE_POINTS) op *= room > 0 ? room / TAIL_FADE_POINTS : 0;

      const u = pts[o + P_ODO]! * texScale + seedU;
      const v = (vbase + i * 2) * 3;
      center[v] = px;
      center[v + 1] = py;
      center[v + 2] = pz;
      center[v + 3] = px;
      center[v + 4] = py;
      center[v + 5] = pz;
      side[v] = sx;
      side[v + 1] = sy;
      side[v + 2] = sz;
      side[v + 3] = sx;
      side[v + 4] = sy;
      side[v + 5] = sz;
      const d = (vbase + i * 2) * 4;
      data[d] = u;
      data[d + 1] = op;
      data[d + 2] = kindIndex;
      data[d + 3] = width * 0.5;
      data[d + 4] = u;
      data[d + 5] = op;
      data[d + 6] = kindIndex;
      data[d + 7] = width * 0.5;
    }
  }

  /**
   * Appends two triangles per visible segment of `slot` to `out` at `offset` and returns the new offset.
   * Segments whose two ends are both gaps (intensity 0) are skipped. The farther end is drawn first.
   */
  writeIndices(slot: number, cam: Vec3Like, out: Uint16Array | Uint32Array, offset: number): number {
    const n = this.count[slot]!;
    if (n < 2) return offset;
    const pts = this.pts;
    const base = slot * this.points * PT;
    const vbase = slot * this.points * 2;
    const tail = base + (n - 1) * PT;
    const d0x = pts[base + P_X]! - cam.x;
    const d0y = pts[base + P_Y]! - cam.y;
    const d0z = pts[base + P_Z]! - cam.z;
    const d1x = pts[tail + P_X]! - cam.x;
    const d1y = pts[tail + P_Y]! - cam.y;
    const d1z = pts[tail + P_Z]! - cam.z;
    const headFar = d0x * d0x + d0y * d0y + d0z * d0z > d1x * d1x + d1y * d1y + d1z * d1z;
    let w = offset;
    for (let j = 0; j < n - 1; j++) {
      const i = headFar ? j : n - 2 - j;
      if (pts[base + i * PT + P_INT]! <= 0 && pts[base + (i + 1) * PT + P_INT]! <= 0) continue;
      const a = vbase + i * 2;
      out[w] = a;
      out[w + 1] = a + 1;
      out[w + 2] = a + 2;
      out[w + 3] = a + 1;
      out[w + 4] = a + 3;
      out[w + 5] = a + 2;
      w += 6;
    }
    return w;
  }

  /** Squared camera distance of a slot's middle point (for back-to-front ordering of whole ribbons). */
  distanceSq(slot: number, cam: Vec3Like): number {
    const n = this.count[slot]!;
    if (n === 0) return 0;
    const o = slot * this.points * PT + (n >> 1) * PT;
    const dx = this.pts[o + P_X]! - cam.x;
    const dy = this.pts[o + P_Y]! - cam.y;
    const dz = this.pts[o + P_Z]! - cam.z;
    return dx * dx + dy * dy + dz * dz;
  }

  private writePoint(
    o: number,
    x: number,
    y: number,
    z: number,
    inten: number,
    vx: number,
    vy: number,
    vz: number,
    odo: number,
  ): void {
    const p = this.pts;
    p[o + P_X] = x;
    p[o + P_Y] = y;
    p[o + P_Z] = z;
    p[o + P_VX] = vx;
    p[o + P_VY] = vy;
    p[o + P_VZ] = vz;
    p[o + P_AGE] = 0;
    p[o + P_INT] = inten;
    p[o + P_ODO] = odo;
  }

  /** Gives a newly committed point its drift: a smooth function of the odometer, so the trail bends in waves. */
  private setDrift(slot: number, o: number, k: TrailKindDef): void {
    const s = this.seed[slot]! * 6.2831853;
    const d = this.pts[o + P_ODO]!;
    const a = k.drift;
    this.pts[o + P_VX] = a * (Math.sin(d * 0.021 + s) + 0.5 * Math.sin(d * 0.067 + s * 2.3));
    this.pts[o + P_VY] = k.rise + a * 0.6 * Math.sin(d * 0.029 + s * 1.7);
    this.pts[o + P_VZ] = a * (Math.sin(d * 0.019 + s * 3.1) + 0.5 * Math.sin(d * 0.071 + s * 0.7));
  }
}

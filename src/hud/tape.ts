/**
 * Pure layout math for the moving tapes (airspeed, altitude, heading) and the conformal pitch ladder.
 * Results are written into caller-owned typed arrays so per-frame use never allocates.
 */

export interface TapeScale {
  /** Value between minor ticks. */
  minor: number;
  /** Value between labeled major ticks (a multiple of `minor`). */
  major: number;
  /** Layout units per value unit. */
  unitsPerValue: number;
}

export interface TickBuffer {
  count: number;
  /** Offset from the tape center in layout units; positive = toward larger values. */
  offset: Float32Array;
  /** Tick value (wrapped to 0..360 for circular tapes). */
  value: Float64Array;
  /** 1 when the tick is a labeled major tick. */
  major: Uint8Array;
}

export function createTickBuffer(capacity: number): TickBuffer {
  return {
    count: 0,
    offset: new Float32Array(capacity),
    value: new Float64Array(capacity),
    major: new Uint8Array(capacity),
  };
}

/**
 * Ticks visible within ±halfExtent layout units of `value`. With `wrap` (e.g. 360) values wrap around,
 * for the heading tape. Without wrap, ticks below `floor` (e.g. 0 kt) are dropped.
 */
export function tapeTicks(
  value: number,
  scale: TapeScale,
  halfExtent: number,
  out: TickBuffer,
  wrap = 0,
  floor = -Infinity,
): number {
  const v = Number.isFinite(value) ? value : 0;
  const span = halfExtent / scale.unitsPerValue;
  const first = Math.ceil((v - span) / scale.minor) * scale.minor;
  const cap = out.offset.length;
  let n = 0;
  for (let t = first; t <= v + span + 1e-9 && n < cap; t += scale.minor) {
    // Re-derive from an integer index to avoid accumulating floating point drift.
    const tv = Math.round(t / scale.minor) * scale.minor;
    if (!wrap && tv < floor) continue;
    let label = tv;
    if (wrap) {
      label = tv % wrap;
      if (label < 0) label += wrap;
    }
    out.offset[n] = (tv - v) * scale.unitsPerValue;
    out.value[n] = label;
    out.major[n] = Math.abs(Math.round(tv / scale.major) * scale.major - tv) < 1e-6 ? 1 : 0;
    n++;
  }
  out.count = n;
  return n;
}

export interface RungBuffer {
  count: number;
  /** Screen offset of the rung from the ladder center along the rolled "up" axis, device px (up > 0). */
  offset: Float32Array;
  /** Rung pitch in whole degrees (-90..90). */
  deg: Int16Array;
}

export function createRungBuffer(capacity: number): RungBuffer {
  return { count: 0, offset: new Float32Array(capacity), deg: new Int16Array(capacity) };
}

const MAX_RUNG_DELTA = (80 * Math.PI) / 180;

/**
 * Conformal pitch ladder rungs: a rung at pitch p sits at pxPerRad · tan(p − pitch) above the view
 * center (pinhole projection, exact on the vertical through the center). Only rungs within
 * ±halfWindow px are returned. `stepDeg` is the rung spacing (5 or 10).
 */
export function ladderRungs(
  pitch: number,
  pxPerRad: number,
  halfWindow: number,
  stepDeg: number,
  out: RungBuffer,
): number {
  const p = Number.isFinite(pitch) ? pitch : 0;
  const pDeg = (p * 180) / Math.PI;
  // Angular half-window (conservative: tan grows faster than linear, so this over-covers).
  const spanDeg = Math.min(85, (Math.atan(halfWindow / Math.max(pxPerRad, 1e-3)) * 180) / Math.PI + stepDeg);
  const lo = Math.max(-90, Math.ceil((pDeg - spanDeg) / stepDeg) * stepDeg);
  const hi = Math.min(90, Math.floor((pDeg + spanDeg) / stepDeg) * stepDeg);
  const cap = out.offset.length;
  let n = 0;
  for (let d = lo; d <= hi && n < cap; d += stepDeg) {
    const delta = (d * Math.PI) / 180 - p;
    if (delta > MAX_RUNG_DELTA || delta < -MAX_RUNG_DELTA) continue;
    const off = pxPerRad * Math.tan(delta);
    if (off > halfWindow || off < -halfWindow) continue;
    out.offset[n] = off;
    out.deg[n] = d;
    n++;
  }
  out.count = n;
  return n;
}

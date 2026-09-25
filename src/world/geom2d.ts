/**
 * Pure 2D helpers for hand-authored map control data: splines (canyons, fjords, roads), runway frames and
 * designators. World x/z in meters; headings are radians clockwise from north (-Z).
 */

export type P2 = readonly [number, number];

/** Unit direction (x, z) of a heading. */
export function headingDir(heading: number): [number, number] {
  return [Math.sin(heading), -Math.cos(heading)];
}

/** Heading of a direction vector (x, z). */
export function dirHeading(dx: number, dz: number): number {
  const h = Math.atan2(dx, -dz);
  return h < 0 ? h + Math.PI * 2 : h;
}

/** Runway designator for a heading (magnetic ~ true here): 1..36, zero padded. */
export function runwayNumber(heading: number): string {
  const deg = ((heading * 180) / Math.PI + 360) % 360;
  let n = Math.round(deg / 10);
  if (n === 0) n = 36;
  return String(n).padStart(2, '0');
}

/** Both designators of a runway: [end facing `heading`, reciprocal]. */
export function runwayDesignators(heading: number): [string, string] {
  return [runwayNumber(heading), runwayNumber(heading + Math.PI)];
}

/**
 * Local coordinates of point (x, z) in a runway-like frame: u along the heading from the center, v to the
 * right of the centerline.
 */
export function toLocal(cx: number, cz: number, heading: number, x: number, z: number): [number, number] {
  const [dx, dz] = headingDir(heading);
  const rx = x - cx;
  const rz = z - cz;
  // Right of heading = (−dz, dx) rotated clockwise: for north (0, −1) right is east (1, 0).
  return [rx * dx + rz * dz, rx * -dz + rz * dx];
}

export function fromLocal(cx: number, cz: number, heading: number, u: number, v: number): [number, number] {
  const [dx, dz] = headingDir(heading);
  return [cx + dx * u - dz * v, cz + dz * u + dx * v];
}

/** Distance from p to segment ab, and the segment parameter t in [0, 1]. */
export function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { d: number; t: number } {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + ex * t - px;
  const qz = az + ez * t - pz;
  return { d: Math.sqrt(qx * qx + qz * qz), t };
}

/** Uniform Catmull-Rom spline through control points, sampled every `step` meters (approximately). */
export function catmullRom(points: readonly P2[], step: number): [number, number][] {
  const out: [number, number][] = [];
  if (points.length < 2) return points.map((p) => [p[0], p[1]]);
  const get = (i: number): P2 => points[Math.max(0, Math.min(points.length - 1, i))]!;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = points[points.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

/** Cumulative arc length along a polyline. */
export function arcLengths(poly: readonly P2[]): number[] {
  const out = [0];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    out.push(out[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

/** Point at arc length s along a polyline (clamped) and its heading. */
export function pointAt(
  poly: readonly P2[],
  lengths: readonly number[],
  s: number,
): [number, number, number] {
  const total = lengths[lengths.length - 1]!;
  const c = s < 0 ? 0 : s > total ? total : s;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i]! < c) i++;
  const a = poly[i - 1]!;
  const b = poly[i]!;
  const l0 = lengths[i - 1]!;
  const l1 = lengths[i]!;
  const t = l1 > l0 ? (c - l0) / (l1 - l0) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, dirHeading(b[0] - a[0], b[1] - a[1])];
}

/** Distance from a point to a polyline plus the arc length of the closest point. */
export function polylineDistance(
  poly: readonly P2[],
  lengths: readonly number[],
  x: number,
  z: number,
): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const r = segmentDistance(x, z, a[0], a[1], b[0], b[1]);
    if (r.d < best) {
      best = r.d;
      bestS = lengths[i - 1]! + (lengths[i]! - lengths[i - 1]!) * r.t;
    }
  }
  return { d: best, s: bestS };
}

/**
 * Rasterizes the distance to a set of polylines into a grid (min-combined), only within `reach` meters of the
 * lines. dist must be pre-filled with a large value. Grid sample (ix, iz) sits at origin + i * cell.
 */
export function rasterizeDistance(
  dist: Float32Array,
  size: number,
  originX: number,
  originZ: number,
  cell: number,
  polylines: readonly (readonly P2[])[],
  reach: number,
): void {
  for (const poly of polylines) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]!;
      const b = poly[i]!;
      const minX = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - originX) / cell));
      const maxX = Math.min(size - 1, Math.ceil((Math.max(a[0], b[0]) + reach - originX) / cell));
      const minZ = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - originZ) / cell));
      const maxZ = Math.min(size - 1, Math.ceil((Math.max(a[1], b[1]) + reach - originZ) / cell));
      for (let iz = minZ; iz <= maxZ; iz++) {
        const z = originZ + iz * cell;
        for (let ix = minX; ix <= maxX; ix++) {
          const x = originX + ix * cell;
          const d = segmentDistance(x, z, a[0], a[1], b[0], b[1]).d;
          const k = iz * size + ix;
          if (d < dist[k]!) dist[k] = d;
        }
      }
    }
  }
}

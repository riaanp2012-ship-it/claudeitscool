/**
 * Static vector shapes in layout units (x right, y down, nose up). Flat [x0, y0, x1, y1, ...] arrays
 * are built once at module load and only read per frame.
 */

/** Top-view silhouette of the player's jet for the damage diagram, split into damageable parts. */
export const JET_HULL = new Float32Array([
  0, -30, 2.2, -25, 3.6, -17, 4.4, -8, 4.6, 4, 4.6, 19, 3.8, 23, -3.8, 23, -4.6, 19, -4.6, 4, -4.4, -8, -3.6,
  -17, -2.2, -25,
]);
export const JET_WING_L = new Float32Array([-4.6, -7, -12, -1, -25, 8.5, -25, 11.5, -4.6, 11.5]);
export const JET_WING_R = new Float32Array([4.6, -7, 12, -1, 25, 8.5, 25, 11.5, 4.6, 11.5]);
export const JET_TAIL_L = new Float32Array([-4.6, 16.5, -13, 23.5, -13, 26.5, -4.2, 25]);
export const JET_TAIL_R = new Float32Array([4.6, 16.5, 13, 23.5, 13, 26.5, 4.2, 25]);
export const JET_ENGINE = new Float32Array([-3.8, 23, 3.8, 23, 3.2, 29.5, -3.2, 29.5]);
/** Canopy outline drawn as a detail line on the hull. */
export const JET_CANOPY = new Float32Array([0, -22, 1.5, -18.5, 1.6, -13, 0, -11, -1.6, -13, -1.5, -18.5]);

/** Small own-ship glyph for the center of the RWR scope and radar (about 12 units tall). */
export const OWNSHIP = new Float32Array([
  0, -6.5, 1.2, -2.5, 6, 1.5, 6, 3, 1.2, 1.8, 1, 4.5, 3, 6, -3, 6, -1, 4.5, -1.2, 1.8, -6, 3, -6, 1.5, -1.2,
  -2.5,
]);

/** Appends a closed polygon to the current path, scaled by `s` and translated to (x, y). */
export function tracePolygon(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  x: number,
  y: number,
  s: number,
): void {
  ctx.moveTo(x + pts[0]! * s, y + pts[1]! * s);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(x + pts[i]! * s, y + pts[i + 1]! * s);
  ctx.closePath();
}

/** Appends a closed polygon rotated by `angle` (clockwise, radians) around its origin. */
export function traceRotated(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  x: number,
  y: number,
  s: number,
  angle: number,
): void {
  const c = Math.cos(angle) * s;
  const n = Math.sin(angle) * s;
  ctx.moveTo(x + pts[0]! * c - pts[1]! * n, y + pts[0]! * n + pts[1]! * c);
  for (let i = 2; i < pts.length; i += 2) {
    const px = pts[i]!;
    const py = pts[i + 1]!;
    ctx.lineTo(x + px * c - py * n, y + px * n + py * c);
  }
  ctx.closePath();
}

/** Radar aircraft arrow (nose up), about 10 units tall. */
export const BLIP_ARROW = new Float32Array([0, -5.5, 4, 4.5, 0, 2, -4, 4.5]);
/** Ship hull (nose up). */
export const BLIP_SHIP = new Float32Array([0, -6, 2.4, -2.5, 2.4, 5, -2.4, 5, -2.4, -2.5]);

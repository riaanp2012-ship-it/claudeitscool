/**
 * Label decluttering for contacts: a fixed-capacity list of occupied screen rectangles and a greedy
 * placer that tries a few candidate positions around a symbol and keeps the first one that collides
 * with nothing already placed. Pure and allocation-free (typed arrays sized once).
 */

export interface BoxList {
  count: number;
  x0: Float32Array;
  y0: Float32Array;
  x1: Float32Array;
  y1: Float32Array;
}

export function createBoxList(capacity: number): BoxList {
  return {
    count: 0,
    x0: new Float32Array(capacity),
    y0: new Float32Array(capacity),
    x1: new Float32Array(capacity),
    y1: new Float32Array(capacity),
  };
}

/** Adds a rectangle; silently ignored when full (callers then simply place fewer labels). */
export function addBox(b: BoxList, x0: number, y0: number, x1: number, y1: number): void {
  const i = b.count;
  if (i >= b.x0.length) return;
  b.x0[i] = x0;
  b.y0[i] = y0;
  b.x1[i] = x1;
  b.y1[i] = y1;
  b.count = i + 1;
}

export function overlapsAny(b: BoxList, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 0; i < b.count; i++) {
    if (x0 < b.x1[i]! && x1 > b.x0[i]! && y0 < b.y1[i]! && y1 > b.y0[i]!) return true;
  }
  return false;
}

/** Candidate order around a symbol: below, above, right, left. */
export const LABEL_BELOW = 0;
export const LABEL_ABOVE = 1;
export const LABEL_RIGHT = 2;
export const LABEL_LEFT = 3;

/** Candidate orders (module constants, so passing them allocates nothing). */
export const ORDER_DEFAULT: readonly number[] = [LABEL_BELOW, LABEL_ABOVE, LABEL_RIGHT, LABEL_LEFT];
export const ORDER_CALLSIGN: readonly number[] = [LABEL_ABOVE, LABEL_BELOW, LABEL_LEFT, LABEL_RIGHT];
export const ORDER_INFO: readonly number[] = [LABEL_RIGHT, LABEL_LEFT, LABEL_BELOW, LABEL_ABOVE];

export interface LabelSpot {
  /** Top-left of the placed label. */
  x: number;
  y: number;
}

/**
 * Places a w×h label next to a symbol of radius r at (sx, sy), `gap` px away, inside the bounds
 * [minX, maxX]×[minY, maxY], trying candidates in `order`. Returns the candidate used (and records the
 * box), or -1 when every candidate collides or leaves the bounds.
 */
export function placeLabel(
  b: BoxList,
  sx: number,
  sy: number,
  r: number,
  w: number,
  h: number,
  gap: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  out: LabelSpot,
  order: readonly number[] = ORDER_DEFAULT,
): number {
  for (let k = 0; k < order.length; k++) {
    const c = order[k]!;
    candidateSpot(c, sx, sy, r, w, h, gap, out);
    const x = out.x;
    const y = out.y;
    if (x < minX || y < minY || x + w > maxX || y + h > maxY) continue;
    if (overlapsAny(b, x, y, x + w, y + h)) continue;
    addBox(b, x, y, x + w, y + h);
    return c;
  }
  return -1;
}

/** Top-left of candidate `c` for a w×h label around a symbol of radius r (no collision test). */
export function candidateSpot(
  c: number,
  sx: number,
  sy: number,
  r: number,
  w: number,
  h: number,
  gap: number,
  out: LabelSpot,
): void {
  if (c === LABEL_BELOW) {
    out.x = sx - w / 2;
    out.y = sy + r + gap;
  } else if (c === LABEL_ABOVE) {
    out.x = sx - w / 2;
    out.y = sy - r - gap - h;
  } else if (c === LABEL_RIGHT) {
    out.x = sx + r + gap;
    out.y = sy - h / 2;
  } else {
    out.x = sx - r - gap - w;
    out.y = sy - h / 2;
  }
}

/**
 * Writes the indices 0..n-1 into `out` ordered by ascending `keys` (stable insertion sort; n is small).
 * Entries with a non-finite key sort last.
 */
export function sortIndices(keys: Float32Array, n: number, out: Int32Array): void {
  for (let i = 0; i < n; i++) {
    const k = keys[i]!;
    const kk = Number.isFinite(k) ? k : Infinity;
    let j = i;
    while (j > 0) {
      const prev = keys[out[j - 1]!]!;
      const pk = Number.isFinite(prev) ? prev : Infinity;
      if (pk <= kk) break;
      out[j] = out[j - 1]!;
      j--;
    }
    out[j] = i;
  }
}

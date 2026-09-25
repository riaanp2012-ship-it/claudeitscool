/**
 * Pure focus-navigation model (no DOM). A screen is a grid of rows; each row holds one or more cells.
 * `shape[row][col]` is true when that cell can take focus. Disabled cells are always skipped.
 */
export type NavShape = readonly (readonly boolean[])[];

export interface NavPos {
  row: number;
  col: number;
}

/**
 * Index of the next enabled entry after `from` in direction `dir`. With `wrap`, the search continues
 * past the ends. Returns `from` when no other enabled entry exists (so focus never lands on a disabled item).
 */
export function stepIndex(enabled: readonly boolean[], from: number, dir: 1 | -1, wrap: boolean): number {
  const n = enabled.length;
  if (n === 0) return -1;
  let i = from;
  for (let k = 0; k < n; k++) {
    i += dir;
    if (i < 0 || i >= n) {
      if (!wrap) return enabled[from] ? from : firstEnabled(enabled);
      i = (i + n) % n;
    }
    if (enabled[i]) return i;
  }
  return enabled[from] ? from : -1;
}

/** First enabled index at or after `preferred` (wrapping), or -1 when everything is disabled. */
export function firstEnabled(enabled: readonly boolean[], preferred = 0): number {
  const n = enabled.length;
  if (n === 0) return -1;
  const start = Math.min(Math.max(preferred, 0), n - 1);
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (enabled[i]) return i;
  }
  return -1;
}

const rowEnabled = (shape: NavShape): boolean[] => shape.map((cells) => cells.some(Boolean));

/** Enabled cell in `cells` closest to `col` (ties prefer the lower index). */
export function nearestEnabled(cells: readonly boolean[], col: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const d = Math.abs(i - col);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/** Initial focus: the preferred cell if enabled, otherwise the first enabled cell in reading order. */
export function initialPos(shape: NavShape, preferred?: NavPos): NavPos | null {
  if (preferred && shape[preferred.row]?.[preferred.col]) return { ...preferred };
  for (let r = 0; r < shape.length; r++) {
    const c = firstEnabledStrict(shape[r]!);
    if (c >= 0) return { row: r, col: c };
  }
  return null;
}

function firstEnabledStrict(cells: readonly boolean[]): number {
  for (let i = 0; i < cells.length; i++) if (cells[i]) return i;
  return -1;
}

/** Move up (-1) or down (+1) to the next row with an enabled cell, keeping the column where possible. */
export function moveRow(shape: NavShape, pos: NavPos, dir: 1 | -1, wrap: boolean): NavPos {
  const rows = rowEnabled(shape);
  const r = stepIndex(rows, pos.row, dir, wrap);
  if (r < 0 || r === pos.row) return validate(shape, pos);
  return { row: r, col: nearestEnabled(shape[r]!, pos.col) };
}

/** Move left (-1) or right (+1) within the current row. Never wraps, never leaves the row. */
export function moveCol(shape: NavShape, pos: NavPos, dir: 1 | -1): NavPos {
  const cells = shape[pos.row];
  if (!cells) return pos;
  const c = stepIndex(cells, pos.col, dir, false);
  return c < 0 ? pos : { row: pos.row, col: c };
}

/** Re-validates a position after the shape changed (items disabled or removed). */
export function validate(shape: NavShape, pos: NavPos): NavPos {
  if (shape[pos.row]?.[pos.col]) return pos;
  const cells = shape[pos.row];
  if (cells && cells.some(Boolean)) return { row: pos.row, col: nearestEnabled(cells, pos.col) };
  const rows = rowEnabled(shape);
  let r = stepIndex(rows, Math.min(pos.row, shape.length - 1), 1, true);
  if (r < 0) r = firstEnabled(rows);
  if (r < 0) return pos;
  return { row: r, col: nearestEnabled(shape[r]!, pos.col) };
}

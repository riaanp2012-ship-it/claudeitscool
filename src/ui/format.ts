/**
 * Pure number and time formatting for the UI. Never returns 'NaN', 'undefined' or 'Infinity' (ZD-J03):
 * non-finite input renders as an em dash.
 */
export const EMPTY = '—';
/** Typographic minus sign (U+2212), same width as the plus sign in tabular fonts. */
export const MINUS = '−';

export function pad(n: number, width = 2): string {
  if (!Number.isFinite(n)) return EMPTY;
  const s = String(Math.abs(Math.trunc(n)));
  const padded = s.length >= width ? s : '0'.repeat(width - s.length) + s;
  return n < 0 ? MINUS + padded : padded;
}

/** Thousands-separated integer: 12400 -> '12,400'. */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return EMPTY;
  const r = Math.round(n);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return r < 0 ? MINUS + s : s;
}

/** Fixed decimals with a typographic minus: formatFixed(-1.5, 2) -> '−1.50'. */
export function formatFixed(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return EMPTY;
  const s = Math.abs(n).toFixed(decimals);
  const isZero = Number(s) === 0;
  return n < 0 && !isZero ? MINUS + s : s;
}

/** Signed delta: '+0.20', '−1.00', '0.00' for zero. */
export function formatSigned(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return EMPTY;
  const s = Math.abs(n).toFixed(decimals);
  if (Number(s) === 0) return s;
  return (n > 0 ? '+' : MINUS) + s;
}

/** Whole percent from a 0..1 fraction: 0.345 -> '35%'. */
export function formatPercent(fraction: number, decimals = 0): string {
  if (!Number.isFinite(fraction)) return EMPTY;
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Mission clock: 734 -> '12:14', 3700 -> '1:01:40'. Negative values clamp to zero. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return EMPTY;
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Lap or lesson time with hundredths: 102.364 -> '1:42.36'. */
export function formatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return EMPTY;
  const hundredths = Math.round(seconds * 100);
  const m = Math.floor(hundredths / 6000);
  const s = Math.floor((hundredths % 6000) / 100);
  const c = hundredths % 100;
  return `${m}:${pad(s)}.${pad(c)}`;
}

/** Flight hours with one decimal: 66780 s -> '18.6'. */
export function formatHours(seconds: number): string {
  if (!Number.isFinite(seconds)) return EMPTY;
  return (Math.max(0, seconds) / 3600).toFixed(1);
}

/** Kill/death ratio; with no deaths the kill count is the ratio. */
export function formatRatio(kills: number, deaths: number): string {
  if (!Number.isFinite(kills) || !Number.isFinite(deaths)) return EMPTY;
  return (deaths > 0 ? kills / deaths : kills).toFixed(2);
}

/** Mach number: 2.3 -> 'M 2.30'. */
export function formatMach(mach: number): string {
  return `M ${formatFixed(mach, 2)}`;
}

/** Distance in meters as km with one decimal above 1 km: 18000 -> '18.0 km'. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return EMPTY;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

/** Upper-cases a label for display. Kept here so copy stays sentence case in data. */
export function upper(text: string): string {
  return text.toLocaleUpperCase('en-US');
}

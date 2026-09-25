/**
 * HUD layout frame. Everything is designed in "layout units" on a 16:9 frame; one unit is one CSS px
 * at 1080p and 100 % HUD scale. The unit grows with resolution and the HUD scale setting, but is capped
 * so the safe area always holds at least 1280×720 units: that guarantees the fixed layout never
 * overlaps from 1280×720 to 3840×2160 and from 4:3 to 32:9 at any scale (ZD-J01, ZD-J02).
 */

export const REF_HEIGHT = 1080;
export const MIN_UNITS_W = 1280;
export const MIN_UNITS_H = 720;
/** Widest aspect the HUD spreads to; wider screens center a 16:9 safe area (ZD-J02). */
export const SAFE_ASPECT = 16 / 9;
/** Inset of the peripheral panels from the safe-area edge, in layout units. */
export const EDGE_MARGIN = 24;
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.4;

export interface HudLayout {
  cssW: number;
  cssH: number;
  dpr: number;
  /** Backing store size, device px. */
  W: number;
  H: number;
  /** CSS px per layout unit. */
  u: number;
  /** Device px per layout unit (u × dpr). All drawing happens in device px. */
  S: number;
  /** Safe area, device px (16:9 at most, centered). */
  safeX: number;
  safeY: number;
  safeW: number;
  safeH: number;
  /** Safe area inset by EDGE_MARGIN: where peripheral panels anchor, device px. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Viewport center, device px. */
  cx: number;
  cy: number;
  /** Safe area size in layout units (≥ 1280×720 by construction, up to rounding). */
  unitsW: number;
  unitsH: number;
  /** Stroke widths in device px (integers so lines sit on the pixel grid, ZD-B31). */
  line: number;
  thin: number;
  bold: number;
  /** Halo added on each side of a stroke, device px. */
  halo: number;
}

export function createLayout(): HudLayout {
  return {
    cssW: 1,
    cssH: 1,
    dpr: 1,
    W: 1,
    H: 1,
    u: 1,
    S: 1,
    safeX: 0,
    safeY: 0,
    safeW: 1,
    safeH: 1,
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
    cx: 0,
    cy: 0,
    unitsW: 1,
    unitsH: 1,
    line: 1,
    thin: 1,
    bold: 2,
    halo: 1,
  };
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return scale < MIN_SCALE ? MIN_SCALE : scale > MAX_SCALE ? MAX_SCALE : scale;
}

/** The CSS px per layout unit for a safe area of cssW×cssH at HUD scale `scale`. */
export function unitSize(safeCssW: number, safeCssH: number, scale: number): number {
  const byResolution = Math.min(2, Math.max(1, safeCssH / REF_HEIGHT));
  const wanted = byResolution * clampScale(scale);
  const fit = Math.min(safeCssW / MIN_UNITS_W, safeCssH / MIN_UNITS_H);
  return Math.max(0.25, Math.min(wanted, fit));
}

export function computeLayout(
  cssW: number,
  cssH: number,
  dpr: number,
  scale: number,
  out: HudLayout,
): HudLayout {
  const w = Math.max(1, cssW);
  const h = Math.max(1, cssH);
  const r = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  out.cssW = w;
  out.cssH = h;
  out.dpr = r;
  out.W = Math.max(1, Math.round(w * r));
  out.H = Math.max(1, Math.round(h * r));

  const safeCssW = w / h > SAFE_ASPECT ? h * SAFE_ASPECT : w;
  const safeCssH = h;
  out.u = unitSize(safeCssW, safeCssH, scale);
  out.S = out.u * r;

  out.safeW = Math.round(safeCssW * r);
  out.safeH = Math.round(safeCssH * r);
  out.safeX = Math.round((out.W - out.safeW) / 2);
  out.safeY = Math.round((out.H - out.safeH) / 2);
  const m = Math.round(EDGE_MARGIN * out.S);
  out.left = out.safeX + m;
  out.right = out.safeX + out.safeW - m;
  out.top = out.safeY + m;
  out.bottom = out.safeY + out.safeH - m;
  out.cx = Math.round(out.W / 2);
  out.cy = Math.round(out.H / 2);
  out.unitsW = safeCssW / out.u;
  out.unitsH = safeCssH / out.u;

  out.line = Math.max(1, Math.round(1.5 * out.S));
  out.thin = Math.max(1, Math.round(1 * out.S));
  out.bold = Math.max(2, Math.round(3 * out.S));
  out.halo = Math.max(1, Math.round(1 * out.S));
  return out;
}

/** Offset that puts a stroke of integer width `lw` on the pixel grid: 0.5 for odd widths. */
export function snapOffset(lw: number): number {
  return (Math.round(lw) & 1) === 1 ? 0.5 : 0;
}

/** Snaps a device-px coordinate so a stroke of width `lw` renders crisp (ZD-B31). */
export function snap(v: number, lw: number): number {
  const o = snapOffset(lw);
  return Math.round(v - o) + o;
}

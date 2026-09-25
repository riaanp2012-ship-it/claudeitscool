/**
 * HUD colors from the design tokens (spec §8.2). Every color string the renderer uses per frame is
 * built here once when the color or colorblind mode changes, never per frame.
 */

export type HudColorName = 'green' | 'amber' | 'white';
export type ColorblindMode = 'off' | 'protan' | 'deutan' | 'tritan';

export const HUD_COLOR_TOKENS: Readonly<Record<HudColorName, string>> = {
  green: '#9DF2B4',
  amber: '#FFC24B',
  white: '#EAF2EE',
};

export const INK_900 = '#0A0C0D';
export const BONE = '#E9E5D9';

interface Signals {
  friend: string;
  foe: string;
  warn: string;
  critical: string;
}

/**
 * Friend/foe/warning colors per colorblind mode. Shapes always differ (circles vs diamonds), so these
 * only improve separation: protan/deutan move foe to a luminous orange and critical to yellow; tritan
 * moves friend toward white-cyan and foe toward magenta-red.
 */
export const SIGNALS: Readonly<Record<ColorblindMode, Signals>> = {
  off: { friend: '#5AB8FF', foe: '#FF4D3D', warn: '#FFC24B', critical: '#FF4D3D' },
  protan: { friend: '#5AB8FF', foe: '#FF9E1B', warn: '#E8D46A', critical: '#FFE14D' },
  deutan: { friend: '#4FA3FF', foe: '#FF8A1F', warn: '#E8D46A', critical: '#FFE14D' },
  tritan: { friend: '#9FEFFF', foe: '#FF3D7A', warn: '#FF9A6B', critical: '#FF3D7A' },
};

export interface HudPalette {
  primary: string;
  /** Secondary symbology and labels (70 %). */
  dim: string;
  /** Backgrounds of scopes, faint rings (35 %). */
  faint: string;
  /** Dark halo under every stroke and glyph (ZD-J08). */
  halo: string;
  /** Backing for text blocks (subtitles, hints) and scope discs. */
  backing: string;
  scopeBacking: string;
  bone: string;
  friend: string;
  foe: string;
  warn: string;
  critical: string;
  /** Damage fill per band: light, moderate, heavy, destroyed. */
  damage: readonly [string, string, string, string];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/** Mix two hex colors (t = 0 → a, 1 → b) and return rgba with `alpha`. */
export function mixRgba(a: string, b: string, t: number, alpha: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return 'rgba(' + r + ',' + g + ',' + bl + ',' + alpha + ')';
}

/** The halo is a darkened, slightly tinted version of the HUD color so it reads as depth, not a box. */
function haloFor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 'rgba(' + Math.round(r * 0.06) + ',' + Math.round(g * 0.08) + ',' + Math.round(b * 0.07) + ',0.62)';
}

export function buildPalette(color: HudColorName, mode: ColorblindMode): HudPalette {
  const primary = HUD_COLOR_TOKENS[color] ?? HUD_COLOR_TOKENS.green;
  const s = SIGNALS[mode] ?? SIGNALS.off;
  return {
    primary,
    dim: rgba(primary, 0.7),
    faint: rgba(primary, 0.35),
    halo: haloFor(primary),
    backing: rgba(INK_900, 0.5),
    scopeBacking: rgba(INK_900, 0.32),
    bone: BONE,
    friend: s.friend,
    foe: s.foe,
    warn: s.warn,
    critical: s.critical,
    damage: [
      rgba(s.warn, 0.35),
      rgba(s.warn, 0.7),
      mixRgba(s.warn, s.critical, 0.75, 0.75),
      rgba(s.critical, 0.95),
    ],
  };
}

/** Damage band 0..3 for a part at damage d (0 intact .. 1 destroyed), or -1 when undamaged. */
export function damageBand(d: number): number {
  if (!(d > 0.05)) return -1;
  if (d < 0.34) return 0;
  if (d < 0.67) return 1;
  if (d < 0.999) return 2;
  return 3;
}

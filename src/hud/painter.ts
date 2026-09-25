import type { HudLayout } from './layout';
import { snapOffset } from './layout';
import type { HudPalette } from './palette';
import { fitText, wrapText } from './text';

/**
 * Thin state-tracking wrapper over the 2D context: font roles, halo strokes, pixel snapping and
 * cached text measurement. Setting `ctx.font` is the expensive part of canvas text, so fonts are
 * switched only when the role changes. Nothing here allocates on the per-frame path.
 */

const MONO = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace';
const LABEL = '"Barlow Condensed", "Arial Narrow", sans-serif';
const BODY = '"IBM Plex Sans", "Segoe UI", sans-serif';

export interface FontRole {
  readonly id: number;
  readonly family: string;
  readonly weight: number;
  /** Size in layout units (the §8.3 type scale). */
  readonly size: number;
  /** Letter spacing in em. */
  readonly tracking: number;
  font: string;
  spacing: string;
  /** Rendered size in device px. */
  px: number;
}

function role(id: number, family: string, weight: number, size: number, tracking: number): FontRole {
  return { id, family, weight, size, tracking, font: '', spacing: '0px', px: size };
}

/** Font roles. Numbers use JetBrains Mono (fixed advance = tabular figures, ZD-J07). */
export function createFonts() {
  return {
    monoL: role(0, MONO, 500, 20, 0),
    monoM: role(1, MONO, 500, 16, 0),
    monoS: role(2, MONO, 500, 14, 0),
    monoXL: role(3, MONO, 500, 28, 0),
    labelL: role(4, LABEL, 600, 20, 0.08),
    labelM: role(5, LABEL, 600, 16, 0.08),
    labelS: role(6, LABEL, 600, 14, 0.1),
    labelXL: role(7, LABEL, 600, 28, 0.06),
    warning: role(8, LABEL, 700, 28, 0.1),
    title: role(9, LABEL, 700, 40, 0.14),
    body: role(10, BODY, 500, 16, 0),
    bodyS: role(11, BODY, 500, 14, 0),
  };
}

export type HudFonts = ReturnType<typeof createFonts>;

export type Align = 'left' | 'right' | 'center';

export class Painter {
  readonly ctx: CanvasRenderingContext2D;
  readonly fonts: HudFonts = createFonts();
  layout: HudLayout;
  palette: HudPalette;
  private readonly roles: FontRole[] = Object.values(this.fonts);
  private font: FontRole | null = null;
  private align: CanvasTextAlign | '' = '';
  /** Per-role width caches for strings (static labels, feed lines). Cleared on font size change. */
  private readonly widths: Map<string, number>[] = this.roles.map(() => new Map<string, number>());
  private readonly fits: Map<string, string>[] = this.roles.map(() => new Map<string, string>());
  private readonly fitWidth: number[] = this.roles.map(() => 0);
  private measureRole: FontRole = this.fonts.labelM;
  private readonly measureFn = (s: string): number => this.measure(s, this.measureRole);
  /** Text halo stroke width, device px. */
  textHalo = 3;

  constructor(ctx: CanvasRenderingContext2D, layout: HudLayout, palette: HudPalette) {
    this.ctx = ctx;
    this.layout = layout;
    this.palette = palette;
  }

  /** Rebuilds font strings for the current layout scale and forgets context state (after resize). */
  configure(layout: HudLayout): void {
    this.layout = layout;
    for (let i = 0; i < this.roles.length; i++) {
      const r = this.roles[i]!;
      const px = Math.max(8, Math.round(r.size * layout.S));
      if (px !== r.px || r.font === '') {
        this.widths[i]!.clear();
        this.fits[i]!.clear();
      }
      r.px = px;
      r.font = r.weight + ' ' + px + 'px ' + r.family;
      r.spacing = r.tracking > 0 ? Math.round(px * r.tracking * 10) / 10 + 'px' : '0px';
    }
    this.textHalo = Math.max(2, Math.round(2.5 * layout.S));
    this.invalidate();
  }

  /** Context state is lost when the canvas is resized; force every property to be set again. */
  invalidate(): void {
    this.font = null;
    this.align = '';
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.miterLimit = 2;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;
    ctx.setLineDash(NO_DASH);
  }

  save(): void {
    this.ctx.save();
  }

  /** ctx.restore() also restores font and alignment, so forget what we think is set. */
  restore(): void {
    this.ctx.restore();
    this.font = null;
    this.align = '';
  }

  setFont(r: FontRole): void {
    if (this.font === r) return;
    this.font = r;
    this.ctx.font = r.font;
    this.ctx.letterSpacing = r.spacing;
  }

  setAlign(a: CanvasTextAlign): void {
    if (this.align === a) return;
    this.align = a;
    this.ctx.textAlign = a;
  }

  /** Prepares halo'd text: fill color, halo stroke, font and alignment. */
  textStyle(r: FontRole, color: string, align: CanvasTextAlign): void {
    const ctx = this.ctx;
    this.setFont(r);
    this.setAlign(align);
    ctx.fillStyle = color;
    ctx.strokeStyle = this.palette.halo;
    ctx.lineWidth = this.textHalo;
  }

  /** Draws text with its halo at a whole-pixel position (no subpixel shimmer, ZD-B31). */
  text(s: string, x: number, y: number): void {
    if (s.length === 0) return;
    const ctx = this.ctx;
    const px = Math.round(x);
    const py = Math.round(y);
    ctx.strokeText(s, px, py);
    ctx.fillText(s, px, py);
  }

  /** Strokes the current path twice: a dark halo, then the color (ZD-J08). */
  stroke(color: string, width: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = width + this.layout.halo * 2;
    ctx.strokeStyle = this.palette.halo;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /** Fills the current path over a halo outline. */
  fill(color: string): void {
    const ctx = this.ctx;
    ctx.lineWidth = this.layout.halo * 2;
    ctx.strokeStyle = this.palette.halo;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** Snap for strokes of width `lw` (device px). */
  snap(v: number, lw: number): number {
    const o = snapOffset(lw);
    return Math.round(v - o) + o;
  }

  /** Width of a string in a role, device px. Cached per string; measureText only on a miss. */
  measure(s: string, r: FontRole): number {
    const cache = this.widths[r.id]!;
    let w = cache.get(s);
    if (w === undefined) {
      const prevFont = this.font;
      this.setFont(r);
      w = this.ctx.measureText(s).width;
      if (prevFont) this.setFont(prevFont);
      if (cache.size > 512) cache.clear();
      cache.set(s, w);
    }
    return w;
  }

  /** `s` truncated with an ellipsis to `maxWidth` device px in role `r`. Cached per string. */
  fit(s: string, r: FontRole, maxWidth: number): string {
    const id = r.id;
    const cache = this.fits[id]!;
    if (this.fitWidth[id] !== maxWidth) {
      cache.clear();
      this.fitWidth[id] = maxWidth;
    }
    let out = cache.get(s);
    if (out === undefined) {
      this.measureRole = r;
      out = fitText(s, maxWidth, this.measureFn);
      if (cache.size > 256) cache.clear();
      cache.set(s, out);
    }
    return out;
  }

  /** Word-wraps (not cached; callers cache the result per source string). */
  wrap(s: string, r: FontRole, maxWidth: number, maxLines: number): string[] {
    this.measureRole = r;
    return wrapText(s, maxWidth, maxLines, this.measureFn);
  }
}

export const NO_DASH: number[] = [];

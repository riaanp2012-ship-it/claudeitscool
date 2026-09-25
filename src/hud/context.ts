import type { HudState, HudWarning } from '../core/types';
import type { HudStrings } from './caches';
import type { Vec2Out } from './edge';
import type { DrumSplit } from './format';
import type { HudLayout } from './layout';
import type { HudFonts, Painter } from './painter';
import type { HudPalette } from './palette';
import type { RungBuffer, TickBuffer } from './tape';

/**
 * Geometry of the central flight cluster for the current view, device px. In 'chase' the cluster is
 * centered on the viewport; in 'cockpit' it shrinks into the HUD glass around the view center.
 */
export interface Cluster {
  cx: number;
  cy: number;
  /** Distance from the cluster center to the inner edge of the speed/altitude tapes. */
  tapeInner: number;
  /** Half height of the tapes. */
  tapeHalf: number;
  /** Heading tape baseline. */
  headingY: number;
  /** Heading tape half width. */
  headingHalf: number;
  /** Pitch ladder clip rectangle. */
  ladderX: number;
  ladderY: number;
  ladderW: number;
  ladderH: number;
  /** HUD glass rectangle in cockpit view (clip for flight symbology), or glassW = 0 when unused. */
  glassX: number;
  glassY: number;
  glassW: number;
  glassH: number;
}

export function createCluster(): Cluster {
  return {
    cx: 0,
    cy: 0,
    tapeInner: 0,
    tapeHalf: 0,
    headingY: 0,
    headingHalf: 0,
    ladderX: 0,
    ladderY: 0,
    ladderW: 0,
    ladderH: 0,
    glassX: 0,
    glassY: 0,
    glassW: 0,
    glassH: 0,
  };
}

/** Everything a draw pass needs. One instance per HUD; nothing in it is reallocated per frame. */
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  p: Painter;
  L: HudLayout;
  pal: HudPalette;
  f: HudFonts;
  s: HudStrings;
  cl: Cluster;
  /** Seconds since the HUD was created (drives flashing and fades). */
  time: number;
  /** Top of the free space in the center stack (warnings, then the message), device px. */
  stackY: number;
  /** Seconds the current center message has been shown. */
  messageShown: number;
  ticks: TickBuffer;
  rungs: RungBuffer;
  drum: DrumSplit;
  v2: Vec2Out;
  warnings: HudWarning[];
  /** Kill feed indices sorted youngest last. */
  feedIdx: Int32Array;
  /** Wrapped subtitle for `subtitleSource` (rebuilt only when the text changes). */
  subtitleSource: string;
  subtitleLines: string[];
  subtitleWrapWidth: number;
  /** Dash patterns in device px, rescaled in place on layout change (setLineDash gets stable arrays). */
  dashLadder: number[];
  dashSeeker: number[];
  dashFine: number[];
  noDash: number[];
  state: HudState;
}

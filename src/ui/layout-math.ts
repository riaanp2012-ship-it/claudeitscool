/** Pure layout math: UI zoom per viewport and tooltip placement (tested without a DOM). */
import { clamp } from './values';

/** The layout is designed at this size; larger viewports zoom the whole UI up. */
export const REFERENCE_WIDTH = 1920;
export const REFERENCE_HEIGHT = 1080;
/** Smallest layout box (in UI px) every screen is designed to fit. */
export const MIN_LAYOUT_WIDTH = 1024;
export const MIN_LAYOUT_HEIGHT = 600;
/** Widest frame aspect; ultrawide screens center a 16:9 frame (the scene fills the sides). */
export const MAX_FRAME_ASPECT = 16 / 9;
/** Below this layout height the UI switches to its compact vertical rhythm. */
export const COMPACT_HEIGHT = 820;
/** Below this layout width grids tighten their gutters. */
export const NARROW_WIDTH = 1360;

export interface UiLayout {
  /** CSS zoom applied to the UI root. */
  zoom: number;
  /** Layout box in UI px (viewport / zoom). */
  width: number;
  height: number;
  /** Centered frame inside the layout box. */
  frameWidth: number;
  frameLeft: number;
  compact: boolean;
  narrow: boolean;
}

/**
 * Viewports above 1920x1080 zoom the UI so it keeps its proportions (2x at 3840x2160); the
 * accessibility UI scale multiplies that. The zoom is capped so the layout box never drops below the
 * minimum size every screen is designed for, which keeps text from clipping at large scales (ZD-J01).
 */
export function computeLayout(viewportWidth: number, viewportHeight: number, uiScale: number): UiLayout {
  const w = Math.max(1, viewportWidth);
  const h = Math.max(1, viewportHeight);
  const auto = Math.max(1, Math.min(w / REFERENCE_WIDTH, h / REFERENCE_HEIGHT));
  const requested = auto * (Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1);
  const cap = Math.min(w / MIN_LAYOUT_WIDTH, h / MIN_LAYOUT_HEIGHT);
  const zoom = Math.round(clamp(Math.min(requested, cap), 0.25, 8) * 1000) / 1000;
  const width = w / zoom;
  const height = h / zoom;
  const frameWidth = Math.min(width, height * MAX_FRAME_ASPECT);
  return {
    zoom,
    width,
    height,
    frameWidth,
    frameLeft: (width - frameWidth) / 2,
    compact: height < COMPACT_HEIGHT,
    narrow: frameWidth < NARROW_WIDTH,
  };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  side: 'above' | 'below';
}

/**
 * Places a tooltip below its anchor (above when there is no room), left-aligned with the anchor,
 * and clamped so it never leaves `bounds` (ZD-J14).
 */
export function placeTooltip(
  anchor: Box,
  tip: { width: number; height: number },
  bounds: { width: number; height: number },
  gap = 8,
  margin = 8,
): TooltipPlacement {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - tip.height;
  const fitsBelow = below + tip.height <= bounds.height - margin;
  const fitsAbove = above >= margin;
  const side: 'above' | 'below' = fitsBelow || !fitsAbove ? 'below' : 'above';
  const rawTop = side === 'below' ? below : above;
  const maxLeft = Math.max(margin, bounds.width - margin - tip.width);
  const maxTop = Math.max(margin, bounds.height - margin - tip.height);
  return {
    left: clamp(anchor.left, margin, maxLeft),
    top: clamp(rawTop, margin, maxTop),
    side,
  };
}

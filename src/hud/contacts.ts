import type { HudContact, Team } from '../core/types';
import type { DrawContext } from './context';
import {
  ORDER_INFO,
  addBox,
  candidateSpot,
  createBoxList,
  placeLabel,
  sortIndices,
  type BoxList,
  type LabelSpot,
} from './declutter';
import { ellipseEdge } from './edge';
import { closureIn, distanceIn, distanceUnitLabel, rangeKey, speedUnitLabel } from './format';

/**
 * Contact symbology. Shape carries identity (never color alone, spec §8.2): friendlies are circles,
 * hostiles are diamonds, checkpoints are rings. The selected target gets corner brackets, callsign,
 * range, closure, health and the lock ring that closes into a heavy lock diamond.
 *
 * Decluttering: the selected target's info block and every on-screen symbol are reserved first; then
 * the other contacts are labeled nearest-first. The FULL_LABELS nearest get "CALLSIGN range", the rest
 * range only, each placed below/above/right/left of its symbol at the first spot that collides with
 * nothing. A label that fits nowhere is dropped (the symbol still carries identity).
 */

/** Non-selected contacts (nearest first) that get a callsign in addition to the range. */
export const FULL_LABELS = 2;
/** Contacts considered for labels; beyond this only symbols are drawn. */
export const MAX_LABELED = 64;

export interface ContactLabels {
  boxes: BoxList;
  keys: Float32Array;
  order: Int32Array;
  /** Per contact index: -1 no label, 0 range only, 1 callsign + range. */
  tier: Int8Array;
  lx: Float32Array;
  ly: Float32Array;
  spot: LabelSpot;
  /** Selected target: index (-1 none) and the top-left corner of its callsign/range/closure block. */
  sel: number;
  infoX: number;
  infoY: number;
}

export function createContactLabels(): ContactLabels {
  return {
    boxes: createBoxList(MAX_LABELED * 2 + 8),
    keys: new Float32Array(MAX_LABELED),
    order: new Int32Array(MAX_LABELED),
    tier: new Int8Array(MAX_LABELED),
    lx: new Float32Array(MAX_LABELED),
    ly: new Float32Array(MAX_LABELED),
    spot: { x: 0, y: 0 },
    sel: -1,
    infoX: 0,
    infoY: 0,
  };
}

const TAU = Math.PI * 2;
/** The player's side. HudContact.team is absolute, so friend/foe is relative to this. */
export const PLAYER_TEAM: Team = 'blue';
/** World radius (m) of a training checkpoint ring, for its on-screen size. */
export const CHECKPOINT_RADIUS = 50;

const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

function isShown(c: HudContact): boolean {
  return c.onScreen && c.screen.visible && Number.isFinite(c.screen.x) && Number.isFinite(c.screen.y);
}

const GROUP_FOE = 0;
const GROUP_FRIEND = 1;
const GROUP_CHECKPOINT = 2;

function groupOf(c: HudContact): number {
  if (c.kind === 'checkpoint') return GROUP_CHECKPOINT;
  return c.team === PLAYER_TEAM ? GROUP_FRIEND : GROUP_FOE;
}

function groupColor(dc: DrawContext, g: number): string {
  return g === GROUP_FOE ? dc.pal.foe : g === GROUP_FRIEND ? dc.pal.friend : dc.pal.primary;
}

function checkpointRadius(dc: DrawContext, c: HudContact): number {
  const k = fin(dc.state.camera.pxPerRad) * dc.L.dpr;
  const d = Math.max(1, fin(c.distance, 1000));
  const r = (CHECKPOINT_RADIUS / d) * k;
  const min = 14 * dc.L.S;
  const max = dc.L.H * 0.4;
  return r < min ? min : r > max ? max : r;
}

/** On-screen symbols of one group, stroked as a single path. */
function drawGroupSymbols(dc: DrawContext, g: number): number {
  const { ctx, p, L } = dc;
  const cs = dc.state.contacts;
  const S = L.S;
  const dpr = L.dpr;
  const lw = L.line;
  let count = 0;
  ctx.beginPath();
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (!isShown(c) || groupOf(c) !== g) continue;
    count++;
    if (c.selected && c.lock >= 1 && g !== GROUP_CHECKPOINT) continue;
    const x = p.snap(c.screen.x * dpr, lw);
    const y = p.snap(c.screen.y * dpr, lw);
    if (g === GROUP_CHECKPOINT) {
      const r = checkpointRadius(dc, c);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      const t = Math.min(8 * S, r * 0.35);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y - r + t);
      ctx.moveTo(x, y + r);
      ctx.lineTo(x, y + r - t);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x - r + t, y);
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + r - t, y);
    } else if (g === GROUP_FRIEND) {
      const r = Math.round((c.selected ? 10 : 8) * S);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    } else {
      const r = Math.round((c.selected ? 11 : 9) * S);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    }
    if (c.kind === 'ground' || c.kind === 'ship') {
      // Surface targets carry a base line under the symbol.
      const b = y + Math.round(13 * S);
      ctx.moveTo(x - 7 * S, b);
      ctx.lineTo(x + 7 * S, b);
    }
  }
  if (count > 0) p.stroke(groupColor(dc, g), lw);
  return count;
}

/** Half-size of a contact's symbol footprint, device px (surface targets include their base line). */
function symbolRadius(dc: DrawContext, c: HudContact): number {
  const S = dc.L.S;
  if (c.kind === 'checkpoint') return checkpointRadius(dc, c);
  if (c.kind === 'ground' || c.kind === 'ship') return 14 * S;
  const g = groupOf(c);
  return (g === GROUP_FRIEND ? (c.selected ? 10 : 8) : c.selected ? 11 : 9) * S;
}

function rangeText(dc: DrawContext, c: HudContact): string {
  return dc.s.range.get(rangeKey(distanceIn(fin(c.distance), dc.state.units)));
}

/** Geometry shared by layout and drawing of the selected target block, device px. */
function selectedHalf(dc: DrawContext, c: HudContact): number {
  return groupOf(c) === GROUP_CHECKPOINT ? checkpointRadius(dc, c) + 6 * dc.L.S : Math.round(20 * dc.L.S);
}

function selectedClear(dc: DrawContext, c: HudContact): number {
  const lock = Math.min(1, Math.max(0, fin(c.lock)));
  const half = selectedHalf(dc, c);
  return lock > 0 && lock < 1 ? Math.max(half, 34 * dc.L.S) : half;
}

/** Selected target text block: callsign, range and closure lines (layout units). */
const INFO_H = 52;
const INFO_LINE_1 = 9;
const INFO_LINE_2 = 27;
const INFO_LINE_3 = 43;

/** Width of the selected target's range/closure block, device px. */
function infoWidth(dc: DrawContext, c: HudContact): number {
  const { p, f, s } = dc;
  const units = dc.state.units;
  const adv = p.measure('0', f.monoS);
  const range = rangeText(dc, c).length * adv + 4 * dc.L.S + p.measure(distanceUnitLabel(units), f.labelS);
  const cl = s.signed.get(Math.round(closureIn(fin(c.closure), units))).length * adv;
  return Math.max(range, cl + 4 * dc.L.S + p.measure(speedUnitLabel(units), f.labelS));
}

/**
 * Places the selected target's callsign/range/closure block at the first spot free of other symbols;
 * if none is free it keeps the default spot (the selected target always shows its data).
 */
function placeSelected(dc: DrawContext, c: HudContact, x: number, y: number): void {
  const { p, L, f } = dc;
  const lab = dc.labels;
  const S = L.S;
  const half = selectedHalf(dc, c);
  const clear = selectedClear(dc, c);
  // Health bar and cue under the brackets are fixed.
  addBox(lab.boxes, x - 26 * S, y + half + 4 * S, x + 26 * S, y + half + 32 * S);
  // One block beside the brackets (right, else left, below, above) so the callsign can never be read
  // as belonging to a neighbouring contact.
  const iw = Math.max(infoWidth(dc, c), p.measure(c.label, f.labelM));
  const ih = INFO_H * S;
  if (placeLabel(lab.boxes, x, y, clear, iw, ih, 8 * S, 0, 0, L.W, L.H, lab.spot, ORDER_INFO) < 0) {
    candidateSpot(ORDER_INFO[0]!, x, y, clear, iw, ih, 8 * S, lab.spot);
    addBox(lab.boxes, lab.spot.x, lab.spot.y, lab.spot.x + iw, lab.spot.y + ih);
  }
  lab.infoX = lab.spot.x;
  lab.infoY = lab.spot.y;
}

/** Decides which contacts get which label and where, before anything is drawn. */
function layoutLabels(dc: DrawContext): void {
  const { p, L, f } = dc;
  const cs = dc.state.contacts;
  const lab = dc.labels;
  const S = L.S;
  const dpr = L.dpr;
  const n = Math.min(cs.length, MAX_LABELED);
  lab.boxes.count = 0;
  lab.sel = -1;
  // Every on-screen symbol is an obstacle (the selected one with its brackets / lock ring).
  for (let i = 0; i < n; i++) {
    const c = cs[i]!;
    lab.tier[i] = -1;
    if (!isShown(c)) {
      lab.keys[i] = Infinity;
      continue;
    }
    const x = c.screen.x * dpr;
    const y = c.screen.y * dpr;
    const r = c.selected ? selectedClear(dc, c) : symbolRadius(dc, c);
    addBox(lab.boxes, x - r, y - r, x + r, y + r);
    if (c.selected && lab.sel < 0) lab.sel = i;
    lab.keys[i] = c.selected ? Infinity : fin(c.distance, 1e9);
  }
  // The selected target's text is placed first, so it wins every contest.
  if (lab.sel >= 0) {
    const c = cs[lab.sel]!;
    placeSelected(dc, c, c.screen.x * dpr, c.screen.y * dpr);
  }
  sortIndices(lab.keys, n, lab.order);
  const h = Math.round(16 * S);
  const gap = 3 * S;
  const adv = p.measure('0', f.monoS);
  let rank = 0;
  for (let k = 0; k < n; k++) {
    const i = lab.order[k]!;
    if (!(lab.keys[i]! < Infinity)) break;
    const c = cs[i]!;
    const x = c.screen.x * dpr;
    const y = c.screen.y * dpr;
    const r = symbolRadius(dc, c);
    const rangeW = rangeText(dc, c).length * adv;
    let placed = -1;
    if (rank < FULL_LABELS && c.label.length > 0) {
      const w = p.measure(c.label, f.labelS) + 5 * S + rangeW;
      placed = placeLabel(lab.boxes, x, y, r, w, h, gap, 0, 0, L.W, L.H, lab.spot);
      if (placed >= 0) lab.tier[i] = 1;
    }
    if (placed < 0) {
      placed = placeLabel(lab.boxes, x, y, r, rangeW, h, gap, 0, 0, L.W, L.H, lab.spot);
      if (placed >= 0) lab.tier[i] = 0;
    }
    if (placed >= 0) {
      lab.lx[i] = lab.spot.x;
      lab.ly[i] = lab.spot.y + h / 2;
    }
    rank++;
  }
}

/** Labels of one group as placed by layoutLabels: callsigns first, then ranges (two font switches). */
function drawGroupLabels(dc: DrawContext, g: number): void {
  const { p, L, f } = dc;
  const cs = dc.state.contacts;
  const lab = dc.labels;
  const n = Math.min(cs.length, MAX_LABELED);
  const color = groupColor(dc, g);
  p.textStyle(f.labelS, color, 'left');
  for (let i = 0; i < n; i++) {
    if (lab.tier[i] !== 1 || groupOf(cs[i]!) !== g) continue;
    p.text(cs[i]!.label, lab.lx[i]!, lab.ly[i]!);
  }
  p.textStyle(f.monoS, color, 'left');
  for (let i = 0; i < n; i++) {
    const t = lab.tier[i]!;
    if (t < 0 || groupOf(cs[i]!) !== g) continue;
    const c = cs[i]!;
    const x = t === 1 ? lab.lx[i]! + p.measure(c.label, f.labelS) + 5 * L.S : lab.lx[i]!;
    p.text(rangeText(dc, c), x, lab.ly[i]!);
  }
}

function drawSelected(dc: DrawContext, c: HudContact): void {
  const { ctx, p, L, pal, f, s } = dc;
  const st = dc.state;
  const S = L.S;
  const dpr = L.dpr;
  const lw = L.line;
  const g = groupOf(c);
  const color = groupColor(dc, g);
  const x = p.snap(c.screen.x * dpr, lw);
  const y = p.snap(c.screen.y * dpr, lw);
  const half = selectedHalf(dc, c);
  const arm = Math.round(7 * S);

  const lock = Math.min(1, Math.max(0, fin(c.lock)));
  // Corner brackets (replaced by the heavy lock diamond once locked).
  ctx.beginPath();
  for (let sx = -1; sx <= 1 && lock < 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      const cx = x + sx * half;
      const cy = y + sy * half;
      ctx.moveTo(cx - sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy - sy * arm);
    }
  }
  if (lock < 1) p.stroke(pal.primary, lw);

  // Lock: a ring that closes and tightens with progress, then a heavy lock diamond.
  if (lock >= 1) {
    // Heavy lock symbol in the contact's own shape and color: diamond for hostiles, circle for friendlies.
    const r = Math.round(18 * S);
    ctx.beginPath();
    if (g === GROUP_FRIEND) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    } else {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    }
    p.stroke(color, L.bold);
  } else if (lock > 0) {
    const r = (34 - 16 * lock) * S;
    ctx.beginPath();
    const a0 = -Math.PI / 2;
    ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.arc(x, y, r, a0, a0 + lock * TAU);
    p.stroke(pal.primary, lw);
  }

  // Health bar under the brackets.
  const hbW = Math.round(40 * S);
  const hbH = Math.max(3, Math.round(4 * S));
  const hbX = Math.round(x - hbW / 2);
  const hbY = Math.round(y + half + 8 * S);
  if (g !== GROUP_CHECKPOINT) {
    const hp = Math.min(1, Math.max(0, fin(c.health)));
    ctx.beginPath();
    ctx.rect(hbX + 0.5, hbY + 0.5, hbW - 1, hbH - 1);
    p.stroke(pal.dim, 1);
    if (hp > 0) {
      ctx.beginPath();
      ctx.rect(hbX, hbY, Math.max(1, Math.round(hbW * hp)), hbH);
      p.fill(color);
    }
  }

  // Callsign and range/closure at the spots chosen by the declutter pass; cue below.
  const lab = dc.labels;
  const tx = lab.infoX;
  p.textStyle(f.labelM, color, 'left');
  p.text(c.label, tx, lab.infoY + INFO_LINE_1 * S);
  const units = st.units;
  const r1 = lab.infoY + INFO_LINE_2 * S;
  const r2 = lab.infoY + INFO_LINE_3 * S;
  p.textStyle(f.monoS, color, 'left');
  const rangeStr = rangeText(dc, c);
  p.text(rangeStr, tx, r1);
  const closureStr = s.signed.get(Math.round(closureIn(fin(c.closure), units)));
  p.text(closureStr, tx, r2);
  const adv = p.measure('0', f.monoS);
  p.textStyle(f.labelS, pal.dim, 'left');
  p.text(distanceUnitLabel(units), tx + rangeStr.length * adv + 4 * S, r1);
  p.text(speedUnitLabel(units), tx + closureStr.length * adv + 4 * S, r2);

  const cueY = hbY + hbH + 11 * S;
  if (c.inRange) {
    p.textStyle(f.labelM, pal.primary, 'center');
    p.text(lock >= 1 ? 'SHOOT' : 'IN RANGE', x, cueY);
  } else if (lock >= 1) {
    p.textStyle(f.labelS, pal.primary, 'center');
    p.text('LOCK', x, cueY);
  }
}

/**
 * Off-screen arrows ride an ellipse near the safe-area edge, pulled in far enough to pass inside the
 * corner panels (stores, radar, RWR, feeds) and lifted slightly so the bottom clears the subtitles.
 */
const ARROW_DY = -12;
function arrowA(L: DrawContext['L']): number {
  return L.safeW / 2 - 112 * L.S;
}
function arrowB(L: DrawContext['L']): number {
  return L.safeH / 2 - 92 * L.S;
}

/** Off-screen arrows for one group along an ellipse inside the safe area. */
function drawGroupArrows(dc: DrawContext, g: number): void {
  const { ctx, p, L, v2 } = dc;
  const cs = dc.state.contacts;
  const S = L.S;
  const a = arrowA(L);
  const b = arrowB(L);
  let count = 0;
  ctx.beginPath();
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (isShown(c) || groupOf(c) !== g) continue;
    const ang = fin(c.offscreenAngle);
    ellipseEdge(ang, a, b, v2);
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const size = (c.selected ? 13 : 9) * S;
    const ex = L.cx + v2.x;
    const ey = L.cy + ARROW_DY * S + v2.y;
    const bx = ex - dx * size * 0.7;
    const by = ey - dy * size * 0.7;
    ctx.moveTo(ex + dx * size, ey + dy * size);
    ctx.lineTo(bx - dy * size * 0.75, by + dx * size * 0.75);
    if (g === GROUP_FRIEND || g === GROUP_CHECKPOINT) ctx.lineTo(ex - dx * size * 0.2, ey - dy * size * 0.2);
    ctx.lineTo(bx + dy * size * 0.75, by - dx * size * 0.75);
    ctx.closePath();
    count++;
  }
  if (count === 0) return;
  if (g === GROUP_FOE) p.fill(dc.pal.foe);
  else p.stroke(groupColor(dc, g), L.line);
}

function drawSelectedArrowLabel(dc: DrawContext, c: HudContact): void {
  const { p, L, f, s, v2 } = dc;
  const S = L.S;
  const ang = fin(c.offscreenAngle);
  ellipseEdge(ang, arrowA(L), arrowB(L), v2);
  const x = L.cx + v2.x - Math.sin(ang) * 30 * S;
  const y = L.cy + ARROW_DY * S + v2.y + Math.cos(ang) * 30 * S;
  p.textStyle(f.monoS, groupColor(dc, groupOf(c)), 'center');
  p.text(s.range.get(rangeKey(distanceIn(fin(c.distance), dc.state.units))), x, y);
}

export function drawContacts(dc: DrawContext): void {
  const cs = dc.state.contacts;
  if (cs.length === 0) return;
  layoutLabels(dc);
  for (let g = 0; g <= 2; g++) {
    if (drawGroupSymbols(dc, g) > 0) drawGroupLabels(dc, g);
    drawGroupArrows(dc, g);
  }
  const sel = dc.labels.sel;
  if (sel >= 0) drawSelected(dc, cs[sel]!);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (c.selected && !isShown(c)) drawSelectedArrowLabel(dc, c);
  }
}

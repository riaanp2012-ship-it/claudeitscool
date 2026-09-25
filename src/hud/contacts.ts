import type { HudContact, Team } from '../core/types';
import type { DrawContext } from './context';
import { ellipseEdge } from './edge';
import { closureIn, distanceIn, distanceUnitLabel, rangeKey, speedUnitLabel } from './format';

/**
 * Contact symbology. Shape carries identity (never color alone, spec §8.2): friendlies are circles,
 * hostiles are diamonds, checkpoints are rings. The selected target gets corner brackets, callsign,
 * range, closure, health and the lock ring that closes into a heavy lock diamond.
 */

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

/** Range readouts under the non-selected symbols of a group. */
function drawGroupRanges(dc: DrawContext, g: number): void {
  const { p, L, f, s } = dc;
  const cs = dc.state.contacts;
  const units = dc.state.units;
  const S = L.S;
  const dpr = L.dpr;
  p.textStyle(f.monoS, groupColor(dc, g), 'center');
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (c.selected || !isShown(c) || groupOf(c) !== g) continue;
    const x = c.screen.x * dpr;
    let y = c.screen.y * dpr;
    y +=
      g === GROUP_CHECKPOINT
        ? checkpointRadius(dc, c) + 12 * S
        : c.kind === 'ground' || c.kind === 'ship'
          ? 25 * S
          : 20 * S;
    p.text(s.range.get(rangeKey(distanceIn(fin(c.distance), units))), x, y);
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
  const half = g === GROUP_CHECKPOINT ? checkpointRadius(dc, c) + 6 * S : Math.round(20 * S);
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

  // Label above, range and closure to the right, cue below.
  // Text clears both the brackets and the widest lock ring (34 units at the start of a lock).
  const clear = lock > 0 && lock < 1 ? Math.max(half, 34 * S) : half;
  const tx = x + clear + 8 * S;
  p.textStyle(f.labelM, color, 'center');
  p.text(c.label, x, y - clear - 12 * S);
  const units = st.units;
  p.textStyle(f.monoS, color, 'left');
  const rangeStr = s.range.get(rangeKey(distanceIn(fin(c.distance), units)));
  p.text(rangeStr, tx, y - 7 * S);
  const closure = Math.round(closureIn(fin(c.closure), units));
  const closureStr = s.signed.get(closure);
  p.text(closureStr, tx, y + 9 * S);
  const adv = p.measure('0', f.monoS);
  p.textStyle(f.labelS, pal.dim, 'left');
  p.text(distanceUnitLabel(units), tx + rangeStr.length * adv + 4 * S, y - 7 * S);
  p.text(speedUnitLabel(units), tx + closureStr.length * adv + 4 * S, y + 9 * S);

  const cueY = hbY + hbH + 11 * S;
  if (c.inRange) {
    p.textStyle(f.labelM, pal.primary, 'center');
    p.text(lock >= 1 ? 'SHOOT' : 'IN RANGE', x, cueY);
  } else if (lock >= 1) {
    p.textStyle(f.labelS, pal.primary, 'center');
    p.text('LOCK', x, cueY);
  }
}

/** Off-screen arrows for one group along an ellipse inside the safe area. */
function drawGroupArrows(dc: DrawContext, g: number): void {
  const { ctx, p, L, v2 } = dc;
  const cs = dc.state.contacts;
  const S = L.S;
  const a = L.safeW / 2 - 76 * S;
  const b = L.safeH / 2 - 70 * S;
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
    const ey = L.cy + v2.y;
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
  ellipseEdge(ang, L.safeW / 2 - 76 * S, L.safeH / 2 - 70 * S, v2);
  const x = L.cx + v2.x - Math.sin(ang) * 30 * S;
  const y = L.cy + v2.y + Math.cos(ang) * 30 * S;
  p.textStyle(f.monoS, groupColor(dc, groupOf(c)), 'center');
  p.text(s.range.get(rangeKey(distanceIn(fin(c.distance), dc.state.units))), x, y);
}

export function drawContacts(dc: DrawContext): void {
  const cs = dc.state.contacts;
  if (cs.length === 0) return;
  for (let g = 0; g <= 2; g++) {
    if (drawGroupSymbols(dc, g) > 0) drawGroupRanges(dc, g);
    drawGroupArrows(dc, g);
  }
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (!c.selected) continue;
    if (isShown(c)) drawSelected(dc, c);
    else drawSelectedArrowLabel(dc, c);
  }
}

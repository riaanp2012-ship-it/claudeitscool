import type { HudRadarBlip } from '../core/types';
import { PLAYER_TEAM } from './contacts';
import type { DrawContext } from './context';
import { distanceIn, distanceUnitLabel, radarRangeKey } from './format';
import { damageBand } from './palette';
import {
  BLIP_ARROW,
  BLIP_SHIP,
  JET_CANOPY,
  JET_ENGINE,
  JET_HULL,
  JET_TAIL_L,
  JET_TAIL_R,
  JET_WING_L,
  JET_WING_R,
  OWNSHIP,
  tracePolygon,
  traceRotated,
} from './shapes';
import { flashAlpha } from './warnings';

/**
 * Situational awareness: RWR scope, heading-up radar minimap, incoming-missile arrows around the
 * center and the own-jet damage diagram.
 */

const TAU = Math.PI * 2;
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

/** Scope radii in layout units. */
export const RWR_RADIUS = 54;
export const RADAR_RADIUS = 74;

function scopeFrame(dc: DrawContext, x: number, y: number, r: number): void {
  const { ctx, p, L, pal } = dc;
  // Faint backing disc so symbols read over snow and bright cloud (ZD-J08).
  ctx.beginPath();
  ctx.arc(x, y, r + 5 * L.S, 0, TAU);
  ctx.fillStyle = pal.scopeBacking;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
  p.stroke(pal.dim, L.thin);
  ctx.beginPath();
  ctx.moveTo(x + r * 0.5, y);
  ctx.arc(x, y, r * 0.5, 0, TAU);
  ctx.setLineDash(dc.dashFine);
  p.stroke(pal.faint, L.thin);
  ctx.setLineDash(dc.noDash);
}

function ownship(dc: DrawContext, x: number, y: number): void {
  const { ctx, p, L, pal } = dc;
  ctx.beginPath();
  tracePolygon(ctx, OWNSHIP, x, y, L.S);
  p.stroke(pal.primary, L.thin);
}

export function drawRwr(dc: DrawContext, x: number, y: number): void {
  const { ctx, p, L, pal, f } = dc;
  const S = L.S;
  const r = RWR_RADIUS * S;
  scopeFrame(dc, x, y, r);

  // Clock ticks every 30°.
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    const sx = Math.sin(a);
    const sy = -Math.cos(a);
    const t = i % 3 === 0 ? 7 * S : 4 * S;
    ctx.moveTo(x + sx * r, y + sy * r);
    ctx.lineTo(x + sx * (r - t), y + sy * (r - t));
  }
  p.stroke(pal.dim, L.thin);
  ownship(dc, x, y);

  p.textStyle(f.labelS, pal.dim, 'left');
  p.text('RWR', x - r, y - r - 12 * S);

  const threats = dc.state.threats;
  if (threats.length === 0) return;
  // Search radars: open circles on the outer band.
  ctx.beginPath();
  let n = 0;
  for (let i = 0; i < threats.length; i++) {
    const t = threats[i]!;
    if (t.kind !== 'search') continue;
    const b = fin(t.bearing);
    const tx = x + Math.sin(b) * r * 0.8;
    const ty = y - Math.cos(b) * r * 0.8;
    const rr = 3.5 * S;
    ctx.moveTo(tx + rr, ty);
    ctx.arc(tx, ty, rr, 0, TAU);
    n++;
  }
  if (n > 0) p.stroke(pal.primary, L.thin);
  // Locks (spikes): diamonds on the middle band.
  ctx.beginPath();
  n = 0;
  for (let i = 0; i < threats.length; i++) {
    const t = threats[i]!;
    if (t.kind !== 'lock') continue;
    const b = fin(t.bearing);
    const tx = x + Math.sin(b) * r * 0.58;
    const ty = y - Math.cos(b) * r * 0.58;
    const d = 6 * S;
    ctx.moveTo(tx, ty - d);
    ctx.lineTo(tx + d, ty);
    ctx.lineTo(tx, ty + d);
    ctx.lineTo(tx - d, ty);
    ctx.closePath();
    n++;
  }
  if (n > 0) p.stroke(pal.warn, L.line);
  // Missiles: filled arrowheads pointing at the center, inner band, flashing with the warning.
  ctx.beginPath();
  n = 0;
  for (let i = 0; i < threats.length; i++) {
    const t = threats[i]!;
    if (t.kind !== 'missile') continue;
    const b = fin(t.bearing);
    const sx = Math.sin(b);
    const sy = -Math.cos(b);
    const tx = x + sx * r * 0.3;
    const ty = y + sy * r * 0.3;
    const a = 7 * S;
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + sx * a * 1.6 - sy * a * 0.7, ty + sy * a * 1.6 + sx * a * 0.7);
    ctx.lineTo(tx + sx * a * 1.6 + sy * a * 0.7, ty + sy * a * 1.6 - sx * a * 0.7);
    ctx.closePath();
    n++;
  }
  if (n > 0) {
    ctx.globalAlpha = flashAlpha(dc.time);
    p.fill(pal.critical);
    ctx.globalAlpha = 1;
  }
}

/** Incoming-missile arrows on a ring around the view center, pointing toward each missile. */
export function drawMissileArrows(dc: DrawContext): void {
  const { ctx, p, L, pal, cl } = dc;
  const threats = dc.state.threats;
  const S = L.S;
  const R = 96 * S;
  let n = 0;
  ctx.beginPath();
  for (let i = 0; i < threats.length; i++) {
    const t = threats[i]!;
    if (t.kind !== 'missile') continue;
    const b = fin(t.bearing);
    const sx = Math.sin(b);
    const sy = -Math.cos(b);
    const bx = cl.cx + sx * R;
    const by = cl.cy + sy * R;
    const len = 18 * S;
    const w = 11 * S;
    ctx.moveTo(bx + sx * len, by + sy * len);
    ctx.lineTo(bx - sy * w, by + sx * w);
    ctx.lineTo(bx + sx * len * 0.35, by + sy * len * 0.35);
    ctx.lineTo(bx + sy * w, by - sx * w);
    ctx.closePath();
    n++;
  }
  if (n === 0) return;
  ctx.globalAlpha = flashAlpha(dc.time);
  p.fill(pal.critical);
  ctx.globalAlpha = 1;
}

function blipVisible(b: HudRadarBlip): boolean {
  return Number.isFinite(b.x) && Number.isFinite(b.y);
}

/** Scope position of a blip; returns false when it is outside the range and should not be drawn. */
function blipPos(
  dc: DrawContext,
  b: HudRadarBlip,
  cx: number,
  cy: number,
  r: number,
  range: number,
): boolean {
  let nx = b.x / range;
  let ny = b.y / range;
  const d = Math.sqrt(nx * nx + ny * ny);
  if (d > 1) {
    if (!(b.selected || b.kind === 'objective' || b.kind === 'checkpoint')) return false;
    nx = (nx / d) * 0.96;
    ny = (ny / d) * 0.96;
  }
  dc.v2.x = cx + nx * r;
  dc.v2.y = cy - ny * r;
  return true;
}

export function drawRadar(dc: DrawContext, x: number, y: number): void {
  const { ctx, p, L, pal, f, s, v2 } = dc;
  const st = dc.state;
  const S = L.S;
  const r = RADAR_RADIUS * S;
  const range = Math.max(100, fin(st.radar.range, 10000));
  scopeFrame(dc, x, y, r);

  // Compass rim rotating with heading (heading-up display): ticks every 30°, 'N' on north.
  const hdg = fin(st.aircraft.heading);
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12 - hdg;
    const sx = Math.sin(a);
    const sy = -Math.cos(a);
    const t = i % 3 === 0 ? 7 * S : 4 * S;
    ctx.moveTo(x + sx * r, y + sy * r);
    ctx.lineTo(x + sx * (r - t), y + sy * (r - t));
  }
  p.stroke(pal.dim, L.thin);
  p.textStyle(f.labelS, pal.primary, 'center');
  p.text('N', x + Math.sin(-hdg) * (r - 15 * S), y - Math.cos(-hdg) * (r - 15 * S));
  ownship(dc, x, y);

  // Range readout in the free corner of the bounding box.
  p.textStyle(f.monoS, pal.dim, 'left');
  const rk = radarRangeKey(distanceIn(range, st.units));
  const rs = s.radarRange.get(rk);
  const rx = x - r - 2 * S;
  const ry = y - r - 12 * S;
  p.text(rs, rx, ry);
  p.textStyle(f.labelS, pal.dim, 'left');
  p.text(distanceUnitLabel(st.units), rx + rs.length * p.measure('0', f.monoS) + 4 * S, ry);

  const blips = st.radar.blips;
  if (blips.length === 0) return;

  // Hostiles: filled. Aircraft are heading arrows, ground a square, ships a hull.
  ctx.beginPath();
  let n = 0;
  for (let i = 0; i < blips.length; i++) {
    const b = blips[i]!;
    if (b.team === PLAYER_TEAM || b.kind === 'missile' || b.kind === 'checkpoint' || b.kind === 'objective')
      continue;
    if (!blipVisible(b) || !blipPos(dc, b, x, y, r, range)) continue;
    traceBlip(dc, b, v2.x, v2.y);
    n++;
  }
  if (n > 0) p.fill(pal.foe);
  // Friendlies: outlined, round ground marker.
  ctx.beginPath();
  n = 0;
  for (let i = 0; i < blips.length; i++) {
    const b = blips[i]!;
    if (b.team !== PLAYER_TEAM || b.kind === 'missile' || b.kind === 'checkpoint' || b.kind === 'objective')
      continue;
    if (!blipVisible(b) || !blipPos(dc, b, x, y, r, range)) continue;
    traceBlip(dc, b, v2.x, v2.y);
    n++;
  }
  if (n > 0) p.stroke(pal.friend, L.thin);
  // Checkpoints and objectives (neutral): rings, objectives with a center dot.
  ctx.beginPath();
  n = 0;
  for (let i = 0; i < blips.length; i++) {
    const b = blips[i]!;
    if (b.kind !== 'checkpoint' && b.kind !== 'objective') continue;
    if (!blipVisible(b) || !blipPos(dc, b, x, y, r, range)) continue;
    const rr = (b.kind === 'objective' ? 5 : 4) * S;
    ctx.moveTo(v2.x + rr, v2.y);
    ctx.arc(v2.x, v2.y, rr, 0, TAU);
    if (b.kind === 'objective') {
      ctx.moveTo(v2.x + 1.2 * S, v2.y);
      ctx.arc(v2.x, v2.y, 1.2 * S, 0, TAU);
    }
    n++;
  }
  if (n > 0) p.stroke(pal.primary, L.thin);
  // Missiles: a dot with a short heading tail; hostile ones in the warning color.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    n = 0;
    for (let i = 0; i < blips.length; i++) {
      const b = blips[i]!;
      if (b.kind !== 'missile' || (b.team === PLAYER_TEAM) !== (pass === 1)) continue;
      if (!blipVisible(b) || !blipPos(dc, b, x, y, r, range)) continue;
      const h = fin(b.heading);
      const rr = 2 * S;
      ctx.moveTo(v2.x + rr, v2.y);
      ctx.arc(v2.x, v2.y, rr, 0, TAU);
      ctx.moveTo(v2.x, v2.y);
      ctx.lineTo(v2.x - Math.sin(h) * 7 * S, v2.y + Math.cos(h) * 7 * S);
      n++;
    }
    if (n > 0) p.stroke(pass === 0 ? pal.critical : pal.dim, L.thin);
  }
  // Selected: small corner brackets.
  for (let i = 0; i < blips.length; i++) {
    const b = blips[i]!;
    if (!b.selected || !blipVisible(b) || !blipPos(dc, b, x, y, r, range)) continue;
    const h = 8 * S;
    const a = 3 * S;
    ctx.beginPath();
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        const cx = v2.x + sx * h;
        const cy = v2.y + sy * h;
        ctx.moveTo(cx - sx * a, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy - sy * a);
      }
    }
    p.stroke(pal.primary, L.thin);
  }
}

function traceBlip(dc: DrawContext, b: HudRadarBlip, x: number, y: number): void {
  const ctx = dc.ctx;
  const S = dc.L.S;
  if (b.kind === 'aircraft') {
    traceRotated(ctx, BLIP_ARROW, x, y, S, fin(b.heading));
  } else if (b.kind === 'ship') {
    traceRotated(ctx, BLIP_SHIP, x, y, S, fin(b.heading));
  } else if (b.team === PLAYER_TEAM) {
    const r = 3.5 * S;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  } else {
    const h = 3.5 * S;
    ctx.rect(x - h, y - h, h * 2, h * 2);
  }
}

/** Top-view silhouette of the player's jet, each part filled by its damage band. */
export function drawDamage(dc: DrawContext, x: number, y: number): void {
  const { ctx, p, L, pal, f, s } = dc;
  const dmg = dc.state.aircraft.damage;
  const S = L.S;
  const bands = pal.damage;

  fillPart(dc, JET_HULL, x, y, damageBand(fin(dmg.hull)), bands);
  fillPart(dc, JET_WING_L, x, y, damageBand(fin(dmg.wingL)), bands);
  fillPart(dc, JET_WING_R, x, y, damageBand(fin(dmg.wingR)), bands);
  const tail = damageBand(fin(dmg.tail));
  fillPart(dc, JET_TAIL_L, x, y, tail, bands);
  fillPart(dc, JET_TAIL_R, x, y, tail, bands);
  fillPart(dc, JET_ENGINE, x, y, damageBand(fin(dmg.engine)), bands);

  ctx.beginPath();
  tracePolygon(ctx, JET_WING_L, x, y, S);
  tracePolygon(ctx, JET_WING_R, x, y, S);
  tracePolygon(ctx, JET_TAIL_L, x, y, S);
  tracePolygon(ctx, JET_TAIL_R, x, y, S);
  tracePolygon(ctx, JET_ENGINE, x, y, S);
  tracePolygon(ctx, JET_HULL, x, y, S);
  tracePolygon(ctx, JET_CANOPY, x, y, S);
  p.stroke(pal.dim, L.thin);

  // Airframe integrity beside the silhouette.
  const tx = x + 32 * S;
  p.textStyle(f.labelS, pal.dim, 'left');
  p.text('HULL', tx, y + 8 * S);
  const integrity = Math.round((1 - Math.min(1, Math.max(0, fin(dmg.hull)))) * 100);
  p.textStyle(f.monoS, integrity < 35 ? pal.warn : pal.primary, 'left');
  p.text(s.percent.get(integrity), tx, y + 23 * S);
}

function fillPart(
  dc: DrawContext,
  pts: Float32Array,
  x: number,
  y: number,
  band: number,
  bands: readonly [string, string, string, string],
): void {
  if (band < 0) return;
  const ctx = dc.ctx;
  ctx.beginPath();
  tracePolygon(ctx, pts, x, y, dc.L.S);
  ctx.fillStyle = bands[band]!;
  ctx.fill();
}

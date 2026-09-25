import { RAD } from '../core/math';
import type { DrawContext } from './context';
import { altitudeIn, drumSplit, headingDegrees, speedIn, verticalSpeedIn } from './format';
import type { FontRole } from './painter';
import { ladderRungs, tapeTicks, type TapeScale } from './tape';

/**
 * Flight instruments: conformal pitch ladder, flight path marker, gun cross, mouse-aim reticle,
 * airspeed/altitude tapes with rolling digits, heading tape and the numeric readouts.
 * All coordinates are device px; `S` converts layout units.
 */

const TAU = Math.PI * 2;

export const SPEED_IMPERIAL: TapeScale = { minor: 10, major: 50, unitsPerValue: 1.2 };
export const SPEED_METRIC: TapeScale = { minor: 20, major: 100, unitsPerValue: 0.6 };
export const ALT_IMPERIAL: TapeScale = { minor: 100, major: 500, unitsPerValue: 0.12 };
export const ALT_METRIC: TapeScale = { minor: 20, major: 100, unitsPerValue: 0.6 };
export const HEADING_SCALE: TapeScale = { minor: 5, major: 10, unitsPerValue: 5 };

/** Tape value box geometry, layout units. */
const BOX_HALF = 16;
const SPEED_BOX_W = 76;
const ALT_BOX_W = 104;

/** Radar altitude is shown below this height AGL (m), like a real radar altimeter's range. */
const RADAR_ALT_MAX = 1500;

const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

// ───────────────────────────────────────────────────────────── pitch ladder

export function drawLadder(dc: DrawContext): void {
  const { ctx, p, L, pal, f, s, cl, rungs } = dc;
  const cam = dc.state.camera;
  const dpr = L.dpr;
  const S = L.S;
  const k = fin(cam.pxPerRad) * dpr;
  if (!(k > 1)) return;
  const roll = fin(cam.roll);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const ox = Math.round(fin(cam.center.x, L.cssW / 2) * dpr);
  const oy = Math.round(fin(cam.center.y, L.cssH / 2) * dpr);

  // Slide the ladder along its rungs to stay centered on the flight path marker (as real HUDs do);
  // sliding along a rung keeps it conformal.
  let lx = 0;
  const fpm = dc.state.flightPath;
  if (fpm.visible) {
    const dx = fpm.x * dpr - ox;
    const dy = fpm.y * dpr - oy;
    lx = dx * cr - dy * sr;
    const lim = 70 * S;
    lx = Math.round(lx < -lim ? -lim : lx > lim ? lim : lx);
  }

  // Extent of the clip rectangle along the rolled "up" axis bounds which rungs can be visible.
  const hw = cl.ladderW / 2;
  const hh = cl.ladderH / 2;
  const ccx = cl.ladderX + hw - ox;
  const ccy = cl.ladderY + hh - oy;
  const along = Math.abs(ccx * sr + ccy * cr);
  const halfWindow = hh * Math.abs(cr) + hw * Math.abs(sr) + along + 12 * S;
  const n = ladderRungs(fin(cam.pitch), k, halfWindow, 5, rungs);
  if (n === 0) return;

  const lw = L.line;
  const gap = Math.round(40 * S);
  const long = Math.round(62 * S);
  const short = Math.round(34 * S);
  const tick = Math.round(8 * S);
  const horizonHalf = Math.round(260 * S);

  ctx.save();
  ctx.beginPath();
  ctx.rect(cl.ladderX, cl.ladderY, cl.ladderW, cl.ladderH);
  ctx.clip();

  // Solid: horizon and rungs above it.
  ctx.setTransform(1, 0, 0, 1, ox, oy);
  ctx.rotate(-roll);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const deg = rungs.deg[i]!;
    if (deg < 0) continue;
    const y = p.snap(-rungs.offset[i]!, lw);
    if (deg === 0) {
      ctx.moveTo(lx - horizonHalf, y);
      ctx.lineTo(lx - gap, y);
      ctx.moveTo(lx + gap, y);
      ctx.lineTo(lx + horizonHalf, y);
      continue;
    }
    if (deg === 90) {
      const r = 10 * S;
      ctx.moveTo(lx + r, y);
      ctx.arc(lx, y, r, 0, TAU);
      continue;
    }
    const len = deg % 10 === 0 ? long : short;
    const x0 = p.snap(lx - gap, lw);
    const x1 = p.snap(lx + gap, lw);
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 - len, y);
    ctx.lineTo(x0 - len, y + tick);
    ctx.moveTo(x1, y);
    ctx.lineTo(x1 + len, y);
    ctx.lineTo(x1 + len, y + tick);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  p.stroke(pal.primary, lw);

  // Dashed: rungs below the horizon, ticks pointing up toward it.
  ctx.setTransform(1, 0, 0, 1, ox, oy);
  ctx.rotate(-roll);
  ctx.beginPath();
  let dashed = 0;
  for (let i = 0; i < n; i++) {
    const deg = rungs.deg[i]!;
    if (deg >= 0) continue;
    dashed++;
    const y = p.snap(-rungs.offset[i]!, lw);
    if (deg === -90) {
      const r = 10 * S;
      ctx.moveTo(lx + r, y);
      ctx.arc(lx, y, r, 0, TAU);
      ctx.moveTo(lx - r * 0.7, y - r * 0.7);
      ctx.lineTo(lx + r * 0.7, y + r * 0.7);
      ctx.moveTo(lx + r * 0.7, y - r * 0.7);
      ctx.lineTo(lx - r * 0.7, y + r * 0.7);
      continue;
    }
    const len = deg % 10 === 0 ? long : short;
    const x0 = p.snap(lx - gap, lw);
    const x1 = p.snap(lx + gap, lw);
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 - len, y);
    ctx.lineTo(x0 - len, y - tick);
    ctx.moveTo(x1, y);
    ctx.lineTo(x1 + len, y);
    ctx.lineTo(x1 + len, y - tick);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (dashed > 0) {
    ctx.setLineDash(dc.dashLadder);
    p.stroke(pal.primary, lw);
    ctx.setLineDash(dc.noDash);
  }

  // Numbers on the 10° rungs, both ends, rotating with the ladder.
  ctx.setTransform(1, 0, 0, 1, ox, oy);
  ctx.rotate(-roll);
  const nx = gap + long + 6 * S;
  p.textStyle(f.monoS, pal.primary, 'right');
  for (let i = 0; i < n; i++) {
    const deg = rungs.deg[i]!;
    if (deg === 0 || deg % 10 !== 0 || deg === 90 || deg === -90) continue;
    const y = -rungs.offset[i]! + (deg > 0 ? tick * 0.5 : -tick * 0.5);
    p.text(s.ladder[(deg + 90) / 5]!, lx - nx, y);
  }
  p.setAlign('left');
  for (let i = 0; i < n; i++) {
    const deg = rungs.deg[i]!;
    if (deg === 0 || deg % 10 !== 0 || deg === 90 || deg === -90) continue;
    const y = -rungs.offset[i]! + (deg > 0 ? tick * 0.5 : -tick * 0.5);
    p.text(s.ladder[(deg + 90) / 5]!, lx + nx, y);
  }
  p.restore();
}

// ───────────────────────────────────────────────────────────── markers

export function drawMarkers(dc: DrawContext): void {
  const { ctx, p, L, pal } = dc;
  const st = dc.state;
  const dpr = L.dpr;
  const S = L.S;
  const lw = L.line;

  ctx.beginPath();
  // Flight path marker: circle, wings and tail.
  const fpm = st.flightPath;
  if (fpm.visible && Number.isFinite(fpm.x) && Number.isFinite(fpm.y)) {
    const x = p.snap(fpm.x * dpr, lw);
    const y = p.snap(fpm.y * dpr, lw);
    const r = Math.round(7 * S);
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r, y);
    ctx.lineTo(x - r - Math.round(12 * S), y);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + r + Math.round(12 * S), y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y - r - Math.round(7 * S));
  }
  // Gun cross (boresight).
  const bs = st.boresight;
  if (bs.visible && Number.isFinite(bs.x) && Number.isFinite(bs.y)) {
    const x = p.snap(bs.x * dpr, lw);
    const y = p.snap(bs.y * dpr, lw);
    const a = Math.round(4 * S);
    const b = Math.round(13 * S);
    const c = Math.round(9 * S);
    ctx.moveTo(x - b, y);
    ctx.lineTo(x - a, y);
    ctx.moveTo(x + a, y);
    ctx.lineTo(x + b, y);
    ctx.moveTo(x, y - c);
    ctx.lineTo(x, y - a);
    ctx.moveTo(x, y + a);
    ctx.lineTo(x, y + c);
  }
  p.stroke(pal.primary, lw);

  // Mouse-aim reticle: a thin, plain circle, visibly different from the winged FPM.
  const aim = st.aimReticle;
  if (aim && aim.visible && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
    const t = L.thin;
    const x = p.snap(aim.x * dpr, t);
    const y = p.snap(aim.y * dpr, t);
    const r = Math.round(11 * S);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
    p.stroke(pal.dim, t);
  }

  // Hit marker: four short diagonal ticks around the gun cross, fading out.
  const hit = fin(st.hitMarker);
  if (hit > 0.01 && bs.visible) {
    const x = bs.x * dpr;
    const y = bs.y * dpr;
    const r0 = 10 * S;
    const r1 = 19 * S;
    const d0 = r0 * Math.SQRT1_2;
    const d1 = r1 * Math.SQRT1_2;
    ctx.globalAlpha = hit > 1 ? 1 : hit;
    ctx.beginPath();
    ctx.moveTo(x - d0, y - d0);
    ctx.lineTo(x - d1, y - d1);
    ctx.moveTo(x + d0, y - d0);
    ctx.lineTo(x + d1, y - d1);
    ctx.moveTo(x - d0, y + d0);
    ctx.lineTo(x - d1, y + d1);
    ctx.moveTo(x + d0, y + d0);
    ctx.lineTo(x + d1, y + d1);
    p.stroke(pal.bone, L.line);
    ctx.globalAlpha = 1;
  }
}

// ───────────────────────────────────────────────────────────── tapes

/** Outline of a value box with a pointer notch on one side (dir +1 points right, -1 left). */
function pointerBox(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tipX: number,
  cy: number,
  notch: number,
  dir: 1 | -1,
): void {
  ctx.beginPath();
  if (dir === 1) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, cy - notch);
    ctx.lineTo(tipX, cy);
    ctx.lineTo(x1, cy + notch);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
  } else {
    ctx.moveTo(x1, y0);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0, cy - notch);
    ctx.lineTo(tipX, cy);
    ctx.lineTo(x0, cy + notch);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
  }
  ctx.closePath();
}

/** Faint spine along a tape's tick base, broken around the value box. */
function tapeSpine(dc: DrawContext, x: number, cy: number, half: number, gap: number): void {
  const { ctx, p, L, pal } = dc;
  const t = L.thin;
  const sx = p.snap(x, t);
  ctx.beginPath();
  ctx.moveTo(sx, cy - half);
  ctx.lineTo(sx, cy - gap);
  ctx.moveTo(sx, cy + gap);
  ctx.lineTo(sx, cy + half);
  p.stroke(pal.faint, t);
}

/**
 * Rolling-digit counter: `labels` is the drum (e.g. '0'..'9'), the prefix (static digits) rolls to
 * prefix + 1 during the last drum step before a carry. Clipped to the box interior.
 */
function drawDrum(
  dc: DrawContext,
  font: FontRole,
  labels: readonly string[],
  prefix: string,
  prefixNext: string,
  rightX: number,
  cy: number,
  clipX: number,
  clipY: number,
  clipW: number,
  clipH: number,
): void {
  const { ctx, p, pal, drum } = dc;
  const n = labels.length;
  // One drum step = the full window height: neighbours are only visible while a digit rolls.
  const lineH = Math.max(Math.round(font.px * 1.15), clipH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, clipW, clipH);
  ctx.clip();
  p.textStyle(font, pal.primary, 'right');
  const d = Math.floor(drum.roll);
  const frac = drum.roll - d;
  const y0 = cy + frac * lineH;
  p.text(labels[((d % n) + n) % n]!, rightX, y0);
  p.text(labels[(((d + 1) % n) + n) % n]!, rightX, y0 - lineH);
  if (frac < 0.5) p.text(labels[(((d - 1) % n) + n) % n]!, rightX, y0 + lineH);
  const drumW = labels[0]!.length * p.measure('0', font);
  const px = rightX - drumW;
  const cyP = cy + drum.carry * lineH;
  p.text(prefix, px, cyP);
  if (drum.carry > 0) p.text(prefixNext, px, cyP - lineH);
  p.restore();
}

export function drawSpeedTape(dc: DrawContext): void {
  const { ctx, p, L, pal, f, s, cl, ticks, drum } = dc;
  const st = dc.state;
  const S = L.S;
  const lw = L.line;
  const v = Math.max(0, speedIn(fin(st.aircraft.speed), st.units));
  const scale = st.units === 'imperial' ? SPEED_IMPERIAL : SPEED_METRIC;
  const xi = Math.round(cl.cx - cl.tapeInner);
  const cy = Math.round(cl.cy);
  const boxHalf = Math.round(BOX_HALF * S);
  const n = tapeTicks(v, scale, cl.tapeHalf / S, ticks, 0, 0);

  const xs = p.snap(xi, lw);
  const tickSkip = boxHalf + 4 * S;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const off = ticks.offset[i]! * S;
    if (off < tickSkip && off > -tickSkip) continue;
    const y = p.snap(cy - off, lw);
    ctx.moveTo(xs, y);
    ctx.lineTo(xs - (ticks.major[i] ? 12 * S : 6 * S), y);
  }
  const bx1 = xi - Math.round(12 * S);
  const bx0 = bx1 - Math.round(SPEED_BOX_W * S);
  p.stroke(pal.primary, lw);
  tapeSpine(dc, xs, cy, cl.tapeHalf, tickSkip);
  pointerBox(
    ctx,
    p.snap(bx0, lw),
    p.snap(cy - boxHalf, lw),
    p.snap(bx1, lw),
    p.snap(cy + boxHalf, lw),
    xi - 2 * S,
    cy,
    5 * S,
    1,
  );
  p.stroke(pal.primary, lw);

  const labelSkip = boxHalf + 10 * S;
  p.textStyle(f.monoM, pal.primary, 'right');
  const lx = xi - 18 * S;
  for (let i = 0; i < n; i++) {
    if (!ticks.major[i]) continue;
    const off = ticks.offset[i]! * S;
    if (off < labelSkip && off > -labelSkip) continue;
    if (off > cl.tapeHalf - 6 * S || off < -cl.tapeHalf + 6 * S) continue;
    p.text(s.int.get(ticks.value[i]!), lx, cy - off);
  }

  drumSplit(v, 10, 1, drum);
  const prefix = drum.prefix > 0 ? s.int.get(drum.prefix) : '';
  const next = s.int.get(drum.prefix + 1);
  const inset = L.line + 1;
  drawDrum(
    dc,
    f.monoL,
    s.drumOnes,
    prefix,
    next,
    bx1 - 6 * S,
    cy,
    bx0 + inset,
    cy - boxHalf + inset,
    bx1 - bx0 - inset * 2,
    boxHalf * 2 - inset * 2,
  );
}

export function drawAltitudeTape(dc: DrawContext): void {
  const { ctx, p, L, pal, f, s, cl, ticks, drum } = dc;
  const st = dc.state;
  const S = L.S;
  const lw = L.line;
  const imperial = st.units === 'imperial';
  const alt = altitudeIn(fin(st.aircraft.altitude), st.units);
  const scale = imperial ? ALT_IMPERIAL : ALT_METRIC;
  const xi = Math.round(cl.cx + cl.tapeInner);
  const cy = Math.round(cl.cy);
  const boxHalf = Math.round(BOX_HALF * S);
  const half = cl.tapeHalf;
  const n = tapeTicks(alt, scale, half / S, ticks);

  const xs = p.snap(xi, lw);
  const tickSkip = boxHalf + 4 * S;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const off = ticks.offset[i]! * S;
    if (off < tickSkip && off > -tickSkip) continue;
    const y = p.snap(cy - off, lw);
    ctx.moveTo(xs, y);
    ctx.lineTo(xs + (ticks.major[i] ? 12 * S : 6 * S), y);
  }
  // Ground reference from the radar altimeter: a bar at terrain height with hatching below it.
  const agl = fin(st.aircraft.radarAltitude, -1);
  if (agl >= 0) {
    const ground = alt - altitudeIn(agl, st.units);
    const gOff = (ground - alt) * scale.unitsPerValue * S;
    if (gOff > -half) {
      const gy = p.snap(cy - gOff, lw);
      const hx0 = xs;
      const hx1 = xs + 14 * S;
      ctx.moveTo(hx0, gy);
      ctx.lineTo(hx1 + 4 * S, gy);
      const step = 6 * S;
      const bottom = cy + half;
      for (let y = gy + step; y <= bottom; y += step) {
        if (y > cy - tickSkip && y < cy + tickSkip) continue;
        ctx.moveTo(hx0, y);
        ctx.lineTo(hx0 + step * 1.3, y - step);
      }
    }
  }
  p.stroke(pal.primary, lw);
  tapeSpine(dc, xs, cy, half, tickSkip);

  const bx0 = xi + Math.round(12 * S);
  const bx1 = bx0 + Math.round(ALT_BOX_W * S);
  pointerBox(
    ctx,
    p.snap(bx0, lw),
    p.snap(cy - boxHalf, lw),
    p.snap(bx1, lw),
    p.snap(cy + boxHalf, lw),
    xi + 2 * S,
    cy,
    5 * S,
    -1,
  );
  p.stroke(pal.primary, lw);

  const labelSkip = boxHalf + 10 * S;
  p.textStyle(f.monoM, pal.primary, 'left');
  const lx = xi + 18 * S;
  for (let i = 0; i < n; i++) {
    if (!ticks.major[i]) continue;
    const off = ticks.offset[i]! * S;
    if (off < labelSkip && off > -labelSkip) continue;
    if (off > half - 6 * S || off < -half + 6 * S) continue;
    p.text(s.thousands.get(ticks.value[i]!), lx, cy - off);
  }

  drumSplit(alt, 100, imperial ? 20 : 10, drum);
  const inset = L.line + 1;
  drawDrum(
    dc,
    f.monoL,
    imperial ? s.drumAltFt : s.drumAltM,
    s.altPrefix.get(drum.prefix),
    s.altPrefix.get(drum.prefix + 1),
    bx1 - 6 * S,
    cy,
    bx0 + inset,
    cy - boxHalf + inset,
    bx1 - bx0 - inset * 2,
    boxHalf * 2 - inset * 2,
  );
}

export function drawHeadingTape(dc: DrawContext): void {
  const { ctx, p, L, pal, f, s, cl, ticks } = dc;
  const S = L.S;
  const lw = L.line;
  const rad = fin(dc.state.aircraft.heading);
  let deg = (rad * RAD) % 360;
  if (deg < 0) deg += 360;
  const cx = Math.round(cl.cx);
  const y = Math.round(cl.headingY);
  const half = cl.headingHalf;
  const n = tapeTicks(deg, HEADING_SCALE, half / S, ticks, 360);

  const ys = p.snap(y, lw);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = p.snap(cx + ticks.offset[i]! * S, lw);
    ctx.moveTo(x, ys);
    ctx.lineTo(x, ys - (ticks.major[i] ? 9 * S : 4 * S));
  }
  // Caret and heading box below the scale.
  const bw = Math.round(28 * S);
  const by0 = p.snap(y + 9 * S, lw);
  const by1 = p.snap(y + 39 * S, lw);
  const bx0 = p.snap(cx - bw, lw);
  const bx1 = p.snap(cx + bw, lw);
  const notch = 5 * S;
  ctx.moveTo(bx0, by0);
  ctx.lineTo(cx - notch, by0);
  ctx.lineTo(cx, y + 3 * S);
  ctx.lineTo(cx + notch, by0);
  ctx.lineTo(bx1, by0);
  ctx.lineTo(bx1, by1);
  ctx.lineTo(bx0, by1);
  ctx.closePath();
  p.stroke(pal.primary, lw);

  p.textStyle(f.monoS, pal.primary, 'center');
  const labelY = y - 20 * S;
  const edge = half - 12 * S;
  for (let i = 0; i < n; i++) {
    if (!ticks.major[i]) continue;
    const off = ticks.offset[i]! * S;
    if (off > edge || off < -edge) continue;
    p.text(s.compass[Math.round(ticks.value[i]! / 10) % 36]!, cx + off, labelY);
  }
  p.textStyle(f.monoL, pal.primary, 'center');
  p.text(s.heading.get(headingDegrees(rad)), cx, (by0 + by1) / 2 + 1);
}

// ───────────────────────────────────────────────────────────── readouts

export function drawReadouts(dc: DrawContext): void {
  const { ctx, p, L, pal, f, s, cl } = dc;
  const st = dc.state;
  const a = st.aircraft;
  const S = L.S;
  const imperial = st.units === 'imperial';

  // Left block (under/over the airspeed tape): labels at the box's left edge, values at its right.
  const lRight = Math.round(cl.cx - cl.tapeInner - 18 * S);
  const lLeft = Math.round(cl.cx - cl.tapeInner - (26 + SPEED_BOX_W) * S);
  // Right block (altitude side).
  const rLeft = Math.round(cl.cx + cl.tapeInner + 12 * S);
  const rRight = Math.round(cl.cx + cl.tapeInner + (6 + ALT_BOX_W) * S);
  const top = cl.cy - cl.tapeHalf;
  const bottom = cl.cy + cl.tapeHalf;
  const row = Math.round(20 * S);
  const yG = top - 40 * S;
  const yGMax = yG + row;
  const yUnit = bottom + 16 * S;
  const y1 = bottom + 40 * S;
  const y2 = y1 + row;
  const y3 = y2 + row;
  const y4 = y3 + row;

  const showRadarAlt = a.radarAltitude >= 0 && a.radarAltitude < RADAR_ALT_MAX;
  const fuel = fin(a.fuel);
  const lowFuel = fuel < 0.2;

  // Labels.
  p.textStyle(f.labelS, pal.dim, 'left');
  p.text('G', lLeft, yG);
  p.text('MAX', lLeft, yGMax);
  p.text('M', lLeft, y1);
  p.text('AOA', lLeft, y2);
  p.text('THR', lLeft, y3);
  p.text('FUEL', lLeft, y4);
  p.text('VS', rLeft, yG);
  if (showRadarAlt) p.text('R', rLeft, y1);
  p.setAlign('center');
  p.text(imperial ? 'KT' : 'KM/H', (lLeft + lRight) / 2, yUnit);
  p.text(imperial ? 'FT' : 'M', (rLeft + rRight) / 2, yUnit);

  // Annunciators (gear, flaps, speed brake) on the altitude side, only when active.
  let ay = showRadarAlt ? y2 : y1;
  p.textStyle(f.labelS, pal.primary, 'left');
  if (a.gearDown) {
    p.text('GEAR DN', rLeft, ay);
    ay += row;
  }
  if (a.flaps) {
    p.text('FLAPS', rLeft, ay);
    ay += row;
  }
  if (a.airbrake) p.text('SPD BRK', rLeft, ay);

  // Values.
  p.textStyle(f.monoM, pal.primary, 'right');
  p.text(s.fixed1.get(Math.round(fin(a.g) * 10)), lRight, yG);
  p.text(s.fixed2.get(Math.round(fin(a.mach) * 100)), lRight, y1);
  p.text(s.fixed1.get(Math.round(fin(a.aoa) * RAD * 10)), lRight, y2);
  if (!a.afterburner) {
    p.text(s.int.get(Math.round(Math.min(1, Math.max(0, fin(a.throttle))) * 100)), lRight, y3);
  }
  const vs = verticalSpeedIn(fin(a.verticalSpeed), st.units);
  p.text(imperial ? s.signed.get(Math.round(vs / 100) * 100) : s.signed.get(Math.round(vs)), rRight, yG);
  if (showRadarAlt) {
    const ra = altitudeIn(a.radarAltitude, st.units);
    p.text(s.thousands.get(imperial ? Math.round(ra / 10) * 10 : Math.round(ra)), rRight, y1);
  }
  ctx.fillStyle = lowFuel ? pal.warn : pal.primary;
  p.text(s.percent.get(Math.round(Math.min(1, Math.max(0, fuel)) * 100)), lRight, y4);
  p.textStyle(f.monoS, pal.dim, 'right');
  p.text(s.fixed1.get(Math.round(fin(a.maxG) * 10)), lRight, yGMax);

  // Afterburner cue: the throttle value becomes a boxed 'AB' tag.
  if (a.afterburner) {
    const t = L.thin;
    const bw = Math.round(22 * S);
    const bh = Math.round(15 * S);
    const bx = p.snap(lRight - bw + 2 * S, t);
    const by = p.snap(y3 - bh / 2, t);
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    p.stroke(pal.primary, t);
    p.textStyle(f.labelS, pal.primary, 'center');
    p.text('AB', bx + bw / 2, y3 + 1);
  }
}

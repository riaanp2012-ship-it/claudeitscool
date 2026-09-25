import type { DrawContext } from './context';

/**
 * Weapon symbology: IR seeker circle, gun funnel and lead pip, launch envelope (DLZ) scale, CCIP
 * pipper with fall line, and the stores block (weapon, rounds, countermeasures, reload).
 */

const TAU = Math.PI * 2;
/** Nominal target wingspan the gun funnel is sized for (m). */
const FUNNEL_SPAN = 12;
/** Closest range the funnel starts at (m). */
const FUNNEL_NEAR = 180;
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

export function drawSeeker(dc: DrawContext): void {
  const { ctx, p, L, pal } = dc;
  const sk = dc.state.weapon.seeker;
  if (!sk || !sk.point.visible) return;
  const x = sk.point.x * L.dpr;
  const y = sk.point.y * L.dpr;
  const r = Math.max(6 * L.S, fin(sk.radius) * L.dpr);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
  if (sk.locked) {
    p.stroke(pal.primary, L.line);
  } else {
    ctx.setLineDash(dc.dashSeeker);
    p.stroke(pal.primary, L.thin);
    ctx.setLineDash(dc.noDash);
  }
}

/** Selected contact's distance (m), or `fallback` when nothing is selected. */
function selectedDistance(dc: DrawContext, fallback: number): number {
  const cs = dc.state.contacts;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (c.selected) return fin(c.distance, fallback);
  }
  return fallback;
}

export function drawGunsight(dc: DrawContext): void {
  const { ctx, p, L, pal } = dc;
  const st = dc.state;
  const pip = st.weapon.leadPip;
  if (!pip || !pip.visible || !Number.isFinite(pip.x) || !Number.isFinite(pip.y)) return;
  const dpr = L.dpr;
  const S = L.S;
  const px = pip.x * dpr;
  const py = pip.y * dpr;
  const k = fin(st.camera.pxPerRad) * dpr;

  // Funnel: the bullet stream from the gun cross to the pip, as wide as a fighter's wingspan would
  // appear at each range, so the target "fits" the funnel at the right distance.
  const bs = st.boresight;
  if (bs.visible && k > 0) {
    const bx = bs.x * dpr;
    const by = bs.y * dpr;
    const dx = px - bx;
    const dy = py - by;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 30 * S) {
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const range = Math.max(FUNNEL_NEAR * 1.5, selectedDistance(dc, 600));
      const wNear = Math.min(70 * S, ((FUNNEL_SPAN / FUNNEL_NEAR) * k) / 2);
      const wFar = Math.max(4 * S, Math.min(wNear, ((FUNNEL_SPAN / range) * k) / 2));
      const start = 18 * S;
      const end = len - 16 * S;
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          // Hyperbolic taper (apparent size ∝ 1/range), sampled along the stream.
          const w = wNear + (wFar - wNear) * Math.sqrt(t);
          const along = start + (end - start) * t;
          const x = bx + ux * along + nx * w * side;
          const y = by + uy * along + ny * w * side;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      p.stroke(pal.dim, L.thin);
    }
  }

  // Lead pip: circle with a center dot.
  const r = Math.round(12 * S);
  const x = p.snap(px, L.line);
  const y = p.snap(py, L.line);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
  p.stroke(pal.primary, L.line);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.5, 2 * S), 0, TAU);
  p.fill(pal.primary);
}

export function drawCcip(dc: DrawContext): void {
  const { ctx, p, L, pal } = dc;
  const st = dc.state;
  const c = st.weapon.ccip;
  if (!c || !c.visible || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
  const dpr = L.dpr;
  const S = L.S;
  const x = p.snap(c.x * dpr, L.line);
  const y = p.snap(c.y * dpr, L.line);
  const r = Math.round(11 * S);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
  // Bomb fall line from the flight path marker (or gun cross) down to the pipper.
  const from = st.flightPath.visible ? st.flightPath : st.boresight;
  if (from.visible) {
    const fx = from.x * dpr;
    const fy = from.y * dpr;
    const dx = x - fx;
    const dy = y - fy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > r + 24 * S) {
      const ux = dx / len;
      const uy = dy / len;
      ctx.moveTo(fx + ux * 22 * S, fy + uy * 22 * S);
      ctx.lineTo(x - ux * r, y - uy * r);
    }
  }
  p.stroke(pal.primary, L.line);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.5, 2 * S), 0, TAU);
  p.fill(pal.primary);
}

/**
 * Dynamic launch zone scale, inboard of the altitude tape: a vertical range scale with Rmin and Rmax
 * ticks, the no-escape segment drawn heavy, and a caret at the target's current range.
 */
export function drawEnvelope(dc: DrawContext): void {
  const { ctx, p, L, pal, cl } = dc;
  const env = dc.state.weapon.envelope;
  if (!env) return;
  const max = fin(env.max);
  if (!(max > 0)) return;
  const S = L.S;
  const x = p.snap(cl.cx + cl.tapeInner - (dc.state.view === 'cockpit' ? 8 : 30) * S, L.line);
  const y0 = Math.round(cl.cy + 90 * S);
  const h = Math.round(180 * S);
  // Scale runs from 0 (bottom) to 1.2 × Rmax (top).
  const perM = h / (max * 1.2);
  const yMin = p.snap(y0 - envClamp(fin(env.min), max) * perM, L.line);
  const yMax = p.snap(y0 - max * perM, L.line);
  const yNez = p.snap(y0 - envClamp(fin(env.noEscape), max) * perM, L.line);
  const tick = Math.round(7 * S);

  ctx.beginPath();
  ctx.moveTo(x, yMin);
  ctx.lineTo(x, yMax);
  ctx.moveTo(x - tick, yMin);
  ctx.lineTo(x, yMin);
  ctx.moveTo(x - tick, yMax);
  ctx.lineTo(x, yMax);
  p.stroke(pal.primary, L.thin);
  // No-escape zone: heavy bar between Rmin and Rne.
  ctx.beginPath();
  ctx.moveTo(x + L.bold / 2, yMin);
  ctx.lineTo(x + L.bold / 2, yNez);
  p.stroke(pal.primary, L.bold);

  // Range caret (points at the scale from the inboard side); pinned to the top when beyond scale.
  const range = fin(env.range, -1);
  if (range >= 0) {
    const ry = Math.round(y0 - Math.min(range, max * 1.2) * perM);
    const cx = x - 3 * S;
    const a = 7 * S;
    ctx.beginPath();
    ctx.moveTo(cx, ry);
    ctx.lineTo(cx - a, ry - a * 0.6);
    ctx.lineTo(cx - a, ry + a * 0.6);
    ctx.closePath();
    const inZone = range >= fin(env.min) && range <= max;
    p.fill(inZone ? pal.primary : pal.dim);
  }
}

function envClamp(r: number, max: number): number {
  return r < 0 ? 0 : r > max ? max : r;
}

/** Stores block, right column above the radar: weapon + count, reload bar, gun rounds, flares/chaff. */
export function drawStores(dc: DrawContext, x0: number, x1: number, bottom: number): void {
  const { ctx, p, L, pal, f, s } = dc;
  const st = dc.state;
  const w = st.weapon;
  const S = L.S;
  const row = Math.round(22 * S);
  const yCm = bottom - 8 * S;
  const yGun = yCm - row;
  const isGun = w.name === 'GUN';
  const yName = (isGun ? yCm : yGun) - row - 14 * S;
  const reloading = Math.min(1, Math.max(0, fin(w.reloading)));
  // Two columns for the countermeasures: FLR n | CHF n.
  const colR = Math.round(x0 + (x1 - x0) * 0.42);
  const col2 = colR + Math.round(22 * S);

  p.textStyle(f.labelS, pal.dim, 'left');
  p.text('FLR', x0, yCm);
  p.text('CHF', col2, yCm);
  if (!isGun) p.text('GUN', x0, yGun);

  // Selected weapon (large) with its count; dimmed while cycling/reloading.
  const ready = reloading <= 0;
  p.textStyle(f.labelXL, ready ? pal.primary : pal.dim, 'left');
  p.text(w.name, x0, yName);
  p.textStyle(f.monoXL, ready ? pal.primary : pal.dim, 'right');
  p.text(s.int.get(Math.max(0, Math.round(fin(isGun ? w.gunAmmo : w.count)))), x1, yName);

  p.textStyle(f.monoM, pal.primary, 'right');
  if (!isGun) p.text(s.int.get(Math.max(0, Math.round(fin(w.gunAmmo)))), x1, yGun);
  const flares = Math.max(0, Math.round(fin(st.countermeasures.flares)));
  const chaff = Math.max(0, Math.round(fin(st.countermeasures.chaff)));
  ctx.fillStyle = flares === 0 ? pal.warn : pal.primary;
  p.text(s.int.get(flares), colR, yCm);
  ctx.fillStyle = chaff === 0 ? pal.warn : pal.primary;
  p.text(s.int.get(chaff), x1, yCm);

  // Reload / cooldown: a hairline under the weapon name that fills as the weapon becomes ready.
  if (reloading > 0) {
    const y = p.snap(yName + 20 * S, L.thin);
    const full = x1 - x0;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    p.stroke(pal.faint, L.thin);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + full * (1 - reloading), y);
    p.stroke(pal.primary, L.line);
  }
}

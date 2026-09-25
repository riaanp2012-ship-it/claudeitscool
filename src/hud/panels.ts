import type { HudWarning } from '../core/types';
import type { DrawContext } from './context';
import { easeOut, killFeedAlpha, messageAlpha, subtitleAlpha } from './text';
import { flashAlpha, isCritical, prioritizeWarnings } from './warnings';

/**
 * Text panels: kill feed, objectives, radio subtitles, center message, score strip, training hint,
 * warnings (with out-of-bounds countdown) and spawn protection.
 */

const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);
const MAX_FEED = 5;
const MAX_OBJECTIVES = 5;

/**
 * Picks the MAX_FEED youngest visible entries into `idx`, ordered oldest → youngest, allocation-free.
 * Returns how many were picked.
 */
export function selectFeed(feed: readonly { age: number }[], idx: Int32Array): number {
  let n = 0;
  for (let i = 0; i < feed.length; i++) {
    const age = fin(feed[i]!.age, 1e9);
    if (killFeedAlpha(age) <= 0) continue;
    if (n < MAX_FEED) {
      let j = n++;
      while (j > 0 && fin(feed[idx[j - 1]!]!.age, 1e9) < age) {
        idx[j] = idx[j - 1]!;
        j--;
      }
      idx[j] = i;
    } else if (age < fin(feed[idx[0]!]!.age, 1e9)) {
      // Younger than the oldest kept line: drop that one and insert in order.
      let j = 0;
      while (j < MAX_FEED - 1 && fin(feed[idx[j + 1]!]!.age, 1e9) > age) {
        idx[j] = idx[j + 1]!;
        j++;
      }
      idx[j] = i;
    }
  }
  return n;
}

/** Kill feed, top-right: the 5 most recent lines, newest at the bottom, each fading by age. */
export function drawKillFeed(dc: DrawContext): void {
  const { ctx, p, L, pal, f } = dc;
  const feed = dc.state.killFeed;
  if (feed.length === 0) return;
  const idx = dc.feedIdx;
  const n = selectFeed(feed, idx);
  if (n === 0) return;
  const S = L.S;
  const x = L.right;
  const row = Math.round(24 * S);
  const y0 = L.top + 8 * S;
  const textRight = x - 16 * S;
  const maxW = Math.round(330 * S);
  const font = f.labelM;
  for (let k = 0; k < n; k++) {
    const e = feed[idx[k]!]!;
    const a = killFeedAlpha(fin(e.age, 1e9));
    const y = y0 + k * row;
    const color = e.friendly ? pal.primary : pal.foe;
    ctx.globalAlpha = a;
    // Marker glyph: circle for our side's kill, diamond for a loss (shape-coded, spec §8.2).
    const gx = x - 5 * S;
    const r = 4 * S;
    ctx.beginPath();
    if (e.friendly) {
      ctx.moveTo(gx + r, y);
      ctx.arc(gx, y, r, 0, Math.PI * 2);
    } else {
      ctx.moveTo(gx, y - r - S);
      ctx.lineTo(gx + r + S, y);
      ctx.lineTo(gx, y + r + S);
      ctx.lineTo(gx - r - S, y);
      ctx.closePath();
    }
    p.stroke(color, L.thin);
    p.textStyle(font, color, 'right');
    p.text(p.fit(e.text, font, maxW), textRight, y);
  }
  ctx.globalAlpha = 1;
}

/** Objectives, top-left: pending (open box), done (check, dimmed), failed (cross, struck through). */
export function drawObjectives(dc: DrawContext): void {
  const { ctx, p, L, pal, f } = dc;
  const obj = dc.state.objectives;
  if (obj.length === 0) return;
  const S = L.S;
  const x = L.left;
  const row = Math.round(22 * S);
  let y = L.top + 8 * S;
  p.textStyle(f.labelS, pal.dim, 'left');
  p.text('OBJECTIVES', x, y);
  y += row;
  const font = f.bodyS;
  const tx = x + 18 * S;
  const maxW = Math.round(320 * S);
  const count = Math.min(obj.length, MAX_OBJECTIVES);
  for (let i = 0; i < count; i++) {
    const o = obj[i]!;
    const color = o.failed ? pal.foe : o.done ? pal.dim : pal.primary;
    const t = L.thin;
    const bx = p.snap(x, t);
    const h = Math.round(10 * S);
    const by = p.snap(y - h / 2, t);
    ctx.beginPath();
    ctx.rect(bx, by, h, h);
    if (o.done && !o.failed) {
      ctx.moveTo(bx + 2 * S, by + h * 0.55);
      ctx.lineTo(bx + h * 0.42, by + h - 2 * S);
      ctx.lineTo(bx + h - 1.5 * S, by + 1.5 * S);
    } else if (o.failed) {
      ctx.moveTo(bx + 2 * S, by + 2 * S);
      ctx.lineTo(bx + h - 2 * S, by + h - 2 * S);
      ctx.moveTo(bx + h - 2 * S, by + 2 * S);
      ctx.lineTo(bx + 2 * S, by + h - 2 * S);
    }
    p.stroke(color, t);
    const text = p.fit(o.text, font, maxW);
    p.textStyle(font, color, 'left');
    p.text(text, tx, y);
    if (o.failed) {
      const w = p.measure(text, font);
      ctx.beginPath();
      const sy = p.snap(y, t);
      ctx.moveTo(tx, sy);
      ctx.lineTo(tx + w, sy);
      p.stroke(color, t);
    }
    y += row;
  }
}

/** Radio subtitle, lower center: speaker callsign in caps above up to two lines of text. */
export function drawSubtitle(dc: DrawContext): void {
  const { ctx, p, L, pal, f } = dc;
  const sub = dc.state.subtitle;
  if (!sub || sub.text.length === 0) return;
  const a = subtitleAlpha(fin(sub.age, 1e9), sub.text.length);
  if (a <= 0) return;
  const S = L.S;
  const font = f.body;
  const maxW = Math.round(560 * S);
  if (dc.subtitleSource !== sub.text || dc.subtitleWrapWidth !== maxW) {
    // Rebuilt only when a new line arrives (not a per-frame cost).
    const lines = p.wrap(sub.text, font, maxW, 2);
    dc.subtitleLines.length = 0;
    for (let i = 0; i < lines.length; i++) dc.subtitleLines.push(lines[i]!);
    dc.subtitleSource = sub.text;
    dc.subtitleWrapWidth = maxW;
  }
  const lines = dc.subtitleLines;
  const lineH = Math.round(22 * S);
  const cx = L.cx;
  const bottom = L.bottom - 4 * S;
  const textTop = bottom - lines.length * lineH;
  let w = 0;
  for (let i = 0; i < lines.length; i++) w = Math.max(w, p.measure(lines[i]!, font));
  const speakerY = textTop - 12 * S;
  const padX = Math.round(14 * S);
  ctx.globalAlpha = a;
  // Backing plate for legibility over any sky (not a card: no border, no radius).
  ctx.fillStyle = pal.backing;
  ctx.fillRect(
    Math.round(cx - w / 2 - padX),
    Math.round(speakerY - 12 * S),
    Math.round(w + padX * 2),
    Math.round(bottom - speakerY + 16 * S),
  );
  p.textStyle(f.labelM, pal.primary, 'center');
  p.text(sub.speaker, cx, speakerY);
  p.textStyle(font, pal.bone, 'center');
  for (let i = 0; i < lines.length; i++) p.text(lines[i]!, cx, textTop + lineH * (i + 0.5));
  ctx.globalAlpha = 1;
}

/** Big center message ('SPLASH ONE') with its sub line, flanked by hairlines. */
export function drawMessage(dc: DrawContext): void {
  const { ctx, p, L, pal, f, cl } = dc;
  const m = dc.state.message;
  if (!m || m.text.length === 0) return;
  const a = messageAlpha(dc.messageShown, fin(m.time));
  if (a <= 0) return;
  const S = L.S;
  // 8-unit rise on entry (spec §8.4).
  const rise = (1 - easeOut(dc.messageShown / 0.25)) * 8 * S;
  // Below any active warnings in the stack under the heading tape.
  const y = Math.round(dc.stackY + 22 * S + rise);
  const cx = cl.cx;
  ctx.globalAlpha = a;
  p.textStyle(f.title, pal.primary, 'center');
  p.text(m.text, cx, y);
  if (m.sub.length > 0) {
    const sy = y + 36 * S;
    p.textStyle(f.labelL, pal.primary, 'center');
    p.text(m.sub, cx, sy);
    const half = p.measure(m.sub, f.labelL) / 2 + 14 * S;
    const len = 40 * S;
    const ly = p.snap(sy, L.thin);
    ctx.beginPath();
    ctx.moveTo(cx - half - len, ly);
    ctx.lineTo(cx - half, ly);
    ctx.moveTo(cx + half, ly);
    ctx.lineTo(cx + half + len, ly);
    p.stroke(pal.primary, L.thin);
  }
  ctx.globalAlpha = 1;
}

/** Score and timer strip, top center. */
export function drawScore(dc: DrawContext): void {
  const { ctx, p, L, pal, f } = dc;
  const sc = dc.state.score;
  if (!sc) return;
  const S = L.S;
  const y = L.top + 8 * S;
  const cx = L.cx;
  const gap = 44 * S;
  p.textStyle(f.monoL, pal.primary, 'center');
  p.text(sc.timer, cx, y);
  p.textStyle(f.labelL, pal.primary, 'right');
  p.text(sc.left, cx - gap, y);
  p.setAlign('left');
  p.text(sc.right, cx + gap, y);
  const t = L.thin;
  ctx.beginPath();
  const x0 = p.snap(cx - gap + 12 * S, t);
  const x1 = p.snap(cx + gap - 12 * S, t);
  ctx.moveTo(x0, y - 7 * S);
  ctx.lineTo(x0, y + 7 * S);
  ctx.moveTo(x1, y - 7 * S);
  ctx.lineTo(x1, y + 7 * S);
  p.stroke(pal.dim, t);
}

export function drawSpawnProtection(dc: DrawContext): void {
  const { p, L, pal, f, s } = dc;
  const t = fin(dc.state.spawnProtection);
  if (t <= 0) return;
  const S = L.S;
  const y = L.top + (dc.state.score ? 34 : 8) * S;
  p.textStyle(f.labelS, pal.dim, 'right');
  p.text('SPAWN PROTECTION', L.cx + 44 * S, y);
  p.textStyle(f.monoS, pal.primary, 'left');
  p.text(s.int.get(Math.ceil(t)), L.cx + 52 * S, y);
}

/** Training hint, lower center above the subtitles, in a hairline frame. */
export function drawHint(dc: DrawContext): void {
  const { ctx, p, L, pal, f } = dc;
  const h = dc.state.hint;
  if (!h || h.length === 0) return;
  const S = L.S;
  const font = f.body;
  const text = p.fit(h, font, Math.round(440 * S));
  const w = p.measure(text, font);
  const padX = Math.round(16 * S);
  const halfH = Math.round(16 * S);
  const cy = Math.round(L.bottom - 104 * S);
  const t = L.thin;
  const x0 = p.snap(L.cx - w / 2 - padX, t);
  const x1 = p.snap(L.cx + w / 2 + padX, t);
  const y0 = p.snap(cy - halfH, t);
  const y1 = p.snap(cy + halfH, t);
  ctx.fillStyle = pal.backing;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  p.stroke(pal.dim, t);
  // Registration ticks on the left edge: the one decorative touch, marks it as an instructor note.
  ctx.beginPath();
  ctx.moveTo(x0, y0 + 6 * S);
  ctx.lineTo(x0 + 4 * S, y0 + 6 * S);
  ctx.moveTo(x0, y1 - 6 * S);
  ctx.lineTo(x0 + 4 * S, y1 - 6 * S);
  p.stroke(pal.primary, t);
  p.textStyle(font, pal.bone, 'center');
  p.text(text, L.cx, cy + 1);
}

/**
 * Warnings, stacked under the heading tape above the gun cross, where the flight path marker (which
 * sits at or below the gun cross at positive AoA) cannot be covered: the most critical warning large,
 * boxed and flashing (<= 2 Hz, never a strobe), then the out-of-bounds countdown, then the other active
 * warnings on one row without flashing. Leaves `dc.stackY` at the bottom of the stack for the message.
 */
export function drawWarnings(dc: DrawContext): void {
  const { ctx, p, L, pal, f, s, cl } = dc;
  const st = dc.state;
  const list = dc.warnings;
  const S = L.S;
  const n = prioritizeWarnings(st.warnings, list);
  const oob = st.outOfBounds;
  let y = dc.stackY;
  if (n === 0 && (oob === null || !Number.isFinite(oob))) return;
  const cx = cl.cx;

  if (n > 0) {
    const top = list[0]!;
    const color = isCritical(top) ? pal.critical : pal.warn;
    const font = f.warning;
    const w = p.measure(top, font);
    const padX = Math.round(14 * S);
    const h = Math.round(40 * S);
    const t = L.line;
    ctx.globalAlpha = flashAlpha(dc.time);
    ctx.beginPath();
    const x0 = p.snap(cx - w / 2 - padX, t);
    const x1 = p.snap(cx + w / 2 + padX, t);
    const y0 = p.snap(y, t);
    ctx.rect(x0, y0, x1 - x0, h);
    p.stroke(color, t);
    p.textStyle(font, color, 'center');
    p.text(top, cx, y0 + h / 2 + 1);
    ctx.globalAlpha = 1;
    y += h + 8 * S;
  }

  if (oob !== null && Number.isFinite(oob)) {
    const label = 'RETURN TO COMBAT AREA';
    const num = s.clock.get(Math.ceil(Math.max(0, oob)));
    const lw = p.measure(label, f.labelL);
    const nw = num.length * p.measure('0', f.monoL);
    const gap = 10 * S;
    const x0 = cx - (lw + gap + nw) / 2;
    const ly = y + 11 * S;
    p.textStyle(f.labelL, pal.warn, 'left');
    p.text(label, x0, ly);
    p.textStyle(f.monoL, pal.warn, 'left');
    p.text(num, x0 + lw + gap, ly);
    y += 24 * S;
  }

  if (n > 1) {
    // Secondary warnings on one centered row.
    const font = f.labelM;
    const gap = 18 * S;
    let total = 0;
    for (let i = 1; i < n; i++) total += p.measure(list[i]!, font) + (i > 1 ? gap : 0);
    let x = cx - total / 2;
    const ry = y + 10 * S;
    for (let i = 1; i < n; i++) {
      const w: HudWarning = list[i]!;
      p.textStyle(font, isCritical(w) ? pal.critical : pal.warn, 'left');
      p.text(w, x, ry);
      x += p.measure(w, font) + gap;
    }
    y += 22 * S;
  }
  dc.stackY = y + 6 * S;
}

import type { Hud, HudState, HudWarning } from '../core/types';
import { drawDamage, drawMissileArrows, drawRadar, drawRwr, RADAR_RADIUS, RWR_RADIUS } from './awareness';
import { HudStrings } from './caches';
import { createContactLabels, drawContacts } from './contacts';
import { createCluster, type Cluster, type DrawContext } from './context';
import {
  drawAltitudeTape,
  drawHeadingTape,
  drawLadder,
  drawMarkers,
  drawReadouts,
  drawSpeedTape,
} from './flight';
import { clampScale, computeLayout, createLayout, type HudLayout } from './layout';
import { NO_DASH, Painter } from './painter';
import { buildPalette, type ColorblindMode, type HudColorName } from './palette';
import {
  drawHint,
  drawKillFeed,
  drawMessage,
  drawObjectives,
  drawScore,
  drawSpawnProtection,
  drawSubtitle,
  drawWarnings,
} from './panels';
import { createRungBuffer, createTickBuffer } from './tape';
import { WARNING_PRIORITY } from './warnings';
import { drawCcip, drawEnvelope, drawGunsight, drawSeeker, drawStores } from './weapons';

/**
 * The HUD: one Canvas 2D overlay above the WebGL canvas, drawn after post-processing so bloom and
 * haze never touch it (ZD-B33). Backing store is CSS size × dpr (ZD-B23); all drawing happens in
 * device px with integer line widths and snapped coordinates (ZD-B31).
 */
export class HudRenderer implements Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout: HudLayout = createLayout();
  private readonly painter: Painter;
  private readonly dc: DrawContext;
  private readonly cluster: Cluster = createCluster();
  private scale = 1;
  private color: HudColorName = 'green';
  private colorblind: ColorblindMode = 'off';
  private messageText: string | null = null;
  private disposed = false;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.className = 'hud';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:block;';
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('HUD: Canvas 2D is not available in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
    const palette = buildPalette(this.color, this.colorblind);
    this.painter = new Painter(ctx, this.layout, palette);
    this.dc = {
      ctx,
      p: this.painter,
      L: this.layout,
      pal: palette,
      f: this.painter.fonts,
      s: new HudStrings(),
      cl: this.cluster,
      time: 0,
      stackY: 0,
      messageShown: 0,
      ticks: createTickBuffer(128),
      rungs: createRungBuffer(40),
      drum: { prefix: 0, roll: 0, carry: 0 },
      v2: { x: 0, y: 0 },
      labels: createContactLabels(),
      warnings: WARNING_PRIORITY.slice() as HudWarning[],
      feedIdx: new Int32Array(8),
      subtitleSource: '',
      subtitleLines: [],
      subtitleWrapWidth: 0,
      dashLadder: [8, 5],
      dashSeeker: [6, 5],
      dashFine: [2, 3],
      noDash: NO_DASH,
      state: null as unknown as HudState,
    };
    const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const h = typeof window === 'undefined' ? 720 : window.innerHeight;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.resize(w, h, dpr);
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) return;
    const L = computeLayout(width, height, dpr, this.scale, this.layout);
    if (this.canvas.width !== L.W) this.canvas.width = L.W;
    if (this.canvas.height !== L.H) this.canvas.height = L.H;
    this.canvas.style.width = L.cssW + 'px';
    this.canvas.style.height = L.cssH + 'px';
    this.configure();
  }

  setColor(color: HudColorName): void {
    this.color = color;
    this.applyPalette();
  }

  setScale(scale: number): void {
    this.scale = clampScale(scale);
    const L = this.layout;
    computeLayout(L.cssW, L.cssH, L.dpr, this.scale, L);
    this.configure();
  }

  setColorblind(mode: ColorblindMode): void {
    this.colorblind = mode;
    this.applyPalette();
  }

  draw(state: HudState, dt: number): void {
    if (this.disposed) return;
    const L = this.layout;
    const vw = state.viewport.width;
    const vh = state.viewport.height;
    if (vw > 0 && vh > 0 && (Math.abs(vw - L.cssW) > 0.5 || Math.abs(vh - L.cssH) > 0.5)) {
      this.resize(vw, vh, L.dpr);
    }
    const dc = this.dc;
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    dc.time += step;
    dc.state = state;
    const msg = state.message;
    if (msg && msg.text.length > 0) {
      if (msg.text !== this.messageText) {
        this.messageText = msg.text;
        dc.messageShown = 0;
      } else {
        dc.messageShown += step;
      }
    } else {
      this.messageText = null;
    }

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);

    this.layoutCluster(state);
    // The center stack starts just below the heading tape's value box.
    dc.stackY = this.cluster.headingY + Math.round(52 * L.S);
    if (state.view !== 'hidden') {
      this.drawFlight(state.view === 'cockpit');
      drawSeeker(dc);
      drawGunsight(dc);
      drawCcip(dc);
      drawContacts(dc);
      drawMissileArrows(dc);
      this.drawPeripheral();
      drawWarnings(dc);
    }
    drawKillFeed(dc);
    drawSubtitle(dc);
    drawMessage(dc);
  }

  clear(): void {
    if (this.disposed) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
    // Release the backing store right away instead of waiting for GC.
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private applyPalette(): void {
    const pal = buildPalette(this.color, this.colorblind);
    this.painter.palette = pal;
    this.dc.pal = pal;
  }

  /** Rebuilds everything derived from the layout: fonts, dash lengths, cached measurements. */
  private configure(): void {
    const L = this.layout;
    this.painter.configure(L);
    const dc = this.dc;
    const S = L.S;
    dc.dashLadder[0] = Math.max(3, Math.round(9 * S));
    dc.dashLadder[1] = Math.max(2, Math.round(5 * S));
    dc.dashSeeker[0] = Math.max(3, Math.round(7 * S));
    dc.dashSeeker[1] = Math.max(2, Math.round(6 * S));
    dc.dashFine[0] = Math.max(1, Math.round(2 * S));
    dc.dashFine[1] = Math.max(2, Math.round(4 * S));
    dc.subtitleSource = '';
  }

  /** Flight cluster geometry: full size around the viewport center in chase, inside the glass in cockpit. */
  private layoutCluster(state: HudState): void {
    const L = this.layout;
    const S = L.S;
    const c = this.cluster;
    if (state.view === 'cockpit') {
      const cx = Number.isFinite(state.camera.center.x) ? state.camera.center.x * L.dpr : L.cx;
      const cy = Number.isFinite(state.camera.center.y) ? state.camera.center.y * L.dpr : L.cy;
      c.cx = Math.round(cx);
      c.cy = Math.round(cy);
      c.tapeInner = Math.round(150 * S);
      c.tapeHalf = Math.round(110 * S);
      c.headingY = Math.round(c.cy - 192 * S);
      c.headingHalf = Math.round(112 * S);
      c.glassW = Math.round(540 * S);
      c.glassH = Math.round(480 * S);
      c.glassX = Math.round(c.cx - c.glassW / 2);
      c.glassY = Math.round(c.cy - c.glassH / 2);
      c.ladderW = Math.round(280 * S);
      c.ladderX = c.cx - Math.round(c.ladderW / 2);
      c.ladderY = Math.round(c.cy - 150 * S);
      c.ladderH = Math.round(c.glassY + c.glassH - c.ladderY - 12 * S);
    } else {
      c.cx = L.cx;
      c.cy = L.cy;
      c.tapeInner = Math.round(280 * S);
      c.tapeHalf = Math.round(150 * S);
      c.headingY = Math.round(c.cy - 262 * S);
      c.headingHalf = Math.round(160 * S);
      c.glassW = 0;
      c.glassH = 0;
      c.glassX = 0;
      c.glassY = 0;
      c.ladderW = Math.round(2 * (c.tapeInner - 44 * S));
      c.ladderX = c.cx - Math.round(c.ladderW / 2);
      c.ladderY = Math.round(c.cy - 222 * S);
      c.ladderH = Math.round(422 * S);
    }
  }

  private drawFlight(cockpit: boolean): void {
    const dc = this.dc;
    const c = this.cluster;
    if (cockpit) {
      this.painter.save();
      this.ctx.beginPath();
      this.ctx.rect(c.glassX, c.glassY, c.glassW, c.glassH);
      this.ctx.clip();
    }
    drawLadder(dc);
    drawHeadingTape(dc);
    drawSpeedTape(dc);
    drawAltitudeTape(dc);
    drawReadouts(dc);
    drawEnvelope(dc);
    drawMarkers(dc);
    if (cockpit) this.painter.restore();
  }

  private drawPeripheral(): void {
    const dc = this.dc;
    const L = this.layout;
    const S = L.S;
    const rwr = RWR_RADIUS * S;
    const radar = RADAR_RADIUS * S;
    drawRwr(dc, L.left + rwr, L.bottom - rwr);
    drawDamage(dc, L.left + rwr * 2 + 58 * S, L.bottom - 32 * S);
    drawRadar(dc, L.right - radar, L.bottom - radar);
    drawStores(dc, L.right - 170 * S, L.right, L.bottom - radar * 2 - 30 * S);
    drawObjectives(dc);
    drawScore(dc);
    drawSpawnProtection(dc);
    drawHint(dc);
  }
}

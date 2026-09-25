import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';

/**
 * Marking atlas: fictional national insignia, squadron badges, unit codes, stencils and a stencil-style
 * glyph set for tail numbers. Drawn once into a canvas on first use (browser only); in Node (unit tests)
 * a 1x1 transparent texture stands in so geometry and materials can still be built.
 */
export const ATLAS_SIZE = 1024;

type Rect = [x: number, y: number, w: number, h: number];

const REGIONS: Record<string, Rect> = {
  insigniaBlue: [0, 0, 256, 256],
  insigniaRed: [256, 0, 256, 256],
  squadronBlue: [512, 0, 256, 256],
  squadronRed: [768, 0, 256, 256],
  noStep: [0, 256, 256, 96],
  rescue: [256, 256, 256, 128],
  danger: [512, 256, 256, 128],
  eject: [768, 256, 128, 128],
  unitBlue: [0, 400, 256, 80],
  unitRed: [256, 400, 256, 80],
};

export const GLYPH = { x0: 0, y0: 512, w: 64, h: 96, perRow: 16 } as const;
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-';

/** Glyph index for a tail-number character (-1 = blank). */
export function glyphIndex(ch: string): number {
  return GLYPHS.indexOf(ch.toUpperCase());
}

/** UV rectangle [u0, v0, u1, v1] of an atlas region (v up, canvas flipped on upload). */
export function atlasRect(key: string): [number, number, number, number] {
  const r = REGIONS[key];
  if (!r) return [0, 0, 0, 0];
  const [x, y, w, h] = r;
  return [x / ATLAS_SIZE, 1 - (y + h) / ATLAS_SIZE, (x + w) / ATLAS_SIZE, 1 - y / ATLAS_SIZE];
}

/** Glyph grid in UV space: origin (u, v of the first cell's bottom-left), cell size, cells per row. */
export function glyphGrid(): [number, number, number, number] {
  return [
    GLYPH.x0 / ATLAS_SIZE,
    1 - (GLYPH.y0 + GLYPH.h) / ATLAS_SIZE,
    GLYPH.w / ATLAS_SIZE,
    GLYPH.h / ATLAS_SIZE,
  ];
}

let atlas: Texture | null = null;

export function getAtlas(): Texture {
  if (atlas) return atlas;
  if (typeof document === 'undefined') {
    const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
    t.needsUpdate = true;
    atlas = t;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  atlas = t;
  return t;
}

export function disposeAtlas(): void {
  atlas?.dispose();
  atlas = null;
}

const FONT = '"Arial Narrow", "Liberation Sans Narrow", "Roboto Condensed", Arial, Helvetica, sans-serif';

function draw(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  insigniaBlue(g, 128, 128, 118);
  insigniaRed(g, 384, 128, 120);
  squadronBlue(g, 640, 128);
  squadronRed(g, 896, 128);
  stencil(g, REGIONS.noStep!, 'NO STEP', '#ffffff', true);
  rescue(g, REGIONS.rescue!);
  danger(g, REGIONS.danger!);
  eject(g, REGIONS.eject!);
  unit(g, REGIONS.unitBlue!, 'ACC  7 SQN');
  unit(g, REGIONS.unitRed!, 'VR  II/44');
  for (let i = 0; i < GLYPHS.length; i++) {
    const x = GLYPH.x0 + (i % GLYPH.perRow) * GLYPH.w;
    const y = GLYPH.y0 + Math.floor(i / GLYPH.perRow) * GLYPH.h;
    g.save();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.translate(x + GLYPH.w / 2, y + GLYPH.h / 2 + 3);
    g.scale(0.78, 1);
    g.font = `700 86px ${FONT}`;
    g.fillText(GLYPHS[i]!, 0, 0);
    g.restore();
  }
}

/** Allied Coastal Command: navy ring, pale sky disc, white breaking wave under a navy sun. */
function insigniaBlue(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = '#1d3252';
  g.fill();
  g.beginPath();
  g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  g.fillStyle = '#a9c0d6';
  g.fill();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  g.clip();
  // wave band
  g.beginPath();
  g.moveTo(cx - r, cy + r * 0.06);
  for (let k = 0; k <= 40; k++) {
    const x = cx - r + (k / 40) * r * 2;
    g.lineTo(x, cy + r * 0.06 - Math.sin((k / 40) * Math.PI * 3) * r * 0.1);
  }
  g.lineTo(cx + r, cy + r);
  g.lineTo(cx - r, cy + r);
  g.closePath();
  g.fillStyle = '#f4f5f2';
  g.fill();
  g.beginPath();
  g.moveTo(cx - r, cy + r * 0.34);
  for (let k = 0; k <= 40; k++) {
    const x = cx - r + (k / 40) * r * 2;
    g.lineTo(x, cy + r * 0.34 - Math.sin((k / 40) * Math.PI * 3 + 0.9) * r * 0.08);
  }
  g.lineTo(cx + r, cy + r);
  g.lineTo(cx - r, cy + r);
  g.closePath();
  g.fillStyle = '#1d3252';
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(cx, cy - r * 0.3, r * 0.2, 0, Math.PI * 2);
  g.fillStyle = '#1d3252';
  g.fill();
  g.restore();
}

/** Varen Republic: dark red lozenge, black border, white mountain chevron. */
function insigniaRed(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const d = (s: number) => {
    g.beginPath();
    g.moveTo(cx, cy - r * s);
    g.lineTo(cx + r * s * 0.82, cy);
    g.lineTo(cx, cy + r * s);
    g.lineTo(cx - r * s * 0.82, cy);
    g.closePath();
  };
  d(1);
  g.fillStyle = '#141414';
  g.fill();
  d(0.86);
  g.fillStyle = '#7d1616';
  g.fill();
  g.beginPath();
  g.moveTo(cx - r * 0.42, cy + r * 0.22);
  g.lineTo(cx, cy - r * 0.36);
  g.lineTo(cx + r * 0.42, cy + r * 0.22);
  g.lineTo(cx + r * 0.26, cy + r * 0.22);
  g.lineTo(cx, cy - r * 0.12);
  g.lineTo(cx - r * 0.26, cy + r * 0.22);
  g.closePath();
  g.fillStyle = '#efeee9';
  g.fill();
}

function squadronBlue(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.save();
  g.beginPath();
  g.moveTo(cx - 80, cy - 100);
  g.lineTo(cx + 80, cy - 100);
  g.lineTo(cx + 80, cy + 10);
  g.quadraticCurveTo(cx + 70, cy + 80, cx, cy + 110);
  g.quadraticCurveTo(cx - 70, cy + 80, cx - 80, cy + 10);
  g.closePath();
  g.fillStyle = '#20324d';
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = '#d9dcd8';
  g.stroke();
  // stylised gannet: swept wings over a wave line
  g.beginPath();
  g.moveTo(cx - 62, cy - 10);
  g.quadraticCurveTo(cx - 22, cy - 38, cx, cy - 8);
  g.quadraticCurveTo(cx + 22, cy - 38, cx + 62, cy - 10);
  g.quadraticCurveTo(cx + 20, cy - 18, cx, cy + 16);
  g.quadraticCurveTo(cx - 20, cy - 18, cx - 62, cy - 10);
  g.fillStyle = '#e8eae6';
  g.fill();
  g.fillStyle = '#c9a33a';
  g.fillRect(cx - 50, cy + 40, 100, 9);
  g.restore();
}

function squadronRed(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, 100, 0, Math.PI * 2);
  g.fillStyle = '#161616';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#8a1b1b';
  g.stroke();
  // running hound silhouette reduced to three strokes
  g.beginPath();
  g.moveTo(cx - 70, cy + 20);
  g.lineTo(cx - 20, cy - 10);
  g.lineTo(cx + 30, cy - 12);
  g.lineTo(cx + 62, cy - 40);
  g.lineTo(cx + 68, cy - 18);
  g.lineTo(cx + 40, cy + 2);
  g.lineTo(cx + 55, cy + 45);
  g.lineTo(cx + 38, cy + 45);
  g.lineTo(cx + 20, cy + 10);
  g.lineTo(cx - 25, cy + 12);
  g.lineTo(cx - 50, cy + 48);
  g.lineTo(cx - 66, cy + 44);
  g.closePath();
  g.fillStyle = '#c9c4b8';
  g.fill();
  g.restore();
}

function stencil(
  g: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  color: string,
  underline: boolean,
): void {
  const [x, y, w, h] = r;
  g.save();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h * 0.52)}px ${FONT}`;
  g.fillText(text, x + w / 2, y + h * 0.42);
  if (underline) g.fillRect(x + w * 0.08, y + h * 0.78, w * 0.84, h * 0.07);
  g.restore();
}

function rescue(g: CanvasRenderingContext2D, r: Rect): void {
  const [x, y, , h] = r;
  g.save();
  g.fillStyle = '#c8412a';
  g.beginPath();
  g.moveTo(x + 10, y + h * 0.5);
  g.lineTo(x + 58, y + h * 0.18);
  g.lineTo(x + 58, y + h * 0.36);
  g.lineTo(x + 96, y + h * 0.36);
  g.lineTo(x + 96, y + h * 0.64);
  g.lineTo(x + 58, y + h * 0.64);
  g.lineTo(x + 58, y + h * 0.82);
  g.closePath();
  g.fill();
  g.font = `700 ${Math.round(h * 0.34)}px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText('RESCUE', x + 106, y + h * 0.36);
  g.font = `600 ${Math.round(h * 0.18)}px ${FONT}`;
  g.fillText('PULL TO OPEN', x + 108, y + h * 0.66);
  g.restore();
}

function danger(g: CanvasRenderingContext2D, r: Rect): void {
  const [x, y, , h] = r;
  g.save();
  g.fillStyle = '#b8321f';
  for (let k = 0; k < 3; k++) {
    const ox = x + 12 + k * 26;
    g.beginPath();
    g.moveTo(ox, y + h * 0.15);
    g.lineTo(ox + 18, y + h * 0.15);
    g.lineTo(ox + 40, y + h * 0.5);
    g.lineTo(ox + 18, y + h * 0.85);
    g.lineTo(ox, y + h * 0.85);
    g.lineTo(ox + 22, y + h * 0.5);
    g.closePath();
    g.fill();
  }
  g.font = `700 ${Math.round(h * 0.36)}px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText('DANGER', x + 112, y + h * 0.4);
  g.font = `600 ${Math.round(h * 0.16)}px ${FONT}`;
  g.fillText('INTAKE SUCTION', x + 113, y + h * 0.72);
  g.restore();
}

function eject(g: CanvasRenderingContext2D, r: Rect): void {
  const [x, y, w, h] = r;
  g.save();
  g.beginPath();
  g.moveTo(x + w / 2, y + 8);
  g.lineTo(x + w - 8, y + h - 12);
  g.lineTo(x + 8, y + h - 12);
  g.closePath();
  g.fillStyle = '#c8412a';
  g.fill();
  g.beginPath();
  g.moveTo(x + w / 2, y + 30);
  g.lineTo(x + w - 28, y + h - 24);
  g.lineTo(x + 28, y + h - 24);
  g.closePath();
  g.fillStyle = '#f0f0ea';
  g.fill();
  g.fillStyle = '#1a1a1a';
  g.font = `700 22px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('EJECT', x + w / 2, y + h - 36);
  g.restore();
}

function unit(g: CanvasRenderingContext2D, r: Rect, text: string): void {
  const [x, y, w, h] = r;
  g.save();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h * 0.62)}px ${FONT}`;
  g.fillText(text, x + w / 2, y + h / 2 + 2, w - 8);
  g.restore();
}

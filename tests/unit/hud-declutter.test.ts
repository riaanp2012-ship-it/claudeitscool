import { describe, expect, it } from 'vitest';
import {
  LABEL_ABOVE,
  LABEL_BELOW,
  LABEL_LEFT,
  LABEL_RIGHT,
  ORDER_CALLSIGN,
  ORDER_INFO,
  addBox,
  candidateSpot,
  createBoxList,
  overlapsAny,
  placeLabel,
  sortIndices,
} from '../../src/hud/declutter';

const W = 1920;
const H = 1080;

describe('label boxes', () => {
  it('detects overlap and ignores boxes beyond capacity', () => {
    const b = createBoxList(2);
    addBox(b, 0, 0, 10, 10);
    expect(overlapsAny(b, 5, 5, 15, 15)).toBe(true);
    expect(overlapsAny(b, 10, 0, 20, 10)).toBe(false); // touching edges do not overlap
    addBox(b, 100, 100, 110, 110);
    addBox(b, 200, 200, 210, 210);
    expect(b.count).toBe(2);
  });
});

describe('placeLabel', () => {
  it('prefers below, then above, right, left', () => {
    const b = createBoxList(16);
    const spot = { x: 0, y: 0 };
    expect(placeLabel(b, 500, 500, 10, 40, 16, 3, 0, 0, W, H, spot)).toBe(LABEL_BELOW);
    expect(spot).toEqual({ x: 480, y: 513 });
    expect(placeLabel(b, 500, 500, 10, 40, 16, 3, 0, 0, W, H, spot)).toBe(LABEL_ABOVE);
    expect(placeLabel(b, 500, 500, 10, 40, 16, 3, 0, 0, W, H, spot)).toBe(LABEL_RIGHT);
    expect(placeLabel(b, 500, 500, 10, 40, 16, 3, 0, 0, W, H, spot)).toBe(LABEL_LEFT);
    expect(placeLabel(b, 500, 500, 10, 40, 16, 3, 0, 0, W, H, spot)).toBe(-1);
  });

  it('never places two labels on top of each other in a dense cluster', () => {
    const b = createBoxList(256);
    const spot = { x: 0, y: 0 };
    const placed: [number, number, number, number][] = [];
    // 30 symbols packed in a 120 px square.
    for (let i = 0; i < 30; i++) {
      const sx = 900 + ((i * 37) % 120);
      const sy = 500 + ((i * 53) % 120);
      addBox(b, sx - 9, sy - 9, sx + 9, sy + 9);
    }
    for (let i = 0; i < 30; i++) {
      const sx = 900 + ((i * 37) % 120);
      const sy = 500 + ((i * 53) % 120);
      if (placeLabel(b, sx, sy, 9, 44, 16, 3, 0, 0, W, H, spot) >= 0)
        placed.push([spot.x, spot.y, spot.x + 44, spot.y + 16]);
    }
    expect(placed.length).toBeGreaterThan(0);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const c = placed[j]!;
        const hit = a[0] < c[2] && a[2] > c[0] && a[1] < c[3] && a[3] > c[1];
        expect(hit).toBe(false);
      }
    }
  });

  it('keeps labels on screen', () => {
    const b = createBoxList(8);
    const spot = { x: 0, y: 0 };
    // Symbol at the bottom-left corner: below and left are off-screen, above fits.
    expect(placeLabel(b, 40, H - 5, 9, 60, 16, 3, 0, 0, W, H, spot)).toBe(LABEL_ABOVE);
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.y + 16).toBeLessThanOrEqual(H);
    // Tucked into the corner, no candidate fits on screen: the label is dropped.
    expect(placeLabel(b, 3, H - 3, 9, 60, 16, 3, 0, 0, W, H, spot)).toBe(-1);
  });

  it('honors a custom candidate order', () => {
    const b = createBoxList(8);
    const spot = { x: 0, y: 0 };
    expect(placeLabel(b, 500, 500, 20, 50, 18, 2, 0, 0, W, H, spot, ORDER_CALLSIGN)).toBe(LABEL_ABOVE);
    expect(placeLabel(b, 500, 500, 20, 80, 34, 8, 0, 0, W, H, spot, ORDER_INFO)).toBe(LABEL_RIGHT);
    candidateSpot(LABEL_RIGHT, 500, 500, 20, 80, 34, 8, spot);
    expect(spot).toEqual({ x: 528, y: 483 });
  });
});

describe('sortIndices', () => {
  it('orders by key with non-finite keys last, stably', () => {
    const keys = new Float32Array([500, Infinity, 100, 300, 100, Number.NaN]);
    const out = new Int32Array(6);
    sortIndices(keys, 6, out);
    expect(Array.from(out)).toEqual([2, 4, 3, 0, 1, 5]);
  });
});

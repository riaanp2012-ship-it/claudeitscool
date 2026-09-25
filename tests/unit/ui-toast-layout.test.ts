import { describe, expect, it } from 'vitest';
import { ToastQueue } from '../../src/ui/toast-queue';
import { computeLayout, placeTooltip } from '../../src/ui/layout-math';

describe('ToastQueue', () => {
  it('keeps at most three toasts and evicts the oldest first', () => {
    const q = new ToastQueue(3, { info: 1000, warn: 2000, success: 1000 });
    q.push('a', 'info', 0);
    q.push('b', 'info', 10);
    q.push('c', 'warn', 20);
    const r = q.push('d', 'success', 30);
    expect(q.items.map((t) => t.text)).toEqual(['b', 'c', 'd']);
    expect(r.evicted.map((t) => t.text)).toEqual(['a']);
  });

  it('refreshes a duplicate instead of stacking it', () => {
    const q = new ToastQueue(3, { info: 1000, warn: 2000, success: 1000 });
    q.push('Saved', 'success', 0);
    const again = q.push('Saved', 'success', 500);
    expect(again.refreshed).toBe(true);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]!.expires).toBe(1500);
  });

  it('expires by kind lifetime and reports the next expiry', () => {
    const q = new ToastQueue(3, { info: 1000, warn: 2000, success: 1000 });
    q.push('info', 'info', 0);
    q.push('warn', 'warn', 0);
    expect(q.nextExpiry()).toBe(1000);
    expect(q.expire(999)).toHaveLength(0);
    expect(q.expire(1000).map((t) => t.text)).toEqual(['info']);
    expect(q.items.map((t) => t.text)).toEqual(['warn']);
    expect(q.remove(q.items[0]!.id)).toBe(true);
    expect(q.nextExpiry()).toBeNull();
  });
});

describe('computeLayout', () => {
  it('keeps 1:1 at and below the reference size', () => {
    expect(computeLayout(1920, 1080, 1).zoom).toBe(1);
    expect(computeLayout(1280, 720, 1).zoom).toBe(1);
    expect(computeLayout(1024, 768, 1).zoom).toBe(1);
  });

  it('zooms up on large screens so proportions hold', () => {
    expect(computeLayout(3840, 2160, 1).zoom).toBe(2);
    expect(computeLayout(2560, 1440, 1).zoom).toBeCloseTo(1.333, 3);
  });

  it('centers a 16:9 frame on ultrawide screens', () => {
    const l = computeLayout(2560, 1080, 1);
    expect(l.zoom).toBe(1);
    expect(l.frameWidth).toBeCloseTo(1920);
    expect(l.frameLeft).toBeCloseTo(320);
    const u = computeLayout(3440, 1440, 1);
    expect(u.frameWidth / u.height).toBeCloseTo(16 / 9);
  });

  it('uses the whole width on 4:3', () => {
    const l = computeLayout(1024, 768, 1);
    expect(l.frameWidth).toBe(1024);
    expect(l.frameLeft).toBe(0);
    expect(l.narrow).toBe(true);
  });

  it('applies the UI scale but never shrinks the layout below the minimum box', () => {
    const big = computeLayout(1920, 1080, 1.4);
    expect(big.zoom).toBeCloseTo(1.4);
    const small = computeLayout(1280, 720, 1.4);
    expect(small.width).toBeGreaterThanOrEqual(1024 - 1e-6);
    expect(small.height).toBeGreaterThanOrEqual(600 - 1e-6);
    expect(computeLayout(1920, 1080, 0.8).zoom).toBeCloseTo(0.8);
  });

  it('flags compact and short heights', () => {
    expect(computeLayout(1280, 720, 1).compact).toBe(true);
    expect(computeLayout(1280, 720, 1).short).toBe(false);
    expect(computeLayout(1920, 1080, 1).compact).toBe(false);
    const small = computeLayout(960, 540, 1);
    expect(small.short).toBe(true);
    expect(small.height).toBeGreaterThanOrEqual(600 - 1e-6);
    expect(small.width).toBeGreaterThanOrEqual(1024 - 1e-6);
  });
});

describe('placeTooltip', () => {
  const bounds = { width: 1280, height: 720 };

  it('prefers below the anchor, aligned to its left edge', () => {
    const r = placeTooltip(
      { left: 100, top: 100, width: 200, height: 40 },
      { width: 240, height: 60 },
      bounds,
    );
    expect(r).toEqual({ left: 100, top: 148, side: 'below' });
  });

  it('flips above when there is no room below', () => {
    const r = placeTooltip(
      { left: 100, top: 660, width: 200, height: 40 },
      { width: 240, height: 60 },
      bounds,
    );
    expect(r.side).toBe('above');
    expect(r.top).toBe(592);
  });

  it('never leaves the screen horizontally', () => {
    const r = placeTooltip(
      { left: 1200, top: 100, width: 60, height: 40 },
      { width: 300, height: 60 },
      bounds,
    );
    expect(r.left + 300).toBeLessThanOrEqual(1280 - 8);
    const l = placeTooltip(
      { left: -50, top: 100, width: 60, height: 40 },
      { width: 300, height: 60 },
      bounds,
    );
    expect(l.left).toBe(8);
  });

  it('clamps vertically when the tip is taller than any gap', () => {
    const r = placeTooltip(
      { left: 10, top: 300, width: 60, height: 40 },
      { width: 100, height: 700 },
      bounds,
    );
    expect(r.top).toBeGreaterThanOrEqual(8);
  });
});

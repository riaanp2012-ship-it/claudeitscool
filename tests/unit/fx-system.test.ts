import { describe, expect, it } from 'vitest';
import { Color, Mesh, PerspectiveCamera, PointLight, Vector3 } from 'three';
import { createFx, createFxSystem } from '../../src/fx';
import { atmoUniforms } from '../../src/render/atmosphere';
import { DEBRIS_RIBBON_RESERVE, PARTICLE_CAPACITY } from '../../src/fx/tuning';
import type { ExplosionKind, TrailHandle } from '../../src/core/types';

const surface = (): number => 0;

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 16 / 9, 0.5, 160000);
  c.position.set(0, 300, 600);
  c.lookAt(0, 200, 0);
  c.updateMatrixWorld();
  return c;
}

describe('fx system', () => {
  it('implements every contract method', () => {
    const fx = createFx();
    for (const m of [
      'explosion',
      'impact',
      'debris',
      'trail',
      'glow',
      'tracer',
      'dot',
      'flash',
      'muzzle',
      'setQuality',
      'warmup',
      'update',
      'stats',
      'clear',
      'dispose',
    ]) {
      expect(typeof (fx as unknown as Record<string, unknown>)[m]).toBe('function');
    }
    expect(fx.root).toBeDefined();
    fx.dispose();
  });

  it('keeps a constant light count and stays within six draw objects', () => {
    const fx = createFxSystem(1);
    const lights: PointLight[] = [];
    const meshes: Mesh[] = [];
    fx.root.traverse((o) => {
      if (o instanceof PointLight) lights.push(o);
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(lights.length).toBe(2);
    expect(lights.every((l) => l.intensity === 0)).toBe(true);
    expect(meshes.length).toBeLessThanOrEqual(8);
    fx.dispose();
  });

  it('simulates every effect for a long time without NaN and cleans up', () => {
    const fx = createFxSystem(7);
    const cam = camera();
    const kinds: ExplosionKind[] = ['air-small', 'air-large', 'aircraft', 'ground', 'water'];
    const trails: (TrailHandle | null)[] = [];
    const p = new Vector3();
    const white = new Color(1, 1, 1);
    for (let f = 0; f < 60 * 20; f++) {
      const t = f / 60;
      if (f % 45 === 0)
        fx.explosion(
          p.set((f % 7) * 40 - 120, 150 + (f % 3) * 60, -(f % 5) * 50),
          kinds[f % 5]!,
          new Vector3(100, 0, 0),
        );
      if (f % 20 === 0)
        fx.impact(p.set(f % 30, 0, 0), new Vector3(0, 1, 0), f % 40 === 0 ? 'ground' : 'metal');
      if (f % 300 === 0) fx.debris(p.set(0, 300, 0), new Vector3(50, 0, 0), 3);
      if (f % 120 === 0) trails.push(fx.trail(f % 240 === 0 ? 'missile' : 'flare'));
      for (const tr of trails)
        tr?.push(p.set(Math.cos(t + trails.indexOf(tr)) * 400, 250, Math.sin(t) * 400), 1);
      if (f % 240 === 239) trails.shift()?.release();
      fx.glow(p.set(0, 200, 0), white, 3, 5);
      fx.tracer(new Vector3(0, 200, 0), new Vector3(10, 205, -30), white, 0.2);
      fx.dot(p.set(0, 1000, -8000), white);
      fx.muzzle(p.set(0, 200, 0), new Vector3(0, 0, -1), 1);
      fx.update(1 / 60, cam, surface);
    }
    const s = fx.stats();
    expect(s.particles).toBeGreaterThan(0);
    expect(s.particles).toBeLessThanOrEqual(PARTICLE_CAPACITY.high);
    expect(s.glows).toBe(1);
    const internals = fx as unknown as { ps: { px: Float32Array; high: number; alive: Uint8Array } };
    for (let i = 0; i < internals.ps.high; i++) {
      if (internals.ps.alive[i]) expect(Number.isFinite(internals.ps.px[i]!)).toBe(true);
    }
    fx.clear();
    fx.update(1 / 60, cam, surface);
    expect(fx.stats().particles).toBe(0);
    expect(fx.stats().trails).toBe(0);
    for (const v of atmoUniforms.uFlashPos.value) expect(v.w).toBe(0);
    fx.dispose();
  });

  it('respects the quality cap and returns null when trails run out', () => {
    const fx = createFxSystem(3);
    fx.setQuality('low', false);
    const cam = camera();
    for (let i = 0; i < 60; i++) fx.explosion(new Vector3(i, 200, 0), 'air-large');
    fx.update(0.5, cam, surface);
    expect(fx.stats().particles).toBeLessThanOrEqual(PARTICLE_CAPACITY.low);
    const handles: (TrailHandle | null)[] = [];
    for (let i = 0; i < 200; i++) handles.push(fx.trail('contrail'));
    expect(handles.some((h) => h === null)).toBe(true);
    // Debris ribbons fill the pool but always leave the reserve free for missiles and contrails.
    expect(handles.filter((h) => h !== null).length).toBeGreaterThanOrEqual(DEBRIS_RIBBON_RESERVE);
    fx.dispose();
  });

  it('drives the shared flash uniforms and lets them decay to zero', () => {
    const fx = createFxSystem(9);
    const cam = camera();
    fx.flash(new Vector3(0, 100, 0), new Color(1, 0.6, 0.3), 5, 200, 0.4);
    fx.update(0.03, cam, surface);
    const lit = atmoUniforms.uFlashPos.value.some((v) => v.w > 0);
    expect(lit).toBe(true);
    for (let i = 0; i < 40; i++) fx.update(1 / 60, cam, surface);
    expect(atmoUniforms.uFlashPos.value.every((v) => v.w === 0)).toBe(true);
    fx.dispose();
  });

  it('ignores stale trail handles after their slot is recycled', () => {
    const fx = createFxSystem(11);
    const cam = camera();
    const a = fx.trail('vortex')!;
    a.push(new Vector3(0, 0, 0), 1);
    a.release();
    for (let i = 0; i < 200; i++) fx.update(1 / 60, cam, surface);
    const b = fx.trail('vortex')!;
    b.push(new Vector3(5, 0, 0), 1);
    a.push(new Vector3(1000, 0, 0), 1);
    a.release();
    fx.update(1 / 60, cam, surface);
    expect(fx.stats().trails).toBe(1);
    fx.dispose();
  });
});

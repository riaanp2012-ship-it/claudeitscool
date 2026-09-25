import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import {
  GUN25_LOOP,
  GUN30_LOOP,
  brownNoise,
  crackleNoise,
  evalFourier,
  fourierSeries,
  gateClampCurve,
  gunLoop,
  periodicShape,
  pinkNoise,
  pulseAt,
  reverbImpulse,
  seamlessLoop,
  smoothNoise,
  softClipCurve,
  sonicBoomWave,
} from '../../src/audio/dsp';

const SR = 48000;
const maxAbs = (a: Float32Array): number => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
/** Largest sample-to-sample step, including the wrap from the end back to the start. */
function maxStep(a: Float32Array, wrap: boolean): { inner: number; seam: number } {
  let inner = 0;
  for (let i = 1; i < a.length; i++) inner = Math.max(inner, Math.abs(a[i]! - a[i - 1]!));
  return { inner, seam: wrap ? Math.abs(a[0]! - a[a.length - 1]!) : 0 };
}

describe('noise beds', () => {
  it('are deterministic for a seed', () => {
    expect(Array.from(pinkNoise(4096, new Rng(3)).slice(0, 64))).toEqual(
      Array.from(pinkNoise(4096, new Rng(3)).slice(0, 64)),
    );
  });

  it('are peak-normalized and loop without a seam', () => {
    for (const data of [pinkNoise(SR, new Rng(1)), brownNoise(SR, new Rng(2), SR)]) {
      expect(maxAbs(data)).toBeCloseTo(0.95, 5);
      const { inner, seam } = maxStep(data, true);
      expect(seam).toBeLessThanOrEqual(inner * 1.05);
    }
  });

  it('crossfades loops seamlessly', () => {
    const ramp = new Float32Array(1000).map((_, i) => i / 1000);
    const out = seamlessLoop(ramp, 100);
    expect(out.length).toBe(900);
    expect(Math.abs(out[0]! - ramp[900]!)).toBeLessThan(0.02);
  });

  it('smooth noise stays in range and loops', () => {
    const s = smoothNoise(SR, SR, 5, new Rng(4));
    expect(maxAbs(s)).toBeLessThanOrEqual(1);
    const { inner, seam } = maxStep(s, true);
    expect(seam).toBeLessThan(inner * 2 + 1e-6);
  });

  it('crackle is sparse', () => {
    const c = crackleNoise(SR, SR, 40, new Rng(5));
    let quiet = 0;
    for (const x of c) if (Math.abs(x) < 0.01) quiet++;
    expect(quiet / c.length).toBeGreaterThan(0.5);
  });
});

describe('gun loops', () => {
  it('hold an integer number of rounds at the fire rate and never clip', () => {
    for (const spec of [GUN25_LOOP, GUN30_LOOP]) {
      const loop = gunLoop(spec, SR, new Rng(6));
      expect(loop.length).toBe(Math.round(SR / spec.rate) * spec.rounds);
      expect(maxAbs(loop)).toBeCloseTo(0.9, 5);
    }
  });

  it('25 mm fires faster than 30 mm', () => {
    expect(GUN25_LOOP.rate).toBeGreaterThan(55);
    expect(GUN30_LOOP.rate).toBeLessThan(32);
  });
});

describe('one-shot buffers and curves', () => {
  it('sonic boom starts and ends at zero', () => {
    const b = sonicBoomWave(SR, new Rng(7));
    expect(b[0]).toBe(0);
    expect(Math.abs(b[b.length - 1]!)).toBeLessThan(1e-3);
    expect(maxAbs(b)).toBeCloseTo(0.95, 5);
  });

  it('reverb impulse decays to silence', () => {
    const [l, r] = reverbImpulse(SR, 1.5, new Rng(8), 0.3);
    expect(Math.abs(l[l.length - 1]!)).toBeLessThan(1e-3);
    expect(Math.abs(r[0]!)).toBe(0);
  });

  it('soft clip is linear below the knee and never exceeds the ceiling', () => {
    const c = softClipCurve(4097, 2, 0.72, 0.975);
    const at = (x: number) => c[Math.round(((x / 2 + 1) / 2) * 4096)]!;
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.3)).toBeCloseTo(-0.3, 3);
    expect(maxAbs(c)).toBeLessThanOrEqual(0.975);
    expect(at(2)).toBeGreaterThan(0.95);
  });

  it('gate clamp has a dead zone at both ends', () => {
    const c = gateClampCurve(2049, 0.02);
    expect(c[1024]).toBe(0);
    expect(c[2048]).toBe(1);
    expect(c[Math.round(1024 * 1.01)]).toBe(0);
  });
});

describe('Fourier gate patterns', () => {
  it('reproduce a smooth pulse shape with little ripple', () => {
    const pulses = [[0.04, 0.54]] as const;
    const shape = periodicShape(4096, (u) => pulseAt(u, pulses, 0.07));
    const f = fourierSeries(shape, 64);
    expect(f.mean).toBeCloseTo(0.43, 2);
    for (let i = 0; i < 200; i++) {
      const u = i / 200;
      const v = evalFourier(f.real, f.imag, u) + f.mean;
      expect(Math.abs(v - pulseAt(u, pulses, 0.07))).toBeLessThan(0.08);
    }
    // Deep in the off region the gate is essentially closed (the clamp removes the rest).
    expect(Math.abs(evalFourier(f.real, f.imag, 0.8) + f.mean)).toBeLessThan(0.02);
  });
});

import type { Rng } from '../core/rng';

/** Sample data backed by a plain ArrayBuffer (what AudioBuffer and WaveShaperNode accept). */
export type Samples = Float32Array<ArrayBuffer>;

/**
 * Offline DSP that fills Float32Arrays: noise beds, crackle, gun loops, the sonic-boom N-wave, reverb impulse
 * responses and waveshaper curves. Pure functions of (sample rate, seeded Rng), so buffers are reproducible
 * and testable in Node. Everything here runs once at startup, never per frame.
 */

/** Direct-form biquad (RBJ cookbook) for offline synthesis. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  /** Constant 0 dB peak gain bandpass. */
  bandpass(freq: number, q: number, sampleRate: number): this {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    return this.set(alpha, 0, -alpha, 1 + alpha, -2 * Math.cos(w), 1 - alpha);
  }

  lowpass(freq: number, q: number, sampleRate: number): this {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
  }

  highpass(freq: number, q: number, sampleRate: number): this {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Scales so the largest absolute sample equals `peak`. */
export function normalizePeak<T extends Float32Array>(data: T, peak: number): T {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]!));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < data.length; i++) data[i] = data[i]! * k;
  }
  return data;
}

/** Removes the mean so a looped buffer carries no DC offset. */
export function removeDc<T extends Float32Array>(data: T): T {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i]!;
  const mean = s / Math.max(1, data.length);
  for (let i = 0; i < data.length; i++) data[i] = data[i]! - mean;
  return data;
}

/**
 * Makes a buffer loop without a seam: the last `fade` samples are cross-faded (equal power) into the start and
 * dropped, so the sample after the final one continues naturally into the first.
 */
export function seamlessLoop(src: Float32Array, fade: number): Samples {
  const f = Math.max(1, Math.min(fade, Math.floor(src.length / 2)));
  const n = src.length - f;
  const out = new Float32Array(n);
  out.set(src.subarray(f, n), f);
  for (let i = 0; i < f; i++) {
    const t = (i + 0.5) / f;
    const a = Math.sin((t * Math.PI) / 2);
    const b = Math.cos((t * Math.PI) / 2);
    out[i] = src[i]! * a + src[n + i]! * b;
  }
  return out;
}

export function whiteNoise(n: number, rng: Rng): Samples {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Pink (-3 dB/oct) noise, Paul Kellet's refined filter, loop-safe and peak normalized. */
export function pinkNoise(n: number, rng: Rng, fade = 2048): Samples {
  const raw = new Float32Array(n + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalizePeak(removeDc(seamlessLoop(raw, fade)), 0.95);
}

/** Brown (-6 dB/oct) noise from a leaky integrator, high-passed at ~20 Hz, loop-safe and peak normalized. */
export function brownNoise(n: number, rng: Rng, sampleRate: number, fade = 4096): Samples {
  const raw = new Float32Array(n + fade);
  const hp = new Biquad().highpass(22, 0.7, sampleRate);
  let y = 0;
  for (let i = 0; i < raw.length; i++) {
    y = y * 0.996 + (rng.next() * 2 - 1) * 0.06;
    raw[i] = hp.process(y);
  }
  return normalizePeak(removeDc(seamlessLoop(raw, fade)), 0.95);
}

/**
 * Smooth random control signal in [-1, 1] (cosine-interpolated value noise) with about `rateHz` new values
 * per second. The last segment interpolates back to the first value, so it loops seamlessly.
 */
export function smoothNoise(n: number, sampleRate: number, rateHz: number, rng: Rng): Samples {
  const points = Math.max(2, Math.round((n * rateHz) / sampleRate));
  const values = new Float32Array(points);
  for (let i = 0; i < points; i++) values[i] = rng.next() * 2 - 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * points) / n;
    const k = Math.floor(pos);
    const frac = pos - k;
    const a = values[k % points]!;
    const b = values[(k + 1) % points]!;
    const w = (1 - Math.cos(frac * Math.PI)) / 2;
    out[i] = a + (b - a) * w;
  }
  return out;
}

/**
 * Sparse crackle: short decaying noise pops at random times (Poisson, `density` per second) with a heavy-tailed
 * amplitude spread (a few loud pops, many small ones). Pops wrap around the end, so the buffer loops.
 */
export function crackleNoise(n: number, sampleRate: number, density: number, rng: Rng): Samples {
  const out = new Float32Array(n);
  const events = Math.max(1, Math.round((density * n) / sampleRate));
  for (let e = 0; e < events; e++) {
    const pos = Math.floor(rng.next() * n);
    const amp = 0.15 + 0.85 * Math.pow(rng.next(), 3);
    const len = Math.floor(sampleRate * (0.0006 + 0.004 * rng.next()));
    const tau = len / 4;
    let lp = 0;
    const smooth = 0.2 + 0.7 * rng.next();
    for (let i = 0; i < len; i++) {
      lp += (rng.next() * 2 - 1 - lp) * smooth;
      const attack = Math.min(1, i / 6);
      const idx = (pos + i) % n;
      out[idx] = out[idx]! + lp * amp * attack * Math.exp(-i / tau);
    }
  }
  return normalizePeak(removeDc(out), 0.95);
}

export interface GunLoopSpec {
  /** Rounds per second. */
  rate: number;
  /** Rounds in the loop (an integer so the loop is exactly periodic in rounds). */
  rounds: number;
  /** Timing jitter as a fraction of the round period. */
  jitter: number;
  crackTau: number;
  bodyFreq: number;
  bodyTau: number;
  thumpStart: number;
  thumpEnd: number;
  thumpTau: number;
  mechFreq: number;
  /** How long each round rings (s); tails wrap into the next rounds. */
  length: number;
  mix: { crack: number; body: number; thump: number; mech: number };
}

/** 25 mm rotary: fast, tight, bright "brrrt". */
export const GUN25_LOOP: GunLoopSpec = {
  rate: 60,
  rounds: 36,
  jitter: 0.035,
  crackTau: 0.0011,
  bodyFreq: 1250,
  bodyTau: 0.0055,
  thumpStart: 190,
  thumpEnd: 72,
  thumpTau: 0.013,
  mechFreq: 3400,
  length: 0.06,
  mix: { crack: 0.7, body: 0.9, thump: 0.85, mech: 0.22 },
};

/** 30 mm revolver: slower, heavier rounds with a deep chest thump. */
export const GUN30_LOOP: GunLoopSpec = {
  rate: 28,
  rounds: 20,
  jitter: 0.025,
  crackTau: 0.0016,
  bodyFreq: 820,
  bodyTau: 0.011,
  thumpStart: 150,
  thumpEnd: 48,
  thumpTau: 0.032,
  mechFreq: 2600,
  length: 0.12,
  mix: { crack: 0.75, body: 0.85, thump: 1.1, mech: 0.3 },
};

/**
 * A seamless gun loop: `rounds` individually varied shots (crack + resonant body + pitch-dropping thump +
 * mechanism tick) at the fire rate. The periodic transients give the gritty buzz at the fire rate.
 */
export function gunLoop(spec: GunLoopSpec, sampleRate: number, rng: Rng): Samples {
  const period = Math.round(sampleRate / spec.rate);
  const n = period * spec.rounds;
  const out = new Float32Array(n);
  const len = Math.floor(spec.length * sampleRate);
  const body = new Biquad();
  const mech = new Biquad();
  const crackHp = new Biquad();
  for (let k = 0; k < spec.rounds; k++) {
    const start = k * period + Math.round((rng.next() * 2 - 1) * spec.jitter * period);
    const amp = 0.8 + 0.35 * rng.next();
    const bodyF = spec.bodyFreq * (0.88 + 0.24 * rng.next());
    body.bandpass(bodyF, 1.3, sampleRate).reset();
    mech.bandpass(spec.mechFreq * (0.9 + 0.2 * rng.next()), 7, sampleRate).reset();
    crackHp.highpass(1800, 0.7, sampleRate).reset();
    const thumpScale = 0.85 + 0.3 * rng.next();
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      const w = rng.next() * 2 - 1;
      const attack = 1 - Math.exp(-t / 0.00025);
      const crack = crackHp.process(w) * Math.exp(-t / spec.crackTau) * spec.mix.crack;
      const bod = body.process(w) * Math.exp(-t / spec.bodyTau) * spec.mix.body * 2.2;
      const f = spec.thumpEnd + (spec.thumpStart - spec.thumpEnd) * Math.exp(-t / 0.006);
      phase += (2 * Math.PI * f) / sampleRate;
      const thump = Math.sin(phase) * Math.exp(-t / spec.thumpTau) * spec.mix.thump * thumpScale;
      const mec = mech.process(w) * Math.exp(-t / 0.003) * spec.mix.mech * 3;
      const idx = (((start + i) % n) + n) % n;
      out[idx] = out[idx]! + (crack + bod + thump + mec) * attack * amp;
    }
  }
  return normalizePeak(removeDc(out), 0.9);
}

/**
 * Sonic boom: a rounded N-wave (front shock, linear expansion, rear shock) with its ground reflection a few ms
 * later, followed by a low rolling rumble. Starts at exactly zero.
 */
export function sonicBoomWave(sampleRate: number, rng: Rng): Samples {
  const dur = 2.2;
  const n = Math.floor(dur * sampleRate);
  const nw = new Float32Array(n);
  const T = 0.1 + 0.05 * rng.next();
  // Shock rise time: turbulence rounds real booms to several ms at the ground (and it keeps the start click-free).
  const rise = 0.006;
  const lead = Math.floor(0.004 * sampleRate);
  for (let i = 0; i < n; i++) {
    const t = (i - lead) / sampleRate;
    let v = 0;
    if (t >= 0 && t < rise) v = t / rise;
    else if (t >= rise && t < T) v = 1 - (2 * (t - rise)) / (T - rise);
    else if (t >= T && t < T + rise) v = -1 + (t - T) / rise;
    nw[i] = v;
  }
  // Ground reflection and atmospheric rounding.
  const refl = Math.floor((0.008 + 0.01 * rng.next()) * sampleRate);
  const out = new Float32Array(n);
  const lp = new Biquad().lowpass(2400, 0.6, sampleRate);
  for (let i = 0; i < n; i++) {
    const r = i >= refl ? nw[i - refl]! * 0.55 : 0;
    out[i] = lp.process(nw[i]! + r);
  }
  // Rolling rumble tail (echoes off terrain).
  const rumbleLp = new Biquad().lowpass(160, 0.7, sampleRate);
  let y = 0;
  const tailStart = Math.floor((T + 0.03) * sampleRate);
  for (let i = tailStart; i < n; i++) {
    const t = (i - tailStart) / sampleRate;
    y = y * 0.995 + (rng.next() * 2 - 1) * 0.08;
    const env = Math.min(1, t / 0.08) * Math.exp(-t / 0.45);
    out[i] = out[i]! + rumbleLp.process(y) * env * 0.9;
  }
  // Fade the very end to silence.
  const fadeN = Math.floor(0.05 * sampleRate);
  for (let i = 0; i < fadeN; i++) out[n - 1 - i] = out[n - 1 - i]! * (i / fadeN);
  out[0] = 0;
  return normalizePeak(out, 0.95);
}

/**
 * Stereo reverb impulse response: sparse early reflections, then decorrelated noise with an exponential decay
 * (-60 dB at `seconds`) that darkens over time. Starts and ends at zero.
 */
export function reverbImpulse(
  sampleRate: number,
  seconds: number,
  rng: Rng,
  brightness: number,
  predelay = 0.012,
): [Samples, Samples] {
  const n = Math.floor(seconds * sampleRate);
  const pre = Math.floor(predelay * sampleRate);
  const make = (): Samples => {
    const out = new Float32Array(n);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      const decay = Math.exp((-6.9 * t) / seconds);
      // One-pole lowpass whose cutoff falls as the tail ages (air and surfaces absorb highs first).
      const k = Math.min(0.98, brightness * Math.exp(-t * 2.2) + 0.04);
      lp += (rng.next() * 2 - 1 - lp) * k;
      const fadeIn = Math.min(1, t / 0.004);
      out[i] = lp * decay * fadeIn;
    }
    for (let r = 0; r < 7; r++) {
      const idx = pre + Math.floor((0.003 + 0.05 * rng.next()) * sampleRate);
      if (idx < n) out[idx] = out[idx]! + (rng.next() * 2 - 1) * 0.5 * Math.exp(-r * 0.3);
    }
    const fadeN = Math.min(n, Math.floor(0.03 * sampleRate));
    for (let i = 0; i < fadeN; i++) out[n - 1 - i] = out[n - 1 - i]! * (i / fadeN);
    return normalizePeak(out, 0.9);
  };
  return [make(), make()];
}

/**
 * Soft ceiling for the master output. The shaper input spans ±`range` (the caller pre-scales by 1/range);
 * below `knee` the curve is exactly linear, above it bends smoothly (tanh) toward `ceiling`, never beyond.
 */
export function softClipCurve(n: number, range: number, knee: number, ceiling: number): Samples {
  const out = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (-1 + (2 * i) / (n - 1)) * range;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span);
    out[i] = x < 0 ? -y : y;
  }
  return out;
}

/** Mild symmetric saturation curve (tanh) for grit, normalized so ±1 maps to ±1. */
export function saturationCurve(n: number, drive: number): Samples {
  const out = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = -1 + (2 * i) / (n - 1);
    out[i] = Math.tanh(x * drive) / norm;
  }
  return out;
}

/**
 * Trapezoid pulse train over one period: `pulses` are [start, end] positions (period fractions, 0..1) with
 * linear edges `edge` wide. Returns the gate value (0..1) at position `u`.
 */
export function pulseAt(u: number, pulses: readonly (readonly [number, number])[], edge: number): number {
  let v = 0;
  for (let i = 0; i < pulses.length; i++) {
    const p = pulses[i]!;
    const a = p[0];
    const b = p[1];
    if (u <= a || u >= b) continue;
    v = Math.max(v, Math.min(1, (u - a) / edge, (b - u) / edge));
  }
  return v;
}

/** Samples one period of `fn` (u = i / n, 0 ≤ u < 1). */
export function periodicShape(n: number, fn: (u: number) => number): Samples {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / n);
  return out;
}

export interface FourierSeries {
  real: Samples;
  imag: Samples;
  /** DC term, which PeriodicWave ignores; add it back with a ConstantSourceNode. */
  mean: number;
}

/**
 * Fourier series of one sampled period, Lanczos-smoothed so edges ring as little as possible. Played by an
 * OscillatorNode (PeriodicWave, normalization disabled) it reproduces the shape minus its mean, starting at
 * u = 0 when the oscillator starts. Used for smooth periodic gates and pitch contours: unlike a sawtooth LFO
 * through a shaper, a smooth target shape has no reset that sweeps back through the curve.
 */
export function fourierSeries(shape: Float32Array, harmonics: number): FourierSeries {
  const n = shape.length;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += shape[i]!;
  mean /= n;
  for (let k = 1; k <= harmonics; k++) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      const w = (2 * Math.PI * k * i) / n;
      a += shape[i]! * Math.cos(w);
      b += shape[i]! * Math.sin(w);
    }
    const x = (Math.PI * k) / (harmonics + 1);
    const sigma = Math.sin(x) / x;
    real[k] = ((2 * a) / n) * sigma;
    imag[k] = ((2 * b) / n) * sigma;
  }
  return { real, imag, mean };
}

/**
 * Dead-zone clamp for gate signals: maps [-1, 1] to [0, 1], with everything below `lo` exactly 0 and above
 * `1 - lo` exactly 1, so the small ripple of a band-limited gate never leaks a tone through.
 */
export function gateClampCurve(n: number, lo: number): Samples {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = -1 + (2 * i) / (n - 1);
    out[i] = Math.min(1, Math.max(0, (x - lo) / (1 - 2 * lo)));
  }
  return out;
}

/** Evaluates a PeriodicWave-style Fourier series at phase p (0..1); used by tests to check the LFO shape. */
export function evalFourier(real: Float32Array, imag: Float32Array, p: number): number {
  let v = 0;
  for (let k = 1; k < real.length; k++) {
    const w = 2 * Math.PI * k * p;
    v += real[k]! * Math.cos(w) + imag[k]! * Math.sin(w);
  }
  return v;
}

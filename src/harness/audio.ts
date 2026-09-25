import { Quaternion, Vector3 } from 'three';
import { AudioCore } from '../audio/core';
import { Rng } from '../core/rng';
import type { CockpitTones, EngineParams, SfxId } from '../core/types';

/**
 * Offline audio verification (spec §2.6 for ears): renders every SFX and a set of engine, gun, tone, music and
 * mix scenarios through the real AudioCore in an OfflineAudioContext, measures peak / RMS / edge clicks, runs
 * scenario-specific checks (doppler, panning, pause, limiter, calibration) and draws waveform + spectrogram.
 */

const SR = 48000;
const QUANTUM = 128;
const FRAME = 1 / 60;

interface Check {
  label: string;
  value: number;
  pass: boolean;
}

interface Harness {
  core: AudioCore;
  ctx: OfflineAudioContext;
  at(t: number, fn: () => void): void;
  frame(fn: (t: number, dt: number) => void): void;
}

interface Scenario {
  name: string;
  duration: number;
  /** Full master chain (compressor, limiter, ceiling). Default off: measure the dry patch. */
  dynamics?: boolean;
  /** Minimum loudest-20ms-window RMS (dBFS) to count as audible. */
  minActiveDb?: number;
  setup(h: Harness): void;
  checks?(data: Rendered): Check[];
}

interface Rendered {
  left: Float32Array;
  right: Float32Array;
  updateMs: number[];
}

interface Result {
  name: string;
  peakDb: number;
  rmsDb: number;
  activeDb: number;
  startRatio: number;
  endMax: number;
  clicks: number;
  clickTimes: number[];
  checks: Check[];
  pass: boolean;
  fails: string[];
  wave: Float32Array;
  spec: Float32Array[];
  updateAvgMs: number;
  updateMaxMs: number;
}

const origin = new Vector3();
const identity = new Quaternion();
const still = new Vector3();
const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -200);
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────── rendering

async function render(s: Scenario): Promise<Rendered> {
  const length = Math.ceil(s.duration * SR);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: SR });
  const core = new AudioCore(ctx, {
    dynamics: s.dynamics ?? false,
    rng: new Rng(seedOf(s.name)),
    lookahead: 0,
    volumes: { master: 1, music: 1, effects: 1, radio: 1, ui: 1 },
  });
  core.setListener(origin, identity, still);
  // Make the context load its HRTF database before rendering starts, not when the first panner appears mid-render.
  const warm = new PannerNode(ctx, { panningModel: 'HRTF' });
  const warmGain = new GainNode(ctx, { gain: 0 });
  warm.connect(warmGain).connect(ctx.destination);
  const events = new Map<number, (() => void)[]>();
  const at = (t: number, fn: () => void): void => {
    const q = Math.max(0, Math.round((t * SR) / QUANTUM));
    const list = events.get(q);
    if (list) list.push(fn);
    else events.set(q, [fn]);
  };
  let frameFn: ((t: number, dt: number) => void) | null = null;
  s.setup({ core, ctx, at, frame: (fn) => (frameFn = fn) });

  // A frame loop (60 Hz) that drives the scenario and then core.update, timing update() like the game would.
  const updateMs: number[] = [];
  let lastT = 0;
  const tick = (t: number): void => {
    const dt = t - lastT;
    lastT = t;
    frameFn?.(t, dt);
    const t0 = performance.now();
    core.update(dt);
    updateMs.push(performance.now() - t0);
  };
  for (let t = 0; t < s.duration - 0.005; t += FRAME) {
    const q = Math.round((t * SR) / QUANTUM);
    at(t, () => tick((q * QUANTUM) / SR));
  }
  const q0 = events.get(0);
  if (q0) for (const fn of q0) fn();
  events.delete(0);
  for (const [q, fns] of events) {
    // Half a sample past the quantum boundary so float rounding can never land on the previous quantum.
    const t = (q * QUANTUM + 0.5) / SR;
    if (t >= s.duration) continue;
    ctx.suspend(t).then(
      () => {
        for (const fn of fns) fn();
        return ctx.resume();
      },
      () => undefined,
    );
  }
  const buf = await ctx.startRendering();
  core.dispose();
  return { left: buf.getChannelData(0), right: buf.getChannelData(1), updateMs };
}

// ─────────────────────────────────────────────────────────────── analysis

/**
 * Abrupt onsets from silence: the signal jumps above 0.06 within 0.25 ms after at least 2 ms below -66 dBFS.
 * Scanned forward (clicks on start) and reversed (clicks on stop). Returns the times (s) of the first hits.
 */
function findClicks(x: Float32Array, out: number[]): void {
  const scan = (dir: 1 | -1): void => {
    let run = 0;
    let onset = -100000;
    const n = x.length;
    for (let k = 0; k < n; k++) {
      const i = dir === 1 ? k : n - 1 - k;
      const a = Math.abs(x[i]!);
      if (a < 5e-4) run++;
      else {
        if (run >= 96) onset = k;
        run = 0;
      }
      if (k - onset <= 12 && a > 0.06) {
        out.push(i / SR);
        onset = -100000;
      }
    }
  };
  scan(1);
  scan(-1);
}

function windowRms(x: Float32Array, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * SR));
  const b = Math.min(x.length, Math.floor(to * SR));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return b > a ? Math.sqrt(s / (b - a)) : 0;
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const N_FFT = 2048;
const hann = new Float32Array(N_FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1)));

/** Magnitude spectrum (dB re full-scale sine) of the frame centred at sample `c`. */
function spectrum(x: Float32Array, c: number): Float32Array {
  const re = new Float32Array(N_FFT);
  const im = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    const idx = c - N_FFT / 2 + i;
    re[i] = idx >= 0 && idx < x.length ? x[idx]! * hann[i]! : 0;
  }
  fft(re, im);
  const out = new Float32Array(N_FFT / 2);
  for (let k = 0; k < N_FFT / 2; k++) out[k] = db(Math.hypot(re[k]!, im[k]!) / (N_FFT / 4));
  return out;
}

/** Power-weighted spectral centroid (Hz) over a time window. */
function centroid(x: Float32Array, from: number, to: number): number {
  let num = 0;
  let den = 0;
  for (let t = from; t < to; t += 0.05) {
    const s = spectrum(x, Math.floor(t * SR));
    for (let k = 2; k < s.length; k++) {
      const p = Math.pow(10, s[k]! / 10);
      num += p * ((k * SR) / N_FFT);
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

const WAVE_COLS = 250;
const SPEC_COLS = 125;
const SPEC_ROWS = 60;
const F_LO = 30;
const F_HI = 20000;

function analyze(s: Scenario, r: Rendered): Result {
  const { left, right } = r;
  const n = left.length;
  const mono = new Float32Array(n);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i]!;
    const rr = right[i]!;
    mono[i] = (l + rr) / 2;
    peak = Math.max(peak, Math.abs(l), Math.abs(rr));
    sum += l * l + rr * rr;
  }
  const rms = Math.sqrt(sum / (2 * n));
  let active = 0;
  const win = Math.floor(0.02 * SR);
  for (let i = 0; i + win <= n; i += win) {
    let w = 0;
    for (let k = i; k < i + win; k++) w += left[k]! * left[k]! + right[k]! * right[k]!;
    active = Math.max(active, Math.sqrt(w / (2 * win)));
  }
  const edge = (from: number, to: number): number => {
    let m = 0;
    for (let i = Math.max(0, from); i < Math.min(n, to); i++)
      m = Math.max(m, Math.abs(left[i]!), Math.abs(right[i]!));
    return m;
  };
  // Onset rise: the first 0.5 ms after the sound begins must stay small relative to the first 6 ms, which is
  // what a >= 5 ms gain ramp guarantees (a hard start would already be near full level).
  let onsetIdx = 0;
  while (onsetIdx < n && Math.abs(left[onsetIdx]!) <= 1e-4 && Math.abs(right[onsetIdx]!) <= 1e-4) onsetIdx++;
  const early = edge(onsetIdx, onsetIdx + Math.floor(0.0005 * SR));
  const later = edge(onsetIdx, onsetIdx + Math.floor(0.006 * SR));
  const startRatio = later > 1e-3 ? early / later : 0;
  const endMax = edge(n - Math.floor(0.005 * SR), n);
  const clickTimes: number[] = [];
  findClicks(left, clickTimes);
  findClicks(right, clickTimes);
  const clicks = clickTimes.length;
  const checks = s.checks ? s.checks(r) : [];
  const fails: string[] = [];
  if (peak > 0.98) fails.push('peak');
  if (db(active) < (s.minActiveDb ?? -50)) fails.push('silent');
  if (startRatio > 0.25) fails.push('start');
  if (endMax > 0.002) fails.push('end');
  if (clicks > 0) fails.push('click');
  for (const c of checks) if (!c.pass) fails.push(c.label);

  const wave = new Float32Array(WAVE_COLS * 2);
  for (let c = 0; c < WAVE_COLS; c++) {
    const a = Math.floor((c * n) / WAVE_COLS);
    const b = Math.floor(((c + 1) * n) / WAVE_COLS);
    let lo = 0;
    let hi = 0;
    for (let i = a; i < b; i++) {
      lo = Math.min(lo, mono[i]!);
      hi = Math.max(hi, mono[i]!);
    }
    wave[c * 2] = lo;
    wave[c * 2 + 1] = hi;
  }
  const spec: Float32Array[] = [];
  for (let c = 0; c < SPEC_COLS; c++) {
    const center = Math.floor(((c + 0.5) * n) / SPEC_COLS);
    const full = spectrum(mono, center);
    const col = new Float32Array(SPEC_ROWS);
    for (let row = 0; row < SPEC_ROWS; row++) {
      const f0 = F_LO * Math.pow(F_HI / F_LO, row / SPEC_ROWS);
      const f1 = F_LO * Math.pow(F_HI / F_LO, (row + 1) / SPEC_ROWS);
      const k0 = Math.max(1, Math.floor((f0 * N_FFT) / SR));
      const k1 = Math.max(k0 + 1, Math.ceil((f1 * N_FFT) / SR));
      let m = -200;
      for (let k = k0; k < k1 && k < full.length; k++) m = Math.max(m, full[k]!);
      col[row] = m;
    }
    spec.push(col);
  }
  let upd = 0;
  let updMax = 0;
  for (const u of r.updateMs) {
    upd += u;
    updMax = Math.max(updMax, u);
  }
  return {
    name: s.name,
    peakDb: db(peak),
    rmsDb: db(rms),
    activeDb: db(active),
    startRatio,
    endMax,
    clicks,
    clickTimes: clickTimes.slice(0, 6),
    checks,
    pass: fails.length === 0,
    fails,
    wave,
    spec,
    updateAvgMs: r.updateMs.length ? upd / r.updateMs.length : 0,
    updateMaxMs: updMax,
  };
}

// ─────────────────────────────────────────────────────────────── scenarios

const TONES_OFF: CockpitTones = {
  seeker: 'off',
  radarLock: false,
  rwr: 'off',
  missileWarning: false,
  stall: false,
  pullUp: false,
  g: 1,
};

function engineParams(): EngineParams {
  return {
    throttle: 0,
    afterburner: 0,
    speed: 0,
    mach: 0,
    g: 1,
    aoa: 0.04,
    position: new Vector3(),
    velocity: new Vector3(),
    cockpit: false,
    damaged: 0,
  };
}

const sfx = (id: SfxId, duration: number, position?: Vector3, minActiveDb?: number): Scenario => ({
  name: id,
  duration,
  minActiveDb,
  setup(h) {
    h.core.play(id, position ? { position } : undefined);
    h.frame(() => undefined);
  },
});

const tone = (name: string, duration: number, fn: (t: number, s: CockpitTones) => void): Scenario => ({
  name,
  duration,
  setup(h) {
    const s: CockpitTones = { ...TONES_OFF };
    h.frame((t) => {
      fn(t, s);
      h.core.setCockpitTones(s);
    });
  },
});

const SCENARIOS: Scenario[] = [
  sfx('missileLaunch', 3.3),
  sfx('rocketLaunch', 1.1),
  sfx('bombRelease', 0.8),
  sfx('explosionSmall', 2.6, new Vector3(90, 10, -110)),
  sfx('explosionLarge', 4.6, new Vector3(-160, 40, -220)),
  sfx('explosionGround', 4.4, new Vector3(250, -300, -150)),
  sfx('explosionWater', 3.8, new Vector3(-60, -120, -140)),
  sfx('hitMetal', 0.6, new Vector3(4, 0, -12)),
  sfx('hitTaken', 1.0),
  sfx('flare', 0.9),
  sfx('chaff', 0.8),
  sfx('gearMove', 3.0),
  sfx('canopy', 2.2),
  sfx('sonicBoom', 2.6, new Vector3(0, 900, -300)),
  sfx('touchdown', 1.2),
  sfx('crash', 4.8, new Vector3(40, -30, -60)),
  sfx('checkpoint', 2.0),
  sfx('medal', 2.8),
  sfx('killConfirm', 1.1),
  sfx('uiHover', 0.25),
  sfx('uiConfirm', 0.4),
  sfx('uiBack', 0.4),
  sfx('uiError', 0.45),
  sfx('uiToggle', 0.25),
  {
    name: 'radio squelch',
    duration: 0.5,
    setup(h) {
      h.core.radio();
      h.frame(() => undefined);
    },
  },
  {
    name: 'engine: player spool→AB',
    duration: 7,
    setup(h) {
      const e = h.core.createEngine(true);
      const p = engineParams();
      p.position.set(0, -2, -18);
      h.frame((t) => {
        p.throttle = smooth(0.6, 3.2, t);
        p.afterburner = smooth(3.9, 4.5, t);
        p.speed = 120 + 30 * t;
        p.mach = p.speed / 340;
        p.velocity.set(0, 0, -p.speed);
        if (t < 6.2) e.set(p);
      });
      h.at(6.25, () => e.dispose());
    },
  },
  {
    name: 'engine: cockpit, 8.5 G, stall',
    duration: 6.4,
    setup(h) {
      const e = h.core.createEngine(true);
      const p = engineParams();
      p.cockpit = true;
      p.throttle = 0.85;
      h.frame((t) => {
        p.speed = 280 - 30 * smooth(3.5, 5, t);
        p.g = 1 + 7.5 * smooth(0.4, 2, t) * (1 - smooth(3.6, 4, t));
        p.aoa = 0.05 + 0.35 * smooth(4, 4.8, t);
        p.velocity.set(0, 0, -p.speed);
        p.mach = p.speed / 340;
        if (t < 5.6) e.set(p);
      });
      h.at(5.65, () => e.dispose());
    },
  },
  {
    name: 'engine: AI flyby 250 m/s',
    duration: 7,
    setup(h) {
      const e = h.core.createEngine(false);
      const p = engineParams();
      p.throttle = 0.95;
      p.afterburner = 0.5;
      p.speed = 250;
      p.velocity.set(250, 0, 0);
      h.frame((t) => {
        p.position.set(-1000 + 250 * t, 40, -80);
        if (t < 6.3) e.set(p);
      });
      h.at(6.35, () => e.dispose());
    },
    checks(r) {
      const mono = new Float32Array(r.left.length);
      for (let i = 0; i < mono.length; i++) mono[i] = (r.left[i]! + r.right[i]!) / 2;
      const before = centroid(mono, 3.0, 3.8);
      const after = centroid(mono, 4.3, 5.1);
      const lBefore = windowRms(r.left, 3.0, 3.8);
      const rBefore = windowRms(r.right, 3.0, 3.8);
      const lAfter = windowRms(r.left, 4.3, 5.1);
      const rAfter = windowRms(r.right, 4.3, 5.1);
      return [
        { label: 'doppler', value: before / Math.max(1, after), pass: before / Math.max(1, after) > 1.3 },
        {
          label: 'pan L→R',
          value: lBefore / rBefore / (lAfter / rAfter),
          pass: lBefore > rBefore && rAfter > lAfter,
        },
      ];
    },
  },
  {
    name: 'engine: AI at 2.5 km',
    duration: 4,
    minActiveDb: -75,
    setup(h) {
      const e = h.core.createEngine(false);
      const p = engineParams();
      p.throttle = 1;
      p.afterburner = 1;
      p.speed = 300;
      p.velocity.set(0, 0, -300);
      h.frame((t) => {
        p.position.set(1800, 600, -1600 - 300 * t);
        if (t < 3.3) e.set(p);
      });
      h.at(3.35, () => e.dispose());
    },
  },
  {
    name: 'gun25 player burst',
    duration: 2.4,
    setup(h) {
      const g = h.core.createGun('gun25', true);
      const pos = new Vector3(0, 0, -2);
      h.at(0.1, () => g.setFiring(true, pos, still));
      h.at(1.1, () => g.setFiring(false, pos, still));
      h.frame(() => undefined);
    },
  },
  {
    name: 'gun30 player burst',
    duration: 2.4,
    setup(h) {
      const g = h.core.createGun('gun30', true);
      const pos = new Vector3(0, 0, -2);
      h.at(0.1, () => g.setFiring(true, pos, still));
      h.at(1.1, () => g.setFiring(false, pos, still));
      h.frame(() => undefined);
    },
  },
  {
    name: 'gun25 AI flyby bursts',
    duration: 4.2,
    setup(h) {
      const g = h.core.createGun('gun25', false);
      const pos = new Vector3();
      const vel = new Vector3(220, 0, 0);
      h.frame((t) => {
        pos.set(-480 + 220 * t, 30, -60);
        const firing = (t > 0.3 && t < 1.3) || (t > 2.0 && t < 3.1);
        g.setFiring(firing, pos, vel);
      });
    },
  },
  tone('seeker search→lock', 4, (t, s) => {
    s.seeker = t < 2.2 ? 'search' : t < 3.5 ? 'locked' : 'off';
  }),
  tone('radar lock', 0.7, (t, s) => {
    s.radarLock = t > 0.02;
  }),
  tone('rwr spike', 2.8, (t, s) => {
    s.rwr = t < 2.3 ? 'spike' : 'off';
  }),
  tone('rwr launch', 2.2, (t, s) => {
    s.rwr = t < 1.8 ? 'launch' : 'off';
  }),
  tone('missile warning', 2.2, (t, s) => {
    s.missileWarning = t < 1.8;
    s.seeker = t < 1.8 ? 'search' : 'off';
  }),
  tone('stall horn', 2.4, (t, s) => {
    s.stall = t < 2;
  }),
  tone('pull up', 2.6, (t, s) => {
    s.pullUp = t < 2.2;
  }),
  {
    name: 'menu music (fade in/out)',
    duration: 17,
    setup(h) {
      h.core.setMenuMusic(true);
      h.at(14.5, () => h.core.setMenuMusic(false));
      h.frame(() => undefined);
    },
  },
  {
    name: 'pause / stopAll (ZD-I04)',
    duration: 3.4,
    dynamics: true,
    setup(h) {
      const e = h.core.createEngine(true);
      const g = h.core.createGun('gun30', true);
      const p = engineParams();
      p.throttle = 0.7;
      p.speed = 200;
      p.position.set(0, 0, -15);
      p.velocity.set(0, 0, -200);
      const pos = new Vector3(0, 0, -2);
      g.setFiring(true, pos, still);
      h.frame((t) => {
        if (t < 2.4) e.set(p);
      });
      h.at(0.8, () => h.core.setPaused(true));
      h.at(1.5, () => h.core.setPaused(false));
      h.at(2.4, () => h.core.stopAll());
    },
    checks(r) {
      const paused = db(Math.max(windowRms(r.left, 1.05, 1.45), windowRms(r.right, 1.05, 1.45)));
      const resumed = db(windowRms(r.left, 1.9, 2.3));
      const stopped = db(Math.max(windowRms(r.left, 2.8, 3.3), windowRms(r.right, 2.8, 3.3)));
      return [
        { label: 'paused silent', value: paused, pass: paused < -80 },
        { label: 'resumed', value: resumed, pass: resumed > -45 },
        { label: 'stopAll silent', value: stopped, pass: stopped < -80 },
      ];
    },
  },
  {
    name: 'stress: 18 explosions, master',
    duration: 5.5,
    dynamics: true,
    setup(h) {
      const rnd = new Rng(99);
      for (let i = 0; i < 18; i++) {
        const t = 0.02 + rnd.range(0, 0.4);
        const pos = new Vector3(rnd.range(-60, 60), rnd.range(-20, 20), rnd.range(-80, -30));
        h.at(t, () =>
          h.core.play(i % 3 === 0 ? 'explosionSmall' : 'explosionLarge', { position: pos, volume: 2 }),
        );
      }
      h.frame(() => undefined);
    },
    checks() {
      return [];
    },
  },
  {
    name: 'master chain: -20 dBFS tone',
    duration: 1.2,
    dynamics: true,
    setup(h) {
      const o = new OscillatorNode(h.ctx, { frequency: 1000 });
      const g = new GainNode(h.ctx, { gain: 0 });
      o.connect(g).connect(h.core.mixer.master);
      g.gain.setValueAtTime(0, 0.05);
      g.gain.linearRampToValueAtTime(0.1, 0.07);
      g.gain.setValueAtTime(0.1, 1.0);
      g.gain.linearRampToValueAtTime(0, 1.02);
      o.start(0);
      o.stop(1.1);
      h.frame(() => undefined);
    },
    checks(r) {
      const out = windowRms(r.left, 0.5, 0.9);
      const err = db(out) - db(0.1 / Math.SQRT2);
      return [{ label: 'unity ±1.5 dB', value: err, pass: Math.abs(err) <= 1.5 }];
    },
  },
  {
    name: 'battle: 12 AI + player (perf)',
    duration: 5,
    dynamics: true,
    setup(h) {
      const core = h.core;
      const player = core.createEngine(true);
      const pp = engineParams();
      pp.throttle = 0.8;
      pp.speed = 250;
      pp.position.set(0, 0, -15);
      pp.velocity.set(0, 0, -250);
      const ai = Array.from({ length: 12 }, () => core.createEngine(false));
      const params = ai.map(() => engineParams());
      const guns = [
        core.createGun('gun25', false),
        core.createGun('gun30', false),
        core.createGun('gun25', false),
      ];
      const rnd = new Rng(7);
      const radius = ai.map((_, i) => 250 + i * 240);
      const phase = ai.map(() => rnd.range(0, Math.PI * 2));
      const listenerPos = new Vector3();
      const listenerVel = new Vector3(0, 0, -250);
      h.frame((t) => {
        if (t >= 4.3) return;
        listenerPos.set(0, 0, -250 * t);
        core.setListener(listenerPos, identity, listenerVel);
        pp.position.set(0, 0, -250 * t - 15);
        player.set(pp);
        for (let i = 0; i < ai.length; i++) {
          const p = params[i]!;
          const a = phase[i]! + (t * 220) / radius[i]!;
          p.throttle = 0.6 + 0.4 * Math.sin(t + i);
          p.afterburner = i % 4 === 0 ? 1 : 0;
          p.speed = 220;
          p.position.set(Math.cos(a) * radius[i]!, 200 * Math.sin(i), -250 * t + Math.sin(a) * radius[i]!);
          p.velocity.set(-Math.sin(a) * 220, 0, Math.cos(a) * 220 - 250);
          ai[i]!.set(p);
        }
        for (let i = 0; i < guns.length; i++) {
          const p = params[i]!;
          guns[i]!.setFiring(Math.sin(t * 2 + i * 2) > 0.3, p.position, p.velocity);
        }
        const s: CockpitTones = { ...TONES_OFF, rwr: t > 1 && t < 3 ? 'spike' : 'off', g: 7 };
        core.setCockpitTones(s);
      });
      for (let i = 0; i < 8; i++) {
        const pos = new Vector3(rnd.range(-900, 900), rnd.range(-200, 200), rnd.range(-1500, -300));
        h.at(0.3 + i * 0.5, () => core.play('explosionSmall', { position: pos }));
      }
      h.at(4.3, () => core.stopAll());
    },
  },
];

// ─────────────────────────────────────────────────────────────── drawing

const INFERNO: readonly [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];

function colormap(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v)) * (INFERNO.length - 1);
  const i = Math.min(INFERNO.length - 2, Math.floor(x));
  const f = x - i;
  const a = INFERNO[i]!;
  const b = INFERNO[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function drawCell(g: CanvasRenderingContext2D, r: Result, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#121517';
  g.fillRect(x, y, w, h);
  g.fillStyle = r.pass ? '#e9e5d9' : '#ff6a1a';
  g.font = '600 11px monospace';
  g.fillText(r.name, x + 6, y + 13);
  g.font = '10px monospace';
  g.fillStyle = r.pass ? '#8fa39a' : '#ff6a1a';
  const stat = `pk ${r.peakDb.toFixed(1)}  rms ${r.rmsDb.toFixed(0)}  win ${r.activeDb.toFixed(0)}`;
  g.fillText(r.pass ? `${stat}  OK` : `${stat}  ${r.fails.join(',')}`, x + 6, y + 25);

  const wy = y + 30;
  const wh = 36;
  g.strokeStyle = '#2a3034';
  g.beginPath();
  g.moveTo(x + 4, wy + wh / 2);
  g.lineTo(x + w - 4, wy + wh / 2);
  g.stroke();
  g.fillStyle = r.pass ? '#c9d6cf' : '#ff6a1a';
  const cols = r.wave.length / 2;
  const cw = (w - 8) / cols;
  for (let c = 0; c < cols; c++) {
    const lo = r.wave[c * 2]!;
    const hi = r.wave[c * 2 + 1]!;
    const y0 = wy + wh / 2 - hi * (wh / 2);
    const y1 = wy + wh / 2 - lo * (wh / 2);
    g.fillRect(x + 4 + c * cw, y0, Math.max(1, cw), Math.max(1, y1 - y0));
  }

  const sy = wy + wh + 3;
  const sh = h - (sy - y) - 4;
  const img = g.createImageData(SPEC_COLS, SPEC_ROWS);
  for (let c = 0; c < SPEC_COLS; c++) {
    const col = r.spec[c]!;
    for (let row = 0; row < SPEC_ROWS; row++) {
      const [cr, cg, cb] = colormap((col[row]! + 100) / 95);
      const p = ((SPEC_ROWS - 1 - row) * SPEC_COLS + c) * 4;
      img.data[p] = cr;
      img.data[p + 1] = cg;
      img.data[p + 2] = cb;
      img.data[p + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = SPEC_COLS;
  tmp.height = SPEC_ROWS;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, x + 4, sy, w - 8, sh);
  // 100 Hz, 1 kHz, 10 kHz guides.
  g.strokeStyle = 'rgba(233,229,217,0.18)';
  g.fillStyle = 'rgba(233,229,217,0.45)';
  g.font = '8px monospace';
  for (const [f, label] of [
    [100, '100'],
    [1000, '1k'],
    [10000, '10k'],
  ] as const) {
    const fy = sy + sh - (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * sh;
    g.beginPath();
    g.moveTo(x + 4, fy);
    g.lineTo(x + w - 4, fy);
    g.stroke();
    g.fillText(label, x + 6, fy - 2);
  }
}

async function main(): Promise<void> {
  document.body.style.margin = '0';
  document.body.style.background = '#0a0c0d';
  const canvas = document.createElement('canvas');
  const W = 1600;
  const H = 1200;
  canvas.width = W;
  canvas.height = H;
  canvas.style.display = 'block';
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0a0c0d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e9e5d9';
  g.font = '600 14px monospace';
  g.fillText('SPLASH ONE audio: rendering offline...', 12, 22);

  const t0 = performance.now();
  const results: Result[] = [];
  const timings: number[] = [];
  const only = new URLSearchParams(window.location.search).get('only');
  const keys = only ? only.split(',') : null;
  const list = keys ? SCENARIOS.filter((s) => keys.some((k) => s.name.includes(k))) : SCENARIOS;
  for (let i = 0; i < list.length; i++) {
    const s = list[i]!;
    document.title = `audio ${i + 1}/${list.length}: ${s.name}`;
    const ts = performance.now();
    results.push(analyze(s, await render(s)));
    timings.push(Math.round(performance.now() - ts));
  }
  const renderMs = performance.now() - t0;

  const colsN = 6;
  const header = 40;
  const rowsN = Math.ceil(results.length / colsN);
  const cw = Math.floor(W / colsN);
  const ch = Math.floor((H - header) / rowsN);
  g.fillStyle = '#0a0c0d';
  g.fillRect(0, 0, W, H);
  const passed = results.filter((r) => r.pass).length;
  const battle = results.find((r) => r.name.startsWith('battle'));
  g.fillStyle = passed === results.length ? '#e9e5d9' : '#ff6a1a';
  g.font = '600 14px monospace';
  g.fillText(
    `SPLASH ONE audio: ${passed}/${results.length} pass  |  rendered offline in ${(renderMs / 1000).toFixed(1)} s  |  ` +
      `update() avg ${battle ? battle.updateAvgMs.toFixed(3) : '-'} ms, max ${battle ? battle.updateMaxMs.toFixed(2) : '-'} ms (12 AI + player)`,
    12,
    18,
  );
  g.font = '10px monospace';
  g.fillStyle = '#8fa39a';
  g.fillText(
    'checks: peak <= 0.98 (-0.2 dBFS), loudest 20 ms RMS audible, onset rise (0.5 ms vs 6 ms) <= 0.25, last 5 ms < 0.002, no abrupt onset/offset; spectrogram 30 Hz-20 kHz log, -100..-5 dBFS',
    12,
    33,
  );
  results.forEach((r, i) =>
    drawCell(g, r, (i % colsN) * cw + 2, header + Math.floor(i / colsN) * ch + 2, cw - 4, ch - 4),
  );

  window.__HARNESS_INFO__ = {
    passed,
    total: results.length,
    renderMs: Math.round(renderMs),
    timings,
    updateAvgMs: battle ? Number(battle.updateAvgMs.toFixed(4)) : null,
    updateMaxMs: battle ? Number(battle.updateMaxMs.toFixed(3)) : null,
    results: results.map((r) => ({
      name: r.name,
      pass: r.pass,
      fails: r.fails,
      peakDb: Number(r.peakDb.toFixed(2)),
      rmsDb: Number(r.rmsDb.toFixed(1)),
      activeDb: Number(r.activeDb.toFixed(1)),
      start: Number(r.startRatio.toFixed(3)),
      end: Number(r.endMax.toFixed(6)),
      clicks: r.clicks,
      clickAt: r.clickTimes.map((t) => Number(t.toFixed(4))),
      checks: r.checks.map((c) => ({ label: c.label, value: Number(c.value.toFixed(3)), pass: c.pass })),
    })),
  };
  window.__HARNESS_READY__ = true;
}

main().catch((e: unknown) => {
  console.error('audio harness failed', e);
  window.__HARNESS_INFO__ = { error: String(e) };
  window.__HARNESS_READY__ = true;
});

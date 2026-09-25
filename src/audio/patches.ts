import type { Rng } from '../core/rng';
import type { SfxId } from '../core/types';
import type { SoundBank } from './bank';
import type { NodeSet } from './host';
import { envAD, envAHR, envTrap, sweep } from './params';
import type { SpatialProfile } from './spatial';
import { midiToHz } from './util';

/**
 * Procedural SFX patches. Each patch builds a small, self-terminating graph into `pc.out` starting at `pc.t`
 * and returns the time its last envelope reaches zero. Every envelope starts at 0 and ends at 0 (ramps of at
 * least 5 ms), and every patch draws its variation (timing, pitch, filter, level) from `pc.rnd`.
 */
export interface PatchContext {
  readonly set: NodeSet;
  readonly out: AudioNode;
  readonly t: number;
  readonly rnd: Rng;
  /** Multiplies every source frequency and playback rate (variation, caller pitch and doppler). */
  readonly pitch: number;
  readonly bank: SoundBank;
}

export type SfxBus = 'ext' | 'int' | 'ui' | 'radio';

export interface SfxPatch {
  readonly category: number;
  /** Base priority: when a category is full, lower priority voices are stolen first. */
  readonly priority: number;
  /** Bus for non-positional playback (positional playback always goes through the world/exterior bus). */
  readonly bus: SfxBus;
  /** Voice gain, calibrated so a single dry voice at volume 1 peaks well below full scale. */
  readonly gain: number;
  /** Minimum time between triggers (s) and the window in which repeats get quieter (ZD-I08). */
  readonly minInterval: number;
  readonly repeatWindow: number;
  /** Profile used when a position is given; null = never spatialized. */
  readonly spatial: SpatialProfile | null;
  /** Delay the start by distance / speed of sound. */
  readonly propagate: boolean;
  readonly build: (pc: PatchContext) => number;
}

export const CAT_EXPLOSION = 0;
export const CAT_WEAPON = 1;
export const CAT_IMPACT = 2;
export const CAT_MISC = 3;
export const CAT_EVENT = 4;
export const CAT_UI = 5;
export const CAT_RADIO = 6;
/** Voice caps per category (index = CAT_*). */
export const CATEGORY_LIMITS: readonly number[] = [8, 10, 8, 6, 4, 4, 2];
/** Global cap across all one-shot voices. */
export const MAX_SFX_VOICES = 36;

const EXPLOSION: SpatialProfile = { ref: 120, rolloff: 1, maxDistance: 12000, reverb: true };
const WEAPON: SpatialProfile = { ref: 40, rolloff: 1, maxDistance: 5000, reverb: true };
const IMPACT: SpatialProfile = { ref: 15, rolloff: 1, maxDistance: 1500, reverb: false };
const COUNTER: SpatialProfile = { ref: 25, rolloff: 1, maxDistance: 2000, reverb: false };
const NEARBY: SpatialProfile = { ref: 10, rolloff: 1, maxDistance: 600, reverb: false };
const BOOM: SpatialProfile = { ref: 1500, rolloff: 1, maxDistance: 30000, reverb: true };

// ─────────────────────────────────────────────────────────────── building blocks

const vary = (pc: PatchContext, amount: number): number => 1 + (pc.rnd.next() * 2 - 1) * amount;

/** Looping noise source with a random start offset, running from `at` for `dur`. */
function noise(
  pc: PatchContext,
  buffer: AudioBuffer,
  at: number,
  dur: number,
  rate = 1,
): AudioBufferSourceNode {
  const n = pc.set.buffer(buffer, rate * pc.pitch, true);
  n.start(at, pc.rnd.next() * buffer.duration);
  n.stop(at + dur);
  return n;
}

function osc(
  pc: PatchContext,
  type: OscillatorType,
  freq: number,
  at: number,
  dur: number,
  detune = 0,
): OscillatorNode {
  const o = pc.set.osc(type, freq * pc.pitch, detune);
  o.start(at);
  o.stop(at + dur);
  return o;
}

/** Gain stage (starting silent) feeding `dest`. */
function vca(pc: PatchContext, dest: AudioNode = pc.out): GainNode {
  const g = pc.set.gain(0);
  g.connect(dest);
  return g;
}

const hz = (pc: PatchContext, f: number): number => f * pc.pitch;

/** Exponential frequency sweep on an oscillator or filter, scaled by the patch pitch. */
function glideHz(pc: PatchContext, p: AudioParam, at: number, from: number, to: number, dur: number): void {
  sweep(p, at, from * pc.pitch, to * pc.pitch, dur);
}

/** Noise through a filter with an attack/decay envelope. Returns the end time. */
function noiseHit(
  pc: PatchContext,
  buffer: AudioBuffer,
  at: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
  attack: number,
  peak: number,
  decay: number,
  dest: AudioNode = pc.out,
): number {
  const f = pc.set.filter(type, hz(pc, freq), q);
  const g = vca(pc, dest);
  const end = envAD(g.gain, at, attack, peak, decay);
  noise(pc, buffer, at, end - at + 0.01)
    .connect(f)
    .connect(g);
  return end;
}

/** Sine thump with a fast downward pitch glide. Returns the end time. */
function thump(
  pc: PatchContext,
  at: number,
  from: number,
  to: number,
  glideT: number,
  peak: number,
  decay: number,
): number {
  const g = vca(pc);
  const end = envAD(g.gain, at, 0.005, peak, decay);
  const o = osc(pc, 'sine', from, at, end - at + 0.01);
  glideHz(pc, o.frequency, at, from, to, glideT);
  o.connect(g);
  return end;
}

/**
 * Modal (struck metal) resonance: inharmonic partials with individual decays. Higher partials die faster,
 * which is what makes it read as metal rather than a beep.
 */
function modal(
  pc: PatchContext,
  at: number,
  f0: number,
  ratios: readonly number[],
  decays: readonly number[],
  amps: readonly number[],
  level: number,
): number {
  let end = at;
  for (let i = 0; i < ratios.length; i++) {
    const g = vca(pc);
    const e = envAD(g.gain, at, 0.005, (amps[i] ?? 0) * level, (decays[i] ?? 0.1) * vary(pc, 0.15));
    osc(pc, 'sine', f0 * (ratios[i] ?? 1) * vary(pc, 0.012), at, e - at + 0.01).connect(g);
    end = Math.max(end, e);
  }
  return end;
}

/** Slow random amplitude movement (smooth noise) added to a gain stage's own level: base ± depth. */
function wobble(pc: PatchContext, g: GainNode, at: number, dur: number, depth: number, rate: number): void {
  const m = noise(pc, pc.bank.smoothMid, at, dur, rate / pc.pitch);
  const d = pc.set.gain(depth);
  m.connect(d).connect(g.gain);
}

/** Short feedback echo for musical cues (a small room without a convolver per voice). */
function echo(pc: PatchContext, time: number, feedback: number, wet: number, cutoff: number): AudioNode {
  const input = pc.set.gain(1);
  const dl = pc.set.delay(time, 1);
  const fb = pc.set.gain(feedback);
  const lp = pc.set.filter('lowpass', cutoff, 0.5);
  const wetG = pc.set.gain(wet);
  input.connect(pc.out);
  input.connect(dl);
  dl.connect(lp).connect(fb).connect(dl);
  lp.connect(wetG).connect(pc.out);
  return input;
}

interface BoomSpec {
  /** 0..1 overall scale of the event. */
  size: number;
  /** Final thump frequency (Hz). */
  thump: number;
  /** Initial blast lowpass cutoff (Hz). */
  bright: number;
  /** Rumble tail decay (s). */
  tail: number;
  crackle: number;
  body: number;
}

/** Explosion core: noise blast, sub thump, mid crunch, delayed rolling rumble, optional debris crackle. */
function boom(pc: PatchContext, at: number, o: BoomSpec): number {
  const b = pc.bank;
  const size = o.size;
  let end = at;
  // Blast: broadband noise whose lowpass closes quickly (the "crack" turning into a "whump").
  {
    const dur = (0.3 + 0.55 * size) * vary(pc, 0.15);
    const lp = pc.set.filter('lowpass', 1, 0.6);
    glideHz(pc, lp.frequency, at, o.bright * vary(pc, 0.15), 260, dur * 0.8);
    const g = vca(pc);
    const e = envAD(g.gain, at, 0.005, 0.55, dur);
    noise(pc, b.white, at, e - at + 0.01)
      .connect(lp)
      .connect(g);
    end = Math.max(end, e);
  }
  // Sub thump plus its octave (the octave keeps it audible on small speakers).
  {
    const f = o.thump * vary(pc, 0.08);
    const d = (0.35 + 0.45 * size) * vary(pc, 0.1);
    end = Math.max(end, thump(pc, at, f * 2.4, f, 0.16, 0.75, d));
    end = Math.max(end, thump(pc, at + 0.004, f * 4.2, f * 2, 0.1, 0.22, d * 0.5));
  }
  // Mid crunch.
  end = Math.max(
    end,
    noiseHit(pc, b.pink, at, 'bandpass', 650 * vary(pc, 0.2), 0.8, 0.006, 0.35 * o.body, 0.25 + 0.4 * size),
  );
  // Rolling rumble tail, delayed a little, with slow random amplitude movement.
  {
    const start = at + 0.05 + 0.05 * pc.rnd.next();
    const lp = pc.set.filter('lowpass', hz(pc, 200 * vary(pc, 0.2)), 0.7);
    const am = pc.set.gain(0.7);
    const g = vca(pc);
    const e = envAHR(g.gain, start, 0.12 + 0.1 * size, 0.55, 0.1 * size, o.tail * vary(pc, 0.15));
    wobble(pc, am, start, e - start + 0.01, 0.3, 1);
    noise(pc, b.brown, start, e - start + 0.01)
      .connect(lp)
      .connect(am)
      .connect(g);
    end = Math.max(end, e);
  }
  // Debris crackle.
  if (o.crackle > 0) {
    const start = at + 0.03 + 0.04 * pc.rnd.next();
    const hp = pc.set.filter('highpass', hz(pc, 900), 0.7);
    const g = vca(pc);
    const e = envAD(g.gain, start, 0.02, o.crackle, 0.5 + 0.8 * size);
    noise(pc, b.crackle, start, e - start + 0.01, 0.9 * vary(pc, 0.1))
      .connect(hp)
      .connect(g);
    end = Math.max(end, e);
  }
  return end;
}

// ─────────────────────────────────────────────────────────────── patches

function missileLaunch(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = thump(pc, t, 120, 48, 0.12, 0.45, 0.35);
  // Ignition flare-up: band of noise sweeping up.
  {
    const bp = pc.set.filter('bandpass', 1, 0.9);
    glideHz(pc, bp.frequency, t, 700, 2400 * vary(pc, 0.1), 0.25);
    const g = vca(pc);
    end = Math.max(end, envAD(g.gain, t, 0.008, 0.5, 0.55));
    noise(pc, b.white, t, 0.7).connect(bp).connect(g);
  }
  // Motor: hiss + crackle, darkening as the missile pulls away.
  {
    const lp = pc.set.filter('lowpass', 1, 0.7);
    glideHz(pc, lp.frequency, t, 9000, 1400, 2.4);
    const g = vca(pc);
    const e = envAHR(g.gain, t + 0.02, 0.04, 0.55, 0.25, 2.1 * vary(pc, 0.1));
    const hiss = noise(pc, b.pink, t, e - t + 0.01, 1.1);
    const hp = pc.set.filter('highpass', hz(pc, 500), 0.7);
    hiss.connect(hp).connect(lp);
    const cr = noise(pc, b.crackle, t, e - t + 0.01, 1.2);
    const crG = pc.set.gain(0.6);
    cr.connect(crG).connect(lp);
    lp.connect(g);
    end = Math.max(end, e);
  }
  // Receding whoosh: doppler-down band.
  {
    const bp = pc.set.filter('bandpass', 1, 1.3);
    glideHz(pc, bp.frequency, t + 0.05, 2600, 650, 1.3);
    const g = vca(pc);
    const e = envAHR(g.gain, t + 0.05, 0.12, 0.35, 0.1, 1.1);
    noise(pc, b.white, t + 0.05, e - t)
      .connect(bp)
      .connect(g);
    end = Math.max(end, e);
  }
  return end;
}

function rocketLaunch(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = noiseHit(pc, b.white, t, 'highpass', 1500, 0.7, 0.005, 0.45, 0.07);
  end = Math.max(end, thump(pc, t, 160, 60, 0.08, 0.35, 0.16));
  const bp = pc.set.filter('bandpass', 1, 1.1);
  glideHz(pc, bp.frequency, t, 3400 * vary(pc, 0.1), 1000, 0.55);
  const g = vca(pc);
  const e = envAHR(g.gain, t, 0.006, 0.55, 0.05, 0.6 * vary(pc, 0.15));
  noise(pc, b.white, t, e - t + 0.01)
    .connect(bp)
    .connect(g);
  return Math.max(end, e);
}

function bombRelease(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  // Ejector clunk: low modal thud + dull noise, then the latch click.
  let end = modal(pc, t, 150 * vary(pc, 0.08), [1, 2.31, 3.9], [0.13, 0.08, 0.05], [0.5, 0.25, 0.12], 1);
  end = Math.max(end, noiseHit(pc, b.pink, t, 'lowpass', 1100, 0.7, 0.005, 0.45, 0.07));
  const t2 = t + 0.03 + 0.015 * pc.rnd.next();
  end = Math.max(end, noiseHit(pc, b.white, t2, 'bandpass', 3400, 3, 0.005, 0.35, 0.03));
  end = Math.max(
    end,
    modal(pc, t2, 1900 * vary(pc, 0.1), [1, 1.47, 2.3], [0.05, 0.035, 0.02], [0.12, 0.07, 0.04], 1),
  );
  // A brief rattle as the store falls away.
  end = Math.max(end, noiseHit(pc, b.crackle, t + 0.05, 'bandpass', 2400, 0.8, 0.01, 0.15, 0.18));
  return end;
}

function explosionSmall(pc: PatchContext): number {
  return boom(pc, pc.t, { size: 0.35, thump: 52, bright: 5200, tail: 1.2, crackle: 0.18, body: 0.9 });
}

function explosionLarge(pc: PatchContext): number {
  return boom(pc, pc.t, { size: 1, thump: 38, bright: 4200, tail: 2.8, crackle: 0.3, body: 1 });
}

function explosionGround(pc: PatchContext): number {
  const b = pc.bank;
  let end = boom(pc, pc.t, { size: 0.8, thump: 42, bright: 3200, tail: 2.4, crackle: 0.12, body: 1.2 });
  // Dirt and rocks raining back down.
  const start = pc.t + 0.3 + 0.15 * pc.rnd.next();
  const lp = pc.set.filter('lowpass', hz(pc, 2600), 0.7);
  const g = vca(pc);
  const e = envAHR(g.gain, start, 0.15, 0.22, 0.2, 1.3);
  noise(pc, b.crackle, start, e - start + 0.01, 0.55)
    .connect(lp)
    .connect(g);
  end = Math.max(end, e);
  return end;
}

function explosionWater(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = boom(pc, t, { size: 0.6, thump: 40, bright: 1500, tail: 1.6, crackle: 0, body: 0.6 });
  // The column of water: a swelling, falling spray.
  {
    const bp = pc.set.filter('bandpass', 1, 0.6);
    glideHz(pc, bp.frequency, t + 0.05, 2200, 900, 1.2);
    const g = vca(pc);
    const e = envAHR(g.gain, t + 0.05, 0.08, 0.42, 0.25, 1.3 * vary(pc, 0.15));
    noise(pc, b.white, t + 0.05, e - t)
      .connect(bp)
      .connect(g);
    end = Math.max(end, e);
  }
  // Spray falling back: bright hiss.
  {
    const start = t + 0.45;
    const hp = pc.set.filter('highpass', hz(pc, 2800), 0.7);
    const g = vca(pc);
    const e = envAHR(g.gain, start, 0.3, 0.16, 0.4, 1.2);
    noise(pc, b.white, start, e - start + 0.01)
      .connect(hp)
      .connect(g);
    end = Math.max(end, e);
  }
  // Bubbles: short rising chirps.
  const count = 5 + Math.floor(pc.rnd.next() * 4);
  for (let i = 0; i < count; i++) {
    const at = t + 0.15 + pc.rnd.next() * 1.1;
    const f = 320 + pc.rnd.next() * 600;
    const g = vca(pc);
    const e = envAD(g.gain, at, 0.005, 0.05 + 0.04 * pc.rnd.next(), 0.06);
    const o = osc(pc, 'sine', f, at, e - at + 0.01);
    glideHz(pc, o.frequency, at, f, f * 1.7, 0.05);
    o.connect(g);
    end = Math.max(end, e);
  }
  return end;
}

function hitMetal(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  const f0 = 1400 + pc.rnd.next() * 900;
  let end = modal(
    pc,
    t,
    f0,
    [1, 1.53, 2.26, 2.91, 3.7],
    [0.14, 0.1, 0.07, 0.05, 0.035],
    [0.3, 0.24, 0.17, 0.12, 0.08],
    1,
  );
  // One to three impact ticks (several rounds striking).
  const hits = 1 + Math.floor(pc.rnd.next() * 3);
  let at = t;
  for (let i = 0; i < hits; i++) {
    end = Math.max(end, noiseHit(pc, b.white, at, 'highpass', 2600, 0.8, 0.005, 0.6 * (1 - i * 0.25), 0.035));
    end = Math.max(end, noiseHit(pc, b.white, at, 'bandpass', 5200 * vary(pc, 0.15), 4, 0.005, 0.3, 0.05));
    at += 0.018 + 0.03 * pc.rnd.next();
  }
  return end;
}

function hitTaken(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = thump(pc, t, 130, 55, 0.1, 0.7, 0.32);
  end = Math.max(end, noiseHit(pc, b.pink, t, 'bandpass', 1200, 1, 0.005, 0.6, 0.14));
  end = Math.max(
    end,
    modal(
      pc,
      t,
      380 + pc.rnd.next() * 120,
      [1, 1.71, 2.53, 3.47],
      [0.34, 0.22, 0.14, 0.09],
      [0.28, 0.2, 0.13, 0.08],
      1,
    ),
  );
  end = Math.max(end, noiseHit(pc, b.crackle, t + 0.01, 'highpass', 3000, 0.7, 0.01, 0.35, 0.28));
  end = Math.max(end, noiseHit(pc, b.white, t, 'highpass', 3500, 0.7, 0.005, 0.3, 0.03));
  return end;
}

function flare(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = noiseHit(pc, b.white, t, 'bandpass', 1900 * vary(pc, 0.15), 0.9, 0.005, 0.55, 0.05);
  end = Math.max(end, thump(pc, t, 210, 90, 0.05, 0.4, 0.09));
  // Burning magnesium: bright fizz with crackle.
  const hp = pc.set.filter('highpass', hz(pc, 3800), 0.7);
  const g = vca(pc);
  const e = envAHR(g.gain, t + 0.01, 0.02, 0.16, 0.05, 0.55);
  noise(pc, b.white, t, e - t + 0.01)
    .connect(hp)
    .connect(g);
  const cr = noise(pc, b.crackle, t, e - t + 0.01, 1.4);
  const crG = pc.set.gain(0.6);
  cr.connect(crG).connect(hp);
  return Math.max(end, e);
}

function chaff(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = noiseHit(pc, b.pink, t, 'lowpass', 1000, 0.7, 0.005, 0.5, 0.06);
  end = Math.max(end, thump(pc, t, 170, 80, 0.05, 0.25, 0.07));
  // The cloud of foil: papery rustle.
  end = Math.max(end, noiseHit(pc, b.crackle, t + 0.01, 'bandpass', 5200, 0.5, 0.012, 0.3, 0.38));
  end = Math.max(end, noiseHit(pc, b.white, t + 0.01, 'highpass', 6000, 0.7, 0.01, 0.07, 0.3));
  return end;
}

function gearMove(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  // Uplock release clunk.
  let end = modal(pc, t, 170, [1, 2.2, 3.6], [0.09, 0.06, 0.04], [0.3, 0.15, 0.08], 1);
  end = Math.max(end, noiseHit(pc, b.pink, t, 'lowpass', 900, 0.7, 0.005, 0.3, 0.06));
  // Hydraulic pump whine, rising slightly under load.
  const run = 2.0 * vary(pc, 0.06);
  {
    const bp = pc.set.filter('bandpass', hz(pc, 820), 2.2);
    const g = vca(pc);
    const e = envAHR(g.gain, t + 0.05, 0.12, 0.13, run - 0.3, 0.2);
    const a = osc(pc, 'sawtooth', 380, t + 0.05, e - t);
    const c = osc(pc, 'sawtooth', 380, t + 0.05, e - t, 11);
    glideHz(pc, a.frequency, t + 0.05, 380, 455, run);
    glideHz(pc, c.frequency, t + 0.05, 380, 455, run);
    a.connect(bp);
    c.connect(bp);
    const am = pc.set.gain(0.8);
    wobble(pc, am, t + 0.05, e - t, 0.2, 3);
    bp.connect(am).connect(g);
    end = Math.max(end, e);
  }
  // Hydraulic hiss.
  end = Math.max(end, noiseHit(pc, b.pink, t + 0.05, 'bandpass', 2600, 0.7, 0.1, 0.06, run));
  // Down-and-locked thunk.
  const tl = t + run + 0.1;
  end = Math.max(
    end,
    modal(pc, tl, 120, [1, 1.9, 3.1, 4.4], [0.16, 0.1, 0.07, 0.04], [0.55, 0.28, 0.14, 0.07], 1),
  );
  end = Math.max(end, noiseHit(pc, b.pink, tl, 'lowpass', 1400, 0.7, 0.005, 0.45, 0.08));
  end = Math.max(end, noiseHit(pc, b.white, tl + 0.012, 'bandpass', 3000, 2, 0.005, 0.2, 0.03));
  return end;
}

function canopy(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  // Seal release hiss.
  let end = noiseHit(pc, b.white, t, 'highpass', 3200, 0.7, 0.01, 0.1, 0.25);
  // Electric actuator motor.
  const run = 1.35 * vary(pc, 0.05);
  {
    const lp = pc.set.filter('lowpass', hz(pc, 900), 1.5);
    const g = vca(pc);
    const e = envAHR(g.gain, t + 0.05, 0.08, 0.16, run, 0.15);
    const m = osc(pc, 'sawtooth', 96, t + 0.05, e - t);
    const w = osc(pc, 'triangle', 1150, t + 0.05, e - t);
    glideHz(pc, w.frequency, t + 0.05, 1150, 1320, run);
    const wg = pc.set.gain(0.25);
    m.connect(lp);
    w.connect(wg).connect(lp);
    lp.connect(g);
    end = Math.max(end, e);
  }
  // Latch thunk.
  const tl = t + run + 0.2;
  end = Math.max(end, modal(pc, tl, 210, [1, 2.4, 3.9], [0.1, 0.06, 0.04], [0.4, 0.2, 0.1], 1));
  end = Math.max(end, noiseHit(pc, b.white, tl, 'bandpass', 2800, 2, 0.005, 0.25, 0.03));
  return end;
}

function sonicBoom(pc: PatchContext): number {
  const t = pc.t;
  const src = pc.set.buffer(pc.bank.boom, pc.pitch, false);
  const lp = pc.set.filter('lowpass', hz(pc, 2600 * vary(pc, 0.15)), 0.6);
  const g = vca(pc);
  const dur = pc.bank.boom.duration / pc.pitch;
  const end = envTrap(g.gain, t, 0.005, 1, dur - 0.02, 0.01);
  src.connect(lp).connect(g);
  src.start(t);
  src.stop(end + 0.01);
  return end;
}

function touchdown(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = t;
  // Two main-gear tires, a few tens of ms apart: a squeal chirp each.
  for (let i = 0; i < 2; i++) {
    const at = t + i * (0.035 + 0.03 * pc.rnd.next());
    end = Math.max(end, noiseHit(pc, b.white, at, 'bandpass', 1350 * vary(pc, 0.1), 5, 0.006, 0.4, 0.2));
    const g = vca(pc);
    const e = envAD(g.gain, at, 0.006, 0.07, 0.2);
    const o = osc(pc, 'sine', 1050 * vary(pc, 0.08), at, e - at + 0.01);
    glideHz(pc, o.frequency, at, 1050, 800, 0.2);
    o.connect(g);
    end = Math.max(end, e);
  }
  // Suspension thud and rolling rumble.
  end = Math.max(end, thump(pc, t, 90, 45, 0.1, 0.55, 0.28));
  {
    const lp = pc.set.filter('lowpass', hz(pc, 220), 0.7);
    const g = vca(pc);
    const e = envAHR(g.gain, t, 0.05, 0.3, 0.15, 0.6);
    noise(pc, b.brown, t, e - t + 0.01)
      .connect(lp)
      .connect(g);
    end = Math.max(end, e);
  }
  return end;
}

function crash(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = boom(pc, t, { size: 0.9, thump: 36, bright: 3600, tail: 2.6, crackle: 0.35, body: 1.2 });
  // Airframe breaking up: several low metal impacts.
  let at = t;
  for (let i = 0; i < 3; i++) {
    end = Math.max(
      end,
      modal(
        pc,
        at,
        240 + 120 * pc.rnd.next(),
        [1, 1.64, 2.42, 3.3],
        [0.3, 0.2, 0.12, 0.08],
        [0.22, 0.16, 0.1, 0.06],
        1,
      ),
    );
    at += 0.05 + 0.1 * pc.rnd.next();
  }
  // Scraping.
  {
    const bp = pc.set.filter('bandpass', hz(pc, 2100), 1.8);
    const am = pc.set.gain(0.6);
    const g = vca(pc);
    const e = envAHR(g.gain, t + 0.08, 0.05, 0.22, 0.5, 0.6);
    wobble(pc, am, t + 0.08, e - t, 0.4, 6);
    noise(pc, b.white, t + 0.08, e - t)
      .connect(bp)
      .connect(am)
      .connect(g);
    end = Math.max(end, e);
  }
  return end;
}

/** Struck bell: a fundamental plus inharmonic partials with their own decays. */
function bell(pc: PatchContext, at: number, f: number, level: number, dest: AudioNode, length = 1): number {
  const ratios = [1, 2.0, 2.76, 5.4];
  const amps = [1, 0.28, 0.32, 0.12];
  const decays = [0.9, 0.5, 0.35, 0.15];
  let end = at;
  for (let i = 0; i < ratios.length; i++) {
    const g = vca(pc, dest);
    const e = envAD(g.gain, at, 0.005, amps[i]! * level, decays[i]! * length);
    osc(pc, 'sine', f * ratios[i]!, at, e - at + 0.01).connect(g);
    end = Math.max(end, e);
  }
  return end;
}

function checkpoint(pc: PatchContext): number {
  const t = pc.t;
  const dest = echo(pc, 0.11, 0.3, 0.35, 3000);
  const e1 = bell(pc, t, midiToHz(88), 0.2, dest);
  const e2 = bell(pc, t + 0.11, midiToHz(95), 0.18, dest);
  // The echo tail rings on after the notes.
  return Math.max(e1, e2) + 0.6;
}

/** Soft brass-like voice: detuned saws through a lowpass that opens and settles. */
function brass(
  pc: PatchContext,
  at: number,
  f: number,
  level: number,
  hold: number,
  dest: AudioNode,
): number {
  const lp = pc.set.filter('lowpass', 1, 1.2);
  const g = vca(pc, dest);
  const e = envAHR(g.gain, at, 0.03, level, hold, 0.55);
  lp.frequency.setValueAtTime(hz(pc, f * 1.2), at);
  lp.frequency.exponentialRampToValueAtTime(hz(pc, f * 4.5), at + 0.08);
  lp.frequency.exponentialRampToValueAtTime(hz(pc, f * 2.2), at + 0.5);
  const a = osc(pc, 'sawtooth', f, at, e - at + 0.01, -6);
  const c = osc(pc, 'sawtooth', f, at, e - at + 0.01, 6);
  a.connect(lp);
  c.connect(lp);
  lp.connect(g);
  return e;
}

function medal(pc: PatchContext): number {
  const t = pc.t;
  const dest = echo(pc, 0.16, 0.28, 0.3, 2500);
  // D major rising figure resolving onto an open D chord with a 9th.
  let end = brass(pc, t, midiToHz(62), 0.06, 0.05, dest);
  end = Math.max(end, brass(pc, t + 0.1, midiToHz(66), 0.06, 0.05, dest));
  end = Math.max(end, brass(pc, t + 0.2, midiToHz(69), 0.06, 0.05, dest));
  const tc = t + 0.34;
  for (const n of [50, 57, 62, 64, 66, 69]) end = Math.max(end, brass(pc, tc, midiToHz(n), 0.045, 0.8, dest));
  end = Math.max(end, bell(pc, tc, midiToHz(86), 0.05, dest, 1.3));
  return end + 0.6;
}

function killConfirm(pc: PatchContext): number {
  const t = pc.t;
  let end = thump(pc, t, 150, 75, 0.06, 0.4, 0.14);
  const dest = echo(pc, 0.09, 0.22, 0.25, 3500);
  for (const [dt, note] of [
    [0, 81],
    [0.045, 88],
  ] as const) {
    const lp = pc.set.filter('lowpass', hz(pc, 3200), 0.7);
    const g = vca(pc, dest);
    const e = envAD(g.gain, t + dt, 0.005, 0.14, 0.28);
    osc(pc, 'triangle', midiToHz(note), t + dt, e - t - dt + 0.01)
      .connect(lp)
      .connect(g);
    end = Math.max(end, e);
  }
  return end + 0.35;
}

function uiHover(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = noiseHit(pc, b.white, t, 'bandpass', 4200 * vary(pc, 0.05), 4, 0.005, 0.12, 0.022);
  const g = vca(pc);
  const e = envAD(g.gain, t, 0.005, 0.03, 0.03);
  osc(pc, 'sine', 2600, t, e - t + 0.01).connect(g);
  end = Math.max(end, e);
  return end;
}

function uiPluck(pc: PatchContext, notes: readonly number[], level: number, spacing: number): number {
  const t = pc.t;
  let end = t;
  for (let i = 0; i < notes.length; i++) {
    const at = t + i * spacing;
    const lp = pc.set.filter('lowpass', hz(pc, 3200), 0.7);
    const g = vca(pc);
    const e = envAD(g.gain, at, 0.005, level * (i === 0 ? 1 : 0.85), 0.16);
    osc(pc, 'triangle', midiToHz(notes[i]!), at, e - at + 0.01)
      .connect(lp)
      .connect(g);
    end = Math.max(end, e);
  }
  // Tiny body tick under the first note.
  const g = vca(pc);
  const e = envAD(g.gain, t, 0.005, level * 0.3, 0.05);
  osc(pc, 'sine', midiToHz(notes[0]! - 12), t, e - t + 0.01).connect(g);
  return Math.max(end, e);
}

function uiConfirm(pc: PatchContext): number {
  return uiPluck(pc, [81, 88], 0.2, 0.045);
}

function uiBack(pc: PatchContext): number {
  return uiPluck(pc, [88, 81], 0.14, 0.04);
}

function uiError(pc: PatchContext): number {
  const t = pc.t;
  let end = t;
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.11;
    const lp = pc.set.filter('lowpass', hz(pc, 900), 1.5);
    const g = vca(pc);
    const e = envTrap(g.gain, at, 0.006, 0.13, 0.05, 0.03);
    osc(pc, 'square', 175, at, e - at + 0.01)
      .connect(lp)
      .connect(g);
    end = Math.max(end, e);
  }
  return end;
}

function uiToggle(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  let end = noiseHit(pc, b.white, t, 'bandpass', 3200 * vary(pc, 0.05), 2.5, 0.005, 0.22, 0.018);
  end = Math.max(
    end,
    noiseHit(pc, b.white, t + 0.028, 'bandpass', 2100 * vary(pc, 0.05), 2.5, 0.005, 0.16, 0.02),
  );
  return end;
}

function radio(pc: PatchContext): number {
  const b = pc.bank;
  const t = pc.t;
  // Key-up click, then a band-limited squelch burst.
  let end = noiseHit(pc, b.white, t, 'bandpass', 1800, 1.5, 0.005, 0.35, 0.015);
  const hp = pc.set.filter('highpass', 380, 0.7);
  const lp = pc.set.filter('lowpass', 2900, 0.9);
  const grit = pc.set.shaper(b.radioGrit);
  const g = vca(pc);
  const e = envTrap(g.gain, t + 0.012, 0.006, 0.16, 0.08, 0.07);
  noise(pc, b.white, t + 0.012, e - t)
    .connect(hp)
    .connect(grit)
    .connect(lp)
    .connect(g);
  end = Math.max(end, e);
  return end;
}

// ─────────────────────────────────────────────────────────────── registry

const P = (
  category: number,
  priority: number,
  bus: SfxBus,
  gain: number,
  minInterval: number,
  repeatWindow: number,
  spatial: SpatialProfile | null,
  propagate: boolean,
  build: (pc: PatchContext) => number,
): SfxPatch => ({ category, priority, bus, gain, minInterval, repeatWindow, spatial, propagate, build });

export type PatchId = SfxId | 'radio';

/**
 * The SFX registry. A decoded AudioBuffer registered through `SfxPlayer.override(id, buffer)` replaces the
 * synth `build` for that id while keeping its category, bus, priority, spatial profile and rate limits.
 */
export const PATCHES: Readonly<Record<PatchId, SfxPatch>> = {
  missileLaunch: P(CAT_WEAPON, 6, 'ext', 0.9, 0.05, 0.3, WEAPON, false, missileLaunch),
  rocketLaunch: P(CAT_WEAPON, 4, 'ext', 0.85, 0.03, 0.25, WEAPON, false, rocketLaunch),
  bombRelease: P(CAT_WEAPON, 4, 'ext', 0.9, 0.05, 0.3, NEARBY, false, bombRelease),
  explosionSmall: P(CAT_EXPLOSION, 6, 'ext', 0.45, 0.02, 0.2, EXPLOSION, true, explosionSmall),
  explosionLarge: P(CAT_EXPLOSION, 8, 'ext', 0.45, 0.02, 0.2, EXPLOSION, true, explosionLarge),
  explosionGround: P(CAT_EXPLOSION, 7, 'ext', 0.5, 0.02, 0.2, EXPLOSION, true, explosionGround),
  explosionWater: P(CAT_EXPLOSION, 7, 'ext', 0.45, 0.02, 0.2, EXPLOSION, true, explosionWater),
  hitMetal: P(CAT_IMPACT, 3, 'ext', 0.7, 0.035, 0.25, IMPACT, false, hitMetal),
  hitTaken: P(CAT_IMPACT, 7, 'int', 0.55, 0.06, 0.3, IMPACT, false, hitTaken),
  flare: P(CAT_WEAPON, 3, 'ext', 0.8, 0.04, 0.3, COUNTER, false, flare),
  chaff: P(CAT_WEAPON, 3, 'ext', 0.8, 0.04, 0.3, COUNTER, false, chaff),
  gearMove: P(CAT_MISC, 3, 'ext', 0.8, 0.5, 1, NEARBY, false, gearMove),
  canopy: P(CAT_MISC, 3, 'int', 0.8, 0.5, 1, NEARBY, false, canopy),
  sonicBoom: P(CAT_MISC, 7, 'ext', 0.8, 0.4, 1, BOOM, false, sonicBoom),
  touchdown: P(CAT_MISC, 4, 'ext', 0.85, 0.25, 0.8, NEARBY, false, touchdown),
  crash: P(CAT_EXPLOSION, 9, 'ext', 0.5, 0.2, 0.5, EXPLOSION, true, crash),
  checkpoint: P(CAT_EVENT, 5, 'int', 0.8, 0.2, 0.6, null, false, checkpoint),
  medal: P(CAT_EVENT, 6, 'ui', 0.8, 0.5, 1, null, false, medal),
  killConfirm: P(CAT_EVENT, 6, 'int', 0.8, 0.15, 0.5, null, false, killConfirm),
  uiHover: P(CAT_UI, 1, 'ui', 0.7, 0.06, 0.35, null, false, uiHover),
  uiConfirm: P(CAT_UI, 3, 'ui', 0.8, 0.05, 0.3, null, false, uiConfirm),
  uiBack: P(CAT_UI, 3, 'ui', 0.8, 0.05, 0.3, null, false, uiBack),
  uiError: P(CAT_UI, 3, 'ui', 0.8, 0.12, 0.4, null, false, uiError),
  uiToggle: P(CAT_UI, 2, 'ui', 0.8, 0.04, 0.3, null, false, uiToggle),
  radio: P(CAT_RADIO, 5, 'radio', 0.8, 0.06, 0.3, null, false, radio),
};

/** Stable index per patch id (for the rate limiter's typed arrays). */
export const PATCH_IDS: readonly PatchId[] = Object.keys(PATCHES) as PatchId[];

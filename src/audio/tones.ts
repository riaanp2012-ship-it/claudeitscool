import type { CockpitTones } from '../core/types';
import { fourierSeries, periodicShape, pulseAt, type FourierSeries } from './dsp';
import { NodeSet, type AudioHost } from './host';
import { envTrap, glide, holdParam } from './params';
import {
  TONE_MAW,
  TONE_PULLUP,
  TONE_RADAR,
  TONE_RWR,
  TONE_SEEKER,
  TONE_STALL,
  ToneTracker,
} from './tonestate';

const smoothstep = (a: number, b: number, u: number): number => {
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Periodic gates and pitch contours as Fourier series (see `fourierSeries`): periodic tones need no per-event
 * scheduling, so they cost nothing per frame, and a smooth target shape cannot produce ghost blips.
 */
const PATTERNS = {
  /** RWR spike: two short chirps at the start of each period. */
  spike: fourierSeries(
    periodicShape(4096, (u) =>
      pulseAt(
        u,
        [
          [0.02, 0.12],
          [0.19, 0.29],
        ],
        0.014,
      ),
    ),
    180,
  ),
  /** Pitch rises through both chirps (the second is higher), then returns while silent. */
  spikeChirp: fourierSeries(
    periodicShape(4096, (u) => (u < 0.3 ? u / 0.3 : 1 - smoothstep(0.3, 1, u))),
    48,
  ),
  /** Missile warning: urgent pulse, half the period on. */
  maw: fourierSeries(
    periodicShape(4096, (u) => pulseAt(u, [[0.04, 0.54]], 0.07)),
    64,
  ),
  /** Stall horn: long on, short off. */
  stall: fourierSeries(
    periodicShape(4096, (u) => pulseAt(u, [[0.04, 0.64]], 0.035)),
    96,
  ),
  /** Pull-up whoop: gate and its rising pitch (which falls back while the gate is closed). */
  pullUpGate: fourierSeries(
    periodicShape(4096, (u) => pulseAt(u, [[0.02, 0.72]], 0.05)),
    80,
  ),
  pullUpPitch: fourierSeries(
    periodicShape(4096, (u) => (u < 0.72 ? Math.pow(u / 0.72, 1.3) : 1 - smoothstep(0.72, 1, u))),
    48,
  ),
} satisfies Record<string, FourierSeries>;

/** Periodic control signal: the pattern's waveform plus its mean (PeriodicWave drops the DC term). */
function periodic(s: NodeSet, series: FourierSeries, hz: number): GainNode {
  const wave = new PeriodicWave(s.ctx, { real: series.real, imag: series.imag, disableNormalization: true });
  const osc = s.customOsc(wave, hz);
  const dc = s.constant(series.mean);
  const sum = s.gain(1);
  osc.connect(sum);
  dc.connect(sum);
  return sum;
}

/** A continuous tone that is built when switched on and retired when switched off. */
class GatedTone {
  private set: NodeSet | null = null;
  private gate: GainNode | null = null;

  constructor(
    private readonly host: AudioHost,
    private readonly out: AudioNode,
    private readonly build: (s: NodeSet, out: AudioNode) => void,
    private readonly fadeIn = 0.012,
  ) {}

  get on(): boolean {
    return this.set !== null;
  }

  start(now: number): void {
    if (this.set) return;
    const s = new NodeSet(this.host.ctx);
    const gate = s.gain(0);
    gate.connect(this.out);
    this.build(s, gate);
    const t = now + this.host.lookahead;
    s.startAll(t, this.host.rnd);
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(1, t + this.fadeIn);
    this.set = s;
    this.gate = gate;
  }

  stop(now: number): void {
    if (!this.set || !this.gate) return;
    holdParam(this.gate.gain, now);
    this.gate.gain.setTargetAtTime(0, now, 0.01);
    this.set.stopAll(now + 0.12);
    this.host.retire(this.set, now + 0.15);
    this.set = null;
    this.gate = null;
  }

  toggle(on: boolean, now: number): void {
    if (on) this.start(now);
    else this.stop(now);
  }
}

/** IR seeker: a warbling, amplitude-modulated growl that snaps to a high steady tone on lock. */
class SeekerTone {
  private set: NodeSet | null = null;
  private gate: GainNode | null = null;
  private carrier: OscillatorNode | null = null;
  private fmDepth: GainNode | null = null;
  private amDepth: GainNode | null = null;
  private am: GainNode | null = null;
  private bp: BiquadFilterNode | null = null;
  private level: GainNode | null = null;

  constructor(
    private readonly host: AudioHost,
    private readonly out: AudioNode,
  ) {}

  apply(state: CockpitTones['seeker'], now: number): void {
    if (state === 'off') {
      this.stop(now);
      return;
    }
    if (!this.set) this.start(now);
    const locked = state === 'locked';
    glide(this.carrier!.frequency, locked ? 1680 : 620, now, locked ? 0.015 : 0.04);
    glide(this.fmDepth!.gain, locked ? 5 : 220, now, 0.03);
    glide(this.amDepth!.gain, locked ? 0.02 : 0.42, now, 0.03);
    glide(this.am!.gain, locked ? 0.97 : 0.56, now, 0.03);
    glide(this.bp!.frequency, locked ? 1800 : 900, now, 0.03);
    glide(this.level!.gain, locked ? 0.1 : 0.16, now, 0.03);
  }

  private start(now: number): void {
    const { ctx, bank, rnd } = this.host;
    const s = new NodeSet(ctx);
    const gate = s.gain(0);
    gate.connect(this.out);
    const carrier = s.osc('triangle', 620);
    const fm = s.buffer(bank.smoothMid, 1.5);
    const fmDepth = s.gain(220);
    fm.connect(fmDepth).connect(carrier.frequency);
    const lfo = s.osc('sine', 23);
    const amDepth = s.gain(0.42);
    const am = s.gain(0.56);
    lfo.connect(amDepth).connect(am.gain);
    const grit = s.shaper(bank.grit);
    const bp = s.filter('bandpass', 900, 0.6);
    const level = s.gain(0.16);
    carrier.connect(grit).connect(bp).connect(am).connect(level).connect(gate);
    const t = now + this.host.lookahead;
    s.startAll(t, rnd);
    gate.gain.setValueAtTime(0, t);
    gate.gain.linearRampToValueAtTime(1, t + 0.02);
    this.set = s;
    this.gate = gate;
    this.carrier = carrier;
    this.fmDepth = fmDepth;
    this.amDepth = amDepth;
    this.am = am;
    this.bp = bp;
    this.level = level;
  }

  stop(now: number): void {
    if (!this.set || !this.gate) return;
    holdParam(this.gate.gain, now);
    this.gate.gain.setTargetAtTime(0, now, 0.01);
    this.set.stopAll(now + 0.12);
    this.host.retire(this.set, now + 0.15);
    this.set = null;
    this.gate = null;
  }
}

/**
 * Cockpit tones. `set` is called every frame with the full state and only reacts to changes (ToneTracker).
 * The missile warning has priority: while it sounds, every other tone is ducked.
 */
export class CockpitTonesImpl {
  private readonly tracker = new ToneTracker();
  private readonly duck: GainNode;
  private readonly seeker: SeekerTone;
  private readonly spike: GatedTone;
  private readonly launch: GatedTone;
  private readonly maw: GatedTone;
  private readonly stall: GatedTone;
  private readonly pullUp: GatedTone;

  constructor(private readonly host: AudioHost) {
    const { ctx, mixer, bank } = host;
    this.duck = new GainNode(ctx, { gain: 1 });
    this.duck.connect(mixer.tones);
    /** Gate from a pattern into a param, through the dead-zone clamp. */
    const gate = (s: NodeSet, p: FourierSeries, hz: number, target: AudioParam): void => {
      periodic(s, p, hz).connect(s.shaper(bank.gateClamp)).connect(target);
    };

    this.seeker = new SeekerTone(host, this.duck);

    this.spike = new GatedTone(host, this.duck, (s, out) => {
      const carrier = s.osc('square', 1250);
      const lp = s.filter('lowpass', 3000, 0.7);
      const am = s.gain(0);
      const level = s.gain(0.1);
      gate(s, PATTERNS.spike, 1.35, am.gain);
      const chirp = s.gain(150);
      periodic(s, PATTERNS.spikeChirp, 1.35).connect(chirp).connect(carrier.frequency);
      carrier.connect(lp).connect(am).connect(level).connect(out);
    });

    this.launch = new GatedTone(host, this.duck, (s, out) => {
      const a = s.osc('triangle', 1225);
      const b = s.osc('square', 1225);
      const bg = s.gain(0.25);
      const lp = s.filter('lowpass', 3500, 0.7);
      const level = s.gain(0.15);
      // A hard square would switch pitch instantly (spectral splatter, audible ticks); round the edges first.
      const warble = s.osc('square', 7);
      const round = s.filter('lowpass', 45, 0.6);
      const depth = s.gain(225);
      warble.connect(round).connect(depth);
      depth.connect(a.frequency);
      depth.connect(b.frequency);
      a.connect(lp);
      b.connect(bg).connect(lp);
      lp.connect(level).connect(out);
    });

    this.maw = new GatedTone(host, mixer.tones, (s, out) => {
      const carrier = s.osc('square', 1500);
      const lp = s.filter('lowpass', 3800, 0.8);
      const am = s.gain(0);
      const level = s.gain(0.13);
      const alt = s.osc('square', 1.25);
      const altRound = s.filter('lowpass', 30, 0.6);
      const altDepth = s.gain(250);
      alt.connect(altRound).connect(altDepth).connect(carrier.frequency);
      gate(s, PATTERNS.maw, 9, am.gain);
      carrier.connect(lp).connect(am).connect(level).connect(out);
    });

    this.stall = new GatedTone(host, this.duck, (s, out) => {
      const a = s.osc('square', 380);
      const b = s.osc('square', 386);
      const lp = s.filter('lowpass', 1600, 0.9);
      const am = s.gain(0);
      const level = s.gain(0.1);
      gate(s, PATTERNS.stall, 3.2, am.gain);
      a.connect(lp);
      b.connect(lp);
      lp.connect(am).connect(level).connect(out);
    });

    this.pullUp = new GatedTone(host, this.duck, (s, out) => {
      const carrier = s.osc('sawtooth', 450);
      const lp = s.filter('lowpass', 2600, 0.8);
      const am = s.gain(0);
      const level = s.gain(0.12);
      gate(s, PATTERNS.pullUpGate, 1.8, am.gain);
      const pitchDepth = s.gain(700);
      periodic(s, PATTERNS.pullUpPitch, 1.8).connect(pitchDepth).connect(carrier.frequency);
      carrier.connect(lp).connect(am).connect(level).connect(out);
    });
  }

  /** Latest G seen by the tone tracker (0.1 G steps). */
  get g(): number {
    return this.tracker.g;
  }

  set(t: CockpitTones, now: number): void {
    const changed = this.tracker.update(t);
    if (changed === 0) return;
    const s = this.tracker;
    if (changed & TONE_SEEKER) this.seeker.apply(s.seeker, now);
    if ((changed & TONE_RADAR) !== 0 && s.radarLock) this.radarAcquired(now);
    if (changed & TONE_RWR) {
      this.spike.toggle(s.rwr === 'spike', now);
      this.launch.toggle(s.rwr === 'launch', now);
    }
    if (changed & TONE_MAW) {
      this.maw.toggle(s.missileWarning, now);
      glide(this.duck.gain, s.missileWarning ? 0.35 : 1, now, 0.03);
    }
    if (changed & TONE_STALL) this.stall.toggle(s.stall, now);
    if (changed & TONE_PULLUP) this.pullUp.toggle(s.pullUp, now);
  }

  /** Radar lock acquired: two crisp pulses. */
  private radarAcquired(now: number): void {
    const s = new NodeSet(this.host.ctx);
    const o = s.osc('sine', 1100);
    const h = s.osc('sine', 3300);
    const hg = s.gain(0.15);
    const g = s.gain(0);
    o.connect(g);
    h.connect(hg).connect(g);
    g.connect(this.duck);
    const t = now + this.host.lookahead;
    envTrap(g.gain, t, 0.006, 0.14, 0.06, 0.006);
    const end = envTrap(g.gain, t + 0.11, 0.006, 0.14, 0.06, 0.006);
    s.startAll(t, this.host.rnd);
    s.stopAll(end + 0.02);
    this.host.retire(s, end + 0.05);
  }

  stopAll(now: number): void {
    this.seeker.stop(now);
    this.spike.stop(now);
    this.launch.stop(now);
    this.maw.stop(now);
    this.stall.stop(now);
    this.pullUp.stop(now);
    glide(this.duck.gain, 1, now, 0.03);
    this.tracker.reset();
  }

  dispose(): void {
    this.duck.disconnect();
  }
}

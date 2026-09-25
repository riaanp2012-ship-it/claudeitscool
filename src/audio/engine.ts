import { Vector3 } from 'three';
import type { EngineParams, EngineVoice } from '../core/types';
import { NodeSet, type AudioHost } from './host';
import { SmoothParam, holdParam } from './params';
import { SpatialChain, type SpatialProfile } from './spatial';
import { distance, distanceGain, dopplerFactor, frontness, ratioToCents } from './util';

/** Compressor blade-pass whine at 100% rpm (Hz). */
const WHINE_HZ = 3900;
/** Shaft tone at 100% rpm (Hz). */
const CORE_HZ = 112;
/** Spooled rpm fraction at idle throttle. */
const IDLE_RPM = 0.55;
/** Whine pitch follows rpm^1.2 (cents per octave of rpm). */
const RPM_CENTS = 1440;

export const ENGINE_PROFILE: SpatialProfile = { ref: 60, rolloff: 1, maxDistance: 7000, reverb: true };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The live node graph of one audible engine. Built on activation, retired on deactivation. */
class EngineGraph {
  readonly set: NodeSet;
  readonly gate: GainNode;
  readonly igate: GainNode | null;
  readonly spatial: SpatialChain | null;
  readonly pitch: SmoothParam;
  readonly dop: SmoothParam;
  readonly level: SmoothParam;
  readonly whine: SmoothParam;
  readonly roar: SmoothParam;
  readonly roarCut: SmoothParam;
  readonly low: SmoothParam;
  readonly ab: SmoothParam;
  readonly abCut: SmoothParam;
  readonly crackle: SmoothParam;
  readonly wind: SmoothParam;
  readonly windF: SmoothParam;
  readonly damage: SmoothParam;
  readonly buffet: SmoothParam | null = null;
  readonly hum: SmoothParam | null = null;
  readonly hiss: SmoothParam | null = null;
  readonly windLp: SmoothParam | null = null;
  /** True until the first parameter write (which starts params at their targets instead of gliding). */
  fresh = true;

  constructor(host: AudioHost, player: boolean, now: number) {
    const { ctx, bank, mixer } = host;
    const s = new NodeSet(ctx);
    this.set = s;

    // Output: sum (damage AM) → level (distance for the player) → gate (activation fades).
    this.gate = s.gain(0);
    const level = s.gain(1);
    const sum = s.gain(1);
    sum.connect(level).connect(this.gate);
    if (player) {
      this.gate.connect(mixer.exterior);
      this.spatial = null;
      this.igate = s.gain(0);
      this.igate.connect(mixer.interior);
    } else {
      this.spatial = new SpatialChain(ctx, mixer.exterior, mixer.reverbSend, ENGINE_PROFILE);
      s.extras.push(this.spatial);
      this.gate.connect(this.spatial.input);
      this.igate = null;
    }

    // Control signals in cents: `pitch` (rpm + doppler) for tonal parts, `dop` (doppler) for noise beds.
    const pitch = s.constant(0);
    const dop = s.constant(0);

    // Turbine whine: narrow band of noise at the blade-pass frequency plus detuned tones through a bandpass.
    const whineOut = s.gain(0);
    whineOut.connect(sum);
    const wNoise = s.buffer(bank.white);
    const wBp = s.filter('bandpass', WHINE_HZ * 1.32, 9);
    const wBoost = s.gain(2.6);
    wNoise.connect(wBp).connect(wBoost).connect(whineOut);
    const oscA = s.osc('sawtooth', WHINE_HZ);
    const oscB = s.osc('triangle', WHINE_HZ * 0.5, 9);
    const oscC = s.osc('sine', WHINE_HZ * 1.006);
    const tBp = s.filter('bandpass', WHINE_HZ, 3.5);
    const tOut = s.gain(0.22);
    oscA.connect(tBp);
    oscB.connect(tBp);
    oscC.connect(tBp);
    tBp.connect(tOut).connect(whineOut);
    const jitter = s.buffer(bank.smoothFast, 1.3);
    const jitterDepth = s.gain(11);
    jitter.connect(jitterDepth);
    for (const p of [oscA.detune, oscB.detune, oscC.detune, wBp.detune, tBp.detune]) {
      pitch.connect(p);
      jitterDepth.connect(p);
    }

    // Broadband roar: pink noise through a throttle-driven lowpass, plus low body (brown noise + shaft tone).
    const roarOut = s.gain(0);
    roarOut.connect(sum);
    const rSrc = s.buffer(bank.pink);
    const rLp = s.filter('lowpass', 1200, 0.75);
    const rBody = s.filter('peaking', 380, 0.8, 4);
    rSrc.connect(rLp).connect(rBody).connect(roarOut);
    const lowOut = s.gain(0);
    lowOut.connect(sum);
    const lSrc = s.buffer(bank.brown);
    const lLp = s.filter('lowpass', 260, 0.8);
    lSrc.connect(lLp).connect(lowOut);
    const shaft = s.osc('sawtooth', CORE_HZ);
    const shaftLp = s.filter('lowpass', 420, 1.1);
    const shaftG = s.gain(0.09);
    shaft.connect(shaftLp).connect(shaftG).connect(lowOut);
    pitch.connect(shaft.detune);
    for (const p of [rSrc.detune, rLp.detune, lSrc.detune, lLp.detune]) dop.connect(p);

    // Afterburner: lowpassed rumble with slow random amplitude modulation, plus crackle.
    const abOut = s.gain(0);
    abOut.connect(sum);
    const abSrc = s.buffer(bank.brown, 0.9);
    const abLp = s.filter('lowpass', 300, 0.9);
    const abAm = s.gain(0.7);
    abSrc.connect(abLp).connect(abAm).connect(abOut);
    const abMod = s.buffer(bank.smoothMid);
    const abModDepth = s.gain(0.3);
    abMod.connect(abModDepth).connect(abAm.gain);
    const crOut = s.gain(0);
    crOut.connect(sum);
    const crSrc = s.buffer(bank.crackle);
    const crBp = s.filter('bandpass', 1500, 0.7);
    crSrc.connect(crBp).connect(crOut);
    for (const p of [abSrc.detune, abLp.detune, crSrc.detune, crBp.detune]) dop.connect(p);

    // Wind / airframe rush from speed and AoA. For the player it goes to the (unmuffled) interior bus.
    const windOut = s.gain(0);
    const wSrc = s.buffer(bank.pink, 1.05);
    const windBp = s.filter('bandpass', 800, 0.8);
    wSrc.connect(windBp).connect(windOut);
    dop.connect(wSrc.detune);
    dop.connect(windBp.detune);

    // Damage: random amplitude sputter on the whole engine.
    const dmgSrc = s.buffer(bank.smoothFast, 1.8);
    const dmgDepth = s.gain(0);
    dmgSrc.connect(dmgDepth).connect(sum.gain);

    this.pitch = new SmoothParam(pitch.offset, 0.05, 2, 0);
    this.dop = new SmoothParam(dop.offset, 0.03, 2, 0);
    this.level = new SmoothParam(level.gain, 0.05, 1e-3, 0.02);
    this.whine = new SmoothParam(whineOut.gain, 0.06, 5e-4, 0.02);
    this.roar = new SmoothParam(roarOut.gain, 0.06, 5e-4, 0.02);
    this.roarCut = new SmoothParam(rLp.frequency, 0.08, 5, 0.01);
    this.low = new SmoothParam(lowOut.gain, 0.06, 5e-4, 0.02);
    this.ab = new SmoothParam(abOut.gain, 0.08, 5e-4, 0.02);
    this.abCut = new SmoothParam(abLp.frequency, 0.1, 5, 0.02);
    this.crackle = new SmoothParam(crOut.gain, 0.08, 5e-4, 0.02);
    this.wind = new SmoothParam(windOut.gain, 0.08, 5e-4, 0.02);
    this.windF = new SmoothParam(windBp.frequency, 0.1, 5, 0.02);
    this.damage = new SmoothParam(dmgDepth.gain, 0.1, 5e-3, 0.05);

    if (player && this.igate) {
      const windLp = s.filter('lowpass', 9000, 0.6);
      windOut.connect(windLp).connect(this.igate);
      this.windLp = new SmoothParam(windLp.frequency, 0.08, 10, 0.02);

      // Buffet: very low rumble shaken by a fast random modulator near the stall.
      const bSrc = s.buffer(bank.brown, 0.8);
      const bLp = s.filter('lowpass', 85, 1);
      const bAm = s.gain(0.5);
      const bMod = s.buffer(bank.smoothFast, 0.75);
      const bModDepth = s.gain(0.5);
      bMod.connect(bModDepth).connect(bAm.gain);
      const bOut = s.gain(0);
      bSrc.connect(bLp).connect(bAm).connect(bOut).connect(this.igate);
      this.buffet = new SmoothParam(bOut.gain, 0.08, 5e-4, 0.02);

      // Cockpit hum: 400 Hz avionics power with a little harmonic content, plus environmental-control hiss.
      const humOut = s.gain(0);
      humOut.connect(this.igate);
      const h1 = s.osc('sine', 400);
      const h2 = s.osc('triangle', 800, 4);
      const h2g = s.gain(0.3);
      const h3 = s.osc('sine', 120);
      const h3g = s.gain(0.6);
      h1.connect(humOut);
      h2.connect(h2g).connect(humOut);
      h3.connect(h3g).connect(humOut);
      this.hum = new SmoothParam(humOut.gain, 0.1, 2e-4, 0.02);
      const hsSrc = s.buffer(bank.pink, 0.9);
      const hsHp = s.filter('highpass', 2600, 0.7);
      const hsOut = s.gain(0);
      hsSrc.connect(hsHp).connect(hsOut).connect(this.igate);
      this.hiss = new SmoothParam(hsOut.gain, 0.1, 2e-4, 0.02);
    } else {
      windOut.connect(sum);
    }

    const t = now + host.lookahead;
    s.startAll(t, host.rnd);
    // Fade in; nothing sounds before the gate opens.
    this.gate.gain.setValueAtTime(0, t);
    this.gate.gain.linearRampToValueAtTime(1, t + 0.25);
    if (this.igate) {
      this.igate.gain.setValueAtTime(0, t);
      this.igate.gain.linearRampToValueAtTime(1, t + 0.25);
    }
  }

  /** Fades out, stops every source after the fade and hands the graph to the host for disconnection. */
  retire(host: AudioHost, now: number): void {
    holdParam(this.gate.gain, now);
    this.gate.gain.setTargetAtTime(0, now, 0.05);
    if (this.igate) {
      holdParam(this.igate.gain, now);
      this.igate.gain.setTargetAtTime(0, now, 0.05);
    }
    const end = now + 0.45;
    this.set.stopAll(end);
    host.retire(this.set, end + 0.05);
  }
}

/**
 * Engine voice: turbine whine, roar, afterburner rumble and crackle, wind, damage sputter; for the player also
 * buffet, cockpit hum and hiss (the G-strain layer is a separate voice driven from the player's G).
 * `set` only copies numbers; `update` (called once per frame by the core) turns them into audio.
 */
export class EngineVoiceImpl implements EngineVoice {
  readonly params: EngineParams = {
    throttle: 0,
    afterburner: 0,
    speed: 0,
    mach: 0,
    g: 1,
    aoa: 0,
    position: new Vector3(),
    velocity: new Vector3(),
    cockpit: false,
    damaged: 0,
  };
  hasParams = false;
  disposed = false;
  /** Estimated loudness at the listener (for choosing which AI engines are audible). */
  score = 0;
  private graph: EngineGraph | null = null;

  constructor(
    private readonly host: AudioHost,
    readonly isPlayer: boolean,
    private readonly onDispose: (v: EngineVoiceImpl) => void,
  ) {}

  get active(): boolean {
    return this.graph !== null;
  }

  set(p: EngineParams): void {
    if (this.disposed) return;
    const o = this.params;
    o.throttle = p.throttle;
    o.afterburner = p.afterburner;
    o.speed = p.speed;
    o.mach = p.mach;
    o.g = p.g;
    o.aoa = p.aoa;
    o.position.copy(p.position);
    o.velocity.copy(p.velocity);
    o.cockpit = p.cockpit;
    o.damaged = p.damaged;
    this.hasParams = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.silence(this.host.ctx.currentTime);
    this.onDispose(this);
  }

  /** Stops sounding until `set` is called again (stopAll / restart). */
  reset(now: number): void {
    this.silence(now);
    this.hasParams = false;
  }

  silence(now: number): void {
    if (this.graph) {
      this.graph.retire(this.host, now);
      this.graph = null;
    }
  }

  computeScore(): number {
    if (!this.hasParams || this.disposed) return (this.score = 0);
    const p = this.params;
    const loud = 0.35 + 0.5 * clamp01(p.throttle) + 0.5 * clamp01(p.afterburner);
    const d = distance(p.position, this.host.listener.position);
    this.score =
      loud * distanceGain(d, ENGINE_PROFILE.ref, ENGINE_PROFILE.rolloff, ENGINE_PROFILE.maxDistance);
    return this.score;
  }

  /**
   * `canBuild` is false when this frame's graph-building budget is spent; the voice then starts next frame.
   * Returns true when a graph was built.
   */
  update(now: number, audible: boolean, canBuild = true): boolean {
    const want = audible && this.hasParams && !this.disposed;
    let built = false;
    if (want && !this.graph && canBuild) {
      this.graph = new EngineGraph(this.host, this.isPlayer, now);
      built = true;
    } else if (!want && this.graph) this.silence(now);
    if (this.graph) this.apply(this.graph, now);
    return built;
  }

  private apply(g: EngineGraph, now: number): void {
    const p = this.params;
    const L = this.host.listener;
    const f = g.fresh;
    g.fresh = false;
    const thr = clamp01(p.throttle);
    const ab = clamp01(p.afterburner);
    const rpm = IDLE_RPM + (1 - IDLE_RPM) * thr;
    const aoa = Math.abs(Number.isFinite(p.aoa) ? p.aoa : 0);
    const speed = Number.isFinite(p.speed) ? Math.max(0, p.speed) : 0;
    const speedN = speed / 300;
    const aoaF = smooth(0.06, 0.35, aoa);

    let dopCents = 0;
    let front = 0;
    if (!this.isPlayer) {
      dopCents = ratioToCents(dopplerFactor(p.position, p.velocity, L.position, L.velocity));
      front = frontness(p.position, p.velocity, L.position);
    } else if (!p.cockpit) {
      front = frontness(p.position, p.velocity, L.position);
    }
    // Intake whine is heard ahead of the jet, nozzle roar behind it.
    const whineW = 0.65 + 0.75 * Math.max(0, front);
    const roarW = 0.8 + 0.45 * Math.max(0, -front);

    g.pitch.put(RPM_CENTS * Math.log2(rpm) + dopCents, now, f);
    g.dop.put(dopCents, now, f);
    g.whine.put((0.07 + 0.05 * thr) * whineW * (1 - 0.35 * ab), now, f);
    g.roar.put((0.035 + 0.36 * Math.pow(thr, 1.6)) * roarW, now, f);
    g.roarCut.put(520 + 2600 * Math.pow(thr, 1.3) + 1600 * ab, now, f);
    g.low.put((0.09 + 0.24 * thr) * roarW, now, f);
    g.ab.put(0.55 * ab * roarW, now, f);
    g.abCut.put(210 + 190 * ab, now, f);
    g.crackle.put(0.11 * ab * roarW, now, f);
    const windBase = 0.3 * Math.min(2.2, speedN * speedN) * (1 + 1.2 * aoaF);
    g.windF.put(380 + 1100 * Math.min(1.6, speedN) - 150 * aoaF, now, f);
    g.damage.put(0.45 * clamp01(p.damaged), now, f);

    if (this.isPlayer) {
      const d = distance(p.position, L.position);
      g.level.put(distanceGain(d, ENGINE_PROFILE.ref, 1, ENGINE_PROFILE.maxDistance), now, f);
      const cockpit = p.cockpit === true;
      this.host.mixer.setCockpit(cockpit, now);
      g.wind.put(windBase * (cockpit ? 0.85 : 0.7), now, f);
      g.windLp?.put(cockpit ? 2600 : 9000, now, f);
      const stallF = smooth(0.24, 0.38, aoa) * smooth(35, 80, speed);
      const mach = Number.isFinite(p.mach) ? p.mach : 0;
      const transonic = Math.max(0, 1 - Math.abs(mach - 1) / 0.06);
      g.buffet?.put(0.6 * stallF + 0.12 * transonic, now, f);
      g.hum?.put(cockpit ? 0.018 : 0, now, f);
      g.hiss?.put(cockpit ? 0.012 + 0.02 * Math.min(1.5, speedN) : 0, now, f);
    } else {
      g.wind.put(windBase * 0.8, now, f);
      g.spatial?.update(now, p.position, L, 1);
    }
  }
}

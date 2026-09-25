import { Vector3 } from 'three';
import type { GunVoice } from '../core/types';
import { GUN25_LOOP, GUN30_LOOP } from './dsp';
import { NodeSet, type AudioHost } from './host';
import { SmoothParam, envAD, holdParam } from './params';
import { SpatialChain, type SpatialProfile } from './spatial';
import { distance, distanceGain, dopplerFactor, ratioToCents } from './util';

export type GunKind = 'gun25' | 'gun30';

/** Time from trigger to the first round's crack (s). */
const FIRST_ROUND_DELAY = 0.014;

export const GUN_PROFILE: SpatialProfile = { ref: 40, rolloff: 1, maxDistance: 4500, reverb: true };

interface GunTuning {
  /** Loop playback rate at the first round (spin-up starts slow and rises to 1). */
  spinFrom: number;
  spinTc: number;
  /** Rate the last rounds fall to while the gate closes. */
  spinDown: number;
  level: number;
  /** Electric drive motor whine (rotary cannon only). */
  motor: boolean;
  tailLevel: number;
}

const TUNING: Record<GunKind, GunTuning> = {
  gun25: { spinFrom: 0.5, spinTc: 0.07, spinDown: 0.62, level: 0.55, motor: true, tailLevel: 0.2 },
  gun30: { spinFrom: 0.82, spinTc: 0.02, spinDown: 0.86, level: 0.5, motor: false, tailLevel: 0.28 },
};

/** One trigger pull: the loop, its gate and (for AI guns) a spatial chain. */
class Burst {
  readonly set: NodeSet;
  readonly gate: GainNode;
  readonly loop: AudioBufferSourceNode;
  readonly dop: SmoothParam;
  readonly spatial: SpatialChain | null;
  readonly out: AudioNode;
  private readonly motorOsc: OscillatorNode[] = [];
  private readonly motorGain: GainNode | null = null;

  constructor(host: AudioHost, kind: GunKind, player: boolean, now: number, pos: Vector3) {
    const { ctx, bank, mixer } = host;
    const tune = TUNING[kind];
    const s = new NodeSet(ctx);
    this.set = s;
    const t = now + host.lookahead;
    this.gate = s.gain(0);
    const level = s.gain(tune.level * (player ? 1 : 0.85));
    this.loop = s.buffer(kind === 'gun25' ? bank.gun25 : bank.gun30, tune.spinFrom);
    if (player) {
      // Close and punchy: a touch of saturation for grit, extra low-end thump and presence.
      const grit = s.shaper(bank.grit, '2x');
      const shelf = s.filter('lowshelf', 130, 0.7, 5);
      const presence = s.filter('peaking', 2300, 1, 2.5);
      // The gate sits right after the source: the oversampling shaper adds latency, and the loop's first
      // sample is mid-round, so gating after the shaper would let that step through a half-open gate.
      this.loop.connect(this.gate).connect(grit).connect(shelf).connect(presence).connect(level);
      level.connect(mixer.interior);
      this.out = mixer.interior;
      this.spatial = null;
    } else {
      this.loop.connect(this.gate);
      this.spatial = new SpatialChain(ctx, mixer.exterior, mixer.reverbSend, GUN_PROFILE);
      s.extras.push(this.spatial);
      this.gate.connect(level).connect(this.spatial.input);
      this.out = this.spatial.input;
      this.spatial.update(now, pos, host.listener, 1);
    }
    this.dop = new SmoothParam(this.loop.detune, 0.03, 3, 0);

    // Start between rounds so the first crack lands ~14 ms in, after the gate has fully opened.
    const spec = kind === 'gun25' ? GUN25_LOOP : GUN30_LOOP;
    const period = Math.round(ctx.sampleRate / spec.rate) / ctx.sampleRate;
    this.loop.start(t, Math.max(0, period - FIRST_ROUND_DELAY));
    this.gate.gain.setValueAtTime(0, t);
    this.gate.gain.linearRampToValueAtTime(1, t + 0.012);
    this.loop.playbackRate.setValueAtTime(tune.spinFrom, t);
    this.loop.playbackRate.setTargetAtTime(1, t, tune.spinTc);

    if (tune.motor && player) {
      const a = s.osc('sawtooth', 160, -7);
      const b = s.osc('sawtooth', 160, 7);
      const bp = s.filter('bandpass', 900, 1.2);
      const g = s.gain(0);
      a.connect(bp);
      b.connect(bp);
      bp.connect(g).connect(level);
      for (const o of [a, b]) {
        o.frequency.setValueAtTime(160, t);
        o.frequency.setTargetAtTime(640, t, 0.08);
        o.start(t);
        this.motorOsc.push(o);
      }
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.06);
      this.motorGain = g;
    }
  }

  /** Spin down: the gate closes while the last rounds slow, then a short tail rings out. */
  release(host: AudioHost, now: number, kind: GunKind, tail: boolean): void {
    const tune = TUNING[kind];
    holdParam(this.gate.gain, now);
    this.gate.gain.setTargetAtTime(0, now, 0.028);
    holdParam(this.loop.playbackRate, now);
    this.loop.playbackRate.setTargetAtTime(tune.spinDown, now, 0.08);
    this.loop.stop(now + 0.3);
    let end = now + 0.35;
    if (this.motorGain) {
      for (const o of this.motorOsc) {
        holdParam(o.frequency, now);
        o.frequency.setTargetAtTime(130, now, 0.25);
        o.stop(now + 1.2);
      }
      holdParam(this.motorGain.gain, now);
      this.motorGain.gain.setTargetAtTime(0, now + 0.04, 0.16);
      end = now + 1.25;
    }
    if (tail) {
      // Echo of the last rounds: low, decaying rumble.
      const src = this.set.buffer(host.bank.brown, 1, true);
      const lp = this.set.filter('lowpass', kind === 'gun25' ? 420 : 320, 0.8);
      const g = this.set.gain(0);
      src.connect(lp).connect(g).connect(this.out);
      const t = now + 0.01;
      const tEnd = envAD(g.gain, t, 0.012, tune.tailLevel, 0.5);
      src.start(t, host.rnd.next() * host.bank.brown.duration);
      src.stop(tEnd + 0.01);
      end = Math.max(end, tEnd + 0.02);
    }
    host.retire(this.set, end + 0.05);
  }
}

/**
 * Gun voice: a seamless procedural loop of individual rounds at the fire rate (the buzz), with spin-up
 * (rate rises from slow to full), spin-down and a tail when the trigger is released. AI guns are spatialized
 * with doppler; the player's gun is close and punchy.
 */
export class GunVoiceImpl implements GunVoice {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  firing = false;
  disposed = false;
  score = 0;
  private burst: Burst | null = null;

  constructor(
    private readonly host: AudioHost,
    readonly kind: GunKind,
    readonly isPlayer: boolean,
    private readonly onDispose: (v: GunVoiceImpl) => void,
  ) {}

  setFiring(firing: boolean, position: Vector3, velocity: Vector3): void {
    if (this.disposed) return;
    this.firing = firing === true;
    this.position.copy(position);
    this.velocity.copy(velocity);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.firing = false;
    this.silence(this.host.ctx.currentTime, false);
    this.onDispose(this);
  }

  computeScore(): number {
    if (!this.firing || this.disposed) return (this.score = 0);
    const d = distance(this.position, this.host.listener.position);
    this.score = distanceGain(d, GUN_PROFILE.ref, GUN_PROFILE.rolloff, GUN_PROFILE.maxDistance);
    return this.score;
  }

  /** Stops the current burst (with its tail when the trigger was released normally). */
  silence(now: number, tail: boolean): void {
    if (!this.burst) return;
    this.burst.release(this.host, now, this.kind, tail);
    this.burst = null;
  }

  reset(now: number): void {
    this.firing = false;
    this.silence(now, false);
  }

  update(now: number, audible: boolean): void {
    const want = this.firing && audible && !this.disposed;
    if (want && !this.burst) {
      this.burst = new Burst(this.host, this.kind, this.isPlayer, now, this.position);
    } else if (!want && this.burst) {
      this.silence(now, !this.firing);
    }
    const b = this.burst;
    if (b && b.spatial) {
      const L = this.host.listener;
      b.dop.set(ratioToCents(dopplerFactor(this.position, this.velocity, L.position, L.velocity)), now);
      b.spatial.update(now, this.position, L, 1);
    }
  }
}

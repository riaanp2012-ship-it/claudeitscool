import type { Rng } from '../core/rng';
import type { SoundBank } from './bank';
import type { Mixer } from './mixer';
import { safeDisconnect, safeStop } from './params';
import type { ListenerState } from './spatial';

/** What every voice needs from the audio core. */
export interface AudioHost {
  readonly ctx: BaseAudioContext;
  readonly bank: SoundBank;
  readonly mixer: Mixer;
  readonly listener: ListenerState;
  /** Cosmetic randomness (variation only; never simulation). */
  readonly rnd: Rng;
  /** Lead time (s) before newly built sounds start, so their first ramp is never already in the past. */
  readonly lookahead: number;
  /** Disconnects a finished graph once `at` has passed (keeps teardown off the audio-critical path). */
  retire(graph: NodeSet, at: number): void;
}

/** A group of nodes built together and torn down together. */
export class NodeSet {
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly nodes: AudioNode[] = [];
  /** Sub-graphs (such as a spatial chain) torn down with this set. */
  readonly extras: { disconnect(): void }[] = [];

  constructor(readonly ctx: BaseAudioContext) {}

  gain(value: number): GainNode {
    const n = new GainNode(this.ctx, { gain: value });
    this.nodes.push(n);
    return n;
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.707, gain = 0): BiquadFilterNode {
    const n = new BiquadFilterNode(this.ctx, { type, frequency, Q: q, gain });
    this.nodes.push(n);
    return n;
  }

  shaper(curve: Float32Array<ArrayBuffer>, oversample: OverSampleType = 'none'): WaveShaperNode {
    const n = new WaveShaperNode(this.ctx, { curve, oversample });
    this.nodes.push(n);
    return n;
  }

  delay(time: number, max: number): DelayNode {
    const n = new DelayNode(this.ctx, { delayTime: time, maxDelayTime: max });
    this.nodes.push(n);
    return n;
  }

  osc(type: OscillatorType, frequency: number, detune = 0): OscillatorNode {
    const n = new OscillatorNode(this.ctx, { type, frequency, detune });
    this.sources.push(n);
    return n;
  }

  customOsc(wave: PeriodicWave, frequency: number): OscillatorNode {
    const n = new OscillatorNode(this.ctx, { type: 'custom', periodicWave: wave, frequency });
    this.sources.push(n);
    return n;
  }

  /** Buffer source; loops by default. */
  buffer(buffer: AudioBuffer, rate = 1, loop = true): AudioBufferSourceNode {
    const n = new AudioBufferSourceNode(this.ctx, { buffer, loop, playbackRate: rate });
    this.sources.push(n);
    return n;
  }

  constant(offset: number): ConstantSourceNode {
    const n = new ConstantSourceNode(this.ctx, { offset });
    this.sources.push(n);
    return n;
  }

  /** Starts every source at `when`; looping buffers start at a random offset so layers never phase-lock. */
  startAll(when: number, rnd: Rng): void {
    for (const s of this.sources) {
      if (s instanceof AudioBufferSourceNode && s.loop && s.buffer)
        s.start(when, rnd.next() * s.buffer.duration);
      else s.start(when);
    }
  }

  stopAll(when: number): void {
    for (const s of this.sources) safeStop(s, when);
  }

  disconnect(): void {
    for (const s of this.sources) safeDisconnect(s);
    for (const n of this.nodes) safeDisconnect(n);
    for (const e of this.extras) e.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
    this.extras.length = 0;
  }
}

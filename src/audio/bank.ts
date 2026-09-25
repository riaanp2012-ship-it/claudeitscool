import { Rng } from '../core/rng';
import {
  GUN25_LOOP,
  GUN30_LOOP,
  brownNoise,
  crackleNoise,
  gunLoop,
  pinkNoise,
  gateClampCurve,
  reverbImpulse,
  saturationCurve,
  seamlessLoop,
  smoothNoise,
  softClipCurve,
  sonicBoomWave,
  whiteNoise,
  type Samples,
} from './dsp';

/** Raw sample data, generated once per sample rate and shared by every context at that rate. */
interface BankData {
  white: Samples;
  pink: Samples;
  brown: Samples;
  crackle: Samples;
  smoothSlow: Samples;
  smoothMid: Samples;
  smoothFast: Samples;
  gun25: Samples;
  gun30: Samples;
  boom: Samples;
  outdoorIr: [Samples, Samples];
  hallIr: [Samples, Samples];
}

const cache = new Map<number, BankData>();

/** Fixed seed: the noise beds are part of the sound design and must be identical on every run. */
const BANK_SEED = 0x5a1a54;

function generate(sampleRate: number): BankData {
  const rng = new Rng(BANK_SEED);
  const sec = (s: number): number => Math.floor(s * sampleRate);
  return {
    white: seamlessLoop(whiteNoise(sec(2.1), rng), sec(0.05)),
    pink: pinkNoise(sec(3), rng),
    brown: brownNoise(sec(3.5), rng, sampleRate),
    crackle: crackleNoise(sec(3), sampleRate, 55, rng),
    smoothSlow: smoothNoise(sec(8), sampleRate, 0.9, rng),
    smoothMid: smoothNoise(sec(4), sampleRate, 5, rng),
    smoothFast: smoothNoise(sec(3), sampleRate, 17, rng),
    gun25: gunLoop(GUN25_LOOP, sampleRate, rng),
    gun30: gunLoop(GUN30_LOOP, sampleRate, rng),
    boom: sonicBoomWave(sampleRate, rng),
    outdoorIr: reverbImpulse(sampleRate, 2.4, rng, 0.35, 0.03),
    hallIr: reverbImpulse(sampleRate, 5.5, rng, 0.22, 0.02),
  };
}

function buffer(ctx: BaseAudioContext, channels: readonly Samples[]): AudioBuffer {
  const first = channels[0]!;
  const b = new AudioBuffer({
    numberOfChannels: channels.length,
    length: first.length,
    sampleRate: ctx.sampleRate,
  });
  for (let c = 0; c < channels.length; c++) b.copyToChannel(channels[c]!, c);
  return b;
}

/**
 * Every procedurally generated buffer, curve and wave the audio module plays, bound to one context.
 * All loops are seamless; all one-shots start and end at zero.
 */
export class SoundBank {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly crackle: AudioBuffer;
  /** Smooth random control signals in [-1, 1] at ~0.9, 5 and 17 new values per second. */
  readonly smoothSlow: AudioBuffer;
  readonly smoothMid: AudioBuffer;
  readonly smoothFast: AudioBuffer;
  readonly gun25: AudioBuffer;
  readonly gun30: AudioBuffer;
  readonly boom: AudioBuffer;
  readonly outdoorIr: AudioBuffer;
  readonly hallIr: AudioBuffer;
  /** Dead-zone clamp for Fourier gate signals (see `fourierSeries`). */
  readonly gateClamp: Samples;
  readonly softClip: Samples;
  readonly grit: Samples;
  readonly radioGrit: Samples;
  /** Input range covered by `softClip` (the shaper is fed input / SOFT_CLIP_RANGE). */
  static readonly SOFT_CLIP_RANGE = 2;

  constructor(ctx: BaseAudioContext) {
    let data = cache.get(ctx.sampleRate);
    if (!data) {
      data = generate(ctx.sampleRate);
      cache.set(ctx.sampleRate, data);
    }
    this.white = buffer(ctx, [data.white]);
    this.pink = buffer(ctx, [data.pink]);
    this.brown = buffer(ctx, [data.brown]);
    this.crackle = buffer(ctx, [data.crackle]);
    this.smoothSlow = buffer(ctx, [data.smoothSlow]);
    this.smoothMid = buffer(ctx, [data.smoothMid]);
    this.smoothFast = buffer(ctx, [data.smoothFast]);
    this.gun25 = buffer(ctx, [data.gun25]);
    this.gun30 = buffer(ctx, [data.gun30]);
    this.boom = buffer(ctx, [data.boom]);
    this.outdoorIr = buffer(ctx, data.outdoorIr);
    this.hallIr = buffer(ctx, data.hallIr);
    this.gateClamp = gateClampCurve(2049, 0.02);
    this.softClip = softClipCurve(4097, SoundBank.SOFT_CLIP_RANGE, 0.72, 0.975);
    this.grit = saturationCurve(2049, 1.8);
    this.radioGrit = saturationCurve(2049, 3.2);
  }
}

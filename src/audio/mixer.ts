import type { AudioVolumes } from '../core/types';
import { SoundBank } from './bank';
import { SmoothParam, glide, safeDisconnect } from './params';
import { volumeToGain } from './util';

export interface MixerOptions {
  /** Master compressor + limiter + soft ceiling. Off only for dry offline measurement. */
  dynamics: boolean;
  volumes: AudioVolumes;
}

/**
 * Bus layout:
 *
 *   exterior (cockpit muffle LP) ─┐
 *   interior ─────────────────────┼─ gameGate (pause) ─ effects (vol) ─ duck (radio) ─┐
 *   tones ────────────────────────┘                                                   │
 *   music (vol) ───────────────────────────────────────────────────────────────────── master (vol) ─ mute
 *   radio (vol) ─────────────────────────────────────────────────────────────────────┤
 *   ui (vol) ────────────────────────────────────────────────────────────────────────┘
 *   mute ─ compressor ─ trim ─ limiter ─ trim ─ soft ceiling (≤ 0.975) ─ destination
 *
 * The outdoor reverb (a shared convolver) returns into the exterior bus, so it is muffled in the cockpit
 * and paused with the game.
 */
export class Mixer {
  readonly master: GainNode;
  readonly music: GainNode;
  readonly effects: GainNode;
  readonly radio: GainNode;
  readonly ui: GainNode;
  readonly gameGate: GainNode;
  readonly exterior: GainNode;
  readonly interior: GainNode;
  readonly tones: GainNode;
  /** Send input of the shared outdoor reverb. */
  readonly reverbSend: GainNode;

  private readonly mute: GainNode;
  private readonly duck: GainNode;
  private readonly exteriorLp: BiquadFilterNode;
  private readonly exteriorIn: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly chain: AudioNode[] = [];
  private readonly vol: Record<keyof AudioVolumes, SmoothParam>;
  private readonly cockpitCut: SmoothParam;
  private readonly cockpitGain: SmoothParam;
  private paused = false;
  private muted = false;
  private cockpit = false;

  constructor(
    readonly ctx: BaseAudioContext,
    bank: SoundBank,
    options: MixerOptions,
  ) {
    const v = options.volumes;
    this.master = new GainNode(ctx, { gain: volumeToGain(v.master) });
    this.mute = new GainNode(ctx, { gain: 1 });
    this.music = new GainNode(ctx, { gain: volumeToGain(v.music) });
    this.effects = new GainNode(ctx, { gain: volumeToGain(v.effects) });
    this.radio = new GainNode(ctx, { gain: volumeToGain(v.radio) });
    this.ui = new GainNode(ctx, { gain: volumeToGain(v.ui) });
    this.duck = new GainNode(ctx, { gain: 1 });
    this.gameGate = new GainNode(ctx, { gain: 1 });
    this.exterior = new GainNode(ctx, { gain: 1 });
    this.exteriorIn = new GainNode(ctx, { gain: 1 });
    this.exteriorLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.interior = new GainNode(ctx, { gain: 1 });
    this.tones = new GainNode(ctx, { gain: 0.8 });
    this.reverbSend = new GainNode(ctx, { gain: 1 });
    this.reverb = new ConvolverNode(ctx, { buffer: bank.outdoorIr, disableNormalization: false });
    const reverbReturn = new GainNode(ctx, { gain: 0.55 });

    this.exterior.connect(this.exteriorLp).connect(this.exteriorIn).connect(this.gameGate);
    this.reverbSend.connect(this.reverb).connect(reverbReturn).connect(this.exterior);
    this.interior.connect(this.gameGate);
    this.tones.connect(this.gameGate);
    this.gameGate.connect(this.effects).connect(this.duck).connect(this.master);
    this.music.connect(this.master);
    this.radio.connect(this.master);
    this.ui.connect(this.master);
    this.master.connect(this.mute);

    if (options.dynamics) {
      // Glue compressor, then a fast limiter, each followed by a trim that cancels the automatic makeup gain
      // DynamicsCompressorNode applies, then a soft ceiling that no transient can pass (ZD-I03).
      const comp = new DynamicsCompressorNode(ctx, {
        threshold: -16,
        knee: 10,
        ratio: 3,
        attack: 0.006,
        release: 0.25,
      });
      const compTrim = new GainNode(ctx, { gain: 0.572 });
      const limiter = new DynamicsCompressorNode(ctx, {
        threshold: -3,
        knee: 0,
        ratio: 20,
        attack: 0.001,
        release: 0.12,
      });
      const limTrim = new GainNode(ctx, { gain: 0.86 / SoundBank.SOFT_CLIP_RANGE });
      const ceiling = new WaveShaperNode(ctx, { curve: bank.softClip, oversample: '2x' });
      this.mute.connect(comp).connect(compTrim).connect(limiter).connect(limTrim).connect(ceiling);
      ceiling.connect(ctx.destination);
      this.chain.push(comp, compTrim, limiter, limTrim, ceiling);
    } else {
      this.mute.connect(ctx.destination);
    }

    this.vol = {
      master: new SmoothParam(this.master.gain, 0.03, 1e-4, 0.005),
      music: new SmoothParam(this.music.gain, 0.03, 1e-4, 0.005),
      effects: new SmoothParam(this.effects.gain, 0.03, 1e-4, 0.005),
      radio: new SmoothParam(this.radio.gain, 0.03, 1e-4, 0.005),
      ui: new SmoothParam(this.ui.gain, 0.03, 1e-4, 0.005),
    };
    this.cockpitCut = new SmoothParam(this.exteriorLp.frequency, 0.06, 1, 0.01);
    this.cockpitGain = new SmoothParam(this.exteriorIn.gain, 0.06, 1e-3, 0.01);
  }

  setVolumes(v: AudioVolumes, now: number): void {
    this.vol.master.set(volumeToGain(v.master), now);
    this.vol.music.set(volumeToGain(v.music), now);
    this.vol.effects.set(volumeToGain(v.effects), now);
    this.vol.radio.set(volumeToGain(v.radio), now);
    this.vol.ui.set(volumeToGain(v.ui), now);
  }

  /** Pause silences game audio (engines, guns, tones, world SFX); UI and music keep playing. */
  setPaused(paused: boolean, now: number): void {
    if (paused === this.paused) return;
    this.paused = paused;
    glide(this.gameGate.gain, paused ? 0 : 1, now, paused ? 0.02 : 0.05);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setMuted(muted: boolean, now: number): void {
    if (muted === this.muted) return;
    this.muted = muted;
    glide(this.mute.gain, muted ? 0 : 1, now, 0.02);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Inside the cockpit the canopy muffles everything outside it. */
  setCockpit(on: boolean, now: number): void {
    if (on === this.cockpit) return;
    this.cockpit = on;
    this.cockpitCut.set(on ? 950 : 20000, now);
    this.cockpitGain.set(on ? 0.62 : 1, now);
  }

  get inCockpit(): boolean {
    return this.cockpit;
  }

  /** Radio lines duck the effects bus by ~5 dB for a moment. */
  duckForRadio(now: number, hold: number): void {
    const g = this.duck.gain;
    glide(g, 0.56, now, 0.03);
    g.setTargetAtTime(1, now + hold, 0.25);
  }

  dispose(): void {
    for (const n of this.chain) safeDisconnect(n);
    safeDisconnect(this.mute);
    safeDisconnect(this.master);
    safeDisconnect(this.music);
    safeDisconnect(this.radio);
    safeDisconnect(this.ui);
    safeDisconnect(this.duck);
    safeDisconnect(this.effects);
    safeDisconnect(this.gameGate);
    safeDisconnect(this.exterior);
    safeDisconnect(this.exteriorLp);
    safeDisconnect(this.exteriorIn);
    safeDisconnect(this.interior);
    safeDisconnect(this.tones);
    safeDisconnect(this.reverbSend);
    safeDisconnect(this.reverb);
  }
}

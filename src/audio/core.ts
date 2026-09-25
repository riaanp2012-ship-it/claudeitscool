import type { Quaternion, Vector3 } from 'three';
import { cosmetic, type Rng } from '../core/rng';
import type { AudioVolumes, CockpitTones, EngineVoice, GunVoice, SfxId } from '../core/types';
import { SoundBank } from './bank';
import { EngineVoiceImpl } from './engine';
import { GunVoiceImpl, type GunKind } from './gun';
import type { AudioHost, NodeSet } from './host';
import { Mixer } from './mixer';
import { MenuMusic } from './music';
import type { PatchId } from './patches';
import { SfxPlayer, type PlayOptions } from './sfx';
import { ListenerState } from './spatial';
import { StrainVoice } from './strain';
import { CockpitTonesImpl } from './tones';
import { AudibleSelector } from './voices';

export interface AudioCoreOptions {
  /** Master compressor/limiter/ceiling (default true). Off only for dry offline measurement. */
  dynamics?: boolean;
  /** Variation source (default: the shared cosmetic stream). */
  rng?: Rng;
  /** Scheduling lead for new sounds (default 10 ms; 0 for offline rendering). */
  lookahead?: number;
  volumes?: AudioVolumes;
  /** Audible AI engines (nearest/loudest), besides the player's. */
  maxAiEngines?: number;
  /** Audible AI guns, besides the player's. */
  maxAiGuns?: number;
}

export const DEFAULT_VOLUMES: Readonly<AudioVolumes> = {
  master: 0.8,
  music: 0.5,
  effects: 0.9,
  radio: 0.8,
  ui: 0.6,
};

/**
 * The audio engine proper, built against any BaseAudioContext so the exact same graphs render in real time
 * and in an OfflineAudioContext (verification harness). The public AudioSystem wraps it with the autoplay
 * unlock and pre-unlock no-ops.
 */
export class AudioCore implements AudioHost {
  readonly bank: SoundBank;
  readonly mixer: Mixer;
  readonly listener = new ListenerState();
  readonly rnd: Rng;
  readonly lookahead: number;
  readonly sfx: SfxPlayer;
  readonly tones: CockpitTonesImpl;
  readonly strain: StrainVoice;
  readonly music: MenuMusic;

  private readonly engines: EngineVoiceImpl[] = [];
  private readonly guns: GunVoiceImpl[] = [];
  private readonly selector = new AudibleSelector(64);
  private scores = new Float32Array(64);
  private selected = new Uint8Array(64);
  private readonly retiredSets: NodeSet[] = [];
  private readonly retiredAt: number[] = [];
  private readonly maxAiEngines: number;
  private readonly maxAiGuns: number;
  private paused = false;
  private disposed = false;

  constructor(
    readonly ctx: BaseAudioContext,
    options: AudioCoreOptions = {},
  ) {
    this.rnd = options.rng ?? cosmetic;
    this.lookahead = options.lookahead ?? 0.01;
    this.maxAiEngines = options.maxAiEngines ?? 5;
    this.maxAiGuns = options.maxAiGuns ?? 4;
    this.bank = new SoundBank(ctx);
    this.mixer = new Mixer(ctx, this.bank, {
      dynamics: options.dynamics ?? true,
      volumes: options.volumes ?? DEFAULT_VOLUMES,
    });
    this.sfx = new SfxPlayer(this);
    this.tones = new CockpitTonesImpl(this);
    this.strain = new StrainVoice(this);
    this.music = new MenuMusic(this);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  retire(set: NodeSet, at: number): void {
    this.retiredSets.push(set);
    this.retiredAt.push(at);
  }

  setVolumes(v: AudioVolumes): void {
    if (this.disposed) return;
    this.mixer.setVolumes(v, this.now);
  }

  setListener(position: Vector3, quaternion: Quaternion, velocity: Vector3): void {
    this.listener.set(position, quaternion, velocity);
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.paused = paused;
    const now = this.now;
    this.mixer.setPaused(paused, now);
    if (paused) this.strain.stop(now);
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.mixer.setMuted(muted, this.now);
  }

  createEngine(isPlayer: boolean): EngineVoice {
    const e = new EngineVoiceImpl(this, isPlayer, this.removeEngine);
    if (!this.disposed) this.engines.push(e);
    return e;
  }

  createGun(kind: GunKind, isPlayer: boolean): GunVoice {
    const g = new GunVoiceImpl(this, kind, isPlayer, this.removeGun);
    if (!this.disposed) this.guns.push(g);
    return g;
  }

  private readonly removeEngine = (e: EngineVoiceImpl): void => {
    const i = this.engines.indexOf(e);
    if (i >= 0) this.engines.splice(i, 1);
    if (e.isPlayer) this.mixer.setCockpit(false, this.now);
  };

  private readonly removeGun = (g: GunVoiceImpl): void => {
    const i = this.guns.indexOf(g);
    if (i >= 0) this.guns.splice(i, 1);
  };

  play(id: SfxId, options?: PlayOptions): void {
    if (this.disposed) return;
    this.sfx.play(id, options);
  }

  playPatch(id: PatchId, options?: PlayOptions): void {
    if (this.disposed) return;
    this.sfx.play(id, options);
  }

  setCockpitTones(tones: CockpitTones): void {
    if (this.disposed) return;
    this.tones.set(tones, this.now);
  }

  radio(): void {
    if (this.disposed) return;
    this.sfx.play('radio');
    this.mixer.duckForRadio(this.now, 1.6);
  }

  setMenuMusic(on: boolean): void {
    if (this.disposed) return;
    this.music.set(on, this.now);
  }

  private ensureCapacity(n: number): void {
    if (n <= this.scores.length) return;
    const cap = Math.max(n, this.scores.length * 2);
    this.scores = new Float32Array(cap);
    this.selected = new Uint8Array(cap);
  }

  update(_dt: number): void {
    if (this.disposed) return;
    const now = this.now;
    const live = !this.paused;

    // Engines: the player's is always audible; of the AI engines only the loudest few are (the rest cost nothing).
    const ne = this.engines.length;
    this.ensureCapacity(ne);
    let playerG = 1;
    for (let i = 0; i < ne; i++) {
      const e = this.engines[i]!;
      this.scores[i] = e.isPlayer ? 0 : e.computeScore();
      this.selected[i] = e.active ? 1 : 0;
    }
    this.selector.select(this.scores, ne, this.maxAiEngines, 1e-3, 1.3, this.selected);
    for (let i = 0; i < ne; i++) {
      const e = this.engines[i]!;
      if (e.isPlayer) {
        e.update(now, live);
        if (e.hasParams && Number.isFinite(e.params.g)) playerG = Math.max(playerG, e.params.g);
      } else {
        e.update(now, live && this.selected[i] === 1);
      }
    }

    // Guns: same idea.
    const ng = this.guns.length;
    this.ensureCapacity(ng);
    for (let i = 0; i < ng; i++) {
      const g = this.guns[i]!;
      this.scores[i] = g.isPlayer ? 0 : g.computeScore();
      this.selected[i] = g.firing ? 1 : 0;
    }
    this.selector.select(this.scores, ng, this.maxAiGuns, 1e-3, 1.3, this.selected);
    for (let i = 0; i < ng; i++) {
      const g = this.guns[i]!;
      g.update(now, live && (g.isPlayer || this.selected[i] === 1));
    }

    this.sfx.update(now);
    this.strain.update(now, Math.max(playerG, this.tones.g), live);
    this.music.update(now);

    // Disconnect graphs whose fade-outs have finished.
    for (let i = this.retiredSets.length - 1; i >= 0; i--) {
      if (now < this.retiredAt[i]!) continue;
      this.retiredSets[i]!.disconnect();
      const last = this.retiredSets.length - 1;
      this.retiredSets[i] = this.retiredSets[last]!;
      this.retiredAt[i] = this.retiredAt[last]!;
      this.retiredSets.pop();
      this.retiredAt.pop();
    }
  }

  /** Kills every game voice (quit/restart); UI sounds and menu music are unaffected. */
  stopAll(): void {
    if (this.disposed) return;
    const now = this.now;
    for (const e of this.engines) e.reset(now);
    for (const g of this.guns) g.reset(now);
    this.sfx.stopGame(now);
    this.tones.stopAll(now);
    this.strain.stop(now);
    this.mixer.setCockpit(false, now);
  }

  /** Voice counts, for the perf overlay and tests. */
  stats(): { engines: number; audibleEngines: number; guns: number; sfx: number; retired: number } {
    let audible = 0;
    for (const e of this.engines) if (e.active) audible++;
    return {
      engines: this.engines.length,
      audibleEngines: audible,
      guns: this.guns.length,
      sfx: this.sfx.liveVoices,
      retired: this.retiredSets.length,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    const now = this.now;
    this.stopAll();
    this.music.stop(now);
    this.sfx.stopAll(now);
    for (const e of this.engines.slice()) e.dispose();
    for (const g of this.guns.slice()) g.dispose();
    this.disposed = true;
    for (const s of this.retiredSets) s.disconnect();
    this.retiredSets.length = 0;
    this.retiredAt.length = 0;
    this.tones.dispose();
    this.mixer.dispose();
  }
}

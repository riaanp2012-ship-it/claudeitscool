import { Quaternion, Vector3 } from 'three';
import type {
  AudioSystem,
  AudioVolumes,
  CockpitTones,
  EngineParams,
  EngineVoice,
  GunVoice,
  SfxId,
} from '../core/types';
import { AudioCore, DEFAULT_VOLUMES } from './core';
import type { GunKind } from './gun';

/** Engine handle that works before unlock (silent) and binds to a real voice once audio is unlocked. */
class EngineHandle implements EngineVoice {
  impl: EngineVoice | null = null;
  disposed = false;

  constructor(
    readonly isPlayer: boolean,
    private readonly owner: WebAudioSystem,
  ) {}

  set(params: EngineParams): void {
    this.impl?.set(params);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.impl?.dispose();
    this.impl = null;
    this.owner.forget(this);
  }
}

class GunHandle implements GunVoice {
  impl: GunVoice | null = null;
  disposed = false;

  constructor(
    readonly kind: GunKind,
    readonly isPlayer: boolean,
    private readonly owner: WebAudioSystem,
  ) {}

  setFiring(firing: boolean, position: Vector3, velocity: Vector3): void {
    this.impl?.setFiring(firing, position, velocity);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.impl?.dispose();
    this.impl = null;
    this.owner.forget(this);
  }
}

type Override = { id: SfxId; data: AudioBuffer | ArrayBuffer; done: (ok: boolean) => void };

/**
 * The AudioSystem the game uses. No AudioContext exists until `unlock()` is called from a user gesture
 * (autoplay policy, ZD-I01); until then every method is a silent no-op that never throws, and state set in the
 * meantime (volumes, pause, mute, menu music, listener, voices) is applied when audio comes up.
 */
class WebAudioSystem implements AudioSystem {
  private ctx: AudioContext | null = null;
  private core: AudioCore | null = null;
  private pending: Promise<void> | null = null;
  private isUnlocked = false;
  private disposed = false;
  private volumes: AudioVolumes = { ...DEFAULT_VOLUMES };
  private paused = false;
  private muted = false;
  private menuMusic = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handles = new Set<EngineHandle | GunHandle>();
  private readonly overrides: Override[] = [];
  private readonly listenerPos = new Vector3();
  private readonly listenerQuat = new Quaternion();
  private readonly listenerVel = new Vector3();

  get unlocked(): boolean {
    return this.isUnlocked;
  }

  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    if (this.isUnlocked && this.ctx && this.ctx.state === 'running') return Promise.resolve();
    this.pending = this.start().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private start(): Promise<void> {
    let ctx = this.ctx;
    if (!ctx) {
      if (typeof AudioContext !== 'function') return Promise.resolve();
      try {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch {
        return Promise.resolve();
      }
      this.ctx = ctx;
    }
    // resume() must be called synchronously inside the gesture; the graph is built right after.
    const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    if (!this.core) this.boot(ctx);
    const c = ctx;
    return resumed.then(
      () => {
        if (c.state === 'running') this.isUnlocked = true;
        if (this.muted) this.scheduleSuspend();
      },
      () => undefined,
    );
  }

  private boot(ctx: AudioContext): void {
    const core = new AudioCore(ctx, { volumes: this.volumes });
    this.core = core;
    core.setListener(this.listenerPos, this.listenerQuat, this.listenerVel);
    if (this.paused) core.setPaused(true);
    if (this.muted) core.setMuted(true);
    if (this.menuMusic) core.setMenuMusic(true);
    for (const h of this.handles) {
      if (h instanceof EngineHandle) h.impl = core.createEngine(h.isPlayer);
      else h.impl = core.createGun(h.kind, h.isPlayer);
    }
    for (const o of this.overrides.splice(0)) this.applyOverride(core, ctx, o);
  }

  forget(h: EngineHandle | GunHandle): void {
    this.handles.delete(h);
  }

  setVolumes(v: AudioVolumes): void {
    this.volumes = { master: v.master, music: v.music, effects: v.effects, radio: v.radio, ui: v.ui };
    this.core?.setVolumes(this.volumes);
  }

  setListener(position: Vector3, quaternion: Quaternion, velocity: Vector3): void {
    if (this.core) this.core.setListener(position, quaternion, velocity);
    else {
      this.listenerPos.copy(position);
      this.listenerQuat.copy(quaternion);
      this.listenerVel.copy(velocity);
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.core?.setPaused(paused);
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const core = this.core;
    const ctx = this.ctx;
    if (!core || !ctx) return;
    core.setMuted(muted);
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    if (muted) this.scheduleSuspend();
    else if (ctx.state === 'suspended' && this.isUnlocked) ctx.resume().catch(() => undefined);
  }

  /** While muted (tab hidden) the context is suspended after the fade, so it costs no CPU (ZD-I07). */
  private scheduleSuspend(): void {
    if (this.suspendTimer !== null) return;
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      const ctx = this.ctx;
      if (this.muted && ctx && ctx.state === 'running') ctx.suspend().catch(() => undefined);
    }, 150);
  }

  createEngine(isPlayer: boolean): EngineVoice {
    const h = new EngineHandle(isPlayer, this);
    if (this.disposed) return h;
    if (this.core) h.impl = this.core.createEngine(isPlayer);
    this.handles.add(h);
    return h;
  }

  createGun(kind: 'gun25' | 'gun30', isPlayer: boolean): GunVoice {
    const h = new GunHandle(kind, isPlayer, this);
    if (this.disposed) return h;
    if (this.core) h.impl = this.core.createGun(kind, isPlayer);
    this.handles.add(h);
    return h;
  }

  play(
    id: SfxId,
    options?: { position?: Vector3; velocity?: Vector3; volume?: number; pitch?: number },
  ): void {
    this.core?.play(id, options);
  }

  setCockpitTones(tones: CockpitTones): void {
    this.core?.setCockpitTones(tones);
  }

  radio(): void {
    this.core?.radio();
  }

  setMenuMusic(on: boolean): void {
    this.menuMusic = on;
    this.core?.setMenuMusic(on);
  }

  update(dt: number): void {
    this.core?.update(dt);
  }

  stopAll(): void {
    this.core?.stopAll();
  }

  /** Replaces the synth patch for `id` with a sample (decoded buffer or encoded file bytes). */
  overrideSfx(id: SfxId, data: AudioBuffer | ArrayBuffer): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const o: Override = { id, data, done: resolve };
      if (this.core && this.ctx) this.applyOverride(this.core, this.ctx, o);
      else if (this.disposed) resolve(false);
      else this.overrides.push(o);
    });
  }

  private applyOverride(core: AudioCore, ctx: AudioContext, o: Override): void {
    if (o.data instanceof ArrayBuffer) {
      ctx.decodeAudioData(o.data.slice(0)).then(
        (buffer) => {
          core.sfx.override(o.id, buffer);
          o.done(true);
        },
        () => o.done(false),
      );
    } else {
      core.sfx.override(o.id, o.data);
      o.done(true);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of [...this.handles]) h.dispose();
    for (const o of this.overrides.splice(0)) o.done(false);
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const core = this.core;
    const ctx = this.ctx;
    this.core = null;
    this.ctx = null;
    this.isUnlocked = false;
    if (!core || !ctx) return;
    // Fade to silence first so closing the context cannot click.
    core.setMuted(true);
    setTimeout(() => {
      core.dispose();
      ctx.close().catch(() => undefined);
    }, 60);
  }
}

/** Creates the game's audio system. Nothing is allocated in Web Audio until `unlock()`. */
export function createAudio(): AudioSystem {
  return new WebAudioSystem();
}

/**
 * Replaces the procedural patch for `id` with a sample, for example a file from `public/audio/` fetched as an
 * ArrayBuffer. Resolves true once the sample is in use (after unlock, when decoding succeeds).
 */
export function overrideSfx(
  system: AudioSystem,
  id: SfxId,
  data: AudioBuffer | ArrayBuffer,
): Promise<boolean> {
  return system instanceof WebAudioSystem ? system.overrideSfx(id, data) : Promise.resolve(false);
}

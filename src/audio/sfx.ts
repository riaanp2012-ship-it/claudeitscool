import { Vector3 } from 'three';
import { NodeSet, type AudioHost } from './host';
import {
  CATEGORY_LIMITS,
  MAX_SFX_VOICES,
  PATCHES,
  PATCH_IDS,
  type PatchContext,
  type PatchId,
  type SfxBus,
} from './patches';
import { holdParam } from './params';
import { HRTF_NEAR, SpatialChain } from './spatial';
import { RateLimiter, VoiceAllocator } from './voices';
import { SPEED_OF_SOUND, distance, distanceGain, dopplerFactor, pitchVariation } from './util';

export interface PlayOptions {
  position?: Vector3;
  velocity?: Vector3;
  volume?: number;
  pitch?: number;
}

/** A playing one-shot. Records are pooled per allocator slot. */
class SfxVoice {
  set: NodeSet | null = null;
  gate: GainNode | null = null;
  spatial: SpatialChain | null = null;
  readonly position = new Vector3();
  end = 0;
  live = false;
  game = false;
}

const PATCH_INDEX = new Map<PatchId, number>(PATCH_IDS.map((id, i) => [id, i]));

/**
 * One-shot sound effects: rate limiting, category voice caps with priority stealing, optional 3D placement
 * with propagation delay and doppler, and the registry of synth patches with optional buffer overrides.
 */
export class SfxPlayer {
  private readonly alloc = new VoiceAllocator(CATEGORY_LIMITS, MAX_SFX_VOICES);
  private readonly limiter = new RateLimiter(PATCH_IDS.length);
  private readonly voices: SfxVoice[] = [];
  private readonly overrides = new Map<PatchId, AudioBuffer[]>();

  constructor(private readonly host: AudioHost) {
    for (let i = 0; i < MAX_SFX_VOICES; i++) this.voices.push(new SfxVoice());
  }

  /** Replace the synth patch for `id` with decoded sample(s); several buffers are picked at random. */
  override(id: PatchId, buffer: AudioBuffer): void {
    const list = this.overrides.get(id);
    if (list) list.push(buffer);
    else this.overrides.set(id, [buffer]);
  }

  clearOverride(id: PatchId): void {
    this.overrides.delete(id);
  }

  private busNode(bus: SfxBus): AudioNode {
    const m = this.host.mixer;
    switch (bus) {
      case 'ext':
        return m.exterior;
      case 'int':
        return m.interior;
      case 'ui':
        return m.ui;
      case 'radio':
        return m.radio;
    }
  }

  play(id: PatchId, options?: PlayOptions): void {
    const patch = PATCHES[id];
    if (!patch) return;
    const host = this.host;
    const now = host.ctx.currentTime;
    const game = patch.bus === 'ext' || patch.bus === 'int';
    if (game && host.mixer.isPaused) return;
    const key = PATCH_INDEX.get(id) ?? -1;
    const repeat = this.limiter.acquire(key, now, patch.minInterval, patch.repeatWindow);
    if (repeat <= 0) return;
    const rawVol = options?.volume ?? 1;
    const volume = (Number.isFinite(rawVol) ? Math.min(Math.max(rawVol, 0), 2) : 1) * repeat;
    if (volume <= 0) return;

    const L = host.listener;
    const pos = options?.position;
    const profile = pos && patch.spatial && Number.isFinite(pos.x + pos.y + pos.z) ? patch.spatial : null;
    let dist = 0;
    let audibility = volume;
    if (profile && pos) {
      dist = distance(pos, L.position);
      audibility *= distanceGain(dist, profile.ref, profile.rolloff, profile.maxDistance);
      if (audibility < 1e-3) return;
    }

    const alloc = this.alloc.acquire(patch.category, patch.priority + audibility, now);
    if (alloc.voice < 0) return;
    const slot = alloc.voice;
    if (alloc.stolen >= 0) this.kill(alloc.stolen, now);

    const rawPitch = options?.pitch ?? 1;
    let pitch =
      pitchVariation(host.rnd.next()) *
      (Number.isFinite(rawPitch) ? Math.min(Math.max(rawPitch, 0.25), 4) : 1);
    const vel = options?.velocity;
    if (profile && pos && vel && Number.isFinite(vel.x + vel.y + vel.z)) {
      pitch *= dopplerFactor(pos, vel, L.position, L.velocity, SPEED_OF_SOUND, 0.6, 1.8);
    }

    const set = new NodeSet(host.ctx);
    const gate = set.gain(1);
    const voiceGain = set.gain(patch.gain * volume);
    voiceGain.connect(gate);
    let spatial: SpatialChain | null = null;
    if (profile && pos) {
      spatial = new SpatialChain(
        host.ctx,
        host.mixer.exterior,
        host.mixer.reverbSend,
        profile,
        dist < HRTF_NEAR,
        host.hrtf,
      );
      set.extras.push(spatial);
      gate.connect(spatial.input);
      spatial.update(now, pos, L, 1);
    } else {
      gate.connect(this.busNode(patch.bus));
    }
    const delay = profile && patch.propagate ? Math.min(3, dist / SPEED_OF_SOUND) : 0;
    const pc: PatchContext = {
      set,
      out: voiceGain,
      t: now + host.lookahead + delay,
      rnd: host.rnd,
      pitch,
      bank: host.bank,
    };
    const buffers = this.overrides.get(id);
    const end = buffers && buffers.length > 0 ? this.playBuffer(pc, buffers) : patch.build(pc);

    const v = this.voices[slot]!;
    v.set = set;
    v.gate = gate;
    v.spatial = spatial;
    v.end = end;
    v.live = true;
    v.game = game;
    if (pos) v.position.copy(pos);
  }

  /** Plays a decoded override sample with 5 ms fades at both ends. */
  private playBuffer(pc: PatchContext, buffers: readonly AudioBuffer[]): number {
    const buffer = buffers[Math.floor(pc.rnd.next() * buffers.length)] ?? buffers[0]!;
    const src = pc.set.buffer(buffer, pc.pitch, false);
    const g = pc.set.gain(0);
    src.connect(g).connect(pc.out);
    const dur = buffer.duration / pc.pitch;
    const t = pc.t;
    const fade = Math.min(0.005, dur / 4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    g.gain.setValueAtTime(1, t + dur - fade);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.start(t);
    src.stop(t + dur + 0.01);
    return t + dur;
  }

  /** Fades a voice out quickly and retires its graph (slot bookkeeping is the caller's). */
  private kill(slot: number, now: number): void {
    const v = this.voices[slot];
    if (!v || !v.live || !v.set || !v.gate) return;
    holdParam(v.gate.gain, now);
    v.gate.gain.setTargetAtTime(0, now, 0.006);
    v.set.stopAll(now + 0.05);
    this.host.retire(v.set, now + 0.08);
    v.live = false;
    v.set = null;
    v.gate = null;
    v.spatial = null;
  }

  /** Per frame: frees finished voices and keeps 3D voices placed relative to the moving listener. */
  update(now: number): void {
    const L = this.host.listener;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!;
      if (!v.live) continue;
      if (now >= v.end + 0.05) {
        v.set?.disconnect();
        v.live = false;
        v.set = null;
        v.gate = null;
        v.spatial = null;
        this.alloc.release(i);
      } else if (v.spatial) {
        v.spatial.update(now, v.position, L, 1);
      }
    }
  }

  /** Kills game one-shots (keeps UI and radio). */
  stopGame(now: number): void {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!;
      if (v.live && v.game) {
        this.kill(i, now);
        this.alloc.release(i);
      }
    }
  }

  stopAll(now: number): void {
    for (let i = 0; i < this.voices.length; i++) this.kill(i, now);
    this.alloc.releaseAll();
    this.limiter.reset();
  }

  get liveVoices(): number {
    return this.alloc.live;
  }
}

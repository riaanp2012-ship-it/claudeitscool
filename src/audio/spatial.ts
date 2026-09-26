import { Quaternion, Vector3 } from 'three';
import { SmoothParam, safeDisconnect } from './params';
import { airAbsorptionCutoff, distanceGain, reverbSend, type Vec3Like } from './util';

/** Listener pose in world space. The Web Audio listener itself stays at the origin facing -Z. */
export class ListenerState {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly inverse = new Quaternion();
  readonly velocity = new Vector3();

  set(position: Vector3, quaternion: Quaternion, velocity: Vector3): void {
    if (Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
      this.position.copy(position);
    }
    if (
      Number.isFinite(quaternion.x) &&
      Number.isFinite(quaternion.y) &&
      Number.isFinite(quaternion.z) &&
      Number.isFinite(quaternion.w)
    ) {
      this.quaternion.copy(quaternion);
      this.inverse.copy(quaternion).invert();
    }
    if (Number.isFinite(velocity.x) && Number.isFinite(velocity.y) && Number.isFinite(velocity.z)) {
      this.velocity.copy(velocity);
    }
  }
}

export interface SpatialProfile {
  /** Distance (m) inside which there is no attenuation. */
  ref: number;
  rolloff: number;
  /** Beyond this the source is silent (and may be culled). */
  maxDistance: number;
  /** Feed the shared outdoor reverb (wetter with distance). */
  reverb: boolean;
}

/** Switch to HRTF inside NEAR, back to equal-power beyond FAR (hysteresis keeps it from toggling). */
export const HRTF_NEAR = 320;
const HRTF_FAR = 480;

const local = new Vector3();

/**
 * Per-voice 3D chain: air absorption lowpass → distance gain → panner, plus an optional reverb send.
 * Positions are converted to listener space in JS (so the Web Audio listener never moves) and the panner
 * receives only a unit direction; distance is handled by our own gain curve, which lets us cull voices.
 */
export class SpatialChain {
  readonly input: GainNode;
  readonly panner: PannerNode;
  private readonly air: BiquadFilterNode;
  private readonly dist: GainNode;
  private readonly send: GainNode | null;
  private readonly airP: SmoothParam;
  private readonly distP: SmoothParam;
  private readonly sendP: SmoothParam | null;
  private readonly px: SmoothParam;
  private readonly py: SmoothParam;
  private readonly pz: SmoothParam;
  private hrtf: boolean;
  private placed = false;
  /** Last computed distance (m) and distance gain. */
  distance = 0;
  gain = 1;

  constructor(
    readonly ctx: BaseAudioContext,
    out: AudioNode,
    reverbIn: AudioNode | null,
    readonly profile: SpatialProfile,
    near = true,
    /** False forces equal-power panning everywhere (cheaper; also a low-CPU option). */
    private readonly allowHrtf = true,
  ) {
    this.input = new GainNode(ctx, { gain: 1 });
    this.air = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.6 });
    this.dist = new GainNode(ctx, { gain: 0 });
    this.hrtf = near && allowHrtf;
    this.panner = new PannerNode(ctx, {
      panningModel: this.hrtf ? 'HRTF' : 'equalpower',
      distanceModel: 'inverse',
      refDistance: 1,
      rolloffFactor: 0,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
      positionX: 0,
      positionY: 0,
      positionZ: -1,
    });
    this.input.connect(this.air).connect(this.dist).connect(this.panner).connect(out);
    if (profile.reverb && reverbIn) {
      this.send = new GainNode(ctx, { gain: 0 });
      this.dist.connect(this.send).connect(reverbIn);
      this.sendP = new SmoothParam(this.send.gain, 0.05, 2e-3, 0.03);
    } else {
      this.send = null;
      this.sendP = null;
    }
    this.airP = new SmoothParam(this.air.frequency, 0.05, 5, 0.02);
    this.distP = new SmoothParam(this.dist.gain, 0.03, 2e-4, 0.015);
    this.px = new SmoothParam(this.panner.positionX, 0.025, 0.01, 0);
    this.py = new SmoothParam(this.panner.positionY, 0.025, 0.01, 0);
    this.pz = new SmoothParam(this.panner.positionZ, 0.025, 0.01, 0);
  }

  /** Estimated gain for a source at `pos` without touching the graph (for culling decisions). */
  static estimate(profile: SpatialProfile, pos: Vec3Like, listener: ListenerState): number {
    const dx = pos.x - listener.position.x;
    const dy = pos.y - listener.position.y;
    const dz = pos.z - listener.position.z;
    return distanceGain(
      Math.sqrt(dx * dx + dy * dy + dz * dz),
      profile.ref,
      profile.rolloff,
      profile.maxDistance,
    );
  }

  /** Places the source; `extra` multiplies the distance gain (voice-level loudness such as throttle). */
  update(now: number, pos: Vec3Like, listener: ListenerState, extra = 1): number {
    local.set(pos.x - listener.position.x, pos.y - listener.position.y, pos.z - listener.position.z);
    const d = local.length();
    this.distance = d;
    const g = distanceGain(d, this.profile.ref, this.profile.rolloff, this.profile.maxDistance);
    this.gain = g;
    local.applyQuaternion(listener.inverse);
    if (d > 1e-3) local.multiplyScalar(1 / d);
    else local.set(0, 0, -1);
    if (!this.placed) {
      this.placed = true;
      this.px.init(local.x, now);
      this.py.init(local.y, now);
      this.pz.init(local.z, now);
      this.airP.init(airAbsorptionCutoff(d), now);
      // Nothing is sounding yet when a chain is first placed, so starting at the target cannot click.
      this.distP.init(g * extra, now);
      this.sendP?.init(reverbSend(d) * g * extra, now);
    } else {
      this.px.set(local.x, now);
      this.py.set(local.y, now);
      this.pz.set(local.z, now);
      this.airP.set(airAbsorptionCutoff(d), now);
      this.distP.set(g * extra, now);
      this.sendP?.set(reverbSend(d) * g * extra, now);
    }
    if (this.hrtf && d > HRTF_FAR) {
      this.hrtf = false;
      this.panner.panningModel = 'equalpower';
    } else if (!this.hrtf && this.allowHrtf && d < HRTF_NEAR) {
      this.hrtf = true;
      this.panner.panningModel = 'HRTF';
    }
    return g;
  }

  disconnect(): void {
    safeDisconnect(this.input);
    safeDisconnect(this.air);
    safeDisconnect(this.dist);
    safeDisconnect(this.panner);
    safeDisconnect(this.send);
  }
}

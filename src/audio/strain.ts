import { NodeSet, type AudioHost } from './host';
import { envAHR, holdParam } from './params';

/** G where the pilot starts the anti-G straining maneuver, and where it is at full effort. */
export const STRAIN_ONSET_G = 6.5;
const STRAIN_FULL_G = 9;

/** 0..1 straining effort for a G load. */
export function strainLevel(g: number): number {
  if (!Number.isFinite(g)) return 0;
  const t = Math.min(1, Math.max(0, (g - STRAIN_ONSET_G) / (STRAIN_FULL_G - STRAIN_ONSET_G)));
  return t * t * (3 - 2 * t);
}

/**
 * G-strain breathing: the anti-G straining maneuver as a repeating cycle of a sharp inhale, a voiced strain
 * hold ("hook") and a short exhale, faster and harder as G rises. Cycles are scheduled a little ahead; each is
 * a short-lived graph, so nothing runs while G is low.
 */
export class StrainVoice {
  private nextAt = 0;
  private current: NodeSet | null = null;
  private currentGate: GainNode | null = null;
  private currentEnd = 0;

  constructor(private readonly host: AudioHost) {}

  update(now: number, g: number, enabled: boolean): void {
    const level = enabled ? strainLevel(g) : 0;
    if (level <= 0.02) {
      this.nextAt = 0;
      return;
    }
    if (this.nextAt === 0) this.nextAt = Math.max(now + this.host.lookahead, this.currentEnd);
    if (this.nextAt - now < 0.15) {
      const period = (2.7 - 1.1 * level) * (0.92 + 0.16 * this.host.rnd.next());
      this.breath(this.nextAt, level, period);
      this.nextAt += period;
    }
  }

  private breath(t: number, level: number, period: number): void {
    const { ctx, bank, mixer, rnd } = this.host;
    const s = new NodeSet(ctx);
    const gate = s.gain(1);
    gate.connect(mixer.interior);

    // Sharp inhale through the mask: two breathy formant bands.
    const inhale = s.gain(0);
    inhale.connect(gate);
    const n1 = s.buffer(bank.pink, 1);
    const bp1 = s.filter('bandpass', 1500, 1.3);
    const bp2 = s.filter('bandpass', 2700, 2);
    n1.connect(bp1).connect(inhale);
    n1.connect(bp2).connect(inhale);
    const inEnd = envAHR(inhale.gain, t, 0.07, 0.5 + 0.4 * level, 0.1, 0.07);

    // Strain hold: a low voiced grunt through vocal-tract formants, with a little breath leaking.
    const holdStart = inEnd + 0.04;
    const hold = Math.min(1.1, Math.max(0.35, period - 0.75));
    const voice = s.gain(0);
    voice.connect(gate);
    const f0 = 100 + 14 * level + 8 * rnd.next();
    const glottal = s.osc('sawtooth', f0);
    const jitter = s.buffer(bank.smoothFast, 1.4);
    const jitterDepth = s.gain(25);
    jitter.connect(jitterDepth).connect(glottal.detune);
    const f1 = s.filter('bandpass', 520, 5);
    const f2 = s.filter('bandpass', 1250, 6);
    const f2g = s.gain(0.6);
    // The effort trembles: a random amplitude wobble in series with the envelope.
    const trem = s.gain(0.75);
    const tremSrc = s.buffer(bank.smoothMid, 2.2);
    const tremDepth = s.gain(0.25);
    tremSrc.connect(tremDepth).connect(trem.gain);
    trem.connect(voice);
    glottal.connect(f1).connect(trem);
    glottal.connect(f2).connect(f2g).connect(trem);
    const leak = s.filter('bandpass', 750, 1);
    const leakG = s.gain(0.25);
    n1.connect(leak).connect(leakG).connect(voice);
    const voiceEnd = envAHR(voice.gain, holdStart, 0.09, 0.22 + 0.25 * level, hold, 0.1);

    // Quick exhale before the next breath.
    const exhale = s.gain(0);
    exhale.connect(gate);
    const bp3 = s.filter('bandpass', 950, 0.9);
    n1.connect(bp3).connect(exhale);
    const end = envAHR(exhale.gain, voiceEnd, 0.012, 0.55 + 0.3 * level, 0.04, 0.1);

    s.startAll(t, rnd);
    s.stopAll(end + 0.02);
    this.host.retire(s, end + 0.05);
    this.current = s;
    this.currentGate = gate;
    this.currentEnd = end;
  }

  /** Cuts any breath in progress (G released is not a reason to cut; this is for stop/pause). */
  stop(now: number): void {
    this.nextAt = 0;
    if (this.current && this.currentGate && now < this.currentEnd) {
      holdParam(this.currentGate.gain, now);
      this.currentGate.gain.setTargetAtTime(0, now, 0.01);
      this.current.stopAll(now + 0.08);
    }
    this.current = null;
    this.currentGate = null;
    this.currentEnd = 0;
  }
}

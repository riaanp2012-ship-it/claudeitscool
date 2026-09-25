import { NodeSet, type AudioHost } from './host';
import { envAD, holdParam } from './params';
import { midiToHz } from './util';

/**
 * Menu ambience: a slow modal pad in D (i9 → ♭VImaj7♯11 → ♭VII6/9 → v11) with shared common tones, so the
 * voices barely move while the colour shifts. Detuned saw/triangle pairs through a slowly breathing lowpass,
 * a low drone, a breath of filtered air and occasional soft bell glints, all into a long generated hall.
 * No combat music by design.
 */
const CHORDS: readonly (readonly number[])[] = [
  [38, 50, 57, 60, 64, 65],
  [34, 53, 57, 62, 64],
  [36, 55, 57, 62, 64],
  [33, 55, 60, 62, 64],
];
const CHORD_SECONDS = 9;
const ATTACK = 3.5;
const RELEASE = 4.5;
const FADE = 1.5;

/** The persistent part of the music graph (bus, filter, reverb, drone, air). */
class MusicGraph {
  readonly set: NodeSet;
  readonly out: GainNode;
  readonly pad: GainNode;
  readonly glints: GainNode;

  constructor(host: AudioHost, t: number) {
    const { ctx, bank, mixer } = host;
    const s = new NodeSet(ctx);
    this.set = s;
    this.out = s.gain(0);
    this.out.connect(mixer.music);
    const reverb = new ConvolverNode(ctx, { buffer: bank.hallIr });
    s.nodes.push(reverb);
    const wet = s.gain(0.62);
    const dry = s.gain(0.55);
    reverb.connect(wet).connect(this.out);

    // Pad bus: breathing lowpass (slow random cutoff movement), then dry + hall.
    this.pad = s.gain(1);
    const lp = s.filter('lowpass', 950, 0.9);
    const move = s.buffer(bank.smoothSlow, 0.6);
    const moveDepth = s.gain(420);
    move.connect(moveDepth).connect(lp.frequency);
    this.pad.connect(lp);
    lp.connect(dry).connect(this.out);
    lp.connect(reverb);

    // Glints go mostly to the hall.
    this.glints = s.gain(1);
    const gDry = s.gain(0.25);
    this.glints.connect(gDry).connect(this.out);
    this.glints.connect(reverb);

    // Drone on D with a slow swell.
    const drone = s.gain(0.05);
    const d1 = s.osc('sine', midiToHz(26));
    const d2 = s.osc('triangle', midiToHz(38), 4);
    const d2g = s.gain(0.35);
    d1.connect(drone);
    d2.connect(d2g).connect(drone);
    const swell = s.buffer(bank.smoothSlow, 0.35);
    const swellDepth = s.gain(0.02);
    swell.connect(swellDepth).connect(drone.gain);
    drone.connect(this.pad);

    // Air: very quiet band of noise, drifting.
    const air = s.buffer(bank.pink, 0.5);
    const airBp = s.filter('bandpass', 2600, 0.5);
    const airG = s.gain(0.022);
    const airMove = s.buffer(bank.smoothSlow, 0.8);
    const airDepth = s.gain(0.012);
    airMove.connect(airDepth).connect(airG.gain);
    air.connect(airBp).connect(airG).connect(reverb);

    s.startAll(t, host.rnd);
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + FADE);
  }
}

export class MenuMusic {
  private graph: MusicGraph | null = null;
  private on = false;
  private nextChord = 0;
  private chordIndex = 0;
  private nextGlint = 0;
  private readonly chordSets: { set: NodeSet; end: number }[] = [];

  constructor(private readonly host: AudioHost) {}

  get playing(): boolean {
    return this.on;
  }

  set(on: boolean, now: number): void {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      const t = now + this.host.lookahead;
      this.graph = new MusicGraph(this.host, t);
      this.nextChord = t;
      this.chordIndex = 0;
      this.nextGlint = t + 5 + 3 * this.host.rnd.next();
      this.schedule(now);
    } else {
      this.fadeOut(now);
    }
  }

  private fadeOut(now: number): void {
    const g = this.graph;
    if (!g) return;
    holdParam(g.out.gain, now);
    g.out.gain.linearRampToValueAtTime(0, now + FADE);
    const end = now + FADE + 0.05;
    g.set.stopAll(end);
    this.host.retire(g.set, end + 0.05);
    for (const c of this.chordSets) {
      c.set.stopAll(end);
      this.host.retire(c.set, end + 0.05);
    }
    this.chordSets.length = 0;
    this.graph = null;
  }

  /** Called every frame: schedules the next chord and glint a little ahead of time. */
  update(now: number): void {
    if (!this.on || !this.graph) return;
    this.schedule(now);
    for (let i = this.chordSets.length - 1; i >= 0; i--) {
      const c = this.chordSets[i]!;
      if (now > c.end + 0.1) {
        c.set.disconnect();
        this.chordSets.splice(i, 1);
      }
    }
  }

  private schedule(now: number): void {
    const g = this.graph;
    if (!g) return;
    if (this.nextChord - now < 1) {
      const notes = CHORDS[this.chordIndex % CHORDS.length]!;
      this.chord(g, notes, this.nextChord);
      this.chordIndex++;
      this.nextChord += CHORD_SECONDS;
    }
    if (this.nextGlint - now < 1) {
      const notes = CHORDS[(this.chordIndex + CHORDS.length - 1) % CHORDS.length]!;
      const pick = notes[1 + Math.floor(this.host.rnd.next() * (notes.length - 1))] ?? 62;
      this.glint(g, pick + (this.host.rnd.next() < 0.5 ? 12 : 24), this.nextGlint);
      this.nextGlint += 4.5 + 4 * this.host.rnd.next();
    }
  }

  private chord(g: MusicGraph, notes: readonly number[], t: number): void {
    const { ctx, rnd } = this.host;
    const s = new NodeSet(ctx);
    const hold = CHORD_SECONDS - ATTACK;
    let end = t;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]!;
      const bass = i === 0;
      const v = s.gain(0);
      v.connect(g.pad);
      const f = midiToHz(note);
      const level = bass ? 0.07 : 0.028;
      const a = s.osc(bass ? 'sine' : 'sawtooth', f, -5 - 3 * rnd.next());
      const b = s.osc('triangle', bass ? f * 2 : f, 5 + 3 * rnd.next());
      const bg = s.gain(bass ? 0.3 : 0.8);
      a.connect(v);
      b.connect(bg).connect(v);
      // Staggered, slightly uneven entries so the chord blooms rather than switches.
      const at = t + (bass ? 0 : 0.25 * i + 0.4 * rnd.next());
      v.gain.setValueAtTime(0, at);
      v.gain.linearRampToValueAtTime(level, at + ATTACK);
      v.gain.setValueAtTime(level, at + ATTACK + hold - 0.4 * rnd.next());
      const relAt = at + ATTACK + hold;
      v.gain.linearRampToValueAtTime(0, relAt + RELEASE);
      end = Math.max(end, relAt + RELEASE);
    }
    s.startAll(t, rnd);
    s.stopAll(end + 0.05);
    this.chordSets.push({ set: s, end });
  }

  private glint(g: MusicGraph, note: number, t: number): void {
    const { ctx, rnd } = this.host;
    const s = new NodeSet(ctx);
    const f = midiToHz(note);
    let end = t;
    const partials: readonly (readonly [number, number, number])[] = [
      [1, 0.03, 2.6],
      [2.76, 0.008, 1.2],
      [5.4, 0.003, 0.5],
    ];
    for (const [ratio, amp, decay] of partials) {
      const v = s.gain(0);
      v.connect(g.glints);
      const o = s.osc('sine', f * ratio, (rnd.next() * 2 - 1) * 4);
      o.connect(v);
      end = Math.max(end, envAD(v.gain, t, 0.02, amp, decay));
    }
    s.startAll(t, rnd);
    s.stopAll(end + 0.02);
    this.chordSets.push({ set: s, end });
  }

  stop(now: number): void {
    if (!this.on) return;
    this.on = false;
    this.fadeOut(now);
  }
}

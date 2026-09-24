/**
 * Seeded pseudo-random numbers. Gameplay must use these so a seed reproduces a session exactly.
 * `cosmetic` is a separate stream for visual/audio variation that must not affect simulation.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed = 1) {
    this.a = this.b = this.c = this.d = 0;
    this.seed(seed);
  }

  /** Re-initializes the stream (sessions reseed the global gameplay stream for reproducibility). */
  seed(seed: number): void {
    // sfc32 seeded through splitmix32 so small seeds still produce well-mixed state.
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Rng.pick called with an empty list');
    return item;
  }

  /** Approximately normal distribution (sum of uniforms), mean 0, sd ~1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}

/** Global gameplay stream; reseeded when a session starts. */
export const rng = new Rng(20260924);

/** Visual/audio variation only. Never read from simulation code. */
export const cosmetic = new Rng(0x5eed);

/** Seed derived from wall-clock time, for sessions that do not request a fixed seed. */
export function timeSeed(): number {
  return (Date.now() ^ (performance.now() * 1000)) >>> 0;
}

/** Deterministic hash of two integers to [0, 1). Useful for placement without storing state. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

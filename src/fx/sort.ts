/**
 * Back-to-front ordering for alpha particles without allocations.
 *
 * Keys are 16-bit and derived from the float32 bit pattern of the squared camera distance, which is
 * monotonic for positive floats and logarithmic in spacing (about 0.14% distance resolution at any range).
 * The LSD radix sort is stable, so particles with equal keys keep their slot order: the order is a pure
 * function of positions and never flickers between frames for ties (ZD-B07). Distance (not view depth)
 * is used so rotating the camera never reorders anything.
 */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Key that sorts farther particles first when sorted ascending. */
export function farFirstKey(distanceSq: number): number {
  f32[0] = distanceSq > 0 ? distanceSq : 0;
  return 0xffff - (u32[0]! >>> 15);
}

export class RadixSorter {
  private readonly counts = new Uint32Array(256);
  private readonly tmpKeys: Uint16Array;
  private readonly tmpIdx: Int32Array;

  constructor(readonly capacity: number) {
    this.tmpKeys = new Uint16Array(capacity);
    this.tmpIdx = new Int32Array(capacity);
  }

  /** Sorts `idx[0..n)` ascending by `keys[0..n)` in place (stable). */
  sort(keys: Uint16Array, idx: Int32Array, n: number): void {
    if (n <= 1) return;
    this.pass(keys, idx, this.tmpKeys, this.tmpIdx, n, 0);
    this.pass(this.tmpKeys, this.tmpIdx, keys, idx, n, 8);
  }

  private pass(
    srcK: Uint16Array,
    srcI: Int32Array,
    dstK: Uint16Array,
    dstI: Int32Array,
    n: number,
    shift: number,
  ): void {
    const c = this.counts;
    c.fill(0);
    for (let i = 0; i < n; i++) {
      const b = (srcK[i]! >>> shift) & 255;
      c[b] = c[b]! + 1;
    }
    let sum = 0;
    for (let b = 0; b < 256; b++) {
      const v = c[b]!;
      c[b] = sum;
      sum += v;
    }
    for (let i = 0; i < n; i++) {
      const k = srcK[i]!;
      const b = (k >>> shift) & 255;
      const o = c[b]!;
      c[b] = o + 1;
      dstK[o] = k;
      dstI[o] = srcI[i]!;
    }
  }
}

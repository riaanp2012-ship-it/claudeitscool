import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three';
import type { Vec3 } from './rig';

/** Kinds of additive effect geometry (aFxA.x). */
export const FX = {
  flameOuter: 0,
  flameCore: 1,
  glow: 2,
  nav: 3,
  strobe: 4,
  beacon: 5,
} as const;

/**
 * Geometry for the additive effects of one jet type: afterburner plumes, nozzle glow discs and nav/strobe
 * light billboards. Shapes are expanded in the vertex shader from per-vertex parameters, so one static
 * buffer serves every throttle setting and every aircraft of that type.
 */
export class FxBuilder {
  readonly pos: number[] = [];
  readonly a: number[] = [];
  readonly b: number[] = [];
  readonly skinI: number[] = [];
  readonly skinW: number[] = [];
  readonly idx: number[] = [];

  private v(
    p: Vec3,
    a0: number,
    a1: number,
    a2: number,
    a3: number,
    b: readonly number[],
    bone: number,
  ): number {
    this.pos.push(p[0], p[1], p[2]);
    this.a.push(a0, a1, a2, a3);
    this.b.push(b[0]!, b[1]!, b[2]!, b[3]!);
    this.skinI.push(bone, 0, 0, 0);
    this.skinW.push(1, 0, 0, 0);
    return this.pos.length / 3 - 1;
  }

  /**
   * Afterburner plume at a nozzle exit (axis +z). radius: exit radius; aspect: width/height for 2D nozzles.
   * Two nested shells: a long soft outer plume and a short bright core carrying the shock diamonds.
   */
  flame(center: Vec3, radius: number, aspect: number, index: number, bone: number): void {
    const rings = 14;
    const seg = 14;
    for (const kind of [FX.flameOuter, FX.flameCore]) {
      const base = this.pos.length / 3;
      for (let i = 0; i < rings; i++) {
        const t = i / (rings - 1);
        for (let j = 0; j <= seg; j++) {
          const ang = (j / seg) * Math.PI * 2;
          this.v(center, kind, t, Math.cos(ang), Math.sin(ang), [radius, aspect, 0, index], bone);
        }
      }
      for (let i = 0; i < rings - 1; i++) {
        for (let j = 0; j < seg; j++) {
          const a = base + i * (seg + 1) + j;
          const b = a + 1;
          const c = a + seg + 1;
          const d = c + 1;
          this.idx.push(a, c, b, b, c, d);
        }
      }
    }
  }

  /** Hot glow disc facing aft inside a nozzle, `depth` metres upstream of the exit. */
  glow(center: Vec3, radius: number, aspect: number, depth: number, index: number, bone: number): void {
    const seg = 16;
    const base = this.pos.length / 3;
    this.v(center, FX.glow, 0, 0, 0, [radius, aspect, depth, index], bone);
    for (let j = 0; j <= seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      this.v(center, FX.glow, 1, Math.cos(ang), Math.sin(ang), [radius, aspect, depth, index], bone);
    }
    for (let j = 0; j < seg; j++) this.idx.push(base, base + 1 + j, base + 2 + j);
  }

  /** Camera-facing light billboard. part: damage part that hides the light when destroyed (-1 none). */
  light(
    center: Vec3,
    kind: number,
    color: readonly [number, number, number],
    size: number,
    part: number,
    bone: number,
  ): void {
    const base = this.pos.length / 3;
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      this.v(center, kind, cx, cy, part, [color[0], color[1], color[2], size], bone);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  shift(dz: number): void {
    for (let i = 2; i < this.pos.length; i += 3) this.pos[i] = this.pos[i]! + dz;
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aFxA', new Float32BufferAttribute(this.a, 4));
    g.setAttribute('aFxB', new Float32BufferAttribute(this.b, 4));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinI, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.skinW, 4));
    g.setIndex(new Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

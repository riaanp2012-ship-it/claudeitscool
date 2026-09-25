/**
 * Bone definitions for the GPU-skinned airframe. Every moving part (control surfaces, gear, doors, canopy,
 * nozzles, stores, detachable sections) is a bone, so a whole jet renders in one skinned draw call.
 * Bone 0 is the per-aircraft data bone (damage, throttle, strobe phase, tail number) read by the shaders;
 * bone 1 is the airframe root.
 */
export type BoneRole =
  | 'data'
  | 'root'
  | 'wingtip'
  | 'tail'
  | 'aileron'
  | 'flap'
  | 'elevon'
  | 'stab'
  | 'canard'
  | 'elevator'
  | 'rudder'
  | 'airbrake'
  | 'canopy'
  | 'gear'
  | 'door'
  | 'nozzle'
  | 'nozzleFlap'
  | 'store'
  | 'decelU'
  | 'decelL'
  | 'slat';

export type Vec3 = [number, number, number];

export interface BoneDef {
  role: BoneRole;
  /** Parent bone index; -1 = attached directly to the model root object. */
  parent: number;
  /** Rest pivot in model space. */
  pivot: Vec3;
  /** Unit rotation axis in model space (rest). */
  axis: Vec3;
  /** -1 left, 0 centre, 1 right. */
  side: number;
  /** Maximum deflection/opening in radians (or scale range for nozzles). */
  max: number;
  /** Role-specific: store index, door timing, direction sign. */
  param: number;
  param2: number;
}

export const DATA_BONE = 0;
export const ROOT_BONE = 1;

export class Rig {
  readonly bones: BoneDef[] = [];
  private readonly mirrorOf = new Map<number, number>();

  constructor() {
    this.bones.push(bone('data', -1, [0, 0, 0], [1, 0, 0], 0, 0));
    this.bones.push(bone('root', -1, [0, 0, 0], [1, 0, 0], 0, 0));
  }

  add(def: Partial<BoneDef> & { role: BoneRole; pivot: Vec3 }): number {
    this.bones.push({
      parent: ROOT_BONE,
      axis: [1, 0, 0],
      side: 0,
      max: 0,
      param: 0,
      param2: 0,
      ...def,
    });
    return this.bones.length - 1;
  }

  /** Adds a right-side bone and its mirrored left twin. Returns [right, left]. */
  addPair(def: Partial<BoneDef> & { role: BoneRole; pivot: Vec3 }): [number, number] {
    const right = this.add({ ...def, side: 1 });
    const r = this.bones[right]!;
    const leftParent = r.parent >= 0 ? this.mirror(r.parent) : r.parent;
    const left = this.add({
      ...r,
      side: -1,
      parent: leftParent,
      pivot: [-r.pivot[0], r.pivot[1], r.pivot[2]],
      axis: [r.axis[0], -r.axis[1], -r.axis[2]],
    });
    this.mirrorOf.set(right, left);
    this.mirrorOf.set(left, right);
    return [right, left];
  }

  mirror(b: number): number {
    return this.mirrorOf.get(b) ?? b;
  }

  readonly mirrorFn = (b: number): number => this.mirror(b);

  shift(dz: number): void {
    for (const b of this.bones) if (b.role !== 'data') b.pivot[2] += dz;
  }
}

function bone(role: BoneRole, parent: number, pivot: Vec3, axis: Vec3, side: number, max: number): BoneDef {
  return { role, parent, pivot, axis, side, max, param: 0, param2: 0 };
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

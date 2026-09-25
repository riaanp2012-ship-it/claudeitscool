import { Bone, Group, Matrix4, Object3D, Skeleton, SkinnedMesh, Sphere, Vector3, type Material } from 'three';
import type {
  AircraftModel,
  AircraftModelOptions,
  AircraftVisualState,
  HardpointMount,
  HitCapsule,
} from '../core/types';
import { cosmetic } from '../core/rng';
import type { AirframeData } from './airframe';
import { glyphIndex } from './atlas';
import type { BoneRole } from './rig';

const ROLE: Record<BoneRole, number> = {
  data: 0,
  root: 1,
  wingtip: 2,
  tail: 3,
  aileron: 4,
  flap: 5,
  elevon: 6,
  stab: 7,
  canard: 8,
  elevator: 9,
  rudder: 10,
  airbrake: 11,
  canopy: 12,
  gear: 13,
  door: 14,
  nozzle: 15,
  nozzleFlap: 16,
  store: 17,
  decelU: 18,
  decelL: 19,
  slat: 20,
};

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

export interface ModelMaterials {
  body: Material;
  glass: Material;
  fx: Material;
}

/**
 * Runtime aircraft: shares geometry and materials with every other aircraft of its type/livery and owns
 * only its skeleton (bones + a small bone texture). One skinned draw call for the airframe, one for the
 * canopy glass and one for the additive effects at LOD0; one airframe draw call plus effects at LOD1.
 */
export class ArtAircraftModel implements AircraftModel {
  readonly root = new Group();
  readonly length: number;
  readonly span: number;
  readonly radius: number;
  readonly cockpitEye: Vector3;
  readonly nozzles: readonly Vector3[];
  readonly wingtips: readonly [Vector3, Vector3];
  readonly hardpoints: readonly HardpointMount[];
  readonly gunMuzzle: Vector3;
  readonly gearContactY: number;
  readonly hitCapsules: readonly HitCapsule[];

  private readonly bones: Bone[] = [];
  private readonly roles: Int8Array;
  private readonly sides: Float32Array;
  private readonly maxes: Float32Array;
  private readonly params: Float32Array;
  private readonly axes: Vector3[] = [];
  private readonly skeleton: Skeleton;
  private readonly data: number[];
  private readonly lod0 = new Group();
  private readonly lod1 = new Group();
  private readonly fx: SkinnedMesh;
  private readonly meshes: SkinnedMesh[] = [];
  private lod: 0 | 1 | 2 = 0;

  constructor(asset: AirframeData, mats: ModelMaterials, options: AircraftModelOptions) {
    const m = asset.meta;
    this.root.name = `aircraft-${asset.id}`;
    this.length = m.length;
    this.span = m.span;
    this.radius = m.radius;
    this.cockpitEye = new Vector3(...m.cockpitEye);
    this.nozzles = m.nozzles.map((n) => new Vector3(...n));
    this.wingtips = [new Vector3(...m.wingtips[0]), new Vector3(...m.wingtips[1])];
    this.hardpoints = m.hardpoints.map((h) => ({
      position: new Vector3(...h.position),
      kind: h.kind,
      internal: h.internal,
    }));
    this.gunMuzzle = new Vector3(...m.gunMuzzle);
    this.gearContactY = m.gearContactY;
    this.hitCapsules = m.capsules.map((c) => ({
      a: new Vector3(...c.a),
      b: new Vector3(...c.b),
      radius: c.radius,
      part: c.part,
    }));

    // ── skeleton: bone 0 carries per-aircraft data and never enters the scene graph
    const defs = asset.bones;
    const n = defs.length;
    this.roles = new Int8Array(n);
    this.sides = new Float32Array(n);
    this.maxes = new Float32Array(n);
    this.params = new Float32Array(n);
    const inverses: Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const d = defs[i]!;
      const bone = new Bone();
      bone.name = `${d.role}-${i}`;
      this.roles[i] = ROLE[d.role];
      this.sides[i] = d.side;
      this.maxes[i] = d.max;
      this.params[i] = d.param;
      this.axes.push(new Vector3(...d.axis).normalize());
      if (i === 0) {
        bone.matrixAutoUpdate = false;
        bone.matrixWorldAutoUpdate = false;
        inverses.push(new Matrix4());
      } else {
        const parent = d.parent >= 1 ? defs[d.parent]! : null;
        bone.position.set(
          d.pivot[0] - (parent ? parent.pivot[0] : 0),
          d.pivot[1] - (parent ? parent.pivot[1] : 0),
          d.pivot[2] - (parent ? parent.pivot[2] : 0),
        );
        inverses.push(new Matrix4().makeTranslation(-d.pivot[0], -d.pivot[1], -d.pivot[2]));
      }
      this.bones.push(bone);
    }
    for (let i = 1; i < n; i++) {
      const p = defs[i]!.parent;
      if (p >= 1) this.bones[p]!.add(this.bones[i]!);
      else this.root.add(this.bones[i]!);
    }
    this.skeleton = new Skeleton(this.bones, inverses);
    this.data = this.bones[0]!.matrixWorld.elements;
    this.bones[0]!.matrixWorld.identity();
    const e = this.bones[0]!.matrixWorld.elements;
    e.fill(0);
    // tail number glyphs (up to four characters; blanks are -1)
    const chars = options.tailNumber.replace(/\s+/g, '').slice(-4);
    const glyphs = [-1, -1, -1, -1];
    for (let i = 0; i < chars.length; i++) glyphs[i] = glyphIndex(chars[i]!);
    e[9] = glyphs[0]!;
    e[10] = glyphs[1]!;
    e[11] = glyphs[2]!;
    e[12] = glyphs[3]!;
    e[7] = cosmetic.next();
    e[8] = 1;

    // ── meshes
    const identity = new Matrix4();
    const make = (geo: SkinnedMesh['geometry'], mat: Material, extra: number): SkinnedMesh => {
      const mesh = new SkinnedMesh(geo, mat);
      mesh.bind(this.skeleton, identity);
      mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), m.radius + extra);
      mesh.castShadow = true;
      this.meshes.push(mesh);
      return mesh;
    };
    const body0 = make(asset.lod0.body, mats.body, 0.5);
    const glass = make(asset.lod0.glass, mats.glass, 0.5);
    glass.castShadow = false;
    glass.renderOrder = 1;
    this.lod0.add(body0, glass);
    const body1 = make(asset.lod1.body, mats.body, 0.5);
    this.lod1.add(body1);
    this.lod1.visible = false;
    this.fx = make(asset.lod0.fx, mats.fx, 9);
    this.fx.castShadow = false;
    this.fx.renderOrder = 2;
    this.fx.frustumCulled = true;
    this.root.add(this.lod0, this.lod1, this.fx);
  }

  setLod(level: 0 | 1 | 2): void {
    if (level === this.lod) return;
    this.lod = level;
    this.lod0.visible = level === 0;
    this.lod1.visible = level === 1;
    this.fx.visible = level !== 2;
  }

  update(s: AircraftVisualState, _dt: number, time: number): void {
    const e = this.data;
    e[0] = s.damage.engine;
    e[1] = s.damage.wingL;
    e[2] = s.damage.wingR;
    e[3] = s.damage.tail;
    e[4] = s.throttle;
    e[5] = s.afterburner;
    e[6] = time % 3600;
    e[8] = s.navLights ? 1 : 0;
    if (this.lod === 2) return;
    const bones = this.bones;
    const gearExt = smoothstep(0.25, 1, s.gear);
    const doorOpen = smoothstep(0, 0.3, s.gear);
    for (let i = 2; i < bones.length; i++) {
      const bone = bones[i]!;
      const side = this.sides[i]!;
      const max = this.maxes[i]!;
      let angle: number;
      switch (this.roles[i]) {
        case 4: // aileron
          angle = -side * s.aileron * max;
          break;
        case 5: // flap
          angle = s.flaps * max;
          break;
        case 6: // elevon
          angle = clamp1(-s.elevator - side * s.aileron) * max;
          break;
        case 7: // stabilator (also tailerons)
          angle = clamp1(-s.elevator - side * s.aileron * 0.35) * max;
          break;
        case 8: // canard
          angle = s.elevator * max;
          break;
        case 9: // elevator
          angle = -s.elevator * max;
          break;
        case 10: // rudder
          angle = (side === 0 ? 1 : side) * s.rudder * max;
          break;
        case 11: // airbrake
          angle = s.airbrake * max * this.params[i]!;
          break;
        case 12: // canopy
          angle = s.canopy * max;
          break;
        case 13: // gear strut
          angle = (1 - gearExt) * max;
          break;
        case 14: // gear door
          angle = doorOpen * max;
          break;
        case 15: {
          // round nozzle: petals close toward military power, open wide in afterburner
          const k =
            (1 - s.afterburner) * (1 - 0.13 * smoothstep(0.25, 0.95, s.throttle)) + s.afterburner * 1.17;
          bone.scale.set(k, k, 1);
          continue;
        }
        case 16: {
          const open = s.afterburner * 0.15 + (1 - s.throttle) * 0.04;
          const vec = -s.elevator * 0.18;
          angle = this.params[i]! > 0 ? -open + vec : open + vec;
          break;
        }
        case 17: // store
          bone.scale.setScalar(s.stores[this.params[i]!] ? 1 : 0);
          continue;
        case 2: // detachable wingtip
          bone.scale.setScalar((side < 0 ? s.damage.wingL : s.damage.wingR) >= 1 ? 0 : 1);
          continue;
        case 3: // tail section
          bone.scale.setScalar(s.damage.tail >= 1 ? 0 : 1);
          continue;
        case 18: // split deceleron upper
          angle = (-side * s.aileron * 0.8 - s.airbrake) * max;
          break;
        case 19: // split deceleron lower
          angle = (-side * s.aileron * 0.8 + s.airbrake) * max;
          break;
        default:
          continue;
      }
      bone.quaternion.setFromAxisAngle(this.axes[i]!, angle);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.skeleton.dispose();
    for (const m of this.meshes) m.removeFromParent();
    this.meshes.length = 0;
  }

  /** Scene-graph node for tests/harness inspection. */
  get object(): Object3D {
    return this.root;
  }
}

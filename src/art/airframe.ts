import type { BufferGeometry } from 'three';
import type { AircraftId, HardpointKind, HitCapsule } from '../core/types';
import { MeshBuilder, PAINT } from './builder';
import { emptyMeta, type BuildContext, type DecalDef, type MetaDraft } from './context';
import { FxBuilder } from './fxgeo';
import { Rig, type BoneDef, type Vec3 } from './rig';
import { Profile } from './shapes';

/** A jet design: builds its airframe in design space (z = station aft of the nose tip, metres). */
export interface JetDesign {
  id: AircraftId;
  /** Station of the centre of gravity; the model origin is placed there. */
  cgZ: number;
  fuselage: Profile;
  build(ctx: BuildContext): void;
}

export interface AirframeMeta {
  length: number;
  span: number;
  height: number;
  radius: number;
  cockpitEye: Vec3;
  nozzles: Vec3[];
  wingtips: [Vec3, Vec3];
  gunMuzzle: Vec3;
  gearContactY: number;
  hardpoints: { position: Vec3; kind: HardpointKind; internal: boolean }[];
  capsules: { a: Vec3; b: Vec3; radius: number; part: HitCapsule['part'] }[];
  decals: DecalDef[];
  soot: [number, number, number, number][];
  radomeZ: number;
  antiGlare: [number, number, number, number];
  /** Airframe bounds (stores excluded), gear down. */
  min: Vec3;
  max: Vec3;
}

export interface AirframeData {
  id: AircraftId;
  bones: BoneDef[];
  lod0: { body: BufferGeometry; glass: BufferGeometry; fx: BufferGeometry };
  lod1: { body: BufferGeometry };
  meta: AirframeMeta;
  triangles: { lod0: number; lod1: number };
  /** Raw builders (kept for tests and harness statistics). */
  builders: { body0: MeshBuilder; body1: MeshBuilder; glass: MeshBuilder };
}

function context(lod: 0 | 1, design: JetDesign): BuildContext {
  return {
    lod,
    body: new MeshBuilder(),
    glass: new MeshBuilder(),
    fx: new FxBuilder(),
    rig: new Rig(),
    meta: emptyMeta(),
    fuselage: design.fuselage,
  };
}

const shiftV = (v: Vec3, dz: number): Vec3 => [v[0], v[1], v[2] + dz];

function shiftMeta(m: MetaDraft, dz: number): void {
  m.cockpitEye = shiftV(m.cockpitEye, dz);
  m.nozzles = m.nozzles.map((n) => shiftV(n, dz));
  m.wingtips = [shiftV(m.wingtips[0], dz), shiftV(m.wingtips[1], dz)];
  m.gunMuzzle = shiftV(m.gunMuzzle, dz);
  for (const h of m.hardpoints) h.position = shiftV(h.position, dz);
  for (const c of m.capsules) {
    c.a = shiftV(c.a, dz);
    c.b = shiftV(c.b, dz);
  }
  for (const d of m.decals) d.center = shiftV(d.center, dz);
  m.soot = m.soot.map((s) => [s[0], s[1], s[2] + dz, s[3]]);
  m.radomeZ += dz;
  m.antiGlare = [m.antiGlare[0] + dz, m.antiGlare[1] + dz, m.antiGlare[2], m.antiGlare[3]];
}

/** Builds both LODs of a design, rigs it and moves the origin to the centre of gravity. */
export function buildAirframe(design: JetDesign): AirframeData {
  const c0 = context(0, design);
  const c1 = context(1, design);
  design.build(c0);
  design.build(c1);
  if (c0.rig.bones.length !== c1.rig.bones.length) {
    throw new Error(`art: ${design.id} LOD rigs differ (${c0.rig.bones.length} vs ${c1.rig.bones.length})`);
  }
  const dz = -design.cgZ;
  c0.body.translate(0, 0, 0, dz);
  c1.body.translate(0, 0, 0, dz);
  c0.glass.translate(0, 0, 0, dz);
  c0.fx.shift(dz);
  c0.rig.shift(dz);
  shiftMeta(c0.meta, dz);

  const b = c0.body;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (let v = 0; v < b.vertexCount; v++) {
    const x = b.pos[v * 3]!;
    const y = b.pos[v * 3 + 1]!;
    const z = b.pos[v * 3 + 2]!;
    radius = Math.max(radius, Math.hypot(x, y, z));
    if (b.info[v * 4] === PAINT.store) continue;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  const m = c0.meta;
  const meta: AirframeMeta = {
    ...m,
    length: max[2] - min[2],
    span: max[0] - min[0],
    height: max[1] - Math.min(min[1], m.gearContactY),
    radius,
    min,
    max,
  };
  return {
    id: design.id,
    bones: c0.rig.bones,
    lod0: {
      body: c0.body.toGeometry(),
      glass: c0.glass.toGeometry({ glass: true }),
      fx: c0.fx.toGeometry(),
    },
    lod1: { body: c1.body.toGeometry() },
    meta,
    triangles: { lod0: c0.body.triangleCount + c0.glass.triangleCount, lod1: c1.body.triangleCount },
    builders: { body0: c0.body, body1: c1.body, glass: c0.glass },
  };
}

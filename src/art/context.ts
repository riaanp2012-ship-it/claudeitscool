import type { HardpointKind, HitCapsule } from '../core/types';
import type { MeshBuilder } from './builder';
import type { FxBuilder } from './fxgeo';
import type { Rig, Vec3 } from './rig';
import type { Profile } from './shapes';

export interface DecalDef {
  /** 0 atlas image, 1 tail number (all glyphs), 2 last two glyphs, 3 flat colour rectangle. */
  type: number;
  center: Vec3;
  /** Unit right/up axes of the decal plane (right x up = facing direction). */
  right: Vec3;
  up: Vec3;
  halfW: number;
  halfH: number;
  /** Atlas key (see atlas.ts) for type 0. */
  atlas?: string;
  /** Tint (linear RGB) and opacity; type 0 multiplies atlas colour by tint. */
  color?: [number, number, number, number];
  /** Projection depth tolerance (m). */
  depth?: number;
  /** Team restriction: 'blue', 'red' or both. */
  team?: 'blue' | 'red';
  /** Uses the livery accent colour instead of `color`. */
  accent?: boolean;
  /** Uses the livery stencil colour instead of `color` (numbers, unit codes, NO STEP). */
  stencil?: boolean;
}

export interface MetaDraft {
  cockpitEye: Vec3;
  nozzles: Vec3[];
  wingtips: [Vec3, Vec3];
  gunMuzzle: Vec3;
  gearContactY: number;
  hardpoints: { position: Vec3; kind: HardpointKind; internal: boolean }[];
  capsules: { a: Vec3; b: Vec3; radius: number; part: HitCapsule['part'] }[];
  decals: DecalDef[];
  /** Nozzle exits and radii for exhaust soot in the livery shader. */
  soot: [number, number, number, number][];
  /** Radome end station, anti-glare region: [z0, z1, halfWidth, minY]. */
  radomeZ: number;
  antiGlare: [number, number, number, number];
}

export interface BuildContext {
  lod: 0 | 1;
  body: MeshBuilder;
  glass: MeshBuilder;
  fx: FxBuilder;
  rig: Rig;
  meta: MetaDraft;
  /** Main fuselage profile for components that sit on the skin (canopy sill, doors). */
  fuselage: Profile;
}

export function emptyMeta(): MetaDraft {
  return {
    cockpitEye: [0, 0, 0],
    nozzles: [],
    wingtips: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    gunMuzzle: [0, 0, 0],
    gearContactY: 0,
    hardpoints: [],
    capsules: [],
    decals: [],
    soot: [],
    radomeZ: 0,
    antiGlare: [0, 0, 0, 0],
  };
}

import type { Object3D } from 'three';
import type { AircraftId, AircraftModelFactory, GroundTargetKind, OrdnanceModelFactory } from '../core/types';
import {
  getAirframe,
  getFxMaterial,
  getGlassMaterial,
  getLiveryMaterial,
  getOrdnanceMaterial,
  getWreckMaterial,
  makeOrdnanceMesh,
} from './cache';
import { makeGroundUnit, wreckGroundUnit } from './ground';
import { hasDesign } from './designs';
import { ArtAircraftModel } from './model';

export { disposeArtCache } from './cache';
export { LIVERIES } from './livery';

/** Procedural aircraft (spec section 7): shared geometry per type, shared materials per type and livery. */
export const createAircraftModel: AircraftModelFactory = (id, options) => {
  const asset = getAirframe(id);
  return new ArtAircraftModel(
    asset,
    {
      body: getLiveryMaterial(id, options.team, options.livery),
      glass: getGlassMaterial(),
      fx: getFxMaterial(),
    },
    options,
  );
};

/** True when the jet has its own finished airframe (unfinished jets fall back to the Kestrel airframe). */
export function isAircraftAvailable(id: AircraftId): boolean {
  return hasDesign(id);
}

/** A store in flight or on a pylon: nose -Z, origin at its centre; geometry and material are shared. */
export const createOrdnanceModel: OrdnanceModelFactory = (kind) => makeOrdnanceMesh(kind);

/** Triangle and draw-call counts per LOD (harness and budget checks). */
export function artStats(id: AircraftId): {
  lod0: { triangles: number; drawCalls: number };
  lod1: { triangles: number; drawCalls: number };
} {
  const a = getAirframe(id);
  return {
    lod0: { triangles: a.triangles.lod0, drawCalls: 3 },
    lod1: { triangles: a.triangles.lod1, drawCalls: 2 },
  };
}

/**
 * Ground target at real scale (SAM launcher, AAA, radar, hangar, fuel farm, command bunker, concrete bunker,
 * frigate). Front toward -Z, origin at the ground contact centre (ship: waterline). Geometry is shared per
 * (kind, climate); `desert` switches to sand paint.
 */
export function createGroundUnitModel(kind: GroundTargetKind, desert: boolean): Object3D {
  return makeGroundUnit(kind, desert, getOrdnanceMaterial());
}

/** Converts a unit from createGroundUnitModel into its wreck (scorched, slumped). Safe to call twice. */
export function wreckGroundUnitModel(obj: Object3D): void {
  wreckGroundUnit(obj, getWreckMaterial());
}

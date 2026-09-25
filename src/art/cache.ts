import {
  Mesh,
  type BufferGeometry,
  type Material,
  type MeshPhysicalMaterial,
  type ShaderMaterial,
} from 'three';
import type { AircraftId, HardpointKind, Team } from '../core/types';
import { buildAirframe, type AirframeData } from './airframe';
import { disposeAtlas } from './atlas';
import { MeshBuilder } from './builder';
import { designFor } from './designs';
import { createFxMaterial, createGlassMaterial } from './effects';
import { createLiveryMaterial, disposeLiveryMaterial, liveryFor } from './livery';
import { buildOrdnance } from './ordnance';

/**
 * Shared GPU resources. Geometry is built once per jet type; materials once per (type, team, livery);
 * the glass and effects materials once overall. Models reference these and never dispose them.
 */
const airframes = new Map<AircraftId, AirframeData>();
const liveries = new Map<string, MeshPhysicalMaterial>();
const ordnanceGeo = new Map<HardpointKind, BufferGeometry>();
let glass: MeshPhysicalMaterial | null = null;
let fx: ShaderMaterial | null = null;
let ordnanceMat: MeshPhysicalMaterial | null = null;

export function getAirframe(id: AircraftId): AirframeData {
  let a = airframes.get(id);
  if (!a) {
    a = buildAirframe(designFor(id));
    airframes.set(id, a);
  }
  return a;
}

export function getLiveryMaterial(id: AircraftId, team: Team, livery: number): MeshPhysicalMaterial {
  const lv = liveryFor(team, livery);
  const key = `${id}|${team}|${lv.name}`;
  let m = liveries.get(key);
  if (!m) {
    const a = getAirframe(id);
    m = createLiveryMaterial(
      {
        decals: a.meta.decals,
        soot: a.meta.soot,
        gun: a.meta.gunMuzzle,
        radomeZ: a.meta.radomeZ,
        antiGlare: a.meta.antiGlare,
        length: a.meta.length,
      },
      team,
      livery,
    );
    liveries.set(key, m);
  }
  return m;
}

export function getGlassMaterial(): MeshPhysicalMaterial {
  glass ??= createGlassMaterial();
  return glass;
}

export function getFxMaterial(): ShaderMaterial {
  fx ??= createFxMaterial();
  return fx;
}

export function getOrdnanceGeometry(kind: HardpointKind): BufferGeometry {
  let g = ordnanceGeo.get(kind);
  if (!g) {
    const b = new MeshBuilder();
    buildOrdnance(b, kind, 0);
    g = b.toGeometry({ skin: false });
    ordnanceGeo.set(kind, g);
  }
  return g;
}

export function getOrdnanceMaterial(): Material {
  ordnanceMat ??= createLiveryMaterial(null, 'blue', 0);
  return ordnanceMat;
}

export function makeOrdnanceMesh(kind: HardpointKind): Mesh {
  const m = new Mesh(getOrdnanceGeometry(kind), getOrdnanceMaterial());
  m.name = `ordnance-${kind}`;
  m.castShadow = true;
  return m;
}

/** Frees every cached geometry, material and texture (full teardown). */
export function disposeArtCache(): void {
  for (const a of airframes.values()) {
    a.lod0.body.dispose();
    a.lod0.glass.dispose();
    a.lod0.fx.dispose();
    a.lod1.body.dispose();
  }
  airframes.clear();
  for (const m of liveries.values()) disposeLiveryMaterial(m);
  liveries.clear();
  for (const g of ordnanceGeo.values()) g.dispose();
  ordnanceGeo.clear();
  glass?.dispose();
  glass = null;
  fx?.dispose();
  fx = null;
  if (ordnanceMat) disposeLiveryMaterial(ordnanceMat);
  ordnanceMat = null;
  disposeAtlas();
}

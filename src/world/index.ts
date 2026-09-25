import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PMREMGenerator,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type PerspectiveCamera,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type {
  GroundTargetSlot,
  MapId,
  RunwayInfo,
  SpawnPoint,
  World,
  WorldFactory,
  WorldOptions,
} from '../core/types';
import { atmoUniforms, setAtmosphere } from '../render/atmosphere';
import { Clouds } from './clouds';
import {
  BOUNDARY,
  FAR_EXTENT,
  NEAR_BLEND_END,
  NEAR_BLEND_START,
  NEAR_EXTENT,
  TERRAIN_QUALITY,
  type TerrainQuality,
} from './constants';
import { Deck } from './deck';
import { generateTerrain } from './generate';
import { makeDomain, TerrainBounds, TerrainHeights } from './heightfield';
import { KESSEL } from './maps/kessel';
import type { MapDef } from './maps/types';
import { Sky } from './sky';
import { StructureBuilder } from './structures';
import { Terrain } from './terrain';
import { createWorldTextures } from './textures';
import { Vegetation } from './vegetation';
import { Water } from './water';

const MAP_DEFS: Partial<Record<MapId, MapDef>> = {
  kessel: KESSEL,
};

export function isMapAvailable(id: MapId): boolean {
  return MAP_DEFS[id] !== undefined;
}

/** Internal knobs for harness pages (not part of the World contract). */
export interface WorldOverrides {
  /** Heightmap resolution for both domains (e.g. 1024 for software rendering). */
  res?: number;
}

export interface WorldStats {
  terrainNodes: number;
  trees: number;
  treeInstances: number;
  puffs: number;
  generationMs: number;
  /** Last update() cost per subsystem (ms). */
  terrainMs: number;
  cloudsMs: number;
  treesMs: number;
}

/** World plus diagnostics for harness pages. */
export interface WorldInternal extends World {
  stats(): WorldStats;
}

const _dir = new Vector3();
const _p = new Vector3();

export const createWorld: WorldFactory = (renderer, options, onProgress) =>
  createWorldWith(renderer, options, onProgress, {});

export async function createWorldWith(
  renderer: WebGLRenderer,
  options: WorldOptions,
  onProgress: (fraction: number, label: string) => void,
  overrides: WorldOverrides,
): Promise<WorldInternal> {
  const def = MAP_DEFS[options.map];
  if (!def) throw new Error(`Map "${options.map}" is not available in this build.`);
  const t0 = performance.now();
  const baseQ = TERRAIN_QUALITY[options.quality.terrain];
  const q: TerrainQuality = overrides.res
    ? { ...baseQ, nearRes: overrides.res, farRes: Math.min(overrides.res, baseQ.farRes) }
    : baseQ;

  onProgress(0, 'Preparing atmosphere');
  const atmo = def.atmosphere();
  setAtmosphere(atmo);
  const sunDir = atmo.sunDirection.clone().normalize();

  const disposables: { dispose(): void }[] = [];
  const textures = createWorldTextures(renderer, def.seed);
  disposables.push(textures);

  const nearDom = makeDomain(NEAR_EXTENT, q.nearRes);
  const farDom = makeDomain(FAR_EXTENT, q.farRes);
  const gen = await generateTerrain(renderer, def, { near: nearDom, far: farDom, sunDir, onProgress });
  for (const d of [gen.near, gen.far]) {
    disposables.push(d.heightTex, d.maskTex, d.bake);
  }
  const heights = new TerrainHeights(gen.near.grid, gen.far.grid, NEAR_BLEND_START, NEAR_BLEND_END);
  const bounds = new TerrainBounds(heights);
  const heightAt = (x: number, z: number) => heights.heightAt(x, z);

  const sampleUniforms: Record<string, IUniform> = {
    uHNear: { value: gen.near.heightTex },
    uHFar: { value: gen.far.heightTex },
    uNearDom: { value: new Vector4(nearDom.originX, nearDom.originZ, nearDom.cell, nearDom.size) },
    uFarDom: { value: new Vector4(farDom.originX, farDom.originZ, farDom.cell, farDom.size) },
    uBlend: { value: new Vector2(NEAR_BLEND_START, NEAR_BLEND_END) },
  };

  const root = new Group();
  root.name = `world-${def.id}`;

  onProgress(0.75, 'Forming clouds');
  const clouds = new Clouds({
    def: def.clouds,
    seed: def.seed[1] * 7 + 3,
    sunDir,
    sampleUniforms,
    puffTexture: textures.puffs,
    waterLevel: def.waterLevel,
    heightAt,
    scale:
      q.cloudPuffScale *
      (options.quality.clouds === 'low' ? 0.6 : options.quality.clouds === 'high' ? 1.2 : 1),
  });
  disposables.push(clouds);
  root.add(clouds.mesh);

  const cloudShadow = clouds.bakeShadow(sunDir, 0.78);
  disposables.push(cloudShadow.texture);

  onProgress(0.76, 'Laying out terrain');
  const palette = def.palette();
  const terrain = new Terrain({
    quality: q,
    bounds,
    sampleUniforms,
    cloudShadow: cloudShadow.uniforms,
    textures: {
      bakeNear: gen.near.bake.texture,
      bakeFar: gen.far.bake.texture,
      maskNear: gen.near.maskTex,
      maskFar: gen.far.maskTex,
      detail: textures.detail,
    },
    palette,
    airbases: def.airbases,
    waterLevel: def.waterLevel,
    roadWidth: def.roadWidth,
    seed: def.seed,
  });
  disposables.push(terrain);
  root.add(...terrain.meshes);

  const sky = new Sky({ cirrus: def.id === 'kessel' ? 0.55 : 0.3, groundAlbedo: palette.grass });
  disposables.push(sky);
  root.add(sky.mesh);

  const water = new Water({
    waterLevel: def.waterLevel,
    cloudShadow: cloudShadow.uniforms,
    sampleUniforms,
    waves: textures.water,
    deep: waterColors[def.id]?.deep ?? new Color(0.004, 0.02, 0.03),
    shallow: waterColors[def.id]?.shallow ?? new Color(0.02, 0.09, 0.09),
    waveStrength: def.id === 'typhoon' ? 1.8 : 1,
    glint: 22,
  });
  disposables.push(water);
  root.add(water.mesh);

  onProgress(0.8, 'Building structures');
  const builder = new StructureBuilder(heightAt);
  const targetDefs = def.build(builder, heightAt);
  const built = builder.finish();
  root.add(...built.meshes);
  disposables.push(built.material, ...built.geometries);
  await Promise.resolve();

  onProgress(0.84, 'Planting trees');
  const clearings: [number, number, number][] = targetDefs.map((t) => [t.x, t.z, 70]);
  const vegetation = new Vegetation({
    def: def.vegetation(),
    grid: gen.near.grid,
    mask: gen.near.mask,
    heightAt,
    density: options.quality.vegetation,
    radius: q.treeRadius,
    seed: def.seed[0] * 31 + def.seed[1],
    clearings: [...clearings, ...builder.clearings],
    waterLevel: def.waterLevel,
  });
  disposables.push(vegetation);
  root.add(...vegetation.meshes);

  let deck: Deck | null = null;
  if (def.deck) {
    deck = new Deck({ def: def.deck, sampleUniforms, detail: textures.detail, atmo });
    disposables.push(deck);
    root.add(...deck.meshes);
  }

  // Lights: the sun always matches uSunDir / uSunColor; the hemisphere matches the ambient terms.
  const sun = new DirectionalLight(atmoUniforms.uSunColor.value.clone(), 1);
  sun.name = 'sun';
  sun.position.copy(sunDir).multiplyScalar(10000);
  sun.target.position.set(0, 0, 0);
  root.add(sun, sun.target);
  const hemi = new HemisphereLight(
    atmoUniforms.uAmbientSky.value.clone(),
    atmoUniforms.uAmbientGround.value.clone(),
    1,
  );
  hemi.name = 'ambient';
  root.add(hemi);

  onProgress(0.95, 'Capturing sky light');
  const envTarget = captureEnvironment(renderer, palette.grass);
  disposables.push(envTarget);

  // Runways (surface height from the final terrain), spawns and targets.
  const runways: RunwayInfo[] = [];
  for (const base of def.airbases) {
    for (const r of base.runways) {
      runways.push({
        id: r.id,
        center: new Vector3(r.x, heightAt(r.x, r.z), r.z),
        heading: r.heading,
        length: r.length,
        width: r.width,
      });
    }
  }
  const airSpawns = buildSpawns(def, bounds);
  const groundTargets: GroundTargetSlot[] = targetDefs.map((t, i) => ({
    id: `${t.group}-${t.kind}-${i}`,
    kind: t.kind,
    position: new Vector3(t.x, t.y ?? heightAt(t.x, t.z), t.z),
    heading: t.heading,
    group: t.group,
  }));

  const generationMs = performance.now() - t0;
  onProgress(1, 'Ready');

  const lastCam = new Vector3();
  const timings = new Float32Array(3);
  const world: WorldInternal = {
    map: def.id,
    root,
    sun,
    environment: envTarget.texture,
    boundary: BOUNDARY,
    waterLevel: def.waterLevel,
    cloudDeck: def.deck ? { base: def.deck.base, top: def.deck.top } : null,
    runways,
    airSpawns,
    groundTargets,
    heightAt,
    surfaceAt(x, z) {
      const h = heights.heightAt(x, z);
      return h > def.waterLevel ? h : def.waterLevel;
    },
    normalAt(x, z, out) {
      const e = 10;
      const hx = heights.heightAt(x - e, z) - heights.heightAt(x + e, z);
      const hz = heights.heightAt(x, z - e) - heights.heightAt(x, z + e);
      return out.set(hx, 2 * e, hz).normalize();
    },
    lineOfSightBlocked(a, b) {
      return segmentBlocked(heights, bounds, a, b);
    },
    cloudDensityAt(p) {
      const c = clouds.densityAt(p.x, p.y, p.z);
      return deck ? Math.max(c, deck.densityAt(p.x, p.y, p.z)) : c;
    },
    update(camera: PerspectiveCamera, _dt: number, elapsed: number) {
      atmoUniforms.uTime.value = elapsed;
      camera.updateMatrixWorld();
      const t0 = performance.now();
      terrain.update(camera);
      const t1 = performance.now();
      sky.update(camera);
      water.update(camera);
      clouds.update(camera);
      const t2 = performance.now();
      vegetation.update(camera);
      const t3 = performance.now();
      if (deck) deck.update(camera);
      sun.color.copy(atmoUniforms.uSunColor.value);
      hemi.color.copy(atmoUniforms.uAmbientSky.value);
      hemi.groundColor.copy(atmoUniforms.uAmbientGround.value);
      lastCam.setFromMatrixPosition(camera.matrixWorld);
      timings[0] = t1 - t0;
      timings[1] = t2 - t1;
      timings[2] = t3 - t2;
    },
    stats() {
      return {
        terrainNodes: terrain.selector.selection.fullCount + terrain.selector.selection.partialCount,
        trees: vegetation.totalTrees,
        treeInstances: vegetation.instanceCounts,
        puffs: clouds.puffCount,
        generationMs,
        terrainMs: timings[0]!,
        cloudsMs: timings[1]!,
        treesMs: timings[2]!,
      };
    },
    dispose() {
      root.removeFromParent();
      for (const d of disposables) d.dispose();
      sun.dispose();
      hemi.dispose();
    },
  };
  return world;
}

const waterColors: Partial<Record<MapId, { deep: Color; shallow: Color }>> = {
  kessel: { deep: new Color(0.0035, 0.016, 0.024), shallow: new Color(0.018, 0.085, 0.078) },
  mesa: { deep: new Color(0.012, 0.02, 0.02), shallow: new Color(0.06, 0.07, 0.05) },
  norrdal: { deep: new Color(0.002, 0.012, 0.016), shallow: new Color(0.01, 0.05, 0.05) },
};

function captureEnvironment(renderer: WebGLRenderer, groundAlbedo: Color): WebGLRenderTarget {
  const scene = new Scene();
  const envSky = new Sky({ cirrus: 0, groundAlbedo, env: true, sunDisk: 5 });
  scene.add(envSky.mesh);
  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0, 1, 5000);
  pmrem.dispose();
  envSky.dispose();
  return rt;
}

function buildSpawns(def: MapDef, bounds: TerrainBounds): { blue: SpawnPoint[]; red: SpawnPoint[] } {
  const out: { blue: SpawnPoint[]; red: SpawnPoint[] } = { blue: [], red: [] };
  const mm = new Float32Array(2);
  for (const team of ['blue', 'red'] as const) {
    const s = def.spawns[team];
    const fx = Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 4);
      const col = (i % 4) - 1.5;
      const lateral = col * 520;
      const back = row * 650;
      // Right of the heading is (-fz, fx); rows stack behind the leader.
      const x = s.x - fz * lateral - fx * back;
      const z = s.z + fx * lateral - fz * back;
      const t = i / 7;
      let alt = def.spawns.altitude[0] + (def.spawns.altitude[1] - def.spawns.altitude[0]) * t;
      bounds.bounds(x - 1200, z - 1200, x + 1200, z + 1200, mm);
      alt = Math.max(alt, mm[1]! + 450);
      out[team].push({ position: new Vector3(x, alt, z), heading: s.heading });
    }
  }
  return out;
}

/** Marches the heightmap along a segment, skipping stretches that are above the local max bound. */
function segmentBlocked(heights: TerrainHeights, bounds: TerrainBounds, a: Vector3, b: Vector3): boolean {
  _dir.subVectors(b, a);
  const len = Math.sqrt(_dir.x * _dir.x + _dir.z * _dir.z);
  const coarse = 320;
  const steps = Math.max(1, Math.ceil(len / coarse));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const x0 = a.x + _dir.x * t0;
    const z0 = a.z + _dir.z * t0;
    const x1 = a.x + _dir.x * t1;
    const z1 = a.z + _dir.z * t1;
    const yMin = Math.min(a.y + _dir.y * t0, a.y + _dir.y * t1);
    bounds.bounds(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), _mm);
    if (yMin > _mm[1]!) continue;
    const fine = Math.max(1, Math.ceil(((t1 - t0) * len) / 15));
    for (let k = 0; k <= fine; k++) {
      const t = t0 + ((t1 - t0) * k) / fine;
      _p.set(a.x + _dir.x * t, a.y + _dir.y * t, a.z + _dir.z * t);
      if (t > 0.001 && t < 0.999 && heights.heightAt(_p.x, _p.z) > _p.y) return true;
    }
  }
  return false;
}
const _mm = new Float32Array(2);

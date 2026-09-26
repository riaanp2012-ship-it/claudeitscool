import {
  BufferAttribute,
  DynamicDrawUsage,
  Float32BufferAttribute,
  FrontSide,
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector4,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { atmoUniforms } from '../render/atmosphere';
import { CdlodSelector, morphParams, type CdlodConfig } from './cdlod';
import type { TerrainQuality } from './constants';
import { NEAR_EXTENT } from './constants';
import { horizonDrop } from './glsl/terrainSample';
import type { TerrainBounds } from './heightfield';
import type { AirbaseDef, TerrainPalette } from './maps/types';
import { MAX_APRONS, MAX_LEVELS, MAX_RUNWAYS, MAX_TAXI, TERRAIN_FRAG, TERRAIN_VERT } from './terrainShader';
import { runwayNumber } from './geom2d';

/** Grid mesh with an outer skirt ring (position.y = 1 marks skirt vertices). Grid coords in position.xz. */
export function buildGridGeometry(n: number): { positions: Float32Array; index: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  const at = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) verts.push(i, 0, j);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Skirts: one extra vertex below each edge vertex, quads facing outward.
  const base = verts.length / 3;
  const edge: [number, number][] = [];
  for (let i = 0; i <= n; i++) edge.push([i, 0]);
  for (let j = 1; j <= n; j++) edge.push([n, j]);
  for (let i = n - 1; i >= 0; i--) edge.push([i, n]);
  for (let j = n - 1; j >= 1; j--) edge.push([0, j]);
  for (const [i, j] of edge) verts.push(i, 1, j);
  const m = edge.length;
  for (let e = 0; e < m; e++) {
    const e1 = (e + 1) % m;
    const [i0, j0] = edge[e]!;
    const [i1, j1] = edge[e1]!;
    const top0 = at(i0, j0);
    const top1 = at(i1, j1);
    const bot0 = base + e;
    const bot1 = base + e1;
    // Edge loop runs counter-clockwise seen from +y (x then z); outward-facing winding.
    idx.push(top0, top1, bot0, bot0, top1, bot1);
  }
  return { positions: new Float32Array(verts), index: new Uint32Array(idx) };
}

export interface TerrainTextures {
  bakeNear: Texture;
  bakeFar: Texture;
  maskNear: Texture;
  maskFar: Texture;
  detail: Texture;
}

export interface TerrainOptions {
  quality: TerrainQuality;
  bounds: TerrainBounds;
  sampleUniforms: Record<string, IUniform>;
  cloudShadow: Record<string, IUniform>;
  textures: TerrainTextures;
  palette: TerrainPalette;
  airbases: readonly AirbaseDef[];
  waterLevel: number;
  roadWidth: number;
  seed: readonly [number, number];
}

const ROOT_ALIGN = -NEAR_EXTENT / 2;

export class Terrain {
  readonly meshes: Mesh[] = [];
  readonly selector: CdlodSelector;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly planes = new Float32Array(24);
  private readonly fullAttr: InstancedBufferAttribute;
  private readonly partialAttr: InstancedBufferAttribute;
  private readonly fullGeo: InstancedBufferGeometry;
  private readonly partialGeo: InstancedBufferGeometry;
  private readonly materials: ShaderMaterial[] = [];
  readonly uniforms: Record<string, IUniform>;

  constructor(opts: TerrainOptions) {
    const q = opts.quality;
    const levels = 8;
    const top = q.leafSize * 2 ** (levels - 1);
    const rootCount = 7;
    const cfg: CdlodConfig = {
      leafSize: q.leafSize,
      levels,
      grid: q.grid,
      rangeFactor: q.rangeFactor,
      morphStart: q.morphStart,
      rootOrigin: ROOT_ALIGN - Math.floor(rootCount / 2) * top,
      rootCount,
      maxNodes: 1536,
    };
    this.selector = new CdlodSelector(cfg, (x0, z0, x1, z1, out) => opts.bounds.bounds(x0, z0, x1, z1, out));
    this.selector.setDropFunction(horizonDrop);

    const morph = morphParams(cfg);
    const morphVec: Vector2[] = [];
    for (let i = 0; i < MAX_LEVELS; i++) {
      morphVec.push(i < levels ? new Vector2(morph[i * 2]!, morph[i * 2 + 1]!) : new Vector2(1e9, 1));
    }

    this.uniforms = {
      ...opts.sampleUniforms,
      ...opts.cloudShadow,
      ...atmoUniforms,
      ...airbaseUniforms(opts.airbases),
      ...paletteUniforms(opts.palette),
      uNzSeed: { value: new Vector2(opts.seed[0], opts.seed[1]) },
      uMorph: { value: morphVec },
      uBakeNear: { value: opts.textures.bakeNear },
      uBakeFar: { value: opts.textures.bakeFar },
      uMaskNear: { value: opts.textures.maskNear },
      uMaskFar: { value: opts.textures.maskFar },
      uDetail: { value: opts.textures.detail },
      uWaterLevel: { value: opts.waterLevel },
      uFarFade: { value: new Vector2(120000, 150000) },
      uRoadHalfW: { value: opts.roadWidth * 0.5 },
    };

    this.fullAttr = new InstancedBufferAttribute(this.selector.selection.full, 4);
    this.partialAttr = new InstancedBufferAttribute(this.selector.selection.partial, 4);
    this.fullAttr.setUsage(DynamicDrawUsage);
    this.partialAttr.setUsage(DynamicDrawUsage);
    this.fullGeo = this.makeGeometry(q.grid, this.fullAttr);
    this.partialGeo = this.makeGeometry(q.grid / 2, this.partialAttr);
    this.meshes.push(this.makeMesh(this.fullGeo, q.grid), this.makeMesh(this.partialGeo, q.grid / 2));
  }

  private makeGeometry(n: number, attr: InstancedBufferAttribute): InstancedBufferGeometry {
    const { positions, index } = buildGridGeometry(n);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(new BufferAttribute(index, 1));
    geo.setAttribute('aNode', attr);
    geo.instanceCount = 0;
    return geo;
  }

  private makeMesh(geo: InstancedBufferGeometry, gridDim: number): Mesh {
    const mat = new ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: { ...this.uniforms, uGridDim: { value: gridDim } },
      side: FrontSide,
    });
    this.materials.push(mat);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'terrain';
    return mesh;
  }

  update(camera: PerspectiveCamera): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const pl = this.planes;
    for (let i = 0; i < 6; i++) {
      const p = this.frustum.planes[i]!;
      pl[i * 4] = p.normal.x;
      pl[i * 4 + 1] = p.normal.y;
      pl[i * 4 + 2] = p.normal.z;
      pl[i * 4 + 3] = p.constant;
    }
    const cam = camera.matrixWorld.elements;
    const sel = this.selector.select(cam[12]!, cam[13]!, cam[14]!, pl);
    this.fullGeo.instanceCount = sel.fullCount;
    this.partialGeo.instanceCount = sel.partialCount;
    this.fullAttr.clearUpdateRanges();
    this.fullAttr.addUpdateRange(0, Math.max(sel.fullCount, 1) * 4);
    this.fullAttr.needsUpdate = true;
    this.partialAttr.clearUpdateRanges();
    this.partialAttr.addUpdateRange(0, Math.max(sel.partialCount, 1) * 4);
    this.partialAttr.needsUpdate = true;
    const fade = this.uniforms.uFarFade!.value as Vector2;
    fade.set(camera.far * 0.62, camera.far * 0.97);
  }

  dispose(): void {
    this.fullGeo.dispose();
    this.partialGeo.dispose();
    for (const m of this.materials) m.dispose();
  }
}

function paletteUniforms(p: TerrainPalette): Record<string, IUniform> {
  return {
    uGrass: { value: p.grass },
    uGrassDry: { value: p.grassDry },
    uForest: { value: p.forest },
    uRock: { value: p.rock },
    uCliff: { value: p.cliff },
    uSand: { value: p.sand },
    uSnow: { value: p.snow },
    uDirt: { value: p.dirt },
    uField0: { value: p.field0 },
    uField1: { value: p.field1 },
    uField2: { value: p.field2 },
    uField3: { value: p.field3 },
    uUrban: { value: p.urban },
    uSeabed: { value: p.seabed },
    uSnowP: { value: new Vector4(p.snowLine, p.snowFade, p.beachHeight, p.strata) },
    uSlopeP: { value: new Vector4(p.rockSlope, p.cliffSlope, p.fieldSize, p.fieldMode) },
  };
}

function airbaseUniforms(bases: readonly AirbaseDef[]): Record<string, IUniform> {
  const rwyA: Vector4[] = [];
  const rwyB: Vector4[] = [];
  const taxi: Vector4[] = [];
  const apA: Vector4[] = [];
  const apB: Vector4[] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const grow = (x: number, z: number, r: number) => {
    minX = Math.min(minX, x - r);
    minZ = Math.min(minZ, z - r);
    maxX = Math.max(maxX, x + r);
    maxZ = Math.max(maxZ, z + r);
  };
  let taxiHalfW = 11;
  let groundsA = new Vector4(0, 0, 1, 0);
  let groundsB = new Vector4(0, 0, 1, 0);
  for (const b of bases) {
    for (const r of b.runways) {
      const dx = Math.sin(r.heading);
      const dz = -Math.cos(r.heading);
      rwyA.push(new Vector4(r.x, r.z, dx, dz));
      rwyB.push(
        new Vector4(
          r.length / 2,
          r.width / 2,
          Number(runwayNumber(r.heading)),
          Number(runwayNumber(r.heading + Math.PI)),
        ),
      );
      grow(r.x, r.z, r.length / 2 + 60);
    }
    for (const t of b.taxiways) {
      taxiHalfW = t.width / 2;
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1]!;
        const c = t.points[i]!;
        taxi.push(new Vector4(a[0], a[1], c[0], c[1]));
        grow(a[0], a[1], t.width + 10);
        grow(c[0], c[1], t.width + 10);
      }
    }
    for (const a of b.aprons) {
      apA.push(new Vector4(a.x, a.z, Math.sin(a.heading), -Math.cos(a.heading)));
      apB.push(new Vector4(a.length / 2, a.width / 2, 0, 0));
      grow(a.x, a.z, Math.hypot(a.length, a.width) / 2 + 10);
    }
    const g = b.grounds;
    groundsA = new Vector4(g.x, g.z, Math.sin(g.heading), -Math.cos(g.heading));
    groundsB = new Vector4(g.halfLength, g.halfWidth, g.falloff, 0);
    grow(g.x, g.z, Math.hypot(g.halfLength, g.halfWidth) + g.falloff);
  }
  const pad = (arr: Vector4[], n: number) => {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(new Vector4());
    return out;
  };
  if (!Number.isFinite(minX)) {
    minX = minZ = 1e9;
    maxX = maxZ = -1e9;
  }
  return {
    uRwyCount: { value: Math.min(rwyA.length, MAX_RUNWAYS) },
    uRwyA: { value: pad(rwyA, MAX_RUNWAYS) },
    uRwyB: { value: pad(rwyB, MAX_RUNWAYS) },
    uTaxiCount: { value: Math.min(taxi.length, MAX_TAXI) },
    uTaxi: { value: pad(taxi, MAX_TAXI) },
    uTaxiHalfW: { value: taxiHalfW },
    uApronCount: { value: Math.min(apA.length, MAX_APRONS) },
    uApronA: { value: pad(apA, MAX_APRONS) },
    uApronB: { value: pad(apB, MAX_APRONS) },
    uBaseBox: { value: new Vector4(minX, minZ, maxX, maxZ) },
    uGroundsA: { value: groundsA },
    uGroundsB: { value: groundsB },
  };
}

import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Frustum,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { hash2, Rng } from '../core/rng';
import { patchAtmosphere } from '../render/atmosphere';
import { setUploadRange } from './gpu';
import type { HeightGrid } from './heightfield';
import type { FlatRect, TreeSpecies, VegetationDef } from './maps/types';

const CELL = 512;

/** Merges parts into one non-indexed geometry with vertex colors. */
function mergeParts(
  parts: { geo: BufferGeometry; color: (p: Vector3, n: Vector3) => Color; smooth?: Vector3 }[],
): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    g.computeVertexNormals();
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i);
      n.fromBufferAttribute(na, i);
      if (part.smooth) {
        // Foliage: normals radiate from the crown center so low-poly crowns shade softly.
        n.copy(p).sub(part.smooth).normalize().multiplyScalar(0.8).add(n.multiplyScalar(0.2)).normalize();
      }
      const c = part.color(p, n);
      pos.push(p.x, p.y, p.z);
      nrm.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
    }
    if (g !== part.geo) g.dispose();
    part.geo.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  return out;
}

function lumpy(geo: BufferGeometry, seed: number, amount: number): BufferGeometry {
  const pa = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i);
    const k =
      1 +
      (hash2(Math.round(v.x * 1000), Math.round(v.y * 1000) + Math.round(v.z * 1000) * 7, seed) - 0.5) *
        amount;
    pa.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  return geo;
}

/** Unit-height tree geometry per species (y = 0 at the ground, 1 at the top). */
export function treeGeometry(kind: TreeSpecies, leaf: Color): BufferGeometry {
  const bark = new Color(0.07, 0.05, 0.035);
  const shade = (base: Color, lo: number, y0: number, y1: number) => (p: Vector3, n: Vector3) => {
    const t = Math.min(1, Math.max(0, (p.y - y0) / Math.max(y1 - y0, 1e-3)));
    const ao = lo + (1 - lo) * (0.55 * t + 0.45 * (0.5 + 0.5 * n.y));
    return base.clone().multiplyScalar(ao);
  };
  switch (kind) {
    case 'conifer': {
      const trunk = new CylinderGeometry(0.022, 0.035, 0.22, 5);
      trunk.translate(0, 0.11, 0);
      const tiers: { geo: BufferGeometry; color: (p: Vector3, n: Vector3) => Color }[] = [];
      const spec = [
        [0.12, 0.6, 0.25],
        [0.36, 0.82, 0.19],
        [0.6, 1.0, 0.12],
      ] as const;
      for (const [y0, y1, r] of spec) {
        const c = new ConeGeometry(r, y1 - y0, 7, 1, false);
        c.translate(0, (y0 + y1) / 2, 0);
        tiers.push({ geo: c, color: shade(leaf, 0.45, y0, y1) });
      }
      return mergeParts([{ geo: trunk, color: () => bark }, ...tiers]);
    }
    case 'broadleaf': {
      const trunk = new CylinderGeometry(0.03, 0.05, 0.4, 5);
      trunk.translate(0, 0.2, 0);
      const crown = lumpy(new IcosahedronGeometry(0.36, 1), 3, 0.45);
      crown.scale(1.12, 0.92, 1.12);
      crown.translate(0, 0.63, 0);
      return mergeParts([
        { geo: trunk, color: () => bark },
        { geo: crown, color: shade(leaf, 0.4, 0.4, 0.95), smooth: new Vector3(0, 0.62, 0) },
      ]);
    }
    case 'birch': {
      const trunk = new CylinderGeometry(0.018, 0.026, 0.55, 5);
      trunk.translate(0, 0.275, 0);
      const crown = lumpy(new IcosahedronGeometry(0.2, 1), 7, 0.4);
      crown.scale(0.9, 1.9, 0.9);
      crown.translate(0, 0.62, 0);
      return mergeParts([
        { geo: trunk, color: () => new Color(0.5, 0.48, 0.44) },
        { geo: crown, color: shade(leaf, 0.45, 0.3, 1.0), smooth: new Vector3(0, 0.62, 0) },
      ]);
    }
    case 'juniper': {
      const trunk = new CylinderGeometry(0.04, 0.07, 0.3, 5);
      trunk.translate(0, 0.15, 0);
      const crown = lumpy(new IcosahedronGeometry(0.42, 1), 11, 0.5);
      crown.scale(1.1, 0.75, 1.0);
      crown.translate(0, 0.55, 0);
      return mergeParts([
        { geo: trunk, color: () => bark },
        { geo: crown, color: shade(leaf, 0.4, 0.25, 0.9), smooth: new Vector3(0, 0.5, 0) },
      ]);
    }
    case 'shrub': {
      const crown = lumpy(new IcosahedronGeometry(0.5, 0), 13, 0.5);
      crown.scale(1.2, 0.8, 1.2);
      crown.translate(0, 0.35, 0);
      return mergeParts([{ geo: crown, color: shade(leaf, 0.45, 0.0, 0.8), smooth: new Vector3(0, 0.2, 0) }]);
    }
  }
}

interface SpeciesData {
  geometry: InstancedBufferGeometry;
  base: BufferGeometry;
  material: MeshLambertMaterial;
  mesh: Mesh;
  /** All trees grouped by cell: x, y, z, packed(scale, rank). */
  data: Float32Array;
  cellStart: Uint32Array;
  cellCount: Uint32Array;
  attr: InstancedBufferAttribute;
  range: { start: number; count: number };
  max: number;
}

export interface VegetationOptions {
  def: VegetationDef;
  grid: HeightGrid;
  mask: Uint8Array;
  heightAt: (x: number, z: number) => number;
  density: number;
  radius: number;
  seed: number;
  /** Circles where nothing may grow (x, z, r). */
  clearings: readonly [number, number, number][];
  /** Rotated rectangles kept clear (airfield grounds). */
  exclusions: readonly FlatRect[];
  waterLevel: number;
}

const VEG_VERTEX_PARS = /* glsl */ `
attribute vec4 aTree;
uniform vec2 uTreeFade;
`;

const VEG_VERTEX_HEAD = /* glsl */ `
float tScale = floor(aTree.w) * 0.01;
float tRank = fract(aTree.w);
float tHash = fract(sin(dot(aTree.xz, vec2(12.9898, 78.233))) * 43758.5453);
float tAng = tHash * 6.2831853;
mat2 tRot = mat2(cos(tAng), sin(tAng), -sin(tAng), cos(tAng));
float tMax = uTreeFade.x + (uTreeFade.y - uTreeFade.x) * pow(1.0 - tRank, 4.0);
float tGrow = 1.0 - smoothstep(tMax - 180.0, tMax, distance(cameraPosition.xz, aTree.xz));
`;

/** Instanced trees placed in believable clusters from the forest mask, streamed per frame from 512 m cells. */
export class Vegetation {
  readonly meshes: Mesh[] = [];
  private readonly species: SpeciesData[] = [];
  private readonly cellsPerSide: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly cellMinY: Float32Array;
  private readonly cellMaxY: Float32Array;
  private readonly ringOrder: Int32Array;
  private readonly frustum = new Frustum();
  private readonly pv = new Matrix4();
  private readonly fullDist: number;
  private readonly maxDist: number;
  readonly totalTrees: number;

  constructor(o: VegetationOptions) {
    const g = o.grid;
    const extent = g.size * g.cell;
    this.originX = g.originX;
    this.originZ = g.originZ;
    this.cellsPerSide = Math.ceil(extent / CELL);
    const nCells = this.cellsPerSide * this.cellsPerSide;
    this.cellMinY = new Float32Array(nCells).fill(1e9);
    this.cellMaxY = new Float32Array(nCells).fill(-1e9);
    this.maxDist = o.radius;
    this.fullDist = Math.min(900, o.radius * 0.2);

    const rng = new Rng(o.seed);
    const def = o.def;
    const kinds = def.species;
    const perTexel = (def.density * o.density * g.cell * g.cell) / 1e6;
    const scatterPerTexel = (def.scatter * o.density * g.cell * g.cell) / 1e6;
    // Temporary per-species lists.
    const lists: number[][] = kinds.map(() => []);
    const n = g.size;
    const totalW = kinds.reduce((s, k) => s + k.weight, 0);
    const clear = o.clearings;
    for (let iz = 1; iz < n - 1; iz++) {
      for (let ix = 1; ix < n - 1; ix++) {
        const k = iz * n + ix;
        const forest = o.mask[k * 4]! / 255;
        const lu = o.mask[k * 4 + 1]! / 255;
        const road = o.mask[k * 4 + 2]! / 255;
        const urban = o.mask[k * 4 + 3]! / 255;
        // Stands and clearings inside woods (no uniform carpets of trees).
        const stand = forest > 0.05 ? valueNoise((ix * g.cell) / 150, (iz * g.cell) / 150, o.seed + 7) : 0;
        let expected =
          forest > 0.05
            ? perTexel * Math.pow(forest, 1.3) * (0.15 + 1.1 * Math.max(0, Math.min(1, (stand - 0.22) * 2.2)))
            : 0;
        if (urban < 0.2 && road > 0.3) expected += scatterPerTexel * (0.3 + lu) * (1 - forest);
        if (expected <= 0) continue;
        let count = Math.floor(expected);
        if (rng.next() < expected - count) count++;
        for (let t = 0; t < count; t++) {
          const x = g.originX + (ix + rng.next() - 0.5) * g.cell;
          const z = g.originZ + (iz + rng.next() - 0.5) * g.cell;
          const y = o.heightAt(x, z);
          if (y < o.waterLevel + 1.2) continue;
          const sx = o.heightAt(x + 4, z) - o.heightAt(x - 4, z);
          const sz = o.heightAt(x, z + 4) - o.heightAt(x, z - 4);
          if (sx * sx + sz * sz > 64 * 0.8) continue;
          let blocked = false;
          for (let c = 0; c < clear.length; c++) {
            const cl = clear[c]!;
            const dx = x - cl[0];
            const dz = z - cl[1];
            if (dx * dx + dz * dz < cl[2] * cl[2]) {
              blocked = true;
              break;
            }
          }
          for (let e = 0; e < o.exclusions.length && !blocked; e++) {
            const r = o.exclusions[e]!;
            const dx = x - r.x;
            const dz = z - r.z;
            const hs = Math.sin(r.heading);
            const hc = -Math.cos(r.heading);
            if (Math.abs(dx * hs + dz * hc) < r.halfLength && Math.abs(-dx * hc + dz * hs) < r.halfWidth)
              blocked = true;
          }
          if (blocked) continue;
          // Species stands: low-frequency field biases the pick so stands cluster.
          const stand = valueNoise(x / 380, z / 380, o.seed);
          let pick = (rng.next() * 0.45 + stand * 0.55) * totalW;
          let si = 0;
          for (; si < kinds.length - 1; si++) {
            pick -= kinds[si]!.weight;
            if (pick <= 0) break;
          }
          const sp = kinds[si]!;
          const hgt = sp.height[0] + (sp.height[1] - sp.height[0]) * Math.pow(rng.next(), 0.8);
          const rank = rng.next() * 0.999;
          const cell = this.cellIndex(x, z);
          lists[si]!.push(cell, x, y - 0.3, z, Math.floor(hgt * 100) + rank);
          if (y < this.cellMinY[cell]!) this.cellMinY[cell] = y;
          if (y + hgt > this.cellMaxY[cell]!) this.cellMaxY[cell] = y + hgt;
        }
      }
    }

    // Visit order of neighbour cells by distance (for streaming nearest first).
    const reach = Math.ceil(o.radius / CELL) + 1;
    const offsets: [number, number, number][] = [];
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) offsets.push([dx, dz, dx * dx + dz * dz]);
    offsets.sort((a, b) => a[2] - b[2]);
    this.ringOrder = new Int32Array(offsets.length * 2);
    offsets.forEach((v, i) => {
      this.ringOrder[i * 2] = v[0];
      this.ringOrder[i * 2 + 1] = v[1];
    });

    let total = 0;
    kinds.forEach((sp, si) => {
      const list = lists[si]!;
      const count = list.length / 5;
      total += count;
      const cellCount = new Uint32Array(nCells);
      for (let i = 0; i < count; i++) {
        const c = list[i * 5]!;
        cellCount[c] = cellCount[c]! + 1;
      }
      const cellStart = new Uint32Array(nCells);
      let acc = 0;
      for (let c = 0; c < nCells; c++) {
        cellStart[c] = acc;
        acc += cellCount[c]!;
      }
      const fill = new Uint32Array(nCells);
      const data = new Float32Array(Math.max(count, 1) * 4);
      for (let i = 0; i < count; i++) {
        const c = list[i * 5]!;
        const o4 = (cellStart[c]! + fill[c]!) * 4;
        fill[c] = fill[c]! + 1;
        data[o4] = list[i * 5 + 1]!;
        data[o4 + 1] = list[i * 5 + 2]!;
        data[o4 + 2] = list[i * 5 + 3]!;
        data[o4 + 3] = list[i * 5 + 4]!;
      }
      // Sort each cell by rank so any prefix is a uniform thinning of the cell.
      for (let c = 0; c < nCells; c++) sortCellByRank(data, cellStart[c]!, cellCount[c]!);

      const max = Math.min(Math.max(count, 1), 60000);
      const attr = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
      attr.setUsage(DynamicDrawUsage);
      const base = treeGeometry(sp.kind, sp.color);
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', base.getAttribute('position'));
      geometry.setAttribute('normal', base.getAttribute('normal'));
      geometry.setAttribute('color', base.getAttribute('color'));
      geometry.setAttribute('aTree', attr);
      geometry.instanceCount = 0;
      const fade = { value: new Float32Array([this.fullDist, this.maxDist]) };
      const material = patchAtmosphere(
        new MeshLambertMaterial({ vertexColors: true }),
        `atmo-trees-${sp.kind}`,
        (shader) => {
          shader.uniforms.uTreeFade = fade;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${VEG_VERTEX_PARS}`)
            .replace(
              '#include <color_vertex>',
              `#include <color_vertex>\n${VEG_VERTEX_HEAD}\nvColor.rgb *= 0.8 + 0.4 * fract(tHash * 13.7);`,
            )
            .replace(
              '#include <beginnormal_vertex>',
              'vec3 objectNormal = normal;\nobjectNormal.xz = tRot * objectNormal.xz;',
            )
            .replace(
              '#include <begin_vertex>',
              'vec3 transformed = position;\ntransformed.xz = tRot * transformed.xz * (0.85 + 0.3 * fract(tHash * 5.3));\ntransformed = transformed * tScale * tGrow + aTree.xyz;',
            );
        },
      );
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.name = `trees-${sp.kind}`;
      this.meshes.push(mesh);
      this.species.push({
        geometry,
        base,
        material,
        mesh,
        data,
        cellStart,
        cellCount,
        attr,
        range: { start: 0, count: 0 },
        max,
      });
    });
    this.totalTrees = total;
  }

  private cellIndex(x: number, z: number): number {
    const cx = Math.min(this.cellsPerSide - 1, Math.max(0, Math.floor((x - this.originX) / CELL)));
    const cz = Math.min(this.cellsPerSide - 1, Math.max(0, Math.floor((z - this.originZ) / CELL)));
    return cz * this.cellsPerSide + cx;
  }

  update(camera: PerspectiveCamera): void {
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const e = camera.matrixWorld.elements;
    const camX = e[12]!;
    const camZ = e[14]!;
    const ccx = Math.floor((camX - this.originX) / CELL);
    const ccz = Math.floor((camZ - this.originZ) / CELL);
    const side = this.cellsPerSide;
    const planes = this.frustum.planes;
    const fullD = this.fullDist;
    const maxD = this.maxDist;
    for (let s = 0; s < this.species.length; s++) {
      const sp = this.species[s]!;
      sp.geometry.instanceCount = 0;
    }
    let written0 = 0;
    const counts = this.writeCounts;
    for (let s = 0; s < this.species.length; s++) counts[s] = 0;
    for (let i = 0; i < this.ringOrder.length; i += 2) {
      const cx = ccx + this.ringOrder[i]!;
      const cz = ccz + this.ringOrder[i + 1]!;
      if (cx < 0 || cz < 0 || cx >= side || cz >= side) continue;
      const cell = cz * side + cx;
      const minY = this.cellMinY[cell]!;
      if (minY > 1e8) continue;
      const x0 = this.originX + cx * CELL;
      const z0 = this.originZ + cz * CELL;
      const dx = camX < x0 ? x0 - camX : camX > x0 + CELL ? camX - x0 - CELL : 0;
      const dz = camZ < z0 ? z0 - camZ : camZ > z0 + CELL ? camZ - z0 - CELL : 0;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > maxD) continue;
      // Sphere-frustum test with a margin (trees are streamed every frame).
      const maxY = this.cellMaxY[cell]!;
      const sx = x0 + CELL / 2;
      const sy = (minY + maxY) / 2;
      const sz = z0 + CELL / 2;
      const r = CELL * 0.75 + (maxY - minY) / 2;
      let inside = true;
      for (let p = 0; p < 6; p++) {
        const pl = planes[p]!;
        if (pl.normal.x * sx + pl.normal.y * sy + pl.normal.z * sz + pl.constant < -r) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      // Fraction of the cell's trees that can be visible at this distance (ranks are uniform and sorted).
      let frac = 1;
      if (d > fullD) frac = 1 - Math.pow((d - fullD) / (maxD - fullD), 0.25);
      for (let s = 0; s < this.species.length; s++) {
        const sp = this.species[s]!;
        const cnt = sp.cellCount[cell]!;
        if (cnt === 0) continue;
        let take = Math.min(cnt, Math.ceil(cnt * frac) + 1);
        const room = sp.max - counts[s]!;
        if (take > room) take = room;
        if (take <= 0) continue;
        const src = sp.data;
        const dst = sp.attr.array as Float32Array;
        let si = sp.cellStart[cell]! * 4;
        let di = counts[s]! * 4;
        const end = si + take * 4;
        while (si < end) dst[di++] = src[si++]!;
        counts[s] = counts[s]! + take;
      }
      written0++;
    }
    for (let s = 0; s < this.species.length; s++) {
      const sp = this.species[s]!;
      sp.geometry.instanceCount = counts[s]!;
      setUploadRange(sp.attr, sp.range, counts[s]!);
      sp.mesh.visible = counts[s]! > 0;
    }
    this.visibleCells = written0;
  }

  private readonly writeCounts = new Uint32Array(8);
  visibleCells = 0;

  get instanceCounts(): number {
    let t = 0;
    for (const sp of this.species) t += sp.geometry.instanceCount;
    return t;
  }

  dispose(): void {
    for (const sp of this.species) {
      sp.geometry.dispose();
      sp.base.dispose();
      sp.material.dispose();
    }
  }
}

function sortCellByRank(data: Float32Array, start: number, count: number): void {
  for (let i = 1; i < count; i++) {
    const o = (start + i) * 4;
    const x = data[o]!;
    const y = data[o + 1]!;
    const z = data[o + 2]!;
    const w = data[o + 3]!;
    const r = w - Math.floor(w);
    let j = i - 1;
    while (j >= 0) {
      const oj = (start + j) * 4;
      const wj = data[oj + 3]!;
      if (wj - Math.floor(wj) <= r) break;
      data[oj + 4] = data[oj]!;
      data[oj + 5] = data[oj + 1]!;
      data[oj + 6] = data[oj + 2]!;
      data[oj + 7] = wj;
      j--;
    }
    const oo = (start + j + 1) * 4;
    data[oo] = x;
    data[oo + 1] = y;
    data[oo + 2] = z;
    data[oo + 3] = w;
  }
}

/** Smooth value noise in [0, 1] (CPU), for species stands. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

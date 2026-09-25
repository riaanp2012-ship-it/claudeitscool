/**
 * GPU containers for the effects: instanced sprite batches (one draw call each), the shared ribbon geometry
 * and the debris chunk mesh. Dynamic attributes are updated in place through update ranges that cover only
 * the live data; range objects are preallocated and reused.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type ShaderMaterial,
} from 'three';
import { hash2 } from '../core/rng';

export interface UpdateRange {
  start: number;
  count: number;
}

/**
 * Marks [start, start + count) of an attribute for upload. If a range from an earlier update is still
 * pending (no render happened in between), it is extended instead of pushing another entry.
 */
export function markRange(attr: BufferAttribute, range: UpdateRange, start: number, count: number): void {
  if (count <= 0) return;
  const ranges = attr.updateRanges;
  if (ranges.includes(range)) {
    const end = Math.max(range.start + range.count, start + count);
    range.start = Math.min(range.start, start);
    range.count = end - range.start;
  } else {
    range.start = start;
    range.count = count;
    ranges.push(range);
  }
  attr.needsUpdate = true;
}

function quadGeometry(): { position: BufferAttribute; index: BufferAttribute } {
  const position = new BufferAttribute(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    3,
  );
  const index = new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
  return { position, index };
}

/** A batch of instanced quads (or chunks) whose per-instance data are vec4 attributes. */
export class InstanceBatch {
  readonly geometry = new InstancedBufferGeometry();
  readonly mesh: Mesh;
  readonly data: Float32Array[] = [];
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly ranges: UpdateRange[] = [];
  count = 0;

  constructor(
    readonly capacity: number,
    names: readonly string[],
    readonly material: ShaderMaterial,
    base?: BufferGeometry,
  ) {
    if (base) {
      for (const name of Object.keys(base.attributes)) {
        const a = base.getAttribute(name);
        if (a instanceof BufferAttribute) this.geometry.setAttribute(name, a);
      }
      if (base.index) this.geometry.setIndex(base.index);
    } else {
      const q = quadGeometry();
      this.geometry.setAttribute('position', q.position);
      this.geometry.setIndex(q.index);
    }
    for (const name of names) {
      const arr = new Float32Array(capacity * 4);
      const attr = new InstancedBufferAttribute(arr, 4);
      attr.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, attr);
      this.data.push(arr);
      this.attrs.push(attr);
      this.ranges.push({ start: 0, count: 0 });
    }
    this.geometry.instanceCount = 0;
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Publishes `count` instances: sets the instance count and uploads only the written range. */
  commit(): void {
    const n = Math.min(this.count, this.capacity);
    this.geometry.instanceCount = n;
    for (let i = 0; i < this.attrs.length; i++) markRange(this.attrs[i]!, this.ranges[i]!, 0, n * 4);
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * All ribbons share one set of buffers: `slots × points × 2` vertices with a dynamic index buffer rebuilt each
 * frame. Two BufferGeometry views share the attributes and index (uploaded once) so smoke ribbons and
 * additive ribbons are separate draw calls with their own render order.
 */
export class RibbonBuffers {
  readonly center: Float32Array;
  readonly side: Float32Array;
  readonly data: Float32Array;
  readonly index: Uint16Array;
  readonly alphaGeometry = new BufferGeometry();
  readonly addGeometry = new BufferGeometry();
  readonly alphaMesh: Mesh;
  readonly addMesh: Mesh;
  private readonly centerAttr: BufferAttribute;
  private readonly sideAttr: BufferAttribute;
  private readonly dataAttr: BufferAttribute;
  private readonly indexAttr: BufferAttribute;
  private readonly vertexAttrs: readonly BufferAttribute[];
  private readonly rangesA: UpdateRange[] = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  private readonly rangesB: UpdateRange[] = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  private readonly indexRange: UpdateRange = { start: 0, count: 0 };

  constructor(
    readonly slots: number,
    readonly points: number,
    alphaMaterial: ShaderMaterial,
    addMaterial: ShaderMaterial,
  ) {
    const verts = slots * points * 2;
    if (verts > 65535) throw new Error('RibbonBuffers: too many vertices for 16-bit indices');
    this.center = new Float32Array(verts * 3);
    this.side = new Float32Array(verts * 3);
    this.data = new Float32Array(verts * 4);
    this.index = new Uint16Array(slots * (points - 1) * 6);
    this.centerAttr = new BufferAttribute(this.center, 3).setUsage(DynamicDrawUsage);
    this.sideAttr = new BufferAttribute(this.side, 3).setUsage(DynamicDrawUsage);
    this.dataAttr = new BufferAttribute(this.data, 4).setUsage(DynamicDrawUsage);
    this.indexAttr = new BufferAttribute(this.index, 1).setUsage(DynamicDrawUsage);
    this.vertexAttrs = [this.centerAttr, this.sideAttr, this.dataAttr];
    for (const g of [this.alphaGeometry, this.addGeometry]) {
      g.setAttribute('position', this.centerAttr);
      g.setAttribute('aSide', this.sideAttr);
      g.setAttribute('aData', this.dataAttr);
      g.setIndex(this.indexAttr);
      g.setDrawRange(0, 0);
    }
    this.alphaMesh = new Mesh(this.alphaGeometry, alphaMaterial);
    this.addMesh = new Mesh(this.addGeometry, addMaterial);
    for (const m of [this.alphaMesh, this.addMesh]) {
      m.frustumCulled = false;
      m.visible = false;
      m.matrixAutoUpdate = false;
    }
  }

  /**
   * Publishes this frame's ribbons. Vertex ranges are given in vertices for the smoke region
   * [aStart, aEnd) and the additive region [bStart, bEnd); indices [0, nA) are smoke, [nA, nA + nB) additive.
   */
  commit(aStart: number, aEnd: number, bStart: number, bEnd: number, nA: number, nB: number): void {
    for (let i = 0; i < 3; i++) {
      const a = this.vertexAttrs[i]!;
      markRange(a, this.rangesA[i]!, aStart * a.itemSize, (aEnd - aStart) * a.itemSize);
      markRange(a, this.rangesB[i]!, bStart * a.itemSize, (bEnd - bStart) * a.itemSize);
    }
    markRange(this.indexAttr, this.indexRange, 0, nA + nB);
    this.alphaGeometry.setDrawRange(0, nA);
    this.addGeometry.setDrawRange(nA, nB);
    this.alphaMesh.visible = nA > 0;
    this.addMesh.visible = nB > 0;
  }

  dispose(): void {
    this.alphaGeometry.dispose();
    this.addGeometry.dispose();
  }
}

/** Irregular low-poly shard: an icosahedron with consistently jittered vertices and flat normals. */
export function debrisChunkGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(0.5, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Same jitter for the same corner on every face that shares it (no cracks).
    const h = hash2(Math.round(x * 1000), Math.round(y * 1000) * 31 + Math.round(z * 1000), 7);
    const k = 0.65 + 0.7 * h;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';

/**
 * Paint modes understood by the livery shader (vertex attribute aInfo.x). Livery is the camouflaged skin;
 * the other modes are flat-coloured detail materials driven by the vertex tint.
 */
export const PAINT = {
  livery: 0,
  dark: 1,
  metal: 2,
  interior: 3,
  rubber: 4,
  store: 5,
  fabric: 6,
  gloss: 7,
  nozzle: 8,
  glassLod: 9,
} as const;

/** Damage parts (aInfo.y); index into the damage vector of the per-aircraft data bone. */
export const PART = { fuselage: 0, engine: 1, wingL: 2, wingR: 3, tail: 4 } as const;

/** Panel-line layout (aInfo.z). body: uv = (station m, arc m); wing: uv = (m from LE, span m), aux.x = chord. */
export const PANEL = { none: 0, body: 1, wing: 2, plain: 3 } as const;

const TRI_EPS = 1e-9;

/**
 * Accumulates an indexed triangle mesh with the attributes the art shaders need.
 * Everything is plain numbers so builders stay pure and testable in Node.
 */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly aux: number[] = [];
  readonly tint: number[] = [];
  readonly info: number[] = [];
  readonly skinI: number[] = [];
  readonly skinW: number[] = [];
  readonly idx: number[] = [];

  paint: number = PAINT.livery;
  part: number = PART.fuselage;
  panel: number = PANEL.body;
  ao = 1;
  tr = 1;
  tg = 1;
  tb = 1;
  bone = 1;
  bone2 = 1;
  weight2 = 0;
  auxX = 0;
  auxY = 0;
  /** Triangles dropped because they were degenerate. */
  dropped = 0;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  setTint(hex: number): this {
    this.tr = ((hex >> 16) & 255) / 255;
    this.tg = ((hex >> 8) & 255) / 255;
    this.tb = (hex & 255) / 255;
    return this;
  }

  style(paint: number, tint = 0xffffff, panel: number = PANEL.plain): this {
    this.paint = paint;
    this.panel = panel;
    return this.setTint(tint);
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / l, ny / l, nz / l);
    this.uv.push(u, v);
    this.aux.push(this.auxX, this.auxY);
    this.tint.push(this.tr, this.tg, this.tb);
    this.info.push(this.paint, this.part, this.panel, this.ao);
    if (this.weight2 > 0) {
      this.skinI.push(this.bone, this.bone2, 0, 0);
      this.skinW.push(1 - this.weight2, this.weight2, 0, 0);
    } else {
      this.skinI.push(this.bone, 0, 0, 0);
      this.skinW.push(1, 0, 0, 0);
    }
    return this.vertexCount - 1;
  }

  /** Adds a triangle unless it is degenerate (zero area). Winding is counter-clockwise from the front. */
  tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const ax = p[a * 3]!,
      ay = p[a * 3 + 1]!,
      az = p[a * 3 + 2]!;
    const ux = p[b * 3]! - ax,
      uy = p[b * 3 + 1]! - ay,
      uz = p[b * 3 + 2]! - az;
    const vx = p[c * 3]! - ax,
      vy = p[c * 3 + 1]! - ay,
      vz = p[c * 3 + 2]! - az;
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < TRI_EPS * TRI_EPS) {
      this.dropped++;
      return;
    }
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Overrides ao for vertices [from, end). */
  setAo(from: number, ao: number): void {
    for (let i = from; i < this.vertexCount; i++) this.info[i * 4 + 3] = ao;
  }

  /**
   * Mirrors vertices [v0, end) and triangles [i0, end) across the YZ plane (x -> -x), reversing winding.
   * `boneMap` maps right-side bones to left-side bones; `partMap` maps part ids.
   */
  mirror(v0: number, i0: number, boneMap: (b: number) => number, partMap: (p: number) => number): void {
    const vEnd = this.vertexCount;
    const iEnd = this.idx.length;
    const offset = vEnd - v0;
    for (let v = v0; v < vEnd; v++) {
      this.pos.push(-this.pos[v * 3]!, this.pos[v * 3 + 1]!, this.pos[v * 3 + 2]!);
      this.nrm.push(-this.nrm[v * 3]!, this.nrm[v * 3 + 1]!, this.nrm[v * 3 + 2]!);
      this.uv.push(this.uv[v * 2]!, this.uv[v * 2 + 1]!);
      this.aux.push(this.aux[v * 2]!, this.aux[v * 2 + 1]!);
      this.tint.push(this.tint[v * 3]!, this.tint[v * 3 + 1]!, this.tint[v * 3 + 2]!);
      this.info.push(
        this.info[v * 4]!,
        partMap(this.info[v * 4 + 1]!),
        this.info[v * 4 + 2]!,
        this.info[v * 4 + 3]!,
      );
      const w1 = this.skinW[v * 4 + 1]!;
      this.skinI.push(boneMap(this.skinI[v * 4]!), w1 > 0 ? boneMap(this.skinI[v * 4 + 1]!) : 0, 0, 0);
      this.skinW.push(this.skinW[v * 4]!, w1, 0, 0);
    }
    for (let i = i0; i < iEnd; i += 3) {
      this.idx.push(this.idx[i]! + offset, this.idx[i + 2]! + offset, this.idx[i + 1]! + offset);
    }
  }

  /** Appends another builder's contents. */
  append(o: MeshBuilder): void {
    const base = this.vertexCount;
    this.pos.push(...o.pos);
    this.nrm.push(...o.nrm);
    this.uv.push(...o.uv);
    this.aux.push(...o.aux);
    this.tint.push(...o.tint);
    this.info.push(...o.info);
    this.skinI.push(...o.skinI);
    this.skinW.push(...o.skinW);
    for (const i of o.idx) this.idx.push(i + base);
  }

  /** Translates vertices [from, end). */
  translate(from: number, dx: number, dy: number, dz: number): void {
    for (let v = from; v < this.vertexCount; v++) {
      this.pos[v * 3] = this.pos[v * 3]! + dx;
      this.pos[v * 3 + 1] = this.pos[v * 3 + 1]! + dy;
      this.pos[v * 3 + 2] = this.pos[v * 3 + 2]! + dz;
    }
  }

  /**
   * Applies a rotation (row-major 3x3) about `pivot`, then a translation, to vertices [from, end).
   * Normals are rotated too.
   */
  transform(
    from: number,
    m: readonly number[],
    pivot: readonly [number, number, number],
    t: readonly [number, number, number] = [0, 0, 0],
  ): void {
    for (let v = from; v < this.vertexCount; v++) {
      const x = this.pos[v * 3]! - pivot[0];
      const y = this.pos[v * 3 + 1]! - pivot[1];
      const z = this.pos[v * 3 + 2]! - pivot[2];
      this.pos[v * 3] = m[0]! * x + m[1]! * y + m[2]! * z + pivot[0] + t[0];
      this.pos[v * 3 + 1] = m[3]! * x + m[4]! * y + m[5]! * z + pivot[1] + t[1];
      this.pos[v * 3 + 2] = m[6]! * x + m[7]! * y + m[8]! * z + pivot[2] + t[2];
      const nx = this.nrm[v * 3]!;
      const ny = this.nrm[v * 3 + 1]!;
      const nz = this.nrm[v * 3 + 2]!;
      this.nrm[v * 3] = m[0]! * nx + m[1]! * ny + m[2]! * nz;
      this.nrm[v * 3 + 1] = m[3]! * nx + m[4]! * ny + m[5]! * nz;
      this.nrm[v * 3 + 2] = m[6]! * nx + m[7]! * ny + m[8]! * nz;
    }
  }

  /** Retargets skin bone `from` to `to` for vertices [v0, end). */
  rebone(v0: number, map: (b: number) => number): void {
    for (let v = v0; v < this.vertexCount; v++) {
      this.skinI[v * 4] = map(this.skinI[v * 4]!);
      if (this.skinW[v * 4 + 1]! > 0) this.skinI[v * 4 + 1] = map(this.skinI[v * 4 + 1]!);
    }
  }

  toGeometry(options: { skin?: boolean; glass?: boolean } = {}): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    if (options.glass) {
      g.setAttribute('color', new Float32BufferAttribute(this.tint, 3));
    } else {
      g.setAttribute('aAux', new Float32BufferAttribute(this.aux, 2));
      g.setAttribute('aTint', new Float32BufferAttribute(this.tint, 3));
      g.setAttribute('aInfo', new Float32BufferAttribute(this.info, 4));
    }
    if (options.skin !== false) {
      g.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinI, 4));
      g.setAttribute('skinWeight', new Float32BufferAttribute(this.skinW, 4));
    }
    const big = this.vertexCount > 65535;
    g.setIndex(big ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export interface GridOptions {
  /** Columns wrap around (closed loop). */
  wrap?: boolean;
  /** Column indices where normals are split (hard edges). */
  creases?: readonly number[];
  /** Row indices where normals are split. */
  rowCreases?: readonly number[];
  /** Reverse winding (normals point the other way). */
  flip?: boolean;
  /** Writes the panel uv for grid point (i, j). */
  uvAt?: (i: number, j: number, out: number[]) => void;
  /** ao per vertex. */
  aoAt?: (i: number, j: number) => number;
  /** Secondary bone weight per vertex (bone2 must be set on the builder). */
  weightAt?: (i: number, j: number) => number;
  /** Writes the aux attribute (for example the local chord of a wing panel). */
  auxAt?: (i: number, j: number, out: number[]) => void;
}

const auxTmp = [0, 0];

const uvTmp = [0, 0];

/**
 * Builds a surface from a grid of points P[(i * nJ + j) * 3] with smooth area-weighted normals.
 * Rows i run along the first parameter, columns j along the second; the face normal is (dP/di x dP/dj),
 * so callers orient their parameterisation to point it outward (or pass flip).
 */
export function gridSurface(
  b: MeshBuilder,
  P: ArrayLike<number>,
  nI: number,
  nJ: number,
  o: GridOptions = {},
): void {
  const wrap = o.wrap === true;
  const colCrease = new Uint8Array(nJ);
  for (const c of o.creases ?? []) if (c >= 0 && c < nJ) colCrease[c] = 1;
  const rowCrease = new Uint8Array(nI);
  for (const r of o.rowCreases ?? []) if (r > 0 && r < nI - 1) rowCrease[r] = 1;
  // Vertex ids: each grid point has up to 4 copies (left/right of a column crease x below/above a row crease).
  const ids = new Int32Array(nI * nJ * 4);
  const start = b.vertexCount;
  const savedAo = b.ao;
  const savedW = b.weight2;
  const savedAuxX = b.auxX;
  const savedAuxY = b.auxY;
  for (let i = 0; i < nI; i++) {
    for (let j = 0; j < nJ; j++) {
      const k = i * nJ + j;
      const x = P[k * 3]!,
        y = P[k * 3 + 1]!,
        z = P[k * 3 + 2]!;
      if (o.uvAt) o.uvAt(i, j, uvTmp);
      else {
        uvTmp[0] = 0;
        uvTmp[1] = 0;
      }
      if (o.aoAt) b.ao = o.aoAt(i, j);
      if (o.weightAt) b.weight2 = o.weightAt(i, j);
      if (o.auxAt) {
        o.auxAt(i, j, auxTmp);
        b.auxX = auxTmp[0]!;
        b.auxY = auxTmp[1]!;
      }
      const cc = colCrease[j]! === 1;
      const rc = rowCrease[i]! === 1;
      for (let s = 0; s < 4; s++) {
        const colSide = s & 1;
        const rowSide = s >> 1;
        if ((colSide === 1 && !cc) || (rowSide === 1 && !rc)) {
          ids[k * 4 + s] = ids[k * 4 + (cc ? colSide : 0) + (rc ? rowSide * 2 : 0)]!;
          continue;
        }
        ids[k * 4 + s] = b.vertex(x, y, z, 0, 0, 0, uvTmp[0], uvTmp[1]);
      }
    }
  }
  b.ao = savedAo;
  b.weight2 = savedW;
  b.auxX = savedAuxX;
  b.auxY = savedAuxY;
  const nV = b.vertexCount - start;
  const acc = new Float64Array(nV * 3);
  const quadsJ = wrap ? nJ : nJ - 1;
  const pos = b.pos;
  const addFace = (a: number, c: number, d: number) => {
    const ax = pos[a * 3]!,
      ay = pos[a * 3 + 1]!,
      az = pos[a * 3 + 2]!;
    const ux = pos[c * 3]! - ax,
      uy = pos[c * 3 + 1]! - ay,
      uz = pos[c * 3 + 2]! - az;
    const vx = pos[d * 3]! - ax,
      vy = pos[d * 3 + 1]! - ay,
      vz = pos[d * 3 + 2]! - az;
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    if (o.flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const v of [a, c, d]) {
      const r = (v - start) * 3;
      acc[r] = acc[r]! + nx;
      acc[r + 1] = acc[r + 1]! + ny;
      acc[r + 2] = acc[r + 2]! + nz;
    }
    if (o.flip) b.tri(a, d, c);
    else b.tri(a, c, d);
  };
  for (let i = 0; i < nI - 1; i++) {
    for (let q = 0; q < quadsJ; q++) {
      const j0 = q;
      const j1 = (q + 1) % nJ;
      // Copy selection: the quad lies right of column j0 (side 1) and left of column j1 (side 0);
      // above row i (side 1) and below row i+1 (side 0).
      const p00 = ids[(i * nJ + j0) * 4 + 1 + 2]!;
      const p01 = ids[(i * nJ + j1) * 4 + 0 + 2]!;
      const p10 = ids[((i + 1) * nJ + j0) * 4 + 1]!;
      const p11 = ids[((i + 1) * nJ + j1) * 4]!;
      addFace(p00, p10, p01);
      addFace(p01, p10, p11);
    }
  }
  for (let v = 0; v < nV; v++) {
    let nx = acc[v * 3]!,
      ny = acc[v * 3 + 1]!,
      nz = acc[v * 3 + 2]!;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-12) {
      nx /= l;
      ny /= l;
      nz /= l;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    const r = (start + v) * 3;
    b.nrm[r] = nx;
    b.nrm[r + 1] = ny;
    b.nrm[r + 2] = nz;
  }
}

/**
 * Closes a ring of existing vertex positions with a fan to an apex. The cap gets its own vertices with
 * normals from the given direction blended toward the fan geometry, so the cap edge reads as a hard edge.
 */
export function fanCap(
  b: MeshBuilder,
  ring: ArrayLike<number>,
  n: number,
  apex: readonly [number, number, number],
  normal: readonly [number, number, number],
  flip = false,
): void {
  const c = b.vertex(apex[0], apex[1], apex[2], normal[0], normal[1], normal[2]);
  const first = b.vertexCount;
  for (let j = 0; j < n; j++)
    b.vertex(ring[j * 3]!, ring[j * 3 + 1]!, ring[j * 3 + 2]!, normal[0], normal[1], normal[2]);
  for (let j = 0; j < n; j++) {
    const a = first + j;
    const d = first + ((j + 1) % n);
    if (flip) b.tri(c, d, a);
    else b.tri(c, a, d);
  }
}

/** Row-major rotation matrix about a unit axis. */
export function rotation(axis: readonly [number, number, number], angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

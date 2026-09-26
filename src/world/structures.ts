import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { patchAtmosphere } from '../render/atmosphere';

interface Batch {
  pos: number[];
  nrm: number[];
  col: number[];
  cx: number;
  cz: number;
  n: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();
const Y = new Vector3(0, 1, 0);

/**
 * Accumulates static structure geometry into merged meshes, one per region (one draw call each), with
 * vertex colors. Headings rotate clockwise from north like everything else in the world.
 */
export class StructureBuilder {
  private readonly batches = new Map<string, Batch>();
  /** Circles (x, z, r) kept free of trees around structures. */
  readonly clearings: [number, number, number][] = [];
  private region = 'misc';
  private readonly tmpColor = new Color();

  constructor(readonly heightAt: (x: number, z: number) => number) {}

  setRegion(name: string): void {
    this.region = name;
  }

  private batch(): Batch {
    let b = this.batches.get(this.region);
    if (!b) {
      b = { pos: [], nrm: [], col: [], cx: 0, cz: 0, n: 0 };
      this.batches.set(this.region, b);
    }
    return b;
  }

  /** Lowest terrain height under a rotated rectangle footprint (corners + center). */
  groundMin(x: number, z: number, w: number, d: number, heading: number): number {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    let lo = this.heightAt(x, z);
    for (const [u, v] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
    ] as const) {
      // Local x (width) points east at heading 0, local z (depth) points south.
      const wx = x + u * c - v * s;
      const wz = z + u * s + v * c;
      lo = Math.min(lo, this.heightAt(wx, wz));
    }
    return lo;
  }

  groundMax(x: number, z: number, w: number, d: number, heading: number): number {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    let hi = this.heightAt(x, z);
    for (const [u, v] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
    ] as const) {
      const wx = x + u * c - v * s;
      const wz = z + u * s + v * c;
      hi = Math.max(hi, this.heightAt(wx, wz));
    }
    return hi;
  }

  /** Adds a geometry transformed by position / heading / scale with a flat color. Disposes the geometry. */
  add(
    geo: BufferGeometry,
    x: number,
    y: number,
    z: number,
    heading: number,
    color: Color | number,
    sx = 1,
    sy = 1,
    sz = 1,
    tilt = 0,
  ): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _q.setFromAxisAngle(Y, -heading);
    if (tilt !== 0) {
      const t = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt);
      _q.multiply(t);
    }
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _nm.getNormalMatrix(_m);
    const pos = g.getAttribute('position') as BufferAttribute;
    const nrm = g.getAttribute('normal') as BufferAttribute | undefined;
    const col = typeof color === 'number' ? this.tmpColor.setHex(color) : color;
    const b = this.batch();
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
      b.pos.push(_v.x, _v.y, _v.z);
      if (nrm) _n.fromBufferAttribute(nrm, i).applyMatrix3(_nm).normalize();
      else _n.set(0, 1, 0);
      b.nrm.push(_n.x, _n.y, _n.z);
      b.col.push(col.r, col.g, col.b);
      b.cx += _v.x;
      b.cz += _v.z;
      b.n++;
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }

  /** Box resting on y (bottom face at y). */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    heading: number,
    color: Color | number,
  ): void {
    const g = new BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    this.add(g, x, y, z, heading, color);
  }

  /** Box whose base follows the terrain: sunk to the lowest footprint point, height measured from the highest. */
  building(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    heading: number,
    color: Color | number,
  ): number {
    this.clearings.push([x, z, Math.hypot(w, d) * 0.5 + 6]);
    const lo = this.groundMin(x, z, w, d, heading) - 1.5;
    const hi = this.groundMax(x, z, w, d, heading);
    this.box(x, lo, z, w, hi - lo + h, d, heading, color);
    return hi + h;
  }

  /** Gable roof prism: ridge along the depth axis (local z). */
  gable(
    x: number,
    y: number,
    z: number,
    w: number,
    rise: number,
    d: number,
    heading: number,
    color: Color | number,
  ): void {
    const hw = w / 2;
    const hd = d / 2;
    // Counter-clockwise seen from outside (outward normals).
    const v = [
      // west slope
      -hw,
      0,
      -hd,
      0,
      rise,
      hd,
      0,
      rise,
      -hd,
      -hw,
      0,
      -hd,
      -hw,
      0,
      hd,
      0,
      rise,
      hd,
      // east slope
      hw,
      0,
      -hd,
      0,
      rise,
      hd,
      hw,
      0,
      hd,
      hw,
      0,
      -hd,
      0,
      rise,
      -hd,
      0,
      rise,
      hd,
      // gable ends
      -hw,
      0,
      hd,
      hw,
      0,
      hd,
      0,
      rise,
      hd,
      hw,
      0,
      -hd,
      -hw,
      0,
      -hd,
      0,
      rise,
      -hd,
    ];
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    this.add(g, x, y, z, heading, color);
  }

  /** House: walls following the ground plus a gable roof. */
  house(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    heading: number,
    wall: Color | number,
    roof: Color | number,
    rise = 0.45,
  ): void {
    const top = this.building(x, z, w, h, d, heading, wall);
    this.gable(x, top, z, w + 0.8, w * rise, d + 0.8, heading, roof);
  }

  cylinder(
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: Color | number,
    segs = 16,
    rTop = r,
  ): void {
    const g = new CylinderGeometry(rTop, r, h, segs, 1, false);
    g.translate(0, h / 2, 0);
    this.add(g, x, y, z, 0, color);
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: Color | number, segs = 12): void {
    const g = new ConeGeometry(r, h, segs, 1, true);
    g.translate(0, h / 2, 0);
    this.add(g, x, y, z, 0, color);
  }

  dome(x: number, y: number, z: number, r: number, color: Color | number, segs = 16, squash = 1): void {
    const g = new SphereGeometry(r, segs, Math.max(4, segs / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    this.add(g, x, y, z, 0, color, 1, squash, 1);
  }

  sphere(x: number, y: number, z: number, r: number, color: Color | number, segs = 16): void {
    this.add(new SphereGeometry(r, segs, Math.max(4, segs / 2)), x, y, z, 0, color);
  }

  /** Arched (Quonset-style) hangar: half cylinder along local z, plus end walls. */
  archHangar(
    x: number,
    z: number,
    w: number,
    len: number,
    heading: number,
    shell: Color | number,
    ends: Color | number,
  ): void {
    const y = this.groundMin(x, z, w, len, heading) - 0.5;
    const g = new CylinderGeometry(w / 2, w / 2, len, 18, 1, true, -Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    this.add(g, x, y, z, heading, shell, 1, 0.62, 1);
    const cap = new CylinderGeometry(w / 2, w / 2, 0.6, 18, 1, false, -Math.PI / 2, Math.PI);
    cap.rotateX(Math.PI / 2);
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    for (const side of [-1, 1]) {
      const off = side * (len / 2 - 0.3);
      this.add(cap.clone(), x - off * s, y, z + off * c, heading, ends, 1, 0.62, 1);
    }
    cap.dispose();
  }

  /** Parabolic dish on a pedestal, tilted up by `elevation` and facing `heading`. */
  dish(
    x: number,
    z: number,
    r: number,
    heading: number,
    elevation: number,
    color: Color | number,
    pedestal: Color | number,
  ): void {
    const y = this.heightAt(x, z);
    this.cylinder(x, y - 1, z, r * 0.12, r * 0.9 + 1, pedestal, 10, r * 0.08);
    const pts: Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new Vector2(r * t, r * 0.35 * t * t));
    }
    const g = new LatheGeometry(pts, 20);
    // Lathe axis is +y; tilt so the dish faces the horizon at `elevation`.
    this.add(g, x, y + r * 0.9, z, heading, color, 1, 1, 1, -(Math.PI / 2 - elevation));
    this.add(
      new LatheGeometry(pts.map((p) => new Vector2(p.x, p.y - 0.15)).reverse(), 20),
      x,
      y + r * 0.9,
      z,
      heading,
      pedestal,
      1,
      1,
      1,
      -(Math.PI / 2 - elevation),
    );
  }

  /** Builds one mesh per region with a shared material. */
  finish(): { meshes: Mesh[]; material: Material; geometries: BufferGeometry[] } {
    const material = patchAtmosphere(
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 }),
      'atmo-structures',
    );
    const meshes: Mesh[] = [];
    const geometries: BufferGeometry[] = [];
    for (const [name, b] of this.batches) {
      if (b.n === 0) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('color', new Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new Mesh(g, material);
      mesh.name = `structures-${name}`;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
      geometries.push(g);
    }
    return { meshes, material, geometries };
  }
}

/** Linear color from sRGB hex, for authoring palettes by eye. */
export function srgb(hex: number): Color {
  return new Color().setHex(hex);
}

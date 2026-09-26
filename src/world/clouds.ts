import {
  CustomBlending,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  UnsignedByteType,
  Vector4,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { Rng } from '../core/rng';
import { ATMOSPHERE_GLSL, atmoUniforms } from '../render/atmosphere';
import { TERRAIN_SAMPLE_GLSL } from './glsl/terrainSample';
import type { CloudDef } from './maps/types';

const CLOUD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_SAMPLE_GLSL}
attribute vec4 aPuff;
attribute vec4 aPuff2;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vData;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
varying float vCamDist;
varying float vRadius;
void main() {
  vec3 center = aPuff.xyz;
  float drop = horizonDrop(center.xz - cameraPosition.xz);
  center.y -= drop;
  vec3 toCam = cameraPosition - center;
  float d = length(toCam);
  // Fully faded (camera inside or next to the puff): collapse the card so it costs no fill.
  if (d < aPuff.w * 0.45) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 fwd = toCam / max(d, 1e-3);
  vec3 r = cross(vec3(0.0, 1.0, 0.0), fwd);
  float rl = length(r);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  r = normalize(r + camRight * (1.0 - smoothstep(0.0, 0.35, rl)) * 0.5);
  vec3 u = cross(fwd, r);
  float c = cos(aPuff2.w);
  float s = sin(aPuff2.w);
  vec2 q = mat2(c, s, -s, c) * position.xy;
  // Pull the card toward the camera so the sprite covers the sphere's silhouette.
  vec3 wp = center + (r * q.x + u * q.y) * aPuff.w + fwd * aPuff.w * 0.35;
  vUv = position.xy * 0.5 + 0.5;
  vWorld = wp;
  vData = vec4(aPuff2.xy, aPuff2.z - drop, 0.0);
  vRight = r * c + u * s;
  vUp = u * c - r * s;
  vFwd = fwd;
  vCamDist = d;
  vRadius = aPuff.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
${TERRAIN_SAMPLE_GLSL}
uniform sampler2D uPuffs;
uniform float uWaterLevel;
uniform float uBrightness;
uniform float uDarkBase;
uniform vec2 uFarFade;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vData;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
varying float vCamDist;
varying float vRadius;

void main() {
  #include <logdepthbuf_fragment>
  // Atlas cell picked per puff from its exposure seed.
  float cell = floor(fract(vData.x * 7.31 + vData.y * 3.17) * 3.999);
  vec2 uv = (vUv + vec2(mod(cell, 2.0), floor(cell / 2.0))) * 0.5;
  vec4 t = texture2D(uPuffs, uv);
  float a = t.a;
  if (a < 0.004) discard;
  vec2 nxy = t.rg * 2.0 - 1.0;
  vec3 n = normalize(vRight * nxy.x + vUp * nxy.y + vFwd * sqrt(max(1.0 - dot(nxy, nxy), 0.0)));

  float exposure = vData.x;
  float hfrac = vData.y;
  // Flat cloud base.
  a *= smoothstep(vData.z - 25.0, vData.z + 35.0, vWorld.y);
  // Fade where the card nears the ground or water, so it never cuts a hard line (ZD-B08).
  float ground = max(terrainHeight(vWorld.xz), uWaterLevel);
  a *= smoothstep(0.0, 120.0, vWorld.y - ground);
  // Fade out as the camera approaches, so the card is never seen flat (ZD-B09).
  a *= smoothstep(vRadius * 0.45, vRadius * 1.25, vCamDist);
  if (a < 0.004) discard;

  vec3 V = vFwd;
  float ndl = dot(n, uSunDir);
  float diffuse = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  // Flat grey bases: light falls off toward the cluster base.
  float lift = smoothstep(vData.z, vData.z + 300.0, vWorld.y);
  float direct = diffuse * mix(0.3, 1.0, exposure) * mix(0.45, 1.0, lift);
  // Forward scattering through thin edges when looking toward the sun (silver lining).
  float mu = dot(-V, uSunDir);
  float thin = 1.0 - t.b;
  float forward = pow(max(mu, 0.0), 6.0) * thin * 1.6;
  vec3 ambient = mix(uAmbientGround * 1.6 + uAmbientSky * 0.35, uAmbientSky * 1.25, mix(uDarkBase, 1.0, hfrac));
  ambient *= mix(uDarkBase + 0.2, 1.0, lift);
  vec3 col = uBrightness * (uSunColor * (direct * 1.45 + forward) + ambient * (0.7 + 0.3 * t.b)) * RECIPROCAL_PI * 0.92;

  vec3 ray = vWorld - cameraPosition;
  col = atmoApply(col, ray);
  a *= 1.0 - smoothstep(uFarFade.x, uFarFade.y, length(ray));
  if (any(isnan(col)) || any(isinf(col)) || isnan(a)) discard;
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  exposure: number;
  hfrac: number;
  base: number;
  rot: number;
}

interface Cluster {
  x: number;
  z: number;
  base: number;
  top: number;
  radius: number;
  first: number;
  count: number;
}

export interface CloudOptions {
  def: CloudDef;
  seed: number;
  sunDir: Vector3;
  sampleUniforms: Record<string, IUniform>;
  puffTexture: Texture;
  waterLevel: number;
  heightAt: (x: number, z: number) => number;
  scale: number;
}

const GRID_CELL = 4000;

/** Cumulus impostors: soft camera-facing puffs in clusters, one draw call, sorted back to front. */
export class Clouds {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly puffs: Puff[] = [];
  private readonly clusters: Cluster[] = [];
  private readonly attrA: InstancedBufferAttribute;
  private readonly attrB: InstancedBufferAttribute;
  private readonly order: Uint32Array;
  private readonly keys: Float32Array;
  private readonly lastCam = new Vector3(1e9, 0, 0);
  private frame = 0;
  /** Number of puffs drawn. */
  get puffCount(): number {
    return this.puffs.length;
  }
  private readonly fade = new Vector2(1e5, 1.5e5);
  /** Spatial hash: cell -> cluster indices. */
  private readonly grid = new Map<number, number[]>();

  constructor(o: CloudOptions) {
    const rng = new Rng(o.seed);
    const def = o.def;
    for (let c = 0; c < def.count; c++) {
      let x = 0;
      let z = 0;
      let base = 0;
      let ok = false;
      for (let tries = 0; tries < 20 && !ok; tries++) {
        x = rng.range(-def.spread, def.spread);
        z = rng.range(-def.spread, def.spread);
        base = rng.range(def.base[0], def.base[1]);
        ok = o.heightAt(x, z) < base - 250;
      }
      if (!ok) continue;
      const radius = rng.range(def.radius[0], def.radius[1]);
      const height = rng.range(def.height[0], def.height[1]);
      this.addCluster(rng, x, z, base, radius, height, o.sunDir, o.scale);
    }
    const n = this.puffs.length;
    this.order = new Uint32Array(n);
    this.keys = new Float32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;

    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    this.attrA = new InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 4), 4);
    this.attrB = new InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 4), 4);
    this.attrA.setUsage(DynamicDrawUsage);
    this.attrB.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aPuff', this.attrA);
    this.geometry.setAttribute('aPuff2', this.attrB);
    this.geometry.instanceCount = n;
    this.material = new ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        ...o.sampleUniforms,
        ...atmoUniforms,
        uPuffs: { value: o.puffTexture },
        uWaterLevel: { value: o.waterLevel },
        uBrightness: { value: def.brightness },
        uDarkBase: { value: def.darkBase },
        uFarFade: { value: this.fade },
      },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.mesh.name = 'clouds';
    this.mesh.visible = n > 0;
    this.writeInstances();
  }

  private addCluster(
    rng: Rng,
    x: number,
    z: number,
    base: number,
    radius: number,
    height: number,
    sun: Vector3,
    scale: number,
  ): void {
    const first = this.puffs.length;
    const stretch = rng.range(0.7, 1.3);
    const angle = rng.range(0, Math.PI);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      const f = l / (layers - 1);
      // Dome profile: wide base, towers narrowing upward.
      const layerR = radius * (1 - 0.62 * f * f) * (l === 0 ? 1 : rng.range(0.8, 1.05));
      const count = Math.max(2, Math.round((l === 0 ? 11 : 9 - l * 2) * scale * (radius / 900)));
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * layerR * 0.75;
        let px = Math.cos(a) * d * stretch;
        let pz = Math.sin(a) * d;
        const rx = px * ca - pz * sa;
        pz = px * sa + pz * ca;
        px = rx;
        const pr = radius * rng.range(0.28, 0.42) * (1 - 0.35 * f);
        // Base puffs sit low so the flat cut at the base spans nearly their whole width.
        const py = base + pr * (l === 0 ? 0.2 : 0.55) + f * height * rng.range(0.85, 1.1);
        const ox = px / radius;
        const oy = (py - base - height * 0.35) / Math.max(height, 1);
        const oz = pz / radius;
        const ol = Math.hypot(ox, oy, oz) || 1;
        const exposure = Math.min(1, Math.max(0, ((ox * sun.x + oy * sun.y + oz * sun.z) / ol) * 0.5 + 0.55));
        this.puffs.push({
          x: x + px,
          y: py,
          z: z + pz,
          r: pr,
          exposure,
          hfrac: Math.min(1, (py - base) / Math.max(height, 1)),
          base,
          rot: rng.range(0, Math.PI * 2),
        });
      }
    }
    const idx = this.clusters.length;
    this.clusters.push({
      x,
      z,
      base,
      top: base + height + radius * 0.5,
      radius: radius * 1.3,
      first,
      count: this.puffs.length - first,
    });
    const r = radius * 1.3;
    for (let gx = Math.floor((x - r) / GRID_CELL); gx <= Math.floor((x + r) / GRID_CELL); gx++) {
      for (let gz = Math.floor((z - r) / GRID_CELL); gz <= Math.floor((z + r) / GRID_CELL); gz++) {
        const key = gx * 100003 + gz;
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(idx);
      }
    }
  }

  private writeInstances(): void {
    const a = this.attrA.array as Float32Array;
    const b = this.attrB.array as Float32Array;
    const n = this.puffs.length;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[this.order[i]!]!;
      const o = i * 4;
      a[o] = p.x;
      a[o + 1] = p.y;
      a[o + 2] = p.z;
      a[o + 3] = p.r;
      b[o] = p.exposure;
      b[o + 1] = p.hfrac;
      b[o + 2] = p.base;
      b[o + 3] = p.rot;
    }
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
  }

  /** Sorts back to front every few frames or when the camera moved (shell sort: fast on nearly sorted input). */
  update(camera: PerspectiveCamera): void {
    const e = camera.matrixWorld.elements;
    const cx = e[12]!;
    const cy = e[13]!;
    const cz = e[14]!;
    this.fade.set(camera.far * 0.55, camera.far * 0.9);
    this.frame++;
    const dx = cx - this.lastCam.x;
    const dy = cy - this.lastCam.y;
    const dz = cz - this.lastCam.z;
    if (dx * dx + dy * dy + dz * dz < 400 && (this.frame & 7) !== 0) return;
    this.lastCam.set(cx, cy, cz);
    const n = this.puffs.length;
    const keys = this.keys;
    const order = this.order;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[order[i]!]!;
      const px = p.x - cx;
      const py = p.y - cy;
      const pz = p.z - cz;
      keys[i] = -(px * px + py * py + pz * pz);
    }
    shellSort(keys, order, n);
    this.writeInstances();
  }

  /**
   * Bakes the cumulus field's ground shadow (seen along the sun direction from y = 0) into a small texture.
   * Clouds are static, so this runs once at load. Returns the uniforms consumed by CLOUD_SHADOW_GLSL.
   */
  bakeShadow(sun: Vector3, strength: number): { uniforms: Record<string, IUniform>; texture: DataTexture } {
    const size = 512;
    const extent = 84000;
    const origin = -extent / 2;
    const data = new Uint8Array(size * size).fill(255);
    const sy = Math.max(sun.y, 0.05);
    const kx = sun.x / sy;
    const kz = sun.z / sy;
    if (this.clusters.length > 0) {
      for (let j = 0; j < size; j++) {
        const z0 = origin + (j + 0.5) * (extent / size);
        for (let i = 0; i < size; i++) {
          const x0 = origin + (i + 0.5) * (extent / size);
          let optical = 0;
          for (let k = 0; k < 5; k++) {
            const y = 1300 + k * 280;
            optical += this.clusterDensity(x0 + kx * y, y, z0 + kz * y);
          }
          data[j * size + i] = Math.round(255 * Math.exp(-optical * 1.1));
        }
      }
    }
    const texture = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return {
      texture,
      uniforms: {
        uCloudShadow: { value: texture },
        uCloudBox: {
          value: new Vector4(origin, origin, 1 / extent, this.clusters.length > 0 ? strength : 0),
        },
      },
    };
  }

  /** Smooth cluster-level density (ellipsoids), cheap enough for the shadow bake. */
  private clusterDensity(x: number, y: number, z: number): number {
    const list = this.grid.get(Math.floor(x / GRID_CELL) * 100003 + Math.floor(z / GRID_CELL));
    if (!list) return 0;
    let best = 0;
    for (let li = 0; li < list.length; li++) {
      const c = this.clusters[list[li]!]!;
      const hy = (c.top - c.base) * 0.5;
      const cy = c.base + hy;
      const r = c.radius * 0.8;
      const qx = (x - c.x) / r;
      const qy = (y - cy) / hy;
      const qz = (z - c.z) / r;
      const q = qx * qx + qy * qy + qz * qz;
      if (q < 1) {
        const v = 1 - q;
        if (v > best) best = v;
      }
    }
    return best;
  }

  /** 0..1 density: 1 deep inside a puff. */
  densityAt(x: number, y: number, z: number): number {
    const list = this.grid.get(Math.floor(x / GRID_CELL) * 100003 + Math.floor(z / GRID_CELL));
    if (!list) return 0;
    let best = 0;
    for (let li = 0; li < list.length; li++) {
      const c = this.clusters[list[li]!]!;
      if (y < c.base - 30 || y > c.top) continue;
      const hx = x - c.x;
      const hz = z - c.z;
      if (hx * hx + hz * hz > c.radius * c.radius) continue;
      for (let i = c.first; i < c.first + c.count; i++) {
        const p = this.puffs[i]!;
        const px = x - p.x;
        const py = y - p.y;
        const pz = z - p.z;
        const d = Math.sqrt(px * px + py * py + pz * pz) / p.r;
        if (d < 1) {
          const v = d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
          if (v > best) best = v;
        }
      }
    }
    return y < 0 ? 0 : best;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const GAPS = [701, 301, 132, 57, 23, 10, 4, 1];

/** In-place shell sort of keys (ascending) carrying order along. Zero allocation. */
export function shellSort(keys: Float32Array, order: Uint32Array, n: number): void {
  for (let g = 0; g < GAPS.length; g++) {
    const gap = GAPS[g]!;
    if (gap >= n) continue;
    for (let i = gap; i < n; i++) {
      const k = keys[i]!;
      const v = order[i]!;
      let j = i;
      while (j >= gap && keys[j - gap]! > k) {
        keys[j] = keys[j - gap]!;
        order[j] = order[j - gap]!;
        j -= gap;
      }
      keys[j] = k;
      order[j] = v;
    }
  }
}

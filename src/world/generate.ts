import {
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  ClampToEdgeWrapping,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type IUniform,
  type ShaderMaterial,
  type WebGLRenderer,
  type Wrapping,
} from 'three';
import { GEN_TILE } from './constants';
import { rasterizeDistance } from './geom2d';
import { NOISE_GLSL } from './glsl/noise';
import { FullscreenPass, passMaterial, yieldToEventLoop } from './gpu';
import type { GridDomain, HeightGrid } from './heightfield';
import type { FlatRect, MapDef } from './maps/types';

export const MAX_FLATS = 16;

/** Shared generator GLSL: flattening rectangles for runways, aprons and pads. */
const GEN_COMMON_GLSL = /* glsl */ `
uniform int uFlatCount;
uniform vec4 uFlatA[${MAX_FLATS}];
uniform vec4 uFlatB[${MAX_FLATS}];

float flatWeight(vec2 p, int i) {
  vec4 a = uFlatA[i];
  vec4 b = uFlatB[i];
  vec2 r = p - a.xy;
  vec2 dir = a.zw;
  vec2 lp = vec2(dot(r, dir), dot(r, vec2(-dir.y, dir.x)));
  vec2 q = max(abs(lp) - b.xy, 0.0);
  return 1.0 - smoothstep(0.0, b.z, length(q));
}

// Blends h toward each flat's elevation; returns the combined weight in .y.
vec2 applyFlats(vec2 p, float h) {
  float wsum = 0.0;
  for (int i = 0; i < ${MAX_FLATS}; i++) {
    if (i >= uFlatCount) break;
    float w = flatWeight(p, i);
    if (w > 0.0) {
      h = mix(h, uFlatB[i].w, w);
      wsum = max(wsum, w);
    }
  }
  return vec2(h, wsum);
}
`;

function genFragment(map: MapDef): string {
  return /* glsl */ `
precision highp float;
precision highp int;
uniform vec2 uOrigin;
uniform float uCell;
uniform vec2 uTile;
${NOISE_GLSL}
${GEN_COMMON_GLSL}
${map.glsl}
void main() {
  vec2 idx = floor(gl_FragCoord.xy) + uTile;
  vec2 p = uOrigin + idx * uCell;
  gl_FragColor = mapSample(p);
}
`;
}

const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
uniform highp sampler2D uH;
uniform vec4 uDom;
uniform vec3 uSun;
uniform float uMirror;

float fetchH(vec2 g) {
  float n = uDom.w;
  if (uMirror > 0.5) {
    float p = 2.0 * (n - 1.0);
    g = g - p * floor(g / p);
    g = vec2(g.x > n - 1.0 ? p - g.x : g.x, g.y > n - 1.0 ? p - g.y : g.y);
  }
  g = clamp(g, vec2(0.0), vec2(n - 1.0));
  vec2 i = min(floor(g), vec2(n - 2.0));
  vec2 f = g - i;
  ivec2 a = ivec2(i);
  float h00 = texelFetch(uH, a, 0).r;
  float h10 = texelFetch(uH, a + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uH, a + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uH, a + ivec2(1, 1), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

void main() {
  vec2 g = floor(gl_FragCoord.xy);
  float cell = uDom.z;
  float h = fetchH(g);
  float hl = fetchH(g - vec2(1.0, 0.0));
  float hr = fetchH(g + vec2(1.0, 0.0));
  float hd = fetchH(g - vec2(0.0, 1.0));
  float hu = fetchH(g + vec2(0.0, 1.0));
  vec3 n = normalize(vec3(hl - hr, 2.0 * cell, hd - hu));

  // Sun visibility: march toward the sun, soft penumbra from the angular clearance.
  vec2 sdir = normalize(uSun.xz + vec2(1e-5));
  float tanE = uSun.y / max(length(uSun.xz), 1e-4);
  float h0 = h + 1.5;
  float vis = 1.0;
  float t = cell * 0.8;
  for (int i = 0; i < 56; i++) {
    vec2 q = g + sdir * (t / cell);
    float clear = (h0 + t * tanE - fetchH(q)) / t;
    vis = min(vis, smoothstep(-0.035, 0.035, clear));
    t = t * 1.065 + cell * 0.55;
  }
  vis = min(vis, smoothstep(-0.05, 0.15, dot(n, uSun)));

  // Horizon-based ambient occlusion over 8 directions.
  float occ = 0.0;
  for (int d = 0; d < 8; d++) {
    float a = float(d) * 0.7853982 + 0.39;
    vec2 dir = vec2(cos(a), sin(a));
    float maxS = 0.0;
    float r = cell;
    for (int s = 0; s < 7; s++) {
      float dh = fetchH(g + dir * (r / cell)) - h;
      maxS = max(maxS, dh / sqrt(dh * dh + r * r));
      r *= 2.0;
    }
    occ += maxS;
  }
  float ao = clamp(1.0 - occ / 8.0 * 1.1, 0.0, 1.0);

  gl_FragColor = vec4(n.x * 0.5 + 0.5, n.z * 0.5 + 0.5, vis, ao);
}
`;

export interface DomainData {
  grid: HeightGrid;
  /** Final masks (forest, landuse, road distance, urban), RGBA8 row-major. */
  mask: Uint8Array;
  heightTex: DataTexture;
  maskTex: DataTexture;
  bake: WebGLRenderTarget;
}

export interface GenerateResult {
  near: DomainData;
  far: DomainData;
}

export interface GenerateOptions {
  near: GridDomain;
  far: GridDomain;
  sunDir: Vector3;
  onProgress: (fraction: number, label: string) => void;
}

function flatUniforms(flats: readonly FlatRect[]): Record<string, IUniform> {
  const a: Vector4[] = [];
  const b: Vector4[] = [];
  for (let i = 0; i < MAX_FLATS; i++) {
    const f = flats[i];
    if (f) {
      a.push(new Vector4(f.x, f.z, Math.sin(f.heading), -Math.cos(f.heading)));
      b.push(new Vector4(f.halfLength, f.halfWidth, Math.max(f.falloff, 1), f.elevation));
    } else {
      a.push(new Vector4(0, 0, 1, 0));
      b.push(new Vector4(0, 0, 1, 0));
    }
  }
  return {
    uFlatCount: { value: Math.min(flats.length, MAX_FLATS) },
    uFlatA: { value: a },
    uFlatB: { value: b },
  };
}

/** Renders the map generator into a domain grid, tile by tile, and reads it back. */
async function renderDomain(
  renderer: WebGLRenderer,
  pass: FullscreenPass,
  material: ShaderMaterial,
  domain: GridDomain,
  progress: (done: number, total: number) => void,
): Promise<{ heights: Float32Array; potential: Uint8Array; landuse: Uint8Array }> {
  const n = domain.size;
  const tile = Math.min(GEN_TILE, n);
  const tiles = Math.ceil(n / tile);
  const rt = new WebGLRenderTarget(tile, tile, {
    type: FloatType,
    format: RGBAFormat,
    depthBuffer: false,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
  });
  const buf = new Float32Array(tile * tile * 4);
  const heights = new Float32Array(n * n);
  const potential = new Uint8Array(n * n);
  const landuse = new Uint8Array(n * n);
  material.uniforms.uOrigin!.value = new Vector2(domain.originX, domain.originZ);
  material.uniforms.uCell!.value = domain.cell;
  const tileUniform = material.uniforms.uTile!.value as Vector2;
  try {
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        tileUniform.set(tx * tile, ty * tile);
        pass.render(renderer, material, rt);
        await renderer.readRenderTargetPixelsAsync(rt, 0, 0, tile, tile, buf);
        for (let r = 0; r < tile; r++) {
          const iz = ty * tile + r;
          if (iz >= n) break;
          for (let c = 0; c < tile; c++) {
            const ix = tx * tile + c;
            if (ix >= n) break;
            const s = (r * tile + c) * 4;
            const k = iz * n + ix;
            heights[k] = buf[s]!;
            potential[k] = Math.max(0, Math.min(255, Math.round(buf[s + 1]! * 255)));
            landuse[k] = Math.max(0, Math.min(255, Math.round(buf[s + 2]! * 255)));
          }
        }
        progress(ty * tiles + tx + 1, tiles * tiles);
        await yieldToEventLoop();
      }
    }
  } finally {
    rt.dispose();
  }
  return { heights, potential, landuse };
}

const ROAD_REACH = 48;

/** Final masks from heights + generator potentials + authored roads and settlements (see ForestRule). */
async function buildMasks(
  map: MapDef,
  grid: HeightGrid,
  potential: Uint8Array,
  landuse: Uint8Array,
  withRoads: boolean,
): Promise<Uint8Array> {
  const n = grid.size;
  const c = grid.cell;
  const h = grid.data;
  const rule = map.forest;
  const out = new Uint8Array(n * n * 4);
  let roadDist: Float32Array | null = null;
  if (withRoads && map.roads.length > 0) {
    roadDist = new Float32Array(n * n).fill(1e9);
    rasterizeDistance(roadDist, n, grid.originX, grid.originZ, c, map.roads, ROAD_REACH + c);
  }
  const k = Math.max(1, Math.round(60 / c));
  const water = map.waterLevel;
  const urban = map.urban;
  const grounds = map.airbases.map((a) => a.grounds);
  for (let iz = 0; iz < n; iz++) {
    const z = grid.originZ + iz * c;
    const zm = iz > 0 ? iz - 1 : iz;
    const zp = iz < n - 1 ? iz + 1 : iz;
    const zk0 = iz >= k ? iz - k : 0;
    const zk1 = iz + k < n ? iz + k : n - 1;
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = grid.originX + ix * c;
      const xm = ix > 0 ? ix - 1 : ix;
      const xp = ix < n - 1 ? ix + 1 : ix;
      const xk0 = ix >= k ? ix - k : 0;
      const xk1 = ix + k < n ? ix + k : n - 1;
      const hc = h[i]!;
      const sx = (h[iz * n + xp]! - h[iz * n + xm]!) / ((xp - xm) * c || 1);
      const sz = (h[zp * n + ix]! - h[zm * n + ix]!) / ((zp - zm) * c || 1);
      const slope = 1 - 1 / Math.sqrt(1 + sx * sx + sz * sz);
      const mean = (h[iz * n + xk0]! + h[iz * n + xk1]! + h[zk0 * n + ix]! + h[zk1 * n + ix]!) * 0.25;
      let conc = (mean - hc) / 10;
      conc = conc < -1 ? -1 : conc > 1 ? 1 : conc;

      let f = potential[i]! / 255 + rule.valley * conc;
      const sl = (slope - 0.05) / 0.25;
      f += rule.slope * (sl < 0 ? 0 : sl > 1 ? 1 : sl);
      let fw = (f - rule.threshold) / rule.softness;
      fw = fw < 0 ? 0 : fw > 1 ? 1 : fw;
      if (slope > rule.maxSlope || hc > rule.maxHeight || hc < water + rule.minHeight) fw = 0;

      let lu = landuse[i]! / 255;
      if (hc < water + 0.5) lu = 0;

      let urb = 0;
      for (let u = 0; u < urban.length; u++) {
        const ud = urban[u]!;
        const dx = x - ud[0];
        const dz = z - ud[1];
        const r = ud[2];
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          const t = 1 - Math.sqrt(d2) / r;
          const w = t * 2.2 > 1 ? 1 : t * 2.2;
          if (w > urb) urb = w;
        }
      }
      for (let gi = 0; gi < grounds.length; gi++) {
        const g = grounds[gi]!;
        const dx = x - g.x;
        const dz = z - g.z;
        const hs = Math.sin(g.heading);
        const hc2 = -Math.cos(g.heading);
        const lu2 = Math.abs(dx * hs + dz * hc2) - g.halfLength;
        const lv2 = Math.abs(-dx * hc2 + dz * hs) - g.halfWidth;
        const d = Math.max(lu2, lv2);
        if (d < g.falloff) {
          const w = d <= 0 ? 1 : 1 - d / g.falloff;
          fw *= 1 - w;
          lu *= 1 - w;
        }
      }
      let road = 1;
      if (roadDist) {
        const rd = roadDist[i]!;
        road = rd / ROAD_REACH;
        if (road > 1) road = 1;
        if (rd < 14) fw *= rd / 14;
      }
      fw *= 1 - urb;
      lu *= 1 - fw;
      lu *= 1 - urb * 0.8;
      const o = i * 4;
      out[o] = Math.round(fw * 255);
      out[o + 1] = Math.round(lu * 255);
      out[o + 2] = Math.round(road * 255);
      out[o + 3] = Math.round(urb * 255);
    }
    if ((iz & 255) === 255) await yieldToEventLoop();
  }
  return out;
}

function heightTexture(grid: HeightGrid): DataTexture {
  const t = new DataTexture(grid.data, grid.size, grid.size, RedFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function maskTexture(mask: Uint8Array, size: number, wrap: Wrapping): DataTexture {
  const t = new DataTexture(mask, size, size, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = wrap;
  t.wrapT = wrap;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

async function bakeDomain(
  renderer: WebGLRenderer,
  pass: FullscreenPass,
  grid: HeightGrid,
  heightTex: DataTexture,
  sunDir: Vector3,
  mirror: boolean,
  progress: (done: number, total: number) => void,
): Promise<WebGLRenderTarget> {
  const n = grid.size;
  const wrap = mirror ? MirroredRepeatWrapping : ClampToEdgeWrapping;
  const rt = new WebGLRenderTarget(n, n, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: false,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    // Mip storage is allocated from this flag on first use; per-tile regeneration is toggled below.
    generateMipmaps: true,
    wrapS: wrap,
    wrapT: wrap,
    anisotropy: 4,
  });
  const mat = passMaterial(BAKE_FRAGMENT, {
    uH: { value: heightTex },
    uDom: { value: new Vector4(grid.originX, grid.originZ, grid.cell, n) },
    uSun: { value: sunDir.clone().normalize() },
    uMirror: { value: mirror ? 1 : 0 },
  });
  const tile = Math.min(GEN_TILE, n);
  const tiles = Math.ceil(n / tile);
  rt.scissorTest = true;
  try {
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const first = ty === 0 && tx === 0;
        const last = ty === tiles - 1 && tx === tiles - 1;
        rt.texture.generateMipmaps = first || last;
        rt.viewport.set(tx * tile, ty * tile, tile, tile);
        rt.scissor.set(tx * tile, ty * tile, tile, tile);
        pass.render(renderer, mat, rt);
        progress(ty * tiles + tx + 1, tiles * tiles);
        await yieldToEventLoop();
      }
    }
  } finally {
    mat.dispose();
  }
  rt.scissorTest = false;
  rt.viewport.set(0, 0, n, n);
  rt.scissor.set(0, 0, n, n);
  return rt;
}

/**
 * Generates both heightmap domains on the GPU, reads them back once, builds masks on the CPU and bakes
 * normals, sun visibility and ambient occlusion on the GPU.
 */
export async function generateTerrain(
  renderer: WebGLRenderer,
  map: MapDef,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  if (!renderer.extensions.has('EXT_color_buffer_float')) {
    throw new Error(
      'Terrain generation needs float render targets (EXT_color_buffer_float), which this GPU lacks.',
    );
  }
  const pass = new FullscreenPass();
  const uniforms: Record<string, IUniform> = {
    uOrigin: { value: new Vector2() },
    uCell: { value: 1 },
    uTile: { value: new Vector2() },
    uNzSeed: { value: new Vector2(map.seed[0], map.seed[1]) },
    ...flatUniforms(map.flats),
    ...map.uniforms(),
  };
  const genMat = passMaterial(genFragment(map), uniforms);
  const report = opts.onProgress;
  try {
    const nearW = 0.4;
    const farW = 0.12;
    const near = await renderDomain(renderer, pass, genMat, opts.near, (d, t) =>
      report((d / t) * nearW, 'Shaping terrain'),
    );
    const far = await renderDomain(renderer, pass, genMat, opts.far, (d, t) =>
      report(nearW + (d / t) * farW, 'Shaping distant terrain'),
    );
    const nearGrid: HeightGrid = { ...opts.near, data: near.heights };
    const farGrid: HeightGrid = { ...opts.far, data: far.heights };
    report(0.53, 'Growing forests');
    const nearMask = await buildMasks(map, nearGrid, near.potential, near.landuse, true);
    const farMask = await buildMasks(map, farGrid, far.potential, far.landuse, false);
    report(0.6, 'Baking light');
    const nearH = heightTexture(nearGrid);
    const farH = heightTexture(farGrid);
    const nearBake = await bakeDomain(renderer, pass, nearGrid, nearH, opts.sunDir, false, (d, t) =>
      report(0.6 + (d / t) * 0.1, 'Baking light'),
    );
    const farBake = await bakeDomain(renderer, pass, farGrid, farH, opts.sunDir, true, (d, t) =>
      report(0.7 + (d / t) * 0.04, 'Baking light'),
    );
    return {
      near: {
        grid: nearGrid,
        mask: nearMask,
        heightTex: nearH,
        maskTex: maskTexture(nearMask, nearGrid.size, ClampToEdgeWrapping),
        bake: nearBake,
      },
      far: {
        grid: farGrid,
        mask: farMask,
        heightTex: farH,
        maskTex: maskTexture(farMask, farGrid.size, MirroredRepeatWrapping),
        bake: farBake,
      },
    };
  } finally {
    genMat.dispose();
    pass.dispose();
  }
}

import {
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  ClampToEdgeWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { NOISE_GLSL } from './glsl/noise';
import { FullscreenPass, passMaterial } from './gpu';

/**
 * Procedural textures generated on the GPU at load (no image assets):
 *  - detail: tileable terrain detail. R albedo variation, G/B detail normal (x, y), A cellular pattern.
 *  - water: tileable wave normals. R/G normal (x, y), B foam pattern, A crest height.
 *  - puffs: 2x2 atlas of cloud puffs. R/G normal (x, y), B thickness, A coverage.
 */
const TILE_GLSL = /* glsl */ `
vec3 tileFbm(vec2 uv, vec2 period, int oct, float gain) {
  vec3 acc = vec3(0.0);
  float amp = 0.5;
  float f = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    vec3 n = nzGradTile(uv * period * f, period * f);
    acc.x += amp * n.x;
    acc.yz += amp * n.yz * period * f;
    amp *= gain;
    f *= 2.0;
  }
  return acc;
}

float tileCell(vec2 uv, float period) {
  vec2 p = uv * period;
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = mod(ip + o, period);
      vec2 q = o + 0.5 + 0.42 * nzHash2(c);
      float d = length(fp - q);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}
`;

const DETAIL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
${TILE_GLSL}
void main() {
  vec2 uv = vUv;
  vec3 a = tileFbm(uv, vec2(8.0), 7, 0.55);
  vec3 b = tileFbm(uv + 0.37, vec2(32.0), 5, 0.5);
  float cell = tileCell(uv, 24.0);
  float edges = smoothstep(0.0, 0.12, cell);
  // Detail height: broad lumps, fine grain and cracks between cells.
  vec2 grad = a.yz * 0.55 + b.yz * 0.35;
  vec3 n = normalize(vec3(-grad * 0.012, 1.0));
  float albedo = clamp(0.5 + a.x * 0.8 + b.x * 0.35 - (1.0 - edges) * 0.15, 0.0, 1.0);
  gl_FragColor = vec4(albedo, n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, clamp(cell * 2.2, 0.0, 1.0));
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
${TILE_GLSL}
void main() {
  vec2 uv = vUv;
  // Anisotropic swell (long crests along x) plus chop.
  vec3 s1 = tileFbm(uv, vec2(3.0, 9.0), 5, 0.5);
  vec3 s2 = tileFbm(uv + 0.21, vec2(12.0, 16.0), 5, 0.55);
  vec3 s3 = tileFbm(uv + 0.63, vec2(40.0, 40.0), 3, 0.5);
  float crest = 1.0 - abs(s1.x * 1.4);
  vec2 grad = s1.yz * 0.45 + s2.yz * 0.3 + s3.yz * 0.12;
  vec3 n = normalize(vec3(-grad * 0.01, 1.0));
  float foam = smoothstep(0.35, 0.75, tileCell(uv, 18.0)) * (0.5 + 0.5 * s2.x);
  gl_FragColor = vec4(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, clamp(foam, 0.0, 1.0), clamp(crest, 0.0, 1.0));
}
`;

const PUFF_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${NOISE_GLSL}
${TILE_GLSL}
void main() {
  vec2 cellId = floor(vUv * 2.0);
  vec2 q = fract(vUv * 2.0) * 2.0 - 1.0;
  float seed = cellId.x + cellId.y * 2.0;
  vec2 off = vec2(seed * 3.1, seed * 5.7);
  // Lumpy sphere: radius perturbed by low-frequency noise, soft edge with fine wisps.
  vec3 lump = nzFbmD(q * 1.6 + off, 4);
  vec3 fine = nzFbmD(q * 5.0 + off * 1.3, 4);
  float r = length(q);
  float edge = r + lump.x * 0.22 + fine.x * 0.08;
  float cover = 1.0 - smoothstep(0.52, 0.95, edge);
  cover *= smoothstep(1.0, 0.9, r);
  float z = sqrt(max(1.0 - min(r * r, 1.0), 0.0));
  vec3 n = normalize(vec3(q + (lump.yz * 0.08 + fine.yz * 0.03), z + 0.25));
  float thick = clamp(z * (0.75 + 0.25 * lump.x), 0.0, 1.0);
  gl_FragColor = vec4(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, thick, clamp(cover, 0.0, 1.0));
}
`;

export interface WorldTextures {
  detail: Texture;
  water: Texture;
  puffs: Texture;
  dispose(): void;
}

function bakeTexture(
  renderer: WebGLRenderer,
  pass: FullscreenPass,
  frag: string,
  size: number,
  repeat: boolean,
  seed: Vector2,
): WebGLRenderTarget {
  const wrap = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  const rt = new WebGLRenderTarget(size, size, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: wrap,
    wrapT: wrap,
    anisotropy: 8,
  });
  const mat = passMaterial(frag, { uNzSeed: { value: seed } });
  pass.render(renderer, mat, rt);
  mat.dispose();
  return rt;
}

export function createWorldTextures(renderer: WebGLRenderer, seed: readonly [number, number]): WorldTextures {
  const pass = new FullscreenPass();
  const s = new Vector2(seed[0] + 101, seed[1] + 37);
  const detail = bakeTexture(renderer, pass, DETAIL_FRAG, 1024, true, s);
  const water = bakeTexture(renderer, pass, WATER_FRAG, 512, true, s);
  const puffs = bakeTexture(renderer, pass, PUFF_FRAG, 512, false, s);
  pass.dispose();
  return {
    detail: detail.texture,
    water: water.texture,
    puffs: puffs.texture,
    dispose() {
      detail.dispose();
      water.dispose();
      puffs.dispose();
    },
  };
}

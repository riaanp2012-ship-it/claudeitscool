import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { ATMOSPHERE_GLSL, atmoUniforms } from '../render/atmosphere';
import { TERRAIN_SAMPLE_GLSL } from './glsl/terrainSample';

const WATER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_SAMPLE_GLSL}
uniform float uWaterLevel;
varying vec3 vWorld;
varying vec2 vFlat;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vFlat = wp.xz;
  wp.y = uWaterLevel - horizonDrop(wp.xz - cameraPosition.xz);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
${TERRAIN_SAMPLE_GLSL}
uniform sampler2D uWaves;
uniform float uWaterLevel;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec2 uFarFade;
uniform float uWaveStrength;
uniform float uGlint;
varying vec3 vWorld;
varying vec2 vFlat;

vec2 waveSlope(vec2 uv) {
  vec2 n = texture2D(uWaves, uv).rg * 2.0 - 1.0;
  return n / max(sqrt(max(1.0 - dot(n, n), 0.0)), 0.2);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vFlat;
  float ground = terrainHeight(p);
  float depth = uWaterLevel - ground;
  if (depth < 0.0) discard;

  vec3 ray = vWorld - cameraPosition;
  float dist = length(ray);
  vec3 V = -ray / max(dist, 1e-3);
  float t = uTime;

  // Multi-scale scrolling wave slopes; flatten with distance so the far sea never sparkles (ZD-B30).
  vec2 s = waveSlope(p / 211.0 + vec2(t * 0.0021, t * 0.0013)) * 0.55
    + waveSlope(mat2(0.8, 0.6, -0.6, 0.8) * p / 67.0 + vec2(-t * 0.0047, t * 0.0031)) * 0.35
    + waveSlope(mat2(0.6, -0.8, 0.8, 0.6) * p / 17.0 + vec2(t * 0.011, -t * 0.007)) * 0.22;
  float fade = 1.0 / (1.0 + dist / 2500.0);
  s *= uWaveStrength * mix(0.25, 1.0, fade);
  // Shallow water is calmer.
  s *= mix(0.4, 1.0, smoothstep(0.0, 4.0, depth));
  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));

  float ndv = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  R = normalize(R);
  vec3 skyR = atmoSky(R);

  // Body color: absorption with depth, lit by sun and sky.
  float absorb = exp(-depth / 7.0);
  vec3 body = mix(uDeep, uShallow, absorb);
  vec3 light = uSunColor * max(uSunDir.y, 0.0) * atmoGroundShadow(vWorld) + uAmbientSky;
  vec3 col = body * light * RECIPROCAL_PI;
  col = mix(col, skyR, fresnel);

  // Sun glint: sharp near the camera, broader far away; HDR so bloom picks it up.
  float rough = mix(0.0025, 0.03, 1.0 - fade);
  float mu = max(dot(R, uSunDir), 0.0);
  float lobe = exp(-(1.0 - mu) / rough);
  col += uSunColor * lobe * uGlint * (0.35 + 0.65 * fade) * atmoGroundShadow(vWorld);

  // Shoreline foam in the first meters of depth.
  vec4 w = texture2D(uWaves, p / 31.0 + vec2(t * 0.004, 0.0));
  float surf = 1.0 - smoothstep(0.0, 2.2, depth + sin(t * 0.9 + p.x * 0.05 + p.y * 0.03) * 0.35);
  float foam = surf * smoothstep(0.25, 0.7, w.b + surf * 0.35);
  col = mix(col, vec3(0.85, 0.88, 0.9) * light * RECIPROCAL_PI, foam * 0.8);

  float alpha = smoothstep(0.0, 1.3, depth);
  alpha = max(alpha, foam * 0.9);
  alpha = mix(alpha, 1.0, smoothstep(1500.0, 6000.0, dist));

  col = atmoApply(col, ray);
  col = mix(col, atmoSky(-V), smoothstep(uFarFade.x, uFarFade.y, dist));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Polar grid: dense near the center, rings growing geometrically out to `radius`. */
function buildDisc(radius: number, rings: number, segments: number): BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  let r = 40;
  const growth = Math.pow(radius / r, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    r *= growth;
  }
  for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments;
    idx.push(0, 1 + j1, 1 + j);
  }
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments;
    const b0 = 1 + (i + 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      idx.push(a0 + j, a0 + j1, b0 + j, b0 + j, a0 + j1, b0 + j1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

export interface WaterOptions {
  waterLevel: number;
  sampleUniforms: Record<string, IUniform>;
  waves: Texture;
  deep: Color;
  shallow: Color;
  waveStrength: number;
  glint: number;
}

export class Water {
  readonly mesh: Mesh;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly fade = new Vector2(1e5, 1.5e5);

  constructor(o: WaterOptions) {
    this.geometry = buildDisc(200000, 56, 96);
    this.material = new ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        ...o.sampleUniforms,
        ...atmoUniforms,
        uWaves: { value: o.waves },
        uWaterLevel: { value: o.waterLevel },
        uDeep: { value: o.deep },
        uShallow: { value: o.shallow },
        uFarFade: { value: this.fade },
        uWaveStrength: { value: o.waveStrength },
        uGlint: { value: o.glint },
      },
      transparent: true,
      blending: NormalBlending,
      depthWrite: true,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'water';
  }

  update(camera: PerspectiveCamera): void {
    const e = camera.matrixWorld.elements;
    // Snap to 1 km so the vertex rings do not swim; shading is in world space.
    this.mesh.position.set(Math.round(e[12]! / 1000) * 1000, 0, Math.round(e[14]! / 1000) * 1000);
    this.fade.set(camera.far * 0.62, camera.far * 0.97);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

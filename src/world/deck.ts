import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { ATMOSPHERE_GLSL, atmoUniforms, type AtmosphereParams } from '../render/atmosphere';
import { TERRAIN_SAMPLE_GLSL } from './glsl/terrainSample';
import type { DeckDef } from './maps/types';

const DECK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_SAMPLE_GLSL}
uniform float uLevel;
varying vec3 vWorld;
varying vec2 vFlat;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vFlat = wp.xz;
  wp.y = uLevel - horizonDrop(wp.xz - cameraPosition.xz);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const DECK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
${TERRAIN_SAMPLE_GLSL}
uniform sampler2D uDetail;
uniform float uLevel;
uniform float uTop;
uniform vec2 uFarFade;
uniform float uBelowLight;
varying vec3 vWorld;
varying vec2 vFlat;

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vFlat + vec2(uTime * 2.5, uTime * 0.8);
  vec4 a = texture2D(uDetail, p / 9100.0);
  vec4 b = texture2D(uDetail, mat2(0.8, 0.6, -0.6, 0.8) * p / 2300.0);
  vec4 c = texture2D(uDetail, p / 610.0);
  float lump = a.r * 0.5 + b.r * 0.33 + c.r * 0.17;
  vec3 ray = vWorld - cameraPosition;
  float dist = length(ray);
  float ground = terrainHeight(vFlat);
  vec3 col;
  float alpha;
  if (uTop > 0.5) {
    // Sunlit top: rolling billows, bright on the sun side, soft blue shade in the troughs.
    vec2 g = (a.gb - 0.5) * 1.6 + (b.gb - 0.5) * 1.2 + (c.gb - 0.5) * 0.6 * (1.0 - smoothstep(2000.0, 12000.0, dist));
    vec3 N = normalize(vec3(g.x, 1.0, g.y));
    float ndl = clamp(dot(N, uSunDir) * 0.65 + 0.35, 0.0, 1.0);
    float shade = smoothstep(0.25, 0.75, lump);
    vec3 lit = uSunColor * ndl * mix(0.55, 1.0, shade) * 1.15 + uAmbientSky * mix(0.9, 1.5, shade);
    col = vec3(0.92) * lit * RECIPROCAL_PI;
    alpha = smoothstep(0.0, 140.0, uLevel - ground);
  } else {
    // Base seen from below: flat grey with darker patches where the deck is thicker.
    float thick = smoothstep(0.3, 0.8, lump);
    col = vec3(0.62, 0.64, 0.67) * (0.72 - 0.25 * thick) * (uAmbientSky * 1.4 + uSunColor * uBelowLight) * RECIPROCAL_PI;
    alpha = smoothstep(0.0, 90.0, uLevel - ground);
  }
  col = atmoApply(col, ray);
  col = mix(col, atmoSky(ray / max(dist, 1e-3)), smoothstep(uFarFade.x, uFarFade.y, dist));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function disc(radius: number, rings: number, segments: number, flip: boolean): BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  let r = 60;
  const growth = Math.pow(radius / r, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    r *= growth;
  }
  const tri = (a: number, b: number, c: number) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let j = 0; j < segments; j++) tri(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments;
    const b0 = 1 + (i + 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      tri(a0 + j, a0 + j1, b0 + j);
      tri(b0 + j, a0 + j1, b0 + j1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

export interface DeckOptions {
  def: DeckDef;
  sampleUniforms: Record<string, IUniform>;
  detail: Texture;
  atmo: AtmosphereParams;
}

interface AtmoSnapshot {
  sunColor: Color;
  zenith: Color;
  horizon: Color;
  haze: Color;
  ambSky: Color;
  ambGround: Color;
  fog: number;
  falloff: number;
  mie: number;
}

/**
 * Norrdal's overcast deck: a textured top seen from above, a grey base seen from below, and atmosphere
 * blending as the camera passes through (dim flat light below, whiteout inside).
 */
export class Deck {
  readonly meshes: Mesh[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly fade = new Vector2(1e5, 1.5e5);
  private readonly above: AtmoSnapshot;
  private readonly below: AtmoSnapshot;
  private readonly inside: AtmoSnapshot;
  private readonly def: DeckDef;

  constructor(o: DeckOptions) {
    this.def = o.def;
    const a = o.atmo;
    this.above = {
      sunColor: a.sunColor.clone(),
      zenith: a.zenithColor.clone(),
      horizon: a.horizonColor.clone(),
      haze: a.groundHazeColor.clone(),
      ambSky: a.ambientSky.clone(),
      ambGround: a.ambientGround.clone(),
      fog: a.fogDensity,
      falloff: a.fogFalloff,
      mie: a.mieStrength,
    };
    const grey = new Color(0.36, 0.38, 0.41);
    this.below = {
      sunColor: a.sunColor.clone().multiplyScalar(o.def.belowLight),
      zenith: grey.clone().multiplyScalar(0.85),
      horizon: grey.clone().multiplyScalar(1.05),
      haze: grey.clone().multiplyScalar(0.9),
      ambSky: new Color(0.62, 0.66, 0.72),
      ambGround: new Color(0.2, 0.2, 0.2),
      fog: 1 / 16000,
      falloff: 1 / 1400,
      mie: 0.02,
    };
    const white = new Color(0.8, 0.82, 0.85);
    this.inside = {
      sunColor: a.sunColor.clone().multiplyScalar(0.35),
      zenith: white.clone(),
      horizon: white.clone(),
      haze: white.clone(),
      ambSky: new Color(0.9, 0.92, 0.95),
      ambGround: new Color(0.4, 0.4, 0.42),
      fog: 1 / 250,
      falloff: 1 / 20000,
      mie: 0.0,
    };
    for (const top of [true, false]) {
      const geo = disc(200000, 48, 96, !top);
      const mat = new ShaderMaterial({
        vertexShader: DECK_VERT,
        fragmentShader: DECK_FRAG,
        uniforms: {
          ...o.sampleUniforms,
          ...atmoUniforms,
          uDetail: { value: o.detail },
          uLevel: { value: top ? o.def.top : o.def.base },
          uTop: { value: top ? 1 : 0 },
          uFarFade: { value: this.fade },
          uBelowLight: { value: o.def.belowLight },
        },
        side: FrontSide,
        transparent: true,
        blending: NormalBlending,
        depthWrite: true,
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = top ? -7 : -8;
      mesh.name = top ? 'deck-top' : 'deck-base';
      this.meshes.push(mesh);
      this.geometries.push(geo);
      this.materials.push(mat);
    }
  }

  densityAt(_x: number, y: number, _z: number): number {
    const d = this.def;
    if (y < d.base - 60 || y > d.top + 60) return 0;
    const inBase = Math.min(1, (y - (d.base - 60)) / 120);
    const inTop = Math.min(1, (d.top + 60 - y) / 120);
    return Math.max(0, Math.min(inBase, inTop));
  }

  update(camera: PerspectiveCamera): void {
    const e = camera.matrixWorld.elements;
    const x = Math.round(e[12]! / 1000) * 1000;
    const z = Math.round(e[14]! / 1000) * 1000;
    for (const m of this.meshes) m.position.set(x, 0, z);
    this.fade.set(camera.far * 0.62, camera.far * 0.97);
    const y = e[13]!;
    const d = this.def;
    // 0 = below the base, 1 = inside, 2 = above the top (with soft transitions).
    const t = smoothstep(d.base - 80, d.base + 80, y) + smoothstep(d.top - 80, d.top + 80, y);
    const u = atmoUniforms;
    if (t <= 1) blend(this.below, this.inside, t, u);
    else blend(this.inside, this.above, t - 1, u);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    // Restore the map's clear-sky atmosphere for anything that outlives the world.
    blend(this.above, this.above, 0, atmoUniforms);
  }
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function blend(a: AtmoSnapshot, b: AtmoSnapshot, t: number, u: typeof atmoUniforms): void {
  u.uSunColor.value.copy(a.sunColor).lerp(b.sunColor, t);
  u.uZenith.value.copy(a.zenith).lerp(b.zenith, t);
  u.uHorizon.value.copy(a.horizon).lerp(b.horizon, t);
  u.uGroundHaze.value.copy(a.haze).lerp(b.haze, t);
  u.uAmbientSky.value.copy(a.ambSky).lerp(b.ambSky, t);
  u.uAmbientGround.value.copy(a.ambGround).lerp(b.ambGround, t);
  // Fog blends in log space so the whiteout ramps smoothly.
  u.uFogDensity.value = Math.exp(Math.log(a.fog) + (Math.log(b.fog) - Math.log(a.fog)) * t);
  u.uFogFalloff.value = a.falloff + (b.falloff - a.falloff) * t;
  u.uMie.value = a.mie + (b.mie - a.mie) * t;
}

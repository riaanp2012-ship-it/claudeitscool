import {
  Color,
  DataTexture,
  Matrix4,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  Vector4,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * Shared atmosphere: one sun, one sky model and one aerial-perspective fog used by every material.
 * Sky, terrain, water, clouds, aircraft and particles all read these uniforms so colors always agree
 * (spec §6, ZD-B17/B19). Values are set per map with `setAtmosphere`.
 */
export interface AtmosphereParams {
  /** Unit vector pointing toward the sun. */
  sunDirection: Vector3;
  /** Direct sunlight color multiplied by intensity (linear, HDR). */
  sunColor: Color;
  zenithColor: Color;
  horizonColor: Color;
  /** Haze color seen below the horizon from altitude. */
  groundHazeColor: Color;
  ambientSky: Color;
  ambientGround: Color;
  /** Fog extinction per meter at sea level (for example 1 / 30000). */
  fogDensity: number;
  /** Exponential height falloff per meter (for example 1 / 2000). */
  fogFalloff: number;
  /** Strength and anisotropy of the sun glow (Mie). */
  mieStrength: number;
  mieG: number;
}

const blackTexture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
blackTexture.needsUpdate = true;

export const MAX_FLASHES = 4;

export const atmoUniforms = {
  uSunDir: { value: new Vector3(0.4, 0.6, -0.5).normalize() },
  uSunColor: { value: new Color(3, 2.85, 2.6) },
  uZenith: { value: new Color(0.16, 0.34, 0.72) },
  uHorizon: { value: new Color(0.62, 0.72, 0.86) },
  uGroundHaze: { value: new Color(0.42, 0.48, 0.55) },
  uAmbientSky: { value: new Color(0.35, 0.45, 0.62) },
  uAmbientGround: { value: new Color(0.18, 0.17, 0.15) },
  uFogDensity: { value: 1 / 30000 },
  uFogFalloff: { value: 1 / 2200 },
  uMie: { value: 0.35 },
  uMieG: { value: 0.78 },
  /** Aircraft ground shadow (coverage map rendered from the sun). Written by render/groundShadow.ts. */
  uGroundShadowMap: { value: blackTexture as Texture },
  uGroundShadowMatrix: { value: new Matrix4() },
  uGroundShadowStrength: { value: 0 },
  /** Short-lived explosion lights: xyz position, w radius (0 = off); color is rgb * intensity. */
  uFlashPos: { value: Array.from({ length: MAX_FLASHES }, () => new Vector4(0, 0, 0, 0)) },
  uFlashColor: { value: Array.from({ length: MAX_FLASHES }, () => new Vector3(0, 0, 0)) },
  /** Seconds since session start; for animated shaders (water, clouds). */
  uTime: { value: 0 },
};

export function setAtmosphere(p: AtmosphereParams): void {
  const u = atmoUniforms;
  u.uSunDir.value.copy(p.sunDirection).normalize();
  u.uSunColor.value.copy(p.sunColor);
  u.uZenith.value.copy(p.zenithColor);
  u.uHorizon.value.copy(p.horizonColor);
  u.uGroundHaze.value.copy(p.groundHazeColor);
  u.uAmbientSky.value.copy(p.ambientSky);
  u.uAmbientGround.value.copy(p.ambientGround);
  u.uFogDensity.value = p.fogDensity;
  u.uFogFalloff.value = p.fogFalloff;
  u.uMie.value = p.mieStrength;
  u.uMieG.value = p.mieG;
}

/**
 * GLSL shared by all world shaders. Requires three's built-in `cameraPosition` uniform
 * (present in every ShaderMaterial and built-in material).
 *
 *  vec3 atmoSky(vec3 dir)                      sky radiance for a world direction (no sun disk)
 *  vec3 atmoApply(vec3 color, vec3 ray)        aerial perspective; ray = fragmentWorldPos - cameraPosition
 *  float atmoTransmittance(vec3 ray)           0..1 fraction of surface color that survives the fog
 *  float atmoGroundShadow(vec3 worldPos)       1 = lit, lower = inside an aircraft shadow
 *  vec3 atmoFlash(vec3 worldPos, vec3 normal)  additive light from active explosion flashes
 *  vec3 atmoDither()                           tiny screen-space noise to break banding
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGroundHaze;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uMie;
uniform float uMieG;
uniform sampler2D uGroundShadowMap;
uniform mat4 uGroundShadowMatrix;
uniform float uGroundShadowStrength;
uniform vec4 uFlashPos[${MAX_FLASHES}];
uniform vec3 uFlashColor[${MAX_FLASHES}];
uniform float uTime;

float atmoHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566370 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

vec3 atmoSky(vec3 dir) {
  float y = dir.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.42));
  sky = mix(sky, uGroundHaze, smoothstep(0.0, 0.18, -y));
  float mu = dot(dir, uSunDir);
  float horizonBand = 1.0 - up;
  sky += uSunColor * uMie * atmoHG(mu, uMieG) * (0.3 + 0.7 * horizonBand);
  sky += uSunColor * 0.035 * pow(max(mu, 0.0), 3.0) * horizonBand * horizonBand;
  return sky;
}

float atmoOpticalDepth(vec3 ray) {
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-3);
  float b = uFogFalloff;
  float x = clamp(b * dir.y * dist, -80.0, 80.0);
  float f = abs(x) < 1e-4 ? 1.0 - 0.5 * x : (1.0 - exp(-x)) / x;
  float h0 = max(cameraPosition.y, -100.0);
  return uFogDensity * exp(-b * h0) * dist * f;
}

float atmoTransmittance(vec3 ray) {
  return exp(-atmoOpticalDepth(ray));
}

vec3 atmoApply(vec3 color, vec3 ray) {
  float t = atmoTransmittance(ray);
  vec3 dir = normalize(ray);
  return color * t + atmoSky(dir) * (1.0 - t);
}

float atmoGroundShadow(vec3 worldPos) {
  if (uGroundShadowStrength <= 0.0) return 1.0;
  vec4 p = uGroundShadowMatrix * vec4(worldPos, 1.0);
  vec2 uv = p.xy;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 1.0;
  float c = texture2D(uGroundShadowMap, uv).r;
  return 1.0 - c * uGroundShadowStrength;
}

vec3 atmoFlash(vec3 worldPos, vec3 normal) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_FLASHES}; i++) {
    vec4 f = uFlashPos[i];
    if (f.w <= 0.0) continue;
    vec3 d = f.xyz - worldPos;
    float dist = length(d);
    float att = clamp(1.0 - dist / f.w, 0.0, 1.0);
    acc += uFlashColor[i] * att * att * max(dot(normal, d / max(dist, 1e-3)), 0.0);
  }
  return acc;
}

vec3 atmoDither() {
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  return vec3((n - 0.5) / 255.0);
}
`;

/**
 * Makes a built-in material (Standard, Physical, Lambert, Basic) use the shared aerial perspective
 * instead of three's fog. `extra` lets a caller add its own shader edits in the same hook.
 * `key` must be unique per distinct `extra` so three does not reuse the wrong program.
 */
export function patchAtmosphere<T extends Material>(
  material: T,
  key = 'atmo',
  extra?: (shader: WebGLProgramParametersWithUniforms) => void,
): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmoUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', 'varying vec3 vAtmoRay;')
      .replace('#include <fog_vertex>', 'vAtmoRay = mvPosition.xyz * mat3( viewMatrix );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `${ATMOSPHERE_GLSL}\nvarying vec3 vAtmoRay;`)
      .replace(
        '#include <fog_fragment>',
        'gl_FragColor.rgb = atmoApply( gl_FragColor.rgb, vAtmoRay ) + atmoDither();',
      );
    extra?.(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

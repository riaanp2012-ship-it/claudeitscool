import { CURVATURE_START, EARTH_RADIUS } from '../constants';

/**
 * Terrain height sampling in GLSL, identical to `TerrainHeights` on the CPU: manual bilinear with texelFetch on
 * R32F textures (float linear filtering is not guaranteed), near map clamped, far map mirrored, blended in a
 * band at the edge of the near domain.
 *
 * Uniforms: uHNear, uHFar (R32F, nearest), uNearDom / uFarDom = (originX, originZ, cell, size),
 * uBlend = (start, end).
 */
export const TERRAIN_SAMPLE_GLSL = /* glsl */ `
uniform highp sampler2D uHNear;
uniform highp sampler2D uHFar;
uniform vec4 uNearDom;
uniform vec4 uFarDom;
uniform vec2 uBlend;

float tsMirror(float g, float n) {
  float p = 2.0 * (n - 1.0);
  float m = g - p * floor(g / p);
  return m > n - 1.0 ? p - m : m;
}

float tsBilinear(highp sampler2D t, vec2 g, float n) {
  float mx = n - 1.0;
  g = clamp(g, vec2(0.0), vec2(mx));
  vec2 i = min(floor(g), vec2(mx - 1.0));
  vec2 f = g - i;
  ivec2 a = ivec2(i);
  float h00 = texelFetch(t, a, 0).r;
  float h10 = texelFetch(t, a + ivec2(1, 0), 0).r;
  float h01 = texelFetch(t, a + ivec2(0, 1), 0).r;
  float h11 = texelFetch(t, a + ivec2(1, 1), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float tsNear(vec2 p) {
  return tsBilinear(uHNear, (p - uNearDom.xy) / uNearDom.z, uNearDom.w);
}

float tsFar(vec2 p) {
  vec2 g = (p - uFarDom.xy) / uFarDom.z;
  g = vec2(tsMirror(g.x, uFarDom.w), tsMirror(g.y, uFarDom.w));
  return tsBilinear(uHFar, g, uFarDom.w);
}

float tsFarWeight(vec2 p) {
  vec2 a = abs(p);
  return smoothstep(uBlend.x, uBlend.y, max(a.x, a.y));
}

float terrainHeight(vec2 p) {
  float w = tsFarWeight(p);
  if (w <= 0.0) return tsNear(p);
  if (w >= 1.0) return tsFar(p);
  return mix(tsNear(p), tsFar(p), w);
}

// Horizon drop: zero within ${CURVATURE_START.toFixed(1)} m of the camera, then a sphere of radius R.
float horizonDrop(vec2 fromCamera) {
  float d = max(length(fromCamera) - ${CURVATURE_START.toFixed(1)}, 0.0);
  return d * d * ${(0.5 / EARTH_RADIUS).toExponential(6)};
}
`;

/** CPU twin of horizonDrop for bounds. */
export function horizonDrop(dist: number): number {
  const d = Math.max(dist - CURVATURE_START, 0);
  return (d * d * 0.5) / EARTH_RADIUS;
}

/**
 * Soft shadows of the (static) cumulus field, baked once to a ground texture. Uniforms: uCloudShadow,
 * uCloudBox = (originX, originZ, 1 / size, strength).
 */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uCloudShadow;
uniform vec4 uCloudBox;
float cloudShadow(vec3 wp) {
  vec2 q = wp.xz - uSunDir.xz / max(uSunDir.y, 0.05) * wp.y;
  vec2 uv = (q - uCloudBox.xy) * uCloudBox.z;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 1.0;
  return mix(1.0, texture2D(uCloudShadow, uv).r, uCloudBox.w);
}
`;

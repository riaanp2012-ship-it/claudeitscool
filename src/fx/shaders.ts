/**
 * GLSL for every effect batch. All shaders use three's logarithmic depth chunks and the shared atmosphere
 * (ATMOSPHERE_GLSL): alpha smoke is lit by the sun and fogged with atmoApply; additive light is only
 * attenuated by atmoTransmittance (never mixed toward the sky color). Colors are linear HDR.
 */
import { ATMOSPHERE_GLSL } from '../render/atmosphere';
import { FIRE_OCCLUSION, MIN_RIBBON_HALF_PX, RIBBON_KINDS } from './tuning';

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** Pixels per world unit at a view depth (vertical), from the projection and the render target height. */
const PX_PER_UNIT = /* glsl */ `
uniform vec2 uViewport;
float fxPxPerUnit(float depth) {
  return projectionMatrix[1][1] * 0.5 * uViewport.y / max(depth, 1e-3);
}
`;

/** Shared smoke lighting: sun with wrap and self-shadowing, forward scattering when backlit, sky ambient. */
const SMOKE_LIGHT = /* glsl */ `
vec3 fxSmokeLight(vec3 n, vec3 toCam, float density) {
  float ndl = dot(n, uSunDir);
  float wrap = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  float selfShadow = mix(1.0, 0.4 + 0.6 * wrap, clamp(density * 1.2, 0.0, 1.0));
  float forward = atmoHG(dot(-toCam, uSunDir), 0.55) * (1.0 - density * 0.6);
  vec3 amb = mix(uAmbientGround, uAmbientSky, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  return uSunColor * (wrap * selfShadow * 0.75 + 0.08 + forward * 0.9) + amb * 1.1;
}
`;

// ─────────────────────────────────────────────────────────────── Alpha particles (smoke, dust, spray)

export const ALPHA_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iPos;
attribute vec4 iColor;
attribute vec4 iParams;
attribute vec4 iExtra;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vRotCS;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vRight;
varying vec3 vUp;
varying float vLayer;
varying float vMode;
varying float vGround;
varying float vEmissive;
varying float vErosion;
varying float vSize;

void main() {
  vec3 center = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
  float size = iPos.w;
  float c = cos(iParams.x);
  float s = sin(iParams.x);
  vec2 corner = position.xy;
  vec2 rc = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center + (right * rc.x + up * rc.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
  float mode = floor(iParams.y / 16.0 + 0.001);
  vUv = corner + 0.5;
  vLocal = rc * 2.0;
  vRotCS = vec2(c, s);
  vColor = iColor;
  vWorld = world;
  vRight = right;
  vUp = up;
  vMode = mode;
  vLayer = iParams.y - mode * 16.0;
  vGround = iParams.z;
  vEmissive = iParams.w;
  vErosion = iExtra.x;
  vSize = size;
}
`;

export const ALPHA_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
${SMOKE_LIGHT}
uniform sampler2DArray uAtlas;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vRotCS;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vRight;
varying vec3 vUp;
varying float vLayer;
varying float vMode;
varying float vGround;
varying float vEmissive;
varying float vErosion;
varying float vSize;

void main() {
  #include <logdepthbuf_fragment>
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  float density = clamp((tex.r - vErosion) / max(1.0 - vErosion, 1e-3), 0.0, 1.0);
  vec3 ray = vWorld - cameraPosition;
  float dist = length(ray);
  float alpha = density * vColor.a;
  // Soft contact with the ground: fade toward the surface height instead of clipping (ZD-B08).
  alpha *= smoothstep(vGround, vGround + max(vSize * 0.32, 0.25), vWorld.y);
  // Fade puffs that reach the camera (no screen-filling overdraw, ZD-C15).
  alpha *= smoothstep(vSize * 0.3, vSize * 1.2, dist);
  if (alpha < 0.002) discard;
  vec3 toCam = -ray / max(dist, 1e-3);
  vec3 col;
  if (vMode < 0.5) {
    vec2 tn = tex.gb * 2.0 - 1.0;
    vec2 sn = vec2(vRotCS.x * tn.x - vRotCS.y * tn.y, vRotCS.y * tn.x + vRotCS.x * tn.y);
    vec2 sph = vLocal * 0.85;
    float sz = sqrt(max(0.0, 1.0 - dot(sph, sph)));
    vec3 n = normalize(vRight * (sph.x + sn.x * 1.4) + vUp * (sph.y + sn.y * 1.4) + toCam * (sz + 0.25));
    col = vColor.rgb * (fxSmokeLight(n, toCam, density) + atmoFlash(vWorld, n));
    col += vEmissive * vec3(3.2, 1.2, 0.32) * (0.35 + 0.65 * density);
  } else {
    col = vColor.rgb * (uAmbientSky * 1.3 + uSunColor * 0.3);
  }
  col = atmoApply(col, ray);
  gl_FragColor = vec4(col * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────── Additive (fire, flash, sparks, glows, tracers)

export const ADD_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PX_PER_UNIT}
attribute vec4 iPos;
attribute vec4 iColor;
attribute vec4 iParams;
attribute vec4 iDir;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWorld;
varying float vLayer;
varying float vMode;
varying float vEnergy;

void main() {
  vec3 center = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
  float size = iPos.w;
  float mode = floor(iParams.y / 16.0 + 0.001);
  float minPx = iParams.z;
  vec2 corner = position.xy;
  vMode = mode;
  vLayer = iParams.y - mode * 16.0;
  vColor = iColor;
  vWorld = center;
  vEnergy = 1.0;
  vUv = corner + 0.5;
  if (mode < 1.5) {
    // Camera-facing sprite with a minimum on-screen size; energy is conserved when enlarged (ZD-B13).
    vec4 mv = viewMatrix * vec4(center, 1.0);
    float depth = -mv.z;
    float ppu = fxPxPerUnit(depth);
    float px = size * ppu;
    float pxc = max(px, minPx);
    vEnergy = px / max(pxc, 1e-6);
    float s = pxc / ppu;
    float c = cos(iParams.x);
    float sn = sin(iParams.x);
    mv.xy += vec2(c * corner.x - sn * corner.y, sn * corner.x + c * corner.y) * s;
    gl_Position = depth > 0.01 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
  } else {
    // Streak from tail to head in screen space, clipped to the near plane, with a minimum pixel width.
    vec4 h = viewMatrix * vec4(center, 1.0);
    vec4 t = viewMatrix * vec4(center - iDir.xyz * iDir.w, 1.0);
    float zc = -1.02 * projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
    if (h.z > zc && t.z > zc) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      vEnergy = 0.0;
    } else {
      if (h.z > zc) h = mix(t, h, (zc - t.z) / (h.z - t.z));
      else if (t.z > zc) t = mix(h, t, (zc - h.z) / (t.z - h.z));
      vec4 ch = projectionMatrix * h;
      vec4 ct = projectionMatrix * t;
      vec2 hv = 0.5 * uViewport;
      vec2 sh = ch.xy / ch.w * hv;
      vec2 st = ct.xy / ct.w * hv;
      vec2 d = sh - st;
      float len = length(d);
      vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      bool isHead = corner.x > 0.0;
      vec4 cc = isHead ? ch : ct;
      float wpx = size * fxPxPerUnit(-(isHead ? h.z : t.z));
      float wc = max(wpx, minPx);
      vEnergy = wpx / max(wc, 1e-6);
      vec2 off = nrm * (corner.y * wc) + dir * (sign(corner.x) * wc * 0.5);
      cc.xy += off / hv * cc.w;
      gl_Position = cc;
    }
  }
  #include <logdepthbuf_vertex>
}
`;

export const ADD_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
uniform sampler2DArray uAtlas;
uniform sampler2D uNoise;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWorld;
varying float vLayer;
varying float vMode;
varying float vEnergy;

// Blackbody-like ramp: dull red -> orange -> yellow -> white. Kept saturated and moderate so the filmic
// tone mapping keeps fire orange instead of washing it out to peach.
vec3 fireRamp(float h) {
  h = max(h, 0.0);
  vec3 c = mix(vec3(0.8, 0.1, 0.012), vec3(1.0, 0.3, 0.03), smoothstep(0.2, 0.55, h));
  c = mix(c, vec3(1.0, 0.55, 0.12), smoothstep(0.55, 0.95, h));
  c = mix(c, vec3(1.0, 0.85, 0.6), smoothstep(1.05, 1.45, h));
  return c * (0.08 + 2.4 * h * h);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 col;
  // Fire also occludes a little (premultiplied alpha), so dense fireballs converge to the fire color
  // instead of summing to white. Everything else is purely additive (alpha 0).
  float occlusion = 0.0;
  if (vMode < 0.5) {
    float m = texture(uAtlas, vec3(vUv, vLayer)).r;
    col = vColor.rgb * (m * vColor.a);
  } else if (vMode < 1.5) {
    vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
    float heat = vColor.r;
    float seed = vColor.g;
    float age = vColor.b;
    vec2 nuv = vUv * 0.7 + vec2(seed * 7.13, seed * 3.71 - age * 0.45);
    float n1 = texture(uNoise, nuv).r;
    float n2 = texture(uNoise, nuv * 2.3 + vec2(age * 0.3, -age * 0.8)).b;
    float turb = n1 * 0.6 + n2 * 0.4;
    float shape = clamp(tex.r * (0.45 + 1.1 * turb) - 0.08, 0.0, 1.0);
    float h = heat * (0.2 + 0.5 * shape + 0.65 * tex.a * turb);
    occlusion = shape * vColor.a * ${f(FIRE_OCCLUSION)};
    col = fireRamp(h) * occlusion;
  } else {
    float across = vUv.y * 2.0 - 1.0;
    float core = pow(max(1.0 - across * across, 0.0), 2.5);
    float along = vUv.x;
    float taper = smoothstep(0.0, 0.2, along) * smoothstep(1.0, 0.9, along) * (0.25 + 0.75 * along);
    col = vColor.rgb * (core * taper * vColor.a);
  }
  float fade = vEnergy * atmoTransmittance(vWorld - cameraPosition);
  gl_FragColor = vec4(min(col * fade, vec3(32.0)), occlusion * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────── Ribbons

export const RIBBON_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PX_PER_UNIT}
attribute vec3 aSide;
attribute vec4 aData;
varying vec3 vWorld;
varying vec3 vSide;
varying vec4 vData;
varying float vAcross;
varying float vCover;

void main() {
  float across = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  vec3 center = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(center, 1.0);
  float ppu = fxPxPerUnit(-mv.z);
  float hwPx = aData.w * ppu;
  float hwc = max(hwPx, ${f(MIN_RIBBON_HALF_PX)});
  vCover = hwPx / max(hwc, 1e-6);
  float hw = hwc / ppu;
  vec3 world = center + aSide * (hw * across);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
  vWorld = world;
  vSide = aSide;
  vAcross = across;
  vData = vec4(aData.xyz, hw);
}
`;

const RIBBON_FRAGMENT_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
${SMOKE_LIGHT}
uniform sampler2D uNoise;
uniform vec3 uTrailColor[${RIBBON_KINDS}];
uniform vec4 uTrailParams[${RIBBON_KINDS}];
uniform float uFxTime;
varying vec3 vWorld;
varying vec3 vSide;
varying vec4 vData;
varying float vAcross;
varying float vCover;
`;

export const RIBBON_ALPHA_FRAGMENT = /* glsl */ `
${RIBBON_FRAGMENT_HEAD}
void main() {
  #include <logdepthbuf_fragment>
  int k = int(vData.z + 0.5);
  vec3 kc = uTrailColor[k];
  vec4 kp = uTrailParams[k];
  float across = vAcross;
  vec2 nuv = vec2(vData.x, across * 0.2 + vData.x * 0.13);
  float n1 = texture(uNoise, nuv).b;
  float n2 = texture(uNoise, nuv * vec2(2.7, 3.1) + 0.37).r;
  float n3 = texture(uNoise, vec2(vData.x * 0.21, 0.5)).g;
  float noise = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
  // Billowy edges: the tube radius itself wanders with the noise.
  float edge = across * (1.0 + n2 * 0.9 * kp.x);
  float prof = max(1.0 - edge * edge, 0.0);
  float density = clamp(prof * (1.0 - kp.x + kp.x * noise * 2.1), 0.0, 1.0);
  vec3 ray = vWorld - cameraPosition;
  float dist = length(ray);
  float alpha = density * vData.y * vCover;
  alpha *= smoothstep(vData.w * 0.6, vData.w * 4.0, dist);
  if (alpha < 0.002) discard;
  vec3 toCam = -ray / max(dist, 1e-3);
  vec3 n = normalize(vSide * across + toCam * (sqrt(prof) + 0.2));
  vec3 col = kc * (fxSmokeLight(n, toCam, density) + atmoFlash(vWorld, n));
  col = atmoApply(col, ray);
  gl_FragColor = vec4(col * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const RIBBON_ADD_FRAGMENT = /* glsl */ `
${RIBBON_FRAGMENT_HEAD}
void main() {
  #include <logdepthbuf_fragment>
  int k = int(vData.z + 0.5);
  vec3 kc = uTrailColor[k];
  vec4 kp = uTrailParams[k];
  float across = vAcross;
  float prof = max(1.0 - across * across, 0.0);
  float n = texture(uNoise, vec2(vData.x - uFxTime * 1.7, across * 0.25 + vData.x * 0.1)).r;
  float core = pow(prof, 1.6) * mix(1.0, 0.35 + 1.3 * n, kp.x);
  float fade = vData.y * vCover * atmoTransmittance(vWorld - cameraPosition);
  gl_FragColor = vec4(min(kc * core * fade, vec3(32.0)), core * fade * kp.y);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────── Distant-aircraft dots (ZD-B36)

export const DOT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${PX_PER_UNIT}
uniform vec2 uDotPx;
attribute vec4 iPos;
attribute vec4 iColor;
varying vec2 vPx;
varying float vDiam;
varying vec4 vColor;
varying vec3 vWorld;

void main() {
  vec3 center = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(center, 1.0);
  float depth = -mv.z;
  float diam = clamp(iPos.w * fxPxPerUnit(depth), uDotPx.x, uDotPx.y);
  float quad = diam + 2.0;
  vec4 clip = projectionMatrix * mv;
  clip.xy += position.xy * quad / (0.5 * uViewport) * clip.w;
  gl_Position = depth > 0.01 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
  vPx = position.xy * quad;
  vDiam = diam;
  vColor = iColor;
  vWorld = center;
}
`;

export const DOT_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
varying vec2 vPx;
varying float vDiam;
varying vec4 vColor;
varying vec3 vWorld;

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vPx);
  float a = clamp(vDiam * 0.5 + 0.5 - r, 0.0, 1.0) * vColor.a;
  if (a < 0.004) discard;
  vec3 ray = vWorld - cameraPosition;
  // Haze lightens distant aircraft but never hides them completely.
  float haze = min(1.0 - atmoTransmittance(ray), 0.6);
  vec3 col = mix(vColor.rgb, atmoSky(normalize(ray)), haze);
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────── Debris chunks

export const DEBRIS_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 iPos;
attribute vec4 iQuat;
attribute vec4 iScale;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vBurn;
varying float vTint;

vec3 fxRotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  vec3 local = position * iScale.xyz;
  vec3 world = (modelMatrix * vec4(iPos.xyz + fxRotate(iQuat, local), 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
  vWorld = world;
  vN = fxRotate(iQuat, normal / max(iScale.xyz, vec3(1e-3)));
  vLocal = position;
  vBurn = iPos.w;
  vTint = iScale.w;
}
`;

export const DEBRIS_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
uniform sampler2D uNoise;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vBurn;
varying float vTint;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  vec3 base = mix(vec3(0.03, 0.028, 0.026), vec3(0.1, 0.095, 0.088), vTint);
  vec3 amb = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
  vec3 col = base * (uSunColor * max(dot(n, uSunDir), 0.0) + amb + atmoFlash(vWorld, n));
  float cracks = texture(uNoise, vLocal.xz * 0.45 + vLocal.y * 0.3).a;
  col += vBurn * vec3(4.2, 1.4, 0.3) * smoothstep(0.62, 0.9, cracks);
  col = atmoApply(col, vWorld - cameraPosition);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

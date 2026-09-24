import { ATMOSPHERE_GLSL } from '../render/atmosphere';
import { NOISE_GLSL } from './glsl/noise';
import { TERRAIN_SAMPLE_GLSL } from './glsl/terrainSample';

export const MAX_RUNWAYS = 4;
export const MAX_TAXI = 40;
export const MAX_APRONS = 8;
export const MAX_LEVELS = 16;
/** Road distance encoded in the mask's blue channel covers 0..ROAD_REACH meters. */
export const ROAD_REACH = 48;

export const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_SAMPLE_GLSL}
attribute vec4 aNode;
uniform float uGridDim;
uniform vec2 uMorph[${MAX_LEVELS}];
varying vec3 vWorld;
varying vec3 vTerrain;

void main() {
  vec2 g = position.xz;
  float spacing = aNode.z / uGridDim;
  vec2 wp = aNode.xy + g * spacing;
  float h = terrainHeight(wp);
  float dist = distance(cameraPosition, vec3(wp.x, h, wp.y));
  int lvl = int(aNode.w + 0.5);
  vec2 m = uMorph[lvl];
  float k = clamp((dist - m.x) * m.y, 0.0, 1.0);
  vec2 odd = fract(g * 0.5) * 2.0;
  wp -= odd * spacing * k;
  h = terrainHeight(wp);
  float y = h;
  if (position.y > 0.5) y -= spacing * 0.5 + 1.0;
  vTerrain = vec3(wp.x, h, wp.y);
  vec3 world = vec3(wp.x, y, wp.y);
  world.y -= horizonDrop(world.xz - cameraPosition.xz);
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const AIRBASE_GLSL = /* glsl */ `
uniform int uRwyCount;
uniform vec4 uRwyA[${MAX_RUNWAYS}];
uniform vec4 uRwyB[${MAX_RUNWAYS}];
uniform int uTaxiCount;
uniform vec4 uTaxi[${MAX_TAXI}];
uniform float uTaxiHalfW;
uniform int uApronCount;
uniform vec4 uApronA[${MAX_APRONS}];
uniform vec4 uApronB[${MAX_APRONS}];
uniform vec4 uBaseBox;
uniform vec4 uGroundsA;
uniform vec4 uGroundsB;

// Box-filtered 1D band: coverage of [-hw, hw] by a pixel footprint of width aa centred at d.
float band(float d, float hw, float aa) {
  float lo = max(d - aa * 0.5, -hw);
  float hi = min(d + aa * 0.5, hw);
  return clamp((hi - lo) / aa, 0.0, 1.0);
}

// Periodic dashes along x: dash length len, period per; fades to the duty cycle when too small to resolve.
float dashes(float x, float len, float per, float aa) {
  float m = mod(x, per) - len * 0.5;
  return mix(band(m, len * 0.5, aa), len / per, smoothstep(per * 0.25, per, aa));
}

const vec4 DIGITS[50] = vec4[50](
  vec4(0.0, 0.0, 3.0, 0.0), vec4(3.0, 0.0, 3.0, 5.0), vec4(3.0, 5.0, 0.0, 5.0), vec4(0.0, 5.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 0.0),
  vec4(1.8, 0.0, 1.8, 5.0), vec4(1.8, 5.0, 0.6, 3.9), vec4(0.6, 0.0, 3.0, 0.0), vec4(1.8, 0.0, 1.8, 0.0), vec4(1.8, 0.0, 1.8, 0.0),
  vec4(0.0, 5.0, 3.0, 5.0), vec4(3.0, 5.0, 3.0, 2.5), vec4(3.0, 2.5, 0.0, 2.5), vec4(0.0, 2.5, 0.0, 0.0), vec4(0.0, 0.0, 3.0, 0.0),
  vec4(0.0, 5.0, 3.0, 5.0), vec4(3.0, 5.0, 3.0, 0.0), vec4(3.0, 0.0, 0.0, 0.0), vec4(0.8, 2.5, 3.0, 2.5), vec4(0.0, 0.0, 0.0, 0.0),
  vec4(0.0, 5.0, 0.0, 1.8), vec4(0.0, 1.8, 3.0, 1.8), vec4(2.3, 3.4, 2.3, 0.0), vec4(2.3, 0.0, 2.3, 0.0), vec4(2.3, 0.0, 2.3, 0.0),
  vec4(3.0, 5.0, 0.0, 5.0), vec4(0.0, 5.0, 0.0, 2.7), vec4(0.0, 2.7, 3.0, 2.7), vec4(3.0, 2.7, 3.0, 0.0), vec4(3.0, 0.0, 0.0, 0.0),
  vec4(3.0, 5.0, 0.0, 5.0), vec4(0.0, 5.0, 0.0, 0.0), vec4(0.0, 0.0, 3.0, 0.0), vec4(3.0, 0.0, 3.0, 2.6), vec4(3.0, 2.6, 0.0, 2.6),
  vec4(0.0, 5.0, 3.0, 5.0), vec4(3.0, 5.0, 1.0, 0.0), vec4(1.0, 0.0, 1.0, 0.0), vec4(1.0, 0.0, 1.0, 0.0), vec4(1.0, 0.0, 1.0, 0.0),
  vec4(0.0, 0.0, 3.0, 0.0), vec4(3.0, 0.0, 3.0, 5.0), vec4(3.0, 5.0, 0.0, 5.0), vec4(0.0, 5.0, 0.0, 0.0), vec4(0.0, 2.5, 3.0, 2.5),
  vec4(3.0, 2.4, 0.0, 2.4), vec4(0.0, 2.4, 0.0, 5.0), vec4(0.0, 5.0, 3.0, 5.0), vec4(3.0, 5.0, 3.0, 0.0), vec4(3.0, 0.0, 0.0, 0.0)
);

float digitDist(int digit, vec2 q) {
  float d = 1e5;
  for (int k = 0; k < 5; k++) {
    vec4 s = DIGITS[digit * 5 + k];
    d = min(d, nzSdSegment(q, s.xy, s.zw));
  }
  return d;
}

// Two-digit runway designator. x across (m, 0 = centerline, + = pilot's right), y from the number's base (m).
float designator(float number, vec2 xy, float aa) {
  if (xy.y < -2.0 || xy.y > 20.0 || abs(xy.x) > 10.0) return 0.0;
  int tens = int(floor(number / 10.0 + 0.01));
  int ones = int(number - float(tens) * 10.0 + 0.01);
  vec2 unit = vec2(2.0, 3.6);
  vec2 qa = (xy - vec2(-7.5, 0.0)) / unit;
  vec2 qb = (xy - vec2(1.5, 0.0)) / unit;
  float da = digitDist(tens, qa) * 2.4;
  float db = digitDist(ones, qb) * 2.4;
  float d = min(da, db);
  return clamp((0.8 - d) / aa + 0.5, 0.0, 1.0) * clamp(2.5 / aa, 0.0, 1.0);
}

// Paints paved surfaces and markings. Returns paved coverage; col receives the paved albedo.
float paintAirbase(vec2 p, float aa, vec4 nz, inout vec3 col, inout float grass) {
  if (p.x < uBaseBox.x || p.y < uBaseBox.y || p.x > uBaseBox.z || p.y > uBaseBox.w) return 0.0;
  float paved = 0.0;
  vec3 pcol = vec3(0.0);
  float mark = 0.0;
  vec3 markCol = vec3(0.0);

  // Mown grass inside the airfield grounds.
  {
    vec2 r = p - uGroundsA.xy;
    vec2 lp = vec2(dot(r, uGroundsA.zw), dot(r, vec2(-uGroundsA.w, uGroundsA.z)));
    vec2 q = max(abs(lp) - uGroundsB.xy, 0.0);
    grass = 1.0 - smoothstep(0.0, uGroundsB.z, length(q));
  }

  // Aprons: light concrete with slab joints.
  for (int i = 0; i < ${MAX_APRONS}; i++) {
    if (i >= uApronCount) break;
    vec4 a = uApronA[i];
    vec4 b = uApronB[i];
    vec2 r = p - a.xy;
    vec2 lp = vec2(dot(r, a.zw), dot(r, vec2(-a.w, a.z)));
    float cov = band(lp.x, b.x, aa) * band(lp.y, b.y, aa);
    if (cov > 0.0) {
      float joints = 1.0 - 0.35 * max(dashes(lp.x, 0.25, 7.5, aa), dashes(lp.y, 0.25, 7.5, aa));
      float slab = 0.9 + 0.1 * nzHash1(floor(lp / 7.5) + 311.0);
      vec3 c = vec3(0.33, 0.325, 0.31) * slab * joints * (0.85 + 0.3 * nz.r);
      pcol = mix(pcol, c, cov);
      paved = max(paved, cov);
      // Yellow lead-in lines across the apron.
      float lead = band(mod(lp.y + 20.0, 40.0) - 20.0, 0.22, aa) * band(lp.x, b.x - 12.0, aa);
      mark = max(mark, lead * cov);
      markCol = vec3(0.55, 0.38, 0.05);
    }
  }

  // Taxiways: asphalt with a yellow centerline.
  for (int i = 0; i < ${MAX_TAXI}; i++) {
    if (i >= uTaxiCount) break;
    vec4 s = uTaxi[i];
    float d = nzSdSegment(p, s.xy, s.zw);
    float cov = band(d, uTaxiHalfW, aa);
    if (cov > 0.0) {
      vec3 c = vec3(0.075, 0.074, 0.072) * (0.8 + 0.4 * nz.r);
      pcol = mix(pcol, c, cov * (1.0 - paved * 0.5));
      paved = max(paved, cov);
      float cl = band(d, 0.2, aa) * clamp(1.2 / aa, 0.0, 1.0);
      if (cl > mark) {
        mark = cl;
        markCol = vec3(0.6, 0.42, 0.04);
      }
    }
  }

  // Runways.
  for (int i = 0; i < ${MAX_RUNWAYS}; i++) {
    if (i >= uRwyCount) break;
    vec4 a = uRwyA[i];
    vec4 b = uRwyB[i];
    vec2 r = p - a.xy;
    float u = dot(r, a.zw);
    float v = dot(r, vec2(-a.w, a.z));
    float halfL = b.x;
    float halfW = b.y;
    float shoulder = band(u, halfL + 6.0, aa) * band(v, halfW + 7.5, aa);
    if (shoulder <= 0.0) continue;
    float cov = band(u, halfL, aa) * band(v, halfW, aa);
    // Asphalt: longitudinal paving lanes, patch repairs, rubber in the touchdown zones.
    float lane = 0.93 + 0.07 * nzHash1(vec2(floor(v / 7.5), 17.0));
    float patchN = nzHash1(floor(vec2(u / 23.0, v / 7.5)) + 91.0);
    float patchy = patchN > 0.86 ? 1.12 : 1.0;
    float s = halfL - abs(u);
    float rubber = smoothstep(180.0, 320.0, s) * (1.0 - smoothstep(700.0, 1100.0, s))
      * (1.0 - smoothstep(4.0, 12.0, abs(v))) * (0.55 + 0.45 * nz.a);
    vec3 asphalt = vec3(0.062, 0.061, 0.06) * lane * patchy * (0.85 + 0.3 * nz.r) * (1.0 - 0.45 * rubber);
    vec3 shoulderCol = vec3(0.13, 0.128, 0.12) * (0.8 + 0.3 * nz.r);
    vec3 c = mix(shoulderCol, asphalt, cov);
    pcol = mix(pcol, c, shoulder);
    paved = max(paved, shoulder);

    // Markings (white).
    float m = 0.0;
    float edge = band(abs(v) - (halfW - 0.9), 0.45, aa) * band(u, halfL, aa);
    m = max(m, edge);
    float centre = band(v, 0.45, aa) * dashes(u + halfL, 36.0, 60.0, aa) * step(62.0, s);
    m = max(m, centre);
    // Threshold bars ("piano keys") 6..36 m from each end.
    float keys = band(s - 21.0, 15.0, aa) * band(abs(v), halfW - 3.0, aa) * step(3.0, abs(v))
      * dashes(abs(v) - 3.0, 1.8, 3.6, aa);
    m = max(m, keys);
    // Threshold line across the runway.
    m = max(m, band(s - 3.0, 0.9, aa) * band(v, halfW - 1.0, aa));
    // Aiming point and touchdown zone bars.
    float aim = band(s - 322.0, 22.5, aa) * band(abs(v) - (halfW * 0.25 + 4.0), 3.0, aa);
    float tdz = 0.0;
    for (int k = 0; k < 5; k++) {
      float at = 161.0 + 150.0 * float(k);
      if (k == 1) continue;
      float bars = k == 0 ? 3.0 : (k < 3 ? 2.0 : 1.0);
      float span = bars * 3.3;
      float lv = abs(v) - 4.5;
      float inBars = band(lv - span * 0.5, span * 0.5, aa) * dashes(lv, 1.8, 3.3, aa);
      tdz = max(tdz, band(s - at, 11.25, aa) * inBars);
    }
    m = max(m, max(aim, tdz) * step(0.0, s));
    // Designators past the threshold bars, readable from each approach direction.
    float num = u < 0.0 ? b.z : b.w;
    float across = u < 0.0 ? v : -v;
    m = max(m, designator(num, vec2(across, s - 48.0), aa));
    m *= cov;
    if (m > mark) {
      mark = m;
      markCol = vec3(0.62, 0.62, 0.6) * (0.9 + 0.2 * nz.r);
    }
  }

  if (paved > 0.0) {
    col = mix(col, pcol, paved);
    col = mix(col, markCol, mark * paved);
  }
  return paved;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
${NOISE_GLSL}
${TERRAIN_SAMPLE_GLSL}
${AIRBASE_GLSL}
uniform sampler2D uBakeNear;
uniform sampler2D uBakeFar;
uniform sampler2D uMaskNear;
uniform sampler2D uMaskFar;
uniform sampler2D uDetail;
uniform float uWaterLevel;
uniform vec2 uFarFade;
uniform vec3 uGrass;
uniform vec3 uGrassDry;
uniform vec3 uForest;
uniform vec3 uRock;
uniform vec3 uCliff;
uniform vec3 uSand;
uniform vec3 uSnow;
uniform vec3 uDirt;
uniform vec3 uField0;
uniform vec3 uField1;
uniform vec3 uField2;
uniform vec3 uField3;
uniform vec3 uUrban;
uniform vec3 uSeabed;
uniform vec4 uSnowP;   // line, fade, beach height, strata
uniform vec4 uSlopeP;  // rock slope, cliff slope, field size, field mode
uniform float uRoadHalfW;
varying vec3 vWorld;
varying vec3 vTerrain;

vec2 domUv(vec2 p, vec4 dom) {
  return ((p - dom.xy) / dom.z + 0.5) / dom.w;
}

vec3 detailNormal(vec4 t) {
  vec2 xy = t.gb * 2.0 - 1.0;
  return vec3(xy.x, sqrt(max(1.0 - dot(xy, xy), 0.0)), xy.y);
}

// Land-use cells: warped, rotated jittered grid with occasional splits. Returns (cell hash, border distance m, stripe dir).
vec3 fieldCells(vec2 p, float size) {
  float ang = nzFbm(p / 9000.0, 2) * 1.2;
  vec2 cs = vec2(cos(ang), sin(ang));
  vec2 q = vec2(dot(p, cs), dot(p, vec2(-cs.y, cs.x)));
  q += vec2(nzFbm(q / 700.0 + 3.0, 3), nzFbm(q / 700.0 - 7.0, 3)) * size * 0.35;
  vec2 cellSize = vec2(size, size * 0.72);
  vec2 g = q / cellSize;
  vec2 id = floor(g);
  vec2 f = g - id;
  float h = nzHash1(id + 7.0);
  // Split some cells into two strips along the longer axis.
  if (h > 0.55) {
    float cut = 0.3 + 0.4 * nzHash1(id + 19.0);
    float side = step(cut, f.x);
    f.x = side > 0.5 ? (f.x - cut) / (1.0 - cut) : f.x / cut;
    cellSize.x *= side > 0.5 ? (1.0 - cut) : cut;
    id += vec2(side * 0.5, 0.0);
    h = nzHash1(id * 3.1 + 5.0);
  }
  vec2 e = min(f, 1.0 - f) * cellSize;
  return vec3(h, min(e.x, e.y), nzHash1(id + 41.0));
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vTerrain.xz;
  float h = vTerrain.y;
  float wFar = tsFarWeight(p);
  vec4 bake;
  vec4 mask;
  if (wFar <= 0.0) {
    vec2 uv = domUv(p, uNearDom);
    bake = texture2D(uBakeNear, uv);
    mask = texture2D(uMaskNear, uv);
  } else if (wFar >= 1.0) {
    vec2 uv = domUv(p, uFarDom);
    bake = texture2D(uBakeFar, uv);
    mask = texture2D(uMaskFar, uv);
  } else {
    vec2 un = domUv(p, uNearDom);
    vec2 uf = domUv(p, uFarDom);
    bake = mix(texture2D(uBakeNear, un), texture2D(uBakeFar, uf), wFar);
    mask = mix(texture2D(uMaskNear, un), texture2D(uMaskFar, uf), wFar);
  }
  vec3 N = vec3(bake.x * 2.0 - 1.0, 0.0, bake.y * 2.0 - 1.0);
  N.y = sqrt(max(1.0 - dot(N.xz, N.xz), 0.02));
  N = normalize(N);
  float sunVis = bake.z;
  float ao = bake.w;
  float forest = mask.r;
  float landuse = mask.g;
  float roadD = mask.b * ${ROAD_REACH.toFixed(1)};
  float urban = mask.a;

  vec3 ray = vWorld - cameraPosition;
  float dist = length(ray);
  float aa = max(length(fwidth(p)), 0.02);
  float near = 1.0 - smoothstep(600.0, 4000.0, dist);

  // Detail textures at several scales and rotations (tiling is broken by the macro layers).
  vec4 d1 = texture2D(uDetail, p / 41.0);
  vec4 d2 = texture2D(uDetail, mat2(0.8, -0.6, 0.6, 0.8) * p / 197.0);
  vec4 d3 = texture2D(uDetail, p / 6.7);
  float macroA = texture2D(uDetail, mat2(0.6, 0.8, -0.8, 0.6) * p / 3900.0).r;
  float macroB = texture2D(uDetail, p / 16000.0 + 0.3).r;
  float macro = macroA * 0.6 + macroB * 0.4;
  float slope = 1.0 - N.y;
  float above = h - uWaterLevel;

  // Base ground: grass drying out with macro variation and sun-facing slopes.
  float dry = smoothstep(0.35, 0.75, macro + (d2.r - 0.5) * 0.35 + max(dot(N.xz, uSunDir.xz), 0.0) * 0.4);
  vec3 col = mix(uGrass, uGrassDry, dry);
  col *= 0.82 + 0.36 * mix(d2.r, d1.r, 0.5);
  float dirtW = smoothstep(0.62, 0.8, d2.r * 0.7 + macroA * 0.5 + slope * 0.8);
  col = mix(col, uDirt * (0.85 + 0.3 * d1.r), dirtW * 0.7);

  // Land use (fields, playa or meadows).
  if (landuse > 0.01) {
    vec3 fc = fieldCells(p, uSlopeP.z);
    vec3 fcol = fc.x < 0.3 ? uField0 : fc.x < 0.55 ? uField1 : fc.x < 0.8 ? uField2 : uField3;
    fcol *= 0.9 + 0.2 * nzHash1(vec2(fc.x * 97.0, 3.0));
    float mode = uSlopeP.w;
    if (mode < 0.5) {
      // Crop rows and hedgerows.
      float rowDir = fc.z * 3.14159;
      vec2 rd = vec2(cos(rowDir), sin(rowDir));
      float rows = dashes(dot(p, rd), 1.2, 3.2, aa);
      fcol *= 1.0 - 0.12 * rows * near * step(0.3, fc.x);
      float hedge = 1.0 - smoothstep(1.5, 4.5 + aa * 0.5, fc.y);
      hedge *= step(0.25, nzHash1(floor(p / 60.0) + fc.x));
      fcol = mix(fcol, uForest * 0.9, hedge * 0.85);
      fcol *= 0.9 + 0.2 * d1.r;
    } else if (mode < 1.5) {
      // Playa: pale cracked clay with faint polygon cracks near the camera.
      float cracks = 1.0 - smoothstep(0.02, 0.08, d3.a);
      fcol = mix(uField0, uField1, smoothstep(0.3, 0.7, macroA + d2.r * 0.3));
      fcol *= 1.0 - 0.25 * cracks * near;
      fcol *= 0.92 + 0.12 * d1.r;
    } else {
      fcol = mix(col, fcol, 0.6);
    }
    col = mix(col, fcol, landuse);
  }

  // Forest canopy: clumped crowns with self-shading.
  if (forest > 0.01) {
    float crowns = smoothstep(0.1, 0.55, texture2D(uDetail, p / 23.0).a);
    vec3 fcol = uForest * (0.6 + 0.55 * crowns) * (0.85 + 0.3 * d2.r) * (0.9 + 0.2 * macroA);
    col = mix(col, fcol, smoothstep(0.0, 0.35, forest));
    ao *= 1.0 - 0.25 * forest * (1.0 - crowns);
  }

  // Beaches and seabed.
  float beach = (1.0 - smoothstep(uSnowP.z * 0.5, uSnowP.z, above + (d2.r - 0.5) * 2.5)) * (1.0 - smoothstep(0.18, 0.4, slope));
  col = mix(col, uSand * (0.88 + 0.24 * d1.r), beach);
  float wet = 1.0 - smoothstep(-0.2, 0.6, above);
  col *= 1.0 - 0.3 * wet;
  if (above < 0.0) col = mix(col, uSeabed * (0.8 + 0.4 * d2.r), smoothstep(0.0, -3.0, above));

  // Settlements and roads.
  col = mix(col, uUrban * (0.8 + 0.4 * d1.a) * (0.85 + 0.3 * d2.r), urban * 0.85);
  float road = band(roadD, uRoadHalfW, aa + 0.5) * step(0.0, above);
  col = mix(col, vec3(0.085, 0.083, 0.08) * (0.85 + 0.3 * d1.r), road);

  // Rock and cliffs with triplanar sampling on steep faces (no stretching).
  float rockW = smoothstep(uSlopeP.x - 0.06, uSlopeP.x + 0.1, slope + (d2.r - 0.5) * 0.12);
  if (rockW > 0.01) {
    vec3 an = abs(N);
    vec3 tw = an * an * an;
    tw /= tw.x + tw.y + tw.z;
    vec4 tx = texture2D(uDetail, vec2(vTerrain.z, vTerrain.y) / 29.0);
    vec4 ty = texture2D(uDetail, vTerrain.xz / 29.0);
    vec4 tz = texture2D(uDetail, vec2(vTerrain.x, vTerrain.y) / 29.0);
    vec4 tri = tx * tw.x + ty * tw.y + tz * tw.z;
    vec4 tx2 = texture2D(uDetail, vec2(vTerrain.z, vTerrain.y * 1.6) / 7.0);
    vec4 tz2 = texture2D(uDetail, vec2(vTerrain.x, vTerrain.y * 1.6) / 7.0);
    float fine = mix(tx2.r, tz2.r, tw.z / max(tw.x + tw.z, 1e-3));
    float strata = uSnowP.w * (0.5 + 0.5 * sin(h * 0.19 + tri.r * 2.5 + macroA * 6.0));
    vec3 rc = mix(uRock, uCliff, smoothstep(uSlopeP.y - 0.1, uSlopeP.y + 0.1, slope));
    rc *= (0.72 + 0.5 * tri.r) * (0.85 + 0.3 * fine) * (1.0 - 0.28 * strata);
    rc *= 0.9 + 0.2 * macroB;
    col = mix(col, rc, rockW);
    vec3 tn = normalize(vec3((tri.g - 0.5) * 2.0, 1.0, (tri.b - 0.5) * 2.0));
    N = normalize(N + (tn - vec3(0.0, 1.0, 0.0)) * rockW * 0.9 * near);
  }

  // Snow on high ground, sliding off steep faces.
  float snow = smoothstep(uSnowP.x - uSnowP.y, uSnowP.x + uSnowP.y, h + (d2.r - 0.5) * 120.0 + (macroA - 0.5) * 160.0);
  snow *= 1.0 - smoothstep(0.42, 0.7, slope - (d1.r - 0.5) * 0.15);
  col = mix(col, uSnow * (0.9 + 0.1 * d1.r), snow);

  float grassMown = 0.0;
  float paved = paintAirbase(p, aa, d3, col, grassMown);
  col = mix(col, mix(uGrass, uGrassDry, 0.25) * (0.9 + 0.2 * d2.r), grassMown * (1.0 - paved) * 0.7);

  // Detail normal for everything that is not paved.
  vec3 dn = detailNormal(d1) * 0.6 + detailNormal(d3) * 0.4;
  N = normalize(N + (dn - vec3(0.0, 1.0, 0.0)) * (0.55 * near) * (1.0 - paved) * (1.0 - snow * 0.6));

  // Lighting (three.js convention: radiance = albedo / PI * irradiance).
  float ndl = max(dot(N, uSunDir), 0.0);
  float shadow = sunVis * atmoGroundShadow(vWorld);
  vec3 sky = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5);
  vec3 irradiance = uSunColor * ndl * shadow + sky * ao;
  vec3 color = col * irradiance * RECIPROCAL_PI + col * atmoFlash(vWorld, N);
  // Faint sheen on snow and wet sand toward the sun.
  vec3 V = -ray / max(dist, 1e-3);
  vec3 H = normalize(V + uSunDir);
  color += uSunColor * pow(max(dot(N, H), 0.0), 60.0) * (snow * 0.12 + wet * 0.08) * shadow;

  color = atmoApply(color, ray);
  color = mix(color, atmoSky(ray / max(dist, 1e-3)), smoothstep(uFarFade.x, uFarFade.y, dist));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Noise library for map generation and procedural textures (GLSL ES 3.00).
 *
 *  vec2  nzHash2(vec2 cell)                 lattice hash to [-1, 1]^2 (integer PCG-style, seeded by uNzSeed)
 *  float nzHash1(vec2 cell)                 lattice hash to [0, 1]
 *  vec3  nzGrad(vec2 p)                     gradient noise, returns (value, d/dx, d/dy), value in ~[-0.7, 0.7]
 *  vec3  nzGradTile(vec2 p, vec2 period)    periodic variant for tileable textures
 *  float nzFbm(vec2 p, int oct)             fBm of nzGrad, ~[-1, 1]
 *  vec3  nzFbmD(vec2 p, int oct)            fBm with analytic derivatives
 *  float nzRidged(vec2 p, int oct)          ridged multifractal, [0, ~1]
 *  float nzEroded(vec2 p, int oct)          derivative-damped fBm: smooth valleys, sharp ridges
 *  vec3  nzGully(vec2 p, vec2 flow)         directional stripes aligned with a downhill flow (erosion gullies)
 *  vec2  nzWarp(vec2 p, float amp, int oct) domain warp offset
 *  float nzCell(vec2 p)                     cellular (F1) distance
 */
export const NOISE_GLSL = /* glsl */ `
uniform vec2 uNzSeed;
const mat2 NZ_ROT = mat2(0.80, 0.60, -0.60, 0.80);

uvec2 nzPcg(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}

vec2 nzHash2(vec2 cell) {
  uvec2 q = uvec2(ivec2(cell + uNzSeed));
  return vec2(nzPcg(q)) * (2.0 / 4294967295.0) - 1.0;
}

float nzHash1(vec2 cell) {
  uvec2 q = uvec2(ivec2(cell + uNzSeed));
  return float(nzPcg(q).x) * (1.0 / 4294967295.0);
}

vec3 nzGradCells(vec2 i, vec2 f, vec2 i1, vec2 i2, vec2 i3) {
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = nzHash2(i);
  vec2 gb = nzHash2(i1);
  vec2 gc = nzHash2(i2);
  vec2 gd = nzHash2(i3);
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
    + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(value, deriv);
}

vec3 nzGrad(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  return nzGradCells(i, f, i + vec2(1.0, 0.0), i + vec2(0.0, 1.0), i + vec2(1.0, 1.0));
}

vec3 nzGradTile(vec2 p, vec2 period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 a = mod(i, period);
  vec2 b = mod(i + 1.0, period);
  return nzGradCells(a, f, vec2(b.x, a.y), vec2(a.x, b.y), b);
}

float nzFbm(vec2 p, int oct) {
  float a = 0.0;
  float b = 0.5;
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    a += b * nzGrad(p).x;
    b *= 0.5;
    p = NZ_ROT * p * 2.03 + vec2(17.1, -9.3);
  }
  return a * 2.0;
}

vec3 nzFbmD(vec2 p, int oct) {
  vec3 acc = vec3(0.0);
  float b = 0.5;
  mat2 m = mat2(1.0);
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    vec3 n = nzGrad(p);
    acc.x += b * n.x;
    acc.yz += b * (m * n.yz);
    b *= 0.5;
    p = NZ_ROT * p * 2.03 + vec2(17.1, -9.3);
    m = 2.03 * transpose(NZ_ROT) * m;
  }
  return acc * 2.0;
}

float nzRidged(vec2 p, int oct) {
  float sum = 0.0;
  float amp = 0.5;
  float weight = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    float s = 1.0 - abs(nzGrad(p).x * 1.6);
    s *= s;
    s *= weight;
    weight = clamp(s * 1.8, 0.0, 1.0);
    sum += s * amp;
    norm += amp;
    amp *= 0.5;
    p = NZ_ROT * p * 2.07 + vec2(-5.3, 11.7);
  }
  return sum / norm;
}

float nzEroded(vec2 p, int oct) {
  float a = 0.0;
  float b = 0.5;
  vec2 d = vec2(0.0);
  mat2 m = mat2(1.0);
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    vec3 n = nzGrad(p);
    d += m * n.yz * b * 1.4;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = NZ_ROT * p * 2.01 + vec2(3.7, 1.9);
    m = 2.01 * transpose(NZ_ROT) * m;
  }
  return a * 2.0;
}

// Directional stripes: sum of Gaussian-weighted plane waves whose crests run along the flow direction.
// Returns (value in ~[-1, 1], derivative x, derivative y).
vec3 nzGully(vec2 p, vec2 flow) {
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  vec2 across = vec2(-flow.y, flow.x);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int j = -1; j <= 2; j++) {
    for (int i = -1; i <= 2; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = o + nzHash2(ip + o) * 0.45;
      vec2 v = fp - c;
      float w = exp(-dot(v, v) * 1.8);
      float ph = dot(v, across) * 6.2831853;
      acc += vec3(cos(ph), -sin(ph) * across * 6.2831853) * w;
      wsum += w;
    }
  }
  return acc / max(wsum, 1e-4);
}

vec2 nzWarp(vec2 p, float amp, int oct) {
  return amp * vec2(nzFbm(p + vec2(13.7, 71.3), oct), nzFbm(p + vec2(-51.1, 29.9), oct));
}

float nzCell(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  float best = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = o + 0.5 + 0.45 * nzHash2(ip + o);
      vec2 v = fp - c;
      best = min(best, dot(v, v));
    }
  }
  return sqrt(best);
}

float nzSmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float nzSmax(float a, float b, float k) {
  return -nzSmin(-a, -b, k);
}

float nzSdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
`;

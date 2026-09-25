/**
 * Procedural sprite textures for the effects (no image files). Generated once on the CPU at creation:
 *  - a 16-layer array of 128² sprites (RGBA8): R = density/mask, G/B = lobe normal (xy, 0.5 = flat), A = detail
 *  - a tileable 128² noise texture (RGBA8): R/G fBm, B billow, A ridged, used to animate fire and ribbons.
 * Pure functions over typed arrays so they are unit-testable in Node.
 */
import { Rng, hash2 } from '../core/rng';
import { ATLAS_LAYERS, ATLAS_SIZE, LAYER, NOISE_SIZE } from './tuning';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Value noise with a smooth quintic fade; `period` (lattice cells) makes it tile, 0 disables tiling. */
export function valueNoise(x: number, y: number, seed: number, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let x0 = xi;
  let y0 = yi;
  let x1 = xi + 1;
  let y1 = yi + 1;
  if (period > 0) {
    x0 = ((x0 % period) + period) % period;
    y0 = ((y0 % period) + period) % period;
    x1 = ((x1 % period) + period) % period;
    y1 = ((y1 % period) + period) % period;
  }
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal sum normalized to 0..1. kind 0 = fBm, 1 = billow (puffy), 2 = ridged (sharp creases). */
export function fractal(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  kind: number,
  period = 0,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    let n = valueNoise(x * f, y * f, seed + o * 131, period > 0 ? period * f : 0);
    if (kind === 1) n = Math.abs(n * 2 - 1);
    else if (kind === 2) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

const S = ATLAS_SIZE;
const LAYER_BYTES = S * S * 4;

function writeNormals(out: Uint8Array, layer: number, height: Float32Array, strength: number): void {
  const base = layer * LAYER_BYTES;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < S - 1 ? x + 1 : x;
      const yd = y > 0 ? y - 1 : y;
      const yu = y < S - 1 ? y + 1 : y;
      const dx = (height[y * S + xr]! - height[y * S + xl]!) * strength;
      const dy = (height[yu * S + x]! - height[yd * S + x]!) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = base + (y * S + x) * 4;
      out[o + 1] = Math.round(clamp01(-dx * inv * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round(clamp01(-dy * inv * 0.5 + 0.5) * 255);
    }
  }
}

type Shader = (u: number, v: number, r: number, px: number, py: number) => number;

/** Fills R (and A detail) of a layer from a mask function; u/v in [-0.5, 0.5], r = radius. */
function fillLayer(
  out: Uint8Array,
  layer: number,
  mask: Shader,
  detailSeed: number,
  height?: Float32Array,
): void {
  const base = layer * LAYER_BYTES;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r = Math.sqrt(u * u + v * v);
      const d = clamp01(mask(u, v, r, x, y));
      const o = base + (y * S + x) * 4;
      out[o] = Math.round(d * 255);
      out[o + 1] = 128;
      out[o + 2] = 128;
      out[o + 3] = Math.round(fractal(u * 6 + 11, v * 6 + 7, detailSeed, 4, 0) * 255);
      if (height) height[y * S + x] = d;
    }
  }
}

/** Soft cauliflower puff: a union of gaussian lobes eroded by billow noise, with baked lobe normals. */
function puff(out: Uint8Array, layer: number, seed: number, height: Float32Array): void {
  const rng = new Rng(seed);
  const n = 7 + rng.int(0, 5);
  const bx = new Float32Array(n);
  const by = new Float32Array(n);
  const br = new Float32Array(n);
  const bw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : rng.range(0.06, 0.2);
    bx[i] = Math.cos(a) * d;
    by[i] = Math.sin(a) * d;
    br[i] = i === 0 ? 0.2 : rng.range(0.08, 0.16);
    bw[i] = i === 0 ? 1 : rng.range(0.65, 1);
  }
  const base = layer * LAYER_BYTES;
  const ox = rng.range(0, 50);
  const oy = rng.range(0, 50);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r = Math.sqrt(u * u + v * v);
      let shape = 0;
      for (let i = 0; i < n; i++) {
        const du = u - bx[i]!;
        const dv = v - by[i]!;
        const rr = br[i]!;
        shape += bw[i]! * Math.exp(-((du * du + dv * dv) / (rr * rr)) * 1.7);
      }
      shape = 1 - Math.exp(-shape * 1.7);
      const billow = fractal(u * 5 + ox, v * 5 + oy, seed, 5, 1);
      const window = 1 - smooth(0.36, 0.49, r);
      const d = clamp01((shape * (0.6 + 0.62 * billow) - 0.2) * 1.55) * window;
      const o = base + (y * S + x) * 4;
      out[o] = Math.round(d * 255);
      out[o + 3] = Math.round(fractal(u * 9 + oy, v * 9 + ox, seed + 7, 4, 0) * 255);
      height[y * S + x] = (shape * 0.75 + billow * 0.4 * shape) * window;
    }
  }
  writeNormals(out, layer, height, 9);
}

/** Ragged flame lobe: radial falloff torn by ridged noise; A holds temperature detail. */
function flame(out: Uint8Array, layer: number, seed: number): void {
  const base = layer * LAYER_BYTES;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r = Math.sqrt(u * u + v * v);
      const radial = Math.pow(clamp01(1 - r / 0.47), 1.25);
      const torn = fractal(u * 6 + seed, v * 6 - seed, seed, 5, 2);
      const d = clamp01((radial * (0.45 + 0.95 * torn) - 0.12) * 1.45) * (1 - smooth(0.4, 0.49, r));
      const o = base + (y * S + x) * 4;
      out[o] = Math.round(d * 255);
      out[o + 1] = 128;
      out[o + 2] = 128;
      out[o + 3] = Math.round(fractal(u * 10 + 3, v * 10 + 5, seed + 3, 4, 0) * 255);
    }
  }
}

/** Builds the 16-layer sprite array. */
export function buildAtlas(): Uint8Array {
  const out = new Uint8Array(ATLAS_LAYERS * LAYER_BYTES);
  const height = new Float32Array(S * S);
  for (let i = 0; i < LAYER.PUFF_COUNT; i++) puff(out, LAYER.PUFF + i, 4101 + i * 17, height);
  for (let i = 0; i < LAYER.FIRE_COUNT; i++) flame(out, LAYER.FIRE + i, 7 + i * 29);

  // Soft glow: bright core, gentle halo, zero at the cell edge.
  fillLayer(
    out,
    LAYER.GLOW,
    (_u, _v, r) => (Math.exp(-r * r * 60) * 0.8 + Math.exp(-r * 11) * 0.28) * (1 - smooth(0.4, 0.5, r)),
    3,
  );
  // Streak (fallback texture for stretched quads; the streak shader is procedural).
  fillLayer(out, LAYER.STREAK, (u, v) => Math.exp(-(u * u * 14 + v * v * 160)), 5);
  // Shock ring: thin noisy shell with a faint inner haze.
  fillLayer(
    out,
    LAYER.RING,
    (u, v, r) => {
      const a = Math.atan2(v, u);
      const n = fractal(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 21, 4, 0);
      const shell = Math.exp(-Math.pow((r - 0.39) / 0.028, 2)) * (0.6 + 0.5 * n);
      return (shell + Math.exp(-Math.pow((r - 0.3) / 0.09, 2)) * 0.12) * (1 - smooth(0.45, 0.5, r));
    },
    9,
  );
  // Flash star: hot core, halo and four soft diffraction spikes (plus weaker diagonals).
  fillLayer(
    out,
    LAYER.STAR,
    (u, v, r) => {
      const au = Math.abs(u);
      const av = Math.abs(v);
      const spikes =
        (Math.exp(-av * 70) * Math.exp(-au * 6) + Math.exp(-au * 70) * Math.exp(-av * 6)) * 0.45 +
        Math.exp(-Math.abs(au - av) * 90) * Math.exp(-r * 9) * 0.18;
      return (Math.exp(-r * r * 90) + Math.exp(-r * 9) * 0.32 + spikes) * (1 - smooth(0.42, 0.5, r));
    },
    13,
  );
  // Dirt clod: a hard-edged irregular lump with lit facets.
  {
    const rng = new Rng(77);
    const lumps: number[] = [];
    for (let i = 0; i < 4; i++)
      lumps.push(rng.range(-0.08, 0.08), rng.range(-0.08, 0.08), rng.range(0.1, 0.16));
    fillLayer(
      out,
      LAYER.CLOD,
      (u, v, r) => {
        let s = 0;
        for (let i = 0; i < lumps.length; i += 3) {
          const du = u - lumps[i]!;
          const dv = v - lumps[i + 1]!;
          const rr = lumps[i + 2]!;
          s = Math.max(s, 1 - Math.sqrt(du * du + dv * dv) / rr);
        }
        const n = fractal(u * 8 + 2, v * 8 + 9, 31, 4, 0);
        return smooth(0.02, 0.2, s + (n - 0.5) * 0.35) * (1 - smooth(0.4, 0.48, r));
      },
      17,
      height,
    );
    writeNormals(out, LAYER.CLOD, height, 6);
  }
  // Water spray: a clump of droplets over a thin mist.
  {
    const rng = new Rng(91);
    const drops: number[] = [];
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * 0.34;
      drops.push(Math.cos(a) * d, Math.sin(a) * d, rng.range(0.012, 0.04));
    }
    fillLayer(
      out,
      LAYER.SPRAY,
      (u, v, r) => {
        let s = Math.exp(-r * r * 22) * 0.55;
        for (let i = 0; i < drops.length; i += 3) {
          const du = u - drops[i]!;
          const dv = v - drops[i + 1]!;
          const rr = drops[i + 2]!;
          s += Math.exp(-(du * du + dv * dv) / (rr * rr)) * 0.8;
        }
        const n = fractal(u * 7 + 4, v * 7 + 1, 41, 4, 1);
        return clamp01(s * (0.7 + 0.5 * n)) * (1 - smooth(0.38, 0.49, r));
      },
      19,
      height,
    );
    writeNormals(out, LAYER.SPRAY, height, 4);
  }
  // Muzzle flash: five uneven petals around a hot core.
  fillLayer(
    out,
    LAYER.MUZZLE,
    (u, v, r) => {
      const a = Math.atan2(v, u);
      const petal = Math.pow(Math.abs(Math.cos(a * 2.5)), 3);
      const n = fractal(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, 51, 3, 0);
      const reach = 0.1 + 0.34 * petal * (0.6 + 0.5 * n);
      return (smooth(reach, reach * 0.35, r) * 0.85 + Math.exp(-r * r * 110)) * (1 - smooth(0.44, 0.5, r));
    },
    23,
  );
  // Disc: soft round ember / dot.
  fillLayer(
    out,
    LAYER.DISC,
    (_u, _v, r) => (1 - smooth(0.18, 0.46, r)) * (0.7 + 0.3 * Math.exp(-r * r * 40)),
    29,
  );
  return out;
}

/** Tileable noise: R fBm, G fBm (other seed), B billow, A ridged. */
export function buildNoise(): Uint8Array {
  const N = NOISE_SIZE;
  const out = new Uint8Array(N * N * 4);
  const cells = 8;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * cells;
      const v = (y / N) * cells;
      const o = (y * N + x) * 4;
      out[o] = Math.round(fractal(u, v, 101, 5, 0, cells) * 255);
      out[o + 1] = Math.round(fractal(u, v, 202, 5, 0, cells) * 255);
      out[o + 2] = Math.round(fractal(u, v, 303, 5, 1, cells) * 255);
      out[o + 3] = Math.round(fractal(u, v, 404, 4, 2, cells) * 255);
    }
  }
  return out;
}

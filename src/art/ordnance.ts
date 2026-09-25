import type { HardpointKind } from '../core/types';
import { MeshBuilder, PAINT, PANEL, rotation } from './builder';
import { lathe } from './shapes';

/** Physical size of each store: length, body radius, and the radius of its fin tips (for pylon clearance). */
export const ORDNANCE_SIZE: Record<HardpointKind, { length: number; radius: number; span: number }> = {
  srm: { length: 2.87, radius: 0.064, span: 0.29 },
  mrm: { length: 3.65, radius: 0.089, span: 0.3 },
  lraam: { length: 4.0, radius: 0.19, span: 0.58 },
  rocketPod: { length: 2.2, radius: 0.21, span: 0.21 },
  bomb: { length: 3.45, radius: 0.18, span: 0.43 },
  agm: { length: 2.5, radius: 0.15, span: 0.37 },
  tank: { length: 4.2, radius: 0.33, span: 0.55 },
};

const WHITE = 0xd8dbd6;
const GREY = 0xb9bec2;
const OLIVE = 0x566043;
const YELLOW = 0xc8a02a;
const BROWN = 0x6a4a2c;
const SEEKER = 0x23282c;

/** Thin trapezoidal fin plate on a body of revolution, radial at angle `ang` (0 = up). */
function fin(
  b: MeshBuilder,
  ang: number,
  rootR: number,
  rootLE: number,
  rootTE: number,
  span: number,
  tipLE: number,
  tipTE: number,
  th: number,
): void {
  const v0 = b.vertexCount;
  // Build in the +y plane (radial up), thickness along x, then rotate about z.
  const pts: [number, number][] = [
    [rootLE, rootR - 0.004],
    [tipLE, rootR + span],
    [tipTE, rootR + span],
    [rootTE, rootR - 0.004],
  ];
  const side = (sx: number) => {
    const ids = pts.map(([z, y]) => b.vertex(sx * th, y, z, sx, 0, 0));
    if (sx > 0) b.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    else b.quad(ids[3]!, ids[2]!, ids[1]!, ids[0]!);
  };
  side(1);
  side(-1);
  // edges: leading, tip, trailing
  for (let e = 0; e < 3; e++) {
    const [z0, y0] = pts[e]!;
    const [z1, y1] = pts[e + 1]!;
    const dz = z1 - z0;
    const dy = y1 - y0;
    const l = Math.hypot(dz, dy) || 1;
    const nz = -dy / l;
    const ny = dz / l;
    const a = b.vertex(th, y0, z0, 0, ny, nz);
    const c = b.vertex(th, y1, z1, 0, ny, nz);
    const d = b.vertex(-th, y1, z1, 0, ny, nz);
    const f = b.vertex(-th, y0, z0, 0, ny, nz);
    b.quad(a, f, d, c);
  }
  b.transform(v0, rotation([0, 0, 1], ang), [0, 0, 0]);
}

function cruciform(
  b: MeshBuilder,
  offset: number,
  rootR: number,
  rootLE: number,
  rootTE: number,
  span: number,
  tipLE: number,
  tipTE: number,
  th: number,
  count = 4,
): void {
  for (let k = 0; k < count; k++) {
    fin(b, offset + (k * Math.PI * 2) / count, rootR, rootLE, rootTE, span, tipLE, tipTE, th);
  }
}

type Band = [z0: number, z1: number, color: number];

/** Body of revolution with colour bands: profile [z, r] front to back; bands recolour spans of z. */
function body(b: MeshBuilder, profile: [number, number][], seg: number, base: number, bands: Band[]): void {
  // Split the profile at band edges so colours change on exact rings.
  const zs = new Set<number>(profile.map((p) => p[0]));
  for (const [z0, z1] of bands) {
    zs.add(z0);
    zs.add(z1);
  }
  const rAt = (z: number) => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [za, ra] = profile[i]!;
      const [zb, rb] = profile[i + 1]!;
      if (z >= za && z <= zb) return zb > za ? ra + ((z - za) / (zb - za)) * (rb - ra) : ra;
    }
    return profile[profile.length - 1]![1];
  };
  const sorted = [...zs]
    .filter((z) => z >= profile[0]![0] && z <= profile[profile.length - 1]![0])
    .sort((x, y) => x - y);
  const colorAt = (z: number) => {
    for (const [z0, z1, c] of bands) if (z >= z0 - 1e-6 && z <= z1 + 1e-6) return c;
    return base;
  };
  // Emit one lathe per colour run (duplicated rings at band edges give crisp paint lines).
  let runStart = 0;
  for (let i = 1; i < sorted.length; i++) {
    const mid = (sorted[i - 1]! + sorted[i]!) / 2;
    const next = i + 1 < sorted.length ? (sorted[i]! + sorted[i + 1]!) / 2 : Infinity;
    if (next === Infinity || colorAt(next) !== colorAt(mid)) {
      b.setTint(colorAt(mid));
      const prof: [number, number][] = [];
      for (let k = runStart; k <= i; k++) prof.push([sorted[k]!, rAt(sorted[k]!)]);
      lathe(b, prof, seg, { capStart: runStart === 0, capEnd: i === sorted.length - 1 });
      runStart = i;
    }
  }
}

function ogive(z0: number, len: number, r: number, n: number, tipR = 0.004): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    out.push([z0 + u * len, Math.max(tipR, r * Math.sqrt(1 - (1 - u) * (1 - u)))]);
  }
  return out;
}

/**
 * Builds a store centred at the origin, nose toward -z. LOD0 is detailed (seekers, fins, bands);
 * LOD1 keeps only the silhouette. Paint mode is set by the caller (store paint uses vertex tints).
 */
export function buildOrdnance(b: MeshBuilder, kind: HardpointKind, lod: 0 | 1): void {
  const hi = lod === 0;
  const seg = hi ? 14 : 6;
  const savedPaint = b.paint;
  const savedPanel = b.panel;
  b.paint = PAINT.store;
  b.panel = PANEL.plain;
  const { length: L, radius: r } = ORDNANCE_SIZE[kind];
  const h = L / 2;
  switch (kind) {
    case 'srm': {
      const nose: [number, number][] = [
        [-h, 0.004],
        [-h + 0.02, r * 0.62],
        [-h + 0.055, r * 0.92],
        [-h + 0.09, r],
      ];
      body(b, [...nose, [h - 0.05, r], [h, r * 0.82]], seg, WHITE, [
        [-h, -h + 0.09, SEEKER],
        [-h + 0.52, -h + 0.6, YELLOW],
        [-h + 1.02, -h + 1.08, BROWN],
      ]);
      b.setTint(WHITE);
      if (hi) {
        cruciform(b, Math.PI / 4, r, -h + 0.36, -h + 0.62, 0.15, -h + 0.52, -h + 0.6, 0.004);
        cruciform(b, Math.PI / 4, r, h - 0.42, h - 0.04, 0.22, h - 0.18, h - 0.04, 0.005);
      } else cruciform(b, Math.PI / 4, r, h - 0.42, h - 0.04, 0.22, h - 0.18, h - 0.04, 0.005, 2);
      break;
    }
    case 'mrm': {
      body(b, [...ogive(-h, 0.62, r, hi ? 7 : 3), [h - 0.06, r], [h, r * 0.8]], seg, GREY, [
        [-h, -h + 0.62, 0xcfd2cf],
        [-h + 0.8, -h + 0.86, YELLOW],
        [-h + 1.5, -h + 1.56, BROWN],
      ]);
      b.setTint(GREY);
      if (hi) {
        cruciform(b, Math.PI / 4, r, -h + 1.1, -h + 1.95, 0.06, -h + 1.25, -h + 1.9, 0.004);
        cruciform(b, Math.PI / 4, r, h - 0.34, h - 0.03, 0.2, h - 0.12, h - 0.03, 0.005);
      } else cruciform(b, Math.PI / 4, r, h - 0.34, h - 0.03, 0.2, h - 0.12, h - 0.03, 0.005, 2);
      break;
    }
    case 'lraam': {
      body(b, [...ogive(-h, 0.95, r, hi ? 8 : 3), [h - 0.1, r], [h, r * 0.75]], seg, WHITE, [
        [-h, -h + 0.95, 0xe4e2dc],
        [-h + 1.1, -h + 1.17, YELLOW],
        [-h + 1.9, -h + 1.97, BROWN],
      ]);
      b.setTint(WHITE);
      if (hi) {
        cruciform(b, Math.PI / 4, r, -h + 1.2, -h + 2.9, 0.1, -h + 1.6, -h + 2.8, 0.005);
        cruciform(b, Math.PI / 4, r, h - 0.72, h - 0.04, 0.38, h - 0.26, h - 0.04, 0.008);
      } else cruciform(b, Math.PI / 4, r, h - 0.72, h - 0.04, 0.38, h - 0.26, h - 0.04, 0.008, 2);
      break;
    }
    case 'rocketPod': {
      const prof: [number, number][] = [
        [-h, r * 0.82],
        [-h + 0.03, r * 0.95],
        [-h + 0.09, r],
        [h - 0.06, r],
        [h, r * 0.9],
      ];
      body(b, prof, hi ? 16 : 6, OLIVE, [[-h + 0.22, -h + 0.3, YELLOW]]);
      if (hi) {
        // 19 tube mouths front and rear: dark recessed discs.
        b.paint = PAINT.interior;
        b.setTint(0x2a2c2a);
        const tubes: [number, number][] = [[0, 0]];
        for (let k = 0; k < 6; k++)
          tubes.push([Math.cos((k * Math.PI) / 3) * 0.066, Math.sin((k * Math.PI) / 3) * 0.066]);
        for (let k = 0; k < 12; k++)
          tubes.push([Math.cos((k * Math.PI) / 6 + 0.26) * 0.13, Math.sin((k * Math.PI) / 6 + 0.26) * 0.13]);
        for (const [x, y] of tubes) {
          for (const end of [-1, 1]) {
            const z = end < 0 ? -h - 0.001 : h + 0.001;
            const v0 = b.vertexCount;
            lathe(
              b,
              end < 0
                ? [
                    [z, 0.028],
                    [z + 0.06, 0.028],
                  ]
                : [
                    [z - 0.06, 0.028],
                    [z, 0.028],
                  ],
              6,
              { cx: x, cy: y, flip: true, capStart: end > 0, capEnd: end < 0 },
            );
            b.setAo(v0, 0.35);
          }
        }
        b.paint = PAINT.store;
      }
      b.setTint(OLIVE);
      break;
    }
    case 'bomb': {
      const prof: [number, number][] = [
        [-h, 0.03],
        [-h + 0.06, 0.085],
        [-h + 0.42, 0.095],
        [-h + 0.46, 0.08],
        ...ogive(-h + 0.46, 0.75, r, hi ? 6 : 3, 0.08).slice(1),
        [h - 0.7, r],
        [h - 0.15, r * 0.62],
        [h, r * 0.5],
      ];
      body(b, prof, seg, OLIVE, [
        [-h, -h + 0.46, 0x9ba0a0],
        [-h + 0.62, -h + 0.7, YELLOW],
      ]);
      b.setTint(0x9ba0a0);
      if (hi) cruciform(b, Math.PI / 4, 0.09, -h + 0.14, -h + 0.4, 0.09, -h + 0.28, -h + 0.4, 0.004);
      b.setTint(OLIVE);
      cruciform(b, Math.PI / 4, r * 0.55, h - 0.62, h - 0.02, 0.33, h - 0.2, h - 0.02, 0.006, hi ? 4 : 2);
      break;
    }
    case 'agm': {
      const prof: [number, number][] = [
        [-h, 0.004],
        [-h + 0.05, r * 0.7],
        [-h + 0.12, r * 0.97],
        [-h + 0.16, r],
        [h - 0.05, r],
        [h, r * 0.85],
      ];
      body(b, prof, seg, 0xc4c6bf, [
        [-h, -h + 0.14, SEEKER],
        [-h + 0.45, -h + 0.52, YELLOW],
        [-h + 1.0, -h + 1.06, BROWN],
      ]);
      b.setTint(0xc4c6bf);
      cruciform(b, Math.PI / 4, r, -h + 0.9, -h + 2.05, 0.22, -h + 1.55, -h + 2.0, 0.006, hi ? 4 : 2);
      if (hi) cruciform(b, Math.PI / 4, r, h - 0.3, h - 0.03, 0.12, h - 0.12, h - 0.03, 0.005);
      break;
    }
    case 'tank': {
      const prof: [number, number][] = [
        ...ogive(-h, 1.3, r, hi ? 8 : 3, 0.02),
        [h - 1.3, r],
        [h - 0.5, r * 0.7],
        [h - 0.05, r * 0.2],
        [h, 0.02],
      ];
      body(b, prof, hi ? 16 : 7, 0x8a9096, []);
      b.setTint(0x8a9096);
      if (hi) {
        fin(b, Math.PI * 0.75, r * 0.5, h - 0.75, h - 0.2, 0.22, h - 0.45, h - 0.2, 0.006);
        fin(b, -Math.PI * 0.75, r * 0.5, h - 0.75, h - 0.2, 0.22, h - 0.45, h - 0.2, 0.006);
        fin(b, Math.PI, r * 0.5, h - 0.75, h - 0.2, 0.22, h - 0.45, h - 0.2, 0.006);
      }
      break;
    }
  }
  b.paint = savedPaint;
  b.panel = savedPanel;
}

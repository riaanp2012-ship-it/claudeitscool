/**
 * Turns the data recipes in tuning.ts into particles. Event-time code (explosions, impacts), but still
 * allocation-free: directions and lobe centers use module scratch arrays.
 */
import type { Rng } from '../core/rng';
import type { ParticleStore } from './particles';
import {
  DIR_CONE_UP,
  DIR_HEMI,
  DIR_NORMAL,
  DIR_RING,
  STYLE,
  STYLES,
  type EmitterDef,
  type Range,
} from './tuning';

const MAX_LOBES = 8;
const lobes = new Float32Array(MAX_LOBES * 3);
const dir = new Float32Array(3);
const TAU = Math.PI * 2;
const WHITE = [1, 1, 1] as const;

const pick = (rng: Rng, r: Range): number => (r[0] === r[1] ? r[0] : rng.range(r[0], r[1]));

function randomSphere(rng: Rng): void {
  const z = rng.next() * 2 - 1;
  const a = rng.next() * TAU;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  dir[0] = s * Math.cos(a);
  dir[1] = z;
  dir[2] = s * Math.sin(a);
}

/** Random direction inside a cone of half-angle `spread` around the unit axis (ax, ay, az). */
function randomCone(rng: Rng, ax: number, ay: number, az: number, spread: number): void {
  const cosT = 1 - rng.next() * (1 - Math.cos(spread));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const a = rng.next() * TAU;
  // Orthonormal basis around the axis.
  let tx = Math.abs(ay) < 0.95 ? 0 : 1;
  let ty = Math.abs(ay) < 0.95 ? 1 : 0;
  let tz = 0;
  // t = normalize(cross(axis, helper)), b = cross(axis, t)
  const cx = ay * tz - az * ty;
  const cy = az * tx - ax * tz;
  const cz = ax * ty - ay * tx;
  const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
  tx = cx / cl;
  ty = cy / cl;
  tz = cz / cl;
  const bx = ay * tz - az * ty;
  const by = az * tx - ax * tz;
  const bz = ax * ty - ay * tx;
  const ca = Math.cos(a) * sinT;
  const sa = Math.sin(a) * sinT;
  dir[0] = ax * cosT + tx * ca + bx * sa;
  dir[1] = ay * cosT + ty * ca + by * sa;
  dir[2] = az * cosT + tz * ca + bz * sa;
}

function direction(rng: Rng, def: EmitterDef, nx: number, ny: number, nz: number): void {
  switch (def.dir) {
    case DIR_HEMI:
      randomSphere(rng);
      dir[1] = Math.abs(dir[1]!);
      break;
    case DIR_CONE_UP:
      randomCone(rng, 0, 1, 0, def.spread ?? 0.5);
      break;
    case DIR_RING: {
      const a = rng.next() * TAU;
      const y = (rng.next() * 2 - 1) * (def.spread ?? 0.1);
      const l = Math.sqrt(1 + y * y);
      dir[0] = Math.cos(a) / l;
      dir[1] = y / l;
      dir[2] = Math.sin(a) / l;
      break;
    }
    case DIR_NORMAL:
      randomCone(rng, nx, ny, nz, def.spread ?? 0.8);
      break;
    default:
      randomSphere(rng);
  }
}

/**
 * Emits one recipe layer at (cx, cy, cz). `bv*` is the burst velocity (inherited by `def.inherit`),
 * `n*` the surface normal (unit) for DIR_NORMAL. Returns the number of particles spawned.
 */
export function emitBurst(
  ps: ParticleStore,
  rng: Rng,
  def: EmitterDef,
  cx: number,
  cy: number,
  cz: number,
  bvx: number,
  bvy: number,
  bvz: number,
  nx: number,
  ny: number,
  nz: number,
  detail: number,
  brightness: number,
): number {
  const st = STYLES[def.style];
  if (!st) return 0;
  const want = def.count * detail;
  const count =
    def.count <= 1 ? def.count : Math.floor(want) + (rng.next() < want - Math.floor(want) ? 1 : 0);
  if (count <= 0) return 0;
  const lobeCount = Math.min(MAX_LOBES, Math.max(1, def.lobes ?? 1));
  const lobeRadius = def.lobeRadius ?? 0;
  for (let l = 0; l < lobeCount; l++) {
    if (lobeCount === 1) {
      lobes[l * 3] = 0;
      lobes[l * 3 + 1] = 0;
      lobes[l * 3 + 2] = 0;
      continue;
    }
    randomSphere(rng);
    const r = lobeRadius * rng.range(0.45, 1);
    lobes[l * 3] = dir[0]! * r;
    lobes[l * 3 + 1] = dir[1]! * r;
    lobes[l * 3 + 2] = dir[2]! * r;
  }
  const inherit = def.inherit ?? 0;
  const offset = def.offset ?? 0;
  const lift = def.lift ?? 0;
  const up = def.up ?? 0;
  const jitter = def.jitter ?? 0;
  const alpha = def.alpha ?? 1;
  const bright = def.style === STYLE.FLASH ? brightness : 1;
  const color = def.color ?? WHITE;
  let spawned = 0;
  for (let n = 0; n < count; n++) {
    const l = n % lobeCount;
    const lx = lobes[l * 3]!;
    const ly = lobes[l * 3 + 1]!;
    const lz = lobes[l * 3 + 2]!;
    direction(rng, def, nx, ny, nz);
    let dx = dir[0]!;
    let dy = dir[1]!;
    let dz = dir[2]!;
    if (lobeCount > 1 && lobeRadius > 0) {
      // Lobe particles expand mostly away from the burst center, so each lobe billows on its own.
      const ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
      dx = dx * 0.4 + (lx / ll) * 0.6;
      dy = dy * 0.4 + (ly / ll) * 0.6;
      dz = dz * 0.4 + (lz / ll) * 0.6;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
    }
    const speed = pick(rng, def.speed);
    const delay = def.delay ? pick(rng, def.delay) : 0;
    randomSphere(rng);
    const or = offset * Math.cbrt(rng.next());
    const x = cx + lx + dir[0]! * or + bvx * inherit * delay;
    const y = cy + lift + ly + dir[1]! * or + bvy * inherit * delay;
    const z = cz + lz + dir[2]! * or + bvz * inherit * delay;
    const i = ps.spawn(
      def.style,
      x,
      y,
      z,
      dx * speed + bvx * inherit,
      dy * speed + up + bvy * inherit,
      dz * speed + bvz * inherit,
      pick(rng, def.life),
      pick(rng, def.size0),
      pick(rng, def.size1),
    );
    if (i < 0) break;
    spawned++;
    ps.age[i] = -delay;
    const j = (1 + (rng.next() * 2 - 1) * jitter) * bright;
    ps.cr[i] = color[0] * j;
    ps.cg[i] = color[1] * j;
    ps.cb[i] = color[2] * j;
    ps.alpha[i] = alpha;
    ps.heat[i] = def.heat ?? 0;
    ps.emissive[i] = def.emissive ?? 0;
    ps.rot[i] = rng.next() * TAU;
    ps.rotVel[i] = (rng.next() * 2 - 1) * st.spin;
    ps.layer[i] = st.layer + (st.layers > 1 ? rng.int(0, st.layers - 1) : 0);
    ps.seed[i] = rng.next();
    if (def.drag !== undefined) ps.drag[i] = ps.drag[i]! * def.drag;
  }
  return spawned;
}

import { capFan } from './shapes';
import { gridSurface, MeshBuilder, PANEL, PART } from './builder';
import { normalize, type BoneRole, type Rig, type Vec3 } from './rig';

const DEG = Math.PI / 180;

/** Planform breakpoint. s: distance along the span axis from the root origin (m). le: LE station z (m). */
export interface PlanformStation {
  s: number;
  le: number;
  chord: number;
  /** Thickness/chord ratio. */
  t: number;
  /** Degrees, positive = leading edge up. */
  twist?: number;
}

export interface ControlDef {
  role: Extract<BoneRole, 'aileron' | 'flap' | 'elevon' | 'rudder' | 'elevator' | 'slat'>;
  s0: number;
  s1: number;
  /** Hinge line as a chord fraction (0..1). Slats hinge at the front: hinge = slat chord fraction. */
  hinge: number;
  /** Maximum deflection, degrees. */
  max: number;
  /** Split into upper/lower halves that open as a speed brake (Mule decelerons). */
  split?: boolean;
}

export interface SurfaceDef {
  /** Root origin: lateral x and height y. */
  x: number;
  y: number;
  vertical?: boolean;
  /** Dihedral (horizontal) or outward cant from vertical (vertical), degrees. */
  angle: number;
  stations: readonly PlanformStation[];
  controls?: readonly ControlDef[];
  allMoving?: { role: 'stab' | 'canard'; pivot: number; max: number };
  /** Span position outboard of which the surface detaches when destroyed. */
  detach?: number;
  camber?: number;
  /** Chord samples per side at LOD0. */
  k?: number;
  /** Damage part id for the right side (mirrored automatically). */
  part: number;
  /** Structural bone (right side). */
  bone: number;
  mirror: boolean;
  rootCap?: boolean;
  tipCap?: boolean;
  /** Extra spanwise subdivisions per metre (smooth twist/lighting). */
  density?: number;
}

export interface SurfaceResult {
  /** Right-side tip trailing edge point (model space). */
  tipTE: Vec3;
  tipLE: Vec3;
  /** Bones created: control and detach bones (right side). */
  detachBone: number;
}

interface Planform {
  le: number;
  chord: number;
  t: number;
  twist: number;
}

export function planformAt(def: SurfaceDef, s: number, out: Planform): Planform {
  const st = def.stations;
  let i = 0;
  while (i < st.length - 2 && s > st[i + 1]!.s) i++;
  const a = st[i]!;
  const b = st[Math.min(i + 1, st.length - 1)]!;
  const f = b.s > a.s ? Math.min(Math.max((s - a.s) / (b.s - a.s), 0), 1) : 0;
  out.le = a.le + (b.le - a.le) * f;
  out.chord = a.chord + (b.chord - a.chord) * f;
  out.t = a.t + (b.t - a.t) * f;
  out.twist = (a.twist ?? 0) + ((b.twist ?? 0) - (a.twist ?? 0)) * f;
  return out;
}

/** Span axis and thickness axis (thickness = z x span, which keeps normals outward for every surface). */
export function surfaceAxes(def: SurfaceDef): { A: Vec3; T: Vec3 } {
  const a = def.angle * DEG;
  const A: Vec3 = def.vertical ? [Math.sin(a), Math.cos(a), 0] : [Math.cos(a), Math.sin(a), 0];
  const T: Vec3 = [-A[1], A[0], 0];
  return { A, T };
}

/** Half thickness (chord units) of a NACA 4-digit section with a slightly blunt trailing edge. */
export function thickness(c: number, t: number, teHalf: number): number {
  const x = Math.min(Math.max(c, 0), 1);
  return (
    5 *
      t *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x) +
    teHalf * x
  );
}

export function camberLine(c: number, m: number): number {
  if (m <= 0) return 0;
  const p = 0.4;
  return c < p
    ? (m / (p * p)) * (2 * p * c - c * c)
    : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * c - c * c);
}

/** Model-space point on a surface at span s, chord fraction c and thickness offset y (chord units). */
export function surfacePoint(
  def: SurfaceDef,
  s: number,
  c: number,
  y: number,
  out: Vec3,
  pf?: Planform,
): Vec3 {
  const p = pf ?? planformAt(def, s, { le: 0, chord: 0, t: 0, twist: 0 });
  const { A, T } = surfaceAxes(def);
  const q = p.le + 0.25 * p.chord;
  let dz = p.le + c * p.chord - q;
  let dy = y * p.chord;
  const tw = p.twist * DEG;
  if (tw !== 0) {
    const cs = Math.cos(tw);
    const sn = Math.sin(tw);
    const nz = dz * cs + dy * sn;
    const ny = dy * cs - dz * sn;
    dz = nz;
    dy = ny;
  }
  out[0] = def.x + A[0] * s + T[0] * dy;
  out[1] = def.y + A[1] * s + T[1] * dy;
  out[2] = q + dz;
  return out;
}

/** Surface skin point at chord fraction c on the upper (+1) or lower (-1) side. */
export function skinPoint(def: SurfaceDef, s: number, c: number, side: 1 | -1, out: Vec3): Vec3 {
  const p = planformAt(def, s, { le: 0, chord: 0, t: 0, twist: 0 });
  const y = camberLine(c, def.camber ?? 0) + side * thickness(c, p.t, 0.0012 / Math.max(p.chord, 0.05));
  return surfacePoint(def, s, c, y, out, p);
}

interface Loop {
  c: number[];
  y: number[];
  creases: number[];
  /** Loop index range belonging to the upper side, for split surfaces. */
}

/**
 * Airfoil section loop for chord range [c0, c1] in chord units: starts at the upper aft point, runs forward
 * along the upper surface, around the nose (sharp LE when c0 = 0, rounded hinge nose otherwise) and back
 * along the lower surface. The aft end is either the blunt trailing edge (c1 = 1) or a flat spar face.
 */
function airfoilLoop(
  c0: number,
  c1: number,
  K: number,
  t: number,
  m: number,
  teHalf: number,
  half = 0,
): Loop {
  const cs: number[] = [];
  for (let k = 0; k <= K; k++) {
    const w = (1 - Math.cos((Math.PI * k) / K)) / 2;
    cs.push(c1 + (c0 - c1) * w);
  }
  const yt = (c: number) => thickness(c, t, teHalf);
  const yc = (c: number) => camberLine(c, m);
  const L: Loop = { c: [], y: [], creases: [] };
  const push = (c: number, y: number) => {
    L.c.push(c);
    L.y.push(y);
  };
  if (half === 0) {
    for (let k = 0; k <= K; k++) push(cs[k]!, yc(cs[k]!) + yt(cs[k]!));
    if (c0 > 0) {
      const r = yt(c0);
      const nNose = 5;
      for (let k = 1; k < nNose; k++) {
        const a = Math.PI / 2 + (Math.PI * k) / nNose;
        push(c0 + Math.cos(a) * r, yc(c0) + Math.sin(a) * r);
      }
      for (let k = K; k >= 0; k--) push(cs[k]!, yc(cs[k]!) - yt(cs[k]!));
    } else {
      for (let k = K - 1; k >= 0; k--) push(cs[k]!, yc(cs[k]!) - yt(cs[k]!));
    }
    L.creases.push(0, L.c.length - 1);
    if (c1 < 1) push(c1, yc(c1));
  } else {
    // Half (split deceleron): one skin plus the camber line as the inner face.
    const sgn = half;
    for (let k = 0; k <= K; k++) push(cs[k]!, yc(cs[k]!) + sgn * yt(cs[k]!));
    const r = yt(c0);
    for (let k = 1; k <= 2; k++) {
      const a = Math.PI / 2 + (Math.PI * k) / 4;
      push(c0 + Math.cos(a) * r, yc(c0) + sgn * Math.sin(a) * r);
    }
    const n0 = L.c.length - 1;
    for (let k = K; k >= 0; k--) push(cs[k]!, yc(cs[k]!) + sgn * 0.0004);
    L.creases.push(0, n0, L.c.length - 1);
    if (sgn < 0) {
      L.c.reverse();
      L.y.reverse();
      L.creases = L.creases.map((i) => L.c.length - 1 - i);
    }
  }
  return L;
}

/** Builds one spanwise piece of a surface over span stations `ss`, chord range [c0, c1]. */
function buildPiece(
  b: MeshBuilder,
  def: SurfaceDef,
  ss: readonly number[],
  c0: number,
  c1: number,
  K: number,
  caps: { root: boolean; tip: boolean },
  half = 0,
): void {
  const pf: Planform = { le: 0, chord: 0, t: 0, twist: 0 };
  // loop topology is shared across stations (thickness varies but point count is constant)
  planformAt(def, ss[0]!, pf);
  const proto = airfoilLoop(c0, c1, K, pf.t, def.camber ?? 0, 0.001, half);
  const nJ = proto.c.length;
  const nI = ss.length;
  const P = new Float64Array(nI * nJ * 3);
  const chordAt = new Float64Array(nI);
  const cAt = new Float64Array(nI * nJ);
  const tmp: Vec3 = [0, 0, 0];
  for (let i = 0; i < nI; i++) {
    const s = ss[i]!;
    planformAt(def, s, pf);
    chordAt[i] = pf.chord;
    const L = airfoilLoop(c0, c1, K, pf.t, def.camber ?? 0, 0.0012 / Math.max(pf.chord, 0.05), half);
    for (let j = 0; j < nJ; j++) {
      surfacePoint(def, s, L.c[j]!, L.y[j]!, tmp, pf);
      const k = (i * nJ + j) * 3;
      P[k] = tmp[0];
      P[k + 1] = tmp[1];
      P[k + 2] = tmp[2];
      cAt[i * nJ + j] = L.c[j]!;
    }
  }
  gridSurface(b, P, nI, nJ, {
    wrap: true,
    creases: proto.creases,
    uvAt: (i, j, out) => {
      out[0] = Math.max(cAt[i * nJ + j]!, 0) * chordAt[i]!;
      out[1] = ss[i]!;
    },
    auxAt: (i, _j, out) => {
      out[0] = chordAt[i]!;
      out[1] = 0;
    },
  });
  const { A } = surfaceAxes(def);
  const cap = (i: number, dir: number) => {
    const pts = new Float64Array(nJ * 3);
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let j = 0; j < nJ; j++) {
      const k = (i * nJ + j) * 3;
      pts[j * 3] = P[k]!;
      pts[j * 3 + 1] = P[k + 1]!;
      pts[j * 3 + 2] = P[k + 2]!;
      cx += P[k]!;
      cy += P[k + 1]!;
      cz += P[k + 2]!;
    }
    const savedPanel = b.panel;
    b.panel = PANEL.plain;
    capFan(b, pts, nJ, [cx / nJ, cy / nJ, cz / nJ], [A[0] * dir, A[1] * dir, A[2] * dir]);
    b.panel = savedPanel;
  };
  if (caps.root) cap(0, -1);
  if (caps.tip) cap(nI - 1, 1);
}

function spanStations(a: number, b: number, extra: readonly number[], density: number): number[] {
  const out = [a];
  const cuts = extra.filter((e) => e > a + 1e-4 && e < b - 1e-4).sort((x, y) => x - y);
  let prev = a;
  for (const e of [...cuts, b]) {
    const n = Math.max(1, Math.ceil((e - prev) * density));
    for (let k = 1; k <= n; k++) out.push(prev + ((e - prev) * k) / n);
    prev = e;
  }
  return out;
}

const partMirror = (p: number): number => (p === PART.wingR ? PART.wingL : p);

/**
 * Builds a lifting surface (wing, tail, canard, fin, pylon) with rounded leading edges, sharp trailing
 * edges, sweep, taper, dihedral/cant and twist. Control surfaces are separate hinged pieces with their own
 * bones at LOD0; LOD1 builds the surface as one piece (no moving parts).
 */
export function buildSurface(b: MeshBuilder, rig: Rig, def: SurfaceDef, lod: 0 | 1): SurfaceResult {
  const v0 = b.vertexCount;
  const i0 = b.idx.length;
  const savedBone = b.bone;
  const savedPart = b.part;
  const savedPanel = b.panel;
  b.part = def.part;
  b.panel = PANEL.wing;
  const sMax = def.stations[def.stations.length - 1]!.s;
  const K = lod === 0 ? (def.k ?? 10) : Math.max(3, Math.round((def.k ?? 10) * 0.4));
  const density = lod === 0 ? (def.density ?? 0.7) : 0;
  const planformCuts = def.stations.map((s) => s.s);
  const tmpA: Vec3 = [0, 0, 0];
  const tmpB: Vec3 = [0, 0, 0];

  // --- bones (registered identically for every LOD so indices match)
  let structural = def.bone;
  let detachBone = -1;
  if (def.detach !== undefined) {
    surfacePoint(def, def.detach, 0.3, 0, tmpA);
    const reg = def.mirror
      ? rig.addPair({ role: 'wingtip', parent: def.bone, pivot: [...tmpA] })[0]
      : rig.add({ role: 'wingtip', parent: def.bone, pivot: [...tmpA] });
    detachBone = reg;
  }
  if (def.allMoving) {
    const root = planformAt(def, 0, { le: 0, chord: 0, t: 0, twist: 0 });
    const pivotZ = root.le + def.allMoving.pivot * root.chord;
    const { A } = surfaceAxes(def);
    const pivot: Vec3 = [def.x, def.y, pivotZ];
    const reg = {
      role: def.allMoving.role,
      parent: def.bone,
      pivot,
      axis: normalize([A[0], A[1], A[2]]),
      max: def.allMoving.max * DEG,
    } as const;
    structural = def.mirror
      ? rig.addPair({ ...reg, pivot: [...pivot] })[0]
      : rig.add({ ...reg, pivot: [...pivot] });
  }
  const controlBones: number[] = [];
  for (const c of def.controls ?? []) {
    const parent = detachBone >= 0 && c.s0 >= def.detach! - 1e-4 ? detachBone : structural;
    const pa = planformAt(def, c.s0, { le: 0, chord: 0, t: 0, twist: 0 });
    const pb = planformAt(def, c.s1, { le: 0, chord: 0, t: 0, twist: 0 });
    surfacePoint(def, c.s0, c.hinge, camberLine(c.hinge, def.camber ?? 0), tmpA, pa);
    surfacePoint(def, c.s1, c.hinge, camberLine(c.hinge, def.camber ?? 0), tmpB, pb);
    const axis = normalize([tmpB[0] - tmpA[0], tmpB[1] - tmpA[1], tmpB[2] - tmpA[2]]);
    const roles = c.split ? (['decelU', 'decelL'] as const) : ([c.role] as const);
    for (const role of roles) {
      const reg = { role, parent, pivot: [...tmpA] as Vec3, axis, max: c.max * DEG };
      controlBones.push(def.mirror ? rig.addPair(reg)[0] : rig.add(reg));
    }
  }

  // --- geometry
  const gap = 0.012;
  const rootCap = def.rootCap !== false;
  const tipCap = def.tipCap !== false;
  if (lod === 1 || (def.controls ?? []).length === 0) {
    const cuts = def.detach !== undefined ? [0, def.detach, sMax] : [0, sMax];
    // LOD1 has no moving parts: all-moving surfaces bind to their structural parent.
    const fixed = lod === 1 ? def.bone : structural;
    for (let p = 0; p < cuts.length - 1; p++) {
      b.bone = p === 0 ? fixed : detachBone;
      const ss = spanStations(cuts[p]!, cuts[p + 1]!, planformCuts, density);
      buildPiece(b, def, ss, 0, 1, K, { root: p > 0 || rootCap, tip: p < cuts.length - 2 || tipCap });
    }
  } else {
    const controls = def.controls!;
    const cutSet = new Set<number>([0, sMax, ...planformCuts]);
    for (const c of controls) {
      cutSet.add(c.s0);
      cutSet.add(c.s1);
    }
    if (def.detach !== undefined) cutSet.add(def.detach);
    const cuts = [...cutSet].filter((c) => c >= 0 && c <= sMax).sort((x, y) => x - y);
    // group consecutive segments with the same (control, detach side)
    interface Run {
      a: number;
      b: number;
      ctrl: number;
      outer: boolean;
    }
    const runs: Run[] = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]!;
      const e = cuts[k + 1]!;
      if (e - a < 1e-4) continue;
      const mid = (a + e) / 2;
      const ctrl = controls.findIndex((c) => c.s0 <= mid && mid <= c.s1);
      const outer = def.detach !== undefined && mid > def.detach;
      const last = runs[runs.length - 1];
      if (last && last.ctrl === ctrl && last.outer === outer) last.b = e;
      else runs.push({ a, b: e, ctrl, outer });
    }
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!;
      b.bone = run.outer ? detachBone : structural;
      const ss = spanStations(run.a, run.b, planformCuts, density);
      let c1 = 1;
      let c0 = 0;
      if (run.ctrl >= 0) {
        const c = controls[run.ctrl]!;
        const pf = planformAt(def, (run.a + run.b) / 2, { le: 0, chord: 0, t: 0, twist: 0 });
        const r0 = thickness(c.hinge, pf.t, 0);
        if (c.role === 'slat') c0 = c.hinge + gap / pf.chord;
        else c1 = Math.max(c.hinge - r0 - gap / pf.chord, 0.05);
      }
      buildPiece(b, def, ss, c0, c1, K, { root: r > 0 || rootCap, tip: r < runs.length - 1 || tipCap });
    }
    let bi = 0;
    for (const c of controls) {
      const ss = spanStations(c.s0 + gap, c.s1 - gap, planformCuts, density);
      if (c.split) {
        b.bone = controlBones[bi++]!;
        buildPiece(b, def, ss, c.hinge, 1, K, { root: true, tip: true }, 1);
        b.bone = controlBones[bi++]!;
        buildPiece(b, def, ss, c.hinge, 1, K, { root: true, tip: true }, -1);
      } else if (c.role === 'slat') {
        b.bone = controlBones[bi++]!;
        buildPiece(b, def, ss, 0, c.hinge, K, { root: true, tip: true });
      } else {
        b.bone = controlBones[bi++]!;
        buildPiece(b, def, ss, c.hinge, 1, K, { root: true, tip: true });
      }
    }
  }
  if (def.mirror) b.mirror(v0, i0, rig.mirrorFn, partMirror);
  b.bone = savedBone;
  b.part = savedPart;
  b.panel = savedPanel;

  const tipTE: Vec3 = [0, 0, 0];
  const tipLE: Vec3 = [0, 0, 0];
  surfacePoint(def, sMax, 1, 0, tipTE);
  surfacePoint(def, sMax, 0, 0, tipLE);
  return { tipTE, tipLE, detachBone };
}

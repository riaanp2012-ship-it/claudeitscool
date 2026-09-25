import type { HitCapsule } from '../../core/types';
import { gridSurface, PAINT, PANEL, PART } from '../builder';
import type { BuildContext, DecalDef } from '../context';
import { ROOT_BONE, type Vec3 } from '../rig';
import { makeSection, sectionPoint, stationList, tube, type Profile } from '../shapes';
import { planformAt, surfacePoint, type SurfaceDef } from '../surfaces';

const DEG = Math.PI / 180;

export function capsule(ctx: BuildContext, part: HitCapsule['part'], a: Vec3, b: Vec3, radius: number): void {
  ctx.meta.capsules.push({ a, b, radius, part });
}

/** Two capsules along 30% and 70% chord of a (right-side) surface, mirrored when requested. */
export function surfaceCapsules(
  ctx: BuildContext,
  def: SurfaceDef,
  part: 'wingR' | 'tail',
  mirror: boolean,
  s0 = 0,
): void {
  const st = def.stations;
  const sMax = st[st.length - 1]!.s;
  const pf0 = planformAt(def, s0, { le: 0, chord: 0, t: 0, twist: 0 });
  const pf1 = planformAt(def, sMax, { le: 0, chord: 0, t: 0, twist: 0 });
  const mean = (pf0.chord + pf1.chord) / 2;
  const r = Math.min(Math.max(mean * 0.2, 0.18), 0.75);
  for (const c of [0.3, 0.7]) {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [0, 0, 0];
    surfacePoint(def, s0 + r * 0.5, c, 0, a);
    surfacePoint(def, sMax - r * 0.5, c, 0, b);
    ctx.meta.capsules.push({ a: [...a], b: [...b], radius: r, part });
    if (mirror) {
      ctx.meta.capsules.push({
        a: [-a[0], a[1], a[2]],
        b: [-b[0], b[1], b[2]],
        radius: r,
        part: part === 'wingR' ? 'wingL' : part,
      });
    }
  }
}

type Face = 'right' | 'left' | 'top' | 'bottom';

const AXES: Record<Face, { right: Vec3; up: Vec3 }> = {
  right: { right: [0, 0, -1], up: [0, 1, 0] },
  left: { right: [0, 0, 1], up: [0, 1, 0] },
  top: { right: [1, 0, 0], up: [0, 0, -1] },
  bottom: { right: [-1, 0, 0], up: [0, 0, -1] },
};

/** Adds a projected decal. Face selects the projection axis; halfW/halfH in metres. */
export function decal(
  ctx: BuildContext,
  face: Face,
  center: Vec3,
  halfW: number,
  halfH: number,
  opts: Partial<DecalDef> & { atlas?: string } = {},
): void {
  if (ctx.lod !== 0) return;
  const ax = AXES[face];
  ctx.meta.decals.push({
    type: 0,
    center,
    right: ax.right,
    up: ax.up,
    halfW,
    halfH,
    depth: 0.6,
    color: [1, 1, 1, 1],
    ...opts,
  });
}

/** Decal on both sides (left/right faces or top/bottom mirrored across x). */
export function decalPair(
  ctx: BuildContext,
  face: 'side' | 'top' | 'bottom',
  center: Vec3,
  halfW: number,
  halfH: number,
  opts: Partial<DecalDef> = {},
): void {
  if (face === 'side') {
    decal(ctx, 'right', [Math.abs(center[0]), center[1], center[2]], halfW, halfH, opts);
    decal(ctx, 'left', [-Math.abs(center[0]), center[1], center[2]], halfW, halfH, opts);
  } else {
    decal(ctx, face, [Math.abs(center[0]), center[1], center[2]], halfW, halfH, opts);
    decal(ctx, face, [-Math.abs(center[0]), center[1], center[2]], halfW, halfH, opts);
  }
}

/** Flat interior-colour rectangle (gear bay seen through open doors, cockpit tub). */
export function bay(ctx: BuildContext, face: Face, center: Vec3, halfW: number, halfH: number): void {
  decal(ctx, face, center, halfW, halfH, { type: 3, color: [0.16, 0.17, 0.17, 1], depth: 0.35 });
}

/**
 * Speed brake panel: a patch of the fuselage skin (ring params t0..t1, may wrap past 1) hinged at its front
 * edge. dir = 1 opens downward (ventral), -1 upward (dorsal).
 */
export function airbrakePanel(
  ctx: BuildContext,
  prof: Profile,
  d: { z0: number; z1: number; t0: number; t1: number; dir: 1 | -1; max: number; cx?: number },
): number {
  const sec = makeSection();
  const tmp = new Float64Array(2);
  prof.at(d.z0, sec);
  sectionPoint(sec, (d.t0 + d.t1) / 2, tmp, 0);
  const bone = ctx.rig.add({
    role: 'airbrake',
    pivot: [d.cx ?? 0, tmp[1]!, d.z0],
    axis: [1, 0, 0],
    max: d.max * DEG,
    param: d.dir,
  });
  if (ctx.lod !== 0) return bone;
  const b = ctx.body;
  b.bone = bone;
  b.part = PART.fuselage;
  const zs = stationList(d.z0, d.z1, 0.2);
  const nJ = 9;
  const tmp2 = new Float64Array(2);
  for (const face of [1, -1]) {
    const P = new Float64Array(zs.length * nJ * 3);
    for (let i = 0; i < zs.length; i++) {
      prof.at(zs[i]!, sec);
      for (let j = 0; j < nJ; j++) {
        const t = d.t0 + ((d.t1 - d.t0) * j) / (nJ - 1);
        sectionPoint(sec, t % 1, tmp, 0);
        sectionPoint(sec, (t + 0.002) % 1, tmp2, 0);
        const tx = tmp2[0]! - tmp[0]!;
        const ty = tmp2[1]! - tmp[1]!;
        const l = Math.hypot(tx, ty) || 1;
        const off = face > 0 ? 0.014 : -0.006;
        const o = (i * nJ + j) * 3;
        P[o] = tmp[0]! + (-ty / l) * off;
        P[o + 1] = tmp[1]! + (tx / l) * off;
        P[o + 2] = zs[i]!;
      }
    }
    if (face > 0) b.style(PAINT.livery, 0xffffff, PANEL.plain);
    else b.style(PAINT.interior, 0x8e918c, PANEL.plain);
    gridSurface(b, P, zs.length, nJ, { flip: face < 0 });
  }
  b.bone = ROOT_BONE;
  return bone;
}

/** Gun port: a short dark barrel shroud and blast soot; records the muzzle. */
export function gunPort(ctx: BuildContext, muzzle: Vec3, r: number, len: number): void {
  ctx.meta.gunMuzzle = [...muzzle];
  if (ctx.lod !== 0) return;
  const b = ctx.body;
  b.bone = ROOT_BONE;
  b.style(PAINT.interior, 0x1a1b1c, PANEL.plain);
  b.ao = 0.4;
  tube(
    b,
    [
      [muzzle[0], muzzle[1], muzzle[2]],
      [muzzle[0], muzzle[1], muzzle[2] + len],
    ],
    r,
    8,
  );
  b.ao = 1;
}

/** Standard light set: red left tip, green right tip, white tail, white tip strobes, red beacons. */
export function lightsAt(
  ctx: BuildContext,
  tipR: Vec3,
  tipBoneR: number,
  tipBoneL: number,
  tail: Vec3,
  tailBone: number,
  beacons: Vec3[],
): void {
  if (ctx.lod !== 0) return;
  const fx = ctx.fx;
  fx.light([-tipR[0], tipR[1], tipR[2]], 3, [1, 0.05, 0.03], 0.14, PART.wingL, tipBoneL);
  fx.light(tipR, 3, [0.08, 1, 0.3], 0.14, PART.wingR, tipBoneR);
  fx.light([-tipR[0], tipR[1], tipR[2] + 0.35], 4, [0.95, 0.97, 1], 0.2, PART.wingL, tipBoneL);
  fx.light([tipR[0], tipR[1], tipR[2] + 0.35], 4, [0.95, 0.97, 1], 0.2, PART.wingR, tipBoneR);
  fx.light(tail, 3, [1, 0.95, 0.85], 0.12, PART.tail, tailBone);
  for (const p of beacons) fx.light(p, 5, [1, 0.1, 0.05], 0.18, -1, ROOT_BONE);
}

/** Standard marking set placed from a few anchor points. */
export interface MarkingAnchors {
  /** Wing insignia centre (right wing, top surface). */
  wingInsignia: Vec3;
  wingInsigniaSize: number;
  /** Fuselage side insignia centre (right side). */
  bodyInsignia: Vec3;
  bodyInsigniaSize: number;
  /** Fin side: tail number centre (right face) and fin x offset handled by caller. */
  fins: { center: Vec3; face: 'right' | 'left' }[];
  finNumberH: number;
  /** Nose modex (right side). */
  nose: Vec3;
  /** Canopy rescue arrow (right side). */
  rescue: Vec3;
  /** Intake danger chevrons (right side). */
  danger: Vec3 | null;
  /** NO STEP on flap roots (right wing, top). */
  noStep: Vec3;
  /** Fin flash stripe region. */
  flash: { z0: number; z1: number; y0: number; y1: number } | null;
}

export function markings(ctx: BuildContext, a: MarkingAnchors): void {
  const s = a.wingInsigniaSize;
  // Insignia: top of left wing and underside of right wing, plus fuselage sides.
  decal(ctx, 'top', [-a.wingInsignia[0], a.wingInsignia[1], a.wingInsignia[2]], s, s, {
    atlas: 'insigniaBlue',
    team: 'blue',
  });
  decal(ctx, 'top', [-a.wingInsignia[0], a.wingInsignia[1], a.wingInsignia[2]], s, s, {
    atlas: 'insigniaRed',
    team: 'red',
  });
  decal(ctx, 'bottom', [a.wingInsignia[0], a.wingInsignia[1], a.wingInsignia[2]], s, s, {
    atlas: 'insigniaBlue',
    team: 'blue',
  });
  decal(ctx, 'bottom', [a.wingInsignia[0], a.wingInsignia[1], a.wingInsignia[2]], s, s, {
    atlas: 'insigniaRed',
    team: 'red',
  });
  const bs = a.bodyInsigniaSize;
  decalPair(ctx, 'side', a.bodyInsignia, bs, bs, { atlas: 'insigniaBlue', team: 'blue', depth: 0.9 });
  decalPair(ctx, 'side', a.bodyInsignia, bs, bs, { atlas: 'insigniaRed', team: 'red', depth: 0.9 });
  for (const f of a.fins) {
    const h = a.finNumberH;
    decal(ctx, f.face, f.center, h * 1.35, h * 0.5, {
      type: 1,
      stencil: true,
      color: [1, 1, 1, 0.92],
      depth: 0.25,
    });
    decal(ctx, f.face, [f.center[0], f.center[1] + h * 0.95, f.center[2] + h * 0.1], h * 0.55, h * 0.45, {
      atlas: 'squadronBlue',
      team: 'blue',
      depth: 0.25,
    });
    decal(ctx, f.face, [f.center[0], f.center[1] + h * 0.95, f.center[2] + h * 0.1], h * 0.55, h * 0.45, {
      atlas: 'squadronRed',
      team: 'red',
      depth: 0.25,
    });
    decal(ctx, f.face, [f.center[0], f.center[1] - h * 0.8, f.center[2] + h * 0.05], h * 0.62, h * 0.2, {
      atlas: 'unitBlue',
      team: 'blue',
      stencil: true,
      depth: 0.25,
    });
    decal(ctx, f.face, [f.center[0], f.center[1] - h * 0.8, f.center[2] + h * 0.05], h * 0.62, h * 0.2, {
      atlas: 'unitRed',
      team: 'red',
      stencil: true,
      depth: 0.25,
    });
  }
  decalPair(ctx, 'side', a.nose, 0.3, 0.16, { type: 2, stencil: true, color: [1, 1, 1, 0.9], depth: 0.5 });
  decalPair(ctx, 'side', a.rescue, 0.26, 0.13, { atlas: 'rescue', depth: 0.5 });
  if (a.danger) decalPair(ctx, 'side', a.danger, 0.22, 0.11, { atlas: 'danger', depth: 0.5 });
  decalPair(ctx, 'top', a.noStep, 0.26, 0.09, {
    atlas: 'noStep',
    stencil: true,
    color: [1, 1, 1, 0.8],
    depth: 0.4,
  });
  if (a.flash) {
    const f = a.flash;
    for (const face of ['right', 'left'] as const) {
      decal(ctx, face, [0, (f.y0 + f.y1) / 2, (f.z0 + f.z1) / 2], (f.z1 - f.z0) / 2, (f.y1 - f.y0) / 2, {
        type: 3,
        accent: true,
        depth: 3,
      });
    }
  }
}

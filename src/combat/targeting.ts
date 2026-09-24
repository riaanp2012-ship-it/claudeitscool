import { Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import { clamp } from '../core/math';
import type { HardpointKind } from '../core/types';
import { MISSILES, UNGUIDED, type MissileDef, type MissileKind } from '../data/weapons';
import type { Targetable } from './targetable';

/**
 * Target selection and lock-on (spec §5.3). Locks need the target inside the weapon's lock cone and range,
 * with a clear line of sight through terrain (ZD-D09). IR range grows with the target's heat.
 */
const _toT = new Vector3();
const _fwd = new Vector3();

export function missileDefFor(kind: HardpointKind | null): MissileDef | null {
  if (!kind || kind === 'rocketPod' || kind === 'bomb' || kind === 'tank') return null;
  return MISSILES[kind as MissileKind];
}

export function weaponHudName(kind: HardpointKind | null): string {
  if (!kind) return 'GUN';
  if (kind === 'rocketPod') return UNGUIDED.rocketPod.hud;
  if (kind === 'bomb') return UNGUIDED.bomb.hud;
  if (kind === 'tank') return 'TANK';
  return MISSILES[kind as MissileKind].hud;
}

/** Angle (rad) between the aircraft's nose and a point. */
export function angleOffNose(ac: Aircraft, p: Vector3): number {
  ac.body.forward(_fwd);
  _toT.subVectors(p, ac.body.position);
  const d = _toT.length();
  if (d < 1e-3) return 0;
  return Math.acos(clamp(_toT.dot(_fwd) / d, -1, 1));
}

export function isValidTarget(ac: Aircraft, t: Targetable, def: MissileDef | null): boolean {
  if (!t.alive || t.team === ac.team || (t as unknown) === ac) return false;
  if (def?.surface && t.kind !== 'ground' && t.kind !== 'ship') return false;
  if (def && !def.surface && (t.kind === 'ground' || t.kind === 'ship')) return false;
  return true;
}

/**
 * Picks the next target. `cycle` moves to the next candidate after the current one (sorted by a score
 * of angle off the nose and distance); otherwise the best candidate is chosen.
 */
export function selectTarget(
  ac: Aircraft,
  targets: readonly Targetable[],
  cycle: boolean,
  maxRange = 40000,
): Targetable | null {
  const def = missileDefFor(ac.selectedKind());
  const scored: { t: Targetable; score: number }[] = [];
  for (const t of targets) {
    if (!isValidTarget(ac, t, def)) continue;
    const d = t.position.distanceTo(ac.body.position);
    if (d > maxRange) continue;
    const ang = angleOffNose(ac, t.position);
    scored.push({ t, score: ang * 2 + d / 12000 });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.score - b.score);
  if (!cycle || !ac.target) return scored[0]!.t;
  const i = scored.findIndex((s) => s.t === ac.target);
  return scored[(i + 1) % scored.length]!.t;
}

export interface LockEnvironment {
  lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
}

/**
 * Advances lock progress for the selected missile against the current target.
 * `losClear` is refreshed by the caller at a lower rate to keep terrain marching cheap.
 */
export function updateLock(ac: Aircraft, dt: number, losClear: boolean): void {
  const def = missileDefFor(ac.selectedKind());
  const t = ac.target;
  if (!def || !t || !t.alive || ac.roundsOf(def.id) <= 0) {
    ac.lockProgress = Math.max(0, ac.lockProgress - dt * 2);
    ac.locked = false;
    return;
  }
  const d = t.position.distanceTo(ac.body.position);
  const rangeScale =
    def.seeker === 'ir'
      ? clamp(t.heat(), 0.8, 1.8)
      : def.seeker === 'radar'
        ? clamp(Math.sqrt(t.rcs), 0.5, 1.3)
        : 1;
  const maxRange = def.maxRange * rangeScale * 1.1;
  const inCone = angleOffNose(ac, t.position) <= def.lockCone;
  if (inCone && d <= maxRange && d >= def.minRange * 0.5 && losClear) {
    const speed = def.seeker === 'ir' ? clamp(t.heat(), 1, 1.6) : 1;
    ac.lockProgress = Math.min(1, ac.lockProgress + (dt / def.lockTime) * speed);
  } else {
    ac.lockProgress = Math.max(0, ac.lockProgress - dt * (inCone ? 0.8 : 2.5));
  }
  ac.locked = ac.lockProgress >= 1;
}

/** Launch envelope for the HUD: returns min, max, no-escape and current range for the selected missile. */
export function envelope(ac: Aircraft): { min: number; max: number; noEscape: number; range: number } | null {
  const def = missileDefFor(ac.selectedKind());
  const t = ac.target;
  if (!def || !t) return null;
  return {
    min: def.minRange,
    max: def.maxRange,
    noEscape: def.noEscape,
    range: t.position.distanceTo(ac.body.position),
  };
}

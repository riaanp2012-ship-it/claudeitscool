import type { Vector3 } from 'three';
import type { Team } from '../core/types';

export type DamagePart = 'fuselage' | 'cockpit' | 'engine' | 'wingL' | 'wingR' | 'tail';

/** Anything weapons can lock, hit and destroy: aircraft, drones, ground targets, ships. */
export interface Targetable {
  readonly uid: number;
  readonly team: Team;
  readonly kind: 'aircraft' | 'ground' | 'ship' | 'drone';
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly radius: number;
  readonly label: string;
  alive: boolean;
  /** Relative radar signature (1 = typical fighter). */
  readonly rcs: number;
  /** IR signature multiplier (afterburner raises it). */
  heat(): number;
  /** 0..1 remaining structural health. */
  health(): number;
  /** Returns the part hit by the world-space segment a→b, or null. */
  hitSegment(a: Vector3, b: Vector3): DamagePart | null;
  /** Applies damage; `part` null means blast damage distributed by the target. */
  applyDamage(
    amount: number,
    part: DamagePart | null,
    source: DamageSource | null,
    blastCenter?: Vector3,
  ): void;
}

export interface DamageSource {
  readonly uid: number;
  readonly team: Team;
  readonly label: string;
  readonly isPlayer: boolean;
}

export interface KillEvent {
  victim: Targetable;
  killer: DamageSource | null;
  assists: readonly DamageSource[];
  weapon: string;
  cause: 'weapon' | 'crash' | 'collision';
  time: number;
}

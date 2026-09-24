import type { HardpointKind } from '../core/types';

/**
 * Weapon data (spec §5.3). Ranges are compressed ~50% from real life so fights stay visual;
 * RANGE_SCALE scales every missile range at once.
 */
export const RANGE_SCALE = 1;

export interface GunDef {
  id: 'gun25' | 'gun30';
  name: string;
  rate: number; // rounds per second
  muzzleVelocity: number; // m/s
  damage: number; // per hit
  dispersion: number; // rad (1 sigma)
  lifetime: number; // s
  tracerEvery: number;
  range: number; // effective range for the lead pip, m
}

export const GUNS: Record<GunDef['id'], GunDef> = {
  gun25: {
    id: 'gun25',
    name: '25 mm rotary',
    rate: 60,
    muzzleVelocity: 1050,
    damage: 9,
    dispersion: 0.0015,
    lifetime: 2,
    tracerEvery: 4,
    range: 1200,
  },
  gun30: {
    id: 'gun30',
    name: '30 mm revolver',
    rate: 28,
    muzzleVelocity: 900,
    damage: 22,
    dispersion: 0.0018,
    lifetime: 2,
    tracerEvery: 3,
    range: 1100,
  },
};

export type MissileKind = 'srm' | 'mrm' | 'lraam' | 'agm';

export interface MissileDef {
  id: MissileKind;
  name: string;
  hud: string;
  callout: string;
  seeker: 'ir' | 'radar' | 'tv';
  /** Surface targets only (AGM). */
  surface: boolean;
  minRange: number;
  maxRange: number;
  /** Range inside which a target cannot escape by maneuvering. */
  noEscape: number;
  lockTime: number; // s
  /** Half-angle from boresight inside which a lock can be built (rad). */
  lockCone: number;
  /** Seeker gimbal limit after launch (rad). */
  gimbal: number;
  maxG: number;
  motorTime: number; // s
  motorAccel: number; // m/s^2
  dragK: number; // quadratic drag coefficient at sea level
  lifetime: number;
  fuse: number; // proximity fuse radius (m)
  blast: number; // damage radius (m)
  damage: number;
  /** 0..1 resistance to flares (IR) or chaff/notching (radar). */
  resist: number;
  navGain: number;
  /** Radius (m) inside which an active-radar missile guides itself (pitbull). */
  pitbull: number;
  cooldown: number; // s between launches of this type
}

export const MISSILES: Record<MissileKind, MissileDef> = {
  srm: {
    id: 'srm',
    name: 'SRM short-range IR missile',
    hud: 'SRM',
    callout: 'Fox Two',
    seeker: 'ir',
    surface: false,
    minRange: 300 * RANGE_SCALE,
    maxRange: 5000 * RANGE_SCALE,
    noEscape: 1600 * RANGE_SCALE,
    lockTime: 1.0,
    lockCone: 0.35,
    gimbal: 0.8,
    maxG: 35,
    motorTime: 2.5,
    motorAccel: 260,
    dragK: 7.5e-5,
    lifetime: 14,
    fuse: 8,
    blast: 14,
    damage: 115,
    resist: 0.35,
    navGain: 3.6,
    pitbull: 0,
    cooldown: 0.6,
  },
  mrm: {
    id: 'mrm',
    name: 'MRM medium-range active radar missile',
    hud: 'MRM',
    callout: 'Fox Three',
    seeker: 'radar',
    surface: false,
    minRange: 1500 * RANGE_SCALE,
    maxRange: 20000 * RANGE_SCALE,
    noEscape: 6000 * RANGE_SCALE,
    lockTime: 2.0,
    lockCone: 0.52,
    gimbal: 1.0,
    maxG: 30,
    motorTime: 4,
    motorAccel: 230,
    dragK: 4.5e-5,
    lifetime: 40,
    fuse: 12,
    blast: 18,
    damage: 125,
    resist: 0.5,
    navGain: 3.2,
    pitbull: 8000 * RANGE_SCALE,
    cooldown: 0.9,
  },
  lraam: {
    id: 'lraam',
    name: 'LRAAM long-range missile',
    hud: 'LRAAM',
    callout: 'Fox Three',
    seeker: 'radar',
    surface: false,
    minRange: 5000 * RANGE_SCALE,
    maxRange: 35000 * RANGE_SCALE,
    noEscape: 10000 * RANGE_SCALE,
    lockTime: 3.0,
    lockCone: 0.52,
    gimbal: 1.0,
    maxG: 25,
    motorTime: 6,
    motorAccel: 220,
    dragK: 3.2e-5,
    lifetime: 60,
    fuse: 14,
    blast: 20,
    damage: 130,
    resist: 0.55,
    navGain: 3,
    pitbull: 10000 * RANGE_SCALE,
    cooldown: 1.2,
  },
  agm: {
    id: 'agm',
    name: 'AGM TV-guided air-to-ground missile',
    hud: 'AGM',
    callout: 'Rifle',
    seeker: 'tv',
    surface: true,
    minRange: 800 * RANGE_SCALE,
    maxRange: 8000 * RANGE_SCALE,
    noEscape: 8000 * RANGE_SCALE,
    lockTime: 1.5,
    lockCone: 0.45,
    gimbal: 1.1,
    maxG: 18,
    motorTime: 5,
    motorAccel: 160,
    dragK: 6e-5,
    lifetime: 40,
    fuse: 4,
    blast: 16,
    damage: 260,
    resist: 1,
    navGain: 3,
    pitbull: 0,
    cooldown: 1.0,
  },
};

export interface UnguidedDef {
  id: 'rocketPod' | 'bomb';
  name: string;
  hud: string;
  callout: string;
  rounds: number; // per station
  speed: number; // launch speed added to aircraft velocity along the nose (m/s)
  damage: number;
  blast: number;
  /** Laser-guided bombs steer toward the designated point. */
  guided: boolean;
  cooldown: number;
}

export const UNGUIDED: Record<UnguidedDef['id'], UnguidedDef> = {
  rocketPod: {
    id: 'rocketPod',
    name: 'Rocket pod (19 unguided rockets)',
    hud: 'RKT',
    callout: 'Rockets away',
    rounds: 19,
    speed: 700,
    damage: 45,
    blast: 9,
    guided: false,
    cooldown: 0.12,
  },
  bomb: {
    id: 'bomb',
    name: 'Laser-guided bomb',
    hud: 'LGB',
    callout: 'Pickle',
    rounds: 1,
    speed: 0,
    damage: 300,
    blast: 30,
    guided: true,
    cooldown: 0.6,
  },
};

/** What a hardpoint kind carries and how many rounds per station. */
export function roundsFor(kind: HardpointKind): number {
  if (kind === 'rocketPod') return UNGUIDED.rocketPod.rounds;
  if (kind === 'tank') return 0;
  return 1;
}

export const FLARE = { life: 3.2, ejectSpeed: 32, cooldown: 0.25, salvo: 2 };
export const CHAFF = { life: 4, ejectSpeed: 20, cooldown: 0.25, salvo: 2 };

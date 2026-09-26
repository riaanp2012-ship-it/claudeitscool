/**
 * Effects tuning data. Everything the effects system looks like lives here as plain data: capacities,
 * particle styles, trail looks and explosion/impact recipes. Colors are linear; emissive values are HDR
 * (above 1 so bloom catches them). Albedo values are reflectances lit by the shared atmosphere sun.
 */
import type { ExplosionKind, ImpactKind, QualityLevel, TrailKind } from '../core/types';

// ─────────────────────────────────────────────────────────────── Capacities

/** Buffers are allocated once at this size; quality presets only lower the live limit. */
export const PARTICLE_MAX = 6000;
export const PARTICLE_CAPACITY: Record<QualityLevel, number> = { high: 6000, medium: 3500, low: 2000 };
/** Multiplier on the particle counts of every recipe. */
export const DETAIL: Record<QualityLevel, number> = { high: 1, medium: 0.72, low: 0.5 };
/** When the pool is fuller than this fraction, recipes halve their counts to keep headroom. */
export const HEADROOM_FRACTION = 0.85;

export const TRAIL_SLOTS = 96;
export const TRAIL_POINTS = 96;
/** Slots [0, TRAIL_ALPHA_SLOTS) are smoke ribbons; the rest are additive (fire, hot exhaust cores). */
export const TRAIL_ALPHA_SLOTS = 76;
export const TRAIL_SLOT_LIMIT: Record<QualityLevel, { alpha: number; add: number }> = {
  high: { alpha: 76, add: 20 },
  medium: { alpha: 62, add: 16 },
  low: { alpha: 46, add: 12 },
};
/** A trail that received no push for this long is released automatically (a lost handle never leaks a slot). */
export const TRAIL_ORPHAN_SECONDS = 5;

export const MAX_GLOWS = 768;
export const MAX_TRACERS = 512;
export const MAX_MUZZLES = 64;
export const MAX_DOTS = 256;
export const DEBRIS_MAX = 96;
/** Additive instances reserved after the particles for immediate-mode sprites (a muzzle uses two). */
export const IMMEDIATE_ADD = MAX_GLOWS + MAX_TRACERS + MAX_MUZZLES * 2;

// ─────────────────────────────────────────────────────────────── Screen-space limits (ZD-B13, ZD-B36)

export const MIN_GLOW_PX = 2.5;
export const MIN_TRACER_PX = 1.5;
export const MIN_SPRITE_PX = 1.5;
export const MIN_RIBBON_HALF_PX = 0.75;
export const DOT_MIN_PX = 2;
export const DOT_MAX_PX = 5;
/** World size (m) projected to size a distant-aircraft dot before clamping to [DOT_MIN_PX, DOT_MAX_PX]. */
export const DOT_WORLD_SIZE = 14;

// ─────────────────────────────────────────────────────────────── Air

/** Wind that smoke drifts with (m/s). */
export const WIND = { x: 3.2, y: 0, z: -1.6 } as const;
export const GRAVITY = 9.81;
/** Seconds a particle takes to fade out after hitting the ground (never snaps out, ZD-B34). */
export const CONTACT_FADE = 0.3;

// ─────────────────────────────────────────────────────────────── Atlas layers

export const LAYER = {
  PUFF: 0,
  PUFF_COUNT: 6,
  FIRE: 6,
  FIRE_COUNT: 2,
  GLOW: 8,
  STREAK: 9,
  RING: 10,
  STAR: 11,
  CLOD: 12,
  SPRAY: 13,
  MUZZLE: 14,
  DISC: 15,
} as const;
export const ATLAS_SIZE = 128;
export const ATLAS_LAYERS = 16;
export const NOISE_SIZE = 128;

// ─────────────────────────────────────────────────────────────── Particle styles

/** Shader modes. Alpha batch: 0 lit smoke, 1 unlit tint. Additive: 0 sprite, 1 fire, 2 streak, 3 glow. */
export const MODE_LIT = 0;
export const MODE_TINT = 1;
export const MODE_SPRITE = 0;
export const MODE_FIRE = 1;
export const MODE_STREAK = 2;
/** Procedural soft glow (no texture, so bright glows never band). */
export const MODE_GLOW = 3;

export const COLLIDE_NONE = 0;
/** Slides along the ground (smoke, dust). */
export const COLLIDE_SLIDE = 1;
/** Stops and fades out on contact (dirt, spray, embers). */
export const COLLIDE_FADE = 2;
/** Bounces (sparks). */
export const COLLIDE_BOUNCE = 3;

export interface ParticleStyleDef {
  additive: boolean;
  mode: number;
  layer: number;
  layers: number;
  /** 1/s; pulls the velocity toward the wind (times `wind`). */
  drag: number;
  /** m/s²: negative is gravity, positive is buoyancy. */
  accelY: number;
  wind: number;
  /** Fractions of life. */
  fadeIn: number;
  fadeOut: number;
  /** Size easing: 1 linear, 2 quadratic ease-out, 3 cubic ease-out. */
  grow: number;
  collide: number;
  /** Max rotation speed (rad/s). */
  spin: number;
  /** Texture erosion reached at the end of life (smoke thins from its edges instead of fading uniformly). */
  erode: number;
  /** How fast additive colors cool toward red (0 none). */
  cool: number;
  /** Streak length in seconds of travel (sparks). */
  stretch: number;
}

/** Opacity of fire sprites (fraction of their mask): flames hide the sky behind them. */
export const FIRE_OCCLUSION = 0.72;
/** Emission of a single fire layer relative to the ramp (a dense fireball converges to ramp × EMIT / OCCLUSION). */
export const FIRE_EMIT = 0.85;

export const STYLE = {
  SMOKE: 0,
  DUST: 1,
  SPRAY: 2,
  MIST: 3,
  DIRT: 4,
  RING: 5,
  FIRE: 6,
  FLASH: 7,
  SPARK: 8,
  EMBER: 9,
} as const;

const style = (s: Partial<ParticleStyleDef> & { additive: boolean; mode: number }): ParticleStyleDef => ({
  layer: LAYER.PUFF,
  layers: LAYER.PUFF_COUNT,
  drag: 1,
  accelY: 0,
  wind: 1,
  fadeIn: 0.05,
  fadeOut: 0.4,
  grow: 3,
  collide: COLLIDE_NONE,
  spin: 0.3,
  erode: 0,
  cool: 0,
  stretch: 0,
  ...s,
});

export const STYLES: readonly ParticleStyleDef[] = [
  // SMOKE: buoyant, lit, drifts with the wind, thins from the edges.
  style({
    additive: false,
    mode: MODE_LIT,
    drag: 0.85,
    accelY: 1.1,
    fadeIn: 0.04,
    fadeOut: 0.38,
    collide: COLLIDE_SLIDE,
    spin: 0.22,
    erode: 0.5,
  }),
  // DUST: heavy, settles.
  style({
    additive: false,
    mode: MODE_LIT,
    drag: 1.3,
    accelY: -0.35,
    wind: 0.8,
    fadeIn: 0.03,
    fadeOut: 0.32,
    collide: COLLIDE_SLIDE,
    spin: 0.18,
    erode: 0.45,
  }),
  // SPRAY: water droplets thrown ballistically.
  style({
    additive: false,
    mode: MODE_LIT,
    layer: LAYER.SPRAY,
    layers: 1,
    drag: 0.55,
    accelY: -GRAVITY,
    wind: 0.2,
    fadeIn: 0.02,
    fadeOut: 0.5,
    grow: 2,
    collide: COLLIDE_FADE,
    spin: 0.5,
    erode: 0.35,
  }),
  // MIST: slow, wide, faint.
  style({
    additive: false,
    mode: MODE_LIT,
    drag: 1.6,
    accelY: 0.25,
    fadeIn: 0.12,
    fadeOut: 0.3,
    collide: COLLIDE_SLIDE,
    spin: 0.12,
    erode: 0.55,
  }),
  // DIRT: clods thrown out of a crater.
  style({
    additive: false,
    mode: MODE_LIT,
    layer: LAYER.CLOD,
    layers: 1,
    drag: 0.12,
    accelY: -GRAVITY,
    wind: 0,
    fadeIn: 0.01,
    fadeOut: 0.85,
    grow: 1,
    collide: COLLIDE_FADE,
    spin: 5,
  }),
  // RING: faint shock front.
  style({
    additive: false,
    mode: MODE_TINT,
    layer: LAYER.RING,
    layers: 1,
    drag: 0,
    wind: 0,
    fadeIn: 0,
    fadeOut: 0.15,
    grow: 2,
    spin: 0,
  }),
  // FIRE: fireball lobes and burning debris.
  style({
    additive: true,
    mode: MODE_FIRE,
    layer: LAYER.FIRE,
    layers: LAYER.FIRE_COUNT,
    drag: 2.2,
    accelY: 3,
    wind: 0.5,
    fadeIn: 0.04,
    fadeOut: 0.3,
    grow: 2,
    collide: COLLIDE_SLIDE,
    spin: 1.1,
  }),
  // FLASH: the first frames of a detonation.
  style({
    additive: true,
    mode: MODE_SPRITE,
    layer: LAYER.STAR,
    layers: 1,
    drag: 0,
    wind: 0,
    fadeIn: 0,
    fadeOut: 0.05,
    grow: 2,
    spin: 0,
  }),
  // SPARK: hot fragments, drawn as streaks along their velocity.
  style({
    additive: true,
    mode: MODE_STREAK,
    layer: LAYER.STREAK,
    layers: 1,
    drag: 0.55,
    accelY: -GRAVITY,
    wind: 0,
    fadeIn: 0,
    fadeOut: 0.45,
    grow: 1,
    collide: COLLIDE_BOUNCE,
    spin: 0,
    cool: 1,
    stretch: 0.035,
  }),
  // EMBER: slower glowing bits.
  style({
    additive: true,
    mode: MODE_SPRITE,
    layer: LAYER.DISC,
    layers: 1,
    drag: 0.9,
    accelY: -3,
    wind: 0.6,
    fadeIn: 0,
    fadeOut: 0.5,
    grow: 1,
    collide: COLLIDE_FADE,
    spin: 0,
    cool: 0.8,
  }),
];

// ─────────────────────────────────────────────────────────────── Trails

export interface TrailKindDef {
  additive: boolean;
  /** Seconds a point lives. */
  life: number;
  width0: number;
  width1: number;
  /** Seconds to reach half of the width growth. */
  growTau: number;
  opacity: number;
  /** Seconds of fade-in after emission (contrails condense a little behind the engine). */
  fadeIn: number;
  /** Fraction of life where the fade-out starts. */
  fadeOut: number;
  /** 0..1: how much opacity drops as the ribbon widens (the same smoke spread over more area). */
  thin: number;
  /** Linear albedo (smoke) or HDR emission (additive). */
  color: readonly [number, number, number];
  /** Minimum distance between committed points (m); raised automatically so the buffer covers the life. */
  segLen: number;
  maxSegTime: number;
  /** Commit early when the path bends more than this (cosine of the angle). */
  bendCos: number;
  /** Coherent drift amplitude (m/s), rise (m/s), velocity damping (1/s) and wind following. */
  drift: number;
  rise: number;
  drag: number;
  wind: number;
  /** Texture: world meters per noise repeat along the ribbon, and how much noise breaks up the density. */
  texScale: number;
  noise: number;
  /** Additive ribbons only: how much the ribbon also occludes what is behind it (flames are not glass). */
  occlusion: number;
}

/** Internal ribbon kinds; the public kinds map onto these (missile and flare also get an additive core). */
export const RIBBON = {
  MISSILE: 0,
  CONTRAIL: 1,
  VORTEX: 2,
  DAMAGE: 3,
  FIRE: 4,
  FLARE_SMOKE: 5,
  FLARE_CORE: 6,
  MISSILE_CORE: 7,
  DEBRIS: 8,
} as const;
export const RIBBON_KINDS = 9;
/** Debris ribbons never take the last smoke slots, so missiles and contrails always find one. */
export const DEBRIS_RIBBON_RESERVE = 10;

const trailKind = (
  k: Partial<TrailKindDef> & { life: number; color: readonly [number, number, number] },
): TrailKindDef => ({
  additive: false,
  width0: 1,
  width1: 4,
  growTau: 2,
  opacity: 0.8,
  fadeIn: 0,
  fadeOut: 0.4,
  thin: 0.4,
  segLen: 8,
  maxSegTime: 0.25,
  bendCos: 0.9986,
  drift: 0.6,
  rise: 0.2,
  drag: 0.35,
  wind: 1,
  texScale: 40,
  noise: 0.6,
  occlusion: 0,
  ...k,
});

export const RIBBON_DEFS: readonly TrailKindDef[] = [
  // MISSILE: thick white-grey rocket smoke that widens, wanders and fades over ~7 s.
  trailKind({
    life: 7,
    width0: 1.3,
    width1: 11,
    growTau: 2.6,
    opacity: 0.92,
    fadeOut: 0.35,
    thin: 0.55,
    color: [0.8, 0.8, 0.79],
    segLen: 10,
    drift: 1.4,
    rise: 0.35,
    drag: 0.3,
    texScale: 28,
    noise: 0.75,
  }),
  // CONTRAIL: thin, long, bright white.
  trailKind({
    life: 14,
    width0: 1.6,
    width1: 9,
    growTau: 6,
    opacity: 0.85,
    fadeIn: 0.1,
    fadeOut: 0.5,
    thin: 0.45,
    color: [0.95, 0.96, 0.98],
    segLen: 24,
    maxSegTime: 0.5,
    drift: 0.25,
    rise: 0,
    drag: 0.2,
    wind: 0.6,
    texScale: 70,
    noise: 0.35,
  }),
  // VORTEX: very thin wingtip vapor, only while intensity > 0.
  trailKind({
    life: 1.1,
    width0: 0.3,
    width1: 1.1,
    growTau: 0.6,
    opacity: 0.6,
    fadeIn: 0.02,
    fadeOut: 0.2,
    thin: 0.3,
    color: [0.92, 0.93, 0.95],
    segLen: 3,
    maxSegTime: 0.05,
    drift: 0.2,
    rise: 0,
    drag: 1,
    wind: 0.2,
    texScale: 12,
    noise: 0.45,
  }),
  // DAMAGE: dark grey smoke from a hit engine.
  trailKind({
    life: 5.5,
    width0: 1.8,
    width1: 13,
    growTau: 1.8,
    opacity: 0.82,
    fadeOut: 0.3,
    thin: 0.45,
    color: [0.075, 0.072, 0.07],
    segLen: 10,
    drift: 1.2,
    rise: 0.8,
    drag: 0.4,
    texScale: 24,
    noise: 0.8,
  }),
  // FIRE: short additive orange flame streaming from a burning aircraft.
  trailKind({
    additive: true,
    life: 0.45,
    width0: 2.6,
    width1: 0.9,
    growTau: 0.2,
    opacity: 1,
    fadeOut: 0.1,
    thin: 0,
    color: [5.2, 1.9, 0.45],
    segLen: 2.5,
    maxSegTime: 0.03,
    drift: 0.8,
    rise: 1.5,
    drag: 1,
    wind: 0.2,
    texScale: 9,
    noise: 0.7,
    occlusion: 0.35,
  }),
  // FLARE_SMOKE: white smoke behind a falling flare.
  trailKind({
    life: 3.8,
    width0: 1.5,
    width1: 9,
    growTau: 1.4,
    opacity: 0.85,
    fadeOut: 0.3,
    thin: 0.5,
    color: [0.88, 0.88, 0.87],
    segLen: 4,
    drift: 0.9,
    rise: 0.3,
    drag: 0.5,
    texScale: 16,
    noise: 0.7,
  }),
  // FLARE_CORE: blinding white-magenta magnesium burn.
  trailKind({
    additive: true,
    life: 0.12,
    width0: 1.5,
    width1: 0.8,
    growTau: 0.06,
    opacity: 1,
    fadeOut: 0,
    thin: 0,
    color: [14, 11, 12],
    segLen: 0.8,
    maxSegTime: 0.02,
    drift: 0,
    rise: 0,
    drag: 1,
    wind: 0,
    texScale: 4,
    noise: 0.3,
  }),
  // MISSILE_CORE: hot exhaust right behind the motor.
  trailKind({
    additive: true,
    life: 0.05,
    width0: 0.9,
    width1: 0.4,
    growTau: 0.03,
    opacity: 1,
    fadeOut: 0,
    thin: 0,
    color: [9, 5.2, 2.4],
    segLen: 1.5,
    maxSegTime: 0.02,
    drift: 0,
    rise: 0,
    drag: 1,
    wind: 0,
    texScale: 6,
    noise: 0.35,
  }),
  // DEBRIS: black smoke streaming from a falling burning piece.
  trailKind({
    life: 3.2,
    width0: 1.1,
    width1: 8.5,
    growTau: 1.1,
    opacity: 0.88,
    fadeOut: 0.3,
    thin: 0.45,
    color: [0.07, 0.066, 0.062],
    segLen: 3,
    maxSegTime: 0.1,
    drift: 1.1,
    rise: 0.7,
    drag: 0.5,
    texScale: 13,
    noise: 0.85,
  }),
];

/** Which internal ribbons each public trail kind uses: [main, core] (-1 = none). */
export const TRAIL_LAYOUT: Record<TrailKind, readonly [number, number]> = {
  missile: [RIBBON.MISSILE, RIBBON.MISSILE_CORE],
  contrail: [RIBBON.CONTRAIL, -1],
  vortex: [RIBBON.VORTEX, -1],
  'damage-smoke': [RIBBON.DAMAGE, -1],
  fire: [RIBBON.FIRE, -1],
  flare: [RIBBON.FLARE_SMOKE, RIBBON.FLARE_CORE],
};

// ─────────────────────────────────────────────────────────────── Recipes

export const DIR_SPHERE = 0;
export const DIR_HEMI = 1;
export const DIR_CONE_UP = 2;
export const DIR_RING = 3;
export const DIR_NORMAL = 4;

export type Range = readonly [number, number];

export interface EmitterDef {
  style: number;
  count: number;
  life: Range;
  size0: Range;
  size1: Range;
  speed: Range;
  dir: number;
  /** Cone half-angle (rad) for cone/normal directions; vertical jitter for rings. */
  spread?: number;
  /** Random start position radius (m). */
  offset?: number;
  /** Height above the burst point (m), for ground and water bursts. */
  lift?: number;
  /** Extra vertical speed (m/s). */
  up?: number;
  delay?: Range;
  /** Albedo (alpha styles) or HDR tint (additive styles); fire ignores it (its color comes from heat). */
  color?: readonly [number, number, number];
  /** Random brightness variation (fraction). */
  jitter?: number;
  alpha?: number;
  /** Fraction of the burst velocity inherited. */
  inherit?: number;
  /** Fire temperature at birth (1 = yellow-white). */
  heat?: number;
  /** Orange self-illumination of smoke from the fireball, decays over the first second. */
  emissive?: number;
  /** Number of lobes the particles are split into (multi-lobe fireballs and smoke). */
  lobes?: number;
  lobeRadius?: number;
  /** Multiplies the style drag. */
  drag?: number;
}

export interface FlashDef {
  color: readonly [number, number, number];
  intensity: number;
  radius: number;
  duration: number;
}

export interface DebrisDef {
  count: number;
  speed: Range;
  size: Range;
  life: Range;
  inherit: number;
  /** Fraction of pieces that burn (fire + black smoke) instead of only smoking. */
  burning: number;
}

export interface RecipeDef {
  emitters: readonly EmitterDef[];
  flash: FlashDef;
  debris: DebrisDef | null;
}

const SMOKE_BLACK = [0.062, 0.058, 0.055] as const;
const SMOKE_DARK = [0.1, 0.095, 0.09] as const;
const DUST = [0.25, 0.205, 0.15] as const;
const DIRT = [0.11, 0.09, 0.07] as const;
const SPRAY = [0.86, 0.9, 0.92] as const;
const SPARK = [3.6, 1.6, 0.5] as const;
const FLASH_WHITE = [9, 7.5, 5.5] as const;

export const EXPLOSIONS: Record<ExplosionKind, RecipeDef> = {
  'air-small': {
    flash: { color: [1, 0.72, 0.42], intensity: 4, radius: 260, duration: 0.35 },
    debris: null,
    emitters: [
      {
        style: STYLE.FLASH,
        count: 1,
        life: [0.09, 0.11],
        size0: [16, 18],
        size1: [24, 26],
        speed: [0, 0],
        dir: DIR_SPHERE,
        color: FLASH_WHITE,
      },
      {
        style: STYLE.FIRE,
        count: 11,
        life: [0.32, 0.6],
        size0: [2.5, 4],
        size1: [7, 11],
        speed: [5, 14],
        dir: DIR_SPHERE,
        offset: 1.5,
        lobes: 2,
        lobeRadius: 2.5,
        heat: 1.25,
        inherit: 0.3,
      },
      {
        style: STYLE.SMOKE,
        count: 16,
        life: [3.6, 5.8],
        size0: [3.5, 5],
        size1: [11, 18],
        speed: [2, 8],
        dir: DIR_SPHERE,
        offset: 2,
        lobes: 3,
        lobeRadius: 3,
        delay: [0.02, 0.2],
        color: SMOKE_DARK,
        jitter: 0.25,
        alpha: 0.9,
        emissive: 0.7,
        inherit: 0.15,
      },
      {
        style: STYLE.SPARK,
        count: 32,
        life: [0.35, 0.9],
        size0: [0.12, 0.2],
        size1: [0.1, 0.15],
        speed: [70, 190],
        dir: DIR_SPHERE,
        color: SPARK,
        inherit: 0.3,
      },
      {
        style: STYLE.EMBER,
        count: 8,
        life: [0.8, 1.8],
        size0: [0.35, 0.6],
        size1: [0.2, 0.3],
        speed: [15, 45],
        dir: DIR_SPHERE,
        color: [4.5, 2.2, 0.8],
      },
      {
        style: STYLE.RING,
        count: 1,
        life: [0.24, 0.26],
        size0: [2, 2],
        size1: [44, 48],
        speed: [0, 0],
        dir: DIR_SPHERE,
        color: [0.95, 0.95, 0.97],
        alpha: 0.104,
      },
    ],
  },
  'air-large': {
    flash: { color: [1, 0.66, 0.34], intensity: 9, radius: 650, duration: 0.7 },
    debris: { count: 7, speed: [30, 75], size: [0.5, 1.6], life: [3, 5.5], inherit: 0.4, burning: 0.7 },
    emitters: [
      {
        style: STYLE.FLASH,
        count: 1,
        life: [0.13, 0.15],
        size0: [38, 42],
        size1: [56, 60],
        speed: [0, 0],
        dir: DIR_SPHERE,
        color: FLASH_WHITE,
      },
      {
        style: STYLE.FIRE,
        count: 34,
        life: [0.8, 1.5],
        size0: [6, 9],
        size1: [16, 28],
        speed: [4, 15],
        dir: DIR_SPHERE,
        offset: 3,
        lobes: 4,
        lobeRadius: 7,
        delay: [0, 0.1],
        heat: 1.35,
        inherit: 0.3,
      },
      {
        style: STYLE.FIRE,
        count: 12,
        life: [0.7, 1.2],
        size0: [8, 10],
        size1: [18, 26],
        speed: [2, 8],
        dir: DIR_SPHERE,
        offset: 4,
        lobes: 3,
        lobeRadius: 10,
        delay: [0.12, 0.35],
        heat: 0.95,
        inherit: 0.2,
      },
      {
        style: STYLE.SMOKE,
        count: 48,
        life: [6, 10],
        size0: [8, 12],
        size1: [26, 44],
        speed: [3, 12],
        dir: DIR_SPHERE,
        offset: 4,
        lobes: 4,
        lobeRadius: 9,
        delay: [0.02, 0.35],
        color: SMOKE_BLACK,
        jitter: 0.25,
        alpha: 0.92,
        emissive: 0.9,
        inherit: 0.12,
      },
      {
        style: STYLE.SPARK,
        count: 60,
        life: [0.5, 1.4],
        size0: [0.16, 0.26],
        size1: [0.1, 0.16],
        speed: [90, 240],
        dir: DIR_SPHERE,
        color: SPARK,
        inherit: 0.3,
      },
      {
        style: STYLE.EMBER,
        count: 22,
        life: [1, 2.6],
        size0: [0.45, 0.9],
        size1: [0.2, 0.4],
        speed: [20, 70],
        dir: DIR_SPHERE,
        color: [4.5, 2.1, 0.7],
      },
      {
        style: STYLE.RING,
        count: 1,
        life: [0.38, 0.42],
        size0: [4, 4],
        size1: [110, 120],
        speed: [0, 0],
        dir: DIR_SPHERE,
        color: [0.95, 0.95, 0.97],
        alpha: 0.156,
      },
    ],
  },
  aircraft: {
    flash: { color: [1, 0.62, 0.3], intensity: 10, radius: 700, duration: 0.9 },
    debris: { count: 10, speed: [20, 60], size: [0.5, 2.2], life: [3.5, 6.5], inherit: 0.45, burning: 0.75 },
    emitters: [
      {
        style: STYLE.FLASH,
        count: 1,
        life: [0.14, 0.16],
        size0: [40, 44],
        size1: [60, 64],
        speed: [0, 0],
        dir: DIR_SPHERE,
        color: FLASH_WHITE,
        inherit: 0.5,
      },
      {
        style: STYLE.FIRE,
        count: 40,
        life: [0.9, 1.8],
        size0: [7, 10],
        size1: [18, 30],
        speed: [4, 14],
        dir: DIR_SPHERE,
        offset: 4,
        lobes: 5,
        lobeRadius: 9,
        delay: [0, 0.15],
        heat: 1.3,
        inherit: 0.55,
      },
      {
        style: STYLE.FIRE,
        count: 14,
        life: [0.8, 1.4],
        size0: [8, 11],
        size1: [20, 28],
        speed: [2, 8],
        dir: DIR_SPHERE,
        offset: 5,
        lobes: 3,
        lobeRadius: 12,
        delay: [0.15, 0.45],
        heat: 0.9,
        inherit: 0.45,
      },
      {
        style: STYLE.SMOKE,
        count: 54,
        life: [6.5, 10],
        size0: [9, 13],
        size1: [28, 46],
        speed: [3, 11],
        dir: DIR_SPHERE,
        offset: 5,
        lobes: 5,
        lobeRadius: 10,
        delay: [0.02, 0.4],
        color: SMOKE_BLACK,
        jitter: 0.25,
        alpha: 0.92,
        emissive: 0.9,
        inherit: 0.3,
      },
      {
        style: STYLE.SPARK,
        count: 60,
        life: [0.5, 1.4],
        size0: [0.16, 0.26],
        size1: [0.1, 0.16],
        speed: [80, 220],
        dir: DIR_SPHERE,
        color: SPARK,
        inherit: 0.5,
      },
      {
        style: STYLE.EMBER,
        count: 26,
        life: [1, 2.8],
        size0: [0.45, 0.9],
        size1: [0.2, 0.4],
        speed: [20, 70],
        dir: DIR_SPHERE,
        color: [4.5, 2.1, 0.7],
        inherit: 0.5,
      },
      {
        style: STYLE.RING,
        count: 1,
        life: [0.38, 0.42],
        size0: [4, 4],
        size1: [110, 120],
        speed: [0, 0],
        dir: DIR_SPHERE,
        color: [0.95, 0.95, 0.97],
        alpha: 0.13,
        inherit: 0.5,
      },
    ],
  },
  ground: {
    flash: { color: [1, 0.64, 0.32], intensity: 7, radius: 320, duration: 0.55 },
    debris: { count: 4, speed: [20, 45], size: [0.4, 1.1], life: [2.5, 4], inherit: 0, burning: 0.5 },
    emitters: [
      {
        style: STYLE.FLASH,
        count: 1,
        life: [0.11, 0.13],
        size0: [26, 30],
        size1: [40, 44],
        speed: [0, 0],
        dir: DIR_SPHERE,
        lift: 3,
        color: FLASH_WHITE,
      },
      {
        style: STYLE.FIRE,
        count: 20,
        life: [0.55, 1.1],
        size0: [5, 8],
        size1: [14, 24],
        speed: [6, 18],
        up: 8,
        dir: DIR_HEMI,
        offset: 3,
        lift: 3,
        lobes: 3,
        lobeRadius: 5,
        heat: 1.3,
      },
      // Burning crater: small flames keep licking up for a few seconds and feed the smoke column.
      {
        style: STYLE.FIRE,
        count: 16,
        life: [0.5, 0.9],
        size0: [2.5, 4],
        size1: [4, 7],
        speed: [1, 3],
        up: 4,
        dir: DIR_HEMI,
        offset: 4,
        lift: 1.5,
        delay: [0.6, 4.5],
        heat: 0.9,
      },
      {
        style: STYLE.DIRT,
        count: 44,
        life: [2.2, 3.8],
        size0: [0.7, 1.7],
        size1: [0.9, 2],
        speed: [25, 72],
        dir: DIR_CONE_UP,
        spread: 0.75,
        offset: 2,
        lift: 1,
        color: DIRT,
        jitter: 0.3,
      },
      {
        style: STYLE.DUST,
        count: 28,
        life: [4, 6.5],
        size0: [6, 10],
        size1: [22, 40],
        speed: [8, 32],
        dir: DIR_CONE_UP,
        spread: 0.4,
        offset: 3,
        lift: 2,
        delay: [0, 0.15],
        color: DUST,
        jitter: 0.15,
        alpha: 0.8,
        drag: 0.5,
      },
      {
        style: STYLE.DUST,
        count: 22,
        life: [4.5, 7.5],
        size0: [5, 8],
        size1: [18, 32],
        speed: [14, 34],
        dir: DIR_RING,
        spread: 0.08,
        lift: 2,
        delay: [0.03, 0.2],
        color: DUST,
        jitter: 0.12,
        alpha: 0.62,
      },
      {
        style: STYLE.SMOKE,
        count: 30,
        life: [8, 12],
        size0: [6, 10],
        size1: [30, 48],
        speed: [3, 9],
        up: 10,
        dir: DIR_CONE_UP,
        spread: 0.3,
        offset: 5,
        lift: 6,
        delay: [0.2, 4.5],
        color: [0.1, 0.092, 0.085],
        jitter: 0.2,
        alpha: 0.86,
        emissive: 0.5,
        drag: 0.45,
      },
      {
        style: STYLE.SPARK,
        count: 26,
        life: [0.4, 1.1],
        size0: [0.15, 0.24],
        size1: [0.1, 0.14],
        speed: [40, 120],
        dir: DIR_HEMI,
        lift: 2,
        color: SPARK,
      },
    ],
  },
  water: {
    flash: { color: [1, 0.72, 0.45], intensity: 3.5, radius: 220, duration: 0.3 },
    debris: null,
    emitters: [
      {
        style: STYLE.FLASH,
        count: 1,
        life: [0.07, 0.09],
        size0: [14, 16],
        size1: [22, 24],
        speed: [0, 0],
        dir: DIR_SPHERE,
        lift: 2,
        color: [7, 6, 5],
      },
      {
        style: STYLE.SPRAY,
        count: 80,
        life: [2.4, 3.8],
        size0: [1.6, 3.2],
        size1: [5, 10],
        speed: [20, 62],
        dir: DIR_CONE_UP,
        spread: 0.22,
        offset: 3,
        lift: 1,
        color: SPRAY,
        jitter: 0.06,
        alpha: 0.95,
      },
      // Crown: thinner jets thrown wider that fall back as a curtain.
      {
        style: STYLE.SPRAY,
        count: 36,
        life: [2, 3.2],
        size0: [1, 1.8],
        size1: [3, 6],
        speed: [26, 48],
        dir: DIR_CONE_UP,
        spread: 0.55,
        offset: 4,
        lift: 1,
        color: SPRAY,
        jitter: 0.05,
        alpha: 0.85,
      },
      {
        style: STYLE.SPRAY,
        count: 34,
        life: [1.6, 2.6],
        size0: [1.5, 3],
        size1: [5, 8],
        speed: [12, 26],
        up: 10,
        dir: DIR_RING,
        spread: 0.2,
        lift: 1,
        color: SPRAY,
        jitter: 0.06,
        alpha: 0.9,
      },
      {
        style: STYLE.MIST,
        count: 18,
        life: [4.5, 7],
        size0: [10, 16],
        size1: [30, 50],
        speed: [4, 14],
        up: 3,
        dir: DIR_RING,
        spread: 0.3,
        lift: 4,
        delay: [0.2, 0.9],
        color: [0.9, 0.92, 0.94],
        jitter: 0.04,
        alpha: 0.42,
      },
      {
        style: STYLE.MIST,
        count: 10,
        life: [3.5, 5.5],
        size0: [8, 12],
        size1: [22, 34],
        speed: [2, 6],
        up: 14,
        dir: DIR_CONE_UP,
        spread: 0.2,
        lift: 12,
        delay: [0.4, 1.4],
        color: [0.92, 0.94, 0.96],
        alpha: 0.4,
      },
    ],
  },
};

export const IMPACTS: Record<ImpactKind, readonly EmitterDef[]> = {
  metal: [
    {
      style: STYLE.FLASH,
      count: 1,
      life: [0.05, 0.07],
      size0: [2.2, 2.8],
      size1: [3.2, 3.6],
      speed: [0, 0],
      dir: DIR_SPHERE,
      color: [7, 5, 2.8],
    },
    {
      style: STYLE.SPARK,
      count: 12,
      life: [0.15, 0.45],
      size0: [0.07, 0.12],
      size1: [0.05, 0.08],
      speed: [25, 85],
      dir: DIR_NORMAL,
      spread: 1.1,
      color: SPARK,
    },
    {
      style: STYLE.SMOKE,
      count: 2,
      life: [0.8, 1.4],
      size0: [0.7, 1.1],
      size1: [3, 4.5],
      speed: [1, 4],
      dir: DIR_NORMAL,
      spread: 0.8,
      color: [0.24, 0.23, 0.22],
      alpha: 0.55,
    },
  ],
  ground: [
    {
      style: STYLE.DUST,
      count: 4,
      life: [1.2, 2.1],
      size0: [1, 1.6],
      size1: [4, 6.5],
      speed: [2, 8],
      dir: DIR_NORMAL,
      spread: 0.6,
      color: DUST,
      jitter: 0.15,
      alpha: 0.78,
    },
    {
      style: STYLE.DIRT,
      count: 6,
      life: [0.7, 1.3],
      size0: [0.2, 0.45],
      size1: [0.25, 0.5],
      speed: [6, 18],
      dir: DIR_NORMAL,
      spread: 0.55,
      color: DIRT,
      jitter: 0.3,
    },
    {
      style: STYLE.SPARK,
      count: 2,
      life: [0.1, 0.25],
      size0: [0.06, 0.1],
      size1: [0.04, 0.06],
      speed: [15, 40],
      dir: DIR_NORMAL,
      spread: 1,
      color: SPARK,
    },
  ],
  water: [
    {
      style: STYLE.SPRAY,
      count: 10,
      life: [0.8, 1.4],
      size0: [0.5, 0.9],
      size1: [1.8, 3],
      speed: [6, 17],
      dir: DIR_NORMAL,
      spread: 0.22,
      color: SPRAY,
      jitter: 0.05,
      alpha: 0.9,
    },
    {
      style: STYLE.MIST,
      count: 2,
      life: [1.3, 2],
      size0: [1.6, 2.4],
      size1: [5, 7],
      speed: [0.5, 2],
      dir: DIR_NORMAL,
      spread: 0.5,
      lift: 0.5,
      color: [0.9, 0.92, 0.94],
      alpha: 0.35,
    },
  ],
};

/** Pieces spawned by the public `debris()` call (for example parts shed by a damaged aircraft). */
export const DEBRIS_PUBLIC: DebrisDef = {
  count: 1,
  speed: [8, 30],
  size: [0.4, 1.4],
  life: [3, 5.5],
  inherit: 1,
  burning: 0.6,
};

/** Debris pieces: what they emit while flying (per second) and how they look. */
export const DEBRIS = {
  drag: 0.3,
  /** Meters of travel between volume smoke puffs (the continuous streak is a ribbon) and flame sprites. */
  smokeSpacing: 7,
  fireSpacing: 1.4,
  /** Time fallback for slow pieces, and the smoulder rate once landed. */
  smokeInterval: 0.08,
  smoulderInterval: 0.22,
  maxPerFrame: 4,
  smokeLife: [2.2, 3.4] as Range,
  smokeSize0: [2.4, 3.4] as Range,
  smokeSize1: [9, 14] as Range,
  smokeAlpha: 0.55,
  smokeColor: [0.07, 0.066, 0.062] as const,
  fireLife: [0.2, 0.34] as Range,
  fireSize0: [1.6, 2.4] as Range,
  fireSize1: [0.6, 1] as Range,
  spin: 9,
  /** Seconds a piece shrinks away at the end of its life (never snaps out). */
  shrink: 0.6,
  bounce: 0.25,
} as const;

// ─────────────────────────────────────────────────────────────── Flash lights

/** Seconds of the flash rise; with reduced flashes the rise is slower and the peak lower. */
export const FLASH_ATTACK = 0.025;
export const FLASH_ATTACK_REDUCED = 0.1;
export const FLASH_REDUCED_SCALE = 0.35;
/** With reduced flashes, a new flash within this window of the last one is dimmed further. */
export const FLASH_REDUCED_WINDOW = 0.35;
/** PointLight candela per unit of flash intensity per m² of radius. */
export const FLASH_LIGHT_SCALE = 0.02;
/** Brightness of the explosion flash sprite with reduced flashes. */
export const FLASH_SPRITE_REDUCED = 0.4;

// ─────────────────────────────────────────────────────────────── Immediate sprites

export const MUZZLE = {
  starSize: 1.7,
  starColor: [7, 4.6, 2.1] as const,
  flameLength: 2.4,
  flameWidth: 0.85,
  flameColor: [6, 3.3, 1.3] as const,
};

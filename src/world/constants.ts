import type { QualityLevel } from '../core/types';

/**
 * World-module tuning. Distances in meters. The playable square is |x|,|z| < BOUNDARY; the detailed
 * heightmap covers NEAR_EXTENT, a coarser heightmap covers FAR_EXTENT and is mirrored beyond it, so terrain
 * continues to the far plane with no edge (ZD-B18).
 */
export const BOUNDARY = 16000;
export const NEAR_EXTENT = 40960;
export const FAR_EXTENT = 163840;
/** Chebyshev distance from the origin where the near heightmap starts blending into the far one. */
export const NEAR_BLEND_START = 18400;
export const NEAR_BLEND_END = 20200;

/** Planet radius for the horizon drop; curvature only starts beyond CURVATURE_START from the camera. */
export const EARTH_RADIUS = 6371000;
export const CURVATURE_START = 20000;

export interface TerrainQuality {
  /** Heightmap samples per side for the near and far domains. */
  nearRes: number;
  farRes: number;
  /** Quads per CDLOD node side (even). */
  grid: number;
  /** Level-0 node size in meters. */
  leafSize: number;
  /** LOD range = rangeFactor * node size. */
  rangeFactor: number;
  morphStart: number;
  /** Bake resolution divisor for the near map (1 = full). */
  treeRadius: number;
  cloudPuffScale: number;
}

export const TERRAIN_QUALITY: Record<QualityLevel, TerrainQuality> = {
  low: {
    nearRes: 1024,
    farRes: 1024,
    grid: 16,
    leafSize: 640,
    rangeFactor: 4.6,
    morphStart: 0.7,
    treeRadius: 3500,
    cloudPuffScale: 0.6,
  },
  medium: {
    nearRes: 2048,
    farRes: 1024,
    grid: 32,
    leafSize: 640,
    rangeFactor: 4.6,
    morphStart: 0.7,
    treeRadius: 5000,
    cloudPuffScale: 0.85,
  },
  high: {
    nearRes: 2048,
    farRes: 2048,
    grid: 32,
    leafSize: 640,
    rangeFactor: 5.4,
    morphStart: 0.7,
    treeRadius: 6500,
    cloudPuffScale: 1,
  },
};

/** Tiles rendered per generation pass (square, pixels). */
export const GEN_TILE = 512;

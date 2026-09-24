import type { Color, IUniform } from 'three';
import type { GroundTargetKind, MapId } from '../../core/types';
import type { AtmosphereParams } from '../../render/atmosphere';
import type { P2 } from '../geom2d';
import type { StructureBuilder } from '../structures';

/** Rectangle flattened to an exact elevation in the heightmap (runways, aprons, pads, dam crest). */
export interface FlatRect {
  x: number;
  z: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
  /** Distance over which the flattening blends back into natural terrain. */
  falloff: number;
  elevation: number;
}

export interface RunwayDef {
  id: string;
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
}

export interface TaxiwayDef {
  points: readonly P2[];
  width: number;
}

/** Paved rectangle (apron, hardstand). */
export interface ApronDef {
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
}

export interface AirbaseDef {
  name: string;
  elevation: number;
  runways: readonly RunwayDef[];
  taxiways: readonly TaxiwayDef[];
  aprons: readonly ApronDef[];
  /** Mown-grass area around the paved surfaces (center, heading, half extents). */
  grounds: FlatRect;
}

/** Linear-space terrain palette and splat parameters. */
export interface TerrainPalette {
  grass: Color;
  grassDry: Color;
  forest: Color;
  rock: Color;
  cliff: Color;
  sand: Color;
  snow: Color;
  dirt: Color;
  /** Land-use colors (fields for farmland, playa for lakebeds): four variants picked per cell. */
  field0: Color;
  field1: Color;
  field2: Color;
  field3: Color;
  urban: Color;
  seabed: Color;
  /** Snow line and fade band (m); snow disabled when line is very high. */
  snowLine: number;
  snowFade: number;
  /** Beach sand up to this height above the water level. */
  beachHeight: number;
  /** Slope (1 - normal.y) where rock starts and where the cliff color takes over. */
  rockSlope: number;
  cliffSlope: number;
  /** Size of land-use cells (m). */
  fieldSize: number;
  /** 0 = fields with hedgerows (farmland), 1 = smooth playa (lakebed), 2 = meadow patches. */
  fieldMode: number;
  /** Horizontal rock strata strength (Mesa). */
  strata: number;
}

/** CPU rule that turns the generator's forest potential into the final forest density. */
export interface ForestRule {
  /** Weight of concave terrain (valleys) and of moderate slopes. */
  valley: number;
  slope: number;
  /** Forest disappears above this slope (1 - n.y) and above this height. */
  maxSlope: number;
  maxHeight: number;
  /** Minimum height above water. */
  minHeight: number;
  /** Final threshold/softness applied to the potential. */
  threshold: number;
  softness: number;
}

export type TreeSpecies = 'conifer' | 'broadleaf' | 'birch' | 'juniper' | 'shrub';

export interface VegetationDef {
  species: readonly { kind: TreeSpecies; weight: number; color: Color; height: [number, number] }[];
  /** Trees per square kilometer at full forest density and vegetation = 1. */
  density: number;
  /** Additional sparse trees outside forests (per km², scaled by the landuse and grass). */
  scatter: number;
}

export interface CloudDef {
  /** Cumulus clusters. */
  count: number;
  base: [number, number];
  /** Cluster horizontal radius range (m). */
  radius: [number, number];
  /** Vertical extent range above the base (m). */
  height: [number, number];
  /** Region (Chebyshev half size) where clusters are placed. */
  spread: number;
  /** Tint multiplier for shading (storm clouds are darker). */
  brightness: number;
  darkBase: number;
}

export interface DeckDef {
  base: number;
  top: number;
  /** Sun/ambient scale below the deck. */
  belowLight: number;
}

export interface SpawnDef {
  /** Blue team spawn center (x, z) and heading; red mirrors at the opposite end. */
  blue: { x: number; z: number; heading: number };
  red: { x: number; z: number; heading: number };
  altitude: [number, number];
}

export interface TargetDef {
  kind: GroundTargetKind;
  x: number;
  z: number;
  heading: number;
  group: string;
  /** Fixed height (ships); otherwise placed on the terrain. */
  y?: number;
}

export interface MapDef {
  id: MapId;
  seed: [number, number];
  waterLevel: number;
  atmosphere: () => AtmosphereParams;
  /** GLSL that defines `vec4 mapSample(vec2 p)` returning (height, forest potential, landuse, spare). */
  glsl: string;
  uniforms: () => Record<string, IUniform>;
  flats: readonly FlatRect[];
  airbases: readonly AirbaseDef[];
  roads: readonly (readonly P2[])[];
  roadWidth: number;
  /** Built-up ground: circles (x, z, radius). */
  urban: readonly [number, number, number][];
  palette: () => TerrainPalette;
  forest: ForestRule;
  vegetation: () => VegetationDef;
  clouds: CloudDef;
  deck: DeckDef | null;
  spawns: SpawnDef;
  /** Adds structure geometry and target slots. heightAt is the final terrain. */
  build: (b: StructureBuilder, heightAt: (x: number, z: number) => number) => TargetDef[];
}

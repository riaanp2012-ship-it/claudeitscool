import type { MapId } from '../core/types';

export interface MapMeta {
  id: MapId;
  name: string;
  region: string;
  timeOfDay: string;
  weather: string;
  description: string;
  /** Tier 1 maps ship first; the UI hides maps whose world generator is not available yet. */
  tier: 1 | 2;
}

export const MAPS: Record<MapId, MapMeta> = {
  kessel: {
    id: 'kessel',
    name: 'Kessel Strait',
    region: 'Temperate coast and islands',
    timeOfDay: '15:00',
    weather: 'Fair, scattered cumulus',
    description:
      'A mainland airbase above chalk cliffs, a harbor town and a scatter of green islands across a cold, clear strait.',
    tier: 1,
  },
  mesa: {
    id: 'mesa',
    name: 'Mesa Roja',
    region: 'Red desert canyons',
    timeOfDay: '18:40',
    weather: 'Clear, dust haze',
    description:
      'Terraced mesas cut by an eleven-kilometer canyon. A dry-lakebed strip sits at the canyon mouth under the evening sun.',
    tier: 1,
  },
  norrdal: {
    id: 'norrdal',
    name: 'Norrdal Fjords',
    region: 'Alpine glaciers and fjords',
    timeOfDay: '10:00',
    weather: 'Overcast deck at 1,800 m',
    description:
      'Glaciated peaks, deep fjords and a hydro dam. A solid cloud deck hides the valleys; above it the sun is out.',
    tier: 1,
  },
  varen: {
    id: 'varen',
    name: 'Port Varen',
    region: 'Coastal city at night',
    timeOfDay: '23:00',
    weather: 'Moonlit, light haze',
    description: 'A lit harbor city behind a belt of surface-to-air sites and flak batteries.',
    tier: 2,
  },
  typhoon: {
    id: 'typhoon',
    name: 'Typhoon Line',
    region: 'Open ocean storm',
    timeOfDay: '19:30',
    weather: 'Heavy rain, lightning',
    description: 'A carrier group riding out the edge of a typhoon, towering storm cells in every direction.',
    tier: 2,
  },
};

export const MAP_IDS: readonly MapId[] = ['kessel', 'mesa', 'norrdal', 'varen', 'typhoon'];

import type { AircraftId, PilotProfileView } from './types';
import { readJson, sanitize, writeJson } from './storage';

/**
 * Pilot profile: callsign, XP and rank, statistics, medals and unlocks (spec §5.10).
 * Stored versioned with sanitize() so corrupt or old saves never crash the game (ZD-K01).
 */
export const RANK_NAMES = [
  'Cadet',
  'Pilot Officer',
  'Pilot Officer II',
  'Flying Officer',
  'Flying Officer II',
  'Flight Lieutenant',
  'Flight Lieutenant II',
  'Flight Lieutenant III',
  'Squadron Leader',
  'Squadron Leader II',
  'Squadron Leader III',
  'Wing Commander',
  'Wing Commander II',
  'Wing Commander III',
  'Group Captain',
  'Group Captain II',
  'Group Captain III',
  'Air Commodore',
  'Air Commodore II',
  'Air Commodore III',
  'Air Vice-Marshal',
  'Air Vice-Marshal II',
  'Air Vice-Marshal III',
  'Air Marshal',
  'Air Marshal II',
  'Air Marshal III',
  'Air Chief Marshal',
  'Air Chief Marshal II',
  'Air Chief Marshal III',
  'Marshal of the Air',
] as const;

export const MAX_RANK = RANK_NAMES.length;

/** Total XP needed to reach `rank` (rank 1 needs 0). */
export function xpForRank(rank: number): number {
  if (rank <= 1) return 0;
  return Math.round(350 * Math.pow(rank - 1, 1.45));
}

export function rankForXp(xp: number): number {
  let r = 1;
  while (r < MAX_RANK && xp >= xpForRank(r + 1)) r++;
  return r;
}

export type Medal = 'none' | 'bronze' | 'silver' | 'gold';
const MEDAL_ORDER: Medal[] = ['none', 'bronze', 'silver', 'gold'];
export const betterMedal = (a: Medal, b: Medal): Medal =>
  MEDAL_ORDER.indexOf(a) >= MEDAL_ORDER.indexOf(b) ? a : b;

export interface ProfileData {
  version: number;
  callsign: string;
  xp: number;
  stats: {
    kills: number;
    deaths: number;
    sorties: number;
    flightSeconds: number;
    shotsFired: number;
    shotsHit: number;
  };
  lessons: Record<string, { medal: Medal; bestTime: number }>;
  missions: Record<string, { completed: boolean; medal: Medal }>;
  lastAircraft: AircraftId;
  survivalBest: number;
}

const DEFAULT_PROFILE: ProfileData = {
  version: 1,
  callsign: 'VIPER 1',
  xp: 0,
  stats: { kills: 0, deaths: 0, sorties: 0, flightSeconds: 0, shotsFired: 0, shotsHit: 0 },
  lessons: {},
  missions: {},
  lastAircraft: 'kestrel',
  survivalBest: 0,
};

const KEY = 'splash1.profile';

class ProfileStore {
  data: ProfileData;

  constructor() {
    const raw = readJson(KEY);
    this.data = sanitize(DEFAULT_PROFILE, raw);
    // Records are free-form maps; sanitize() keeps them only if they are objects.
    const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProfileData>;
    this.data.lessons = cleanRecords(src.lessons, (v) => ({
      medal: MEDAL_ORDER.includes(v.medal as Medal) ? (v.medal as Medal) : 'none',
      bestTime: Number.isFinite(v.bestTime) ? Number(v.bestTime) : 0,
    }));
    this.data.missions = cleanRecords(src.missions, (v) => ({
      completed: v.completed === true,
      medal: MEDAL_ORDER.includes(v.medal as Medal) ? (v.medal as Medal) : 'none',
    }));
  }

  save(): void {
    writeJson(KEY, this.data);
  }

  get rank(): number {
    return rankForXp(this.data.xp);
  }

  view(): PilotProfileView {
    const rank = this.rank;
    const s = this.data.stats;
    const base = xpForRank(rank);
    const next = rank >= MAX_RANK ? base : xpForRank(rank + 1);
    return {
      callsign: this.data.callsign,
      rank,
      rankName: RANK_NAMES[rank - 1] ?? RANK_NAMES[0],
      xp: this.data.xp,
      xpIntoRank: this.data.xp - base,
      xpForRank: Math.max(1, next - base),
      stats: {
        kills: s.kills,
        deaths: s.deaths,
        sorties: s.sorties,
        flightSeconds: s.flightSeconds,
        accuracy: s.shotsFired > 0 ? s.shotsHit / s.shotsFired : 0,
      },
    };
  }

  addXp(amount: number): void {
    this.data.xp = Math.max(0, Math.round(this.data.xp + amount));
  }

  recordLesson(id: string, medal: Medal, time: number): void {
    const prev = this.data.lessons[id];
    const best = prev && prev.bestTime > 0 ? Math.min(prev.bestTime, time) : time;
    this.data.lessons[id] = { medal: betterMedal(prev?.medal ?? 'none', medal), bestTime: best };
  }

  recordMission(id: string, medal: Medal): void {
    const prev = this.data.missions[id];
    this.data.missions[id] = { completed: true, medal: betterMedal(prev?.medal ?? 'none', medal) };
  }
}

function cleanRecords<T>(src: unknown, map: (v: Record<string, unknown>) => T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = map(v as Record<string, unknown>);
  }
  return out;
}

export const profile = new ProfileStore();

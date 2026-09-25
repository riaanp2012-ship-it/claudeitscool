import type { PilotProfileView } from '../core/types';
import { clamp } from './values';

/** One bar fill: the XP bar for `rank` animates from `from` to `to` out of `size`. */
export interface XpSegment {
  rank: number;
  from: number;
  to: number;
  size: number;
}

export interface XpFrame {
  rank: number;
  /** XP into the current rank at this moment. */
  into: number;
  /** XP needed for the current rank. */
  size: number;
  /** 0..1 bar fill. */
  fraction: number;
  /** Index of the active segment; rank-ups passed = segment index. */
  segment: number;
}

type ProfileXp = Pick<PilotProfileView, 'rank' | 'xp' | 'xpIntoRank' | 'xpForRank'>;

/**
 * Splits an XP gain into per-rank bar fills. Intermediate ranks (several promotions at once) are not
 * described by the two profiles, so their size is the remaining XP split evenly between them.
 */
export function buildXpSegments(before: ProfileXp, after: ProfileXp): XpSegment[] {
  const size = (n: number): number => Math.max(1, n);
  const backwards =
    after.rank < before.rank || (after.rank === before.rank && after.xpIntoRank < before.xpIntoRank);
  if (backwards) {
    return [{ rank: after.rank, from: after.xpIntoRank, to: after.xpIntoRank, size: size(after.xpForRank) }];
  }
  if (after.rank === before.rank) {
    return [
      {
        rank: after.rank,
        from: clamp(before.xpIntoRank, 0, size(after.xpForRank)),
        to: clamp(after.xpIntoRank, 0, size(after.xpForRank)),
        size: size(after.xpForRank),
      },
    ];
  }
  const segs: XpSegment[] = [
    {
      rank: before.rank,
      from: clamp(before.xpIntoRank, 0, size(before.xpForRank)),
      to: size(before.xpForRank),
      size: size(before.xpForRank),
    },
  ];
  const middle = after.rank - before.rank - 1;
  if (middle > 0) {
    const total = after.xp - before.xp;
    const known = before.xpForRank - before.xpIntoRank + after.xpIntoRank;
    const each = size(Math.round((total - known) / middle));
    for (let i = 1; i <= middle; i++) segs.push({ rank: before.rank + i, from: 0, to: each, size: each });
  }
  segs.push({
    rank: after.rank,
    from: 0,
    to: clamp(after.xpIntoRank, 0, size(after.xpForRank)),
    size: size(after.xpForRank),
  });
  return segs;
}

/** Bar state at `progress` (0..1 of the total XP gained, already eased by the caller). */
export function sampleXp(segs: readonly XpSegment[], progress: number): XpFrame {
  const last = segs.length - 1;
  if (last < 0) return { rank: 0, into: 0, size: 1, fraction: 0, segment: 0 };
  let total = 0;
  for (const s of segs) total += s.to - s.from;
  let remaining = clamp(progress, 0, 1) * total;
  for (let i = 0; i <= last; i++) {
    const s = segs[i]!;
    const amount = s.to - s.from;
    if (remaining <= amount || i === last) {
      const into = s.from + Math.min(Math.max(remaining, 0), amount);
      return { rank: s.rank, into, size: s.size, fraction: clamp(into / s.size, 0, 1), segment: i };
    }
    remaining -= amount;
  }
  const s = segs[last]!;
  return { rank: s.rank, into: s.to, size: s.size, fraction: clamp(s.to / s.size, 0, 1), segment: last };
}

export function easeOutCubic(t: number): number {
  const x = 1 - clamp(t, 0, 1);
  return 1 - x * x * x;
}

/** Count-up duration in ms: longer for bigger gains and for each promotion, capped so it never drags. */
export function xpDuration(segs: readonly XpSegment[]): number {
  const promotions = Math.max(0, segs.length - 1);
  return Math.min(900 + promotions * 450, 2400);
}

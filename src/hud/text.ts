/**
 * Pure text fitting and fade timing for the HUD feeds (kill feed, objectives, subtitles, messages).
 * Measuring is injected so these run in Node tests; the renderer passes a cached canvas measure.
 */

export type Measure = (text: string) => number;

export const ELLIPSIS = '…';

/** Truncates `text` with an ellipsis so it fits `maxWidth` (ZD-J16). Returns the input when it fits. */
export function fitText(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  // Largest prefix length whose prefix + ellipsis fits.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid).trimEnd() + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ELLIPSIS : text.slice(0, lo).trimEnd() + ELLIPSIS;
}

/**
 * Greedy word wrap into at most `maxLines` lines; the last line is truncated with an ellipsis if the
 * text does not fit. Returns the lines.
 */
export function wrapText(text: string, maxWidth: number, maxLines: number, measure: Measure): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i]!;
    const candidate = line ? line + ' ' + word : word;
    if (measure(candidate) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) break;
    lines.push(line);
    line = word;
  }
  if (i < words.length) {
    // Out of lines: put the rest on the last line and let fitText cut it.
    line = line + ' ' + words.slice(i).join(' ');
  }
  if (line) lines.push(fitText(line, maxWidth, measure));
  return lines;
}

/** How long a radio line stays up: reading time from its length, 2.5..8 s. */
export function subtitleHold(length: number): number {
  return Math.min(8, Math.max(2.5, 1.6 + length * 0.055));
}

/** Subtitle opacity by age (s): 150 ms fade in, hold by length, 400 ms fade out. */
export function subtitleAlpha(age: number, length: number): number {
  if (!(age >= 0)) return 0;
  const hold = subtitleHold(length);
  if (age < 0.15) return age / 0.15;
  if (age <= hold) return 1;
  const t = (age - hold) / 0.4;
  return t >= 1 ? 0 : 1 - t;
}

/** Kill feed line opacity by age (s): visible 6 s, then fades out over 1.5 s. */
export const KILL_FEED_HOLD = 6;
export function killFeedAlpha(age: number): number {
  if (!(age >= 0)) return 0;
  if (age < 0.18) return age / 0.18;
  if (age <= KILL_FEED_HOLD) return 1;
  const t = (age - KILL_FEED_HOLD) / 1.5;
  return t >= 1 ? 0 : 1 - t;
}

/**
 * Center message opacity: fades in over 250 ms after it first appeared (`shown` seconds ago) and out
 * over the last 500 ms of its remaining `time`.
 */
export function messageAlpha(shown: number, remaining: number): number {
  const fadeIn = shown < 0.25 ? Math.max(0, shown) / 0.25 : 1;
  const fadeOut = remaining < 0.5 ? Math.max(0, remaining) / 0.5 : 1;
  return fadeIn * fadeOut;
}

/** Ease-out used for the 8-unit entry travel of messages (spec §8.4). */
export function easeOut(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

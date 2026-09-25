/**
 * Self-hosted typefaces (spec §8.3, all SIL OFL 1.1). Only the Latin subsets are bundled.
 * `loadFonts` resolves once every face the UI uses is ready, so text never renders in a fallback font
 * (ZD-J06). It never rejects: if the browser has no Font Loading API it resolves at once, and a
 * stalled load gives up after a few seconds rather than blocking the game.
 */
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';

export const FONT_FACES: readonly string[] = [
  '500 16px "Barlow Condensed"',
  '600 16px "Barlow Condensed"',
  '700 16px "Barlow Condensed"',
  '400 16px "IBM Plex Sans"',
  '500 16px "IBM Plex Sans"',
  '400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
];

const SAMPLE = 'SPLASH ONE 0123456789 abcdefghijklmnopqrstuvwxyz';
const TIMEOUT_MS = 6000;

let pending: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (pending) return pending;
  if (typeof document === 'undefined' || !('fonts' in document)) return (pending = Promise.resolve());
  const load = (async () => {
    await Promise.all(FONT_FACES.map((f) => document.fonts.load(f, SAMPLE).catch(() => [])));
    await document.fonts.ready;
  })();
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, TIMEOUT_MS));
  pending = Promise.race([load, timeout]);
  return pending;
}

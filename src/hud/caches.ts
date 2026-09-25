import {
  StringCache,
  altitudePrefix,
  clock,
  compassLabel,
  drumLabels,
  fixedFromKey,
  pad3,
  radarRangeText,
  rangeText,
  signed,
  thousands,
} from './format';

/**
 * Every string the HUD draws for a changing value comes from one of these caches, keyed by the value
 * rounded to its display precision. Static label tables are built once.
 */
export class HudStrings {
  readonly int = new StringCache((k) => String(k));
  readonly thousands = new StringCache(thousands);
  readonly altPrefix = new StringCache(altitudePrefix);
  readonly heading = new StringCache(pad3, 400);
  readonly fixed1 = new StringCache((k) => fixedFromKey(k, 1));
  readonly fixed2 = new StringCache((k) => fixedFromKey(k, 2));
  readonly signed = new StringCache(signed);
  readonly signedThousands = new StringCache((k) => (k > 0 ? '+' + thousands(k) : thousands(k)));
  readonly range = new StringCache(rangeText);
  readonly radarRange = new StringCache(radarRangeText);
  readonly clock = new StringCache(clock);
  readonly percent = new StringCache((k) => k + '%');

  /** Heading tape labels for 0, 10, ..., 350. */
  readonly compass: readonly string[] = Array.from({ length: 36 }, (_, i) => compassLabel(i * 10));
  /** Pitch ladder labels indexed by (deg + 90) / 5. */
  readonly ladder: readonly string[] = Array.from({ length: 37 }, (_, i) => {
    const d = i * 5 - 90;
    return d < 0 ? '-' + -d : String(d);
  });
  readonly drumOnes = drumLabels(10, 1);
  readonly drumAltFt = drumLabels(100, 20);
  readonly drumAltM = drumLabels(100, 10);
}

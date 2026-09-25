/** Hand-built vector graphics: the SPLASH ONE wordmark and medal insignia. */
import { svg } from './dom';
import type { Medal } from './ui-types';

type Pt = readonly [number, number];
type Poly = readonly Pt[];

/*
 * Wordmark letterforms on a 100-unit cap height: condensed, 17-unit strokes, 45-degree chamfers on the
 * outer corners (stencil and airframe-marking geometry). Each glyph is a list of polygons; holes are
 * extra polygons drawn with the even-odd rule.
 */
const T = 17;
const K = 11;
const M1 = 41.5;
const M2 = 58.5;

const GLYPHS: Record<string, { width: number; polys: readonly Poly[] }> = {
  S: {
    width: 54,
    polys: [
      [
        [K, 0],
        [54 - K, 0],
        [54, K],
        [54, 32],
        [54 - T, 32],
        [54 - T, T],
        [T, T],
        [T, M1],
        [54 - K, M1],
        [54, M1 + K],
        [54, 100 - K],
        [54 - K, 100],
        [K, 100],
        [0, 100 - K],
        [0, 68],
        [T, 68],
        [T, 100 - T],
        [54 - T, 100 - T],
        [54 - T, M2],
        [K, M2],
        [0, M2 - K],
        [0, K],
      ],
    ],
  },
  P: {
    width: 52,
    polys: [
      [
        [0, 0],
        [52 - K, 0],
        [52, K],
        [52, M2 - K],
        [52 - K, M2],
        [T, M2],
        [T, 100],
        [0, 100],
      ],
      [
        [T, T],
        [52 - T, T],
        [52 - T, M1],
        [T, M1],
      ],
    ],
  },
  L: {
    width: 46,
    polys: [
      [
        [0, 0],
        [T, 0],
        [T, 100 - T],
        [46, 100 - T],
        [46, 100],
        [K, 100],
        [0, 100 - K],
      ],
    ],
  },
  A: {
    width: 54,
    polys: [
      [
        [0, 100],
        [0, 20],
        [20, 0],
        [34, 0],
        [54, 20],
        [54, 100],
        [54 - T, 100],
        [54 - T, 66],
        [T, 66],
        [T, 100],
      ],
      [
        [27, T],
        [54 - T, 27],
        [54 - T, 49],
        [T, 49],
        [T, 27],
      ],
    ],
  },
  H: {
    width: 54,
    polys: [
      [
        [0, 0],
        [T, 0],
        [T, M1],
        [54 - T, M1],
        [54 - T, 0],
        [54, 0],
        [54, 100],
        [54 - T, 100],
        [54 - T, M2],
        [T, M2],
        [T, 100],
        [0, 100],
      ],
    ],
  },
  O: {
    width: 58,
    polys: [
      [
        [18, 0],
        [40, 0],
        [58, 18],
        [58, 82],
        [40, 100],
        [18, 100],
        [0, 82],
        [0, 18],
      ],
      [
        [25, T],
        [33, T],
        [58 - T, 25],
        [58 - T, 75],
        [33, 100 - T],
        [25, 100 - T],
        [T, 75],
        [T, 25],
      ],
    ],
  },
  N: {
    width: 56,
    polys: [
      [
        [0, 0],
        [T, 0],
        [56 - T, 58],
        [56 - T, 0],
        [56, 0],
        [56, 100],
        [56 - T, 100],
        [T, 42],
        [T, 100],
        [0, 100],
      ],
    ],
  },
  E: {
    width: 48,
    polys: [
      [
        [K, 0],
        [48, 0],
        [48, T],
        [T, T],
        [T, M1],
        [42, M1],
        [42, M2],
        [T, M2],
        [T, 100 - T],
        [48, 100 - T],
        [48, 100],
        [K, 100],
        [0, 100 - K],
        [0, K],
      ],
    ],
  },
};

const LETTER_GAP = 9;
const WORD_GAP = 26;
const SKEW_DEG = 10;

function polyPath(polys: readonly Poly[], dx: number): string {
  return polys.map((p) => `M${p.map(([x, y]) => `${+(x + dx).toFixed(2)} ${y}`).join(' L')} Z`).join(' ');
}

let wordmarkSeq = 0;

/**
 * "SPLASH ONE" in custom condensed letterforms, slanted 10 degrees, with a contrail cutting through the O
 * (the O is knocked out around the trail). Colored by `currentColor`.
 */
export function wordmark(className = 's1-wordmark'): SVGSVGElement {
  const id = `s1wm${++wordmarkSeq}`;
  const words = ['SPLASH', 'ONE'];
  const paths: string[] = [];
  let x = 0;
  let oLeft = 0;
  words.forEach((word, w) => {
    if (w > 0) x += WORD_GAP - LETTER_GAP;
    for (const ch of word) {
      const g = GLYPHS[ch]!;
      if (ch === 'O') oLeft = x;
      else paths.push(polyPath(g.polys, x));
      x += g.width + LETTER_GAP;
    }
  });
  const width = x - LETTER_GAP;

  // Contrail: a tapered streak rising at about 52 degrees through the center of the O.
  const cx = oLeft + GLYPHS.O!.width / 2;
  const cy = 50;
  const slope = -1.3;
  const tail: Pt = [cx - 62, cy + slope * -62];
  const head: Pt = [cx + 32, cy + slope * 32];
  const len = Math.hypot(head[0] - tail[0], head[1] - tail[1]);
  const ux = (head[0] - tail[0]) / len;
  const uy = (head[1] - tail[1]) / len;
  const nx = -uy;
  const ny = ux;
  const at = (f: number, half: number, side: 1 | -1): string => {
    const px = tail[0] + ux * len * f + nx * half * side;
    const py = tail[1] + uy * len * f + ny * half * side;
    return `${px.toFixed(2)} ${py.toFixed(2)}`;
  };
  const trail = `M${at(0, 0.4, 1)} L${at(0.9, 2.6, 1)} L${at(1, 0, 1)} L${at(0.9, 2.6, -1)} L${at(0, 0.4, -1)} Z`;
  const knock = `M${at(0.08, 0, 1)} L${at(1, 0, 1)}`;

  const skew = `skewX(${-SKEW_DEG})`;
  const lean = Math.tan((SKEW_DEG * Math.PI) / 180) * 100;
  const root = svg('svg', {
    class: className,
    viewBox: `${(-lean - 1).toFixed(2)} 0 ${(width + lean + 2).toFixed(2)} 100`,
    role: 'img',
    'aria-label': 'SPLASH ONE',
    overflow: 'visible',
  });
  const defs = svg('defs', {}, [
    svg(
      'mask',
      { id: `${id}k`, maskUnits: 'userSpaceOnUse', x: -40, y: -40, width: width + 80, height: 200 },
      [
        svg('rect', { x: -40, y: -40, width: width + 80, height: 200, fill: 'white' }),
        svg('path', {
          d: knock,
          stroke: 'black',
          'stroke-width': 11,
          'stroke-linecap': 'butt',
          fill: 'none',
        }),
      ],
    ),
    svg(
      'linearGradient',
      {
        id: `${id}g`,
        gradientUnits: 'userSpaceOnUse',
        x1: tail[0].toFixed(2),
        y1: tail[1].toFixed(2),
        x2: head[0].toFixed(2),
        y2: head[1].toFixed(2),
      },
      [
        svg('stop', { offset: 0, 'stop-color': 'currentColor', 'stop-opacity': 0 }),
        svg('stop', { offset: 0.55, 'stop-color': 'currentColor', 'stop-opacity': 0.7 }),
        svg('stop', { offset: 1, 'stop-color': 'currentColor', 'stop-opacity': 1 }),
      ],
    ),
  ]);
  const group = svg('g', { transform: skew }, [
    svg('path', { d: paths.join(' '), fill: 'currentColor', 'fill-rule': 'evenodd' }),
    svg('path', {
      d: polyPath(GLYPHS.O!.polys, oLeft),
      fill: 'currentColor',
      'fill-rule': 'evenodd',
      mask: `url(#${id}k)`,
    }),
    svg('path', { d: trail, fill: `url(#${id}g)` }),
  ]);
  root.append(defs, group);
  return root;
}

/** Medal insignia: a shield with one (bronze), two (silver) or three (gold) chevrons. */
export function medalIcon(medal: Medal): SVGSVGElement {
  const count = { none: 0, bronze: 1, silver: 2, gold: 3 }[medal];
  const shield = 'M1 1 H15 V13 L8 19 L1 13 Z';
  const children: SVGElement[] = [
    svg('path', {
      d: shield,
      fill: count ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': 1,
      'stroke-linejoin': 'miter',
    }),
  ];
  for (let i = 0; i < count; i++) {
    const y = 4 + i * 3.5;
    children.push(
      svg('path', {
        d: `M4 ${y} L8 ${y + 2.5} L12 ${y}`,
        fill: 'none',
        style: 'stroke: var(--ink-900)',
        'stroke-width': 1.5,
      }),
    );
  }
  return svg('svg', { viewBox: '0 0 16 20', 'aria-hidden': 'true' }, children);
}

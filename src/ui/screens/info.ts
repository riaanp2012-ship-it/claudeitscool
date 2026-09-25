/** Credits, briefing and loading screens. */
import type { MapSummary } from '../../core/types';
import type { UiContext } from '../context';
import { actionButton, backButton } from '../controls';
import { CREDITS, TIPS } from '../copy';
import { el, stagger, svg, txt } from '../dom';
import { formatPercent, pad } from '../format';
import { wordmark } from '../graphics';
import { footer, header, HINT, Screen } from '../screen';
import { clamp } from '../values';
import { mapFacts } from './parts';

export class CreditsScreen extends Screen {
  constructor(ctx: UiContext, onBack: () => void) {
    super(ctx, 'credits', { scrim: 'left', nav: { onBack } });
    const [production, ...rest] = CREDITS;
    const intro = el('section', 's1-credits__intro', [
      txt('div', 's1-code', production!.title),
      ...production!.entries.map((e, i) =>
        el('div', 's1-credits__entry', [
          txt('h2', i === 0 ? 's1-credits__game s1-display' : 's1-credits__name s1-label', e.name),
          txt('p', 's1-body-text s1-credits__detail', e.detail),
        ]),
      ),
    ]);
    const tables = rest.map((section) =>
      el('section', 's1-credits__section', [
        el('div', 's1-section-title', [txt('span', 's1-code', section.title)]),
        el('table', 's1-bind s1-credits__table', [
          el('thead', '', [
            el('tr', '', [txt('th', '', 'Name'), txt('th', '', 'Author'), txt('th', '', 'License')]),
          ]),
          el(
            'tbody',
            '',
            section.entries.map((e) =>
              el('tr', '', [
                txt('td', 's1-credits__lib', e.name),
                txt('td', '', e.detail),
                txt('td', 's1-credits__lic', e.license ?? ''),
              ]),
            ),
          ),
        ]),
      ]),
    );
    const note = txt(
      'p',
      's1-small s1-credits__note',
      'Typefaces are used under the SIL Open Font License 1.1. three.js is used under the MIT license and postprocessing under the Zlib license; full license texts ship with each package.',
    );
    this.frame.append(
      header({ code: 'CREDITS // LICENSES', title: 'Credits' }),
      el('div', 's1-body', [stagger(intro, 1), stagger(el('div', 's1-credits__libs', [...tables, note]), 2)]),
    );
    const back = backButton(onBack);
    this.frame.appendChild(footer([HINT.back], [back.el]));
    this.nav.setRows([{ items: [back.item] }]);
  }
}

export class BriefingScreen extends Screen {
  constructor(
    ctx: UiContext,
    title: string,
    map: MapSummary,
    text: string,
    objectives: readonly string[],
    onBegin: () => void,
    onBack: () => void,
  ) {
    super(ctx, 'briefing', { scrim: 'left', nav: { onBack } });
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => txt('p', 's1-body-text', p));
    const left = el('div', 's1-brief__text s1-scroll', [
      el('section', 's1-brief__section', [
        el('div', 's1-section-title', [txt('span', 's1-code', 'Situation')]),
        ...paragraphs,
      ]),
      el('section', 's1-brief__section', [
        el('div', 's1-section-title', [txt('span', 's1-code', `Objectives // ${objectives.length}`)]),
        el(
          'ol',
          's1-brief__obj',
          objectives.map((o, i) =>
            el('li', '', [txt('span', 's1-brief__objnum', `OBJ ${i + 1}`), txt('span', 's1-body-text', o)]),
          ),
        ),
      ]),
      el('section', 's1-brief__section', [
        el('div', 's1-section-title', [txt('span', 's1-code', 'Conditions')]),
        mapFacts(map),
      ]),
    ]);
    const chart = el('figure', 's1-brief__map s1-panel s1-brackets', [
      el('div', 's1-brief__map-head', [
        txt('span', 's1-code', `Theater // ${map.name}`),
        txt('span', 's1-code', '40 × 40 km'),
      ]),
      tacticalGrid(),
      txt('figcaption', 's1-small s1-brief__caption', map.description),
    ]);
    this.frame.append(
      header({
        code: `Mission briefing // ${map.name}`,
        title,
        meta: [txt('span', 's1-code', `${map.timeOfDay} LCL`), txt('span', 's1-code', map.weather)],
      }),
      el('div', 's1-body', [stagger(left, 1), stagger(chart, 2)]),
    );
    const back = backButton(onBack);
    const begin = actionButton('Begin sortie', onBegin, { primary: true, chevron: true });
    this.frame.appendChild(footer([HINT.select, HINT.confirm, HINT.back], [back.el, begin.el]));
    this.nav.setRows([{ items: [back.item, begin.item] }], begin.el);
  }
}

/** Sector grid with a north marker and scale bar: the frame the game's tactical map sits in. */
function tacticalGrid(): SVGSVGElement {
  const n = 8;
  const size = 400;
  const cell = size / n;
  const lines: SVGElement[] = [];
  for (let i = 0; i <= n; i++) {
    const p = i * cell;
    const major = i % 4 === 0;
    const attrs = { stroke: 'currentColor', 'stroke-width': major ? 1 : 0.5, opacity: major ? 0.7 : 0.35 };
    lines.push(svg('line', { x1: p, y1: 0, x2: p, y2: size, ...attrs }));
    lines.push(svg('line', { x1: 0, y1: p, x2: size, y2: p, ...attrs }));
  }
  const labels: SVGElement[] = [];
  for (let i = 0; i < n; i++) {
    const t = svg('text', {
      x: i * cell + cell / 2,
      y: -8,
      'text-anchor': 'middle',
      class: 's1-brief__glabel',
    });
    t.textContent = String.fromCharCode(65 + i);
    const r = svg('text', {
      x: -10,
      y: i * cell + cell / 2 + 4,
      'text-anchor': 'end',
      class: 's1-brief__glabel',
    });
    r.textContent = String(i + 1);
    labels.push(t, r);
  }
  const north = svg('g', { transform: `translate(${size - 28} 28)` }, [
    svg('path', { d: 'M0 -14 L6 6 L0 2 L-6 6 Z', fill: 'currentColor' }),
    svg('text', { x: 0, y: 20, 'text-anchor': 'middle', class: 's1-brief__glabel' }),
  ]);
  (north.lastChild as SVGElement).textContent = 'N';
  const scaleY = size - 20;
  const scale = svg('g', {}, [
    svg('line', {
      x1: 16,
      y1: scaleY,
      x2: 16 + cell * 2,
      y2: scaleY,
      stroke: 'currentColor',
      'stroke-width': 1.5,
    }),
    svg('line', { x1: 16, y1: scaleY - 4, x2: 16, y2: scaleY + 4, stroke: 'currentColor' }),
    svg('line', { x1: 16 + cell, y1: scaleY - 3, x2: 16 + cell, y2: scaleY + 3, stroke: 'currentColor' }),
    svg('line', {
      x1: 16 + cell * 2,
      y1: scaleY - 4,
      x2: 16 + cell * 2,
      y2: scaleY + 4,
      stroke: 'currentColor',
    }),
    svg('text', { x: 16 + cell * 2 + 8, y: scaleY + 4, class: 's1-brief__glabel' }),
  ]);
  (scale.lastChild as SVGElement).textContent = '10 KM';
  const center = svg('g', { transform: `translate(${size / 2} ${size / 2})` }, [
    svg('circle', { r: 6, fill: 'none', stroke: 'currentColor' }),
    svg('line', { x1: -14, y1: 0, x2: -8, y2: 0, stroke: 'currentColor' }),
    svg('line', { x1: 8, y1: 0, x2: 14, y2: 0, stroke: 'currentColor' }),
    svg('line', { x1: 0, y1: -14, x2: 0, y2: -8, stroke: 'currentColor' }),
    svg('line', { x1: 0, y1: 8, x2: 0, y2: 14, stroke: 'currentColor' }),
  ]);
  return svg(
    'svg',
    {
      class: 's1-brief__grid',
      viewBox: `-28 -24 ${size + 40} ${size + 32}`,
      role: 'img',
      'aria-label': 'Sector grid',
    },
    [
      svg('rect', { x: 0, y: 0, width: size, height: size, class: 's1-brief__sea' }),
      ...lines,
      ...labels,
      north,
      scale,
      center,
    ],
  );
}

let tipCursor = 0;

export class LoadingScreen extends Screen {
  private readonly fill: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly task: HTMLElement;
  private readonly tipText: HTMLElement;
  private readonly tipIndex: HTMLElement;
  private tip = tipCursor++ % TIPS.length;

  constructor(ctx: UiContext, title: string, subtitle: string) {
    super(ctx, 'loading', { scrim: 'loading' });
    this.fill = el('div', 's1-progress__fill');
    this.pct = txt('span', 's1-progress__pct s1-mono', '0%');
    this.task = txt('span', 's1-code s1-progress__task', 'Preparing');
    this.tipText = txt('p', 's1-body-text s1-loading__tip-text', '');
    this.tipIndex = txt('span', 's1-code', '');
    const bar = el('div', 's1-progress', [
      el('div', 's1-progress__head', [this.task, this.pct]),
      el('div', 's1-progress__track', [this.fill]),
    ]);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    this.frame.append(
      stagger(el('div', 's1-loading__brand', [wordmark('s1-wordmark s1-wordmark--sm')]), 0),
      stagger(
        el('div', 's1-loading__main', [
          txt('div', 's1-code', 'Loading'),
          txt('h1', 's1-loading__title s1-display', title),
          txt('p', 's1-loading__sub', subtitle),
          bar,
        ]),
        1,
      ),
      stagger(
        el('aside', 's1-loading__tip', [
          el('div', 's1-section-title', [txt('span', 's1-code', 'Pilot notes'), this.tipIndex]),
          this.tipText,
        ]),
        2,
      ),
      ...['tl', 'tr', 'bl', 'br'].map((c) => el('span', `s1-reg s1-reg--${c}`)),
    );
    this.showTip();
    const rotate = (): void => {
      this.tip = (this.tip + 1) % TIPS.length;
      this.tipText.classList.add('is-out');
      this.later(() => {
        this.showTip();
        this.tipText.classList.remove('is-out');
      }, 180);
      this.later(rotate, 7000);
    };
    this.later(rotate, 7000);
    this.setProgress(0, 'Preparing');
  }

  setProgress(fraction: number, label: string): void {
    const f = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
    this.fill.style.transform = `scaleX(${f})`;
    this.pct.textContent = formatPercent(Math.floor(f * 100) / 100);
    if (label) this.task.textContent = label;
    this.el.querySelector('.s1-progress')?.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }

  private showTip(): void {
    this.tipText.textContent = TIPS[this.tip]!;
    this.tipIndex.textContent = `${pad(this.tip + 1)}/${pad(TIPS.length)}`;
  }
}

/** Small display parts shared by several screens. */
import type { AircraftSummary, MapSummary } from '../../core/types';
import { MEDAL_LABEL } from '../copy';
import { el, txt, type Child } from '../dom';
import { formatInt } from '../format';
import { medalIcon } from '../graphics';
import type { Medal } from '../ui-types';

export function xpBar(into: number, forRank: number): HTMLElement {
  const fill = el('div', 's1-xp__fill');
  const bar = el('div', 's1-xp', [
    el('div', 's1-xp__track', [fill]),
    el('div', 's1-xp__line', [
      txt('span', 's1-code', 'XP'),
      txt('span', 's1-mono s1-xp__num', `${formatInt(into)} / ${formatInt(forRank)}`),
    ]),
  ]);
  bar.style.setProperty('--f', String(forRank > 0 ? Math.min(1, Math.max(0, into / forRank)) : 0));
  return bar;
}

export function medal(m: Medal, large = false, label = true): HTMLElement {
  return el('span', `s1-medal s1-medal--${m}${large ? ' s1-medal--lg' : ''}`, [
    medalIcon(m),
    label ? txt('span', 's1-medal__label', MEDAL_LABEL[m]) : null,
  ]);
}

/** Definition list from label/value pairs. Values may carry a unit span. */
export function dataList(rows: readonly [string, readonly Child[]][], className = ''): HTMLElement {
  return el(
    'dl',
    `s1-dl ${className}`.trim(),
    rows.flatMap(([k, v]) => [txt('dt', '', k), el('dd', '', v)]),
  );
}

export function unit(value: string, u: string): Child[] {
  return [value, txt('span', 's1-unit', u)];
}

/** Map summary card body used by setup and briefing screens. */
export function mapFacts(map: MapSummary): HTMLElement {
  return dataList(
    [
      ['Region', [map.region]],
      ['Local time', [txt('span', 's1-mono', map.timeOfDay)]],
      ['Weather', [map.weather]],
    ],
    's1-dl--text',
  );
}

export function aircraftDesignation(a: AircraftSummary): { code: string; name: string } {
  const i = a.name.lastIndexOf(' ');
  return i > 0 ? { code: a.name.slice(0, i), name: a.name.slice(i + 1) } : { code: '', name: a.name };
}

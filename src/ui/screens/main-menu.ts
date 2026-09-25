import type { MainMenuHandlers, PilotProfileView } from '../../core/types';
import type { UiContext } from '../context';
import { menuItem } from '../controls';
import { MAIN_MENU, type MenuEntryCopy } from '../copy';
import { el, stagger, txt } from '../dom';
import { formatHours, formatInt, formatPercent, formatRatio, pad } from '../format';
import { wordmark } from '../graphics';
import { SelectionBar } from '../nav';
import { HINT, hints, Screen } from '../screen';
import { xpBar } from './parts';

export class MainMenuScreen extends Screen {
  private readonly ctxCode: HTMLElement;
  private readonly ctxTitle: HTMLElement;
  private readonly ctxText: HTMLElement;
  private readonly ctxFacts: HTMLElement;
  private readonly ctxBody: HTMLElement;

  constructor(ctx: UiContext, profile: PilotProfileView, handlers: MainMenuHandlers) {
    super(ctx, 'menu', { scrim: 'left', nav: { wrap: true } });

    const brand = stagger(
      el('div', 's1-mm__brand', [
        wordmark('s1-wordmark s1-wordmark--sm'),
        txt('div', 's1-code', 'ALLIED COASTAL COMMAND // READY ROOM'),
      ]),
      0,
    );

    const onSurvival = handlers.onSurvival;
    const actions: Record<MenuEntryCopy['id'], (() => void) | null> = {
      campaign: () => handlers.onCampaign(),
      instant: () => handlers.onInstantAction(),
      survival: onSurvival ? () => onSurvival.call(handlers) : null,
      free: () => handlers.onFreeFlight(),
      training: () => handlers.onTraining(),
      hangar: () => handlers.onHangar(),
      settings: () => handlers.onSettings(),
      credits: () => handlers.onCredits(),
    };

    const list = el('nav', 's1-menu');
    list.setAttribute('aria-label', 'Main menu');
    const bar = new SelectionBar(list);
    // Modes the game does not provide a handler for are not shown at all (nothing unfinished is visible).
    const shown = MAIN_MENU.flatMap((entry) => {
      const fn = actions[entry.id];
      return fn ? [{ entry, fn }] : [];
    });
    const rows = shown.map(({ entry, fn }, i) => {
      const c = menuItem(i + 1, entry.label, entry.note, fn);
      stagger(c.el, i + 1);
      list.appendChild(c.el);
      c.item.onFocus = () => this.describe(entry);
      return { items: [c.item], bar };
    });

    const menuCol = el('div', 's1-mm__menu', [
      list,
      stagger(el('div', 's1-mm__hints', [hints([HINT.select, HINT.confirm])]), 9),
    ]);

    this.ctxCode = txt('div', 's1-code', '');
    this.ctxTitle = txt('h2', 's1-mm__ctx-title s1-display', '');
    this.ctxText = txt('p', 's1-body-text s1-mm__ctx-text', '');
    this.ctxFacts = el('dl', 's1-dl s1-mm__facts');
    this.ctxBody = el('div', 's1-mm__ctx-body', [this.ctxCode, this.ctxTitle, this.ctxText, this.ctxFacts]);
    const panel = stagger(el('aside', 's1-mm__ctx s1-panel s1-brackets', [this.ctxBody]), 3);
    panel.setAttribute('aria-live', 'polite');

    const s = profile.stats;
    const pilot = stagger(
      el('div', 's1-mm__pilot', [
        txt('div', 's1-code', 'PILOT'),
        txt('div', 's1-mm__callsign s1-display', profile.callsign),
        el('div', 's1-mm__rank s1-label', [
          txt('span', 's1-mono', `RANK ${pad(profile.rank)}`),
          txt('span', '', profile.rankName),
        ]),
        xpBar(profile.xpIntoRank, profile.xpForRank),
      ]),
      8,
    );
    const stat = (label: string, value: string): HTMLElement =>
      el('div', 's1-mm__stat', [
        txt('div', 's1-mm__stat-label', label),
        txt('div', 's1-mm__stat-value s1-mono', value),
      ]);
    const stats = stagger(
      el('div', 's1-mm__stats', [
        el('div', 's1-mm__stat-row', [
          stat('Sorties', formatInt(s.sorties)),
          stat('Kills', formatInt(s.kills)),
          stat('K/D', formatRatio(s.kills, s.deaths)),
          stat('Accuracy', formatPercent(s.accuracy)),
          stat('Flight hours', formatHours(s.flightSeconds)),
        ]),
        txt('div', 's1-code s1-mm__build', `BUILD ${this.ctx.build}`),
      ]),
      9,
    );

    this.frame.append(brand, menuCol, panel, pilot, stats);
    this.nav.setRows(rows);
  }

  private describe(entry: MenuEntryCopy): void {
    this.ctxCode.textContent = entry.code;
    this.ctxTitle.textContent = entry.label;
    this.ctxText.textContent = entry.description;
    this.ctxFacts.replaceChildren(...entry.facts.flatMap(([k, v]) => [txt('dt', '', k), txt('dd', '', v)]));
    // Restart the short enter animation so the panel visibly follows the selection.
    this.ctxBody.classList.remove('is-swap');
    void this.ctxBody.offsetWidth;
    this.ctxBody.classList.add('is-swap');
  }
}

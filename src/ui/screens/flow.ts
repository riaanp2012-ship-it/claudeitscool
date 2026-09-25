/** In-game flow screens: pause, debrief, click-to-resume and the fatal error screen. */
import type { DebriefData, PauseHandlers } from '../../core/types';
import type { UiContext } from '../context';
import { actionButton, backButton, menuItem } from '../controls';
import { MEDAL_LABEL } from '../copy';
import { el, stagger, txt } from '../dom';
import { formatClock, formatInt, pad } from '../format';
import { SelectionBar, type NavRow } from '../nav';
import { footer, HINT, hints, Screen } from '../screen';
import type { NavAction } from '../ui-types';
import { buildXpSegments, easeOutCubic, sampleXp, xpDuration } from '../xp';
import { medal } from './parts';

export class PauseScreen extends Screen {
  private handlers: PauseHandlers;

  constructor(ctx: UiContext, handlers: PauseHandlers) {
    super(ctx, 'pause', { scrim: 'veil', nav: { wrap: true } });
    this.handlers = handlers;
    this.nav.configure({ onBack: () => this.handlers.onResume(), onStart: () => this.resume() });
    const list = el('nav', 's1-menu s1-pause__menu');
    list.setAttribute('aria-label', 'Pause menu');
    const bar = new SelectionBar(list);
    const entries: [string, string, () => void][] = [
      ['Resume', 'Esc', () => this.handlers.onResume()],
      ['Restart', 'From the start', () => this.handlers.onRestart()],
      ['Settings', 'Graphics, controls, audio', () => this.handlers.onSettings()],
      ['Quit to menu', 'Asks first', () => this.confirmQuit()],
    ];
    const rows: NavRow[] = entries.map(([label, note, fn], i) => {
      const c = menuItem(i + 1, label, note, fn);
      if (label === 'Quit to menu') c.item.terminal = false;
      stagger(c.el, i + 2);
      list.appendChild(c.el);
      return { items: [c.item], bar };
    });
    this.frame.append(
      el('div', 's1-pause__col', [
        stagger(txt('div', 's1-code', 'Sortie paused // simulation frozen'), 0),
        stagger(txt('h1', 's1-pause__title s1-display', 'Paused'), 1),
        list,
        stagger(
          el('div', 's1-pause__hints', [
            hints([HINT.select, HINT.confirm, { kb: ['Esc'], pad: ['B'], label: 'Resume' }]),
          ]),
          7,
        ),
      ]),
    );
    this.nav.setRows(rows);
  }

  /** Re-showing pause while it is open only swaps the handlers (the modal never opens twice). */
  setHandlers(handlers: PauseHandlers): void {
    this.handlers = handlers;
  }

  private resume(): void {
    this.ctx.sound('uiBack');
    this.handlers.onResume();
  }

  private confirmQuit(): void {
    const cancel = backButton(() => this.closeLayer(), 'Cancel');
    cancel.item.terminal = false;
    const quit = actionButton('Quit to menu', () => this.handlers.onQuit(), { primary: true });
    const dialog = el('div', 's1-dialog s1-panel s1-brackets', [
      txt('div', 's1-code', 'Confirm'),
      txt('h2', 's1-dialog__title s1-display', 'Quit to menu'),
      txt(
        'p',
        's1-body-text',
        'Progress in this sortie will be lost. Rank and medals already earned are kept.',
      ),
      el('div', 's1-dialog__actions', [cancel.el, quit.el]),
    ]);
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-label', 'Quit to menu');
    this.openLayer(dialog, [{ items: [cancel.item, quit.item] }], () => undefined, cancel.el);
  }
}

export class DebriefScreen extends Screen {
  constructor(ctx: UiContext, data: DebriefData, onRetry: () => void, onContinue: () => void) {
    super(ctx, 'debrief', { scrim: 'full', nav: { onBack: onContinue } });
    const outcome = {
      success: { tag: 'Success', cls: 's1-tag--ok' },
      failure: { tag: 'Failed', cls: 's1-tag--foe' },
      ended: { tag: 'Ended', cls: '' },
    }[data.outcome];
    const head = stagger(
      el('header', 's1-debrief__head', [
        el('div', 's1-debrief__tags', [
          el('span', `s1-tag ${outcome.cls}`, [
            el('span', `s1-outcome s1-outcome--${data.outcome}`),
            outcome.tag,
          ]),
          txt('span', 's1-code', `Mission time ${formatClock(data.time)}`),
        ]),
        txt('h1', 's1-debrief__title s1-display', data.title),
        txt('p', 's1-debrief__sub s1-label', data.subtitle),
      ]),
      0,
    );

    const stats = stagger(
      el('section', 's1-debrief__stats', [
        el('div', 's1-section-title', [txt('span', 's1-code', 'Sortie record')]),
        el(
          'dl',
          's1-dl',
          data.stats.flatMap((s) => [txt('dt', '', s.label), txt('dd', '', s.value)]),
        ),
      ]),
      1,
    );

    const timeline = stagger(
      el('section', 's1-debrief__timeline', [
        el('div', 's1-section-title', [txt('span', 's1-code', `Timeline // ${data.timeline.length} events`)]),
        data.timeline.length
          ? el(
              'ol',
              's1-timeline s1-scroll',
              data.timeline.map((t) =>
                el('li', 's1-timeline__item', [
                  txt('span', 's1-timeline__time s1-mono', formatClock(t.time)),
                  txt('span', 's1-timeline__text', t.text),
                ]),
              ),
            )
          : txt('p', 's1-small', 'No events were recorded in this sortie.'),
      ]),
      2,
    );

    const before = data.profileBefore;
    const after = data.profileAfter;
    const segs = buildXpSegments(before, after);
    const xpGain = txt('div', 's1-debrief__gain s1-mono', '+0');
    const rankLine = txt('div', 's1-debrief__rank s1-label', '');
    const xpNum = txt('span', 's1-mono s1-xp__num', '');
    const fill = el('div', 's1-xp__fill');
    const xp = el('div', 's1-xp', [
      el('div', 's1-xp__track', [fill]),
      el('div', 's1-xp__line', [txt('span', 's1-code', 'XP to next rank'), xpNum]),
    ]);
    const promo = txt('div', 's1-debrief__promo s1-code', '');
    const unlocks = el(
      'ul',
      's1-debrief__unlocks',
      data.unlocks.map((u) => el('li', '', [txt('span', 's1-body-text', u)])),
    );
    const pilot = stagger(
      el('section', 's1-debrief__pilot s1-panel s1-brackets', [
        el('div', 's1-section-title', [txt('span', 's1-code', `Pilot // ${after.callsign}`)]),
        el('div', 's1-debrief__gainrow', [xpGain, txt('span', 's1-code', 'XP earned')]),
        rankLine,
        xp,
        promo,
        el('div', 's1-debrief__medal', [
          medal(data.medal, true, false),
          el('div', '', [
            txt('div', 's1-code', 'Medal'),
            txt('div', 's1-label s1-debrief__medal-name', MEDAL_LABEL[data.medal]),
          ]),
        ]),
        data.unlocks.length
          ? el('div', 's1-debrief__unlock-block', [
              el('div', 's1-section-title', [txt('span', 's1-code', `Unlocked // ${data.unlocks.length}`)]),
              unlocks,
            ])
          : null,
      ]),
      3,
    );

    const rankName = (rank: number): string =>
      rank === after.rank ? after.rankName : rank === before.rank ? before.rankName : '';
    let lastRank = -1;
    const render = (progress: number, eased: number): void => {
      const f = sampleXp(segs, eased);
      fill.style.transform = `scaleX(${f.fraction})`;
      xpNum.textContent = `${formatInt(f.into)} / ${formatInt(f.size)}`;
      xpGain.textContent = `+${formatInt(data.xpGained * eased)}`;
      if (f.rank !== lastRank) {
        const name = rankName(f.rank);
        rankLine.textContent = `Rank ${pad(f.rank)}${name ? ` · ${name}` : ''}`;
        if (lastRank >= 0 && f.rank > lastRank) {
          promo.textContent = `Promoted to rank ${pad(f.rank)}`;
          promo.classList.add('is-on');
          this.ctx.sound('uiConfirm');
        }
        lastRank = f.rank;
      }
      if (progress >= 1) xp.classList.add('is-done');
    };
    render(0, 0);
    const duration = xpDuration(segs);
    let t0 = -1;
    this.later(() => {
      this.frameLoop((now) => {
        if (t0 < 0) t0 = now;
        const p = Math.min(1, (now - t0) / duration);
        render(p, easeOutCubic(p));
        return p < 1;
      });
    }, 500);

    this.frame.append(head, el('div', 's1-body s1-debrief__body', [stats, timeline, pilot]));
    const retry = actionButton('Retry', onRetry);
    const cont = actionButton('Continue', onContinue, { primary: true, chevron: true });
    this.frame.appendChild(footer([HINT.select, HINT.confirm], [retry.el, cont.el]));
    this.nav.setRows([{ items: [retry.item, cont.item] }], cont.el);
  }
}

/** Shown when pointer lock is lost mid-flight. A click (or Enter) resumes; the click never reaches the game. */
export class ResumeOverlay extends Screen {
  private fired = false;

  constructor(
    ctx: UiContext,
    private readonly onResume: () => void,
  ) {
    super(ctx, 'resume', { scrim: 'dim' });
    this.frame.appendChild(
      el('div', 's1-resume__box s1-panel s1-brackets', [
        stagger(txt('div', 's1-code', 'Pointer released'), 0),
        stagger(txt('h1', 's1-resume__title s1-display', 'Click to resume'), 1),
        stagger(
          txt(
            'p',
            's1-body-text',
            'The mouse was released from the game. Click anywhere or press Enter to return to the cockpit.',
          ),
          2,
        ),
        stagger(el('div', 's1-resume__hints', [hints([{ kb: ['Enter'], pad: ['A'], label: 'Resume' }])]), 3),
      ]),
    );
    this.listen(this.el, 'click', (e) => {
      e.preventDefault();
      this.fire();
    });
  }

  override handle(action: NavAction): boolean {
    if (action === 'confirm' || action === 'start') {
      this.fire();
      return true;
    }
    return action !== 'back';
  }

  private fire(): void {
    if (this.fired) return;
    this.fired = true;
    this.ctx.sound('uiConfirm');
    this.onResume();
  }

  /** Allows the overlay to fire again if the game shows it again without replacing it. */
  rearm(): void {
    this.fired = false;
  }
}

export class FatalScreen extends Screen {
  constructor(ctx: UiContext, title: string, message: string) {
    super(ctx, 'fatal', { scrim: 'fatal' });
    const reload = actionButton('Reload page', () => window.location.reload(), { primary: true });
    this.frame.append(
      el('div', 's1-fatal__box', [
        stagger(txt('div', 's1-code s1-fatal__code', 'Fault // the game cannot continue'), 0),
        stagger(txt('h1', 's1-fatal__title s1-display', title), 1),
        stagger(
          el(
            'div',
            's1-fatal__msg',
            message
              .split(/\n+/)
              .map((m) => m.trim())
              .filter(Boolean)
              .map((m) => txt('p', 's1-body-text', m)),
          ),
          2,
        ),
        stagger(el('div', 's1-fatal__actions', [reload.el]), 3),
      ]),
      ...['tl', 'tr', 'bl', 'br'].map((c) => el('span', `s1-reg s1-reg--${c}`)),
    );
    this.nav.setRows([{ items: [reload.item] }]);
  }
}

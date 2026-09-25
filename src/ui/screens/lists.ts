import type { LessonSummary, MapSummary, MissionSummary } from '../../core/types';
import type { UiContext } from '../context';
import { actionButton, backButton, type Control } from '../controls';
import { LESSON_UNAVAILABLE, MEDAL_LABEL } from '../copy';
import { button, el, setDisabled, stagger, txt, type Child } from '../dom';
import { formatLapTime, pad } from '../format';
import { SelectionBar, type NavRow } from '../nav';
import { footer, header, HINT, lockIcon, Screen } from '../screen';
import type { Medal } from '../ui-types';
import { dataList, medal } from './parts';

interface Entry {
  id: string;
  number: number;
  title: string;
  sub: string;
  available: boolean;
  reason: string;
  /** Short tag shown on an unavailable row. */
  tag: string;
  medal: Medal;
  end: readonly Child[];
  detailCode: string;
  detailText: string;
  facts: readonly [string, readonly Child[]][];
}

/** List on the left, detail panel on the right, primary action for the selected entry. */
abstract class ListScreen extends Screen {
  private current: Entry | null = null;
  private readonly rowsById = new Map<string, HTMLElement>();
  private readonly detail: HTMLElement;
  private primary!: Control;

  constructor(
    ctx: UiContext,
    kind: 'training' | 'campaign',
    opts: { code: string; title: string; meta: string; action: string; listLabel: string },
    entries: readonly Entry[],
    private readonly onStart: (id: string) => void,
    onBack: () => void,
  ) {
    super(ctx, kind, { scrim: 'left', nav: { onBack, wrap: true } });
    const list = el('ol', 's1-list');
    list.setAttribute('aria-label', opts.listLabel);
    const bar = new SelectionBar(list);
    const rows: NavRow[] = entries.map((e, i) => {
      const row = button('s1-row', [
        txt('span', 's1-row__num', pad(e.number)),
        el('span', 's1-row__main', [
          txt('span', 's1-row__title', e.title),
          txt('span', 's1-row__sub', e.sub),
        ]),
        el('span', 's1-row__end', e.available ? e.end : [el('span', 's1-tag', [lockIcon(), e.tag])]),
      ]);
      if (!e.available) setDisabled(row, e.reason);
      stagger(row, i + 1);
      list.appendChild(el('li', '', [row]));
      this.rowsById.set(e.id, row);
      return {
        bar,
        items: [
          {
            el: row,
            disabled: () => !e.available,
            activate: () => this.onStart(e.id),
            terminal: true,
            onFocus: () => this.select(e),
          },
        ],
      };
    });
    this.detail = el('div', 's1-list__detail-body');
    const side = stagger(el('aside', 's1-list__detail s1-panel s1-brackets', [this.detail]), 3);
    side.setAttribute('aria-live', 'polite');
    this.frame.append(
      header({ code: opts.code, title: opts.title, meta: [txt('span', 's1-code', opts.meta)] }),
      el('div', 's1-body', [el('div', 's1-list__col s1-scroll', [list]), side]),
    );
    const back = backButton(onBack);
    this.primary = actionButton(opts.action, () => this.current && this.onStart(this.current.id), {
      primary: true,
      chevron: true,
      disabled: () => (this.current ? null : 'Select an available entry first.'),
    });
    this.frame.appendChild(footer([HINT.select, HINT.confirm, HINT.back], [back.el, this.primary.el]));
    rows.push({ items: [back.item, this.primary.item] });
    const firstOpen =
      entries.find((e) => e.available && e.medal === 'none') ?? entries.find((e) => e.available) ?? null;
    const start = firstOpen ? this.rowsById.get(firstOpen.id) : back.el;
    this.nav.setRows(rows, start);
    if (!firstOpen) this.renderEmpty();
  }

  private select(e: Entry): void {
    if (this.current) this.rowsById.get(this.current.id)?.classList.remove('is-current');
    this.current = e;
    this.rowsById.get(e.id)?.classList.add('is-current');
    this.primary.update();
    this.detail.replaceChildren(
      txt('div', 's1-code', e.detailCode),
      txt('h2', 's1-list__title s1-display', e.title),
      txt('p', 's1-body-text s1-list__text', e.detailText),
      dataList(e.facts, 's1-list__facts s1-dl--text'),
    );
    this.detail.classList.remove('is-swap');
    void this.detail.offsetWidth;
    this.detail.classList.add('is-swap');
  }

  private renderEmpty(): void {
    this.primary.update();
    this.detail.replaceChildren(
      txt('div', 's1-code', 'NO ENTRIES AVAILABLE'),
      txt('p', 's1-body-text', 'Nothing here can be started yet.'),
    );
  }
}

export class TrainingScreen extends ListScreen {
  constructor(
    ctx: UiContext,
    lessons: readonly LessonSummary[],
    onStart: (id: string) => void,
    onBack: () => void,
  ) {
    const earned = lessons.filter((l) => l.medal !== 'none').length;
    const entries: Entry[] = lessons.map((l) => ({
      id: l.id,
      number: l.number,
      title: l.title,
      sub: !l.available
        ? 'Not available'
        : l.medal !== 'none'
          ? `${MEDAL_LABEL[l.medal]} medal`
          : l.bestTime === null
            ? 'Not flown'
            : 'Flown, no medal',
      available: l.available,
      reason: LESSON_UNAVAILABLE,
      tag: 'Unavailable',
      medal: l.medal,
      end: [medal(l.medal, false, false), txt('span', 's1-row__time', formatLapTime(l.bestTime))],
      detailCode: `LESSON ${pad(l.number)} // ACADEMY`,
      detailText: l.description,
      facts: [
        ['Best time', [txt('span', 's1-mono', formatLapTime(l.bestTime))]],
        ['Medal', [medal(l.medal)]],
        ['Status', [l.medal === 'none' ? (l.bestTime === null ? 'Not flown' : 'Flown') : 'Passed']],
      ],
    }));
    super(
      ctx,
      'training',
      {
        code: `ACADEMY // ${lessons.length} LESSONS`,
        title: 'Training',
        meta: `MEDALS ${pad(earned)}/${pad(lessons.length)}`,
        action: 'Start lesson',
        listLabel: 'Lessons',
      },
      entries,
      onStart,
      onBack,
    );
  }
}

export class CampaignScreen extends ListScreen {
  constructor(
    ctx: UiContext,
    missions: readonly MissionSummary[],
    maps: readonly Pick<MapSummary, 'id' | 'name'>[],
    onStart: (id: string) => void,
    onBack: () => void,
  ) {
    const mapName = (id: string): string => maps.find((m) => m.id === id)?.name ?? id;
    const cleared = missions.filter((m) => m.completed).length;
    const entries: Entry[] = missions.map((m, i) => {
      const prev = missions[i - 1];
      const locked = Boolean(prev && !prev.completed);
      const reason = locked
        ? `Complete the previous mission (${pad(prev!.number)}) first.`
        : 'Map not available in this build.';
      return {
        id: m.id,
        number: m.number,
        title: m.title,
        sub: mapName(m.map),
        available: m.available,
        reason,
        tag: locked ? 'Locked' : 'Unavailable',
        medal: m.medal,
        end: [
          m.completed ? txt('span', 's1-tag s1-tag--solid', 'Cleared') : txt('span', 's1-tag', 'Open'),
          medal(m.medal, false, false),
        ],
        detailCode: `MISSION ${pad(m.number)} // ${mapName(m.map).toUpperCase()}`,
        detailText: m.briefing,
        facts: [
          ['Theater', [mapName(m.map)]],
          ['Status', [m.completed ? 'Cleared' : 'Not cleared']],
          ['Medal', [m.medal === 'none' ? MEDAL_LABEL.none : medal(m.medal)]],
        ],
      };
    });
    super(
      ctx,
      'campaign',
      {
        code: 'CAMPAIGN // ALLIED COASTAL COMMAND',
        title: 'Operation Low Tide',
        meta: `CLEARED ${pad(cleared)}/${pad(missions.length)}`,
        action: 'Select mission',
        listLabel: 'Missions',
      },
      entries,
      onStart,
      onBack,
    );
  }
}

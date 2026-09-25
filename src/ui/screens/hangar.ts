import { settings } from '../../core/settings';
import type { AircraftId, AircraftSummary } from '../../core/types';
import { AIRCRAFT } from '../../data/aircraft';
import type { UiContext } from '../context';
import { actionButton, backButton, type Control } from '../controls';
import { STORE_LABEL, STORE_NAME, unlockReason } from '../copy';
import { button, el, stagger, txt, type Child } from '../dom';
import { formatFixed, formatInt, formatMach, formatSigned, pad } from '../format';
import { SelectionBar, type NavRow } from '../nav';
import { footer, header, HINT, lockIcon, Screen } from '../screen';
import { aircraftDesignation } from './parts';

type StatKey = 'topSpeedMach' | 'thrustToWeight' | 'gLimit' | 'rollRateDeg' | 'hardpoints';

const PERF: readonly {
  key: StatKey;
  label: string;
  decimals: number;
  show: (a: AircraftSummary) => Child[];
}[] = [
  { key: 'topSpeedMach', label: 'Top speed', decimals: 2, show: (a) => [formatMach(a.stats.topSpeedMach)] },
  {
    key: 'thrustToWeight',
    label: 'Thrust / weight',
    decimals: 2,
    show: (a) => [formatFixed(a.stats.thrustToWeight, 2)],
  },
  {
    key: 'gLimit',
    label: 'G limit',
    decimals: 1,
    show: (a) => [`+${formatFixed(a.stats.gLimit, 1)}`, txt('span', 's1-unit', 'G')],
  },
  {
    key: 'rollRateDeg',
    label: 'Roll rate',
    decimals: 0,
    show: (a) => [formatInt(a.stats.rollRateDeg), txt('span', 's1-unit', '°/s')],
  },
  { key: 'hardpoints', label: 'Hardpoints', decimals: 0, show: (a) => [String(a.stats.hardpoints)] },
];

/** Hangar overlay: list on the left, figures on the right, the center left clear for the turntable. */
export class HangarScreen extends Screen {
  private current: AircraftId;
  private preview: AircraftSummary | null = null;
  private readonly rowsById = new Map<AircraftId, HTMLElement>();
  private readonly tags = new Map<AircraftId, HTMLElement>();
  private readonly panel: HTMLElement;
  private readonly loadout: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly primary: Control;
  private readonly max: Record<StatKey, number>;

  constructor(
    ctx: UiContext,
    private readonly aircraft: readonly AircraftSummary[],
    selected: AircraftId,
    private readonly onSelect: (id: AircraftId) => void,
    onBack: () => void,
  ) {
    super(ctx, 'hangar', { scrim: 'hangar', nav: { onBack, wrap: true } });
    this.current = selected;
    this.max = {
      topSpeedMach: Math.max(...aircraft.map((a) => a.stats.topSpeedMach), 1e-6),
      thrustToWeight: Math.max(...aircraft.map((a) => a.stats.thrustToWeight), 1e-6),
      gLimit: Math.max(...aircraft.map((a) => a.stats.gLimit), 1e-6),
      rollRateDeg: Math.max(...aircraft.map((a) => a.stats.rollRateDeg), 1e-6),
      hardpoints: Math.max(...aircraft.map((a) => a.stats.hardpoints), 1e-6),
    };

    const list = el('ol', 's1-list s1-hangar__list');
    list.setAttribute('aria-label', 'Aircraft');
    const bar = new SelectionBar(list);
    const rows: NavRow[] = aircraft.map((a, i) => {
      const d = aircraftDesignation(a);
      const tag = el('span', 's1-row__end');
      const row = button('s1-row s1-hangar__row', [
        txt('span', 's1-row__num', pad(i + 1)),
        el('span', 's1-row__main', [
          el('span', 's1-row__title', [txt('span', 's1-hangar__code', d.code), ` ${d.name}`]),
          txt('span', 's1-row__sub', a.role),
        ]),
        tag,
      ]);
      if (!a.unlocked) {
        row.classList.add('is-locked');
        row.dataset.tip = unlockReason(a.unlockRank);
      }
      stagger(row, i + 1);
      list.appendChild(el('li', '', [row]));
      this.rowsById.set(a.id, row);
      this.tags.set(a.id, tag);
      return {
        bar,
        items: [
          {
            el: row,
            activate: () => this.choose(a),
            confirmSound: null,
            onFocus: () => this.show(a),
          },
        ],
      };
    });

    this.panel = el('div', 's1-hangar__panel-body');
    const side = stagger(el('aside', 's1-hangar__panel s1-panel s1-brackets', [this.panel]), 3);
    side.setAttribute('aria-live', 'polite');
    this.loadout = stagger(el('section', 's1-hangar__loadout'), 5);
    this.metaEl = txt('span', 's1-code', '');
    this.frame.append(
      header({ code: `FLEET // ${aircraft.length} AIRFRAMES`, title: 'Hangar', meta: [this.metaEl] }),
      el('div', 's1-body', [el('div', 's1-hangar__col s1-scroll', [list]), this.loadout, side]),
    );

    const back = backButton(onBack);
    this.primary = actionButton('Select aircraft', () => this.preview && this.choose(this.preview), {
      primary: true,
      disabled: () => {
        const p = this.preview;
        if (!p) return 'Highlight an aircraft first.';
        if (!p.unlocked) return unlockReason(p.unlockRank);
        if (p.id === this.current) return 'This is already your aircraft.';
        return null;
      },
      terminal: false,
    });
    this.frame.appendChild(footer([HINT.select, HINT.confirm, HINT.back], [back.el, this.primary.el]));
    rows.push({ items: [back.item, this.primary.item] });
    this.updateTags();
    this.nav.setRows(rows, this.rowsById.get(selected));
  }

  private choose(a: AircraftSummary): void {
    if (!a.unlocked) {
      this.ctx.sound('uiError');
      return;
    }
    if (a.id === this.current) {
      this.ctx.sound('uiConfirm');
      return;
    }
    this.ctx.sound('uiConfirm');
    this.current = a.id;
    this.updateTags();
    this.show(a);
    this.onSelect(a.id);
  }

  private updateTags(): void {
    for (const a of this.aircraft) {
      const tag = this.tags.get(a.id)!;
      const row = this.rowsById.get(a.id)!;
      row.classList.toggle('is-current', a.id === this.current);
      if (a.id === this.current) tag.replaceChildren(txt('span', 's1-tag s1-tag--solid', 'Current'));
      else if (!a.unlocked) tag.replaceChildren(el('span', 's1-tag', [lockIcon(), `Rank ${a.unlockRank}`]));
      else tag.replaceChildren();
    }
    const cur = this.aircraft.find((a) => a.id === this.current);
    this.metaEl.textContent = cur ? `CURRENT // ${cur.name.toUpperCase()}` : '';
  }

  private show(a: AircraftSummary): void {
    this.preview = a;
    this.primary.update();
    const base = this.aircraft.find((x) => x.id === this.current) ?? a;
    const d = aircraftDesignation(a);
    const def = AIRCRAFT[a.id];
    const imperial = settings.value.gameplay.units === 'imperial';
    const len = (m: number): string =>
      imperial ? `${formatFixed(m * 3.28084, 1)} ft` : `${formatFixed(m, 1)} m`;
    const mass = (kg: number): string => (imperial ? `${formatInt(kg * 2.20462)} lb` : `${formatInt(kg)} kg`);
    const range = (m: number): string =>
      imperial ? `${formatInt((m / 1000) * 0.539957)} nm` : `${formatInt(m / 1000)} km`;

    const perf = el(
      'dl',
      's1-dl s1-hangar__perf',
      PERF.flatMap((p) => {
        const v = a.stats[p.key];
        const delta = v - base.stats[p.key];
        const meter = el('span', 's1-meter', [el('span', 's1-meter__fill')]);
        meter.style.setProperty('--f', String(v / this.max[p.key]));
        const dEl = txt(
          'span',
          `s1-delta${delta > 1e-9 ? ' is-up' : delta < -1e-9 ? ' is-down' : ''}`,
          a.id === base.id ? '' : formatSigned(delta, p.decimals),
        );
        return [txt('dt', '', p.label), el('dd', '', [...p.show(a), meter, dEl])];
      }),
    );
    const airframe = def
      ? el('dl', 's1-dl', [
          txt('dt', '', 'Length / span'),
          txt('dd', '', `${len(def.design.length)} / ${len(def.design.span)}`),
          txt('dt', '', 'Empty mass'),
          txt('dd', '', mass(def.massEmpty)),
          txt('dt', '', 'Internal fuel'),
          txt('dd', '', mass(def.fuelMax)),
          txt('dt', '', 'Radar range'),
          txt('dd', '', range(def.radarRange)),
          txt('dt', '', 'Gun'),
          txt('dd', '', `${a.stats.gun} · ${formatInt(def.gunAmmo)} rds`),
          txt('dt', '', 'Flares / chaff'),
          txt('dd', '', `${def.flares} / ${def.chaff}`),
        ])
      : null;

    const status =
      a.id === this.current
        ? txt('span', 's1-tag s1-tag--solid', 'Current aircraft')
        : a.unlocked
          ? txt('span', 's1-tag', 'Available')
          : el('span', 's1-tag', [lockIcon(), unlockReason(a.unlockRank).replace(/\.$/, '')]);

    this.panel.replaceChildren(
      el('div', 's1-hangar__id', [txt('div', 's1-code', `${d.code} // ${a.role}`), status]),
      txt('h2', 's1-hangar__name s1-display', d.name),
      txt('p', 's1-small s1-hangar__desc', a.description),
      el('div', 's1-section-title', [
        txt('span', 's1-code', 'Performance'),
        a.id === base.id ? null : txt('span', 's1-code', `vs ${aircraftDesignation(base).name}`),
      ]),
      perf,
      ...(airframe ? [el('div', 's1-section-title', [txt('span', 's1-code', 'Airframe')]), airframe] : []),
    );
    this.panel.classList.remove('is-swap');
    void this.panel.offsetWidth;
    this.panel.classList.add('is-swap');

    const stations = def?.hardpoints ?? [];
    this.loadout.replaceChildren(
      el('div', 's1-section-title', [
        txt('span', 's1-code', `Loadout // ${stations.length} stations`),
        txt('span', 's1-code', 'Default stores'),
      ]),
      el(
        'ol',
        's1-hangar__stations',
        stations.map((h, i) => {
          const cell = el('li', 's1-stn', [
            txt('span', 's1-stn__num', `STN ${i + 1}`),
            txt('span', 's1-stn__kind', STORE_LABEL[h.kind]),
            txt('span', 's1-stn__int', h.internal ? 'Internal' : 'Pylon'),
          ]);
          cell.dataset.tip = STORE_NAME[h.kind];
          cell.dataset.tipKind = 'info';
          return cell;
        }),
      ),
    );
  }
}

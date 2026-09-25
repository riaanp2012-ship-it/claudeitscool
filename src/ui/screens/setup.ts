import type {
  AircraftId,
  AircraftSummary,
  FreeFlightOptions,
  InstantActionOptions,
  MapId,
  MapSummary,
} from '../../core/types';
import type { UiContext } from '../context';
import {
  actionButton,
  backButton,
  segmented,
  select,
  stepper,
  toggle,
  type Control,
  type SelectOption,
} from '../controls';
import { MAP_UNAVAILABLE, SKILL_LABEL, unlockReason, WEAPONS_LABEL } from '../copy';
import { el, stagger, txt } from '../dom';
import { formatFixed, formatMach, pad } from '../format';
import { SelectionBar, type NavRow } from '../nav';
import { footer, header, HINT, Screen } from '../screen';
import { aircraftDesignation, dataList, mapFacts, unit } from './parts';

const TIME_LIMITS = [0, 5, 10, 15, 20, 30] as const;
const SCORE_LIMITS = [0, 5, 10, 15, 20, 25, 30] as const;

interface FieldDef {
  control: Control;
  help: string;
}

/** Shared layout for the Instant Action and Free Flight setup screens. */
abstract class SetupScreen extends Screen {
  protected readonly fieldsEl: HTMLElement;
  protected readonly helpEl: HTMLElement;
  protected readonly side: HTMLElement;
  protected readonly mapBlock: HTMLElement;
  protected readonly jetBlock: HTMLElement;
  protected fields: FieldDef[] = [];
  protected buttons: Control[] = [];

  constructor(
    ctx: UiContext,
    kind: 'instant' | 'free',
    code: string,
    title: string,
    protected readonly maps: readonly MapSummary[],
    protected readonly aircraft: readonly AircraftSummary[],
    onBack: () => void,
  ) {
    super(ctx, kind, { scrim: 'left', nav: { onBack, wrap: true } });
    this.fieldsEl = el('div', 's1-fields');
    this.helpEl = txt('p', 's1-setup__help s1-small', '');
    this.mapBlock = el('section', 's1-setup__block');
    this.jetBlock = el('section', 's1-setup__block');
    this.side = el('aside', 's1-setup__side s1-panel s1-brackets', [this.mapBlock, this.jetBlock]);
    this.frame.append(
      header({ code, title }),
      el('div', 's1-body', [
        stagger(
          el('div', 's1-setup__form', [
            el('div', 's1-scroll s1-setup__scroll', [this.fieldsEl]),
            this.helpEl,
          ]),
          1,
        ),
        stagger(this.side, 2),
      ]),
    );
  }

  protected mapOptions(): SelectOption[] {
    return this.maps.map((m) => ({
      value: m.id,
      name: m.name,
      meta: `${m.region} · ${m.timeOfDay}`,
      reason: m.available ? undefined : MAP_UNAVAILABLE,
    }));
  }

  protected jetOptions(): SelectOption[] {
    return this.aircraft.map((a) => ({
      value: a.id,
      name: a.name,
      meta: a.role,
      reason: a.unlocked ? undefined : unlockReason(a.unlockRank),
    }));
  }

  protected firstMap(id: MapId): MapId {
    if (this.maps.find((m) => m.id === id)?.available) return id;
    return this.maps.find((m) => m.available)?.id ?? id;
  }

  protected firstJet(id: AircraftId): AircraftId {
    if (this.aircraft.find((a) => a.id === id)?.unlocked) return id;
    return this.aircraft.find((a) => a.unlocked)?.id ?? id;
  }

  protected openSelect(title: string, options: () => SelectOption[], value: () => string) {
    return (anchor: HTMLElement, onPick: (v: string) => void): void =>
      this.openList(anchor, { title, options: options(), value: value(), onPick });
  }

  protected field(control: Control, help: string): FieldDef {
    stagger(control.el, this.fields.length + 1);
    const def = { control, help };
    control.item.onFocus = () => {
      this.helpEl.textContent = help;
    };
    this.fieldsEl.appendChild(control.el);
    this.fields.push(def);
    return def;
  }

  protected finish(hintsRow: boolean, actions: Control[], preferred?: HTMLElement): void {
    this.buttons = actions;
    this.frame.appendChild(
      footer(
        hintsRow ? [HINT.select, HINT.adjust, HINT.confirm, HINT.back] : [HINT.select, HINT.back],
        actions.map((a) => a.el),
      ),
    );
    const bar = new SelectionBar(this.fieldsEl);
    const rows: NavRow[] = this.fields.map((f) => ({ items: [f.control.item], bar }));
    rows.push({ items: actions.map((a) => a.item) });
    for (const a of actions) {
      const prev = a.item.onFocus;
      a.item.onFocus = () => {
        prev?.();
        this.helpEl.textContent = a.el.dataset.help ?? '';
      };
    }
    this.nav.setRows(rows, preferred);
    this.refreshSide();
  }

  protected refreshAll(): void {
    for (const f of this.fields) f.control.update();
    for (const b of this.buttons) b.update();
    this.nav.refresh();
    this.refreshSide();
  }

  protected renderMap(id: MapId): void {
    const m = this.maps.find((x) => x.id === id);
    if (!m) return;
    this.mapBlock.replaceChildren(
      txt('div', 's1-code', `THEATER // ${m.id.slice(0, 3).toUpperCase()}`),
      txt('h2', 's1-setup__name s1-display', m.name),
      mapFacts(m),
      txt('p', 's1-small s1-setup__desc', m.description),
    );
  }

  protected renderJet(id: AircraftId): void {
    const a = this.aircraft.find((x) => x.id === id);
    if (!a) return;
    const d = aircraftDesignation(a);
    this.jetBlock.replaceChildren(
      txt('div', 's1-code', `AIRCRAFT // ${d.code}`),
      txt('h2', 's1-setup__jet s1-display', d.name),
      txt('p', 's1-small', a.role),
      dataList([
        ['Top speed', [formatMach(a.stats.topSpeedMach)]],
        ['Thrust / weight', [formatFixed(a.stats.thrustToWeight, 2)]],
        ['G limit', unit(`+${formatFixed(a.stats.gLimit, 1)}`, 'G')],
        ['Gun', [a.stats.gun]],
      ]),
    );
  }

  protected abstract refreshSide(): void;
}

export class InstantActionScreen extends SetupScreen {
  private o: InstantActionOptions;
  private readonly rulesBlock: HTMLElement;

  constructor(
    ctx: UiContext,
    private readonly defaults: InstantActionOptions,
    maps: readonly MapSummary[],
    aircraft: readonly AircraftSummary[],
    onStart: (o: InstantActionOptions) => void,
    onBack: () => void,
  ) {
    super(ctx, 'instant', 'MODE SETUP // DOGFIGHT', 'Instant action', maps, aircraft, onBack);
    this.o = { ...defaults, map: this.firstMap(defaults.map), aircraft: this.firstJet(defaults.aircraft) };
    this.rulesBlock = el('section', 's1-setup__block');
    this.side.appendChild(this.rulesBlock);
    const o = (): InstantActionOptions => this.o;
    const set = (patch: Partial<InstantActionOptions>): void => {
      this.o = { ...this.o, ...patch };
      this.refreshAll();
    };
    this.field(
      select(ctx, {
        label: 'Theater',
        title: 'THEATER',
        options: () => this.mapOptions(),
        get: () => o().map,
        set: (v) => set({ map: v as MapId }),
        open: this.openSelect(
          'THEATER',
          () => this.mapOptions(),
          () => o().map,
        ),
      }),
      'Where the engagement takes place. Each theater sets its own time of day and weather.',
    );
    this.field(
      select(ctx, {
        label: 'Aircraft',
        title: 'AIRCRAFT',
        options: () => this.jetOptions(),
        get: () => o().aircraft,
        set: (v) => set({ aircraft: v as AircraftId }),
        open: this.openSelect(
          'AIRCRAFT',
          () => this.jetOptions(),
          () => o().aircraft,
        ),
      }),
      'The aircraft you fly. Locked types open as your rank rises.',
    );
    this.field(
      stepper(ctx, {
        label: 'Bandits',
        min: 1,
        max: 12,
        step: 1,
        get: () => o().enemies,
        set: (v) => set({ enemies: v }),
        format: (v) => pad(v),
      }),
      'Enemy aircraft in the fight, from 1 to 12.',
    );
    this.field(
      stepper(ctx, {
        label: 'Wingmen',
        min: 0,
        max: 7,
        step: 1,
        get: () => o().allies,
        set: (v) => set({ allies: v }),
        format: (v) => pad(v),
      }),
      'Friendly aircraft flying on your side, from 0 to 7.',
    );
    this.field(
      segmented(ctx, {
        label: 'AI skill',
        options: (['rookie', 'veteran', 'ace'] as const).map((v) => ({ value: v, label: SKILL_LABEL[v] })),
        get: () => o().skill,
        set: (v) => set({ skill: v as InstantActionOptions['skill'] }),
      }),
      'Rookies fire late and rarely defend. Veterans manage energy and use countermeasures. Aces punish every mistake.',
    );
    this.field(
      segmented(ctx, {
        label: 'Weapons',
        options: (['guns', 'standard', 'unlimited'] as const).map((v) => ({
          value: v,
          label: WEAPONS_LABEL[v],
        })),
        get: () => o().weapons,
        set: (v) => set({ weapons: v as InstantActionOptions['weapons'] }),
      }),
      'Guns only: cannon and nothing else. Standard: the normal loadout. Unlimited: missiles and countermeasures never run out.',
    );
    this.field(
      toggle(ctx, { label: 'Respawn', get: () => o().respawn, set: (v) => set({ respawn: v }) }),
      'Return to the fight after being shot down. With respawn off, the engagement ends when you go down.',
    );
    this.field(
      stepper(ctx, {
        label: 'Time limit',
        values: TIME_LIMITS,
        min: TIME_LIMITS[0],
        max: TIME_LIMITS[TIME_LIMITS.length - 1]!,
        step: 5,
        get: () => o().timeLimit,
        set: (v) => set({ timeLimit: v }),
        format: (v) => (v === 0 ? 'NONE' : pad(v)),
        unit: (v) => (v === 0 ? '' : 'min'),
      }),
      'The engagement ends when the clock runs out. None: it ends when one side is destroyed or the score limit is reached.',
    );
    this.field(
      stepper(ctx, {
        label: 'Score limit',
        values: SCORE_LIMITS,
        min: SCORE_LIMITS[0],
        max: SCORE_LIMITS[SCORE_LIMITS.length - 1]!,
        step: 5,
        get: () => o().scoreLimit,
        set: (v) => set({ scoreLimit: v }),
        format: (v) => (v === 0 ? 'NONE' : pad(v)),
        unit: (v) => (v === 0 ? '' : 'kills'),
      }),
      'Kills needed to win. None: fight until one side is destroyed or time runs out.',
    );

    const invalid = (x: InstantActionOptions): string | null => {
      if (!this.maps.find((m) => m.id === x.map)?.available) return 'Choose an available theater first.';
      if (!this.aircraft.find((a) => a.id === x.aircraft)?.unlocked)
        return 'Choose an unlocked aircraft first.';
      return null;
    };
    const back = backButton(onBack);
    back.el.dataset.help = 'Return to the main menu. Changes on this screen are not kept.';
    const quick = actionButton('Quick start', () => onStart({ ...this.defaults }), {
      disabled: () => invalid(this.defaults),
    });
    quick.el.dataset.help = 'Launch at once with the recommended setup, ignoring changes on this screen.';
    const begin = actionButton('Begin', () => onStart({ ...this.o }), {
      primary: true,
      chevron: true,
      disabled: () => invalid(this.o),
    });
    begin.el.dataset.help = 'Launch the engagement with the options above.';
    this.finish(true, [back, quick, begin]);
  }

  protected refreshSide(): void {
    const x = this.o;
    this.renderMap(x.map);
    this.renderJet(x.aircraft);
    this.rulesBlock.replaceChildren(
      txt('div', 's1-code', 'ENGAGEMENT'),
      dataList([
        ['Blue', [`1 + ${x.allies} wingm${x.allies === 1 ? 'an' : 'en'}`]],
        ['Red', [`${x.enemies} bandit${x.enemies === 1 ? '' : 's'} · ${SKILL_LABEL[x.skill]}`]],
        ['Weapons', [`${WEAPONS_LABEL[x.weapons]} · respawn ${x.respawn ? 'on' : 'off'}`]],
        [
          'Limits',
          [
            `${x.timeLimit ? `${x.timeLimit} min` : 'No time limit'} · ${x.scoreLimit ? `${x.scoreLimit} kills` : 'no score limit'}`,
          ],
        ],
      ]),
    );
  }
}

export class FreeFlightScreen extends SetupScreen {
  private o: FreeFlightOptions;

  constructor(
    ctx: UiContext,
    defaults: FreeFlightOptions,
    maps: readonly MapSummary[],
    aircraft: readonly AircraftSummary[],
    onStart: (o: FreeFlightOptions) => void,
    onBack: () => void,
  ) {
    super(ctx, 'free', 'MODE SETUP // NO THREATS', 'Free flight', maps, aircraft, onBack);
    this.o = { ...defaults, map: this.firstMap(defaults.map), aircraft: this.firstJet(defaults.aircraft) };
    const o = (): FreeFlightOptions => this.o;
    const set = (patch: Partial<FreeFlightOptions>): void => {
      this.o = { ...this.o, ...patch };
      this.refreshAll();
    };
    this.field(
      select(ctx, {
        label: 'Theater',
        title: 'THEATER',
        options: () => this.mapOptions(),
        get: () => o().map,
        set: (v) => set({ map: v as MapId }),
        open: this.openSelect(
          'THEATER',
          () => this.mapOptions(),
          () => o().map,
        ),
      }),
      'Where to fly. Each theater sets its own time of day and weather.',
    );
    this.field(
      select(ctx, {
        label: 'Aircraft',
        title: 'AIRCRAFT',
        options: () => this.jetOptions(),
        get: () => o().aircraft,
        set: (v) => set({ aircraft: v as AircraftId }),
        open: this.openSelect(
          'AIRCRAFT',
          () => this.jetOptions(),
          () => o().aircraft,
        ),
      }),
      'The aircraft you fly. Locked types open as your rank rises.',
    );
    this.field(
      segmented(ctx, {
        label: 'Start',
        options: [
          { value: 'air', label: 'Air start' },
          { value: 'runway', label: 'Runway' },
        ],
        get: () => o().start,
        set: (v) => set({ start: v as FreeFlightOptions['start'] }),
      }),
      'Air start: begin in flight at cruise speed. Runway: begin lined up on the active runway, engines running.',
    );
    this.field(
      toggle(ctx, { label: 'Target drones', get: () => o().drones, set: (v) => set({ drones: v }) }),
      'Slow, unarmed drones orbit the area for gunnery and missile practice.',
    );
    this.field(
      toggle(ctx, { label: 'Ring course', get: () => o().rings, set: (v) => set({ rings: v }) }),
      'A timed course of rings through the terrain. The clock starts at the first ring.',
    );
    const invalid = (): string | null => {
      if (!this.maps.find((m) => m.id === this.o.map)?.available) return 'Choose an available theater first.';
      if (!this.aircraft.find((a) => a.id === this.o.aircraft)?.unlocked)
        return 'Choose an unlocked aircraft first.';
      return null;
    };
    const back = backButton(onBack);
    back.el.dataset.help = 'Return to the main menu. Changes on this screen are not kept.';
    const begin = actionButton('Begin', () => onStart({ ...this.o }), {
      primary: true,
      chevron: true,
      disabled: invalid,
    });
    begin.el.dataset.help = 'Start the flight with the options above.';
    this.finish(true, [back, begin]);
  }

  protected refreshSide(): void {
    this.renderMap(this.o.map);
    this.renderJet(this.o.aircraft);
  }
}

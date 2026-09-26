import { DEFAULT_SETTINGS, settings, type Quality } from '../../core/settings';
import type { UiContext } from '../context';
import { actionButton, backButton, segmented, slider, toggle, type Control } from '../controls';
import { DEFAULT_BINDINGS } from '../copy';
import { button, el, stagger, txt } from '../dom';
import { pad } from '../format';
import { SelectionBar, type NavItem, type NavRow } from '../nav';
import { footer, header, HINT, hints, Screen } from '../screen';
import {
  FIELDS,
  readField,
  SECTIONS,
  writeField,
  type FieldValue,
  type SettingsField,
  type SettingsSection,
} from '../settings-fields';
import { dataList } from './parts';

/** Settings with five sections. Every change writes through the settings store and applies live. */
export class SettingsScreen extends Screen {
  private section: SettingsSection;
  private readonly tabs = new Map<SettingsSection, HTMLButtonElement>();
  private readonly tabItems: NavItem[] = [];
  private readonly fieldsEl: HTMLElement;
  private readonly help: HTMLElement;
  private readonly footerRow: NavRow;
  private readonly reset: Control;
  private controls: { field: SettingsField; control: Control }[] = [];
  private bindingItems: NavItem[] = [];
  private bar: SelectionBar;

  constructor(ctx: UiContext, onBack: () => void, initial: SettingsSection = 'graphics') {
    super(ctx, 'settings', { scrim: 'left', nav: { onBack, wrap: true } });
    this.nav.configure({ onTab: (dir) => this.cycleTab(dir) });
    this.section = initial;

    const tabRow = el('div', 's1-tabs', [
      el('span', 's1-tabs__cap', [hints([{ kb: ['Q'], pad: ['LB'], label: '' }])]),
    ]);
    tabRow.setAttribute('role', 'tablist');
    for (const s of SECTIONS) {
      const b = button('s1-tab', [s.label]);
      b.setAttribute('role', 'tab');
      this.tabs.set(s.id, b);
      tabRow.appendChild(b);
      this.tabItems.push({
        el: b,
        activate: () => this.showSection(s.id, true),
        confirmSound: null,
        onFocus: () => this.showSection(s.id, false),
      });
    }
    tabRow.appendChild(el('span', 's1-tabs__cap', [hints([{ kb: ['E'], pad: ['RB'], label: '' }])]));

    this.fieldsEl = el('div', 's1-fields');
    this.bar = new SelectionBar(this.fieldsEl);
    this.help = el('div', 's1-settings__help s1-panel s1-brackets');
    this.help.setAttribute('aria-live', 'polite');

    this.frame.append(
      header({ code: 'CONFIG // SAVED IN THIS BROWSER', title: 'Settings' }),
      el('div', 's1-body s1-settings__body', [
        stagger(el('div', 's1-settings__tabs'), 1),
        stagger(el('div', 's1-settings__main s1-scroll', [this.fieldsEl]), 2),
        stagger(el('div', 's1-settings__side s1-scroll', [this.help]), 3),
      ]),
    );
    this.frame.querySelector('.s1-settings__tabs')!.appendChild(tabRow);

    const back = backButton(onBack);
    this.reset = actionButton('Reset section', () => this.resetSection(), { terminal: false });
    this.reset.el.dataset.help = 'Restores every option in this section to its default value.';
    this.frame.appendChild(
      footer([HINT.select, HINT.adjust, HINT.tabs, HINT.back], [back.el, this.reset.el]),
    );
    this.footerRow = { items: [back.item, this.reset.item] };

    const off = settings.onChange(() => this.syncValues());
    this.onDispose(off);
    this.showSection(initial, false, true);
  }

  private cycleTab(dir: 1 | -1): void {
    const i = SECTIONS.findIndex((s) => s.id === this.section);
    const next = SECTIONS[(i + dir + SECTIONS.length) % SECTIONS.length]!;
    this.ctx.sound('uiToggle');
    const onTabs = this.tabItems.includes(this.nav.current()!);
    this.showSection(next.id, !onTabs);
  }

  private showSection(id: SettingsSection, focusFields: boolean, initial = false): void {
    if (id === this.section && !initial) {
      if (focusFields && this.controls[0]) this.nav.focusElement(this.controls[0].control.el, 'key');
      return;
    }
    const wasOnTabs = !initial && this.tabItems.includes(this.nav.current()!);
    this.section = id;
    for (const [s, b] of this.tabs) {
      b.classList.toggle('is-active', s === id);
      b.setAttribute('aria-selected', String(s === id));
    }
    this.buildFields();
    this.reset.el.querySelector('.s1-btn__label')!.textContent =
      `Reset ${SECTIONS.find((s) => s.id === id)!.label}`;
    const rows: NavRow[] = [
      { items: this.tabItems },
      ...this.controls.map((c) => ({ items: [c.control.item], bar: this.bar })),
      ...this.bindingItems.map((item) => ({ items: [item], bar: this.bar })),
      this.footerRow,
    ];
    const target = initial || focusFields || !wasOnTabs ? this.controls[0]?.control.el : this.tabs.get(id);
    this.nav.setRows(rows, target);
  }

  private buildFields(): void {
    this.controls = FIELDS[this.section].map((field, i) => {
      const control = this.makeControl(field);
      stagger(control.el, i);
      control.item.onFocus = () => this.describe(field, i);
      return { field, control };
    });
    this.bindingItems = this.section === 'controls' ? this.bindingRows() : [];
    this.fieldsEl.replaceChildren(
      this.bar.el,
      ...this.controls.map((c) => c.control.el),
      ...(this.bindingItems.length
        ? [
            el('div', 's1-section-title s1-bind__title', [
              txt('span', 's1-code', 'Default bindings // read only'),
            ]),
            el('div', 's1-bindrow s1-bindrow--head', [
              txt('span', '', 'Action'),
              txt('span', '', 'Keyboard / mouse'),
              txt('span', '', 'Gamepad'),
            ]),
          ]
        : []),
      ...this.bindingItems.map((i) => i.el),
    );
    this.bar.hide();
  }

  private makeControl(field: SettingsField): Control {
    const get = (): FieldValue => readField(settings.value, field);
    const set = (v: FieldValue): void => {
      if (field.kind === 'choice' && field.preset) settings.applyPreset(v as Quality);
      else settings.update((s) => writeField(s, field, v));
    };
    const label = field.label;
    if (field.kind === 'toggle')
      return toggle(this.ctx, { label, get: () => get() === true, set: (v) => set(v) });
    if (field.kind === 'range') {
      return slider(this.ctx, {
        label,
        min: field.min,
        max: field.max,
        step: field.step,
        format: field.format,
        get: () => get() as number,
        set: (v) => set(v),
        commitOnRelease: field.id === 'accessibility.uiScale',
      });
    }
    return segmented(this.ctx, {
      label,
      options: field.options,
      get: () => get() as string,
      set: (v) => set(v),
    });
  }

  private describe(field: SettingsField, index: number): void {
    const def = readField(DEFAULT_SETTINGS, field);
    this.help.replaceChildren(
      txt('div', 's1-code', `${field.section} // ${pad(index + 1)}`),
      txt('h2', 's1-settings__help-title s1-display', field.label),
      txt('p', 's1-body-text s1-settings__help-text', field.help),
      dataList([['Default', [valueLabel(field, def)]]]),
    );
  }

  private syncValues(): void {
    for (const c of this.controls) c.control.update();
    this.nav.refresh();
  }

  private resetSection(): void {
    settings.reset(this.section);
    const label = SECTIONS.find((s) => s.id === this.section)!.label;
    this.ctx.toast(`${label} settings restored to their defaults.`, 'success');
  }

  /** Default bindings as read-only rows: keyboard and gamepad users can move through and read them. */
  private bindingRows(): NavItem[] {
    return DEFAULT_BINDINGS.map((b, i) => {
      const row = el('div', 's1-bindrow', [
        txt('span', 's1-bindrow__action', b.action),
        txt('span', 's1-bindrow__key', b.keyboard),
        txt('span', 's1-bindrow__key', b.gamepad),
      ]);
      row.tabIndex = -1;
      row.setAttribute('role', 'row');
      stagger(row, FIELDS.controls.length + i);
      return {
        el: row,
        confirmSound: null,
        onFocus: () =>
          this.help.replaceChildren(
            txt('div', 's1-code', `Bindings // ${pad(i + 1)}`),
            txt('h2', 's1-settings__help-title s1-display', b.action),
            dataList(
              [
                ['Keyboard / mouse', [b.keyboard]],
                ['Gamepad', [b.gamepad]],
              ],
              's1-dl--text',
            ),
            txt(
              'p',
              's1-small',
              'Default binding. Keys are matched by position, so they work on any keyboard layout.',
            ),
          ),
      };
    });
  }
}

function valueLabel(field: SettingsField, v: FieldValue): string {
  if (field.kind === 'toggle') return v ? 'On' : 'Off';
  if (field.kind === 'range') return field.format(v as number);
  return field.options.find((o) => o.value === v)?.label ?? String(v);
}

/**
 * Control builders: buttons, main-menu items and value rows (segmented, toggle, stepper, slider, select).
 * Each returns its element and a NavItem so screens compose them into the navigation grid.
 */
import type { UiContext } from './context';
import { button, chevron, el, setDisabled, txt } from './dom';
import { pad } from './format';
import type { NavItem } from './nav';
import { atLimit, fractionOf, stepChoice, stepList, stepRange, valueFromFraction } from './values';

export interface Control {
  el: HTMLElement;
  item: NavItem;
  /** Re-reads the bound value and redraws. */
  update(): void;
}

// ─────────────────────────────────────────────────────────────── Buttons

export interface ButtonOptions {
  primary?: boolean;
  /** Returns a reason when the button is unavailable; the reason becomes its tooltip. */
  disabled?: () => string | null;
  terminal?: boolean;
  chevron?: boolean;
}

export function actionButton(label: string, onActivate: () => void, opts: ButtonOptions = {}): Control {
  const b = button(`s1-btn${opts.primary ? ' s1-btn--primary' : ''}`, [
    txt('span', 's1-btn__label', label),
    opts.chevron ? chevron('right') : null,
  ]);
  const update = (): void => setDisabled(b, opts.disabled?.() ?? null);
  update();
  return {
    el: b,
    update,
    item: {
      el: b,
      disabled: () => Boolean(opts.disabled?.()),
      activate: onActivate,
      terminal: opts.terminal ?? true,
    },
  };
}

/** Secondary BACK button with the back cue. */
export function backButton(onBack: () => void, label = 'Back'): Control {
  const c = actionButton(label, onBack, { terminal: true });
  c.item.confirmSound = 'uiBack';
  c.el.dataset.help = 'Return to the previous screen.';
  return c;
}

// ─────────────────────────────────────────────────────────────── Main menu item

export function menuItem(index: number, label: string, note: string, onActivate: () => void): Control {
  const b = button('s1-mi', [
    txt('span', 's1-mi__idx', pad(index)),
    txt('span', 's1-mi__label', label),
    txt('span', 's1-mi__note', note),
  ]);
  return { el: b, update: () => undefined, item: { el: b, activate: onActivate, terminal: true } };
}

// ─────────────────────────────────────────────────────────────── Field rows

/** Label + control row. The row element is the focus target; its control handles pointer input. */
function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 's1-field', [
    txt('span', 's1-field__label', label),
    el('div', 's1-field__control', [control]),
  ]);
  row.tabIndex = -1;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', label);
  return row;
}

export interface ChoiceSpec {
  label: string;
  options: readonly { value: string; label: string; disabled?: string; swatch?: string }[];
  get: () => string;
  set: (value: string) => void;
}

/** Segmented control. Left/right step through enabled options; Enter cycles with wrap-around. */
export function segmented(ctx: UiContext, spec: ChoiceSpec): Control {
  const seg = el('div', 's1-seg');
  seg.setAttribute('role', 'radiogroup');
  const opts = spec.options.map((o) => {
    const b = button('s1-seg__opt', [
      o.swatch ? swatch(o.swatch) : null,
      txt('span', 's1-seg__txt', o.label),
    ]);
    b.setAttribute('role', 'radio');
    if (o.disabled) setDisabled(b, o.disabled);
    b.addEventListener('click', () => {
      if (o.disabled) {
        ctx.sound('uiError');
        return;
      }
      if (spec.get() !== o.value) {
        spec.set(o.value);
        ctx.sound('uiToggle');
      }
      update();
    });
    seg.appendChild(b);
    return b;
  });
  const values = spec.options.map((o) => o.value);
  const enabled = (v: string): boolean => !spec.options.find((o) => o.value === v)?.disabled;
  const update = (): void => {
    const v = spec.get();
    spec.options.forEach((o, i) => {
      const on = o.value === v;
      opts[i]!.classList.toggle('is-on', on);
      opts[i]!.setAttribute('aria-checked', String(on));
    });
  };
  const change = (dir: 1 | -1, wrap: boolean): void => {
    const cur = spec.get();
    const next = stepChoice(values, cur, dir, enabled, wrap);
    if (next === cur) {
      ctx.sound('uiError');
      return;
    }
    spec.set(next);
    ctx.sound('uiToggle');
    update();
  };
  const row = fieldRow(spec.label, seg);
  update();
  return {
    el: row,
    update,
    item: {
      el: row,
      adjust: (dir) => change(dir, false),
      activate: () => change(1, true),
      confirmSound: null,
      clickActivates: false,
    },
  };
}

export function toggle(
  ctx: UiContext,
  spec: { label: string; get: () => boolean; set: (v: boolean) => void; off?: string; on?: string },
): Control {
  return segmented(ctx, {
    label: spec.label,
    options: [
      { value: 'off', label: spec.off ?? 'Off' },
      { value: 'on', label: spec.on ?? 'On' },
    ],
    get: () => (spec.get() ? 'on' : 'off'),
    set: (v) => spec.set(v === 'on'),
  });
}

export interface StepperSpec {
  label: string;
  /** Explicit values (for example time limits); otherwise min/max/step. */
  values?: readonly number[];
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
  unit?: (v: number) => string;
}

export function stepper(ctx: UiContext, spec: StepperSpec): Control {
  const dec = button('s1-step__btn', [chevron('left')]);
  const inc = button('s1-step__btn', [chevron('right')]);
  dec.setAttribute('aria-label', `Decrease ${spec.label}`);
  inc.setAttribute('aria-label', `Increase ${spec.label}`);
  const value = txt('span', 's1-step__num', '');
  const unit = txt('span', 's1-step__unit', '');
  const box = el('div', 's1-step', [dec, el('span', 's1-step__val', [value, unit]), inc]);
  const next = (v: number, dir: 1 | -1): number =>
    spec.values ? stepList(spec.values, v, dir) : stepRange(v, dir, spec.min, spec.max, spec.step);
  const update = (): void => {
    const v = spec.get();
    value.textContent = spec.format(v);
    unit.textContent = spec.unit?.(v) ?? '';
    setDisabled(dec, atLimit(v, -1, spec.min, spec.max) ? 'Already at the minimum.' : null);
    setDisabled(inc, atLimit(v, 1, spec.min, spec.max) ? 'Already at the maximum.' : null);
    box.setAttribute('aria-valuenow', String(v));
  };
  const change = (dir: 1 | -1): void => {
    const cur = spec.get();
    const n = next(cur, dir);
    if (n === cur) {
      ctx.sound('uiError');
      return;
    }
    spec.set(n);
    ctx.sound('uiToggle');
    update();
  };
  dec.addEventListener('click', () => change(-1));
  inc.addEventListener('click', () => change(1));
  box.setAttribute('role', 'spinbutton');
  const row = fieldRow(spec.label, box);
  update();
  return {
    el: row,
    update,
    item: { el: row, adjust: change, activate: () => change(1), confirmSound: null, clickActivates: false },
  };
}

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
  /** Pointer drags preview the value and commit on release (for values that change the layout itself). */
  commitOnRelease?: boolean;
}

export function slider(ctx: UiContext, spec: SliderSpec): Control {
  const thumb = el('div', 's1-slider__thumb');
  const track = el('div', 's1-slider__track', [
    el('div', 's1-slider__ticks'),
    el('div', 's1-slider__fill'),
    el('div', 's1-slider__rail', [thumb]),
  ]);
  const readout = txt('span', 's1-slider__val', '');
  const box = el('div', 's1-slider', [track, readout]);
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', spec.label);
  track.setAttribute('aria-valuemin', String(spec.min));
  track.setAttribute('aria-valuemax', String(spec.max));
  let pending: number | null = null;
  const show = (v: number): void => {
    box.style.setProperty('--f', String(fractionOf(v, spec.min, spec.max)));
    readout.textContent = spec.format(v);
    track.setAttribute('aria-valuenow', String(v));
    track.setAttribute('aria-valuetext', spec.format(v));
  };
  const update = (): void => show(pending ?? spec.get());
  const commit = (v: number): void => {
    if (v === spec.get()) return;
    spec.set(v);
    ctx.sound('uiToggle');
    update();
  };
  const fromPointer = (e: PointerEvent): void => {
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    const v = valueFromFraction((e.clientX - r.left) / r.width, spec.min, spec.max, spec.step);
    if (spec.commitOnRelease) {
      if (v !== (pending ?? spec.get())) ctx.sound('uiToggle');
      pending = v;
      show(v);
    } else commit(v);
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  const release = (): void => {
    if (pending === null) return;
    const v = pending;
    pending = null;
    if (v !== spec.get()) spec.set(v);
    update();
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  const change = (dir: 1 | -1): void => {
    const cur = spec.get();
    const n = stepRange(cur, dir, spec.min, spec.max, spec.step);
    if (n === cur) {
      ctx.sound('uiError');
      return;
    }
    commit(n);
  };
  const row = fieldRow(spec.label, box);
  update();
  return {
    el: row,
    update,
    item: { el: row, adjust: change, activate: () => undefined, confirmSound: null, clickActivates: false },
  };
}

export interface SelectOption {
  value: string;
  name: string;
  meta?: string;
  /** Present when the option cannot be chosen; explains why. */
  reason?: string;
}

export interface SelectSpec {
  label: string;
  title: string;
  options: () => readonly SelectOption[];
  get: () => string;
  set: (v: string) => void;
  open: (anchor: HTMLElement, onPick: (v: string) => void) => void;
}

/** Select: left/right cycles enabled options; Enter or a click opens the full list with reasons. */
export function select(ctx: UiContext, spec: SelectSpec): Control {
  const prev = button('s1-step__btn', [chevron('left')]);
  const next = button('s1-step__btn', [chevron('right')]);
  prev.setAttribute('aria-label', `Previous ${spec.label}`);
  next.setAttribute('aria-label', `Next ${spec.label}`);
  const value = txt('span', 's1-select__val', '');
  const meta = txt('span', 's1-select__meta', '');
  const opener = button('s1-select__open', [value, meta, chevron('down')]);
  opener.setAttribute('aria-haspopup', 'listbox');
  const box = el('div', 's1-select', [prev, opener, next]);
  const update = (): void => {
    const opts = spec.options();
    const v = spec.get();
    const i = opts.findIndex((o) => o.value === v);
    const o = opts[i];
    value.textContent = o ? o.name : '';
    meta.textContent = `${pad(i + 1)}/${pad(opts.length)}`;
    const enabled = (x: string): boolean => !opts.find((y) => y.value === x)?.reason;
    const values = opts.map((x) => x.value);
    setDisabled(prev, stepChoice(values, v, -1, enabled) === v ? 'No earlier option is available.' : null);
    setDisabled(next, stepChoice(values, v, 1, enabled) === v ? 'No later option is available.' : null);
  };
  const change = (dir: 1 | -1): void => {
    const opts = spec.options();
    const cur = spec.get();
    const n = stepChoice(
      opts.map((o) => o.value),
      cur,
      dir,
      (x) => !opts.find((o) => o.value === x)?.reason,
    );
    if (n === cur) {
      ctx.sound('uiError');
      return;
    }
    spec.set(n);
    ctx.sound('uiToggle');
    update();
  };
  const open = (): void => {
    ctx.sound('uiConfirm');
    spec.open(box, (v) => {
      if (v !== spec.get()) {
        spec.set(v);
        ctx.sound('uiToggle');
      }
      update();
    });
  };
  prev.addEventListener('click', () => change(-1));
  next.addEventListener('click', () => change(1));
  opener.addEventListener('click', open);
  const row = fieldRow(spec.label, box);
  update();
  return {
    el: row,
    update,
    item: { el: row, adjust: change, activate: open, confirmSound: null, clickActivates: false },
  };
}

function swatch(color: string): HTMLElement {
  const s = el('span', 's1-swatch');
  s.style.background = color;
  return s;
}

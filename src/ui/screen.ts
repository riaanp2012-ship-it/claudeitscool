/**
 * Screen base: frame grid, header and footer chrome, the navigation stack (screen, then popovers and
 * dialogs on top) and automatic cleanup of timers and listeners.
 */
import type { UiContext } from './context';
import { button, chevron, el, stagger, svg, txt, type Child } from './dom';
import { placeTooltip } from './layout-math';
import { NavController, SelectionBar, type NavOptions, type NavRow } from './nav';
import type { NavAction } from './ui-types';

export type ScreenKind =
  | 'title'
  | 'menu'
  | 'instant'
  | 'free'
  | 'training'
  | 'campaign'
  | 'hangar'
  | 'settings'
  | 'credits'
  | 'briefing'
  | 'loading'
  | 'pause'
  | 'debrief'
  | 'resume'
  | 'fatal';

interface Layer {
  nav: NavController;
  el: HTMLElement;
  close: () => void;
}

export interface ScreenOptions {
  /** Scrim style suffix (s1-scrim--<name>), or 'none'. */
  scrim?: string;
  /** Builds the 12-column frame (default true). */
  frame?: boolean;
  nav?: Omit<NavOptions, 'sound'>;
}

export abstract class Screen {
  readonly el: HTMLElement;
  readonly frame: HTMLElement;
  protected readonly nav: NavController;
  private layers: Layer[] = [];
  private cleanups: (() => void)[] = [];
  private timers = new Set<number>();
  private frames = new Set<number>();
  disposed = false;

  constructor(
    protected readonly ctx: UiContext,
    readonly kind: ScreenKind,
    options: ScreenOptions = {},
  ) {
    this.el = el('section', `s1-screen s1-screen--${kind}`);
    this.el.dataset.screen = kind;
    const scrim = options.scrim ?? 'left';
    if (scrim !== 'none') this.el.appendChild(el('div', `s1-scrim s1-scrim--${scrim}`));
    this.frame = el('div', 's1-frame');
    if (options.frame !== false) this.el.appendChild(this.frame);
    this.nav = new NavController({ sound: (id) => ctx.sound(id), ...options.nav });
    // Menus own their pointer input: nothing leaks to the game underneath (ZD-H10).
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel'] as const) {
      this.listen(this.el, type, (e) => {
        e.stopPropagation();
        if (type === 'contextmenu') e.preventDefault();
      });
    }
  }

  /** Top-most navigation layer gets the input. */
  handle(action: NavAction): boolean {
    const top = this.layers[this.layers.length - 1];
    if (top) return top.nav.handle(action);
    return this.nav.handle(action);
  }

  /** "Press any key" screens override this; return true when the input was used. */
  anyInput(): boolean {
    return false;
  }

  /** Called once the element is in the document (measure-dependent setup). */
  mounted(): void {
    this.nav.refresh();
  }

  /** Called after resize, UI scale or density changes. */
  relayout(): void {
    this.nav.refresh();
    for (const l of this.layers) l.nav.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const l of this.layers) l.nav.dispose();
    this.layers = [];
    this.nav.dispose();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    for (const t of this.timers) window.clearTimeout(t);
    for (const f of this.frames) cancelAnimationFrame(f);
    this.timers.clear();
    this.frames.clear();
  }

  get hasLayer(): boolean {
    return this.layers.length > 0;
  }

  protected listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window | Document,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  protected onDispose(fn: () => void): void {
    this.cleanups.push(fn);
  }

  protected later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }

  protected frameLoop(fn: (now: number) => boolean): void {
    const step = (now: number): void => {
      if (this.disposed) return;
      const keep = fn(now);
      if (keep) {
        const id = requestAnimationFrame(step);
        this.frames.add(id);
      }
    };
    const id = requestAnimationFrame(step);
    this.frames.add(id);
  }

  /** Pushes a modal navigation layer (popover or dialog). Only one layer per screen at a time (ZD-J15). */
  protected openLayer(
    layerEl: HTMLElement,
    rows: NavRow[],
    onClose: () => void,
    preferred?: HTMLElement,
  ): boolean {
    if (this.layers.length > 0) return false;
    const catcher = el('div', 's1-catch');
    const close = (): void => {
      const i = this.layers.indexOf(layer);
      if (i < 0) return;
      this.layers.splice(i, 1);
      layer.nav.dispose();
      catcher.remove();
      layerEl.remove();
      this.nav.enabled = true;
      onClose();
    };
    const nav = new NavController({
      sound: (id) => this.ctx.sound(id),
      wrap: false,
      onBack: close,
    });
    const layer: Layer = { nav, el: layerEl, close };
    catcher.addEventListener('click', () => {
      this.ctx.sound('uiBack');
      close();
    });
    this.nav.enabled = false;
    this.ctx.hideTooltip();
    this.el.append(catcher, layerEl);
    this.layers.push(layer);
    nav.setRows(rows, preferred);
    return true;
  }

  protected closeLayer(): void {
    this.layers[this.layers.length - 1]?.close();
  }

  /**
   * Opens a list popover anchored to `anchor` (a select control). Placed below the anchor, or above
   * when there is no room, and always inside the screen.
   */
  protected openList(
    anchor: HTMLElement,
    spec: {
      title: string;
      options: readonly { value: string; name: string; meta?: string; reason?: string }[];
      value: string;
      onPick: (value: string) => void;
    },
  ): void {
    const list = el('div', 's1-pop__list s1-scroll');
    const pop = el('div', 's1-pop', [
      el('div', 's1-pop__head', [txt('span', 's1-code', spec.title), txt('span', 's1-code', 'ENTER SELECT')]),
      list,
    ]);
    pop.setAttribute('role', 'listbox');
    const bar = new SelectionBar(list);
    let picked: string | null = null;
    const rows: NavRow[] = spec.options.map((o) => {
      const opt = button(`s1-opt${o.value === spec.value ? ' is-on' : ''}`, [
        el('span', 's1-row__main', [
          txt('span', 's1-opt__name', o.name),
          o.meta ? txt('span', 's1-opt__meta', o.meta) : null,
        ]),
        o.reason ? el('span', 's1-tag', [lockIcon(), shortReason(o.reason)]) : null,
      ]);
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(o.value === spec.value));
      if (o.reason) {
        opt.classList.add('is-disabled');
        opt.dataset.tip = o.reason;
        opt.setAttribute('aria-disabled', 'true');
      }
      list.appendChild(opt);
      return {
        bar,
        items: [
          {
            el: opt,
            disabled: () => Boolean(o.reason),
            activate: () => {
              picked = o.value;
              this.closeLayer();
            },
          },
        ],
      };
    });
    const selected = Array.from(list.children).find((c) => c.classList.contains('is-on')) as
      HTMLElement | undefined;
    this.openLayer(
      pop,
      rows,
      () => {
        if (picked !== null) spec.onPick(picked);
      },
      selected,
    );
    // Position after insertion so the real size is known. Coordinates are in UI px (zoom-independent).
    const zoom = this.ctx.layout().zoom;
    const host = this.el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const anchorBox = {
      left: (a.left - host.left) / zoom,
      top: (a.top - host.top) / zoom,
      width: a.width / zoom,
      height: a.height / zoom,
    };
    pop.style.width = `${Math.max(anchorBox.width, 280)}px`;
    const place = placeTooltip(
      anchorBox,
      { width: pop.offsetWidth, height: pop.offsetHeight },
      { width: host.width / zoom, height: host.height / zoom },
      4,
      16,
    );
    pop.style.left = `${place.left}px`;
    pop.style.top = `${place.top}px`;
    this.relayout();
  }
}

function shortReason(reason: string): string {
  const m = /rank (\d+)/i.exec(reason);
  return m ? `RANK ${m[1]}` : 'N/A';
}

/** Padlock glyph used next to locked items. */
export function lockIcon(): SVGSVGElement {
  return svg('svg', { class: 's1-lock', viewBox: '0 0 10 12', 'aria-hidden': 'true' }, [
    svg('path', {
      d: 'M2.5 5 V3.5 a2.5 2.5 0 0 1 5 0 V5',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1,
    }),
    svg('rect', { x: 1, y: 5, width: 8, height: 6.5, fill: 'currentColor' }),
  ]);
}

// ─────────────────────────────────────────────────────────────── Chrome builders

export function header(opts: { code: string; title: string; meta?: readonly Child[] }): HTMLElement {
  const h = el('header', 's1-head', [
    txt('div', 's1-head__code s1-code', opts.code),
    txt('h1', 's1-head__title s1-display', opts.title),
    opts.meta ? el('div', 's1-head__meta', opts.meta) : null,
  ]);
  stagger(h, 0);
  return h;
}

export type HintKey = string;

export interface Hint {
  kb: readonly HintKey[];
  pad: readonly HintKey[];
  label: string;
}

export const HINT = {
  select: { kb: ['up', 'down'], pad: ['dpad'], label: 'Select' },
  adjust: { kb: ['left', 'right'], pad: ['dpad'], label: 'Adjust' },
  confirm: { kb: ['Enter'], pad: ['A'], label: 'Confirm' },
  back: { kb: ['Esc'], pad: ['B'], label: 'Back' },
  tabs: { kb: ['Q', 'E'], pad: ['LB', 'RB'], label: 'Section' },
} as const satisfies Record<string, Hint>;

function keyCap(k: HintKey, pad: boolean): HTMLElement {
  if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
    const cap = el('span', 's1-key', [chevron(k)]);
    cap.setAttribute('aria-label', k);
    return cap;
  }
  if (k === 'dpad') {
    const cap = el('span', 's1-key', [
      svg('svg', { viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' }, [
        svg('path', {
          d: 'M4.5 1 H7.5 V4.5 H11 V7.5 H7.5 V11 H4.5 V7.5 H1 V4.5 H4.5 Z',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1,
        }),
      ]),
    ]);
    cap.setAttribute('aria-label', 'D-pad');
    return cap;
  }
  const round = pad && k.length === 1;
  return txt('span', `s1-key${pad ? (round ? ' s1-key--pad' : ' s1-key--wide') : ''}`, k.toUpperCase());
}

export function hints(list: readonly Hint[]): HTMLElement {
  return el(
    'div',
    's1-hints',
    list.map((h) =>
      el('span', 's1-hint', [
        el(
          'span',
          's1-hint__keys s1-kb',
          h.kb.map((k) => keyCap(k, false)),
        ),
        el(
          'span',
          's1-hint__keys s1-pad',
          h.pad.map((k) => keyCap(k, true)),
        ),
        h.label,
      ]),
    ),
  );
}

export function footer(hintList: readonly Hint[], actions: readonly HTMLElement[]): HTMLElement {
  const f = el('footer', 's1-foot', [hints(hintList), el('div', 's1-foot__actions', actions)]);
  stagger(f, 6);
  return f;
}

/**
 * DOM side of focus navigation: keeps the pure grid model (nav-model.ts) in sync with elements,
 * mouse hover, the visible selection state and the sliding selection bar.
 */
import { el } from './dom';
import { initialPos, moveCol, moveRow, validate, type NavPos, type NavShape } from './nav-model';
import type { NavAction, UiSoundId } from './ui-types';

export interface NavItem {
  el: HTMLElement;
  /** Disabled items are skipped by keyboard and gamepad; clicking them plays the error cue. */
  disabled?: () => boolean;
  /** Enter, A or a click. */
  activate?: () => void;
  /** Left/right on a value control. */
  adjust?: (dir: 1 | -1) => void;
  /** Runs whenever the item gains focus (context panels, help text). */
  onFocus?: () => void;
  /** Sound for activation; null for controls that play their own cue. Default 'uiConfirm'. */
  confirmSound?: UiSoundId | null;
  /** A click on the element activates it (default true). Value rows handle their own clicks. */
  clickActivates?: boolean;
  /** Blocks repeated activation for a moment (actions that leave the screen). */
  terminal?: boolean;
}

export interface NavRow {
  items: NavItem[];
  /** Selection bar that tracks this row. */
  bar?: SelectionBar;
}

export interface NavOptions {
  sound: (id: UiSoundId) => void;
  onBack?: () => void;
  onTab?: (dir: 1 | -1) => void;
  onStart?: () => void;
  wrap?: boolean;
  /** Called when a direction has nowhere to go (for example left/right on a plain list). */
  onEdge?: (action: NavAction) => boolean;
}

type Source = 'init' | 'key' | 'mouse' | 'silent';

const TERMINAL_LOCK_MS = 400;

/** Offset of `node` from the top of `ancestor` in layout px (independent of CSS zoom). */
export function offsetWithin(node: HTMLElement, ancestor: HTMLElement): number {
  let y = 0;
  let cur: HTMLElement | null = node;
  while (cur && cur !== ancestor) {
    y += cur.offsetTop;
    const parent = cur.offsetParent as HTMLElement | null;
    if (parent === null) break;
    if (parent !== ancestor && !ancestor.contains(parent)) {
      y -= ancestor.offsetTop;
      break;
    }
    cur = parent;
  }
  return y;
}

/**
 * Scrolls the nearest UI scroll container just enough to show `node`. Only UI scroll containers move;
 * the page and the UI root never scroll.
 */
function ensureVisible(node: HTMLElement): void {
  const sc = node.parentElement?.closest<HTMLElement>('.s1-scroll');
  if (!sc || sc.scrollHeight <= sc.clientHeight) return;
  const top = offsetWithin(node, sc);
  const bottom = top + node.offsetHeight;
  const pad = 8;
  if (top - pad < sc.scrollTop) sc.scrollTop = Math.max(0, top - pad);
  else if (bottom + pad > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom + pad - sc.clientHeight;
}

/** The orange bar that slides between the rows of one list. */
export class SelectionBar {
  readonly el: HTMLElement;
  private placed = false;
  private target: HTMLElement | null = null;

  constructor(readonly host: HTMLElement) {
    host.classList.add('s1-barhost');
    this.el = el('div', 's1-selbar');
    this.el.setAttribute('aria-hidden', 'true');
    host.appendChild(this.el);
  }

  moveTo(target: HTMLElement): void {
    this.target = target;
    const y = offsetWithin(target, this.host);
    const h = target.offsetHeight;
    if (!this.placed || h === 0) {
      this.el.classList.add('is-instant');
      this.placed = h > 0;
    }
    this.el.style.transform = `translateY(${y}px) scaleY(${h})`;
    this.el.classList.add('is-on');
    if (this.el.classList.contains('is-instant')) {
      // Re-enable the slide on the next frame so the first placement never animates from the top.
      requestAnimationFrame(() => this.el.classList.remove('is-instant'));
    }
  }

  /** Re-measure after a layout change (resize, density switch, content update). */
  refresh(): void {
    if (this.target && this.el.classList.contains('is-on')) {
      this.placed = false;
      this.moveTo(this.target);
    }
  }

  hide(): void {
    this.el.classList.remove('is-on');
  }
}

export class NavController {
  private rows: NavRow[] = [];
  private pos: NavPos | null = null;
  private lockedUntil = 0;
  private cleanups: (() => void)[] = [];
  private bars = new Set<SelectionBar>();
  enabled = true;

  constructor(private opts: NavOptions) {}

  /** Adds or replaces callbacks after construction (subclass constructors cannot capture `this` earlier). */
  configure(opts: Partial<NavOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** Replaces all rows. `preferred` picks the initial focus (element or grid position). */
  setRows(rows: NavRow[], preferred?: HTMLElement | NavPos): void {
    this.detach();
    this.rows = rows;
    this.bars.clear();
    for (const row of rows) if (row.bar) this.bars.add(row.bar);
    rows.forEach((row, r) =>
      row.items.forEach((item, c) => {
        const onEnter = (): void => {
          if (!this.enabled || this.isDisabled(item)) return;
          if (this.pos?.row === r && this.pos.col === c) return;
          this.focusAt({ row: r, col: c }, 'mouse');
        };
        const onClick = (e: MouseEvent): void => {
          if (!this.enabled) return;
          if (this.isDisabled(item)) {
            this.opts.sound('uiError');
            return;
          }
          this.focusAt({ row: r, col: c }, 'silent');
          if (item.clickActivates === false) return;
          e.preventDefault();
          this.activate(item);
        };
        item.el.addEventListener('pointerenter', onEnter);
        item.el.addEventListener('click', onClick);
        this.cleanups.push(() => {
          item.el.removeEventListener('pointerenter', onEnter);
          item.el.removeEventListener('click', onClick);
        });
      }),
    );
    let start: NavPos | undefined;
    if (preferred instanceof HTMLElement) start = this.find(preferred) ?? undefined;
    else start = preferred;
    const p = initialPos(this.shape(), start);
    this.pos = null;
    if (p) this.focusAt(p, 'init');
  }

  shape(): NavShape {
    return this.rows.map((row) => row.items.map((item) => !this.isDisabled(item)));
  }

  current(): NavItem | null {
    if (!this.pos) return null;
    return this.rows[this.pos.row]?.items[this.pos.col] ?? null;
  }

  position(): NavPos | null {
    return this.pos ? { ...this.pos } : null;
  }

  find(target: HTMLElement): NavPos | null {
    for (let r = 0; r < this.rows.length; r++) {
      const c = this.rows[r]!.items.findIndex((i) => i.el === target);
      if (c >= 0) return { row: r, col: c };
    }
    return null;
  }

  /** Moves focus to an element (for example after a list selection changes programmatically). */
  focusElement(target: HTMLElement, source: Source = 'silent'): void {
    const p = this.find(target);
    if (p && !this.isDisabled(this.rows[p.row]!.items[p.col]!)) this.focusAt(p, source);
  }

  handle(action: NavAction): boolean {
    if (!this.enabled) return false;
    const cur = this.current();
    switch (action) {
      case 'up':
      case 'down':
        return this.move(action === 'up' ? -1 : 1);
      case 'left':
      case 'right': {
        const dir = action === 'left' ? -1 : 1;
        if (cur?.adjust) {
          cur.adjust(dir);
          return true;
        }
        const row = this.pos ? this.rows[this.pos.row] : undefined;
        if (row && row.items.length > 1 && this.pos) {
          const next = moveCol(this.shape(), this.pos, dir);
          if (next.col !== this.pos.col) this.focusAt(next, 'key');
          return true;
        }
        return this.opts.onEdge?.(action) ?? false;
      }
      case 'confirm':
        if (cur) this.activate(cur);
        return true;
      case 'back':
        if (!this.opts.onBack) return this.opts.onEdge?.(action) ?? false;
        if (this.isLocked()) return true;
        this.lock();
        this.opts.sound('uiBack');
        this.opts.onBack();
        return true;
      case 'tabPrev':
      case 'tabNext':
        if (!this.opts.onTab) return false;
        this.opts.onTab(action === 'tabPrev' ? -1 : 1);
        return true;
      case 'start':
        if (this.opts.onStart) {
          if (this.isLocked()) return true;
          this.lock();
          this.opts.onStart();
          return true;
        }
        if (cur) this.activate(cur);
        return true;
    }
  }

  /** Re-check disabled states and bar positions after data or layout changed. */
  refresh(): void {
    if (this.pos) {
      const p = validate(this.shape(), this.pos);
      if (p.row !== this.pos.row || p.col !== this.pos.col) this.focusAt(p, 'silent');
    }
    for (const b of this.bars) b.refresh();
    const cur = this.current();
    if (cur && this.enabled && cur.el.isConnected && document.activeElement !== cur.el) {
      cur.el.focus({ preventScroll: true });
      ensureVisible(cur.el);
    }
  }

  dispose(): void {
    this.detach();
    this.rows = [];
    this.pos = null;
  }

  private move(dir: 1 | -1): boolean {
    const shape = this.shape();
    if (!this.pos) {
      const p = initialPos(shape);
      if (p) this.focusAt(p, 'key');
      return true;
    }
    const next = moveRow(shape, this.pos, dir, this.opts.wrap ?? true);
    if (next.row !== this.pos.row || next.col !== this.pos.col) this.focusAt(next, 'key');
    return true;
  }

  private activate(item: NavItem): void {
    if (!item.activate) return;
    if (item.terminal) {
      if (this.isLocked()) return;
      this.lock();
    }
    const cue = item.confirmSound === undefined ? 'uiConfirm' : item.confirmSound;
    if (cue) this.opts.sound(cue);
    item.activate();
  }

  private focusAt(p: NavPos, source: Source): void {
    const prev = this.current();
    const row = this.rows[p.row];
    const item = row?.items[p.col];
    if (!row || !item) return;
    const changed = prev !== item;
    if (prev && changed) prev.el.classList.remove('is-sel');
    this.pos = { row: p.row, col: p.col };
    item.el.classList.add('is-sel');
    for (const b of this.bars) if (b !== row.bar) b.hide();
    row.bar?.moveTo(
      row.items.length > 1 ? item.el : (item.el.closest<HTMLElement>('[data-bar-target]') ?? item.el),
    );
    if (document.activeElement !== item.el) item.el.focus({ preventScroll: true });
    if (source === 'key' || source === 'init') ensureVisible(item.el);
    if (changed && (source === 'key' || source === 'mouse')) this.opts.sound('uiHover');
    if (changed || source === 'init') item.onFocus?.();
  }

  private isDisabled(item: NavItem): boolean {
    return item.disabled?.() ?? false;
  }

  private isLocked(): boolean {
    return performance.now() < this.lockedUntil;
  }

  private lock(): void {
    this.lockedUntil = performance.now() + TERMINAL_LOCK_MS;
  }

  private detach(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }
}

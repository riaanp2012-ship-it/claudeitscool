/** Root-level views that live outside screens: the tooltip and the toast stack. */
import { el, txt } from './dom';
import { placeTooltip } from './layout-math';
import { ToastQueue } from './toast-queue';
import type { ToastKind } from './ui-types';

const TIP_DELAY_MS = 140;

/** One tooltip for the whole UI. Any element with `data-tip` gets it on hover, clamped on screen (ZD-J14). */
export class TooltipView {
  readonly el: HTMLElement;
  private anchor: HTMLElement | null = null;
  private timer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly zoom: () => number,
  ) {
    this.el = el('div', 's1-tip');
    this.el.setAttribute('role', 'tooltip');
    root.addEventListener('pointerover', this.onOver);
    root.addEventListener('pointerout', this.onOut);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.anchor = null;
    this.el.classList.remove('is-on');
  }

  dispose(): void {
    this.hide();
    this.root.removeEventListener('pointerover', this.onOver);
    this.root.removeEventListener('pointerout', this.onOut);
  }

  private onOver = (e: PointerEvent): void => {
    const target = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
    if (!target || target === this.anchor) return;
    this.hide();
    this.anchor = target;
    this.timer = window.setTimeout(() => this.show(target), TIP_DELAY_MS);
  };

  private onOut = (e: PointerEvent): void => {
    if (!this.anchor) return;
    const to = e.relatedTarget as Node | null;
    if (to && this.anchor.contains(to)) return;
    this.hide();
  };

  private show(target: HTMLElement): void {
    if (!target.isConnected || this.anchor !== target) return;
    const text = target.dataset.tip;
    if (!text) return;
    this.el.textContent = text;
    this.el.dataset.kind = target.dataset.tipKind ?? 'reason';
    const z = this.zoom();
    const host = this.root.getBoundingClientRect();
    const a = target.getBoundingClientRect();
    this.el.style.transform = 'none';
    const place = placeTooltip(
      {
        left: (a.left - host.left) / z,
        top: (a.top - host.top) / z,
        width: a.width / z,
        height: a.height / z,
      },
      { width: this.el.offsetWidth, height: this.el.offsetHeight },
      { width: host.width / z, height: host.height / z },
    );
    this.el.style.transform = `translate(${place.left}px, ${place.top}px)`;
    this.el.classList.add('is-on');
  }
}

const KIND_LABEL: Record<ToastKind, string> = { info: 'Notice', warn: 'Caution', success: 'Confirmed' };

/** Toast stack: at most three, oldest evicted first, identical messages refresh (ZD-J12). */
export class ToastView {
  readonly el: HTMLElement;
  private readonly queue = new ToastQueue(3);
  private readonly nodes = new Map<number, HTMLElement>();
  private timer = 0;

  constructor() {
    this.el = el('div', 's1-toasts');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
  }

  push(text: string, kind: ToastKind): void {
    const now = performance.now();
    const r = this.queue.push(text, kind, now);
    for (const gone of r.evicted) this.drop(gone.id, true);
    if (!r.refreshed) {
      const node = el('div', 's1-toast', [
        el('span', 's1-toast__glyph'),
        txt('span', 's1-toast__kind s1-code', KIND_LABEL[kind]),
        txt('p', 's1-toast__text', text),
      ]);
      node.dataset.kind = kind;
      this.nodes.set(r.entry.id, node);
      this.el.appendChild(node);
    }
    this.schedule();
  }

  clear(): void {
    this.queue.clear();
    for (const id of [...this.nodes.keys()]) this.drop(id, true);
    window.clearTimeout(this.timer);
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    const next = this.queue.nextExpiry();
    if (next === null) return;
    this.timer = window.setTimeout(
      () => {
        for (const t of this.queue.expire(performance.now())) this.drop(t.id, false);
        this.schedule();
      },
      Math.max(16, next - performance.now()),
    );
  }

  private drop(id: number, immediate: boolean): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.delete(id);
    this.queue.remove(id);
    if (immediate) {
      node.remove();
      return;
    }
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 220);
  }
}

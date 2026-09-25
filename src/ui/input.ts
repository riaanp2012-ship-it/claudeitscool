/**
 * Menu input: keyboard (capture phase, so keys the menus consume never reach the game) and gamepad
 * polling that runs only while a menu is visible.
 */
import { countsAsAnyKey, keyToAction, PAD, RepeatGate } from './keymap';
import type { InputDevice, NavAction } from './ui-types';

export interface InputSink {
  /** True while menus want input. */
  active(): boolean;
  /** "Press any key" handler; return true when consumed. */
  any(): boolean;
  /** Navigation handler; return true when consumed. */
  action(a: NavAction): boolean;
  device(d: InputDevice): void;
}

const STICK_THRESHOLD = 0.55;
const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const BUTTONS: readonly [number, NavAction][] = [
  [PAD.a, 'confirm'],
  [PAD.b, 'back'],
  [PAD.start, 'start'],
  [PAD.lb, 'tabPrev'],
  [PAD.rb, 'tabNext'],
];

export class MenuInput {
  private raf = 0;
  private polling = false;
  private readonly gates = new Map<string, RepeatGate>();
  private readonly held = new Map<string, boolean>();
  private fresh = true;

  constructor(private readonly sink: InputSink) {
    window.addEventListener('keydown', this.onKey, { capture: true });
    for (const d of DIRECTIONS) this.gates.set(d, new RepeatGate(380, 90));
  }

  /** Starts or stops gamepad polling to match menu visibility. */
  sync(): void {
    const want = this.sink.active() && typeof navigator !== 'undefined' && 'getGamepads' in navigator;
    if (want && !this.polling) {
      this.polling = true;
      this.fresh = true;
      this.raf = requestAnimationFrame(this.poll);
    } else if (!want && this.polling) {
      this.polling = false;
      cancelAnimationFrame(this.raf);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.polling = false;
    cancelAnimationFrame(this.raf);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.sink.active()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.isComposing) return;
    const action = keyToAction(e.code, e.shiftKey);
    if (countsAsAnyKey(e.code) && !e.repeat && this.sink.any()) {
      this.consume(e);
      return;
    }
    if (!action) return;
    this.sink.device('keyboard');
    if (e.repeat && (action === 'confirm' || action === 'back' || action === 'start')) {
      this.consume(e);
      return;
    }
    const used = this.sink.action(action);
    // Navigation keys never scroll the page or reach the game while a menu is up.
    if (used || action !== 'back') this.consume(e);
  };

  private consume(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private poll = (now: number): void => {
    if (!this.polling) return;
    this.raf = requestAnimationFrame(this.poll);
    if (!this.sink.active()) return;
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads();
    } catch {
      return;
    }
    const pressed = (i: number): boolean =>
      pads.some((p) => p?.connected === true && p.buttons[i]?.pressed === true);
    const axis = (i: number): number => {
      let v = 0;
      for (const p of pads) {
        const a = p?.connected ? (p.axes[i] ?? 0) : 0;
        if (Math.abs(a) > Math.abs(v)) v = a;
      }
      return v;
    };
    const ax = axis(0);
    const ay = axis(1);
    const dirs: Record<(typeof DIRECTIONS)[number], boolean> = {
      up: pressed(PAD.up) || ay < -STICK_THRESHOLD,
      down: pressed(PAD.down) || ay > STICK_THRESHOLD,
      left: pressed(PAD.left) || ax < -STICK_THRESHOLD,
      right: pressed(PAD.right) || ax > STICK_THRESHOLD,
    };
    const anyButton = pads.some((p) => p?.connected === true && p.buttons.some((b) => b.pressed));
    if (this.fresh) {
      // Anything already held when the menu opened must be released before it counts.
      this.fresh = false;
      for (const d of DIRECTIONS) {
        if (dirs[d]) this.gates.get(d)!.latch(now);
        else this.gates.get(d)!.reset();
      }
      for (const [i] of BUTTONS) this.held.set(String(i), pressed(i));
      this.held.set('any', anyButton);
      return;
    }
    const wasAny = this.held.get('any') ?? false;
    this.held.set('any', anyButton);
    if (anyButton && !wasAny) {
      this.sink.device('gamepad');
      if (this.sink.any()) {
        for (const [i] of BUTTONS) this.held.set(String(i), pressed(i));
        return;
      }
    }
    for (const d of DIRECTIONS) {
      if (this.gates.get(d)!.update(dirs[d], now)) {
        this.sink.device('gamepad');
        this.sink.action(d);
        if (!this.polling) return;
      }
    }
    for (const [i, action] of BUTTONS) {
      const key = String(i);
      const down = pressed(i);
      const was = this.held.get(key) ?? false;
      this.held.set(key, down);
      if (down && !was) {
        this.sink.device('gamepad');
        this.sink.action(action);
        if (!this.polling) return;
      }
    }
  };
}

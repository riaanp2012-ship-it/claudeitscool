import type { NavAction } from './ui-types';

/**
 * Keyboard navigation map, by `KeyboardEvent.code` so it works on any layout (ZD-H03).
 * Arrows and WASD move, Enter/Space confirm, Esc/Backspace go back, Q/E switch tabs.
 */
export function keyToAction(code: string, shift = false): NavAction | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      return 'confirm';
    case 'Escape':
    case 'Backspace':
      return 'back';
    case 'Tab':
      return shift ? 'up' : 'down';
    case 'KeyQ':
    case 'PageUp':
      return 'tabPrev';
    case 'KeyE':
    case 'PageDown':
      return 'tabNext';
    default:
      return null;
  }
}

const NOT_ANY_KEY = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu',
  'Fn',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'PrintScreen',
]);

/** "Press any key" ignores modifiers and function keys (F5 reload, F11 fullscreen, F12 tools). */
export function countsAsAnyKey(code: string): boolean {
  return code !== '' && !NOT_ANY_KEY.has(code);
}

/** Standard-mapping gamepad button indices used by the menus. */
export const PAD = {
  a: 0,
  b: 1,
  lb: 4,
  rb: 5,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/**
 * Auto-repeat for held directions: fires on press, again after `delay` ms, then every `interval` ms.
 */
export class RepeatGate {
  private heldSince = -1;
  private lastFire = -1;

  constructor(
    private readonly delay = 380,
    private readonly interval = 90,
  ) {}

  update(held: boolean, now: number): boolean {
    if (!held) {
      this.heldSince = -1;
      return false;
    }
    if (this.heldSince < 0) {
      this.heldSince = now;
      this.lastFire = now;
      return true;
    }
    if (now - this.heldSince < this.delay) return false;
    if (now - this.lastFire >= this.interval) {
      this.lastFire = now;
      return true;
    }
    return false;
  }

  /** Treat the input as already held (so a button held while a menu opens does not fire). */
  latch(now: number): void {
    this.heldSince = now;
    this.lastFire = now + 1e9;
  }

  reset(): void {
    this.heldSince = -1;
    this.lastFire = -1;
  }
}

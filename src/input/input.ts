import { clamp } from '../core/math';

/**
 * Keyboard, mouse and gamepad input (spec §5.12, ZD-H01..H10).
 * - Keys are bound by KeyboardEvent.code so layouts like AZERTY work.
 * - Ctrl/Meta combinations are never bound (the browser owns Ctrl+W etc).
 * - All state clears on blur/visibility loss so keys can't stick.
 * - Mouse uses pointer lock when available, otherwise the cursor position steers.
 */
export type ActionId =
  | 'pitchUp'
  | 'pitchDown'
  | 'turnLeft'
  | 'turnRight'
  | 'rollLeft'
  | 'rollRight'
  | 'yawLeft'
  | 'yawRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'gun'
  | 'weapon'
  | 'cycleWeapon'
  | 'lock'
  | 'lookTarget'
  | 'flares'
  | 'chaff'
  | 'camera'
  | 'freeLook'
  | 'gear'
  | 'airbrake'
  | 'flaps'
  | 'wing1'
  | 'wing2'
  | 'wing3'
  | 'wing4'
  | 'map'
  | 'pause'
  | 'hud'
  | 'perf';

export const ACTION_LABELS: Record<ActionId, string> = {
  pitchUp: 'Climb (nose up)',
  pitchDown: 'Dive (nose down)',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  yawLeft: 'Yaw left',
  yawRight: 'Yaw right',
  throttleUp: 'Throttle up / afterburner',
  throttleDown: 'Throttle down',
  gun: 'Guns',
  weapon: 'Fire weapon',
  cycleWeapon: 'Cycle weapon',
  lock: 'Lock / cycle target',
  lookTarget: 'Look at target',
  flares: 'Flares',
  chaff: 'Chaff',
  camera: 'Change camera',
  freeLook: 'Free look',
  gear: 'Landing gear',
  airbrake: 'Airbrake / wheel brakes',
  flaps: 'Flaps',
  wing1: 'Wingmen: attack my target',
  wing2: 'Wingmen: cover me',
  wing3: 'Wingmen: engage at will',
  wing4: 'Wingmen: form up',
  map: 'Map / scoreboard',
  pause: 'Pause',
  hud: 'Toggle HUD',
  perf: 'Performance overlay',
};

/** Keyboard codes, 'Mouse0/1/2' for buttons. */
export const DEFAULT_BINDINGS: Record<ActionId, readonly string[]> = {
  // WASD steers: W climbs, S dives, A/D turn (the jet banks into the turn by itself).
  pitchUp: ['KeyW'],
  pitchDown: ['KeyS'],
  turnLeft: ['KeyA'],
  turnRight: ['KeyD'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  yawLeft: [],
  yawRight: [],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['KeyX'],
  gun: ['Mouse0'],
  weapon: ['Mouse2', 'Space'],
  cycleWeapon: ['Tab'],
  lock: ['KeyT'],
  lookTarget: ['KeyC'],
  flares: ['KeyF'],
  chaff: ['KeyG'],
  camera: ['KeyV'],
  freeLook: ['Mouse1'],
  gear: ['KeyL'],
  airbrake: ['KeyB'],
  flaps: ['KeyK'],
  wing1: ['Digit1'],
  wing2: ['Digit2'],
  wing3: ['Digit3'],
  wing4: ['Digit4'],
  map: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  hud: ['KeyH'],
  perf: ['F3'],
};

/** Standard-mapping gamepad buttons per action. */
const PAD_BUTTONS: Partial<Record<ActionId, readonly number[]>> = {
  gun: [2], // X
  weapon: [0], // A
  flares: [1], // B
  lock: [3], // Y
  yawLeft: [4], // LB
  yawRight: [5], // RB
  pause: [9], // Start
  camera: [8], // View
  cycleWeapon: [12], // D-pad up
  chaff: [13], // D-pad down
  gear: [14], // D-pad left
  flaps: [15], // D-pad right
  freeLook: [11], // R3
};

const ACTIONS = Object.keys(DEFAULT_BINDINGS) as ActionId[];

export interface AnalogState {
  /** Stick axes for direct control, -1..1 (gamepad or keyboard). */
  pitch: number;
  roll: number;
  yaw: number;
  /** Gamepad analog throttle: -1 (LT) .. +1 (RT); 0 when not used. */
  throttleAxis: number;
  /** Right stick look, -1..1. */
  lookX: number;
  lookY: number;
}

export class Input {
  /** When false, flight actions read as released (menus capture input). */
  enabled = false;
  pointerLocked = false;
  /** Cursor position relative to the viewport center, -1..1 on each axis (y up). */
  readonly cursor = { x: 0, y: 0, inside: false };
  /** Mouse motion accumulated since the last poll (CSS pixels). */
  mouseDX = 0;
  mouseDY = 0;
  readonly analog: AnalogState = { pitch: 0, roll: 0, yaw: 0, throttleAxis: 0, lookX: 0, lookY: 0 };
  gamepadConnected = false;
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';
  sensitivity = 1;
  invertPitch = false;
  deadzone = 0.12;

  private bindings = new Map<string, ActionId[]>();
  private readonly downCodes = new Set<string>();
  private readonly held = new Map<ActionId, boolean>();
  private readonly pressedEdge = new Set<ActionId>();
  private readonly prevHeld = new Map<ActionId, boolean>();
  /** Actions held when input was cleared; they stay released until the button is let go. */
  private readonly suppressed = new Set<ActionId>();
  private suppressPending = false;
  private accDX = 0;
  private accDY = 0;
  private lastUnlock = -10000;
  private readonly target: HTMLElement;
  private readonly unsub: Array<() => void> = [];
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  onGamepadChange: ((connected: boolean) => void) | null = null;

  constructor(target: HTMLElement) {
    this.target = target;
    this.setBindings({});
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      window.addEventListener(type, fn, opts);
      this.unsub.push(() => window.removeEventListener(type, fn, opts));
    };
    on('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) return; // never interfere with browser shortcuts
      const actions = this.bindings.get(e.code);
      if (this.enabled && actions) e.preventDefault();
      if (!e.repeat) this.downCodes.add(e.code);
      this.lastDevice = 'keyboard';
    });
    on('keyup', (e) => {
      this.downCodes.delete(e.code);
      if (this.enabled && this.bindings.has(e.code)) e.preventDefault();
    });
    on('blur', () => this.clear());
    on('mousedown', (e) => {
      if (!this.enabled) return;
      this.downCodes.add(`Mouse${e.button}`);
      this.lastDevice = 'keyboard';
    });
    on('mouseup', (e) => this.downCodes.delete(`Mouse${e.button}`));
    on('mousemove', (e) => {
      if (this.pointerLocked) {
        this.accDX += e.movementX;
        this.accDY += e.movementY;
      }
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.cursor.x = clamp((e.clientX / w) * 2 - 1, -1, 1);
      this.cursor.y = clamp(1 - (e.clientY / h) * 2, -1, 1);
      this.cursor.inside = true;
    });
    on('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    on('gamepadconnected', () => {
      this.gamepadConnected = true;
      this.onGamepadChange?.(true);
    });
    on('gamepaddisconnected', () => {
      this.gamepadConnected = this.anyGamepad() !== null;
      this.clear();
      this.onGamepadChange?.(this.gamepadConnected);
    });
    const docVis = () => {
      if (document.hidden) this.clear();
    };
    document.addEventListener('visibilitychange', docVis);
    this.unsub.push(() => document.removeEventListener('visibilitychange', docVis));
    const lockChange = () => {
      const locked = document.pointerLockElement === this.target;
      if (!locked && this.pointerLocked) this.lastUnlock = performance.now();
      this.pointerLocked = locked;
      this.onPointerLockChange?.(locked);
    };
    document.addEventListener('pointerlockchange', lockChange);
    this.unsub.push(() => document.removeEventListener('pointerlockchange', lockChange));
    const lockError = () => {
      this.pointerLocked = false;
    };
    document.addEventListener('pointerlockerror', lockError);
    this.unsub.push(() => document.removeEventListener('pointerlockerror', lockError));
    const noDrag = (e: Event) => e.preventDefault();
    target.addEventListener('dragstart', noDrag);
    this.unsub.push(() => target.removeEventListener('dragstart', noDrag));
  }

  setBindings(overrides: Record<string, string[]>): void {
    this.bindings.clear();
    for (const action of ACTIONS) {
      const codes = overrides[action] ?? DEFAULT_BINDINGS[action];
      for (const code of codes) {
        const list = this.bindings.get(code) ?? [];
        list.push(action);
        this.bindings.set(code, list);
      }
    }
  }

  /** Requests pointer lock, respecting the browser's re-lock cooldown after Esc (ZD-H04). */
  requestPointerLock(): void {
    if (this.pointerLocked || !this.target.requestPointerLock) return;
    if (performance.now() - this.lastUnlock < 1300) return;
    try {
      const result = this.target.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => (this.pointerLocked = false));
    } catch {
      this.pointerLocked = false;
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Clears everything (focus loss, pause, restart) so nothing sticks (ZD-H01). */
  clear(): void {
    // Gamepad buttons still held (e.g. B used to leave a menu) are ignored until released.
    this.suppressPending = true;
    this.downCodes.clear();
    this.held.clear();
    this.pressedEdge.clear();
    this.prevHeld.clear();
    this.accDX = 0;
    this.accDY = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.analog.pitch = this.analog.roll = this.analog.yaw = 0;
    this.analog.throttleAxis = this.analog.lookX = this.analog.lookY = 0;
  }

  /** Once per frame, before the simulation: resolves held/pressed state from all devices. */
  poll(): void {
    this.mouseDX = this.accDX;
    this.mouseDY = this.accDY;
    this.accDX = 0;
    this.accDY = 0;

    const pad = this.anyGamepad();
    this.gamepadConnected = pad !== null;
    for (const action of ACTIONS) this.held.set(action, false);
    if (this.enabled) {
      for (const code of this.downCodes) {
        const actions = this.bindings.get(code);
        if (actions) for (const a of actions) this.held.set(a, true);
      }
    }

    // Gamepad buttons first so button-driven actions (LB/RB yaw) feed the axes below.
    const dz = (v: number) => {
      const a = Math.abs(v);
      if (a < this.deadzone) return 0;
      const n = (a - this.deadzone) / (1 - this.deadzone);
      return Math.sign(v) * (n * n * 0.6 + n * 0.4); // soft response curve
    };
    if (pad && this.enabled) {
      for (const [action, buttons] of Object.entries(PAD_BUTTONS) as [ActionId, readonly number[]][]) {
        for (const b of buttons) {
          if (pad.buttons[b]?.pressed) {
            this.held.set(action, true);
            this.lastDevice = 'gamepad';
          }
        }
      }
    }

    // Keyboard axes
    const k = (a: ActionId) => (this.held.get(a) ? 1 : 0);
    let pitch = k('pitchUp') - k('pitchDown');
    // In direct control the turn keys act as roll; in mouse aim the session steers the aim with them.
    let roll = k('rollRight') - k('rollLeft') + k('turnRight') - k('turnLeft');
    const yaw = k('yawRight') - k('yawLeft');
    let throttleAxis = 0;
    let lookX = 0;
    let lookY = 0;

    if (pad && this.enabled) {
      const ax = pad.axes;
      const radial = Math.hypot(ax[0] ?? 0, ax[1] ?? 0);
      const scale = radial < this.deadzone ? 0 : 1;
      const lx = dz(ax[0] ?? 0) * scale;
      const ly = dz(ax[1] ?? 0) * scale;
      if (lx !== 0 || ly !== 0) this.lastDevice = 'gamepad';
      roll += lx;
      pitch += ly; // stick back (down, +y) = nose up
      lookX = dz(ax[2] ?? 0);
      lookY = -dz(ax[3] ?? 0);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      throttleAxis = rt - lt;
    }
    if (this.invertPitch) pitch = -pitch;
    this.analog.pitch = clamp(pitch, -1, 1);
    this.analog.roll = clamp(roll, -1, 1);
    this.analog.yaw = clamp(yaw, -1, 1);
    this.analog.throttleAxis = clamp(throttleAxis, -1, 1);
    this.analog.lookX = lookX;
    this.analog.lookY = lookY;

    if (this.suppressPending) {
      this.suppressPending = false;
      this.suppressed.clear();
      for (const action of ACTIONS) if (this.held.get(action)) this.suppressed.add(action);
    }
    for (const action of this.suppressed) {
      if (this.held.get(action)) this.held.set(action, false);
      else this.suppressed.delete(action);
    }
    this.pressedEdge.clear();
    for (const action of ACTIONS) {
      const now = this.held.get(action) ?? false;
      if (now && !(this.prevHeld.get(action) ?? false)) this.pressedEdge.add(action);
      this.prevHeld.set(action, now);
    }
  }

  isHeld(action: ActionId): boolean {
    return this.held.get(action) ?? false;
  }

  /** True on the frame the action went down. */
  wasPressed(action: ActionId): boolean {
    return this.pressedEdge.has(action);
  }

  /** Consumes a press so a menu click can't also fire in game (ZD-H10). */
  consume(action: ActionId): void {
    this.pressedEdge.delete(action);
  }

  anyGamepad(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Human-readable label for the first binding of an action on the active device. */
  label(action: ActionId): string {
    if (this.lastDevice === 'gamepad') {
      const b = PAD_BUTTONS[action]?.[0];
      const names = [
        'A',
        'B',
        'X',
        'Y',
        'LB',
        'RB',
        'LT',
        'RT',
        'View',
        'Start',
        'L3',
        'R3',
        'D-pad up',
        'D-pad down',
        'D-pad left',
        'D-pad right',
      ];
      if (b !== undefined) return names[b] ?? `Button ${b}`;
    }
    const code = [...this.bindings.entries()].find(([, a]) => a.includes(action))?.[0] ?? '';
    return codeLabel(code);
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.exitPointerLock();
  }
}

export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: 'Left mouse',
    Mouse1: 'Middle mouse',
    Mouse2: 'Right mouse',
    ShiftLeft: 'Shift',
    ShiftRight: 'Right Shift',
    Space: 'Space',
    Tab: 'Tab',
    Escape: 'Esc',
    Enter: 'Enter',
  };
  return map[code] ?? code;
}

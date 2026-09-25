/** Internal UI types shared by the UI modules (the public contract lives in src/core/types.ts). */

/** UI sound cues. The game maps these onto the audio system's SfxIds. */
export type UiSoundId = 'uiHover' | 'uiConfirm' | 'uiBack' | 'uiToggle' | 'uiError';

/** Abstract navigation intents produced by the keyboard, gamepad and on-screen hints. */
export type NavAction =
  'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tabPrev' | 'tabNext' | 'start';

/** Last device the player used, for choosing key or button glyphs. */
export type InputDevice = 'keyboard' | 'gamepad';

export type ToastKind = 'info' | 'warn' | 'success';

export type Medal = 'none' | 'bronze' | 'silver' | 'gold';

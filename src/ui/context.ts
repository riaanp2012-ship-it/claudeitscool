import type { UiLayout } from './layout-math';
import type { UiSoundId } from './ui-types';

/** Services every screen gets from the UI root. */
export interface UiContext {
  readonly root: HTMLElement;
  sound(id: UiSoundId): void;
  layout(): UiLayout;
  hideTooltip(): void;
  toast(text: string, kind?: 'info' | 'warn' | 'success'): void;
  /** Build/version tag shown on the title and menus. */
  readonly build: string;
}

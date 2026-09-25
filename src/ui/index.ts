/**
 * SPLASH ONE menus (spec §8): plain TypeScript + DOM (decision D2). `createUi` mounts one root over the
 * game canvas; every screen is translucent so the live 3D scene stays visible behind it.
 */
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/screens.css';

import { settings } from '../core/settings';
import type {
  AircraftId,
  AircraftSummary,
  DebriefData,
  FreeFlightOptions,
  InstantActionOptions,
  LessonSummary,
  MainMenuHandlers,
  MapSummary,
  MissionSummary,
  PauseHandlers,
  PilotProfileView,
  Ui,
} from '../core/types';
import { MAPS } from '../data/maps';
import { BUILD_VERSION } from './build-info';
import type { UiContext } from './context';
import { el } from './dom';
import { loadFonts } from './fonts';
import { MenuInput } from './input';
import { computeLayout, type UiLayout } from './layout-math';
import { ToastView, TooltipView } from './overlay-views';
import type { Screen } from './screen';
import { DebriefScreen, FatalScreen, PauseScreen, ResumeOverlay } from './screens/flow';
import { HangarScreen } from './screens/hangar';
import { BriefingScreen, CreditsScreen, LoadingScreen } from './screens/info';
import { CampaignScreen, TrainingScreen } from './screens/lists';
import { MainMenuScreen } from './screens/main-menu';
import { SettingsScreen } from './screens/settings';
import { FreeFlightScreen, InstantActionScreen } from './screens/setup';
import { TitleScreen } from './screens/title';
import type { SettingsSection } from './settings-fields';
import type { InputDevice, ToastKind, UiSoundId } from './ui-types';

export { loadFonts } from './fonts';
export type { UiSoundId } from './ui-types';

const SCREEN_FADE_MS = 260;
const HOVER_SOUND_GAP_MS = 45;

export class UiImpl implements Ui {
  readonly root: HTMLElement;
  /** Wire to the audio system: every hover, confirm, back, toggle and error cue goes through here. */
  onSound?: (id: UiSoundId) => void;

  private readonly screens: HTMLElement;
  private readonly overlays: HTMLElement;
  private readonly tooltip: TooltipView;
  private readonly toasts: ToastView;
  private readonly input: MenuInput;
  private readonly ctx: UiContext;
  private current: Screen | null = null;
  private resume: ResumeOverlay | null = null;
  private layoutState: UiLayout;
  private lastHover = -Infinity;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly container: HTMLElement) {
    this.root = el('div', 's1-ui');
    this.root.dataset.device = 'keyboard';
    this.root.setAttribute('lang', 'en');
    this.screens = el('div', 's1-layer s1-layer--screens');
    this.overlays = el('div', 's1-layer s1-layer--overlays');
    this.toasts = new ToastView();
    this.tooltip = new TooltipView(this.root, () => this.layoutState.zoom);
    this.root.append(this.screens, this.overlays, this.toasts.el, this.tooltip.el);
    container.appendChild(this.root);

    this.layoutState = computeLayout(1920, 1080, 1);
    this.ctx = {
      root: this.root,
      build: BUILD_VERSION,
      sound: (id) => this.sound(id),
      layout: () => this.layoutState,
      hideTooltip: () => this.tooltip.hide(),
      toast: (text, kind) => this.toast(text, kind),
    };
    this.applyLayout();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.applyLayout());
      ro.observe(container);
      this.cleanups.push(() => ro.disconnect());
    } else {
      const onResize = (): void => this.applyLayout();
      window.addEventListener('resize', onResize);
      this.cleanups.push(() => window.removeEventListener('resize', onResize));
    }
    let scale = settings.value.accessibility.uiScale;
    this.cleanups.push(
      settings.onChange((s) => {
        if (s.accessibility.uiScale !== scale) {
          scale = s.accessibility.uiScale;
          this.applyLayout();
        }
      }),
    );

    this.input = new MenuInput({
      active: () => this.capturingInput,
      any: () => this.top()?.anyInput() ?? false,
      action: (a) => this.top()?.handle(a) ?? false,
      device: (d) => this.setDevice(d),
    });
    const onPointer = (): void => this.setDevice('keyboard');
    this.root.addEventListener('pointermove', onPointer, { passive: true });
    this.cleanups.push(() => this.root.removeEventListener('pointermove', onPointer));
    // Space and Enter activate focused buttons on keyup; menus act on keydown only.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (this.capturingInput && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) {
        e.preventDefault();
      }
    };
    window.addEventListener('keyup', onKeyUp, { capture: true });
    this.cleanups.push(() => window.removeEventListener('keyup', onKeyUp, { capture: true }));

    // Never show fallback fonts (ZD-J06): the root stays transparent until the typefaces are ready.
    void loadFonts().then(() => this.root.classList.add('is-ready'));
  }

  get capturingInput(): boolean {
    return this.current !== null || this.resume !== null;
  }

  showTitle(onContinue: () => void): void {
    this.show(new TitleScreen(this.ctx, onContinue));
  }

  showMainMenu(profile: PilotProfileView, handlers: MainMenuHandlers): void {
    this.show(new MainMenuScreen(this.ctx, profile, handlers));
  }

  showInstantAction(
    defaults: InstantActionOptions,
    maps: readonly MapSummary[],
    aircraft: readonly AircraftSummary[],
    onStart: (o: InstantActionOptions) => void,
    onBack: () => void,
  ): void {
    this.show(new InstantActionScreen(this.ctx, defaults, maps, aircraft, onStart, onBack));
  }

  showFreeFlight(
    defaults: FreeFlightOptions,
    maps: readonly MapSummary[],
    aircraft: readonly AircraftSummary[],
    onStart: (o: FreeFlightOptions) => void,
    onBack: () => void,
  ): void {
    this.show(new FreeFlightScreen(this.ctx, defaults, maps, aircraft, onStart, onBack));
  }

  showTraining(lessons: readonly LessonSummary[], onStart: (id: string) => void, onBack: () => void): void {
    this.show(new TrainingScreen(this.ctx, lessons, onStart, onBack));
  }

  showCampaign(missions: readonly MissionSummary[], onStart: (id: string) => void, onBack: () => void): void {
    this.show(new CampaignScreen(this.ctx, missions, Object.values(MAPS), onStart, onBack));
  }

  showHangar(
    aircraft: readonly AircraftSummary[],
    selected: AircraftId,
    onSelect: (id: AircraftId) => void,
    onBack: () => void,
  ): void {
    this.show(new HangarScreen(this.ctx, aircraft, selected, onSelect, onBack));
  }

  /** `section` picks the opening tab (the game always opens Graphics; tools may open another). */
  showSettings(onBack: () => void, section: SettingsSection = 'graphics'): void {
    this.show(new SettingsScreen(this.ctx, onBack, section));
  }

  showCredits(onBack: () => void): void {
    this.show(new CreditsScreen(this.ctx, onBack));
  }

  showBriefing(
    title: string,
    map: MapSummary,
    text: string,
    objectives: readonly string[],
    onBegin: () => void,
    onBack: () => void,
  ): void {
    this.show(new BriefingScreen(this.ctx, title, map, text, objectives, onBegin, onBack));
  }

  showLoading(title: string, subtitle: string): void {
    this.show(new LoadingScreen(this.ctx, title, subtitle));
  }

  setLoadingProgress(fraction: number, label: string): void {
    if (this.current instanceof LoadingScreen && !this.current.disposed)
      this.current.setProgress(fraction, label);
  }

  showGame(): void {
    this.tooltip.hide();
    if (this.current) this.retire(this.current);
    this.current = null;
    this.releaseFocus();
    this.input.sync();
  }

  showPause(handlers: PauseHandlers): void {
    // A second request while paused only refreshes the handlers: the menu never stacks (ZD-J15).
    if (this.current instanceof PauseScreen && !this.current.disposed) {
      this.current.setHandlers(handlers);
      return;
    }
    this.show(new PauseScreen(this.ctx, handlers));
  }

  showDebrief(data: DebriefData, onRetry: () => void, onContinue: () => void): void {
    this.show(new DebriefScreen(this.ctx, data, onRetry, onContinue));
  }

  showClickToResume(onResume: () => void): void {
    if (this.resume && !this.resume.disposed) {
      this.resume.rearm();
      return;
    }
    const overlay = new ResumeOverlay(this.ctx, () => onResume());
    this.resume = overlay;
    this.mount(overlay, this.overlays);
    this.input.sync();
  }

  hideClickToResume(): void {
    if (!this.resume) return;
    this.retire(this.resume);
    this.resume = null;
    if (!this.current) this.releaseFocus();
    this.input.sync();
  }

  showFatal(title: string, message: string): void {
    this.hideClickToResume();
    this.show(new FatalScreen(this.ctx, title, message));
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.toasts.push(text, kind);
  }

  /** Removes the UI and all listeners. */
  dispose(): void {
    if (this.current) this.current.dispose();
    this.resume?.dispose();
    this.current = null;
    this.resume = null;
    this.input.dispose();
    this.tooltip.dispose();
    this.toasts.clear();
    for (const c of this.cleanups) c();
    this.root.remove();
  }

  private top(): Screen | null {
    return this.resume ?? this.current;
  }

  private show(next: Screen): void {
    this.tooltip.hide();
    if (this.resume) this.hideClickToResume();
    if (this.current) this.retire(this.current);
    this.current = next;
    this.mount(next, this.screens);
    this.input.sync();
  }

  private mount(screen: Screen, layer: HTMLElement): void {
    layer.appendChild(screen.el);
    screen.mounted();
    // Commit the start state, then fade in (cross-fade with the outgoing screen).
    void screen.el.offsetWidth;
    screen.el.classList.add('is-in');
  }

  private retire(screen: Screen): void {
    screen.dispose();
    screen.el.classList.remove('is-in');
    screen.el.classList.add('is-out');
    window.setTimeout(() => screen.el.remove(), SCREEN_FADE_MS);
  }

  private releaseFocus(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  private setDevice(d: InputDevice): void {
    if (this.root.dataset.device !== d) this.root.dataset.device = d;
  }

  private sound(id: UiSoundId): void {
    if (id === 'uiHover') {
      const now = performance.now();
      if (now - this.lastHover < HOVER_SOUND_GAP_MS) return;
      this.lastHover = now;
    }
    this.onSound?.(id);
  }

  private applyLayout(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const L = computeLayout(w, h, settings.value.accessibility.uiScale);
    this.layoutState = L;
    const s = this.root.style;
    s.setProperty('--s1-zoom', String(L.zoom));
    s.setProperty('--s1-frame-w', `${L.frameWidth.toFixed(2)}px`);
    s.setProperty('--s1-frame-left', `${L.frameLeft.toFixed(2)}px`);
    this.root.toggleAttribute('data-compact', L.compact);
    this.root.toggleAttribute('data-short', L.short);
    this.root.toggleAttribute('data-narrow', L.narrow);
    this.current?.relayout();
    this.resume?.relayout();
  }
}

export function createUi(container: HTMLElement): UiImpl {
  return new UiImpl(container);
}

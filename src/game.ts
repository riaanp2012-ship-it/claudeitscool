import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { profile, type Medal } from './core/profile';
import { rng, timeSeed } from './core/rng';
import { settings, type Settings } from './core/settings';
import type {
  AircraftId,
  AircraftModelFactory,
  AircraftSummary,
  AudioSystem,
  DebriefData,
  FreeFlightOptions,
  Fx,
  Hud,
  InstantActionOptions,
  LessonSummary,
  MapId,
  MapSummary,
  OrdnanceModelFactory,
  Ui,
  World,
  WorldFactory,
} from './core/types';
import { AIRCRAFT, AIRCRAFT_IDS } from './data/aircraft';
import { MAP_IDS, MAPS } from './data/maps';
import { Input } from './input/input';
import { FreeFlightRules } from './modes/freeFlight';
import { InstantActionRules } from './modes/instantAction';
import { LESSONS, LessonRules, lessonById } from './modes/training';
import { Session, type ModeRules } from './modes/session';
import { HangarScene, type HangarFraming } from './render/hangar';
import { AdaptiveResolution, FrameStats, PerfOverlay } from './render/perf';
import { DEFAULT_PIPELINE_OPTIONS, Pipeline } from './render/pipeline';

/**
 * Game shell (spec §4.3): boot → title → menus → loading → in game ⇄ pause → debrief → menus.
 * Worker modules (world, art, fx, audio, HUD, UI) are injected so this file only depends on contracts.
 */
export interface GameModules {
  createWorld: WorldFactory;
  isMapAvailable(id: MapId): boolean;
  createAircraftModel: AircraftModelFactory;
  createOrdnanceModel: OrdnanceModelFactory;
  isAircraftAvailable?(id: AircraftId): boolean;
  createFx(): Fx;
  createAudio(): AudioSystem;
  createHud(): Hud;
  createUi(container: HTMLElement): Ui;
  loadFonts(): Promise<void>;
}

type GameState = 'boot' | 'title' | 'menu' | 'loading' | 'game' | 'paused' | 'debrief';

type SessionRequest =
  | { kind: 'instant'; options: InstantActionOptions }
  | { kind: 'free'; options: FreeFlightOptions }
  | { kind: 'lesson'; id: string; options: { map: MapId; aircraft: AircraftId } };

export class Game {
  readonly container: HTMLElement;
  readonly modules: GameModules;
  state: GameState = 'boot';
  pipeline!: Pipeline;
  ui!: Ui;
  hud!: Hud;
  audio!: AudioSystem;
  fx!: Fx;
  input!: Input;
  hangar!: HangarScene;
  session: Session | null = null;
  world: World | null = null;
  private lastRequest: SessionRequest | null = null;
  private readonly stats = new FrameStats();
  private readonly adaptive = new AdaptiveResolution();
  private perf!: PerfOverlay;
  private last = performance.now();
  private endTimer = -1;
  private instantDefaults: InstantActionOptions = {
    map: 'kessel',
    aircraft: 'kestrel',
    enemies: 4,
    allies: 1,
    skill: 'veteran',
    weapons: 'standard',
    respawn: false,
    timeLimit: 0,
    scoreLimit: 0,
  };
  private freeDefaults: FreeFlightOptions = {
    map: 'kessel',
    aircraft: 'kestrel',
    start: 'air',
    drones: false,
    rings: true,
  };
  private hangarAircraft: AircraftId = 'kestrel';
  private lockAcquired = false;
  private readonly menuScene = new Scene();
  private readonly menuCamera = new PerspectiveCamera();

  constructor(container: HTMLElement, modules: GameModules) {
    this.container = container;
    this.modules = modules;
  }

  async boot(): Promise<void> {
    const c = this.container;
    c.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#0a0c0d;user-select:none;';
    if (!hasWebGL2()) {
      await this.modules.loadFonts().catch(() => undefined);
      this.ui = this.modules.createUi(c);
      this.ui.showFatal(
        'WebGL 2 is not available',
        'SPLASH ONE needs a browser with WebGL 2 and hardware acceleration enabled. Update your browser or turn on hardware acceleration in its settings, then reload this page.',
      );
      return;
    }
    await this.modules.loadFonts().catch(() => undefined);
    const g = settings.value.graphics;
    this.pipeline = new Pipeline(c, this.menuScene, this.menuCamera, {
      ...DEFAULT_PIPELINE_OPTIONS,
      renderScale: g.renderScale,
      smaa: g.antialias,
      bloom: g.bloom,
      maxPixelRatio: g.preset === 'low' ? 1 : g.preset === 'medium' ? 1.25 : g.preset === 'ultra' ? 2 : 1.5,
      msaa: g.preset === 'high' || g.preset === 'ultra' ? 4 : 0,
    });
    const renderer = this.pipeline.renderer;
    renderer.info.autoReset = false;
    const canvas = this.pipeline.canvas;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    this.hud = this.modules.createHud();
    c.appendChild(this.hud.canvas);
    this.hud.canvas.style.position = 'absolute';
    this.hud.canvas.style.inset = '0';
    this.hud.canvas.style.pointerEvents = 'none';
    const uiRoot = document.createElement('div');
    uiRoot.style.cssText = 'position:absolute;inset:0;';
    c.appendChild(uiRoot);
    this.ui = this.modules.createUi(uiRoot);
    this.audio = this.modules.createAudio();
    this.fx = this.modules.createFx();
    this.input = new Input(canvas);
    this.perf = new PerfOverlay(c);
    const soundHook = this.ui as unknown as {
      onSound?: (id: 'uiHover' | 'uiConfirm' | 'uiBack' | 'uiToggle' | 'uiError') => void;
    };
    soundHook.onSound = (id) => this.audio.play(id);
    this.hangar = new HangarScene(renderer, this.modules.createAircraftModel);
    this.hangarAircraft = profile.data.lastAircraft in AIRCRAFT ? profile.data.lastAircraft : 'kestrel';
    this.hangar.setAircraft(this.hangarAircraft);
    this.applySettings(settings.value);
    settings.onChange((s) => this.applySettings(s));

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('keydown', (e) => this.onKey(e));
    canvas.addEventListener('click', () => {
      if (this.state === 'game') this.input.requestPointerLock();
    });
    this.input.onPointerLockChange = (locked) => {
      if (locked) this.lockAcquired = true;
      else if (this.state === 'game' && this.lockAcquired) this.pause();
    };
    this.input.onGamepadChange = (connected) => {
      if (!connected && this.state === 'game') this.pause();
    };
    window.addEventListener('pagehide', () => profile.save());
    this.resize();
    this.installDebugApi();

    this.pipeline.setScene(this.hangar.scene, this.hangar.camera);
    renderer.setAnimationLoop((now: number) => this.frame(now));
    this.showTitle();
    // Autostart for tests/benchmarks: ?autostart=instant|free&map=...&aircraft=...
    const params = new URLSearchParams(window.location.search);
    const auto = params.get('autostart');
    if (auto) void this.autostart(auto, params);
  }

  // ───────────────────────────────────────── Screens

  private showTitle(): void {
    this.state = 'title';
    this.hangar.setFraming('title');
    this.ui.showTitle(() => {
      void this.audio.unlock().then(() => this.audio.setMenuMusic(true));
      this.showMenu();
    });
  }

  showMenu(): void {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.hangar.setFraming('menu');
    this.pipeline.setScene(this.hangar.scene, this.hangar.camera);
    this.audio.setMenuMusic(true);
    this.ui.showMainMenu(profile.view(), {
      onCampaign: () => this.showCampaign(),
      onInstantAction: () => this.showInstantAction(),
      onFreeFlight: () => this.showFreeFlight(),
      onTraining: () => this.showTraining(),
      onHangar: () => this.showHangarScreen(),
      onSettings: () => {
        this.hangar.setFraming('setup');
        this.ui.showSettings(() => this.showMenu());
      },
      onCredits: () => this.ui.showCredits(() => this.showMenu()),
    });
  }

  private mapSummaries(): MapSummary[] {
    return MAP_IDS.map((id) => {
      const m = MAPS[id];
      return {
        id,
        name: m.name,
        region: m.region,
        timeOfDay: m.timeOfDay,
        weather: m.weather,
        description: m.description,
        available: this.modules.isMapAvailable(id),
      };
    });
  }

  private aircraftSummaries(): AircraftSummary[] {
    const rank = profile.rank;
    return AIRCRAFT_IDS.filter((id) => this.modules.isAircraftAvailable?.(id) ?? true).map((id) => {
      const a = AIRCRAFT[id];
      return {
        id,
        name: a.name,
        role: a.role,
        description: a.description,
        unlocked: rank >= a.unlockRank || import.meta.env.MODE === 'test',
        unlockRank: a.unlockRank,
        stats: {
          topSpeedMach: a.stats.topSpeedMach,
          thrustToWeight: a.stats.thrustToWeight,
          gLimit: a.gLimit,
          rollRateDeg: a.stats.rollRateDeg,
          hardpoints: a.hardpoints.length,
          gun: a.gun === 'gun25' ? '25 mm rotary' : '30 mm revolver',
        },
      };
    });
  }

  private showInstantAction(): void {
    this.hangar.setFraming('setup');
    this.instantDefaults.aircraft = this.hangarAircraft;
    this.ui.showInstantAction(
      this.instantDefaults,
      this.mapSummaries(),
      this.aircraftSummaries(),
      (o) => {
        this.instantDefaults = { ...o };
        void this.startSession({ kind: 'instant', options: o });
      },
      () => this.showMenu(),
    );
  }

  private showFreeFlight(): void {
    this.hangar.setFraming('setup');
    this.freeDefaults.aircraft = this.hangarAircraft;
    this.ui.showFreeFlight(
      this.freeDefaults,
      this.mapSummaries(),
      this.aircraftSummaries(),
      (o) => {
        this.freeDefaults = { ...o };
        void this.startSession({ kind: 'free', options: o });
      },
      () => this.showMenu(),
    );
  }

  private showTraining(): void {
    this.hangar.setFraming('setup');
    const lessons: LessonSummary[] = [];
    const titles: Record<number, [string, string]> = {
      3: ['Takeoff and Landing', 'Runway takeoff, circuit, glide slope approach and a full-stop landing.'],
      8: [
        'Ground Attack',
        'Rockets with the CCIP pipper, laser-guided bombs and staying out of SAM coverage.',
      ],
    };
    for (let n = 1; n <= 8; n++) {
      const def = LESSONS.find((l) => l.number === n);
      if (def) {
        const rec = profile.data.lessons[def.id];
        lessons.push({
          id: def.id,
          number: n,
          title: def.title,
          description: def.description,
          available: true,
          medal: rec?.medal ?? 'none',
          bestTime: rec && rec.bestTime > 0 ? rec.bestTime : null,
        });
      } else {
        const [title, description] = titles[n] ?? ['Lesson', ''];
        lessons.push({
          id: `lesson-${n}`,
          number: n,
          title,
          description,
          available: false,
          medal: 'none',
          bestTime: null,
        });
      }
    }
    this.ui.showTraining(
      lessons,
      (id) => {
        const def = lessonById(id);
        if (def)
          void this.startSession({ kind: 'lesson', id, options: { map: 'kessel', aircraft: def.aircraft } });
      },
      () => this.showMenu(),
    );
  }

  private showCampaign(): void {
    this.hangar.setFraming('setup');
    this.ui.showCampaign(
      [],
      () => undefined,
      () => this.showMenu(),
    );
  }

  private showHangarScreen(): void {
    this.hangar.setFraming('hangar');
    this.ui.showHangar(
      this.aircraftSummaries(),
      this.hangarAircraft,
      (id) => {
        this.hangarAircraft = id;
        this.hangar.setAircraft(id);
        profile.data.lastAircraft = id;
        profile.save();
      },
      () => this.showMenu(),
    );
  }

  // ───────────────────────────────────────── Sessions

  private async startSession(req: SessionRequest): Promise<void> {
    this.lastRequest = req;
    this.teardownSession();
    const map = req.options.map;
    const meta = MAPS[map];
    this.state = 'loading';
    this.audio.setMenuMusic(false);
    const lesson = req.kind === 'lesson' ? lessonById(req.id) : undefined;
    this.ui.showLoading(
      meta.name.toUpperCase(),
      req.kind === 'instant'
        ? 'Instant Action'
        : req.kind === 'free'
          ? 'Free Flight'
          : `Training · ${lesson?.title ?? ''}`,
    );
    const g = settings.value.graphics;
    try {
      this.world = await this.modules.createWorld(
        this.pipeline.renderer,
        {
          map,
          quality: {
            terrain: g.terrain,
            clouds: g.clouds,
            water: g.terrain,
            vegetation: g.vegetation,
          },
        },
        (fraction, label) => this.ui.setLoadingProgress(fraction * 0.85, label),
      );
    } catch (err) {
      this.ui.toast(err instanceof Error ? err.message : 'The map could not be loaded.', 'warn');
      this.showMenu();
      return;
    }
    const aircraftAvailable = (id: AircraftId) => this.modules.isAircraftAvailable?.(id) ?? true;
    const rules: ModeRules =
      req.kind === 'instant'
        ? new InstantActionRules(req.options, meta.name, aircraftAvailable)
        : req.kind === 'lesson' && lesson
          ? new LessonRules(lesson, meta.name)
          : new FreeFlightRules(req.kind === 'free' ? req.options : { ...this.freeDefaults, map }, meta.name);
    this.ui.setLoadingProgress(0.88, 'Briefing aircrew');
    const seed = timeSeed();
    rng.seed(seed);
    const session = new Session(
      {
        renderer: this.pipeline.renderer,
        world: this.world,
        fx: this.fx,
        audio: this.audio,
        hud: this.hud,
        input: this.input,
        models: this.modules.createAircraftModel,
        ordnance: this.modules.createOrdnanceModel,
      },
      rules,
      { aircraft: req.options.aircraft, seed, unlimitedFuel: req.kind !== 'instant' },
    );
    this.session = session;
    this.resize();
    // Warm up every shader so the first explosion or missile never hitches (ZD-C02).
    this.ui.setLoadingProgress(0.92, 'Compiling shaders');
    await this.pipeline.renderer.compileAsync(session.scene, session.camera).catch(() => undefined);
    await this.fx.warmup(this.pipeline.renderer, session.camera).catch(() => undefined);
    this.ui.setLoadingProgress(1, 'Ready');
    session.update(0);
    this.pipeline.setScene(session.scene, session.camera);
    this.pipeline.render(0);
    this.ui.showGame();
    this.state = 'game';
    this.input.enabled = true;
    this.input.clear();
    this.endTimer = -1;
    this.lockAcquired = false;
    this.input.requestPointerLock();
    profile.data.stats.sorties++;
    window.__SPLASH_READY__ = true;
  }

  private teardownSession(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    this.fx.clear();
    this.audio.stopAll();
    this.hud.clear();
  }

  pause(): void {
    if (this.state !== 'game' || !this.session) return;
    this.state = 'paused';
    this.session.setPaused(true);
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.ui.showPause({
      onResume: () => this.resume(),
      onRestart: () => {
        if (this.lastRequest) void this.startSession(this.lastRequest);
      },
      onSettings: () =>
        this.ui.showSettings(() => {
          if (this.state === 'paused') this.pause2();
        }),
      onQuit: () => {
        this.recordFlightTime();
        this.teardownSession();
        this.showMenu();
      },
    });
  }

  /** Re-shows the pause menu after the settings screen. */
  private pause2(): void {
    this.state = 'game';
    this.pause();
  }

  private resume(): void {
    if (this.state !== 'paused' || !this.session) return;
    this.state = 'game';
    this.ui.showGame();
    this.session.setPaused(false);
    this.input.enabled = true;
    this.input.clear();
    this.input.requestPointerLock();
  }

  private recordFlightTime(): void {
    if (!this.session) return;
    profile.data.stats.flightSeconds += Math.round(this.session.time);
    profile.save();
  }

  private finishSession(): void {
    const s = this.session;
    if (!s?.result) return;
    const r = s.result;
    const before = profile.view();
    const st = s.stats;
    const p = s.player;
    profile.data.stats.kills += st.kills;
    profile.data.stats.deaths += st.deaths;
    profile.data.stats.flightSeconds += Math.round(s.time);
    profile.data.stats.shotsFired += p?.shotsFired ?? 0;
    profile.data.stats.shotsHit += p?.shotsHit ?? 0;
    profile.addXp(r.xp);
    if (s.rules instanceof LessonRules && r.outcome === 'success')
      profile.recordLesson(s.rules.def.id, r.medal, s.time);
    profile.save();
    const after = profile.view();
    const unlocks = AIRCRAFT_IDS.filter(
      (id) => AIRCRAFT[id].unlockRank > before.rank && AIRCRAFT[id].unlockRank <= after.rank,
    ).map((id) => AIRCRAFT[id].name);
    const accuracy = p && p.shotsFired > 0 ? Math.round((p.shotsHit / p.shotsFired) * 100) : 0;
    const data: DebriefData = {
      outcome: r.outcome,
      title: r.title,
      subtitle: `${s.rules.title} · ${s.rules.subtitle}`,
      time: s.time,
      stats: [
        { label: 'Kills', value: String(st.kills) },
        { label: 'Assists', value: String(st.assists) },
        { label: 'Losses', value: String(st.deaths) },
        { label: 'Gun accuracy', value: `${accuracy}%` },
        { label: 'Missiles fired', value: String(st.missiles) },
        ...r.stats,
      ],
      timeline: s.timeline.slice(-12),
      xpGained: r.xp,
      medal: r.medal as Medal,
      profileBefore: before,
      profileAfter: after,
      unlocks,
    };
    this.state = 'debrief';
    this.input.enabled = false;
    this.input.exitPointerLock();
    s.setPaused(true);
    this.audio.play(r.outcome === 'success' ? 'medal' : 'uiBack');
    this.ui.showDebrief(
      data,
      () => {
        if (this.lastRequest) void this.startSession(this.lastRequest);
      },
      () => {
        this.teardownSession();
        this.showMenu();
      },
    );
  }

  // ───────────────────────────────────────── Frame loop

  private frame(now: number): void {
    const t0 = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const renderer = this.pipeline.renderer;
    renderer.info.reset();
    this.input.poll();
    if (this.state === 'game' && this.input.wasPressed('pause')) this.pause();
    if (this.input.wasPressed('perf')) this.perf.toggle();

    const s = this.session;
    if (s && (this.state === 'game' || this.state === 'paused' || this.state === 'debrief')) {
      s.update(this.state === 'game' ? dt : 0);
      if (s.result && this.state === 'game') {
        if (this.endTimer < 0) this.endTimer = 2.8;
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.finishSession();
      }
      this.pipeline.render(dt);
      this.hud.draw(s.hudState, dt);
    } else if (this.state !== 'loading') {
      this.hangar.update(dt);
      this.pipeline.render(dt);
    }
    const cpu = performance.now() - t0;
    this.stats.push(dt * 1000, cpu);
    if (
      this.adaptive.update(
        dt,
        this.stats.percentile(95),
        settings.value.graphics.adaptive && this.state === 'game',
      )
    ) {
      this.pipeline.setOptions({ renderScale: settings.value.graphics.renderScale * this.adaptive.scale });
      this.resize();
    }
    this.perf.update(
      dt,
      this.stats,
      renderer,
      `scale    ${this.pipeline.pixelRatio.toFixed(2)}\nstate    ${this.state}\n`,
    );
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pipeline.resize(w, h);
    this.hangar.resize(w / h);
    if (this.session) {
      this.session.camera.aspect = w / h;
      this.session.camera.updateProjectionMatrix();
    }
    this.hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  private onVisibility(): void {
    const hidden = document.hidden;
    if (hidden) {
      if (this.state === 'game') this.pause();
      if (settings.value.audio.muteUnfocused) this.audio.setMuted(true);
    } else {
      this.audio.setMuted(false);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' && this.state === 'game') {
      e.preventDefault();
      this.pause();
    }
  }

  private onContextLost(): void {
    if (this.state === 'game') this.pause();
    this.ui.showFatal(
      'The graphics device was reset',
      'Your browser lost the WebGL context (a driver reset or too many open tabs). The game will reload when it recovers; if it does not, reload this page.',
    );
  }

  private applySettings(s: Settings): void {
    const g = s.graphics;
    this.pipeline.setOptions({
      renderScale: g.renderScale * this.adaptive.scale,
      smaa: g.antialias,
      bloom: g.bloom,
      maxPixelRatio: g.preset === 'low' ? 1 : g.preset === 'medium' ? 1.25 : g.preset === 'ultra' ? 2 : 1.5,
      msaa: g.preset === 'high' || g.preset === 'ultra' ? 4 : 0,
    });
    this.hud.setColor(s.gameplay.hudColor);
    this.hud.setScale(s.accessibility.uiScale);
    this.hud.setColorblind(s.accessibility.colorblind);
    this.audio.setVolumes(s.audio);
    this.input.sensitivity = s.controls.sensitivity;
    this.input.invertPitch = s.controls.invertPitch;
    this.input.deadzone = s.controls.deadzone;
    this.input.setBindings(s.controls.bindings);
    this.fx.setQuality(g.effects, s.accessibility.reduceFlashes);
    this.perf?.toggle(g.showFps || this.perf.visible);
    this.resize();
  }

  // ───────────────────────────────────────── Tests and tooling

  private async autostart(kind: string, params: URLSearchParams): Promise<void> {
    await this.audio.unlock().catch(() => undefined);
    const map = (params.get('map') as MapId | null) ?? 'kessel';
    const aircraft = (params.get('aircraft') as AircraftId | null) ?? 'kestrel';
    if (kind === 'instant') {
      await this.startSession({
        kind: 'instant',
        options: {
          ...this.instantDefaults,
          map,
          aircraft,
          enemies: Number(params.get('enemies') ?? 4),
          allies: Number(params.get('allies') ?? 1),
        },
      });
    } else {
      await this.startSession({ kind: 'free', options: { ...this.freeDefaults, map, aircraft } });
    }
  }

  private installDebugApi(): void {
    if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return;
    const api = {
      state: () => ({
        state: this.state,
        aircraft: this.session?.sim.aircraft.length ?? 0,
        alive: this.session?.sim.aircraft.filter((a) => a.alive).length ?? 0,
        kills: this.session?.sim.kills.length ?? 0,
        time: this.session?.time ?? 0,
        player: this.session?.player
          ? {
              alive: this.session.player.alive,
              altitude: this.session.player.body.position.y,
              speed: this.session.player.body.airspeed,
            }
          : null,
      }),
      perf: () => ({
        avgFrameMs: this.stats.average(),
        p95FrameMs: this.stats.percentile(95),
        avgCpuMs: this.stats.average('cpu'),
        p95CpuMs: this.stats.percentile(95, 'cpu'),
        maxCpuMs: this.stats.max('cpu'),
        calls: this.pipeline.renderer.info.render.calls,
        triangles: this.pipeline.renderer.info.render.triangles,
        geometries: this.pipeline.renderer.info.memory.geometries,
        textures: this.pipeline.renderer.info.memory.textures,
      }),
      resetPerf: () => this.stats.reset(),
      start: (kind: 'instant' | 'free', opts: Record<string, string>) =>
        this.autostart(kind, new URLSearchParams(opts)),
      menu: () => {
        this.teardownSession();
        this.showMenu();
      },
      pause: () => this.pause(),
      resume: () => this.resume(),
      timeScale: (n: number) => {
        if (this.session) this.session.timeScale = n;
      },
      /** Hands the player to an AI pilot so tests and benchmarks can fly unattended. */
      autopilot: async () => {
        const s = this.session;
        if (!s?.player) return;
        const { AiPilot } = await import('./ai/pilot');
        const pilot = new AiPilot(s.player, 'ace', 99);
        s.sim.pilots.set(s.player, pilot);
      },
      screenshotCamera: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
        const cam = this.session?.camera;
        if (!cam) return;
        cam.position.set(x, y, z);
        cam.lookAt(new Vector3(tx, ty, tz));
      },
    };
    (window as unknown as { __SPLASH__: typeof api }).__SPLASH__ = api;
  }
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export type { HangarFraming };

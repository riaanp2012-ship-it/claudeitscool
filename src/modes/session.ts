import { Color, PerspectiveCamera, Scene, Vector3, type Object3D, type WebGLRenderer } from 'three';
import { AiPilot, type AiSkill } from '../ai/pilot';
import { Aircraft, type LoadoutRule } from '../aircraft/aircraft';
import { CameraRig } from '../camera/rig';
import type { KillEvent, Targetable } from '../combat/targetable';
import { selectTarget } from '../combat/targeting';
import { FixedStep } from '../core/loop';
import { clamp, clamp01 } from '../core/math';
import { rng } from '../core/rng';
import { settings } from '../core/settings';
import type {
  AircraftId,
  AircraftModelFactory,
  AudioSystem,
  CockpitTones,
  Fx,
  Hud,
  HudState,
  OrdnanceModelFactory,
  Team,
  World,
} from '../core/types';
import { AIRCRAFT, type AircraftDef } from '../data/aircraft';
import { MISSILES, type MissileKind } from '../data/weapons';
import { Instructor, PLAYER_GAINS } from '../flight/instructor';
import type { Input } from '../input/input';
import { GroundShadow } from '../render/groundShadow';
import { atmoUniforms } from '../render/atmosphere';
import { buildHudState, createHudState } from './hudBuilder';
import { Simulation } from './simulation';

export interface SessionServices {
  renderer: WebGLRenderer;
  world: World;
  fx: Fx;
  audio: AudioSystem;
  hud: Hud;
  input: Input;
  models: AircraftModelFactory;
  ordnance: OrdnanceModelFactory;
}

export interface SpawnSpec {
  def: AircraftDef;
  team: Team;
  label: string;
  isPlayer?: boolean;
  rule: LoadoutRule;
  skill?: AiSkill;
  livery?: number;
  position: Vector3;
  heading: number;
  speed: number;
  onGround?: boolean;
  drone?: boolean;
}

export interface HudObjective {
  text: string;
  done: boolean;
  failed: boolean;
}

export interface ModeResult {
  outcome: 'success' | 'failure' | 'ended';
  title: string;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
  xp: number;
  stats: { label: string; value: string }[];
}

/** Game-mode rules plugged into a session (free flight, instant action, lessons, missions, survival). */
export interface ModeRules {
  readonly title: string;
  readonly subtitle: string;
  start(s: Session): void;
  step?(s: Session, dt: number): void;
  frame?(s: Session, dt: number): void;
  onKill?(s: Session, e: KillEvent): void;
  /** Called 3.5 s after the player is destroyed. Return true if the mode respawned the player. */
  onPlayerDown?(s: Session): boolean;
  objectives(s: Session): readonly HudObjective[];
  score(s: Session): { left: string; right: string; timer: string } | null;
  result(s: Session): ModeResult | null;
  hint?(s: Session): string | null;
  /** Extra HUD contacts such as checkpoint rings. */
  checkpoints?(s: Session): readonly Vector3[];
  dispose?(s: Session): void;
}

export interface SessionOptions {
  aircraft: AircraftId;
  seed: number;
  unlimitedFuel: boolean;
}

const ORDINALS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
const _v = new Vector3();
const EXPLOSION_FLASH = new Color(3, 2, 1.1);
const DOT_BLUE = new Color(0.08, 0.1, 0.13);
const DOT_RED = new Color(0.12, 0.08, 0.08);

export class Session {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly rig: CameraRig;
  readonly sim: Simulation;
  readonly services: SessionServices;
  readonly rules: ModeRules;
  readonly options: SessionOptions;
  player!: Aircraft;
  readonly loop = new FixedStep();
  readonly hudState: HudState;
  readonly groundShadow = new GroundShadow(1024);
  paused = false;
  hudVisible = true;
  timeScale = 1;
  result: ModeResult | null = null;
  readonly killFeed: { text: string; age: number; friendly: boolean }[] = [];
  message: { text: string; sub: string; time: number } | null = null;
  subtitle: { speaker: string; text: string; age: number } | null = null;
  private readonly radioQueue: { speaker: string; text: string }[] = [];
  readonly timeline: { time: number; text: string }[] = [];
  hitMarker = 0;
  playerDownTimer = -1;
  throttleCmd = 0.75;
  gearCmd = false;
  flapsCmd = false;
  outOfBounds: number | null = null;
  private readonly instructor = new Instructor();
  private autoTargetTimer = 0;
  private readonly casters: Object3D[] = [];
  private toneState: CockpitTones = {
    seeker: 'off',
    radarLock: false,
    rwr: 'off',
    missileWarning: false,
    stall: false,
    pullUp: false,
    g: 1,
  };
  /** Stats for the debrief. */
  readonly stats = { kills: 0, assists: 0, deaths: 0, damageTaken: 0, missiles: 0 };
  private disposed = false;

  constructor(services: SessionServices, rules: ModeRules, options: SessionOptions) {
    this.services = services;
    this.rules = rules;
    this.options = options;
    rng.seed(options.seed);
    this.camera = new PerspectiveCamera(settings.value.graphics.fov, 16 / 9, 0.3, 160000);
    this.rig = new CameraRig(this.camera);
    this.rig.baseFov = settings.value.graphics.fov;
    this.scene.add(services.world.root);
    this.scene.add(services.fx.root);
    this.scene.environment = services.world.environment;
    const w = services.world;
    this.sim = new Simulation(
      {
        heightAt: (x, z) => w.heightAt(x, z),
        waterLevel: w.waterLevel,
        boundary: w.boundary,
        lineOfSightBlocked: (a, b) => w.lineOfSightBlocked(a, b),
      },
      services.ordnance,
    );
    this.sim.combat.fx = services.fx;
    this.sim.combat.audio = services.audio;
    this.scene.add(this.sim.combat.missiles.root);
    this.hudState = createHudState();
    this.sim.listener = {
      onKill: (e) => this.handleKill(e),
      onDestroyed: (ac, cause) => this.handleDestroyed(ac, cause),
      onWreckImpact: (ac, water) => {
        services.fx.explosion(ac.body.position, water ? 'water' : 'ground');
        services.audio.play(water ? 'explosionWater' : 'explosionGround', { position: ac.body.position });
      },
      onHit: (target, shooter) => {
        if (shooter?.isPlayer && target !== (this.player as Targetable)) this.hitMarker = 1;
        if ((target as unknown) === this.player) {
          this.rig.addTrauma(0.25);
          this.stats.damageTaken++;
        }
      },
      onMissileLaunch: (owner, kind) => {
        if (owner.isPlayer) {
          this.stats.missiles++;
          const def = kind in MISSILES ? MISSILES[kind as MissileKind] : null;
          this.radio(
            owner.label,
            def ? `${def.callout}.` : kind === 'rocketPod' ? 'Rockets away.' : 'Pickle.',
          );
        }
      },
    };
    rules.start(this);
    this.sim.combat.missiles.prewarm(new Set(this.sim.aircraft.flatMap((a) => a.weaponKinds())));
    if (this.player) this.rig.snapTo(this.player);
  }

  get world(): World {
    return this.services.world;
  }

  get time(): number {
    return this.sim.time;
  }

  /** Creates an aircraft with its model, voice and (for AI) pilot. */
  spawn(spec: SpawnSpec): Aircraft {
    const s = this.services;
    const model = s.models(spec.def.id, {
      livery: spec.livery ?? (spec.team === 'blue' ? 0 : 1),
      team: spec.team,
      tailNumber: String(100 + rng.int(0, 899)),
    });
    this.scene.add(model.root);
    const ac = new Aircraft({
      def: spec.def,
      team: spec.team,
      label: spec.label,
      isPlayer: spec.isPlayer ?? false,
      rule: spec.rule,
      model,
      drone: spec.drone,
    });
    ac.body.options.mode = spec.isPlayer ? settings.value.gameplay.flightModel : 'standard';
    ac.body.options.autoLevel = spec.isPlayer ? settings.value.gameplay.autoLevel : false;
    ac.body.options.unlimitedFuel = this.options.unlimitedFuel || !spec.isPlayer;
    if (spec.onGround) ac.body.resetOnGround(spec.position, spec.heading, ac.gearContactY);
    else ac.body.reset(spec.position, spec.heading, spec.speed);
    ac.beginStep();
    ac.interpolate(1);
    ac.engineVoice = s.audio.createEngine(ac.isPlayer);
    ac.gunVoice = s.audio.createGun(ac.def.gun, ac.isPlayer);
    let pilot: AiPilot | null = null;
    if (!ac.isPlayer) {
      pilot = new AiPilot(ac, spec.skill ?? 'veteran', rng.nextU32());
      if (spec.drone) {
        pilot.state = 'drone';
        pilot.droneSpeed = spec.speed;
        pilot.patrolPoint.copy(spec.position);
      }
    }
    this.sim.add(ac, pilot);
    if (ac.isPlayer) {
      this.player = ac;
      ac.spawnProtection = 0;
      this.throttleCmd = spec.onGround ? 0 : 0.8;
      this.gearCmd = spec.onGround ?? false;
      this.flapsCmd = false;
      this.instructor.reset();
      this.rig.snapTo(ac);
    }
    return ac;
  }

  /** Removes an aircraft completely (after its wreck has landed, or on respawn). */
  despawn(ac: Aircraft): void {
    ac.releasePresentation();
    this.sim.remove(ac);
    if (ac.model) {
      ac.model.root.removeFromParent();
      ac.model.dispose();
      ac.model = null;
    }
  }

  /** Queues a radio line (subtitled, with squelch). */
  radio(speaker: string, text: string): void {
    if (this.radioQueue.length > 3) this.radioQueue.shift();
    this.radioQueue.push({ speaker, text });
  }

  showMessage(text: string, sub = '', time = 2.6): void {
    this.message = { text, sub, time };
  }

  pushFeed(text: string, friendly: boolean): void {
    this.killFeed.unshift({ text, age: 0, friendly });
    if (this.killFeed.length > 5) this.killFeed.length = 5;
  }

  private handleKill(e: KillEvent): void {
    const victim = e.victim as unknown as Aircraft;
    const killer = e.killer;
    const friendlyVictim = victim.team === 'blue';
    const t = this.sim.time;
    if (killer) {
      this.pushFeed(`${killer.label}  ›  ${victim.label}`, !friendlyVictim);
      this.timeline.push({ time: t, text: `${killer.label} destroyed ${victim.label}` });
    } else {
      this.pushFeed(`${victim.label} crashed`, !friendlyVictim);
      this.timeline.push({
        time: t,
        text: `${victim.label} ${e.cause === 'collision' ? 'collided' : 'crashed'}`,
      });
    }
    if (killer?.isPlayer) {
      this.stats.kills++;
      const word = ORDINALS[this.stats.kills - 1] ?? String(this.stats.kills);
      this.showMessage(`SPLASH ${word}`, victim.label, 2.4);
      this.radio(this.player.label, `Splash ${word.toLowerCase()}.`);
      this.services.audio.play('killConfirm');
    } else if (e.assists.some((a) => a.isPlayer)) {
      this.stats.assists++;
      this.pushFeed('Assist', true);
    }
    this.rules.onKill?.(this, e);
  }

  private handleDestroyed(ac: Aircraft, cause: string): void {
    const fx = this.services.fx;
    const audio = this.services.audio;
    if (cause === 'weapon' || cause === 'collision') {
      fx.explosion(ac.body.position, 'aircraft', ac.body.velocity);
      fx.debris(ac.body.position, ac.body.velocity, 10);
      fx.flash(ac.body.position, EXPLOSION_FLASH, 16, 400, 0.5);
      audio.play('explosionLarge', { position: ac.body.position, velocity: ac.body.velocity });
    } else {
      ac.finished = true;
      fx.explosion(ac.body.position, cause === 'water' ? 'water' : 'ground');
      audio.play(cause === 'water' ? 'explosionWater' : 'crash', { position: ac.body.position });
    }
    const d = ac.body.position.distanceTo(this.camera.position);
    this.rig.addTrauma(clamp01(1 - d / 1500) * 0.6);
    if (ac === this.player) {
      this.stats.deaths++;
      this.playerDownTimer = 3.5;
      this.rig.orbitTarget = ac.body.position.clone();
      audio.setCockpitTones({
        seeker: 'off',
        radarLock: false,
        rwr: 'off',
        missileWarning: false,
        stall: false,
        pullUp: false,
        g: 1,
      });
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.services.audio.setPaused(paused);
    if (paused) this.services.input.clear();
  }

  // ───────────────────────────────────────── Per frame

  update(frameDt: number): void {
    if (this.disposed) return;
    const s = this.services;
    const input = s.input;
    const dt = Math.min(frameDt, 0.1);
    if (!this.paused && !this.result) {
      this.handlePlayerInput(dt);
      this.loop.advance(frameDt, this.timeScale, (step) => {
        this.sim.step(step);
        this.rules.step?.(this, step);
      });
      this.rules.frame?.(this, dt);
      this.updateTimers(dt);
      this.result = this.rules.result(this);
    }
    input.mouseDX = 0;
    input.mouseDY = 0;

    // Presentation
    for (const ac of this.sim.aircraft) ac.interpolate(this.loop.alpha);
    const w = this.world;
    const surfaceAt = (x: number, z: number) => w.surfaceAt(x, z);
    if (this.player) this.rig.update(this.player, this.paused ? 0 : dt, surfaceAt);
    this.camera.updateMatrixWorld();
    w.update(this.camera, dt, this.sim.time);
    atmoUniforms.uTime.value = this.sim.time;
    this.casters.length = 0;
    for (const ac of this.sim.aircraft) {
      ac.present(
        this.paused ? 0 : dt,
        this.sim.time,
        this.camera.position,
        s.fx,
        ac.team === 'blue' ? DOT_BLUE : DOT_RED,
      );
      if (ac.model && ac.lod < 2 && ac.body.position.distanceTo(this.camera.position) < 1500)
        this.casters.push(ac.model.root);
      this.updateVoices(ac);
    }
    this.sim.combat.present();
    s.fx.update(this.paused ? 0 : dt, this.camera, surfaceAt);
    // Aircraft shadow on the ground, fading with height above ground.
    if (this.player) {
      const p = this.player.renderPosition;
      const agl = p.y - w.surfaceAt(p.x, p.z);
      const strength = clamp01(1 - agl / 900) * 0.55;
      _v.set(p.x, w.surfaceAt(p.x, p.z), p.z);
      this.groundShadow.render(
        s.renderer,
        _v,
        this.casters,
        settings.value.graphics.shadows === 'off' ? 0 : strength,
      );
    }
    // Remove finished wrecks after a while
    for (let i = this.sim.aircraft.length - 1; i >= 0; i--) {
      const ac = this.sim.aircraft[i]!;
      if (!ac.alive && ac !== this.player && this.sim.time - ac.deathTime > 12) this.despawn(ac);
    }
    s.audio.setListener(
      this.camera.position,
      this.camera.quaternion,
      this.player?.body.velocity ?? _v.set(0, 0, 0),
    );
    this.updateTones();
    s.audio.update(dt);
    buildHudState(this, this.hudState);
  }

  private updateTimers(dt: number): void {
    for (const k of this.killFeed) k.age += dt;
    while (this.killFeed.length > 0 && this.killFeed[this.killFeed.length - 1]!.age > 7) this.killFeed.pop();
    if (this.message) {
      this.message.time -= dt;
      if (this.message.time <= 0) this.message = null;
    }
    if (this.subtitle) {
      this.subtitle.age += dt;
      if (this.subtitle.age > 3.2) this.subtitle = null;
    }
    if (!this.subtitle && this.radioQueue.length > 0) {
      const next = this.radioQueue.shift()!;
      this.subtitle = { speaker: next.speaker, text: next.text, age: 0 };
      this.services.audio.radio();
    }
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3);
    if (this.playerDownTimer > 0) {
      this.playerDownTimer -= dt;
      if (this.playerDownTimer <= 0) {
        this.playerDownTimer = -1;
        const respawned = this.rules.onPlayerDown?.(this) ?? false;
        if (respawned) {
          this.rig.orbitTarget = null;
          this.rig.snapTo(this.player);
        }
      }
    }
    // Out of bounds (ZD-E08)
    const p = this.player;
    if (p?.alive) {
      const r = Math.max(Math.abs(p.body.position.x), Math.abs(p.body.position.z));
      if (r > this.world.boundary) {
        this.outOfBounds = (this.outOfBounds ?? 10) - dt;
        if (this.outOfBounds <= 0) {
          this.outOfBounds = null;
          this.sim.destroy(p, 'crash', 'boundary');
        }
      } else this.outOfBounds = null;
    } else this.outOfBounds = null;
  }

  private handlePlayerInput(dt: number): void {
    const p = this.player;
    const input = this.services.input;
    const cfg = settings.value;
    if (!p) return;
    // Camera controls
    if (input.wasPressed('camera')) this.rig.setView(this.rig.view === 'chase' ? 'cockpit' : 'chase');
    if (input.wasPressed('hud')) this.hudVisible = !this.hudVisible;
    this.rig.shakeScale = cfg.accessibility.shake;
    this.rig.baseFov = cfg.graphics.fov;
    const freeLook = input.isHeld('freeLook');
    this.rig.freeLook = freeLook;
    if (freeLook) {
      this.rig.lookYaw = clamp(this.rig.lookYaw - input.mouseDX * 0.004, -2.6, 2.6);
      this.rig.lookPitch = clamp(this.rig.lookPitch - input.mouseDY * 0.004, -1.2, 1.2);
    } else if (Math.abs(input.analog.lookX) > 0.05 || Math.abs(input.analog.lookY) > 0.05) {
      this.rig.lookYaw = -input.analog.lookX * 2.4;
      this.rig.lookPitch = input.analog.lookY * 1.1;
    } else {
      this.rig.lookYaw *= 1 - Math.min(1, dt * 6);
      this.rig.lookPitch *= 1 - Math.min(1, dt * 6);
    }
    this.rig.targetLook = input.isHeld('lookTarget') && p.target?.alive ? p.target.position : null;

    if (!p.alive) {
      p.gunTrigger = false;
      return;
    }
    const c = p.controls;
    const direct = cfg.controls.scheme === 'direct' || input.lastDevice === 'gamepad';
    const a = input.analog;
    const stickActive = Math.abs(a.pitch) > 0.04 || Math.abs(a.roll) > 0.04;
    this.rig.mouseAim = !direct;
    if (!direct && !freeLook) {
      if (input.pointerLocked)
        this.rig.applyAimDelta(
          input.mouseDX,
          input.mouseDY,
          cfg.controls.sensitivity,
          cfg.controls.invertPitch,
        );
      else if (input.cursor.inside) {
        // Without pointer lock the cursor acts like a stick for the aim point.
        const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
        this.rig.applyAimDelta(
          dz(input.cursor.x) * 1100 * dt,
          -dz(input.cursor.y) * 700 * dt,
          cfg.controls.sensitivity,
          cfg.controls.invertPitch,
        );
      }
    }
    if (direct || stickActive) {
      c.pitch = a.pitch;
      c.roll = a.roll;
      c.yaw = a.yaw;
      if (!direct) {
        // Keyboard override in mouse aim: re-center the aim on the nose so releasing keys doesn't snap.
        this.rig.aimQuat.copy(p.renderQuaternion);
        this.rig.aimDir.set(0, 0, -1).applyQuaternion(p.renderQuaternion);
      }
    } else {
      this.instructor.update(p.body, this.rig.aimDir, PLAYER_GAINS, c);
      if (Math.abs(a.yaw) > 0) c.yaw = clamp(c.yaw + a.yaw, -1, 1);
    }
    // Throttle
    const up = input.isHeld('throttleUp') || a.throttleAxis > 0.2;
    const down = input.isHeld('throttleDown') || a.throttleAxis < -0.2;
    if (up) this.throttleCmd = Math.min(1, this.throttleCmd + dt * 0.6);
    if (down) this.throttleCmd = Math.max(0, this.throttleCmd - dt * 0.6);
    c.throttle = this.throttleCmd;
    c.afterburner = this.throttleCmd >= 1 && up;
    if (input.wasPressed('gear')) {
      this.gearCmd = !this.gearCmd;
      this.services.audio.play('gearMove', { position: p.body.position });
    }
    if (input.wasPressed('flaps')) this.flapsCmd = !this.flapsCmd;
    c.gearDown = this.gearCmd;
    c.flaps = this.flapsCmd;
    c.brake = input.isHeld('airbrake');
    // Weapons
    p.gunTrigger = input.isHeld('gun');
    if (input.wasPressed('cycleWeapon')) p.cycleWeapon();
    if (input.wasPressed('lock')) {
      p.target = selectTarget(p, this.sim.targets, true);
      p.lockProgress = 0;
      p.locked = false;
    }
    this.autoTargetTimer -= dt;
    if ((!p.target || !p.target.alive) && this.autoTargetTimer <= 0) {
      this.autoTargetTimer = 0.5;
      p.target = selectTarget(p, this.sim.targets, false, 15000);
    }
    if (input.wasPressed('weapon')) {
      const fired = this.sim.combat.fireSelected(p);
      if (!fired && p.roundsOf(p.selectedKind() ?? 'tank') > 0 && !p.locked)
        this.services.audio.play('uiError', { volume: 0.4 });
    }
    if (input.isHeld('flares')) this.sim.combat.dropCountermeasure(p, 'flare');
    if (input.isHeld('chaff')) this.sim.combat.dropCountermeasure(p, 'chaff');
    // Auto countermeasures option
    if (cfg.gameplay.autoFlares) {
      for (const m of this.sim.combat.missiles.items) {
        if (m.isGuidedAt === p && m.position.distanceTo(p.body.position) < 1400) {
          this.sim.combat.dropCountermeasure(p, m.guided?.seeker === 'radar' ? 'chaff' : 'flare');
          break;
        }
      }
    }
    // Wingmen orders
    const orders = [
      ['wing1', 'attack-target', 'Engage my target.'],
      ['wing2', 'cover', 'Cover me.'],
      ['wing3', 'engage', 'Engage at will.'],
      ['wing4', 'form', 'Form up on me.'],
    ] as const;
    for (const [action, order, line] of orders) {
      if (!input.wasPressed(action)) continue;
      let any = false;
      for (const pilot of this.sim.pilots.values()) {
        if (pilot.ac.team !== p.team || !pilot.ac.alive || pilot.state === 'drone') continue;
        pilot.order = order;
        pilot.orderTarget = p.target && 'body' in p.target ? (p.target as Aircraft) : null;
        pilot.leader = p;
        any = true;
      }
      if (any) this.radio(p.label, line);
    }
  }

  private updateVoices(ac: Aircraft): void {
    const b = ac.body;
    if (ac.engineVoice) {
      if (ac.alive) {
        ac.engineVoice.set({
          throttle: b.throttle,
          afterburner: b.afterburner,
          speed: b.airspeed,
          mach: b.mach,
          g: b.g,
          aoa: b.aoa,
          position: ac.renderPosition,
          velocity: b.velocity,
          cockpit: ac.isPlayer && this.rig.view === 'cockpit',
          damaged: ac.visual.damage.engine,
        });
      } else {
        ac.engineVoice.dispose();
        ac.engineVoice = null;
      }
    }
    ac.gunVoice?.setFiring(ac.alive && ac.gunTrigger && ac.gunAmmo > 0, ac.renderPosition, b.velocity);
  }

  private updateTones(): void {
    const p = this.player;
    const t = this.toneState;
    const audio = this.services.audio;
    if (!p?.alive || this.paused) {
      t.seeker = 'off';
      t.radarLock = t.missileWarning = t.stall = t.pullUp = false;
      t.rwr = 'off';
      t.g = 1;
      audio.setCockpitTones(t);
      return;
    }
    const kind = p.selectedKind();
    const def = kind && kind in MISSILES ? MISSILES[kind as MissileKind] : null;
    t.seeker = def?.seeker === 'ir' && p.roundsOf(def.id) > 0 ? (p.locked ? 'locked' : 'search') : 'off';
    t.radarLock = def?.seeker === 'radar' && p.locked;
    let rwr: CockpitTones['rwr'] = 'off';
    for (const ac of this.sim.aircraft) {
      if (!ac.alive || ac.team === p.team || ac.target !== (p as Targetable)) continue;
      const k = ac.selectedKind();
      if (k === 'mrm' || k === 'lraam') rwr = 'spike';
    }
    let incoming = false;
    for (const m of this.sim.combat.missiles.items) {
      if (m.isGuidedAt !== p) continue;
      if (m.guided?.seeker === 'radar') rwr = 'launch';
      if (m.position.distanceTo(p.body.position) < 6000) incoming = true;
    }
    t.rwr = rwr;
    t.missileWarning = incoming;
    t.stall = p.body.stalled;
    t.pullUp = this.hudState.warnings.includes('PULL UP');
    t.g = p.body.g;
    audio.setCockpitTones(t);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rules.dispose?.(this);
    for (const ac of [...this.sim.aircraft]) this.despawn(ac);
    this.sim.clear();
    this.sim.combat.missiles.dispose();
    this.services.fx.clear();
    this.services.audio.stopAll();
    this.groundShadow.dispose();
    this.scene.remove(this.services.world.root);
    this.scene.remove(this.services.fx.root);
    this.services.hud.clear();
  }
}

export function spawnLabel(team: Team, index: number): string {
  const blue = ['VIPER', 'COBRA', 'HAWK', 'LANCE'];
  const red = ['BANDIT', 'BANDIT', 'BANDIT', 'BANDIT'];
  const list = team === 'blue' ? blue : red;
  return `${list[Math.floor(index / 4) % list.length]} ${(index % 4) + 1}`;
}

export function defFor(id: AircraftId): AircraftDef {
  return AIRCRAFT[id];
}

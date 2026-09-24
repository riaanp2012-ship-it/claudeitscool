import { Quaternion, Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import type { KillEvent } from '../combat/targetable';
import { DEG, KMH_PER_MS, fmtTime } from '../core/math';
import type { Medal } from '../core/profile';
import type { AircraftId } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import type { ActionId } from '../input/input';
import { RingCourse } from './freeFlight';
import { ScoreBox, type HudObjective, type ModeResult, type ModeRules, type Session } from './session';

/**
 * Training Academy (spec §5.8): scripted lessons made of steps with instructor prompts, checkpoints
 * (a failed step restores the aircraft to the step's start), medals by completion time, and an exit
 * at any time from the pause menu.
 */
export interface LessonStep {
  /** Instructor line spoken when the step starts. */
  say: string;
  /** Persistent hint; may reference input labels via {action}. */
  hint: string;
  enter?(s: Session, l: LessonRules): void;
  /** Returns true when the step is complete. */
  check(s: Session, l: LessonRules, dt: number): boolean;
  /** Returns a failure message when the step failed (restores the checkpoint). */
  fail?(s: Session, l: LessonRules): string | null;
}

export interface LessonDef {
  id: string;
  number: number;
  title: string;
  description: string;
  aircraft: AircraftId;
  loadout: 'guns' | 'standard';
  start: 'air' | 'runway';
  /** Completion times (s) for gold/silver; any completion earns bronze. */
  gold: number;
  silver: number;
  steps: LessonStep[];
}

const _v = new Vector3();

export class LessonRules implements ModeRules {
  readonly title = 'TRAINING';
  readonly subtitle: string;
  readonly def: LessonDef;
  stepIndex = -1;
  stepTime = 0;
  /** Scratch accumulator available to step checks. */
  counter = 0;
  flag = false;
  course: RingCourse | null = null;
  readonly drones: Aircraft[] = [];
  launcher: Aircraft | null = null;
  private startTime = 0;
  private finished: ModeResult | null = null;
  private failTimer = -1;
  private readonly checkpoint = {
    pos: new Vector3(),
    vel: new Vector3(),
    quat: new Quaternion(),
    throttle: 0.8,
  };
  kills = 0;
  missilesSurvived = 0;

  private readonly allObjectives: HudObjective[];
  private readonly visible: HudObjective[] = [];

  constructor(def: LessonDef, mapName: string) {
    this.def = def;
    this.subtitle = `${def.number}. ${def.title} · ${mapName}`;
    this.allObjectives = def.steps.map((st) => ({
      text: st.hint
        .replace(/\{[a-zA-Z]+\}/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      done: false,
      failed: false,
    }));
  }

  start(s: Session): void {
    const w = s.world;
    const rw = w.runways[0];
    if (this.def.start === 'runway' && rw) {
      const back = rw.length * 0.42;
      const pos = new Vector3(
        rw.center.x - Math.sin(rw.heading) * back,
        rw.center.y,
        rw.center.z + Math.cos(rw.heading) * back,
      );
      s.spawn({
        def: AIRCRAFT[this.def.aircraft],
        team: 'blue',
        label: 'VIPER 1',
        isPlayer: true,
        rule: this.def.loadout,
        position: pos,
        heading: rw.heading,
        speed: 0,
        onGround: true,
      });
      this.startTime = s.time;
      this.next(s);
      return;
    }
    const sp = w.airSpawns.blue[0]!;
    const pos = sp.position.clone();
    pos.y = Math.max(1500, w.surfaceAt(pos.x, pos.z) + 900);
    s.spawn({
      def: AIRCRAFT[this.def.aircraft],
      team: 'blue',
      label: 'VIPER 1',
      isPlayer: true,
      rule: this.def.loadout,
      position: pos,
      heading: sp.heading,
      speed: 200,
    });
    this.startTime = s.time;
    this.next(s);
  }

  private next(s: Session): void {
    this.stepIndex++;
    this.stepTime = 0;
    this.counter = 0;
    this.flag = false;
    const step = this.def.steps[this.stepIndex];
    if (!step) {
      const t = s.time - this.startTime;
      const medal: Medal = t <= this.def.gold ? 'gold' : t <= this.def.silver ? 'silver' : 'bronze';
      s.showMessage('LESSON COMPLETE', `${fmtTime(t)} · ${medal.toUpperCase()}`, 4);
      s.services.audio.play('medal');
      this.finished = {
        outcome: 'success',
        title: 'LESSON COMPLETE',
        medal,
        xp: medal === 'gold' ? 300 : medal === 'silver' ? 200 : 100,
        stats: [
          { label: 'Lesson time', value: fmtTime(t) },
          { label: 'Gold time', value: fmtTime(this.def.gold) },
        ],
      };
      return;
    }
    this.saveCheckpoint(s);
    step.enter?.(s, this);
    s.radio('INSTRUCTOR', step.say);
    if (this.stepIndex > 0) s.services.audio.play('checkpoint');
  }

  private saveCheckpoint(s: Session): void {
    const b = s.player.body;
    this.checkpoint.pos.copy(b.position);
    this.checkpoint.vel.copy(b.velocity);
    this.checkpoint.quat.copy(b.quaternion);
    this.checkpoint.throttle = s.throttleCmd;
  }

  /** Restores the aircraft to the start of the current step. */
  restoreCheckpoint(s: Session): void {
    const p = s.player;
    const b = p.body;
    b.position.copy(this.checkpoint.pos);
    b.velocity.copy(this.checkpoint.vel);
    b.quaternion.copy(this.checkpoint.quat);
    b.rates.set(0, 0, 0);
    s.throttleCmd = this.checkpoint.throttle;
    p.repair();
    p.flares = p.def.flares;
    p.chaff = p.def.chaff;
    s.sim.combat.missiles.clear();
    p.beginStep();
    s.rig.snapTo(p);
    const step = this.def.steps[this.stepIndex];
    this.stepTime = 0;
    this.counter = 0;
    this.flag = false;
    step?.enter?.(s, this);
  }

  step(s: Session, dt: number): void {
    if (this.finished || this.failTimer >= 0) return;
    const step = this.def.steps[this.stepIndex];
    if (!step) return;
    this.stepTime += dt;
    const failure = step.fail?.(s, this) ?? null;
    if (failure) {
      s.showMessage('TRY AGAIN', failure, 3);
      s.services.audio.play('uiError');
      this.failTimer = 3;
      return;
    }
    if (step.check(s, this, dt)) this.next(s);
  }

  frame(s: Session, dt: number): void {
    this.course?.update(s);
    if (this.failTimer >= 0) {
      this.failTimer -= dt;
      if (this.failTimer < 0) this.restoreCheckpoint(s);
    }
  }

  onKill(_s: Session, e: KillEvent): void {
    if (e.victim.team === 'red' && e.killer?.isPlayer) this.kills++;
  }

  onPlayerDown(s: Session): boolean {
    // A crash in training restores the checkpoint instead of ending the lesson.
    const old = s.player;
    s.spawn({
      def: AIRCRAFT[this.def.aircraft],
      team: 'blue',
      label: 'VIPER 1',
      isPlayer: true,
      rule: this.def.loadout,
      position: this.checkpoint.pos,
      heading: 0,
      speed: 200,
    });
    s.despawn(old);
    this.restoreCheckpoint(s);
    s.showMessage('CHECKPOINT', 'Resuming from the start of this step', 2.5);
    return true;
  }

  objectives(): readonly HudObjective[] {
    // Show the previous, current and next step; objects are reused every frame.
    const from = Math.max(0, this.stepIndex - 1);
    const to = Math.min(this.def.steps.length, this.stepIndex + 2);
    this.visible.length = 0;
    for (let i = from; i < to; i++) {
      const o = this.allObjectives[i]!;
      o.done = i < this.stepIndex;
      this.visible.push(o);
    }
    return this.visible;
  }

  private readonly scoreBox = new ScoreBox();
  private stepLabelIndex = -1;
  private stepLabel = '';

  score(s: Session): { left: string; right: string; timer: string } {
    if (this.stepLabelIndex !== this.stepIndex) {
      this.stepLabelIndex = this.stepIndex;
      this.stepLabel = `STEP ${Math.min(this.stepIndex + 1, this.def.steps.length)}/${this.def.steps.length}`;
    }
    return this.scoreBox.set(`LESSON ${this.def.number}`, this.stepLabel, s.time - this.startTime);
  }

  result(): ModeResult | null {
    return this.finished;
  }

  hint(s: Session): string | null {
    const step = this.def.steps[this.stepIndex];
    if (!step || this.finished) return null;
    const input = s.services.input;
    return step.hint.replace(/\{([a-zA-Z]+)\}/g, (_m, a: string) => input.label(a as ActionId).toUpperCase());
  }

  checkpoints(): readonly Vector3[] {
    const c = this.course;
    if (!c || c.next >= c.rings.length) return [];
    return [c.rings[c.next]!.center];
  }

  /** Spawns a slow red drone at a bearing/range from the player. */
  spawnDrone(
    s: Session,
    bearingOffset: number,
    range: number,
    altOffset: number,
    speed: number,
    loadout: 'guns' | 'standard' = 'guns',
  ): Aircraft {
    const p = s.player.body;
    const hdg = p.heading + bearingOffset;
    _v.set(p.position.x + Math.sin(hdg) * range, 0, p.position.z - Math.cos(hdg) * range);
    _v.y = Math.max(p.position.y + altOffset, s.world.surfaceAt(_v.x, _v.z) + 600);
    const ac = s.spawn({
      def: AIRCRAFT.kestrel,
      team: 'red',
      label: `DRONE ${this.drones.length + 1}`,
      rule: loadout,
      position: _v.clone(),
      heading: p.heading + bearingOffset * 0.3,
      speed,
      drone: true,
      livery: 2,
    });
    this.drones.push(ac);
    return ac;
  }

  dispose(): void {
    this.course?.dispose();
  }
}

// ───────────────────────────────────────── Lesson content

const bank = (s: Session) => s.player.body.bankAngle;

export const LESSONS: LessonDef[] = [
  {
    id: 'basic-flight',
    number: 1,
    title: 'Basic Flight',
    description: 'Attitude, bank and climb. Finish with a six-ring course at low level.',
    aircraft: 'kestrel',
    loadout: 'guns',
    start: 'air',
    gold: 150,
    silver: 220,
    steps: [
      {
        say: 'Kestrel, you have control. Wings level, hold your heading for five seconds.',
        hint: 'Keep the wings level for 5 s',
        check: (s, l, dt) => {
          if (Math.abs(bank(s)) < 10 * DEG) l.counter += dt;
          else l.counter = 0;
          return l.counter > 5;
        },
      },
      {
        say: 'Roll into sixty degrees of left bank.',
        hint: 'Bank 60° left (move the mouse left, or {rollLeft})',
        check: (s) => bank(s) < -55 * DEG,
      },
      {
        say: 'Good. Now sixty degrees right.',
        hint: 'Bank 60° right ({rollRight})',
        check: (s) => bank(s) > 55 * DEG,
      },
      {
        say: 'Climb. Level off above two and a half thousand meters.',
        hint: 'Climb above 2,500 m',
        check: (s) => s.player.body.position.y > 2500,
      },
      {
        say: 'Six rings ahead. Fly through each one; the next ring is marked on the HUD.',
        hint: 'Fly through all six rings',
        enter: (s, l) => {
          l.course?.dispose();
          const p = s.player.body;
          l.course = new RingCourse(s, p.position.clone(), p.heading, 6, 21);
        },
        check: (_s, l) => !!l.course && l.course.next >= l.course.rings.length,
      },
    ],
  },
  {
    id: 'energy',
    number: 2,
    title: 'Energy and Throttle',
    description: 'Afterburner, speed management, a low-speed climb and a sustained high-G turn.',
    aircraft: 'kestrel',
    loadout: 'guns',
    start: 'air',
    gold: 110,
    silver: 170,
    steps: [
      {
        say: 'Full throttle and hold it for the burner. Accelerate past nine hundred kilometers per hour.',
        hint: 'Hold {throttleUp} for afterburner, reach 900 km/h',
        check: (s) => s.player.body.airspeed * KMH_PER_MS > 900,
      },
      {
        say: 'Throttle back to idle and pull into a steep climb. Let the speed bleed below three hundred.',
        hint: 'Idle ({throttleDown}) and climb until below 300 km/h',
        check: (s) => s.player.body.airspeed * KMH_PER_MS < 300,
      },
      {
        say: 'Now recover. Nose down, power up, get back above five hundred.',
        hint: 'Lower the nose and accelerate past 500 km/h',
        check: (s) => s.player.body.airspeed * KMH_PER_MS > 500,
      },
      {
        say: 'Hard turn. Hold six G or more for three seconds. Watch your speed.',
        hint: 'Hold 6 G or more for 3 s',
        check: (s, l, dt) => {
          if (s.player.body.g >= 5.8) l.counter += dt;
          else l.counter = Math.max(0, l.counter - dt * 0.5);
          return l.counter >= 3;
        },
      },
    ],
  },
  {
    id: 'takeoff-landing',
    number: 3,
    title: 'Takeoff and Landing',
    description: 'Runway takeoff, a ring-marked circuit, gear and flaps, and a full-stop landing.',
    aircraft: 'kestrel',
    loadout: 'guns',
    start: 'runway',
    gold: 240,
    silver: 330,
    steps: [
      {
        say: 'Cleared for takeoff. Full power, keep it on the centerline, rotate at two eighty.',
        hint: 'Full throttle ({throttleUp}), pull up gently above 280 km/h',
        check: (s) =>
          !s.player.body.onGround &&
          s.player.body.position.y - s.world.surfaceAt(s.player.body.position.x, s.player.body.position.z) >
            40,
      },
      {
        say: 'Positive rate. Gear up.',
        hint: 'Retract the landing gear ({gear})',
        check: (s) => s.player.body.gear < 0.05,
      },
      {
        say: 'Fly the circuit through the rings. Keep it smooth, six hundred meters.',
        hint: 'Fly the circuit rings',
        enter: (s, l) => {
          l.course?.dispose();
          const rw = s.world.runways[0];
          if (!rw) return;
          const c = rw.center;
          const fx = Math.sin(rw.heading);
          const fz = -Math.cos(rw.heading);
          const rx = Math.cos(rw.heading);
          const rz = Math.sin(rw.heading);
          const at = (along: number, side: number, alt: number) =>
            new Vector3(c.x + fx * along + rx * side, 0, c.z + fz * along + rz * side).setY(c.y + alt);
          l.course = new RingCourse(s, s.player.body.position.clone(), 0, 0, 0, [
            at(4500, 0, 450),
            at(5500, 3000, 600),
            at(0, 3500, 600),
            at(-5500, 2500, 500),
            at(-6000, 0, 380),
            at(-3000, 0, 200),
          ]);
        },
        check: (_s, l) => !!l.course && l.course.next >= l.course.rings.length,
      },
      {
        say: 'On final. Gear down, flaps down, power back. Aim for the threshold and flare just before touchdown.',
        hint: 'Gear ({gear}) and flaps ({flaps}) down, land on the runway and stop (brakes: {airbrake})',
        check: (s) => {
          const b = s.player.body;
          return b.onGround && b.airspeed < 8;
        },
        fail: (s) => {
          const b = s.player.body;
          if (b.onGround && b.gear < 0.9) return 'Landed with the gear up.';
          return null;
        },
      },
    ],
  },
  {
    id: 'gunnery',
    number: 4,
    title: 'Gunnery',
    description: 'Three slow target drones. Put the lead pip on the target and use short bursts.',
    aircraft: 'kestrel',
    loadout: 'guns',
    start: 'air',
    gold: 120,
    silver: 200,
    steps: [
      {
        say: 'Three drones ahead. Close to under a kilometer, put the pipper on the lead cue, short bursts.',
        hint: 'Destroy 3 drones with guns ({gun})',
        enter: (s, l) => {
          for (const d of l.drones) if (d.alive) s.despawn(d);
          l.drones.length = 0;
          l.kills = 0;
          l.spawnDrone(s, -0.15, 3500, 0, 150);
          l.spawnDrone(s, 0.1, 4800, 250, 160);
          l.spawnDrone(s, 0.3, 6200, -150, 150);
        },
        check: (_s, l) => l.kills >= 3,
      },
    ],
  },
  {
    id: 'missiles',
    number: 5,
    title: 'Missiles',
    description: 'Infrared lock and launch, then a radar missile shot beyond visual range.',
    aircraft: 'kestrel',
    loadout: 'standard',
    start: 'air',
    gold: 120,
    silver: 200,
    steps: [
      {
        say: 'Heat seekers selected. Keep the target in the seeker circle until the tone goes solid, then fire.',
        hint: 'Lock ({lock}) and fire an SRM ({weapon}) at the drone',
        enter: (s, l) => {
          for (const d of l.drones) if (d.alive) s.despawn(d);
          l.drones.length = 0;
          l.kills = 0;
          s.player.selectedWeapon = 0;
          l.spawnDrone(s, 0.05, 3500, 0, 180);
        },
        check: (_s, l) => l.kills >= 1,
      },
      {
        say: 'Next target is fifteen kilometers out. Switch to the radar missile, wait for the lock, fire.',
        hint: 'Cycle to MRM ({cycleWeapon}), lock and fire',
        enter: (s, l) => {
          l.kills = 0;
          l.spawnDrone(s, 0, 15000, 400, 200);
        },
        check: (_s, l) => l.kills >= 1,
      },
    ],
  },
  {
    id: 'defensive',
    number: 6,
    title: 'Defensive Flying',
    description: 'Beat three incoming heat-seekers with flares, a hard break and good timing.',
    aircraft: 'kestrel',
    loadout: 'guns',
    start: 'air',
    gold: 90,
    silver: 140,
    steps: [
      {
        say: 'A launcher behind you will fire three heat seekers, one at a time. Break hard into each one and drop flares when it gets close.',
        hint: 'Survive 3 missiles: break turn and {flares} at about 1.5 km',
        enter: (s, l) => {
          l.counter = 0;
          l.missilesSurvived = 0;
          if (!l.launcher?.alive) {
            if (l.launcher) s.despawn(l.launcher);
            l.launcher = l.spawnDrone(s, Math.PI, 3500, 200, 220, 'standard');
            l.launcher.label = 'LAUNCHER';
            // Plenty of rounds for the exercise.
            for (const st of l.launcher.stations) if (st.kind === 'srm') st.rounds = 8;
          }
        },
        check: (s, l, dt) => {
          const launcher = l.launcher;
          if (!launcher?.alive) return false;
          // Keep the launcher behind the player at a teaching distance.
          const p = s.player.body;
          const behind = _v.copy(p.velocity).normalize().multiplyScalar(-3200).add(p.position);
          launcher.body.position.lerp(behind, Math.min(1, dt * 0.2));
          const active = s.sim.combat.missiles.countThreats(s.player) > 0;
          if (!active) {
            l.counter += dt;
            if (l.flag) {
              l.missilesSurvived++;
              l.flag = false;
              if (l.missilesSurvived < 3) s.radio('INSTRUCTOR', 'Missile defeated. Next one is coming.');
            }
            if (l.missilesSurvived >= 3) return true;
            if (l.counter > 4) {
              launcher.target = s.player;
              launcher.selectedWeapon = 0;
              launcher.locked = true;
              launcher.lockProgress = 1;
              if (s.sim.combat.fireSelected(launcher)) {
                l.flag = true;
                l.counter = 0;
                s.radio('INSTRUCTOR', 'Missile launch, six o’clock.');
              }
            }
          }
          return false;
        },
        fail: (s) => (s.player.health() < 0.999 ? 'You were hit. Break earlier and time the flares.' : null),
      },
    ],
  },
  {
    id: 'bfm',
    number: 7,
    title: 'Basic Fighter Maneuvers',
    description: 'A one-versus-one against a rookie instructor pilot. Guns and heat seekers only.',
    aircraft: 'kestrel',
    loadout: 'standard',
    start: 'air',
    gold: 150,
    silver: 260,
    steps: [
      {
        say: 'Fight is on. Your opponent is a rookie in a Kestrel. Manage your energy and take the shot when you have it.',
        hint: 'Shoot down the instructor pilot',
        enter: (s, l) => {
          for (const d of l.drones) if (d.alive) s.despawn(d);
          l.drones.length = 0;
          l.kills = 0;
          const p = s.player.body;
          const hdg = p.heading;
          _v.set(p.position.x + Math.sin(hdg) * 5000, p.position.y, p.position.z - Math.cos(hdg) * 5000);
          s.spawn({
            def: AIRCRAFT.kestrel,
            team: 'red',
            label: 'IP',
            rule: 'standard',
            skill: 'rookie',
            position: _v.clone(),
            heading: hdg + Math.PI,
            speed: 220,
          });
        },
        check: (_s, l) => l.kills >= 1,
      },
    ],
  },
];

/** Lesson 8 is appended separately because it needs ground units. */
LESSONS.push({
  id: 'ground-attack',
  number: 8,
  title: 'Ground Attack',
  description: 'Rockets with the CCIP pipper and a laser-guided bomb, while staying out of SAM coverage.',
  aircraft: 'wyvern',
  loadout: 'standard',
  start: 'air',
  gold: 180,
  silver: 280,
  steps: [
    {
      say: 'Rockets selected. Dive on the flak site, put the impact pipper on it, fire a salvo, then pull off.',
      hint: 'Select rockets ({cycleWeapon}), dive and fire ({weapon}) with the pipper on the target',
      enter: (s, l) => {
        l.kills = 0;
        const p = s.player;
        const kinds = p.weaponKinds();
        const idx = kinds.indexOf('rocketPod');
        if (idx >= 0) p.selectedWeapon = idx;
        const b = p.body;
        const at = new Vector3(
          b.position.x + Math.sin(b.heading) * 5000,
          0,
          b.position.z - Math.cos(b.heading) * 5000,
        );
        at.y = s.world.heightAt(at.x, at.z);
        s.spawnGround('bunker', 'red', at, 0, 'lesson', 'RANGE TARGET');
        s.spawnGround(
          'aaa',
          'red',
          at
            .clone()
            .add(new Vector3(60, 0, 40))
            .setY(s.world.heightAt(at.x + 60, at.z + 40)),
          0,
          'lesson',
          'FLAK',
        );
        p.target = null;
      },
      check: (_s, l) => l.kills >= 1,
    },
    {
      say: 'Now the bomb. Select the laser-guided bomb, designate the bunker and release above one thousand meters.',
      hint: 'Select LGB ({cycleWeapon}), target the bunker ({lock}) and release ({weapon})',
      enter: (s, l) => {
        l.kills = 0;
        const p = s.player;
        const idx = p.weaponKinds().indexOf('bomb');
        if (idx >= 0) p.selectedWeapon = idx;
      },
      check: (s, l) => l.kills >= 1 || s.sim.grounds.every((g) => !g.alive),
    },
  ],
});

export function lessonById(id: string): LessonDef | undefined {
  return LESSONS.find((l) => l.id === id);
}

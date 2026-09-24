import { Vector3 } from 'three';
import type { AiSkill } from '../ai/pilot';
import type { Aircraft } from '../aircraft/aircraft';
import type { GroundTarget } from '../combat/groundTarget';
import type { KillEvent } from '../combat/targetable';
import { fmtTime } from '../core/math';
import type { Medal } from '../core/profile';
import type { AircraftId, GroundTargetKind, MapId } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import {
  ScoreBox,
  spawnLabel,
  type HudObjective,
  type ModeResult,
  type ModeRules,
  type Session,
} from './session';

/**
 * Campaign "Operation Low Tide" (spec §5.9): data-driven missions built from spawns, waves, triggers and
 * objectives. Missions reference the world's ground-target slots by kind and fall back to positions
 * computed from the map when a slot is missing.
 */
export interface MissionObjective extends HudObjective {
  /** Primary objectives must all be done to succeed. */
  primary: boolean;
}

export interface MissionDef {
  id: string;
  number: number;
  title: string;
  map: MapId;
  briefing: string;
  objectives: string[];
  /** Suggested aircraft (the player's hangar choice is used if unlocked). */
  aircraft: AircraftId;
  /** Gold/silver completion times in seconds. */
  gold: number;
  silver: number;
  build(s: Session, m: MissionRules): void;
}

interface Trigger {
  when: (s: Session, m: MissionRules) => boolean;
  then: (s: Session, m: MissionRules) => void;
  fired: boolean;
}

const _v = new Vector3();

export class MissionRules implements ModeRules {
  readonly title = 'SORTIE';
  readonly subtitle: string;
  readonly def: MissionDef;
  readonly objectiveList: MissionObjective[] = [];
  private readonly triggers: Trigger[] = [];
  readonly groups = new Map<string, (Aircraft | GroundTarget)[]>();
  private finished: ModeResult | null = null;
  private startTime = 0;
  private readonly box = new ScoreBox();
  readonly playerAircraft: AircraftId;
  /** Free-form counters for mission scripts. */
  readonly vars = new Map<string, number>();

  constructor(def: MissionDef, mapName: string, playerAircraft: AircraftId) {
    this.def = def;
    this.subtitle = `${def.number}. ${def.title} · ${mapName}`;
    this.playerAircraft = playerAircraft;
  }

  start(s: Session): void {
    this.startTime = s.time;
    const sp = s.world.airSpawns.blue[0]!;
    const pos = sp.position.clone();
    pos.y = Math.max(pos.y, s.world.surfaceAt(pos.x, pos.z) + 900);
    s.spawn({
      def: AIRCRAFT[this.playerAircraft],
      team: 'blue',
      label: 'VIPER 1',
      isPlayer: true,
      rule: 'standard',
      position: pos,
      heading: sp.heading,
      speed: 220,
    });
    this.def.build(s, this);
  }

  objective(text: string, primary = true): MissionObjective {
    const o: MissionObjective = { text, done: false, failed: false, primary };
    this.objectiveList.push(o);
    return o;
  }

  on(when: Trigger['when'], then: Trigger['then']): void {
    this.triggers.push({ when, then, fired: false });
  }

  add(group: string, unit: Aircraft | GroundTarget): void {
    const list = this.groups.get(group) ?? [];
    list.push(unit);
    this.groups.set(group, list);
  }

  alive(group: string): number {
    let n = 0;
    for (const u of this.groups.get(group) ?? []) if (u.alive) n++;
    return n;
  }

  total(group: string): number {
    return this.groups.get(group)?.length ?? 0;
  }

  /** Spawns a flight of aircraft near a point, facing a heading. */
  flight(
    s: Session,
    group: string,
    team: 'blue' | 'red',
    types: AircraftId[],
    count: number,
    at: Vector3,
    heading: number,
    skill: AiSkill,
    opts: { passive?: boolean; drone?: boolean; speed?: number; label?: string } = {},
  ): Aircraft[] {
    const out: Aircraft[] = [];
    for (let i = 0; i < count; i++) {
      const side = (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 250;
      _v.set(at.x + Math.cos(heading) * side, at.y, at.z + Math.sin(heading) * side);
      _v.y = Math.max(_v.y, s.world.surfaceAt(_v.x, _v.z) + 700);
      const ac = s.spawn({
        def: AIRCRAFT[types[i % types.length]!],
        team,
        label: opts.label ? `${opts.label} ${i + 1}` : spawnLabel(team, this.total(group) + i),
        rule: 'standard',
        skill,
        position: _v.clone(),
        heading,
        speed: opts.speed ?? 230,
        drone: opts.drone,
      });
      const pilot = s.sim.pilots.get(ac);
      if (pilot && opts.passive) {
        pilot.passive = true;
        pilot.state = 'patrol';
      }
      this.add(group, ac);
      out.push(ac);
    }
    return out;
  }

  /** Places ground units, preferring the world's slots of the same kind nearest to `near`. */
  ground(
    s: Session,
    group: string,
    kind: GroundTargetKind,
    count: number,
    near: Vector3,
    spread = 2500,
    team: 'blue' | 'red' = 'red',
  ): GroundTarget[] {
    const slots = s.world.groundTargets
      .filter((g) => g.kind === kind)
      .sort((a, b) => a.position.distanceTo(near) - b.position.distanceTo(near));
    const out: GroundTarget[] = [];
    for (let i = 0; i < count; i++) {
      const slot = slots[i];
      let pos: Vector3;
      let heading = 0;
      if (slot && slot.position.distanceTo(near) < spread * 3) {
        pos = slot.position.clone();
        heading = slot.heading;
      } else {
        const ang = (i / Math.max(1, count)) * Math.PI * 2 + 0.4;
        pos = new Vector3(
          near.x + Math.cos(ang) * spread * (0.5 + (i % 2) * 0.4),
          0,
          near.z + Math.sin(ang) * spread * (0.5 + (i % 2) * 0.4),
        );
        pos.y = kind === 'ship' ? s.world.waterLevel : s.world.heightAt(pos.x, pos.z);
      }
      const g = s.spawnGround(kind, team, pos, heading, group);
      this.add(group, g);
      out.push(g);
    }
    return out;
  }

  step(s: Session): void {
    if (this.finished) return;
    for (const t of this.triggers) {
      if (!t.fired && t.when(s, this)) {
        t.fired = true;
        t.then(s, this);
      }
    }
    let primaries = 0;
    let done = 0;
    let failed = false;
    for (const o of this.objectiveList) {
      if (!o.primary) continue;
      primaries++;
      if (o.done) done++;
      if (o.failed) failed = true;
    }
    if (failed) this.finish(s, 'failure', 'MISSION FAILED');
    else if (primaries > 0 && done === primaries) this.finish(s, 'success', 'MISSION COMPLETE');
  }

  finish(s: Session, outcome: 'success' | 'failure', title: string): void {
    if (this.finished) return;
    const t = s.time - this.startTime;
    const medal: Medal =
      outcome !== 'success'
        ? 'none'
        : t <= this.def.gold && s.stats.deaths === 0
          ? 'gold'
          : t <= this.def.silver
            ? 'silver'
            : 'bronze';
    this.finished = {
      outcome,
      title,
      medal,
      xp: outcome === 'success' ? 400 + s.stats.kills * 100 + s.stats.groundKills * 60 : s.stats.kills * 60,
      stats: [
        { label: 'Mission time', value: fmtTime(t) },
        { label: 'Ground targets', value: String(s.stats.groundKills) },
      ],
    };
    s.showMessage(title, this.def.title, 3);
  }

  onKill(_s: Session, _e: KillEvent): void {
    // Objective checks run in triggers.
  }

  onPlayerDown(s: Session): boolean {
    this.finish(s, 'failure', 'SHOT DOWN');
    return false;
  }

  objectives(): readonly HudObjective[] {
    return this.objectiveList;
  }

  score(s: Session): { left: string; right: string; timer: string } {
    return this.box.set(`MISSION ${this.def.number}`, this.def.title.toUpperCase(), s.time - this.startTime);
  }

  result(): ModeResult | null {
    return this.finished;
  }
}

// ───────────────────────────────────────── Helpers for mission scripts

function ahead(s: Session, dist: number, alt: number, lateral = 0): Vector3 {
  const b = s.player.body;
  const h = b.heading;
  const p = new Vector3(
    b.position.x + Math.sin(h) * dist + Math.cos(h) * lateral,
    0,
    b.position.z - Math.cos(h) * dist + Math.sin(h) * lateral,
  );
  p.y = Math.max(alt, s.world.surfaceAt(p.x, p.z) + 700);
  return p;
}

function headingTo(from: Vector3, to: Vector3): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

function mapCenterOf(s: Session): Vector3 {
  const rw = s.world.runways[0];
  return rw ? rw.center.clone() : new Vector3(0, 0, 0);
}

// ───────────────────────────────────────── Missions

export const MISSIONS: MissionDef[] = [
  {
    id: 'first-light',
    number: 1,
    title: 'First Light',
    map: 'kessel',
    briefing:
      'Radar has two flights of Varen trainers probing the strait at dawn. Take the combat air patrol with Cobra flight, turn them back or shoot them down. Expect a second pair once the first is engaged.',
    objectives: [
      'Destroy the first pair of bandits',
      'Destroy the second pair',
      'Keep your wingman alive (optional)',
    ],
    aircraft: 'kestrel',
    gold: 240,
    silver: 420,
    build(s, m) {
      m.flight(s, 'wing', 'blue', ['kestrel'], 1, ahead(s, -300, 0, 400), s.player.body.heading, 'veteran', {
        label: 'COBRA',
      });
      const o1 = m.objective('Destroy the first pair of bandits');
      const o2 = m.objective('Destroy the second pair');
      const o3 = m.objective('Keep Cobra 1 alive', false);
      const p1 = ahead(s, 9000, 2400, -1500);
      m.flight(s, 'wave1', 'red', ['kestrel'], 2, p1, headingTo(p1, s.player.body.position), 'rookie');
      s.radio('MAGIC', 'Viper, Magic. Two bandits, bullseye one-eight-zero, twelve thousand. Weapons free.');
      m.on(
        (_s, mm) => mm.alive('wave1') === 0,
        (ss, mm) => {
          o1.done = true;
          const p2 = ahead(ss, 11000, 3000, 2000);
          mm.flight(
            ss,
            'wave2',
            'red',
            ['kestrel', 'wyvern'],
            2,
            p2,
            headingTo(p2, ss.player.body.position),
            'rookie',
          );
          ss.radio('MAGIC', 'New group, two contacts, closing from the east.');
        },
      );
      m.on(
        (_s, mm) => mm.total('wave2') > 0 && mm.alive('wave2') === 0,
        () => {
          o2.done = true;
        },
      );
      m.on(
        (_s, mm) => mm.alive('wing') === 0,
        () => {
          o3.failed = true;
        },
      );
      m.on(
        (_s, mm) => o2.done && mm.alive('wing') > 0,
        () => {
          o3.done = true;
        },
      );
    },
  },
  {
    id: 'tanker-track',
    number: 2,
    title: 'Tanker Track',
    map: 'kessel',
    briefing:
      'SHEPHERD, our tanker, is holding on the track over the strait. Four Borzoi interceptors are coming for it in two waves. Nothing gets within missile range of the tanker.',
    objectives: ['Protect SHEPHERD', 'Destroy both interceptor waves'],
    aircraft: 'kestrel',
    gold: 300,
    silver: 480,
    build(s, m) {
      const tankerPos = ahead(s, 3000, 5200, 0);
      const tanker = m.flight(s, 'tanker', 'blue', ['mule'], 1, tankerPos, s.player.body.heading, 'veteran', {
        passive: true,
        speed: 170,
        label: 'SHEPHERD',
      })[0]!;
      tanker.label = 'SHEPHERD';
      const pilot = s.sim.pilots.get(tanker);
      if (pilot) pilot.patrolPoint.copy(tankerPos);
      const protect = m.objective('Protect SHEPHERD');
      const waves = m.objective('Destroy both interceptor waves');
      const spawnWave = (ss: Session, mm: MissionRules, group: string, lateral: number) => {
        const p = ahead(ss, 16000, 7000, lateral);
        mm.flight(ss, group, 'red', ['borzoi'], 2, p, headingTo(p, tanker.body.position), 'veteran');
      };
      spawnWave(s, m, 'wave1', -3000);
      s.radio('SHEPHERD', 'Shepherd on station. Keep them off me.');
      m.on(
        (_s, mm) => mm.alive('wave1') === 0,
        (ss, mm) => {
          spawnWave(ss, mm, 'wave2', 4000);
          ss.radio('MAGIC', 'Second pair, fast movers, high.');
        },
      );
      m.on(
        (_s, mm) => mm.total('wave2') > 0 && mm.alive('wave2') === 0,
        () => {
          waves.done = true;
          protect.done = true;
        },
      );
      m.on(
        () => !tanker.alive,
        () => {
          protect.failed = true;
        },
      );
    },
  },
  {
    id: 'canyon-run',
    number: 3,
    title: 'Canyon Run',
    map: 'mesa',
    briefing:
      'Three early-warning radars watch the canyon mouth, covered by SAM sites on the rim. Fly the canyon below the rim where their radars cannot see you and destroy all three radars.',
    objectives: ['Destroy three radar sites', 'Stay low: SAMs cover everything above the rim'],
    aircraft: 'wyvern',
    gold: 300,
    silver: 480,
    build(s, m) {
      const center = mapCenterOf(s);
      const target = new Vector3(center.x + 6000, 0, center.z - 6000);
      m.ground(s, 'radars', 'radar', 3, target, 2200);
      m.ground(s, 'sams', 'sam', 3, target, 3200);
      m.ground(s, 'aaa', 'aaa', 2, target, 1500);
      const o = m.objective('Destroy three radar sites');
      m.objective('Stay below the canyon rim', false).done = true;
      s.radio('INTEL', 'Radars are on the canyon floor. The rim sites will engage anything they can see.');
      m.on(
        (_s, mm) => mm.alive('radars') === 0,
        () => {
          o.done = true;
        },
      );
    },
  },
  {
    id: 'dust-line',
    number: 4,
    title: 'Dust Line',
    map: 'mesa',
    briefing:
      'Two Mules from Anvil flight are striking the fuel farm at the dry lake. Varen fighters will try to stop them. Escort Anvil to the target and back out.',
    objectives: [
      'Anvil flight reaches the target',
      'At least one Mule survives',
      'Destroy the escort fighters (optional)',
    ],
    aircraft: 'harrow',
    gold: 360,
    silver: 540,
    build(s, m) {
      const center = mapCenterOf(s);
      const fuel = m.ground(s, 'fuel', 'fuel', 2, new Vector3(center.x - 4000, 0, center.z - 7000), 800);
      const start = ahead(s, 800, 1800, 600);
      const strikers = m.flight(
        s,
        'anvil',
        'blue',
        ['mule'],
        2,
        start,
        headingTo(start, fuel[0]!.position),
        'veteran',
        { passive: true, speed: 190, label: 'ANVIL' },
      );
      for (const a of strikers) {
        const pilot = s.sim.pilots.get(a);
        if (pilot) pilot.patrolPoint.copy(fuel[0]!.position).setY(fuel[0]!.position.y + 900);
      }
      const reach = m.objective('Anvil reaches the fuel farm');
      const survive = m.objective('At least one Mule survives');
      const fighters = m.objective('Destroy the escort fighters', false);
      const p = ahead(s, 14000, 4000, -2500);
      m.flight(s, 'fighters', 'red', ['wyvern', 'kestrel'], 3, p, headingTo(p, start), 'veteran');
      s.radio('ANVIL', 'Anvil two-ship, pushing. Keep them off us.');
      m.on(
        () => strikers.some((a) => a.alive && a.body.position.distanceTo(fuel[0]!.position) < 2500),
        (ss) => {
          reach.done = true;
          for (const f of fuel) f.applyDamage(1000, null, strikers.find((x) => x.alive) ?? null);
          ss.radio('ANVIL', 'Bombs away. Target destroyed. Egressing.');
        },
      );
      m.on(
        () => strikers.every((a) => !a.alive),
        () => {
          survive.failed = true;
        },
      );
      m.on(
        () => reach.done,
        () => {
          survive.done = strikers.some((a) => a.alive);
        },
      );
      m.on(
        (_s, mm) => mm.alive('fighters') === 0,
        () => {
          fighters.done = true;
        },
      );
    },
  },
  {
    id: 'cold-water',
    number: 5,
    title: 'Cold Water',
    map: 'norrdal',
    briefing:
      'The dam is protected by a ring of SAM sites and flak below the cloud deck. Take down the air defenses so the strike package can follow. Use the valleys; the deck hides you from above.',
    objectives: ['Destroy four SAM sites', 'Destroy the flak batteries (optional)'],
    aircraft: 'wyvern',
    gold: 360,
    silver: 600,
    build(s, m) {
      const center = mapCenterOf(s);
      const dam =
        s.world.groundTargets.find((g) => g.group.includes('dam'))?.position ??
        new Vector3(center.x + 5000, 0, center.z - 5000);
      m.ground(s, 'sams', 'sam', 4, dam, 2800);
      m.ground(s, 'aaa', 'aaa', 3, dam, 1400);
      const o = m.objective('Destroy four SAM sites');
      const f = m.objective('Destroy the flak batteries', false);
      m.on(
        (_s, mm) => mm.alive('sams') === 0,
        () => {
          o.done = true;
        },
      );
      m.on(
        (_s, mm) => mm.alive('aaa') === 0,
        () => {
          f.done = true;
        },
      );
    },
  },
  {
    id: 'above-the-deck',
    number: 6,
    title: 'Above the Deck',
    map: 'norrdal',
    briefing:
      'A veteran squadron is using the cloud deck for cover. Two will come over the top, two will come up through it. Clear the airspace.',
    objectives: ['Destroy the four veterans'],
    aircraft: 'harrow',
    gold: 300,
    silver: 480,
    build(s, m) {
      const deck = s.world.cloudDeck;
      const above = ahead(s, 12000, (deck?.top ?? 2600) + 1500, -1500);
      const below = ahead(s, 10000, (deck?.base ?? 1500) - 300, 2000);
      m.flight(
        s,
        'high',
        'red',
        ['wyvern', 'harrow'],
        2,
        above,
        headingTo(above, s.player.body.position),
        'veteran',
      );
      m.flight(s, 'low', 'red', ['wyvern'], 2, below, headingTo(below, s.player.body.position), 'veteran');
      const o = m.objective('Destroy the four veterans');
      m.on(
        (_s, mm) => mm.alive('high') + mm.alive('low') === 0,
        () => {
          o.done = true;
        },
      );
    },
  },
  {
    id: 'lights-out',
    number: 7,
    title: 'Lights Out',
    map: 'varen',
    briefing:
      'Night strike on the Varen command post in the harbor district. Expect a SAM belt on the ridge and flak along the waterfront. Take out the command post; everything else is optional.',
    objectives: ['Destroy the command post', 'Suppress the SAM belt (optional)'],
    aircraft: 'wyvern',
    gold: 360,
    silver: 600,
    build(s, m) {
      const center = mapCenterOf(s);
      const cmd = m.ground(s, 'command', 'command', 1, new Vector3(center.x, 0, center.z - 8000), 500);
      m.ground(s, 'sams', 'sam', 4, cmd[0]!.position, 3500);
      m.ground(s, 'aaa', 'aaa', 4, cmd[0]!.position, 1600);
      const o = m.objective('Destroy the command post');
      const sams = m.objective('Suppress the SAM belt', false);
      m.on(
        (_s, mm) => mm.alive('command') === 0,
        () => {
          o.done = true;
        },
      );
      m.on(
        (_s, mm) => mm.alive('sams') === 0,
        () => {
          sams.done = true;
        },
      );
    },
  },
  {
    id: 'typhoon',
    number: 8,
    title: 'Typhoon',
    map: 'typhoon',
    briefing:
      'An anti-ship strike is inbound on the carrier group under the storm. Intercept the Mules before they reach launch range and deal with their escort.',
    objectives: ['Protect the carrier group', 'Destroy the strike aircraft'],
    aircraft: 'harrow',
    gold: 360,
    silver: 600,
    build(s, m) {
      const ship = m.ground(s, 'fleet', 'ship', 2, new Vector3(0, 0, 3000), 800, 'blue');
      for (const g of ship) g.speed = 10;
      const strikePos = ahead(s, 18000, 1200, 0);
      const strikers = m.flight(
        s,
        'strike',
        'red',
        ['mule'],
        3,
        strikePos,
        headingTo(strikePos, ship[0]!.position),
        'veteran',
        { passive: true, speed: 200 },
      );
      for (const a of strikers) {
        const pilot = s.sim.pilots.get(a);
        if (pilot) pilot.patrolPoint.copy(ship[0]!.position).setY(600);
      }
      const escortPos = ahead(s, 15000, 4000, 2500);
      m.flight(
        s,
        'escort',
        'red',
        ['borzoi', 'wyvern'],
        2,
        escortPos,
        headingTo(escortPos, s.player.body.position),
        'veteran',
      );
      const protect = m.objective('Protect the carrier group');
      const kill = m.objective('Destroy the strike aircraft');
      m.on(
        () => strikers.some((a) => a.alive && a.body.position.distanceTo(ship[0]!.position) < 5000),
        (ss) => {
          for (const g of ship) g.applyDamage(2000, null, strikers.find((x) => x.alive) ?? null);
          protect.failed = true;
          ss.radio('MOTHER', 'Vampire, vampire. We are hit.');
        },
      );
      m.on(
        (_s, mm) => mm.alive('strike') === 0,
        () => {
          kill.done = true;
          protect.done = true;
        },
      );
    },
  },
  {
    id: 'splash-one',
    number: 9,
    title: 'Splash One',
    map: 'kessel',
    briefing:
      'The Varen aces who have been hunting our patrols are airborne and heading for the strait. This is the fight that ends it. Four aces, no support.',
    objectives: ['Destroy the enemy aces'],
    aircraft: 'nightjar',
    gold: 360,
    silver: 600,
    build(s, m) {
      const p = ahead(s, 13000, 4500, 0);
      m.flight(
        s,
        'aces',
        'red',
        ['nightjar', 'harrow', 'borzoi', 'wyvern'],
        4,
        p,
        headingTo(p, s.player.body.position),
        'ace',
        { label: 'KARST' },
      );
      const o = m.objective('Destroy the enemy aces');
      s.radio('KARST 1', 'Karst flight, engaging. The one in front is mine.');
      m.on(
        (_s, mm) => mm.alive('aces') === 0,
        () => {
          o.done = true;
        },
      );
    },
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((x) => x.id === id);
}

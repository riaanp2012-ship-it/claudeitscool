import { Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import type { KillEvent } from '../combat/targetable';
import type { AircraftId, InstantActionOptions, Team } from '../core/types';
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
 * Instant Action dogfight (spec §5.1): configurable teams, skill, weapons rules, respawns and limits.
 */
const ENEMY_MIX: Record<InstantActionOptions['skill'], AircraftId[]> = {
  rookie: ['kestrel', 'wyvern', 'kestrel'],
  veteran: ['wyvern', 'harrow', 'kestrel', 'borzoi'],
  ace: ['harrow', 'borzoi', 'wyvern', 'nightjar'],
};

export class InstantActionRules implements ModeRules {
  readonly title = 'INSTANT ACTION';
  readonly subtitle: string;
  private readonly o: InstantActionOptions;
  private blueScore = 0;
  private redScore = 0;
  private readonly respawnQueue: {
    team: Team;
    index: number;
    at: number;
    type: AircraftId;
    label: string;
  }[] = [];
  private startTime = 0;
  private ended: ModeResult | null = null;
  private readonly availableTypes: (id: AircraftId) => boolean;

  constructor(options: InstantActionOptions, mapName: string, availableTypes: (id: AircraftId) => boolean) {
    this.o = options;
    this.subtitle = mapName;
    this.availableTypes = availableTypes;
  }

  private enemyType(i: number): AircraftId {
    const mix = ENEMY_MIX[this.o.skill].filter(this.availableTypes);
    return mix[i % Math.max(1, mix.length)] ?? 'kestrel';
  }

  start(s: Session): void {
    this.startTime = s.time;
    this.spawnAt(s, 'blue', 0, this.o.aircraft, 'VIPER 1', true);
    for (let i = 0; i < this.o.allies; i++)
      this.spawnAt(s, 'blue', i + 1, this.o.aircraft, spawnLabel('blue', i + 1), false);
    for (let i = 0; i < this.o.enemies; i++)
      this.spawnAt(s, 'red', i, this.enemyType(i), spawnLabel('red', i), false);
    s.radio(
      'MAGIC',
      `Picture: ${this.o.enemies === 1 ? 'single group' : `${this.o.enemies} contacts`}, bullseye north. Weapons free.`,
    );
  }

  private spawnAt(
    s: Session,
    team: Team,
    index: number,
    type: AircraftId,
    label: string,
    player: boolean,
  ): Aircraft {
    const spawns = s.world.airSpawns[team];
    const sp = spawns[index % spawns.length]!;
    const pos = sp.position.clone();
    // Spread extra aircraft sideways if spawns run out.
    const lap = Math.floor(index / spawns.length);
    if (lap > 0)
      pos.add(new Vector3(Math.cos(sp.heading), 0, Math.sin(sp.heading)).multiplyScalar(lap * 350));
    pos.y = Math.max(pos.y, s.world.surfaceAt(pos.x, pos.z) + 800);
    const ac = s.spawn({
      def: AIRCRAFT[type],
      team,
      label,
      isPlayer: player,
      rule: this.o.weapons,
      skill: team === 'red' ? this.o.skill : this.o.skill === 'rookie' ? 'veteran' : this.o.skill,
      position: pos,
      heading: sp.heading,
      speed: 220,
    });
    if (player || this.o.respawn) ac.spawnProtection = s.time > 1 ? 3 : 0;
    return ac;
  }

  step(s: Session): void {
    if (this.ended) return;
    // Respawns
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i]!;
      if (s.time >= r.at) {
        this.respawnQueue.splice(i, 1);
        this.spawnAt(s, r.team, r.index, r.type, r.label, false);
      }
    }
    this.ended = this.checkEnd(s);
  }

  onKill(s: Session, e: KillEvent): void {
    const victim = e.victim as unknown as Aircraft;
    if (victim.team === 'red') this.blueScore++;
    else this.redScore++;
    if (this.o.respawn && !victim.isPlayer) {
      const index = s.sim.aircraft.filter((a) => a.team === victim.team).indexOf(victim);
      this.respawnQueue.push({
        team: victim.team,
        index: Math.max(0, index),
        at: s.time + 8,
        type: victim.def.id,
        label: victim.label,
      });
    }
  }

  onPlayerDown(s: Session): boolean {
    if (!this.o.respawn || this.ended) return false;
    const old = s.player;
    this.spawnAt(s, 'blue', 0, this.o.aircraft, 'VIPER 1', true);
    s.despawn(old);
    return true;
  }

  private checkEnd(s: Session): ModeResult | null {
    const elapsed = s.time - this.startTime;
    const limit = this.o.timeLimit * 60;
    const redAlive =
      s.sim.aircraft.some((a) => a.team === 'red' && a.alive) ||
      this.respawnQueue.some((r) => r.team === 'red');
    const playerAlive = s.player?.alive ?? false;
    if (this.o.scoreLimit > 0 && this.blueScore >= this.o.scoreLimit)
      return this.make(s, 'success', 'VICTORY');
    if (this.o.scoreLimit > 0 && this.redScore >= this.o.scoreLimit) return this.make(s, 'failure', 'DEFEAT');
    if (limit > 0 && elapsed >= limit) {
      if (this.blueScore > this.redScore) return this.make(s, 'success', 'VICTORY');
      if (this.blueScore < this.redScore) return this.make(s, 'failure', 'DEFEAT');
      return this.make(s, 'ended', 'DRAW');
    }
    if (!this.o.respawn) {
      if (!redAlive) return this.make(s, 'success', 'AIRSPACE CLEAR');
      if (!playerAlive && s.playerDownTimer < 0) return this.make(s, 'failure', 'SHOT DOWN');
    }
    return null;
  }

  private make(s: Session, outcome: ModeResult['outcome'], title: string): ModeResult {
    const st = s.stats;
    const medal =
      outcome !== 'success'
        ? 'none'
        : st.deaths === 0 && st.kills >= 3
          ? 'gold'
          : st.deaths === 0
            ? 'silver'
            : 'bronze';
    return {
      outcome,
      title,
      medal,
      xp: st.kills * 100 + st.assists * 40 + (outcome === 'success' ? 250 : 0),
      stats: [
        { label: 'Score', value: `${this.blueScore} – ${this.redScore}` },
        { label: 'Enemy skill', value: this.o.skill.toUpperCase() },
      ],
    };
  }

  result(): ModeResult | null {
    return this.ended;
  }

  private readonly objective: HudObjective = { text: '', done: false, failed: false };
  private readonly objectiveList: HudObjective[] = [this.objective];
  private lastRedAlive = -1;
  private readonly scoreBox = new ScoreBox();
  private scoreKey = -1;
  private leftText = '';
  private rightText = '';

  objectives(s: Session): readonly HudObjective[] {
    let redAlive = 0;
    for (const a of s.sim.aircraft) if (a.team === 'red' && a.alive) redAlive++;
    if (redAlive !== this.lastRedAlive) {
      this.lastRedAlive = redAlive;
      if (this.o.scoreLimit > 0) this.objective.text = `First to ${this.o.scoreLimit} kills`;
      else if (!this.o.respawn) this.objective.text = `Destroy all bandits  (${redAlive} remaining)`;
      else this.objective.text = 'Win the air battle';
      this.objective.done = !this.o.respawn && this.o.scoreLimit === 0 && redAlive === 0;
    }
    return this.objectiveList;
  }

  score(s: Session): { left: string; right: string; timer: string } {
    const elapsed = s.time - this.startTime;
    const limit = this.o.timeLimit * 60;
    const key = this.blueScore * 1000 + this.redScore;
    if (key !== this.scoreKey) {
      this.scoreKey = key;
      this.leftText = `BLUE ${this.blueScore}`;
      this.rightText = `RED ${this.redScore}`;
    }
    return this.scoreBox.set(this.leftText, this.rightText, limit > 0 ? limit - elapsed : elapsed);
  }
}

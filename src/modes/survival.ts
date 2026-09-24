import type { Aircraft } from '../aircraft/aircraft';
import type { AiSkill } from '../ai/pilot';
import type { KillEvent } from '../combat/targetable';
import type { AircraftId, MapId } from '../core/types';
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
 * Survival (spec §5.1): endless escalating waves. Each wave adds bandits and raises their skill;
 * the player is repaired and rearmed between waves. One life.
 */
export interface SurvivalOptions {
  map: MapId;
  aircraft: AircraftId;
}

const WAVE_TYPES: AircraftId[] = ['kestrel', 'wyvern', 'harrow', 'borzoi', 'nightjar'];

export class SurvivalRules implements ModeRules {
  readonly title = 'SURVIVAL';
  readonly subtitle: string;
  private readonly o: SurvivalOptions;
  private readonly available: (id: AircraftId) => boolean;
  wave = 0;
  points = 0;
  private waveKills = 0;
  private enemies: Aircraft[] = [];
  private nextWaveAt = -1;
  private ended: ModeResult | null = null;
  private readonly objective: HudObjective = { text: '', done: false, failed: false };
  private readonly objectiveList = [this.objective];
  private objectiveKey = '';
  private readonly box = new ScoreBox();
  private leftText = '';
  private rightText = '';
  private startTime = 0;

  constructor(options: SurvivalOptions, mapName: string, available: (id: AircraftId) => boolean) {
    this.o = options;
    this.subtitle = mapName;
    this.available = available;
  }

  start(s: Session): void {
    const sp = s.world.airSpawns.blue[0]!;
    const pos = sp.position.clone();
    pos.y = Math.max(pos.y, s.world.surfaceAt(pos.x, pos.z) + 900);
    s.spawn({
      def: AIRCRAFT[this.o.aircraft],
      team: 'blue',
      label: 'VIPER 1',
      isPlayer: true,
      rule: 'standard',
      position: pos,
      heading: sp.heading,
      speed: 220,
    });
    this.startTime = s.time;
    this.nextWaveAt = s.time + 3;
  }

  private launchWave(s: Session): void {
    this.wave++;
    this.waveKills = 0;
    const count = Math.min(10, 1 + Math.floor(this.wave * 0.8));
    const skill: AiSkill = this.wave < 3 ? 'rookie' : this.wave < 6 ? 'veteran' : 'ace';
    const types = WAVE_TYPES.filter(this.available);
    const spawns = s.world.airSpawns.red;
    this.enemies = [];
    for (let i = 0; i < count; i++) {
      const sp = spawns[i % spawns.length]!;
      const pos = sp.position.clone();
      pos.y = Math.max(pos.y, s.world.surfaceAt(pos.x, pos.z) + 900);
      const type =
        types[Math.min(types.length - 1, Math.floor((this.wave + i) / 3) % Math.max(1, types.length))] ??
        'kestrel';
      this.enemies.push(
        s.spawn({
          def: AIRCRAFT[type],
          team: 'red',
          label: spawnLabel('red', i),
          rule: 'standard',
          skill,
          position: pos,
          heading: sp.heading,
          speed: 230,
        }),
      );
    }
    s.showMessage(
      `WAVE ${this.wave}`,
      `${count} bandit${count === 1 ? '' : 's'} · ${skill.toUpperCase()}`,
      3,
    );
    s.radio('MAGIC', `New group inbound, ${count} contact${count === 1 ? '' : 's'}.`);
  }

  step(s: Session): void {
    if (this.ended) return;
    if (this.nextWaveAt >= 0 && s.time >= this.nextWaveAt) {
      this.nextWaveAt = -1;
      this.launchWave(s);
    }
    if (this.nextWaveAt < 0 && this.wave > 0 && this.enemies.every((e) => !e.alive)) {
      // Wave cleared: repair and rearm the player, then send the next wave.
      const p = s.player;
      if (p.alive) {
        p.repair();
        for (const st of p.stations) st.rounds = st.capacity;
        p.gunAmmo = p.def.gunAmmo;
        p.flares = p.def.flares;
        p.chaff = p.def.chaff;
        this.points += 250 * this.wave;
        s.showMessage('WAVE CLEARED', 'Repaired and rearmed', 3);
      }
      this.nextWaveAt = s.time + 6;
      this.enemies = [];
    }
  }

  onKill(_s: Session, e: KillEvent): void {
    if (e.victim.team === 'red' && e.killer?.isPlayer) {
      this.waveKills++;
      this.points += 100 * this.wave;
    }
  }

  onPlayerDown(s: Session): boolean {
    this.ended = {
      outcome: 'ended',
      title: `SURVIVED ${this.wave - 1} WAVE${this.wave - 1 === 1 ? '' : 'S'}`,
      medal: this.wave > 8 ? 'gold' : this.wave > 5 ? 'silver' : this.wave > 2 ? 'bronze' : 'none',
      xp: Math.round(this.points / 4) + s.stats.kills * 60,
      stats: [
        { label: 'Waves cleared', value: String(Math.max(0, this.wave - 1)) },
        { label: 'Score', value: String(this.points) },
      ],
    };
    return false;
  }

  objectives(): readonly HudObjective[] {
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    const key = `${this.wave}:${alive}`;
    if (key !== this.objectiveKey) {
      this.objectiveKey = key;
      this.objective.text =
        this.wave === 0
          ? 'Stand by for the first wave'
          : `Wave ${this.wave}: ${alive} bandit${alive === 1 ? '' : 's'} left`;
    }
    return this.objectiveList;
  }

  private labelKey = -1;

  score(s: Session): { left: string; right: string; timer: string } {
    const key = this.wave * 1e7 + this.points;
    if (key !== this.labelKey) {
      this.labelKey = key;
      this.leftText = `WAVE ${this.wave}`;
      this.rightText = `SCORE ${this.points}`;
    }
    return this.box.set(this.leftText, this.rightText, s.time - this.startTime);
  }

  result(): ModeResult | null {
    return this.ended;
  }
}

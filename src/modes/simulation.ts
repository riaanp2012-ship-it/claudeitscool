import { Vector3 } from 'three';
import { AiPilot, type AiContext, type AiWorld } from '../ai/pilot';
import type { Aircraft } from '../aircraft/aircraft';
import { Combat } from '../combat/combat';
import type { DamageSource, KillEvent, Targetable } from '../combat/targetable';
import { updateLock } from '../combat/targeting';
import { rng } from '../core/rng';
import type { HardpointKind, OrdnanceModelFactory } from '../core/types';
import type { Missile } from '../combat/missiles';
import type { FlightEvent } from '../flight/flightModel';

/**
 * Headless simulation core: aircraft, AI, weapons, damage and kill credit. The game session wraps it
 * with rendering/audio; tests run it directly in Node (AI soak test, determinism).
 */
export interface SimWorld extends AiWorld {
  lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
}

export interface SimListener {
  onKill?(e: KillEvent): void;
  onHit?(target: Targetable, shooter: Aircraft | null, damage: number, weapon: string): void;
  onMissileLaunch?(owner: Aircraft, kind: HardpointKind, missile: Missile): void;
  onMissileDefeated?(missile: Missile, reason: string): void;
  onDestroyed?(ac: Aircraft, cause: 'weapon' | 'crash' | 'water' | 'collision'): void;
  onWreckImpact?(ac: Aircraft, water: boolean): void;
  onLanding?(ac: Aircraft, event: FlightEvent): void;
}

const KILL_CREDIT_WINDOW = 25; // s

export class Simulation implements AiContext {
  time = 0;
  readonly aircraft: Aircraft[] = [];
  readonly targets: Targetable[] = [];
  readonly pilots = new Map<Aircraft, AiPilot>();
  readonly combat: Combat;
  readonly world: SimWorld;
  readonly kills: KillEvent[] = [];
  listener: SimListener = {};
  private readonly losTimers = new Map<Aircraft, number>();
  private readonly losClear = new Map<Aircraft, boolean>();
  private readonly attackCount = new Map<Aircraft, number>();
  private readonly lastWeaponHit = new Map<Targetable, string>();

  constructor(world: SimWorld, ordnance: OrdnanceModelFactory | null) {
    this.world = world;
    this.combat = new Combat(ordnance, world);
    this.combat.targets = this.targets;
    this.combat.events = {
      onHit: (target, shooter, damage, weapon) => {
        this.lastWeaponHit.set(target, weapon);
        this.listener.onHit?.(target, shooter, damage, weapon);
      },
      onMissileLaunch: (owner, kind, missile) => this.listener.onMissileLaunch?.(owner, kind, missile),
      onMissileDefeated: (missile, reason) => this.listener.onMissileDefeated?.(missile, reason),
    };
  }

  add(ac: Aircraft, pilot: AiPilot | null = null): void {
    this.aircraft.push(ac);
    this.targets.push(ac);
    if (pilot) this.pilots.set(ac, pilot);
    this.losTimers.set(ac, rng.range(0, 0.2));
    this.losClear.set(ac, true);
  }

  remove(ac: Aircraft): void {
    const i = this.aircraft.indexOf(ac);
    if (i >= 0) this.aircraft.splice(i, 1);
    const j = this.targets.indexOf(ac);
    if (j >= 0) this.targets.splice(j, 1);
    this.pilots.delete(ac);
    this.lastWeaponHit.delete(ac);
    this.losTimers.delete(ac);
    this.losClear.delete(ac);
  }

  addTarget(t: Targetable): void {
    this.targets.push(t);
  }

  attackersOf(target: Aircraft): number {
    return this.attackCount.get(target) ?? 0;
  }

  step(dt: number): void {
    this.time += dt;
    // Fairness bookkeeping for the AI (how many are attacking each aircraft).
    this.attackCount.clear();
    for (const p of this.pilots.values()) {
      if (p.ac.alive && p.state === 'engage' && p.target) {
        this.attackCount.set(p.target, (this.attackCount.get(p.target) ?? 0) + 1);
      }
    }
    for (const ac of this.aircraft) ac.beginStep();
    for (const p of this.pilots.values()) p.update(dt, this);

    for (const ac of this.aircraft) {
      if (ac.alive) {
        // Terrain line of sight for locks, refreshed at 5 Hz per aircraft.
        let timer = (this.losTimers.get(ac) ?? 0) - dt;
        if (timer <= 0) {
          timer = 0.2;
          const t = ac.target;
          this.losClear.set(ac, !t || !this.world.lineOfSightBlocked(ac.body.position, t.position));
        }
        this.losTimers.set(ac, timer);
        updateLock(ac, dt, this.losClear.get(ac) ?? true);
        this.combat.stepGun(ac, dt);
      }
      const wasAlive = ac.alive;
      const event = ac.step(dt, this.world);
      if (!wasAlive) {
        if (event === 'crash-ground' || event === 'crash-water')
          this.listener.onWreckImpact?.(ac, event === 'crash-water');
        continue;
      }
      if (event === 'crash-ground' || event === 'crash-water') {
        this.destroy(ac, event === 'crash-water' ? 'water' : 'crash', 'terrain');
      } else if (event === 'touchdown' || event === 'hard-landing') {
        this.listener.onLanding?.(ac, event);
        if (event === 'hard-landing') ac.applyDamage(ac.maxHp.fuselage * 0.15, 'fuselage', null);
      }
    }

    this.combat.step(dt);

    // Deaths from damage
    for (const ac of this.aircraft) {
      if (ac.alive && ac.checkDestroyed()) this.destroy(ac, 'weapon', this.lastWeapon(ac));
    }
    this.midAirCollisions();
  }

  private lastWeapon(ac: Aircraft): string {
    return this.lastWeaponHit.get(ac) ?? 'gun';
  }

  private midAirCollisions(): void {
    const list = this.aircraft;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (!b.alive) continue;
        const r = (a.radius + b.radius) * 0.55;
        if (a.body.position.distanceToSquared(b.body.position) < r * r) {
          this.destroy(a, 'collision', 'collision');
          this.destroy(b, 'collision', 'collision');
        }
      }
    }
  }

  /** Kills an aircraft and credits the kill (last damager within the window, others assist). */
  destroy(ac: Aircraft, cause: 'weapon' | 'crash' | 'water' | 'collision', weapon: string): void {
    if (!ac.alive) return;
    ac.kill(this.time, [rng.next(), rng.next(), rng.next()]);
    const recent = ac.damageLog.filter((r) => r.age <= KILL_CREDIT_WINDOW);
    let killer: DamageSource | null = null;
    const assists: DamageSource[] = [];
    if (recent.length > 0) {
      killer = recent[recent.length - 1]!.source;
      for (const r of recent)
        if (r.source.uid !== killer.uid && !assists.some((a) => a.uid === r.source.uid))
          assists.push(r.source);
    }
    if (killer && killer.team === ac.team) killer = null; // no credit for friendly fire
    if (killer) {
      const killerAc = this.aircraft.find((x) => x.uid === killer!.uid);
      if (killerAc) killerAc.kills++;
    }
    const event: KillEvent = {
      victim: ac,
      killer,
      assists,
      weapon,
      cause: cause === 'weapon' ? 'weapon' : cause === 'collision' ? 'collision' : 'crash',
      time: this.time,
    };
    this.kills.push(event);
    this.listener.onDestroyed?.(ac, cause);
    this.listener.onKill?.(event);
  }

  /** Detaches everything (restart/quit). */
  clear(): void {
    this.combat.clear();
    this.aircraft.length = 0;
    this.targets.length = 0;
    this.pilots.clear();
    this.kills.length = 0;
    this.lastWeaponHit.clear();
    this.losTimers.clear();
    this.losClear.clear();
    this.time = 0;
  }
}

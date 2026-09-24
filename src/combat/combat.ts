import { Color, Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import type { AudioSystem, Fx, HardpointKind, OrdnanceModelFactory } from '../core/types';
import { rng } from '../core/rng';
import { CHAFF, FLARE, MISSILES, UNGUIDED, type MissileKind } from '../data/weapons';
import { BulletSystem } from './bullets';
import { DecoySystem } from './decoys';
import { MissileSystem, type DetonationKind, type Missile } from './missiles';
import { missileDefFor } from './targeting';
import type { DamagePart, Targetable } from './targetable';

/**
 * Owns every projectile system and routes hits, blasts and kills (spec §5.3, §5.5).
 * Player and AI fire through the same methods, so the AI has no special weapons (ZD-F11).
 */
export interface CombatEvents {
  onHit(target: Targetable, shooter: Aircraft | null, damage: number, weapon: string): void;
  onMissileLaunch(owner: Aircraft, kind: HardpointKind, missile: Missile): void;
  onMissileDefeated(missile: Missile, reason: string): void;
}

const _muzzle = new Vector3();
const _dir = new Vector3();
const _pos = new Vector3();
const _normal = new Vector3(0, 1, 0);
const _flash = new Color(3, 1.9, 1.0);

export class Combat {
  readonly bullets = new BulletSystem();
  readonly missiles: MissileSystem;
  readonly decoys = new DecoySystem();
  fx: Fx | null = null;
  audio: AudioSystem | null = null;
  targets: readonly Targetable[] = [];
  world: {
    heightAt(x: number, z: number): number;
    waterLevel: number;
    lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
  };
  events: CombatEvents | null = null;
  friendlyFire = false;
  /** Muzzle flashes are drawn once per frame, not per bullet. */
  private readonly firingThisFrame = new Set<Aircraft>();

  constructor(
    ordnance: OrdnanceModelFactory | null,
    world: {
      heightAt(x: number, z: number): number;
      waterLevel: number;
      lineOfSightBlocked(a: Vector3, b: Vector3): boolean;
    },
  ) {
    this.missiles = new MissileSystem(ordnance);
    this.world = world;
    this.decoys.onRelease = (d) => this.missiles.onDecoyReleased(d);
  }

  /** Gun: called every sim step for each aircraft; fires rounds at the gun's rate while the trigger is held. */
  stepGun(ac: Aircraft, dt: number): void {
    if (!ac.alive || !ac.gunTrigger || ac.gunAmmo <= 0) {
      ac.gunAccumulator = 0;
      return;
    }
    ac.gunAccumulator += dt * ac.gun.rate;
    const model = ac.model;
    while (ac.gunAccumulator >= 1 && ac.gunAmmo > 0) {
      ac.gunAccumulator -= 1;
      if (ac.rule !== 'unlimited') ac.gunAmmo--;
      ac.roundCounter++;
      if (model) ac.localToWorld(model.gunMuzzle, _muzzle);
      else _muzzle.copy(ac.body.position);
      ac.body.forward(_dir);
      // Guns are boresighted ~1.2 degrees nose-up, like real installations.
      _dir.addScaledVector(ac.body.up(_pos), 0.021).normalize();
      this.bullets.fire(
        ac,
        _muzzle,
        _dir,
        ac.gun.muzzleVelocity,
        ac.gun.dispersion,
        ac.gun.lifetime,
        ac.gun.damage,
        ac.roundCounter % ac.gun.tracerEvery === 0,
      );
      ac.shotsFired++;
    }
    this.firingThisFrame.add(ac);
  }

  /** Fires the selected weapon. Returns true if something launched. */
  fireSelected(ac: Aircraft, guidePoint: Vector3 | null = null): boolean {
    if (!ac.alive) return false;
    const kind = ac.selectedKind();
    if (!kind || kind === 'tank') return false;
    const cd = ac.cooldowns.get(kind) ?? 0;
    if (cd > 0) return false;
    const def = missileDefFor(kind);
    // Unlocked radar missiles cannot guide; don't waste them. IR/unguided can be fired boresight.
    if (def && def.seeker === 'radar' && !ac.locked) return false;
    const mount = ac.takeRound(kind);
    if (!mount) return false;
    ac.localToWorld(mount, _pos);
    const target = def ? (ac.locked ? ac.target : null) : kind === 'bomb' ? ac.target : null;
    const m = this.missiles.launch(ac, kind, _pos, target, guidePoint, this.fx);
    ac.cooldowns.set(
      kind,
      def ? def.cooldown : kind === 'rocketPod' ? UNGUIDED.rocketPod.cooldown : UNGUIDED.bomb.cooldown,
    );
    if (m) {
      this.audio?.play(
        kind === 'bomb' ? 'bombRelease' : kind === 'rocketPod' ? 'rocketLaunch' : 'missileLaunch',
        {
          position: _pos,
          velocity: ac.body.velocity,
          volume: ac.isPlayer ? 1 : 0.8,
        },
      );
      this.events?.onMissileLaunch(ac, kind, m);
    }
    return m !== null;
  }

  dropCountermeasure(ac: Aircraft, kind: 'flare' | 'chaff'): boolean {
    if (!ac.alive || ac.decoyCooldown > 0) return false;
    if (kind === 'flare' ? ac.flares <= 0 : ac.chaff <= 0) return false;
    const n = this.decoys.release(ac, kind, this.fx);
    if (n <= 0) return false;
    if (ac.rule !== 'unlimited') {
      if (kind === 'flare') ac.flares = Math.max(0, ac.flares - n);
      else ac.chaff = Math.max(0, ac.chaff - n);
    }
    ac.decoyCooldown = kind === 'flare' ? FLARE.cooldown : CHAFF.cooldown;
    this.audio?.play(kind, {
      position: ac.body.position,
      velocity: ac.body.velocity,
      volume: ac.isPlayer ? 0.9 : 0.6,
    });
    return true;
  }

  /** Advances projectiles one fixed step. */
  step(dt: number): void {
    this.bullets.friendlyFire = this.friendlyFire;
    this.decoys.step(dt);
    this.bullets.step(dt, this.targets, this.world, {
      onHit: (target, part, position, shooter, damage) => this.hit(target, part, position, shooter, damage),
      onImpact: (position, kind) => {
        if (rng.chance(0.35)) this.fx?.impact(position, _normal, kind);
      },
    });
    this.missiles.step(dt, this.targets, this.world, {
      onDetonate: (m, position, kind) => this.detonate(m, position, kind),
      onDefeated: (m, reason) => this.events?.onMissileDefeated(m, reason),
    });
  }

  private hit(
    target: Targetable,
    part: DamagePart,
    position: Vector3,
    shooter: Aircraft,
    damage: number,
  ): void {
    target.applyDamage(damage, part, shooter);
    shooter.shotsHit++;
    this.fx?.impact(position, _normal, 'metal');
    if (target.kind === 'aircraft' || target.kind === 'drone') {
      this.audio?.play((target as unknown as Aircraft).isPlayer ? 'hitTaken' : 'hitMetal', {
        position,
        volume: 0.7,
      });
    }
    this.events?.onHit(target, shooter, damage, shooter.gun.id);
  }

  private detonate(m: Missile, position: Vector3, kind: DetonationKind): void {
    const guided = m.guided;
    const blast = guided ? guided.blast : (m.unguided?.blast ?? 10);
    const damage = guided ? guided.damage : (m.unguided?.damage ?? 40);
    const owner = m.owner;
    for (const t of this.targets) {
      if (!t.alive) continue;
      if (!this.friendlyFire && owner && t.team === owner.team && (t as unknown) !== owner) continue;
      const d = Math.max(0, t.position.distanceTo(position) - t.radius * 0.5);
      if (d > blast) continue;
      // Splash damage does not pass through terrain (ZD-D11).
      if (d > 5 && this.world.lineOfSightBlocked(position, t.position)) continue;
      const falloff = Math.pow(1 - d / blast, 1.4);
      const amount = damage * (0.25 + 0.75 * falloff);
      t.applyDamage(amount, null, owner, position);
      this.events?.onHit(t, owner, amount, m.kind);
    }
    if (this.fx) {
      const fxKind =
        kind === 'water'
          ? 'water'
          : kind === 'ground'
            ? 'ground'
            : m.kind === 'bomb'
              ? 'air-large'
              : 'air-small';
      this.fx.explosion(position, fxKind);
      this.fx.flash(position, _flash, kind === 'air' ? 8 : 14, blast * 12, 0.35);
    }
    this.audio?.play(
      kind === 'water' ? 'explosionWater' : kind === 'ground' ? 'explosionGround' : 'explosionSmall',
      { position },
    );
  }

  /** Per-frame presentation: tracers, missile visuals, decoys, muzzle flashes. */
  present(): void {
    const fx = this.fx;
    if (!fx) return;
    this.bullets.present(fx);
    this.missiles.present(fx);
    this.decoys.present(fx);
    for (const ac of this.firingThisFrame) {
      if (!ac.model || !ac.alive) continue;
      _muzzle.copy(ac.model.gunMuzzle).applyQuaternion(ac.renderQuaternion).add(ac.renderPosition);
      _dir.set(0, 0, -1).applyQuaternion(ac.renderQuaternion);
      fx.muzzle(_muzzle, _dir, ac.gun.id === 'gun30' ? 1.3 : 1);
    }
    this.firingThisFrame.clear();
  }

  clear(): void {
    this.bullets.clear();
    this.missiles.clear();
    this.decoys.clear();
    this.firingThisFrame.clear();
  }
}

export function missileKindLabel(kind: HardpointKind): string {
  if (kind === 'rocketPod') return 'rockets';
  if (kind === 'bomb') return 'bomb';
  if (kind === 'tank') return 'tank';
  return MISSILES[kind as MissileKind].hud;
}

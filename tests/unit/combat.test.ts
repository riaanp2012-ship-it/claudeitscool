import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Aircraft } from '../../src/aircraft/aircraft';
import { BulletSystem } from '../../src/combat/bullets';
import { DecoySystem } from '../../src/combat/decoys';
import { MissileSystem } from '../../src/combat/missiles';
import type { DamagePart, Targetable } from '../../src/combat/targetable';
import { STEP } from '../../src/core/loop';
import { Rng, rng } from '../../src/core/rng';
import { AIRCRAFT } from '../../src/data/aircraft';

class DummyTarget implements Targetable {
  static next = 1000;
  readonly uid = DummyTarget.next++;
  readonly team = 'red' as const;
  readonly kind = 'aircraft' as const;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly radius = 7;
  readonly label = 'DUMMY';
  readonly rcs = 1;
  alive = true;
  hits = 0;
  heat(): number {
    return 1;
  }
  health(): number {
    return 1;
  }
  hitSegment(a: Vector3, b: Vector3): DamagePart | null {
    const ab = new Vector3().subVectors(b, a);
    const t = Math.max(
      0,
      Math.min(1, new Vector3().subVectors(this.position, a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)),
    );
    const p = a.clone().addScaledVector(ab, t);
    return p.distanceTo(this.position) <= 4 ? 'fuselage' : null;
  }
  applyDamage(): void {
    this.hits++;
  }
}

const world = { heightAt: () => 0, waterLevel: -100, lineOfSightBlocked: () => false };

function shooter(): Aircraft {
  const ac = new Aircraft({
    def: AIRCRAFT.kestrel,
    team: 'blue',
    label: 'TEST',
    isPlayer: false,
    rule: 'standard',
    model: null,
  });
  ac.body.reset(new Vector3(0, 3000, 0), 0, 250);
  return ac;
}

function runMissile(
  target: DummyTarget,
  launcher: Aircraft,
  systems: { missiles: MissileSystem; decoys?: DecoySystem },
  onStep?: (t: number) => void,
): { hit: boolean; missDistance: number } {
  const m = systems.missiles.launch(launcher, 'srm', launcher.body.position.clone(), target, null, null)!;
  let hit = false;
  let missDistance = Infinity;
  let t = 0;
  while (m.active && t < 30) {
    onStep?.(t);
    systems.decoys?.step(STEP);
    target.position.addScaledVector(target.velocity, STEP);
    systems.missiles.step(STEP, [target], world, {
      onDetonate: (_m, pos) => {
        missDistance = pos.distanceTo(target.position);
        hit = missDistance <= 8 + target.radius;
      },
    });
    t += STEP;
  }
  expect(Number.isFinite(m.position.x)).toBe(true);
  return { hit, missDistance };
}

describe('missiles', () => {
  it('proportional navigation hits non-maneuvering targets at least 95% of the time', () => {
    const r = new Rng(42);
    let hits = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const launcher = shooter();
      const missiles = new MissileSystem(null);
      const target = new DummyTarget();
      const range = r.range(1500, 4500);
      const bearing = r.range(-0.3, 0.3);
      target.position.set(Math.sin(bearing) * range, 3000 + r.range(-400, 400), -Math.cos(bearing) * range);
      const course = r.range(0, Math.PI * 2);
      target.velocity
        .set(Math.sin(course), r.range(-0.05, 0.05), -Math.cos(course))
        .normalize()
        .multiplyScalar(r.range(150, 300));
      if (runMissile(target, launcher, { missiles }).hit) hits++;
    }
    expect(hits / N).toBeGreaterThanOrEqual(0.95);
  });

  it('well-timed flares defeat IR missiles often, badly timed flares rarely', () => {
    const trial = (releaseAtRange: number, seed: number) => {
      rng.seed(seed);
      const r = new Rng(seed);
      let defeated = 0;
      const N = 150;
      for (let i = 0; i < N; i++) {
        const launcher = shooter();
        const missiles = new MissileSystem(null);
        const decoys = new DecoySystem();
        decoys.onRelease = (d) => missiles.onDecoyReleased(d);
        const target = new Aircraft({
          def: AIRCRAFT.kestrel,
          team: 'red',
          label: 'T',
          isPlayer: false,
          rule: 'standard',
          model: null,
        });
        target.body.reset(new Vector3(r.range(-300, 300), 3000, -3000), r.range(-0.5, 0.5), 220);
        const m = missiles.launch(launcher, 'srm', launcher.body.position.clone(), target, null, null)!;
        let released = false;
        let hit = false;
        let t = 0;
        while (m.active && t < 30) {
          if (!released && m.position.distanceTo(target.position) < releaseAtRange) {
            released = true;
            decoys.release(target, 'flare', null);
          }
          decoys.step(STEP);
          target.body.position.addScaledVector(target.body.velocity, STEP);
          missiles.step(STEP, [target], world, {
            onDetonate: (_m, pos) => {
              hit = pos.distanceTo(target.position) <= 8 + target.radius;
            },
          });
          t += STEP;
        }
        if (!hit) defeated++;
      }
      return defeated / N;
    };
    const good = trial(1500, 3);
    const late = trial(200, 4);
    expect(good).toBeGreaterThan(0.45);
    expect(late).toBeLessThan(0.3);
  });
});

describe('bullets', () => {
  it('fast rounds never tunnel through a small target', () => {
    const b = new BulletSystem(64);
    const ac = shooter();
    const target = new DummyTarget();
    target.position.set(0, 3000, -600);
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      b.fire(ac, new Vector3(0, 3000, 0), new Vector3(0, 0, -1), 1050, 0, 2, 9, false);
      for (let s = 0; s < 120; s++) {
        b.step(STEP, [target], world, { onHit: () => hits++, onImpact: () => undefined });
      }
    }
    expect(hits).toBe(40);
  });
});

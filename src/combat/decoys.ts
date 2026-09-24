import { Color, Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import type { Team, TrailHandle } from '../core/types';
import { rng } from '../core/rng';
import { CHAFF, FLARE } from '../data/weapons';

/** Flares and chaff (spec §5.3). Missiles evaluate them when they are released. */
export class Decoy {
  active = false;
  kind: 'flare' | 'chaff' = 'flare';
  team: Team = 'blue';
  owner: Aircraft | null = null;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  age = 0;
  life = 0;
  trail: TrailHandle | null = null;
  /** Missiles pull toward decoys through this velocity when seduced. */
  get alive(): boolean {
    return this.active;
  }
}

const FLARE_COLOR = new Color(3.2, 2.2, 1.2);
const CHAFF_COLOR = new Color(0.9, 0.9, 0.95);
const _side = new Vector3();
const _down = new Vector3();

export class DecoySystem {
  readonly items: Decoy[] = [];
  /** Called for each decoy released so the missile system can roll seduction checks. */
  onRelease: ((decoy: Decoy) => void) | null = null;

  constructor(capacity = 160) {
    for (let i = 0; i < capacity; i++) this.items.push(new Decoy());
  }

  release(
    owner: Aircraft,
    kind: 'flare' | 'chaff',
    fx: { trail(kind: 'flare'): TrailHandle | null } | null,
  ): number {
    const spec = kind === 'flare' ? FLARE : CHAFF;
    let released = 0;
    for (let n = 0; n < spec.salvo; n++) {
      const d = this.items.find((x) => !x.active);
      if (!d) break;
      d.active = true;
      d.kind = kind;
      d.team = owner.team;
      d.owner = owner;
      d.age = 0;
      d.life = spec.life;
      d.position.copy(owner.body.position);
      owner.body.right(_side).multiplyScalar(n % 2 === 0 ? -1 : 1);
      owner.body.up(_down).multiplyScalar(-1);
      d.velocity
        .copy(owner.body.velocity)
        .addScaledVector(_down, spec.ejectSpeed)
        .addScaledVector(_side, spec.ejectSpeed * 0.6 + rng.range(-4, 4));
      d.trail = kind === 'flare' && fx ? fx.trail('flare') : null;
      released++;
      this.onRelease?.(d);
    }
    return released;
  }

  step(dt: number): void {
    for (const d of this.items) {
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= d.life) {
        this.deactivate(d);
        continue;
      }
      // Heavy drag: decoys decelerate quickly and fall away from the aircraft.
      d.velocity.multiplyScalar(Math.exp(-(d.kind === 'flare' ? 1.4 : 3) * dt));
      d.velocity.y -= (d.kind === 'flare' ? 9.81 : 2) * dt;
      d.position.addScaledVector(d.velocity, dt);
    }
  }

  present(fx: { glow(p: Vector3, c: Color, size: number, intensity: number): void }): void {
    for (const d of this.items) {
      if (!d.active) continue;
      const fade = 1 - d.age / d.life;
      if (d.kind === 'flare') {
        d.trail?.push(d.position, fade);
        fx.glow(d.position, FLARE_COLOR, 6, 3 * fade + 0.5);
      } else {
        fx.glow(d.position, CHAFF_COLOR, 3.5, 0.25 * fade);
      }
    }
  }

  private deactivate(d: Decoy): void {
    d.active = false;
    d.owner = null;
    d.trail?.release();
    d.trail = null;
  }

  clear(): void {
    for (const d of this.items) if (d.active) this.deactivate(d);
  }
}

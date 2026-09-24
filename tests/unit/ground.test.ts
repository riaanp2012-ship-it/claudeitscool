import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Aircraft } from '../../src/aircraft/aircraft';
import { GroundTarget } from '../../src/combat/groundTarget';
import { STEP } from '../../src/core/loop';
import { rng } from '../../src/core/rng';
import { AIRCRAFT } from '../../src/data/aircraft';
import { Simulation } from '../../src/modes/simulation';

function setup(blocked: boolean) {
  rng.seed(5);
  const sim = new Simulation(
    { heightAt: () => 0, waterLevel: -10, boundary: 16000, lineOfSightBlocked: () => blocked },
    null,
  );
  const sam = new GroundTarget('sam', 'red', new Vector3(0, 0, 0), 0, 'test', 1);
  sim.addGround(sam);
  const ac = new Aircraft({
    def: AIRCRAFT.kestrel,
    team: 'blue',
    label: 'V1',
    isPlayer: false,
    rule: 'standard',
    model: null,
  });
  ac.body.reset(new Vector3(-6000, 3000, 0), Math.PI / 2, 220);
  sim.add(ac);
  let launches = 0;
  sim.listener = { onMissileLaunch: (owner) => owner === sam && launches++ };
  for (let i = 0; i < 120 * 20; i++) sim.step(STEP);
  return { launches, sam };
}

describe('ground units', () => {
  it('a SAM site tracks, locks and fires at an aircraft in range', () => {
    expect(setup(false).launches).toBeGreaterThan(0);
  });

  it('a SAM site never fires through terrain', () => {
    expect(setup(true).launches).toBe(0);
  });
});

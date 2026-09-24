import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AiPilot, type AiSkill } from '../../src/ai/pilot';
import { Aircraft } from '../../src/aircraft/aircraft';
import { STEP } from '../../src/core/loop';
import { rng } from '../../src/core/rng';
import type { AircraftId } from '../../src/core/types';
import { AIRCRAFT } from '../../src/data/aircraft';
import { Simulation, type SimWorld } from '../../src/modes/simulation';

const heightAt = (x: number, z: number) =>
  350 + 650 * Math.sin(x / 2800) * Math.cos(z / 2300) + 200 * Math.sin(z / 900 + x / 1300);
const world: SimWorld = {
  heightAt,
  waterLevel: 0,
  boundary: 16000,
  lineOfSightBlocked(a: Vector3, b: Vector3) {
    for (let i = 1; i < 16; i++) {
      const t = i / 16;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      if (y < heightAt(x, z)) return true;
    }
    return false;
  },
};

function battle(seed: number, skill: AiSkill, seconds: number) {
  rng.seed(seed);
  const sim = new Simulation(world, null);
  const types: AircraftId[] = ['kestrel', 'harrow', 'wyvern', 'borzoi'];
  for (let i = 0; i < 8; i++) {
    const team = i < 4 ? 'blue' : 'red';
    const def = AIRCRAFT[types[i % 4]!];
    const ac = new Aircraft({
      def,
      team,
      label: `${team}${i}`,
      isPlayer: false,
      rule: 'standard',
      model: null,
    });
    const z = team === 'blue' ? 6000 : -6000;
    ac.body.reset(
      new Vector3((i % 4) * 700 - 1000, 2600 + (i % 2) * 300, z),
      team === 'blue' ? 0 : Math.PI,
      230,
    );
    const pilot = new AiPilot(ac, skill, seed * 31 + i);
    pilot.state = 'engage';
    sim.add(ac, pilot);
  }
  let terrainCrashes = 0;
  let nan = false;
  sim.listener = {
    onDestroyed: (ac, cause) => {
      if ((cause === 'crash' || cause === 'water') && ac.damageLog.every((r) => r.age > 25)) terrainCrashes++;
    },
  };
  const steps = Math.round(seconds / STEP);
  for (let s = 0; s < steps; s++) {
    sim.step(STEP);
    if (s % 600 === 0) {
      for (const ac of sim.aircraft) if (!Number.isFinite(ac.body.position.y)) nan = true;
    }
  }
  const kills = sim.kills.filter((k) => k.killer !== null).length;
  return { terrainCrashes, kills, nan, deaths: sim.kills.length };
}

describe('AI', () => {
  it.each([
    [11, 'veteran'],
    [12, 'ace'],
    [13, 'rookie'],
  ] as const)('seed %i (%s): no terrain crashes, kills happen, no NaN', (seed, skill) => {
    const r = battle(seed, skill, 150);
    expect(r.nan).toBe(false);
    expect(r.terrainCrashes).toBe(0);
    expect(r.kills).toBeGreaterThanOrEqual(2);
  });
});

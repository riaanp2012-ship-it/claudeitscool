import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Aircraft } from '../../src/aircraft/aircraft';
import { CameraRig } from '../../src/camera/rig';
import { STEP } from '../../src/core/loop';
import { AIRCRAFT } from '../../src/data/aircraft';
import { Instructor, PLAYER_GAINS } from '../../src/flight/instructor';

/** Flies the Kestrel with WASD-style aim steering: turn/pitch are key states (-1, 0, 1). */
function fly(turn: number, pitch: number, seconds: number) {
  const ac = new Aircraft({
    def: AIRCRAFT.kestrel,
    team: 'blue',
    label: 'V1',
    isPlayer: true,
    rule: 'standard',
    model: null,
  });
  ac.body.reset(new Vector3(0, 3000, 0), 0, 220);
  ac.body.throttle = 0.9;
  ac.controls.throttle = 0.9;
  ac.beginStep();
  ac.interpolate(1);
  const rig = new CameraRig(new PerspectiveCamera(70, 16 / 9, 0.3, 1e5));
  rig.snapTo(ac);
  const pilot = new Instructor();
  const nose = new Vector3();
  const env = { heightAt: () => 0, waterLevel: -100 };
  let maxOff = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    rig.steerAim(turn * 0.75 * STEP, pitch * 0.6 * STEP, ac.body.forward(nose));
    rig.update(ac, STEP, () => 0);
    maxOff = Math.max(maxOff, Math.acos(Math.min(1, rig.aimDir.dot(ac.body.forward(nose)))));
    pilot.update(ac.body, rig.aimDir, PLAYER_GAINS, ac.controls);
    ac.beginStep();
    ac.step(STEP, env);
    ac.interpolate(1);
  }
  return { heading: ac.body.heading, altitude: ac.body.position.y, maxOff, alive: ac.alive };
}

describe('keyboard steering (WASD)', () => {
  it('holding D turns right and holds altitude', () => {
    const r = fly(1, 0, 6);
    expect(r.heading).toBeGreaterThan(0.8); // more than ~45 degrees to the right
    expect(Math.abs(r.altitude - 3000)).toBeLessThan(350);
    expect(r.maxOff).toBeLessThan(1.2); // the aim never runs away from the nose
  });

  it('holding A turns left', () => {
    const r = fly(-1, 0, 6);
    expect(r.heading).toBeLessThan(-0.8);
  });

  it('holding W climbs and S dives', () => {
    expect(fly(0, 1, 4).altitude).toBeGreaterThan(3150);
    expect(fly(0, -1, 4).altitude).toBeLessThan(2850);
  });
});

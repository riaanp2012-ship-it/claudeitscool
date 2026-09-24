import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FixedStep, STEP } from '../../src/core/loop';
import { atmosphere } from '../../src/core/math';
import { Rng } from '../../src/core/rng';
import { AIRCRAFT, AIRCRAFT_IDS } from '../../src/data/aircraft';
import { FlightBody, neutralInputs, type FlightEnvironment } from '../../src/flight/flightModel';
import { Instructor, PLAYER_GAINS } from '../../src/flight/instructor';

const flatEnv: FlightEnvironment = {
  heightAt: () => 0,
  waterLevel: -1000,
  collisionPoints: [new Vector3(0, 0, -7), new Vector3(-4.7, 0, 1), new Vector3(4.7, 0, 1)],
  gearContactY: -2,
};

function levelDir(heading: number): Vector3 {
  return new Vector3(Math.sin(heading), 0, -Math.cos(heading));
}

describe('flight model', () => {
  it.each(AIRCRAFT_IDS)('%s reaches its published top speed within 5%%', (id) => {
    const def = AIRCRAFT[id];
    const body = new FlightBody(def);
    body.options.unlimitedFuel = true;
    const alt = def.stats.topSpeedMach < 1 ? 1000 : 11000;
    const atm = { rho: 0, a: 0, tempK: 0 };
    atmosphere(alt, atm);
    body.reset(new Vector3(0, alt, 0), 0, def.stats.topSpeedMach * atm.a * 0.85);
    body.fuel = def.fuelMax * 0.5;
    body.storesMass = 600;
    const input = neutralInputs();
    input.throttle = 1;
    input.afterburner = true;
    const dir = new Vector3();
    const pilot = new Instructor();
    for (let i = 0; i < 120 * 420; i++) {
      // Hold altitude: aim slightly up/down proportional to the altitude error.
      const err = (alt - body.position.y) / 2000;
      dir.copy(levelDir(0));
      dir.y = Math.max(-0.1, Math.min(0.1, err));
      dir.normalize();
      pilot.update(body, dir, PLAYER_GAINS, input);
      body.step(STEP, input, flatEnv);
    }
    expect(Math.abs(body.mach / def.stats.topSpeedMach - 1)).toBeLessThan(0.05);
  });

  it('holds altitude with a neutral stick in Standard mode', () => {
    const body = new FlightBody(AIRCRAFT.kestrel);
    body.reset(new Vector3(0, 3000, 0), 0, 210);
    const input = neutralInputs();
    input.throttle = 0.72;
    let maxDev = 0;
    for (let i = 0; i < 120 * 10; i++) {
      body.step(STEP, input, flatEnv);
      maxDev = Math.max(maxDev, Math.abs(body.position.y - 3000));
    }
    expect(maxDev).toBeLessThan(15);
  });

  it('never exceeds the G limit in Standard mode with full back stick', () => {
    for (const id of AIRCRAFT_IDS) {
      const def = AIRCRAFT[id];
      const body = new FlightBody(def);
      body.reset(new Vector3(0, 3000, 0), 0, 280);
      const input = neutralInputs();
      input.throttle = 1;
      input.pitch = 1;
      let maxG = 0;
      for (let i = 0; i < 120 * 4; i++) {
        body.step(STEP, input, flatEnv);
        maxG = Math.max(maxG, body.g);
      }
      expect(maxG).toBeLessThan(def.gLimit * 1.06);
      expect(maxG).toBeGreaterThan(def.gLimit * 0.6);
    }
  });

  it('stalls in Sim mode when pulled hard at low speed, but not in Standard', () => {
    const sim = new FlightBody(AIRCRAFT.kestrel);
    sim.options.mode = 'sim';
    sim.reset(new Vector3(0, 3000, 0), 0, 95);
    const std = new FlightBody(AIRCRAFT.kestrel);
    std.reset(new Vector3(0, 3000, 0), 0, 95);
    const input = neutralInputs();
    input.throttle = 0.3;
    input.pitch = 1;
    let simStalled = false;
    let stdStalled = false;
    for (let i = 0; i < 120 * 3; i++) {
      sim.step(STEP, input, flatEnv);
      std.step(STEP, input, flatEnv);
      simStalled ||= sim.stalled;
      stdStalled ||= std.stalled;
    }
    expect(simStalled).toBe(true);
    expect(stdStalled).toBe(false);
  });

  it('instructor turns onto a target 90 degrees right without oscillating', () => {
    const body = new FlightBody(AIRCRAFT.kestrel);
    body.reset(new Vector3(0, 3000, 0), 0, 220);
    const input = neutralInputs();
    input.throttle = 0.85;
    const target = levelDir(Math.PI / 2);
    const fwd = new Vector3();
    let errAfter = Infinity;
    let maxLateErr = 0;
    const pilot = new Instructor();
    for (let i = 0; i < 120 * 14; i++) {
      pilot.update(body, target, PLAYER_GAINS, input);
      body.step(STEP, input, flatEnv);
      const err = Math.acos(Math.min(1, body.forward(fwd).dot(target)));
      if (i === 120 * 10) errAfter = err;
      if (i > 120 * 10) maxLateErr = Math.max(maxLateErr, err);
    }
    expect(errAfter).toBeLessThan(0.06);
    expect(maxLateErr).toBeLessThan(0.06);
    expect(Math.abs(body.position.y - 3000)).toBeLessThan(400);
  });

  it('produces identical results regardless of how frames are chunked', () => {
    const run = (frameDt: number) => {
      const body = new FlightBody(AIRCRAFT.wyvern);
      body.reset(new Vector3(0, 2000, 0), 1, 230);
      const input = neutralInputs();
      input.throttle = 0.9;
      input.pitch = 0.4;
      input.roll = 0.3;
      const loop = new FixedStep();
      let steps = 0;
      let snapshot: Vector3 | null = null;
      while (!snapshot) {
        loop.advance(frameDt, 1, (dt) => {
          if (snapshot) return;
          body.step(dt, input, flatEnv);
          steps++;
          if (steps === 600) snapshot = body.position.clone();
        });
      }
      return snapshot as Vector3;
    };
    const a = run(1 / 30);
    const b = run(1 / 60);
    const c = run(1 / 144);
    const d = run(1 / 240);
    expect(a.equals(b)).toBe(true);
    expect(b.equals(c)).toBe(true);
    expect(c.equals(d)).toBe(true);
  });

  it('never produces NaN under random inputs', () => {
    const rng = new Rng(7);
    for (const id of AIRCRAFT_IDS) {
      const body = new FlightBody(AIRCRAFT[id]);
      body.options.mode = rng.chance(0.5) ? 'sim' : 'standard';
      body.reset(new Vector3(0, 6000, 0), rng.range(0, 6), rng.range(40, 400));
      const input = neutralInputs();
      for (let i = 0; i < 120 * 30; i++) {
        if (i % 30 === 0) {
          input.pitch = rng.range(-1, 1);
          input.roll = rng.range(-1, 1);
          input.yaw = rng.range(-1, 1);
          input.throttle = rng.next();
          input.afterburner = rng.chance(0.3);
        }
        body.step(STEP, input, flatEnv);
        if (body.position.y < 500) body.position.y = 6000;
      }
      expect(Number.isFinite(body.position.x + body.position.y + body.position.z)).toBe(true);
      expect(Number.isFinite(body.quaternion.w)).toBe(true);
      expect(Math.abs(body.quaternion.length() - 1)).toBeLessThan(1e-6);
    }
  });
});

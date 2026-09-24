import { Quaternion, Vector3 } from 'three';
import { G0, atmosphere, clamp, clamp01, dampFactor, lerp, safeNormalize, smoothstep } from '../core/math';
import type { AircraftDef } from '../data/aircraft';

/**
 * Semi-sim flight model (spec §5.4). Forces: thrust, lift, drag (with transonic wave drag), side force,
 * gravity. Rotation is a rate-command model with authority scaled by dynamic pressure, a G limiter and an
 * AoA limiter in Standard mode, stall nose-drop and auto-coordination. Orientation is a quaternion only.
 *
 * Axes: body nose -Z, up +Y, right +X. Pilot-convention rates: pitch up +, yaw right +, roll right +.
 */

export interface ControlInputs {
  pitch: number; // -1..1, positive = nose up
  roll: number; // -1..1, positive = roll right
  yaw: number; // -1..1, positive = nose right
  throttle: number; // 0..1 commanded
  afterburner: boolean; // engaged when throttle is at 1 and this is set
  brake: boolean; // wheel brakes on the ground, airbrake in the air
  flaps: boolean;
  gearDown: boolean;
}

export const neutralInputs = (): ControlInputs => ({
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0.7,
  afterburner: false,
  brake: false,
  flaps: false,
  gearDown: false,
});

export interface FlightEnvironment {
  /** Ground height (terrain) at x/z. */
  heightAt(x: number, z: number): number;
  waterLevel: number;
  /** Local points (aircraft frame) tested against the ground every step. */
  collisionPoints: readonly Vector3[];
  /** Local Y of the wheels (negative) when the gear is down. */
  gearContactY: number;
}

export type FlightEvent = 'none' | 'crash-ground' | 'crash-water' | 'touchdown' | 'hard-landing';

export interface FlightOptions {
  mode: 'standard' | 'sim';
  autoLevel: boolean;
  unlimitedFuel: boolean;
}

const RHO0 = 1.225;
const _atm = { rho: RHO0, a: 340, tempK: 288 };
const _q = new Quaternion();
const _qInv = new Quaternion();
const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _vb = new Vector3();
const _vhat = new Vector3();
const _force = new Vector3();
const _tmp = new Vector3();
const _liftDir = new Vector3();
const _axis = new Vector3();
const _p = new Vector3();

/** Wave-drag multiplier curve on cd0, calibrated per aircraft so top speed matches its published Mach. */
export interface WaveDragCurve {
  machCrit: number;
  peak: number;
  machTop: number;
  atTop: number;
}

export function waveDrag(curve: WaveDragCurve, mach: number): number {
  const { machCrit, peak, machTop, atTop } = curve;
  if (machTop < 1) {
    // Subsonic airframe: drag rises from the critical Mach and becomes a wall just past top speed.
    if (mach <= machCrit) return 1;
    if (mach <= machTop) return lerp(1, atTop, smoothstep(machCrit, machTop, mach));
    return atTop * (1 + 12 * (mach - machTop));
  }
  if (mach <= machCrit) return 1;
  if (mach <= 1.05) return lerp(1, peak, smoothstep(machCrit, 1.05, mach));
  if (mach <= machTop) return lerp(peak, atTop, smoothstep(1.05, machTop, mach));
  return atTop * (1 + 6 * (mach - machTop));
}

/** Thrust in newtons for a given altitude/mach/throttle state. */
export function thrustAt(
  def: AircraftDef,
  altitude: number,
  mach: number,
  throttle: number,
  ab: number,
): number {
  atmosphere(altitude, _atm);
  const sigma = _atm.rho / RHO0;
  const lapse = Math.pow(sigma, 0.72);
  const dry = def.thrustDry * throttle * (1 + 0.12 * mach);
  const wet = def.thrustAB * (1 + 0.28 * mach);
  const hasAb = def.thrustAB > def.thrustDry * 1.01;
  const t = hasAb ? lerp(dry, wet, ab) : dry;
  // Subsonic turbofans lose thrust quickly past Mach 0.8.
  const ramLoss = hasAb ? 1 : clamp(1 - Math.max(0, mach - 0.75) * 1.5, 0.3, 1);
  return t * lapse * ramLoss;
}

/**
 * Solves for the wave-drag multiplier at top speed so level flight at the calibration altitude
 * with full thrust balances drag exactly at the aircraft's published top Mach.
 */
export function calibrateWaveDrag(def: AircraftDef): WaveDragCurve {
  const machTop = def.stats.topSpeedMach;
  const altitude = machTop < 1 ? 1000 : 11000;
  atmosphere(altitude, _atm);
  const v = machTop * _atm.a;
  const qbar = 0.5 * _atm.rho * v * v;
  const mass = def.massEmpty + def.fuelMax * 0.5 + 600;
  const ar = (def.design.span * def.design.span) / def.wingArea;
  const k = 1 / (Math.PI * def.oswald * ar);
  const cl = (mass * G0) / (qbar * def.wingArea);
  const thrust = thrustAt(def, altitude, machTop, 1, 1);
  const cdAvailable = thrust / (qbar * def.wingArea) - k * cl * cl;
  const atTop = Math.max(0.6, cdAvailable / def.cd0);
  return { machCrit: def.machCrit, peak: def.waveDragPeak, machTop, atTop };
}

export class FlightBody {
  readonly def: AircraftDef;
  readonly curve: WaveDragCurve;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly quaternion = new Quaternion();
  /** Pilot-convention body rates: x = pitch (up +), y = yaw (right +), z = roll (right +). rad/s */
  readonly rates = new Vector3();
  options: FlightOptions = { mode: 'standard', autoLevel: false, unlimitedFuel: false };

  // Systems
  throttle = 0.7; // spooled 0..1
  afterburner = 0; // spooled 0..1
  fuel: number;
  storesMass = 0;
  gear = 0; // 0 up .. 1 down (animated)
  flaps = 0;
  airbrake = 0;
  onGround = false;
  /** Multipliers from damage (1 = healthy). */
  thrustFactor = 1;
  liftFactor = 1;
  rollBias = 0; // -1..1 roll tendency from wing damage
  controlFactor = 1;

  // Derived each step (read by HUD, AI, audio)
  airspeed = 0;
  mach = 0;
  aoa = 0;
  beta = 0;
  g = 1;
  qbar = 0;
  stalled = false;
  overG = false;
  thrust = 0;
  /** Control surface positions for visuals, -1..1. */
  readonly surfaces = { aileron: 0, elevator: 0, rudder: 0 };

  private readonly aspect: number;
  private readonly inducedK: number;
  private readonly qCorner: number;

  constructor(def: AircraftDef) {
    this.def = def;
    this.curve = calibrateWaveDrag(def);
    this.fuel = def.fuelMax;
    this.aspect = (def.design.span * def.design.span) / def.wingArea;
    this.inducedK = 1 / (Math.PI * def.oswald * this.aspect);
    this.qCorner = 0.5 * RHO0 * def.cornerSpeed * def.cornerSpeed;
  }

  get mass(): number {
    return this.def.massEmpty + this.fuel + this.storesMass;
  }

  /** Places the aircraft in level flight heading `heading` (rad clockwise from north) at `speed`. */
  reset(position: Vector3, heading: number, speed: number): void {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(_axis.set(0, 1, 0), -heading);
    if (speed > 30) {
      atmosphere(position.y, _atm);
      const qbar = 0.5 * _atm.rho * speed * speed;
      const trim = clamp(
        (this.mass * G0) / (qbar * this.def.wingArea * this.def.clAlpha),
        0,
        this.def.alphaStall * 0.8,
      );
      this.quaternion.multiply(_q.setFromAxisAngle(_axis.set(1, 0, 0), trim));
      this.velocity.set(0, 0, -speed).applyQuaternion(_q.setFromAxisAngle(_axis.set(0, 1, 0), -heading));
    } else {
      this.velocity.set(0, 0, -speed).applyQuaternion(this.quaternion);
    }
    this.rates.set(0, 0, 0);
    this.throttle = 0.75;
    this.afterburner = 0;
    this.fuel = this.def.fuelMax;
    this.gear = 0;
    this.flaps = 0;
    this.airbrake = 0;
    this.onGround = false;
    this.stalled = false;
    this.overG = false;
    this.g = 1;
  }

  /** Places the aircraft on the ground (wheels on the surface) at rest. */
  resetOnGround(position: Vector3, heading: number, gearContactY: number): void {
    this.reset(position, heading, 0);
    this.position.y = position.y - gearContactY;
    this.gear = 1;
    this.onGround = true;
    this.throttle = 0;
  }

  forward(out: Vector3): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  up(out: Vector3): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  right(out: Vector3): Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  /** Pitch angle (rad) of the nose above the horizon. */
  get pitchAngle(): number {
    this.forward(_tmp);
    return Math.asin(clamp(_tmp.y, -1, 1));
  }

  /** Bank angle (rad), right wing down positive. */
  get bankAngle(): number {
    this.right(_right);
    this.up(_up);
    return Math.atan2(-_right.y, _up.y);
  }

  /** Heading (rad clockwise from north) of the nose. */
  get heading(): number {
    this.forward(_tmp);
    return Math.atan2(_tmp.x, -_tmp.z);
  }

  step(dt: number, input: ControlInputs, env: FlightEnvironment): FlightEvent {
    const def = this.def;
    const sim = this.options.mode === 'sim';

    // Engine spool and systems
    const hasFuel = this.fuel > 0 || this.options.unlimitedFuel;
    const throttleCmd = hasFuel ? clamp01(input.throttle) : 0;
    const abCmd = hasFuel && input.afterburner && throttleCmd > 0.98 ? 1 : 0;
    this.throttle += (throttleCmd - this.throttle) * dampFactor(1 / 0.9, dt);
    this.afterburner +=
      (abCmd - this.afterburner) * dampFactor(abCmd > this.afterburner ? 1 / 0.35 : 1 / 0.2, dt);
    this.gear = clamp01(this.gear + (input.gearDown ? dt : -dt) / 5.5);
    this.flaps = clamp01(this.flaps + (input.flaps ? dt : -dt) / 3);
    const wantAirbrake = input.brake && !this.onGround;
    this.airbrake = clamp01(this.airbrake + (wantAirbrake ? dt : -dt) / 1.2);
    if (!this.options.unlimitedFuel) {
      const burn =
        lerp(def.fuelBurnDry * 0.18, def.fuelBurnDry, this.throttle) +
        this.afterburner * (def.fuelBurnAB - def.fuelBurnDry);
      this.fuel = Math.max(0, this.fuel - burn * dt);
    }

    // Frame and air data
    const q = this.quaternion;
    _qInv.copy(q).invert();
    this.forward(_fwd);
    this.up(_up);
    this.right(_right);
    atmosphere(this.position.y, _atm);
    const speed = this.velocity.length();
    this.airspeed = speed;
    this.mach = speed / _atm.a;
    this.qbar = 0.5 * _atm.rho * speed * speed;
    _vb.copy(this.velocity).applyQuaternion(_qInv);
    const fwdSpeed = -_vb.z;
    if (speed > 2) {
      this.aoa = Math.atan2(-_vb.y, Math.max(fwdSpeed, 1e-3));
      this.beta = Math.atan2(_vb.x, Math.max(fwdSpeed, 1e-3));
      if (fwdSpeed < 0) {
        // Flying backwards (tail slide): treat as deep stall.
        this.aoa = Math.sign(-_vb.y || 1) * 1.2;
      }
    } else {
      this.aoa = 0;
      this.beta = 0;
    }
    const alpha = this.aoa;
    const absA = Math.abs(alpha);

    // Aerodynamic coefficients
    const aStall = def.alphaStall;
    let cl: number;
    if (absA <= aStall) cl = def.clAlpha * absA;
    else if (absA <= aStall + 0.35)
      cl = lerp(def.clAlpha * aStall, def.clAlpha * aStall * 0.72, (absA - aStall) / 0.35);
    else cl = Math.max(0, 1.05 * Math.sin(2 * absA));
    cl = Math.min(cl, def.clMax * 1.02) * Math.sign(alpha || 1);
    cl += this.flaps * 0.35 * Math.cos(absA);
    cl *= this.liftFactor;
    this.stalled = absA > aStall && speed > 5;
    const cdWave = def.cd0 * waveDrag(this.curve, this.mach);
    const cdStall = absA > aStall ? 1.1 * Math.sin(absA) * Math.sin(absA) : 0;
    const cd =
      cdWave +
      this.inducedK * cl * cl +
      cdStall +
      this.gear * 0.018 +
      this.flaps * 0.02 +
      this.airbrake * 0.055;

    // Forces (world)
    _force.set(0, -this.mass * G0, 0);
    if (speed > 0.5) {
      _vhat.copy(this.velocity).multiplyScalar(1 / speed);
      const qS = this.qbar * def.wingArea;
      _force.addScaledVector(_vhat, -qS * cd);
      _liftDir.crossVectors(_right, _vhat);
      safeNormalize(_liftDir, _up);
      _force.addScaledVector(_liftDir, qS * cl);
      _force.addScaledVector(_right, -qS * 0.55 * this.beta);
    }
    this.thrust = hasFuel
      ? thrustAt(def, this.position.y, this.mach, this.throttle, this.afterburner) * this.thrustFactor
      : 0;
    _force.addScaledVector(_fwd, this.thrust);

    // Accelerometer G (specific force along body up)
    const m = this.mass;
    this.g = (_force.dot(_up) + m * G0 * _up.y) / (m * G0);

    // Ground contact
    let event: FlightEvent = 'none';
    const ground = env.heightAt(this.position.x, this.position.z);
    const gearDown = this.gear > 0.98;
    const wheelY = this.position.y + env.gearContactY * _up.y;
    const onWater = env.waterLevel >= ground;
    if (gearDown && !onWater && wheelY <= ground + 0.05 && _up.y > 0.9) {
      if (!this.onGround) {
        const sink = -this.velocity.y;
        event = sink > 9 ? 'crash-ground' : sink > 4.5 ? 'hard-landing' : 'touchdown';
      }
      this.onGround = true;
      this.position.y = ground - env.gearContactY * _up.y;
      if (this.velocity.y < 0) this.velocity.y = 0;
      // Normal force cancels the downward part of the net force.
      if (_force.y < 0) _force.y = 0;
      // Rolling resistance and brakes along the ground track.
      const horiz = Math.hypot(this.velocity.x, this.velocity.z);
      if (horiz > 0.05) {
        const mu = input.brake ? 0.45 : 0.025;
        const normal = Math.max(0, this.mass * G0 - Math.max(0, _force.dot(_up)));
        const decel = (mu * normal) / m;
        const k = Math.min(1, (decel * dt) / horiz);
        this.velocity.x -= this.velocity.x * k;
        this.velocity.z -= this.velocity.z * k;
      }
    } else {
      this.onGround = false;
    }

    // Integrate linear motion (semi-implicit Euler)
    this.velocity.addScaledVector(_force, dt / m);
    if (this.onGround) {
      // No sideways skidding: wheels keep the velocity on the nose track.
      const along = this.velocity.x * _fwd.x + this.velocity.z * _fwd.z;
      const fl = Math.hypot(_fwd.x, _fwd.z) || 1;
      this.velocity.x = (_fwd.x / fl) * along;
      this.velocity.z = (_fwd.z / fl) * along;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    this.position.addScaledVector(this.velocity, dt);

    // Rotation: rate commands
    const authority = clamp(this.qbar / this.qCorner, 0.06, 1) * this.controlFactor;
    const rollAuth = Math.sqrt(authority);
    const pitchAuth = Math.sqrt(authority);
    const vForG = Math.max(speed, 40);
    const maxPitchUp = Math.min(def.pitchRate * pitchAuth, (def.gLimit * G0) / vForG);
    const maxPitchDown = Math.min(def.pitchRate * pitchAuth, (-def.gMin * G0) / vForG);
    let pitchCmd: number;
    const pin = clamp(input.pitch, -1, 1);
    // Neutral stick in Standard holds the flight path (1G-style auto-trim); input blends to rate command.
    const trimWeight = sim ? 0 : 1 - Math.min(1, Math.abs(pin) * 4);
    const gamma = speed > 1 ? Math.asin(clamp(this.velocity.y / speed, -1, 1)) : 0;
    const bank = Math.atan2(-_right.y, _up.y);
    const nTarget = clamp(Math.cos(gamma) * Math.cos(bank), -0.5, 1.2);
    const alphaTrim =
      this.qbar > 1
        ? clamp((nTarget * m * G0) / (this.qbar * def.wingArea * def.clAlpha), -0.1, aStall * 0.8)
        : 0;
    const trimRate = clamp((alphaTrim - alpha) * 6, -maxPitchDown, maxPitchUp);
    const stickRate = pin >= 0 ? pin * maxPitchUp : pin * maxPitchDown;
    pitchCmd = lerp(stickRate, trimRate, trimWeight);
    if (!sim) {
      // Closed-loop G limiter on top of the rate limit (catches lag and gravity components).
      const gHi = def.gLimit * 0.96;
      const gLo = def.gMin * 0.96;
      if (this.g > gHi) pitchCmd = Math.min(pitchCmd, this.rates.x - (this.g - gHi) * 0.12);
      if (this.g < gLo) pitchCmd = Math.max(pitchCmd, this.rates.x + (gLo - this.g) * 0.12);
      // AoA limiter
      const aLimit = aStall * 0.92;
      if (alpha > aLimit - 0.06 && pitchCmd > 0) pitchCmd *= clamp((aLimit - alpha) / 0.06, 0, 1);
      if (alpha > aLimit) pitchCmd = Math.min(pitchCmd, -(alpha - aLimit) * 4);
    }
    // Stall: the nose drops, more so at low speed.
    if (absA > aStall) pitchCmd -= Math.sign(alpha) * (absA - aStall) * 2.2;
    // Weathervane at very low dynamic pressure
    pitchCmd = lerp(pitchCmd, -alpha * 1.2, clamp01(1 - authority * 4) * 0.5);

    let rollCmd = clamp(input.roll + this.rollBias * 0.35, -1, 1) * def.rollRate * rollAuth;
    if (this.options.autoLevel && Math.abs(input.roll) < 0.05 && !this.onGround) {
      rollCmd += clamp(-bank * 1.5, -1, 1) * def.rollRate * 0.3 * rollAuth;
    }
    let yawCmd = clamp(input.yaw, -1, 1) * def.yawRate * authority;
    // Auto-coordination: kill sideslip
    yawCmd += clamp(this.beta * (sim ? 1.5 : 3.2), -0.5, 0.5);

    if (this.onGround) {
      // Wheels: level the wings, keep the nose on the ground until rotation speed, steer with rudder.
      rollCmd = clamp(-bank * 3, -1, 1);
      const theta = Math.asin(clamp(_fwd.y, -1, 1));
      const liftRatio = (this.qbar * def.wingArea * def.clAlpha * aStall * 0.6) / (m * G0);
      if (pin > 0.1 && liftRatio > 0.8) pitchCmd = pin * 0.18;
      else pitchCmd = clamp(-theta * 2, -0.3, 0.3);
      const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      yawCmd =
        input.yaw * 0.45 * clamp(groundSpeed / 8, 0.15, 1) * clamp(40 / Math.max(groundSpeed, 1), 0.2, 1);
    }

    const tauP = lerp(0.45, 0.22, pitchAuth);
    const tauR = lerp(0.3, 0.12, rollAuth);
    const tauY = 0.35;
    this.rates.x += (pitchCmd - this.rates.x) * dampFactor(1 / tauP, dt);
    this.rates.y += (yawCmd - this.rates.y) * dampFactor(1 / tauY, dt);
    this.rates.z += (rollCmd - this.rates.z) * dampFactor(1 / tauR, dt);

    // Integrate orientation: body axes (x = +pitch, y = -yaw, z = -roll).
    _axis.set(this.rates.x, -this.rates.y, -this.rates.z);
    const angle = _axis.length() * dt;
    if (angle > 1e-9) {
      _axis.normalize();
      _q.setFromAxisAngle(_axis, angle);
      q.multiply(_q).normalize();
    }

    // Visual control surface deflections
    const sd = dampFactor(12, dt);
    this.surfaces.aileron += (clamp(input.roll, -1, 1) - this.surfaces.aileron) * sd;
    this.surfaces.elevator += (clamp(input.pitch, -1, 1) - this.surfaces.elevator) * sd;
    this.surfaces.rudder += (clamp(input.yaw, -1, 1) - this.surfaces.rudder) * sd;

    // Structural limits
    this.overG = this.g > def.gLimit * 1.08 || this.g < def.gMin * 1.1;

    // Terrain / water collision (after integration)
    if (event === 'none' || event === 'touchdown' || event === 'hard-landing') {
      const surfaceHere = Math.max(env.heightAt(this.position.x, this.position.z), env.waterLevel);
      if (this.position.y < surfaceHere + 0.5 && !this.onGround) {
        event =
          surfaceHere <= env.waterLevel + 0.01 && env.waterLevel >= ground ? 'crash-water' : 'crash-ground';
      } else if (!this.onGround || !gearDown) {
        for (let i = 0; i < env.collisionPoints.length; i++) {
          _p.copy(env.collisionPoints[i]!).applyQuaternion(q).add(this.position);
          const h = env.heightAt(_p.x, _p.z);
          if (_p.y < h) {
            event = 'crash-ground';
            break;
          }
          if (_p.y < env.waterLevel && env.waterLevel > h) {
            event = 'crash-water';
            break;
          }
        }
      }
    }
    return event;
  }
}

import { Quaternion, Vector3 } from 'three';
import { clamp, lerp, smoothstep, wrapPi } from '../core/math';
import type { ControlInputs, FlightBody } from './flightModel';

/**
 * "Instructor" autopilot: flies the aircraft toward a world direction through the normal control inputs,
 * using the real flight model (spec §5.4 Mouse Aim, and the AI's virtual stick in §5.6).
 *
 * Far from the target it banks the lift vector onto the target and pulls. Close to the target it levels
 * the wings and uses pitch and rudder directly. A target just below the nose is handled by pushing
 * (with hysteresis) instead of rolling inverted, which avoids the classic "roll-over" oscillation.
 */
export interface InstructorGains {
  roll: number;
  rollDamp: number;
  pitch: number;
  pitchDamp: number;
  yaw: number;
  yawDamp: number;
  /** Angle (rad) around which the controller switches from banking to fine control. */
  levelAngle: number;
  /** Maximum stick deflection used (AI skill limits this). */
  maxStick: number;
}

export const PLAYER_GAINS: InstructorGains = {
  roll: 2.4,
  rollDamp: 0.3,
  pitch: 5,
  pitchDamp: 1.2,
  yaw: 2.6,
  yawDamp: 1.2,
  levelAngle: 0.16,
  maxStick: 1,
};

const _qInv = new Quaternion();
const _local = new Vector3();
const _right = new Vector3();
const _up = new Vector3();

export class Instructor {
  private push = false;
  /** Last computed angle between the nose and the target (rad). */
  angleOff = 0;

  reset(): void {
    this.push = false;
  }

  /**
   * Writes pitch/roll/yaw into `out`. `keepWingsLevel` levels the wings near the target (off for AI
   * maneuvers that want to hold a bank).
   */
  update(
    body: FlightBody,
    targetDir: Vector3,
    gains: InstructorGains,
    out: ControlInputs,
    keepWingsLevel = true,
  ): void {
    _qInv.copy(body.quaternion).invert();
    _local.copy(targetDir).applyQuaternion(_qInv);
    const len = _local.length();
    if (len < 1e-6) return;
    _local.multiplyScalar(1 / len);
    const fwd = -_local.z;
    const up = _local.y;
    const right = _local.x;
    const angleOff = Math.acos(clamp(fwd, -1, 1));
    this.angleOff = angleOff;

    const rollToTarget = Math.atan2(right, up); // roll that puts the target over the canopy
    const below = Math.abs(rollToTarget) > Math.PI * 0.55;
    if (!this.push && below && angleOff < 0.12) this.push = true;
    else if (this.push && (angleOff > 0.3 || !below)) this.push = false;

    body.right(_right);
    body.up(_up);
    const bank = Math.atan2(-_right.y, _up.y);
    // Near the target, hold a small bank toward it (how pilots make fine heading corrections).
    const yawErr = Math.atan2(right, Math.max(fwd, 0.05));
    const fineBank = clamp(yawErr * 5, -0.55, 0.55);
    const levelErr = keepWingsLevel ? fineBank - bank : 0;

    let rollTarget: number;
    let weight: number;
    if (this.push) {
      rollTarget = wrapPi(rollToTarget - Math.PI); // put the target under the belly
      weight = smoothstep(0.04, 0.2, angleOff);
    } else {
      rollTarget = rollToTarget;
      weight = smoothstep(gains.levelAngle * 0.35, gains.levelAngle, angleOff);
    }
    const rollAngle = lerp(levelErr, rollTarget, weight);
    let roll = rollAngle * gains.roll - body.rates.z * gains.rollDamp;

    // Pitch in the aircraft's symmetry plane. While the bank is still wrong, pull less.
    let pitchErr = Math.atan2(up, Math.max(fwd, 0.02));
    if (fwd < 0 && !this.push) pitchErr = Math.PI / 2;
    const alignment = clamp(Math.cos(rollTarget), 0, 1);
    const pullScale = this.push ? 1 : lerp(1, Math.max(0.2, alignment), weight);
    let pitch = pitchErr * gains.pitch * pullScale - body.rates.x * gains.pitchDamp;
    if (!this.push && weight > 0.5 && pitchErr > 0.25) pitch = Math.max(pitch, 0.25 * alignment);

    // Rudder trims the last few degrees horizontally.
    const yawWeight = 1 - smoothstep(0.08, 0.25, angleOff);
    let yaw = (yawErr * gains.yaw - body.rates.y * gains.yawDamp) * yawWeight;

    const m = gains.maxStick;
    roll = clamp(roll, -m, m);
    pitch = clamp(pitch, -m, m);
    yaw = clamp(yaw, -m, m);
    out.roll = roll;
    out.pitch = pitch;
    out.yaw = yaw;
  }
}

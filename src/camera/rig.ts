import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Aircraft } from '../aircraft/aircraft';
import { DEG, clamp, clamp01, dampFactor, safeNormalize } from '../core/math';

/**
 * Camera rigs (spec §5.11): mouse-aim chase, direct chase, cockpit, free look, target lock, death/kill cam.
 * Cameras use the interpolated render transforms and are updated after interpolation (ZD-G01, ZD-B35).
 * Smoothing is frame-rate independent; switches blend over ~200 ms (ZD-G02); shake uses smooth noise (ZD-G03).
 */
export type CameraView = 'chase' | 'cockpit';

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _target = new Vector3();
const _pos = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/** Smooth 1D value noise for camera shake. */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const x = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;
  view: CameraView = 'chase';
  /** Mouse aim: where the pilot wants to fly (world direction). */
  readonly aimQuat = new Quaternion();
  readonly aimDir = new Vector3(0, 0, -1);
  mouseAim = true;
  /** Rig orientation that the camera sits on (follows aim/aircraft smoothly). */
  private readonly rigQuat = new Quaternion();
  private readonly camPos = new Vector3();
  private readonly camQuat = new Quaternion();
  private blend = 1;
  private readonly blendFromPos = new Vector3();
  private readonly blendFromQuat = new Quaternion();
  baseFov = 70;
  /** 0..1 camera shake trauma; decays over time. */
  trauma = 0;
  shakeScale = 1;
  private time = 0;
  // Free look
  lookYaw = 0;
  lookPitch = 0;
  freeLook = false;
  targetLook: Vector3 | null = null;
  /** Orbit mode used after death (spectate the wreck / killer). */
  orbitTarget: Vector3 | null = null;
  private orbitAngle = 0;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Resets aim and camera behind the aircraft (spawn/respawn). */
  snapTo(ac: Aircraft): void {
    this.aimQuat.copy(ac.renderQuaternion);
    this.rigQuat.copy(ac.renderQuaternion);
    this.aimDir.set(0, 0, -1).applyQuaternion(this.aimQuat);
    this.lookYaw = this.lookPitch = 0;
    this.blend = 1;
    this.trauma = 0;
    this.orbitTarget = null;
    this.targetLook = null;
    this.computeChase(ac, this.camPos, this.camQuat);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  setView(view: CameraView): void {
    if (view === this.view) return;
    this.view = view;
    this.startBlend();
  }

  private startBlend(): void {
    this.blendFromPos.copy(this.camera.position);
    this.blendFromQuat.copy(this.camera.quaternion);
    this.blend = 0;
  }

  /** Applies mouse deltas (pixels) to the aim direction. */
  applyAimDelta(dx: number, dy: number, sensitivity: number, invert: boolean): void {
    const k = 0.0022 * sensitivity;
    // Rotate around the rig's own axes so loops through the vertical work.
    this.rigAxes();
    _q.setFromAxisAngle(_up, -dx * k);
    _q2.setFromAxisAngle(_right, (invert ? dy : -dy) * k);
    this.aimQuat.premultiply(_q).premultiply(_q2).normalize();
    this.aimDir.set(0, 0, -1).applyQuaternion(this.aimQuat);
  }

  private rigAxes(): void {
    _up.set(0, 1, 0).applyQuaternion(this.rigQuat);
    _right.set(1, 0, 0).applyQuaternion(this.rigQuat);
  }

  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount);
  }

  /** Per frame, after aircraft interpolation. */
  update(ac: Aircraft, dt: number, surfaceAt: (x: number, z: number) => number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const pos = this.camPos;
    const quat = this.camQuat;

    if (this.orbitTarget) {
      this.orbitAngle += dt * 0.25;
      _pos.set(Math.sin(this.orbitAngle) * 70, 25, Math.cos(this.orbitAngle) * 70).add(this.orbitTarget);
      pos.lerp(_pos, dampFactor(3, dt));
      _m.lookAt(pos, this.orbitTarget, WORLD_UP);
      quat.slerp(_q.setFromRotationMatrix(_m), dampFactor(5, dt));
    } else if (this.view === 'cockpit') {
      const eye = ac.model?.cockpitEye;
      _v.copy(eye ?? _v.set(0, 1, -ac.def.design.length * 0.3))
        .applyQuaternion(ac.renderQuaternion)
        .add(ac.renderPosition);
      pos.copy(_v);
      quat.copy(ac.renderQuaternion);
      if (this.freeLook || this.lookYaw !== 0 || this.lookPitch !== 0) {
        _q.setFromAxisAngle(_v.set(0, 1, 0), this.lookYaw);
        _q2.setFromAxisAngle(_v.set(1, 0, 0), this.lookPitch);
        quat.multiply(_q).multiply(_q2);
      }
      if (this.targetLook) {
        _m.lookAt(pos, this.targetLook, _up.set(0, 1, 0).applyQuaternion(ac.renderQuaternion));
        quat.setFromRotationMatrix(_m);
      }
    } else {
      this.updateRig(ac, dt);
      this.computeChase(ac, pos, quat);
      if (this.targetLook) {
        // Padlock: keep the target and our jet framed.
        _fwd.subVectors(this.targetLook, ac.renderPosition);
        safeNormalize(_fwd, _v.set(0, 0, -1));
        pos
          .copy(ac.renderPosition)
          .addScaledVector(_fwd, -this.chaseDistance(ac))
          .addScaledVector(WORLD_UP, 6);
        _m.lookAt(pos, this.targetLook, WORLD_UP);
        quat.setFromRotationMatrix(_m);
      } else if (this.freeLook || this.lookYaw !== 0 || this.lookPitch !== 0) {
        _q.setFromAxisAngle(_v.set(0, 1, 0), this.lookYaw);
        _q2.setFromAxisAngle(_v.set(1, 0, 0), this.lookPitch);
        _q.multiply(_q2);
        _fwd.set(0, 0, -1).applyQuaternion(quat).applyQuaternion(_q);
        const d = this.chaseDistance(ac);
        _v.copy(_fwd).multiplyScalar(-d);
        pos.copy(ac.renderPosition).add(_v).addScaledVector(WORLD_UP, 3);
        _m.lookAt(pos, ac.renderPosition, WORLD_UP);
        quat.setFromRotationMatrix(_m);
      }
    }

    // Keep the camera above the ground (ZD-B24).
    const floor = surfaceAt(pos.x, pos.z) + 2.5;
    if (pos.y < floor) pos.y = floor;

    // Blend between views
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.22);
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      pos.lerpVectors(this.blendFromPos, pos, t);
      quat.slerpQuaternions(this.blendFromQuat, quat, t);
    }

    this.camera.position.copy(pos);
    this.camera.quaternion.copy(quat);

    // Shake (smooth noise, squared trauma, scaled by the accessibility setting)
    const shake = this.trauma * this.trauma * this.shakeScale;
    if (shake > 0.001) {
      const t = this.time * 14;
      this.camera.rotateX(noise1(t, 1) * 0.02 * shake);
      this.camera.rotateY(noise1(t, 2) * 0.02 * shake);
      this.camera.rotateZ(noise1(t, 3) * 0.035 * shake);
    }
    // Buffet near the stall / at high G, very subtle.
    const buffet = ac.alive
      ? clamp01((Math.abs(ac.body.g) - 7) / 3) * 0.004 + (ac.body.stalled ? 0.004 : 0)
      : 0;
    if (buffet > 0 && this.shakeScale > 0)
      this.camera.rotateX(noise1(this.time * 30, 4) * buffet * this.shakeScale);

    // FOV: base plus a small speed effect (max +6 degrees, ZD-G06).
    const speedFov = this.view === 'chase' ? clamp((ac.body.airspeed - 150) / 350, 0, 1) * 6 : 0;
    const fov = clamp(this.baseFov + speedFov, 50, 100);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * dampFactor(3, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private chaseDistance(ac: Aircraft): number {
    return ac.def.design.length * 1.15 + 9;
  }

  /** The rig follows the mouse-aim direction (mouse aim) or the aircraft (direct control). */
  private updateRig(ac: Aircraft, dt: number): void {
    if (this.mouseAim) {
      _fwd.set(0, 0, -1).applyQuaternion(this.aimQuat);
      // Near vertical, keep the current rig up so loops don't flip the camera.
      const up = Math.abs(_fwd.y) > 0.9 ? _up.set(0, 1, 0).applyQuaternion(this.rigQuat) : _up.set(0, 1, 0);
      _m.lookAt(_v.set(0, 0, 0), _fwd, up);
      _q.setFromRotationMatrix(_m);
      this.rigQuat.slerp(_q, dampFactor(9, dt));
      // Re-derive the aim so it never rolls relative to the rig.
      _fwd.set(0, 0, -1).applyQuaternion(this.aimQuat);
      _m.lookAt(_v.set(0, 0, 0), _fwd, _up.set(0, 1, 0).applyQuaternion(this.rigQuat));
      this.aimQuat.setFromRotationMatrix(_m);
      this.aimDir.copy(_fwd);
    } else {
      // Direct control: follow the aircraft with lag, keeping part of its roll.
      _q.copy(ac.renderQuaternion);
      this.rigQuat.slerp(_q, dampFactor(5, dt));
      this.aimQuat.copy(this.rigQuat);
      this.aimDir.set(0, 0, -1).applyQuaternion(ac.renderQuaternion);
    }
  }

  private computeChase(ac: Aircraft, pos: Vector3, quat: Quaternion): void {
    const d = this.chaseDistance(ac);
    _fwd.set(0, 0, -1).applyQuaternion(this.rigQuat);
    _up.set(0, 1, 0).applyQuaternion(this.rigQuat);
    pos
      .copy(ac.renderPosition)
      .addScaledVector(_fwd, -d)
      .addScaledVector(_up, ac.def.design.height * 0.55 + 1.5);
    // Look slightly above the aircraft so it sits in the lower third of the frame.
    _target.copy(ac.renderPosition).addScaledVector(_fwd, 60).addScaledVector(_up, 3);
    _m.lookAt(pos, _target, _up);
    quat.setFromRotationMatrix(_m);
  }

  /** Degrees per pixel helper for the HUD. */
  pxPerRad(viewportHeight: number): number {
    return viewportHeight / 2 / Math.tan((this.camera.fov * DEG) / 2);
  }
}

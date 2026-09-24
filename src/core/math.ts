import { Quaternion, Vector3 } from 'three';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G0 = 9.80665;
export const KNOTS_PER_MS = 1.943844;
export const FEET_PER_M = 3.28084;
export const KMH_PER_MS = 3.6;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const sign = (v: number): number => (v < 0 ? -1 : 1);

/** Frame-rate independent exponential approach factor for a rate constant k (1/s). */
export const dampFactor = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
export const damp = (current: number, target: number, k: number, dt: number): number =>
  current + (target - current) * dampFactor(k, dt);

/** Wrap an angle to (-PI, PI]. */
export const wrapPi = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r <= -Math.PI) r += Math.PI * 2;
  return r;
};

/** acos that never returns NaN for inputs slightly outside [-1, 1] due to rounding. */
export const safeAcos = (v: number): number => Math.acos(clamp(v, -1, 1));

/** Normalizes in place; leaves a zero vector untouched instead of producing NaN. */
export function safeNormalize(v: Vector3, fallback?: Vector3): Vector3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len > 1e-9) v.multiplyScalar(1 / len);
  else if (fallback) v.copy(fallback);
  return v;
}

export function isFiniteVec(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuat(q: Quaternion): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

/** Speed of sound (m/s) and air density (kg/m^3) from the ISA model, valid to 20 km. */
export function atmosphere(altitude: number, out: { rho: number; a: number; tempK: number }): void {
  const h = clamp(altitude, -500, 20000);
  const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  const p = h < 11000 ? 101325 * Math.pow(T / 288.15, 5.2559) : 22632 * Math.exp(-0.000157688 * (h - 11000));
  out.tempK = T;
  out.rho = p / (287.05 * T);
  out.a = Math.sqrt(1.4 * 287.05 * T);
}

/**
 * Scratch objects for per-frame math. Each module takes its own named set so calls never alias.
 * Using these avoids allocating in hot loops.
 */
export function scratchVectors(count: number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < count; i++) out.push(new Vector3());
  return out;
}

export const WORLD_UP = Object.freeze(new Vector3(0, 1, 0)) as Vector3;

/** Formats a number with a fixed number of digits, returning '0' for non-finite input. */
export function fmt(v: number, digits = 0): string {
  return Number.isFinite(v) ? v.toFixed(digits) : (0).toFixed(digits);
}

export function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Fixed-timestep accumulator (spec §4.2). The simulation always advances in STEP increments, so results
 * are identical at 30, 60, 144 or 240 Hz render rates (ZD-C10). Hitches are clamped (ZD-C08, ZD-C09).
 */
export const SIM_HZ = 120;
export const STEP = 1 / SIM_HZ;
export const MAX_FRAME_DT = 0.1;
export const MAX_STEPS = 8;

export class FixedStep {
  private acc = 0;
  /** Interpolation factor between the previous and current simulation states, 0..1. */
  alpha = 0;
  /** Number of steps run in the last advance() call. */
  lastSteps = 0;

  /** Advances by a real frame delta; calls `step` zero or more times with STEP. */
  advance(frameDt: number, timeScale: number, step: (dt: number) => void): void {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT) * timeScale;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS && this.acc >= STEP) this.acc = 0;
    this.lastSteps = steps;
    this.alpha = this.acc / STEP;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}

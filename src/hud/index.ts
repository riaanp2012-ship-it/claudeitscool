import type { Hud } from '../core/types';
import { HudRenderer } from './renderer';

/**
 * Creates the HUD overlay. The game appends `hud.canvas` to its container (above the WebGL canvas),
 * calls `resize` with the viewport CSS size and device pixel ratio, and `draw(state, dt)` once per
 * frame after rendering.
 */
export function createHud(): Hud {
  return new HudRenderer();
}

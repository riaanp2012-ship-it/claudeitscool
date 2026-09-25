/**
 * Placement of off-screen contact arrows. Arrows ride an ellipse inscribed in the HUD safe area so
 * they stay clear of the corner panels, and point along the contact's screen direction.
 */

export interface Vec2Out {
  x: number;
  y: number;
}

/**
 * Point on an axis-aligned ellipse (semi-axes a, b) in the direction `angle`, measured from screen up,
 * clockwise (the HudContact.offscreenAngle convention). Relative to the ellipse center, y down.
 */
export function ellipseEdge(angle: number, a: number, b: number, out: Vec2Out): Vec2Out {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const denom = Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  const t = denom > 1e-12 ? 1 / denom : 0;
  out.x = dx * t;
  out.y = dy * t;
  return out;
}

/**
 * Point on an axis-aligned rectangle (half sizes hw, hh) in the direction `angle` (from up, clockwise).
 */
export function rectEdge(angle: number, hw: number, hh: number, out: Vec2Out): Vec2Out {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const tx = Math.abs(dx) > 1e-12 ? hw / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-12 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  out.x = dx * t;
  out.y = dy * t;
  return out;
}

/**
 * Screen angle (from up, clockwise) of a point relative to a center, y down. Inverse of the arrow
 * direction convention; used when a contact is behind the camera but still has a projected point.
 */
export function screenAngle(dx: number, dy: number): number {
  return Math.atan2(dx, -dy);
}

/**
 * Keeps a label box of size w×h anchored near (x, y) inside [minX, maxX]×[minY, maxY].
 * Returns the adjusted top-left corner in `out`.
 */
export function clampBox(
  x: number,
  y: number,
  w: number,
  h: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  out: Vec2Out,
): Vec2Out {
  out.x = x < minX ? minX : x + w > maxX ? maxX - w : x;
  out.y = y < minY ? minY : y + h > maxY ? maxY - h : y;
  return out;
}

import { describe, expect, it } from 'vitest';
import { Box3, Mesh, type Object3D } from 'three';
import type { GroundTargetKind } from '../../src/core/types';
import { createGroundUnitModel, disposeArtCache, wreckGroundUnitModel } from '../../src/art';
import { buildGroundGeometry } from '../../src/art/ground';

const KINDS: GroundTargetKind[] = ['sam', 'aaa', 'radar', 'hangar', 'fuel', 'ship', 'command', 'bunker'];

/** Expected real-world footprint (length along z, metres) with generous tolerance. */
const LENGTH: Record<GroundTargetKind, [number, number]> = {
  sam: [9, 14],
  aaa: [6, 11],
  radar: [5.5, 9],
  hangar: [40, 52],
  fuel: [30, 42],
  ship: [105, 115],
  command: [15, 22],
  bunker: [11, 18],
};

const meshOf = (o: Object3D): Mesh => o.children[0] as Mesh;

describe('art: ground units', () => {
  for (const kind of KINDS) {
    it(`${kind}: finite, non-degenerate, real scale`, () => {
      const b = buildGroundGeometry(kind, false);
      expect(b.triangleCount).toBeGreaterThan(40);
      expect(b.triangleCount).toBeLessThan(20000);
      for (const v of b.pos) expect(Number.isFinite(v)).toBe(true);
      for (const v of b.nrm) expect(Number.isFinite(v)).toBe(true);
      const box = new Box3().setFromObject(createGroundUnitModel(kind, false));
      const len = box.max.z - box.min.z;
      expect(len).toBeGreaterThanOrEqual(LENGTH[kind][0]);
      expect(len).toBeLessThanOrEqual(LENGTH[kind][1]);
      // sits on the ground (ship: hull reaches below the waterline)
      if (kind === 'ship') expect(box.min.y).toBeLessThan(-3);
      else expect(box.min.y).toBeGreaterThan(-0.2);
    });
  }

  it('shares geometry and material per kind and climate; wrecks swap material once', () => {
    const a = createGroundUnitModel('sam', true);
    const b = createGroundUnitModel('sam', true);
    const c = createGroundUnitModel('sam', false);
    expect(meshOf(a).geometry).toBe(meshOf(b).geometry);
    expect(meshOf(a).geometry).not.toBe(meshOf(c).geometry);
    expect(meshOf(a).material).toBe(meshOf(c).material);
    const before = meshOf(a).material;
    wreckGroundUnitModel(a);
    const wrecked = meshOf(a).material;
    expect(wrecked).not.toBe(before);
    const y = meshOf(a).position.y;
    wreckGroundUnitModel(a);
    expect(meshOf(a).position.y).toBe(y);
    expect(meshOf(b).material).toBe(before);
    disposeArtCache();
  });
});

import { describe, expect, it } from 'vitest';
import { KESSEL } from '../../src/world/maps/kessel';
import type { MapDef } from '../../src/world/maps/types';
import { StructureBuilder } from '../../src/world/structures';

const MAPS: MapDef[] = [KESSEL];

describe('structure primitives', () => {
  it('house walls and roof face outward', () => {
    const b = new StructureBuilder(() => 0);
    b.house(0, 0, 10, 6, 14, 0.3, 0xffffff, 0x884422);
    const { geometries, material } = b.finish();
    const g = geometries[0]!;
    const pos = g.getAttribute('position').array;
    const nrm = g.getAttribute('normal').array;
    // Center of the house volume (walls start 1.5 m below ground, roof ridge ~10.5 m up).
    const cy = 4;
    let outward = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const mx = (pos[i]! + pos[i + 3]! + pos[i + 6]!) / 3;
      const my = (pos[i + 1]! + pos[i + 4]! + pos[i + 7]!) / 3;
      const mz = (pos[i + 2]! + pos[i + 5]! + pos[i + 8]!) / 3;
      const d = mx * nrm[i]! + (my - cy) * nrm[i + 1]! + mz * nrm[i + 2]!;
      if (d > 0) outward++;
    }
    expect(outward).toBe(pos.length / 9);
    g.dispose();
    material.dispose();
  });
});

describe('map structures', () => {
  for (const map of MAPS) {
    it(`${map.id}: merged structure geometry is finite with unit normals`, () => {
      const heightAt = (x: number, z: number) => 40 + 10 * Math.sin(x / 300) * Math.cos(z / 400);
      const b = new StructureBuilder(heightAt);
      const targets = map.build(b, heightAt);
      expect(targets.length).toBeGreaterThan(0);
      const { meshes, material, geometries } = b.finish();
      expect(meshes.length).toBeGreaterThan(0);
      for (const g of geometries) {
        const pos = g.getAttribute('position').array;
        const nrm = g.getAttribute('normal').array;
        const col = g.getAttribute('color').array;
        for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
        for (let i = 0; i < col.length; i++) expect(Number.isFinite(col[i])).toBe(true);
        for (let i = 0; i < nrm.length; i += 3) {
          const l = Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!);
          if (!(Math.abs(l - 1) < 1e-3)) throw new Error(`${g.uuid}: normal ${i / 3} has length ${l}`);
        }
        g.dispose();
      }
      material.dispose();
      for (const t of targets) {
        expect(Number.isFinite(t.x) && Number.isFinite(t.z) && Number.isFinite(t.heading)).toBe(true);
      }
    });
  }
});

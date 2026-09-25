import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AIRCRAFT, AIRCRAFT_IDS } from '../../src/data/aircraft';
import type { AircraftVisualState, HardpointKind } from '../../src/core/types';
import { buildAirframe } from '../../src/art/airframe';
import { PAINT } from '../../src/art/builder';
import { designFor } from '../../src/art/designs';
import {
  artStats,
  createAircraftModel,
  createOrdnanceModel,
  disposeArtCache,
  isAircraftAvailable,
} from '../../src/art';

const READY = AIRCRAFT_IDS.filter((id) => isAircraftAvailable(id));
const builds = new Map(READY.map((id) => [id, buildAirframe(designFor(id))]));

function state(n: number, overrides: Partial<AircraftVisualState> = {}): AircraftVisualState {
  return {
    aileron: 0.5,
    elevator: -0.3,
    rudder: 0.2,
    flaps: 0.5,
    airbrake: 0.4,
    gear: 0.6,
    throttle: 0.9,
    afterburner: 0.5,
    canopy: 0,
    damage: { engine: 0.2, wingL: 0, wingR: 1, tail: 0 },
    navLights: true,
    stores: Array.from({ length: n }, (_, i) => i % 2 === 0),
    ...overrides,
  };
}

describe('art: airframe geometry', () => {
  it('has at least the starter jet finished', () => {
    expect(isAircraftAvailable('kestrel')).toBe(true);
  });
  for (const id of READY) {
    const a = builds.get(id)!;
    const design = AIRCRAFT[id].design;

    it(`${id}: dimensions within 3% of the design`, () => {
      const m = a.meta;
      expect(Math.abs(m.length - design.length) / design.length).toBeLessThan(0.03);
      expect(Math.abs(m.span - design.span) / design.span).toBeLessThan(0.03);
      expect(Math.abs(m.height - design.height) / design.height).toBeLessThan(0.03);
    });

    it(`${id}: no NaN and no degenerate triangles`, () => {
      for (const b of [a.builders.body0, a.builders.body1, a.builders.glass]) {
        for (const v of b.pos) expect(Number.isFinite(v)).toBe(true);
        for (const v of b.nrm) expect(Number.isFinite(v)).toBe(true);
        const p = b.pos;
        for (let i = 0; i < b.idx.length; i += 3) {
          const ia = b.idx[i]! * 3;
          const ib = b.idx[i + 1]! * 3;
          const ic = b.idx[i + 2]! * 3;
          const ux = p[ib]! - p[ia]!;
          const uy = p[ib + 1]! - p[ia + 1]!;
          const uz = p[ib + 2]! - p[ia + 2]!;
          const vx = p[ic]! - p[ia]!;
          const vy = p[ic + 1]! - p[ia + 1]!;
          const vz = p[ic + 2]! - p[ia + 2]!;
          const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          expect(area).toBeGreaterThan(1e-10);
        }
      }
    });

    it(`${id}: fuselage normals point outward`, () => {
      const b = a.builders.body0;
      const prof = designFor(id).fuselage;
      let checked = 0;
      let outward = 0;
      // sample livery body-panel vertices on the main fuselage skin (panel style 1, part fuselage)
      for (let v = 0; v < b.vertexCount; v += 7) {
        if (b.info[v * 4] !== PAINT.livery || b.info[v * 4 + 2] !== 1) continue;
        const z = b.pos[v * 3 + 2]! + designFor(id).cgZ;
        if (z < prof.z0 + 0.5 || z > prof.z1 - 0.5) continue;
        const s = prof.at(z, { cx: 0, cy: 0, wl: 0, wr: 0, ht: 0, hb: 0, nTL: 2, nTR: 2, nBL: 2, nBR: 2 });
        const dx = b.pos[v * 3]! - s.cx;
        const dy = b.pos[v * 3 + 1]! - s.cy;
        // only vertices on the lofted skin itself (superellipse equation ~ 1)
        const n = dy >= 0 ? (dx >= 0 ? s.nTR : s.nTL) : dx >= 0 ? s.nBR : s.nBL;
        const w = dx >= 0 ? s.wr : s.wl;
        const h = dy >= 0 ? s.ht : s.hb;
        const f =
          Math.pow(Math.abs(dx) / Math.max(w, 1e-3), n) + Math.pow(Math.abs(dy) / Math.max(h, 1e-3), n);
        if (Math.abs(f - 1) > 0.03) continue;
        checked++;
        if (dx * b.nrm[v * 3]! + dy * b.nrm[v * 3 + 1]! > 0) outward++;
      }
      expect(checked).toBeGreaterThan(50);
      expect(outward / checked).toBeGreaterThan(0.97);
    });

    it(`${id}: hardpoints match the aircraft definition`, () => {
      const def = AIRCRAFT[id].hardpoints;
      expect(a.meta.hardpoints.length).toBe(def.length);
      def.forEach((h, i) => {
        expect(a.meta.hardpoints[i]!.kind).toBe(h.kind);
        expect(a.meta.hardpoints[i]!.internal).toBe(h.internal);
      });
    });

    it(`${id}: hit capsules lie inside the bounds`, () => {
      const { min, max } = a.meta;
      const parts = new Set(a.meta.capsules.map((c) => c.part));
      for (const p of ['fuselage', 'cockpit', 'engine', 'wingL', 'wingR', 'tail'] as const)
        expect(parts.has(p)).toBe(true);
      for (const c of a.meta.capsules) {
        for (const e of [c.a, c.b]) {
          for (let k = 0; k < 3; k++) {
            expect(e[k]!).toBeGreaterThanOrEqual(min[k]! - 0.05);
            expect(e[k]!).toBeLessThanOrEqual(max[k]! + 0.05);
          }
        }
        expect(c.radius).toBeGreaterThan(0.05);
        expect(c.radius).toBeLessThan(1.5);
      }
    });

    it(`${id}: triangle budgets per LOD`, () => {
      expect(a.triangles.lod0).toBeGreaterThanOrEqual(12000);
      expect(a.triangles.lod0).toBeLessThanOrEqual(25000);
      expect(a.triangles.lod1).toBeLessThanOrEqual(4000);
      expect(a.triangles.lod1).toBeGreaterThan(800);
    });

    it(`${id}: metadata is consistent`, () => {
      const m = a.meta;
      expect(m.nozzles.length).toBe(AIRCRAFT[id].design.engines);
      expect(m.wingtips[0][0]).toBeLessThan(0);
      expect(m.wingtips[1][0]).toBeGreaterThan(0);
      expect(m.gearContactY).toBeLessThan(-0.5);
      expect(m.radius).toBeGreaterThan(m.length / 2 - 0.5);
      for (const n of m.nozzles) expect(n[2]).toBeGreaterThan(0);
      expect(m.cockpitEye[2]).toBeLessThan(0);
    });
  }
});

describe('art: runtime model', () => {
  it('builds, animates without allocation-sensitive errors, switches LOD and disposes', () => {
    for (const id of AIRCRAFT_IDS) {
      const n = AIRCRAFT[id].hardpoints.length;
      const model = createAircraftModel(id, { livery: 1, team: 'red', tailNumber: '412' });
      if (isAircraftAvailable(id)) expect(model.hardpoints.length).toBe(n);
      model.update(state(n), 1 / 60, 12.5);
      model.setLod(1);
      model.update(state(n, { gear: 0, canopy: 1 }), 1 / 60, 12.6);
      model.setLod(2);
      model.setLod(0);
      model.root.updateMatrixWorld(true);
      const p = new Vector3();
      model.root.traverse((o) => {
        o.getWorldPosition(p);
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      });
      model.dispose();
    }
  });

  it('reports LOD budgets', () => {
    for (const id of AIRCRAFT_IDS) {
      const s = artStats(id);
      expect(s.lod0.drawCalls).toBeLessThanOrEqual(10);
      expect(s.lod1.drawCalls).toBeLessThanOrEqual(2);
    }
  });

  it('creates every ordnance kind with shared geometry', () => {
    const kinds: HardpointKind[] = ['srm', 'mrm', 'lraam', 'rocketPod', 'bomb', 'agm', 'tank'];
    for (const k of kinds) {
      const a = createOrdnanceModel(k);
      const b = createOrdnanceModel(k);
      expect(a).not.toBe(b);
      expect((a as unknown as { geometry: unknown }).geometry).toBe(
        (b as unknown as { geometry: unknown }).geometry,
      );
    }
    disposeArtCache();
  });
});

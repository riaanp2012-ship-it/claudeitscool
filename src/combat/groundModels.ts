import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { GroundTargetKind } from '../core/types';
import { patchAtmosphere } from '../render/atmosphere';

/**
 * Procedural ground-unit models shared by all instances (geometry and materials are cached).
 * Built from simple military shapes at real scale; destroyed units swap to a burnt material.
 */
const cache = new Map<string, BufferGeometry>();
const mats = new Map<string, Material>();

function geo(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

function mat(key: string, color: number, roughness = 0.85, metalness = 0.1): Material {
  let m = mats.get(key);
  if (!m) {
    m = patchAtmosphere(new MeshStandardMaterial({ color, roughness, metalness }), 'ground-unit');
    mats.set(key, m);
  }
  return m;
}

const OLIVE = 0x4a4d38;
const SAND = 0x8b7d62;
const GREY = 0x6f7478;
const DARK = 0x2c2f31;
const CONCRETE = 0x8a8a84;

function part(g: BufferGeometry, m: Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
  const mesh = new Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export function createGroundModel(kind: GroundTargetKind, desert = false): Object3D {
  const g = new Group();
  const body = mat(desert ? 'sand' : 'olive', desert ? SAND : OLIVE);
  const dark = mat('dark', DARK, 0.7, 0.3);
  const grey = mat('grey', GREY, 0.6, 0.4);
  const concrete = mat('concrete', CONCRETE, 0.95, 0);
  switch (kind) {
    case 'sam': {
      g.add(
        part(
          geo('sam-trailer', () => new BoxGeometry(3, 1.2, 8)),
          body,
          0,
          0.9,
          0,
        ),
      );
      const launcher = new Group();
      launcher.position.set(0, 1.6, 0.5);
      launcher.rotation.x = -0.55;
      for (let i = 0; i < 4; i++) {
        launcher.add(
          part(
            geo('sam-tube', () => new BoxGeometry(0.7, 0.7, 6.5)),
            body,
            (i % 2) * 0.8 - 0.4,
            Math.floor(i / 2) * 0.8,
            0,
          ),
        );
      }
      g.add(launcher);
      g.add(
        part(
          geo('sam-mast', () => new CylinderGeometry(0.12, 0.12, 5, 8)),
          dark,
          1.8,
          2.5,
          -3,
        ),
      );
      g.add(
        part(
          geo('sam-radar', () => new BoxGeometry(2.2, 1.4, 0.2)),
          grey,
          1.8,
          5,
          -3,
        ),
      );
      break;
    }
    case 'aaa': {
      g.add(
        part(
          geo('aaa-base', () => new CylinderGeometry(2.2, 2.6, 1.2, 12)),
          body,
          0,
          0.6,
          0,
        ),
      );
      g.add(
        part(
          geo('aaa-turret', () => new BoxGeometry(2.2, 1.4, 2.6)),
          body,
          0,
          1.9,
          0,
        ),
      );
      g.add(
        part(
          geo('aaa-barrel', () => new CylinderGeometry(0.1, 0.1, 3.4, 6)),
          dark,
          0.45,
          2.9,
          -1.2,
          -1.0,
        ),
      );
      g.add(
        part(
          geo('aaa-barrel', () => new CylinderGeometry(0.1, 0.1, 3.4, 6)),
          dark,
          -0.45,
          2.9,
          -1.2,
          -1.0,
        ),
      );
      break;
    }
    case 'radar': {
      g.add(
        part(
          geo('radar-cabin', () => new BoxGeometry(3, 2.5, 5)),
          body,
          0,
          1.25,
          0,
        ),
      );
      g.add(
        part(
          geo('radar-mast', () => new CylinderGeometry(0.25, 0.35, 8, 8)),
          grey,
          0,
          6,
          0,
        ),
      );
      g.add(
        part(
          geo('radar-dish', () => new SphereGeometry(4, 20, 8, 0, Math.PI * 2, 0, 0.7)),
          grey,
          0,
          10.5,
          0,
          -1.2,
        ),
      );
      break;
    }
    case 'hangar': {
      g.add(
        part(
          geo('hangar-shell', () => new CylinderGeometry(15, 15, 40, 24, 1, false, 0, Math.PI)),
          concrete,
          0,
          0,
          0,
          Math.PI / 2,
          0,
          Math.PI / 2,
        ),
      );
      g.add(
        part(
          geo('hangar-door', () => new BoxGeometry(24, 11, 0.4)),
          grey,
          0,
          5.5,
          -20,
        ),
      );
      break;
    }
    case 'fuel': {
      for (let i = 0; i < 3; i++)
        g.add(
          part(
            geo('fuel-tank', () => new CylinderGeometry(4.5, 4.5, 7, 20)),
            mat('tank', 0xb8b6ae, 0.5, 0.2),
            i * 11 - 11,
            3.5,
            0,
          ),
        );
      break;
    }
    case 'command': {
      g.add(
        part(
          geo('cmd-block', () => new BoxGeometry(24, 6, 16)),
          concrete,
          0,
          3,
          0,
        ),
      );
      g.add(
        part(
          geo('cmd-roof', () => new BoxGeometry(14, 3, 9)),
          concrete,
          0,
          7.5,
          0,
        ),
      );
      g.add(
        part(
          geo('cmd-mast', () => new CylinderGeometry(0.2, 0.3, 14, 6)),
          grey,
          8,
          13,
          4,
        ),
      );
      break;
    }
    case 'bunker': {
      g.add(
        part(
          geo('bunker', () => new BoxGeometry(14, 5, 12)),
          concrete,
          0,
          2.5,
          0,
        ),
      );
      g.add(
        part(
          geo('bunker-slit', () => new BoxGeometry(8, 0.8, 0.4)),
          dark,
          0,
          3.4,
          -6.1,
        ),
      );
      break;
    }
    case 'ship': {
      g.add(
        part(
          geo('ship-hull', () => new BoxGeometry(14, 8, 110)),
          grey,
          0,
          1,
          0,
        ),
      );
      g.add(
        part(
          geo('ship-bow', () => new CylinderGeometry(0.1, 7, 22, 4)),
          grey,
          0,
          1,
          -64,
          Math.PI / 2,
          Math.PI / 4,
        ),
      );
      g.add(
        part(
          geo('ship-super', () => new BoxGeometry(10, 10, 30)),
          grey,
          0,
          10,
          8,
        ),
      );
      g.add(
        part(
          geo('ship-mast', () => new CylinderGeometry(0.5, 0.9, 16, 8)),
          grey,
          0,
          23,
          4,
        ),
      );
      g.add(
        part(
          geo('ship-gun', () => new BoxGeometry(4, 3, 5)),
          grey,
          0,
          6.5,
          -34,
        ),
      );
      break;
    }
  }
  return g;
}

/** Visual state for a destroyed unit: flattened and burnt. */
export function wreckGroundModel(model: Object3D): void {
  const burnt = mat('burnt', 0x151311, 1, 0);
  model.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).material = burnt;
  });
  model.scale.y = 0.45;
}

export function disposeGroundModels(): void {
  for (const g of cache.values()) g.dispose();
  for (const m of mats.values()) m.dispose();
  cache.clear();
  mats.clear();
}

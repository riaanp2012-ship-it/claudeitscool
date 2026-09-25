import { UnsignedByteType, Vector3, WebGLRenderTarget } from 'three';
import type { MapId, QualityLevel } from '../core/types';
import { createWorldWith, type WorldInternal } from '../world';
import { createHarness } from './common';

/**
 * World harness: ?map=kessel|mesa|norrdal&view=<name>&res=1024&quality=medium&veg=0.6
 * Fixed camera views per map; reports draw calls, triangles, update time, generation time and runway flatness.
 */
interface View {
  /** Camera position; y is above ground level when agl is true. */
  pos: [number, number, number];
  look: [number, number, number];
  agl?: boolean;
  lookAgl?: boolean;
  fov?: number;
}

const VIEWS: Record<string, Record<string, View>> = {
  kessel: {
    coast: { pos: [2600, 150, -600], look: [300, 60, -2600], agl: false },
    cliffs: { pos: [-1600, 120, -900], look: [900, 40, -2700] },
    approach: { pos: [-11200, 600, -6400], look: [-6300, 92, -8400] },
    airbase: { pos: [-4300, 420, -6800], look: [-6600, 92, -8700] },
    harbor: { pos: [6900, 380, -1800], look: [6200, 10, -4600] },
    cruise: { pos: [-3000, 3000, 9000], look: [1000, 800, -4000] },
    horizon: { pos: [0, 9000, 14000], look: [0, 6500, -20000] },
    islands: { pos: [-9000, 700, -1500], look: [3000, 150, 7000] },
    lowvalley: { pos: [6500, 70, -8200], look: [6200, 60, -5200], agl: true, lookAgl: true },
  },
  mesa: {
    canyon: { pos: [0, 60, 0], look: [0, 60, -1000], agl: true, lookAgl: true },
    lakebed: { pos: [-4000, 500, 9000], look: [-6000, 0, 4000] },
    cruise: { pos: [-6000, 3000, 12000], look: [0, 500, -2000] },
    horizon: { pos: [0, 9000, 14000], look: [0, 6500, -20000] },
    mesas: { pos: [5000, 900, 6000], look: [0, 300, -3000] },
  },
  norrdal: {
    above: { pos: [0, 3200, 12000], look: [0, 1500, -6000] },
    below: { pos: [-2000, 900, 6000], look: [0, 600, -3000] },
    fjord: { pos: [0, 300, 9000], look: [0, 150, 2000] },
    dam: { pos: [0, 900, 0], look: [0, 500, -3000] },
    horizon: { pos: [0, 9000, 14000], look: [0, 6500, -20000] },
  },
};

const params = new URLSearchParams(location.search);
const map = (params.get('map') ?? 'kessel') as MapId;
const mapViews = VIEWS[map] ?? VIEWS.kessel!;
const viewName = params.get('view') ?? Object.keys(mapViews)[0]!;
const view = mapViews[viewName] ?? Object.values(mapViews)[0]!;
const res = params.get('res') ? Number(params.get('res')) : undefined;
const quality = (params.get('quality') ?? 'medium') as QualityLevel;
const veg = params.get('veg')
  ? Number(params.get('veg'))
  : quality === 'low'
    ? 0.35
    : quality === 'high'
      ? 0.85
      : 0.6;
const settleFrames = Number(params.get('frames') ?? 4);

const h = createHarness({ readyAfterFrames: Number.POSITIVE_INFINITY, far: 160000 });
if (params.get('scale')) h.pipeline.setOptions({ renderScale: Number(params.get('scale')) });
if (view.fov) {
  h.camera.fov = view.fov;
  h.camera.updateProjectionMatrix();
}

const label = document.createElement('div');
label.style.cssText =
  'position:fixed;left:12px;bottom:10px;font:12px/1.4 monospace;color:#cfd6dc;text-shadow:0 1px 2px #000;pointer-events:none';
document.body.appendChild(label);

function placeCamera(world: WorldInternal): void {
  const [px, py, pz] = view.pos;
  const [lx, ly, lz] = view.look;
  const cy = view.agl ? world.surfaceAt(px, pz) + py : py;
  const ly2 = view.lookAgl ? world.surfaceAt(lx, lz) + ly : ly;
  h.camera.position.set(px, cy, pz);
  h.camera.lookAt(lx, ly2, lz);
  h.camera.updateMatrixWorld();
}

function measureHeightAt(world: WorldInternal): number {
  const n = 200000;
  let acc = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const x = ((i * 7919) % 32000) - 16000 + i * 0.013;
    const z = ((i * 104729) % 32000) - 16000;
    acc += world.heightAt(x, z);
  }
  const dt = performance.now() - t0;
  return Number.isFinite(acc) ? (dt * 1e6) / n : -1;
}

function runwayFlatness(world: WorldInternal): { id: string; maxDev: number }[] {
  return world.runways.map((r) => {
    const fx = Math.sin(r.heading);
    const fz = -Math.cos(r.heading);
    let maxDev = 0;
    for (let i = 0; i <= 60; i++) {
      const u = (i / 60 - 0.5) * r.length;
      for (const v of [-r.width / 2, 0, r.width / 2]) {
        const x = r.center.x + fx * u - fz * v;
        const z = r.center.z + fz * u + fx * v;
        maxDev = Math.max(maxDev, Math.abs(world.heightAt(x, z) - r.center.y));
      }
    }
    return { id: r.id, maxDev: Number(maxDev.toFixed(3)) };
  });
}

function measureRender(world: WorldInternal): { calls: number; triangles: number } {
  const rt = new WebGLRenderTarget(64, 36, { type: UnsignedByteType });
  const r = h.renderer;
  const auto = r.info.autoReset;
  r.info.autoReset = false;
  r.info.reset();
  world.update(h.camera, 1 / 60, 1);
  r.setRenderTarget(rt);
  r.render(h.scene, h.camera);
  r.setRenderTarget(null);
  const out = { calls: r.info.render.calls, triangles: r.info.render.triangles };
  r.info.autoReset = auto;
  rt.dispose();
  return out;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const world = await createWorldWith(
    h.renderer,
    { map, quality: { terrain: quality, clouds: quality, water: quality, vegetation: veg } },
    (f, text) => {
      label.textContent = `${map}: ${text} ${(f * 100).toFixed(0)}%`;
    },
    { res },
  );
  const loadMs = performance.now() - t0;
  h.scene.add(world.root);
  if (params.get('hide')) {
    const hide = params.get('hide')!.split(',');
    world.root.traverse((o) => {
      if (hide.some((n) => o.name.startsWith(n))) o.visible = false;
    });
  }
  const probes = (params.get('probe') ?? '')
    .split(';')
    .filter((v) => v.length > 0)
    .map((v) => {
      const [x, z] = v.split(',').map(Number);
      return { x, z, h: Number(world.heightAt(x ?? 0, z ?? 0).toFixed(1)) };
    });
  h.scene.environment = world.environment;
  placeCamera(world);
  const heightNs = measureHeightAt(world);
  const flat = runwayFlatness(world);
  const render = measureRender(world);
  // Warm, steady-state update() cost: the camera drifts and turns a little every call.
  const bench = { avg: 0, max: 0 };
  {
    const base = h.camera.position.clone();
    const n = 300;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      h.camera.position.set(base.x + i * 1.5, base.y, base.z - i * 0.8);
      h.camera.rotation.y += 0.002;
      const a = performance.now();
      world.update(h.camera, 1 / 60, i / 60);
      const d = performance.now() - a;
      if (i >= 60) {
        acc += d;
        bench.max = Math.max(bench.max, d);
      }
    }
    bench.avg = acc / (n - 60);
    placeCamera(world);
  }

  let frames = 0;
  let updAcc = 0;
  let updMax = 0;
  const sub = [0, 0, 0];
  const spawnCheck = new Vector3();
  let minSpawnClearance = Infinity;
  for (const team of ['blue', 'red'] as const) {
    for (const s of world.airSpawns[team]) {
      spawnCheck.copy(s.position);
      minSpawnClearance = Math.min(
        minSpawnClearance,
        s.position.y - world.surfaceAt(s.position.x, s.position.z),
      );
    }
  }
  let lastFrame = performance.now();
  let frameMs = 0;
  h.frame((dt, elapsed) => {
    const a = performance.now();
    frameMs = a - lastFrame;
    lastFrame = a;
    world.update(h.camera, dt, elapsed);
    const u = performance.now() - a;
    frames++;
    const stats = world.stats();
    if (frames > 2) {
      updAcc += u;
      updMax = Math.max(updMax, u);
      sub[0] = sub[0]! + stats.terrainMs;
      sub[1] = sub[1]! + stats.cloudsMs;
      sub[2] = sub[2]! + stats.treesMs;
    }
    const info = {
      map,
      view: viewName,
      quality,
      res: res ?? null,
      drawCalls: render.calls,
      triangles: render.triangles,
      updateMsAvg: Number((updAcc / Math.max(frames - 2, 1)).toFixed(3)),
      updateMsMax: Number(updMax.toFixed(3)),
      frameMs: Math.round(frameMs),
      updateBenchMsAvg: Number(bench.avg.toFixed(3)),
      updateBenchMsMax: Number(bench.max.toFixed(3)),
      updateBreakdownMs: sub.map((v) => Number((v / Math.max(frames - 2, 1)).toFixed(3))),
      generationMs: Math.round(stats.generationMs),
      loadMs: Math.round(loadMs),
      heightAtNs: Number(heightNs.toFixed(1)),
      runwayFlatness: flat,
      trees: stats.trees,
      treeInstances: stats.treeInstances,
      puffs: stats.puffs,
      terrainNodes: stats.terrainNodes,
      minSpawnClearance: Math.round(minSpawnClearance),
      groundTargets: world.groundTargets.length,
      probes,
    };
    window.__HARNESS_INFO__ = info;
    label.textContent = `${map} / ${viewName}  calls ${info.drawCalls}  tris ${info.triangles}  update ${info.updateMsAvg} ms  gen ${info.generationMs} ms`;
    if (frames === settleFrames) {
      if (!params.has('label')) label.style.display = 'none';
      window.__HARNESS_READY__ = true;
    }
  });
}

main().catch((e: unknown) => {
  label.textContent = `world failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});

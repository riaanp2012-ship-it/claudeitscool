import { PerspectiveCamera, Scene } from 'three';
import { DEFAULT_PIPELINE_OPTIONS, Pipeline } from '../render/pipeline';

/**
 * Shared scaffolding for harness pages (visual verification, spec §2.6). Uses the game's real pipeline.
 * Call `frame(fn)` to run a per-frame callback; `window.__HARNESS_READY__` is set after `readyAfterFrames`.
 */
export function createHarness(options: { readyAfterFrames?: number; far?: number } = {}) {
  document.body.style.margin = '0';
  document.body.style.background = '#0a0c0d';
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;';
  document.body.appendChild(container);
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.5,
    options.far ?? 160000,
  );
  const pipeline = new Pipeline(container, scene, camera, DEFAULT_PIPELINE_OPTIONS);
  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    pipeline.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  let callback: ((dt: number, elapsed: number) => void) | null = null;
  let frames = 0;
  let last = performance.now();
  let elapsed = 0;
  const readyAfter = options.readyAfterFrames ?? 30;
  pipeline.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;
    callback?.(dt, elapsed);
    pipeline.render(dt);
    frames++;
    if (frames === readyAfter) window.__HARNESS_READY__ = true;
  });

  return {
    scene,
    camera,
    pipeline,
    renderer: pipeline.renderer,
    frame(fn: (dt: number, elapsed: number) => void) {
      callback = fn;
    },
  };
}

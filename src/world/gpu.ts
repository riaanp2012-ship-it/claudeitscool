import {
  type BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

/** Vertex shader for full-screen passes: a single triangle covering the viewport. */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Renders a material over a whole render target (generation and bake passes). */
export class FullscreenPass {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new BufferGeometry();
  private readonly mesh: Mesh;

  constructor() {
    this.geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.mesh.material = material;
    const prev = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** A material for FullscreenPass with depth disabled. */
export function passMaterial(
  fragmentShader: string,
  uniforms: ShaderMaterial['uniforms'],
  defines: Record<string, string | number> = {},
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
  });
}

let channel: MessageChannel | null = null;
const pending: (() => void)[] = [];

/** Yields to the event loop (not throttled like setTimeout) so the loading screen stays responsive. */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => pending.shift()?.();
  }
  return new Promise((resolve) => {
    pending.push(resolve);
    channel!.port2.postMessage(0);
  });
}

/**
 * Marks the first `count` items of an attribute for upload without allocating: reuses one range object.
 * (three only mutates ranges when merging several, and this always sets exactly one.)
 */
export function setUploadRange(
  attr: BufferAttribute,
  range: { start: number; count: number },
  count: number,
): void {
  range.start = 0;
  range.count = Math.max(count, 1) * attr.itemSize;
  attr.updateRanges.length = 0;
  attr.updateRanges.push(range);
  attr.needsUpdate = true;
}

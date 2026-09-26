import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import {
  HalfFloatType,
  NoToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  type Camera,
  type Scene,
  WebGLRenderer,
} from 'three';

export interface PipelineOptions {
  /** Multiplies the device pixel ratio (render scale / adaptive resolution). */
  renderScale: number;
  /** Upper bound on the effective device pixel ratio for this preset. */
  maxPixelRatio: number;
  msaa: number; // 0 or 4
  smaa: boolean;
  bloom: boolean;
}

/**
 * The one renderer + post chain used by the game and every harness page, so previews match the game.
 * Linear HDR is rendered into HalfFloat buffers; AgX tone mapping and sRGB output happen in the post chain.
 */
export class Pipeline {
  readonly renderer: WebGLRenderer;
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: BloomEffect;
  private readonly smaa: SMAAEffect;
  private readonly mainPass: EffectPass;
  private readonly aaPass: EffectPass;
  private options: PipelineOptions;
  private width = 1;
  private height = 1;

  constructor(container: HTMLElement, scene: Scene, camera: Camera, options: PipelineOptions) {
    this.options = { ...options };
    this.renderer = new WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: true,
      alpha: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0c0d, 1);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-label', 'Game view');
    container.appendChild(canvas);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: HalfFloatType,
      multisampling: options.msaa,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new BloomEffect({
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.25,
      intensity: 0.55,
      mipmapBlur: true,
      radius: 0.68,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.mainPass = new EffectPass(camera, this.bloom, tone, vignette);
    this.smaa = new SMAAEffect();
    this.aaPass = new EffectPass(camera, this.smaa);
    // Dither at the final 8-bit output so sky and fog gradients never band (ZD-B10).
    this.mainPass.dithering = true;
    this.aaPass.dithering = true;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.mainPass);
    this.composer.addPass(this.aaPass);
    this.applyOptions();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setScene(scene: Scene, camera: Camera): void {
    this.composer.setMainScene(scene);
    this.composer.setMainCamera(camera);
  }

  setOptions(options: Partial<PipelineOptions>): void {
    const msaaChanged = options.msaa !== undefined && options.msaa !== this.options.msaa;
    this.options = { ...this.options, ...options };
    if (msaaChanged) this.composer.multisampling = this.options.msaa;
    this.applyOptions();
  }

  get pixelRatio(): number {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.min(dpr, this.options.maxPixelRatio) * this.options.renderScale;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height, false);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  /**
   * Compiles every material in `scene` for the composer's linear HDR buffer, which is where the scene is
   * drawn. three picks a different program for the sRGB canvas, so compiling without this target warms up
   * variants the game never uses, and anything off screen at load (distant LODs, pooled missiles,
   * vegetation) would then compile on first sight mid-game (ZD-C02).
   */
  async warmup(scene: Scene, camera: Camera): Promise<void> {
    const r = this.renderer;
    const previous = r.getRenderTarget();
    r.setRenderTarget(this.composer.inputBuffer);
    let pending: Promise<unknown> | null = null;
    try {
      // compileAsync warns without KHR_parallel_shader_compile (software GL, some browsers); the
      // synchronous compile does the same work silently. Both choose programs before returning, so the
      // target can be restored before waiting for the driver.
      if (r.extensions.has('KHR_parallel_shader_compile')) pending = r.compileAsync(scene, camera);
      else r.compile(scene, camera);
    } finally {
      r.setRenderTarget(previous);
    }
    if (pending) await pending.catch(() => undefined);
  }

  private applyOptions(): void {
    this.bloom.blendMode.opacity.value = this.options.bloom ? 1 : 0;
    this.aaPass.enabled = this.options.smaa;
    // The last enabled pass must render to screen.
    this.mainPass.renderToScreen = !this.options.smaa;
    this.aaPass.renderToScreen = this.options.smaa;
    if (this.width > 1) this.resize(this.width, this.height);
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  renderScale: 1,
  maxPixelRatio: 1.5,
  msaa: 0,
  smaa: true,
  bloom: true,
};

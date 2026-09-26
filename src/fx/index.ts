/**
 * Effects system (spec §6 "Effects"): particles, ribbon trails, explosions, impacts, debris, tracers, glows,
 * distant-aircraft dots, muzzle flashes and explosion lights. Six draw calls in total:
 *
 *   ribbons (smoke)  → alpha particles (sorted) → dots → ribbons (additive) → additive particles + immediates
 *   debris chunks (opaque)
 *
 * All simulation runs on the CPU in preallocated typed arrays; update() allocates nothing.
 */
import {
  AddEquation,
  ClampToEdgeWrapping,
  CustomBlending,
  DataArrayTexture,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PointLight,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type Color,
  type IUniform,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { ExplosionKind, Fx, ImpactKind, QualityLevel, TrailHandle, TrailKind } from '../core/types';
import { Rng } from '../core/rng';
import { isFiniteVec } from '../core/math';
import { MAX_FLASHES, atmoUniforms } from '../render/atmosphere';
import { buildAtlas, buildNoise } from './atlas';
import { InstanceBatch, RibbonBuffers, debrisChunkGeometry } from './batches';
import { DebrisSystem, type DebrisEmitter } from './debris';
import { FlashPool } from './flashes';
import { ParticleStore, type SurfaceFn } from './particles';
import { emitBurst } from './recipes';
import {
  ADD_FRAGMENT,
  ADD_VERTEX,
  ALPHA_FRAGMENT,
  ALPHA_VERTEX,
  DEBRIS_FRAGMENT,
  DEBRIS_VERTEX,
  DOT_FRAGMENT,
  DOT_VERTEX,
  RIBBON_ADD_FRAGMENT,
  RIBBON_ALPHA_FRAGMENT,
  RIBBON_VERTEX,
} from './shaders';
import { RadixSorter, farFirstKey } from './sort';
import { FREE, TrailStore } from './trailStore';
import {
  ATLAS_LAYERS,
  ATLAS_SIZE,
  CONTACT_FADE,
  DEBRIS,
  DEBRIS_MAX,
  DEBRIS_PUBLIC,
  DEBRIS_RIBBON_RESERVE,
  DETAIL,
  DOT_MAX_PX,
  DOT_MIN_PX,
  DOT_WORLD_SIZE,
  EXPLOSIONS,
  FLASH_LIGHT_SCALE,
  FLASH_SPRITE_REDUCED,
  HEADROOM_FRACTION,
  IMMEDIATE_ADD,
  IMPACTS,
  LAYER,
  MAX_DOTS,
  MAX_GLOWS,
  MAX_MUZZLES,
  MAX_TRACERS,
  MIN_GLOW_PX,
  MIN_SPRITE_PX,
  MIN_TRACER_PX,
  MODE_FIRE,
  MODE_GLOW,
  MODE_SPRITE,
  MODE_STREAK,
  MUZZLE,
  NOISE_SIZE,
  PARTICLE_CAPACITY,
  PARTICLE_MAX,
  RIBBON,
  RIBBON_DEFS,
  RIBBON_KINDS,
  STYLE,
  STYLES,
  TRAIL_ALPHA_SLOTS,
  TRAIL_LAYOUT,
  TRAIL_POINTS,
  TRAIL_SLOTS,
  TRAIL_SLOT_LIMIT,
  WIND,
  type DebrisDef,
  type Range,
} from './tuning';

const TAU = Math.PI * 2;
/** Seconds over which smoke loses the orange glow of the fireball inside it. */
const EMISSIVE_DECAY = 0.6;
const RENDER_ORDER = {
  ribbonAlpha: 20,
  particlesAlpha: 21,
  dots: 22,
  ribbonAdd: 23,
  particlesAdd: 24,
} as const;
const noSurface: SurfaceFn = () => -1e9;

/** Handle given to callers; checks the slot generation so a stale handle can never touch a reused slot. */
class FxTrail implements TrailHandle {
  constructor(
    private readonly store: TrailStore,
    private readonly slot: number,
    private readonly gen: number,
    private readonly coreSlot: number,
    private readonly coreGen: number,
  ) {}

  push(position: Vector3, intensity: number): void {
    const s = this.store;
    if (s.owns(this.slot, this.gen)) s.push(this.slot, position.x, position.y, position.z, intensity);
    if (this.coreSlot >= 0 && s.owns(this.coreSlot, this.coreGen)) {
      s.push(this.coreSlot, position.x, position.y, position.z, intensity);
    }
  }

  release(): void {
    const s = this.store;
    if (s.owns(this.slot, this.gen)) s.release(this.slot);
    if (this.coreSlot >= 0 && s.owns(this.coreSlot, this.coreGen)) s.release(this.coreSlot);
  }
}

function blendMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, IUniform>,
  additive: boolean,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    // Additive batches write alpha 0 (pure add) except fire, which also occludes a little.
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: additive ? ZeroFactor : OneFactor,
    blendDstAlpha: additive ? OneFactor : OneMinusSrcAlphaFactor,
    fog: false,
    lights: false,
  });
}

export class FxSystem implements Fx {
  readonly root = new Group();
  /** Draw calls the effects issued in the last rendered frame (debug/harness). */
  drawCalls = 0;
  /** CPU milliseconds spent in the last update() (debug/harness). */
  updateMs = 0;

  private readonly rng: Rng;
  private readonly ps = new ParticleStore(PARTICLE_MAX);
  private readonly sorter = new RadixSorter(PARTICLE_MAX);
  private readonly sortKeys = new Uint16Array(PARTICLE_MAX);
  private readonly sortIdx = new Int32Array(PARTICLE_MAX);
  private readonly renderSize = new Float32Array(PARTICLE_MAX);
  private readonly renderAlpha = new Float32Array(PARTICLE_MAX);
  private readonly trails = new TrailStore(TRAIL_SLOTS, TRAIL_POINTS);
  private readonly trailOrder = new Int32Array(TRAIL_SLOTS);
  private readonly trailKeys = new Float32Array(TRAIL_SLOTS);
  private readonly flashes = new FlashPool(MAX_FLASHES);
  private readonly debrisSim = new DebrisSystem(DEBRIS_MAX);

  private readonly atlas: DataArrayTexture;
  private readonly noise: DataTexture;
  private readonly alphaBatch: InstanceBatch;
  private readonly addBatch: InstanceBatch;
  private readonly dotBatch: InstanceBatch;
  private readonly debrisBatch: InstanceBatch;
  private readonly ribbons: RibbonBuffers;
  private readonly ribbonMaterials: ShaderMaterial[];
  private readonly lights: PointLight[] = [];
  private readonly viewport = { value: new Vector2(1920, 1080) };
  private readonly fxTime = { value: 0 };

  private readonly glowQ = new Float32Array(MAX_GLOWS * 8);
  private readonly tracerQ = new Float32Array(MAX_TRACERS * 10);
  private readonly muzzleQ = new Float32Array(MAX_MUZZLES * 8);
  private readonly dotQ = new Float32Array(MAX_DOTS * 7);
  private glowN = 0;
  private tracerN = 0;
  private muzzleN = 0;
  private dotN = 0;
  private statGlows = 0;
  private readonly statsOut = { particles: 0, trails: 0, glows: 0 };
  private drawCounter = 0;

  private quality: QualityLevel = 'high';
  private detail = 1;
  private spriteBrightness = 1;
  private time = 0;
  private readonly cam = { x: 0, y: 0, z: 0 };
  private readonly camRight = { x: 1, y: 0, z: 0 };
  private readonly camFwd = { x: 0, y: 0, z: -1 };

  private readonly debrisEmitter: DebrisEmitter;

  constructor(seed = 0x5f1e) {
    this.rng = new Rng(seed);
    this.root.name = 'fx';

    this.atlas = new DataArrayTexture(buildAtlas(), ATLAS_SIZE, ATLAS_SIZE, ATLAS_LAYERS);
    this.atlas.format = RGBAFormat;
    this.atlas.type = UnsignedByteType;
    this.atlas.minFilter = LinearMipmapLinearFilter;
    this.atlas.magFilter = LinearFilter;
    this.atlas.wrapS = ClampToEdgeWrapping;
    this.atlas.wrapT = ClampToEdgeWrapping;
    this.atlas.generateMipmaps = true;
    this.atlas.colorSpace = NoColorSpace;
    this.atlas.needsUpdate = true;

    this.noise = new DataTexture(buildNoise(), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
    this.noise.minFilter = LinearMipmapLinearFilter;
    this.noise.magFilter = LinearFilter;
    this.noise.wrapS = RepeatWrapping;
    this.noise.wrapT = RepeatWrapping;
    this.noise.generateMipmaps = true;
    this.noise.colorSpace = NoColorSpace;
    this.noise.needsUpdate = true;

    const trailColor = { value: RIBBON_DEFS.map((k) => new Vector3(k.color[0], k.color[1], k.color[2])) };
    const trailParams = { value: RIBBON_DEFS.map((k) => new Vector4(k.noise, k.occlusion, 0, 0)) };
    while (trailColor.value.length < RIBBON_KINDS) trailColor.value.push(new Vector3());
    while (trailParams.value.length < RIBBON_KINDS) trailParams.value.push(new Vector4());
    const shared = (): Record<string, IUniform> => ({
      ...atmoUniforms,
      uAtlas: { value: this.atlas },
      uNoise: { value: this.noise },
      uViewport: this.viewport,
      uFxTime: this.fxTime,
      uTrailColor: trailColor,
      uTrailParams: trailParams,
      uDotPx: { value: new Vector2(DOT_MIN_PX, DOT_MAX_PX) },
    });

    const alphaMat = blendMaterial(ALPHA_VERTEX, ALPHA_FRAGMENT, shared(), false);
    const addMat = blendMaterial(ADD_VERTEX, ADD_FRAGMENT, shared(), true);
    const dotMat = blendMaterial(DOT_VERTEX, DOT_FRAGMENT, shared(), false);
    const ribbonAlphaMat = blendMaterial(RIBBON_VERTEX, RIBBON_ALPHA_FRAGMENT, shared(), false);
    const ribbonAddMat = blendMaterial(RIBBON_VERTEX, RIBBON_ADD_FRAGMENT, shared(), true);
    const debrisMat = new ShaderMaterial({
      vertexShader: DEBRIS_VERTEX,
      fragmentShader: DEBRIS_FRAGMENT,
      uniforms: shared(),
      side: FrontSide,
      fog: false,
      lights: false,
    });

    this.alphaBatch = new InstanceBatch(PARTICLE_MAX, ['iPos', 'iColor', 'iParams', 'iExtra'], alphaMat);
    this.addBatch = new InstanceBatch(
      PARTICLE_MAX + IMMEDIATE_ADD,
      ['iPos', 'iColor', 'iParams', 'iDir'],
      addMat,
    );
    this.dotBatch = new InstanceBatch(MAX_DOTS, ['iPos', 'iColor'], dotMat);
    const chunk = debrisChunkGeometry();
    this.debrisBatch = new InstanceBatch(DEBRIS_MAX, ['iPos', 'iQuat', 'iScale'], debrisMat, chunk);
    this.ribbons = new RibbonBuffers(TRAIL_SLOTS, TRAIL_POINTS, ribbonAlphaMat, ribbonAddMat);
    this.ribbonMaterials = [ribbonAlphaMat, ribbonAddMat];

    this.ribbons.alphaMesh.renderOrder = RENDER_ORDER.ribbonAlpha;
    this.alphaBatch.mesh.renderOrder = RENDER_ORDER.particlesAlpha;
    this.dotBatch.mesh.renderOrder = RENDER_ORDER.dots;
    this.ribbons.addMesh.renderOrder = RENDER_ORDER.ribbonAdd;
    this.addBatch.mesh.renderOrder = RENDER_ORDER.particlesAdd;

    const meshes = [
      this.ribbons.alphaMesh,
      this.alphaBatch.mesh,
      this.dotBatch.mesh,
      this.ribbons.addMesh,
      this.addBatch.mesh,
      this.debrisBatch.mesh,
    ];
    const onBeforeRender = (renderer: WebGLRenderer): void => {
      const rt = renderer.getRenderTarget();
      if (rt) this.viewport.value.set(rt.width, rt.height);
      else renderer.getDrawingBufferSize(this.viewport.value);
      this.drawCounter++;
    };
    for (const m of meshes) {
      m.onBeforeRender = onBeforeRender;
      this.root.add(m);
    }
    // Two explosion lights that always exist (intensity 0 when idle) so the light count never changes.
    for (let i = 0; i < 2; i++) {
      const light = new PointLight(0xffffff, 0, 1, 2);
      light.name = `fx-flash-${i}`;
      this.lights.push(light);
      this.root.add(light);
    }

    this.debrisEmitter = {
      smoke: (x, y, z, vx, vy, vz, strength) => this.debrisSmoke(x, y, z, vx, vy, vz, strength),
      fire: (x, y, z, vx, vy, vz) => this.debrisFire(x, y, z, vx, vy, vz),
      trail: (slot, gen, x, y, z, intensity) => {
        if (this.trails.owns(slot, gen)) this.trails.push(slot, x, y, z, intensity);
      },
      trailEnd: (slot, gen) => {
        if (this.trails.owns(slot, gen)) this.trails.release(slot);
      },
    };
  }

  // ───────────────────────────────────────────────────────────── Events

  explosion(position: Vector3, kind: ExplosionKind, velocity?: Vector3): void {
    const def = EXPLOSIONS[kind];
    if (!def || !isFiniteVec(position)) return;
    let bvx = 0;
    let bvy = 0;
    let bvz = 0;
    if (velocity && isFiniteVec(velocity)) {
      bvx = velocity.x;
      bvy = velocity.y;
      bvz = velocity.z;
    }
    const detail = this.burstDetail();
    const { x, y, z } = position;
    for (let i = 0; i < def.emitters.length; i++) {
      emitBurst(
        this.ps,
        this.rng,
        def.emitters[i]!,
        x,
        y,
        z,
        bvx,
        bvy,
        bvz,
        0,
        1,
        0,
        detail,
        this.spriteBrightness,
      );
    }
    const f = def.flash;
    const lift = kind === 'ground' ? 8 : kind === 'water' ? 4 : 0;
    this.flashes.add(x, y + lift, z, f.color[0], f.color[1], f.color[2], f.intensity, f.radius, f.duration);
    if (def.debris) {
      const n = Math.max(1, Math.round(def.debris.count * detail));
      this.spawnDebris(def.debris, x, y, z, bvx, bvy, bvz, n);
    }
  }

  impact(position: Vector3, normal: Vector3, kind: ImpactKind): void {
    const defs = IMPACTS[kind];
    if (!defs || !isFiniteVec(position)) return;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (isFiniteVec(normal)) {
      const l = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
      if (l > 1e-6) {
        nx = normal.x / l;
        ny = normal.y / l;
        nz = normal.z / l;
      }
    }
    const x = position.x + nx * 0.15;
    const y = position.y + ny * 0.15;
    const z = position.z + nz * 0.15;
    const detail = this.burstDetail();
    for (let i = 0; i < defs.length; i++) {
      emitBurst(this.ps, this.rng, defs[i]!, x, y, z, 0, 0, 0, nx, ny, nz, detail, this.spriteBrightness);
    }
  }

  debris(position: Vector3, velocity: Vector3, count: number): void {
    if (!isFiniteVec(position) || !isFiniteVec(velocity) || !(count > 0)) return;
    const n = Math.min(32, Math.floor(count));
    this.spawnDebris(
      DEBRIS_PUBLIC,
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
      n,
    );
  }

  trail(kind: TrailKind): TrailHandle | null {
    const layout = TRAIL_LAYOUT[kind];
    if (!layout) return null;
    const main = this.allocRibbon(layout[0]);
    if (main < 0) return null;
    const core = layout[1] >= 0 ? this.allocRibbon(layout[1]) : -1;
    return new FxTrail(
      this.trails,
      main,
      this.trails.gen[main]!,
      core,
      core >= 0 ? this.trails.gen[core]! : 0,
    );
  }

  glow(position: Vector3, color: Color, size: number, intensity: number): void {
    if (this.glowN >= MAX_GLOWS || !isFiniteVec(position)) return;
    if (!(size > 0) || !(intensity > 0) || !Number.isFinite(size) || !Number.isFinite(intensity)) return;
    const o = this.glowN * 8;
    const q = this.glowQ;
    q[o] = position.x;
    q[o + 1] = position.y;
    q[o + 2] = position.z;
    q[o + 3] = color.r * intensity;
    q[o + 4] = color.g * intensity;
    q[o + 5] = color.b * intensity;
    q[o + 6] = size;
    q[o + 7] = 0;
    this.glowN++;
  }

  tracer(from: Vector3, to: Vector3, color: Color, width: number): void {
    if (this.tracerN >= MAX_TRACERS || !isFiniteVec(from) || !isFiniteVec(to)) return;
    if (!(width > 0) || !Number.isFinite(width)) return;
    const o = this.tracerN * 10;
    const q = this.tracerQ;
    q[o] = from.x;
    q[o + 1] = from.y;
    q[o + 2] = from.z;
    q[o + 3] = to.x;
    q[o + 4] = to.y;
    q[o + 5] = to.z;
    q[o + 6] = color.r;
    q[o + 7] = color.g;
    q[o + 8] = color.b;
    q[o + 9] = width;
    this.tracerN++;
  }

  dot(position: Vector3, color: Color): void {
    if (this.dotN >= MAX_DOTS || !isFiniteVec(position)) return;
    const o = this.dotN * 7;
    const q = this.dotQ;
    q[o] = position.x;
    q[o + 1] = position.y;
    q[o + 2] = position.z;
    q[o + 3] = color.r;
    q[o + 4] = color.g;
    q[o + 5] = color.b;
    q[o + 6] = 1;
    this.dotN++;
  }

  flash(position: Vector3, color: Color, intensity: number, radius: number, duration: number): void {
    if (!isFiniteVec(position)) return;
    this.flashes.add(
      position.x,
      position.y,
      position.z,
      color.r,
      color.g,
      color.b,
      intensity,
      radius,
      duration,
    );
  }

  muzzle(position: Vector3, direction: Vector3, scale: number): void {
    if (this.muzzleN >= MAX_MUZZLES || !isFiniteVec(position) || !(scale > 0) || !Number.isFinite(scale))
      return;
    let dx = 0;
    let dy = 0;
    let dz = -1;
    if (isFiniteVec(direction)) {
      const l = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
      if (l > 1e-6) {
        dx = direction.x / l;
        dy = direction.y / l;
        dz = direction.z / l;
      }
    }
    const o = this.muzzleN * 8;
    const q = this.muzzleQ;
    q[o] = position.x;
    q[o + 1] = position.y;
    q[o + 2] = position.z;
    q[o + 3] = dx;
    q[o + 4] = dy;
    q[o + 5] = dz;
    q[o + 6] = scale;
    q[o + 7] = this.rng.next() * TAU;
    this.muzzleN++;
  }

  setQuality(level: QualityLevel, reduceFlashes: boolean): void {
    this.quality = level;
    this.ps.limit = PARTICLE_CAPACITY[level];
    this.detail = DETAIL[level];
    this.debrisSim.intervalScale = 1 / this.detail;
    this.flashes.reduce = reduceFlashes;
    this.spriteBrightness = reduceFlashes ? FLASH_SPRITE_REDUCED : 1;
  }

  // ───────────────────────────────────────────────────────────── Frame

  update(dt: number, camera: PerspectiveCamera, surfaceAt: (x: number, z: number) => number): void {
    const t0 = performance.now();
    const step = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
    this.drawCalls = this.drawCounter;
    this.drawCounter = 0;
    this.time += step;
    this.fxTime.value = this.time;
    this.readCamera(camera);
    const surface = typeof surfaceAt === 'function' ? surfaceAt : noSurface;

    this.flashes.update(step);
    this.applyFlashes();
    this.debrisSim.update(step, surface, this.debrisEmitter);
    this.ps.update(step, surface, WIND.x, WIND.y, WIND.z);
    this.trails.update(step);

    this.buildParticles();
    this.buildRibbons();
    this.buildDots();
    this.debrisBatch.count = this.debrisSim.write(
      this.debrisBatch.data[0]!,
      this.debrisBatch.data[1]!,
      this.debrisBatch.data[2]!,
    );
    this.debrisBatch.commit();

    this.statGlows = this.glowN;
    this.glowN = 0;
    this.tracerN = 0;
    this.muzzleN = 0;
    this.dotN = 0;
    this.updateMs = performance.now() - t0;
  }

  /** Returns the same object every call (no per-frame allocation). */
  stats(): { particles: number; trails: number; glows: number } {
    const s = this.statsOut;
    s.particles = this.ps.live;
    s.trails = this.trails.active;
    s.glows = this.statGlows;
    return s;
  }

  clear(): void {
    this.ps.clear();
    this.trails.clear();
    this.debrisSim.clear();
    this.flashes.clear();
    this.applyFlashes();
    this.glowN = 0;
    this.tracerN = 0;
    this.muzzleN = 0;
    this.dotN = 0;
    this.statGlows = 0;
    for (const b of [this.alphaBatch, this.addBatch, this.dotBatch, this.debrisBatch]) {
      b.count = 0;
      b.commit();
    }
    this.ribbons.commit(0, 0, 0, 0, 0, 0);
  }

  async warmup(renderer: WebGLRenderer, camera: PerspectiveCamera): Promise<void> {
    this.readCamera(camera);
    this.fillWarmup();
    // Compile against the root's own light set, then render it once into a tiny target so the programs,
    // attribute buffers and textures are all uploaded before the first explosion (ZD-C02). ShaderMaterials
    // with lights: false keep this program when later drawn in the full scene. The target is bound before
    // compiling because three picks the linear-output program for render targets and the sRGB one for the
    // canvas; the game always draws into the composer's linear buffer.
    const rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    let pending: Promise<unknown> | null = null;
    if (renderer.extensions.has('KHR_parallel_shader_compile'))
      pending = renderer.compileAsync(this.root, camera);
    else renderer.compile(this.root, camera);
    renderer.setRenderTarget(previous);
    if (pending) await pending;
    renderer.setRenderTarget(rt);
    renderer.render(this.root, camera);
    renderer.setRenderTarget(previous);
    rt.dispose();
    // Drop the warmup instances; live effects are rebuilt from the simulation on the next update().
    for (const b of [this.alphaBatch, this.addBatch, this.dotBatch, this.debrisBatch]) {
      b.count = 0;
      b.commit();
    }
    this.ribbons.commit(0, 0, 0, 0, 0, 0);
  }

  dispose(): void {
    this.clear();
    this.alphaBatch.dispose();
    this.addBatch.dispose();
    this.dotBatch.dispose();
    this.debrisBatch.dispose();
    this.ribbons.dispose();
    for (const m of this.ribbonMaterials) m.dispose();
    this.atlas.dispose();
    this.noise.dispose();
    for (const l of this.lights) {
      l.intensity = 0;
      l.removeFromParent();
      l.dispose();
    }
    this.root.removeFromParent();
    this.root.clear();
  }

  // ───────────────────────────────────────────────────────────── Internals

  private burstDetail(): number {
    const full = this.ps.live > this.ps.limit * HEADROOM_FRACTION;
    return this.detail * (full ? 0.5 : 1);
  }

  private allocRibbon(kind: number): number {
    const def = RIBBON_DEFS[kind];
    if (!def) return -1;
    const lim = TRAIL_SLOT_LIMIT[this.quality];
    const seed = this.rng.next();
    return def.additive
      ? this.trails.allocate(kind, TRAIL_ALPHA_SLOTS, TRAIL_ALPHA_SLOTS + lim.add, seed)
      : this.trails.allocate(kind, 0, lim.alpha, seed);
  }

  private readCamera(camera: PerspectiveCamera): void {
    camera.updateWorldMatrix(true, false);
    const e = camera.matrixWorld.elements;
    this.cam.x = e[12]!;
    this.cam.y = e[13]!;
    this.cam.z = e[14]!;
    let l = Math.hypot(e[0]!, e[1]!, e[2]!) || 1;
    this.camRight.x = e[0]! / l;
    this.camRight.y = e[1]! / l;
    this.camRight.z = e[2]! / l;
    l = Math.hypot(e[8]!, e[9]!, e[10]!) || 1;
    this.camFwd.x = -e[8]! / l;
    this.camFwd.y = -e[9]! / l;
    this.camFwd.z = -e[10]! / l;
  }

  private pick(r: Range): number {
    return r[0] === r[1] ? r[0] : this.rng.range(r[0], r[1]);
  }

  private spawnDebris(
    def: DebrisDef,
    x: number,
    y: number,
    z: number,
    bvx: number,
    bvy: number,
    bvz: number,
    count: number,
  ): void {
    const rng = this.rng;
    for (let k = 0; k < count; k++) {
      const cz = rng.next() * 2 - 1;
      const a = rng.next() * TAU;
      const s = Math.sqrt(Math.max(0, 1 - cz * cz));
      const dx = s * Math.cos(a);
      const dy = Math.abs(cz) * 0.8 + 0.2;
      const dz = s * Math.sin(a);
      const speed = this.pick(def.speed);
      const i = this.debrisSim.spawn(
        x + dx * 1.5,
        y + dy * 1.5,
        z + dz * 1.5,
        dx * speed + bvx * def.inherit,
        dy * speed + bvy * def.inherit,
        dz * speed + bvz * def.inherit,
        this.pick(def.size),
        this.pick(def.life),
        rng.next() < def.burning,
        rng.next(),
        rng.next(),
        rng.next(),
      );
      if (i < 0) return;
      const lim = TRAIL_SLOT_LIMIT[this.quality].alpha - DEBRIS_RIBBON_RESERVE;
      const slot = this.trails.allocate(RIBBON.DEBRIS, 0, lim, rng.next());
      if (slot >= 0) this.debrisSim.attachRibbon(i, slot, this.trails.gen[slot]!);
    }
  }

  private debrisSmoke(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    strength: number,
  ): void {
    const rng = this.rng;
    const i = this.ps.spawn(
      STYLE.SMOKE,
      x + (rng.next() - 0.5) * 0.6,
      y + (rng.next() - 0.5) * 0.6,
      z + (rng.next() - 0.5) * 0.6,
      vx * 0.08 + (rng.next() - 0.5) * 2,
      vy * 0.08 + (rng.next() - 0.5) * 2,
      vz * 0.08 + (rng.next() - 0.5) * 2,
      this.pick(DEBRIS.smokeLife),
      this.pick(DEBRIS.smokeSize0),
      this.pick(DEBRIS.smokeSize1),
    );
    if (i < 0) return;
    const c = DEBRIS.smokeColor;
    const j = 0.85 + rng.next() * 0.3;
    this.ps.cr[i] = c[0] * j;
    this.ps.cg[i] = c[1] * j;
    this.ps.cb[i] = c[2] * j;
    this.ps.alpha[i] = DEBRIS.smokeAlpha * strength;
    this.ps.emissive[i] = strength > 0.9 ? 0.25 : 0;
    this.ps.rot[i] = rng.next() * TAU;
    this.ps.rotVel[i] = (rng.next() * 2 - 1) * 0.4;
    this.ps.layer[i] = LAYER.PUFF + rng.int(0, LAYER.PUFF_COUNT - 1);
    this.ps.seed[i] = rng.next();
  }

  private debrisFire(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const rng = this.rng;
    const i = this.ps.spawn(
      STYLE.FIRE,
      x,
      y,
      z,
      vx * 0.3,
      vy * 0.3,
      vz * 0.3,
      this.pick(DEBRIS.fireLife),
      this.pick(DEBRIS.fireSize0),
      this.pick(DEBRIS.fireSize1),
    );
    if (i < 0) return;
    this.ps.heat[i] = 1.05;
    this.ps.alpha[i] = 0.9;
    this.ps.rot[i] = rng.next() * TAU;
    this.ps.layer[i] = LAYER.FIRE + rng.int(0, LAYER.FIRE_COUNT - 1);
    this.ps.seed[i] = rng.next();
  }

  private applyFlashes(): void {
    const fp = this.flashes;
    const P = atmoUniforms.uFlashPos.value;
    const C = atmoUniforms.uFlashColor.value;
    let best = -1;
    let second = -1;
    let bestScore = 0;
    let secondScore = 0;
    for (let i = 0; i < MAX_FLASHES; i++) {
      const p = P[i]!;
      const c = C[i]!;
      const env = fp.env[i]!;
      if (fp.active[i] === 1 && env > 0) {
        const k = fp.intensity[i]! * env;
        p.set(fp.x[i]!, fp.y[i]!, fp.z[i]!, fp.radius[i]! * (0.7 + 0.3 * env));
        c.set(fp.r[i]! * k, fp.g[i]! * k, fp.b[i]! * k);
        const score = k * fp.radius[i]!;
        if (score > bestScore) {
          second = best;
          secondScore = bestScore;
          best = i;
          bestScore = score;
        } else if (score > secondScore) {
          second = i;
          secondScore = score;
        }
      } else {
        p.set(0, 0, 0, 0);
        c.set(0, 0, 0);
      }
    }
    for (let l = 0; l < this.lights.length; l++) {
      const light = this.lights[l]!;
      const i = l === 0 ? best : second;
      if (i < 0) {
        light.intensity = 0;
        continue;
      }
      const r = fp.radius[i]!;
      light.position.set(fp.x[i]!, fp.y[i]!, fp.z[i]!);
      light.color.setRGB(fp.r[i]!, fp.g[i]!, fp.b[i]!);
      light.intensity = fp.intensity[i]! * fp.env[i]! * r * r * FLASH_LIGHT_SCALE;
      light.distance = r * 1.25;
    }
  }

  private buildParticles(): void {
    const ps = this.ps;
    const { px, py, pz, vx, vy, vz, age, life, alpha, style, rot, layer, cr, cg, cb, heat, seed, fade } = ps;
    const aP = this.alphaBatch.data[0]!;
    const aC = this.alphaBatch.data[1]!;
    const aR = this.alphaBatch.data[2]!;
    const aE = this.alphaBatch.data[3]!;
    const dP = this.addBatch.data[0]!;
    const dC = this.addBatch.data[1]!;
    const dR = this.addBatch.data[2]!;
    const dD = this.addBatch.data[3]!;
    const cx = this.cam.x;
    const cy = this.cam.y;
    const cz = this.cam.z;
    const fx = this.camFwd.x;
    const fy = this.camFwd.y;
    const fz = this.camFwd.z;
    const keys = this.sortKeys;
    const idx = this.sortIdx;
    let nA = 0;
    let nD = 0;
    for (let i = 0; i < ps.high; i++) {
      if (ps.alive[i] === 0) continue;
      const a0 = age[i]!;
      if (a0 < 0) continue;
      const s = style[i]!;
      const def = STYLES[s]!;
      const t = Math.min(1, a0 / life[i]!);
      const size = ps.sizeOf(i);
      let a = alpha[i]!;
      if (def.fadeIn > 0 && t < def.fadeIn) a *= t / def.fadeIn;
      if (t > def.fadeOut) {
        const u = (t - def.fadeOut) / (1 - def.fadeOut);
        a *= 1 - u * u * (3 - 2 * u);
      }
      const f = fade[i]!;
      if (f > 0) a *= f / CONTACT_FADE;
      if (a < 0.003) continue;
      const dx = px[i]! - cx;
      const dy = py[i]! - cy;
      const dz = pz[i]! - cz;
      if (dx * fx + dy * fy + dz * fz < -size) continue;
      if (def.additive) {
        const o = nD * 4;
        dP[o] = px[i]!;
        dP[o + 1] = py[i]!;
        dP[o + 2] = pz[i]!;
        dP[o + 3] = size;
        if (def.mode === MODE_FIRE) {
          dC[o] = heat[i]! * (1 - t) * (1 - 0.5 * t);
          dC[o + 1] = seed[i]!;
          dC[o + 2] = a0;
          dC[o + 3] = a;
        } else {
          const k = def.cool * t;
          dC[o] = cr[i]! * Math.max(0, 1 - 0.25 * k);
          dC[o + 1] = cg[i]! * Math.max(0, 1 - 0.7 * k);
          dC[o + 2] = cb[i]! * Math.max(0, 1 - 0.92 * k);
          dC[o + 3] = a;
        }
        dR[o] = rot[i]!;
        dR[o + 1] = layer[i]! + 16 * def.mode;
        dR[o + 2] = MIN_SPRITE_PX;
        dR[o + 3] = 0;
        if (def.mode === MODE_STREAK) {
          const svx = vx[i]!;
          const svy = vy[i]!;
          const svz = vz[i]!;
          const sp = Math.sqrt(svx * svx + svy * svy + svz * svz);
          const inv = sp > 1e-4 ? 1 / sp : 0;
          dD[o] = svx * inv;
          dD[o + 1] = sp > 1e-4 ? svy * inv : 1;
          dD[o + 2] = svz * inv;
          dD[o + 3] = Math.max(sp * def.stretch, size * 2);
        } else {
          dD[o] = 0;
          dD[o + 1] = 0;
          dD[o + 2] = 0;
          dD[o + 3] = 0;
        }
        nD++;
      } else {
        keys[nA] = farFirstKey(dx * dx + dy * dy + dz * dz);
        idx[nA] = i;
        this.renderSize[i] = size;
        this.renderAlpha[i] = a;
        nA++;
      }
    }

    this.sorter.sort(keys, idx, nA);
    const { ground, emissive } = ps;
    for (let j = 0; j < nA; j++) {
      const i = idx[j]!;
      const s = style[i]!;
      const def = STYLES[s]!;
      const o = j * 4;
      aP[o] = px[i]!;
      aP[o + 1] = py[i]!;
      aP[o + 2] = pz[i]!;
      aP[o + 3] = this.renderSize[i]!;
      aC[o] = cr[i]!;
      aC[o + 1] = cg[i]!;
      aC[o + 2] = cb[i]!;
      aC[o + 3] = this.renderAlpha[i]!;
      const t = Math.min(1, age[i]! / life[i]!);
      const g = ground[i]!;
      const e = Math.max(0, 1 - age[i]! / EMISSIVE_DECAY);
      aR[o] = rot[i]!;
      aR[o + 1] = layer[i]! + 16 * def.mode;
      aR[o + 2] = Number.isNaN(g) ? -1e9 : g;
      aR[o + 3] = emissive[i]! * e * e;
      aE[o] = def.erode * t * Math.sqrt(t);
      aE[o + 1] = seed[i]!;
      aE[o + 2] = 0;
      aE[o + 3] = 0;
    }
    this.alphaBatch.count = nA;
    this.alphaBatch.commit();

    nD = this.writeImmediates(nD, dP, dC, dR, dD);
    this.addBatch.count = nD;
    this.addBatch.commit();
  }

  private writeImmediates(
    start: number,
    P: Float32Array,
    C: Float32Array,
    R: Float32Array,
    D: Float32Array,
  ): number {
    let n = start;
    const cap = this.addBatch.capacity;
    const q = this.glowQ;
    for (let g = 0; g < this.glowN && n < cap; g++) {
      const s = g * 8;
      const o = n * 4;
      P[o] = q[s]!;
      P[o + 1] = q[s + 1]!;
      P[o + 2] = q[s + 2]!;
      P[o + 3] = q[s + 6]!;
      C[o] = q[s + 3]!;
      C[o + 1] = q[s + 4]!;
      C[o + 2] = q[s + 5]!;
      C[o + 3] = 1;
      R[o] = 0;
      R[o + 1] = LAYER.GLOW + 16 * MODE_GLOW;
      R[o + 2] = MIN_GLOW_PX;
      R[o + 3] = 0;
      D[o] = 0;
      D[o + 1] = 0;
      D[o + 2] = 0;
      D[o + 3] = 0;
      n++;
    }
    const t = this.tracerQ;
    for (let k = 0; k < this.tracerN && n < cap; k++) {
      const s = k * 10;
      const ex = t[s + 3]! - t[s]!;
      const ey = t[s + 4]! - t[s + 1]!;
      const ez = t[s + 5]! - t[s + 2]!;
      const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (len < 1e-4) continue;
      const o = n * 4;
      P[o] = t[s + 3]!;
      P[o + 1] = t[s + 4]!;
      P[o + 2] = t[s + 5]!;
      P[o + 3] = t[s + 9]!;
      C[o] = t[s + 6]!;
      C[o + 1] = t[s + 7]!;
      C[o + 2] = t[s + 8]!;
      C[o + 3] = 1;
      R[o] = 0;
      R[o + 1] = LAYER.STREAK + 16 * MODE_STREAK;
      R[o + 2] = MIN_TRACER_PX;
      R[o + 3] = 0;
      D[o] = ex / len;
      D[o + 1] = ey / len;
      D[o + 2] = ez / len;
      D[o + 3] = len;
      n++;
    }
    const m = this.muzzleQ;
    const b = this.spriteBrightness;
    for (let k = 0; k < this.muzzleN && n + 1 < cap; k++) {
      const s = k * 8;
      const x = m[s]!;
      const y = m[s + 1]!;
      const z = m[s + 2]!;
      const dx = m[s + 3]!;
      const dy = m[s + 4]!;
      const dz = m[s + 5]!;
      const sc = m[s + 6]!;
      let o = n * 4;
      P[o] = x;
      P[o + 1] = y;
      P[o + 2] = z;
      P[o + 3] = MUZZLE.starSize * sc;
      C[o] = MUZZLE.starColor[0] * b;
      C[o + 1] = MUZZLE.starColor[1] * b;
      C[o + 2] = MUZZLE.starColor[2] * b;
      C[o + 3] = 1;
      R[o] = m[s + 7]!;
      R[o + 1] = LAYER.MUZZLE + 16 * MODE_SPRITE;
      R[o + 2] = MIN_SPRITE_PX;
      R[o + 3] = 0;
      D[o] = 0;
      D[o + 1] = 0;
      D[o + 2] = 0;
      D[o + 3] = 0;
      n++;
      const len = MUZZLE.flameLength * sc;
      o = n * 4;
      P[o] = x + dx * len;
      P[o + 1] = y + dy * len;
      P[o + 2] = z + dz * len;
      P[o + 3] = MUZZLE.flameWidth * sc;
      C[o] = MUZZLE.flameColor[0] * b;
      C[o + 1] = MUZZLE.flameColor[1] * b;
      C[o + 2] = MUZZLE.flameColor[2] * b;
      C[o + 3] = 1;
      R[o] = 0;
      R[o + 1] = LAYER.STREAK + 16 * MODE_STREAK;
      R[o + 2] = MIN_SPRITE_PX;
      R[o + 3] = 0;
      D[o] = dx;
      D[o + 1] = dy;
      D[o + 2] = dz;
      D[o + 3] = len;
      n++;
    }
    return n;
  }

  private buildRibbons(): void {
    const tr = this.trails;
    const out = this.ribbons;
    const order = this.trailOrder;
    const keys = this.trailKeys;
    let n = 0;
    let maxA = -1;
    for (let s = 0; s < TRAIL_ALPHA_SLOTS; s++) {
      if (tr.state[s] === FREE || tr.count[s]! < 2) continue;
      tr.buildRibbon(s, this.cam, this.camRight, tr.kind[s]!, out);
      // Insertion sort, farthest ribbon first.
      const key = tr.distanceSq(s, this.cam);
      let j = n;
      while (j > 0 && keys[j - 1]! < key) {
        keys[j] = keys[j - 1]!;
        order[j] = order[j - 1]!;
        j--;
      }
      keys[j] = key;
      order[j] = s;
      n++;
      maxA = s;
    }
    let w = 0;
    for (let k = 0; k < n; k++) w = tr.writeIndices(order[k]!, this.cam, out.index, w);
    const nA = w;
    let maxB = -1;
    for (let s = TRAIL_ALPHA_SLOTS; s < TRAIL_SLOTS; s++) {
      if (tr.state[s] === FREE || tr.count[s]! < 2) continue;
      tr.buildRibbon(s, this.cam, this.camRight, tr.kind[s]!, out);
      w = tr.writeIndices(s, this.cam, out.index, w);
      maxB = s;
    }
    const per = TRAIL_POINTS * 2;
    out.commit(
      0,
      (maxA + 1) * per,
      TRAIL_ALPHA_SLOTS * per,
      maxB < 0 ? TRAIL_ALPHA_SLOTS * per : (maxB + 1) * per,
      nA,
      w - nA,
    );
  }

  private buildDots(): void {
    const P = this.dotBatch.data[0]!;
    const C = this.dotBatch.data[1]!;
    const q = this.dotQ;
    for (let k = 0; k < this.dotN; k++) {
      const s = k * 7;
      const o = k * 4;
      P[o] = q[s]!;
      P[o + 1] = q[s + 1]!;
      P[o + 2] = q[s + 2]!;
      P[o + 3] = DOT_WORLD_SIZE;
      C[o] = q[s + 3]!;
      C[o + 1] = q[s + 4]!;
      C[o + 2] = q[s + 5]!;
      C[o + 3] = q[s + 6]!;
    }
    this.dotBatch.count = this.dotN;
    this.dotBatch.commit();
  }

  /** One instance of everything, 60 m in front of the camera, for warmup. */
  private fillWarmup(): void {
    const x = this.cam.x + this.camFwd.x * 60;
    const y = this.cam.y + this.camFwd.y * 60;
    const z = this.cam.z + this.camFwd.z * 60;
    const put = (b: InstanceBatch, n: number, values: readonly number[][]): void => {
      for (let a = 0; a < b.data.length; a++) {
        const v = values[a]!;
        for (let k = 0; k < n; k++) b.data[a]!.set(v, k * 4);
      }
      b.count = n;
      b.commit();
    };
    put(this.alphaBatch, 1, [
      [x, y, z, 1],
      [0, 0, 0, 0.001],
      [0, LAYER.PUFF, -1e9, 0],
      [0, 0, 0, 0],
    ]);
    put(this.addBatch, 1, [
      [x, y, z, 1],
      [0, 0, 0, 0],
      [0, LAYER.GLOW, MIN_SPRITE_PX, 0],
      [0, 1, 0, 1],
    ]);
    // Exercise the fire and streak paths too (same program, but different texture fetches).
    this.addBatch.data[2]!.set([0, LAYER.FIRE + 16 * MODE_FIRE, MIN_SPRITE_PX, 0], 4);
    this.addBatch.data[2]!.set([0, LAYER.STREAK + 16 * MODE_STREAK, MIN_SPRITE_PX, 0], 8);
    for (let a = 0; a < 4; a++) {
      if (a !== 2) {
        this.addBatch.data[a]!.copyWithin(4, 0, 4);
        this.addBatch.data[a]!.copyWithin(8, 0, 4);
      }
    }
    this.addBatch.count = 3;
    this.addBatch.commit();
    put(this.dotBatch, 1, [
      [x, y, z, 1],
      [0, 0, 0, 0.001],
    ]);
    put(this.debrisBatch, 1, [
      [x, y, z, 0],
      [0, 0, 0, 1],
      [0.001, 0.001, 0.001, 0],
    ]);
    // A two-point ribbon in the first smoke slot and the first additive slot.
    const r = this.ribbons;
    const per = TRAIL_POINTS * 2;
    for (const base of [0, TRAIL_ALPHA_SLOTS * per]) {
      for (let v = 0; v < 4; v++) {
        r.center.set([x, y + v * 0.01, z], (base + v) * 3);
        r.side.set([1, 0, 0], (base + v) * 3);
        r.data.set([0, 0, 0, 0.001], (base + v) * 4);
      }
    }
    r.index.set([0, 1, 2, 1, 3, 2], 0);
    const b0 = TRAIL_ALPHA_SLOTS * per;
    r.index.set([b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2], 6);
    r.commit(0, 4, b0, b0 + 4, 6, 6);
  }
}

/** Creates the effects system. `seed` makes effect variation reproducible (harness captures). */
export function createFx(seed?: number): Fx {
  return new FxSystem(seed);
}

export function createFxSystem(seed?: number): FxSystem {
  return new FxSystem(seed);
}

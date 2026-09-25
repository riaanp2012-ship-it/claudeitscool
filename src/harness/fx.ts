/**
 * Effects harness: deterministic scripted scenes over a simple ground/water plane under the shared sky.
 *   ?scene=air|ground|water|trails|stress   (default air)
 *   ?t=<seconds>   fast-forward the script at a fixed 120 Hz step and freeze there (for captures)
 *   ?live=1        keep simulating in real time after the fast-forward
 *   ?fov=<deg>     override the camera field of view (telephoto close-ups)
 *   ?reduce=1      reduced flashes
 * window.__HARNESS_INFO__ reports particle/trail counts, fx draw calls and update() CPU time.
 */
import {
  BackSide,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from 'three';
import type { TrailHandle } from '../core/types';
import { Rng } from '../core/rng';
import { ATMOSPHERE_GLSL, atmoUniforms } from '../render/atmosphere';
import { fractal } from '../fx/atlas';
import { createFxSystem } from '../fx';
import { createHarness } from './common';

const params = new URLSearchParams(window.location.search);
const sceneName = params.get('scene') ?? 'air';
const tParam = params.get('t');
const live = params.get('live') === '1';
const STEP = 1 / 120;

const h = createHarness({ readyAfterFrames: Number.MAX_SAFE_INTEGER });
const fx = createFxSystem(0x51a5);
h.scene.add(fx.root);
const rng = new Rng(0xf00d);
const surfaceAt = (): number => 0;

// ─────────────────────────────────────────────────────────────── Backdrop (sky dome, ground, water)

const LOGDEPTH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;
const FRAG_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
varying vec3 vWorld;
`;
const FRAG_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

const sky = new Mesh(
  new SphereGeometry(90000, 48, 24),
  new ShaderMaterial({
    vertexShader: LOGDEPTH_VERT,
    fragmentShader: /* glsl */ `${FRAG_HEAD}
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 c = atmoSky(d);
  c += uSunColor * 6.0 * smoothstep(0.99955, 0.99985, dot(d, uSunDir));
  gl_FragColor = vec4(c, 1.0);
  ${FRAG_TAIL}
}`,
    uniforms: { ...atmoUniforms },
    side: BackSide,
    depthWrite: false,
  }),
);
sky.renderOrder = -1000;
sky.frustumCulled = false;
h.scene.add(sky);

const N = 256;
const noiseData = new Uint8Array(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4;
    noiseData[o] = Math.round(fractal((x / N) * 8, (y / N) * 8, 5, 5, 0, 8) * 255);
    noiseData[o + 1] = Math.round(fractal((x / N) * 16, (y / N) * 16, 9, 4, 1, 16) * 255);
    noiseData[o + 2] = Math.round(fractal((x / N) * 4, (y / N) * 4, 13, 5, 2, 4) * 255);
    noiseData[o + 3] = 255;
  }
}
const noiseTex = new DataTexture(noiseData, N, N, RGBAFormat, UnsignedByteType);
noiseTex.wrapS = RepeatWrapping;
noiseTex.wrapT = RepeatWrapping;
noiseTex.minFilter = LinearMipmapLinearFilter;
noiseTex.magFilter = LinearFilter;
noiseTex.generateMipmaps = true;
noiseTex.colorSpace = NoColorSpace;
noiseTex.needsUpdate = true;

const isWater = sceneName === 'water';
const surface = new Mesh(
  new PlaneGeometry(80000, 80000, 1, 1).rotateX(-Math.PI / 2),
  new ShaderMaterial({
    vertexShader: LOGDEPTH_VERT,
    fragmentShader: isWater
      ? /* glsl */ `${FRAG_HEAD}
uniform sampler2D uNoise;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += (texture2D(uNoise, p / 61.0 + vec2(t * 0.011, t * 0.007)).rg - 0.5) * 0.9;
  g += (texture2D(uNoise, p / 17.0 - vec2(t * 0.02, -t * 0.013)).rg - 0.5) * 0.5;
  vec3 N = normalize(vec3(g.x * 0.35, 1.0, g.y * 0.35));
  vec3 ray = vWorld - cameraPosition;
  vec3 V = normalize(-ray);
  vec3 R = reflect(-V, N);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 refl = atmoSky(normalize(vec3(R.x, abs(R.y), R.z)));
  vec3 deep = vec3(0.012, 0.04, 0.05);
  vec3 col = mix(deep * (uAmbientSky + uSunColor * 0.25 * max(uSunDir.y, 0.0)), refl, fres);
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 600.0) * 5.0;
  col += (deep + fres * 0.4) * atmoFlash(vWorld, N);
  gl_FragColor = vec4(atmoApply(col, ray), 1.0);
  ${FRAG_TAIL}
}`
      : /* glsl */ `${FRAG_HEAD}
uniform sampler2D uNoise;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vWorld.xz;
  float macro = texture2D(uNoise, p / 2600.0).r;
  float mid = texture2D(uNoise, p / 420.0).g;
  float fine = texture2D(uNoise, p / 37.0).r;
  vec3 grass = mix(vec3(0.05, 0.075, 0.03), vec3(0.09, 0.1, 0.045), mid);
  vec3 dirt = vec3(0.14, 0.12, 0.085);
  vec3 albedo = mix(grass, dirt, smoothstep(0.3, 0.9, macro * 0.6 + mid * 0.25 + fine * 0.15));
  albedo *= 0.9 + 0.2 * fine;
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 light = uSunColor * max(dot(N, uSunDir), 0.0) + uAmbientSky;
  vec3 col = albedo * (light + atmoFlash(vWorld, N));
  gl_FragColor = vec4(atmoApply(col, vWorld - cameraPosition), 1.0);
  ${FRAG_TAIL}
}`,
    uniforms: { ...atmoUniforms, uNoise: { value: noiseTex } },
  }),
);
surface.frustumCulled = false;
h.scene.add(surface);

// ─────────────────────────────────────────────────────────────── Script helpers

const tmp = new Vector3();
const tmp2 = new Vector3();
const tmp3 = new Vector3();
const UP = new Vector3(0, 1, 0);

class Path {
  constructor(
    readonly p0: Vector3,
    readonly p1: Vector3,
    readonly p2: Vector3,
    readonly p3: Vector3,
    readonly t0: number,
    readonly t1: number,
  ) {}

  at(t: number, out: Vector3): Vector3 {
    const u = Math.min(1, Math.max(0, (t - this.t0) / (this.t1 - this.t0)));
    const v = 1 - u;
    return out
      .copy(this.p0)
      .multiplyScalar(v * v * v)
      .addScaledVector(this.p1, 3 * v * v * u)
      .addScaledVector(this.p2, 3 * v * u * u)
      .addScaledVector(this.p3, u * u * u);
  }
}

interface Missile {
  path: Path;
  trail: TrailHandle | null;
  done: boolean;
  onHit: () => void;
}

const missiles: Missile[] = [];
function missile(
  from: Vector3,
  launchDir: Vector3,
  to: Vector3,
  approach: Vector3,
  t0: number,
  t1: number,
  onHit: () => void,
) {
  const d = from.distanceTo(to);
  missiles.push({
    path: new Path(
      from.clone(),
      from.clone().addScaledVector(launchDir.clone().normalize(), d * 0.35),
      to.clone().addScaledVector(approach.clone().normalize(), -d * 0.35),
      to.clone(),
      t0,
      t1,
    ),
    trail: null,
    done: false,
    onHit,
  });
}

function stepMissiles(t: number): void {
  for (const m of missiles) {
    if (m.done || t < m.path.t0) continue;
    if (t >= m.path.t1) {
      m.done = true;
      m.trail?.release();
      m.onHit();
      continue;
    }
    if (!m.trail) m.trail = fx.trail('missile');
    m.trail?.push(m.path.at(t, tmp), 1);
  }
}

const MOTOR = new Color(1, 0.62, 0.3);
function drawMissiles(t: number): void {
  for (const m of missiles) {
    if (m.done || t < m.path.t0 || t >= m.path.t1) continue;
    fx.glow(m.path.at(t, tmp), MOTOR, 3.5, 9);
  }
}

interface ScriptEvent {
  time: number;
  fired: boolean;
  run: () => void;
}
const events: ScriptEvent[] = [];
const at = (time: number, run: () => void): void => {
  events.push({ time, fired: false, run });
};

interface Round {
  from: Vector3;
  to: Vector3;
  t0: number;
  t1: number;
  hit: boolean;
  onHit: () => void;
}
const rounds: Round[] = [];
const TRACER = new Color(5, 2.6, 1.1);
function drawRounds(t: number): void {
  for (const r of rounds) {
    if (t < r.t0 || t >= r.t1) continue;
    const u = (t - r.t0) / (r.t1 - r.t0);
    tmp.lerpVectors(r.from, r.to, u);
    tmp2.subVectors(r.to, r.from).normalize();
    tmp3.copy(tmp).addScaledVector(tmp2, -28);
    fx.tracer(tmp3, tmp, TRACER, 0.22);
  }
}
function stepRounds(t: number): void {
  for (const r of rounds) {
    if (!r.hit && t >= r.t1) {
      r.hit = true;
      r.onHit();
    }
  }
}

interface SceneDef {
  start: number;
  camPos: Vector3;
  camTarget: Vector3;
  fov: number;
  step?: (t: number) => void;
  visuals?: (t: number) => void;
}

const DOT = new Color(0.035, 0.038, 0.042);
const BURNER = new Color(1, 0.5, 0.2);

// ─────────────────────────────────────────────────────────────── Scenes

function airScene(): SceneDef {
  const e1 = new Vector3(-150, 1545, -300);
  const e2 = new Vector3(-330, 1495, -140);
  const e3 = new Vector3(-40, 1475, -400);
  const v3 = new Vector3(-200, -4, 28);
  missile(
    new Vector3(400, 1380, 250),
    new Vector3(-0.3, 0.5, -0.6),
    e1,
    new Vector3(-0.8, 0.2, -0.3),
    -3.0,
    0.15,
    () => fx.explosion(e1, 'air-large'),
  );
  missile(
    new Vector3(-700, 1300, 400),
    new Vector3(0.2, 0.7, -0.4),
    e2,
    new Vector3(0.3, -0.1, -0.9),
    -2.6,
    0.5,
    () => fx.explosion(e2, 'air-small'),
  );
  missile(
    new Vector3(250, 1700, 0),
    new Vector3(-0.2, -0.1, -1),
    e3,
    new Vector3(-0.9, -0.05, 0.2),
    -2.8,
    0.85,
    () => fx.explosion(e3, 'aircraft', v3),
  );
  let smoke: TrailHandle | null = null;
  return {
    start: -4,
    camPos: new Vector3(0, 1500, 0),
    camTarget: new Vector3(-190, 1525, -280),
    fov: 60,
    step: (t) => {
      stepMissiles(t);
      if (t < 0.85) {
        if (!smoke) smoke = fx.trail('damage-smoke');
        smoke?.push(tmp.copy(e3).addScaledVector(v3, t - 0.85), t > -1.5 ? 1 : 0);
      } else if (smoke) {
        smoke.release();
        smoke = null;
      }
    },
    visuals: (t) => {
      drawMissiles(t);
      if (t < 0.85) {
        const p = tmp2.copy(e3).addScaledVector(v3, t - 0.85);
        fx.dot(p, DOT);
        fx.glow(tmp.copy(p).addScaledVector(v3, -8 / v3.length()), BURNER, 2.2, 4);
      }
    },
  };
}

function groundScene(water: boolean): SceneDef {
  const kind = water ? 'water' : 'ground';
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(-95, 0, -120);
  at(0.1, () => fx.explosion(a, kind));
  at(0.75, () => fx.explosion(b, kind));
  if (!water) at(-0.9, () => fx.explosion(new Vector3(60, 70, -40), 'air-small'));
  // A strafing pass: rounds walk across the surface ahead of the burst.
  const gun0 = new Vector3(760, 430, 560);
  const gunV = new Vector3(-150, -55, -110);
  for (let k = 0; k < 22; k++) {
    const tf = -1.6 + k * 0.055;
    const from = gun0.clone().addScaledVector(gunV, tf + 1.6);
    const to = new Vector3(185 - k * 6.5 + rng.range(-4, 4), 0, 150 - k * 5.2 + rng.range(-4, 4));
    const hitKind = water ? 'water' : 'ground';
    rounds.push({ from, to, t0: tf, t1: tf + 0.7, hit: false, onHit: () => fx.impact(to, UP, hitKind) });
  }
  return {
    start: -2,
    camPos: water ? new Vector3(390, 26, 250) : new Vector3(420, 62, 270),
    camTarget: new Vector3(-20, 30, -20),
    fov: 55,
    step: (t) => stepRounds(t),
    visuals: (t) => drawRounds(t),
  };
}

function trailsScene(): SceneDef {
  const contrails: { off: Vector3; trail: TrailHandle | null }[] = [];
  const lead = (t: number, out: Vector3) => out.set(300 - 240 * t, 9300, -2600);
  const slots = [
    new Vector3(0, 0, 0),
    new Vector3(70, -12, 50),
    new Vector3(140, -24, -55),
    new Vector3(210, -36, 100),
  ];
  const engines = [[-0.8, 0.8], [0], [-0.8, 0.8], [0]];
  slots.forEach((s, i) => {
    for (const z of engines[i]!) contrails.push({ off: new Vector3(s.x + 8, s.y, s.z + z), trail: null });
  });

  // Turning fighter with wingtip vortices, flares and a gun burst.
  const center = new Vector3(-380, 8960, -950);
  const R = 300;
  const w = 0.42;
  const pos = (t: number, out: Vector3) => {
    const th = 0.6 + w * t;
    return out.set(
      center.x + Math.cos(th) * R,
      center.y + Math.sin(t * 0.7) * 25,
      center.z + Math.sin(th) * R,
    );
  };
  const vel = (t: number, out: Vector3) => {
    const th = 0.6 + w * t;
    return out.set(-Math.sin(th) * R * w, Math.cos(t * 0.7) * 17.5, Math.cos(th) * R * w);
  };
  const right = (t: number, out: Vector3) => {
    // Banked ~70°: the lift vector leans toward the turn center.
    const th = 0.6 + w * t;
    const inward = tmp3.set(-Math.cos(th), 0, -Math.sin(th));
    const upv = new Vector3(0, 1, 0).multiplyScalar(Math.cos(1.2)).addScaledVector(inward, Math.sin(1.2));
    const fwd = vel(t, new Vector3()).normalize();
    return out.crossVectors(fwd, upv).normalize();
  };
  const vortices: (TrailHandle | null)[] = [null, null];
  interface Flare {
    p: Vector3;
    v: Vector3;
    t0: number;
    trail: TrailHandle | null;
  }
  const flares: Flare[] = [];
  for (const tf of [-1.7, -1.45, -1.2, -0.95]) {
    for (const side of [-1, 1]) {
      at(tf, () => {
        const p = pos(tf, new Vector3());
        const v = vel(tf, new Vector3()).multiplyScalar(0.8);
        v.addScaledVector(right(tf, new Vector3()), side * 14).add(new Vector3(0, -16, 0));
        flares.push({ p, v, t0: tf, trail: fx.trail('flare') });
      });
    }
  }
  const burst = new Vector3(-560, 8920, -700);
  missile(
    new Vector3(900, 8700, 200),
    new Vector3(-0.5, 0.4, -0.6),
    burst,
    new Vector3(-0.7, 0.1, -0.6),
    -3.2,
    0.35,
    () => fx.explosion(burst, 'air-small'),
  );
  const gunFrom = -0.55;
  const gunTo = -0.15;
  for (let tf = gunFrom; tf < gunTo; tf += 0.045) {
    const from = pos(tf, new Vector3());
    const dir = vel(tf, new Vector3()).normalize();
    const to = from.clone().addScaledVector(dir, 900 * 1.2);
    rounds.push({ from, to, t0: tf, t1: tf + 1.2, hit: true, onHit: () => undefined });
  }
  const FLARE = new Color(1, 0.86, 0.95);
  return {
    start: -12,
    camPos: new Vector3(0, 9000, 0),
    camTarget: new Vector3(-620, 9150, -1500),
    fov: 60,
    step: (t) => {
      stepMissiles(t);
      for (const c of contrails) {
        if (!c.trail) c.trail = fx.trail('contrail');
        c.trail?.push(lead(t, tmp).add(c.off), 1);
      }
      const p = pos(t, tmp2);
      const r = right(t, tmp);
      const g = Math.max(0, Math.sin(t * 0.9 + 0.4));
      for (let k = 0; k < 2; k++) {
        if (!vortices[k]) vortices[k] = fx.trail('vortex');
        const wing = new Vector3().copy(p).addScaledVector(r, k === 0 ? -5.4 : 5.4);
        vortices[k]?.push(wing, g > 0.25 ? g : 0);
      }
      for (const f of flares) {
        if (!f.trail) continue;
        f.v.y -= 9.81 * STEP;
        f.v.multiplyScalar(1 - 0.9 * STEP);
        f.p.addScaledVector(f.v, STEP);
        if (t - f.t0 > 3.2) {
          f.trail.release();
          f.trail = null;
        } else {
          f.trail.push(f.p, 1);
        }
      }
    },
    visuals: (t) => {
      drawMissiles(t);
      drawRounds(t);
      for (let i = 0; i < slots.length; i++) fx.dot(lead(t, tmp).add(slots[i]!), DOT);
      const p = pos(t, tmp2);
      fx.dot(p, DOT);
      const back = vel(t, new Vector3()).normalize().multiplyScalar(-7);
      fx.glow(tmp.copy(p).add(back), BURNER, 2.4, 5);
      for (const f of flares) if (f.trail) fx.glow(f.p, FLARE, 7, 30);
      if (t >= gunFrom && t < gunTo) fx.muzzle(p, vel(t, new Vector3()).normalize(), 1.2);
    },
  };
}

interface StressState {
  trails: (TrailHandle | null)[];
}
function stressScene(): SceneDef {
  const st: StressState = { trails: [] };
  for (let i = 0; i < 40; i++) st.trails.push(null);
  const c = new Color(1, 0.7, 0.4);
  const p = new Vector3();
  return {
    start: -8,
    camPos: new Vector3(0, 320, 1100),
    camTarget: new Vector3(0, 260, 0),
    fov: 60,
    step: (t) => {
      if (fx.stats().particles < 3000) {
        p.set(rng.range(-500, 500), rng.range(150, 450), rng.range(-400, 200));
        fx.explosion(p, 'air-small');
      }
      for (let i = 0; i < st.trails.length; i++) {
        if (!st.trails[i]) st.trails[i] = fx.trail(i % 3 === 0 ? 'contrail' : 'missile');
        const a = t * 0.5 + i;
        st.trails[i]?.push(
          p.set(Math.cos(a) * (300 + i * 5), 250 + Math.sin(a * 1.3) * 80, Math.sin(a) * 300),
          1,
        );
      }
    },
    visuals: (t) => {
      for (let i = 0; i < 200; i++) fx.glow(p.set(i * 5 - 500, 200 + Math.sin(t + i) * 20, -100), c, 2, 3);
      for (let i = 0; i < 64; i++) fx.dot(p.set(i * 12 - 380, 420, -300), DOT);
    },
  };
}

const def: SceneDef =
  sceneName === 'ground'
    ? groundScene(false)
    : sceneName === 'water'
      ? groundScene(true)
      : sceneName === 'trails'
        ? trailsScene()
        : sceneName === 'stress'
          ? stressScene()
          : airScene();

const fovParam = Number(params.get('fov'));
h.camera.fov = fovParam > 1 && fovParam < 120 ? fovParam : def.fov;
h.camera.near = 0.5;
h.camera.position.copy(def.camPos);
h.camera.lookAt(def.camTarget);
h.camera.updateProjectionMatrix();
h.camera.updateMatrixWorld();
sky.position.copy(h.camera.position);
fx.setQuality('high', params.get('reduce') === '1');

// ─────────────────────────────────────────────────────────────── Simulation clock

let simT = def.start;
const updateSamples: number[] = [];
function stepSim(dt: number): void {
  simT += dt;
  atmoUniforms.uTime.value = simT;
  for (const e of events) {
    if (!e.fired && simT >= e.time) {
      e.fired = true;
      e.run();
    }
  }
  def.step?.(simT);
  def.visuals?.(simT);
  fx.update(dt, h.camera, surfaceAt);
  updateSamples.push(fx.updateMs);
  if (updateSamples.length > 240) updateSamples.shift();
}

const target = tParam !== null && Number.isFinite(Number(tParam)) ? Number(tParam) : def.start;
while (simT + STEP <= target + 1e-9) stepSim(STEP);

let stressReport: Record<string, number> | null = null;
if (sceneName === 'stress') {
  // Steady state at ~3000 live particles, then time update() at a 60 Hz step.
  const samples: number[] = [];
  let liveSum = 0;
  for (let i = 0; i < 300; i++) {
    stepSim(1 / 60);
    samples.push(fx.updateMs);
    liveSum += fx.stats().particles;
  }
  samples.sort((x, y) => x - y);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  stressReport = {
    meanUpdateMs: Number(mean.toFixed(3)),
    p95UpdateMs: Number(samples[Math.floor(samples.length * 0.95)]!.toFixed(3)),
    maxUpdateMs: Number(samples[samples.length - 1]!.toFixed(3)),
    meanLiveParticles: Math.round(liveSum / 300),
  };
}

let frames = 0;
let ready = false;
const frozenT = simT;
void fx.warmup(h.renderer, h.camera).then(() => {
  ready = true;
});

h.frame((dt) => {
  if (live) stepSim(Math.min(dt, 0.05));
  else {
    def.visuals?.(frozenT);
    fx.update(0, h.camera, surfaceAt);
  }
  sky.position.copy(h.camera.position);
  if (!ready) return;
  frames++;
  if (frames === 20) {
    const s = fx.stats();
    const sorted = [...updateSamples].sort((x, y) => x - y);
    window.__HARNESS_INFO__ = {
      scene: sceneName,
      t: Number(simT.toFixed(3)),
      particles: s.particles,
      trails: s.trails,
      glows: s.glows,
      fxDrawCalls: fx.drawCalls,
      updateMsMean: Number((sorted.reduce((a, v) => a + v, 0) / Math.max(1, sorted.length)).toFixed(3)),
      updateMsMax: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
      stress: stressReport,
    };
    window.__HARNESS_READY__ = true;
  }
});

import {
  BackSide,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { artStats, createAircraftModel, createOrdnanceModel } from '../art';
import { AIRCRAFT, AIRCRAFT_IDS } from '../data/aircraft';
import type { AircraftId, AircraftModel, AircraftVisualState, HardpointKind, Team } from '../core/types';
import { ATMOSPHERE_GLSL, atmoUniforms, patchAtmosphere } from '../render/atmosphere';
import { createHarness } from './common';

/**
 * Art harness (visual loop for src/art). Views:
 *   ?view=lineup                                   all six jets, studio light + shared atmosphere
 *   ?view=closeup&id=kestrel&angle=three-quarter   front|side|rear|top|three-quarter|below
 *   ?view=flight&id=kestrel                         in flight, afterburner lit, surfaces deflected
 *   ?view=ordnance                                  every store type
 *   ?view=lod&id=kestrel                            LOD0 (left) vs LOD1 (right)
 * Optional: team=blue|red, livery=0..2, gear=0..1, canopy=0..1, time=seconds, dmg=0..1
 */
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'lineup';
const jetId = (params.get('id') ?? 'kestrel') as AircraftId;
const angle = params.get('angle') ?? 'three-quarter';
const team = (params.get('team') ?? 'blue') as Team;
const livery = Number(params.get('livery') ?? 0);
const fixedTime = Number(params.get('time') ?? 1.3);
const dmg = Number(params.get('dmg') ?? 0);

const h = createHarness({ readyAfterFrames: 6, far: 60000 });
const { scene, camera, renderer } = h;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

// ── lighting from the shared atmosphere
const sunDir = atmoUniforms.uSunDir.value.clone();
const sun = new DirectionalLight(new Color(1, 0.95, 0.88), 3.6);
sun.position.copy(sunDir).multiplyScalar(200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const hemi = new HemisphereLight(atmoUniforms.uAmbientSky.value, atmoUniforms.uAmbientGround.value, 0.35);
scene.add(hemi);

// ── sky dome using the shared atmosphere
const sky = new Mesh(
  new SphereGeometry(20000, 48, 24),
  new ShaderMaterial({
    uniforms: atmoUniforms,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${ATMOSPHERE_GLSL}
      varying vec3 vWorld;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 dir = normalize( vWorld - cameraPosition );
        vec3 col = atmoSky( dir );
        float mu = dot( dir, uSunDir );
        col += uSunColor * 6.0 * smoothstep( 0.9996, 0.99985, mu );
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
  }),
);
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);

// ── environment map: the shared sky over a dark apron (flight: open sky), like World.environment
const pmrem = new PMREMGenerator(renderer);
const envScene = new Scene();
envScene.add(sky.clone());
if (view !== 'flight') {
  const floor = new Mesh(
    new CircleGeometry(400, 32),
    new MeshBasicMaterial({ color: new Color(0.09, 0.09, 0.09) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  envScene.add(floor);
  const room = new RoomEnvironment();
  room.scale.setScalar(0.02);
  room.position.y = 30;
  envScene.add(room);
}
const env: Texture = pmrem.fromScene(envScene, 0.02).texture;
scene.environment = env;
scene.environmentIntensity = 0.85;

// ── neutral concrete apron
function ground(y: number): void {
  const mat = patchAtmosphere(
    new MeshStandardMaterial({ color: 0x626466, roughness: 0.94, metalness: 0 }),
    'harness-apron',
    (shader: WebGLProgramParametersWithUniforms) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vApron;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvApron = (modelMatrix * vec4(position, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vApron;
float apHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
vec2 ap = vApron.xz / 5.0;
vec2 cell = floor( ap );
vec2 f = fract( ap );
vec2 fw = fwidth( ap );
vec2 jl = smoothstep( fw * 1.5, vec2( 0.0 ), min( f, 1.0 - f ) - 0.002 );
float joint = max( jl.x, jl.y ) * ( 1.0 - smoothstep( 0.01, 0.06, max( fw.x, fw.y ) ) );
float stain = sin( vApron.x * 0.13 + sin( vApron.z * 0.21 ) * 2.0 ) * sin( vApron.z * 0.17 + 1.3 );
diffuseColor.rgb *= 0.94 + 0.08 * apHash( cell ) + 0.05 * stain;
diffuseColor.rgb *= 1.0 - 0.3 * joint;`,
        );
    },
  );
  const g = new Mesh(new CircleGeometry(2500, 64), mat);
  g.rotation.x = -Math.PI / 2;
  g.position.y = y;
  g.receiveShadow = true;
  scene.add(g);
}

function visual(n: number, over: Partial<AircraftVisualState> = {}): AircraftVisualState {
  return {
    aileron: 0,
    elevator: 0,
    rudder: 0,
    flaps: 0,
    airbrake: 0,
    gear: Number(params.get('gear') ?? 1),
    throttle: 0.3,
    afterburner: 0,
    canopy: Number(params.get('canopy') ?? 0),
    damage: { engine: dmg, wingL: dmg, wingR: dmg, tail: dmg },
    navLights: true,
    stores: Array.from({ length: n }, () => true),
    ...over,
  };
}

const models: { model: AircraftModel; state: AircraftVisualState }[] = [];
function addJet(
  id: AircraftId,
  pos: Vector3,
  t: Team,
  lv: number,
  tail: string,
  over: Partial<AircraftVisualState> = {},
): AircraftModel {
  const model = createAircraftModel(id, { team: t, livery: lv, tailNumber: tail });
  model.root.position.copy(pos);
  scene.add(model.root);
  const state = visual(AIRCRAFT[id].hardpoints.length, over);
  models.push({ model, state });
  return model;
}

function shadowBox(half: number, center: Vector3): void {
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = 600;
  cam.updateProjectionMatrix();
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDir, 250);
}

const info: Record<string, unknown> = { view };
const stats: Record<string, unknown> = {};
const target = new Vector3();

if (view === 'lineup') {
  const order: AircraftId[] = ['kestrel', 'harrow', 'wyvern', 'borzoi', 'mule', 'nightjar'];
  const liveries: [Team, number, string][] = [
    ['blue', 0, '412'],
    ['blue', 1, '207'],
    ['blue', 2, '531'],
    ['red', 0, '38'],
    ['red', 2, '115'],
    ['red', 1, '09'],
  ];
  let x = 0;
  let groundY = 0;
  order.forEach((id, i) => {
    const d = AIRCRAFT[id].design;
    x += i === 0 ? 0 : d.span / 2 + 3.5;
    const [t, lv, tail] = liveries[i]!;
    const m = addJet(id, new Vector3(x, 0, x * 0.42), t, lv, tail);
    m.root.position.y = -m.gearContactY;
    groundY = 0;
    x += d.span / 2;
    stats[id] = artStats(id);
  });
  ground(groundY);
  const mid = new Vector3(x / 2, 2, (x / 2) * 0.42);
  camera.position.set(mid.x - 58, 24, mid.z - 72);
  camera.lookAt(mid.x - 4, 1.5, mid.z - 2);
  camera.fov = 38;
  camera.updateProjectionMatrix();
  shadowBox(60, mid);
} else if (view === 'closeup' || view === 'lod') {
  const d = AIRCRAFT[jetId].design;
  const L = d.length;
  if (view === 'lod') {
    const a = addJet(jetId, new Vector3(-d.span * 0.62, 0, 0), team, livery, '412');
    const b = addJet(jetId, new Vector3(d.span * 0.62, 0, 0), team, livery, '412');
    a.root.position.y = -a.gearContactY;
    b.root.position.y = -b.gearContactY;
    b.setLod(1);
  } else {
    const m = addJet(jetId, new Vector3(0, 0, 0), team, livery, '412');
    m.root.position.y = -m.gearContactY;
  }
  ground(0);
  const cy = 1.4;
  const presets: Record<string, [number, number, number]> = {
    front: [0.18 * L, 0.2 * L, -1.05 * L],
    side: [1.2 * L, 0.12 * L, 0.02 * L],
    rear: [0.25 * L, 0.2 * L, 1.0 * L],
    top: [0.001, 1.45 * L, 0.02 * L],
    below: [0.3 * L, -0.05 * L, -0.45 * L],
    'three-quarter': [0.78 * L, 0.34 * L, -0.82 * L],
  };
  const p = presets[angle] ?? presets['three-quarter']!;
  const scale = view === 'lod' ? 1.35 : 1;
  camera.position.set(p[0] * scale, p[1] * scale + cy, p[2] * scale);
  target.set(0, cy * 0.9, 0);
  if (angle === 'top') camera.up.set(0, 0, -1);
  camera.lookAt(target);
  camera.fov = 40;
  camera.updateProjectionMatrix();
  shadowBox(L, new Vector3());
  stats[jetId] = artStats(jetId);
} else if (view === 'flight') {
  const d = AIRCRAFT[jetId].design;
  const L = d.length;
  const m = addJet(jetId, new Vector3(0, 3000, 0), team, livery, '412', {
    gear: 0,
    throttle: 1,
    afterburner: 1,
    aileron: 0.55,
    elevator: 0.4,
    rudder: 0.25,
    flaps: 0,
  });
  m.root.rotation.set(0.12, 0.25, -0.5, 'YXZ');
  camera.position.set(-0.75 * L, 3000 + 0.3 * L, 1.05 * L);
  camera.lookAt(0, 3000 - 0.05 * L, -0.1 * L);
  camera.fov = 45;
  camera.updateProjectionMatrix();
  shadowBox(L, new Vector3(0, 3000, 0));
  stats[jetId] = artStats(jetId);
} else if (view === 'ordnance') {
  const kinds: HardpointKind[] = ['srm', 'mrm', 'lraam', 'rocketPod', 'bomb', 'agm', 'tank'];
  const group = new Group();
  kinds.forEach((k, i) => {
    const o = createOrdnanceModel(k);
    o.position.set((i - 3) * 1.05, 0.55, 0);
    o.rotation.y = -0.35;
    group.add(o);
  });
  scene.add(group);
  ground(0);
  camera.position.set(-2.8, 3.2, -6.4);
  camera.lookAt(0, 0.35, 0);
  camera.fov = 45;
  camera.updateProjectionMatrix();
  shadowBox(6, new Vector3());
}

for (const id of AIRCRAFT_IDS) if (!stats[id] && view === 'lineup') stats[id] = artStats(id);
info.stats = stats;
window.__HARNESS_INFO__ = info;

let frame = 0;
h.frame(() => {
  frame++;
  for (const { model, state } of models) model.update(state, 1 / 60, fixedTime);
  sky.position.copy(camera.position);
  if (frame === 3) {
    renderer.info.autoReset = false;
    renderer.info.reset();
  }
  if (frame === 4) {
    info.drawCalls = renderer.info.render.calls;
    info.triangles = renderer.info.render.triangles;
    renderer.info.autoReset = true;
  }
});

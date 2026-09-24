import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DataTexture,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { dampFactor } from '../core/math';
import { Rng } from '../core/rng';
import type { AircraftId, AircraftModel, AircraftModelFactory } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';

/**
 * The live 3D hangar behind the menus (spec §8.5): a jet under spotlights with light shafts, dust motes
 * and a slow camera dolly. Framing changes per screen so the UI panels never cover the aircraft.
 */
export type HangarFraming = 'title' | 'menu' | 'hangar' | 'setup';

const _target = new Vector3();
const _pos = new Vector3();

export class HangarScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 16 / 9, 0.1, 400);
  private readonly factory: AircraftModelFactory;
  private model: AircraftModel | null = null;
  private current: AircraftId | null = null;
  private readonly turntable = new Group();
  private readonly dust: Points;
  private readonly dustBase: Float32Array;
  private readonly envTexture: Texture;
  private readonly disposables: { dispose(): void }[] = [];
  private framing: HangarFraming = 'title';
  private orbit = 0.6;
  private time = 0;
  private readonly lookAt = new Vector3();
  private readonly camPos = new Vector3(14, 3, 12);

  constructor(renderer: WebGLRenderer, factory: AircraftModelFactory) {
    this.factory = factory;
    this.scene.background = new Color(0.012, 0.014, 0.016);
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.35;

    // Floor: sealed concrete with subtle variation and painted guide lines.
    const floorTex = makeFloorTexture();
    floorTex.wrapS = floorTex.wrapT = RepeatWrapping;
    floorTex.repeat.set(6, 6);
    const floorMat = new MeshStandardMaterial({
      color: 0x3a3d40,
      roughness: 0.62,
      metalness: 0.05,
      map: floorTex,
    });
    const floor = new Mesh(new PlaneGeometry(120, 120), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.disposables.push(floor.geometry, floorMat, floorTex);

    // Painted guide line (yellow) and stand markings.
    const lineMat = new MeshBasicMaterial({ color: new Color(0.55, 0.42, 0.08) });
    const line = new Mesh(new PlaneGeometry(0.22, 60), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, 0);
    this.scene.add(line);
    this.disposables.push(line.geometry, lineMat);

    // Contact shadow under the aircraft.
    const shadowTex = makeRadialTexture(128, [0, 0, 0], 0.85);
    const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
    const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.scale.set(16, 20, 1);
    this.turntable.add(shadow);
    this.disposables.push(shadow.geometry, shadowMat, shadowTex);
    this.scene.add(this.turntable);

    // Lights: warm key, cool rim, soft fill.
    const key = new SpotLight(new Color(1, 0.92, 0.82), 900, 60, 0.42, 0.55, 1.6);
    key.position.set(-8, 16, 10);
    key.target.position.set(0, 1, 0);
    const rim = new SpotLight(new Color(0.7, 0.8, 1), 700, 60, 0.35, 0.6, 1.6);
    rim.position.set(10, 12, -12);
    rim.target.position.set(0, 1.5, 0);
    const top = new SpotLight(new Color(1, 0.97, 0.9), 500, 40, 0.5, 0.7, 1.6);
    top.position.set(0, 18, 0);
    top.target.position.set(0, 0, 0);
    this.scene.add(key, key.target, rim, rim.target, top, top.target);
    this.scene.add(new HemisphereLight(0x2a3340, 0x0d0c0b, 0.35));

    // Volumetric-looking light shafts (additive cones, depthWrite off).
    const shaftTex = makeShaftTexture();
    const shaftMat = new MeshBasicMaterial({
      map: shaftTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      color: new Color(0.16, 0.15, 0.13),
    });
    for (const [light, len] of [
      [key, 18],
      [top, 17],
    ] as const) {
      const cone = new Mesh(new ConeGeometry(Math.tan(light.angle) * len, len, 40, 1, true), shaftMat);
      cone.position.copy(light.position);
      const dir = _target.subVectors(light.target.position, light.position).normalize();
      cone.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir);
      cone.position.addScaledVector(dir, len / 2);
      this.scene.add(cone);
      this.disposables.push(cone.geometry);
    }
    this.disposables.push(shaftMat, shaftTex);

    // Dust motes drifting through the light.
    const rng = new Rng(9);
    const count = 700;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng.range(-12, 12);
      pos[i * 3 + 1] = rng.range(0.3, 12);
      pos[i * 3 + 2] = rng.range(-12, 12);
    }
    this.dustBase = pos.slice();
    const dustGeo = new BufferGeometry();
    dustGeo.setAttribute('position', new BufferAttribute(pos, 3));
    const dustTex = makeRadialTexture(32, [1, 1, 1], 1);
    const dustMat = new PointsMaterial({
      size: 0.035,
      map: dustTex,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      color: new Color(0.9, 0.85, 0.75),
      opacity: 0.55,
    });
    this.dust = new Points(dustGeo, dustMat);
    this.scene.add(this.dust);
    this.disposables.push(dustGeo, dustMat, dustTex);
  }

  setAircraft(id: AircraftId): void {
    if (this.current === id) return;
    this.current = id;
    if (this.model) {
      this.model.root.removeFromParent();
      this.model.dispose();
      this.model = null;
    }
    const model = this.factory(id, { livery: 0, team: 'blue', tailNumber: '101' });
    model.setLod(0);
    // Stand on the gear.
    model.root.position.set(0, -model.gearContactY, 0);
    this.turntable.add(model.root);
    this.model = model;
    const d = AIRCRAFT[id].design;
    this.camera.userData.size = Math.max(d.length, d.span);
  }

  setFraming(framing: HangarFraming): void {
    this.framing = framing;
  }

  update(dt: number): void {
    this.time += dt;
    const size = (this.camera.userData.size as number | undefined) ?? 15;
    const model = this.model;
    if (model) {
      model.update(
        {
          aileron: Math.sin(this.time * 0.6) * 0.15,
          elevator: 0,
          rudder: 0,
          flaps: 0.4,
          airbrake: 0,
          gear: 1,
          throttle: 0,
          afterburner: 0,
          canopy: this.framing === 'hangar' ? 1 : 0,
          damage: { engine: 0, wingL: 0, wingR: 0, tail: 0 },
          navLights: true,
          stores: AIRCRAFT[this.current ?? 'kestrel'].hardpoints.map(() => true),
        },
        dt,
        this.time,
      );
    }
    // Camera framing per screen: the jet sits where the UI leaves room.
    this.orbit += dt * (this.framing === 'hangar' ? 0.12 : 0.05);
    const r = size * (this.framing === 'title' ? 0.95 : this.framing === 'hangar' ? 1.25 : 1.15);
    const h = this.framing === 'title' ? 1.4 : 2.8;
    _pos.set(Math.sin(this.orbit) * r, h + Math.sin(this.time * 0.2) * 0.3, Math.cos(this.orbit) * r);
    const sideShift = this.framing === 'menu' || this.framing === 'setup' ? -size * 0.22 : 0;
    _target.set(0, 1.4, 0);
    _right.set(Math.cos(this.orbit), 0, -Math.sin(this.orbit));
    _target.addScaledVector(_right, sideShift);
    this.camPos.lerp(_pos, dampFactor(2, dt));
    this.lookAt.lerp(_target, dampFactor(2, dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookAt);

    // Dust drift
    const attr = this.dust.geometry.getAttribute('position') as BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = this.dustBase[i]! + Math.sin(this.time * 0.11 + i) * 0.4;
      arr[i + 1] = this.dustBase[i + 1]! + Math.sin(this.time * 0.07 + i * 0.3) * 0.3;
      arr[i + 2] = this.dustBase[i + 2]! + Math.cos(this.time * 0.09 + i) * 0.4;
    }
    attr.needsUpdate = true;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.model) {
      this.model.root.removeFromParent();
      this.model.dispose();
      this.model = null;
    }
    for (const d of this.disposables) d.dispose();
    this.envTexture.dispose();
  }
}

const _right = new Vector3();

function makeRadialTexture(size: number, rgb: [number, number, number], alpha: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - r, 2) * alpha;
      const i = (y * size + x) * 4;
      data[i] = rgb[0] * 255;
      data[i + 1] = rgb[1] * 255;
      data[i + 2] = rgb[2] * 255;
      data[i + 3] = a * 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function makeShaftTexture(): DataTexture {
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1); // 0 at the cone tip (top), 1 at the base
      const edge = Math.sin((x / (w - 1)) * Math.PI);
      const a = Math.pow(1 - v, 1.4) * edge * 0.9 + 0.02;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  const t = new DataTexture(data, w, h, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeFloorTexture(): CanvasTexture | DataTexture {
  const size = 256;
  const rng = new Rng(4);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.86 + rng.range(-0.05, 0.05) + 0.04 * Math.sin(x * 0.05) * Math.cos(y * 0.07);
      const seam = x % 128 === 0 || y % 128 === 0 ? 0.7 : 1;
      const v = Math.max(0, Math.min(1, n * seam));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v * 255;
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

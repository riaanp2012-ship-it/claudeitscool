import {
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
  LinearFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';
import { atmoUniforms } from './atmosphere';

/**
 * Aircraft shadows on terrain and water: nearby aircraft are rendered as white coverage from the sun into
 * a small texture around the player; world shaders sample it via atmoGroundShadow(worldPos).
 * Rendering only coverage (no depth) is enough because aircraft are always above the ground they shade.
 */
const _dir = new Vector3();
const _bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class GroundShadow {
  readonly target: WebGLRenderTarget;
  private readonly camera: OrthographicCamera;
  private readonly scene = new Scene();
  private readonly material = new MeshBasicMaterial({ color: 0xffffff });
  enabled = true;
  /** Half-size of the covered square in meters. */
  extent = 140;

  constructor(size = 1024) {
    this.target = new WebGLRenderTarget(size, size, {
      format: RedFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    this.camera = new OrthographicCamera(-this.extent, this.extent, this.extent, -this.extent, 1, 6000);
    this.scene.overrideMaterial = this.material;
    this.scene.matrixWorldAutoUpdate = false;
  }

  /**
   * Renders the given aircraft roots (already positioned) as seen from the sun, centered on `center`.
   */
  render(renderer: WebGLRenderer, center: Vector3, casters: readonly Object3D[], strength: number): void {
    if (!this.enabled || strength <= 0) {
      atmoUniforms.uGroundShadowStrength.value = 0;
      return;
    }
    _dir.copy(atmoUniforms.uSunDir.value).normalize();
    this.camera.position.copy(center).addScaledVector(_dir, 3000);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    // Casters stay parented to the main scene; we only borrow them for this draw.
    for (const c of casters) {
      if (!c.visible) continue;
      c.updateMatrixWorld(true);
      this.scene.children.length = 0;
      this.scene.children.push(c);
      renderer.render(this.scene, this.camera);
      this.scene.children.length = 0;
    }
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(0x0a0c0d, 1);
    atmoUniforms.uGroundShadowMap.value = this.target.texture;
    atmoUniforms.uGroundShadowMatrix.value
      .copy(_bias)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
    atmoUniforms.uGroundShadowStrength.value = strength;
  }

  dispose(): void {
    atmoUniforms.uGroundShadowStrength.value = 0;
    this.target.dispose();
    this.material.dispose();
  }
}

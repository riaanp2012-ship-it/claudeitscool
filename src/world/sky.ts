import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, type PerspectiveCamera } from 'three';
import { ATMOSPHERE_GLSL, atmoUniforms } from '../render/atmosphere';

const SKY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(position, 1.0));
  #include <logdepthbuf_vertex>
}
`;

const SKY_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMOSPHERE_GLSL}
uniform float uSunDisk;
uniform float uEnvGround;
uniform vec3 uGroundAlbedo;
uniform float uCirrus;
varying vec3 vDir;

float skyHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), f.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + 1.0), f.x), f.y);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  vec3 col = atmoSky(dir);

  // High cirrus streaks: faint, stretched along one axis, only well above the horizon.
  if (uCirrus > 0.0 && dir.y > 0.02) {
    vec2 q = dir.xz / (dir.y + 0.12);
    vec2 s = vec2(q.x * 0.9 + q.y * 0.4, q.y * 3.2 - q.x * 0.6);
    float n = skyNoise(s * 1.3) * 0.55 + skyNoise(s * 2.9 + 3.1) * 0.3 + skyNoise(s * 7.0 - 1.7) * 0.15;
    float c = smoothstep(0.55, 0.85, n) * smoothstep(0.02, 0.25, dir.y) * uCirrus;
    float mu = max(dot(dir, uSunDir), 0.0);
    col += (uAmbientSky * 0.5 + uSunColor * (0.08 + 0.25 * pow(mu, 8.0))) * c;
  }

  // Sun disk with a soft edge and limb darkening (HDR so bloom catches it).
  float cosA = dot(dir, uSunDir);
  if (cosA > 0.999) {
    float ang = length(cross(dir, uSunDir));
    float disk = 1.0 - smoothstep(0.0038, 0.0056, ang);
    float limb = 0.6 + 0.4 * sqrt(max(1.0 - ang / 0.0056, 0.0));
    col += uSunColor * disk * limb * uSunDisk;
  }

  // Environment capture only: the lower hemisphere is lit ground fading into haze at the horizon.
  if (uEnvGround > 0.5 && dir.y < 0.0) {
    vec3 ground = uGroundAlbedo * (uSunColor * max(uSunDir.y, 0.0) + uAmbientSky) * RECIPROCAL_PI;
    col = mix(col, ground, smoothstep(0.0, 0.25, -dir.y));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly geometry: SphereGeometry;

  constructor(opts: { cirrus: number; groundAlbedo: Color; env?: boolean; sunDisk?: number }) {
    this.geometry = new SphereGeometry(1000, 64, 32);
    this.material = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        ...atmoUniforms,
        uSunDisk: { value: opts.sunDisk ?? 28 },
        uEnvGround: { value: opts.env ? 1 : 0 },
        uGroundAlbedo: { value: opts.groundAlbedo },
        uCirrus: { value: opts.cirrus },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  update(camera: PerspectiveCamera): void {
    const e = camera.matrixWorld.elements;
    this.mesh.position.set(e[12]!, e[13]!, e[14]!);
    this.mesh.updateMatrix();
    this.mesh.matrixWorld.copy(this.mesh.matrix);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

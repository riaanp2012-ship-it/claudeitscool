import { BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial } from 'three';
import { atmoUniforms, patchAtmosphere } from '../render/atmosphere';
import { createHarness } from './common';

const h = createHarness();
h.scene.background = new Color(0.5, 0.6, 0.75);
const sun = new DirectionalLight(0xffffff, 3);
sun.position.copy(atmoUniforms.uSunDir.value).multiplyScalar(100);
h.scene.add(sun, new HemisphereLight(0x8899bb, 0x443322, 1));
const mat = patchAtmosphere(new MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.2 }));
const box = new Mesh(new BoxGeometry(10, 10, 10), mat);
h.scene.add(box);
h.camera.position.set(20, 12, 30);
h.camera.lookAt(0, 0, 0);
h.frame((dt) => {
  box.rotation.y += dt * 0.3;
});

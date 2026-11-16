// Renders each dinosaur (and its egg) to a small transparent image once at startup.
// The menus, dino cards and sticker book all use these pictures.
import * as THREE from 'three';
import { Animator } from '../dino/rig';
import { ALL_SPECIES, buildEgg, SPECIES, SpeciesId } from '../dino/species';

export interface Portraits {
  dino: Record<SpeciesId, string>;
  egg: Record<SpeciesId, string>;
}

export function renderPortraits(): Portraits {
  const SIZE = 384;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa37a, 2.0));
  const sun = new THREE.DirectionalLight(0xfff4dd, 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  const shoot = (obj: THREE.Object3D, yaw: number, pad: number): string => {
    obj.rotation.y = yaw;
    scene.add(obj);
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    box.getSize(size);
    box.getCenter(center);
    const d = (Math.max(size.x, size.y, size.z) * pad) / Math.tan((cam.fov * Math.PI) / 360) / 2;
    cam.position.set(center.x + d * 0.25, center.y + d * 0.22, center.z + d);
    cam.lookAt(center);
    renderer.render(scene, cam);
    const url = canvas.toDataURL('image/png');
    scene.remove(obj);
    return url;
  };

  const dino = {} as Record<SpeciesId, string>;
  const egg = {} as Record<SpeciesId, string>;
  for (const id of ALL_SPECIES) {
    const s = SPECIES[id];
    const rig = s.build();
    new Animator(rig, s.flies).update(0.42);
    dino[id] = shoot(rig.root, 0.75, 1.08);
    egg[id] = shoot(buildEgg(s.eggSpots), 0.4, 1.25);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return { dino, egg };
}

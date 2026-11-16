// Small ambient life: fish leaping out of the water and butterflies over the meadow.
import * as THREE from 'three';
import { flatPoly } from '../geo';
import { foodGeo } from '../game/food';
import type { Particles } from '../game/particles';
import { heightAt } from './terrain';

interface Jumper {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  dir: number;
  wait: number;
  t: number;
}

interface Butterfly {
  x: number;
  z: number;
  y: number;
  a: number;
  b: number;
  ph: number;
}

export interface Critters {
  /** onSplash(x, z) lets the game play a positional plop */
  update(t: number, dt: number, onSplash: (x: number, z: number) => void): void;
}

export function createCritters(scene: THREE.Scene, particles: Particles, rng: () => number): Critters {
  const v = new THREE.Vector3();

  // ── leaping fish ──
  const fishGeo = foodGeo('fish');
  const fishMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const jumpers: Jumper[] = [];
  for (let tries = 0; jumpers.length < 22 && tries < 20000; tries++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 215;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (heightAt(x, z) > -0.8) continue;
    const mesh = new THREE.Mesh(fishGeo, fishMat);
    mesh.scale.setScalar(0.7);
    mesh.visible = false;
    scene.add(mesh);
    jumpers.push({ mesh, x, z, dir: rng() * Math.PI * 2, wait: 1 + rng() * 8, t: -1 });
  }

  // ── butterflies ──
  const wing = flatPoly([[0, 0, 0], [0.26, 0.05, 0.2], [0.3, 0.05, -0.1], [0.12, 0, -0.22]]);
  const wing2 = wing.clone().scale(-1, 1, 1);
  const pos = [...(wing.getAttribute('position').array as Float32Array), ...(wing2.getAttribute('position').array as Float32Array)];
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const N = 70;
  const flies = new THREE.InstancedMesh(bGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), N);
  flies.frustumCulled = false;
  const bugs: Butterfly[] = [];
  const colors = [0xffffff, 0xffe04a, 0xff8fc0, 0x8fd0ff, 0xffa24a, 0xc79bff];
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    let x = 0, z = 0, h = 0;
    for (let k = 0; k < 40; k++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 165;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      h = heightAt(x, z);
      if (h > 1.1 && h < 6) break;
    }
    bugs.push({ x, z, y: h, a: 0.3 + rng() * 0.5, b: 0.3 + rng() * 0.5, ph: rng() * 20 });
    flies.setColorAt(i, c.set(colors[i % colors.length]));
  }
  scene.add(flies);
  const d = new THREE.Object3D();

  return {
    update(t, dt, onSplash) {
      for (const j of jumpers) {
        if (j.t < 0) {
          j.wait -= dt;
          if (j.wait <= 0) {
            j.t = 0;
            j.dir = Math.random() * Math.PI * 2;
            j.mesh.visible = true;
            particles.burst(v.set(j.x, 0.1, j.z), 8, [0xffffff, 0xbfeaff], { speed: 2.5, up: 4, size: 0.12, life: 0.5, spread: 0.5 });
            onSplash(j.x, j.z);
          }
          continue;
        }
        j.t += dt * 1.15;
        const k = j.t;
        const fx = Math.sin(j.dir), fz = Math.cos(j.dir);
        j.mesh.position.set(j.x + fx * k * 2.6, Math.sin(k * Math.PI) * 1.9 - 0.4, j.z + fz * k * 2.6);
        j.mesh.rotation.set(0, j.dir, 0);
        j.mesh.rotateX(-Math.cos(k * Math.PI) * 1.0);
        if (k >= 1) {
          j.mesh.visible = false;
          j.t = -1;
          j.wait = 4 + Math.random() * 9;
          particles.burst(v.set(j.mesh.position.x, 0.1, j.mesh.position.z), 8, [0xffffff, 0xbfeaff], { speed: 2.5, up: 4, size: 0.12, life: 0.5, spread: 0.5 });
          onSplash(j.mesh.position.x, j.mesh.position.z);
        }
      }
      for (let i = 0; i < N; i++) {
        const b = bugs[i];
        const px = b.x + Math.sin(t * b.a + b.ph) * 3.5;
        const pz = b.z + Math.cos(t * b.b + b.ph * 1.7) * 3.5;
        d.position.set(px, b.y + 1.1 + Math.sin(t * 1.3 + b.ph) * 0.5, pz);
        d.rotation.set(0, Math.atan2(Math.cos(t * b.a + b.ph) * b.a, -Math.sin(t * b.b + b.ph * 1.7) * b.b), 0);
        d.scale.set(0.25 + Math.abs(Math.sin(t * 16 + b.ph)) * 0.75, 1, 1);
        d.updateMatrix();
        flies.setMatrixAt(i, d.matrix);
      }
      flies.instanceMatrix.needsUpdate = true;
    },
  };
}

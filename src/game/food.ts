// Yummy things to eat. Each food is a little procedural model that bobs, gets chomped, and grows back.
import * as THREE from 'three';
import { blob, Bucket, cone, cylBetween, flatPoly, skin, sphere, tf, tube } from '../geo';
import { heightAt } from '../world/terrain';
import type { Collider } from '../world/props';

export type FoodKind = 'melon' | 'apple' | 'banana' | 'fish' | 'meat' | 'berries';

export const FOOD_INFO: Record<FoodKind, { icon: string; word: string; crumbs: number[] }> = {
  melon: { icon: '🍉', word: 'Watermelon', crumbs: [0xff4d6a, 0x3aa64a, 0xff8fa3] },
  apple: { icon: '🍎', word: 'Apple', crumbs: [0xff3b3b, 0xfff1c9] },
  banana: { icon: '🍌', word: 'Banana', crumbs: [0xffe04a, 0xfff6c9] },
  fish: { icon: '🐟', word: 'Fish', crumbs: [0xff9a3c, 0xffffff] },
  meat: { icon: '🍖', word: 'Meat', crumbs: [0xc9703a, 0xffffff] },
  berries: { icon: '🍓', word: 'Berries', crumbs: [0xff3355, 0x3aa64a] },
};

export function foodGeo(kind: FoodKind): THREE.BufferGeometry {
  const b = new Bucket();
  switch (kind) {
    case 'melon': {
      const dark = new THREE.Color(0x2e8b3d), light = new THREE.Color(0x7fd35a);
      const g = sphere(0.55, 16, 10);
      const p = g.getAttribute('position');
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const c = Math.sin(a * 6) > 0.1 ? dark : light;
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      b.add(g, null, tf(-0.2, 0.5, 0, 0.2, 0, 1.3, 1.15, 1, 1));
      // a juicy slice leaning on it
      const m = tf(0.55, 0.12, 0.25, 0, -0.5, 0.25);
      b.add(new THREE.CylinderGeometry(0.56, 0.56, 0.13, 14, 1, false, 0, Math.PI), 0x2e8b3d, m.clone().multiply(tf(0, 0, 0, Math.PI / 2, 0, Math.PI / 2)));
      b.add(new THREE.CylinderGeometry(0.47, 0.47, 0.17, 14, 1, false, 0, Math.PI), 0xff4d6a, m.clone().multiply(tf(0, 0, 0, Math.PI / 2, 0, Math.PI / 2)));
      for (const [x, y] of [[-0.2, 0.15], [0, 0.26], [0.2, 0.15], [0.02, 0.1]]) {
        for (const z of [-0.09, 0.09]) b.add(sphere(0.03, 5, 4), 0x2b1a1a, m.clone().multiply(tf(x, y, z)));
      }
      break;
    }
    case 'apple':
      b.add(sphere(0.48, 14, 10), 0xff3b3b, tf(0, 0.5, 0, 0, 0, 0, 1, 0.9, 1));
      b.add(sphere(0.2, 8, 6), 0xff7a6a, tf(0.2, 0.68, 0.25));
      b.add(cylBetween([0, 0.85, 0], [0.06, 1.1, 0], 0.035, 0.03, 5), 0x7a4a2a);
      b.add(sphere(1, 6, 4), 0x4fbf4a, tf(0.24, 1.05, 0, 0, 0, -0.5, 0.22, 0.05, 0.12));
      break;
    case 'banana':
      for (let i = 0; i < 3; i++) {
        const g = tube(
          [
            { y: 0.0, z: -0.6, rx: 0.05, ry: 0.05 },
            { y: -0.16, z: -0.3, rx: 0.15, ry: 0.15 },
            { y: -0.2, z: 0.05, rx: 0.16, ry: 0.16 },
            { y: -0.1, z: 0.4, rx: 0.13, ry: 0.13 },
            { y: 0.08, z: 0.62, rx: 0.05, ry: 0.05 },
          ],
          skin({ base: 0xffdf3a, belly: 0xffef8a, tip: 0x6b4a2b, tipFrom: 0.94 }), 7, 4,
        );
        b.add(g, null, tf((i - 1) * 0.24, 0.55, 0, 0, (i - 1) * 0.3, (i - 1) * 0.5));
      }
      break;
    case 'fish': {
      const g = tube(
        [
          { y: 0, z: -0.55, rx: 0.03, ry: 0.08 },
          { y: 0, z: -0.25, rx: 0.14, ry: 0.26 },
          { y: 0, z: 0.15, rx: 0.19, ry: 0.32 },
          { y: 0, z: 0.5, rx: 0.13, ry: 0.2 },
          { y: 0, z: 0.68, rx: 0.04, ry: 0.06 },
        ],
        skin({ base: 0xff8a2a, belly: 0xffe9b0, stripe: 0xffffff, stripes: 3 }), 10, 4,
      );
      const m = tf(0, 0.6, 0, 0, 0, 0.25);
      b.add(g, null, m);
      b.add(flatPoly([[0, 0, -0.5], [0, 0.34, -0.95], [0, -0.34, -0.95]]), 0xff6a1a, m);
      b.add(flatPoly([[0, 0.25, 0.1], [0, 0.55, -0.2], [0, 0.25, -0.25]]), 0xff6a1a, m);
      for (const s of [-1, 1]) {
        b.add(sphere(0.07, 6, 5), 0xffffff, m.clone().multiply(tf(s * 0.14, 0.08, 0.42)));
        b.add(sphere(0.04, 5, 4), 0x111111, m.clone().multiply(tf(s * 0.18, 0.08, 0.45)));
      }
      break;
    }
    case 'meat':
      b.add(blob(0.5, 1, 0.08, 4), 0xc9703a, tf(-0.12, 0.55, 0, 0, 0, 0.5, 1.25, 0.95, 0.95));
      b.add(sphere(0.3, 8, 6), 0xe89a5a, tf(-0.25, 0.75, 0.2, 0, 0, 0, 1, 0.6, 0.8));
      b.add(cylBetween([0.3, 0.75, 0], [0.95, 1.1, 0], 0.09, 0.08, 6), 0xfff8ea);
      b.add(sphere(0.13, 6, 5), 0xfff8ea, tf(0.98, 1.2, 0.02));
      b.add(sphere(0.13, 6, 5), 0xfff8ea, tf(1.03, 1.03, -0.02));
      break;
    case 'berries':
      b.add(blob(0.55, 1, 0.16, 6), 0x3aa64a, tf(0, 0.45, 0), true);
      b.add(blob(0.4, 1, 0.16, 7), 0x2f9440, tf(0.4, 0.32, 0.15), true);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, t = 0.5 + (i % 3) * 0.35;
        b.add(sphere(0.13, 7, 6), 0xff2d55, tf(Math.cos(a) * Math.sin(t) * 0.55, 0.45 + Math.cos(t) * 0.55, Math.sin(a) * Math.sin(t) * 0.55));
      }
      b.add(cone(0.1, 0.1, 5), 0x2f9440, tf(0, 1.05, 0));
      break;
  }
  return b.geometry();
}

const foodMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2410 });

/** Soft round glow that sits behind every piece of food so it stands out from the scenery. */
export function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,244,170,0.65)');
  grad.addColorStop(0.62, 'rgba(255,220,90,0.22)');
  grad.addColorStop(1, 'rgba(255,210,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let glowMat: THREE.SpriteMaterial | null = null;
const SIZE = 0.95;

export class Food {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  /** 0 = gone, 1 = fully grown */
  grown = 1;
  available = true;
  private regrow = 0;
  private fly = -1;
  private flyFrom = new THREE.Vector3();
  private baseY: number;
  private phase = Math.random() * 6;
  /** shaken out of a tree: falls from this height, is eaten once, and does not grow back */
  once = false;
  dead = false;
  private drop = 1;
  private dropFrom = 0;

  /** Start up in a tree and tumble to the ground. */
  fall(fromY: number) {
    this.once = true;
    this.drop = 0;
    this.dropFrom = fromY;
    this.available = false;
  }

  constructor(public kind: FoodKind, geo: THREE.BufferGeometry, public x: number, public z: number) {
    this.mesh = new THREE.Mesh(geo, foodMat);
    this.mesh.castShadow = true;
    this.baseY = kind === 'fish' ? 0.15 : Math.max(heightAt(x, z), 0) + 0.25;
    this.mesh.position.set(x, this.baseY, z);
    this.mesh.rotation.y = Math.random() * 6;
    glowMat ??= new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.72, toneMapped: false,
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.renderOrder = 2;
  }

  /** Start flying into a mouth. */
  eat() {
    this.available = false;
    this.fly = 0;
    this.flyFrom.copy(this.mesh.position);
  }

  update(t: number, dt: number, mouth: THREE.Vector3, near: boolean) {
    if (this.dead) {
      this.mesh.visible = this.glow.visible = false;
      return;
    }
    if (this.drop < 1) {
      // tumbling out of the tree, with a little bounce when it lands
      this.drop = Math.min(1, this.drop + dt * 1.25);
      const k = this.drop;
      const bounce = k < 0.6 ? 1 - (k / 0.6) ** 2 : Math.sin(((k - 0.6) / 0.4) * Math.PI) * 0.12;
      this.mesh.visible = true;
      this.glow.visible = false;
      this.mesh.position.set(this.x, this.baseY + 0.12 + (this.dropFrom - this.baseY) * bounce, this.z);
      this.mesh.rotation.x = (1 - k) * 6;
      this.mesh.scale.setScalar(SIZE);
      if (k >= 1) {
        this.mesh.rotation.x = 0;
        this.available = true;
      }
      return;
    }
    // far-away food is hidden entirely: fewer draw calls on tablets
    if (!near && this.fly < 0) {
      this.mesh.visible = this.glow.visible = false;
      if (!this.available && (this.regrow -= dt) <= 0) {
        this.grown = 1;
        this.available = true;
      }
      return;
    }
    if (this.available) this.mesh.visible = true;
    this.glow.visible = this.mesh.visible && this.fly < 0;
    if (this.fly >= 0) {
      this.fly += dt * 2.4;
      const k = Math.min(1, this.fly);
      this.mesh.position.lerpVectors(this.flyFrom, mouth, k * k);
      this.mesh.position.y += Math.sin(k * Math.PI) * 0.5;
      this.mesh.scale.setScalar(Math.max(0.001, SIZE * (1 - k * 0.85)));
      if (k >= 1) {
        this.fly = -1;
        this.mesh.visible = false;
        this.grown = 0;
        this.regrow = 24;
        if (this.once) this.dead = true;
      }
      return;
    }
    if (!this.available) {
      this.regrow -= dt;
      if (this.regrow <= 0 && !this.mesh.visible) {
        this.mesh.visible = true;
        this.mesh.position.set(this.x, this.baseY, this.z);
      }
      if (this.mesh.visible) {
        this.grown = Math.min(1, this.grown + dt * 2);
        if (this.grown >= 1) this.available = true;
      }
    }
    const g = this.grown;
    const pop = g < 1 ? g * (1 + Math.sin(g * Math.PI) * 0.4) : 1;
    this.mesh.scale.setScalar(Math.max(0.001, SIZE * pop));
    const bob = this.kind === 'fish' ? Math.abs(Math.sin(t * 1.6 + this.phase)) * 0.7 : Math.sin(t * 2.2 + this.phase) * 0.12;
    this.mesh.position.set(this.x, this.baseY + 0.12 + bob, this.z);
    this.mesh.rotation.y += dt * 0.7;
    const pulse = 1 + Math.sin(t * 3 + this.phase) * 0.12;
    this.glow.position.set(this.x, this.mesh.position.y + 0.55, this.z);
    this.glow.scale.setScalar(3.3 * pulse * pop);
  }
}

let geoCache: Record<FoodKind, THREE.BufferGeometry> | null = null;

/** Drop a piece of food out of a tree at (x, z), starting from height fromY. */
export function dropFood(scene: THREE.Scene, foods: Food[], kind: FoodKind, x: number, z: number, fromY: number) {
  if (!geoCache) return;
  const f = new Food(kind, geoCache[kind], x, z);
  f.fall(fromY);
  scene.add(f.mesh, f.glow);
  foods.push(f);
}

/**
 * Scatter food over the island. With a diet, only food that suits it is put out: fruit for a herbivore,
 * meat and fish for a carnivore. The same rng seed always gives the same spots, whatever the diet.
 */
export function createFoods(scene: THREE.Scene, colliders: Collider[], rng: () => number, diet?: 'herbivore' | 'carnivore'): Food[] {
  const kinds: FoodKind[] = ['melon', 'apple', 'banana', 'fish', 'meat', 'berries'];
  const geos = (geoCache ??= Object.fromEntries(kinds.map((k) => [k, foodGeo(k)])) as Record<FoodKind, THREE.BufferGeometry>);
  const foods: Food[] = [];
  const place = (kind: FoodKind, x: number, z: number) => {
    const f = new Food(kind, geos[kind], x, z);
    scene.add(f.mesh, f.glow);
    foods.push(f);
  };
  // a few right by the start so there's always something to eat straight away
  const land: FoodKind[] =
    diet === 'carnivore' ? ['meat'] : diet === 'herbivore' ? ['melon', 'apple', 'banana', 'berries'] : ['melon', 'apple', 'banana', 'meat', 'berries'];
  const start: [number, number][] = [[5, 7], [-6, 9], [1, 14], [10, -4]];
  start.forEach(([x, z], i) => place(land[i % land.length], x, z));
  let n = 0;
  for (let tries = 0; n < 95 && tries < 8000; tries++) {
    const a = rng() * Math.PI * 2, r = 12 + Math.sqrt(rng()) * 162;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 1.1 || h > 6.5) continue;
    if (colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.6)) continue;
    if (foods.some((f) => Math.hypot(x - f.x, z - f.z) < 8)) continue;
    place(land[n % land.length], x, z);
    n++;
  }
  // fish only ever live in the water: lakes, the stream and the shallows of the sea
  // (herbivores leave the fish alone, so none are put out for them)
  let fish = diet === 'herbivore' ? 26 : 0;
  for (let tries = 0; fish < 26 && tries < 20000; tries++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 190;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h > -0.3 || h < -1.5) continue;
    if (foods.some((f) => Math.hypot(x - f.x, z - f.z) < 6)) continue;
    place('fish', x, z);
    fish++;
  }
  return foods;
}

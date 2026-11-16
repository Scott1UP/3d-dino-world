// Dino rig: a small hierarchy of pivot groups, each holding one merged vertex-coloured mesh.
import * as THREE from 'three';
import { Bucket, Col, sphere, tf } from '../geo';
import { damp } from '../util';

export const dinoMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group | null;
  tail: THREE.Group | null;
  legs: THREE.Group[];
  legPhase: number[];
  wings: { inner: THREE.Group; outer: THREE.Group; side: number }[];
  mouth: THREE.Object3D;
  /** resting head pitch + how far the head dips when eating */
  eatPitch: number;
  bodyEatPitch: number;
  legSwing: number;
  bodyY: number;
}

export class DinoBuilder {
  root = new THREE.Group();
  body: THREE.Group;
  private buckets = new Map<THREE.Group, Bucket>();

  constructor(hipY: number, hipZ = 0) {
    this.root.userData.p = new THREE.Vector3();
    this.body = this.pivot(this.root, 0, hipY, hipZ);
  }

  /** New pivot group; x/y/z are in root (model) coordinates. */
  pivot(parent: THREE.Group, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.userData.p = new THREE.Vector3(x, y, z);
    g.position.set(x, y, z).sub(parent.userData.p as THREE.Vector3);
    parent.add(g);
    return g;
  }

  /** Add a piece to a pivot group, in that group's local coordinates. */
  add(g: THREE.Group, geo: THREE.BufferGeometry, color: Col | null, m?: THREE.Matrix4, flat = false): this {
    let b = this.buckets.get(g);
    if (!b) this.buckets.set(g, (b = new Bucket()));
    b.add(geo, color, m, flat);
    return this;
  }

  /** Add a piece to the body using root (model) coordinates. */
  addBody(geo: THREE.BufferGeometry, color: Col | null, m?: THREE.Matrix4, flat = false): this {
    const p = this.body.userData.p as THREE.Vector3;
    const off = tf(-p.x, -p.y, -p.z);
    return this.add(this.body, geo, color, m ? off.multiply(m) : off, flat);
  }

  /** Big friendly cartoon eye. side = -1 | 1 */
  eye(g: THREE.Group, x: number, y: number, z: number, r: number, side: number): this {
    this.add(g, sphere(r, 12, 10), 0xffffff, tf(x, y, z, 0, 0, 0, 0.8, 1, 1));
    this.add(g, sphere(r * 0.62, 10, 8), 0x1b1420, tf(x + side * r * 0.42, y - r * 0.02, z + r * 0.38));
    this.add(g, sphere(r * 0.22, 6, 5), 0xffffff, tf(x + side * r * 0.78, y + r * 0.3, z + r * 0.62));
    return this;
  }

  finish(): THREE.Group {
    for (const [g, b] of this.buckets) {
      const mesh = new THREE.Mesh(b.geometry(), dinoMaterial);
      mesh.castShadow = true;
      g.add(mesh);
    }
    return this.root;
  }
}

/** Per-dino animation state; drive the public fields, then call update each frame. */
export class Animator {
  /** 0..1 how fast we're moving */
  move = 0;
  eating = false;
  roaring = false;
  /** set > 0 to trigger a happy hop */
  hop = 0;
  private t = Math.random() * 10;
  private cycle = Math.random() * 6;
  private walk = 0;
  private eat = 0;
  private roar = 0;

  constructor(public rig: Rig, private flies = false) {}

  update(dt: number) {
    const r = this.rig;
    this.t += dt;
    this.walk += (this.move - this.walk) * damp(8, dt);
    this.eat += ((this.eating ? 1 : 0) - this.eat) * damp(9, dt);
    this.roar += ((this.roaring ? 1 : 0) - this.roar) * damp(10, dt);
    this.cycle += dt * (4 + this.walk * 6);
    const w = this.walk;
    const t = this.t;

    for (let i = 0; i < r.legs.length; i++) {
      r.legs[i].rotation.x = this.flies
        ? 0.5 + Math.sin(t * 3 + i) * 0.1
        : Math.sin(this.cycle + r.legPhase[i]) * r.legSwing * w;
    }

    let y = r.bodyY + Math.sin(t * 2) * 0.015;
    if (!this.flies) y += Math.abs(Math.sin(this.cycle)) * 0.07 * w;
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt * 2.2);
      y += Math.sin((1 - this.hop) * Math.PI) * 0.6 * (this.hop > 0 ? 1 : 0);
    }
    r.body.position.y = y;
    r.body.rotation.x = this.eat * r.bodyEatPitch - this.roar * 0.12;
    r.body.rotation.z = this.flies ? 0 : Math.sin(this.cycle) * 0.035 * w;

    r.head.rotation.x = this.eat * r.eatPitch + Math.sin(t * 1.7) * 0.03 - this.roar * 0.35;
    r.head.rotation.y = Math.sin(t * 0.6) * 0.12 * (1 - w) * (1 - this.eat);
    r.head.rotation.z = this.roar * Math.sin(t * 30) * 0.05;

    if (r.jaw) {
      const chomp = this.eat > 0.3 ? Math.abs(Math.sin(t * 13)) * 0.4 : 0;
      r.jaw.rotation.x = chomp + this.roar * 0.6;
    }
    if (r.tail) {
      r.tail.rotation.y = Math.sin(t * 2.1) * 0.14 + Math.sin(this.cycle) * 0.22 * w;
      r.tail.rotation.x = Math.sin(t * 1.3) * 0.04;
    }
    for (const wing of r.wings) {
      const sp = 7 + w * 5;
      wing.inner.rotation.z = wing.side * (Math.sin(t * sp) * 0.55 + 0.08);
      wing.outer.rotation.z = wing.side * (Math.sin(t * sp - 0.9) * 0.6 + 0.1);
    }
  }
}

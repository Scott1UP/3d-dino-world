// Dino rig: a small hierarchy of pivot groups, each holding one merged vertex-coloured mesh.
import * as THREE from 'three';
import { Bucket, Col, sphere, tf } from '../geo';
import { damp } from '../util';

export const dinoMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group | null;
  tail: THREE.Group | null;
  /** hip / shoulder pivots (flippers for swimmers) */
  legs: THREE.Group[];
  /** knee pivots, parallel to legs (null where a leg has no knee) */
  knees: (THREE.Group | null)[];
  legPhase: number[];
  /** -1 | 1 per leg, used for flipper paddling */
  legSide: number[];
  wings: { inner: THREE.Group; outer: THREE.Group; side: number }[];
  /** eyelids, shown briefly to blink */
  lids: THREE.Group | null;
  mouth: THREE.Object3D;
  /** how far the head / body dip when eating */
  eatPitch: number;
  bodyEatPitch: number;
  legSwing: number;
  bodyY: number;
  swims: boolean;
}

export class DinoBuilder {
  root = new THREE.Group();
  body: THREE.Group;
  lids: THREE.Group | null = null;
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

  /** Big friendly cartoon eye with iris, shine, brow and a blinkable lid. side = -1 | 1 */
  eye(g: THREE.Group, x: number, y: number, z: number, r: number, side: number, iris: Col, lid: Col): this {
    this.add(g, sphere(r, 16, 12), 0xffffff, tf(x, y, z, 0, 0, 0, 0.8, 1, 1));
    this.add(g, sphere(r * 0.74, 14, 10), iris, tf(x + side * r * 0.3, y - r * 0.02, z + r * 0.3));
    this.add(g, sphere(r * 0.5, 12, 8), 0x1b1420, tf(x + side * r * 0.52, y - r * 0.02, z + r * 0.5));
    this.add(g, sphere(r * 0.2, 8, 6), 0xffffff, tf(x + side * r * 0.82, y + r * 0.3, z + r * 0.72));
    // soft brow above the eye
    this.add(g, sphere(r, 10, 8), lid, tf(x - side * r * 0.15, y + r * 1.0, z - r * 0.1, 0.1, 0, side * 0.2, 0.7, 0.22, 0.95));
    if (!this.lids) {
      this.lids = this.pivot(g, 0, 0, 0);
      this.lids.position.set(0, 0, 0);
      this.lids.visible = false;
    }
    this.add(this.lids, sphere(r * 1.07, 14, 10), lid, tf(x + side * r * 0.12, y, z + r * 0.1, 0, 0, 0, 0.86, 1, 1));
    return this;
  }

  finish(): THREE.Group {
    for (const [g, b] of this.buckets) {
      const mesh = new THREE.Mesh(b.geometry(), dinoMaterial);
      mesh.castShadow = g !== this.lids;
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
  /** how far the whole dino is off the ground from that hop (the owner applies it to the root) */
  hopY = 0;
  /** head-down charging pose */
  charging = false;
  /** 0..1: rearing back, drawing breath for a big roar */
  windup = 0;
  /** flyers only: standing on a perch with wings folded */
  perched = false;
  /** true on the frame a foot lands / a wing beats down (for sound) */
  stepped = false;
  flapped = false;
  private t = Math.random() * 10;
  private cycle = Math.random() * 6;
  private walk = 0;
  private eat = 0;
  private roar = 0;
  private charge = 0;
  private perch = 0;
  private blink = 1 + Math.random() * 4;

  constructor(public rig: Rig, private flies = false) {}

  update(dt: number) {
    const r = this.rig;
    this.t += dt;
    this.walk += (this.move - this.walk) * damp(8, dt);
    this.eat += ((this.eating ? 1 : 0) - this.eat) * damp(9, dt);
    this.roar += ((this.roaring ? 1 : 0) - this.roar) * damp(10, dt);
    this.charge += ((this.charging ? 1 : 0) - this.charge) * damp(12, dt);
    this.perch += ((this.perched ? 1 : 0) - this.perch) * damp(7, dt);
    const pk = this.perch;
    const before = this.cycle;
    this.cycle += dt * (4 + this.walk * 6);
    const w = this.walk;
    const t = this.t;

    // a foot lands every half cycle
    this.stepped = !this.flies && !r.swims && w > 0.25 && Math.floor(before / Math.PI) !== Math.floor(this.cycle / Math.PI);

    for (let i = 0; i < r.legs.length; i++) {
      const leg = r.legs[i];
      const knee = r.knees[i];
      if (r.swims) {
        const s = Math.sin(t * (2.2 + w * 3) + r.legPhase[i]);
        leg.rotation.z = r.legSide[i] * (0.15 + s * 0.4);
        leg.rotation.y = r.legSide[i] * s * 0.25;
      } else if (this.flies) {
        // trailing behind in flight, straight down to stand on a perch
        leg.rotation.x = (0.5 + Math.sin(t * 3 + i) * 0.1) * (1 - pk);
      } else {
        const ph = this.cycle + r.legPhase[i];
        leg.rotation.x = Math.sin(ph) * r.legSwing * w;
        // lift the foot as the leg swings forward
        if (knee) knee.rotation.x = Math.max(0, -Math.cos(ph)) * 0.75 * w;
      }
    }

    let y = r.bodyY + Math.sin(t * 2) * 0.015;
    if (r.swims) y += Math.sin(t * 1.6) * 0.05;
    else if (!this.flies) y += Math.abs(Math.sin(this.cycle)) * 0.07 * w;
    // the hop lifts the whole animal (legs included), so it is reported rather than applied to the body
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt * 2.2);
    this.hopY = this.hop > 0 ? Math.sin((1 - this.hop) * Math.PI) * 0.6 : 0;
    r.body.position.y = y;
    r.body.rotation.x = this.eat * r.bodyEatPitch - this.roar * 0.12 + this.charge * 0.1 - pk * 0.32 - this.windup * 0.2;
    r.body.rotation.z = this.flies || r.swims ? Math.sin(t * 1.4) * 0.03 : Math.sin(this.cycle) * 0.035 * w;
    // breathing
    const breath = 1 + Math.sin(t * 2) * 0.012;
    r.body.scale.set(breath, breath, 1);

    r.head.rotation.x = this.eat * r.eatPitch + Math.sin(t * 1.7) * 0.03 - this.roar * 0.35 + this.charge * 0.5 + this.windup * 0.3;
    r.head.rotation.y = Math.sin(t * 0.6) * 0.14 * (1 - w) * (1 - this.eat);
    r.head.rotation.z = this.roar * Math.sin(t * 30) * 0.05 + Math.sin(t * 0.43) * 0.05 * (1 - w);

    if (r.jaw) {
      const chomp = this.eat > 0.3 ? Math.abs(Math.sin(t * 13)) * 0.4 : 0;
      r.jaw.rotation.x = chomp + this.roar * 0.6 + 0.02;
    }
    if (r.tail) {
      r.tail.rotation.y = Math.sin(t * 2.1) * 0.14 + Math.sin(this.cycle) * 0.22 * w;
      r.tail.rotation.x = Math.sin(t * 1.3) * 0.04;
    }
    this.flapped = false;
    for (const wing of r.wings) {
      const sp = 7 + w * 5;
      const a = Math.sin(t * sp);
      if (pk < 0.5 && wing.side > 0 && a < 0 && Math.sin((t - dt) * sp) >= 0) this.flapped = true;
      // perched: wings fold down against the body, with the odd little shuffle
      const shuffle = Math.sin(t * 1.3) * 0.04;
      const inner = (a * 0.55 + 0.08) * (1 - pk) + (-1.25 + shuffle) * pk;
      const outer = (Math.sin(t * sp - 0.9) * 0.6 + 0.1) * (1 - pk) + (2.35 - shuffle) * pk;
      wing.inner.rotation.z = wing.side * inner;
      wing.outer.rotation.z = wing.side * outer;
    }
    if (r.lids) {
      this.blink -= dt;
      if (this.blink < -0.13) this.blink = 1.8 + Math.random() * 3.5;
      r.lids.visible = this.blink < 0 || this.eat > 0.6;
    }
  }
}

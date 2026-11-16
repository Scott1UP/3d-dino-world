// A dinosaur in the world (the player and every NPC), plus the simple NPC brain.
import * as THREE from 'three';
import { Animator, Rig } from '../dino/rig';
import { Species, SpeciesId } from '../dino/species';
import { HeightGrid, heightGrid } from '../geo';
import { damp, wrapAngle } from '../util';
import { canWalk, heightAt } from '../world/terrain';
import type { Collider } from '../world/props';

/** Measured once per species from the real model: the shape of its back, and the top of its head. */
interface Shape {
  back: HeightGrid;
  /** highest point of the head, in the head group's own coordinates */
  crown: THREE.Vector3;
}
const shapes = new Map<SpeciesId, Shape>();
const ownMesh = (g: THREE.Object3D) => g.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);

function shapeOf(species: Species): Shape {
  let s = shapes.get(species.id);
  if (s) return s;
  // a fresh, un-animated copy standing at the origin
  const rig = species.build();
  rig.root.updateWorldMatrix(true, true);
  const body = ownMesh(rig.body)!;
  const head = ownMesh(rig.head)!;
  const parts = [{ geo: body.geometry, matrix: body.matrixWorld }];
  // long necks swing about too much to treat as part of the back; other heads count while at rest
  const longNeck = species.id === 'brachiosaurus' || species.id === 'plesiosaurus';
  if (!longNeck) parts.push({ geo: head.geometry, matrix: head.matrixWorld });
  // the tail only sways a little, so its resting shape is close enough to stand on
  const tail = rig.tail && ownMesh(rig.tail);
  if (tail) parts.push({ geo: tail.geometry, matrix: tail.matrixWorld });
  const crown = new THREE.Vector3(0, -Infinity, 0);
  const pos = head.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) if (v.fromBufferAttribute(pos, i).y > crown.y) crown.copy(v);
  crown.x = 0;
  shapes.set(species.id, (s = { back: heightGrid(parts), crown }));
  return s;
}

export class Dino {
  rig: Rig;
  anim: Animator;
  x = 0;
  z = 0;
  y = 0;
  /** extra height (flying hover, mushroom bounces) */
  lift = 0;
  heading = 0;
  /** sideways roll of the whole animal (banking in the air, lying on its side) and the lift that goes with it */
  tilt = 0;
  tiltLift = 0;
  radius: number;

  constructor(public species: Species, public scale = 1) {
    this.rig = species.build();
    this.anim = new Animator(this.rig, species.flies);
    this.rig.root.scale.setScalar(scale);
    this.radius = species.radius * scale;
  }

  get root() {
    return this.rig.root;
  }

  private shadowOn = true;
  /** Only nearby dinos need to render into the shadow map. */
  setShadow(on: boolean) {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    this.rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.parent !== this.rig.lids) o.castShadow = on;
    });
  }

  groundY(): number {
    if (this.species.swims) return -0.3 * this.scale;
    return Math.max(heightAt(this.x, this.z), -0.5 * this.scale);
  }

  setScale(s: number) {
    this.scale = s;
    this.radius = this.species.radius * s;
    this.rig.root.scale.setScalar(s);
  }

  sync(dt: number) {
    this.anim.update(dt);
    this.rig.root.position.set(this.x, this.y + this.lift + this.tiltLift + this.anim.hopY * this.scale, this.z);
    this.rig.root.rotation.set(0, this.heading, this.tilt, 'YXZ');
  }

  turnToward(angle: number, rate: number, dt: number) {
    this.heading += wrapAngle(angle - this.heading) * damp(rate, dt);
  }

  /** World height of this dinosaur's back at a point, or null if the point is not over its body. */
  backTopAt(x: number, z: number): number | null {
    const dx = (x - this.x) / this.scale, dz = (z - this.z) / this.scale;
    if (Math.abs(dx) > 5 || Math.abs(dz) > 5) return null;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const h = shapeOf(this.species).back.at(dx * c - dz * s, dx * s + dz * c, 0.18 / this.scale);
    if (h === null) return null;
    // the body bobs and hops; follow it
    const bob = this.rig.body.position.y - this.rig.bodyY;
    return this.y + this.lift + (h + bob + this.anim.hopY) * this.scale;
  }

  /** World position of the top of the head, wherever the neck has swung it. */
  crownWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateWorldMatrix(true, true);
    return this.rig.head.localToWorld(out.copy(shapeOf(this.species).crown));
  }

  mouthWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.rig.mouth.getWorldPosition(out);
  }
}

type Mode = 'wander' | 'follow' | 'sky';

export class Npc extends Dino {
  mode: Mode = 'wander';
  /** who a follower trails behind */
  leader: Dino | null = null;
  homeX = 0;
  homeZ = 0;
  range = 22;
  private state: 'idle' | 'walk' | 'eat' = 'idle';
  private timer = 1 + Math.random() * 3;
  private tx = 0;
  private tz = 0;
  private skyA = Math.random() * 6;
  skyR = 60;
  skyY = 30;
  /** set true on the frame this dinosaur calls out, so the game can play its voice */
  justCalled = false;
  private callDelay = 0;
  private callAnim = 0;

  /** Someone has landed on us: stop dawdling and set off somewhere, so they get a ride. */
  giddyUp() {
    if (this.state !== 'walk') this.timer = Math.min(this.timer, 0.6);
  }

  /** Answer a roar with a call of its own after a short pause. */
  callOut(delay: number) {
    if (this.callDelay <= 0 && this.callAnim <= 0) this.callDelay = delay;
  }

  /** seconds left lying on its side after being bowled over */
  downT = 0;
  private down = 0;
  private downSide = 1;

  /** Knocked over by a charging triceratops: flop onto one side, kick a bit, then get back up. */
  knock(fromX: number, fromZ: number) {
    if (this.downT > 0 || this.mode === 'sky') return false;
    // fall away from whoever hit us
    const side = (fromX - this.x) * Math.cos(this.heading) - (fromZ - this.z) * Math.sin(this.heading);
    this.downSide = side > 0 ? 1 : -1;
    this.downT = 4;
    return true;
  }

  constructor(species: Species, scale: number, x: number, z: number) {
    super(species, scale);
    this.x = this.homeX = x;
    this.z = this.homeZ = z;
    this.heading = Math.random() * 6;
    this.y = this.groundY();
    if (species.flies) this.lift = 0.5;
  }

  private pickTarget(colliders: Collider[]): boolean {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * this.range;
      const x = this.homeX + Math.cos(a) * r, z = this.homeZ + Math.sin(a) * r;
      let ok = true;
      // check a few points along the way so nobody walks through trees or into the lake
      for (let k = 1; k <= 6 && ok; k++) {
        const px = this.x + ((x - this.x) * k) / 6, pz = this.z + ((z - this.z) * k) / 6;
        const h = heightAt(px, pz);
        if (this.species.swims) {
          if (h > -0.75 || h < -3.5) ok = false;
          continue;
        }
        if (!canWalk(px, pz) || h < 0.5) ok = false;
        else for (const c of colliders) if (Math.hypot(px - c.x, pz - c.z) < c.r + this.radius) { ok = false; break; }
      }
      if (ok) {
        this.tx = x;
        this.tz = z;
        return true;
      }
    }
    return false;
  }

  update(dt: number, player: Dino | null, colliders: Collider[], frozen: boolean) {
    const a = this.anim;
    if (this.callDelay > 0 && (this.callDelay -= dt) <= 0) {
      this.callAnim = 1.1;
      this.justCalled = true;
    }
    if (this.callAnim > 0) this.callAnim -= dt;
    a.roaring = this.callAnim > 0;
    if (this.mode === 'sky') {
      const sp = this.species.speed / this.skyR;
      this.skyA += dt * sp;
      this.x = this.homeX + Math.cos(this.skyA) * this.skyR;
      this.z = this.homeZ + Math.sin(this.skyA) * this.skyR;
      this.y = this.skyY + Math.sin(this.skyA * 3) * 4;
      this.heading = Math.atan2(-Math.sin(this.skyA), Math.cos(this.skyA));
      this.tilt = -0.3;
      a.move = 1;
      this.sync(dt);
      return;
    }

    // bowled over: lie on one side with legs waving, then roll back up
    if (this.downT > 0 || this.down > 0.01) {
      this.downT = Math.max(0, this.downT - dt);
      this.down += ((this.downT > 0.8 ? 1 : 0) - this.down) * damp(this.downT > 0.8 ? 9 : 4, dt);
      this.tilt = this.down * 1.45 * this.downSide;
      this.tiltLift = this.down * 0.55 * this.radius;
      a.eating = false;
      a.move = this.downT > 0.8 ? 0.55 : 0;
      this.y = this.groundY();
      this.sync(dt);
      return;
    }
    this.tilt = this.tiltLift = 0;
    const speed = this.species.speed;
    let moving = 0;
    if (this.mode === 'follow' && this.leader) {
      const dx = this.leader.x - this.x, dz = this.leader.z - this.z;
      const d = Math.hypot(dx, dz);
      const keep = this.leader.radius + this.radius + 1.2;
      if (d > keep) {
        const v = Math.min(speed * 1.6, (d - keep) * 3 + 1.5);
        this.turnToward(Math.atan2(dx, dz), 9, dt);
        this.x += (dx / d) * v * dt;
        this.z += (dz / d) * v * dt;
        moving = Math.min(1, v / speed);
      }
      if (d > 45) {
        // catch up if left far behind
        this.x = this.leader.x - Math.sin(this.leader.heading) * keep;
        this.z = this.leader.z - Math.cos(this.leader.heading) * keep;
      }
    } else if (!frozen) {
      const pd = player ? Math.hypot(player.x - this.x, player.z - this.z) : 1e9;
      const watching = player !== null && pd < this.radius + player.radius + 5;
      if (watching && player) {
        // stop and look at the visitor
        this.turnToward(Math.atan2(player.x - this.x, player.z - this.z), 4, dt);
        a.eating = false;
        this.state = 'idle';
        this.timer = Math.max(this.timer, 1.5);
      } else if (this.state === 'walk') {
        const dx = this.tx - this.x, dz = this.tz - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          this.state = Math.random() < 0.45 ? 'eat' : 'idle';
          this.timer = 2 + Math.random() * 4;
        } else {
          const v = speed * 0.32;
          this.turnToward(Math.atan2(dx, dz), 3, dt);
          this.x += Math.sin(this.heading) * v * dt;
          this.z += Math.cos(this.heading) * v * dt;
          moving = 0.35;
        }
      } else {
        a.eating = this.state === 'eat';
        this.timer -= dt;
        if (this.timer <= 0) {
          a.eating = false;
          if (this.pickTarget(colliders)) this.state = 'walk';
          else this.timer = 1.5;
        }
      }
    }
    a.move = moving;
    this.y = this.groundY();
    if (this.species.flies) this.lift = 0.45 + Math.sin(performance.now() * 0.002 + this.homeX) * 0.15;
    this.sync(dt);
  }
}

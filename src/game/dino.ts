// A dinosaur in the world (the player and every NPC), plus the simple NPC brain.
import * as THREE from 'three';
import { Animator, Rig } from '../dino/rig';
import { Species } from '../dino/species';
import { damp, wrapAngle } from '../util';
import { canWalk, heightAt } from '../world/terrain';
import type { Collider } from '../world/props';

export class Dino {
  rig: Rig;
  anim: Animator;
  x = 0;
  z = 0;
  y = 0;
  /** extra height (flying hover, mushroom bounces) */
  lift = 0;
  heading = 0;
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

  groundY(): number {
    return Math.max(heightAt(this.x, this.z), -0.5 * this.scale);
  }

  sync(dt: number) {
    this.rig.root.position.set(this.x, this.y + this.lift, this.z);
    this.rig.root.rotation.y = this.heading;
    this.anim.update(dt);
  }

  turnToward(angle: number, rate: number, dt: number) {
    this.heading += wrapAngle(angle - this.heading) * damp(rate, dt);
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
        if (!canWalk(px, pz) || heightAt(px, pz) < 0.5) ok = false;
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
    if (this.mode === 'sky') {
      const sp = this.species.speed / this.skyR;
      this.skyA += dt * sp;
      this.x = this.homeX + Math.cos(this.skyA) * this.skyR;
      this.z = this.homeZ + Math.sin(this.skyA) * this.skyR;
      this.y = this.skyY + Math.sin(this.skyA * 3) * 4;
      this.heading = Math.atan2(-Math.sin(this.skyA), Math.cos(this.skyA));
      this.root.rotation.z = -0.3;
      a.move = 1;
      this.sync(dt);
      return;
    }

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

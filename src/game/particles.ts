// One instanced mesh drives every little particle: crumbs, sparkles, splashes, dust, egg shell.
import * as THREE from 'three';

interface P {
  life: number;
  max: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
  gravity: number;
  spin: number;
}

const MAX = 260;

export class Particles {
  mesh: THREE.InstancedMesh;
  private items: P[] = [];
  private next = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.items.push({ life: 0, max: 1, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, size: 0, gravity: 0, spin: 0 });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  burst(
    pos: THREE.Vector3,
    count: number,
    colors: number[],
    o: { speed?: number; up?: number; size?: number; life?: number; gravity?: number; spread?: number } = {},
  ) {
    const speed = o.speed ?? 4;
    for (let i = 0; i < count; i++) {
      const p = this.items[this.next];
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      const sp = o.spread ?? 0.2;
      p.x = pos.x + (Math.random() - 0.5) * sp;
      p.y = pos.y + (Math.random() - 0.5) * sp;
      p.z = pos.z + (Math.random() - 0.5) * sp;
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = (o.up ?? 5) * (0.5 + Math.random() * 0.6);
      p.size = (o.size ?? 0.14) * (0.6 + Math.random() * 0.7);
      p.max = p.life = (o.life ?? 0.8) * (0.7 + Math.random() * 0.5);
      p.gravity = o.gravity ?? 14;
      p.spin = Math.random() * 6;
      this.mesh.setColorAt(this.next, this.color.set(colors[Math.floor(Math.random() * colors.length)]));
      this.next = (this.next + 1) % MAX;
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    const d = this.dummy;
    for (let i = 0; i < MAX; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = Math.max(0, p.life / p.max);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.spin + p.life * 5, p.spin * 2 + p.life * 3, 0);
      d.scale.setScalar(p.life > 0 ? p.size * Math.min(1, k * 2.5) : 0);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

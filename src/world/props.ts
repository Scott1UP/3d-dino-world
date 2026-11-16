// Everything that decorates the island: trees, rocks, flowers, grass, fossil bones, clouds, bouncy mushrooms.
import * as THREE from 'three';
import { blob, Bucket, Col, cylBetween, flatPoly, HeightGrid, heightGrid, plain, sphere, tf, tube } from '../geo';
import { damp, mulberry32 } from '../util';
import { caveAt, heightAt, VOLCANO } from './terrain';

export interface Collider {
  x: number;
  z: number;
  r: number;
  /** set when this collider is a tree trunk (trees can be knocked over and perched on) */
  tree?: Tree;
}

export interface Tree {
  /** trunk base */
  x: number;
  z: number;
  y: number;
  /** middle of the leafy top, its radius, and how high it is: a perch for flyers */
  cx: number;
  cz: number;
  r: number;
  top: number;
  /** 0 = standing, 1 = flat on the ground */
  fall: number;
  /** seconds left lying down */
  down: number;
  dirX: number;
  dirZ: number;
  mesh: THREE.InstancedMesh;
  index: number;
  s: number;
  sy: number;
  rot: number;
  collider: Collider;
  trunkR: number;
  palm: boolean;
  /** the real shape of the top of the tree (shared by every tree of the same kind) */
  grid: HeightGrid;
  /** 1 → 0 while it shudders from a roar */
  shake: number;
  /** seconds until it has fruit to drop again */
  fruitT: number;
}

export interface Mushroom {
  x: number;
  z: number;
  mesh: THREE.Mesh;
  squash: number;
}

/** World height of the top of a standing tree at a point, or null if that point is not over its leaves. */
export function treeTopAt(tr: Tree, x: number, z: number): number | null {
  if (tr.fall > 0.2) return null;
  const dx = x - tr.x, dz = z - tr.z;
  if (Math.abs(dx) > 8 || Math.abs(dz) > 8) return null;
  const c = Math.cos(tr.rot), s = Math.sin(tr.rot);
  const h = tr.grid.at((dx * c - dz * s) / tr.s, (dx * s + dz * c) / tr.s, 0.2 / tr.s);
  // only the leafy top counts, not the trunk or roots
  return h === null || h < 2.6 ? null : tr.y + h * tr.sy;
}

export interface Props {
  colliders: Collider[];
  mushrooms: Mushroom[];
  trees: Tree[];
  /** Topple a tree in the given direction; it gets back up by itself. */
  knock(tree: Tree, dirX: number, dirZ: number): void;
  /** Draw only this share (0..1) of the small decoration: grass, flowers, ferns, bushes and pebbles. */
  setDensity(k: number): void;
  update(t: number, dt: number): void;
}

/** x, z, rotation, size */
export const BONE_SITES: [number, number, number, number][] = [
  [34, -30, 0, 1],
  [-92, 58, 1.9, 0.75],
  [78, 104, -0.8, 0.85],
  [-48, -112, 2.7, 0.65],
  [132, -6, 0.9, 0.7],
];
const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true });

function palmGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  const c1 = new THREE.Color(0xb5834f), c2 = new THREE.Color(0x94673a);
  b.add(
    tube(
      [
        { y: -0.3, z: 0, rx: 0.3, ry: 0.3 },
        { y: 1.6, z: 0.1, rx: 0.23, ry: 0.23 },
        { y: 3.3, z: 0.42, rx: 0.19, ry: 0.19 },
        { y: 4.7, z: 0.98, rx: 0.16, ry: 0.16 },
      ],
      (u, _d, out) => void out.copy(Math.sin(u * 44) > 0 ? c1 : c2), 7, 4,
    ),
    null,
  );
  const top = tf(0, 4.7, 0.98);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const base = top.clone().multiply(tf(0, 0, 0, 0, a, 0));
    const green = i % 2 ? 0x3fae49 : 0x2f9440;
    b.add(sphere(1, 5, 3), green, base.clone().multiply(tf(0, 0.22, 0.85, -0.28, 0, 0, 0.36, 0.07, 0.95)), true);
    b.add(sphere(1, 5, 3), green, base.clone().multiply(tf(0, -0.02, 2.2, 0.6, 0, 0, 0.27, 0.06, 0.8)), true);
  }
  for (const [x, z] of [[0.2, 0.75], [-0.2, 0.85], [0.02, 1.22]]) b.add(sphere(0.19, 6, 5), 0x6b4a2b, tf(x, 4.42, z));
  return b.geometry();
}

function treeGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  b.add(cylBetween([0, -0.3, 0], [0, 2.9, 0], 0.42, 0.26, 7), 0x8a5a36, undefined, true);
  b.add(cylBetween([0, 1.6, 0], [0.9, 3.0, 0.3], 0.16, 0.1, 5), 0x8a5a36, undefined, true);
  const leaves: [number, number, number, number, Col][] = [
    [0, 4.0, 0, 1.8, 0x3aa64a], [1.25, 3.3, 0.4, 1.2, 0x55bd4f], [-1.0, 3.4, -0.6, 1.25, 0x2f9440],
    [0.1, 5.1, -0.2, 1.1, 0x6fcf55], [-0.3, 3.5, 1.1, 1.0, 0x48b34c],
  ];
  leaves.forEach(([x, y, z, r, c], i) => b.add(blob(r, 1, 0.16, i), c, tf(x, y, z), true));
  return b.geometry();
}

/** A giant: a long bare trunk with broad tiers of leaves at the top, well above everything else. */
function tallTreeGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  const bark = new THREE.Color(0x7a4f30), bark2 = new THREE.Color(0x66402a);
  b.add(
    tube(
      [
        { y: -0.4, z: 0, rx: 0.62, ry: 0.62 },
        { y: 1.2, z: 0.02, rx: 0.44, ry: 0.44 },
        { y: 5, z: 0.1, rx: 0.36, ry: 0.36 },
        { y: 9, z: 0.04, rx: 0.28, ry: 0.28 },
        { y: 11.6, z: 0, rx: 0.16, ry: 0.16 },
      ],
      (u, _d, out) => void out.copy(Math.sin(u * 60) > 0.2 ? bark : bark2), 8, 4,
    ),
    null,
  );
  // root flares
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    b.add(cylBetween([Math.cos(a) * 0.25, 0.9, Math.sin(a) * 0.25], [Math.cos(a) * 1.0, -0.3, Math.sin(a) * 1.0], 0.2, 0.26, 5), 0x66402a, undefined, true);
  }
  // three wide, flattish tiers of foliage
  const tiers: [number, number, number, Col][] = [[8.6, 2.9, 0.42, 0x2f9440], [10.3, 2.3, 0.45, 0x3aa64a], [11.8, 1.5, 0.6, 0x55bd4f]];
  tiers.forEach(([y, r, squash, c], i) => {
    b.add(blob(r, 1, 0.14, 20 + i), c, tf(i * 0.15 - 0.15, y, (i % 2) * 0.2 - 0.1, 0, i * 1.1, 0, 1, squash, 1), true);
  });
  // a couple of side boughs lower down
  b.add(cylBetween([0, 6.4, 0.1], [1.7, 7.4, 0.4], 0.14, 0.08, 5), 0x7a4f30, undefined, true);
  b.add(blob(1.05, 1, 0.16, 31), 0x48b34c, tf(2.0, 7.6, 0.45, 0, 0, 0, 1, 0.6, 1), true);
  b.add(cylBetween([0, 5.6, 0.1], [-1.4, 6.5, -0.5], 0.14, 0.08, 5), 0x7a4f30, undefined, true);
  b.add(blob(0.95, 1, 0.16, 32), 0x3aa64a, tf(-1.65, 6.7, -0.6, 0, 0, 0, 1, 0.6, 1), true);
  return b.geometry();
}

function bushGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  b.add(blob(0.8, 1, 0.18, 1), 0x3d9f45, tf(0, 0.45, 0), true);
  b.add(blob(0.6, 1, 0.18, 2), 0x55b84d, tf(0.6, 0.35, 0.2), true);
  b.add(blob(0.55, 1, 0.18, 3), 0x2f8c3d, tf(-0.5, 0.3, -0.3), true);
  return b.geometry();
}

function fernGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  for (let i = 0; i < 7; i++) {
    const m = tf(0, 0, 0, 0, (i / 7) * Math.PI * 2, 0).multiply(tf(0, 0.38, 0.5, -0.55, 0, 0, 0.17, 0.04, 0.7));
    b.add(sphere(1, 5, 3), i % 2 ? 0x46a843 : 0x358f3b, m, true);
  }
  return b.geometry();
}

function rockGeo(seed: number): THREE.BufferGeometry {
  const b = new Bucket();
  b.add(blob(1, 1, 0.2, seed), 0xa8a29a, tf(0, 0.25, 0, 0, 0, 0, 1, 0.72, 0.9), true);
  b.add(blob(0.55, 0, 0.2, seed + 5), 0x8f8980, tf(0.7, 0.05, 0.3, 0, 1, 0), true);
  return b.geometry();
}

function flowerGeo(petal: Col): THREE.BufferGeometry {
  const b = new Bucket();
  for (const [x, z, h] of [[0, 0, 0.55], [0.22, 0.12, 0.4]]) {
    b.add(cylBetween([x, 0, z], [x, h, z], 0.025, 0.02, 4), 0x4da33f);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.add(new THREE.OctahedronGeometry(0.09), petal, tf(x + Math.cos(a) * 0.09, h, z + Math.sin(a) * 0.09, 0, 0, 0, 1, 0.5, 1));
    }
    b.add(new THREE.OctahedronGeometry(0.06), 0xffd23f, tf(x, h + 0.02, z));
  }
  return b.geometry();
}

function grassGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    const lean = 0.12 + (i % 3) * 0.06;
    b.add(
      flatPoly([[-0.07, 0, 0], [0.07, 0, 0], [0, 0.42 + (i % 2) * 0.16, lean]]),
      i % 2 ? 0x6cc144 : 0x55a838,
      tf(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12, 0, a * 2.1, 0),
    );
  }
  const g = b.geometry();
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function mushroomGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  b.add(cylBetween([0, 0, 0], [0, 0.8, 0], 0.42, 0.32, 10), 0xfff1d6);
  b.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xff4d5e, tf(0, 0.7, 0, 0, 0, 0, 1.25, 0.8, 1.25));
  b.add(new THREE.CircleGeometry(1.25, 16), 0xffe1c4, tf(0, 0.7, 0, Math.PI / 2, 0, 0));
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, t = 0.35 + (i % 3) * 0.28;
    b.add(
      sphere(0.17, 6, 5), 0xffffff,
      tf(Math.cos(a) * Math.sin(t) * 1.2, 0.7 + Math.cos(t) * 0.77, Math.sin(a) * Math.sin(t) * 1.2, 0, 0, 0, 1, 0.5, 1),
    );
  }
  return b.geometry();
}

function bonesGeo(): THREE.BufferGeometry {
  const b = new Bucket();
  const BONE = 0xf6f0de;
  const rib = tube(
    [
      { y: -0.4, z: 3.3, rx: 0.3, ry: 0.22 },
      { y: 2.2, z: 3.5, rx: 0.3, ry: 0.22 },
      { y: 4.4, z: 2.6, rx: 0.27, ry: 0.2 },
      { y: 5.6, z: 1.1, rx: 0.2, ry: 0.16 },
      { y: 5.9, z: 0.2, rx: 0.12, ry: 0.1 },
    ],
    plain(BONE), 6, 4,
  );
  const rot = 0.5;
  for (let i = 0; i < 6; i++) {
    const s = 1 - Math.abs(i - 2.2) * 0.09;
    for (const side of [0, Math.PI]) {
      b.add(rib, null, tf(0, 0, 0, 0, rot, 0).multiply(tf(i * 2.3 - 5.5, 0, 0, 0, side, 0, s, s, s)), true);
    }
    b.add(blob(0.5, 0, 0.1, i), BONE, tf(0, 0, 0, 0, rot, 0).multiply(tf(i * 2.3 - 5.5, 5.75 * s, 0, 0, 0, 0, 1.2, 0.8, 1)), true);
  }
  b.add(cylBetween([-6.5, 5.3, 0], [7.2, 5.0, 0], 0.28, 0.22, 6), BONE, tf(0, 0, 0, 0, rot, 0), true);
  // loose bones lying about
  for (const [x, z, a, l] of [[9, 6, 0.4, 1.6], [-9, -6, 2.0, 1.2], [3, 9, 1.2, 1.0], [-3, -10, 2.8, 1.4]]) {
    const m = tf(x, 0.25, z, 0, a, 0);
    b.add(cylBetween([-l, 0, 0], [l, 0, 0], 0.2, 0.2, 6), BONE, m, true);
    for (const e of [-l, l]) for (const k of [-0.2, 0.2]) b.add(sphere(0.3, 6, 5), BONE, m.clone().multiply(tf(e, 0, k)), true);
  }
  return b.geometry();
}

export function createProps(scene: THREE.Scene, avoid: Collider[]): Props {
  const rng = mulberry32(20261116);
  const colliders: Collider[] = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const tiltAxis = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();

  const clear = (x: number, z: number, pad: number) => {
    // nothing grows inside the caves
    const cv = caveAt(x, z);
    if (cv && cv.mask > 0.02 && cv.along > 143) return false;
    for (const a of avoid) if (Math.hypot(x - a.x, z - a.z) < a.r + pad) return false;
    return true;
  };

  const trees: Tree[] = [];
  /** decoration with nothing to bump into, so it can be thinned out on slower devices */
  const thinnable: { mesh: THREE.InstancedMesh; full: number }[] = [];
  function scatter(
    geo: THREE.BufferGeometry,
    count: number,
    o: {
      radius: number; accept: (x: number, z: number, h: number, r: number) => boolean;
      scale: [number, number]; sink?: number; collide?: number; shadow?: boolean; tint?: number; pad?: number;
      /** make each one a knock-over-able, perch-able tree: canopy height, radius and forward lean (all at scale 1) */
      tree?: { top: number; r: number; lean: number };
      grid?: HeightGrid;
    },
  ) {
    const mesh = new THREE.InstancedMesh(geo, flatMat, count);
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * o.radius;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = heightAt(x, z);
      if (!o.accept(x, z, h, r) || !clear(x, z, o.pad ?? 1)) continue;
      if (o.collide) {
        let hit = false;
        for (const c of colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + o.collide * 2.2) { hit = true; break; }
        if (hit) continue;
      }
      const s = o.scale[0] + rng() * (o.scale[1] - o.scale[0]);
      const rot = rng() * Math.PI * 2;
      const sy = s * (0.9 + rng() * 0.2);
      dummy.position.set(x, h - (o.sink ?? 0) * s, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(s, sy, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      const v = 1 - rng() * (o.tint ?? 0.12);
      mesh.setColorAt(placed, tint.setRGB(v, v, v * (0.92 + rng() * 0.08)));
      if (o.collide) {
        const collider: Collider = { x, z, r: o.collide * s };
        colliders.push(collider);
        if (o.tree) {
          const tree: Tree = {
            x, z, y: h, cx: x + Math.sin(rot) * o.tree.lean * s, cz: z + Math.cos(rot) * o.tree.lean * s,
            r: o.tree.r * s, top: h + o.tree.top * sy, fall: 0, down: 0, dirX: 1, dirZ: 0,
            mesh, index: placed, s, sy, rot, collider, trunkR: collider.r, palm: o.tree.lean > 0, shake: 0, fruitT: 0, grid: o.grid!,
          };
          collider.tree = tree;
          trees.push(tree);
        }
      }
      placed++;
    }
    mesh.count = placed;
    if (!o.collide) thinnable.push({ mesh, full: placed });
    mesh.castShadow = o.shadow ?? false;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // fossil skeleton landmark
  // fossil skeletons: the big landmark near the start, plus a few more around the island
  const skeleton = bonesGeo();
  for (const [bx, bz, yaw, size] of BONE_SITES) {
    if (heightAt(bx, bz) < 1) continue;
    const bones = new THREE.Mesh(skeleton, flatMat);
    bones.position.set(bx, heightAt(bx, bz) - 0.1, bz);
    bones.rotation.y = yaw;
    bones.scale.setScalar(size);
    bones.castShadow = true;
    scene.add(bones);
    // each rib foot is something to walk around
    const rot = 0.5 + yaw;
    for (let i = 0; i < 6; i++) {
      const s = 1 - Math.abs(i - 2.2) * 0.09;
      for (const side of [-1, 1]) {
        const lx = (i * 2.3 - 5.5) * size, lz = side * 3.3 * s * size;
        colliders.push({ x: bx + lx * Math.cos(rot) + lz * Math.sin(rot), z: bz - lx * Math.sin(rot) + lz * Math.cos(rot), r: 0.7 * size });
      }
    }
  }

  const meadow = (_x: number, _z: number, h: number, r: number) => r < 176 && h > 1.0 && h < 7;
  const palm = palmGeo();
  scatter(palm, 78, {
    grid: heightGrid([{ geo: palm }]),
    radius: 182, scale: [0.9, 1.5], collide: 0.45, shadow: true, pad: 3, tree: { top: 4.85, r: 1.7, lean: 0.98 },
    accept: (_x, _z, h) => h > 0.6 && h < 3.4 && (h < 1.7 || rng() < 0.2),
  });
  const leafy = treeGeo();
  scatter(leafy, 86, {
    grid: heightGrid([{ geo: leafy }]),
    radius: 182, scale: [0.9, 1.7], collide: 0.5, shadow: true, pad: 4, tree: { top: 5.9, r: 2.1, lean: 0 },
    accept: (_x, _z, h, r) => h > 1.6 && h < 9 && (r > 45 || rng() < 0.3),
  });
  for (let i = 0; i < 3; i++) {
    scatter(rockGeo(i * 7 + 1), 46, {
      radius: 245, scale: [3.5, 8], sink: 0.5, collide: 0.9, shadow: true, tint: 0.2, pad: 6,
      // only on gentler ground, so boulders sit in the hillside instead of hanging off it
      accept: (x, z, h, r) =>
        h > 4 && r > 140 && Math.hypot(x - VOLCANO.x, z - VOLCANO.z) > 92 &&
        Math.abs(heightAt(x + 5, z) - heightAt(x - 5, z)) + Math.abs(heightAt(x, z + 5) - heightAt(x, z - 5)) < 5,
    });
    scatter(rockGeo(i * 7 + 2), 26, {
      radius: 170, scale: [0.9, 2.4], sink: 0.1, collide: 0.9, shadow: true, tint: 0.2, pad: 3, accept: meadow,
    });
    scatter(rockGeo(i * 7 + 3), 55, { radius: 175, scale: [0.25, 0.6], sink: 0.05, tint: 0.2, accept: (_x, _z, h) => h > 0.2 && h < 7 });
  }
  scatter(bushGeo(), 110, { radius: 176, scale: [0.8, 1.6], accept: meadow, pad: 2 });
  scatter(fernGeo(), 230, { radius: 178, scale: [0.9, 1.8], accept: (_x, _z, h, r) => r < 180 && h > 0.5 && h < 8 });
  for (const c of [0xffffff, 0xff8fc0, 0xffd84a, 0xb69cff]) {
    scatter(flowerGeo(c), 190, { radius: 170, scale: [1.2, 2.0], accept: meadow, tint: 0.05, pad: 0 });
  }
  scatter(grassGeo(), 5600, { radius: 172, scale: [0.8, 1.7], accept: (_x, _z, h) => h > 1.2 && h < 7, tint: 0.25, pad: -2 });

  // giant trees, placed last so the rest of the island stays exactly where it was
  const tall = tallTreeGeo();
  scatter(tall, 40, {
    grid: heightGrid([{ geo: tall }]),
    radius: 180, scale: [0.9, 1.25], collide: 0.6, shadow: true, pad: 5, tree: { top: 12.6, r: 2.9, lean: 0 },
    accept: (_x, _z, h, r) => h > 1.6 && h < 8 && r > 30,
  });

  // bouncy mushrooms
  const mushrooms: Mushroom[] = [];
  const mGeo = mushroomGeo();
  const shroomSpots = [
    [14, 12], [-16, -22], [48, 14], [-6, -48], [-62, -20], [26, 44], [62, -34],
    [-110, 20], [118, 30], [-70, 95], [70, 100], [-30, -118], [60, -112], [128, -20], [-125, -30],
  ];
  for (const [x, z] of shroomSpots) {
    if (heightAt(x, z) < 0.9 || !clear(x, z, 1)) continue;
    const mesh = new THREE.Mesh(mGeo, flatMat);
    mesh.position.set(x, heightAt(x, z) - 0.05, z);
    mesh.scale.setScalar(1.25);
    mesh.castShadow = true;
    scene.add(mesh);
    mushrooms.push({ x, z, mesh, squash: 0 });
  }

  // clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb4c8, fog: false });
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 16; i++) {
    const b = new Bucket();
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      b.add(blob(8 + rng() * 7, 1, 0.1, j + i), 0xffffff, tf((j - n / 2) * 11, rng() * 3, rng() * 6, 0, 0, 0, 1.3, 0.55, 1), true);
    }
    const m = new THREE.Mesh(b.geometry(), cloudMat);
    const a = rng() * Math.PI * 2, r = 120 + rng() * 480;
    m.position.set(Math.cos(a) * r, 85 + rng() * 60, Math.sin(a) * r);
    m.scale.setScalar(1 + rng() * 1.2);
    scene.add(m);
    clouds.push(m);
  }

  // volcano glow + smoke
  const vy = heightAt(VOLCANO.x, VOLCANO.z);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(11, 12), new THREE.MeshBasicMaterial({ color: 0xffa02a, fog: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(VOLCANO.x, vy + 1.2, VOLCANO.z);
  scene.add(glow);
  const puffGeo = blob(1, 1, 0.12, 9);
  const puffs: { mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; t: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xe8e2dc, emissive: 0x6a625c, transparent: true, flatShading: true, fog: false });
    const mesh = new THREE.Mesh(puffGeo, mat);
    scene.add(mesh);
    puffs.push({ mesh, mat, t: i / 7 });
  }

  return {
    colliders,
    mushrooms,
    trees,
    knock(tree, dirX, dirZ) {
      if (tree.down > 0) return;
      const len = Math.hypot(dirX, dirZ) || 1;
      tree.dirX = dirX / len;
      tree.dirZ = dirZ / len;
      tree.down = 5;
    },
    setDensity(k) {
      // instances were placed in random order, so drawing the first part of each list thins it evenly
      for (const d of thinnable) d.mesh.count = Math.round(d.full * k);
    },
    update(t, dt) {
      // toppled trees: fall over, lie there, then stand back up
      for (const tr of trees) {
        if (tr.fruitT > 0) tr.fruitT -= dt;
        if (tr.down <= 0 && tr.fall === 0 && tr.shake === 0) continue;
        tr.shake = Math.max(0, tr.shake - dt * 1.1);
        tr.down = Math.max(0, tr.down - dt);
        const target = tr.down > 1.1 ? 1 : 0;
        tr.fall += (target - tr.fall) * damp(target ? 7 : 3.5, dt);
        if (!target && tr.fall < 0.004) tr.fall = 0;
        tr.collider.r = tr.fall > 0.25 ? 0 : tr.trunkR;
        // tip over about the base, away from whoever hit it
        tiltAxis.set(tr.dirZ, 0, -tr.dirX);
        qTilt.setFromAxisAngle(tiltAxis, tr.fall * 1.5 + Math.sin(t * 30) * 0.07 * tr.shake);
        qYaw.setFromAxisAngle(upAxis, tr.rot);
        dummy.position.set(tr.x, tr.y, tr.z);
        dummy.quaternion.copy(qTilt).multiply(qYaw);
        dummy.scale.set(tr.s, tr.sy, tr.s);
        dummy.updateMatrix();
        tr.mesh.setMatrixAt(tr.index, dummy.matrix);
        tr.mesh.instanceMatrix.needsUpdate = true;
      }
      for (const c of clouds) {
        c.position.x += dt * 1.6;
        if (c.position.x > 620) c.position.x = -620;
      }
      for (const p of puffs) {
        p.t = (p.t + dt * 0.07) % 1;
        const k = p.t;
        p.mesh.position.set(VOLCANO.x + k * 26 + Math.sin(k * 9 + p.mesh.id) * 3, vy + 4 + k * 65, VOLCANO.z + Math.cos(k * 7 + p.mesh.id) * 3);
        p.mesh.scale.setScalar(5 + k * 16);
        p.mat.opacity = Math.min(1, k * 6) * (1 - k) * 0.95;
      }
      for (const m of mushrooms) {
        m.squash = Math.max(0, m.squash - dt * 2.5);
        const s = Math.sin(m.squash * Math.PI * 3) * m.squash * 0.35;
        m.mesh.scale.set(1.25 * (1 + s), 1.25 * (1 - s), 1.25 * (1 + s));
      }
      glow.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
    },
  };
}

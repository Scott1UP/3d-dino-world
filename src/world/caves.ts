// Caves: a rock "lid" that roofs over the tunnels carved into the hills, plus everything inside them —
// stalactites, stalagmites, glowing crystals, old bones and ammonite fossils.
import * as THREE from 'three';
import { blob, Bucket, cone, cylBetween, sphere, tf } from '../geo';
import { glowTexture } from '../game/food';
import { fbm, mulberry32 } from '../util';
import type { Collider } from './props';
import { baseHeight, caveAt, caveRoof, CAVES, detailTexture, heightAt, rockColor, TERRAIN_SIZE } from './terrain';

export interface Caves {
  /** good spots (deep in each chamber) for something special */
  chambers: { x: number; z: number }[];
  /** the big magic crystal deep in each cave: touch it and it sings */
  gems: { x: number; z: number; y: number }[];
  /** make a cave's crystals light up and shimmer */
  ring(cave: number): void;
  update(t: number, dt: number): void;
}

const toWorld = (cave: number, along: number, lat: number): [number, number] => {
  const c = CAVES[cave];
  return [c.dx * along + c.dz * lat, c.dz * along - c.dx * lat];
};

function lidGeometry(cave: number): THREE.BufferGeometry {
  const A0 = 124, A1 = 215, STEP = 1.5, COLS = 22, FACE = 6;
  const S = TERRAIN_SIZE;
  const rows = Math.floor((A1 - A0) / STEP) + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const push = (x: number, y: number, z: number, u: number, v: number, shade: number, ny: number) => {
    pos.push(x, y, z);
    uv.push(u, v);
    rockColor(x, y, z, ny, c).multiplyScalar(shade);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  const roofed: boolean[] = [];
  const top: number[][] = [];
  const under: number[][] = [];

  for (let i = 0; i < rows; i++) {
    const along = A0 + i * STEP;
    const [cx, cz] = toWorld(cave, along, 0);
    roofed.push(caveRoof(cx, cz) !== null);
    const w = (caveAt(cx, cz)?.w ?? 6.5) + 6;
    top.push([]);
    under.push([]);
    for (let j = 0; j <= COLS; j++) {
      const lat = (j / COLS - 0.5) * 2 * w;
      const [x, z] = toWorld(cave, along, lat);
      const yTop = baseHeight(x, z) + 0.06;
      // same texture mapping + colouring as the terrain, so the lid is indistinguishable from the hillside
      const u = (x + S / 2) / S, v = (-z + S / 2) / S;
      const gx = baseHeight(x + 1.5, z) - baseHeight(x - 1.5, z), gz = baseHeight(x, z + 1.5) - baseHeight(x, z - 1.5);
      top[i].push(push(x, yTop, z, u, v, 1, 1 / Math.sqrt(1 + (gx * gx + gz * gz) / 9)));
      // the ceiling is lumpy, darker rock
      const r = caveRoof(x, z);
      const lump = (fbm(x * 0.33, z * 0.33) - 0.5) * 1.8 + (fbm(x * 0.9, z * 0.9) - 0.5) * 0.7;
      const yUnder = Math.min(yTop - 0.4, r !== null ? r + lump : heightAt(x, z) - 1);
      under[i].push(push(x, yUnder, z, u, v, 0.6, 0.2));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    if (!roofed[i] || !roofed[i + 1]) continue;
    for (let j = 0; j < COLS; j++) {
      for (const g of [top, under]) idx.push(g[i][j], g[i + 1][j], g[i][j + 1], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]);
    }
  }
  // craggy cliff face around the mouth of the cave: bulges outwards between the ceiling and the hilltop
  const first = roofed.indexOf(true);
  if (first >= 0) {
    const along = A0 + first * STEP;
    const [cx, cz] = toWorld(cave, along, 0);
    const w = (caveAt(cx, cz)?.w ?? 6.5) + 6;
    const face: number[][] = [];
    for (let k = 0; k <= FACE; k++) {
      face.push([]);
      for (let j = 0; j <= COLS; j++) {
        const lat = (j / COLS - 0.5) * 2 * w;
        const a = pos[under[first][j] * 3 + 1], b = pos[top[first][j] * 3 + 1];
        const y = a + ((b - a) * k) / FACE;
        const bulge = Math.sin((k / FACE) * Math.PI) * (0.5 + fbm(lat * 0.3 + cave * 7, y * 0.3) * 2.4);
        const [x, z] = toWorld(cave, along - bulge, lat);
        face[k].push(push(x, y, z, (lat + S / 2) / S, y / S, 0.92, 0.35));
      }
    }
    for (let k = 0; k < FACE; k++) {
      for (let j = 0; j < COLS; j++) idx.push(face[k][j], face[k + 1][j], face[k][j + 1], face[k + 1][j], face[k + 1][j + 1], face[k][j + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createCaves(scene: THREE.Scene, colliders: Collider[]): Caves {
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: detailTexture() });
  const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const crystalMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glowTex = glowTexture();
  const glows: THREE.Sprite[] = [];
  const chambers: { x: number; z: number }[] = [];
  const gemSpots: { x: number; z: number; y: number }[] = [];
  const ringT: number[] = [];
  const hue = new THREE.Color();
  const palettes = [
    [0x5ff2ff, 0x39b8ff, 0xb6fbff],
    [0xff7fe0, 0xb884ff, 0xffc2f3],
  ];

  CAVES.forEach((_, cave) => {
    const rng = mulberry32(900 + cave * 31);
    const lid = new THREE.Mesh(lidGeometry(cave), rockMat);
    lid.castShadow = true;
    lid.receiveShadow = true;
    scene.add(lid);

    // where does the roof begin?
    let start = 150;
    for (let a = 126; a < 200; a++) {
      const [x, z] = toWorld(cave, a, 0);
      if (caveRoof(x, z) !== null) { start = a; break; }
    }
    const rock = new Bucket();
    const gems = new Bucket();
    const pick = (wallMin: number, wallMax: number) => {
      const along = start + 3 + rng() * (207 - start - 3);
      const [cx, cz] = toWorld(cave, along, 0);
      const w = caveAt(cx, cz)?.w ?? 6.5;
      const lat = (rng() < 0.5 ? -1 : 1) * (wallMin + rng() * (wallMax - wallMin)) * w;
      const [x, z] = toWorld(cave, along, lat);
      return { x, z, y: heightAt(x, z) };
    };

    // boulders heaped around the mouth so it reads as broken rock, like the hills around it
    {
      const [mx, mz] = toWorld(cave, start, 0);
      const w = caveAt(mx, mz)?.w ?? 6.5;
      for (const [lat, back, size] of [[-(w + 2), 2, 2.6], [w + 2.5, 1.5, 3], [-(w + 6), 3.5, 3.4], [w + 6.5, 3, 2.4], [-(w - 1), 5, 1.4], [w - 0.5, 4.5, 1.2]]) {
        const [x, z] = toWorld(cave, start - back, lat);
        rock.add(blob(1, 1, 0.22, lat + cave), 0xa8a29a, tf(x, heightAt(x, z) + size * 0.2, z, 0, rng() * 6, 0, size, size * 0.75, size * 0.9), true);
        colliders.push({ x, z, r: size * 0.8 });
      }
      for (const lat of [-(w + 3), -3, 4, w + 2]) {
        const [x, z] = toWorld(cave, start + 2.5, lat);
        const size = 2 + rng() * 1.6;
        rock.add(blob(1, 1, 0.22, lat * 3 + cave), 0x9d968c, tf(x, baseHeight(x, z) + size * 0.15, z, 0, rng() * 6, 0, size, size * 0.6, size), true);
      }
    }
    // stalagmites grow up from the floor near the walls
    for (let i = 0; i < 30; i++) {
      const p = pick(0.55, 1.05);
      const h = 1 + rng() * 2.6, r = 0.3 + rng() * 0.45;
      rock.add(cone(r, h, 6), i % 3 ? 0x8d8274 : 0x756b5f, tf(p.x, p.y + h / 2 - 0.15, p.z, 0, rng() * 6, (rng() - 0.5) * 0.15), true);
      if (r > 0.5) colliders.push({ x: p.x, z: p.z, r: r * 0.9 });
    }
    // stalactites hang from the ceiling
    for (let i = 0; i < 46; i++) {
      const p = pick(0, 0.95);
      const roof = caveRoof(p.x, p.z);
      if (roof === null) continue;
      const h = 0.8 + rng() * 2.6;
      rock.add(cone(0.22 + rng() * 0.3, h, 6), i % 2 ? 0x8d8274 : 0x6d6357, tf(p.x, roof - h / 2 + 0.2, p.z, Math.PI, rng() * 6, 0), true);
    }
    // boulders and rubble
    for (let i = 0; i < 12; i++) {
      const p = pick(0.5, 1.0);
      const s = 0.5 + rng() * 1.1;
      rock.add(blob(1, 1, 0.22, i + cave * 9), 0x857b6f, tf(p.x, p.y + s * 0.25, p.z, 0, rng() * 6, 0, s, s * 0.7, s), true);
      if (s > 1) colliders.push({ x: p.x, z: p.z, r: s * 0.8 });
    }
    // glowing crystal clusters
    const pal = palettes[cave % palettes.length];
    for (let i = 0; i < 9; i++) {
      const p = pick(0.6, 0.98);
      for (let k = 0; k < 4; k++) {
        const h = 0.7 + rng() * 1.3;
        gems.add(
          new THREE.OctahedronGeometry(1), pal[k % pal.length],
          tf(p.x + (rng() - 0.5) * 0.9, p.y + h * 0.7, p.z + (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.7, rng() * 6, (rng() - 0.5) * 0.7, 0.24, h, 0.24),
        );
      }
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: pal[0], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7, toneMapped: false }),
      );
      glow.position.set(p.x, p.y + 1.2, p.z);
      glow.userData.phase = rng() * 6;
      glow.userData.cave = cave;
      glow.userData.base = pal[0];
      glow.userData.size = 5.5;
      scene.add(glow);
      glows.push(glow);
      colliders.push({ x: p.x, z: p.z, r: 0.7 });
    }
    // old bones and ammonite fossils on the floor
    const BONE = 0xf1ead6;
    for (let i = 0; i < 5; i++) {
      const p = pick(0.15, 0.7);
      const m = tf(p.x, p.y + 0.2, p.z, 0, rng() * 6, 0);
      const l = 0.7 + rng() * 0.7;
      rock.add(cylBetween([-l, 0, 0], [l, 0, 0], 0.16, 0.16, 6), BONE, m, true);
      for (const e of [-l, l]) for (const k of [-0.16, 0.16]) rock.add(sphere(0.24, 6, 5), BONE, m.clone().multiply(tf(e, 0, k)), true);
    }
    for (let i = 0; i < 5; i++) {
      const p = pick(0.3, 0.9);
      const s = 0.5 + rng() * 0.6;
      const m = tf(p.x, p.y + s * 0.75, p.z, 0.25, rng() * 6, 0, s, s, s);
      rock.add(new THREE.TorusGeometry(0.62, 0.3, 6, 14), 0xd9b98a, m.clone().multiply(tf(0, 0, 0, Math.PI / 2 - 1.2, 0, 0)), true);
      rock.add(new THREE.TorusGeometry(0.26, 0.18, 6, 10), 0xc4a172, m.clone().multiply(tf(0.06, 0.05, 0, Math.PI / 2 - 1.2, 0, 0)), true);
    }
    // a skull resting in the big chamber
    {
      const [sx, sz] = toWorld(cave, 199, cave ? 6 : -6);
      const m = tf(sx, heightAt(sx, sz) + 0.75, sz, 0, CAVES[cave].ang + Math.PI + 0.5, 0, 1.3, 1.3, 1.3);
      rock.add(sphere(1, 10, 8), BONE, m.clone().multiply(tf(0, 0.1, -0.2, 0, 0, 0, 0.7, 0.62, 0.8)));
      rock.add(sphere(1, 10, 8), BONE, m.clone().multiply(tf(0, -0.05, 0.6, 0, 0, 0, 0.5, 0.4, 0.75)));
      for (const s of [-1, 1]) {
        rock.add(sphere(0.2, 8, 6), 0x2a2420, m.clone().multiply(tf(s * 0.34, 0.2, 0.25)));
        rock.add(sphere(0.07, 6, 5), 0x2a2420, m.clone().multiply(tf(s * 0.14, 0.08, 1.28)));
        for (let k = 0; k < 4; k++) rock.add(cone(0.06, 0.2, 5), 0xffffff, m.clone().multiply(tf(s * (0.36 - k * 0.04), -0.42, 0.45 + k * 0.2, Math.PI, 0, 0)));
      }
      colliders.push({ x: sx, z: sz, r: 1.1 });
    }

    // the reward for exploring: one huge crystal standing in the middle of the chamber
    {
      const [gx, gz] = toWorld(cave, 193, 0);
      const BIG = 1.45;
      const gy = heightAt(gx, gz);
      const shards: [number, number, number, number, number][] = [
        [0, 0, 4.2, 0, 0], [0.9, 0.3, 2.9, 0.35, 0.2], [-0.8, 0.5, 2.6, -0.3, 0.25], [0.2, -0.9, 2.2, 0.1, -0.4], [-0.5, -0.6, 1.6, -0.25, -0.3],
      ];
      shards.forEach(([ox, oz, h, rz, rx], k) => {
        const w = (0.55 - k * 0.05) * BIG;
        gems.add(new THREE.OctahedronGeometry(1), pal[k % pal.length], tf(gx + ox * BIG, gy + h * BIG * 0.72, gz + oz * BIG, rx, k, rz, w, h * BIG, w));
      });
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: pal[0], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8, toneMapped: false }),
      );
      glow.position.set(gx, gy + 3.8, gz);
      glow.userData = { phase: 0, cave, base: pal[0], size: 19 };
      scene.add(glow);
      glows.push(glow);
      colliders.push({ x: gx, z: gz, r: 1.9 });
      gemSpots.push({ x: gx, z: gz, y: gy });
      ringT.push(0);
    }

    const rocks = new THREE.Mesh(rock.geometry(), flatMat);
    rocks.castShadow = true;
    scene.add(rocks, new THREE.Mesh(gems.geometry(), crystalMat));
    // (the middle belongs to the crystal, so the "something special" spot sits to one side of it)
    const [chx, chz] = toWorld(cave, 187, cave ? 8 : -8);
    chambers.push({ x: chx, z: chz });
  });

  return {
    chambers,
    gems: gemSpots,
    ring(cave) {
      ringT[cave] = 6;
    },
    update(t, dt) {
      for (let i = 0; i < ringT.length; i++) ringT[i] = Math.max(0, ringT[i] - dt);
      for (const g of glows) {
        const u = g.userData;
        const k = Math.min(1, ringT[u.cave] / 1.5);
        const mat = g.material as THREE.SpriteMaterial;
        // while ringing, every crystal in the cave swells and runs through the rainbow
        if (k > 0) mat.color.copy(hue.setHSL((t * 0.6 + u.phase * 0.2) % 1, 0.9, 0.62));
        else mat.color.set(u.base);
        g.scale.setScalar(u.size * (1 + k * 0.7) + Math.sin(t * (1.7 + k * 6) + u.phase) * (0.9 + k * 1.5));
      }
    },
  };
}

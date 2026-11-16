// Island heightmap: meadow in the middle, a lake, a stream down to the beach, ringed by rocky hills and a volcano.
import * as THREE from 'three';
import { clamp, fbm, lerp, smoothstep } from '../util';

export const LAKE = { x: -38, z: 14, r: 26 };
export const VOLCANO = { x: 10, z: -150 };
const RIVER: [number, number][] = [[-38, 14], [-20, 40], [2, 56], [8, 80], [4, 125]];

function distToRiver(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i];
    const [bx, bz] = RIVER[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = 2.3 + (fbm(x * 0.017, z * 0.017) - 0.5) * 6 + (fbm(x * 0.07 + 10, z * 0.07) - 0.5) * 1.1;
  h = Math.max(h, 1.1 + (h - 1.1) * 0.4);

  // beach + sea to the south (+Z)
  const ang = Math.abs(Math.atan2(x, z));
  const gap = smoothstep(0.6, 1.05, ang);
  const seaT = smoothstep(78, 122, r) * (1 - gap);
  h = lerp(h, -3.2, seaT);

  // rocky hills all the way round
  const ringStart = 102 + (fbm(x * 0.03 + 50, z * 0.03 + 50) - 0.5) * 18;
  const m = smoothstep(ringStart, ringStart + 30, r) * gap;
  h += m * (15 + fbm(x * 0.05, z * 0.05) * 16);

  // volcano
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (dv < 70) {
    const cone = Math.pow(1 - dv / 70, 1.5) * 62;
    h += dv < 11 ? cone - (1 - dv / 11) * 14 : cone;
  }
  // everything sinks back into the sea far out
  h = lerp(h, -4, smoothstep(175, 215, r));

  // lake
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + (fbm(x * 0.07, z * 0.07) - 0.5) * 9;
  h = lerp(h, -1.25, 1 - smoothstep(LAKE.r * 0.5, LAKE.r, dl));

  // stream
  const dr = distToRiver(x, z) + (fbm(x * 0.1 + 7, z * 0.1) - 0.5) * 3;
  h = lerp(h, Math.min(h, -0.4), 1 - smoothstep(2.2, 7.5, dr));
  return h;
}

/** Can a dino stand here? Keeps everyone out of the deep sea and off the cliffs. */
export function canWalk(x: number, z: number): boolean {
  const h = heightAt(x, z);
  const r = Math.hypot(x, z);
  if (r > 150) return false;
  if (h < -1.6) return false;
  if (h > 7.5 && r > 80) return false;
  return true;
}

function detailTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eeeeee';
  g.fillRect(0, 0, 256, 256);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(205 + rnd() * 50);
    g.fillStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.4})`;
    const x = rnd() * 256, y = rnd() * 256, w = 2 + rnd() * 7;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, w, w * (0.5 + rnd() * 0.5), rnd() * 3, 0, 7);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(90, 90);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createTerrain(): THREE.Mesh {
  const SIZE = 460, SEG = 200;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();

  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const grassA = new THREE.Color(0x63b53a);
  const grassB = new THREE.Color(0x8fce4a);
  const grassC = new THREE.Color(0x4a9a34);
  const dirt = new THREE.Color(0xb89a5e);
  const sand = new THREE.Color(0xf3deA0);
  const wet = new THREE.Color(0xd9c184);
  const foam = new THREE.Color(0xfbfff5);
  const rock = new THREE.Color(0x9d968c);
  const rockDark = new THREE.Color(0x7b736b);
  const lava = new THREE.Color(0xff5a1f);
  const moss = new THREE.Color(0x6fae45);
  const tmp = new THREE.Color();
  const ash = new THREE.Color(0x5b4a44);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = fbm(x * 0.045 + 3, z * 0.045 + 9);
    const f2 = fbm(x * 0.12 + 40, z * 0.12 + 20, 3);
    c.copy(grassA).lerp(grassB, smoothstep(0.35, 0.65, f)).lerp(grassC, smoothstep(0.55, 0.8, f2) * 0.7);
    c.lerp(dirt, smoothstep(0.66, 0.74, fbm(x * 0.03 + 80, z * 0.03 + 60)) * 0.75 * smoothstep(12, 30, Math.hypot(x, z)));
    // sand near the water line
    c.lerp(sand, 1 - smoothstep(0.45, 1.0 + f2 * 0.3, y));
    if (y < 0.3) c.lerp(wet, 1 - smoothstep(-0.6, 0.3, y));
    c.lerp(foam, (1 - smoothstep(0.0, 0.14, Math.abs(y - 0.02))) * 0.75);
    // rock on high or steep ground
    const steep = 1 - smoothstep(0.72, 0.9, n.getY(i));
    const high = smoothstep(7, 11, y + f2 * 3);
    const rk = Math.max(steep * smoothstep(3, 6, y), high);
    if (rk > 0) {
      const band = 0.5 + 0.5 * Math.sin(y * 0.75 + f * 9);
      c.lerp(tmp.copy(rockDark).lerp(rock, band * 0.7 + f2 * 0.5), rk);
      // mossy ledges wherever the rock flattens out
      c.lerp(moss, rk * smoothstep(0.8, 0.96, n.getY(i)) * smoothstep(0.35, 0.6, f) * 0.85);
    }
    // volcano
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    if (dv < 46) c.lerp(ash, smoothstep(46, 24, dv));
    if (dv < 17) c.lerp(lava, smoothstep(17, 9, dv + f2 * 5));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() }));
  mesh.receiveShadow = true;
  return mesh;
}

export interface Water {
  mesh: THREE.Mesh;
  update(t: number): void;
}

export function createWater(): Water {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b9e6fb';
  g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 256, y = rnd() * 256, w = 14 + rnd() * 30;
    g.strokeStyle = `rgba(255,255,255,${0.55 + rnd() * 0.45})`;
    g.lineWidth = 2 + rnd() * 2.5;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      g.beginPath();
      g.moveTo(x + ox - w / 2, y + oy);
      g.quadraticCurveTo(x + ox, y + oy - 5, x + ox + w / 2, y + oy);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(110, 110);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1400, 1400);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshPhongMaterial({
      color: 0x35bdf2, map: tex, transparent: true, opacity: 0.8,
      shininess: 90, specular: 0x8fd8ff, depthWrite: false,
    }),
  );
  mesh.renderOrder = 1;
  return {
    mesh,
    update(t) {
      tex.offset.set(t * 0.012, t * 0.008 + Math.sin(t * 0.4) * 0.004);
      mesh.position.y = Math.sin(t * 0.8) * 0.03;
    },
  };
}

export function createSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f8fe8) },
      mid: { value: new THREE.Color(0x8fd2fb) },
      low: { value: new THREE.Color(0xdff4ff) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vDir;' +
      'void main(){ float h = clamp(vDir.y, 0.0, 1.0);' +
      ' vec3 c = mix(low, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.2, 0.8, h));' +
      ' gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), mat);
  m.frustumCulled = false;
  return m;
}

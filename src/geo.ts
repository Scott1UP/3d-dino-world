// Procedural low-poly geometry toolkit: every model in the game is built from these.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from './util';

export type Col = THREE.ColorRepresentation;

const _c = new THREE.Color();

/** Transform matrix helper: position, euler rotation, scale */
export function tf(
  px = 0, py = 0, pz = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = sx, sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Collects coloured pieces and merges them into a single vertex-coloured geometry. */
export class Bucket {
  private geos: THREE.BufferGeometry[] = [];

  /** color = null means the geometry already carries a colour attribute */
  add(geo: THREE.BufferGeometry, color: Col | null, m?: THREE.Matrix4, flat = false): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    if (flat || !g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    if (color !== null) {
      _c.set(color);
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = _c.r;
        arr[i * 3 + 1] = _c.g;
        arr[i * 3 + 2] = _c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    this.geos.push(g);
    return this;
  }

  get empty() {
    return this.geos.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false)!;
    this.geos.forEach((g) => g.dispose());
    this.geos = [];
    return merged;
  }
}

export interface Ring {
  y: number;
  z: number;
  rx: number;
  ry: number;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** u = 0..1 along the tube, dorsal = 1 on the back / -1 on the belly, side = -1..1 left to right */
export type SkinFn = (u: number, dorsal: number, out: THREE.Color, side: number) => void;

/**
 * Organic tube swept along a spine that lives in the Y/Z plane (symmetrical in X).
 * Rings must run along the curve; `dorsal` passed to the colour fn is 1 on the back, -1 on the belly.
 */
export function tube(rings: Ring[], color: SkinFn, radial = 16, sub = 6): THREE.BufferGeometry {
  const n = (rings.length - 1) * sub + 1;
  const ys: number[] = [];
  const zs: number[] = [];
  const rxs: number[] = [];
  const rys: number[] = [];
  const at = (i: number) => rings[Math.min(rings.length - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) {
    const seg = Math.min(rings.length - 2, Math.floor(i / sub));
    const t = i / sub - seg;
    const a = at(seg - 1), b = at(seg), c = at(seg + 1), d = at(seg + 2);
    ys.push(catmull(a.y, b.y, c.y, d.y, t));
    zs.push(catmull(a.z, b.z, c.z, d.z, t));
    rxs.push(Math.max(0.001, catmull(a.rx, b.rx, c.rx, d.rx, t)));
    rys.push(Math.max(0.001, catmull(a.ry, b.ry, c.ry, d.ry, t)));
  }
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let ty = ys[i1] - ys[i0];
    let tz = zs[i1] - zs[i0];
    const len = Math.hypot(ty, tz) || 1;
    ty /= len;
    tz /= len;
    // in-plane normal: (0, tz, -ty)
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(sa * rxs[i], ys[i] + tz * ca * rys[i], zs[i] - ty * ca * rys[i]);
      color(i / (n - 1), ca, _c, sa);
      col.push(_c.r, _c.g, _c.b);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = i * radial + j1;
      const d = (i + 1) * radial + j1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // caps
  const s = pos.length / 3;
  pos.push(0, ys[0], zs[0]);
  color(0, 0, _c, 0);
  col.push(_c.r, _c.g, _c.b);
  pos.push(0, ys[n - 1], zs[n - 1]);
  color(1, 0, _c, 0);
  col.push(_c.r, _c.g, _c.b);
  for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial;
    idx.push(s, j, j1);
    idx.push(s + 1, (n - 1) * radial + j1, (n - 1) * radial + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface SkinOpts {
  base: Col;
  belly: Col;
  stripe?: Col;
  /** number of stripes along the tube */
  stripes?: number;
  /** dappled spots on the back and flanks */
  spots?: Col;
  /** colour applied where u > tipFrom (beaks, tail tips) */
  tip?: Col;
  tipFrom?: number;
}

/** Standard creature skin: dark back, pale belly, optional stripes across the back. */
export function skin(o: SkinOpts): SkinFn {
  const base = new THREE.Color(o.base);
  const belly = new THREE.Color(o.belly);
  const stripe = o.stripe !== undefined ? new THREE.Color(o.stripe) : null;
  const tip = o.tip !== undefined ? new THREE.Color(o.tip) : null;
  const spots = o.spots !== undefined ? new THREE.Color(o.spots) : null;
  const shade = new THREE.Color(o.base).multiplyScalar(0.8);
  const freq = (o.stripes ?? 5) * Math.PI * 2;
  return (u, d, out, side) => {
    out.copy(belly).lerp(base, smoothstep(-0.6, -0.05, d));
    // slightly deeper colour along the spine gives the body some form
    out.lerp(shade, smoothstep(0.55, 1, d) * 0.45);
    if (spots) {
      const a = Math.abs(side);
      const n = Math.sin(u * 53 + a * 5.1) * Math.sin(a * 8.3 - u * 19 + 1.3);
      out.lerp(spots, smoothstep(0.42, 0.62, n) * smoothstep(-0.35, 0.1, d) * 0.85);
    }
    if (stripe) {
      const s = Math.sin(u * freq);
      out.lerp(stripe, smoothstep(0.25, 0.6, s) * smoothstep(-0.05, 0.45, d));
    }
    if (tip && u > (o.tipFrom ?? 0.85)) out.copy(tip);
  };
}

export const plain = (c: Col): SkinFn => {
  const col = new THREE.Color(c);
  return (_u, _d, out) => void out.copy(col);
};

/** Tapered cylinder between two points (radius ra at a, rb at b). */
export function cylBetween(
  a: [number, number, number],
  b: [number, number, number],
  ra: number,
  rb: number,
  seg = 8,
): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Flat polygon (fan-triangulated) visible from both sides. */
export function flatPoly(points: [number, number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    pos.push(...points[0], ...points[i], ...points[i + 1]);
    pos.push(...points[0], ...points[i + 1], ...points[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Lumpy low-poly blob (rocks, foliage). Deterministic so shared vertices stay welded. */
export function blob(radius: number, detail: number, lump: number, seed = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const q = (v: number) => Math.round((v / radius) * 500);
    const h = Math.sin(q(x) * 0.129898 + q(y) * 0.78233 + q(z) * 0.37719 + seed * 3.17) * 43758.5453;
    const k = 1 + (h - Math.floor(h) - 0.5) * 2 * lump;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

export const sphere = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
export const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);

/** Top-surface lookup built from real geometry: "how high is this model at (x, z)?" */
export interface HeightGrid {
  /**
   * Height of the highest surface at a point (model space), or null where there is nothing.
   * pad = half the width of whatever is standing there, so it rests on the highest bit under its feet.
   */
  at(x: number, z: number, pad?: number): number | null;
}

/**
 * Rasterise the triangles of some meshes into a grid of maximum heights.
 * Used so flyers land on the true surface of a tree or another dinosaur instead of sinking into it.
 */
export function heightGrid(parts: { geo: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[], cell = 0.22): HeightGrid {
  const tris: THREE.Vector3[] = [];
  const box = new THREE.Box3();
  for (const { geo, matrix } of parts) {
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
      if (matrix) v.applyMatrix4(matrix);
      tris.push(v);
      box.expandByPoint(v);
    }
  }
  const x0 = box.min.x - cell, z0 = box.min.z - cell;
  const w = Math.ceil((box.max.x - x0) / cell) + 2, d = Math.ceil((box.max.z - z0) / cell) + 2;
  const h = new Float32Array(w * d).fill(-Infinity);
  const put = (x: number, y: number, z: number) => {
    const i = Math.floor((x - x0) / cell) + Math.floor((z - z0) / cell) * w;
    if (y > h[i]) h[i] = y;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    // sample finely enough that no cell under the triangle is missed
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, k = 1 - u - v;
        put(a.x * k + b.x * u + c.x * v, a.y * k + b.y * u + c.y * v, a.z * k + b.z * u + c.z * v);
      }
    }
  }
  return {
    at(x, z, pad = 0) {
      const cell0 = (px: number, pz: number) => {
        const cx = Math.floor((px - x0) / cell), cz = Math.floor((pz - z0) / cell);
        return cx < 0 || cz < 0 || cx >= w || cz >= d ? -Infinity : h[cx + cz * w];
      };
      const centre = cell0(x, z);
      if (centre === -Infinity) return null;
      // the highest point under the footprint, so feet never dip into a slope
      return Math.max(centre, cell0(x - pad, z - pad), cell0(x + pad, z - pad), cell0(x - pad, z + pad), cell0(x + pad, z + pad));
    },
  };
}

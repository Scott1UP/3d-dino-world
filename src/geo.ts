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

export type SkinFn = (u: number, dorsal: number, out: THREE.Color) => void;

/**
 * Organic tube swept along a spine that lives in the Y/Z plane (symmetrical in X).
 * Rings must run along the curve; `dorsal` passed to the colour fn is 1 on the back, -1 on the belly.
 */
export function tube(rings: Ring[], color: SkinFn, radial = 12, sub = 5): THREE.BufferGeometry {
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
      color(i / (n - 1), ca, _c);
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
  color(0, 0, _c);
  col.push(_c.r, _c.g, _c.b);
  pos.push(0, ys[n - 1], zs[n - 1]);
  color(1, 0, _c);
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
  const freq = (o.stripes ?? 5) * Math.PI * 2;
  return (u, d, out) => {
    out.copy(belly).lerp(base, smoothstep(-0.55, 0.05, d));
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

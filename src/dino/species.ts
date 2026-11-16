// The dinosaurs. Every model is generated in code: organic tubes for bodies, simple shapes for the rest.
// All dinos face +Z with their feet on y = 0.
import * as THREE from 'three';
import { Col, cone, cylBetween, flatPoly, plain, Ring, skin, sphere, tf, tube } from '../geo';
import { DinoBuilder, Rig } from './rig';

export type SpeciesId =
  | 'triceratops' | 'trex' | 'pteranodon' | 'stegosaurus' | 'brachiosaurus' | 'plesiosaurus' | 'turtle';

export interface Species {
  id: SpeciesId;
  name: string;
  say: string;
  food: string;
  foodIcon: string;
  fact: string;
  color: string;
  eggSpots: Col;
  speed: number;
  /** collision / interaction radius at scale 1 */
  radius: number;
  /** camera framing */
  height: number;
  flies: boolean;
  swims: boolean;
  /** roar pitch multiplier */
  voice: number;
  build: () => Rig;
}

const HORN = 0xfff3d6;
const CLAW = 0xf6ecd8;
const BLUSH = 0xff9db0;

interface LegOpts {
  r: number;
  color: Col;
  dark: Col;
  hind?: boolean;
}

/** Two-part leg (thigh + shin/foot) so knees can bend. Returns [hip, knee] pivots. */
function leg(b: DinoBuilder, x: number, y: number, z: number, o: LegOpts): [THREE.Group, THREE.Group] {
  const { r, color, dark } = o;
  const len = y;
  const kz = o.hind ? len * 0.14 : len * 0.03;
  const ky = -len * 0.5;
  const hip = b.pivot(b.root, x, y, z);
  b.add(hip, sphere(1, 14, 10), color, tf(0, -len * 0.2, kz * 0.4, 0, 0, 0, r * 1.35, len * 0.36, r * (o.hind ? 1.8 : 1.4)));
  b.add(hip, cylBetween([0, -len * 0.15, kz * 0.3], [0, ky, kz], r * 1.15, r * 0.95, 12), color);
  b.add(hip, sphere(r * 0.98, 12, 8), color, tf(0, ky, kz));

  const knee = b.pivot(hip, x, y + ky, z + kz);
  const az = -kz * 0.9;
  const fy = -len * 0.5;
  b.add(knee, cylBetween([0, 0, 0], [0, fy + r * 0.55, az], r * 0.92, r * 0.8, 12), color);
  b.add(knee, sphere(1, 14, 8), dark, tf(0, fy + r * 0.42, az + r * 0.35, 0, 0, 0, r * 1.12, r * 0.5, r * 1.45));
  for (const t of [-0.62, 0, 0.62]) {
    const tz = az + r * 1.5 - Math.abs(t) * r * 0.35;
    b.add(knee, sphere(r * 0.34, 8, 6), dark, tf(t * r, fy + r * 0.3, tz, 0, 0, 0, 1, 0.85, 1.25));
    b.add(knee, cone(r * 0.17, r * 0.46, 6), CLAW, tf(t * r, fy + r * 0.2, tz + r * 0.42, 1.8, 0, 0));
  }
  return [hip, knee];
}

function quadLegs(
  b: DinoBuilder,
  o: { fx: number; fy: number; fz: number; rx: number; ry: number; rz: number; r: number; color: Col; dark: Col },
) {
  const legs: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const spots: [number, number, number, boolean][] = [
    [o.fx, o.fy, o.fz, false], [-o.fx, o.fy, o.fz, false], [o.rx, o.ry, o.rz, true], [-o.rx, o.ry, o.rz, true],
  ];
  for (const [x, y, z, hind] of spots) {
    const [h, k] = leg(b, x, y, z, { r: o.r * (hind ? 1.08 : 1), color: o.color, dark: o.dark, hind });
    legs.push(h);
    knees.push(k);
  }
  return { legs, knees, legPhase: [0, Math.PI, Math.PI, 0], legSide: [1, -1, 1, -1] };
}

/** Row of little bumps along the top of a tube. */
function ridge(
  add: (geo: THREE.BufferGeometry, color: Col, m: THREE.Matrix4) => void,
  rings: Ring[], n: number, size: number, color: Col, from = 0.12, to = 0.9,
) {
  for (let i = 0; i < n; i++) {
    const u = from + ((to - from) * i) / (n - 1);
    const f = u * (rings.length - 1);
    const a = rings[Math.floor(f)], c = rings[Math.min(rings.length - 1, Math.floor(f) + 1)];
    const k = f - Math.floor(f);
    const s = size * (0.55 + Math.sin(u * Math.PI) * 0.6);
    add(sphere(s, 8, 6), color, tf(0, a.y + a.ry + (c.y + c.ry - a.y - a.ry) * k - s * 0.25, a.z + (c.z - a.z) * k, 0, 0, 0, 0.75, 1, 1.35));
  }
}

function mouthAt(head: THREE.Group, y: number, z: number): THREE.Object3D {
  const m = new THREE.Object3D();
  m.position.set(0, y, z);
  head.add(m);
  return m;
}

const base: Pick<Rig, 'jaw' | 'tail' | 'wings' | 'swims'> = { jaw: null, tail: null, wings: [], swims: false };

// ───────────────────────────── Triceratops ─────────────────────────────
function buildTriceratops(): Rig {
  const BASE = 0x2fb7a6, BELLY = 0xf9e9b8, STRIPE = 0x1c8f8a, FRILL = 0xff9a3c, DARK = 0x1f8d86;
  const b = new DinoBuilder(1.05, 0);
  const sk = skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 5, spots: 0x54cfc0 });
  const spine: Ring[] = [
    { y: 1.0, z: -1.15, rx: 0.2, ry: 0.22 },
    { y: 1.1, z: -0.75, rx: 0.54, ry: 0.54 },
    { y: 1.2, z: -0.2, rx: 0.72, ry: 0.7 },
    { y: 1.2, z: 0.4, rx: 0.7, ry: 0.66 },
    { y: 1.13, z: 0.85, rx: 0.5, ry: 0.5 },
    { y: 1.08, z: 1.15, rx: 0.34, ry: 0.36 },
  ];
  b.addBody(tube(spine, sk, 18), null);
  ridge((g, c, m) => b.addBody(g, c, m), spine, 9, 0.085, DARK);

  const tail = b.pivot(b.body, 0, 1.05, -0.85);
  const tailRings: Ring[] = [
    { y: -0.32, z: -1.45, rx: 0.03, ry: 0.03 },
    { y: -0.2, z: -1.0, rx: 0.13, ry: 0.13 },
    { y: -0.08, z: -0.5, rx: 0.26, ry: 0.26 },
    { y: 0, z: 0.05, rx: 0.4, ry: 0.4 },
  ];
  b.add(tail, tube(tailRings, skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 }), 12), null);

  const head = b.pivot(b.body, 0, 1.12, 1.05);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.2, rx: 0.3, ry: 0.3 },
        { y: 0.04, z: 0.2, rx: 0.43, ry: 0.41 },
        { y: 0.01, z: 0.55, rx: 0.34, ry: 0.31 },
        { y: -0.07, z: 0.85, rx: 0.21, ry: 0.2 },
        { y: -0.17, z: 1.03, rx: 0.07, ry: 0.07 },
      ],
      skin({ base: BASE, belly: BELLY, tip: 0xffd15c, tipFrom: 0.86 }), 16,
    ),
    null,
  );
  // frill: rolled rim, pale centre, studs
  const frillM = tf(0, 0.38, -0.14, -0.42, 0, 0);
  b.add(head, sphere(1, 24, 14), FRILL, frillM.clone().multiply(tf(0, 0, 0, 0, 0, 0, 0.9, 0.82, 0.1)));
  b.add(head, new THREE.TorusGeometry(0.86, 0.075, 8, 28), 0xf07f22, frillM.clone().multiply(tf(0, 0, 0, 0, 0, 0, 1, 0.91, 1)));
  b.add(head, sphere(1, 20, 10), 0xffc978, frillM.clone().multiply(tf(0, -0.02, 0.07, 0, 0, 0, 0.62, 0.56, 0.06)));
  for (const s of [-1, 1]) {
    b.add(head, sphere(1, 10, 8), 0xffa94f, frillM.clone().multiply(tf(s * 0.3, 0.22, 0.11, 0, 0, s * 0.4, 0.13, 0.2, 0.03)));
  }
  for (let i = 0; i < 11; i++) {
    const a = -1.9 + (i / 10) * 3.8;
    b.add(head, cone(0.085, 0.22, 7), HORN, frillM.clone().multiply(tf(Math.sin(a) * 0.9, Math.cos(a) * 0.82, 0, 0, 0, -a)));
  }
  for (const s of [-1, 1]) {
    b.add(head, cone(0.095, 0.76, 10), HORN, tf(s * 0.22, 0.62, 0.42, 0.75, 0, -s * 0.18));
    b.add(head, sphere(0.11, 8, 6), DARK, tf(s * 0.22, 0.36, 0.2, 0, 0, 0, 1, 0.6, 1));
    b.eye(head, s * 0.33, 0.1, 0.42, 0.125, s, 0x6b3d1f, DARK);
    b.add(head, sphere(0.032, 6, 5), 0x146e6a, tf(s * 0.09, -0.03, 0.94));
    b.add(head, sphere(0.1, 8, 6), BLUSH, tf(s * 0.33, -0.1, 0.5, 0, 0, 0, 0.5, 0.7, 1));
    b.add(head, cone(0.06, 0.16, 6), HORN, tf(s * 0.4, -0.12, 0.25, 0, 0, -s * 1.9));
  }
  b.add(head, cone(0.085, 0.32, 9), HORN, tf(0, 0.26, 0.74, 0.45, 0, 0));

  const jaw = b.pivot(head, 0, 0.98, 1.3);
  b.add(
    jaw,
    tube(
      [
        { y: -0.04, z: -0.05, rx: 0.2, ry: 0.11 },
        { y: -0.06, z: 0.3, rx: 0.21, ry: 0.1 },
        { y: -0.07, z: 0.58, rx: 0.1, ry: 0.06 },
      ],
      plain(BELLY), 10, 4,
    ),
    null,
  );
  b.add(jaw, sphere(0.12, 8, 6), 0xff7f8e, tf(0, 0.02, 0.3, 0, 0, 0, 1, 0.3, 1.8));

  const q = quadLegs(b, { fx: 0.44, fy: 0.95, fz: 0.62, rx: 0.48, ry: 1.0, rz: -0.6, r: 0.2, color: BASE, dark: DARK });
  return {
    ...base, root: b.finish(), body: b.body, head, jaw, tail, ...q, lids: b.lids,
    mouth: mouthAt(head, -0.25, 0.95), eatPitch: 0.75, bodyEatPitch: 0.06, legSwing: 0.55, bodyY: 1.05,
  };
}

// ───────────────────────────── T-Rex ─────────────────────────────
function buildTRex(): Rig {
  const BASE = 0xf0623a, BELLY = 0xffe2a8, STRIPE = 0xb93a2a, DARK = 0xc9472c;
  const b = new DinoBuilder(1.55, -0.05);
  const sk = skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4, spots: 0xff8a5c });
  const spine: Ring[] = [
    { y: 1.45, z: -0.6, rx: 0.3, ry: 0.34 },
    { y: 1.6, z: -0.15, rx: 0.54, ry: 0.58 },
    { y: 1.82, z: 0.38, rx: 0.56, ry: 0.6 },
    { y: 2.08, z: 0.8, rx: 0.42, ry: 0.46 },
    { y: 2.32, z: 1.08, rx: 0.32, ry: 0.34 },
  ];
  b.addBody(tube(spine, sk, 18), null);
  ridge((g, c, m) => b.addBody(g, c, m), spine, 8, 0.09, STRIPE, 0.08, 0.95);

  const tail = b.pivot(b.body, 0, 1.5, -0.45);
  const tailRings: Ring[] = [
    { y: 0.2, z: -2.3, rx: 0.03, ry: 0.03 },
    { y: 0.12, z: -1.55, rx: 0.14, ry: 0.15 },
    { y: 0.04, z: -0.8, rx: 0.27, ry: 0.3 },
    { y: 0, z: 0.05, rx: 0.4, ry: 0.44 },
  ];
  b.add(tail, tube(tailRings, skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 6 }), 12), null);
  ridge((g, c, m) => b.add(tail, g, c, m), tailRings, 7, 0.07, STRIPE, 0.25, 0.95);

  const head = b.pivot(b.body, 0, 2.36, 1.02);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.34, rx: 0.27, ry: 0.29 },
        { y: 0.1, z: 0.0, rx: 0.45, ry: 0.39 },
        { y: 0.09, z: 0.42, rx: 0.4, ry: 0.31 },
        { y: 0.04, z: 0.8, rx: 0.34, ry: 0.25 },
        { y: 0.01, z: 1.05, rx: 0.24, ry: 0.17 },
        { y: -0.01, z: 1.13, rx: 0.1, ry: 0.07 },
      ],
      skin({ base: BASE, belly: 0xf6a36a, spots: 0xff8a5c }), 18,
    ),
    null,
  );
  for (const s of [-1, 1]) {
    b.eye(head, s * 0.35, 0.24, 0.14, 0.14, s, 0xf2b01e, STRIPE);
    b.add(head, sphere(0.12, 10, 8), STRIPE, tf(s * 0.27, 0.43, 0.02, 0, 0, 0, 0.9, 0.45, 1.6));
    b.add(head, sphere(0.06, 8, 6), DARK, tf(s * 0.13, 0.17, 1.02, 0, 0, 0, 1, 0.7, 1));
    b.add(head, sphere(0.035, 6, 5), 0x6b1f18, tf(s * 0.14, 0.17, 1.06));
    b.add(head, sphere(0.11, 8, 6), BLUSH, tf(s * 0.4, 0.0, 0.3, 0, 0, 0, 0.4, 0.7, 1));
    for (let i = 0; i < 6; i++) {
      b.add(head, cone(0.045, 0.13, 6), 0xffffff, tf(s * (0.32 - i * 0.027), -0.2, 0.28 + i * 0.14, Math.PI, 0, 0));
    }
  }
  for (const x of [-0.08, 0.08]) b.add(head, cone(0.045, 0.12, 6), 0xffffff, tf(x, -0.14, 1.05, Math.PI, 0, 0));

  const jaw = b.pivot(head, 0, 2.2, 0.95);
  b.add(
    jaw,
    tube(
      [
        { y: -0.04, z: -0.1, rx: 0.31, ry: 0.15 },
        { y: -0.1, z: 0.35, rx: 0.33, ry: 0.13 },
        { y: -0.09, z: 0.82, rx: 0.27, ry: 0.11 },
        { y: -0.06, z: 1.06, rx: 0.11, ry: 0.05 },
      ],
      plain(BELLY), 12, 4,
    ),
    null,
  );
  b.add(jaw, sphere(0.2, 10, 6), 0xff7f8e, tf(0, -0.01, 0.5, 0, 0, 0, 0.95, 0.3, 2));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) b.add(jaw, cone(0.035, 0.09, 5), 0xffffff, tf(s * (0.27 - i * 0.03), 0.04, 0.4 + i * 0.16));
  }

  // tiny arms
  for (const s of [-1, 1]) {
    b.addBody(sphere(0.12, 8, 6), BASE, tf(s * 0.4, 1.92, 0.72));
    b.addBody(cylBetween([s * 0.4, 1.9, 0.72], [s * 0.44, 1.62, 0.92], 0.09, 0.07, 8), BASE);
    b.addBody(cylBetween([s * 0.44, 1.62, 0.92], [s * 0.42, 1.55, 1.14], 0.07, 0.055, 8), BASE);
    b.addBody(sphere(0.065, 8, 6), DARK, tf(s * 0.42, 1.55, 1.15));
    b.addBody(cone(0.035, 0.13, 6), CLAW, tf(s * 0.39, 1.53, 1.21, 1.9, 0, 0));
    b.addBody(cone(0.035, 0.13, 6), CLAW, tf(s * 0.46, 1.53, 1.21, 1.9, 0, 0));
  }

  const legs: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const [h, k] = leg(b, s * 0.42, 1.55, -0.05, { r: 0.2, color: BASE, dark: DARK, hind: true });
    legs.push(h);
    knees.push(k);
  }

  return {
    ...base, root: b.finish(), body: b.body, head, jaw, tail, legs, knees, legPhase: [0, Math.PI], legSide: [1, -1],
    lids: b.lids, mouth: mouthAt(head, -0.3, 0.9), eatPitch: 0.45, bodyEatPitch: 0.55, legSwing: 0.6, bodyY: 1.55,
  };
}

// ───────────────────────────── Pteranodon ─────────────────────────────
function buildPteranodon(): Rig {
  const BASE = 0x9a5cf0, BELLY = 0xf3e3ff, WING = 0xffc23d, WING2 = 0xffa42b, BEAK = 0xffb020, CREST = 0xff5e7e, DARK = 0x7a41cf;
  const H = 1.25;
  const b = new DinoBuilder(H, 0);

  b.addBody(
    tube(
      [
        { y: H - 0.06, z: -0.8, rx: 0.04, ry: 0.04 },
        { y: H, z: -0.38, rx: 0.22, ry: 0.22 },
        { y: H, z: 0.12, rx: 0.32, ry: 0.32 },
        { y: H + 0.06, z: 0.48, rx: 0.21, ry: 0.22 },
        { y: H + 0.2, z: 0.76, rx: 0.14, ry: 0.15 },
      ],
      skin({ base: BASE, belly: BELLY, spots: 0xb98aff }), 14,
    ),
    null,
  );

  const head = b.pivot(b.body, 0, H + 0.22, 0.72);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.14, rx: 0.14, ry: 0.15 },
        { y: 0.05, z: 0.12, rx: 0.22, ry: 0.22 },
        { y: 0.02, z: 0.4, rx: 0.15, ry: 0.14 },
      ],
      skin({ base: BASE, belly: BELLY }), 14, 5,
    ),
    null,
  );
  b.add(head, cone(0.125, 1.0, 10), BEAK, tf(0, 0.02, 0.86, Math.PI / 2 + 0.06, 0, 0, 1, 1, 0.6));
  b.add(head, cone(0.13, 1.0, 8), CREST, tf(0, 0.38, -0.38, -1.05, 0, 0, 0.42, 1, 1));
  b.add(head, cone(0.09, 0.7, 8), 0xff8fa5, tf(0, 0.3, -0.26, -1.05, 0, 0, 0.5, 1, 0.6));
  for (const s of [-1, 1]) {
    b.eye(head, s * 0.17, 0.1, 0.2, 0.095, s, 0x2f9fe0, DARK);
    b.add(head, sphere(0.02, 5, 4), 0x9a5a00, tf(s * 0.05, 0.07, 0.7));
  }

  const jaw = b.pivot(head, 0, H + 0.2, 1.0);
  b.add(jaw, cone(0.09, 0.84, 8), 0xe89510, tf(0, -0.05, 0.43, Math.PI / 2, 0, 0, 1, 1, 0.4));

  const wings: Rig['wings'] = [];
  for (const s of [-1, 1]) {
    const inner = b.pivot(b.body, s * 0.22, H + 0.08, 0.1);
    b.add(inner, flatPoly([[0, 0, 0.36], [s * 1.15, 0, 0.3], [s * 1.15, 0, -0.36], [s * 0.78, 0, -0.52], [s * 0.4, 0, -0.62], [0, 0, -0.62]]), WING);
    b.add(inner, flatPoly([[0, 0.012, -0.1], [s * 1.15, 0.012, -0.05], [s * 1.15, 0.012, -0.36], [s * 0.78, 0.012, -0.52], [s * 0.4, 0.012, -0.62], [0, 0.012, -0.62]]), WING2);
    b.add(inner, cylBetween([0, 0, 0.34], [s * 1.15, 0, 0.3], 0.085, 0.06, 8), BASE);
    b.add(inner, sphere(0.08, 8, 6), BASE, tf(s * 1.15, 0, 0.3));
    const outer = b.pivot(inner, s * 1.37, H + 0.08, 0.1);
    b.add(outer, flatPoly([[0, 0, 0.2], [s * 1.5, 0, -0.25], [s * 0.95, 0, -0.42], [s * 0.45, 0, -0.44], [0, 0, -0.46]]), WING);
    b.add(outer, flatPoly([[0, 0.012, -0.12], [s * 1.2, 0.012, -0.27], [s * 0.95, 0.012, -0.42], [s * 0.45, 0.012, -0.44], [0, 0.012, -0.46]]), WING2);
    b.add(outer, cylBetween([0, 0, 0.2], [s * 1.5, 0, -0.25], 0.06, 0.015, 8), BASE);
    for (const k of [0.25, 0.6]) b.add(outer, cone(0.03, 0.12, 5), CLAW, tf(s * 0.02, 0, 0.26 + k * 0.05, 1.2, 0, -s * k));
    wings.push({ inner, outer, side: s });
  }

  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const g = b.pivot(b.body, s * 0.14, H - 0.14, -0.32);
    b.add(g, cylBetween([0, 0, 0], [0, -0.42, 0], 0.06, 0.04, 8), BASE);
    b.add(g, sphere(0.075, 8, 6), BEAK, tf(0, -0.45, 0.04, 0, 0, 0, 1, 0.6, 1.7));
    for (const x of [-0.04, 0.04]) b.add(g, cone(0.02, 0.08, 5), CLAW, tf(x, -0.46, 0.17, 1.7, 0, 0));
    legs.push(g);
  }

  return {
    ...base, root: b.finish(), body: b.body, head, jaw, legs, knees: [null, null], legPhase: [0, 0], legSide: [1, -1],
    wings, lids: b.lids, mouth: mouthAt(head, -0.1, 1.2), eatPitch: 0.7, bodyEatPitch: 0.35, legSwing: 0, bodyY: H,
  };
}

// ───────────────────────────── Stegosaurus ─────────────────────────────
function buildStegosaurus(): Rig {
  const BASE = 0x9bcf3f, BELLY = 0xfff4b5, STRIPE = 0x6faa2b, PLATE = 0xff7a3d, PLATE2 = 0xffb347, DARK = 0x78ad2c;
  const b = new DinoBuilder(1.05, 0);
  const spine: Ring[] = [
    { y: 0.8, z: -1.2, rx: 0.14, ry: 0.16 },
    { y: 1.05, z: -0.8, rx: 0.44, ry: 0.47 },
    { y: 1.38, z: -0.2, rx: 0.66, ry: 0.74 },
    { y: 1.32, z: 0.4, rx: 0.58, ry: 0.64 },
    { y: 1.02, z: 0.92, rx: 0.34, ry: 0.36 },
    { y: 0.84, z: 1.22, rx: 0.21, ry: 0.21 },
  ];
  b.addBody(tube(spine, skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 6, spots: 0xc0e86a }), 18), null);

  // plates along the back, two staggered rows; each has a paler centre
  const plates: [number, number, number][] = [
    [-0.85, 1.5, 0.3], [-0.5, 1.9, 0.44], [-0.1, 2.16, 0.54], [0.3, 2.02, 0.48], [0.65, 1.64, 0.36], [0.95, 1.32, 0.24],
  ];
  const plateGeo = () => new THREE.SphereGeometry(1, 5, 4);
  plates.forEach(([z, y, s], i) => {
    const side = i % 2 ? 1 : -1;
    b.addBody(plateGeo(), PLATE, tf(side * 0.13, y, z, 0, Math.PI / 2, side * 0.16, s * 0.8, s, 0.07), true);
    b.addBody(plateGeo(), PLATE2, tf(side * 0.13, y - s * 0.1, z, 0, Math.PI / 2, side * 0.16, s * 0.45, s * 0.6, 0.095), true);
  });

  const tail = b.pivot(b.body, 0, 0.98, -1.0);
  b.add(
    tail,
    tube(
      [
        { y: -0.12, z: -1.6, rx: 0.04, ry: 0.04 },
        { y: -0.06, z: -0.95, rx: 0.14, ry: 0.14 },
        { y: 0, z: 0.05, rx: 0.32, ry: 0.34 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 }), 12,
    ),
    null,
  );
  b.add(tail, plateGeo(), PLATE, tf(0.08, 0.36, -0.4, 0, Math.PI / 2, 0.16, 0.18, 0.22, 0.06), true);
  for (const s of [-1, 1]) {
    b.add(tail, cone(0.055, 0.46, 8), HORN, tf(s * 0.16, 0.12, -1.2, -0.3, 0, -s * 0.9));
    b.add(tail, cone(0.055, 0.44, 8), HORN, tf(s * 0.14, 0.1, -1.42, -0.3, 0, -s * 0.9));
  }

  const head = b.pivot(b.body, 0, 0.84, 1.18);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.12, rx: 0.19, ry: 0.19 },
        { y: 0.03, z: 0.2, rx: 0.25, ry: 0.23 },
        { y: -0.01, z: 0.48, rx: 0.18, ry: 0.14 },
        { y: -0.04, z: 0.66, rx: 0.08, ry: 0.06 },
      ],
      skin({ base: BASE, belly: BELLY, tip: 0xd6c27a, tipFrom: 0.9 }), 14, 5,
    ),
    null,
  );
  for (const s of [-1, 1]) {
    b.eye(head, s * 0.2, 0.1, 0.22, 0.095, s, 0x8a4b1d, DARK);
    b.add(head, sphere(0.02, 5, 4), 0x4f7d1c, tf(s * 0.05, 0.03, 0.62));
    b.add(head, sphere(0.07, 8, 6), BLUSH, tf(s * 0.21, -0.05, 0.3, 0, 0, 0, 0.4, 0.7, 1));
  }
  const jaw = b.pivot(head, 0, 0.78, 1.28);
  b.add(jaw, tube([{ y: -0.03, z: -0.02, rx: 0.14, ry: 0.07 }, { y: -0.04, z: 0.25, rx: 0.13, ry: 0.06 }, { y: -0.04, z: 0.45, rx: 0.06, ry: 0.04 }], plain(BELLY), 10, 4), null);

  const q = quadLegs(b, { fx: 0.4, fy: 0.78, fz: 0.7, rx: 0.46, ry: 1.02, rz: -0.55, r: 0.18, color: BASE, dark: DARK });
  return {
    ...base, root: b.finish(), body: b.body, head, jaw, tail, ...q, lids: b.lids,
    mouth: mouthAt(head, -0.12, 0.6), eatPitch: 0.6, bodyEatPitch: 0.05, legSwing: 0.5, bodyY: 1.05,
  };
}

// ───────────────────────────── Brachiosaurus ─────────────────────────────
function buildBrachiosaurus(): Rig {
  const BASE = 0x4f9df5, BELLY = 0xe9f6ff, STRIPE = 0x3a78d6, DARK = 0x3a7bd9;
  const b = new DinoBuilder(1.7, 0);
  const spine: Ring[] = [
    { y: 1.5, z: -1.1, rx: 0.22, ry: 0.25 },
    { y: 1.7, z: -0.55, rx: 0.62, ry: 0.64 },
    { y: 1.92, z: 0.15, rx: 0.74, ry: 0.76 },
    { y: 2.12, z: 0.72, rx: 0.54, ry: 0.57 },
    { y: 2.32, z: 0.98, rx: 0.38, ry: 0.4 },
  ];
  b.addBody(tube(spine, skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 3, spots: 0x86c1ff }), 18), null);

  const neck = b.pivot(b.body, 0, 2.2, 0.82);
  b.add(
    neck,
    tube(
      [
        { y: -0.1, z: -0.05, rx: 0.38, ry: 0.42 },
        { y: 0.55, z: 0.28, rx: 0.29, ry: 0.31 },
        { y: 1.35, z: 0.52, rx: 0.23, ry: 0.24 },
        { y: 2.1, z: 0.7, rx: 0.2, ry: 0.21 },
        { y: 2.5, z: 0.82, rx: 0.19, ry: 0.2 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 6, spots: 0x86c1ff }), 14,
    ),
    null,
  );
  // head sits on the end of the neck and moves with it
  const hy = 2.52, hz = 0.84;
  b.add(
    neck,
    tube(
      [
        { y: hy, z: hz - 0.14, rx: 0.2, ry: 0.2 },
        { y: hy + 0.05, z: hz + 0.15, rx: 0.27, ry: 0.24 },
        { y: hy - 0.01, z: hz + 0.44, rx: 0.22, ry: 0.16 },
        { y: hy - 0.04, z: hz + 0.62, rx: 0.1, ry: 0.07 },
      ],
      skin({ base: BASE, belly: BELLY }), 14, 5,
    ),
    null,
  );
  b.add(neck, sphere(0.15, 10, 8), BASE, tf(0, hy + 0.24, hz + 0.12, 0, 0, 0, 0.9, 0.8, 1.1));
  for (const s of [-1, 1]) {
    b.eye(neck, s * 0.22, hy + 0.08, hz + 0.2, 0.1, s, 0x7a4a1f, DARK);
    b.add(neck, sphere(0.022, 5, 4), 0x2a5fb0, tf(s * 0.06, hy + 0.06, hz + 0.58));
    b.add(neck, sphere(0.075, 8, 6), BLUSH, tf(s * 0.23, hy - 0.08, hz + 0.3, 0, 0, 0, 0.4, 0.7, 1));
  }
  const jaw = b.pivot(neck, 0, 2.2 + hy - 0.08, 0.82 + hz + 0.1);
  b.add(jaw, tube([{ y: -0.03, z: -0.02, rx: 0.16, ry: 0.07 }, { y: -0.04, z: 0.25, rx: 0.16, ry: 0.06 }, { y: -0.04, z: 0.46, rx: 0.07, ry: 0.04 }], plain(BELLY), 10, 4), null);

  const tail = b.pivot(b.body, 0, 1.58, -0.95);
  b.add(
    tail,
    tube(
      [
        { y: -0.6, z: -2.0, rx: 0.03, ry: 0.03 },
        { y: -0.35, z: -1.15, rx: 0.14, ry: 0.14 },
        { y: 0, z: 0.05, rx: 0.34, ry: 0.36 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 }), 12,
    ),
    null,
  );

  const q = quadLegs(b, { fx: 0.48, fy: 1.75, fz: 0.62, rx: 0.5, ry: 1.6, rz: -0.6, r: 0.22, color: BASE, dark: DARK });
  return {
    ...base, root: b.finish(), body: b.body, head: neck, jaw, tail, ...q, lids: b.lids,
    mouth: mouthAt(neck, hy - 0.15, hz + 0.6), eatPitch: 0.35, bodyEatPitch: 0.03, legSwing: 0.4, bodyY: 1.7,
  };
}

// ───────────────────────────── Plesiosaurus (swims) ─────────────────────────────
function buildPlesiosaurus(): Rig {
  const BASE = 0xff7fa8, BELLY = 0xfff0e0, STRIPE = 0xe65a8c, DARK = 0xd9507f;
  const b = new DinoBuilder(0.5, 0);
  const spine: Ring[] = [
    { y: 0.42, z: -2.0, rx: 0.03, ry: 0.03 },
    { y: 0.45, z: -1.2, rx: 0.2, ry: 0.18 },
    { y: 0.5, z: -0.3, rx: 0.66, ry: 0.46 },
    { y: 0.52, z: 0.35, rx: 0.6, ry: 0.44 },
    { y: 0.58, z: 0.85, rx: 0.36, ry: 0.34 },
  ];
  b.addBody(tube(spine, skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 5, spots: 0xffa9c6 }), 18), null);
  ridge((g, c, m) => b.addBody(g, c, m), spine, 7, 0.08, STRIPE, 0.3, 0.9);

  const neck = b.pivot(b.body, 0, 0.6, 0.75);
  b.add(
    neck,
    tube(
      [
        { y: -0.05, z: -0.05, rx: 0.34, ry: 0.33 },
        { y: 0.4, z: 0.3, rx: 0.24, ry: 0.24 },
        { y: 1.0, z: 0.5, rx: 0.18, ry: 0.19 },
        { y: 1.55, z: 0.68, rx: 0.16, ry: 0.17 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 5 }), 14,
    ),
    null,
  );
  const hy = 1.58, hz = 0.7;
  b.add(
    neck,
    tube(
      [
        { y: hy, z: hz - 0.14, rx: 0.18, ry: 0.18 },
        { y: hy + 0.05, z: hz + 0.14, rx: 0.26, ry: 0.22 },
        { y: hy, z: hz + 0.44, rx: 0.21, ry: 0.14 },
        { y: hy - 0.02, z: hz + 0.64, rx: 0.1, ry: 0.06 },
      ],
      skin({ base: BASE, belly: BELLY }), 14, 5,
    ),
    null,
  );
  for (const s of [-1, 1]) {
    b.eye(neck, s * 0.21, hy + 0.1, hz + 0.18, 0.1, s, 0x2f9fe0, DARK);
    b.add(neck, sphere(0.075, 8, 6), BLUSH, tf(s * 0.22, hy - 0.06, hz + 0.3, 0, 0, 0, 0.4, 0.7, 1));
    for (let i = 0; i < 3; i++) b.add(neck, cone(0.025, 0.07, 5), 0xffffff, tf(s * (0.15 - i * 0.03), hy - 0.12, hz + 0.36 + i * 0.09, Math.PI, 0, 0));
  }
  const jaw = b.pivot(neck, 0, 0.6 + hy - 0.07, 0.75 + hz + 0.08);
  b.add(jaw, tube([{ y: -0.03, z: -0.02, rx: 0.16, ry: 0.07 }, { y: -0.04, z: 0.28, rx: 0.16, ry: 0.06 }, { y: -0.04, z: 0.5, rx: 0.07, ry: 0.04 }], plain(BELLY), 10, 4), null);

  const legs: THREE.Group[] = [];
  const legSide: number[] = [];
  for (const [s, z, size] of [[1, 0.4, 1], [-1, 0.4, 1], [1, -0.65, 0.85], [-1, -0.65, 0.85]]) {
    const g = b.pivot(b.body, s * 0.5, 0.42, z);
    b.add(g, sphere(1, 12, 8), DARK, tf(s * 0.42 * size, -0.12, -0.1, 0, s * 0.3, -s * 0.25, 0.5 * size, 0.08, 0.3 * size));
    legs.push(g);
    legSide.push(s);
  }
  return {
    ...base, root: b.finish(), body: b.body, head: neck, jaw, legs, knees: [null, null, null, null],
    legPhase: [0, 0, Math.PI, Math.PI], legSide, lids: b.lids, swims: true,
    mouth: mouthAt(neck, hy - 0.12, hz + 0.6), eatPitch: 0.4, bodyEatPitch: 0, legSwing: 0, bodyY: 0.5,
  };
}

// ───────────────────────────── Sea turtle (swims) ─────────────────────────────
function buildTurtle(): Rig {
  const SHELL = 0x3f9a58, SHELL2 = 0x2c7a44, SKIN = 0xe8cf7a, DARK = 0xc9ae58;
  const b = new DinoBuilder(0.45, 0);
  b.addBody(sphere(1, 20, 12), SHELL, tf(0, 0.55, 0, 0, 0, 0, 0.8, 0.42, 0.95));
  b.addBody(sphere(1, 16, 8), 0xf3e2a4, tf(0, 0.42, 0, 0, 0, 0, 0.74, 0.2, 0.88));
  b.addBody(new THREE.TorusGeometry(0.86, 0.07, 6, 22), SHELL2, tf(0, 0.47, 0, Math.PI / 2, 0, 0, 0.93, 1.1, 1));
  for (const [x, z, s] of [[0, 0, 0.3], [0, 0.48, 0.22], [0, -0.5, 0.22], [0.42, 0.22, 0.2], [-0.42, 0.22, 0.2], [0.42, -0.26, 0.2], [-0.42, -0.26, 0.2]]) {
    const y = 0.55 + 0.4 * Math.sqrt(Math.max(0, 1 - (x / 0.8) ** 2 - (z / 0.95) ** 2));
    b.addBody(new THREE.SphereGeometry(1, 6, 4), SHELL2, tf(x, y, z, x * -0.5, 0, x * -0.6, s, 0.04, s), true);
  }
  b.addBody(cone(0.08, 0.3, 6), SKIN, tf(0, 0.42, -0.98, -Math.PI / 2, 0, 0));

  const head = b.pivot(b.body, 0, 0.5, 0.82);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.2, rx: 0.16, ry: 0.15 },
        { y: 0.08, z: 0.2, rx: 0.18, ry: 0.17 },
        { y: 0.14, z: 0.48, rx: 0.25, ry: 0.22 },
        { y: 0.12, z: 0.74, rx: 0.14, ry: 0.11 },
      ],
      skin({ base: SKIN, belly: 0xfff6d2, spots: 0xb99a45 }), 14, 5,
    ),
    null,
  );
  for (const s of [-1, 1]) {
    b.eye(head, s * 0.2, 0.22, 0.46, 0.095, s, 0x3a2a1a, DARK);
    b.add(head, sphere(0.06, 8, 6), BLUSH, tf(s * 0.21, 0.08, 0.56, 0, 0, 0, 0.4, 0.7, 1));
  }
  const legs: THREE.Group[] = [];
  const legSide: number[] = [];
  for (const [s, z, size] of [[1, 0.5, 1], [-1, 0.5, 1], [1, -0.6, 0.6], [-1, -0.6, 0.6]]) {
    const g = b.pivot(b.body, s * 0.6, 0.42, z);
    b.add(g, sphere(1, 12, 8), SKIN, tf(s * 0.4 * size, -0.05, 0.05, 0, s * 0.35, -s * 0.15, 0.48 * size, 0.08, 0.27 * size));
    legs.push(g);
    legSide.push(s);
  }
  return {
    ...base, root: b.finish(), body: b.body, head, legs, knees: [null, null, null, null],
    legPhase: [0, Math.PI, Math.PI, 0], legSide, lids: b.lids, swims: true,
    mouth: mouthAt(head, 0.02, 0.75), eatPitch: 0.3, bodyEatPitch: 0, legSwing: 0, bodyY: 0.45,
  };
}

const land = { flies: false, swims: false };
export const SPECIES: Record<SpeciesId, Species> = {
  triceratops: {
    ...land, id: 'triceratops', name: 'Triceratops', say: 'try-SAIR-uh-tops',
    food: 'Herbivore: I only eat plants', foodIcon: '🌿', fact: 'I have three horns!',
    color: '#2fb7a6', eggSpots: 0x2fb7a6, speed: 7.5, radius: 1.2, height: 1.9, voice: 1.1,
    build: buildTriceratops,
  },
  trex: {
    ...land, id: 'trex', name: 'T-Rex', say: 'TEE-rex',
    food: 'Carnivore: I eat meat', foodIcon: '🍖', fact: 'I have a very big ROAR!',
    color: '#f0623a', eggSpots: 0xf0623a, speed: 8.5, radius: 1.1, height: 2.9, voice: 0.7,
    build: buildTRex,
  },
  pteranodon: {
    ...land, id: 'pteranodon', name: 'Pterodactyl', say: 'terra-DAK-til',
    food: 'I eat fish', foodIcon: '🐟', fact: 'I can fly up high!',
    color: '#9a5cf0', eggSpots: 0x9a5cf0, speed: 10, radius: 0.9, height: 2.2, flies: true, voice: 2.2,
    build: buildPteranodon,
  },
  stegosaurus: {
    ...land, id: 'stegosaurus', name: 'Stegosaurus', say: 'steg-oh-SORE-us',
    food: 'Herbivore: I only eat plants', foodIcon: '🌿', fact: 'I have plates on my back!',
    color: '#9bcf3f', eggSpots: 0x9bcf3f, speed: 6, radius: 1.3, height: 2.2, voice: 0.9,
    build: buildStegosaurus,
  },
  brachiosaurus: {
    ...land, id: 'brachiosaurus', name: 'Brachiosaurus', say: 'BRAK-ee-oh-SORE-us',
    food: 'Herbivore: I eat treetop leaves', foodIcon: '🍃', fact: 'My neck is super long!',
    color: '#4f9df5', eggSpots: 0x4f9df5, speed: 5, radius: 1.5, height: 4.6, voice: 0.5,
    build: buildBrachiosaurus,
  },
  plesiosaurus: {
    ...land, id: 'plesiosaurus', name: 'Plesiosaurus', say: 'PLEE-see-oh-SORE-us',
    food: 'I eat fish', foodIcon: '🐟', fact: 'I love to swim!',
    color: '#ff7fa8', eggSpots: 0xff7fa8, speed: 5, radius: 1.4, height: 2.2, swims: true, voice: 1.4,
    build: buildPlesiosaurus,
  },
  turtle: {
    ...land, id: 'turtle', name: 'Sea Turtle', say: 'SEE TUR-tul',
    food: 'I eat sea plants', foodIcon: '🌿', fact: 'My shell is my house!',
    color: '#3f9a58', eggSpots: 0x3f9a58, speed: 3.5, radius: 1.0, height: 1.0, swims: true, voice: 1.8,
    build: buildTurtle,
  },
};

export const PLAYABLE: SpeciesId[] = ['triceratops', 'trex', 'pteranodon'];
export const ALL_SPECIES = Object.keys(SPECIES) as SpeciesId[];
/** Species that can hatch from nest eggs (land babies only). */
export const HATCHABLE: SpeciesId[] = ['triceratops', 'stegosaurus', 'trex', 'brachiosaurus', 'pteranodon'];

/** Speckled egg for the given species. */
export function buildEgg(spots: Col): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI;
    pts.push(new THREE.Vector2(Math.sin(a) * (0.64 - 0.16 * t), -Math.cos(a) * 0.82));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  g.translate(0, 0.82, 0);
  const p = g.getAttribute('position');
  const cream = new THREE.Color(0xfff6e2);
  const spot = new THREE.Color(spots);
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const s = Math.sin(x * 7.1 + y * 3.3) * Math.sin(y * 6.3 + 1.7) * Math.sin(z * 7.7 + x * 2.1);
    c.copy(cream).lerp(spot, s > 0.22 ? 1 : 0);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.castShadow = true;
  return m;
}

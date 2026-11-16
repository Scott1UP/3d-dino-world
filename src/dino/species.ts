// The dinosaurs. Every model is generated in code: organic tubes for bodies, simple shapes for the rest.
// All dinos face +Z with their feet on y = 0.
import * as THREE from 'three';
import { Col, cone, cylBetween, flatPoly, plain, skin, sphere, tf, tube } from '../geo';
import { DinoBuilder, Rig } from './rig';

export type SpeciesId = 'triceratops' | 'trex' | 'pteranodon' | 'stegosaurus' | 'brachiosaurus';

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
  /** roar pitch multiplier */
  voice: number;
  build: () => Rig;
}

const HORN = 0xfff3d6;
const CLAW = 0xf6ecd8;

/** Chunky one-piece leg hanging down from its pivot. */
function leg(b: DinoBuilder, g: THREE.Group, len: number, r: number, color: Col, toes: Col) {
  b.add(g, sphere(r * 1.25, 10, 8), color, tf(0, -r * 0.2, 0, 0, 0, 0, 1, 1.25, 1.15));
  b.add(g, cylBetween([0, -r * 0.3, 0], [0, -len + r * 0.5, 0], r * 1.05, r * 0.82, 9), color);
  b.add(g, sphere(r, 10, 6), color, tf(0, -len + r * 0.42, r * 0.22, 0, 0, 0, 1.05, 0.5, 1.3));
  for (const x of [-0.55, 0, 0.55]) {
    b.add(g, sphere(r * 0.3, 6, 5), toes, tf(x * r, -len + r * 0.22, r * 1.35 - Math.abs(x) * r * 0.3));
  }
}

function quadLegs(
  b: DinoBuilder,
  o: { fx: number; fy: number; fz: number; rx: number; ry: number; rz: number; r: number; color: Col },
) {
  const legs: THREE.Group[] = [];
  for (const [x, y, z] of [
    [o.fx, o.fy, o.fz],
    [-o.fx, o.fy, o.fz],
    [o.rx, o.ry, o.rz],
    [-o.rx, o.ry, o.rz],
  ]) {
    const g = b.pivot(b.root, x, y, z);
    leg(b, g, y, o.r, o.color, CLAW);
    legs.push(g);
  }
  return { legs, legPhase: [0, Math.PI, Math.PI, 0] };
}

function mouthAt(head: THREE.Group, y: number, z: number): THREE.Object3D {
  const m = new THREE.Object3D();
  m.position.set(0, y, z);
  head.add(m);
  return m;
}

// ───────────────────────────── Triceratops ─────────────────────────────
function buildTriceratops(): Rig {
  const BASE = 0x2fb7a6, BELLY = 0xf9e9b8, STRIPE = 0x1c8f8a, FRILL = 0xff9a3c;
  const b = new DinoBuilder(1.05, 0);
  const sk = skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 5 });

  b.addBody(
    tube(
      [
        { y: 1.0, z: -1.15, rx: 0.2, ry: 0.22 },
        { y: 1.1, z: -0.75, rx: 0.52, ry: 0.52 },
        { y: 1.2, z: -0.2, rx: 0.7, ry: 0.68 },
        { y: 1.2, z: 0.4, rx: 0.68, ry: 0.64 },
        { y: 1.13, z: 0.85, rx: 0.48, ry: 0.48 },
        { y: 1.08, z: 1.15, rx: 0.32, ry: 0.34 },
      ],
      sk, 14,
    ),
    null,
  );

  const tail = b.pivot(b.body, 0, 1.05, -0.85);
  b.add(
    tail,
    tube(
      [
        { y: -0.32, z: -1.45, rx: 0.03, ry: 0.03 },
        { y: -0.2, z: -1.0, rx: 0.13, ry: 0.13 },
        { y: -0.08, z: -0.5, rx: 0.26, ry: 0.26 },
        { y: 0, z: 0.05, rx: 0.4, ry: 0.4 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 }), 10,
    ),
    null,
  );

  const head = b.pivot(b.body, 0, 1.12, 1.05);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.2, rx: 0.3, ry: 0.3 },
        { y: 0.04, z: 0.2, rx: 0.42, ry: 0.4 },
        { y: 0, z: 0.55, rx: 0.33, ry: 0.3 },
        { y: -0.08, z: 0.85, rx: 0.2, ry: 0.19 },
        { y: -0.17, z: 1.02, rx: 0.07, ry: 0.07 },
      ],
      skin({ base: BASE, belly: BELLY, tip: 0xffd15c, tipFrom: 0.84 }), 12,
    ),
    null,
  );
  // frill + studs
  const frillM = tf(0, 0.38, -0.14, -0.42, 0, 0);
  b.add(head, sphere(1, 16, 10), FRILL, frillM.clone().multiply(tf(0, 0, 0, 0, 0, 0, 0.9, 0.82, 0.1)));
  b.add(head, sphere(1, 14, 8), 0xffc978, frillM.clone().multiply(tf(0, -0.02, 0.07, 0, 0, 0, 0.62, 0.56, 0.06)));
  for (let i = 0; i < 9; i++) {
    const a = -1.75 + (i / 8) * 3.5;
    b.add(
      head, cone(0.09, 0.2, 5), HORN,
      frillM.clone().multiply(tf(Math.sin(a) * 0.88, Math.cos(a) * 0.8, 0, 0, 0, -a)),
    );
  }
  // horns
  for (const s of [-1, 1]) {
    b.add(head, cone(0.09, 0.72, 7), HORN, tf(s * 0.22, 0.6, 0.42, 0.75, 0, -s * 0.18));
    b.eye(head, s * 0.33, 0.1, 0.42, 0.12, s);
    b.add(head, sphere(0.03, 5, 4), 0x146e6a, tf(s * 0.09, -0.04, 0.93));
  }
  b.add(head, cone(0.08, 0.3, 7), HORN, tf(0, 0.25, 0.74, 0.45, 0, 0));

  const jaw = b.pivot(head, 0, 0.98, 1.3);
  b.add(
    jaw,
    tube(
      [
        { y: -0.04, z: -0.05, rx: 0.2, ry: 0.11 },
        { y: -0.06, z: 0.3, rx: 0.21, ry: 0.1 },
        { y: -0.07, z: 0.58, rx: 0.1, ry: 0.06 },
      ],
      plain(BELLY), 8, 3,
    ),
    null,
  );

  const q = quadLegs(b, { fx: 0.44, fy: 0.95, fz: 0.62, rx: 0.48, ry: 1.0, rz: -0.6, r: 0.21, color: BASE });
  return {
    root: b.finish(), body: b.body, head, jaw, tail, ...q, wings: [],
    mouth: mouthAt(head, -0.25, 0.95), eatPitch: 0.75, bodyEatPitch: 0.06, legSwing: 0.55, bodyY: 1.05,
  };
}

// ───────────────────────────── T-Rex ─────────────────────────────
function buildTRex(): Rig {
  const BASE = 0xf0623a, BELLY = 0xffe2a8, STRIPE = 0xb93a2a;
  const b = new DinoBuilder(1.55, -0.05);
  const sk = skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 });

  b.addBody(
    tube(
      [
        { y: 1.45, z: -0.6, rx: 0.3, ry: 0.34 },
        { y: 1.6, z: -0.15, rx: 0.52, ry: 0.56 },
        { y: 1.82, z: 0.38, rx: 0.54, ry: 0.58 },
        { y: 2.08, z: 0.8, rx: 0.4, ry: 0.44 },
        { y: 2.32, z: 1.08, rx: 0.3, ry: 0.32 },
      ],
      sk, 14,
    ),
    null,
  );

  const tail = b.pivot(b.body, 0, 1.5, -0.45);
  b.add(
    tail,
    tube(
      [
        { y: 0.2, z: -2.3, rx: 0.03, ry: 0.03 },
        { y: 0.12, z: -1.55, rx: 0.14, ry: 0.15 },
        { y: 0.04, z: -0.8, rx: 0.27, ry: 0.3 },
        { y: 0, z: 0.05, rx: 0.4, ry: 0.44 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 6 }), 10,
    ),
    null,
  );

  const head = b.pivot(b.body, 0, 2.36, 1.02);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.32, rx: 0.26, ry: 0.28 },
        { y: 0.1, z: 0.0, rx: 0.42, ry: 0.36 },
        { y: 0.08, z: 0.42, rx: 0.37, ry: 0.29 },
        { y: 0.03, z: 0.78, rx: 0.31, ry: 0.23 },
        { y: 0, z: 1.02, rx: 0.2, ry: 0.14 },
        { y: -0.02, z: 1.08, rx: 0.08, ry: 0.06 },
      ],
      skin({ base: BASE, belly: 0xf6a36a }), 12,
    ),
    null,
  );
  for (const s of [-1, 1]) {
    b.eye(head, s * 0.33, 0.22, 0.14, 0.13, s);
    b.add(head, sphere(0.16, 8, 6), STRIPE, tf(s * 0.3, 0.4, 0.08, 0, 0, 0, 0.9, 0.5, 1.4));
    b.add(head, sphere(0.035, 5, 4), 0x6b1f18, tf(s * 0.12, 0.13, 1.0));
    for (let i = 0; i < 5; i++) {
      b.add(head, cone(0.045, 0.13, 5), 0xffffff, tf(s * (0.3 - i * 0.03), -0.2, 0.3 + i * 0.15, Math.PI, 0, 0));
    }
  }
  b.add(head, cone(0.045, 0.12, 5), 0xffffff, tf(0.07, -0.13, 1.0, Math.PI, 0, 0));
  b.add(head, cone(0.045, 0.12, 5), 0xffffff, tf(-0.07, -0.13, 1.0, Math.PI, 0, 0));

  const jaw = b.pivot(head, 0, 2.2, 0.95);
  b.add(
    jaw,
    tube(
      [
        { y: -0.04, z: -0.1, rx: 0.3, ry: 0.15 },
        { y: -0.1, z: 0.35, rx: 0.31, ry: 0.13 },
        { y: -0.09, z: 0.8, rx: 0.25, ry: 0.11 },
        { y: -0.06, z: 1.02, rx: 0.1, ry: 0.05 },
      ],
      plain(BELLY), 10, 4,
    ),
    null,
  );
  b.add(jaw, sphere(0.2, 8, 6), 0xff7f8e, tf(0, -0.02, 0.5, 0, 0, 0, 0.9, 0.3, 2));

  // tiny arms
  for (const s of [-1, 1]) {
    b.addBody(cylBetween([s * 0.4, 1.9, 0.72], [s * 0.44, 1.62, 0.92], 0.09, 0.07), BASE);
    b.addBody(cylBetween([s * 0.44, 1.62, 0.92], [s * 0.42, 1.55, 1.14], 0.07, 0.05), BASE);
    b.addBody(cone(0.035, 0.12, 5), CLAW, tf(s * 0.39, 1.53, 1.2, 1.9, 0, 0));
    b.addBody(cone(0.035, 0.12, 5), CLAW, tf(s * 0.46, 1.53, 1.2, 1.9, 0, 0));
  }

  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = b.pivot(b.root, s * 0.42, 1.55, -0.05);
    b.add(g, sphere(1, 10, 8), BASE, tf(0, -0.28, 0.05, -0.25, 0, 0, 0.3, 0.55, 0.42));
    b.add(g, cylBetween([0, -0.55, 0.18], [0, -1.15, -0.12], 0.2, 0.13), BASE);
    b.add(g, cylBetween([0, -1.12, -0.12], [0, -1.45, 0.05], 0.13, 0.12), BASE);
    b.add(g, sphere(1, 10, 6), BASE, tf(0, -1.46, 0.22, 0, 0, 0, 0.24, 0.1, 0.38));
    for (const x of [-0.14, 0, 0.14]) b.add(g, cone(0.05, 0.16, 5), CLAW, tf(x, -1.49, 0.6, 1.57, 0, 0));
    legs.push(g);
  }

  return {
    root: b.finish(), body: b.body, head, jaw, tail, legs, legPhase: [0, Math.PI], wings: [],
    mouth: mouthAt(head, -0.3, 0.9), eatPitch: 0.45, bodyEatPitch: 0.55, legSwing: 0.6, bodyY: 1.55,
  };
}

// ───────────────────────────── Pteranodon ─────────────────────────────
function buildPteranodon(): Rig {
  const BASE = 0x9a5cf0, BELLY = 0xf3e3ff, WING = 0xffc23d, BEAK = 0xffb020, CREST = 0xff5e7e;
  const H = 1.25;
  const b = new DinoBuilder(H, 0);

  b.addBody(
    tube(
      [
        { y: H - 0.05, z: -0.75, rx: 0.04, ry: 0.04 },
        { y: H, z: -0.35, rx: 0.2, ry: 0.2 },
        { y: H, z: 0.12, rx: 0.28, ry: 0.28 },
        { y: H + 0.06, z: 0.48, rx: 0.18, ry: 0.19 },
        { y: H + 0.2, z: 0.76, rx: 0.12, ry: 0.13 },
      ],
      skin({ base: BASE, belly: BELLY }), 10,
    ),
    null,
  );

  const head = b.pivot(b.body, 0, H + 0.22, 0.72);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.14, rx: 0.13, ry: 0.14 },
        { y: 0.05, z: 0.12, rx: 0.2, ry: 0.2 },
        { y: 0.02, z: 0.38, rx: 0.14, ry: 0.13 },
      ],
      skin({ base: BASE, belly: BELLY }), 10, 4,
    ),
    null,
  );
  b.add(head, cone(0.115, 1.0, 7), BEAK, tf(0, 0.02, 0.84, Math.PI / 2 + 0.06, 0, 0, 1, 1, 0.6));
  b.add(head, cone(0.12, 0.95, 6), CREST, tf(0, 0.36, -0.36, -1.05, 0, 0, 0.45, 1, 1));
  for (const s of [-1, 1]) b.eye(head, s * 0.15, 0.1, 0.2, 0.085, s);

  const jaw = b.pivot(head, 0, H + 0.2, 1.0);
  b.add(jaw, cone(0.085, 0.82, 6), 0xe89510, tf(0, -0.05, 0.42, Math.PI / 2, 0, 0, 1, 1, 0.4));

  const wings: Rig['wings'] = [];
  for (const s of [-1, 1]) {
    const inner = b.pivot(b.body, s * 0.2, H + 0.08, 0.1);
    b.add(inner, flatPoly([[0, 0, 0.36], [s * 1.15, 0, 0.3], [s * 1.15, 0, -0.38], [0, 0, -0.5]]), WING);
    b.add(inner, cylBetween([0, 0, 0.34], [s * 1.15, 0, 0.3], 0.07, 0.05, 6), BASE);
    const outer = b.pivot(inner, s * 1.35, H + 0.08, 0.1);
    b.add(outer, flatPoly([[0, 0, 0.2], [s * 1.5, 0, -0.25], [0, 0, -0.48]]), WING);
    b.add(outer, cylBetween([0, 0, 0.2], [s * 1.5, 0, -0.25], 0.05, 0.015, 6), BASE);
    wings.push({ inner, outer, side: s });
  }

  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = b.pivot(b.body, s * 0.13, H - 0.12, -0.3);
    b.add(g, cylBetween([0, 0, 0], [0, -0.42, 0], 0.05, 0.035, 6), BASE);
    b.add(g, sphere(0.07, 6, 5), BEAK, tf(0, -0.45, 0.04, 0, 0, 0, 1, 0.6, 1.6));
    legs.push(g);
  }

  return {
    root: b.finish(), body: b.body, head, jaw, tail: null, legs, legPhase: [0, 0], wings,
    mouth: mouthAt(head, -0.1, 1.2), eatPitch: 0.7, bodyEatPitch: 0.35, legSwing: 0, bodyY: H,
  };
}

// ───────────────────────────── Stegosaurus ─────────────────────────────
function buildStegosaurus(): Rig {
  const BASE = 0x9bcf3f, BELLY = 0xfff4b5, STRIPE = 0x6faa2b, PLATE = 0xff7a3d;
  const b = new DinoBuilder(1.05, 0);
  const spine = [
    { y: 0.8, z: -1.2, rx: 0.14, ry: 0.16 },
    { y: 1.05, z: -0.8, rx: 0.42, ry: 0.45 },
    { y: 1.38, z: -0.2, rx: 0.64, ry: 0.72 },
    { y: 1.32, z: 0.4, rx: 0.56, ry: 0.62 },
    { y: 1.02, z: 0.92, rx: 0.33, ry: 0.35 },
    { y: 0.84, z: 1.22, rx: 0.2, ry: 0.2 },
  ];
  b.addBody(tube(spine, skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 6 }), 14), null);

  // plates along the back, two staggered rows
  const plates: [number, number, number][] = [
    [-0.85, 1.5, 0.3], [-0.5, 1.9, 0.44], [-0.1, 2.14, 0.52], [0.3, 2.0, 0.46], [0.65, 1.62, 0.34], [0.95, 1.3, 0.22],
  ];
  plates.forEach(([z, y, s], i) => {
    const side = i % 2 ? 1 : -1;
    b.addBody(new THREE.OctahedronGeometry(1), PLATE, tf(side * 0.12, y, z, 0, 0, side * 0.16, 0.07, s, s * 0.8), true);
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
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 }), 10,
    ),
    null,
  );
  b.add(tail, new THREE.OctahedronGeometry(1), PLATE, tf(0.08, 0.35, -0.4, 0, 0, 0.16, 0.06, 0.22, 0.18), true);
  for (const s of [-1, 1]) {
    b.add(tail, cone(0.05, 0.42, 6), HORN, tf(s * 0.16, 0.12, -1.2, -0.3, 0, -s * 0.9));
    b.add(tail, cone(0.05, 0.4, 6), HORN, tf(s * 0.14, 0.1, -1.42, -0.3, 0, -s * 0.9));
  }

  const head = b.pivot(b.body, 0, 0.84, 1.18);
  b.add(
    head,
    tube(
      [
        { y: 0, z: -0.12, rx: 0.18, ry: 0.18 },
        { y: 0.03, z: 0.2, rx: 0.23, ry: 0.21 },
        { y: -0.02, z: 0.48, rx: 0.16, ry: 0.13 },
        { y: -0.05, z: 0.64, rx: 0.07, ry: 0.06 },
      ],
      skin({ base: BASE, belly: BELLY, tip: 0xd6c27a, tipFrom: 0.88 }), 10, 4,
    ),
    null,
  );
  for (const s of [-1, 1]) b.eye(head, s * 0.19, 0.1, 0.22, 0.085, s);

  const q = quadLegs(b, { fx: 0.4, fy: 0.78, fz: 0.7, rx: 0.46, ry: 1.02, rz: -0.55, r: 0.19, color: BASE });
  return {
    root: b.finish(), body: b.body, head, jaw: null, tail, ...q, wings: [],
    mouth: mouthAt(head, -0.12, 0.6), eatPitch: 0.6, bodyEatPitch: 0.05, legSwing: 0.5, bodyY: 1.05,
  };
}

// ───────────────────────────── Brachiosaurus ─────────────────────────────
function buildBrachiosaurus(): Rig {
  const BASE = 0x4f9df5, BELLY = 0xe9f6ff, STRIPE = 0x3a78d6;
  const b = new DinoBuilder(1.7, 0);
  b.addBody(
    tube(
      [
        { y: 1.5, z: -1.1, rx: 0.22, ry: 0.25 },
        { y: 1.7, z: -0.55, rx: 0.6, ry: 0.62 },
        { y: 1.92, z: 0.15, rx: 0.72, ry: 0.74 },
        { y: 2.12, z: 0.72, rx: 0.52, ry: 0.55 },
        { y: 2.32, z: 0.98, rx: 0.36, ry: 0.38 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 3 }), 14,
    ),
    null,
  );

  const neck = b.pivot(b.body, 0, 2.2, 0.82);
  b.add(
    neck,
    tube(
      [
        { y: -0.1, z: -0.05, rx: 0.36, ry: 0.4 },
        { y: 0.55, z: 0.28, rx: 0.28, ry: 0.3 },
        { y: 1.35, z: 0.52, rx: 0.22, ry: 0.23 },
        { y: 2.1, z: 0.7, rx: 0.19, ry: 0.2 },
        { y: 2.5, z: 0.82, rx: 0.18, ry: 0.19 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 6 }), 10,
    ),
    null,
  );
  // head sits on the end of the neck and moves with it
  const hy = 2.52, hz = 0.84;
  b.add(
    neck,
    tube(
      [
        { y: hy, z: hz - 0.14, rx: 0.19, ry: 0.19 },
        { y: hy + 0.05, z: hz + 0.15, rx: 0.25, ry: 0.22 },
        { y: hy - 0.02, z: hz + 0.44, rx: 0.2, ry: 0.15 },
        { y: hy - 0.05, z: hz + 0.6, rx: 0.09, ry: 0.07 },
      ],
      skin({ base: BASE, belly: BELLY }), 10, 4,
    ),
    null,
  );
  b.add(neck, sphere(0.14, 8, 6), BASE, tf(0, hy + 0.22, hz + 0.12, 0, 0, 0, 0.9, 0.8, 1.1));
  for (const s of [-1, 1]) b.eye(neck, s * 0.2, hy + 0.08, hz + 0.2, 0.09, s);

  const tail = b.pivot(b.body, 0, 1.58, -0.95);
  b.add(
    tail,
    tube(
      [
        { y: -0.6, z: -2.0, rx: 0.03, ry: 0.03 },
        { y: -0.35, z: -1.15, rx: 0.14, ry: 0.14 },
        { y: 0, z: 0.05, rx: 0.34, ry: 0.36 },
      ],
      skin({ base: BASE, belly: BELLY, stripe: STRIPE, stripes: 4 }), 10,
    ),
    null,
  );

  const q = quadLegs(b, { fx: 0.48, fy: 1.75, fz: 0.62, rx: 0.5, ry: 1.6, rz: -0.6, r: 0.23, color: BASE });
  return {
    root: b.finish(), body: b.body, head: neck, jaw: null, tail, ...q, wings: [],
    mouth: mouthAt(neck, hy - 0.15, hz + 0.6), eatPitch: 0.35, bodyEatPitch: 0.03, legSwing: 0.4, bodyY: 1.7,
  };
}

export const SPECIES: Record<SpeciesId, Species> = {
  triceratops: {
    id: 'triceratops', name: 'Triceratops', say: 'try-SAIR-uh-tops',
    food: 'I eat plants', foodIcon: '🌿', fact: 'I have three horns!',
    color: '#2fb7a6', eggSpots: 0x2fb7a6, speed: 7.5, radius: 1.2, height: 1.9, flies: false, voice: 1.1,
    build: buildTriceratops,
  },
  trex: {
    id: 'trex', name: 'T-Rex', say: 'TEE-rex',
    food: 'I eat meat', foodIcon: '🍖', fact: 'I have a very big ROAR!',
    color: '#f0623a', eggSpots: 0xf0623a, speed: 8.5, radius: 1.1, height: 2.9, flies: false, voice: 0.7,
    build: buildTRex,
  },
  pteranodon: {
    id: 'pteranodon', name: 'Pterodactyl', say: 'terra-DAK-til',
    food: 'I eat fish', foodIcon: '🐟', fact: 'I can fly up high!',
    color: '#9a5cf0', eggSpots: 0x9a5cf0, speed: 10, radius: 0.9, height: 2.2, flies: true, voice: 2.2,
    build: buildPteranodon,
  },
  stegosaurus: {
    id: 'stegosaurus', name: 'Stegosaurus', say: 'steg-oh-SORE-us',
    food: 'I eat plants', foodIcon: '🌿', fact: 'I have plates on my back!',
    color: '#9bcf3f', eggSpots: 0x9bcf3f, speed: 6, radius: 1.3, height: 2.2, flies: false, voice: 0.9,
    build: buildStegosaurus,
  },
  brachiosaurus: {
    id: 'brachiosaurus', name: 'Brachiosaurus', say: 'BRAK-ee-oh-SORE-us',
    food: 'I eat leaves', foodIcon: '🍃', fact: 'My neck is super long!',
    color: '#4f9df5', eggSpots: 0x4f9df5, speed: 5, radius: 1.5, height: 4.6, flies: false, voice: 0.5,
    build: buildBrachiosaurus,
  },
};

export const PLAYABLE: SpeciesId[] = ['triceratops', 'trex', 'pteranodon'];
export const ALL_SPECIES = Object.keys(SPECIES) as SpeciesId[];

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
  const base = new THREE.Color(0xfff6e2);
  const spot = new THREE.Color(spots);
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const s = Math.sin(x * 7.1 + y * 3.3) * Math.sin(y * 6.3 + 1.7) * Math.sin(z * 7.7 + x * 2.1);
    c.copy(base).lerp(spot, s > 0.22 ? 1 : 0);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.castShadow = true;
  return m;
}

// The game itself: world setup, the player, camera, interactions and the state machine behind the menus.
import * as THREE from 'three';
import { buildEgg, PLAYABLE, SPECIES, SpeciesId } from '../dino/species';
import { blob, Bucket, cone, tf } from '../geo';
import { damp, mulberry32, smoothstep, wrapAngle } from '../util';
import { Collider, createProps, Props } from '../world/props';
import { canWalk, createSky, createTerrain, createWater, heightAt, Water } from '../world/terrain';
import { Sfx } from './audio';
import { Dino, Npc } from './dino';
import { createFoods, Food, FOOD_INFO } from './food';
import { Input, isTouch } from './input';
import { Particles } from './particles';
import { renderPortraits } from './portraits';
import { Ui } from './ui';

type State = 'title' | 'select' | 'hatch' | 'play' | 'card' | 'book' | 'pause';

interface Nest {
  x: number;
  z: number;
  y: number;
  egg: THREE.Mesh | null;
  species: SpeciesId;
  regrow: number;
}

type Target =
  | { type: 'food'; food: Food; x: number; z: number; top: number }
  | { type: 'npc'; npc: Npc; x: number; z: number; top: number }
  | { type: 'nest'; nest: Nest; x: number; z: number; top: number };

const SPAWN = { x: 0, z: 0 };
const NEST_SPOTS: [number, number][] = [[-14, 16], [30, 8], [-30, -34], [52, 52], [-66, -8]];
const MAX_BABIES = 4;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1600);
  private last = performance.now();
  private sun: THREE.DirectionalLight;
  private water: Water;
  private props: Props;
  private particles: Particles;
  private foods: Food[];
  private npcs: Npc[] = [];
  private babies: Npc[] = [];
  private nests: Nest[] = [];
  private pops: { obj: THREE.Object3D; scale: number; t: number }[] = [];
  private marker: THREE.Mesh;

  private sfx = new Sfx();
  private input: Input;
  private ui: Ui;

  private state: State = 'title';
  private t = 0;
  private player: Dino | null = null;
  private target: Target | null = null;
  private met = new Set<SpeciesId>();
  private cardSpecies: SpeciesId = 'trex';

  private camYaw = 0;
  private look = new THREE.Vector3();
  private jumpY = 0;
  private jumpV = 0;
  private hover = 0;
  private eatT = 0;
  private eatFood: Food | null = null;
  private roarT = 0;
  private fxT = 0;
  private wasInWater = false;

  private hatchT = 0;
  private hatchEgg: THREE.Mesh | null = null;
  private hatchSpecies: SpeciesId = 'trex';
  private hatched = false;

  private mouth = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;

    const scene = this.scene;
    scene.fog = new THREE.Fog(0xd4eefb, 150, 620);
    scene.add(createSky());
    scene.add(new THREE.HemisphereLight(0xdcf1ff, 0x9fb86a, 1.9));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0cf, 2.3));
    sun.castShadow = true;
    const sm = isTouch ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -42;
    sc.right = sc.top = 42;
    sc.near = 1;
    sc.far = 220;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    scene.add(createTerrain());
    this.water = createWater();
    scene.add(this.water.mesh);

    const sp = this.findSpot(SPAWN.x, SPAWN.z, []);
    SPAWN.x = sp.x;
    SPAWN.z = sp.z;
    const avoid: Collider[] = [{ x: SPAWN.x, z: SPAWN.z, r: 9 }];
    for (const [x, z] of NEST_SPOTS) avoid.push({ x, z, r: 2.5 });
    this.props = createProps(scene, avoid);
    this.particles = new Particles(scene);
    this.foods = createFoods(scene, this.props.colliders, mulberry32(77));
    this.spawnNpcs();
    this.buildNests();

    this.marker = new THREE.Mesh(cone(0.38, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0xffd21f, toneMapped: false }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    scene.add(this.marker);

    this.ui = new Ui(renderPortraits(), {
      play: () => this.setState('select'),
      pick: (id) => this.startHatch(id),
      pause: () => this.pause(),
      resume: () => this.closeOverlay(),
      changeDino: () => {
        this.ui.overlay('none');
        this.ui.hud(false);
        this.setState('select');
      },
      toggleSound: () => {
        this.sfx.enabled = !this.sfx.enabled;
        if (!this.sfx.enabled) this.sfx.hush();
        return this.sfx.enabled;
      },
      openBook: () => {
        if (this.state !== 'play') return;
        this.state = 'book';
        this.ui.book(this.met);
      },
      closeOverlay: () => this.closeOverlay(),
      speakCard: () => this.speakCard(),
      tap: () => this.sfx.tap(),
    });
    this.input = new Input(document.getElementById('ui')!);
    this.input.onAction = () => this.action();
    this.input.onPause = () => (this.state === 'pause' ? this.closeOverlay() : this.pause());

    window.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.sfx.unlock(), { capture: true });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    this.resize();
    this.setState('title');
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ───────────────────────── setup ─────────────────────────

  private findSpot(x: number, z: number, colliders: Collider[], minH = 1.2): { x: number; z: number } {
    for (let i = 0; i < 400; i++) {
      const a = i * 2.4, r = Math.sqrt(i) * 1.6;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const h = heightAt(px, pz);
      if (h < minH || h > 6 || !canWalk(px, pz)) continue;
      if (colliders.some((c) => Math.hypot(px - c.x, pz - c.z) < c.r + 2.5)) continue;
      return { x: px, z: pz };
    }
    return { x, z };
  }

  private spawnNpcs() {
    const add = (id: SpeciesId, scale: number, x: number, z: number, range = 22) => {
      const p = this.findSpot(x, z, this.props.colliders);
      const n = new Npc(SPECIES[id], scale, p.x, p.z);
      n.range = range;
      this.scene.add(n.root);
      this.npcs.push(n);
      return n;
    };
    add('triceratops', 1.0, 24, 20);
    add('triceratops', 0.55, 28, 25, 12);
    add('stegosaurus', 1.15, -8, -26);
    add('stegosaurus', 0.9, 66, -6);
    add('trex', 1.3, 40, -52);
    add('trex', 0.8, -52, -44, 16);
    add('brachiosaurus', 2.1, -22, 52, 18);
    add('brachiosaurus', 1.6, 62, 34, 18);
    add('pteranodon', 1.1, 26, 74, 16);
    add('pteranodon', 0.9, -70, 24, 14);
    for (let i = 0; i < 3; i++) {
      const n = new Npc(SPECIES.pteranodon, 2.2, 0, 0);
      n.mode = 'sky';
      n.homeX = [-20, 40, 0][i];
      n.homeZ = [10, -30, 40][i];
      n.skyR = 55 + i * 22;
      n.skyY = 34 + i * 9;
      this.scene.add(n.root);
      this.npcs.push(n);
    }
  }

  private buildNests() {
    const b = new Bucket();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      b.add(blob(0.42, 0, 0.25, i), i % 2 ? 0x9a6b3c : 0x7d5530, tf(Math.cos(a) * 1.0, 0.18, Math.sin(a) * 1.0, 0, -a, 0, 1.3, 0.7, 0.8), true);
    }
    b.add(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 10), 0xc9a45e, tf(0, 0.12, 0));
    const geo = b.geometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    NEST_SPOTS.forEach(([x, z], i) => {
      const p = this.findSpot(x, z, this.props.colliders);
      const y = heightAt(p.x, p.z);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, y, p.z);
      m.castShadow = true;
      this.scene.add(m);
      const nest: Nest = { x: p.x, z: p.z, y, egg: null, species: PLAYABLE[i % 3], regrow: 0 };
      this.nests.push(nest);
      this.layEgg(nest, i);
    });
  }

  private layEgg(n: Nest, i = Math.floor(Math.random() * 5)) {
    const ids: SpeciesId[] = ['triceratops', 'stegosaurus', 'trex', 'brachiosaurus', 'pteranodon'];
    n.species = ids[i % ids.length];
    n.egg = buildEgg(SPECIES[n.species].eggSpots);
    n.egg.position.set(n.x, n.y + 0.15, n.z);
    this.scene.add(n.egg);
    this.pops.push({ obj: n.egg, scale: 0.9, t: 0 });
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep a similar view in portrait
    this.camera.fov = w < h ? 68 : 55;
    this.camera.updateProjectionMatrix();
  }

  // ───────────────────────── states ─────────────────────────

  private setState(s: State) {
    this.state = s;
    if (s === 'title') this.ui.screen('title');
    if (s === 'select') {
      this.ui.screen('select');
      this.marker.visible = false;
    }
  }

  private pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.input.reset();
    this.ui.overlay('pause');
  }

  private closeOverlay() {
    if (this.state !== 'card' && this.state !== 'book' && this.state !== 'pause') return;
    this.sfx.hush();
    this.ui.overlay('none');
    this.state = 'play';
  }

  private startHatch(id: SpeciesId) {
    // clear any previous run
    if (this.player) this.scene.remove(this.player.root);
    for (const b of this.babies) this.scene.remove(b.root);
    this.babies = [];
    this.player = null;
    this.target = null;
    this.ui.screen('none');
    this.hatchSpecies = id;
    this.hatchT = 0;
    this.hatched = false;
    const egg = (this.hatchEgg = buildEgg(SPECIES[id].eggSpots));
    egg.scale.setScalar(1.5);
    egg.position.set(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
    this.scene.add(egg);
    this.camera.position.set(SPAWN.x + 4, egg.position.y + 3.2, SPAWN.z + 7.5);
    this.look.set(SPAWN.x, egg.position.y + 1.3, SPAWN.z);
    this.state = 'hatch';
  }

  private updateHatch(dt: number) {
    const before = this.hatchT;
    this.hatchT += dt;
    const T = this.hatchT;
    const egg = this.hatchEgg;
    const crossed = (x: number) => before < x && T >= x;
    if (egg) {
      const k = Math.min(1, T / 1.7);
      egg.rotation.z = Math.sin(T * (10 + k * 16)) * 0.22 * k;
      egg.position.y = heightAt(SPAWN.x, SPAWN.z) + Math.abs(Math.sin(T * 9)) * 0.25 * k;
      if (crossed(0.5) || crossed(1.0) || crossed(1.4)) {
        this.sfx.crack();
        this.particles.burst(this.v.copy(egg.position).setY(egg.position.y + 1.2), 6, [0xfff6e2], { speed: 3, up: 3, size: 0.12 });
      }
    }
    if (!this.hatched && T >= 1.8) {
      this.hatched = true;
      const s = SPECIES[this.hatchSpecies];
      if (egg) {
        this.particles.burst(this.v.copy(egg.position).setY(egg.position.y + 1), 46, [0xfff6e2, 0xffffff, s.eggSpots as number], {
          speed: 8, up: 8, size: 0.3, life: 1.1, spread: 1,
        });
        this.scene.remove(egg);
        this.hatchEgg = null;
      }
      const p = (this.player = new Dino(s));
      p.x = SPAWN.x;
      p.z = SPAWN.z;
      p.heading = 0.35;
      p.y = p.groundY();
      p.anim.hop = 1;
      this.scene.add(p.root);
      this.pops.push({ obj: p.root, scale: 1, t: 0 });
      this.sfx.pop();
      this.sfx.fanfare();
      this.sfx.speak(`${s.name}!`);
      this.ui.toast(`You are a ${s.name}!`, 2600);
      this.jumpY = this.jumpV = this.eatT = this.roarT = 0;
      this.hover = s.flies ? 0.5 : 0;
    }
    const p = this.player;
    if (p) {
      p.lift = this.hover;
      if (T > 2.5 && T < 3.3) p.anim.roaring = true;
      else p.anim.roaring = false;
      if (crossed(2.5)) this.sfx.roar(p.species.voice);
      p.sync(dt);
    }
    // slow push-in on the egg
    const base = heightAt(SPAWN.x, SPAWN.z);
    this.v.set(SPAWN.x + 3.2, base + 2.6 + (p ? p.species.height * 0.3 : 0), SPAWN.z + 6.5 + (p ? p.species.height : 0));
    this.camera.position.lerp(this.v, damp(1.5, dt));
    this.v.set(SPAWN.x, base + (p ? p.species.height * 0.6 : 1.2), SPAWN.z);
    this.look.lerp(this.v, damp(4, dt));
    this.camera.lookAt(this.look);

    if (T > 3.6 && p) {
      const d = this.v.copy(this.camera.position).sub(p.root.position);
      this.camYaw = Math.atan2(-d.x, -d.z);
      this.state = 'play';
      this.ui.hud(true);
      this.ui.bookCount(this.met);
      this.input.moved = false;
    }
  }

  // ───────────────────────── play ─────────────────────────

  private action() {
    if (this.state === 'card' || this.state === 'book') return this.closeOverlay();
    const p = this.player;
    if (this.state !== 'play' || !p || this.eatT > 0) return;
    const t = this.target;
    if (!t) {
      if (this.roarT > 0.3) return;
      this.roarT = 0.9;
      this.sfx.roar(p.species.voice);
      p.mouthWorld(this.v);
      this.particles.burst(this.v, 16, [0xffffff, 0xffe27a], { speed: 9, up: 1.5, size: 0.16, life: 0.5, gravity: 2 });
      for (const n of this.npcs) {
        if (n.mode !== 'sky' && Math.hypot(n.x - p.x, n.z - p.z) < 20) n.anim.hop = 1;
      }
      for (const b of this.babies) b.anim.hop = 1;
      return;
    }
    if (t.type === 'food') {
      this.eatT = 1.25;
      this.eatFood = t.food;
      p.anim.eating = true;
      this.sfx.chomp();
      this.sfx.yum();
    } else if (t.type === 'npc') {
      const s = t.npc.species;
      t.npc.anim.hop = 1;
      p.anim.hop = 1;
      this.sfx.hello();
      const isNew = !this.met.has(s.id);
      this.met.add(s.id);
      this.ui.bookCount(this.met);
      this.cardSpecies = s.id;
      this.state = 'card';
      this.input.reset();
      this.ui.card(s.id);
      this.speakCard();
      if (isNew) this.particles.burst(this.v.set(t.x, t.top, t.z), 24, [0xffd21f, 0xffffff, 0xff8fc0], { speed: 5, up: 7, size: 0.2 });
    } else {
      this.hatchNest(t.nest);
    }
  }

  private speakCard() {
    const s = SPECIES[this.cardSpecies];
    this.sfx.speak(`${s.name}. ${s.fact} ${s.food}.`);
  }

  private hatchNest(n: Nest) {
    if (!n.egg || !this.player) return;
    const s = SPECIES[n.species];
    this.sfx.crack();
    this.sfx.pop();
    this.particles.burst(this.v.set(n.x, n.y + 1, n.z), 30, [0xfff6e2, 0xffffff, s.eggSpots as number], { speed: 6, up: 7, size: 0.22, life: 1 });
    this.scene.remove(n.egg);
    n.egg = null;
    n.regrow = 40;
    const baby = new Npc(s, 0.36, n.x, n.z);
    baby.mode = 'follow';
    baby.leader = this.babies[this.babies.length - 1] ?? this.player;
    baby.anim.hop = 1;
    this.scene.add(baby.root);
    this.pops.push({ obj: baby.root, scale: 0.36, t: 0 });
    this.babies.push(baby);
    if (this.babies.length > MAX_BABIES) {
      const old = this.babies.shift()!;
      this.scene.remove(old.root);
      this.babies[0].leader = this.player;
    }
    this.ui.toast(`A baby ${s.name}!`);
    this.sfx.speak(`A baby ${s.name}!`);
  }

  private updatePlayer(dt: number) {
    const p = this.player!;
    const inp = this.input;
    inp.update();
    if (inp.moved) this.ui.hideHint();
    const busy = this.eatT > 0;
    const mag = busy ? 0 : Math.hypot(inp.x, inp.y);

    if (mag > 0) {
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      const mx = fx * inp.y - fz * inp.x;
      const mz = fz * inp.y + fx * inp.x;
      p.turnToward(Math.atan2(mx, mz), 10, dt);
      const sp = p.species.speed * dt;
      let nx = p.x + mx * sp, nz = p.z + mz * sp;
      // slide around trees, rocks and other dinos
      const pr = p.radius * 0.55;
      for (const c of this.props.colliders) {
        const dx = nx - c.x, dz = nz - c.z;
        const d = Math.hypot(dx, dz), min = c.r + pr;
        if (d < min && d > 0.0001) {
          nx = c.x + (dx / d) * min;
          nz = c.z + (dz / d) * min;
        }
      }
      for (const n of this.npcs) {
        if (n.mode !== 'wander') continue;
        const dx = nx - n.x, dz = nz - n.z;
        const d = Math.hypot(dx, dz), min = n.radius * 0.7 + pr;
        if (d < min && d > 0.0001) {
          nx = n.x + (dx / d) * min;
          nz = n.z + (dz / d) * min;
        }
      }
      if (canWalk(nx, nz)) {
        p.x = nx;
        p.z = nz;
      } else if (canWalk(nx, p.z)) p.x = nx;
      else if (canWalk(p.x, nz)) p.z = nz;
    }
    p.anim.move = mag;
    p.y = p.groundY();

    // bouncing + hovering
    if (this.jumpY > 0 || this.jumpV > 0) {
      this.jumpV -= 30 * dt;
      this.jumpY = Math.max(0, this.jumpY + this.jumpV * dt);
      if (this.jumpY === 0) {
        this.jumpV = 0;
        this.particles.burst(this.v.set(p.x, p.y + 0.2, p.z), 10, [0xe8dcb8, 0xffffff], { speed: 4, up: 2, size: 0.18, life: 0.5 });
      }
    }
    const hoverT = p.species.flies ? (busy ? 0.15 : 0.55 + mag * 1.1) : 0;
    this.hover += (hoverT - this.hover) * damp(4, dt);
    p.lift = this.hover + this.jumpY;

    for (const m of this.props.mushrooms) {
      if (this.jumpY < 0.4 && this.jumpV <= 0 && Math.hypot(p.x - m.x, p.z - m.z) < 1.7 + p.radius * 0.4) {
        this.jumpV = 15;
        this.jumpY = 0.01;
        m.squash = 1;
        this.sfx.boing();
        this.particles.burst(this.v.set(m.x, p.y + 1.4, m.z), 14, [0xff4d5e, 0xffffff, 0xffd21f], { speed: 5, up: 6, size: 0.18 });
      }
    }

    // splashes + dust
    const h = heightAt(p.x, p.z);
    const inWater = h < -0.08 && p.lift < 0.7;
    if (inWater && !this.wasInWater) this.sfx.splash();
    this.wasInWater = inWater;
    this.fxT -= dt;
    if (mag > 0.3 && this.fxT <= 0 && p.lift < 0.7) {
      this.fxT = 0.13;
      if (inWater) this.particles.burst(this.v.set(p.x, 0.1, p.z), 5, [0xffffff, 0xbfeaff, 0x7fd0f5], { speed: 3, up: 5, size: 0.14, life: 0.6, spread: 0.8 });
      else if (h < 1.3) this.particles.burst(this.v.set(p.x, p.y + 0.1, p.z), 2, [0xf3deA0, 0xfff1c9], { speed: 1.5, up: 2, size: 0.12, life: 0.5, spread: 0.6 });
    }

    // eating
    if (this.eatT > 0) {
      const before = this.eatT;
      this.eatT -= dt;
      const f = this.eatFood;
      if (f) {
        p.turnToward(Math.atan2(f.x - p.x, f.z - p.z), 12, dt);
        if (before > 1.0 && this.eatT <= 1.0) f.eat();
        if (this.eatT < 0.7 && Math.random() < 0.5) {
          this.particles.burst(this.mouth, 1, FOOD_INFO[f.kind].crumbs, { speed: 2.5, up: 2.5, size: 0.09, life: 0.5 });
        }
      }
      if (this.eatT <= 0) {
        p.anim.eating = false;
        p.anim.hop = 1;
        if (f) {
          const info = FOOD_INFO[f.kind];
          this.ui.toast(`Yum! ${info.icon}`, 1500);
          this.particles.burst(this.v.copy(this.mouth).setY(this.mouth.y + 0.6), 18, [0xffd21f, 0xffffff, 0xff8fc0], { speed: 4, up: 6, size: 0.16 });
        }
        this.eatFood = null;
      }
    }
    if (this.roarT > 0) this.roarT -= dt;
    p.anim.roaring = this.roarT > 0.25;
    p.sync(dt);
  }

  private findTarget() {
    const p = this.player!;
    let best: Target | null = null;
    let bestScore = 0;
    const consider = (t: Target, range: number) => {
      const score = Math.hypot(t.x - p.x, t.z - p.z) - range;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    };
    for (const f of this.foods) {
      if (f.available) consider({ type: 'food', food: f, x: f.x, z: f.z, top: f.mesh.position.y + 1.5 }, p.radius + 2.6);
    }
    for (const n of this.npcs) {
      if (n.mode === 'wander') {
        consider({ type: 'npc', npc: n, x: n.x, z: n.z, top: n.y + n.lift + n.species.height * n.scale + 0.9 }, p.radius + n.radius + 3.4);
      }
    }
    for (const n of this.nests) {
      if (n.egg) consider({ type: 'nest', nest: n, x: n.x, z: n.z, top: n.y + 2.4 }, p.radius + 2.8);
    }
    this.target = best as Target | null;
    const t = this.target;
    if (!t) {
      this.ui.setAction('roar', '🦖', 'Roar!');
      this.marker.visible = false;
    } else {
      if (t.type === 'food') this.ui.setAction('eat', FOOD_INFO[t.food.kind].icon, 'Eat!');
      else if (t.type === 'npc') this.ui.setAction('hello', '👋', 'Hello!');
      else this.ui.setAction('egg', '🥚', 'Hatch!');
      this.marker.visible = this.eatT <= 0;
      this.marker.position.set(t.x, t.top + Math.abs(Math.sin(this.t * 5)) * 0.5, t.z);
      this.marker.rotation.y = this.t * 3;
    }
  }

  private updateCamera(dt: number) {
    const p = this.player!;
    const hgt = p.species.height;
    if (this.state === 'play' && p.anim.move > 0.1) {
      const diff = wrapAngle(p.heading - this.camYaw);
      const k = 1 - smoothstep(1.7, 2.7, Math.abs(diff));
      this.camYaw += diff * damp(1.5, dt) * k;
    }
    const dist = 5 + hgt * 1.8;
    let cx = p.x - Math.sin(this.camYaw) * dist;
    let cz = p.z - Math.cos(this.camYaw) * dist;
    // keep the camera out of tree trunks and boulders
    for (const c of this.props.colliders) {
      const dx = cx - c.x, dz = cz - c.z;
      const d = Math.hypot(dx, dz), min = c.r + 2.4;
      if (d < min && d > 0.0001) {
        cx = c.x + (dx / d) * min;
        cz = c.z + (dz / d) * min;
      }
    }
    const cy = Math.max(p.y + p.lift * 0.6 + 2.2 + hgt * 0.85, heightAt(cx, cz) + 1.5, 1.2);
    this.camera.position.lerp(this.v.set(cx, cy, cz), damp(5, dt));
    this.look.lerp(this.v.set(p.x, p.y + p.lift * 0.7 + hgt * 0.75, p.z), damp(9, dt));
    this.camera.lookAt(this.look);
  }

  // ───────────────────────── frame ─────────────────────────

  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const s = this.state;
    const live = s !== 'pause';
    if (live) {
      this.t += dt;
      const t = this.t;
      this.water.update(t);
      this.props.update(t, dt);
      this.particles.update(dt);
      const p = this.player;
      if (p) p.mouthWorld(this.mouth);
      for (const f of this.foods) f.update(t, dt, this.mouth);
      const frozen = s === 'card' || s === 'book';
      for (const n of this.npcs) n.update(dt, s === 'play' || frozen ? p : null, this.props.colliders, frozen);
      for (const b of this.babies) b.update(dt, p, this.props.colliders, false);
      for (const n of this.nests) {
        if (!n.egg && (n.regrow -= dt) <= 0) this.layEgg(n);
        if (n.egg) n.egg.rotation.z = Math.sin(t * 3 + n.x) * 0.06;
      }
      for (let i = this.pops.length - 1; i >= 0; i--) {
        const o = this.pops[i];
        o.t = Math.min(1, o.t + dt * 2.2);
        const k = o.t;
        o.obj.scale.setScalar(Math.max(0.001, o.scale * (k + Math.sin(k * Math.PI) * 0.35)));
        if (k >= 1) this.pops.splice(i, 1);
      }

      if (s === 'title' || s === 'select') {
        const a = t * 0.07 + 0.6;
        this.camera.position.set(Math.sin(a) * 46, 15 + Math.sin(t * 0.2) * 2, Math.cos(a) * 46);
        this.look.set(0, 4, 0);
        this.camera.lookAt(this.look);
      } else if (s === 'hatch') {
        this.updateHatch(dt);
      } else if (p) {
        if (s === 'play') {
          this.updatePlayer(dt);
          this.findTarget();
        } else {
          p.anim.move = 0;
          p.sync(dt);
        }
        this.updateCamera(dt);
      }
    }

    // sun + shadows follow the action
    const f = this.player ? this.player.root.position : this.look;
    this.sun.position.set(f.x + 45, f.y + 70, f.z + 30);
    this.sun.target.position.copy(f);
    this.renderer.render(this.scene, this.camera);
  }
}

// The game itself: world setup, the player, camera, interactions and the state machine behind the menus.
import * as THREE from 'three';
import { buildEgg, HATCHABLE, SPECIES, SpeciesId } from '../dino/species';
import { blob, Bucket, cone, tf } from '../geo';
import { damp, mulberry32, smoothstep, wrapAngle } from '../util';
import { createCritters, Critters } from '../world/critters';
import { Caves, createCaves } from '../world/caves';
import { BONE_SITES, Collider, createProps, Props } from '../world/props';
import { canWalk, caveRoof, createSky, createTerrain, createWater, heightAt, Water } from '../world/terrain';
import { Sfx, VoiceLine } from './audio';
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
const NEST_SPOTS: [number, number][] = [
  [-14, 16], [30, 8], [-30, -34], [52, 52], [-66, -8], [112, 10], [-112, 40], [20, -112], [-60, 104], [84, 92],
  [8, -30], [-34, 58], [62, -14], [-8, 84], [-84, -52], [88, -92], [34, 96], [-124, -8], [-22, -78], [136, 54],
  [60, 20], [-48, -4],
];
const MAX_BABIES = 4;
/** bouncy mushroom cap: radius and height of the top above the ground */
const CAP_R = 1.56;
const CAP_TOP = 1.8;
/** Growing up: hatch small, eat to grow. `need` = foods to reach the next size. */
const STAGES = [
  { scale: 0.5, need: 3 },
  { scale: 0.95, need: 6 },
  // full size matches the grown-up dinosaurs wandering the island
  { scale: 1.4, need: 0 },
];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2400);
  private last = performance.now();
  private sun: THREE.DirectionalLight;
  private water: Water;
  private props: Props;
  private critters: Critters;
  private caves: Caves;
  private hemi: THREE.HemisphereLight;
  private caveK = 0;
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
  private stage = 0;
  /** pterodactyl only: extra altitude from holding the Fly button */
  private flyY = 0;
  private flyV = 0;
  private flying = false;
  /** triceratops only: head-down dash */
  private chargeT = 0;
  private chargeCool = 0;
  /** how many mushroom bounces in a row (each one goes higher) */
  private bounces = 0;
  private eaten = 0;
  private growT = 1;
  private growFrom = 1;

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
    scene.fog = new THREE.Fog(0xd4eefb, 170, 760);
    scene.add(createSky());
    scene.add((this.hemi = new THREE.HemisphereLight(0xdcf1ff, 0x9fb86a, 1.9)));
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
    for (const [x, z, , size] of BONE_SITES) avoid.push({ x, z, r: 8 * size });
    this.props = createProps(scene, avoid);
    this.caves = createCaves(scene, this.props.colliders);
    // a surprise egg waits deep inside the first cave
    NEST_SPOTS.push([this.caves.chambers[0].x, this.caves.chambers[0].z]);
    this.particles = new Particles(scene);
    this.foods = createFoods(scene, this.props.colliders, mulberry32(77));
    this.critters = createCritters(scene, this.particles, mulberry32(5));
    this.spawnNpcs();
    this.buildNests();

    this.marker = new THREE.Mesh(cone(0.38, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0xffd21f, toneMapped: false }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    scene.add(this.marker);

    this.ui = new Ui(renderPortraits(), {
      play: () => this.setState('select'),
      pick: (id) => this.startHatch(id),
      preview: (id) => this.sfx.say(`name.${id}` as VoiceLine),
      pause: () => this.pause(),
      resume: () => this.closeOverlay(),
      changeDino: () => {
        this.ui.overlay('none');
        this.ui.hud(false);
        this.setState('select');
      },
      toggleSound: () => {
        this.sfx.setEnabled(!this.sfx.enabled);
        return this.sfx.enabled;
      },
      toggleMusic: () => {
        this.sfx.setMusic(!this.sfx.musicOn);
        return this.sfx.musicOn;
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
      this.sfx.suspend(document.hidden);
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
      // the big three should feel properly big next to a growing player
      const big = id === 'stegosaurus' || id === 'trex' || id === 'triceratops' ? 1.4 : 1;
      const n = new Npc(SPECIES[id], scale * big, p.x, p.z);
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
    // the wider island
    add('triceratops', 1.2, -108, 30);
    add('triceratops', 0.7, 96, 78, 16);
    add('stegosaurus', 1.3, 118, 8);
    add('stegosaurus', 0.7, -52, 108, 16);
    add('trex', 1.1, 30, -118);
    add('trex', 0.6, -118, -20, 14);
    add('brachiosaurus', 2.3, -70, -100, 18);
    add('brachiosaurus', 1.3, 126, -22, 16);
    add('pteranodon', 1.0, -22, 122, 16);
    // swimmers stay in the lakes and the shallows
    const swim = (id: SpeciesId, scale: number, x: number, z: number, range: number) => {
      // nudge the start point into properly deep water
      for (let i = 0; i < 300 && (heightAt(x, z) > -0.9 || heightAt(x, z) < -3); i++) {
        x += Math.cos(i * 2.4) * Math.sqrt(i) * 0.6;
        z += Math.sin(i * 2.4) * Math.sqrt(i) * 0.6;
      }
      const n = new Npc(SPECIES[id], scale, x, z);
      n.range = range;
      this.scene.add(n.root);
      this.npcs.push(n);
    };
    swim('plesiosaurus', 1.25, -38, 14, 15);
    swim('turtle', 0.9, -32, 6, 14);
    swim('turtle', 0.6, -44, 20, 12);
    swim('plesiosaurus', 0.8, 100, -58, 13);
    swim('turtle', 1.0, 96, -52, 12);
    swim('turtle', 0.8, -104, -72, 10);
    swim('plesiosaurus', 1.5, 6, 152, 16);
    swim('turtle', 1.1, -14, 146, 16);
    for (let i = 0; i < 3; i++) {
      const n = new Npc(SPECIES.pteranodon, 2.2, 0, 0);
      n.mode = 'sky';
      n.homeX = [-20, 40, 0][i];
      n.homeZ = [10, -30, 40][i];
      n.skyR = 60 + i * 34;
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
      const nest: Nest = { x: p.x, z: p.z, y, egg: null, species: HATCHABLE[i % HATCHABLE.length], regrow: 0 };
      this.nests.push(nest);
      this.layEgg(nest, i);
    });
  }

  private layEgg(n: Nest, i = Math.floor(Math.random() * 5)) {
    n.species = HATCHABLE[i % HATCHABLE.length];
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
      this.stage = 0;
      this.eaten = 0;
      this.growT = 1;
      const p = (this.player = new Dino(s, STAGES[0].scale));
      p.x = SPAWN.x;
      p.z = SPAWN.z;
      p.heading = 0.35;
      p.y = p.groundY();
      p.anim.hop = 1;
      this.scene.add(p.root);
      this.pops.push({ obj: p.root, scale: p.scale, t: 0 });
      this.sfx.pop();
      this.sfx.fanfare();
      this.sfx.say(`hatch.${s.id}` as VoiceLine);
      this.ui.toast(`You are a baby ${s.name}!`, 2600);
      this.jumpY = this.jumpV = this.eatT = this.flyY = this.flyV = 0;
      this.roarT = 0;
      this.flying = false;
      this.chargeT = this.chargeCool = this.bounces = 0;
      this.hover = s.flies ? 0.5 : 0;
    }
    const p = this.player;
    if (p) {
      p.lift = this.hover;
      if (crossed(2.5)) this.roarT = this.sfx.roar(p.species.voice, p.species.id === 'trex');
      if (this.roarT > 0) this.roarT -= dt;
      p.anim.roaring = this.roarT > 0.25;
      p.sync(dt);
    }
    // slow push-in on the egg
    const base = heightAt(SPAWN.x, SPAWN.z);
    const ph = p ? p.species.height * p.scale : 0;
    this.v.set(SPAWN.x + 3.2, base + 2.2 + ph * 0.3, SPAWN.z + 5.2 + ph);
    this.camera.position.lerp(this.v, damp(1.5, dt));
    this.v.set(SPAWN.x, base + (p ? ph * 0.6 : 1.2), SPAWN.z);
    this.look.lerp(this.v, damp(4, dt));
    this.camera.lookAt(this.look);

    if (T > 3.6 && p) {
      const d = this.v.copy(this.camera.position).sub(p.root.position);
      this.camYaw = Math.atan2(-d.x, -d.z);
      this.state = 'play';
      this.ui.hud(true);
      this.ui.bookCount(this.met);
      this.ui.grow(this.stage, this.eaten, STAGES[this.stage].need);
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
      if (p.species.flies) {
        // hold to climb; let go to float back down
        this.flying = true;
        this.sfx.flap(0.8);
        return;
      }
      if (p.species.id === 'triceratops') {
        if (this.chargeCool > 0) return;
        this.chargeT = 0.85;
        this.chargeCool = 1.5;
        this.sfx.charge();
        return;
      }
      if (this.roarT > 0.3) return;
      // the roar pose lasts exactly as long as the sound
      this.roarT = this.sfx.roar(p.species.voice, p.species.id === 'trex');
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
    this.sfx.say(`card.${s.id}` as VoiceLine);
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
    const baby = new Npc(s, 0.3, n.x, n.z);
    baby.mode = 'follow';
    baby.leader = this.babies[this.babies.length - 1] ?? this.player;
    baby.anim.hop = 1;
    this.scene.add(baby.root);
    this.pops.push({ obj: baby.root, scale: 0.3, t: 0 });
    this.babies.push(baby);
    if (this.babies.length > MAX_BABIES) {
      const old = this.babies.shift()!;
      this.scene.remove(old.root);
      this.babies[0].leader = this.player;
    }
    this.ui.toast(`A baby ${s.name}!`);
    this.sfx.say(`baby.${s.id}` as VoiceLine);
  }

  private updatePlayer(dt: number) {
    const p = this.player!;
    const inp = this.input;
    inp.update();
    if (inp.moved) this.ui.hideHint();
    const busy = this.eatT > 0;
    let mag = busy ? 0 : Math.hypot(inp.x, inp.y);
    const charging = this.chargeT > 0 && !busy;
    if (this.chargeT > 0) this.chargeT -= dt;
    if (this.chargeCool > 0) this.chargeCool -= dt;
    p.anim.charging = charging;

    if (mag > 0 || charging) {
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      let mx = fx * inp.y - fz * inp.x;
      let mz = fz * inp.y + fx * inp.x;
      let boost = 1;
      if (charging) {
        // dash straight ahead (the stick can still steer a little)
        if (mag > 0) p.turnToward(Math.atan2(mx, mz), 3, dt);
        mx = Math.sin(p.heading);
        mz = Math.cos(p.heading);
        mag = 1;
        boost = 2.7;
        if (Math.random() < 0.7) {
          this.particles.burst(this.v.set(p.x - mx, p.y + 0.2, p.z - mz), 2, [0xe8dcb8, 0xffffff, 0xcdbb8a], { speed: 3, up: 3, size: 0.22, life: 0.6, spread: 1 });
        }
        // friends jump out of the way
        for (const n of this.npcs) {
          if (n.mode === 'wander' && n.anim.hop === 0 && Math.hypot(n.x - p.x, n.z - p.z) < n.radius + p.radius + 3) n.anim.hop = 1;
        }
      } else p.turnToward(Math.atan2(mx, mz), 10, dt);
      const sp = p.species.speed * (0.7 + 0.3 * p.scale) * boost * dt;
      let nx = p.x + mx * sp, nz = p.z + mz * sp;
      // slide around trees, rocks and other dinos
      const pr = p.radius * 0.55;
      // high in the sky there is nothing to bump into
      for (const c of this.flyY > 7 ? [] : this.props.colliders) {
        const dx = nx - c.x, dz = nz - c.z;
        const d = Math.hypot(dx, dz), min = c.r + pr;
        if (d < min && d > 0.0001) {
          nx = c.x + (dx / d) * min;
          nz = c.z + (dz / d) * min;
        }
      }
      for (const n of this.npcs) {
        if (n.mode !== 'wander' || this.flyY > 5) continue;
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
    p.anim.move = this.flying ? 1 : mag;
    p.y = p.groundY();

    // bouncing + hovering
    // Mushrooms are springy platforms: the ground "rises" over the cap so feet land on top of it,
    // and each bounce in a row goes higher.
    let floor = 0;
    let cap: (typeof this.props.mushrooms)[number] | null = null;
    if (this.flyY < 2) {
      for (const m of this.props.mushrooms) {
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d > CAP_R + 1.1) continue;
        floor = Math.max(floor, CAP_TOP * (1 - smoothstep(CAP_R * 0.75, CAP_R + 1.1, d)));
        if (d < CAP_R * 0.9) cap = m;
      }
    }
    const bounce = () => {
      this.jumpV = [15, 20, 25][Math.min(this.bounces, 2)];
      this.bounces++;
      this.jumpY = floor + 0.01;
      cap!.squash = 1;
      this.sfx.boing(this.bounces);
      this.particles.burst(this.v.set(cap!.x, p.y + CAP_TOP + 0.2, cap!.z), 10 + this.bounces * 6, [0xff4d5e, 0xffffff, 0xffd21f], { speed: 4 + this.bounces, up: 6, size: 0.18 });
    };
    if (this.jumpY > floor || this.jumpV > 0) {
      this.jumpV -= 30 * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= floor) {
        this.jumpY = floor;
        if (cap) bounce();
        else {
          this.jumpV = 0;
          this.bounces = 0;
          if (floor === 0) this.particles.burst(this.v.set(p.x, p.y + 0.2, p.z), 10, [0xe8dcb8, 0xffffff], { speed: 4, up: 2, size: 0.18, life: 0.5 });
        }
      }
    } else {
      this.jumpY = floor;
      if (cap) bounce();
      else if (floor === 0) this.bounces = 0;
    }
    const hoverT = p.species.flies ? (busy ? 0.15 : 0.55 + mag * 1.1) : 0;
    this.hover += (hoverT - this.hover) * damp(4, dt);
    if (p.species.flies) {
      if (this.flying && !this.input.held) this.flying = false;
      // climb while held, hang at the top, then drift down gently
      const target = this.flying ? (this.flyY < 15 ? 8 : 0) : this.flyY > 0 ? -2.6 : 0;
      this.flyV += (target - this.flyV) * damp(this.flying ? 4 : 2, dt);
      // stay under the ceiling inside a cave
      const roof = caveRoof(p.x, p.z);
      const maxFly = roof === null ? 16 : Math.max(0, roof - p.y - 3.2);
      this.flyY = Math.min(maxFly, Math.max(0, this.flyY + this.flyV * dt));
      if (this.flyY === 0 && !this.flying) this.flyV = 0;
    }
    p.lift = this.hover + this.jumpY + this.flyY;

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
          if (!this.ate()) this.ui.toast(`Yum! ${info.icon}`, 1500);
          this.particles.burst(this.v.copy(this.mouth).setY(this.mouth.y + 0.6), 18, [0xffd21f, 0xffffff, 0xff8fc0], { speed: 4, up: 6, size: 0.16 });
        }
        this.eatFood = null;
      }
    }
    if (this.roarT > 0) this.roarT -= dt;
    p.anim.roaring = this.roarT > 0.25;
    // growing up: a bouncy swell to the new size
    if (this.growT < 1) {
      this.growT = Math.min(1, this.growT + dt * 1.1);
      const k = this.growT;
      const to = STAGES[this.stage].scale;
      p.setScale(this.growFrom + (to - this.growFrom) * (k + Math.sin(k * Math.PI * 3) * 0.18 * (1 - k)));
      if (Math.random() < 0.6) {
        this.particles.burst(this.v.set(p.x, p.y + p.species.height * p.scale * 0.6, p.z), 2, [0xffd21f, 0xffffff, 0x8be04a], { speed: 5, up: 6, size: 0.2, life: 0.8, spread: 1.5 });
      }
    }
    p.sync(dt);
    if (p.anim.stepped) this.sfx.step(0.9, p.scale * p.species.height * 0.5, inWater);
    if (p.anim.flapped) this.sfx.flap(0.45);
  }

  /** Count a meal towards growing up. Returns true if the player just grew. */
  private ate(): boolean {
    const p = this.player!;
    const st = STAGES[this.stage];
    if (!st.need) return false;
    this.eaten++;
    if (this.eaten < st.need) {
      this.ui.grow(this.stage, this.eaten, st.need);
      return false;
    }
    this.stage++;
    this.eaten = 0;
    this.growFrom = p.scale;
    this.growT = 0;
    p.anim.hop = 1;
    this.sfx.grow();
    const done = !STAGES[this.stage].need;
    const msg = done ? `You are a BIG ${p.species.name}!` : 'You got bigger!';
    this.ui.toast(`${msg} ⭐`, 3000);
    this.sfx.say(done ? (`grow.big.${p.species.id}` as VoiceLine) : 'grow.bigger');
    this.ui.grow(this.stage, 0, STAGES[this.stage].need);
    this.particles.burst(this.v.set(p.x, p.y + 1, p.z), 40, [0xffd21f, 0xffffff, 0x8be04a, 0xff8fc0], { speed: 7, up: 9, size: 0.24, life: 1.1, spread: 1 });
    return true;
  }

  private findTarget() {
    const p = this.player!;
    if (p.species.flies && this.flyY > 1.5) {
      // up in the air: nothing to reach, the button just keeps you flying
      this.target = null;
      this.marker.visible = false;
      this.ui.setAction('fly', '☁️', 'Fly!');
      return;
    }
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
      if (p.species.flies) this.ui.setAction('fly', '☁️', 'Fly!');
      else if (p.species.id === 'triceratops') this.ui.setAction('charge', '💨', 'Charge!');
      else this.ui.setAction('roar', '🦖', 'Roar!');
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
    const hgt = p.species.height * p.scale;
    if (this.state === 'play' && p.anim.move > 0.1) {
      const diff = wrapAngle(p.heading - this.camYaw);
      const k = 1 - smoothstep(1.7, 2.7, Math.abs(diff));
      this.camYaw += diff * damp(1.5, dt) * k;
    }
    const dist = 4.2 + hgt * 2;
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
    // in tight spots (cave walls) pull the camera in towards the player instead of lifting it over the rock
    for (let k = 1; k <= 6 && heightAt(cx, cz) > p.y + 3.5; k++) {
      cx = p.x + (cx - p.x) * 0.8;
      cz = p.z + (cz - p.z) * 0.8;
    }
    let cy = Math.max(p.y + p.lift * 0.92 + 1.7 + hgt * 0.95, heightAt(cx, cz) + 1.5, 1.2);
    const roof = caveRoof(cx, cz);
    if (roof !== null) cy = Math.min(cy, roof - 1.2);
    // caves are dim, echoey places
    const inCave = caveRoof(p.x, p.z) !== null;
    this.caveK += ((inCave ? 1 : 0) - this.caveK) * damp(2.5, dt);
    this.hemi.intensity = 1.9 - 0.85 * this.caveK;
    this.sun.intensity = 2.3 - 1.2 * this.caveK;
    this.sfx.setCave(inCave);
    this.camera.position.lerp(this.v.set(cx, cy, cz), damp(5, dt));
    this.look.lerp(this.v.set(p.x, p.y + p.lift * 0.82 + hgt * 0.75, p.z), damp(9, dt));
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
      this.caves.update(t);
      this.particles.update(dt);
      const p = this.player;
      if (p) p.mouthWorld(this.mouth);
      // "ears": sounds get quieter with distance from the player (or the camera on the menus)
      const ex = p ? p.x : this.camera.position.x, ez = p ? p.z : this.camera.position.z;
      const hear = (x: number, z: number, range: number) => (p ? Math.max(0, 1 - Math.hypot(x - ex, z - ez) / range) : 0);
      for (const f of this.foods) f.update(t, dt, this.mouth, Math.hypot(f.x - ex, f.z - ez) < 110);
      this.critters.update(t, dt, (x, z) => this.sfx.plop(hear(x, z, 30)));
      const frozen = s === 'card' || s === 'book';
      for (const n of this.npcs) {
        // far-away dinos are skipped entirely; only close ones cast shadows
        const nd = n.mode === 'sky' ? 0 : Math.hypot(n.x - ex, n.z - ez);
        n.root.visible = nd < 135;
        if (!n.root.visible) continue;
        n.setShadow(nd < 55);
        n.update(dt, s === 'play' || frozen ? p : null, this.props.colliders, frozen);
        if (n.anim.stepped) this.sfx.step(hear(n.x, n.z, 26) * 0.55, n.scale * n.species.height * 0.5, false);
      }
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
        this.camera.position.set(Math.sin(a) * 50, 16 + Math.sin(t * 0.2) * 2, Math.cos(a) * 50);
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

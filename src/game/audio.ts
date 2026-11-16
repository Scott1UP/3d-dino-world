// All audio is synthesised with WebAudio (no files): sound effects, footsteps, a gentle looping tune,
// outdoor ambience (breeze + birdsong), and read-aloud for the dino cards.

import LINES from './voice-lines.json';

export type VoiceLine = keyof typeof LINES;

const NOTE = (semis: number) => 261.63 * Math.pow(2, semis / 12); // relative to middle C

// Four-bar chord loop (C, Am, F, G) with a simple pentatonic tune over the top. 8th-note grid, -1 = rest.
const CHORDS = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
const TUNE = [
  [7, -1, 4, 7, 9, -1, 7, -1], [4, -1, 0, 4, 7, -1, 4, -1], [9, -1, 5, 9, 12, -1, 9, 7], [7, -1, 2, 7, 11, 9, 7, -1],
  [12, -1, 7, 12, 16, -1, 12, -1], [9, -1, 4, 9, 12, -1, 9, 7], [5, 9, 12, -1, 9, 5, 0, -1], [2, 7, 11, -1, 7, -1, -1, -1],
];
const STEP = 0.3; // seconds per 8th note

export class Sfx {
  enabled = true;
  musicOn = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private nextNote = 0;
  private stepIdx = 0;
  private nextBird = 0;
  private playing = true;
  private inCave = false;
  private nextDrip = 0;
  private roarBuf: AudioBuffer | null = null;
  private roarSrc: AudioBufferSourceNode | null = null;
  /** recorded footsteps by surface (CC0, see public/audio/CREDITS.md) */
  /** ids of the voice-over clips that exist in public/audio/voice (written by `npm run voices`) */
  private clipIds = new Set<string>();
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  private clipSrc: AudioBufferSourceNode | null = null;
  /** bumps on every say / hush so a clip that finishes loading late knows it is no longer wanted */
  private sayToken = 0;
  /** Scott's own recorded knock-over noises, played exactly as mastered (no pitch or level changes in code) */
  private knocks: AudioBuffer[] = [];
  /** each species' own call, used when they answer a T-Rex roar (CC0, see CREDITS.md) */
  private calls = new Map<string, AudioBuffer>();
  private lastKnock = -1;
  private steps: Record<'land' | 'stone' | 'water', AudioBuffer[]> = { land: [], stone: [], water: [] };

  constructor() {
    fetch(`${import.meta.env.BASE_URL}audio/voice/manifest.json`)
      .then((r) => r.json())
      .then((m: Record<string, string>) => {
        this.clipIds = new Set(Object.keys(m));
        if (this.ctx) this.preloadClips();
      })
      .catch(() => {});
    if ('speechSynthesis' in window) {
      this.pickVoice();
      speechSynthesis.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  /** Must be called from a user gesture (first tap) to unlock audio on iOS. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);
      this.ambBus = ctx.createGain();
      this.ambBus.gain.value = 0;
      this.ambBus.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // recorded T-Rex roar (CC0, see public/audio/CREDITS.md)
      fetch(`${import.meta.env.BASE_URL}audio/trex-roar.m4a`)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => (this.roarBuf = buf))
        .catch(() => {});
      const load = (name: string) =>
        fetch(`${import.meta.env.BASE_URL}audio/${name}.m4a`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
      for (const [kind, n] of [['land', 4], ['stone', 3], ['water', 4]] as const) {
        for (let i = 1; i <= n; i++) load(`step-${kind}-${i}`).then((buf) => this.steps[kind].push(buf)).catch(() => {});
      }
      for (const id of ['triceratops', 'stegosaurus', 'brachiosaurus', 'pteranodon', 'plesiosaurus', 'turtle']) {
        load(`call-${id}`).then((buf) => this.calls.set(id, buf)).catch(() => {});
      }
      for (let i = 1; i <= 5; i++) load(`knock-${i}`).then((buf) => this.knocks.push(buf)).catch(() => {});
      this.preloadClips();
      this.startBreeze();
      setInterval(() => this.schedule(), 120);
      this.applyBuses();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Silence everything while the tab is hidden. */
  suspend(on: boolean) {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ───────── background: music + ambience ─────────

  /** Start / stop the background layer (called when the game is actually being played). */
  setPlaying(on: boolean) {
    this.playing = on;
    this.applyBuses();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.applyBuses();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.hush();
    this.applyBuses();
  }

  /** Inside a cave the birds and music fade back and water drips. */
  setCave(on: boolean) {
    if (on === this.inCave) return;
    this.inCave = on;
    this.applyBuses();
  }

  /** Where one-shot effects are sent. */
  private get out(): GainNode {
    return this.master!;
  }

  private applyBuses(duck = false) {
    if (!this.ctx || !this.musicBus || !this.ambBus) return;
    const t = this.ctx.currentTime;
    const on = this.enabled && this.playing;
    const music = (duck ? 0.12 : 0.42) * (this.inCave ? 0.45 : 1);
    this.musicBus.gain.setTargetAtTime(on && this.musicOn ? music : 0, t, 0.4);
    this.ambBus.gain.setTargetAtTime(on ? (this.inCave ? 0.12 : 1) : 0, t, 0.6);
  }

  private startBreeze() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.11;
    // slow swell so the breeze comes and goes
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.09;
    lg.gain.value = 0.06;
    lfo.connect(lg).connect(g.gain);
    const lfo2 = ctx.createOscillator();
    const lg2 = ctx.createGain();
    lfo2.frequency.value = 0.05;
    lg2.gain.value = 160;
    lfo2.connect(lg2).connect(lp.frequency);
    src.connect(lp).connect(g).connect(this.ambBus!);
    src.start();
    lfo.start();
    lfo2.start();
  }

  private pluck(freq: number, t: number, vol: number, dur: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicBus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bird(t: number) {
    const ctx = this.ctx!;
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    const vol = 0.02 + Math.random() * 0.035;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), s);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), s + 0.06);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(vol, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g).connect(this.ambBus!);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  /** Look-ahead scheduler: queues the next few notes and bird calls. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.nextNote < now) this.nextNote = now + 0.05;
    while (this.nextNote < now + 0.4) {
      const t = this.nextNote;
      const bar = Math.floor(this.stepIdx / 8) % TUNE.length;
      const beat = this.stepIdx % 8;
      const chord = CHORDS[bar % CHORDS.length];
      const n = TUNE[bar][beat];
      if (n >= 0) {
        // soft marimba: sine body + a quiet octave "tick"
        this.pluck(NOTE(n), t, 0.2, 0.55);
        this.pluck(NOTE(n + 12), t, 0.05, 0.16, 'triangle');
      }
      if (beat === 0 || beat === 4) this.pluck(NOTE(chord[0] - 12), t, beat === 0 ? 0.24 : 0.14, 0.9, 'triangle');
      if (beat % 2 === 1) this.pluck(NOTE(chord[(beat >> 1) % 3]), t, 0.06, 0.4);
      if (beat === 0) for (const c of chord) this.pluck(NOTE(c), t, 0.035, STEP * 8);
      this.stepIdx++;
      this.nextNote += STEP;
    }
    if (this.inCave && this.enabled && now > this.nextDrip) {
      // water dripping from the ceiling
      const f = 900 + Math.random() * 900;
      this.tone('sine', f, f * 0.55, 0.09, 0.12 + Math.random() * 0.1);
      this.nextDrip = now + 0.5 + Math.random() * 1.8;
    }
    if (now > this.nextBird) {
      this.bird(now + 0.05);
      this.nextBird = now + 1.2 + Math.random() * 4.5;
    }
  }

  // ───────── one-shot effects ─────────

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): OscillatorNode | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noise(dur: number, vol: number, f0: number, f1: number, delay = 0, q = 1, type: BiquadFilterType = 'bandpass') {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Footstep. vol 0..1 (distance), weight ~0.4 (tiny) .. 2 (huge), wet = in water. */
  step(vol: number, weight: number, wet: boolean) {
    if (vol < 0.03) return;
    const set = this.steps[wet ? 'water' : this.inCave ? 'stone' : 'land'];
    if (set.length && this.enabled && this.ctx) {
      const src = this.ctx.createBufferSource();
      src.buffer = set[Math.floor(Math.random() * set.length)];
      // big feet sound lower and slower; a little random variation keeps it from sounding like a loop
      src.playbackRate.value = Math.min(1.35, Math.max(0.55, 1.2 - weight * 0.28)) * (0.94 + Math.random() * 0.12);
      const g = this.ctx.createGain();
      g.gain.value = vol * (wet ? 0.31 : 0.48);
      src.connect(g).connect(this.out);
      src.start();
      // heavy animals also get a soft low thump underneath
      if (!wet && weight > 1.1) this.tone('sine', 95 / Math.sqrt(weight), 40, 0.12, 0.16 * vol);
      return;
    }
    if (wet) {
      this.noise(0.16, 0.124 * vol, 1400, 2800, 0, 0.8);
      this.tone('sine', 420, 180, 0.08, 0.045 * vol);
      return;
    }
    const f = 150 / Math.sqrt(weight);
    this.tone('sine', f, f * 0.45, 0.11, 0.236 * vol);
    this.noise(0.07, 0.09 * vol, 900 / weight, 300 / weight, 0, 0.7, 'lowpass');
  }
  flap(vol: number) {
    if (vol < 0.03) return;
    this.noise(0.2, 0.2 * vol, 300, 900, 0, 0.9);
  }
  plop(vol: number) {
    if (vol < 0.03) return;
    this.tone('sine', 500, 180, 0.12, 0.2 * vol);
    this.noise(0.25, 0.14 * vol, 1200, 2600, 0.03, 0.8);
  }
  chomp() {
    for (let i = 0; i < 3; i++) {
      this.noise(0.09, 0.5, 1800, 500, i * 0.17, 2);
      this.tone('square', 240, 120, 0.07, 0.12, i * 0.17);
    }
  }
  yum() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.22, 0.5 + i * 0.08));
  }
  hello() {
    [659, 880, 784, 1047].forEach((f, i) => this.tone('sine', f, f * 1.02, 0.16, 0.25, i * 0.09));
  }
  pop() {
    this.tone('sine', 300, 900, 0.12, 0.35);
  }
  tap() {
    this.tone('sine', 620, 820, 0.07, 0.2);
  }
  /** n = which bounce in a row (1, 2, 3…): higher bounces sound higher and longer */
  boing(n = 1) {
    const k = 1 + (Math.min(n, 3) - 1) * 0.28;
    this.tone('sine', 180 * k, 620 * k, 0.3 + n * 0.05, 0.4);
    this.tone('triangle', 360 * k, 1240 * k, 0.3, 0.12);
    if (n >= 3) [1047, 1319, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.16, 0.05 + i * 0.06));
  }
  splash() {
    this.noise(0.35, 0.3, 900, 3000, 0, 0.7);
  }
  crack() {
    this.noise(0.08, 0.6, 3000, 1200, 0, 3);
    this.noise(0.08, 0.5, 2400, 900, 0.12, 3);
  }
  fanfare() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.25, i * 0.1));
  }
  grow() {
    [392, 523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.24, i * 0.08));
    this.tone('sine', 200, 800, 0.7, 0.2);
  }
  /** A dinosaur bowled over: a surprised "oof", a thud, then a dizzy little whistle. */
  bonk(voice: number) {
    if (this.knocks.length && this.enabled && this.ctx) {
      // a different one each time
      let i = Math.floor(Math.random() * this.knocks.length);
      if (i === this.lastKnock) i = (i + 1) % this.knocks.length;
      this.lastKnock = i;
      const src = this.ctx.createBufferSource();
      src.buffer = this.knocks[i];
      src.connect(this.out);
      src.start();
      return;
    }
    const f = 260 * voice;
    this.tone('sawtooth', f * 1.4, f * 0.6, 0.22, 0.22);
    this.tone('sine', 110, 45, 0.2, 0.5, 0.12);
    this.noise(0.18, 0.3, 500, 150, 0.12, 0.7, 'lowpass');
    [1400, 1150, 1400, 1150].forEach((n, i) => this.tone('sine', n, n * 0.9, 0.12, 0.07, 0.5 + i * 0.16));
  }
  /** A tree going over: creak, leafy swish, thump. */
  timber() {
    this.tone('sawtooth', 190, 70, 0.4, 0.14);
    this.noise(0.6, 0.28, 2600, 700, 0.1, 0.6);
    this.tone('sine', 85, 38, 0.25, 0.55, 0.45);
    this.noise(0.2, 0.3, 400, 120, 0.45, 0.7, 'lowpass');
  }
  /** The magic crystal singing: a rising, shimmering run of bells. */
  chime() {
    [523, 659, 784, 988, 1175, 1319, 1568, 1976, 2349].forEach((f, i) => {
      this.tone('sine', f, f, 1.1, 0.16, i * 0.11);
      this.tone('triangle', f * 2, f * 2, 0.5, 0.04, i * 0.11);
    });
  }
  /** Found every friend! */
  win() {
    const tune = [523, 523, 659, 784, 659, 784, 1047, 1047, 1319, 1568];
    tune.forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.26, i * 0.14));
    [523, 659, 784, 1047].forEach((f) => this.tone('sine', f, f, 1.4, 0.14, tune.length * 0.14));
  }
  /** Head-down charge: a whoosh and a drum-roll of feet that runs for the whole dash (dur seconds). */
  charge(dur = 0.85) {
    this.noise(dur, 0.3, 500, 2200, 0, 0.7);
    const beats = Math.round(dur / 0.1);
    for (let i = 0; i < beats; i++) {
      // alternate feet, easing off over the last few steps
      const fade = Math.min(1, (beats - i) / 3);
      this.tone('sine', i % 2 ? 110 : 125, 55, 0.09, 0.4 * fade, i * 0.1);
    }
  }
  /** Stegosaurus tail spin: one whoosh per turn, bunched up at the start like the spin itself. */
  spin(turns: number, dur: number) {
    for (let i = 0; i < turns; i++) {
      this.noise((dur / turns) * 1.2, 0.34, 350, 1900, dur * (1 - Math.sqrt(1 - i / turns)), 0.8);
    }
    this.tone('sine', 95, 50, 0.3, 0.3);
  }
  /** Brachiosaurus neck swing: a low grunt as it winds back, then a heavy whoosh for the sweep itself. */
  swing(delay: number, len: number) {
    this.tone('sine', 120, 70, delay, 0.3);
    this.noise(len, 0.42, 200, 1500, delay, 0.7);
  }
  /**
   * A dinosaur calling out. vol 0..1 by distance; bigger animals sound deeper.
   * Returns how long the call lasts (seconds) so an animation can match it.
   */
  call(id: string, vol: number, size: number): number {
    const buf = id === 'trex' ? this.roarBuf : this.calls.get(id);
    const rate = Math.min(1.3, Math.max(0.7, 1.15 - size * 0.12));
    const heard = buf ? Math.min(buf.duration, id === 'trex' ? 1.3 : 3) / rate : 0.6;
    if (vol < 0.04 || !this.enabled || !this.ctx) return heard;
    if (!buf) {
      this.tone('sawtooth', 220, 140, 0.4, 0.15 * vol);
      return heard;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    const len = heard;
    g.gain.setValueAtTime(vol * 0.8, t);
    g.gain.setValueAtTime(vol * 0.8, t + len - 0.25);
    g.gain.linearRampToValueAtTime(0, t + len);
    src.connect(g).connect(this.out);
    src.start();
    src.stop(t + len + 0.05);
    return heard;
  }

  /**
   * Plays a roar and returns how long it lasts (seconds), so the animation can match it.
   * power 0..1: a quick tap gives a short, quieter roar; a fully wound-up one is the whole thing.
   */
  roar(voice: number, recorded = false, power = 1): number {
    if (recorded && this.roarBuf) {
      const len = this.roarBuf.duration * (0.42 + 0.58 * power);
      // the roar animation should run for the whole roar even when sound is off
      if (!this.enabled || !this.ctx || !this.master) return len;
    } else if (!this.enabled || !this.ctx || !this.master) return 0.9;
    if (recorded && this.roarBuf) {
      try {
        this.roarSrc?.stop();
      } catch {
        /* already finished */
      }
      const src = (this.roarSrc = this.ctx.createBufferSource());
      src.buffer = this.roarBuf;
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime;
      const len = this.roarBuf.duration * (0.42 + 0.58 * power);
      const level = 0.5 + 0.45 * power;
      g.gain.setValueAtTime(level, t);
      g.gain.setValueAtTime(level, t + len - 0.35);
      g.gain.linearRampToValueAtTime(0, t + len);
      src.connect(g).connect(this.out);
      src.start();
      src.stop(t + len + 0.05);
      return len;
    }
    const f = 150 * voice;
    const o = this.tone('sawtooth', f * 1.5, f * 0.7, 0.85, 0.3);
    this.tone('square', f * 0.75, f * 0.4, 0.85, 0.16);
    this.noise(0.8, 0.22, 700 * voice, 250 * voice, 0, 0.8);
    if (o) {
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 26;
      lg.gain.value = f * 0.18;
      lfo.connect(lg).connect(o.frequency);
      lfo.start();
      lfo.stop(this.ctx.currentTime + 0.9);
    }
    return 0.9;
  }

  // ───────── read-aloud ─────────

  /** Prefer the nicest natural-sounding English voice the device offers. */
  private pickVoice() {
    const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang) || v.lang === 'en');
    const score = (v: SpeechSynthesisVoice) => {
      let s = 0;
      if (/premium|enhanced|natural|neural/i.test(v.name)) s += 6;
      if (/siri/i.test(v.name)) s += 5;
      if (/samantha|ava|allison|susan|zoe|serena|karen|moira|tessa|fiona|martha/i.test(v.name)) s += 4;
      if (/google (uk|us) english/i.test(v.name)) s += 4;
      if (/aria|jenny|sonia|libby|michelle/i.test(v.name)) s += 4;
      if (/female/i.test(v.name)) s += 1;
      // novelty voices that ship with macOS / iOS
      if (/albert|bad news|bahh|bells|boing|bubbles|cellos|wobble|fred|good news|jester|junior|kathy|organ|ralph|superstar|trinoids|whisper|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|compact/i.test(v.name)) s -= 8;
      if (/en[-_](US|GB|AU)/i.test(v.lang)) s += 1;
      return s;
    };
    voices.sort((a, b) => score(b) - score(a));
    this.voice = voices[0] ?? null;
  }

  /** Say one of the scripted lines: the recorded voice-over if we have it, otherwise the device's voice. */
  say(id: VoiceLine) {
    if (!this.enabled) return;
    this.hush();
    const pending = this.clips.get(id);
    // only lines with no recording at all are read by the device voice
    if (!pending || !this.ctx || !this.master) return this.speak(LINES[id]);
    const token = this.sayToken;
    void pending.then((buf) => {
      // stopped or replaced while loading: stay silent rather than substituting another voice
      if (token !== this.sayToken || !this.ctx || !this.master) return;
      if (!buf) return this.speak(LINES[id]);
      const src = (this.clipSrc = this.ctx.createBufferSource());
      src.buffer = buf;
      src.connect(this.master);
      src.onended = () => {
        if (this.clipSrc === src) {
          this.clipSrc = null;
          this.applyBuses(false);
        }
      };
      this.applyBuses(true);
      src.start();
    });
  }

  /** Decode every recorded line up front so they start instantly and can't be blocked by the browser. */
  private preloadClips() {
    const ctx = this.ctx!;
    for (const id of this.clipIds) {
      if (this.clips.has(id)) continue;
      this.clips.set(
        id,
        fetch(`${import.meta.env.BASE_URL}audio/voice/${id}.mp3`)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b))
          .catch(() => null),
      );
    }
  }

  speak(text: string) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      // short sentences, one utterance each, gives a calmer, clearer read than one long run-on
      const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p);
        if (this.voice) {
          u.voice = this.voice;
          u.lang = this.voice.lang;
        }
        u.rate = 0.88;
        u.pitch = 1.08;
        if (i === 0) u.onstart = () => this.applyBuses(true);
        if (i === parts.length - 1) u.onend = u.onerror = () => this.applyBuses(false);
        speechSynthesis.speak(u);
      });
    } catch {
      /* speech is a nice-to-have */
    }
  }
  hush() {
    this.sayToken++;
    if (this.clipSrc) {
      const src = this.clipSrc;
      this.clipSrc = null;
      try {
        src.stop();
      } catch {
        /* not started yet */
      }
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.applyBuses(false);
  }
}

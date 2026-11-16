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
  private caveBus: GainNode | null = null;
  private inCave = false;
  private nextDrip = 0;
  private roarBuf: AudioBuffer | null = null;
  private roarSrc: AudioBufferSourceNode | null = null;
  /** recorded footsteps by surface (CC0, see public/audio/CREDITS.md) */
  /** ids of the voice-over clips that exist in public/audio/voice (written by `npm run voices`) */
  private clips = new Set<string>();
  private clip: HTMLAudioElement | null = null;
  private steps: Record<'land' | 'stone' | 'water', AudioBuffer[]> = { land: [], stone: [], water: [] };

  constructor() {
    fetch(`${import.meta.env.BASE_URL}audio/voice/manifest.json`)
      .then((r) => r.json())
      .then((m: Record<string, string>) => (this.clips = new Set(Object.keys(m))))
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
      // cave echo: everything sent here repeats and fades
      this.caveBus = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.27;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      const wet = ctx.createGain();
      wet.gain.value = 0.6;
      this.caveBus.connect(this.master);
      this.caveBus.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(this.master);
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

  /** Inside a cave the birds and music fade back, drips start, and every sound echoes. */
  setCave(on: boolean) {
    if (on === this.inCave) return;
    this.inCave = on;
    this.applyBuses();
  }

  /** Where one-shot effects are sent: straight out, or through the cave echo. */
  private get out(): GainNode {
    return (this.inCave ? this.caveBus : this.master)!;
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
      g.gain.value = vol * (wet ? 0.55 : 0.85);
      src.connect(g).connect(this.out);
      src.start();
      // heavy animals also get a soft low thump underneath
      if (!wet && weight > 1.1) this.tone('sine', 95 / Math.sqrt(weight), 40, 0.12, 0.28 * vol);
      return;
    }
    if (wet) {
      this.noise(0.16, 0.22 * vol, 1400, 2800, 0, 0.8);
      this.tone('sine', 420, 180, 0.08, 0.08 * vol);
      return;
    }
    const f = 150 / Math.sqrt(weight);
    this.tone('sine', f, f * 0.45, 0.11, 0.42 * vol);
    this.noise(0.07, 0.16 * vol, 900 / weight, 300 / weight, 0, 0.7, 'lowpass');
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
  /** Head-down charge: a whoosh and a drum-roll of feet. */
  charge() {
    this.noise(0.7, 0.3, 500, 2200, 0, 0.7);
    for (let i = 0; i < 6; i++) this.tone('sine', 120, 55, 0.09, 0.4, i * 0.1);
  }
  /** Plays a roar and returns how long it lasts (seconds), so the animation can match it. */
  roar(voice: number, recorded = false): number {
    if (recorded && this.roarBuf) {
      // the roar animation should run for the whole recording even when sound is off
      if (!this.enabled || !this.ctx || !this.master) return this.roarBuf.duration;
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
      g.gain.value = 0.95;
      src.connect(g).connect(this.out);
      src.start();
      return this.roarBuf.duration;
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
    if (!this.clips.has(id)) return this.speak(LINES[id]);
    this.hush();
    const a = (this.clip = new Audio(`${import.meta.env.BASE_URL}audio/voice/${id}.mp3`));
    a.onplay = () => this.applyBuses(true);
    a.onended = a.onerror = () => {
      if (this.clip === a) this.applyBuses(false);
    };
    a.play().catch(() => this.speak(LINES[id]));
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
    if (this.clip) {
      this.clip.pause();
      this.clip = null;
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.applyBuses(false);
  }
}

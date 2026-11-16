// Tiny synthesised sound effects (no audio files) + read-aloud for dino cards.

export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture (first tap) to unlock audio on iOS. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0,
  ): OscillatorNode | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noise(dur: number, vol: number, f0: number, f1: number, delay = 0, q = 1) {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
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
  boing() {
    this.tone('sine', 180, 620, 0.32, 0.4);
    this.tone('triangle', 360, 1240, 0.3, 0.12);
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
  roar(voice: number) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const base = 150 * voice;
    const o = this.tone('sawtooth', base * 1.5, base * 0.7, 0.85, 0.3);
    this.tone('square', base * 0.75, base * 0.4, 0.85, 0.16);
    this.noise(0.8, 0.22, 700 * voice, 250 * voice, 0, 0.8);
    if (o) {
      // growly wobble
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 26;
      lg.gain.value = base * 0.18;
      lfo.connect(lg).connect(o.frequency);
      lfo.start();
      lfo.stop(this.ctx.currentTime + 0.9);
    }
  }

  speak(text: string) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.85;
      u.pitch = 1.25;
      speechSynthesis.speak(u);
    } catch {
      /* speech is a nice-to-have */
    }
  }
  hush() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}

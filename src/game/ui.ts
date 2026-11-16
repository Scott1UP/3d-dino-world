// DOM menus + HUD. The 3D game calls into this; this calls back through the handlers.
import { ALL_SPECIES, PLAYABLE, SPECIES, SpeciesId } from '../dino/species';
import { isTouch } from './input';
import type { Portraits } from './portraits';
import type { Quality } from './settings';

export type ActionKind = 'roar' | 'eat' | 'hello' | 'egg' | 'fly' | 'charge' | 'gem';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UiHandlers {
  play(): void;
  pick(id: SpeciesId): void;
  /** an egg was tapped once (selected, not yet chosen) */
  preview(id: SpeciesId): void;
  pause(): void;
  resume(): void;
  changeDino(): void;
  toggleSound(): boolean;
  toggleMusic(): boolean;
  /** graphics setting to show as chosen when the game starts */
  quality: Quality;
  setQuality(q: Quality): void;
  openBook(): void;
  closeOverlay(): void;
  speakCard(): void;
  tap(): void;
}

export class Ui {
  private toastTimer = 0;
  private actionKey = '';
  private selected: SpeciesId | null = null;

  constructor(private portraits: Portraits, h: UiHandlers) {
    document.body.classList.toggle('touch', isTouch);
    const click = (id: string, fn: () => void) =>
      $(id).addEventListener('click', () => {
        h.tap();
        fn();
      });
    click('play', h.play);
    click('btn-pause', h.pause);
    click('btn-book', h.openBook);
    click('resume', h.resume);
    click('change', h.changeDino);
    click('card-close', h.closeOverlay);
    click('book-close', h.closeOverlay);
    click('win-close', h.closeOverlay);
    click('card-speak', h.speakCard);
    click('sound', () => {
      const on = h.toggleSound();
      $('sound').innerHTML = `<span class="emoji">${on ? '🔊' : '🔇'}</span> Sound ${on ? 'on' : 'off'}`;
    });

    click('music', () => {
      const on = h.toggleMusic();
      $('music').innerHTML = `<span class="emoji">${on ? '🎵' : '🔕'}</span> Music ${on ? 'on' : 'off'}`;
    });

    // settings open on top of the pause menu and go back to it
    click('open-settings', () => this.overlay('settings'));
    click('settings-back', () => this.overlay('pause'));
    const levels = [...document.querySelectorAll<HTMLButtonElement>('#graphics button')];
    const showQuality = (q: Quality) => {
      for (const b of levels) b.setAttribute('aria-pressed', String(b.dataset.quality === q));
    };
    showQuality(h.quality);
    for (const b of levels) {
      b.addEventListener('click', () => {
        h.tap();
        const q = b.dataset.quality as Quality;
        showQuality(q);
        h.setQuality(q);
      });
    }

    const eggs = $('eggs');
    for (const id of PLAYABLE) {
      const s = SPECIES[id];
      const b = document.createElement('button');
      b.className = 'egg-card';
      b.style.setProperty('--chip', s.color);
      b.innerHTML =
        `<img class="egg-img" src="${portraits.egg[id]}" alt="" draggable="false" />` +
        `<span class="dino-chip"><img src="${portraits.dino[id]}" alt="" draggable="false" /></span>` +
        `<span class="egg-name">${s.name}</span>`;
      b.dataset.id = id;
      // first tap selects the egg and says its name; a second tap (or the Go button) hatches it
      b.addEventListener('click', () => {
        h.tap();
        if (this.selected === id) return h.pick(id);
        this.select(id);
        h.preview(id);
      });
      eggs.appendChild(b);
    }
    click('go', () => {
      if (this.selected) h.pick(this.selected);
    });

    if (!isTouch) {
      $('hint').innerHTML = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp;·&nbsp; <kbd>Space</kbd> eat &amp; say hi';
    }
  }

  private select(id: SpeciesId | null) {
    this.selected = id;
    for (const el of document.querySelectorAll<HTMLElement>('.egg-card')) {
      el.classList.toggle('selected', el.dataset.id === id);
      el.classList.toggle('dim', id !== null && el.dataset.id !== id);
    }
    $('go').classList.toggle('hidden', id === null);
    $('pick-title').textContent = id ? `${SPECIES[id].name}!` : 'Pick an egg!';
  }

  screen(name: 'loading' | 'title' | 'select' | 'none') {
    if (name === 'select') this.select(null);
    for (const id of ['loading', 'title', 'select']) $(id).classList.toggle('hidden', id !== name);
  }

  hud(show: boolean) {
    $('hud').classList.toggle('hidden', !show);
    if (show && !isTouch) {
      $('hint').classList.remove('hidden', 'fade');
    }
  }

  hideHint() {
    $('hint').classList.add('fade');
  }

  overlay(name: 'card' | 'book' | 'pause' | 'settings' | 'win' | 'none') {
    for (const id of ['card', 'book', 'pause', 'settings', 'win']) $(id).classList.toggle('hidden', id !== name);
  }

  setAction(kind: ActionKind, icon: string, label: string) {
    const key = kind + icon;
    if (key === this.actionKey) return;
    this.actionKey = key;
    const a = $('action');
    a.classList.remove('eat', 'hello', 'egg', 'roar', 'fly', 'charge', 'gem', 'ready');
    a.classList.add(kind);
    if (kind === 'eat' || kind === 'hello' || kind === 'egg' || kind === 'gem') a.classList.add('ready');
    const i = $('action-icon');
    i.textContent = icon;
    i.classList.remove('swap');
    void i.offsetWidth;
    i.classList.add('swap');
    $('action-label').textContent = label;
  }

  /** Growing-up meter: one pip per food still needed for the next size. */
  grow(stage: number, eaten: number, need: number) {
    const g = $('grow');
    g.classList.toggle('done', need === 0);
    g.dataset.stage = String(stage);
    const pips = $('grow-pips');
    pips.innerHTML = '';
    for (let i = 0; i < need; i++) {
      const s = document.createElement('i');
      if (i < eaten) s.className = 'full';
      if (i === eaten - 1) s.classList.add('new');
      pips.appendChild(s);
    }
  }

  toast(text: string, ms = 2200) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden', 'out');
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.classList.add('out');
      this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), 260);
    }, ms);
  }

  card(id: SpeciesId) {
    const s = SPECIES[id];
    $<HTMLImageElement>('card-img').src = this.portraits.dino[id];
    $('card').querySelector<HTMLElement>('.card-pic')!.style.setProperty('--tint', s.color);
    $('card-name').textContent = s.name;
    $('card-say').textContent = s.say;
    $('card-fact').textContent = s.fact;
    $('card-food-icon').textContent = s.foodIcon;
    $('card-food').textContent = s.food;
    this.overlay('card');
  }

  /** Celebration for meeting every dinosaur: all the portraits, a trophy and a shower of confetti. */
  win() {
    const grid = $('win-grid');
    grid.innerHTML = '';
    for (const id of ALL_SPECIES) {
      const d = document.createElement('div');
      d.className = 'pic';
      d.style.setProperty('--tint', SPECIES[id].color);
      d.innerHTML = `<img src="${this.portraits.dino[id]}" alt="" draggable="false" />`;
      grid.appendChild(d);
    }
    const confetti = $('confetti');
    confetti.innerHTML = '';
    const colors = ['#ff5e7e', '#ffc21f', '#6fd03c', '#3bb4f6', '#b58cff', '#ff9f1c'];
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('i');
      s.style.cssText =
        `left:${Math.random() * 100}%;background:${colors[i % colors.length]};` +
        `animation-delay:${(-Math.random() * 3).toFixed(2)}s;animation-duration:${(2.4 + Math.random() * 2).toFixed(2)}s;` +
        `width:${8 + Math.random() * 10}px;height:${10 + Math.random() * 14}px;`;
      confetti.appendChild(s);
    }
    this.overlay('win');
    $('btn-book').classList.add('complete');
  }

  bookCount(met: Set<SpeciesId>) {
    $('book-count').textContent = `${met.size}/${ALL_SPECIES.length}`;
  }

  book(met: Set<SpeciesId>) {
    const grid = $('book-grid');
    grid.innerHTML = '';
    for (const id of ALL_SPECIES) {
      const s = SPECIES[id];
      const known = met.has(id);
      const d = document.createElement('div');
      d.className = 'friend' + (known ? '' : ' unknown');
      d.innerHTML =
        `<div class="pic" style="--tint:${s.color}"><img src="${this.portraits.dino[id]}" alt="" draggable="false" /></div>` +
        `<span>${known ? s.name : '???'}</span>`;
      grid.appendChild(d);
    }
    this.overlay('book');
  }
}

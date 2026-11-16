// DOM menus + HUD. The 3D game calls into this; this calls back through the handlers.
import { ALL_SPECIES, PLAYABLE, SPECIES, SpeciesId } from '../dino/species';
import { isTouch } from './input';
import type { Portraits } from './portraits';

export type ActionKind = 'roar' | 'eat' | 'hello' | 'egg';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UiHandlers {
  play(): void;
  pick(id: SpeciesId): void;
  pause(): void;
  resume(): void;
  changeDino(): void;
  toggleSound(): boolean;
  openBook(): void;
  closeOverlay(): void;
  speakCard(): void;
  tap(): void;
}

export class Ui {
  private toastTimer = 0;
  private actionKey = '';

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
    click('card-speak', h.speakCard);
    click('sound', () => {
      const on = h.toggleSound();
      $('sound').innerHTML = `<span class="emoji">${on ? '🔊' : '🔇'}</span> Sound ${on ? 'on' : 'off'}`;
    });

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
      b.addEventListener('click', () => {
        h.tap();
        h.pick(id);
      });
      eggs.appendChild(b);
    }

    if (!isTouch) {
      $('hint').innerHTML = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp;·&nbsp; <kbd>Space</kbd> eat &amp; say hi';
    }
  }

  screen(name: 'loading' | 'title' | 'select' | 'none') {
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

  overlay(name: 'card' | 'book' | 'pause' | 'none') {
    for (const id of ['card', 'book', 'pause']) $(id).classList.toggle('hidden', id !== name);
  }

  setAction(kind: ActionKind, icon: string, label: string) {
    const key = kind + icon;
    if (key === this.actionKey) return;
    this.actionKey = key;
    const a = $('action');
    a.classList.remove('eat', 'hello', 'egg', 'roar', 'ready');
    a.classList.add(kind);
    if (kind !== 'roar') a.classList.add('ready');
    const i = $('action-icon');
    i.textContent = icon;
    i.classList.remove('swap');
    void i.offsetWidth;
    i.classList.add('swap');
    $('action-label').textContent = label;
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

// Touch joystick + one big action button, with keyboard fallback for desktop.

export const isTouch =
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches);

export class Input {
  /** movement, each -1..1 (y = forward) */
  x = 0;
  y = 0;
  onAction: () => void = () => {};
  onPause: () => void = () => {};
  /** true while the action button / key is held down */
  held = false;
  /** true once the player has moved at all (used to hide hints) */
  moved = false;

  private keys = new Set<string>();
  private stickId = -1;
  private sx = 0;
  private sy = 0;
  private jx = 0;
  private jy = 0;
  private base: HTMLElement;
  private knob: HTMLElement;
  private zone: HTMLElement;
  private readonly R = 60;

  constructor(root: HTMLElement) {
    this.zone = root.querySelector<HTMLElement>('#stick-zone')!;
    this.base = root.querySelector<HTMLElement>('#stick-base')!;
    this.knob = root.querySelector<HTMLElement>('#stick-knob')!;
    const action = root.querySelector<HTMLElement>('#action')!;

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      this.sx = e.clientX;
      this.sy = e.clientY;
      this.base.classList.add('active');
      this.placeBase(e.clientX, e.clientY);
      this.setKnob(0, 0);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.sx;
      let dy = e.clientY - this.sy;
      const len = Math.hypot(dx, dy);
      if (len > this.R) {
        // drag the base along so the stick never "runs out"
        this.sx += (dx / len) * (len - this.R);
        this.sy += (dy / len) * (len - this.R);
        this.placeBase(this.sx, this.sy);
        dx = (dx / len) * this.R;
        dy = (dy / len) * this.R;
      }
      this.setKnob(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.base.classList.remove('active');
      this.base.style.left = '';
      this.base.style.top = '';
      this.setKnob(0, 0);
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);

    action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      action.classList.add('down');
      this.held = true;
      this.onAction();
    });
    const up = () => {
      action.classList.remove('down');
      this.held = false;
    };
    action.addEventListener('pointerup', up);
    action.addEventListener('pointerleave', up);
    action.addEventListener('pointercancel', up);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'e' || k === 'enter') {
        e.preventDefault();
        this.held = true;
        this.onAction();
      }
      if (k === 'escape' || k === 'p') this.onPause();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ' || k === 'e' || k === 'enter') this.held = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held = false;
    });
    // stop iOS long-press menus, pinch and double-tap zoom
    for (const ev of ['contextmenu', 'gesturestart', 'dblclick']) {
      document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    }
    document.addEventListener(
      'touchmove',
      (e) => {
        // a menu that is taller than the screen still needs to scroll (one finger only, so no pinch zoom)
        if (e.touches.length === 1 && (e.target as Element).closest?.('.menu')) return;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  private placeBase(x: number, y: number) {
    const r = this.zone.getBoundingClientRect();
    this.base.style.left = `${x - r.left}px`;
    this.base.style.top = `${y - r.top}px`;
  }

  private setKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.jx = dx / this.R;
    this.jy = -dy / this.R;
  }

  update() {
    let x = this.jx;
    let y = this.jy;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (len < 0.12) x = y = 0;
    else this.moved = true;
    this.x = x;
    this.y = y;
  }

  reset() {
    this.held = false;
    this.keys.clear();
    this.jx = this.jy = 0;
  }
}

import { isTouchDevice } from '../input.js';

// Turns keyboard, gamepad and touch into the inputs a packaged minigame asked for in its
// manifest (input: { buttons, dirs, move, touch }): button presses and releases, direction taps
// and the stick, each stamped with the game time it happened at. The game itself never sees a
// key, a mouse or a touch.

const KEY_A = new Set(['Space', 'Enter', 'NumpadEnter']);
const KEY_B = new Set(['ShiftLeft', 'ShiftRight', 'KeyE']);
const KEY_DIRS = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };
const MOVE_KEYS = { u: [0, 1], d: [0, -1], l: [-1, 0], r: [1, 0] };
// A one-button game takes a few more keys, a click or a tap anywhere.
const ONE_BUTTON_KEYS = new Set(['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight']);
const DEADZONE = 0.2;
const SWIPE_PX = 24;
const MOVE_EVERY_MS = 33; // the stick is reported at most this often

export class Controls {
  // clock() -> the current game time in whole milliseconds
  constructor({ input, hudRoot, spec, clock }) {
    this.input = input;
    this.spec = spec;
    this.clock = clock;
    this.queue = [];
    this.held = { a: new Set(), b: new Set() }; // what is holding each button down
    this.keys = new Set(); // direction keys held (for the stick)
    this.oneButton = spec.buttons.length === 1 && !spec.dirs && !spec.move;
    this.pad = { a: false, b: false, u: false, d: false, l: false, r: false };
    this.touchStick = false;
    this.touchButton = false;
    this.lastMove = [0, 0];
    this.moveAt = -Infinity;
    this.cleanup = [];

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };
    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => this.keyUp(e));
    on(window, 'blur', () => {
      for (const b of ['a', 'b']) for (const src of [...this.held[b]]) if (src.startsWith('key:')) this.up(b, src);
      this.keys.clear();
    });
    this.buildTouch(hudRoot, on);
  }

  push(action) {
    this.queue.push([this.clock(), action]);
  }

  down(button, source) {
    if (!this.spec.buttons.includes(button)) return;
    const held = this.held[button];
    if (held.has(source)) return;
    held.add(source);
    if (held.size === 1) this.push(['p', button]);
  }

  up(button, source) {
    const held = this.held[button];
    if (!held.delete(source)) return;
    if (held.size === 0) this.push(['r', button]);
  }

  keyDown(e) {
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    let used = false;
    if (KEY_A.has(code) || (this.oneButton && ONE_BUTTON_KEYS.has(code))) {
      if (!e.repeat) this.down('a', `key:${code}`);
      used = true;
    } else if (KEY_B.has(code) && this.spec.buttons.includes('b')) {
      if (!e.repeat) this.down('b', `key:${code}`);
      used = true;
    }
    const dir = KEY_DIRS[code];
    if (dir && (this.spec.dirs || this.spec.move)) {
      if (this.spec.dirs && !e.repeat) this.push(['d', dir]);
      this.keys.add(dir);
      used = true;
    }
    if (used) e.preventDefault();
  }

  keyUp(e) {
    this.up('a', `key:${e.code}`);
    this.up('b', `key:${e.code}`);
    const dir = KEY_DIRS[e.code];
    if (dir) this.keys.delete(dir);
  }

  buildTouch(hudRoot, on) {
    const layout = this.spec.touch;
    if (layout === 'none') return;
    // One big tap area works with a mouse too; the other layouts are for touch screens only.
    if (layout !== 'tap' && !isTouchDevice) return;

    if (layout === 'tap' || layout === 'swipe') {
      const zone = document.createElement('div');
      zone.className = 'swipe-zone';
      let swipe = null;
      on(zone, 'pointerdown', (e) => {
        e.preventDefault();
        if (layout === 'tap') this.down('a', `touch:${e.pointerId}`);
        else swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      on(zone, 'pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.hypot(dx, dy) < SWIPE_PX) return;
        this.push(['d', Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u']);
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      const lift = (e) => {
        this.up('a', `touch:${e.pointerId}`);
        if (swipe?.id === e.pointerId) swipe = null;
      };
      on(zone, 'pointerup', lift);
      on(zone, 'pointercancel', lift);
      hudRoot.appendChild(zone);
      this.cleanup.push(() => zone.remove());
      return;
    }

    if (layout === 'stick') {
      this.input.showTouchControls(hudRoot, this.spec.touchLabel ?? 'GO');
      this.touchStick = true;
      this.cleanup.push(() => this.input.hideTouchControls());
      return;
    }

    // 'hold' (hold a side to push the stick that way) or 'sides' (tap a side for a direction).
    const el = document.createElement('div');
    el.className = 'touch-controls tap-controls';
    el.innerHTML = `
      <button class="tap-zone left" type="button" aria-label="Left"><span>◀</span></button>
      <button class="tap-zone right" type="button" aria-label="Right"><span>▶</span></button>`;
    this.sideHeld = { l: new Set(), r: new Set() };
    for (const [cls, dir] of [
      ['left', 'l'],
      ['right', 'r'],
    ]) {
      const zone = el.querySelector(`.${cls}`);
      on(zone, 'pointerdown', (e) => {
        e.preventDefault();
        zone.classList.add('pressed');
        if (layout === 'sides') this.push(['d', dir]);
        else this.sideHeld[dir].add(e.pointerId);
      });
      const lift = (e) => {
        this.sideHeld[dir].delete(e.pointerId);
        if (!this.sideHeld[dir].size) zone.classList.remove('pressed');
      };
      on(zone, 'pointerup', lift);
      on(zone, 'pointercancel', lift);
      on(zone, 'pointerleave', lift);
    }
    hudRoot.appendChild(el);
    this.cleanup.push(() => el.remove());
  }

  // Reads the gamepad and the stick, then returns everything since the last call as
  // [gameTimeMs, input] pairs, oldest first.
  poll() {
    const spec = this.spec;
    let mx = 0;
    let my = 0;
    for (const dir of this.keys) {
      mx += MOVE_KEYS[dir][0];
      my += MOVE_KEYS[dir][1];
    }

    const now = { a: false, b: false, u: false, d: false, l: false, r: false };
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const b = pad.buttons;
      now.a ||= Boolean(b[0]?.pressed || (this.oneButton && b[1]?.pressed));
      now.b ||= Boolean(b[1]?.pressed && !this.oneButton);
      const [ax = 0, ay = 0] = pad.axes;
      now.l ||= Boolean(b[14]?.pressed) || ax < -0.5;
      now.r ||= Boolean(b[15]?.pressed) || ax > 0.5;
      now.u ||= Boolean(b[12]?.pressed) || ay < -0.5;
      now.d ||= Boolean(b[13]?.pressed) || ay > 0.5;
      if (Math.hypot(ax, ay) > DEADZONE) {
        mx += ax;
        my -= ay;
      }
      if (b[14]?.pressed) mx -= 1;
      if (b[15]?.pressed) mx += 1;
      if (b[12]?.pressed) my += 1;
      if (b[13]?.pressed) my -= 1;
    }
    for (const button of ['a', 'b']) {
      if (now[button] && !this.pad[button]) this.down(button, 'pad');
      if (!now[button] && this.pad[button]) this.up(button, 'pad');
    }
    if (spec.dirs) for (const dir of ['u', 'd', 'l', 'r']) if (now[dir] && !this.pad[dir]) this.push(['d', dir]);
    this.pad = now;

    if (this.touchStick) {
      mx += this.input.stick.x;
      my -= this.input.stick.z;
      const pressed = this.input.touchActionDown;
      if (pressed && !this.touchButton) this.down('a', 'touch-button');
      if (!pressed && this.touchButton) this.up('a', 'touch-button');
      this.touchButton = pressed;
    }
    if (this.sideHeld && spec.touch === 'hold') mx += (this.sideHeld.r.size ? 1 : 0) - (this.sideHeld.l.size ? 1 : 0);

    if (spec.move) {
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      // Whole steps of 0.1, so small wobbles of a real stick don't flood the network.
      const x = Math.round(mx * 10) * 10;
      const y = Math.round(my * 10) * 10;
      const t = this.clock();
      const changed = x !== this.lastMove[0] || y !== this.lastMove[1];
      if (changed && (t - this.moveAt >= MOVE_EVERY_MS || (x === 0 && y === 0))) {
        this.lastMove = [x, y];
        this.moveAt = t;
        this.push(['m', x, y]);
      }
    }

    const out = this.queue;
    this.queue = [];
    return out;
  }

  dispose() {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.input.clearAction();
  }
}

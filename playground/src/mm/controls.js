import { cleanText } from '../../../shared/mm/format.js';
import { isTouchDevice } from '../input.js';

// Turns keyboard, mouse, gamepad and touch into the inputs a packaged minigame asked for in its
// manifest (input: { buttons, dirs, move, touch, text, pointer }): button presses and releases,
// direction taps, the stick, typed text and where the pointer is in the world, each stamped with
// the game time it happened at. The game itself never sees a key, a mouse or a touch.

const KEY_A = new Set(['Space', 'Enter', 'NumpadEnter']);
const KEY_B = new Set(['ShiftLeft', 'ShiftRight', 'KeyE']);
const SHIFT = new Set(['ShiftLeft', 'ShiftRight']); // a, too, in games without b
const KEY_DIRS = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };
const MOVE_KEYS = { u: [0, 1], d: [0, -1], l: [-1, 0], r: [1, 0] };
// A one-button game takes a few more keys, a click or a tap anywhere.
const ONE_BUTTON_KEYS = new Set(['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight']);
const DEADZONE = 0.2;
const SWIPE_PX = 24;
const TURN_ORDER = 'urdl'; // clockwise
const MOVE_EVERY_MS = 33; // the stick is reported at most this often
const LIVE_EVERY_MS = 50; // and the text box's contents (input.text "live")
const POINTER_EVERY_MS = 50; // and the pointer, as it moves
const CURSOR_SPEED = 1.4; // a gamepad's cursor at full tilt, in screen heights (or widths, if less) a second

export class Controls {
  // clock() -> the current game time in whole milliseconds. hud: the game's Hud (for the text box).
  // project(x, y) -> where a point on the screen is in the world, [x, y, z] in thousandths, or null
  // (for the pointer).
  constructor({ input, hudRoot, hud, spec, clock, project }) {
    this.input = input;
    this.spec = spec;
    this.clock = clock;
    this.project = project;
    this.queue = [];
    this.held = { a: new Set(), b: new Set() }; // what is holding each button down
    this.keys = new Set(); // direction keys held (for the stick)
    this.oneButton = spec.buttons.length === 1 && !spec.dirs && !spec.move;
    this.hasB = spec.buttons.includes('b');
    this.pad = { a: false, b: false, u: false, d: false, l: false, r: false };
    this.touchStick = false;
    this.touchButton = false;
    this.lastMove = [0, 0];
    this.moveAt = -Infinity;
    this.turn = 0; // quarter turns clockwise added to every direction (mm.controls({ turn }))
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
    this.text = null;
    if (spec.text) this.buildText(hud, on);
    this.pointer = null;
    if (spec.pointer) this.buildPointer(hudRoot, on);
  }

  // Shows or hides the touch button (mm.controls({ button })), for a player who's out: hidden, it
  // lets go of a press.
  showButton(show) {
    const el = this.touchStick && this.input.touchEl?.querySelector('.dash-btn');
    if (!el || el.style.display === (show ? '' : 'none')) return;
    el.style.display = show ? '' : 'none';
    if (!show) {
      this.input.touchActionDown = false;
      el.classList.remove('pressed');
    }
  }

  // A typing game: Enter sends what's in the text box and empties it. With "live", what's in it
  // so far goes too, as it changes. On a computer, typing anywhere goes into the box.
  buildText(hud, on) {
    const box = hud.textbox(this.spec.maxLength);
    const text = (this.text = { box, hud, ready: false, live: null, sent: '', at: -Infinity });
    on(box, 'input', () => {
      if (this.spec.text === 'live') text.live = cleanText(box.value, this.spec.maxLength);
    });
    on(box.form, 'submit', (e) => {
      e.preventDefault();
      if (!text.ready) return;
      this.push(['t', cleanText(box.value, this.spec.maxLength), 1]);
      box.value = '';
      text.live = null;
      text.sent = '';
      box.focus({ preventScroll: true }); // after a tap on the send button, keep typing
    });
    on(
      window,
      'keydown',
      (e) => {
        if (!text.ready || box.form.hidden || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter') box.focus({ preventScroll: true });
      },
      { capture: true },
    );
    this.cleanup.push(() => hud.removeTextbox());
  }

  // Once the game starts, the text box opens; after that its contents go out as they change.
  pollText() {
    const text = this.text;
    const t = this.clock();
    if (!text.ready && t >= 0) {
      text.ready = true;
      text.hud.textReady();
      if (!text.box.form.hidden) text.box.focus({ preventScroll: true });
    }
    if (text.live !== null && text.live !== text.sent && t - text.at >= LIVE_EVERY_MS) {
      text.sent = text.live;
      text.at = t;
      this.push(['t', text.live, 0]);
    }
  }

  // A pointer game: the mouse, a finger (the first one down, away from any touch controls) or a
  // gamepad's cursor points at the screen. Where that is in the world goes to the game as it moves
  // (or as the camera does, under a still pointer), when it goes down and when it comes up.
  buildPointer(hudRoot, on) {
    // screen: [x, y] in CSS pixels, or null (no mouse yet, or a finger lifted). held: what's holding
    // it down ('mouse', 'touch:<id>', 'pad'). sent: the last point sent, at game time at.
    const ptr = (this.pointer = { root: hudRoot, screen: null, held: null, sent: null, at: -Infinity, cursor: null, padDown: false, padAt: 0 });
    const zone = document.createElement('div');
    zone.className = 'pointer-zone';
    hudRoot.prepend(zone); // under the HUD's buttons and the touch controls
    this.cleanup.push(() => zone.remove());
    const source = (e) => (e.pointerType === 'mouse' ? 'mouse' : `touch:${e.pointerId}`);
    on(zone, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.hideCursor();
      ptr.screen = [e.clientX, e.clientY];
      this.pointerDown(source(e));
    });
    on(window, 'pointermove', (e) => {
      // A mouse points wherever it is; a finger only while it's the one holding the pointer down.
      if (e.pointerType === 'mouse' || ptr.held === source(e)) {
        if (e.pointerType === 'mouse') this.hideCursor();
        ptr.screen = [e.clientX, e.clientY];
      }
    });
    const lift = (e) => {
      if (ptr.held !== source(e)) return;
      ptr.screen = [e.clientX, e.clientY];
      this.pointerUp();
      if (e.pointerType !== 'mouse') ptr.screen = null;
    };
    on(window, 'pointerup', lift);
    on(window, 'pointercancel', lift);
  }

  pointerDown(source) {
    const ptr = this.pointer;
    if (ptr.held || this.clock() < 0) return; // (presses before GO don't count)
    const at = this.project(...ptr.screen);
    if (!at) return;
    ptr.held = source;
    ptr.sent = at;
    ptr.at = this.clock();
    this.push(['c', 1, ...at]);
  }

  pointerUp() {
    const ptr = this.pointer;
    if (!ptr.held) return;
    ptr.held = null;
    const at = (ptr.screen && this.project(...ptr.screen)) ?? ptr.sent;
    ptr.sent = at;
    ptr.at = this.clock();
    this.push(['c', 2, ...at]);
  }

  // A gamepad's cursor: a ring on the screen its stick moves. stick: [x, y] (y down), pressed: its
  // click held.
  padPointer(stick, pressed) {
    const ptr = this.pointer;
    const now = performance.now();
    const dt = Math.min(0.1, (now - ptr.padAt) / 1000);
    ptr.padAt = now;
    const len = Math.hypot(stick[0], stick[1]);
    if (len > DEADZONE || (pressed && !ptr.padDown)) {
      if (!ptr.cursor) {
        ptr.cursor = document.createElement('div');
        ptr.cursor.className = 'pad-cursor';
        ptr.root.appendChild(ptr.cursor);
        this.cleanup.push(() => ptr.cursor.remove());
      }
      ptr.screen ??= [window.innerWidth / 2, window.innerHeight / 2];
      ptr.cursor.hidden = false;
      if (len > DEADZONE) {
        // Slow near the middle of the stick, for small moves; quick at the edge.
        const k = Math.min(1, (len - DEADZONE) / (1 - DEADZONE));
        const speed = CURSOR_SPEED * Math.min(window.innerWidth, window.innerHeight) * k * k;
        ptr.screen = [
          Math.max(0, Math.min(window.innerWidth - 1, ptr.screen[0] + (stick[0] / len) * speed * dt)),
          Math.max(0, Math.min(window.innerHeight - 1, ptr.screen[1] + (stick[1] / len) * speed * dt)),
        ];
      }
      ptr.cursor.style.transform = `translate(${ptr.screen[0]}px, ${ptr.screen[1]}px)`;
    }
    if (pressed && !ptr.padDown) this.pointerDown('pad');
    if (!pressed && ptr.padDown && ptr.held === 'pad') this.pointerUp();
    ptr.padDown = pressed;
  }

  hideCursor() {
    const ptr = this.pointer;
    if (!ptr.cursor || ptr.cursor.hidden) return;
    ptr.cursor.hidden = true;
    if (ptr.held === 'pad') this.pointerUp();
  }

  // Where the pointer is goes out as it moves, a few times a second at most.
  pollPointer() {
    const ptr = this.pointer;
    const t = this.clock();
    if (!ptr.screen || t - ptr.at < POINTER_EVERY_MS) return;
    const at = this.project(...ptr.screen);
    // (Under a hundredth of a unit isn't worth an input: a gliding camera wobbles that much.)
    if (!at || (ptr.sent && at.every((v, k) => Math.abs(v - ptr.sent[k]) < 10))) return;
    ptr.sent = at;
    ptr.at = t;
    this.push(['c', 0, ...at]);
  }

  push(action) {
    // A camera that looks along another axis turns the directions with it (mm.controls).
    if (this.turn && action[0] === 'd') action = ['d', TURN_ORDER[(TURN_ORDER.indexOf(action[1]) + this.turn) % 4]];
    if (this.turn && action[0] === 'm') {
      let [x, y] = [action[1], action[2]];
      for (let k = 0; k < this.turn; k++) [x, y] = [y, -x];
      action = ['m', x || 0, y || 0];
    }
    this.queue.push([this.clock(), action]);
  }

  // A button in the HUD (mm.hud.ask's −, + and Lock in): 'up' and 'down' send those directions
  // (as they are: they mean more and less, not a way on the screen), 'a' a press and release.
  hudAction(kind) {
    if (kind === 'up' || kind === 'down') {
      if (this.spec.dirs) this.queue.push([this.clock(), ['d', kind === 'up' ? 'u' : 'd']]);
    } else if (kind === 'a') {
      this.down('a', 'hud');
      this.up('a', 'hud');
    }
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const code = e.code;
    let used = false;
    if (KEY_A.has(code) || (this.oneButton && ONE_BUTTON_KEYS.has(code)) || (!this.hasB && SHIFT.has(code))) {
      if (!e.repeat) this.down('a', `key:${code}`);
      used = true;
    } else if (KEY_B.has(code) && this.hasB) {
      if (!e.repeat) this.down('b', `key:${code}`);
      used = true;
    }
    const dir = KEY_DIRS[code];
    if (dir && (this.spec.dirs || this.spec.move)) {
      // input.repeat: a direction key held down goes on repeating, as in a text box.
      if (this.spec.dirs && (!e.repeat || this.spec.repeat === true)) this.push(['d', dir]);
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
      // Ready (yellow) unless the game says it's recharging (mm.hud.cooldown).
      this.input.showTouchControls(hudRoot, this.spec.touchLabel ?? 'GO').classList.add('ready');
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
    let analog = false; // a real stick in play (rather than keys or a d-pad)
    // A pointer game's cursor: the right stick, or either stick and the d-pad in a game that doesn't
    // use them for anything else. A trigger or shoulder button clicks (or A, if the game has no a).
    const cursor = [0, 0];
    let click = false;
    const free = !spec.move && !spec.dirs;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const b = pad.buttons;
      if (spec.pointer) {
        const [ax = 0, ay = 0, rx = 0, ry = 0] = pad.axes;
        cursor[0] += rx + (free ? ax + (b[15]?.pressed ? 1 : 0) - (b[14]?.pressed ? 1 : 0) : 0);
        cursor[1] += ry + (free ? ay + (b[13]?.pressed ? 1 : 0) - (b[12]?.pressed ? 1 : 0) : 0);
        click ||= [4, 5, 6, 7].some((i) => b[i]?.value > 0.5) || Boolean(!spec.buttons.includes('a') && b[0]?.pressed);
      }
      now.a ||= Boolean(b[0]?.pressed || (!this.hasB && b[1]?.pressed));
      now.b ||= Boolean(b[1]?.pressed && this.hasB);
      const [ax = 0, ay = 0] = pad.axes;
      now.l ||= Boolean(b[14]?.pressed) || ax < -0.5;
      now.r ||= Boolean(b[15]?.pressed) || ax > 0.5;
      now.u ||= Boolean(b[12]?.pressed) || ay < -0.5;
      now.d ||= Boolean(b[13]?.pressed) || ay > 0.5;
      if (Math.hypot(ax, ay) > DEADZONE) {
        mx += ax;
        my -= ay;
        analog = true;
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
      if (this.input.stick.x || this.input.stick.z) analog = true;
      const pressed = this.input.touchActionDown;
      if (pressed && !this.touchButton) this.down('a', 'touch-button');
      if (!pressed && this.touchButton) this.up('a', 'touch-button');
      this.touchButton = pressed;
    }
    if (this.sideHeld && spec.touch === 'hold') mx += (this.sideHeld.r.size ? 1 : 0) - (this.sideHeld.l.size ? 1 : 0);
    if (this.text) this.pollText();
    if (this.pointer) {
      this.padPointer(cursor, click);
      this.pollPointer();
    }

    if (spec.move) {
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      // A real stick in whole steps of 0.1, so its small wobbles don't flood the network; keys and
      // d-pads to the hundredth, so a diagonal is as long as straight ahead (0.71, not 0.7).
      const x = analog ? Math.round(mx * 10) * 10 : Math.round(mx * 100);
      const y = analog ? Math.round(my * 10) * 10 : Math.round(my * 100);
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

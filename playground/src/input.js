// Merges keyboard, gamepad and on-screen touch controls into one move vector + one action
// button (dash in Bumper Bash, jump in Sky Sprint), plus a queue of discrete left / right / up
// taps for games played one press at a time (Beanstalk Blitz).
// Move is in world space as seen from the default camera: +x is right, +z is toward the camera.

const DEADZONE = 0.2;
const STICK_RADIUS = 56; // px the touch stick can travel
const MAX_TAPS = 8;
const TAP_KEYS = { KeyA: 'L', ArrowLeft: 'L', KeyD: 'R', ArrowRight: 'R', KeyW: 'U', ArrowUp: 'U', Space: 'U' };
// Everything a minigame puts on screen to press (its HUD, buttons and tap / swipe areas).
const GAME_CONTROLS = '.hud, .touch-controls, .swipe-zone';

export const isTouchDevice = matchMedia('(pointer: coarse)').matches;

export class Input {
  constructor() {
    this.keys = new Set();
    this.actionQueued = false;
    this.padActionDown = false;
    this.touchActionDown = false;
    this.stick = { x: 0, z: 0 };
    this.touchEl = null;
    this.taps = [];
    this.padTaps = { L: false, R: false, U: false };

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
      if (!e.repeat && TAP_KEYS[e.code]) this.pushTap(TAP_KEYS[e.code]);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!e.repeat) this.actionQueued = true;
        e.preventDefault();
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // Holding a button down on a phone is a long press, which opens the context menu.
    window.addEventListener('contextmenu', (e) => {
      if (e.target instanceof Element && e.target.closest(GAME_CONTROLS)) e.preventDefault();
    });
  }

  move() {
    const k = this.keys;
    let x = 0;
    let z = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;

    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const [ax = 0, az = 0] = pad.axes;
      if (Math.hypot(ax, az) > DEADZONE) {
        x += ax;
        z += az;
      }
      const b = pad.buttons;
      if (b[14]?.pressed) x -= 1;
      if (b[15]?.pressed) x += 1;
      if (b[12]?.pressed) z -= 1;
      if (b[13]?.pressed) z += 1;
      const actionDown = Boolean(b[0]?.pressed || b[1]?.pressed);
      if (actionDown && !this.padActionDown) this.actionQueued = true;
      this.padActionDown = actionDown;
    }

    x += this.stick.x;
    z += this.stick.z;

    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  // True once per press of the action button.
  consumeAction() {
    const pressed = this.actionQueued;
    this.actionQueued = false;
    return pressed;
  }

  clearAction() {
    this.actionQueued = false;
  }

  // Whether the action button is currently held down (gamepad state is read in move()).
  actionHeld() {
    const k = this.keys;
    return k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || this.padActionDown || this.touchActionDown;
  }

  pushTap(tap) {
    this.taps.push(tap);
    if (this.taps.length > MAX_TAPS) this.taps.shift();
  }

  // Left / right / up presses ('L' | 'R' | 'U') since the last call, oldest first.
  consumeTaps() {
    const now = { L: false, R: false, U: false };
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const ax = pad.axes[0] ?? 0;
      const b = pad.buttons;
      if (ax < -0.5 || b[14]?.pressed) now.L = true;
      if (ax > 0.5 || b[15]?.pressed) now.R = true;
      if (b[0]?.pressed || b[12]?.pressed) now.U = true;
    }
    for (const tap of ['L', 'R', 'U']) if (now[tap] && !this.padTaps[tap]) this.pushTap(tap);
    this.padTaps = now;
    const taps = this.taps;
    this.taps = [];
    return taps;
  }

  // Two big buttons splitting the screen in half: tap a side to hop that way.
  showTapControls(parent) {
    this.hideTouchControls();
    const el = document.createElement('div');
    el.className = 'touch-controls tap-controls';
    el.innerHTML = `
      <button class="tap-zone left" type="button" aria-label="Hop left"><span>◀</span></button>
      <button class="tap-zone right" type="button" aria-label="Hop right"><span>▶</span></button>`;
    for (const [cls, tap] of [
      ['left', 'L'],
      ['right', 'R'],
    ]) {
      const zone = el.querySelector(`.${cls}`);
      zone.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pushTap(tap);
        zone.classList.add('pressed');
      });
      const unpress = () => zone.classList.remove('pressed');
      zone.addEventListener('pointerup', unpress);
      zone.addEventListener('pointercancel', unpress);
      zone.addEventListener('pointerleave', unpress);
    }
    parent.appendChild(el);
    this.touchEl = el;
    return el;
  }

  // The same two big buttons, but held down: holding the left one is like holding A (← ), the
  // right one like holding D (→). Feeds move().x, so it works anywhere the keys do.
  showHoldControls(parent, labels = ['Lean left', 'Lean right']) {
    this.hideTouchControls();
    const el = document.createElement('div');
    el.className = 'touch-controls tap-controls';
    el.innerHTML = `
      <button class="tap-zone left" type="button" aria-label="${labels[0]}"><span>◀</span></button>
      <button class="tap-zone right" type="button" aria-label="${labels[1]}"><span>▶</span></button>`;
    const held = { left: new Set(), right: new Set() };
    const apply = () => {
      this.stick.x = (held.right.size ? 1 : 0) - (held.left.size ? 1 : 0);
    };
    for (const side of ['left', 'right']) {
      const zone = el.querySelector(`.${side}`);
      zone.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        held[side].add(e.pointerId);
        zone.classList.add('pressed');
        apply();
      });
      const lift = (e) => {
        held[side].delete(e.pointerId);
        if (!held[side].size) zone.classList.remove('pressed');
        apply();
      };
      zone.addEventListener('pointerup', lift);
      zone.addEventListener('pointercancel', lift);
      zone.addEventListener('pointerleave', lift);
    }
    parent.appendChild(el);
    this.touchEl = el;
    return el;
  }

  // Floating thumbstick on the left half of the screen and an action button on the right.
  showTouchControls(parent, label = 'DASH') {
    this.hideTouchControls();
    const el = document.createElement('div');
    el.className = 'touch-controls';
    el.innerHTML = `
      <div class="touch-zone"></div>
      <div class="stick-base" hidden><div class="stick-knob"></div></div>
      <button class="dash-btn" type="button"><span>${label}</span></button>`;
    parent.appendChild(el);
    this.touchEl = el;

    const zone = el.querySelector('.touch-zone');
    const base = el.querySelector('.stick-base');
    const knob = el.querySelector('.stick-knob');
    let pointerId = null;
    let originX = 0;
    let originY = 0;

    zone.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      zone.setPointerCapture(pointerId);
      originX = e.clientX;
      originY = e.clientY;
      base.hidden = false;
      base.style.transform = `translate(${originX}px, ${originY}px)`;
      knob.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      let dx = e.clientX - originX;
      let dy = e.clientY - originY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const mag = Math.hypot(dx, dy) / STICK_RADIUS;
      this.stick.x = mag > DEADZONE ? dx / STICK_RADIUS : 0;
      this.stick.z = mag > DEADZONE ? dy / STICK_RADIUS : 0;
    });
    const release = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      base.hidden = true;
      this.stick.x = 0;
      this.stick.z = 0;
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    const actionBtn = el.querySelector('.dash-btn');
    actionBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.actionQueued = true;
      this.touchActionDown = true;
      actionBtn.classList.add('pressed');
    });
    const unpress = () => {
      this.touchActionDown = false;
      actionBtn.classList.remove('pressed');
    };
    actionBtn.addEventListener('pointerup', unpress);
    actionBtn.addEventListener('pointercancel', unpress);
    actionBtn.addEventListener('pointerleave', unpress);

    return actionBtn;
  }

  hideTouchControls() {
    this.touchEl?.remove();
    this.touchEl = null;
    this.touchActionDown = false;
    this.stick.x = 0;
    this.stick.z = 0;
  }
}

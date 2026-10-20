import { isTouchDevice } from '../input.js';
import { sfx } from '../sfx.js';

// The HUD parts a packaged minigame can use (mm.hud in the sandbox), built from the same
// elements and styles as every other game: score chips, the timer, a race meter, the big
// center pop, the banner, and a typing game's text box. Everything the game passes in is
// checked and only ever used as text, never as HTML.

const COLOR = /^#[0-9a-f]{3,8}$/i;
const POP_STYLES = new Set(['count', 'go', 'bad', 'big']);
const BANNER_STYLES = new Set(['info', 'warn', 'section']);

const str = (v, max) => String(v ?? '').slice(0, max);
const ms = (v, def) => (Number.isFinite(v) ? Math.max(0, Math.min(10000, v)) : def);

export class Hud {
  // players: [{ name, color, me }] in player order
  constructor(root, { players, hint }) {
    this.root = root;
    this.players = players;
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-chips"></div>
        <div class="hud-timer" hidden><span class="hud-timer-label">Time</span><span class="hud-timer-value"></span></div>
      </div>
      <div class="hud-banner" hidden></div>
      <div class="hud-center"></div>
      <div class="hud-bottom" hidden><div class="hud-hint"></div></div>`;
    root.appendChild(this.el);
    this.chipsEl = this.el.querySelector('.hud-chips');
    this.timerEl = this.el.querySelector('.hud-timer');
    this.timerLabel = this.el.querySelector('.hud-timer-label');
    this.timerValue = this.el.querySelector('.hud-timer-value');
    this.bannerEl = this.el.querySelector('.hud-banner');
    this.centerEl = this.el.querySelector('.hud-center');
    if (hint) {
      this.el.querySelector('.hud-bottom').hidden = false;
      this.el.querySelector('.hud-hint').textContent = hint;
    } else {
      this.el.querySelector('.hud-hint').hidden = true;
    }
    this.chips = null;
    this.outList = [];
    this.meterDots = null;
    this.lastSecond = null;
    this.typeForm = null;
    this.typeOptions = { show: true, placeholder: '' }; // as the game last set them
    this.cooldownEl = null;
    this.statusEl = null;
    this.calloutEl = null;
    this.buttonLabel = 'READY'; // the cooldown meter's label: the touch button's (set by the host)
  }

  apply(part, a, b) {
    if (part === 'scores') this.scores(a);
    else if (part === 'out') this.out(a);
    else if (part === 'timer') this.timer(a);
    else if (part === 'meter') this.meter(a);
    else if (part === 'center') this.center(a, b);
    else if (part === 'banner') this.banner(a, b);
    else if (part === 'textbox') this.textOptions(a);
    else if (part === 'cooldown') this.cooldown(a);
    else if (part === 'status') this.status(a);
    else if (part === 'callout') this.callout(a);
  }

  scores(values) {
    if (!Array.isArray(values)) return;
    if (!this.chips) {
      this.chipsEl.classList.toggle('many', this.players.length > 4);
      this.chips = this.players.map((p) => {
        const chip = document.createElement('div');
        chip.className = `chip${p.me ? ' me' : ''}`;
        chip.style.setProperty('--c', p.color);
        chip.innerHTML = '<span class="chip-dot"></span><span class="chip-name"></span><span class="chip-score"></span>';
        chip.querySelector('.chip-name').textContent = p.name;
        this.chipsEl.appendChild(chip);
        return chip.querySelector('.chip-score');
      });
      this.out(this.outList);
    }
    // An empty score leaves the chip with just the name.
    this.chips.forEach((el, i) => {
      const text = values[i] === null || values[i] === undefined ? '' : str(values[i], 8);
      if (el.textContent !== text) el.textContent = text;
      el.hidden = text === '';
    });
  }

  // Greys out the chips of players who are out.
  out(list) {
    this.outList = Array.isArray(list) ? list.filter(Number.isInteger) : [];
    this.chips?.forEach((score, i) => score.parentElement.classList.toggle('out', this.outList.includes(i)));
  }

  // seconds left, or { left, label, urgent, seconds } (see mm.hud.timer).
  timer(value) {
    const options = value !== null && typeof value === 'object' ? value : {};
    const seconds = value !== null && typeof value === 'object' ? value.left : value;
    if (seconds === null || !Number.isFinite(seconds)) {
      this.timerEl.hidden = true;
      return;
    }
    const secs = Math.max(0, Math.min(5999, Math.round(seconds)));
    this.timerEl.hidden = false;
    const label = typeof options.label === 'string' && options.label.trim() ? str(options.label, 16) : 'Time';
    if (this.timerLabel.textContent !== label) this.timerLabel.textContent = label;
    this.timerValue.textContent = options.seconds === true ? String(secs) : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const urgentFrom = Number.isFinite(options.urgent) ? Math.max(0, Math.min(60, options.urgent)) : 10;
    const urgent = secs <= urgentFrom && secs > 0;
    this.timerEl.classList.toggle('urgent', urgent);
    if (urgent && secs !== this.lastSecond) sfx.tick();
    this.lastSecond = secs;
  }

  // How ready the a button is (0 to 1, or null to hide it): the touch button fills up, and on a
  // keyboard or gamepad a meter labelled like the touch button shows above the controls hint.
  cooldown(value) {
    const ready = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
    const button = this.root.querySelector('.dash-btn');
    if (button) {
      button.style.setProperty('--cd', ready ?? 1);
      button.classList.toggle('ready', ready !== null && ready >= 1);
    }
    if (isTouchDevice) return;
    if (!this.cooldownEl && ready !== null) {
      const bottom = this.el.querySelector('.hud-bottom');
      this.cooldownEl = document.createElement('div');
      this.cooldownEl.className = 'dash-meter';
      this.cooldownEl.innerHTML = '<div class="dash-fill"></div><span></span>';
      this.cooldownEl.querySelector('span').textContent = this.buttonLabel;
      bottom.prepend(this.cooldownEl);
      bottom.hidden = false;
    }
    if (!this.cooldownEl) return;
    this.cooldownEl.hidden = ready === null;
    this.cooldownEl.querySelector('.dash-fill').style.transform = `scaleX(${ready ?? 0})`;
    this.cooldownEl.classList.toggle('ready', ready !== null && ready >= 1);
  }

  // A short line in a pill along the top, beside the chips ("Round 3/12"), or null to hide it.
  status(text) {
    const value = text === null || text === undefined ? '' : str(text, 24);
    if (!this.statusEl) {
      if (!value) return;
      this.statusEl = document.createElement('div');
      this.statusEl.className = 'flag-round';
      const top = this.el.querySelector('.hud-top');
      top.insertBefore(this.statusEl, this.timerEl);
    }
    this.statusEl.hidden = !value;
    if (this.statusEl.textContent !== value) this.statusEl.textContent = value;
  }

  // The big call of the moment ("RED!"): { text, color, icon, progress (0 to 1: a bar that runs
  // down, or null for none), flash }, or null to hide it. It pops in when its text or color
  // changes. Off to the left on wide screens, along the top on narrow ones.
  callout(o) {
    if (!o || typeof o !== 'object') {
      if (this.calloutEl) this.calloutEl.hidden = true;
      return;
    }
    if (!this.calloutEl) {
      const el = (this.calloutEl = document.createElement('div'));
      el.className = 'flag-call';
      el.innerHTML = '<span class="flag-swatch"></span><span class="flag-name"></span><span class="flag-bar"><i></i></span>';
      this.el.insertBefore(el, this.bannerEl);
      this.calloutKey = '';
    }
    const el = this.calloutEl;
    const color = COLOR.test(String(o.color)) ? o.color : '#2a1840';
    const text = str(o.text, 24);
    const icon = str(o.icon, 4);
    el.hidden = false;
    if (`${text}|${color}` !== this.calloutKey) {
      this.calloutKey = `${text}|${color}`;
      el.style.setProperty('--c', color);
      el.querySelector('.flag-swatch').textContent = icon;
      el.querySelector('.flag-swatch').hidden = !icon;
      el.querySelector('.flag-name').textContent = text;
      // Pop in again.
      el.classList.remove('fresh');
      void el.offsetWidth;
      el.classList.add('fresh');
    }
    const bar = el.querySelector('.flag-bar');
    const progress = Number.isFinite(o.progress) ? Math.max(0, Math.min(1, o.progress)) : null;
    bar.hidden = progress === null;
    if (progress !== null) bar.firstChild.style.transform = `scaleX(${progress})`;
    el.classList.toggle('sinking', o.flash === true);
  }

  // { icon, values: [0..1 per player], stops: ['#hex' | ['#hex', percent]] }
  meter(options) {
    if (!options || typeof options !== 'object') return;
    if (!this.meterDots) {
      const tower = document.createElement('div');
      tower.className = 'climb-tower';
      tower.innerHTML = '<span class="climb-star"></span><div class="climb-track"></div>';
      tower.querySelector('.climb-star').textContent = str(options.icon, 4);
      const track = tower.querySelector('.climb-track');
      const stops = Array.isArray(options.stops) ? options.stops : [];
      const css = stops
        .map((s) => (Array.isArray(s) ? [s[0], s[1]] : [s, null]))
        .filter(([c, at]) => COLOR.test(String(c)) && (at === null || Number.isFinite(at)))
        .map(([c, at]) => (at === null ? c : `${c} ${Math.max(0, Math.min(100, at))}%`));
      if (css.length >= 2) track.style.background = `linear-gradient(${css.join(', ')})`;
      this.meterDots = this.players.map((p) => {
        const dot = document.createElement('span');
        dot.className = `climb-dot${p.me ? ' me' : ''}`;
        dot.style.setProperty('--c', p.color);
        track.appendChild(dot);
        return dot;
      });
      this.el.appendChild(tower);
    }
    const values = Array.isArray(options.values) ? options.values : [];
    this.meterDots.forEach((dot, i) => {
      const v = Number.isFinite(values[i]) ? Math.max(0, Math.min(1, values[i])) : 0;
      dot.style.bottom = `${v * 100}%`;
    });
  }

  // A big word in the middle of the screen ("3", "GO!", "YOU WIN!"). ms = 0 keeps it up.
  center(text, options = {}) {
    const el = document.createElement('div');
    el.className = `pop${POP_STYLES.has(options?.style) ? ` ${options.style}` : ''}`;
    el.textContent = str(text, 40);
    this.centerEl.replaceChildren(el);
    clearTimeout(this.centerTimer);
    const keep = ms(options?.ms, 900);
    if (keep > 0) this.centerTimer = setTimeout(() => el.remove(), keep);
  }

  banner(text, options = {}) {
    const b = this.bannerEl;
    clearTimeout(this.bannerTimer);
    const value = str(text, 120);
    b.hidden = !value;
    if (!value) return;
    b.className = `hud-banner${BANNER_STYLES.has(options?.style) ? ` ${options.style}` : ''}`;
    b.textContent = value;
    const keep = ms(options?.ms, 0);
    if (keep > 0) this.bannerTimer = setTimeout(() => (b.hidden = true), keep);
  }

  // A typing game's text box (made by controls.js for players, not spectators), along the bottom
  // and above a phone's keyboard while it's up. It stays off until the game starts. Returns the
  // <input>.
  textbox(maxLength) {
    const form = document.createElement('form');
    form.className = 'hud-type';
    form.innerHTML = `
      <input class="hud-type-input" type="text" maxlength="${maxLength}" autocomplete="off" autocapitalize="off"
        autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Type here" disabled />
      <button class="hud-type-send" type="submit" aria-label="Send" disabled>⏎</button>`;
    this.el.appendChild(form);
    this.typeForm = form;
    const vv = window.visualViewport;
    if (vv) {
      const place = () => form.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
      vv.addEventListener('resize', place);
      vv.addEventListener('scroll', place);
      this.typeUnplace = () => {
        vv.removeEventListener('resize', place);
        vv.removeEventListener('scroll', place);
      };
    }
    this.textOptions(this.typeOptions);
    return form.querySelector('input');
  }

  // Lets the player type (once the game has started).
  textReady() {
    if (!this.typeForm) return;
    for (const el of this.typeForm.elements) el.disabled = false;
    this.textOptions(this.typeOptions);
  }

  // { show, placeholder } from the game.
  textOptions(options) {
    if (!options || typeof options !== 'object') return;
    this.typeOptions = { show: options.show !== false, placeholder: str(options.placeholder, 60) };
    const form = this.typeForm;
    if (!form) return;
    const input = form.querySelector('input');
    form.hidden = !this.typeOptions.show;
    input.placeholder = input.disabled ? 'Get ready…' : this.typeOptions.placeholder || 'Type here';
    if (form.hidden && document.activeElement === input) input.blur();
  }

  removeTextbox() {
    this.typeUnplace?.();
    this.typeUnplace = null;
    this.typeForm?.remove();
    this.typeForm = null;
  }

  dispose() {
    this.removeTextbox();
    clearTimeout(this.centerTimer);
    clearTimeout(this.bannerTimer);
    this.el.remove();
  }
}

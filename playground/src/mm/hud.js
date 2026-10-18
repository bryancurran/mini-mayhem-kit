import { sfx } from '../sfx.js';

// The HUD parts a packaged minigame can use (mm.hud in the sandbox), built from the same
// elements and styles as every other game: score chips, the timer, a race meter, the big
// center pop and the banner. Everything the game passes in is checked and only ever used as
// text, never as HTML.

const COLOR = /^#[0-9a-f]{3,8}$/i;
const POP_STYLES = new Set(['count', 'go', 'bad', 'big']);
const BANNER_STYLES = new Set(['info', 'warn', 'section']);

const str = (v, max) => String(v ?? '').slice(0, max);
const ms = (v, def) => (Number.isFinite(v) ? Math.max(0, Math.min(10000, v)) : def);

export class Hud {
  // players: [{ name, color, me }] in player order
  constructor(root, { players, hint }) {
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
    this.timerValue = this.el.querySelector('.hud-timer-value');
    this.bannerEl = this.el.querySelector('.hud-banner');
    this.centerEl = this.el.querySelector('.hud-center');
    if (hint) {
      this.el.querySelector('.hud-bottom').hidden = false;
      this.el.querySelector('.hud-hint').textContent = hint;
    }
    this.chips = null;
    this.outList = [];
    this.meterDots = null;
    this.lastSecond = null;
  }

  apply(part, a, b) {
    if (part === 'scores') this.scores(a);
    else if (part === 'out') this.out(a);
    else if (part === 'timer') this.timer(a);
    else if (part === 'meter') this.meter(a);
    else if (part === 'center') this.center(a, b);
    else if (part === 'banner') this.banner(a, b);
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
    this.chips.forEach((el, i) => {
      const text = str(values[i], 8);
      if (el.textContent !== text) el.textContent = text;
    });
  }

  // Greys out the chips of players who are out.
  out(list) {
    this.outList = Array.isArray(list) ? list.filter(Number.isInteger) : [];
    this.chips?.forEach((score, i) => score.parentElement.classList.toggle('out', this.outList.includes(i)));
  }

  timer(seconds) {
    if (seconds === null || !Number.isFinite(seconds)) {
      this.timerEl.hidden = true;
      return;
    }
    const secs = Math.max(0, Math.min(5999, Math.round(seconds)));
    this.timerEl.hidden = false;
    this.timerValue.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const urgent = secs <= 10 && secs > 0;
    this.timerEl.classList.toggle('urgent', urgent);
    if (urgent && secs !== this.lastSecond) sfx.tick();
    this.lastSecond = secs;
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

  dispose() {
    clearTimeout(this.centerTimer);
    clearTimeout(this.bannerTimer);
    this.el.remove();
  }
}

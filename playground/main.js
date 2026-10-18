import './src/style.css';
import './playground.css';
import ENGINE from '../shared/mm/prelude-rules.js?raw';
import { registerMinigame } from '../shared/minigames.js';
import { lobbyInfo } from '../shared/mm/format.js';
import { localGame } from '../shared/mm/local-game.js';
import { Engine } from './src/engine.js';
import { Input } from './src/input.js';
import { loadPackage } from './src/mm/catalog.js';
import { scriptedView } from './src/mm/host.js';
import { loadQuickJS } from './src/mm/quickjs.js';

// The playground: plays a game from games/ or examples/ in this browser, with the same drawing,
// HUD and controls as Mini Mayhem. A local stand-in for the server runs here too, and your
// connection can be given a delay so you see how prediction feels online.
//
// URL: ?game=<id>&bots=3&lag=0 (ms each way)&seed=7 (the same game.random() every time).
// &autoplay presses buttons for you (screenshots).

const COLORS = ['#ff4d5e', '#3d8bff', '#3ccf4e', '#ffc83d', '#a65bff', '#ff8f2e', '#ff6fcf', '#2ed9d9'];
const BOT_NAMES = ['Ava', 'Kai', 'Mo', 'Lu', 'Zed', 'Pip', 'Rex'];
const params = new URLSearchParams(location.search);
const id = params.get('game');
const bots = Math.max(0, Math.min(7, Number(params.get('bots') ?? 3) || 0));
const lag = Math.max(0, Math.min(1000, Number(params.get('lag') ?? 0) || 0));
const autoplay = params.has('autoplay');
const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
const dev = document.getElementById('dev');
const ui = document.getElementById('ui');
const errors = [];

// Read by `npm run shot` and handy in the console.
const pg = (window.__playground = { ready: false, time: () => -Infinity, results: null, errors, view: null, game: null });

window.addEventListener('error', (e) => errors.push(e.message));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message ?? e.reason)));
for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    errors.push(args.map(String).join(' ').slice(0, 300));
    original(...args);
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

if (!id) showPicker();
else start().catch((e) => showError(e.message));

async function showPicker() {
  const list = await (await fetch('mm/index.json')).json();
  const link = (g) => `<a class="pg-game" href="?game=${encodeURIComponent(g.id)}"><b>${esc(g.name ?? g.id)}</b><small>${esc(g.folder)}/${esc(g.dir)}${g.error ? ` · ${esc(g.error)}` : ''}</small></a>`;
  ui.innerHTML = `<div class="pg-picker card"><h2>Playground</h2><p>Pick a game to try:</p>${list.map(link).join('') || '<p>No games yet. Make one with <code>npm run new my-game</code>.</p>'}</div>`;
}

function showError(message) {
  ui.innerHTML = `<div class="pg-picker card"><h2>Couldn’t start the game</h2><pre class="pg-error">${esc(message)}</pre><p><a href="?">Back to the list</a></p></div>`;
}

async function start() {
  // Packing problems (a bad manifest, a missing file) come back as an error message.
  const res = await fetch(`mm/${encodeURIComponent(id)}.mm`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const [pkg, QuickJS] = await Promise.all([loadPackage(id), loadQuickJS()]);
  const m = pkg.manifest;
  registerMinigame(lobbyInfo(m));
  document.title = `${m.name} · playground`;

  const ids = ['you', ...BOT_NAMES.slice(0, bots).map((n) => n.toLowerCase())];
  const players = new Map(ids.map((pid, i) => [pid, { id: pid, name: i === 0 ? 'You' : BOT_NAMES[i - 1], color: COLORS[i] }]));
  const Game = localGame(pkg, { QuickJS, ENGINE, clock: performance, log: console, seed });
  const game = new Game(ids);
  pg.game = game;
  if (game.crashed) throw new Error(`The rules crashed while starting:\n${game.crashed}`);

  // Our connection to the "server": everything is delayed by `lag` each way.
  const net = {
    offset: 0,
    serverNow: () => performance.now(),
    seedClock() {},
    send(type, data) {
      if (type === 'input') setTimeout(() => game.handleInput('you', data), lag);
    },
  };
  const engine = new Engine(document.getElementById('stage'));
  const View = scriptedView({ id: m.id });
  const view = new View({ net, input: new Input(), meId: 'you', participants: ids, players, init: game.getInit(), hudRoot: ui });
  pg.view = view;
  engine.setView(view);
  pg.time = () => (performance.now() - game.goAt) / 1000;

  // The server's loop, like the real one: fixed ticks, snapshots ten times a second and
  // whenever there's news.
  const stepMs = 1000 / Game.tickRate;
  const sendEvery = Math.max(1, Math.round(Game.tickRate / Game.sendRate));
  let last = performance.now();
  let acc = 0;
  let ticks = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - last), 250);
    last = now;
    while (acc >= stepMs) {
      acc -= stepMs;
      game.step();
      ticks++;
      if (ticks % sendEvery === 0 || game.isFinished() || game.wantsSnapshot()) {
        const snap = { type: 'snap', t: performance.now(), ...game.snapshot() };
        setTimeout(() => view.onSnapshot(snap), lag);
      }
      if (game.isFinished()) {
        clearInterval(loop);
        const results = game.getResults();
        pg.endedAt = pg.time();
        pg.results = results;
        setTimeout(() => {
          view.onGameOver({ results });
          setTimeout(() => showResults(results, players), 1800);
        }, lag);
        return;
      }
    }
  }, stepMs / 2);

  startBots(game, ids.slice(1), m.input);
  if (autoplay) startAutoplay(m.input);
  pg.ready = true;
  if (!autoplay) showDev(view, m); // screenshots show just the game
}

// Bots press random (but valid) inputs, a few times a second.
function startBots(game, botIds, spec) {
  for (const botId of botIds) {
    let c = 0;
    const press = () => {
      if (game.isFinished()) return;
      const t = Math.round(performance.now() - game.goAt);
      const send = (a, at = t) => at >= 0 && game.handleInput(botId, { a, t: at, c: ++c });
      const choices = [spec.buttons.length && 'button', spec.dirs && 'dir', spec.move && 'move'].filter(Boolean);
      const pick = choices[Math.floor(Math.random() * choices.length)];
      if (pick === 'button') {
        const b = spec.buttons[Math.floor(Math.random() * spec.buttons.length)];
        send(['p', b]);
        send(['r', b], t + 80);
      } else if (pick === 'dir') send(['d', 'udlr'[Math.floor(Math.random() * 4)]]);
      else if (pick === 'move') send(['m', Math.round((Math.random() * 2 - 1) * 10) * 10, Math.round((Math.random() * 2 - 1) * 10) * 10]);
      setTimeout(press, 200 + Math.random() * 800);
    };
    setTimeout(press, Math.random() * 1000);
  }
}

// For screenshots: plays for you through the real keyboard controls.
function startAutoplay(spec) {
  const key = (code, ms) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), ms);
  };
  const tick = () => {
    const r = Math.random();
    if (spec.buttons.length && (r < 0.4 || (!spec.move && !spec.dirs))) key(spec.buttons.includes('b') && Math.random() < 0.3 ? 'ShiftLeft' : 'Space', 80);
    else if (spec.move || spec.dirs) key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][Math.floor(Math.random() * 4)], 150 + Math.random() * 450);
    setTimeout(tick, 250 + Math.random() * 500);
  };
  setTimeout(tick, 500);
}

function showResults(results, players) {
  const el = document.getElementById('overlay');
  el.innerHTML = `<div class="results-overlay"><div class="card results-card"><div class="eyebrow">Playground</div><h2>Results</h2>
    <ol class="result-list">${results
      .map((r) => `<li class="result place-${r.place}" style="--c:${players.get(r.id).color};--i:0"><span class="medal">${r.place}.</span><span class="dot"></span><span class="rname">${esc(players.get(r.id).name)}</span></li>`)
      .join('')}</ol>
    <button class="btn primary" type="button" onclick="location.reload()">Play again</button></div></div>`;
}

// A small panel in the corner: the clock, sandbox time, prediction and sync, delay and bots.
function showDev(view, m) {
  const options = (values, current) => values.map((v) => `<option${v === current ? ' selected' : ''}>${v}</option>`).join('');
  const open = matchMedia('(min-width: 700px)').matches ? ' open' : '';
  dev.innerHTML = `<details${open}><summary>${esc(m.name)}</summary>
    <div class="pg-stats"></div>
    <label>Delay <select data-k="lag">${options([0, 50, 100, 200, 400], lag)}</select> ms</label>
    <label>Bots <select data-k="bots">${options([0, 1, 2, 3, 5, 7], bots)}</select></label>
    <div class="pg-buttons"><button type="button" data-a="restart">Restart</button><button type="button" data-a="state">Log state</button><a href="?">All games</a></div>
    <div class="pg-errors"></div></details>`;
  dev.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    params.set(k, e.target.value);
    location.search = params.toString();
  });
  dev.addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (a === 'restart') location.reload();
    if (a === 'state') console.log('predicted state', view.debugState(), '\nconfirmed state', view.debugState(true));
  });
  const stats = dev.querySelector('.pg-stats');
  const errs = dev.querySelector('.pg-errors');
  setInterval(() => {
    const s = view.stats;
    const t = pg.time();
    stats.textContent = `time ${t.toFixed(1)}s · sandbox ${s.frames ? (s.sandboxMs / s.frames).toFixed(2) : '–'} ms/frame · rebuilds ${s.rebuilds} · checks ${s.checks}${s.desyncs ? ` · OUT OF SYNC ×${s.desyncs}` : ''}`;
    errs.innerHTML = errors.slice(-4).map((e) => `<div>${esc(e)}</div>`).join('');
  }, 250);
}

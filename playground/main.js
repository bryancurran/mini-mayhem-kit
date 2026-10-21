import './src/style.css';
import './playground.css';
import ENGINE from '../shared/mm/prelude-rules.js?raw';
import { registerMinigame } from '../shared/minigames.js';
import { MM, botWord, cleanText, lobbyInfo } from '../shared/mm/format.js';
import { localGame } from '../shared/mm/local-game.js';
import { Engine } from './src/engine.js';
import { Input } from './src/input.js';
import { loadPackage } from './src/mm/catalog.js';
import { scriptedView } from './src/mm/host.js';
import { loadQuickJS } from './src/mm/quickjs.js';
import { playSound, setLoop, setMusic, setSoundBase } from './src/sounds.js';

// The playground: plays a game from games/ or examples/ in this browser, with the same drawing,
// HUD and controls as Mini Mosh. A local stand-in for the server runs here too, and your
// connection can be given a delay so you see how prediction feels online.
//
// URL: ?game=<id>&bots=3&lag=0 (ms each way)&seed=7 (the same game.random() every time).
// &autoplay presses buttons (or types) for you (screenshots). &slow gives the game's scripts ten
// times as long before they're stopped for taking too long, for a machine that's slow at drawing
// (the server's screenshots draw without a graphics card). ?sounds: the sound library, to listen
// to (npm run sounds).

// The sound library's files come from Mini Mosh's server (MM_SERVER, set by tools/playground.mjs).
setSoundBase(new URL('sounds/', import.meta.env.MM_SERVER || 'https://minimosh.io/').href);

const COLORS = ['#ff4d5e', '#3d8bff', '#3ccf4e', '#ffc83d', '#a65bff', '#ff8f2e', '#ff6fcf', '#2ed9d9'];
const BOT_NAMES = ['Ava', 'Kai', 'Mo', 'Lu', 'Zed', 'Pip', 'Rex'];
const params = new URLSearchParams(location.search);
const id = params.get('game');
const bots = Math.max(0, Math.min(7, Number(params.get('bots') ?? 3) || 0));
const lag = Math.max(0, Math.min(1000, Number(params.get('lag') ?? 0) || 0));
const autoplay = params.has('autoplay');
const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
if (params.has('slow')) {
  // The limits still hold everywhere that matters: in the check, on the server and in players'
  // browsers.
  for (const k of Object.keys(MM.deadline)) MM.deadline[k] *= 10;
  MM.clientCpuShare = 1;
}
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

if (params.has('sounds')) showSounds();
else if (!id) showPicker();
else start().catch((e) => showError(e.message));

async function showPicker() {
  const list = await (await fetch('mm/index.json')).json();
  const link = (g) => `<a class="pg-game" href="?game=${encodeURIComponent(g.id)}"><b>${esc(g.name ?? g.id)}</b><small>${esc(g.folder)}/${esc(g.dir)}${g.error ? ` · ${esc(g.error)}` : ''}</small></a>`;
  ui.innerHTML = `<div class="pg-picker card"><h2>Playground</h2><p>Pick a game to try:</p>${list.map(link).join('') || '<p>No games yet. Make one with <code>npm run new my-game</code>.</p>'}<p><a href="?sounds">The sound library</a>: every sound and music loop a game can play.</p></div>`;
}

// The sound library (npm run sounds): every sound with a button for each of its takes, the loops
// with a button to loop them, and the music, searchable by name and words. Clicking a name copies
// the line that plays it.
async function showSounds() {
  const lib = (await import('../shared/sounds/library.json')).default;
  const secs = (s) => (s < 10 ? s.toFixed(1) : Math.round(s)) + ' s';
  const sound = ([name, s]) =>
    `<div class="pg-sound" data-words="${esc(`${name} ${s.tags}`)}"><button type="button" class="pg-name" data-copy="mm.sound('${name}')" title="Copy mm.sound('${name}')">${esc(name)}</button>
      <span class="pg-takes">${s.takes.map((t, i) => `<button type="button" data-play="${esc(name)}" data-take="${i + 1}" title="Take ${i + 1}: ${secs(t[1])}">${s.takes.length > 1 ? i + 1 : '▶'}</button>`).join('')}${
        s.loop ? `<button type="button" class="pg-loop" data-loop="${esc(name)}">loop</button>` : ''
      }</span><small>${secs(s.takes[0][1])}${s.takes.length > 1 ? ` · ${s.takes.length} takes` : ''}</small></div>`;
  const track = ([name, m]) =>
    `<div class="pg-sound" data-words="${esc(`${name} ${m.tags}`)}"><button type="button" class="pg-name" data-copy="mm.music('${name}')" title="Copy mm.music('${name}')">${esc(name)}</button>
      <span class="pg-takes"><button type="button" class="pg-loop" data-music="${esc(name)}">play</button></span><small>${secs(m.dur)} · ${esc(m.mood)}</small></div>`;
  const groups = {};
  for (const entry of Object.entries(lib.sounds)) (groups[entry[0].split('/')[0]] ??= []).push(entry);
  ui.innerHTML = `<div class="pg-picker pg-sounds card">
    <h2>The sound library</h2>
    <p>${Object.keys(lib.sounds).length} sounds and ${Object.keys(lib.music).length} music loops your game can play (see "Sounds and music" in docs/making-games.md). Press a number to hear that take, a name to copy the line that plays it.</p>
    <input class="pg-search" type="search" placeholder="Search: coin, splash, whoosh, spooky, win…" aria-label="Search sounds">
    <h3>Music</h3>${Object.entries(lib.music).map(track).join('')}
    ${Object.entries(groups).map(([cat, list]) => `<h3>${esc(cat)}/</h3>${list.map(sound).join('')}`).join('')}
    <p class="pg-credits">All free to use (CC0), from: ${lib.sources.map((s) => `<a href="${esc(s.page)}" target="_blank" rel="noopener">${esc(s.title)}</a> (${esc(s.author)})`).join(', ')}.</p>
  </div>`;
  const box = ui.querySelector('.pg-sounds');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.play) playSound(b.dataset.play, { take: Number(b.dataset.take) }, { patience: Infinity });
    if (b.dataset.copy) {
      navigator.clipboard?.writeText(b.dataset.copy);
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 900);
    }
    for (const [attr, start, stop] of [
      ['music', (n) => setMusic(n), () => setMusic(null)],
      ['loop', (n) => setLoop('listen', n), () => setLoop('listen', null)],
    ]) {
      if (!b.dataset[attr]) continue;
      const on = !b.classList.contains('on');
      for (const other of box.querySelectorAll(`[data-${attr}].on`)) other.classList.remove('on');
      b.classList.toggle('on', on);
      on ? start(b.dataset[attr]) : stop();
    }
  });
  box.querySelector('.pg-search').addEventListener('input', (e) => {
    const words = e.target.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const row of box.querySelectorAll('.pg-sound')) row.hidden = !words.every((w) => row.dataset.words.includes(w));
    for (const h of box.querySelectorAll('h3')) {
      let n = h.nextElementSibling;
      let any = false;
      while (n && n.tagName !== 'H3' && n.classList.contains('pg-sound')) {
        any ||= !n.hidden;
        n = n.nextElementSibling;
      }
      h.hidden = !any;
    }
  });
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

  // As many bots as asked for, within the players the game takes (you're one of them).
  const range = m.players ?? { min: 1, max: MM.maxPlayers };
  const botCount = Math.max(range.min - 1, Math.min(range.max - 1, bots));
  const ids = ['you', ...BOT_NAMES.slice(0, botCount).map((n) => n.toLowerCase())];
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

  startBots(game, ids.slice(1), m.input, view);
  if (autoplay) startAutoplay(m.input, view);
  pg.ready = true;
  if (!autoplay) showDev(view, m); // screenshots show just the game
}

// What a bot playing player index `player` types next (see botWord in format.js).
function botTarget(view, player, spec) {
  let wanted = '';
  try {
    if (view.box && !view.box.dead) wanted = view.box.call('bot', JSON.stringify({ player }), MM.deadline.tick);
  } catch {
    // The game stopped: a random word then.
  }
  return cleanText(botWord(wanted, Math.random), spec.maxLength);
}

// Bots press random (but valid) inputs, a few times a second. In a typing game they type words
// a letter at a time, mostly what the game's bot() says.
function startBots(game, botIds, spec, view) {
  botIds.forEach((botId, i) => {
    let c = 0;
    if (spec.text) {
      let word = null;
      let typed = '';
      const type = () => {
        if (game.isFinished()) return;
        const t = Math.round(performance.now() - game.goAt);
        if (t < 0) return setTimeout(type, 100 - t);
        if (word === null) {
          word = botTarget(view, i + 1, spec);
          typed = '';
        }
        if (typed.length < word.length) {
          typed = word.slice(0, typed.length + 1);
          if (spec.text === 'live') game.handleInput(botId, { a: ['t', typed, 0], t, c: ++c });
          setTimeout(type, 110 + Math.random() * 260);
        } else {
          game.handleInput(botId, { a: ['t', typed, 1], t, c: ++c });
          word = null;
          setTimeout(type, 400 + Math.random() * 1200);
        }
      };
      setTimeout(type, Math.random() * 1000);
      return;
    }
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
  });
}

// For screenshots: plays for you through the real keyboard controls, or types into the text box.
function startAutoplay(spec, view) {
  if (spec.text) {
    let word = null;
    const type = () => {
      const box = document.querySelector('.hud-type-input');
      if (box && !box.disabled && !box.form.hidden) {
        word ??= botTarget(view, 0, spec);
        if (box.value.length < word.length) {
          box.value = word.slice(0, box.value.length + 1);
          box.dispatchEvent(new Event('input'));
        } else {
          box.form.requestSubmit();
          word = null;
        }
      }
      setTimeout(type, 120 + Math.random() * 200);
    };
    setTimeout(type, 500);
    return;
  }
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

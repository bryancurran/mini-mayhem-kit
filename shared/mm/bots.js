import { MM, botWord, cleanText, tickOf } from './format.js';
import { Sandbox } from './sandbox.js';

// Bots: players the game server plays for (a private room's host can add them; the kit's
// playground plays you against them). A game says how its bots play in its rules' bot() (see
// "Bots" in docs/making-games.md); in a game that doesn't, they press buttons at random, like
// the play test's.
//
// The server runs a second copy of the rules beside the game's own, fed the same inputs, so
// nothing a game's bot() does (however slow or broken) can reach the game. Ten times a second the
// copy's state is moved on to the present, bot() says what each bot holds, and whatever changed
// becomes inputs, made at that moment, as a player's would be.

export const BOT_THINK_MS = 100;
// Bots never take more than about this share of the server's time: a game whose bot() is slow
// gets fewer goes at it.
const BOT_CPU_SHARE = 0.04;
const DIRS = { up: 'u', down: 'd', left: 'l', right: 'r' };
const clamp = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

// One bot's hands on the controls: turns what bot() says it holds into presses, releases, stick
// moves and taps (and typing, a letter at a time). act(answer, t) -> inputs to make at game time
// t (ms). answer is what bot() returned, or undefined for random presses (the game has no bot(),
// or it failed). wild: how often to do something random instead (the play test's bots, so wrong
// moves get tried too).
export function botHands(spec, { rand = Math.random, wild = 0 } = {}) {
  const held = new Set();
  let stick = [0, 0];
  let nextRandom = 0;
  let typing = null; // { word, typed, next }
  let restUntil = 0;

  // Random but plausible input for whatever the game asked for, a few times a second.
  function random(t) {
    if (t < nextRandom) return [];
    nextRandom = t + 120 + rand() * 900;
    const choices = [];
    if (spec.buttons.length) choices.push('button');
    if (spec.dirs) choices.push('dir');
    if (spec.move) choices.push('move');
    const pick = choices[Math.floor(rand() * choices.length)];
    if (pick === 'button') {
      const b = spec.buttons[Math.floor(rand() * spec.buttons.length)];
      held.delete(b);
      return [['p', b], ['r', b]];
    }
    if (pick === 'dir') return [['d', 'udlr'[Math.floor(rand() * 4)]]];
    if (pick === 'move') {
      stick = [Math.round((rand() * 2 - 1) * 10) * 10, Math.round((rand() * 2 - 1) * 10) * 10];
      return [['m', ...stick]];
    }
    return [];
  }

  // A word at a time, a letter at a time, then Enter. '' from bot(): nothing to type just now.
  function type(answer, t) {
    if (!typing) {
      if (t < restUntil) return [];
      const wanted = typeof answer === 'string' ? answer : '';
      if (answer !== undefined && !wanted && !(wild && rand() < wild)) return [];
      const word = cleanText(wild || answer === undefined ? botWord(wanted, rand) : wanted, spec.maxLength);
      if (!word) return [];
      typing = { word, typed: '', next: t };
    }
    if (t < typing.next) return [];
    if (typing.typed.length < typing.word.length) {
      typing.typed = typing.word.slice(0, typing.typed.length + 1);
      typing.next = t + 110 + rand() * 260;
      return spec.text === 'live' ? [['t', typing.typed, 0]] : [];
    }
    const out = [['t', typing.typed, 1]];
    typing = null;
    restUntil = t + 400 + rand() * 1200;
    return out;
  }

  return {
    act(answer, t) {
      if (spec.text) return type(answer, t);
      if (answer === undefined || (wild && rand() < wild)) return random(t);
      const a = answer && typeof answer === 'object' ? answer : {};
      const out = [];
      // (The stick first, so a press in the same answer goes the new way.)
      if (spec.move) {
        const m = a.move && typeof a.move === 'object' ? a.move : {};
        const x = Math.round(clamp(m.x) * 100);
        const y = Math.round(clamp(m.y) * 100);
        // (Small wobbles aren't worth an input; letting go always is.)
        const moved = Math.abs(x - stick[0]) >= 4 || Math.abs(y - stick[1]) >= 4 || ((x === 0 && y === 0) !== (stick[0] === 0 && stick[1] === 0));
        if (moved && (x !== stick[0] || y !== stick[1])) out.push(['m', x, y]), (stick = [x, y]);
      }
      if (spec.dirs && Object.hasOwn(DIRS, a.dir)) out.push(['d', DIRS[a.dir]]);
      for (const b of spec.buttons) {
        const want = a[b] === true;
        if (want && !held.has(b)) out.push(['p', b]), held.add(b);
        else if (!want && held.has(b)) out.push(['r', b]), held.delete(b);
      }
      return out;
    },
  };
}

// The bots in one game, on the server (or the kit's stand-in for it). bots: their places in the
// game's player list. resume(): the game's confirmed state (as JSON) and the inputs since
// (encoded), for starting the copy again if it stops (out of time once, on a busy machine). Feed
// it every advance the game's sandbox gets (the same JSON), then ask what the bots do with
// think(t).
export class Bots {
  constructor({ QuickJS, ENGINE, pkg, seed, players, bots, resume = null, log = console, label = pkg.manifest.id }) {
    this.setup = { QuickJS, ENGINE, pkg, seed, players };
    this.spec = pkg.manifest.input;
    this.rate = pkg.manifest.tickRate;
    this.bots = bots;
    this.resume = resume;
    this.label = label;
    this.log = log;
    this.hands = bots.map(() => botHands(this.spec));
    this.nextAt = 0;
    this.every = BOT_THINK_MS;
    this.restarts = 0;
    this.failed = new Set(); // bots whose bot() has thrown (logged once each)
    this.box = null;
    this.smart = this.start(null); // whether the game has a bot() (and the copy's running)
  }

  // Runs the rules in a sandbox of their own, from the start or from { state, log }.
  start(from) {
    const { QuickJS, ENGINE, pkg, seed, players } = this.setup;
    this.box = new Sandbox(QuickJS, { memory: MM.memory.server, onLog: () => {} });
    try {
      this.box.run(ENGINE, 'engine.js', MM.deadline.setup);
      this.box.run(pkg.files['rules.js'], 'rules.js', MM.deadline.setup);
      this.box.call('init', JSON.stringify({ seed, rate: this.rate, me: -1, players, state: from ? JSON.parse(from.state) : null, log: from?.log ?? [] }), MM.deadline.setup);
      if (this.box.call('hasBot', '', MM.deadline.tick) === 'yes') return true;
    } catch (e) {
      this.log.warn(`[${this.label}] bots couldn't start: ${String(e?.message ?? e).split('\n')[0]}`);
    }
    this.dispose(); // (random presses need no rules)
    return false;
  }

  // The same advance the game's sandbox just made.
  advance(json) {
    if (!this.smart) return;
    try {
      this.box.call('advance', json, MM.deadline.tick);
    } catch (e) {
      this.stop(e);
    }
  }

  // Whether it's time they had another think.
  due(t) {
    return t >= 0 && t >= this.nextAt;
  }

  // What the bots do at game time t (whole ms): [[index in the player list, input], ...]. pending:
  // inputs the game has that its sandbox hasn't been given yet (encoded as in advance). A bot
  // whose bot() throws, or whose go is missed, keeps holding what it held.
  think(t, pending = []) {
    if (!this.due(t)) return [];
    this.nextAt = t + this.every;
    let answers;
    if (this.smart) {
      const started = performance.now();
      try {
        answers = JSON.parse(this.box.call('bots', JSON.stringify({ to: tickOf(t, this.rate), players: this.bots, log: pending }), MM.deadline.tick));
      } catch (e) {
        this.stop(e);
        return [];
      }
      this.every = Math.max(BOT_THINK_MS, Math.min(1000, (performance.now() - started) / BOT_CPU_SHARE));
    }
    const out = [];
    this.bots.forEach((index, i) => {
      const answer = answers ? answers[i] : undefined; // (undefined: random presses)
      if (answer && typeof answer === 'object' && typeof answer.error === 'string') {
        if (!this.failed.has(index)) this.log.warn(`[${this.label}] bot() failed for player ${index}: ${answer.error}`);
        this.failed.add(index);
        return;
      }
      for (const a of this.hands[i].act(answer, t)) out.push([index, a]);
    });
    return out;
  }

  // Out of time or memory, or broken: the copy starts again from the game's confirmed state (a
  // few times at most), or failing that the bots press at random from now on.
  stop(e) {
    this.log.warn(`[${this.label}] bots stopped thinking: ${String(e?.message ?? e).split('\n')[0]}`);
    this.dispose();
    this.smart = false;
    if (this.resume && this.restarts++ < 3) {
      try {
        this.smart = this.start(this.resume());
      } catch {
        // (the game itself has stopped)
      }
    }
  }

  dispose() {
    this.box?.dispose();
  }
}

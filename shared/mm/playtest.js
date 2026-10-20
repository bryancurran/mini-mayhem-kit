import { MM, botWord, cleanText, tickOf } from './format.js';
import { Sandbox } from './sandbox.js';

// Plays a packaged minigame headless, with a simulated clock and simulated network delays: a
// server-side game (runtime.makeGame) and browser sandboxes like the real ones. Bots press
// random (but valid) inputs, a spectator watches from the start and another joins halfway
// through from the late-join state. Used by tools/mm.mjs check, by uploads, and by the creator
// kit (with its local stand-in for the server).
//
// runtime: { QuickJS, ENGINE, KIT, makeGame(pkg, { clock, log }) -> game class }.
//
// players is how many bots play, or a list with a count per game (then games is ignored).
// Returns { problems: [...], games: [{ endedAt, inputs, results }], stats }. No problems means
// the game started, ended, placed everyone, kept plain data, drew valid commands, and came out
// the same on every simulated machine (and again when replayed from scratch).

const OPS = new Set(['new', 'set', 'del', 'inst', 'ibulk', 'cbulk', 'mat', 'rset', 'tex', 'geo', 'free', 'bake', 'camera', 'world', 'burst', 'ripple', 'sound', 'hud', 'controls']);
// Half the simulated players are on a laptop, half on a phone held upright.
const screen = (width, height, top, bottom) => ({
  width,
  height,
  aspect: width / height,
  portrait: width / height < 0.8,
  safe: { top, bottom, left: 0, right: 0, width, height: height - top - bottom, aspect: width / (height - top - bottom) },
});
const SCREENS = [screen(1280, 800, 60, 50), screen(390, 844, 140, 180)];
const quiet = { log() {}, warn() {}, error() {} };

// How many players to play-test a game with: 3 (or as near as it takes), then the fewest.
export function testCounts(manifest) {
  const { min, max } = manifest.players ?? { min: 1, max: MM.maxPlayers };
  return [...new Set([Math.max(min, Math.min(3, max)), min])];
}

export function playtest(pkg, { runtime, players = 4, games = 2, seed = 12345, maxSeconds = MM.maxGameSeconds, clientMemory = MM.memory.client, log = quiet } = {}) {
  const { QuickJS, ENGINE, KIT, makeGame } = runtime;
  const m = pkg.manifest;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const problems = [];
  const played = [];
  const stats = { serverMs: [], frameMs: [], commands: [], desyncs: 0, checks: 0, rebuilds: 0, memory: 0, inputs: 0 };

  const counts = Array.isArray(players) ? players : new Array(games).fill(players);
  for (let g = 0; g < counts.length && problems.length === 0; g++) {
    const boxes = [];
    try {
      played.push(playOne(boxes, counts[g]));
    } catch (e) {
      const label = counts.length > 1 ? `game ${g + 1} (${counts[g]} player${counts[g] > 1 ? 's' : ''}): ` : '';
      problems.push(label + firstLines(e.message));
    } finally {
      for (const box of boxes) box.dispose();
    }
  }

  // Loops, not Math.max(...a): a long game has more timings than fit in a call's arguments.
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const worst = (a) => a.reduce((x, y) => (y > x ? y : x), 0);
  return {
    problems,
    games: played,
    stats: {
      serverMsAvg: avg(stats.serverMs),
      serverMsWorst: worst(stats.serverMs),
      frameMsAvg: avg(stats.frameMs),
      frameMsWorst: worst(stats.frameMs),
      commandsPerFrame: avg(stats.commands),
      rebuilds: stats.rebuilds,
      checks: stats.checks,
      memoryBytes: stats.memory,
    },
  };

  function playOne(boxes, count) {
    let now = 0;
    const ids = Array.from({ length: count }, (_, i) => `bot${i}`);
    const Game = makeGame(pkg, { clock: { now: () => now }, log });
    const game = new Game(ids);
    boxes.push({ dispose: () => game.box.dispose() });
    if (game.crashed) throw new Error(`crashed while starting: ${game.crashed}`);
    const init = game.getInit();
    const net = []; // [deliverAt, fn]
    const send = (delay, fn) => net.push([now + delay, fn]);
    const allInputs = [];
    const roster = ids.map((id, index) => ({ index, id }));

    function makeClient(me, from) {
      const box = new Sandbox(QuickJS, { memory: clientMemory });
      boxes.push(box);
      box.run(ENGINE, 'engine.js', MM.deadline.setup);
      box.run(KIT, 'kit.js', MM.deadline.setup);
      box.run(pkg.files['rules.js'], 'rules.js', MM.deadline.setup);
      box.run(pkg.files['view.js'], 'view.js', MM.deadline.setup);
      const setup = box.call(
        'init',
        JSON.stringify({
          seed: from.seed,
          rate: from.rate,
          me,
          players: roster,
          state: from.state ? JSON.parse(from.state) : null,
          log: from.log,
          view: { players: roster.map((p) => ({ ...p, name: p.id, color: '#ff5c8a' })), screen: SCREENS[(me + 2) % 2] },
        }),
        MM.deadline.setup,
      );
      checkCommands(setup);
      return { me, box, screen: SCREENS[(me + 2) % 2], delay: 15 + rand() * 110, inbox: { log: [], fin: from.fin, hash: null }, next: 0, nextPress: 500 + rand() * 1500 };
    }

    function checkCommands(text) {
      if (text.length > MM.maxFrameBytes) throw new Error(`the view drew ${Math.round(text.length / 1048576)} MB of commands in one frame (the limit is ${MM.maxFrameBytes / 1048576} MB)`);
      const cmds = JSON.parse(text);
      if (!Array.isArray(cmds)) throw new Error('the view returned something other than drawing commands');
      for (const c of cmds) if (!Array.isArray(c) || !OPS.has(c[0])) throw new Error(`unknown drawing command ${JSON.stringify(c).slice(0, 80)}`);
      stats.commands.push(cmds.length);
    }

    // Random but plausible input for whatever the game asked for.
    function botInputs(c, t) {
      const out = [];
      const spec = m.input;
      if (t < c.nextPress) return out;
      c.nextPress = t + 120 + rand() * 900;
      if (spec.text) return botTyping(c, t, spec);
      const choices = [];
      if (spec.buttons.length) choices.push('button');
      if (spec.dirs) choices.push('dir');
      if (spec.move) choices.push('move');
      const pick = choices[Math.floor(rand() * choices.length)];
      if (pick === 'button') {
        const b = spec.buttons[Math.floor(rand() * spec.buttons.length)];
        out.push(['p', b], ['r', b]);
      } else if (pick === 'dir') out.push(['d', 'udlr'[Math.floor(rand() * 4)]]);
      else if (pick === 'move') out.push(['m', Math.round((rand() * 2 - 1) * 10) * 10, Math.round((rand() * 2 - 1) * 10) * 10]);
      return out;
    }

    // A word (see botWord) a letter at a time, then Enter.
    function botTyping(c, t, spec) {
      const out = [];
      if (c.word === undefined || c.word === null) {
        c.word = cleanText(botWord(c.box.call('bot', JSON.stringify({ player: c.me }), MM.deadline.tick), rand), spec.maxLength);
        c.typed = '';
      }
      if (c.typed.length < c.word.length) {
        c.typed = c.word.slice(0, c.typed.length + 1);
        if (spec.text === 'live') out.push(['t', c.typed, 0]);
        c.nextPress = t + 60 + rand() * 180;
      } else {
        out.push(['t', c.typed, 1]);
        c.word = null;
      }
      return out;
    }

    function receive(c, snap) {
      for (const e of snap.in) c.inbox.log.push(e);
      c.inbox.fin = Math.max(c.inbox.fin, snap.f);
      if (snap.h) c.inbox.hash = snap.h;
    }

    function frame(c, gameMs) {
      const local = [];
      if (c.me >= 0 && gameMs >= 0) {
        for (const a of botInputs(c, gameMs)) {
          const t = Math.round(gameMs);
          const msg = { a, t, c: ++c.next };
          local.push([msg.c, t, a]);
          stats.inputs++;
          const id = ids[c.me];
          send(c.delay, () => game.handleInput(id, msg));
        }
      }
      const check = c.inbox.hash !== null && c.inbox.hash[0] === c.inbox.fin;
      const args = { now: gameMs, wall: now, log: c.inbox.log, fin: c.inbox.fin, local, reset: null, hash: check, dt: frameMs / 1000, screen: c.screen };
      c.inbox.log = [];
      const t0 = performance.now();
      const text = c.box.call('frame', JSON.stringify(args), MM.deadline.frame);
      stats.frameMs.push(performance.now() - t0);
      if (text.length > MM.maxFrameBytes) checkCommands(text);
      const out = JSON.parse(text);
      checkCommands(JSON.stringify(out.c));
      stats.rebuilds = Math.max(stats.rebuilds, out.r);
      if (check && out.h !== undefined) {
        stats.checks++;
        if (out.h !== c.inbox.hash[1]) stats.desyncs++;
        c.inbox.hash = null;
      }
    }

    const clients = [...ids.map((id, i) => i), -1].map((me) => makeClient(me, init));
    let lateJoined = false;
    const inputsBefore = stats.inputs;
    const frameMs = 1000 / 60;
    const tickMs = 1000 / m.tickRate;
    const sendEvery = Math.max(1, Math.round(m.tickRate / MM.sendRate));
    let ticks = 0;
    let nextTick = 0;
    let nextFrame = 0;
    const end = init.goAt + maxSeconds * 1000;
    let serverHash = null;

    for (;;) {
      if (now > end) throw new Error(`never ended (stopped after ${maxSeconds} seconds of game time)`);
      net.sort((a, b) => a[0] - b[0]);
      while (net.length && net[0][0] <= now) net.shift()[1]();

      if (now >= nextTick) {
        nextTick += tickMs;
        const t0 = performance.now();
        game.step(tickMs / 1000);
        stats.serverMs.push(performance.now() - t0);
        ticks++;
        if (game.crashed) throw new Error(`crashed on the server: ${game.crashed}`);
        if (ticks % sendEvery === 0 || game.isFinished() || game.wantsSnapshot()) {
          const snap = game.snapshot();
          for (const e of snap.in) allInputs.push(e);
          for (const c of clients) send(c.delay, () => receive(c, snap));
        }
        if (game.isFinished()) {
          serverHash = game.box.call('hash', '', MM.deadline.tick);
          break;
        }
      }

      if (now >= nextFrame) {
        nextFrame += frameMs;
        const gameMs = now - init.goAt;
        if (!lateJoined && gameMs > 5000) {
          lateJoined = true;
          const late = game.getInit();
          if (game.crashed) throw new Error(`crashed when someone joined late: ${game.crashed}`);
          clients.push(makeClient(-1, late));
        }
        for (const c of clients) frame(c, gameMs);
      }
      now = Math.min(nextTick, nextFrame, net.length ? Math.min(...net.map((n) => n[0])) : Infinity);
    }

    for (const c of clients) {
      if (c.box.call('plain', '', MM.deadline.tick) !== 'yes') problems.push('the state holds something other than plain data (objects, arrays, strings, finite numbers, booleans, null)');
      stats.memory = Math.max(stats.memory, c.box.memoryUsed());
    }

    // Replaying every input from scratch has to land on exactly the same state.
    const box = new Sandbox(QuickJS, { memory: MM.memory.server });
    boxes.push(box);
    box.run(ENGINE, 'engine.js', MM.deadline.setup);
    box.run(pkg.files['rules.js'], 'rules.js', MM.deadline.setup);
    box.call('init', JSON.stringify({ seed: init.seed, rate: init.rate, me: -1, players: roster }), MM.deadline.setup);
    box.call('advance', JSON.stringify({ to: tickOf(now - init.goAt, init.rate) + 1, log: allInputs }), 60_000);
    if (box.call('hash', '', MM.deadline.tick) !== serverHash) problems.push('replaying the same inputs gave a different result: the rules depend on something besides the inputs and game.random()');

    const results = game.getResults();
    if (results.length !== ids.length || new Set(results.map((r) => r.id)).size !== ids.length) problems.push('results() must place every player exactly once');
    if (!results.some((r) => r.place === 1)) problems.push('results(): nobody came first');
    if (stats.desyncs) problems.push(`${stats.desyncs} of ${stats.checks} state checks disagreed with the server: the rules aren't deterministic`);
    return { players: count, endedAt: (now - init.goAt) / 1000, inputs: stats.inputs - inputsBefore, results };
  }
}

// The error and where it happened in the game's own files (not the engine's).
function firstLines(message) {
  const [first, ...rest] = message.split('\n');
  const where = rest.map((l) => l.trim()).filter((l) => /\b(rules|view)\.js\b/.test(l)).slice(0, 3);
  return [first, ...where].join('\n    ');
}

// Runs inside the sandbox, before a game's rules.js, on the server and in every browser. It holds
// the game's state and moves it forward one tick at a time, applying inputs in a fixed order, so
// the same inputs give exactly the same state everywhere.
//
// Browsers keep two copies of the state: the confirmed one (every input up to it is final) and a
// prediction of the present. Your own inputs go into the prediction the moment you press; when
// an input turns up for a moment that has already been predicted (someone else's, or one of
// yours the server had to move), the prediction is rebuilt from the confirmed state.
//
// This is a plain script (not a module). The engine outside the sandbox calls the functions on
// globalThis.__mm.
(function () {
  'use strict';
  const global = globalThis;
  const realRandom = Math.random;
  const realNow = Date.now;
  const DIRS = { u: 'up', d: 'down', l: 'left', r: 'right' };

  let rules = null;
  global.defineRules = function (r) {
    if (rules) throw new Error('defineRules() can only be called once');
    if (!r || typeof r.setup !== 'function') throw new Error('defineRules() needs at least a setup(game) function');
    rules = r;
  };

  const E = {
    rate: 30,
    seed: 0,
    me: -1,
    conf: null, // { s, tick, ended }: state after ticks 0 .. tick - 1, all final
    pred: null, // the same, predicted up to the present
    log: [], // inputs from the server not yet in conf: { q, k, t, p, a, c }
    lastQ: 0, // the server numbers inputs; anything at or below this has been seen already
    rebuilds: 0,
    pending: [], // our own inputs the server hasn't echoed yet: { c, k, t, a, wall }
    delivered: new Map(), // predicted events already shown -> their tick
    quiet: true, // the first frame catches up silently
    info: null, // passed to view.render
  };

  // ---- deterministic randomness: reseeded every tick, so replays draw the same numbers ----

  let rngState = 0;
  function rng() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function seedTick(k) {
    rngState = (E.seed ^ Math.imul(k + 1, 0x9e3779b1)) | 0;
  }

  // ---- what rules see ---------------------------------------------------------------------

  let cur = null; // the state being advanced
  let sink = null; // where emitted events go (null: nowhere)
  let eventIndex = 0;

  const game = {
    players: [],
    seed: 0,
    tick: 0,
    time: 0,
    dt: 0,
    random: rng,
    emit(ev) {
      if (sink) sink.push([game.tick, eventIndex++, JSON.stringify(ev === undefined ? null : ev)]);
    },
    end() {
      if (cur) cur.ended = true;
    },
  };

  // Rules always see the game clock and the seeded random numbers, never the real ones.
  function inRules(fn) {
    Math.random = rng;
    Date.now = () => Math.round(game.time * 1000);
    try {
      return fn();
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
  }

  function toEvent(e) {
    const a = e.a;
    let ev;
    if (a[0] === 'p') ev = { type: 'press', button: a[1] };
    else if (a[0] === 'r') ev = { type: 'release', button: a[1] };
    else if (a[0] === 'd') ev = { type: 'dir', dir: DIRS[a[1]] };
    else if (a[0] === 't') ev = { type: 'text', text: a[1], enter: a[2] === 1 };
    else ev = { type: 'move', x: a[1] / 100, y: a[2] / 100 };
    ev.player = e.p;
    ev.time = e.t / 1000;
    return ev;
  }

  // ---- stepping ---------------------------------------------------------------------------

  const tickOf = (ms) => Math.floor((ms * E.rate) / 1000);
  const tickStartMs = (k) => Math.ceil((k * 1000) / E.rate);
  const clone = (st) => ({ s: JSON.parse(JSON.stringify(st.s)), tick: st.tick, ended: st.ended });

  // Inputs within a tick go in time order; the server's order breaks ties.
  function order(x, y) {
    if (x.t !== y.t) return x.t - y.t;
    const qx = x.q === undefined ? Infinity : x.q;
    const qy = y.q === undefined ? Infinity : y.q;
    if (qx !== qy) return qx < qy ? -1 : 1;
    return (x.c || 0) - (y.c || 0);
  }

  function byTick(list) {
    const map = new Map();
    for (const e of list) {
      let bucket = map.get(e.k);
      if (!bucket) map.set(e.k, (bucket = []));
      bucket.push(e);
    }
    for (const bucket of map.values()) bucket.sort(order);
    return map;
  }

  // Processes tick k: its inputs, then step() at the end of the tick. With step = false only the
  // inputs are applied (a provisional look at the tick that's still going on).
  function runTick(st, k, inputs, events, step) {
    cur = st;
    sink = events;
    eventIndex = 0;
    seedTick(k);
    game.tick = k;
    game.dt = 1 / E.rate;
    inRules(() => {
      for (const e of inputs) {
        if (st.ended) break;
        game.time = e.t / 1000;
        if (rules.input) rules.input(st.s, toEvent(e), game);
      }
      if (step && !st.ended) {
        game.time = (k + 1) / E.rate;
        if (rules.step) rules.step(st.s, game);
      }
    });
    if (step) st.tick = k + 1;
    cur = null;
    sink = null;
  }

  function advance(st, to, inputs, events, budget) {
    let n = 0;
    while (st.tick < to && !st.ended && n++ < budget) runTick(st, st.tick, inputs.get(st.tick) || [], events, true);
  }

  function decode(raw) {
    return { q: raw[0], k: raw[1], t: raw[2], p: raw[3], a: raw[4], c: raw[5] };
  }

  // One of our inputs as the server will see it: if its tick is already final, it moves to the
  // first tick that isn't.
  function effective(p) {
    if (p.k >= E.conf.tick) return { k: p.k, t: p.t, p: E.me, a: p.a, c: p.c };
    const k = E.conf.tick;
    return { k, t: Math.max(p.t, tickStartMs(k)), p: E.me, a: p.a, c: p.c };
  }

  function hashOf(st) {
    const text = `${JSON.stringify(st.s)}|${st.tick}|${st.ended ? 1 : 0}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // Only plain data can be copied and sent around; anything else would make copies disagree.
  function isPlain(v, depth) {
    if (depth > 64) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.every((x) => isPlain(x, depth + 1));
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.keys(v).every((k) => v[k] !== undefined && isPlain(v[k], depth + 1));
    }
    return false;
  }

  // ---- called from outside ----------------------------------------------------------------

  const CATCH_UP = 900; // most ticks simulated in one call (catching up after a background tab)

  global.__mm = {
    // { seed, rate, players: [{ index, id }], me, state?, log?, view? } -> drawing commands (browsers)
    init(json) {
      const a = JSON.parse(json);
      if (!rules) throw new Error('rules.js never called defineRules()');
      E.rate = a.rate;
      E.seed = a.seed | 0;
      E.me = a.me;
      game.players = Object.freeze(a.players.map((p) => Object.freeze({ index: p.index, id: p.id })));
      game.seed = E.seed;
      if (a.state) {
        E.conf = { s: a.state.s, tick: a.state.tick, ended: a.state.ended };
      } else {
        seedTick(-1);
        game.tick = 0;
        game.time = 0;
        game.dt = 1 / E.rate;
        const scratch = { s: null, tick: 0, ended: false };
        cur = scratch;
        const s = inRules(() => rules.setup(game));
        cur = null;
        if (!isPlain(s, 0)) throw new Error('setup() must return plain data (objects, arrays, strings, finite numbers, booleans, null)');
        E.conf = { s: JSON.parse(JSON.stringify(s)), tick: 0, ended: false };
      }
      for (const raw of a.log || []) {
        const e = decode(raw);
        if (e.q > E.lastQ) E.log.push(e), (E.lastQ = e.q);
      }
      E.pred = clone(E.conf);
      if (!a.view) return '[]';
      if (!global.__mmView) throw new Error('view kit missing');
      E.info = Object.assign({ me: E.me, playing: E.me >= 0, seed: E.seed, rate: E.rate }, a.view);
      return JSON.stringify(global.__mmView.setup(E.info, E.pred.s));
    },

    // Browsers, once per frame. In: { now (game ms), wall (ms), log, fin, local, reset, hash, dt,
    // screen }. Out: { c: drawing commands, k: confirmed tick, h: its hash if asked, ended }.
    frame(json) {
      const a = JSON.parse(json);
      let rebuild = false;

      if (a.reset) {
        E.conf = { s: a.reset.s, tick: a.reset.tick, ended: a.reset.ended };
        E.log = E.log.filter((e) => e.k >= E.conf.tick);
        rebuild = true;
      }

      for (const raw of a.log) {
        const e = decode(raw);
        if (e.q <= E.lastQ) continue;
        E.lastQ = e.q;
        if (e.k < E.conf.tick) continue;
        const mine = e.p === E.me ? E.pending.findIndex((p) => p.c === e.c) : -1;
        if (mine >= 0) {
          // Our own input coming back: only a change if the server had to move it.
          const was = effective(E.pending[mine]);
          E.pending.splice(mine, 1);
          if ((was.k !== e.k || was.t !== e.t) && Math.min(was.k, e.k) < E.pred.tick) rebuild = true;
        } else if (e.k < E.pred.tick) {
          rebuild = true;
        }
        E.log.push(e);
      }

      for (const raw of a.local) {
        const p = { c: raw[0], k: tickOf(raw[1]), t: raw[1], a: raw[2], wall: a.wall };
        if (effective(p).k < E.pred.tick) rebuild = true;
        E.pending.push(p);
      }
      // Inputs the server never echoed (it refused them) stop being predicted after a while.
      const before = E.pending.length;
      E.pending = E.pending.filter((p) => a.wall - p.wall < 3000);
      if (E.pending.length !== before) rebuild = true;

      const confirmed = [];
      if (a.fin > E.conf.tick) {
        advance(E.conf, a.fin, byTick(E.log), confirmed, CATCH_UP);
        E.log = E.log.filter((e) => e.k >= E.conf.tick);
        for (const [key, k] of E.delivered) if (k < E.conf.tick) E.delivered.delete(key);
      }

      // The prediction: from the confirmed state (if it needs rebuilding) up to the present.
      if (rebuild || E.pred.tick < E.conf.tick) {
        E.pred = clone(E.conf);
        E.rebuilds++;
      }
      const inputs = byTick(E.log.concat(E.pending.map(effective)));
      const predicted = [];
      advance(E.pred, Math.max(0, tickOf(a.now)), inputs, predicted, CATCH_UP);
      // Inputs already made during the tick that's still going on show right away.
      let shown = E.pred;
      const early = (inputs.get(E.pred.tick) || []).filter((e) => e.t <= a.now);
      if (early.length && !E.pred.ended) {
        shown = clone(E.pred);
        runTick(shown, E.pred.tick, early, predicted, false);
      }

      const events = [];
      for (const [k, i, text] of predicted) {
        const key = `${k}|${i}|${text}`;
        if (E.delivered.has(key)) continue;
        E.delivered.set(key, k);
        if (!E.quiet) events.push(JSON.parse(text));
      }
      const info = E.info;
      info.time = a.now / 1000;
      info.dt = a.dt;
      info.tick = E.pred.tick;
      info.screen = a.screen;
      info.events = events;
      info.confirmed = E.quiet ? [] : confirmed.map((c) => JSON.parse(c[2]));
      info.ended = shown.ended;
      E.quiet = false;
      const commands = global.__mmView.render(shown.s, info);
      return JSON.stringify({
        c: commands,
        k: E.conf.tick,
        h: a.hash && E.conf.tick === a.fin ? hashOf(E.conf) : undefined,
        ended: E.conf.ended,
        r: E.rebuilds,
      });
    },

    // The server: { to, log, hash } -> { tick, ended, h }
    advance(json) {
      const a = JSON.parse(json);
      for (const raw of a.log) E.log.push(decode(raw));
      advance(E.conf, a.to, byTick(E.log), null, Infinity);
      E.log = E.log.filter((e) => e.k >= E.conf.tick);
      return JSON.stringify({ tick: E.conf.tick, ended: E.conf.ended, h: a.hash ? hashOf(E.conf) : undefined });
    },

    results() {
      const r = inRules(() => (rules.results ? rules.results(E.conf.s, game) : null));
      return JSON.stringify(r === undefined ? null : r);
    },

    // The confirmed state, for late joiners and resyncs.
    state() {
      return JSON.stringify(E.conf);
    },

    hash() {
      return hashOf(E.conf);
    },

    plain() {
      return isPlain(E.conf.s, 0) ? 'yes' : 'no';
    },

    // What a bot playing { player } would type now (rules.bot, for typing games), from the
    // predicted state: for the bots in the play test and the kit's playground. '' if the game
    // doesn't say. Nothing it does reaches the state.
    bot(json) {
      if (typeof rules.bot !== 'function' || !E.pred) return '';
      const { player } = JSON.parse(json);
      const text = inRules(() => rules.bot(JSON.parse(JSON.stringify(E.pred.s)), player, game));
      return typeof text === 'string' ? text : '';
    },

    // The predicted state, for debugging tools and tests.
    peek() {
      return JSON.stringify({ s: E.pred.s, tick: E.pred.tick, ended: E.pred.ended });
    },
  };
})();

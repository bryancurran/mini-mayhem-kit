// Runs inside the sandbox, before a game's rules.js, on the server and in every browser. It holds
// the game's state and moves it forward one tick at a time, applying inputs in a fixed order, so
// the same inputs give exactly the same state everywhere.
//
// Browsers keep two copies of the state: the confirmed one (every input up to it is final) and a
// prediction of the present. Your own inputs go into the prediction the moment you press; when
// an input turns up for a moment that has already been predicted (someone else's, or one of
// yours the server had to move), the prediction is rebuilt from the copy it kept of the state
// just before that moment, or from the confirmed state.
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
    pending: [], // our own inputs the server hasn't echoed yet: { c, k, t, a, wall, at }
    saves: [], // copies of the prediction as of recent ticks, oldest first, none before conf
    saving: true, // false while the state is too big to be worth a copy a tick (see SAVE_BELOW)
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
  // A copy of plain data: the same as a round trip through JSON, several times quicker. Slice and
  // Object.assign copy each level (in QuickJS's own code), then whatever's nested is copied too.
  function copy(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      const a = v.slice();
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x !== null && typeof x === 'object') a[i] = copy(x);
      }
      return a;
    }
    const o = Object.assign({}, v);
    for (const k in o) {
      const x = o[k];
      if (x !== null && typeof x === 'object') o[k] = copy(x);
    }
    return o;
  }
  const clone = (st) => ({ s: copy(st.s), tick: st.tick, ended: st.ended });

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

  // A state bigger than this (as JSON) isn't copied every tick: copying it would cost more than
  // rebuilding from the confirmed state now and then. Measured whenever the state is hashed.
  const SAVE_BELOW = 32 * 1024;

  // The prediction moves on to tick `to`, keeping a copy of each tick it reaches within `last`.
  function predict(to, last, inputs, events) {
    const st = E.pred;
    let n = 0;
    while (st.tick < to && !st.ended && n++ < CATCH_UP) {
      runTick(st, st.tick, inputs.get(st.tick) || [], events, true);
      if (E.saving && last - st.tick < E.keep) E.saves.push(clone(st));
    }
    if (E.saves.length > E.keep) E.saves.splice(0, E.saves.length - E.keep);
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
    E.saving = text.length < SAVE_BELOW;
    if (!E.saving) E.saves = [];
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

  // Makes plain data read-only, all the way down (and returns it).
  function freeze(v) {
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
    Object.freeze(v);
    if (Array.isArray(v)) for (let i = 0; i < v.length; i++) freeze(v[i]);
    else for (const k in v) freeze(v[k]);
    return v;
  }

  // What rules.bot says a bot playing `player` does, given a state `s` it can only read (one
  // throwaway copy, frozen, serves every bot in a go: freezing it once is quicker than a copy for
  // each), as JSON. It sees the game's clock as of the state.
  function answer(st, s, player) {
    game.tick = st.tick;
    game.time = st.tick / E.rate;
    game.dt = 1 / E.rate;
    const r = inRules(() => rules.bot(s, player, game));
    return r === undefined ? 'null' : JSON.stringify(r);
  }

  // ---- called from outside ----------------------------------------------------------------

  const CATCH_UP = 900; // most ticks simulated in one call (catching up after a background tab)

  global.__mm = {
    // { seed, rate, players: [{ index, id }], me, state?, log?, view? } -> drawing commands (browsers)
    init(json) {
      const a = JSON.parse(json);
      if (!rules) throw new Error('rules.js never called defineRules()');
      E.rate = a.rate;
      E.keep = Math.ceil(a.rate); // the most saves kept: a second's worth (more than ever needed)
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
        const text = JSON.stringify(s);
        E.conf = { s: JSON.parse(text), tick: 0, ended: false };
        E.saving = text.length < SAVE_BELOW;
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
    // screen }. Out: { c: drawing commands, p: the predicted tick they're drawn from, k: confirmed
    // tick, h: its hash if asked, ended }.
    frame(json) {
      const a = JSON.parse(json);
      let from = Infinity; // the first tick whose inputs changed: the prediction is redone from it

      if (a.reset) {
        E.conf = { s: a.reset.s, tick: a.reset.tick, ended: a.reset.ended };
        E.log = E.log.filter((e) => e.k >= E.conf.tick);
        E.saves = [];
        from = -Infinity;
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
          if (was.k !== e.k || was.t !== e.t) from = Math.min(from, was.k, e.k);
        } else {
          from = Math.min(from, e.k);
        }
        E.log.push(e);
      }

      for (const raw of a.local) {
        const p = { c: raw[0], k: tickOf(raw[1]), t: raw[1], a: raw[2], wall: a.wall };
        from = Math.min(from, effective(p).k);
        E.pending.push(p);
      }
      // Inputs the server never echoed (it refused them) stop being predicted after a while.
      const kept = [];
      for (const p of E.pending) {
        if (a.wall - p.wall < 3000) kept.push(p);
        else from = Math.min(from, p.at ?? -Infinity);
      }
      E.pending = kept;

      const confirmed = [];
      if (a.fin > E.conf.tick) {
        advance(E.conf, a.fin, byTick(E.log), confirmed, CATCH_UP);
        E.log = E.log.filter((e) => e.k >= E.conf.tick);
        for (const [key, k] of E.delivered) if (k < E.conf.tick) E.delivered.delete(key);
        let old = 0;
        while (old < E.saves.length && E.saves[old].tick < E.conf.tick) old++;
        E.saves.splice(0, old);
        // One of ours went final unechoed: it's now predicted at the first tick that isn't.
        for (const p of E.pending) if (p.at !== undefined && effective(p).k !== p.at) from = Math.min(from, p.at);
      }

      // After a long pause between frames the confirmed state can overtake the prediction: the
      // ticks in between were never predicted, so their events come as they were confirmed.
      const predicted = E.pred.tick < E.conf.tick ? confirmed.filter((c) => c[0] >= E.pred.tick) : [];

      // The prediction: redone (if an input changed) from the last copy before the change, or
      // the confirmed state, then on up to the present.
      let was = null; // the prediction being replaced
      if (from < E.pred.tick || E.pred.tick < E.conf.tick) {
        if (E.pred.tick >= E.conf.tick) was = E.pred;
        while (E.saves.length && E.saves[E.saves.length - 1].tick > from) E.saves.pop();
        E.pred = clone(E.saves.length ? E.saves[E.saves.length - 1] : E.conf);
        E.rebuilds++;
      }
      const placed = E.pending.map(effective);
      for (let i = 0; i < placed.length; i++) E.pending[i].at = placed[i].k;
      const inputs = byTick(E.log.concat(placed));
      // The new prediction at the moment the old one had reached, to compare with it (see
      // view.correction).
      let correction = null;
      const present = Math.max(0, tickOf(a.now));
      if (was && !was.ended && was.tick <= present) {
        predict(was.tick, present, inputs, predicted);
        if (E.pred.tick === was.tick && !E.pred.ended) correction = { was: was.s, now: copy(E.pred.s) };
      }
      predict(present, present, inputs, predicted);
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
      // How far the present is into the next tick (0 up to 1): the state is as of the tick's start.
      info.alpha = Math.max(0, Math.min(1, (a.now * E.rate) / 1000 - E.pred.tick));
      info.screen = a.screen;
      info.events = events;
      info.correction = E.quiet ? null : correction;
      info.confirmed = E.quiet ? [] : confirmed.map((c) => JSON.parse(c[2]));
      info.ended = shown.ended;
      E.quiet = false;
      const commands = global.__mmView.render(shown.s, info);
      return JSON.stringify({
        c: commands,
        p: E.pred.tick, // the tick the drawing is of
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

    // Whether the game says how bots play it (rules.bot).
    hasBot() {
      return typeof rules.bot === 'function' ? 'yes' : 'no';
    },

    // What a bot playing { player } does now (rules.bot), from the predicted state, as JSON: what
    // it holds ({ move, a, b, dir }) or, in a typing game, what it would type. For the bots in
    // the play test. null if the game doesn't say. It gets a frozen copy of the state.
    bot(json) {
      if (typeof rules.bot !== 'function' || !E.pred) return 'null';
      const { player } = JSON.parse(json);
      return answer(E.pred, freeze(copy(E.pred.s)), player);
    },

    // The server's bots (see shared/mm/bots.js), from a copy of the game run alongside the real
    // one: { to, players: [index], log } -> [answer as JSON, or { error } if bot() threw]. The
    // confirmed state is moved on to tick `to` (the present) through every input there is so far
    // (log: those this copy hasn't been given yet), so bots see the game as it is now, their own
    // last moves included.
    bots(json) {
      const a = JSON.parse(json);
      if (typeof rules.bot !== 'function') return '[]';
      const st = clone(E.conf);
      advance(st, a.to, byTick(E.log.concat((a.log || []).map(decode))), null, CATCH_UP);
      const s = freeze(st.s);
      return `[${a.players.map((p) => {
        try {
          return answer(st, s, p);
        } catch (e) {
          return JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) });
        }
      }).join(',')}]`;
    },

    // The predicted state, for debugging tools and tests.
    peek() {
      return JSON.stringify({ s: E.pred.s, tick: E.pred.tick, ended: E.pred.ended });
    },
  };
})();

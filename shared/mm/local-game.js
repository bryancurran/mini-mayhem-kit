import { MM, checkAction, tickOf, tickStartMs } from './format.js';
import { Sandbox } from './sandbox.js';

// A stand-in for the Mini Mosh game server, for trying packages on your own machine (npm run
// check and npm run play). It plays by the same rules as the real one:
//   - rules.js runs in a sandbox with the same memory and time limits;
//   - everyone's inputs are put in one order;
//   - a tick is final MM.netDelay ms after it happens, and an input that arrives later moves to
//     the first tick that isn't final;
//   - every couple of seconds it sends a hash of its state so clients can check they agree;
//   - a game that crashes, throws, or uses too much time ends with everyone tied for last.
//
// localGame(pkg, { QuickJS, ENGINE, clock, log, seed }) returns a class: new Game(playerIds), then
// handleInput(playerId, msg), step(), snapshot(), wantsSnapshot(), isFinished(), getResults(),
// getInit() (what a browser needs to start), and `box` (the sandbox) and `crashed`.

const encode = (e) => [e.q, e.k, e.t, e.p, e.a, e.c];

function normalizeResults(raw, ids) {
  const n = ids.length;
  const places = new Array(n).fill(null);
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const p = r?.player;
      if (!Number.isInteger(p) || p < 0 || p >= n || places[p] !== null) continue;
      if (Number.isInteger(r.place) && r.place >= 1 && r.place <= n) places[p] = r.place;
    }
  }
  return ids.map((id, i) => ({ id, place: places[i] ?? n })).sort((a, b) => a.place - b.place);
}

export function localGame(pkg, { QuickJS, ENGINE, clock = performance, log = console, seed }) {
  const m = pkg.manifest;
  const rate = m.tickRate;
  const label = m.id;

  return class LocalGame {
    static id = m.id;
    static tickRate = rate;
    static sendRate = MM.sendRate;

    constructor(playerIds) {
      this.ids = playerIds;
      this.seed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 2 ** 31);
      this.goAt = clock.now() + m.countdown * 1000;
      this.fin = 0;
      this.q = 0;
      this.log = [];
      this.toSim = [];
      this.fresh = [];
      this.lastC = new Array(playerIds.length).fill(0);
      this.hashAt = 0;
      this.check = null;
      this.wantFull = false;
      this.over = false;
      this.results = null;
      this.crashed = null;
      this.cpu = { spent: 0, since: clock.now() };
      this.box = new Sandbox(QuickJS, { memory: MM.memory.server, onLog: (level, msg) => log[level === 'log' ? 'log' : level](`[${label}] ${msg}`) });
      try {
        this.box.run(ENGINE, 'engine.js', MM.deadline.setup);
        this.box.run(pkg.files['rules.js'], 'rules.js', MM.deadline.setup);
        this.box.call('init', JSON.stringify({ seed: this.seed, rate, me: -1, players: playerIds.map((id, index) => ({ index, id })) }), MM.deadline.setup);
      } catch (e) {
        this.crash(e);
      }
    }

    get elapsedMs() {
      return clock.now() - this.goAt;
    }

    getInit() {
      const init = { goAt: this.goAt, seed: this.seed, rate, fin: this.fin, log: this.log.map(encode) };
      if (this.fin > 0 && !this.over) {
        try {
          const state = this.box.call('state', '', MM.deadline.tick);
          if (state.length > MM.maxStateBytes) throw new Error(`state is ${Math.round(state.length / 1024)} KB (the limit is ${MM.maxStateBytes / 1024} KB)`);
          init.state = state;
        } catch (e) {
          this.crash(e);
        }
      }
      return init;
    }

    handleInput(playerId, msg) {
      if (this.over) return;
      if (msg.resync === true) {
        this.wantFull = true;
        return;
      }
      const p = this.ids.indexOf(playerId);
      const a = checkAction(msg.a, m.input);
      if (p < 0 || !a || !Number.isInteger(msg.t) || !Number.isInteger(msg.c) || msg.c <= this.lastC[p]) return;
      if (msg.t < 0 || msg.t > this.elapsedMs + MM.futureSlack) return;
      this.lastC[p] = msg.c;
      let t = msg.t;
      let k = tickOf(t, rate);
      if (k < this.fin) {
        k = this.fin;
        t = Math.max(t, tickStartMs(k, rate));
      }
      const e = { q: ++this.q, k, t, p, a, c: msg.c };
      this.log.push(e);
      this.toSim.push(e);
      this.fresh.push(e);
    }

    step() {
      if (this.over) return;
      const target = Math.max(0, tickOf(this.elapsedMs - MM.netDelay, rate));
      if (target > this.fin) {
        const wantHash = target >= this.hashAt;
        try {
          const started = performance.now();
          const r = JSON.parse(this.box.call('advance', JSON.stringify({ to: target, log: this.toSim.map(encode), hash: wantHash }), MM.deadline.tick));
          this.cpu.spent += performance.now() - started;
          const since = clock.now() - this.cpu.since;
          if (since >= 1000) {
            if (this.cpu.spent > (MM.serverCpuPerSecond * since) / 1000) throw new Error(`used ${Math.round(this.cpu.spent)} ms of server time in ${Math.round(since)} ms (the limit is ${MM.serverCpuPerSecond} ms a second)`);
            this.cpu = { spent: 0, since: clock.now() };
          }
          this.toSim = [];
          this.fin = target;
          this.log = this.log.filter((e) => e.k >= this.fin);
          if (wantHash) {
            this.check = [this.fin, r.h];
            this.hashAt = this.fin + MM.hashEvery * rate;
          }
          if (r.ended) this.finish();
        } catch (e) {
          this.crash(e);
        }
      }
      if (!this.over && this.elapsedMs > MM.maxGameSeconds * 1000) this.finish();
    }

    finish() {
      try {
        this.results = normalizeResults(JSON.parse(this.box.call('results', '', MM.deadline.tick)), this.ids);
      } catch (e) {
        log.warn(`[${label}] results() failed: ${e.message}`);
        this.results = normalizeResults(null, this.ids);
      }
      this.over = true;
    }

    crash(e) {
      log.warn(`[${label}] crashed: ${e.message}`);
      this.crashed = e.message;
      this.results = normalizeResults(null, this.ids);
      this.over = true;
    }

    wantsSnapshot() {
      return this.fresh.length > 0 || this.check !== null || this.wantFull;
    }

    snapshot() {
      const snap = { f: this.fin, in: this.fresh.map(encode) };
      this.fresh = [];
      if (this.check) {
        snap.h = this.check;
        this.check = null;
      }
      if (this.wantFull && !this.over) snap.S = this.box.call('state', '', MM.deadline.tick);
      this.wantFull = false;
      return snap;
    }

    isFinished() {
      return this.over;
    }

    getResults() {
      this.box.dispose();
      return this.results;
    }
  };
}

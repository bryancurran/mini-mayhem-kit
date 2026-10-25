import * as THREE from 'three';
import ENGINE from '../../../shared/mm/prelude-rules.js?raw';
import KIT from '../../../shared/mm/prelude-view.js?raw';
import { MAX_POINT, MM } from '../../../shared/mm/format.js';
import { Sandbox } from '../../../shared/mm/sandbox.js';
import { MINIGAMES } from '../../../shared/minigames.js';
import { disposeScene } from '../gfx.js';
import { isTouchDevice } from '../input.js';
import { sfx } from '../sfx.js';
import { playSound, preloadSounds } from '../sounds.js';
import { loadPackage } from './catalog.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { SceneHost } from './scene.js';

// A packaged (.mm) minigame in the browser: a regular client view (see
// client/src/minigames/index.js) wrapped around a QuickJS sandbox that runs the package's
// rules.js and view.js. Once a frame it hands the sandbox the time, our inputs and whatever the
// server sent; the sandbox predicts the game up to now and returns drawing commands, which
// SceneHost checks and draws. The countdown, spectator banner, controls hint and the end's sound
// are the same for every packaged game, so they live here.

// What a game's end sounds like (see sayEnd): the referee's whistle, for everyone ([name, ms after,
// volume] each). (The scoreboard after it has a sound of its own: main.js.)
const END_SOUNDS = { first: [['retro/refereewhistle', 0, 1]], rest: [['retro/refereewhistle', 0, 1]] };
const AXES = ['x', 'y', 'z'];
const ray = new THREE.Raycaster();
const screenPoint = new THREE.Vector2();

export function scriptedView(info) {
  return class extends ScriptedView {
    constructor(ctx) {
      super(ctx, info.id);
    }
  };
}

class ScriptedView {
  constructor(ctx, id) {
    this.ctx = ctx;
    this.id = id;
    this.init = ctx.init ?? {};
    this.rate = this.init.rate ?? 30;
    this.meIndex = ctx.participants.indexOf(ctx.meId);
    this.isPlaying = this.meIndex >= 0;
    this.players = ctx.participants.map((pid, index) => {
      const p = ctx.players.get(pid) ?? { name: '???', color: '#999999' };
      return { index, id: pid, name: p.name, color: p.color, me: pid === ctx.meId };
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 500);
    this.camera.position.set(0, 6, 14);
    this.camera.lookAt(0, 1, 0);

    const meta = MINIGAMES[id];
    const hint = this.isPlaying && meta ? (isTouchDevice ? meta.controls.touch : meta.controls.keyboard) : null;
    this.hud = new Hud(ctx.hudRoot, { players: this.players, hint });
    this.hud.onAction = (kind) => this.controls?.hudAction(kind);
    if (!this.isPlaying) this.hud.banner('Spectating · you’ll play next round', { style: 'info' });
    this.turn = 0; // mm.controls({ turn }), kept for the controls once they're made…
    this.button = true; // …and mm.controls({ button })
    this.plane = { axis: 1, at: 0 }; // and the pointer's: mm.controls({ pointer: { y: 0 } }), the floor
    this.host = new SceneHost(this.scene, this.camera, {
      hud: this.hud,
      onBadCommand: (msg) => console.warn(`[${id}] ${msg}`),
      onEnd: (won) => this.sayEnd(won),
      onControls: (o) => {
        if (Number.isInteger(o?.turn)) this.turn = ((o.turn % 4) + 4) % 4;
        if (typeof o?.button === 'boolean') this.button = o.button;
        const axis = AXES.findIndex((k) => Number.isFinite(o?.pointer?.[k]));
        if (axis >= 0) this.plane = { axis, at: o.pointer[AXES[axis]] };
        if (this.controls) this.controls.turn = this.turn;
        this.controls?.showButton(this.button);
      },
    });
    // Things are drawn one tick of the rules late, gliding between ticks (see SceneHost).
    this.host.glideMs = Math.min(100, 1000 / this.rate);

    this.inbox = { log: [], fin: this.init.fin ?? 0, hash: null, reset: null };
    this.nextInput = 0;
    this.startMove = null; // the stick as it's held during the countdown
    this.startPointer = null; // and where the pointer is
    this.box = null;
    this.controls = null;
    this.manifest = null;
    this.ready = false;
    this.failed = false;
    this.over = false;
    this.disposed = false;
    this.lastCountdown = null;
    this.introShown = false;
    // For tests and tuning: time spent in the sandbox, prediction rebuilds, disagreements.
    this.stats = { frames: 0, sandboxMs: 0, worstMs: 0, rebuilds: 0, desyncs: 0, checks: 0 };
    this.load = { spent: 0, since: performance.now() };
    this.boot();
  }

  // The game state as this browser currently predicts it, and the confirmed one (for debugging
  // and tests).
  debugState(confirmed = false) {
    return this.box && !this.box.dead ? JSON.parse(this.box.call(confirmed ? 'state' : 'peek', '', MM.deadline.frame)) : null;
  }

  gameMs() {
    return this.ctx.net.serverNow() - (this.init.goAt ?? 0);
  }

  // The screen, and the part of it the HUD doesn't cover (safe: px in from each edge, plus the
  // size and shape of what's left). Banners come and go, so they don't count.
  screen() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    return { width, height, aspect: width / height, portrait: width / height < 0.8, safe: this.safeArea(width, height) };
  }

  safeArea(width, height) {
    const now = performance.now();
    const c = this.safeCache;
    if (c && now - c.at < 250 && c.width === width && c.height === height) return c.value;
    const rects = (sel) => [...this.ctx.hudRoot.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    let top = 0;
    let bottom = 0;
    let right = 0;
    for (const r of rects('.hud-chips .chip, .hud-timer, .hud-top .flag-round')) top = Math.max(top, r.bottom + 8);
    for (const r of rects('.hud-bottom, .hud-type, .dash-btn, .tap-zone span')) bottom = Math.max(bottom, height - r.top + 8);
    for (const r of rects('.climb-tower')) right = Math.max(right, width - r.left + 8);
    // A race track, your place and a dial sit along the top on some screens and the bottom on
    // others: each counts for the half it's in.
    for (const r of rects('.race-progress, .race-place, .rope-meter')) {
      if (r.top + r.bottom < height) top = Math.max(top, r.bottom + 8);
      else bottom = Math.max(bottom, height - r.top + 8);
    }
    const w = Math.max(1, width - right);
    const h = Math.max(1, height - top - bottom);
    const value = { top: Math.round(top), bottom: Math.round(bottom), left: 0, right: Math.round(right), width: Math.round(w), height: Math.round(h), aspect: w / h };
    this.safeCache = { at: now, width, height, value };
    return value;
  }

  async boot() {
    try {
      const [{ loadQuickJS }, pkg] = await Promise.all([import('./quickjs.js'), loadPackage(this.id, this.ctx.version)]);
      preloadSounds(pkg.files['view.js']); // (already on their way if it was up next in the lobby)
      preloadSounds([...END_SOUNDS.first, ...END_SOUNDS.rest].map(([name]) => `'${name}'`).join(' ')); // (the end's, see sayEnd)
      preloadSounds("'ui/confirmation-2'"); // (played for the synthesized 'win': see scene.js)
      const QuickJS = await loadQuickJS();
      if (this.disposed) return;
      this.manifest = pkg.manifest;
      this.box = new Sandbox(QuickJS, {
        memory: MM.memory.client,
        onLog: (level, msg) => console[level === 'log' ? 'log' : level](`[${this.id}] ${msg}`),
      });
      this.box.run(ENGINE, 'engine.js', MM.deadline.setup);
      this.box.run(KIT, 'kit.js', MM.deadline.setup);
      this.box.run(pkg.files['rules.js'], 'rules.js', MM.deadline.setup);
      this.box.run(pkg.files['view.js'], 'view.js', MM.deadline.setup);
      const init = this.init;
      const commands = this.box.call(
        'init',
        JSON.stringify({
          seed: init.seed ?? 1,
          rate: this.rate,
          me: this.meIndex,
          players: this.players.map(({ index, id }) => ({ index, id })),
          state: init.state ? JSON.parse(init.state) : null,
          log: init.log ?? [],
          view: { players: this.players.map(({ index, id, name, color }) => ({ index, id, name, color })), screen: this.screen() },
        }),
        MM.deadline.setup,
      );
      if (commands.length > MM.maxFrameBytes) throw new Error(`drew ${Math.round(commands.length / 1048576)} MB of commands while setting up`);
      this.host.apply(JSON.parse(commands));
      this.hud.buttonLabel = pkg.manifest.input.touchLabel ?? 'READY';
      if (this.isPlaying && !this.over) {
        this.controls = new Controls({
          input: this.ctx.input,
          hudRoot: this.ctx.hudRoot,
          hud: this.hud,
          spec: pkg.manifest.input,
          clock: () => Math.floor(this.gameMs()), // never ahead of now, or it waits a frame
          project: (x, y) => this.project(x, y),
        });
        this.controls.turn = this.turn;
        this.controls.showButton(this.button);
      }
      this.ready = true;
    } catch (e) {
      this.fail(e);
    }
  }

  fail(e) {
    if (this.failed || this.disposed) return;
    this.failed = true;
    console.error(`[${this.id}] stopped: ${e.message}`);
    this.hud.banner('This game hit a problem and stopped. Hang tight for the next round!', { style: 'warn' });
    this.controls?.dispose();
    this.controls = null;
  }

  // Where a point on the screen (CSS pixels) is in the world, as the camera showed it last frame:
  // on the pointer's plane (the floor unless the view says), as [x, y, z] in thousandths, or null
  // where the screen doesn't look at it.
  project(x, y) {
    screenPoint.set((x / window.innerWidth) * 2 - 1, 1 - (y / window.innerHeight) * 2);
    this.camera.updateMatrixWorld();
    ray.setFromCamera(screenPoint, this.camera);
    const { origin, direction } = ray.ray;
    const { axis, at } = this.plane;
    const k = AXES[axis];
    const along = (at - origin[k]) / direction[k];
    if (!Number.isFinite(along) || along <= 0 || along > this.camera.far * 4) return null;
    const point = AXES.map((c, i) => Math.round((i === axis ? at : origin[c] + direction[c] * along) * 1000));
    return point.every((v) => Math.abs(v) <= MAX_POINT) ? point : null;
  }

  // ---- networking -------------------------------------------------------------------------

  onSnapshot(snap) {
    const net = this.ctx.net;
    net.seedClock(snap.t);
    if (Math.abs(net.serverNow() - snap.t) > 1000) net.offset = snap.t - performance.now();
    const inbox = this.inbox;
    if (snap.S) {
      inbox.reset = JSON.parse(snap.S);
      inbox.log = inbox.log.filter((e) => e[1] >= inbox.reset.tick);
    }
    if (Array.isArray(snap.in)) for (const e of snap.in) inbox.log.push(e);
    if (Number.isInteger(snap.f)) inbox.fin = Math.max(inbox.fin, snap.f);
    if (snap.h) inbox.hash = snap.h;
  }

  onGameOver(msg) {
    this.over = true;
    this.controls?.dispose();
    this.controls = null;
    // The end's sound, if the game didn't sound it when its result was decided.
    const mine = msg?.results?.find((r) => r.id === this.ctx.meId);
    this.sayEnd(mine?.place === 1);
  }

  // The end: the referee's whistle. Once a game: when the game says its result is decided
  // (mm.sound('end', won), the moment it shows who won), or else when it ends.
  sayEnd(won) {
    if (this.endSaid) return;
    this.endSaid = true;
    for (const [name, after, volume] of won ? END_SOUNDS.first : END_SOUNDS.rest) {
      const play = () => playSound(name, { take: 1, volume }, { patience: 1500 });
      if (after) setTimeout(play, after);
      else play();
    }
  }

  // ---- per frame --------------------------------------------------------------------------

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  countdown(T) {
    // (Until the package is in, the lobby's word on it.)
    const count = (this.manifest ?? MINIGAMES[this.id])?.count;
    if (T < 0) {
      const n = Math.ceil(-T);
      // With a count, only its last seconds are counted out: before them is the game's opening,
      // under its name.
      if (count !== undefined && n > count) {
        const m = this.manifest ?? MINIGAMES[this.id];
        if (!this.titleShown && m?.name) this.hud.title(m.name, m.color);
        this.titleShown = true;
        this.lastCountdown = n;
        return;
      }
      if (n !== this.lastCountdown && n <= 5) {
        this.lastCountdown = n;
        this.hud.title(null);
        this.hud.center(String(n), { style: 'count', ms: 850 });
        sfx.countdown();
      }
      if (!this.introShown && this.manifest) {
        this.introShown = true;
        if (this.isPlaying && this.manifest.intro) this.hud.banner(this.manifest.intro, { style: 'info', ms: 3000 });
      }
    } else if (this.lastCountdown !== 0 && this.lastCountdown !== null) {
      this.lastCountdown = 0;
      this.hud.title(null);
      // A game can open with something of its own instead (manifest "go": false).
      if (this.manifest?.go !== false) {
        this.hud.center('GO!', { style: 'go', ms: 900 });
        sfx.go();
      }
    }
  }

  update(dt) {
    this.countdown(this.gameMs() / 1000);
    if (!this.ready || this.failed) {
      this.host.tick(dt);
      return;
    }

    // Our inputs go to the server straight away and into the prediction this frame.
    const local = [];
    if (this.controls && !this.over) {
      // Before GO only the stick and the pointer count: wherever they are then is sent at GO.
      const polled = [];
      for (const [t, a] of this.controls.poll()) {
        if (t >= 0) polled.push([t, a]);
        else if (a[0] === 'm') this.startMove = a;
        else if (a[0] === 'c') this.startPointer = a;
      }
      if (this.startPointer && this.gameMs() >= 0) {
        polled.unshift([0, this.startPointer]);
        this.startPointer = null;
      }
      if (this.startMove && this.gameMs() >= 0) {
        if (this.startMove[1] || this.startMove[2]) polled.unshift([0, this.startMove]);
        this.startMove = null;
      }
      for (const [t, a] of polled) {
        const c = ++this.nextInput;
        this.ctx.net.send('input', { a, t, c });
        local.push([c, t, a]);
      }
    }

    const inbox = this.inbox;
    const check = inbox.hash !== null && inbox.hash[0] === inbox.fin;
    const screen = this.screen();
    this.host.safe = screen.safe;
    const args = {
      now: this.gameMs(),
      wall: performance.now(),
      log: inbox.log,
      fin: inbox.fin,
      local,
      reset: inbox.reset,
      hash: check,
      dt,
      screen,
    };
    inbox.log = [];
    inbox.reset = null;

    const started = performance.now();
    let out;
    try {
      const text = this.box.call('frame', JSON.stringify(args), MM.deadline.frame);
      if (text.length > MM.maxFrameBytes) throw new Error(`drew ${Math.round(text.length / 1048576)} MB of commands in one frame`);
      out = JSON.parse(text);
    } catch (e) {
      this.fail(e);
      return;
    }
    const spent = performance.now() - started;
    // A game that hogs the browser (without any single frame timing out) is stopped too.
    const load = this.load;
    load.spent += spent;
    if (started - load.since > 3000) {
      if (load.spent > (started - load.since) * MM.clientCpuShare) {
        this.fail(new Error(`took ${Math.round((100 * load.spent) / (started - load.since))}% of the browser's time`));
        return;
      }
      this.load = { spent: 0, since: started };
    }
    const s = this.stats;
    const rebuilt = out.r !== s.rebuilds;
    s.frames++;
    s.sandboxMs += spent;
    s.worstMs = Math.max(s.worstMs, spent);
    s.rebuilds = out.r;

    // Every couple of seconds the server says what its state looks like; if ours differs,
    // ask for a fresh copy.
    if (check && out.h !== undefined) {
      s.checks++;
      if (out.h !== inbox.hash[1]) {
        s.desyncs++;
        console.warn(`[${this.id}] out of sync at tick ${inbox.fin}; fetching the server's state`);
        this.ctx.net.send('input', { resync: true });
      }
      inbox.hash = null;
    }

    try {
      this.host.setClock(args.now, (out.p * 1000) / this.rate, rebuilt);
      this.host.apply(out.c);
    } catch (e) {
      this.fail(e);
      return;
    }
    this.host.tick(dt);
  }

  dispose() {
    this.disposed = true;
    this.controls?.dispose();
    this.box?.dispose();
    this.host.dispose();
    disposeScene(this.scene);
    this.hud.dispose();
  }
}

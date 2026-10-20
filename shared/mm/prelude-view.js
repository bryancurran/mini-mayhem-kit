// Runs inside the sandbox in browsers, before a game's view.js: the drawing kit (the global `mm`).
// Nothing here can touch the page. Every call is recorded as a command; once per frame the
// engine outside the sandbox checks the commands and carries them out with three.js and the
// regular game HUD. See docs/making-games.md for the API.
//
// This is a plain script (not a module).
(function () {
  'use strict';
  const global = globalThis;

  let view = null;
  global.defineView = function (v) {
    if (view) throw new Error('defineView() can only be called once');
    if (!v || typeof v.render !== 'function') throw new Error('defineView() needs at least a render(state, view) function');
    view = v;
  };

  let out = []; // commands, in call order
  const dirty = new Map(); // node id -> properties changed this frame (sent at the end)
  const placed = new Map(); // instances node id -> Map(copy -> properties changed this frame)
  let camera = null;
  let lastControls = null; // mm.controls as last sent
  let lastSun = null; // mm.sun as last sent
  let lastMusic = null; // mm.music as last sent
  const lastLoops = {}; // mm.loop as last sent, per key
  const hudLast = {}; // last value sent per HUD part, so unchanged ones aren't resent
  let nextId = 1;

  const round = (v) => Math.round(v * 1e4) / 1e4;
  const isHandle = (v) => v !== null && typeof v === 'object' && typeof v.__mm === 'string';

  // Numbers in arrays (pos, rot, look, positions, ...) go out as whole numbers 10000 times too
  // big: QuickJS writes those out several times quicker than decimals, and scene.js (unfix) puts
  // them back as the commands arrive.
  function vec(v) {
    if (typeof v === 'number') return round(v);
    if (!Array.isArray(v)) return v;
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) a[i] = typeof v[i] === 'number' ? Math.round(v[i] * 1e4) : v[i];
    return a;
  }

  // Numbers go out to 4 decimal places (more is invisible, and slow to turn into text).
  function pack(props) {
    const o = {};
    for (const k of Object.keys(props || {})) {
      const v = props[k];
      if (v === undefined) continue;
      if (k === 'material') o[k] = Array.isArray(v) ? v.map((m) => (isHandle(m) ? m.id : m)) : isHandle(v) ? v.id : v;
      else if (isHandle(v)) o[k] = v.id;
      else o[k] = vec(v);
    }
    return o;
  }

  function flush() {
    for (const [id, props] of dirty) out.push(['set', id, props]);
    dirty.clear();
    for (const [id, copies] of placed) out.push(['inst', id, [...copies]]);
    placed.clear();
  }

  // ---- scene nodes ------------------------------------------------------------------------

  function Node(kind, props) {
    props = props || {};
    this.__mm = 'node';
    this.id = nextId++;
    this.kind = kind;
    this.alive = true;
    this.parent = null;
    this.children = new Set();
    this.link(props.parent);
    out.push(['new', this.id, kind, pack(props)]);
  }
  Node.prototype.link = function (parent) {
    if (parent === undefined) return;
    if (this.parent) this.parent.children.delete(this);
    this.parent = parent && parent.alive ? parent : null;
    if (this.parent) this.parent.children.add(this);
  };
  // Changes some properties. Several changes in one frame are sent as one.
  Node.prototype.set = function (props) {
    if (!this.alive) return this;
    if (props && 'parent' in props) this.link(props.parent);
    const p = pack(props);
    const d = dirty.get(this.id);
    if (d) Object.assign(d, p);
    else dirty.set(this.id, p);
    return this;
  };
  Node.prototype.forget = function () {
    this.alive = false;
    dirty.delete(this.id);
    placed.delete(this.id);
    for (const child of this.children) child.forget();
    this.children.clear();
  };
  // Removes this node and everything under it.
  Node.prototype.remove = function () {
    if (!this.alive) return;
    flush();
    if (this.parent) this.parent.children.delete(this);
    this.forget();
    out.push(['del', this.id]);
  };

  // Many copies of one shape drawn at once (mm.instances). Each copy shows once it's placed.
  function Instances(props) {
    Node.call(this, 'instances', props);
    this.count = props && Number.isInteger(props.count) ? props.count : 1;
  }
  Instances.prototype = Object.create(Node.prototype);
  // Many copies in one go (much quicker than .at for each): { from, pos: [x, y, z, x, y, z, ...],
  // rot: (3 numbers a copy), scale: (1 a copy), color: ['#hex', ...], shown, snap }, starting at
  // copy `from` (0). shown: how many copies to show from the start (the rest are hidden).
  Instances.prototype.update = function (data) {
    if (!this.alive || !data) return this;
    flush(); // keeps it in order with .at
    out.push(['ibulk', this.id, pack(data)]);
    return this;
  };
  // Places copy i: { pos, rot, scale, color, visible }. Several changes in one frame are sent as one.
  Instances.prototype.at = function (i, props) {
    if (!this.alive || !Number.isInteger(i) || i < 0 || i >= this.count) return this;
    let copies = placed.get(this.id);
    if (!copies) placed.set(this.id, (copies = new Map()));
    const p = pack(props);
    const d = copies.get(i);
    if (d) Object.assign(d, p);
    else copies.set(i, p);
    return this;
  };

  // Lots of little Moshes at once (dancers, guests, an audience): { max, shadow, parent, pos }.
  // Each frame .update({ shown, pos: [x, y, z, ...], yaw, scale, sway, bounce, step, arms, reach,
  // spin, color, dark, hat }) places them: see docs/making-games.md.
  function Crowd(props) {
    Node.call(this, 'crowd', props);
  }
  Crowd.prototype = Object.create(Node.prototype);
  Crowd.prototype.update = function (data) {
    if (!this.alive || !data) return this;
    flush();
    out.push(['cbulk', this.id, pack(data)]);
    return this;
  };

  function Resource(kind) {
    this.__mm = kind;
    this.id = nextId++;
  }
  Resource.prototype.set = function (props) {
    out.push(['rset', this.id, pack(props)]);
    return this;
  };
  Resource.prototype.dispose = function () {
    out.push(['free', this.id]);
  };

  // ---- canvas textures: a recording stand-in for a 2D canvas context ----------------------

  const CANVAS_PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline'];
  const CANVAS_METHODS = [
    'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
    'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'fillText', 'strokeText',
    'roundRect', 'setLineDash',
  ];
  function Recorder(width, height) {
    this.width = width;
    this.height = height;
    this.ops = [];
    this.state = {};
  }
  for (const p of CANVAS_PROPS) {
    Object.defineProperty(Recorder.prototype, p, {
      get() {
        return this.state[p];
      },
      set(v) {
        this.state[p] = v;
        this.ops.push(['=', p, v && v.__gradient ? v.__gradient : v]);
      },
    });
  }
  for (const m of CANVAS_METHODS) {
    Recorder.prototype[m] = function (...args) {
      this.ops.push([m, ...args.map((x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x))]);
    };
  }
  function gradient(spec) {
    const stops = [];
    spec.push(stops);
    return {
      __gradient: spec,
      addColorStop(offset, color) {
        stops.push([offset, color]);
      },
    };
  }
  Recorder.prototype.createLinearGradient = (x0, y0, x1, y1) => gradient(['linear', x0, y0, x1, y1]);
  Recorder.prototype.createRadialGradient = (x0, y0, r0, x1, y1, r1) => gradient(['radial', x0, y0, r0, x1, y1, r1]);

  // ---- the kit ----------------------------------------------------------------------------

  const mm = {
    group: (props) => new Node('group', props),
    mesh: (props) => new Node('mesh', props),
    avatar: (props) => new Node('avatar', props),
    label: (props) => new Node('label', props),
    // { shape | geometry, color | material, count, shadow, outline, parent }: place copies with
    // .update({ pos: [...], ... }) (many at once) or .at(i, { pos, rot, scale, color, visible }).
    instances: (props) => new Instances(props),
    crowd: (props) => new Crowd(props),
    // A thin line through points: { points: [x, y, z, ...], color, parent, pos } (a wire, a laser).
    line: (props) => new Node('line', props),
    // Another of a group built already (a baked one), sharing its shapes and materials: a group
    // of its own, in one piece, placed with props ({ pos, rot, scale, parent, ... }).
    copy(source, props) {
      if (!source || !source.alive) throw new Error('mm.copy() needs a group');
      flush();
      return new Node('group', Object.assign({}, props, { copy: source.id }));
    },
    // A bank of cloud in front of the scene: { pos, width, height, edge, top, color }, solid above
    // a wavy lower edge (the world height edge) up to top; move edge with .set({ edge }).
    mist: (props) => new Node('mist', props),
    // How the controls behave: { turn } adds quarter turns clockwise to every direction the
    // player gives, for a camera that looks along another axis (up on screen is then right on the
    // floor). Sent only when it changes.
    controls(options) {
      const text = JSON.stringify(options || {});
      if (text === lastControls) return;
      lastControls = text;
      out.push(['controls', options || {}]);
    },

    material(props) {
      const r = new Resource('material');
      out.push(['mat', r.id, pack(props)]);
      return r;
    },
    // draw(g, width, height) is called right away with something that works like a canvas 2D
    // context; what it draws becomes the texture.
    texture(width, height, draw, options) {
      const r = new Resource('texture');
      const g = new Recorder(width, height);
      draw(g, width, height);
      out.push(['tex', r.id, width, height, g.ops, options || {}]);
      return r;
    },
    // { positions, normals?, uvs?, indices?, groups?: [[start, count, materialIndex]] }. Its
    // .set({ positions }) moves the same vertices somewhere else (a flag waving), cheaply.
    geometry(data) {
      const r = new Resource('geometry');
      out.push(['geo', r.id, data]);
      return r;
    },
    // Merges every mesh under a group into as few meshes as possible (one draw call per
    // material) and removes the nodes that were under it. { colors: true }: meshes in plain colors
    // become one mesh, each part keeping its color (one draw call for a model in many colors).
    bake(group, options) {
      if (!group || !group.alive) return;
      flush();
      for (const child of group.children) child.forget();
      group.children.clear();
      out.push(['bake', group.id, options && options.colors === true ? { colors: true } : {}]);
    },
    world(options) {
      out.push(['world', options || {}]);
    },
    // Moves the sun: { pos, target } (where it shines from, and the middle of the area its
    // shadows cover), for a scene bigger than mm.world's shadowSize: keep it on the action. Sent
    // only when it changes.
    sun(options) {
      const o = pack(options);
      const text = JSON.stringify(o);
      if (text === lastSun) return;
      lastSun = text;
      out.push(['sun', o]);
    },
    camera(options) {
      camera = Object.assign(camera || {}, pack(options));
    },
    burst(options) {
      out.push(['burst', pack(options)]);
    },
    // A ring spreading out over water and fading: { pos, size, life }.
    ripple(options) {
      out.push(['ripple', pack(options)]);
    },
    // A sound: one of the synthesized ones by its name ('pop', 'win'), or one from the sound
    // library by its ('hit/wood-heavy'), with { volume, pitch, take, pan }.
    sound(name, ...args) {
      out.push(['sound', name, args]);
    },
    // The music: a loop from the library by name, faded in (and across from another), or null to
    // fade it out. { volume }. Call it every frame or once: it's sent only when it changes.
    music(name, options) {
      const o = [name ?? null, options ? pack(options) : null];
      const text = JSON.stringify(o);
      if (text === lastMusic) return;
      lastMusic = text;
      out.push(['music', ...o]);
    },
    // A looping sound from the library under a key of the game's own ('engine', 'rain'; up to 4
    // at once), or null to stop it. { volume, pitch }, which can change every frame (to follow a
    // speed, say). Sent only when it changes.
    loop(key, name, options) {
      const o = [String(key), name ?? null, options ? pack(options) : null];
      const text = JSON.stringify(o);
      if (text === lastLoops[o[0]]) return;
      lastLoops[o[0]] = text;
      out.push(['loop', ...o]);
    },
    hud: {
      // A score per player (in player order) on the chips along the top: numbers or short text.
      scores(values) {
        send('scores', values);
      },
      // Players who are out (their chips grey out): a list of player indexes.
      out(players) {
        send('out', players);
      },
      // Seconds left (rounded up), or null to hide the timer. options: { label (above the time,
      // 'Time' if left out), urgent (it turns red and ticks from this many seconds left; 10),
      // seconds: true (plain seconds rather than minutes:seconds) }.
      timer(seconds, options) {
        const value = seconds === null || seconds === undefined ? null : Math.max(0, Math.ceil(seconds));
        send('timer', options && value !== null ? Object.assign({}, options, { left: value }) : value);
      },
      // How ready the a button is after it's used, from 0 (just used) to 1 (ready): fills the
      // touch button and, on a keyboard or gamepad, a meter along the bottom.
      cooldown(value) {
        send('cooldown', typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : null);
      },
      // A short line in a pill along the top, beside the chips ("Round 3/12"), or null to hide it.
      status(text) {
        send('status', text === null || text === undefined ? null : String(text));
      },
      // The big call of the moment: { text, color, icon, progress (0 to 1, or null), flash },
      // or null to hide it. It pops in whenever its text or color changes.
      callout(options) {
        if (!options || typeof options !== 'object') return send('callout', null);
        const o = Object.assign({}, options);
        if (typeof o.progress === 'number') o.progress = Math.round(Math.max(0, Math.min(1, o.progress)) * 1000) / 1000;
        send('callout', o);
      },
      // A race track: { icon, values: [0..1 per player], stops: [colors], done: [players],
      // across }: down the right edge, or along the top with across: true.
      meter(options) {
        send('meter', options);
      },
      // A question with a number to pick: { question: [text, { text, color }, ...], value, picker,
      // locked, progress, lock, lockedText }, or null to hide it. Its −, + and Lock in send down,
      // up and a press of a.
      ask(options) {
        if (!options || typeof options !== 'object') return send('ask', null);
        const o = Object.assign({}, options);
        if (typeof o.progress === 'number') o.progress = Math.round(Math.max(0, Math.min(1, o.progress)) * 1000) / 1000;
        send('ask', o);
      },
      // A half-circle dial with a needle (balance): value from -1 (all the way left) to 1 (right),
      // { danger: true } to pulse it; null hides it.
      dial(value, options) {
        const ok = typeof value === 'number' && Number.isFinite(value);
        send('dial', ok ? { value: Math.round(Math.max(-1.1, Math.min(1.1, value)) * 1000) / 1000, danger: Boolean(options && options.danger === true) } : null);
      },
      // A big card in the middle: { title, text }, or null to hide it.
      card(options) {
        send('card', options && typeof options === 'object' ? options : null);
      },
      // The answer, big, near the top: { label, value, text, good }, or null to hide it.
      result(options) {
        send('result', options && typeof options === 'object' ? options : null);
      },
      // Shows (true) or hides (false) the controls hint along the bottom.
      hint(show) {
        send('hint', show !== false);
      },
      // Your place ("2nd" of 4) at the top right, or null to hide it.
      place(place, of) {
        send('place', typeof place === 'number' && Number.isFinite(place) ? { place: Math.round(place), of: typeof of === 'number' ? Math.round(of) : null } : null);
      },
      center(text, options) {
        out.push(['hud', 'center', text, options || {}]);
      },
      banner(text, options) {
        out.push(['hud', 'banner', text, options || {}]);
      },
      // A typing game's text box (manifest input.text): { show, placeholder }, or false to hide
      // it. It's shown from the start.
      textbox(options) {
        send('textbox', options === false ? { show: false } : options || {});
      },
    },
  };
  function send(part, value) {
    const text = JSON.stringify(value);
    if (hudLast[part] === text) return;
    hudLast[part] = text;
    out.push(['hud', part, value]);
  }
  global.mm = mm;

  function take() {
    flush();
    if (camera) {
      out.push(['camera', camera]);
      camera = null;
    }
    const commands = out;
    out = [];
    return commands;
  }

  global.__mmView = {
    setup(info, state) {
      if (!view) throw new Error('view.js never called defineView()');
      if (view.setup) view.setup(info, state);
      return take();
    },
    render(state, info) {
      view.render(state, info);
      return take();
    },
  };
})();

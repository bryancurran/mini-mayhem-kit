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
  let camera = null;
  const hudLast = {}; // last value sent per HUD part, so unchanged ones aren't resent
  let nextId = 1;

  const round = (v) => Math.round(v * 1e4) / 1e4;
  const isHandle = (v) => v !== null && typeof v === 'object' && typeof v.__mm === 'string';

  function vec(v) {
    if (typeof v === 'number') return round(v);
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? round(x) : x));
    return v;
  }

  function pack(props) {
    const o = {};
    for (const k of Object.keys(props || {})) {
      const v = props[k];
      if (v === undefined) continue;
      if (k === 'pos' || k === 'rot' || k === 'scale' || k === 'look') o[k] = vec(v);
      else if (k === 'material') o[k] = Array.isArray(v) ? v.map((m) => (isHandle(m) ? m.id : m)) : isHandle(v) ? v.id : v;
      else if (isHandle(v)) o[k] = v.id;
      else o[k] = v;
    }
    return o;
  }

  function flush() {
    for (const [id, props] of dirty) out.push(['set', id, props]);
    dirty.clear();
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
    // { positions, normals?, uvs?, indices?, groups?: [[start, count, materialIndex]] }
    geometry(data) {
      const r = new Resource('geometry');
      out.push(['geo', r.id, data]);
      return r;
    },
    // Merges every mesh under a group into as few meshes as possible (one draw call per
    // material) and removes the nodes that were under it.
    bake(group) {
      if (!group || !group.alive) return;
      flush();
      for (const child of group.children) child.forget();
      group.children.clear();
      out.push(['bake', group.id]);
    },
    world(options) {
      out.push(['world', options || {}]);
    },
    camera(options) {
      camera = Object.assign(camera || {}, pack(options));
    },
    burst(options) {
      out.push(['burst', pack(options)]);
    },
    sound(name, ...args) {
      out.push(['sound', name, args]);
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
      // Seconds left (rounded up), or null to hide the timer.
      timer(seconds) {
        send('timer', seconds === null || seconds === undefined ? null : Math.max(0, Math.ceil(seconds)));
      },
      // A vertical race track: { icon, values: [0..1 per player], stops: [colors] }.
      meter(options) {
        send('meter', options);
      },
      center(text, options) {
        out.push(['hud', 'center', text, options || {}]);
      },
      banner(text, options) {
        out.push(['hud', 'banner', text, options || {}]);
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

// Sandwich Stack's look: a picnic blanket, your sandwich in front, everyone else's in a row
// behind. The sandwiches are drawn from the game state every frame (so a corrected prediction
// just redraws); events add the effects: falling slices, flashes, sounds and floating text.

const PLATE_TOP = 0.12;
const BACK_ROW_Z = -10; // everyone else's sandwiches stand in a row behind yours…
const BACK_SCALE = 0.55; // …a bit smaller, so yours stays the star
const LANE_GAP = 3.1;
const LOOSE = 4; // the top few layers are meshes of their own; everything below is baked together
const CONFETTI = ['#ff4d5e', '#ffc83d', '#3ccf4e', '#3d8bff', '#a65bff', '#ff6fcf'];
const METER_STOPS = ['#ff5c6c', ['#ffd447', 40], ['#6fd14f', 70], '#e0a55c'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

// ---- textures ------------------------------------------------------------------------------

function dots(g, w, h, color, count, r, seed = 1) {
  g.fillStyle = color;
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < count; i++) {
    g.beginPath();
    g.arc(rand() * w, rand() * h, r * (0.6 + rand() * 0.6), 0, Math.PI * 2);
    g.fill();
  }
}

function stripes(g, w, h, colors, waves = 0) {
  const band = h / colors.length;
  colors.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, i * band);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, i * band + Math.sin((x / w) * Math.PI * 2 * waves) * band * 0.3);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.fill();
  });
}

// For each filling: the edge you see from the side, and the face you see from above. Both
// repeat every baseWidth along the sandwich.
const LOOKS = {
  bread: {
    side: (g, w, h) => {
      g.fillStyle = '#c98b45';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e0a55c';
      g.fillRect(0, h * 0.3, w, h * 0.4);
      dots(g, w, h, '#a96c30', 30, 2.2);
    },
    top: (g, w, h) => {
      g.fillStyle = '#f6dfb2';
      g.fillRect(0, 0, w, h);
      dots(g, w, h, '#e6c48c', 60, 3);
    },
  },
  lettuce: {
    side: (g, w, h) => stripes(g, w, h, ['#4bb534', '#6fd14f', '#9be46e'], 3),
    top: (g, w, h) => {
      g.fillStyle = '#62c947';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#a6ea7c';
      g.lineWidth = 4;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(i * 24, 0);
        g.quadraticCurveTo(i * 24 + 30, h / 2, i * 24 - 6, h);
        g.stroke();
      }
    },
  },
  tomato: {
    side: (g, w, h) => {
      g.fillStyle = '#ec3b2c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff7c69';
      g.fillRect(0, h * 0.2, w, h * 0.25);
    },
    top: (g, w, h) => {
      g.fillStyle = '#ec3b2c';
      g.fillRect(0, 0, w, h);
      for (const [cx, cy] of [
        [32, 40],
        [96, 88],
        [100, 24],
        [30, 104],
      ]) {
        g.fillStyle = '#ff6b57';
        g.beginPath();
        g.arc(cx, cy, 20, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffd56b';
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.beginPath();
          g.ellipse(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, 3, 5, a, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  },
  cheese: {
    side: (g, w, h) => {
      g.fillStyle = '#ffcc33';
      g.fillRect(0, 0, w, h);
      dots(g, w, h, '#e8a91c', 6, 5, 3);
    },
    top: (g, w, h) => {
      g.fillStyle = '#ffd447';
      g.fillRect(0, 0, w, h);
      dots(g, w, h, '#e8ac22', 9, 11, 5);
    },
  },
  ham: {
    side: (g, w, h) => {
      g.fillStyle = '#ff9aa9';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd1d9';
      g.fillRect(0, h * 0.65, w, h * 0.2);
    },
    top: (g, w, h) => {
      g.fillStyle = '#ff9aa9';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffd1d9';
      g.lineWidth = 5;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(64, 64, 14 + i * 16, 0.3 * i, 0.3 * i + 4);
        g.stroke();
      }
    },
  },
  bacon: {
    side: (g, w, h) => stripes(g, w, h, ['#b8402c', '#f2c3a2', '#c4492f', '#f2c3a2'], 2),
    top: (g, w, h) => stripes(g, w, h, ['#b8402c', '#f2c3a2', '#c4492f', '#f6d2b8', '#b8402c', '#f2c3a2'], 2),
  },
  pickle: {
    side: (g, w, h) => {
      g.fillStyle = '#6aa52b';
      g.fillRect(0, 0, w, h);
      dots(g, w, h, '#93c94a', 18, 4, 7);
    },
    top: (g, w, h) => {
      g.fillStyle = '#5b9a25';
      g.fillRect(0, 0, w, h);
      for (const [cx, cy] of [
        [30, 30],
        [94, 36],
        [40, 96],
        [100, 100],
        [66, 66],
      ]) {
        g.fillStyle = '#9fd25a';
        g.beginPath();
        g.arc(cx, cy, 18, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#d8efa0';
        g.beginPath();
        g.arc(cx, cy, 9, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  onion: {
    side: (g, w, h) => stripes(g, w, h, ['#f6efff', '#dcc8f4', '#f6efff', '#dcc8f4']),
    top: (g, w, h) => {
      g.fillStyle = '#f6efff';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#c9b0ea';
      g.lineWidth = 4;
      for (const [cx, cy] of [
        [40, 40],
        [96, 92],
      ]) {
        for (let r = 8; r < 40; r += 9) {
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.stroke();
        }
      }
    },
  },
  egg: {
    side: (g, w, h) => stripes(g, w, h, ['#ffffff', '#ffd23d', '#ffffff']),
    top: (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffc21f';
      for (const [cx, cy] of [
        [36, 44],
        [96, 92],
      ]) {
        g.beginPath();
        g.arc(cx, cy, 20, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  salami: {
    side: (g, w, h) => {
      g.fillStyle = '#b8323f';
      g.fillRect(0, 0, w, h);
      dots(g, w, h, '#f2b8bd', 16, 3, 9);
    },
    top: (g, w, h) => {
      g.fillStyle = '#b8323f';
      g.fillRect(0, 0, w, h);
      dots(g, w, h, '#f2b8bd', 40, 5, 11);
    },
  },
};

// A layer w wide and h thick: a box laid out like three.js's BoxGeometry (faces +x, −x, +y, −y,
// +z, −z, one material each), with its textures repeating every baseWidth so a narrow layer
// isn't a squashed-up wide one.
function layerGeometry(w, h) {
  const d = STACK.depth;
  const positions = [];
  const uvs = [];
  const indices = [];
  const groups = [];
  const plane = (u, v, axis, udir, vdir, width, height, depth, face) => {
    const base = positions.length / 3;
    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) {
        const p = [0, 0, 0];
        p[u] = (ix * width - width / 2) * udir;
        p[v] = (iy * height - height / 2) * vdir;
        p[axis] = depth / 2;
        positions.push(p[0], p[1], p[2]);
        const across = face < 2 ? d : w;
        uvs.push((ix * across) / STACK.baseWidth, face === 2 || face === 3 ? ((1 - iy) * d) / STACK.baseWidth : 1 - iy);
      }
    }
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    groups.push([face * 6, 6, face]);
  };
  plane(2, 1, 0, -1, -1, d, h, w, 0);
  plane(2, 1, 0, 1, -1, d, h, -w, 1);
  plane(0, 2, 1, 1, 1, w, d, h, 2);
  plane(0, 2, 1, 1, -1, w, d, -h, 3);
  plane(0, 1, 2, 1, -1, w, h, d, 4);
  plane(0, 1, 2, -1, -1, w, h, -d, 5);
  return { positions, uvs, indices, groups };
}

// ---- one player's sandwich -----------------------------------------------------------------

let fillings = [];
let mats = {};

function kindOf(n) {
  return fillings[n] ?? 'bread';
}

class Tower {
  constructor(player, origin, scale) {
    this.player = player;
    this.origin = origin;
    this.scale = scale;
    this.group = mm.group({ pos: origin, scale });
    mm.mesh({ shape: ['cylinder', 2.3, 1.9, PLATE_TOP, 40], color: '#ffffff', pos: [0, PLATE_TOP / 2, 0], parent: this.group, shadow: 'receive' });
    mm.mesh({ shape: ['torus', 2.2, 0.05, 8, 48], rot: [Math.PI / 2, 0, 0], color: player.color, pos: [0, PLATE_TOP, 0], parent: this.group });
    this.stack = mm.group({ parent: this.group }); // squashes a little when a layer lands
    this.frozen = null; // layers below the top few, baked into one mesh
    this.loose = []; // the top few layers' meshes
    this.shown = []; // the layers drawn, [x, w] each
    this.bottoms = [PLATE_TOP]; // bottoms[i] = height of layer i's underside
    this.slider = mm.mesh({ geometry: layerGeometry(1, 1), material: mats.bread, parent: this.group, visible: false, shadow: 'cast' });
    this.sliderKey = '';
    this.sliderShown = false;
    this.squash = 0;
    this.squashShown = 0;
    this.capped = false;
    this.cap = null;
    this.labelY = null;
  }

  height(n) {
    return layerHeight(fillings, n);
  }

  topY() {
    return this.bottoms[this.shown.length];
  }

  // Height of layer n's underside (n can be past the top, when several drops arrive at once).
  bottom(n) {
    let y = this.topY();
    for (let i = this.shown.length; i < n; i++) y += this.height(i);
    return n <= this.shown.length ? this.bottoms[n] : y;
  }

  // A point on this sandwich (x across it, y up from the blanket) in the world.
  world(x, y) {
    return [this.origin[0] + x * this.scale, this.origin[1] + y * this.scale, this.origin[2]];
  }

  layerMesh(n, parent) {
    const [x, w] = this.shown[n];
    const h = this.height(n);
    return mm.mesh({ geometry: layerGeometry(w, h), material: mats[kindOf(n)], pos: [x, this.bottoms[n] + h / 2, 0], parent, shadow: true });
  }

  // Draws the sandwich from scratch.
  rebuild(layers) {
    this.frozen?.remove();
    for (const m of this.loose) m.remove();
    this.shown = layers.map((l) => [l[0], l[1]]);
    this.bottoms.length = 1;
    for (let n = 0; n < layers.length; n++) this.bottoms[n + 1] = this.bottoms[n] + this.height(n);
    const frozenCount = Math.max(0, layers.length - LOOSE);
    this.frozen = mm.group({ parent: this.stack });
    for (let n = 0; n < frozenCount; n++) this.layerMesh(n, this.frozen);
    if (frozenCount) mm.bake(this.frozen);
    this.loose = [];
    for (let n = frozenCount; n < layers.length; n++) this.loose.push(this.layerMesh(n, this.stack));
  }

  // A newly placed layer gets its own mesh; the oldest loose one joins the baked ones.
  addLayer(layer) {
    const n = this.shown.length;
    this.shown.push([layer[0], layer[1]]);
    this.bottoms[n + 1] = this.bottoms[n] + this.height(n);
    this.loose.push(this.layerMesh(n, this.stack));
    if (this.loose.length > LOOSE) {
      this.loose.shift().set({ parent: this.frozen });
      mm.bake(this.frozen);
    }
  }

  // Makes the drawing match the state: usually nothing, or one new layer.
  sync(layers) {
    const shown = this.shown;
    const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
    const last = layers.length - 1;
    if (layers.length === shown.length && same(layers[last], shown[last])) return;
    if (layers.length === shown.length + 1 && same(layers[last - 1], shown[last - 1])) this.addLayer(layers[last]);
    else this.rebuild(layers);
  }

  update(s, T, dt, sliding) {
    // The layer sliding over the top, from the moment it's due.
    const show = sliding && T >= s.at;
    if (show) {
      const n = s.layers.length;
      const kind = kindOf(n);
      const w = s.layers[n - 1][1];
      const h = this.height(n);
      const key = `${kind}:${w}`;
      if (key !== this.sliderKey) {
        this.sliderKey = key;
        this.slider.set({ geometry: layerGeometry(w, h), material: mats[kind] });
      }
      const pop = clamp((T - s.at) / 0.12, 0, 1);
      this.slider.set({ pos: [sliderX(n, T - s.at), this.topY() + h / 2 + (1 - pop) * 0.6, 0] });
    }
    if (show !== this.sliderShown) {
      this.sliderShown = show;
      this.slider.set({ visible: show });
    }
    this.squash = Math.max(0, this.squash - dt * 3);
    const k = Math.sin(this.squash * Math.PI) * 0.06;
    if (k !== this.squashShown) {
      this.squashShown = k;
      this.stack.set({ scale: [1 + k, 1 - k, 1 + k] });
    }
  }
}

// ---- the view ------------------------------------------------------------------------------

let me = -1;
let players = [];
let towers = [];
let myTower = null;
let falling = [];
let flashes = [];
let floaters = [];
let camY = 1;
let shake = 0;
let decided = false;
let firstFrame = true;

function addFalling(tower, { kind, x, y, w, h, vx = 0, vy = 0, spin = 0 }) {
  const mesh = mm.mesh({ geometry: layerGeometry(w, h), material: mats[kind], pos: tower.world(x, y), scale: tower.scale, shadow: 'cast' });
  falling.push({ mesh, pos: tower.world(x, y), rz: 0, vx, vy, vz: (Math.random() - 0.5) * 1.5, spin, life: 2.2, scale: tower.scale });
}

// A white outline around a perfectly placed layer.
function flash(tower, x, y, w) {
  const material = mm.material({ color: '#ffffff', unlit: true, opacity: 0.8, depthWrite: false, outline: false });
  const size = [w + 0.3, STACK.depth + 0.3];
  const mesh = mm.mesh({ shape: ['plane', 1, 1], material, rot: [-Math.PI / 2, 0, 0], pos: tower.world(x, y + 0.02), scale: [size[0] * tower.scale, size[1] * tower.scale, 1] });
  flashes.push({ mesh, material, size, scale: tower.scale, life: 0.45 });
}

// Floating text over your sandwich ("Perfect! ×3").
function floatText(text, tone) {
  if (!myTower) return;
  const y = myTower.topY() + 0.4;
  const label = mm.label({ text, style: 'float', tone, pos: [1.9, y, 0] });
  floaters.push({ label, y, life: 0.9 });
}

function confetti([x, y, z]) {
  for (let i = 0; i < 3; i++) mm.burst({ pos: [x, y, z], count: 26, speed: 6, up: 8, life: 1.5, size: 0.14, gravity: 11, colors: CONFETTI });
}

// The top slice of bread and a cocktail stick once time's up.
function capSandwich(tower) {
  if (tower.capped) return;
  tower.capped = true;
  const top = tower.shown[tower.shown.length - 1];
  const rest = tower.topY() + STACK.baseHeight / 2;
  const group = mm.group({ parent: tower.group, pos: [top[0], rest + 3, 0] });
  mm.mesh({ geometry: layerGeometry(top[1], STACK.baseHeight), material: mats.bread, parent: group, shadow: 'cast' });
  mm.mesh({ shape: ['cylinder', 0.03, 0.03, 1.2, 6], color: '#e8c98f', pos: [0, 0.5, 0], parent: group });
  mm.mesh({ shape: ['sphere', 0.16, 12, 10], color: '#5f8f2a', pos: [0, 0.95, 0], parent: group });
  const flag = mm.material({ color: tower.player.color, side: 'double' });
  mm.mesh({ shape: ['plane', 0.4, 0.26], material: flag, pos: [0.2, 1.02, 0], parent: group });
  tower.cap = { group, x: top[0], y: rest + 3, rest, vy: 0 };
}

function onDecided(winners, quiet) {
  decided = true;
  for (const tower of towers) capSandwich(tower);
  if (quiet) return;
  for (const p of winners) {
    const t = towers[p];
    if (t) confetti(t.world(0, t.topY() + 1));
  }
  if (winners.includes(me)) {
    mm.hud.center(winners.length === 1 ? 'YOU WIN!' : 'TIE!', { style: 'big', ms: 0 });
    mm.sound('win');
  } else {
    mm.hud.center('TIME!', { style: 'go', ms: 1400 });
    const names = winners.map((p) => players[p].name);
    if (names.length) mm.hud.banner(`${names.join(' & ')} ${names.length === 1 ? 'wins' : 'tie'} with the tallest sandwich!`, { style: 'info' });
  }
}

function onDrop(ev) {
  const tower = towers[ev.player];
  if (!tower) return;
  const n = ev.n;
  const kind = kindOf(n);
  const h = tower.height(n);
  const mine = ev.player === me;
  const bottom = tower.bottom(n);
  if (ev.miss) {
    // The whole layer falls past, and knocks the top of the sandwich off.
    addFalling(tower, { kind, x: ev.x, y: bottom + h / 2, w: ev.w, h, vx: ev.x > 0 ? 2 : -2, spin: ev.x > 0 ? -3 : 3 });
    for (let k = 0; k < ev.lost; k++) {
      const i = n - 1 - k;
      const layer = tower.shown[i];
      if (!layer) continue;
      const hi = tower.height(i);
      addFalling(tower, { kind: kindOf(i), x: layer[0], y: tower.bottom(i) + hi / 2, w: layer[1], h: hi, vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 3, spin: (Math.random() - 0.5) * 8 });
    }
    tower.squash = 0.6;
    if (mine) {
      mm.sound('fall');
      mm.sound('thud', 0.6);
      shake = 0.45;
      floatText(ev.lost ? `Miss! −${ev.lost}` : 'Miss!', 'bad');
    }
    return;
  }
  const top = bottom + h;
  if (ev.cut) addFalling(tower, { kind, x: ev.cut.x, y: bottom + h / 2, w: ev.cut.w, h, vx: ev.cut.x > ev.x ? 1.6 : -1.6, spin: ev.cut.x > ev.x ? -2.5 : 2.5 });
  if (ev.perfect) flash(tower, ev.x, top, ev.w);
  tower.squash = ev.perfect ? 0.5 : 0.35;
  if (!mine) return;
  if (ev.perfect) {
    mm.sound('thud', 1.2);
    mm.sound('collect', ev.combo - 1);
    floatText(ev.combo > 1 ? `Perfect! ×${ev.combo}` : 'Perfect!', ev.combo >= STACK.growAfter ? 'great' : 'good');
    mm.burst({ pos: tower.world(ev.x, top), count: 10 + Math.min(ev.combo, 8) * 2, speed: 3, up: 3, life: 0.5, size: 0.1, gravity: 6, colors: ['#ffffff', '#ffe27a'] });
  } else {
    mm.sound('thud', 1);
    if (ev.cut) mm.sound('slice');
  }
}

function updateEffects(dt) {
  falling = falling.filter((f) => {
    f.life -= dt;
    f.vy -= 20 * dt;
    f.pos[0] += f.vx * dt;
    f.pos[1] += f.vy * dt;
    f.pos[2] += f.vz * dt;
    f.rz += f.spin * dt;
    // Land on the blanket and lie there for a moment.
    if (f.pos[1] < 0.15) {
      f.pos[1] = 0.15;
      f.vy = Math.abs(f.vy) * 0.25;
      f.vx *= 0.6;
      f.spin *= 0.5;
    }
    if (f.life <= 0) {
      f.mesh.remove();
      return false;
    }
    const props = { pos: f.pos, rot: [0, 0, f.rz] };
    if (f.life < 0.4) props.scale = Math.max(0.001, f.life / 0.4) * f.scale;
    f.mesh.set(props);
    return true;
  });
  flashes = flashes.filter((f) => {
    f.life -= dt;
    if (f.life <= 0) {
      f.mesh.remove();
      f.material.dispose();
      return false;
    }
    const k = (1 + (0.45 - f.life) * 0.5) * f.scale;
    f.material.set({ opacity: Math.max(0, f.life / 0.45) * 0.8 });
    f.mesh.set({ scale: [f.size[0] * k, f.size[1] * k, 1] });
    return true;
  });
  floaters = floaters.filter((f) => {
    f.life -= dt;
    if (f.life <= 0) {
      f.label.remove();
      return false;
    }
    f.y += dt * 1.2;
    f.label.set({ pos: [1.9, f.y, 0], opacity: Math.min(1, f.life * 3) });
    return true;
  });
  // Top slices dropping on at the end.
  for (const tower of towers) {
    const c = tower.cap;
    if (!c || c.y === c.rest) continue;
    c.vy -= 18 * dt;
    c.y = Math.max(c.rest, c.y + c.vy * dt);
    c.group.set({ pos: [c.x, c.y, 0] });
  }
}

// Follows the top of your sandwich (or, watching, the tallest one).
function updateCamera(dt, aspect) {
  let top = myTower ? myTower.topY() : 1;
  if (!myTower) for (const t of towers) top = Math.max(top, t.world(0, t.topY())[1]);
  camY = damp(camY, top + 0.3, 4, dt);
  const fov = aspect < 0.8 ? 52 : 40;
  // Wide enough to see your whole slide (and some neighbors) on any screen.
  const halfWidth = aspect < 0.8 ? 4.4 : 7.5;
  const hfov = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
  const dist = halfWidth / Math.tan(hfov / 2);
  // Looking down a little, so the sandwiches behind show up above yours rather than behind it.
  const pos = [0, camY + dist * 0.42, dist];
  shake = Math.max(0, shake - dt * 2.5);
  if (shake > 0) {
    const s = shake * shake;
    pos[0] += (Math.random() - 0.5) * s;
    pos[1] += (Math.random() - 0.5) * s;
  }
  // On tall screens your sandwich's top sits a bit above the middle.
  mm.camera({ pos, look: [0, camY - (aspect < 0.8 ? 2.4 : 0.6), 0], fov });
}

function buildPicnic() {
  mm.mesh({ shape: ['circle', 160, 48], rot: [-Math.PI / 2, 0, 0], color: '#7fd66b', shadow: 'receive' });
  const check = mm.texture(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ff5c6c';
    g.globalAlpha = 0.85;
    g.fillRect(0, 0, 32, 64);
    g.fillRect(0, 0, 64, 32);
    g.globalAlpha = 1;
    g.fillStyle = '#e8384a';
    g.fillRect(0, 0, 32, 32);
  });
  const blanket = mm.material({ texture: check, repeat: [23, 15] });
  mm.mesh({ shape: ['plane', 46, 30], rot: [-Math.PI / 2, 0, 0], material: blanket, pos: [0, 0.01, 2], shadow: 'receive' });

  // A picnic basket and a jug of lemonade in front (tall phone screens see a lot of blanket).
  const basket = mm.group({ pos: [-3.6, 0, 5.2], rot: [0, 0.35, 0] });
  const wicker = '#d39b52';
  mm.mesh({ shape: ['box', 2.4, 1.3, 1.6], color: wicker, pos: [0, 0.65, 0], parent: basket, shadow: 'cast' });
  mm.mesh({ shape: ['box', 2.5, 0.18, 1.7], color: '#b97c38', pos: [0, 1.36, 0], parent: basket, shadow: 'cast' });
  mm.mesh({ shape: ['torus', 0.7, 0.08, 8, 24, Math.PI], color: wicker, pos: [0, 1.4, 0], parent: basket, shadow: 'cast' });
  mm.mesh({ shape: ['box', 0.9, 0.12, 1.75], color: '#ff5c6c', pos: [-0.6, 1.47, 0], parent: basket, shadow: 'cast' });
  const jug = mm.group({ pos: [3.7, 0, 5.4] });
  mm.mesh({ shape: ['cylinder', 0.55, 0.62, 1.6, 20], color: '#fff3a6', pos: [0, 0.8, 0], parent: jug, shadow: 'cast' });
  mm.mesh({ shape: ['cylinder', 0.3, 0.3, 0.06, 16], rot: [0, 0, Math.PI / 2], color: '#ffd23d', pos: [0, 1.62, 0.2], parent: jug, shadow: 'cast' });
  mm.mesh({ shape: ['cone', 0.18, 0.4, 10], rot: [0, 0, -Math.PI / 2.4], color: '#fff3a6', pos: [0.6, 1.45, 0], parent: jug, shadow: 'cast' });

  // Trees around the park.
  const leafColors = ['#4fbf5a', '#3fae4c', '#62cc63'];
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * (0.08 + (i / 21) * 0.84) + Math.PI;
    const r = 26 + (i % 3) * 7 + Math.random() * 4;
    const tree = mm.group({ pos: [Math.cos(a) * r, 0, Math.sin(a) * r * 0.8 - 6], scale: 1 + Math.random() * 0.5 });
    mm.mesh({ shape: ['cylinder', 0.35, 0.5, 3, 8], color: '#9a6a44', pos: [0, 1.5, 0], parent: tree });
    mm.mesh({ shape: ['icosahedron', 2.4, 1], color: leafColors[i % 3], pos: [0, 3.6, 0], parent: tree });
    mm.mesh({ shape: ['icosahedron', 1.8, 1], color: leafColors[i % 3], pos: [0, 4.8, 0], parent: tree });
  }
}

defineView({
  setup(view) {
    me = view.me;
    players = view.players;
    fillings = buildFillings(view.seed);
    mats = {};
    for (const [kind, look] of Object.entries(LOOKS)) {
      const side = mm.material({ texture: mm.texture(128, 32, look.side) });
      const top = mm.material({ texture: mm.texture(128, 128, look.top) });
      mats[kind] = [side, side, top, top, side, side];
    }
    mm.world({ sky: true, lights: { shadowSize: 24 }, clouds: { minRadius: 70, maxRadius: 160, minY: 10, maxY: 45 } });
    buildPicnic();

    // Your sandwich at the front; everyone else's in a row behind, nearest first, alternating
    // sides so yours doesn't hide anyone.
    towers = [];
    let k = 0;
    for (const p of players) {
      if (p.index === me) {
        towers[p.index] = myTower = new Tower(p, [0, 0, 0], 1);
        continue;
      }
      const side = k % 2 ? 1 : -1;
      const slot = Math.floor(k / 2);
      k++;
      const tower = new Tower(p, [side * (LANE_GAP / 2 + slot * LANE_GAP), 0, BACK_ROW_Z + slot * 0.8], BACK_SCALE);
      tower.label = mm.label({ text: p.name, color: p.color, style: 'tag' });
      towers[p.index] = tower;
    }
  },

  render(state, view) {
    const T = view.time;
    const dt = view.dt;
    // Effects first, while the sandwiches still look the way they did before these events.
    for (const ev of view.events) if (ev.type === 'drop') onDrop(ev);
    for (const ev of view.confirmed) if (ev.type === 'timeup' && !decided) onDecided(ev.winners, false);

    const sliding = T >= 0 && T <= STACK.roundTime && !decided && !view.ended;
    let most = 0;
    state.sandwiches.forEach((s, p) => {
      const tower = towers[p];
      tower.sync(s.layers);
      tower.update(s, T, dt, sliding);
      most = Math.max(most, s.layers.length - 1);
      if (tower.label) {
        const y = tower.topY();
        if (y !== tower.labelY) {
          tower.labelY = y;
          tower.label.set({ pos: tower.world(0, y + 1.6) });
        }
      }
    });
    // Joined after time was up: no fanfare, just the finished sandwiches.
    if (firstFrame && state.phase === 'done' && !decided) onDecided(state.winners, true);
    firstFrame = false;

    updateEffects(dt);
    updateCamera(dt, view.screen.aspect);

    const scale = Math.max(20, most + 6);
    mm.hud.scores(state.sandwiches.map((s) => s.layers.length - 1));
    mm.hud.meter({ icon: '🥪', values: state.sandwiches.map((s) => (s.layers.length - 1) / scale), stops: METER_STOPS });
    mm.hud.timer(Math.max(0, STACK.roundTime - Math.max(0, T)));
  },
});

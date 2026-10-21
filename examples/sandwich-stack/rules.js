// Sandwich Stack, as a packaged minigame. Each new layer slides back and forth over your stack;
// drop it at the right moment. Whatever hangs over the edge gets sliced off, so the sandwich gets
// narrower unless you're spot on. Miss completely and the top of the stack falls off. Tallest
// sandwich when time's up wins.
//
// These rules run on the server and in every browser. The engine predicts your own drops the
// moment you press and replays everyone's drops in the same order everywhere, so all copies of
// every sandwich agree. view.js can use everything defined at the top level here.

const STACK = {
  roundTime: 60,
  baseWidth: 3.2, // the bottom slice of bread
  depth: 2.4,
  baseHeight: 0.42,
  swing: 2.5, // a sliding layer travels this far either side of the plate's middle
  speedStart: 2.4, // how fast it slides (units/s) on the first layer…
  speedStep: 0.07, // …and this much faster for every layer on the stack…
  speedMax: 5.4, // …up to this
  perfect: 0.1, // drops this close to the layer below are perfect: nothing is sliced off
  growAfter: 3, // from this many perfects in a row on, each perfect widens the sandwich…
  growBy: 0.15, // …by this much (never wider than the bottom slice)
  minOverlap: 0.04, // overlapping by less than this is a miss
  missLoss: 2, // layers that fall off when you miss
  nextDelay: 0.3, // pause after a drop before the next layer slides in
  missDelay: 0.9, // longer after a miss
  endDelay: 2.2, // once time's up, the game ends this much later
};

// Fillings: h = how thick the layer is. Every sixth layer is a slice of bread (a club sandwich).
const INGREDIENTS = {
  bread: { name: 'Bread', h: 0.36 },
  lettuce: { name: 'Lettuce', h: 0.15 },
  tomato: { name: 'Tomato', h: 0.17 },
  cheese: { name: 'Cheese', h: 0.12 },
  ham: { name: 'Ham', h: 0.15 },
  bacon: { name: 'Bacon', h: 0.12 },
  pickle: { name: 'Pickles', h: 0.12 },
  onion: { name: 'Onion', h: 0.12 },
  egg: { name: 'Egg', h: 0.14 },
  salami: { name: 'Salami', h: 0.13 },
};
const FILLINGS = Object.keys(INGREDIENTS).filter((k) => k !== 'bread');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The fillings for layers 1, 2, 3… (layer 0 is the bottom slice of bread). Never the same
// filling twice in a row.
function buildFillings(seed, count = 200) {
  const rand = mulberry32(seed);
  const kinds = ['bread'];
  for (let n = 1; n < count; n++) {
    if (n % 6 === 0) {
      kinds.push('bread');
      continue;
    }
    let k;
    do k = FILLINGS[Math.floor(rand() * FILLINGS.length)];
    while (k === kinds[n - 1]);
    kinds.push(k);
  }
  return kinds;
}

function layerHeight(kinds, n) {
  return n === 0 ? STACK.baseHeight : INGREDIENTS[kinds[n] ?? 'bread'].h;
}

function slideSpeed(n) {
  return Math.min(STACK.speedMax, STACK.speedStart + STACK.speedStep * n);
}

// Where layer n is while it slides, `age` seconds after it appeared: in from one side
// (alternating each layer), across, back, and so on.
function sliderX(n, age) {
  const A = STACK.swing;
  const travel = (Math.max(0, age) * slideSpeed(n)) % (4 * A);
  const x = travel < 2 * A ? -A + travel : 3 * A - travel;
  return n % 2 ? -x : x;
}

// Dropping a layer of width w at x onto top = [x, w]. Returns { miss } or the new layer
// { x, w, perfect, cut } where cut = { x, w } is the part sliced off (or null).
function dropLayer(top, x, w, combo) {
  const S = STACK;
  const [tx, tw] = top;
  if (Math.abs(x - tx) <= S.perfect) {
    // Spot on: lines up exactly, and a streak of these widens the sandwich again.
    const grown = combo + 1 >= S.growAfter ? Math.min(S.baseWidth, w + S.growBy) : w;
    return { miss: false, x: tx, w: grown, perfect: true, cut: null };
  }
  const lo = Math.max(tx - tw / 2, x - w / 2);
  const hi = Math.min(tx + tw / 2, x + w / 2);
  if (hi - lo < S.minOverlap) return { miss: true };
  const cut = x > tx ? { x: (hi + x + w / 2) / 2, w: x + w / 2 - hi } : { x: (x - w / 2 + lo) / 2, w: lo - (x - w / 2) };
  return { miss: false, x: (lo + hi) / 2, w: hi - lo, perfect: false, cut: cut.w > 0.001 ? cut : null };
}

// The layer sliding over a sandwich at game time t: it's as wide as the top layer.
function slidingLayer(s, t) {
  const n = s.layers.length;
  return { n, x: sliderX(n, t - s.at), w: s.layers[n - 1][1] };
}

// Drops the sliding layer at game time t and returns what happened.
function dropAt(s, t) {
  const S = STACK;
  const slide = slidingLayer(s, t);
  const top = s.layers[s.layers.length - 1];
  const result = dropLayer(top, slide.x, slide.w, s.combo);
  s.drops++;
  if (result.miss) {
    const lost = Math.min(S.missLoss, s.layers.length - 1);
    s.layers.length -= lost;
    s.combo = 0;
    s.misses++;
    s.at = t + S.missDelay;
    return { miss: true, lost, x: slide.x, w: slide.w, n: slide.n };
  }
  s.layers.push([result.x, result.w]);
  s.combo = result.perfect ? s.combo + 1 : 0;
  if (result.perfect) s.perfects++;
  s.at = t + S.nextDelay;
  s.lastDropAt = t;
  return { ...result, n: slide.n, from: slide.x, combo: s.combo };
}

// Tallest first; then the wider top, then whoever got there first.
function compareSandwiches(a, b) {
  return b.layers.length - a.layers.length || b.layers[b.layers.length - 1][1] - a.layers[a.layers.length - 1][1] || a.lastDropAt - b.lastDropAt;
}

function ranking(state) {
  const order = state.sandwiches.map((s, player) => player);
  order.sort((a, b) => compareSandwiches(state.sandwiches[a], state.sandwiches[b]));
  let place = 0;
  return order.map((player, i) => {
    if (i === 0 || compareSandwiches(state.sandwiches[player], state.sandwiches[order[i - 1]]) !== 0) place = i + 1;
    return { player, place };
  });
}

// ---- bots ------------------------------------------------------------------------------------
//
// How the server's bots play (bot() at the bottom; see "Bots" in docs/making-games.md). A good
// player watches the layer slide and taps just as it passes over the top of the stack, so that's
// what a bot aims for. Then it's made human, or it would never miss: each bot is sharper or
// clumsier than the others, needs a moment to get going on a new layer, is always a touch early
// or late, is off by a bit more on every drop (more as the layers speed up), slips now and then,
// and now and then isn't ready and lets the layer go by once. Only bot() uses these helpers (they
// start with "bot" so their names can't clash with view.js's).

// Random numbers that come out the same every time they're asked for: the same seed, player and k
// give the same list. A bot's habits come from k = -1, so they last the whole game. Its error on a
// drop comes from k = the drop's number, so it stays put while the bot waits for its moment (fresh
// numbers on every go would have it change its mind ten times a second).
function botDice(seed, player, k) {
  return mulberry32(seed ^ Math.imul(player + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca77));
}

// How long after layer n appeared it's over x for the k-th time (k = 0, 1, 2…): on the way across
// (even k), on the way back (odd k), across again… sliderX worked backwards.
function botPassAge(n, x, k) {
  const A = STACK.swing;
  const v = slideSpeed(n);
  const u = n % 2 ? -x : x; // (sliderX mirrors every other layer)
  const lap = (4 * A) / v; // there and back
  return Math.floor(k / 2) * lap + (k % 2 ? 3 * A - u : A + u) / v;
}

// The moment (game time) this bot means to drop the layer sliding over sandwich s: the first time
// it passes over the top once the bot's had time to react, give or take this drop's error. If
// that moment's gone by (it's now `now`), the next time it passes.
function botAim(s, player, seed, now) {
  const n = s.layers.length;
  const [topX, topW] = s.layers[n - 1];

  // Its habits, the same all game. skill runs from 0 (clumsy) to 1 (sharp).
  const habit = botDice(seed, player, -1);
  const skill = habit();
  const bias = (habit() - 0.5) * 0.04 * (1 - 0.7 * skill); // seconds early (-) or late (+), every time
  const react = 0.12 + habit() * 0.08 + 0.12 * (1 - skill); // how soon it can tap a new layer

  // This drop. `fast` goes from 0 on the first layer to 1 once they slide at full speed.
  const roll = botDice(seed, player, s.drops);
  const fast = (slideSpeed(n) - STACK.speedStart) / (STACK.speedMax - STACK.speedStart);
  const spread = (0.006 + 0.06 * (1 - skill)) * (1 + 0.6 * fast);
  // (Four random numbers added up make a bell curve: mostly small errors, now and then a big one.)
  let off = bias + spread * (roll() + roll() + roll() + roll() - 2) * 1.732;
  // A slip: way off, early or late.
  if (roll() < (0.015 + 0.05 * fast) * (1.6 - skill)) off += (roll() < 0.5 ? -1 : 1) * (0.09 + roll() * 0.12);
  // Not ready: lets the layer go by once (more often once the sandwich is narrow).
  let skip = roll() < (topW < 1.2 ? 0.12 : 0.05) ? 1 : 0;

  for (let k = 0; k < 40; k++) {
    const age = botPassAge(n, topX, k);
    if (age < react) continue;
    if (skip > 0) {
      skip--;
      continue;
    }
    const at = s.at + Math.max(0.15, age + off);
    if (at >= now - 0.12) return at; // (a little late is still worth a tap)
  }
  return Infinity;
}

defineRules({
  setup(game) {
    return {
      phase: 'play', // then 'done' once time's up
      endAt: 0,
      winners: [],
      // layers[0] is the bottom slice of bread; each layer is [x, width]. `at` is when the
      // layer now sliding appeared.
      sandwiches: game.players.map(() => ({ layers: [[0, STACK.baseWidth]], combo: 0, at: 0, drops: 0, misses: 0, perfects: 0, lastDropAt: 0 })),
    };
  },

  input(state, input, game) {
    if (input.type !== 'press' || state.phase !== 'play' || input.time > STACK.roundTime) return;
    const s = state.sandwiches[input.player];
    if (input.time < s.at) return; // the next layer isn't in yet
    const result = dropAt(s, input.time);
    game.emit({ type: 'drop', player: input.player, ...result });
  },

  step(state, game) {
    if (state.phase === 'play' && game.time >= STACK.roundTime) {
      state.phase = 'done';
      state.endAt = game.time + STACK.endDelay;
      state.winners = ranking(state)
        .filter((r) => r.place === 1)
        .map((r) => r.player);
      game.emit({ type: 'timeup', winners: state.winners });
    }
    if (state.phase === 'done' && game.time >= state.endAt) game.end();
  },

  results(state) {
    return ranking(state);
  },

  // What a bot holds right now. The server asks ten times a second, so it taps on the go nearest
  // the moment it aims for (never more than 0.05 s out: that's part of being human too). A tap is
  // holding the button in one answer and letting go in the next: once a drop lands, the next
  // layer isn't in for a moment, so the next answer is null, which lets go.
  bot(state, player, game) {
    const s = state.sandwiches[player];
    const now = game.time; // (a press made now lands a moment later, within a tick: close enough)
    if (!s || state.phase !== 'play' || now < s.at || now > STACK.roundTime) return null;
    return now >= botAim(s, player, game.seed, now) - 0.05 ? { a: true } : null;
  },
});

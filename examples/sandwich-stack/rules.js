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
});

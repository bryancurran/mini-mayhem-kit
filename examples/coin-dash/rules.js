// Coin Dash: run around a round arena and grab coins before anyone else does. Dash for a burst
// of speed. Most coins when time's up wins.
//
// These rules run on the server and in every player's browser, so they have to give exactly
// the same result everywhere: keep everything in `state` (plain data) and use game.random()
// for randomness. view.js can use anything defined at the top level here.

const ARENA = 8; // radius of the arena
const SPEED = 5.5; // running speed (units a second)
const DASH_SPEED = 14;
const DASH_TIME = 0.18; // seconds a dash lasts…
const DASH_COOLDOWN = 1.2; // …and before the next one
const REACH = 0.95; // how close you need to get to a coin
const COINS = 6; // coins on the arena at once
const ROUND = 45; // seconds
const round3 = (v) => Math.round(v * 1000) / 1000;

// A coin somewhere on the arena (spread evenly, not bunched in the middle).
function newCoin(game) {
  const a = game.random() * Math.PI * 2;
  const r = Math.sqrt(game.random()) * (ARENA - 1);
  return [round3(Math.cos(a) * r), round3(Math.sin(a) * r)];
}

// Most coins first; equal coins share a place.
function ranking(state) {
  return state.players.map((p, player) => ({ player, place: 1 + state.players.filter((q) => q.coins > p.coins).length }));
}

defineRules({
  setup(game) {
    const n = game.players.length;
    return {
      phase: 'play', // then 'done' for a moment once time's up
      endAt: 0,
      winners: [],
      // Everyone starts on a circle, facing the middle.
      players: game.players.map((p, i) => {
        const a = (i / n) * Math.PI * 2;
        return { x: round3(Math.cos(a) * 4), z: round3(Math.sin(a) * 4), face: round3(Math.atan2(-Math.cos(a), -Math.sin(a))), sx: 0, sz: 0, dash: 0, cool: 0, coins: 0 };
      }),
      coins: Array.from({ length: COINS }, () => newCoin(game)),
    };
  },

  input(state, input) {
    const p = state.players[input.player];
    if (input.type === 'move') {
      // The stick: x right, y up (away from the camera, which is -z here).
      p.sx = input.x;
      p.sz = -input.y;
    } else if (input.type === 'press' && input.button === 'a' && p.cool <= 0 && state.phase === 'play') {
      p.dash = DASH_TIME;
      p.cool = DASH_COOLDOWN;
    }
  },

  step(state, game) {
    if (state.phase === 'done') {
      if (game.time >= state.endAt) game.end();
      return;
    }
    state.players.forEach((p, i) => {
      const len = Math.hypot(p.sx, p.sz);
      if (len > 0.05) p.face = round3(Math.atan2(p.sx, p.sz));
      // Dashing goes the way you face, even with the stick let go.
      const speed = p.dash > 0 ? DASH_SPEED : SPEED * Math.min(1, len);
      const dx = p.dash > 0 ? Math.sin(p.face) : len > 0 ? p.sx / len : 0;
      const dz = p.dash > 0 ? Math.cos(p.face) : len > 0 ? p.sz / len : 0;
      let x = p.x + dx * speed * game.dt;
      let z = p.z + dz * speed * game.dt;
      const r = Math.hypot(x, z);
      if (r > ARENA - 0.5) {
        x *= (ARENA - 0.5) / r;
        z *= (ARENA - 0.5) / r;
      }
      p.x = round3(x);
      p.z = round3(z);
      p.dash = round3(Math.max(0, p.dash - game.dt));
      p.cool = round3(Math.max(0, p.cool - game.dt));
      state.coins.forEach((c, k) => {
        if (Math.hypot(c[0] - p.x, c[1] - p.z) > REACH) return;
        p.coins++;
        game.emit({ type: 'coin', player: i, x: c[0], z: c[1], coins: p.coins });
        state.coins[k] = newCoin(game);
      });
    });
    if (game.time >= ROUND) {
      state.phase = 'done';
      state.endAt = game.time + 2;
      state.winners = ranking(state).filter((r) => r.place === 1).map((r) => r.player);
      game.emit({ type: 'timeup', winners: state.winners });
    }
  },

  results(state) {
    return ranking(state);
  },
});

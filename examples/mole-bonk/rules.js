// Mole Bonk: moles pop out of the holes, and everyone races to bonk them first. Most moles when
// time's up wins.
//
// A pointer game (manifest input.pointer). Players point with a mouse, a finger or a gamepad's
// cursor, and the game gets where that is on the field ({ type: 'pointer', x, y, z }): moving
// (action 'move'), going down (a click or a tap: 'down') and coming up ('up'). Every player's
// pointer is in the state, so everyone sees everyone's mallet.

const COLS = 4;
const ROWS = 3;
const GAP = 2.6; // between holes
const HOLES = Array.from({ length: COLS * ROWS }, (_, i) => [((i % COLS) - (COLS - 1) / 2) * GAP, (Math.floor(i / COLS) - (ROWS - 1) / 2) * GAP]);
const FIELD = [COLS * GAP, ROWS * GAP]; // width and depth of the field
const REACH = 0.9; // how close to a mole a bonk must land
const MISS_WAIT = 0.4; // a mallet that misses takes this long to lift again (no bonking everywhere at once)
const ROUND = 40; // seconds
const round3 = (v) => Math.round(v * 1000) / 1000;

// How long a mole stays up: shorter as the round goes on.
const upTime = (time) => 1.3 - 0.5 * Math.min(1, time / ROUND);

// The hole a bonk at (x, z) lands on, if a mole is up in it at that moment.
function holeAt(state, x, z, time) {
  return HOLES.findIndex(([hx, hz], h) => state.holes[h].until > time && Math.hypot(hx - x, hz - z) <= REACH);
}

// Most moles first; equal moles share a place.
function ranking(state) {
  return state.players.map((p, player) => ({ player, place: 1 + state.players.filter((q) => q.score > p.score).length }));
}

defineRules({
  setup(game) {
    return {
      phase: 'play', // then 'done' for a moment once time's up
      endAt: 0,
      winners: [],
      next: 0.6, // when the next mole pops up
      // Each hole's mole: up from `from` until `until` (0 once it's down).
      holes: HOLES.map(() => ({ from: 0, until: 0 })),
      // Where each player points (their mallet), their moles, when they last swung and when they
      // can swing again.
      players: game.players.map((p, i) => ({ x: round3(((i % 4) - 1.5) * 2), z: FIELD[1] / 2 + 1, score: 0, swing: -1, wait: 0 })),
    };
  },

  input(state, input, game) {
    if (input.type !== 'pointer') return;
    const p = state.players[input.player];
    p.x = round3(input.x);
    p.z = round3(input.z);
    if (input.action !== 'down' || state.phase !== 'play' || input.time < p.wait) return;
    p.swing = round3(input.time);
    const h = holeAt(state, p.x, p.z, input.time);
    if (h < 0) {
      p.wait = round3(input.time + MISS_WAIT);
      game.emit({ type: 'miss', player: input.player, x: p.x, z: p.z });
      return;
    }
    state.holes[h].until = 0;
    p.score++;
    game.emit({ type: 'bonk', player: input.player, hole: h, score: p.score });
  },

  step(state, game) {
    if (state.phase === 'done') {
      if (game.time >= state.endAt) game.end();
      return;
    }
    // More players, more moles.
    if (game.time >= state.next) {
      const free = state.holes.map((m, h) => (m.until <= game.time ? h : -1)).filter((h) => h >= 0);
      if (free.length) {
        const h = free[Math.floor(game.random() * free.length)];
        state.holes[h] = { from: round3(game.time), until: round3(game.time + upTime(game.time)) };
      }
      const gap = 0.85 / Math.sqrt(state.players.length);
      state.next = round3(game.time + gap * (0.6 + game.random() * 0.8));
    }
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

  // How a bot plays (the server asks ten times a second; see "Bots" in docs/making-games.md):
  // where its pointer is and whether it's held down. It goes for the mole nearest its mallet once
  // it's noticed it, moves there at a hand's speed (a little off), and bonks when it's over it,
  // letting go again straight after.
  bot(state, player, game) {
    const p = state.players[player];
    if (state.phase !== 'play') return null;
    const notice = 0.2 + (player % 3) * 0.08; // some bots are quicker than others
    let target = null;
    let best = Infinity;
    state.holes.forEach((m, h) => {
      if (m.until <= game.time || game.time - m.from < notice) return;
      const d = Math.hypot(HOLES[h][0] - p.x, HOLES[h][1] - p.z);
      if (d < best) (best = d), (target = HOLES[h]);
    });
    const lifting = game.time - p.swing < 0.15;
    if (!target) return { pointer: { x: p.x, y: 0, z: p.z, down: false } };
    const step = 14 * 0.1; // units a go: about how fast a hand moves a mouse
    const aim = [target[0] + (game.random() - 0.5) * 1.3, target[1] + (game.random() - 0.5) * 1.3]; // (now and then far enough off to miss)
    const k = Math.min(1, step / Math.max(best, 0.001));
    const x = p.x + (aim[0] - p.x) * k;
    const z = p.z + (aim[1] - p.z) * k;
    return { pointer: { x, y: 0, z, down: !lifting && best < 0.5 && game.time >= p.wait } };
  },
});

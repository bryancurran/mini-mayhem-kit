// Word Rush: everyone gets the same words in the same order. Type each one and press Enter to run
// your critter along the track; first to the finish wins, or furthest along when time's up.
//
// A typing game (manifest input.text). With "live", each player's box comes in as they type
// ({ type: 'text', enter: false }), so everyone can watch everyone's letters; Enter sends the word
// ({ enter: true }) and empties the box.

const WORDS = [
  'apple', 'bread', 'cloud', 'dance', 'eagle', 'grape', 'happy', 'jelly', 'kite', 'lemon',
  'mango', 'night', 'ocean', 'panda', 'queen', 'river', 'snake', 'tiger', 'water', 'zebra',
  'cake', 'door', 'frog', 'jump', 'lamp', 'milk', 'nest', 'rain', 'sock', 'wind',
  'bunny', 'candy', 'daisy', 'ghost', 'honey', 'juice', 'koala', 'llama', 'magic', 'pizza',
  'robot', 'sunny', 'train', 'wagon', 'puppy', 'rocket', 'banana', 'cookie', 'dragon', 'jungle',
  'kitten', 'monkey', 'orange', 'parrot', 'rabbit', 'turtle', 'window', 'button', 'castle', 'pickle',
];
const GOAL = 12; // words to the finish
const ROUND = 60; // seconds
const round3 = (v) => Math.round(v * 1000) / 1000;

// Further along first; of those at the finish, whoever got there first. Ties share a place.
function ahead(q, p) {
  if (q.at !== p.at) return q.at > p.at;
  return q.done !== null && p.done !== null && q.done < p.done;
}

function ranking(state) {
  return state.players.map((p, player) => ({ player, place: 1 + state.players.filter((q) => ahead(q, p)).length }));
}

defineRules({
  setup(game) {
    // The same GOAL words for everyone, shuffled with the game's seed.
    const pool = WORDS.slice();
    const words = [];
    while (words.length < GOAL) words.push(pool.splice(Math.floor(game.random() * pool.length), 1)[0]);
    return {
      phase: 'play', // then 'done' for a moment at the end
      endAt: 0,
      winners: [],
      words,
      players: game.players.map(() => ({ at: 0, typed: '', done: null })),
    };
  },

  input(state, input, game) {
    if (input.type !== 'text' || state.phase !== 'play') return;
    const p = state.players[input.player];
    if (p.at >= GOAL) return;
    if (!input.enter) {
      p.typed = input.text.toLowerCase();
      return;
    }
    p.typed = '';
    const word = input.text.trim().toLowerCase();
    if (word === state.words[p.at]) {
      p.at++;
      game.emit({ type: 'word', player: input.player });
      if (p.at === GOAL) {
        p.done = round3(input.time);
        game.emit({ type: 'finish', player: input.player });
      }
    } else if (word) game.emit({ type: 'miss', player: input.player });
  },

  step(state, game) {
    if (state.phase === 'done') {
      if (game.time >= state.endAt) game.end();
      return;
    }
    if (game.time >= ROUND || state.players.every((p) => p.at === GOAL)) {
      state.phase = 'done';
      state.endAt = game.time + 2;
      state.winners = ranking(state).filter((r) => r.place === 1).map((r) => r.player);
      game.emit({ type: 'timeup', winners: state.winners });
    }
  },

  results(state) {
    return ranking(state);
  },

  // For the check's bots and the playground's: what a good player would type now.
  bot(state, player) {
    const p = state.players[player];
    return p.at < GOAL ? state.words[p.at] : '';
  },
});

// Word Rush's look: a lane each on a grassy track, a Mosh in each lane running to the finish
// line, and over each Mosh the word it's on, with the letters typed so far in capitals. Your
// word is in the text box too, until you start typing.

const LANE = 1.7; // lane width
const LENGTH = 24; // start (z = 0) to finish (z = -LENGTH)
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const laneX = (i, n) => (i - (n - 1) / 2) * LANE;

let me = -1;
let players = [];
let moshes = [];
let decided = false;
let typing = null; // what the text box asks for, as last set

// The word with what's been typed of it so far in capitals: "APPle".
function progress(word, typed) {
  return word.startsWith(typed) ? typed.toUpperCase() + word.slice(typed.length) : word;
}

defineView({
  setup(view) {
    me = view.me;
    players = view.players;
    const n = players.length;
    const width = n * LANE + 3;
    mm.world({ sky: true, lights: { shadowSize: 30 }, clouds: { minRadius: 40, maxRadius: 110, minY: -10, maxY: 20 } });
    mm.mesh({ shape: ['box', width, 0.6, LENGTH + 8], color: '#7fd66b', pos: [0, -0.3, -LENGTH / 2], shadow: 'receive' });
    players.forEach((p, i) => {
      if (i % 2 === 0) mm.mesh({ shape: ['box', LANE, 0.02, LENGTH + 8], color: '#93e07f', pos: [laneX(i, n), 0.01, -LENGTH / 2] });
    });
    mm.mesh({ shape: ['box', width, 0.04, 0.3], color: '#ffffff', pos: [0, 0.02, 0] });
    // A checked finish line.
    const checks = mm.texture(128, 16, (g, w, h) => {
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 2; y++) {
          g.fillStyle = (x + y) % 2 ? '#2a1840' : '#ffffff';
          g.fillRect((x * w) / 16, (y * h) / 2, w / 16, h / 2);
        }
      }
    });
    mm.mesh({ shape: ['box', width, 0.04, 1], material: mm.material({ texture: checks }), pos: [0, 0.03, -LENGTH] });

    moshes = players.map((p, i) => ({
      node: mm.avatar({ color: p.color, scale: 0.75, shadow: true, rot: [0, Math.PI, 0] }),
      label: mm.label({ text: '', color: p.color, style: 'tag' }),
      x: laneX(i, n),
      z: 0,
    }));
  },

  render(state, view) {
    const dt = view.dt;
    const n = players.length;
    for (const ev of view.events) {
      const c = moshes[ev.player];
      if (ev.type === 'word') {
        mm.burst({ pos: [c.x, 0.8, c.z], count: 10, speed: 3, up: 3, life: 0.4, size: 0.1, gravity: 8, colors: [players[ev.player].color, '#ffffff'] });
        if (ev.player === me) mm.sound('collect');
      } else if (ev.type === 'miss' && ev.player === me) mm.sound('miss');
      else if (ev.type === 'finish') {
        mm.burst({ pos: [c.x, 1, -LENGTH], count: 30, speed: 5, up: 6, life: 0.8, size: 0.14, gravity: 9 });
        mm.sound(ev.player === me ? 'win' : 'checkpoint');
      }
    }
    for (const ev of view.confirmed) {
      if (ev.type !== 'timeup' || decided) continue;
      decided = true;
      if (ev.winners.includes(me)) mm.hud.center(ev.winners.length === 1 ? 'YOU WIN!' : 'TIE!', { style: 'big', ms: 0 });
      else {
        mm.hud.center('TIME!', { style: 'go', ms: 1400 });
        mm.hud.banner(`${ev.winners.map((p) => players[p].name).join(' & ')} ${ev.winners.length === 1 ? 'wins' : 'tie'}!`, { style: 'info' });
      }
    }

    state.players.forEach((p, i) => {
      const c = moshes[i];
      const z = (-LENGTH * p.at) / GOAL;
      c.z = damp(c.z, z, 6, dt);
      const running = c.z - z > 0.05;
      const won = state.phase === 'done' && state.winners.includes(i);
      c.node.set({ pos: [c.x, 0, c.z], mode: won ? 'cheer' : running ? 'run' : p.at === GOAL ? 'happy' : 'idle', speed: running ? 9 : 0 });
      const word = state.words[p.at];
      c.label.set({ text: word ? progress(word, p.typed) : '🏁', pos: [c.x, 2, c.z] });
    });

    // Your word in the text box, and no box once you've finished.
    const mine = me >= 0 ? state.players[me] : null;
    const ask = mine && state.phase === 'play' && mine.at < GOAL ? `Type “${state.words[mine.at]}”` : null;
    if (me >= 0 && ask !== typing) {
      typing = ask;
      mm.hud.textbox(ask ? { placeholder: ask } : false);
    }

    // From behind the start line, looking down the track: from just behind the start to just
    // past the finish, and every lane, fit in the free part of the screen. The near end looks
    // bigger, so the camera looks at a point nearer the start than the middle.
    const fov = 45;
    const tilt = 0.8; // radians above the horizon
    const T = Math.tan((fov * Math.PI) / 360);
    const s = Math.sin(tilt);
    const c = Math.cos(tilt);
    const span = LENGTH + 4; // from 2 behind the start to 2 past the finish
    const near = (span * (s / T - c)) / (2 * s / T); // how far behind the look point the start end is
    const width = n * LANE + 2;
    const across = 2 * Math.atan(T * view.screen.safe.aspect);
    const dist = Math.max(near * (s / T + c), width / 2 / Math.tan(across / 2) + near * c);
    const look = 2 - near;
    mm.camera({ pos: [0, s * dist, look + c * dist], look: [0, 0, look], fov, safe: true });
    mm.hud.scores(state.players.map((p) => (p.at === GOAL ? '🏁' : `${p.at}/${GOAL}`)));
    mm.hud.timer(state.phase === 'play' ? Math.max(0, ROUND - Math.max(0, view.time)) : null);
  },
});

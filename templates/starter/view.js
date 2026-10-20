// Coin Dash's look: a round grassy arena in the sky, a critter for each player, spinning coins.
// Everything is drawn straight from the state each frame. The engine glides every node (and the
// camera) to where it's put, over one tick, so motion is smooth on any screen and corrections
// that arrive over the network don't make anyone jump. (snap: true makes a move a jump.)

let me = -1;
let players = [];
let critters = [];
let coins = null;
let coinSpots = []; // where each coin was last frame
let ring = null;
let decided = false;

defineView({
  setup(view) {
    me = view.me;
    players = view.players;
    mm.world({ sky: true, lights: { shadowSize: 14 }, clouds: { minRadius: 40, maxRadius: 120, minY: -12, maxY: 18 } });
    mm.mesh({ shape: ['cylinder', ARENA + 0.4, ARENA - 0.6, 1.4, 48], color: '#7fd66b', pos: [0, -0.7, 0], shadow: 'receive' });
    mm.mesh({ shape: ['cylinder', ARENA - 0.6, 1.2, 3, 32], color: '#9a6a44', pos: [0, -2.9, 0] });
    mm.mesh({ shape: ['torus', ARENA + 0.35, 0.16, 8, 64], rot: [Math.PI / 2, 0, 0], color: '#ffffff', pos: [0, 0.02, 0] });

    critters = players.map((p) => ({
      node: mm.avatar({ color: p.color, scale: 0.8, shadow: true }),
      label: p.index === me ? null : mm.label({ text: p.name, color: p.color, style: 'tag' }),
    }));
    // A ring under your own critter, so you can always find yourself.
    if (me >= 0) ring = mm.mesh({ shape: ['ring', 0.6, 0.85, 32], rot: [-Math.PI / 2, 0, 0], material: mm.material({ color: '#ffffff', unlit: true, outline: false }) });
    // Every coin is a copy of one shape, drawn in one go (instances suit crowds, coins, debris).
    coins = mm.instances({ shape: ['cylinder', 0.42, 0.42, 0.12, 24], color: '#ffd23d', count: COINS, shadow: 'cast' });
  },

  render(state, view) {
    for (const ev of view.events) {
      if (ev.type !== 'coin') continue;
      mm.burst({ pos: [ev.x, 0.6, ev.z], count: 14, speed: 4, up: 4, life: 0.5, size: 0.12, gravity: 9, colors: ['#ffd23d', '#fff3a6'] });
      if (ev.player === me) mm.sound('collect', ev.coins - 1);
    }
    for (const ev of view.confirmed) {
      if (ev.type !== 'timeup' || decided) continue;
      decided = true;
      if (ev.winners.includes(me)) {
        mm.hud.center(ev.winners.length === 1 ? 'YOU WIN!' : 'TIE!', { style: 'big', ms: 0 });
        mm.sound('win');
      } else {
        mm.hud.center('TIME!', { style: 'go', ms: 1400 });
        const names = ev.winners.map((p) => players[p].name).join(' & ');
        mm.hud.banner(`${names} ${ev.winners.length === 1 ? 'wins' : 'tie'}!`, { style: 'info' });
      }
    }

    state.players.forEach((p, i) => {
      const c = critters[i];
      const moving = Math.hypot(p.sx, p.sz) > 0.05;
      const won = state.phase === 'done' && state.winners.includes(i);
      c.node.set({
        pos: [p.x, 0, p.z],
        rot: [0, p.face, 0],
        mode: won ? 'cheer' : p.dash > 0 ? 'jump' : moving ? 'run' : 'idle',
        speed: moving ? 8 : 0,
      });
      c.label?.set({ pos: [p.x, 2.1, p.z] });
      if (i === me) ring.set({ pos: [p.x, 0.03, p.z] });
    });
    // Standing on edge (rot x), spinning (rot z, which the tilt turns into a spin about the up axis).
    // A coin that's just been grabbed comes back somewhere else: snap, rather than glide there.
    state.coins.forEach((c, k) => {
      const moved = coinSpots[k] && (coinSpots[k][0] !== c[0] || coinSpots[k][1] !== c[1]);
      coins.at(k, { pos: [c[0], 0.55 + Math.sin(view.time * 3 + k) * 0.08, c[1]], rot: [Math.PI / 2, 0, -(view.time * 2.5 + k)], snap: moved });
      coinSpots[k] = c;
    });

    // safe: true frames the picture on the part of the screen the HUD leaves free (between the
    // score chips and the controls). Far enough back to fit the whole arena across the narrower
    // side of that area.
    const fov = 50;
    const vertical = (fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * view.screen.safe.aspect);
    const dist = (ARENA + 1) / Math.tan(Math.min(vertical, horizontal) / 2);
    const tilt = 0.95; // radians above the horizon
    mm.camera({ pos: [0, Math.sin(tilt) * dist, Math.cos(tilt) * dist], look: [0, 0, 0], fov, safe: true });
    mm.hud.scores(state.players.map((p) => p.coins));
    mm.hud.timer(Math.max(0, ROUND - Math.max(0, view.time)));
  },
});

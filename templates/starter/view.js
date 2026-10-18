// Coin Dash's look: a round grassy arena in the sky, a critter for each player, spinning coins.
// Everything is drawn from the state each frame. Your own critter follows the state exactly
// (your presses show instantly); everyone else's glides towards theirs, so corrections that
// arrive over the network don't make them jump.

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

let me = -1;
let players = [];
let critters = [];
let coinNodes = [];
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
      x: 0,
      z: 0,
      face: 0,
      placed: false,
    }));
    // A ring under your own critter, so you can always find yourself.
    if (me >= 0) ring = mm.mesh({ shape: ['ring', 0.6, 0.85, 32], rot: [-Math.PI / 2, 0, 0], material: mm.material({ color: '#ffffff', unlit: true, outline: false }) });
    coinNodes = Array.from({ length: COINS }, () => {
      const group = mm.group({});
      mm.mesh({ shape: ['cylinder', 0.42, 0.42, 0.12, 24], rot: [Math.PI / 2, 0, 0], color: '#ffd23d', parent: group, shadow: 'cast' });
      return group;
    });
  },

  render(state, view) {
    const dt = view.dt;
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
      if (i === me || !c.placed) {
        c.x = p.x;
        c.z = p.z;
        c.face = p.face;
        c.placed = true;
      } else {
        c.x = damp(c.x, p.x, 18, dt);
        c.z = damp(c.z, p.z, 18, dt);
        c.face = p.face;
      }
      const moving = Math.hypot(p.sx, p.sz) > 0.05;
      const won = state.phase === 'done' && state.winners.includes(i);
      c.node.set({
        pos: [c.x, 0, c.z],
        rot: [0, c.face, 0],
        mode: won ? 'cheer' : p.dash > 0 ? 'jump' : moving ? 'run' : 'idle',
        speed: moving ? 8 : 0,
      });
      c.label?.set({ pos: [c.x, 2.1, c.z] });
      if (i === me) ring.set({ pos: [c.x, 0.03, c.z] });
    });
    state.coins.forEach((c, k) => {
      coinNodes[k].set({ pos: [c[0], 0.55 + Math.sin(view.time * 3 + k) * 0.08, c[1]], rot: [0, view.time * 2.5 + k, 0] });
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

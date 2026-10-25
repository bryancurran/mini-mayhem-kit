// Mole Bonk's look: a lawn with a grid of holes, moles that pop up and duck back down, and a
// mallet for each player, in their color, wherever they point. The pointer lands on the floor
// (y = 0) unless the view picks another plane with mm.controls({ pointer: { y } }).

let me = -1;
let players = [];
let moles = []; // one a hole: { node, wasUp, sinkAt }
let mallets = [];
let floaters = []; // "+1"s rising over bonked moles: { label, x, z, born }
let decided = false;

const SINK = 0.15; // seconds a bonked mole takes to duck down

defineView({
  setup(view) {
    me = view.me;
    players = view.players;
    mm.world({ sky: true, lights: { shadowSize: 14 } });
    mm.music('carnival-rides');
    mm.mesh({ shape: ['box', FIELD[0] + 1.6, 1, FIELD[1] + 1.6], color: '#7fd66b', pos: [0, -0.5, 0], shadow: 'receive' });
    mm.mesh({ shape: ['box', FIELD[0] + 2.2, 0.6, FIELD[1] + 2.2], color: '#9a6a44', pos: [0, -0.75, 0] });

    const hole = mm.material({ color: '#3a2618', unlit: true, outline: false });
    moles = HOLES.map(([x, z]) => {
      mm.mesh({ shape: ['circle', 0.72, 32], rot: [-Math.PI / 2, 0, 0], material: hole, pos: [x, 0.01, z] });
      mm.mesh({ shape: ['torus', 0.75, 0.12, 8, 32], rot: [Math.PI / 2, 0, 0], color: '#8a5a36', pos: [x, 0.04, z] });
      // The mole: under the floor until it pops up.
      const node = mm.group({ pos: [x, -1, z], visible: false });
      mm.mesh({ shape: ['capsule', 0.42, 0.4, 6, 16], color: '#8b6b52', pos: [0, 0.45, 0], parent: node, shadow: 'cast' });
      mm.mesh({ shape: ['sphere', 0.11, 12, 8], color: '#ff8fa3', pos: [0, 0.6, 0.4], parent: node });
      for (const side of [-1, 1]) mm.mesh({ shape: ['sphere', 0.07, 10, 8], color: '#1f1430', pos: [side * 0.16, 0.78, 0.34], parent: node });
      return { node, wasUp: false, sinkAt: -Infinity };
    });

    // A mallet: it pivots at the back end of its handle (toward the camera), its head over the point.
    mallets = players.map((p) => {
      const node = mm.group({});
      const arm = mm.group({ pos: [0, 0, 1.4], parent: node });
      mm.mesh({ shape: ['cylinder', 0.07, 0.07, 1.4, 8], rot: [Math.PI / 2, 0, 0], color: '#c8915a', pos: [0, 0.9, -0.7], parent: arm });
      mm.mesh({ shape: ['cylinder', 0.3, 0.3, 0.75, 20], rot: [0, 0, Math.PI / 2], color: p.color, pos: [0, 0.9, -1.4], parent: arm, shadow: 'cast' });
      // Where it points, exactly, on the grass.
      const spot = mm.mesh({ shape: ['ring', 0.16, 0.26, 24], rot: [-Math.PI / 2, 0, 0], material: mm.material({ color: p.color, unlit: true, outline: false }) });
      return { node, arm, spot };
    });
  },

  render(state, view) {
    for (const ev of view.events) {
      if (ev.type === 'bonk') {
        const [x, z] = HOLES[ev.hole];
        mm.burst({ pos: [x, 0.8, z], count: 12, speed: 4, up: 3, life: 0.4, size: 0.12, gravity: 9, colors: [players[ev.player].color, '#ffffff'] });
        floaters.push({ label: mm.label({ text: '+1', style: 'float', tone: 'good', pos: [x, 1.4, z] }), x, z, born: view.time });
        mm.sound('hit/soft-heavy', { pitch: ev.player === me ? 1 : 0.9, volume: ev.player === me ? 1 : 0.5 });
      } else if (ev.type === 'miss' && ev.player === me) {
        mm.sound('hit/wood-light', { volume: 0.6 });
      }
    }
    for (const ev of view.confirmed) {
      if (ev.type !== 'timeup' || decided) continue;
      decided = true;
      if (ev.winners.includes(me)) {
        mm.hud.center(ev.winners.length === 1 ? 'YOU WIN!' : 'TIE!', { style: 'big', ms: 0 });
        mm.sound('end', true);
      } else {
        mm.hud.center('TIME!', { style: 'go', ms: 1400 });
        const names = ev.winners.map((p) => players[p].name).join(' & ');
        mm.hud.banner(`${names} ${ev.winners.length === 1 ? 'wins' : 'tie'}!`, { style: 'info' });
        mm.sound('end', false);
      }
    }

    floaters = floaters.filter((f) => {
      const age = view.time - f.born;
      if (age < 0.8) f.label.set({ pos: [f.x, 1.4 + age * 1.5, f.z], opacity: 1 - age / 0.8, smooth: false });
      else f.label.remove();
      return age < 0.8;
    });

    // Moles pop up quickly, and duck down quickly when bonked or when their time's up.
    state.holes.forEach((m, h) => {
      const mole = moles[h];
      const up = m.until > view.time;
      if (mole.wasUp && !up) mole.sinkAt = view.time;
      mole.wasUp = up;
      const rise = up ? Math.min(1, (view.time - m.from) / 0.12) : Math.max(0, 1 - (view.time - mole.sinkAt) / SINK);
      const squash = !up && rise > 0 ? 0.6 : 1;
      mole.node.set({ visible: rise > 0, pos: [HOLES[h][0], -1 + rise, HOLES[h][1]], scale: [1, squash, 1], smooth: false });
    });

    // Each mallet over its player's point: raised, then down for a moment after a swing.
    state.players.forEach((p, i) => {
      const since = view.time - p.swing;
      const swing = since < 0.07 ? since / 0.07 : since < 0.3 ? 1 - (since - 0.07) / 0.23 : 0;
      mallets[i].node.set({ pos: [p.x, 0, p.z] });
      mallets[i].arm.set({ rot: [0.55 * (1 - swing), 0, 0] });
      mallets[i].spot.set({ pos: [p.x, 0.03, p.z] });
    });

    // safe: true frames the picture on the part of the screen the HUD leaves free. Far enough back
    // to fit the whole field.
    const fov = 45;
    const vertical = (fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * view.screen.safe.aspect);
    const dist = Math.max((FIELD[0] / 2 + 1.2) / Math.tan(horizontal / 2), (FIELD[1] / 2 + 1.8) / Math.tan(vertical / 2) / 0.9);
    const tilt = 1.05; // radians above the horizon
    mm.camera({ pos: [0, Math.sin(tilt) * dist, Math.cos(tilt) * dist + 0.6], look: [0, 0, 0.6], fov, safe: true });
    mm.hud.scores(state.players.map((p) => p.score));
    mm.hud.timer(Math.max(0, ROUND - Math.max(0, view.time)));
  },
});

# Making a packaged minigame (.mm)

A packaged minigame is one `.mm` file: a manifest plus two scripts. The server and every
browser run those scripts inside a [QuickJS](https://bellard.org/quickjs/) sandbox, so a
package can't reach the page, the network, the server or anyone's data. All it can do is
describe a game through the small API below, and the engine takes care of the rest: rooms,
the countdown, controls on keyboard, gamepad and touch, netcode, spectators, the results
screen and coins.

You make them with the creator kit (https://github.com/bryancurran/mini-mayhem-kit). It has
a starter template, two examples, a playground for trying games in your browser, the same bot
check uploads get, screenshots, and an upload command. `examples/coin-dash/` is small (avatars
and a stick); `examples/sandwich-stack/` is a full game.

## Quick start

```bash
npm install
npm run new my-game -- --name "My Game"   # copies the starter game to games/my-game/
npm run play my-game                      # play it in your browser against bots
npm run check my-game                     # the same bot play test uploads get
```

```
games/my-game/
  manifest.json   name, rules text, controls, which inputs the game uses
  rules.js        what happens: runs on the server and in every browser
  view.js         what it looks like: runs in browsers only
```

The playground reloads when you save a file. When it's ready, `npm run upload my-game` sends it
to the game's library (see Uploading).

## manifest.json

```json
{
  "id": "my-game",
  "name": "My Game",
  "color": "#ff9f43",
  "tagline": "One line shown in the lobby.",
  "rules": ["How to play, one short line each (1-6 lines)."],
  "controls": { "keyboard": "Space to jump", "touch": "Tap anywhere to jump", "gamepad": "A to jump" },
  "intro": "Shown as a banner during the countdown (optional).",
  "tickRate": 30,
  "countdown": 3,
  "input": { "buttons": ["a"], "dirs": false, "move": false, "touch": "tap" }
}
```

- `id`: lowercase letters, digits and dashes.
- `color`: the game's segments on the spin wheel.
- `tickRate`: rule steps per second, 10-60.
- `input`: which inputs the game receives. Players never press keys at your game directly:
  the engine maps keyboard, gamepad and touch onto these, the same way for every game.

| input | keyboard | gamepad | touch |
|---|---|---|---|
| `buttons: ["a"]` | Space / Enter (a one-button game also takes ↓, S, Shift, a click) | A | depends on `touch` |
| `buttons: ["a", "b"]` | a: Space / Enter, b: Shift / E | A, B | |
| `dirs: true` (taps) | arrows / WASD | d-pad, stick flicks | |
| `move: true` (a stick) | arrows / WASD held | left stick, d-pad | |

`touch` picks the phone layout:
- `tap`: tap anywhere = a.
- `stick`: a thumbstick plus an a button (label it with `touchLabel`).
- `hold`: hold either half of the screen to push the stick left or right.
- `sides`: tap either half for a left or right direction.
- `swipe`: swipe anywhere for directions.
- `none`

There's no mouse aiming or free-form pointer input on purpose: every game has to play the
same on a phone, a keyboard and a gamepad.

## rules.js

```js
defineRules({
  // Returns the starting state. Plain data only (see below).
  setup(game) {
    return { scores: game.players.map(() => 0) };
  },
  // One input from one player.
  input(state, input, game) {
    if (input.type === 'press') state.scores[input.player]++;
  },
  // Once per tick, after that tick's inputs.
  step(state, game) {
    if (game.time >= 30) game.end();
  },
  // Who came where, once the game has ended.
  results(state, game) {
    return game.players.map((p) => ({ player: p.index, place: 1 + state.scores.filter((s) => s > state.scores[p.index]).length }));
  },
});
```

`game` gives you:
- `players`: `[{ index, id }]`.
- `seed`
- `tick`, `time` and `dt`: game time in seconds, starting at 0 on "GO!".
- `random()`
- `emit(event)`: tells the view something happened (see `events` below). Events emitted during
  `setup()` are dropped.
- `end()`

Inputs look like this, each with `player` (an index) and `time` (seconds, to the
millisecond):
- `{ type: 'press' | 'release', button: 'a' | 'b' }`
- `{ type: 'dir', dir: 'up' | 'down' | 'left' | 'right' }`
- `{ type: 'move', x, y }`, with x and y from -1 to 1 and y pointing up.

Inputs arrive in time order, and an input is applied before the step of the tick it falls
in.

**The rules must be deterministic.** The same inputs have to give exactly the same state on
the server and in every browser, because that's what lets each browser show your own
presses instantly and still agree with everyone else:

- Keep everything in `state`: plain objects, arrays, strings, finite numbers, booleans and
  `null`. No `Map`, `Set`, class instances, functions, `undefined` or `NaN`. Globals you
  change during a game won't be copied or rolled back.
- Use `game.random()` for randomness. `Math.random()` is replaced by the same seeded
  generator inside rules, and `Date.now()` returns game time.
- Use `input.time` and `game.time`, never a clock of your own.
- `results()` returns `{ player, place }` for each player, where place starts at 1 and ties
  share a place. Anyone left out ties for last.

`npm run check` replays every game it plays and fails if anything comes out different.

Anything rules.js defines at the top level (constants, helper functions) is visible to
view.js too, so shared maths only needs writing once.

## view.js

```js
defineView({
  setup(view, state) {
    mm.world({ sky: true, lights: { shadowSize: 20 } });
    this.box = mm.mesh({ shape: ['box', 1, 1, 1], color: '#ff5c8a', shadow: true });
  },
  render(state, view) {
    this.box.set({ pos: [0, 0.5 + Math.sin(view.time * 3) * 0.2, 0] });
    for (const ev of view.events) if (ev.type === 'point') mm.sound('pop');
    mm.camera({ pos: [0, 4, 10], look: [0, 1, 0] });
    mm.hud.scores(state.scores);
  },
});
```

`setup(view, state)` runs once, with the state as it is when you join (usually the start, but
not for someone joining mid-game). `render(state, view)` runs every frame.

`view` gives you:
- `me`: your player index, or -1 when watching.
- `playing`
- `players`: `[{ index, id, name, color }]`.
- `seed`
- `time`: game time right now, smooth, for animation.
- `dt`
- `tick`
- `screen`: `{ width, height, aspect, portrait, safe }`. `safe` is the part of the screen the
  HUD doesn't cover: `{ top, bottom, left, right }` in pixels from each edge, and the `width`,
  `height` and `aspect` of what's left. See the camera's `safe` option below.
- `events`: new events from `game.emit` since the last frame, predicted, so they arrive
  instantly. A predicted event is never taken back: if the prediction gets corrected, the
  event isn't retracted, and a corrected version (with different contents) can arrive as well.
- `confirmed`: events that are final, a third of a second or so later.
- `ended`

`state` is the game as this browser predicts it right now. **Draw from the state every
frame** and use events only for effects (sounds, particles, floating text). Then when a
prediction gets corrected (someone else's input turns up late), the drawing just follows.
Use `confirmed` events for announcements that must not be wrong, such as who won. Don't
change `state` in the view.

### Scene

Nodes are created with a function and changed with `.set({...})`. Several changes in one
frame are sent as one. `.remove()` removes a node and everything under it.

```js
mm.group({ pos, rot, scale, parent, visible })
mm.mesh({ shape | geometry, color | material, pos, rot, scale, parent, visible, shadow })
mm.avatar({ color, mode, speed, crown, shadow, pos, rot, scale, parent })   // the party critter
mm.label({ text, style: 'tag' | 'float', tone: 'good' | 'great' | 'bad', color, pos, opacity, parent })
```

- `pos`, `rot` (radians, XYZ order) and `scale` (a number or `[x, y, z]`) are like
  three.js. y is up.
- `shadow`: `true` (cast and receive), `'cast'`, `'receive'` or `false` (the default).
- `shape`:
  - `['box', w, h, d]`
  - `['sphere', r, widthSegments, heightSegments]`
  - `['cylinder', rTop, rBottom, h, segments]`
  - `['cone', r, h, segments]`
  - `['plane', w, h]`
  - `['circle', r, segments]`
  - `['ring', inner, outer, segments]`
  - `['torus', r, tube, radialSegments, tubularSegments, arc]`
  - `['icosahedron', r, detail]`
  - `['capsule', r, length, capSegments, radialSegments]`

  Shapes are cached by their numbers, so for lots of different sizes, scale one shape or
  pass geometry.
- `geometry`: `{ positions, uvs?, normals?, indices?, groups?: [[start, count, materialIndex]] }`
  for your own meshes, or a handle from `mm.geometry(data)` to share one.
- `color`: a hex color, giving the standard cartoon material.
- `material`: a handle from `mm.material(...)`, or an array of them for meshes with groups.
- avatar `mode`: `idle`, `happy`, `run`, `jump`, `fall`, `stuck`, `swim`, `balance`,
  `sleep` or `cheer`; `speed` sets the run pace.

```js
mm.material({ color, texture, repeat: [u, v], opacity, transparent, depthWrite, side: 'double', emissive, unlit, outline })
mm.texture(width, height, (g, w, h) => { g.fillStyle = '#f00'; g.fillRect(0, 0, w, h); }, { repeat: true, pixelated: false })
mm.geometry({ positions, ... })
mm.bake(group)
```

- **Materials:** `.set()` changes a material, for example to fade its opacity. `.dispose()`
  frees it.
- **Textures:** `mm.texture` hands you something that works like a canvas 2D context:
  - Properties: `fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`, `lineCap`,
    `lineJoin`, `font`, `textAlign` and `textBaseline`.
  - Paths: `beginPath`, `moveTo`, `lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `arc`,
    `arcTo`, `ellipse`, `rect` and `closePath`.
  - Drawing: `fill`, `stroke`, `fillRect`, `strokeRect`, `clearRect`, `fillText` and
    `strokeText`.
  - State: `save`, `restore`, `translate`, `rotate` and `scale`.
  - Gradients from `createLinearGradient` and `createRadialGradient`.
- **`mm.bake(group)`:** merges every mesh under the group into one mesh per material and
  removes the nodes that were under it. Use it for anything big that stops changing: a tall
  sandwich is a handful of draw calls instead of hundreds.

### World, camera, effects, sound

```js
mm.world({ sky: true, lights: { shadowSize }, clouds: { count, minRadius, maxRadius, minY, maxY }, background: '#hex', fog: ['#hex', near, far] })
mm.camera({ pos, look, fov, safe })
mm.burst({ pos, count, speed, up, life, size, gravity, colors })
mm.sound(name, ...numbers)
```

- `mm.world`: each part can be added once.
- `mm.camera`: `fov` is the vertical field of view in degrees. With `safe: true`, the picture is
  framed on the part of the screen the HUD leaves free (`view.screen.safe`): the camera looks at
  the middle of that area and `fov` spans its height, while the scene still shows behind the
  HUD. Fit things to `view.screen.safe.aspect` (see Coin Dash's view.js).
- `mm.burst`: confetti-style particles.
- `mm.sound` names: click, join, leave, ready, countdown, go, bump, dash, fall, jump,
  boing, pop, hop, miss, ouch, splat, wiggle, crash, creak, shatter, checkpoint, splash,
  warn, rumble, tick, bongo, thud, step, slice, collect, whistle, win, lose.

### HUD

```js
mm.hud.scores([...])                                     // per player: a number or short text (8 characters, emoji fine)
mm.hud.out([1, 3])                                       // grey out these players' chips (they're out)
mm.hud.timer(secondsLeft)                                // or null to hide; ticks in the last 10 s
mm.hud.meter({ icon: '🥪', values: [0..1 per player], stops: ['#hex', ['#hex', 40], ...] })
mm.hud.center('YOU WIN!', { style: 'count' | 'go' | 'bad' | 'big', ms })   // ms: 0 keeps it up
mm.hud.banner('Text', { style: 'info' | 'warn', ms })
```

The engine already shows the countdown and "GO!", the controls hint, "Spectating" for
people who joined mid-game, the whistle at the end and the results screen.

Where things sit:
- **Along the top:** the score chips (top left) and the timer (top right). With many players on
  a phone, the chips wrap onto two or three rows.
- **Along the bottom:** the controls hint, plus the touch controls on phones (the DASH button or
  side buttons in the bottom corners). The meter runs down the right edge.
- **Banners:** below the chips on wide screens, and above the bottom controls on phones.

`view.screen.safe` covers everything except banners, which come and go.

## How the netcode works

You don't write any. When you press a button, your browser sends it to the server stamped
with the game time and applies it to its own copy right away. The server puts everyone's
inputs in one order and passes them on. A tick becomes final 300 ms after it happens; an
input that arrives later is moved to the first tick that isn't final yet.

Each browser keeps two copies of the state:
- **Confirmed:** every input up to it is final, so it never changes.
- **Predicted:** the confirmed copy plus every input heard of since, run forward to the
  present.

When an input turns up for a moment that has already been predicted, the prediction is
rebuilt from the confirmed copy. Because the rules are deterministic and the server and
browsers run the same QuickJS build, every copy agrees. Every couple of seconds each browser
checks its confirmed state against the server's and fetches a fresh copy if they differ.
That's a safety net, not something that should happen.

People who join or refresh mid-game get the confirmed state and every input since.

## Limits

| | |
|---|---|
| package size | 200 KB in all |
| memory | 32 MB per game on the server, 64 MB in the browser |
| time per call | 50 ms per server tick, 250 ms per browser frame |
| sustained time | 100 ms per second on the server; 70% of a browser's time |
| state | 256 KB as JSON |
| drawing | 6000 nodes, 2000 materials, textures and geometries, 96 textures (up to 1024²), 1.5 M vertices, 200 labels, 4 MB of commands per frame, 8 sounds per frame |
| inputs | 60 per second per player (a press and its release are two) |

A game that breaks a limit or throws an error is stopped. In a browser, the player sees
"This game hit a problem and stopped". On the server, the round ends straight away with
everyone tied for last (no coins for a win). `console.log` works and prints with the game's
id in front.

There are no timers, promises or async code (promises never resolve). There's also no way
to fetch anything, store anything or talk to anything outside the game.

## Uploading

From the kit, `npm run upload my-game -- --by "Your name"`. Or build the file with
`npm run pack my-game` and upload `dist/my-game.mm` from a lobby: open the **User created**
tab and press **Upload a game (.mm)**. It's checked in three steps, and you'll see why if it's
turned down:

1. **File:** at most 200 KB, a valid package, an `id` and `name` no other game uses, and not
   just a renamed copy of the starter game or an example.
2. **Play test:** the same check as `npm run check` (below), with 3 bots and then solo,
   up to 5 minutes of game time, and 48 MB of memory per browser.
3. **Review:** an automated look at everything in the package. It turns down:
   - content that isn't fine for all ages;
   - scams, or asking players for personal details;
   - pretending to be an official game, or using real brands or people;
   - hostile or deliberately hidden code;
   - placeholders and spam, or rules that don't match the game.

   It doesn't judge how good the game is.

Accepted games are playable right away. Everyone in a lobby sees them under User created, and
the host can pick them like any other game. They don't appear on the spin wheel.

## npm run check

The check plays the package with a stand-in for the server that follows the same rules, and the
same browser sandbox, using a simulated clock and network delays: bots with random inputs, a
spectator from the start, and one who joins halfway (3 players, then solo; `-- --players 4,2`
for others). It fails if:

- the game crashes, never ends, or `results()` doesn't place everyone;
- any browser's state disagrees with the server's, or replaying the inputs from scratch gives
  a different result;
- the state holds anything that isn't plain data;
- the view draws an unknown command or too much in one frame.

The check doesn't look at what you pass to the drawing commands. A bad shape, color or
property shows up as a warning in the playground's panel and in `npm run shot`'s output, so
look at those too. The bots press random buttons, which catches crashes but says nothing
about whether the game is fun or fair. Play it, or write a small script with smarter bots in
`.scratch/` (git ignores that folder).

It also prints how long ticks and frames take. `npm run shot my-game` saves screenshots of the
game being played, so you can see what players will see. Its options:
- `-- --phone` for a phone screen;
- `-- --at 3,15,40` for the moments (seconds of game time; negative for the countdown);
- `-- --bots N`, where 0 means solo;
- `-- --seed N` for the same `game.random()` every time;
- `-- --out dir` to save elsewhere.

It needs a browser: `npm run setup-browser` downloads Chromium's headless shell once (about 110
MB, 260 MB unpacked) into `~/.cache/ms-playwright`, or wherever `PLAYWRIGHT_BROWSERS_PATH`
points.

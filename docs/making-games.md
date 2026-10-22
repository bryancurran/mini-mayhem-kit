# Making a packaged minigame (.mm)

A packaged minigame is one `.mm` file: a manifest plus two scripts. The server and every
browser run those scripts inside a [QuickJS](https://bellard.org/quickjs/) sandbox, so a
package can't reach the page, the network, the server or anyone's data. All it can do is
describe a game through the small API below, and the engine takes care of the rest: rooms,
the countdown, controls on keyboard, gamepad and touch, netcode, spectators, the results
screen and coins.

You make them with the creator kit (https://github.com/bryancurran/mini-mayhem-kit). It has
a starter template, examples, a playground for trying games in your browser against bots, the
same bot check uploads get, screenshots, and an upload command. `examples/coin-dash/` is small (avatars
and a stick); `examples/sandwich-stack/` is a full game; `examples/word-rush/` is a typing game.
To make a game look and feel like the standard ones, follow `docs/style-guide.md`.

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
  "tickRate": 60,
  "countdown": 3,
  "players": { "min": 1, "max": 8 },
  "input": { "buttons": ["a"], "dirs": false, "move": false, "touch": "tap" }
}
```

- `id`: lowercase letters, digits and dashes.
- `color`: the game's color in the lobby's list and on its card when players vote.
- `tickRate`: rule steps per second, 10-60. Use 60 for anything fast (running, driving, flying,
  bumping, aiming a jump), which also makes presses land sooner; 30 for slower games; less only
  for games played a move at a time. It costs server time (see Limits), so keep `step` lean.
- `go`: `false` leaves out the big "GO!" and its sound when the countdown ends, for a game that
  opens with something of its own (Mosh Count's "Round 1" card).
- `count`: how many of the countdown's last seconds are counted out, for an opening shot before
  them. With `"countdown": 5, "count": 3`, the game's name shows for two seconds over whatever
  your view draws (fly the camera over the arena: `view.time` runs from -5 to 0), then 3, 2, 1
  and GO. Leave it out to count every second.
- `players` (required): the fewest and the most players the game takes, from 1 to 8. The lobby
  won't start it with fewer or more, and the play test, the playground and the bots stay inside
  it. Take 1 to 8 if you can: a room holds up to 8, and playing alone is how people practise and
  try a game. Narrow it only when the game can't work otherwise (a duel: 2 to 2; a team game: 4 to
  8).
- `input`: which inputs the game receives. Players never press keys at your game directly:
  the engine maps keyboard, gamepad and touch onto these, the same way for every game.

| input | keyboard | gamepad | touch |
|---|---|---|---|
| `buttons: ["a"]` | Space / Enter / Shift (a one-button game also takes ↓, S, a click) | A or B | depends on `touch` |
| `buttons: ["a", "b"]` | a: Space / Enter, b: Shift / E | A, B | |
| `dirs: true` (taps) | arrows / WASD | d-pad, stick flicks | |
| `move: true` (a stick) | arrows / WASD held | left stick, d-pad | |
| `text: "enter"` or `"live"` (typing) | typing in a text box | can't play | the phone's keyboard |

`repeat: true` (with `dirs`) has a direction key held down go on repeating, as it does in a text
box, for counting a number up or down (Mosh Count). Without it, a held key is one tap.

The stick counts from "GO!": where it's held during the countdown is sent the moment the game
starts, so a player who holds a direction through the countdown sets off straight away.

`touch` picks the phone layout:
- `tap`: tap anywhere = a.
- `stick`: a thumbstick plus an a button (label it with `touchLabel`).
- `hold`: hold either half of the screen to push the stick left or right.
- `sides`: tap either half for a left or right direction.
- `swipe`: swipe anywhere for directions.
- `none`

There's no mouse aiming or free-form pointer input on purpose: every game has to play the
same on a phone, a keyboard and a gamepad.

Directions are as the player sees them: up is up on the screen. A view whose camera looks along
another axis (a board turned sideways to fit a phone held upright) turns them to match with
`mm.controls({ turn: 1 })` in view.js: every direction and stick a player gives is turned that
many quarter turns clockwise (up becomes right) before it's sent, so the rules get directions on
the board. Call it again when the camera turns back (`turn: 0`).

`mm.controls({ button: false })` hides the button of the `"stick"` touch layout, for a player who
can't use it any more (one who's out of the round); `button: true` shows it again.
The stick stays. Keyboards and gamepads are unchanged.

### Typing games

A game can ask for typing instead: `"input": { "text": "enter" }`. Players get a text box along
the bottom of the screen (on a phone, above the keyboard), and the game gets what they type.
Typing is all a typing game takes: no buttons, `dirs` or `move` (the keyboard is busy typing),
and `touch` is `"none"`. Leave out `controls.gamepad`: **a gamepad can't play a typing game**, and
the game shows it as one for a computer or a phone only.

- `text: "enter"`: the game gets what's in the box when the player presses Enter (or the send
  button on a phone), and the box empties.
- `text: "live"`: the same, plus what's in the box so far each time it changes (up to 20 times a
  second), for games that show everyone's typing as it happens.
- `maxLength`: the most characters the box takes, 1-100 (100 if you leave it out).

The box opens at "GO!", and on a computer anything typed goes into it. Keep the words, answers or
prompts in the state, drawn by view.js, and set the box's placeholder to what to type
(`mm.hud.textbox`, see HUD). Compare text loosely (`text.trim().toLowerCase()`): phones
add capitals and spaces of their own. Everything typed reaches every player's browser, the same as
any input.

Bots type too: a word at a time, a letter at a time, then Enter. They type what your rules'
`bot()` says a good player would type now (see Bots); the check's bots also type a random word
now and then, so wrong answers get tried as well. Without `bot()` they only type random words, so
a game that needs the right words to end must also end on a timer. See `examples/word-rush`.

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
  // Optional: what a bot playing `player` holds right now (see Bots).
  bot(state, player, game) {
    return { move: { x: 1, y: 0 }, a: state.scores[player] < 10 };
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
- `{ type: 'move', x, y }`, with x and y from -1 to 1 and y pointing up. A stick sends whole
  steps of 0.1; keys and d-pads send hundredths, so a diagonal is 0.71 each way, as long as
  straight ahead.
- `{ type: 'text', text, enter }` in typing games: `enter` is `true` when they pressed Enter
  (the box is empty after that), and `false` for what's in the box so far (`text: "live"` only).

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

### Bots

A private room's host can add bots to play against, or to make up the numbers, and the
playground plays you against them. The server plays for them: ten times a second it asks your
rules' `bot(state, player, game)` what the bot playing `player` (an index) does, given the game
as it is at that moment (its own last moves included), and turns the answer into the inputs a
player's controls would send. Return what the bot is holding right now:

- `{ move: { x, y }, a: true, b: false }`: the stick (x and y from -1 to 1, y up, as in `move`
  inputs) and the buttons held. Leave out what it isn't holding: `{}` or `null` lets go of
  everything. A press lasts until an answer leaves the button out, so to tap one, hold it in one
  answer and let go in the next.
- `{ dir: 'up' }`: a direction tap (with `input.dirs`), once for each answer that has it.
- In a typing game, a string: what a good player would type now (`''` for nothing just now).

Only what the manifest's `input` asks for is used. `bot()` gets the state read-only (frozen: one
copy serves all the bots, so work things out in variables of your own rather than writing to
it) and `game` as in `step()`, `random()` included. It runs only on the server (and in the check
and the playground), never in players' browsers, so it can look at anything in the state; keep
it quick, though: the bots of a game that takes more than a few milliseconds a go think less
often. If it throws, that bot keeps holding what it held until its next go, and `npm run check`
fails, saying why.

Without `bot()`, bots press buttons at random. That's enough to see your game doesn't break, but
useless as an opponent or a teammate, and the lobby warns players when a game's bots only press
at random. So write one: make it play the way a good player would, then make it human. People
take a moment to react, aim a little off and slip up now and then; a bot that plays perfectly
is no fun to play against. See the starter game (Coin Dash) and `examples/word-rush`.

Browsers copy the state as they predict, about once a tick, so a small state makes for a quicker
game. Anything that never changes and follows from `game.seed` alone (a map, a schedule) can be
worked out by a top-level function in rules.js, once, instead of kept in the state; the view
gets the same seed as `view.seed`.

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
- `alpha`: how far the present is into the next tick, from 0 up to 1 (the state is as of the
  start of it). Rarely needed: see Smooth motion.
- `screen`: `{ width, height, aspect, portrait, safe }`. `safe` is the part of the screen the
  HUD doesn't cover: `{ top, bottom, left, right }` in pixels from each edge, and the `width`,
  `height` and `aspect` of what's left. See the camera's `safe` option below.
- `events`: new events from `game.emit` since the last frame, predicted, so they arrive
  instantly. A predicted event is never taken back: if the prediction gets corrected, the
  event isn't retracted, and a corrected version (with different contents) can arrive as well.
  After a long pause between frames (a hitch, a slow phone), the events of the moments that
  were never predicted come here once they're confirmed, so effects aren't skipped.
- `confirmed`: events that are final, a third of a second or so later.
- `correction`: on a frame where the prediction was corrected, `{ was, now }`: the state as it
  was predicted on the last frame, and as it is now predicted for that same moment. `null` on
  other frames. See Smoothing corrections.
- `ended`

`state` is the game as this browser predicts it right now. **Draw from the state every
frame** and use events only for effects (sounds, particles, floating text). Then when a
prediction gets corrected (someone else's input turns up late), the drawing just follows.
Use `confirmed` events for announcements that must not be wrong, such as who won. Don't
change `state` in the view.

### Smooth motion

The state only moves on once a tick, but screens draw 60, 90, 120 or 144 frames a second, so
things drawn straight from it would move in steps. The engine takes care of that: every node,
every copy in `mm.instances` and the camera glide to where you put them. What moves with the
state is drawn one tick behind the game's clock, part way between where you put it on the tick
before and on the latest one, timed by the game's clock rather than the frames, so it moves at
an even speed on any screen. Things you animate every frame from `view.time` (a bobbing coin, a
camera you ease yourself) glide from where they are to each new place over one tick. So set
positions straight from the state, and don't smooth them yourself as well: that only adds lag.

- `snap: true` in a `.set()` (or an instance's `.at()`, or `mm.camera`) makes that one move a jump:
  for teleports, respawns, a coin that reappears somewhere else.
- `smooth: false` on a node (or `mm.camera`) turns gliding off for it, for things you animate
  exactly yourself every frame (a camera you ease and shake, tumbling debris).
- Things just made, shown again after being hidden, or moved to another parent always jump. So
  do a node's first position, turn and size, and anything set in the frame it's made (a mesh
  made and then `.set()` in place goes straight there).

### Smoothing corrections

Your own moves show the moment you press, and everyone else's turn up a little later (as late as
their connection and yours add up to, often a tenth of a second), so the prediction of other
players gets corrected all the time. Mostly that's a tiny nudge. In games where players move fast
and bump into each other, a late dash or a knock can move something a whole unit in one go, which
looks like a jump. To ease those out, keep an offset for each thing that moves, add to it whatever
a correction moved the thing by, and let it shrink back to nothing:

```js
const offsets = state.players.map(() => [0, 0]); // in setup: one [x, z] per player

// in render, before drawing each player:
if (view.correction) {
  const was = view.correction.was.players[i];
  const now = view.correction.now.players[i];
  offsets[i][0] += was.x - now.x; // where it was drawn, minus where it is now
  offsets[i][1] += was.z - now.z;
}
// ...then shrink it once per tick (view.tick moved on), and draw at state + offset:
node.set({ pos: [p.x + offsets[i][0], 0, p.z + offsets[i][1]] });
```

Shrink the offsets as the ticks go by, not every frame (things that move with the state should
only change once a tick, or they don't glide evenly), by something like `Math.exp(-12 * ticks /
tickRate)`. Where things carry speed (balls, cars), ease the speed difference out too, with a
spring, so a corrected ball carries on the way it was going and then settles: add `was.vx -
now.vx` (and z) to a second offset for each player, `speeds[i]`, then each time the tick moves on:

```js
// A critically damped spring: off and vel ([x, z] each) settle back to nothing.
function settle(off, vel, rate, seconds) {
  const e = Math.exp(-rate * seconds);
  for (let k = 0; k < off.length; k++) {
    const c = vel[k] + rate * off[k];
    off[k] = (off[k] + c * seconds) * e;
    vel[k] = (vel[k] - rate * c * seconds) * e;
  }
}
settle(offsets[i], speeds[i], 12, (view.tick - lastTick) / tickRate);
```

Effects shown from `view.events` (a bump's burst and sound) can arrive twice when a correction
moves them a tick or changes them slightly: skip one that's the same as one shown a moment ago.

### Scene

Nodes are created with a function and changed with `.set({...})`. Several changes in one
frame are sent as one. `.remove()` removes a node and everything under it.

```js
mm.group({ pos, rot, scale, parent, part, visible })
mm.mesh({ shape | geometry, color | material, pos, rot, scale, parent, part, visible, shadow, order })
mm.avatar({ color, mode, speed, crown, shadow, outfit, bobble, pos, rot, scale, parent, part })   // a Mosh, the players' character
mm.label({ text, strong, style: 'tag' | 'me' | 'float' | 'bubble' | 'count', tone: 'good' | 'great' | 'bad', color, bubble, pos, opacity, parent, part })
mm.instances({ shape | geometry, color | material, count, shadow, outline, colorEase, pos, rot, scale, parent, part })
mm.crowd({ max, shadow, pos, parent })           // lots of little Moshes at once (a conga line, an audience)
mm.line({ points: [x, y, z, ...], color, pos, parent })   // a thin line (a wire, a laser)
mm.mist({ pos, width, height, edge, top, color })         // a bank of cloud with a wavy lower edge
mm.copy(group, { pos, rot, scale, parent, visible })      // another of a group built already
```

`mm.instances` draws many copies of one shape at once (a crowd, coins, debris, a field of grass)
for the price of one node. Each copy shows once it's placed:
- `.at(i, { pos, rot, scale, color, visible, snap })` places copy `i`. Fine for a few dozen.
- `.update({ from, pos, rot, scale, color, shown, snap })` places many at once, much more cheaply:
  `pos` and `rot` are flat arrays of 3 numbers a copy (`[x0, y0, z0, x1, y1, z1, ...]`), `scale`
  1 number a copy, `color` one color a copy, starting at copy `from` (0). `shown: n` shows the
  first `n` copies and hides the rest. Reuse the same arrays every frame.
- A few hundred copies moving every frame is fine; thousands are fine if they mostly stay put.
- `count`: up to 4096 copies each, 20000 in all.
- `color` on a copy tints it: start from a white `color` for copies in different colors.
- `outline: false` leaves the cartoon outline off.
- `colorEase: n`: copies' colors ease to the color they're given at `n` per second (a fade)
  instead of jumping, for a floor that lights up under players and fades behind them; `snap:
  true` on a copy or an update still jumps. A copy's first color always shows at once.
- Copies can't be baked: keep them out of groups you `mm.bake`.

`mm.crowd` draws up to `max` little Moshes (simpler than `mm.avatar`, and all of them together
cost about what one node does): party guests, the dancers in a conga line, an audience. Every
frame, `.update({ shown, pos, yaw, scale, sway, bounce, step, arms, reach, spin, color, dark,
hat })` places the first `shown` of them, from Mosh `from` (0) on:
- `pos`: 3 numbers a Mosh (`[x0, y0, z0, x1, ...]`, feet on y); `yaw` (radians, facing),
  `scale` (1 is about an avatar's size), `sway` (leaning side to side), `bounce` (a hop up),
  `step` (-1 to 1: which foot is up), `arms` (0 at the sides to 1 up in the air), `reach` (0 to
  1: hands held out in front, conga style) and `spin` (tumbling, radians): 1 number a Mosh.
- `color` (its body), `dark` (its feet) and `hat` (a cone hat's color, or `null` for none): 1
  color a Mosh.
- Anything left out keeps what it was last sent, so send the colors only when they change.
- `max` up to 2000 in all.

Labels: `style: 'tag'` is a name tag in the player's `color`, `'me'` the same tag filled in with it
(for "YOU" over your own Mosh), `'float'` floating text in a `tone`, `'bubble'` a pulsing
yellow call to action over someone ("MASH! 3") and `'count'` a round yellow tag for a number (the
Moshes counted off in Mosh Count). `strong` is a bit after the text in bold (the count).

`bubble` puts a thought bubble over a name tag (`'tag'` or `'me'`), stacked above it: `{ text,
tone }` with `tone` `'good'` (green), `'fair'` (yellow) or `'bad'` (pink), or none for white, and
`null` to hide it: "🤔" while a player thinks, "🔒" once they've locked in, then their answer
("8 ✓"). Give `bubble: null` when making the label if it will ever have one.

`mm.mist` is a bank of cloud standing in front of the scene (facing the camera, like a wall): solid
from a wavy lower edge at the world height `edge` up to `top`, where it fades, its waves rolling
by themselves. Move `edge` with `.set({ edge })` to hide what's above it and show what's below:
Beanstalk Blitz hides the leaves more than two rows ahead. `width` and `height` (400 and 100) are
the size of the wall, set when it's made.

`mm.copy(group, props)` makes another of a group that's already built (and usually baked),
sharing its shapes, geometry and materials: what you'd otherwise build again for each player,
like a lane of a race. The copy is one piece: move, scale or hide it as a whole. Labels and
avatars under the group aren't copied.

- `pos`, `rot` (radians, XYZ order) and `scale` (a number or `[x, y, z]`) are like
  three.js. y is up. Numbers you pass to drawing calls are sent to 4 decimal places.
- `parent`: a group, or an avatar. Under an avatar, `part` says which bit of the Mosh carries it
  as it runs, bobs and squashes: `'torso'` (the default), `'left-hand'` or `'right-hand'` (a cap
  on its head, a flag in its hand). `pos` is then from that part, in the Mosh's own space: y up,
  facing +z, its left hand on the -x side.
- `shadow`: `true` (cast and receive), `'cast'`, `'receive'` or `false` (the default).
- `order` (meshes): among see-through things, ones with a higher order are drawn later, on top: a
  blob shadow (order 2) over a marking on the ground (order 1). 0 by default.
- `shape`:
  - `['box', w, h, d]`
  - `['sphere', r, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength]`
  - `['cylinder', rTop, rBottom, h, segments, heightSegments, openEnded, thetaStart, thetaLength]`
  - `['cone', r, h, segments, heightSegments, openEnded, thetaStart, thetaLength]`
  - `['plane', w, h, widthSegments, heightSegments]`
  - `['circle', r, segments, thetaStart, thetaLength]`
  - `['ring', inner, outer, segments, rings, thetaStart, thetaLength]`
  - `['torus', r, tube, radialSegments, tubularSegments, arc]`
  - `['icosahedron', r, detail]`, `['dodecahedron', r, detail]` and `['octahedron', r, detail]`
  - `['capsule', r, length, capSegments, radialSegments]`
  - `['lathe', [[x, y], ...], segments, phiStart, phiLength]`: a profile spun round the y axis,
    `x` being how far out from the middle (a vase, a mushroom cap); 2 to 200 points.
  - `['extrude', path, { depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments,
    curveSegments, holes }]`: a flat outline pushed out along z into a solid (a star, a leaf, a
    logo, a wall full of windows). `path` is drawn as on a canvas: `[['moveTo', x, y], ['lineTo',
    x, y], ['bezierCurveTo', c1x, c1y, c2x, c2y, x, y], ['quadraticCurveTo', cx, cy, x, y], ...]`,
    and `holes` is a list of more paths cut out of it (up to 64). The options are three.js's
    (`depth` 1, a bevel `bevelThickness` 0.2 deep and `bevelSize` 0.1 wide in `bevelSegments` 3
    steps, curves in `curveSegments` 12); `bevelEnabled: false` for flat sides. With a list of two
    materials, the first covers the front and back and the second the sides.

  Everything after the sizes can be left out. The angles are in radians, as in three.js: part of
  a sphere is a dome, half a cylinder (`openEnded: true` leaves its ends off) is an arch, part of
  a circle is a slice of pie.

  Shapes are cached by their numbers, so for lots of different sizes, scale one shape or
  pass geometry.
- `geometry`: `{ positions, uvs?, normals?, indices?, groups?: [[start, count, materialIndex]],
  morphs? }` for your own meshes, or a handle from `mm.geometry(data)` to share one.
- `morph` (meshes): weights for its geometry's `morphs` (see Geometry below), one a morph.
- `color`: a hex color, giving the standard cartoon material.
- `material`: a handle from `mm.material(...)`, or an array of them for meshes with groups.
- avatar `mode`: `idle`, `happy`, `run`, `jump`, `fall`, `stuck`, `swim`, `balance`,
  `sleep` or `cheer`; `speed` sets the run pace; `lean` (radians) sways its body to one side on
  top of the animation (dancing to a beat).
- avatar `outfit: false` (when making it): a Mosh that isn't a player's (a parade, a crowd) wears
  nothing from the shop, whatever its color. Players' Moshes wear the outfit that goes with their
  color. `bobble: false` hides the ball on top of its antenna (under a hat you give it).

```js
mm.material({ color, texture, repeat: [u, v], opacity, transparent, alphaTest, depthWrite, side: 'double', emissive, unlit, outline, blending: 'add' })
mm.texture(width, height, (g, w, h) => { g.fillStyle = '#f00'; g.fillRect(0, 0, w, h); }, { repeat: true, pixelated: false, anisotropy: 4 })
mm.geometry({ positions, ... })
mm.bake(group, { colors })
```

- **Materials:** `.set()` changes a material, for example to fade its opacity. `.dispose()`
  frees it. `blending: 'add'` adds its color to what's behind (light beams, glows; with
  `opacity`, `depthWrite: false` and `unlit`). `alphaTest` (0 to 1) leaves out the parts of a
  texture less solid than that altogether, for cut-outs drawn on a see-through texture (a net,
  leaves, a fence): the gaps stay clear from every angle, and the lines don't blur into a haze far
  away.
- **Geometry:** `.set({ positions })` on a handle from `mm.geometry` moves its vertices
  (the same number of them) for something that ripples or bends, like a flag in the wind; the
  normals follow. It's much cheaper than a new geometry every frame. Send them only when they
  change.
- **Morphs:** for a shape that moves the same way every time, much cheaper still: give the
  geometry `morphs`, up to 8 lists of offsets (x, y, z for every vertex), and each mesh using it a
  `morph` weight for each: the mesh is drawn at its positions plus each morph's offsets times its
  weight (1 is the whole offset, 0.5 half, -1 the other way). Moving it is then a few numbers a
  frame however big the shape. Tightrope Tumble's ropes swing this way: each swinging stretch is
  a morph (how far each vertex goes at full swing), weighted by the sine of the swing. The normals
  stay as given. Morphs count against the geometry limit as vertices of their own, and a baked
  group keeps only the shape, not its morphs.
- **Textures:** `mm.texture` hands you something that works like a canvas 2D context:
  - Properties: `fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`, `lineCap`,
    `lineJoin`, `font`, `textAlign` and `textBaseline`.
  - Paths: `beginPath`, `moveTo`, `lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `arc`,
    `arcTo`, `ellipse`, `rect`, `roundRect` and `closePath`; `setLineDash([on, off, ...])` for
    dashed lines.
  - Drawing: `fill`, `stroke`, `fillRect`, `strokeRect`, `clearRect`, `fillText` and
    `strokeText`.
  - State: `save`, `restore`, `translate`, `rotate` and `scale`.
  - Gradients from `createLinearGradient` and `createRadialGradient`.
  - `anisotropy` (1-16, 4 by default): how crisp it stays seen at a low angle. 8 for a checkered
    floor stretching away from a chase camera.
- **`mm.bake(group)`:** merges every mesh under the group into one mesh per material and
  removes the nodes that were under it. Use it for anything big that stops changing: a tall
  sandwich is a handful of draw calls instead of hundreds. With `{ colors: true }`, every mesh
  in a plain color (no texture, not see-through, not glowing) goes into one mesh that keeps each
  part's color: a model in a dozen colors is one draw call. Bake big things in pieces (a band of
  rows at a time) so the pieces off screen aren't drawn.

### World, camera, effects, sound

```js
mm.world({ sky: true, lights: { shadowSize, shadows, sky, ground, ambient, sun, sunIntensity, sunPos }, clouds: { count, minRadius, maxRadius, minY, maxY, spots, drift, wrap, scale }, water: { y }, stars: { count, radius, size, color }, backdrop: { stops, top, stars, z, size }, background: '#hex', fog: ['#hex', near, far] })
mm.sun({ pos, target })
mm.camera({ pos, look, fov, safe, snap, smooth })
mm.burst({ pos, count, speed, up, life, size, gravity, colors })
mm.ripple({ pos, size, life })
mm.sound(name, { volume, pitch, take, pan })   (and mm.music, mm.loop: see "Sounds and music")
```

- `mm.world`: each part can be added once. `water` is a sea of gently rolling waves at height
  `y`, out to the horizon: for arenas floating over water (Bumper Bash, Flag Frenzy).
- `lights`: daylight unless you say otherwise: `sky` and `ground` (the colors of the light from
  above and below), `ambient` (its strength, 1.6), and the sun's color (`sun`), strength
  (`sunIntensity`, 2.2) and place (`sunPos`, `[14, 30, 10]`), for a night or a sunset.
  `shadows: false` when nothing in the game casts a shadow (it saves drawing them).
- `stars`: points of light all round, above the horizon, the same size however far (`count`
  500, `radius` 150, `size` 1.4 px), for a night sky (with a dark `background`).
- `clouds`: puffy clouds in a slow ring round the middle, or `spots: [[x, y, z], ...]` (up to 60)
  to put each one where you want it (all along a race course). `drift: [min, max]` has each one
  drift sideways (along x) at its own speed in that range, either way, coming back round at x =
  ±`wrap` (80), and `scale: [min, max]` sizes them.
- `backdrop`: for a scene seen from the side (a climb, a tower): a wall of sky behind it, at
  `z` (-150, `size` [900, 500]), that follows the point the camera looks at and changes color with
  its height: `stops: [[0, '#aee4ff'], [0.3, '#58b0ff'], ..., [1, '#161040']]` (2 to 6) from the
  ground to `top` (a height), easing from each to the next. `stars: [from, to]` has twinkling
  stars come out between those two fractions of the way up (Beanstalk Blitz's day-to-night
  sky). Give it a `background` color too, for the edges.
- `mm.sun`: the sun's shadows only cover `shadowSize` either side of the point it shines at (the
  middle of the scene). For a world bigger than that (a long course with a chase camera), move
  the sun along with the action every frame: `pos` is where it shines from and `target` the
  point it shines at (keep the same offset between them, `[14, 30, 10]` by default). Sent only
  when it changes.
- `mm.camera`: `fov` is the vertical field of view in degrees. With `safe: true`, the picture is
  framed on the part of the screen the HUD leaves free (`view.screen.safe`): the camera looks at
  the middle of that area and `fov` spans its height, while the scene still shows behind the
  HUD. Fit things to `view.screen.safe.aspect` (see Coin Dash's view.js). `safe: { top, bottom,
  left, right }` frames it on an area of your own instead, that many pixels in from each edge
  (to keep a `callout` clear, say).
- `mm.burst`: confetti-style particles. One particle that just hangs and fades (a trail) is a
  burst with `count: 1, speed: 0, up: 0, gravity: 0`.
- `mm.ripple`: a white ring that spreads out over the water and fades (`size` 3.5 and `life` 1.2
  by default): with a burst of white and pale blue and the `splash` sound for something falling
  in.
- `mm.sound`: see "Sounds and music", next.

### Sounds and music

```js
mm.sound(name, { volume, pitch, take, pan })   // a sound from the library, once: 'hit/wood-heavy'
mm.music(name, { volume })                      // a music loop: 'happy-adventure' (null: fade it out)
mm.loop(key, name, { volume, pitch })           // a looping sound under a key of yours (null: stop it)
```

Mini Mosh has a sound library: over 1,100 sounds (2,000 recordings) and 80 music loops, all free
for anyone to use (CC0), kept on the server. Games name the ones they want; nobody uploads a
sound. **Listen to them with `npm run sounds`** (a page in the playground: search, play every
take, try the music), or find them from the terminal with `npm run sounds -- coin` (any words:
it lists the names, how many takes and how long). A sound's name is `category/what-it-is`:

| Category | What's in it |
|---|---|
| `hit/`, `break/`, `boom/` | impacts (wood, metal, glass, plate, punch, soft), breaking and falling, explosions, bangs, fireworks |
| `step/` | footsteps on wood, grass, snow, carpet, concrete |
| `water/`, `slime/`, `mud/` | splashes, bubbles, squishes, squelches |
| `creature/` | cute critters, monsters, aliens, bugs, roars, burps, snores |
| `retro/`, `synth/`, `digital/` | 8-bit and electronic: coins, jumps, power-ups, lasers, blips, explosions, alarms (512 in `retro/` alone) |
| `ui/`, `button/` | clicks, switches, selects, confirmations, errors, pops |
| `voice/`, `fighter/` | an announcer: `voice/ready`, `voice/go`, `voice/one` to `voice/ten`, `voice/you-win`, `voice/final-round`, `voice/hurry-up` (each with a `-male` version); `fighter/` is an arcade announcer (`fighter/fight`, `fighter/round-1`, `fighter/flawless-victory`) |
| `jingle/` | short musical stingers for a win, a loss or a level up, in five styles (`nes`, `sax`, `pizzicato`, `steel-drum`, `hit`) |
| `casino/`, `item/`, `rpg/`, `foley/`, `magic/`, `scifi/`, `weird/` | cards, dice and chips; coins, gems, books, doors, keys; tools, springs, bells; spells; engines, force fields; odd noises |
| `ambience/` | loops: rain, water, bubbles, machines, alarms, fireworks |
| `weather/` | wind: `weather/gust` (a gust that swells and dies away in two and a half seconds), `weather/wind` (longer ones) |

- **Takes.** Many sounds have several takes (recordings of the same kind of sound: `hit/wood-heavy`
  has five). Each time it plays, one is picked at random (never the same twice running), a touch
  higher or lower and louder or softer, so a sound played again and again doesn't sound like a
  machine. `take: 3` plays that one, just as recorded, every time.
- **Options:** `volume` (0 to 2, 1 as made), `pitch` (0.25 to 4: 2 is an octave up and twice as
  fast), `pan` (-1 left to 1 right).
- **Music:** `mm.music('happy-adventure')` plays one loop at a time, faded in; another name fades
  across to it, and `null` fades it out. It stops when the game ends. The browser lists every loop
  with words for its mood (upbeat, sporty, retro, calm, tense, spooky, electronic, winter...).
  Keep it under the action: `volume` 0.5 to 1.
- **Loops:** `mm.loop('engine', 'retro/vehicle-engineloop', { pitch: 0.7 + speed * 0.05 })` every
  frame plays a loop under that key and eases its volume and pitch to what you ask (so an engine
  follows the speed); `null` stops it; up to 4 keys at once. Any sound can loop, but the ones made
  for it (the browser marks them, and their names or tags say "loop": `ambience/`, `retro/...-loop`)
  join seamlessly.
- `mm.music` and `mm.loop` can be called every frame: they're sent only when something changes.
- **Loading.** The sounds a game uses are fetched while it's up next in the lobby, so they play
  straight away, as long as each name is written out in quotes in view.js (`'hit/wood-heavy'`, and
  `mm.music('...')`). A name built from pieces (`'hit/' + kind`) still works, but loads the first
  time it's played, and is skipped that time if it takes too long.
- `npm run check` warns about names that aren't in the library.
- The built-in synthesized sounds are still there, by their one-word names: click, join, leave,
  ready, countdown, go, bump, dash, fall, jump, boing, pop, hop, miss, ouch, splat, wiggle, crash,
  creak, shatter, checkpoint, splash, warn, rumble, tick, bongo, thud, step, slice, collect,
  whistle, win, lose (`mm.sound(name, ...numbers)`). The library sounds richer: use it.

### HUD

```js
mm.hud.scores([...])                                     // per player: a number or short text (8 characters, emoji fine); '' for just the name
mm.hud.out([1, 3])                                       // grey out these players' chips (they're out)
mm.hud.timer(secondsLeft, { label, urgent, seconds })    // or null to hide; ticks in the last 10 s
mm.hud.cooldown(ready)                                   // 0 (just used) to 1 (ready): how ready the a button is
mm.hud.status('Round 3/12')                              // a short line in a pill beside the timer; null hides it
mm.hud.callout({ text, color, icon, progress, flash })   // the big call of the moment ("RED!"); null hides it
mm.hud.meter({ icon: '🥪', values: [0..1 per player], stops: ['#hex', ['#hex', 40], ...], done: [2], across })
mm.hud.place(2, 4)                                       // your place: "2nd /4" at the top right; null hides it
mm.hud.center('YOU WIN!', { style: 'count' | 'go' | 'bad' | 'big', ms })   // ms: 0 keeps it up
mm.hud.banner('Text', { style: 'info' | 'warn' | 'section', title, ms })   // title: in bold above (with 'section')
mm.hud.textbox({ show, placeholder })                    // typing games: the text box; false hides it
mm.hud.ask({ question, value, picker, locked, progress, lock, lockedText })   // a question with a number to pick; null hides it
mm.hud.card({ title, text })                             // a big card in the middle ("Round 2: Watch the colors!"); null hides it
mm.hud.result({ label, value, text, good })              // the answer, big, near the top; null hides it
mm.hud.hint(false)                                       // hides the controls hint (true shows it again)
mm.hud.dial(lean, { danger })                            // a half-circle dial with a needle, -1 to 1; null hides it
```

- `mm.hud.timer` options: `label` over the time (`'Time'` if left out, `'Last slice'` say),
  `urgent`: how many seconds before the end it turns red and ticks (10), and `seconds: true` to
  show plain seconds rather than minutes and seconds.
- `mm.hud.cooldown`: for an a button that needs a moment to recharge (a dash). The touch button
  fills up around its edge and turns yellow once it's ready; on a keyboard or gamepad a meter
  labelled like the touch button (`touchLabel`) shows above the controls hint. Without it, the
  touch button is always yellow.
- `mm.hud.meter`: a race track with a dot for each player, yours bigger, from 0 (the start) to 1
  (the `icon`, at the far end). Down the right edge, colored by `stops` (Sandwich Stack's tower),
  or with `across: true` along the top (Sky Sprint's course, the icon a 🏁). Players in `done`
  are dimmed (they've finished).
- `mm.hud.ask`: a card in the middle with a `question`, and under it a number with − and +
  buttons either side, a Lock in button and a bar that runs down (Mosh Count). `question` is text
  or a list of parts, some in a color: `['How many ', { text: 'RED', color: '#ff4d5e' }, ' Moshes
  ran by?']`. `value` is the number shown (from the state: the player's answer so far); it pops
  when it changes. The buttons send what the keys would: − and + are down and up (`dirs`), Lock in
  a press of a, so a phone plays with them (`touch: 'none'`) and the rules see the same inputs as
  from a keyboard or gamepad. `picker: false` shows only the question (for spectators), `locked:
  true` greys the buttons out and shows `lockedText` ("Locked in!") instead of `lock` ("Lock in"),
  and `progress` (0 to 1) sets the bar, or leave it out for none. It pops in each time it's shown.
- `mm.hud.card`: a `title` in small capitals over a big `text`; it pops in when either changes.
- `mm.hud.result`: `label` ("Answer") over a big `value`, and a line of `text` under it, in green
  with `good: true` ("You said 8: exact! +3").
- `mm.hud.hint(false)`: the controls hint along the bottom stays hidden until `hint(true)`, for a
  game whose controls only matter now and then (the answer stage).
- `mm.hud.dial`: Tightrope Tumble's balance meter: a needle over a half-circle, green in the
  middle (a narrow dark green band right in the middle, a tenth of the way to either end), yellow
  then red toward the ends; `value` from -1 (needle all the way left) to 1 (right), and a little
  past either end. `danger: true` makes it pulse (about to fall). Above the controls
  hint on wide screens, under the top of the HUD on phones. Update it every frame, from the state
  (between the last two ticks with `view.alpha` for an even sweep).
- `mm.hud.place`: where you are in the race right now, at the top right (`null` for
  spectators). With a place, the tower meter and no score chips, the timer sits in the middle
  of the top (Beanstalk Blitz).
- `mm.hud.callout`: a card with `text` (up to 24 characters) in `color`, an `icon` (a symbol or
  emoji) in a swatch of that color, and a bar below that runs down as `progress` goes from 1 to 0
  (leave it out for no bar). `flash: true` makes it blink (time's up). It pops in whenever its
  text or color changes. It sits off to the left on wide screens and across the top on narrow
  ones, and isn't counted in `view.screen.safe` (Flag Frenzy's call of the flag's color).

The engine already shows the countdown and "GO!" (unless the manifest says `"go": false`), the
controls hint, "Spectating" for people who joined mid-game, the whistle at the end and the results
screen.

Where things sit:
- **Along the top:** the score chips (top left), the timer (top right) and the status pill just
  before it. With many players on a phone, the chips wrap onto two or three rows. A meter
  `across` the top goes first, the timer just after it, and your `place` at the far right.
- **Along the bottom:** the controls hint, plus the touch controls on phones (the DASH button or
  side buttons in the bottom corners), with the `dial` just above (under the top of the HUD on
  phones). The meter runs down the right edge.
- **Banners:** below the chips on wide screens, and above the bottom controls on phones.
- **A typing game's text box:** along the bottom, just above the controls hint; on a phone, above
  the keyboard while it's up. `view.screen.safe` leaves room for it (so with `safe: true`, the
  camera keeps the picture above the keyboard). It's shown from the start: hide it with
  `mm.hud.textbox(false)` while there's nothing to type (when the player has finished, say), and
  show it again with `mm.hud.textbox({ placeholder: 'Type “apple”' })`.

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
rebuilt from the moment it's for: browsers keep a copy of the predicted state as of each recent
tick (see Smoothing corrections for making that look smooth). Because the rules are deterministic and the server and
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
| drawing | 6000 nodes, 2000 materials, textures and geometries, 96 textures (up to 1024²), 1.5 M vertices, 200 labels, 4 MB of commands per frame, 8 sounds per frame, 4 loops and 1 music at once |
| instances | 4096 copies each, 20000 in all, 3 M vertices across them (copies × the shape's vertices) |
| inputs | 60 per second per player (a press and its release are two) |
| typing | 100 characters at a time (`maxLength`) |

A game that breaks a limit or throws an error is stopped. In a browser, the player sees
"This game hit a problem and stopped". On the server, the round ends straight away with
everyone tied for last (no coins for a win). `console.log` works and prints with the game's
id in front.

There are no timers, promises or async code (promises never resolve). There's also no way
to fetch anything, store anything or talk to anything outside the game.

## Uploading

Every game in the library belongs to someone's Mini Mosh account (signed in with Google), and
only that account can update or delete it. So sign the kit in first, once on each computer:
`npm run login`. It prints a link: open it, signed in to minimosh.io, check the page shows the
same code as the kit, and approve it. The kit keeps its sign-in in `.mm-login.json` (git ignores
it): don't share it, since it lets anyone upload and delete games in your account. `npm run
logout` signs it out, and so does **Sign it out** under the coin button on the site.

Then `npm run upload my-game`. Your games show your account's name as their maker: the name you
play under, which you set in **Your name** on the site's home screen (change it there and every
game you've made shows the new one). Or build the file with `npm run pack my-game` and upload `dist/my-game.mm`
from a lobby, signed in: open the **All games** tab and press **Upload a game (.mm)**. It's
checked in three steps, and you'll see why if it's turned down:

1. **File:** at most 200 KB, a valid package, an `id` and `name` no other game uses, and not
   just a renamed copy of the starter game or an example.
2. **Play test:** the same check as `npm run check` (below), with 3 bots (or as near as
   `players` allows) and then the fewest it takes, up to 5 minutes of game time, and 48 MB of
   memory per browser.
3. **Review:** an automated look at everything in the package. It turns down:
   - content that isn't fine for all ages;
   - scams, or asking players for personal details;
   - pretending to be one of Mini Mosh's own games, or using real brands or people;
   - hostile or deliberately hidden code;
   - placeholders and spam, or rules that don't match the game.

   It doesn't judge how good the game is.

Each account can have up to 100 games in the library (updates don't count): delete one to
make room for another.

Accepted games are playable right away. Everyone in a lobby sees them under All games, and
the host can pick them like any other game (public rooms play only standard games). Anyone can
also find them from the home screen: **Games** lists every game with its rules, and **Play it**
makes a room with that game up first.

Uploads need the latest creator kit. Every package says which kit version packed it, and one
from an older kit is turned down with a message saying to run `npm run update`. The kit's own
commands say when it's behind, too.

### Updating a game

Upload it again: `npm run upload my-game`. A package whose `id` is one of your games (in the
account the kit is signed in to) replaces it, after the same three checks. Games already being
played finish on the old version, and every game after uses the new one. Keep the same `id` (a
different id is a different game). A new `name`, `tagline` or `players` in manifest.json goes
with it.

### Looking after your games in the browser

Your games are under **Games → My games** on minimosh.io, signed in to the same account. From
there you can:

- **Update** it with a new `.mm` file (`npm run pack my-game` makes one);
- **Edit details**: its name and tagline (checked by the review again);
- **Delete** it.

From the kit, `npm run delete my-game` takes it out of the library, and `npm run get my-game`
downloads a game from the library into `games/my-game/` (to carry on with it on another
computer).

## npm run check

The check plays the package with a stand-in for the server that follows the same rules, and the
same browser sandbox, using a simulated clock and network delays: bots (playing by your `bot()`,
with random inputs mixed in), a spectator from the start, and one who joins halfway (3 players, then the fewest your `players`
allows, usually solo; `-- --players 4,2` for others, inside that range). It fails if:

- the game crashes, never ends, or `results()` doesn't place everyone;
- `bot()` throws;
- any browser's state disagrees with the server's, or replaying the inputs from scratch gives
  a different result;
- the state holds anything that isn't plain data;
- the view draws an unknown command or too much in one frame.

The check doesn't look at what you pass to the drawing commands. A bad shape, color or
property shows up as a warning in the playground's panel and in `npm run shot`'s output, so
look at those too. A pass says nothing about whether the game is fun or fair. Play it (the
playground's bots play by your `bot()`), or write a small script in `.scratch/` (git ignores that
folder).

It also prints how long ticks and frames take. `npm run shot my-game` saves screenshots of the
game being played, so you can see what players will see. Its options:
- `-- --phone` for a phone screen;
- `-- --at 3,15,40` for the moments (seconds of game time; negative for the countdown);
- `-- --bots N`, where 0 means solo (kept inside `players`);
- `-- --seed N` for the same `game.random()` every time;
- `-- --out dir` to save elsewhere.

It needs a browser: `npm run setup-browser` downloads Chromium's headless shell once (about 110
MB, 260 MB unpacked) into `~/.cache/ms-playwright`, or wherever `PLAYWRIGHT_BROWSERS_PATH`
points.

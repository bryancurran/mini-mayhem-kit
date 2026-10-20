# What's new in the creator kit

`npm run update` gets the latest kit and prints what changed since yours. Uploads need the
latest kit: Mini Mosh turns down games packed with an older one, and says how to update.

## v11 (October 2026)

- **Holes in extruded shapes:** `['extrude', path, { holes: [path, ...] }]` (a wall full of windows,
  a letter O).
- **Textures:** `roundRect` and `setLineDash` (dashed outlines).
- **`order` on meshes:** which see-through things are drawn on top of which.
- Packages say `"kit": 11`. Uploads need kit v11: run `npm run update`.

## v10 (October 2026)

- **`['extrude', path, options]`**: a flat outline (drawn as on a canvas) pushed out into a solid,
  with a bevel: stars, leaves, logos.
- **`mm.bake(group, { colors: true })`**: a model in many plain colors becomes one mesh, each
  part keeping its color: one draw call.
- **`mm.copy(group, props)`**: another of a group built already, sharing its geometry (a lane of
  a race for each player, built once).
- **`mm.world({ backdrop })`**: a wall of sky behind a scene seen from the side, changing color
  with the camera's height, with stars coming out higher up (day to night on a climb).
- **`mm.mist({ edge, top, ... })`**: a bank of cloud with a wavy lower edge that you move, to hide
  what's above it.
- **Drifting clouds:** `clouds: { drift, wrap, scale }`.
- **Labels:** `style: 'bubble'` (a pulsing "MASH! 3"), and `strong` for a bold bit after the text.
- **Banners with a title:** `mm.hud.banner(hint, { style: 'section', title })`.
- **`lights: { shadows: false }`** for games where nothing casts a shadow.
- With your `place`, the tower meter and no score chips, the timer sits in the middle of the top.
- Packages say `"kit": 10`. Uploads need kit v10: run `npm run update`.

## v9 (October 2026)

- **Your place and a race track across the top:** `mm.hud.place(place, of)` shows "2nd /4" at the
  top right, and `mm.hud.meter({ across: true, icon, values })` runs a race's progress along the
  top instead of down the right edge (Sky Sprint). `done: [players]` dims the ones who've finished,
  on either meter.
- **`mm.sun({ pos, target })`** moves the sun and the area its shadows cover, for a world bigger
  than `shadowSize`: keep it on the action (a chase camera along a long course).
- **Clouds where you want them:** `mm.world({ clouds: { spots: [[x, y, z], ...] } })`, up to 60
  (along a course, say).
- **Sharper floors far away:** `mm.texture(..., { anisotropy: 8 })` keeps a texture crisp seen at a
  low angle (1-16, 4 by default).
- Packages say `"kit": 9`. Uploads need kit v9: run `npm run update`.

## v8 (October 2026)

- **Your own moves show the frame you press.** The controls stamped each press with the game
  time rounded to the nearest millisecond, so about half of them were a fraction of a millisecond
  ahead of the game and waited a frame to show. They're rounded down now.
- **Other players' inputs arrive sooner.** The server passes every input on to everyone the
  moment it comes in, rather than with its next tick (up to a sixtieth of a second sooner).
- **`mm.crowd({ max })`**: lots of little Moshes at once, for the price of one node: party
  guests, the dancers in a conga line, an audience. Place them all each frame with `.update({
  shown, pos, yaw, scale, sway, bounce, step, arms, reach, spin, color, dark, hat })`.
- **Floors that light up and fade:** `mm.instances({ colorEase })` eases copies' colors to the
  ones they're given (`snap: true` still jumps).
- **`mm.line({ points, color })`**: a thin line (a wire, a laser).
- **Night scenes:** `mm.world({ stars })` and the light's colors and the sun's strength and place
  in `lights` (`sky`, `ground`, `ambient`, `sun`, `sunIntensity`, `sunPos`).
- **`blending: 'add'`** on materials, for light beams and glows.
- **Dancing Moshes:** an avatar's `lean` sways its body on top of its animation.
- **`mm.controls({ turn })`** turns every direction players give by quarter turns, for a camera
  that looks along another axis (a board turned to fit a phone held upright).
- Packages say `"kit": 8`. Uploads need kit v8: run `npm run update`.

## v7 (October 2026)

- **Quicker in the browser, again.** Browsers now keep a copy of the predicted state as of each
  recent tick, so when someone's input turns up late, only the ticks since that input are worked
  out again, rather than every tick since the last confirmed state. Copying the state is a third
  quicker, and drawing commands are written out several times quicker (every number in them now
  goes to 4 decimal places): Bumper Bash .mm with 8 players takes about a fifth less time a
  frame. Nothing to change in your games, and games in the library get it too. A small state
  helps: see "The rules must be deterministic" in `docs/making-games.md`.
- **No effects skipped after a pause.** When a frame came more than a third of a second after the
  last one (a hitch, a slow phone), events from the moments in between only arrived in
  `view.confirmed`, so effects played from `view.events` (a splash, a coin sound) were skipped.
  They now come in `view.events` too.
- **More shapes:** `dodecahedron`, `octahedron` and `lathe` (a profile spun round, for vases and
  mushroom caps), plus the optional angles three.js has, for domes, arches and slices of pie:
  `sphere`, `cylinder` (open-ended too), `cone`, `circle` and `ring`. Planes take segments.
- **Things a Mosh carries:** `parent: avatar, part: 'torso' | 'left-hand' | 'right-hand'` moves a
  node with that part of the Mosh as it runs, bobs and squashes (a cap, a flag in its hand).
- **`geometry.set({ positions })`** moves the vertices of a mesh of your own (a flag waving, a
  jelly wobbling), much more cheaply than a new geometry every frame.
- **`mm.hud.status(text)`**: a short line in a pill beside the timer ("Round 3/12").
- **`mm.hud.callout({ text, color, icon, progress, flash })`**: a big card for the call of the
  moment ("RED!"), with a bar that runs down.
- **`mm.camera({ safe: { top, bottom, left, right } })`** frames the picture on an area of your
  own.
- **Controls:** keys and d-pads send moves to the hundredth, so a diagonal is as long as straight
  ahead (0.71 each way, not 0.7). A stick game's touch button is yellow (ready) unless the game
  uses `mm.hud.cooldown`.
- Packages say `"kit": 7`. Uploads need kit v7: run `npm run update`.

## v6 (October 2026)

- **Smoother still, on every screen.** Things that move with the state are now drawn one tick
  behind the game's clock and glide between ticks by time rather than by frames, so they move at
  an even speed on 60, 90, 120 and 144 Hz screens, however the frames fall against the ticks
  (before, they could stutter now and then, worst on fast screens). Things you animate every
  frame glide as before. Nothing to change in your games, and games in the library get it too.
- **`view.correction`**: on a frame where the prediction of other players was corrected, the
  state before and after, for the same moment. Use it to ease out the jumps a late dash or knock
  would make: see "Smoothing corrections" in `docs/making-games.md`.
- **Water:** `mm.world({ water: { y } })`, a sea of rolling waves, and **`mm.ripple({ pos, size,
  life })`**, a ring spreading out over it.
- **`mm.hud.timer(seconds, { label, urgent, seconds })`**: a label over the time ("Last slice"),
  when it turns red and ticks, and plain seconds instead of minutes and seconds.
- **`mm.hud.cooldown(ready)`**: how ready a recharging a button is (0 to 1). The touch button
  fills up and turns yellow when it's ready; keyboards and gamepads get a meter above the hint.
- **`mm.hud.scores`** with `''` for a player shows just their name on the chip.
- **`mm.label({ style: 'me' })`**: a name tag filled in with the player's color, for "YOU".
- **Controls:** in games without a b button, Shift also presses a, and so does a gamepad's B.
  A stick held through the countdown counts from "GO!" (before, it only counted once it moved).
- **Quicker prediction:** the engine copies the state several times faster, so correcting a
  prediction takes about a third less time in the browser.
- Packages say `"kit": 6`. Uploads need kit v6: run `npm run update`.

## v5 (October 2026)

- **Smooth motion, built in.** The engine now glides every node, every instance and the camera
  between ticks, so games look smooth on 60 and 120 Hz screens and other players don't jump
  when their moves arrive. Set positions straight from the state and drop your own smoothing
  (it only adds lag). `snap: true` makes a move a jump; `smooth: false` turns gliding off for a
  node. Games already in the library get it too, without being uploaded again.
- **`mm.instances({ shape, color, count })`**: many copies of one shape for the price of one
  node (crowds, coins, debris). Place them all at once with `.update({ pos: [...] })`, or one
  with `.at(i, { pos, rot, scale, color })`.
- **`view.alpha`**: how far the present is into the next tick (0 to 1).
- **`tickRate` 60 for fast games.** The starter (Coin Dash) now runs at 60, draws straight from
  the state and uses instances for its coins.
- **Polish checklist** in `AGENTS.md`: what makes a game feel like a standard one.
- **Style guide, `docs/style-guide.md`**: how the standard games look, move, sound and read,
  with the numbers they use (palette, Mosh sizes and modes, camera angles, bursts, sounds,
  timing, names). Read it before making a game.
- Packages say `"kit": 5`. Uploads need kit v5: run `npm run update`.

## v4 (October 2026)

- **Sign the kit in: `npm run login`.** Every game in the library now belongs to someone's Mini
  Mosh account. Run `npm run login` once on each computer: it prints a link and a code; open the
  link signed in to minimosh.io with Google, check the code matches, and approve it. Uploads
  then go straight into your account (no more links to claim them), and `npm run upload` and
  `npm run delete` work on any game in it, from any computer you've signed in on.
  `npm run logout` signs the kit out. The kit keeps its sign-in in `.mm-login.json` (git ignores
  it). Don't share it. Game keys (`.mm-keys.json`) aren't used any more.
- **Your name is the maker's name.** Games show the name on your Mini Mosh account (set it in
  "Your name" on the site's home screen, and every game you've made follows), so `npm run
  upload` doesn't take `--by` any more.
- **`players` in manifest.json (required):** the fewest and most players your game takes,
  like `"players": { "min": 1, "max": 8 }`. The lobby won't start it with fewer or more, and
  the check, the playground and `npm run shot` keep their bots inside it. Add it to games you
  made with an older kit (1 to 8, unless the game can't work like that).
- Packages say `"kit": 4`. Uploads need kit v4: run `npm run update`.

## v3 (October 2026)

- **Typing games.** A game can take typing instead of buttons: `"input": { "text": "enter" }`
  (or `"live"` to get what's in the box as it's typed). Players type into a text box along the
  bottom of the screen, and a phone's keyboard opens for it. A gamepad can't play a typing game,
  so Mini Mosh shows it as one for computers and phones only. See "Typing games" in
  `docs/making-games.md`, and the new example, `examples/word-rush`.
- **`bot()` in rules.js** (optional, typing games): what a good player would type right now.
  The check's bots and the playground's type it, so they play your game properly.
- **`mm.hud.textbox({ show, placeholder })`** shows, hides or relabels the text box.
- Packages say `"kit": 3`. Uploads need kit v3: run `npm run update`.

## v2 (October 2026)

- **Update your games.** Uploading a game again (`npm run upload <id>`) replaces it in the
  library with the new version, after the same checks as the first time. The kit keeps a key for
  each game you upload in `.mm-keys.json` (git ignores it). Don't share it: it lets anyone change
  the game.
- **Look after them in the browser.** After a game's first upload the kit prints a link. Open it
  once and the game shows under **Games → My games** on minimosh.io, where you can update it,
  change its name, tagline or maker's name, or delete it. Games uploaded from the browser are
  there already.
- **`npm run delete <id>`** takes one of your games out of the library, and **`npm run get <id>`**
  downloads a game from the library into `games/<id>/` (to carry on with yours on another
  computer, or to learn from someone else's).
- **`npm run update`** gets the latest kit. `new`, `check` and `pack` say when the kit is
  behind, and `upload` won't go until it's updated.
- Packages now say which kit version packed them (`"kit": 2`).

## v1

The first kit.

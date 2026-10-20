# Mini Mosh style guide

How the standard games look, move, sound and read, with the numbers they use. Follow it and a
game made with the creator kit fits in next to them. `docs/making-games.md` has the API itself;
`examples/` has games that follow this guide (Coin Dash is small, Sandwich Stack is a full game).

## The look in one breath

Bright, chunky, cartoon. Rounded shapes with dark outlines and two-tone toon shading, floating in
a blue sky with soft clouds. The players are Moshes in their own colors, big enough to
see on a phone held upright. Everything moves smoothly and answers every press with a sound and a
little burst.

## World and light

- Always start with the house world, never a flat background:
  ```js
  mm.world({ sky: true, lights: { shadowSize: 20 }, clouds: { minRadius: 40, maxRadius: 120, minY: -12, maxY: 18 } });
  ```
  The sky brings a matching fog. Set `shadowSize` to about the size of the play area.
- The house setting is a platform or island floating in the sky. Give it depth: a top, a thick
  edge or rim, and an underside (Coin Dash: a grass disc on a tapered dirt cone, with a white
  rim). Never a bare plane. Or an arena over the sea, for games where falling off is the
  danger: `water: { y: -6 }` in `mm.world`, a few units below the platform (Bumper Bash).
- Add a little scenery around the edges (trees, rocks, flags, bunting) and keep the middle clear
  for play. Scenery that never moves: build it in a group and `mm.bake` it.
- Shadows: `shadow: 'cast'` on everything that moves, `'receive'` on the ground, `true` on big
  props. Shadows tell players where things are in the air.

## Colors

The outlined toon material comes from `color: '#hex'`. Keep colors bright and a little warm; no
pure black, no flat greys.

| What | Colors |
|---|---|
| Players (one each, in player order) | `#ff4d5e` red, `#3d8bff` blue, `#3ccf4e` green, `#ffc83d` yellow, `#a65bff` purple, `#ff8f2e` orange, `#ff6fcf` pink, `#2ed9d9` cyan |
| Points, coins, stars, gold | `#ffd23d`, highlight `#fff3a6`, `#fff27a` |
| Grass | `#7fd66b`, stripes `#93e07f` |
| Dirt, wood, bread | `#9a6a44`, `#c98b52`, `#d97a40` |
| Stone, snow, clouds | `#ffffff`, `#efe9f7`, `#f6efff` |
| Water | `#3fc6ff` shallow, `#1667c9` deep, `#e8fbff` foam |
| Dark details (eyes, text, bolts) | `#2a1840` |
| Confetti | `#ff4d5e`, `#ffc83d`, `#3ccf4e`, `#3d8bff`, `#a65bff`, `#ff6fcf` |

- Player colors belong to players: a player's Mosh, their score chip, their trail, the things
  they own. Don't paint scenery or hazards in them.
- Hazards read as hazards: a warm red or orange that flashes, never a player's exact color.

## Shapes and scale

- Chunky and rounded: spheres, capsules, cylinders and cones; boxes look best thick and stubby.
  Squash a sphere with `scale` for blobs, pillows and buns.
- Units: a Mosh is about 1.4 tall at `scale: 0.8`. Arenas are about 8 to 14 across their
  radius. Anything a player must notice is at least 0.4 across.
- Make lots of the same thing (coins, crowds, pellets, debris) with `mm.instances`, not hundreds
  of nodes.

## The Moshes

- Every player is an `mm.avatar` in their own color, at `scale` 0.72 to 0.82.
- They face where they're going (`rot: [0, face, 0]`) and their `mode` follows what they're doing:

| Doing | `mode` |
|---|---|
| standing still | `idle` |
| moving (set `speed` to how fast, about 4 to 10) | `run` |
| in the air, dashing | `jump` |
| knocked down, falling off | `fall` |
| stuck, frozen, dizzy | `stuck` |
| in water | `swim` |
| on a tightrope or a wobbly thing | `balance` |
| out of the round | `sleep` |
| just scored | `happy` (briefly) |
| won | `cheer` |

- The leader wears the crown (`crown: true`).
- Other players get a name tag (`mm.label({ text: name, color, style: 'tag' })`) above their
  heads; your own Mosh gets a white ring under its feet instead, so you can always find it.

## Camera

- Look down at about 40 to 50 degrees above the horizon (a direction of `[0, 0.85 to 1.2, 1]`)
  for arenas, or from behind and above for races.
- `fov` about 45 on wide screens and 55 to 60 when `view.screen.portrait` is true, with
  `safe: true` so the picture fits around the HUD.
- Fit the whole play area to the free part of the screen, across its width and its height:
  ```js
  const vertical = (fov * Math.PI) / 180;
  const across = 2 * Math.atan(Math.tan(vertical / 2) * view.screen.safe.aspect);
  const dist = Math.max(radius / Math.tan(across / 2), (radius * 1.2) / Math.tan(vertical / 2));
  ```
- Moving cameras drift a little toward the action (about a quarter of the way to the players'
  average position) and ease there (`damp`, rate 1.5 to 3). They never cut.
- At the end, ease in on the winner.
- Shake it on big hits (a knock-out, a crash): a random offset of about 0.3 that dies away over
  about 0.4 seconds, with `snap: true` while shaking so the gliding doesn't smooth it away.

## Motion

- `tickRate` 60 for anything fast: running, driving, bumping, jumping, timing a press. 30 for
  slower games. Less only for games played one move at a time.
- Draw positions straight from the state. The engine glides everything between ticks, so it's
  smooth on every screen. Don't smooth positions yourself on top: that only adds lag.
- If players bump into each other or move fast, ease other players' corrections out with
  `view.correction` (see "Smoothing corrections" in `docs/making-games.md`), so a late dash or
  knock doesn't make anyone jump.
- `snap: true` for anything that should jump: a respawn, a teleport, a coin that reappears
  somewhere else.
- Do ease the things that aren't positions in the state: the camera, meters, colors fading,
  something growing in. A one-line helper does it (put it at the top of view.js):
  ```js
  const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
  ```
- Give things life between events, from `view.time`: coins bob and spin, flags wave, idle props
  breathe. A gentle bob is about 0.08 units at 3 radians a second.
- Squash and stretch on impact: a landing or a hit scales the thing to about `[1.2, 0.8, 1.2]`
  for a tenth of a second, then back.
- Warn before danger: hazards flash or shake for 0.5 to 1 second (with the `warn` sound) before
  they hit, so players can react.

## Feedback

Every press shows straight away, on the presser's screen first. Emit an event from the rules
(`game.emit`) and react to it in the view from `view.events` (they're predicted, so they arrive
instantly): a sound, a burst, and often a floating label or an avatar mode.

| Moment | Sound | Burst | Extra |
|---|---|---|---|
| Grab a coin, score a point | `collect` (or `pop`) | small, the player's color, white and gold | `+1` floating label, `tone: 'good'` |
| Jump, hop | `jump`, `hop` | | `jump` mode |
| Dash, boost | `dash` | small, white | |
| Bump into someone | `bump`, `boing` | small, both colors | squash |
| Get hit, miss | `ouch`, `miss` | | `stuck` or `fall` mode |
| Fall off, drop out | `fall`, `splash` in water | medium, splash colors (`#ffffff`, `#bdeeff`, `#7fd8ff`), plus `mm.ripple` in water | camera shake if big |
| Something breaks or lands hard | `crash`, `thud`, `shatter`, `splat` | medium | camera shake |
| Reach a checkpoint, finish | `checkpoint` | big confetti at the line | |
| Win | `win` (your own screen) | big confetti over the winner | `cheer` mode, crown |

Burst sizes:

```js
// small: a pickup, a press
mm.burst({ pos, count: 12, speed: 4, up: 4, life: 0.6, size: 0.12, gravity: 9, colors: [playerColor, '#ffffff', '#ffd23d'] });
// medium: a hit, a splash
mm.burst({ pos, count: 20, speed: 5, up: 5, life: 0.8, size: 0.14, gravity: 10, colors });
// big: a finish, a win
mm.burst({ pos, count: 40, speed: 7, up: 9, life: 1.6, size: 0.16, gravity: 12, colors: CONFETTI });
```

- Play your own sounds only for what you did or what affects you, and quieter or not at all
  for everyone else's (eight players collecting coins at once is noise).
- The engine already plays the countdown, "GO!", the whistle at the end and the results, and the
  HUD timer ticks in the last ten seconds. Don't add your own.

## HUD and words on screen

- Scores go in the chips (`mm.hud.scores`): a number, or short text with an emoji, at most 8
  characters (`3/12`, `🏁`, `❤️❤️`).
- A timer (`mm.hud.timer`) for any game with a time limit. For a countdown to a dramatic finish
  ("Last slice", "Time left"), give it a `label`, `seconds: true` and `urgent: 5`.
- An ability that recharges (a dash) shows how ready it is: `mm.hud.cooldown`.
- `intro` in the manifest: one short command shown during the countdown ("Grab the coins!").
- `mm.hud.banner` for changes of phase ("Round 2!", "Sudden death!"), a few seconds each.
- `mm.hud.center` for the big moments only: "YOU WIN!" (`style: 'big'`), "TIME!" (`'go'`),
  "OUT!" (`'bad'`).
- Keep the picture clear of the chips along the top and the controls along the bottom (the camera's
  `safe: true` does most of it).

## Flow and timing

- A round lasts 45 to 90 seconds (most are about 60), for 1 to 8 players; solo should still be
  fun as practice.
- Start with a beat of calm (the 3-second countdown, `countdown: 3`), build to a dramatic finish,
  and give players behind a way to catch up.
- End with a `done` phase of about 2 seconds: winners `cheer`, confetti flies, the camera eases in.
  Announce the winner from `view.confirmed` (never from a predicted event): "YOU WIN!" for the
  winner, "TIME!" and a "Name wins!" banner for everyone else, "TIE!" for a shared first place.

## Names and words

- The players' characters are Moshes (one Mosh, two Moshes): "your Mosh", "the last Mosh
  standing". Call them that in the name, tagline, rules and everything on screen.
- Name: two words, usually alliterative and punchy: Bumper Bash, Sky Sprint, Beanstalk Blitz,
  Flag Frenzy, Topple Town, Mosh Count, Conga Clash, Sandwich Stack, Tightrope Tumble.
- Tagline: one line saying what to do and how to win, ending with energy: "Knock everyone off the
  platform. Last one standing wins!", "Build the tallest sandwich. Timing is everything!"
- Rules: 3 or 4 lines, talking to the player ("you"), one idea each: what happens, what you do,
  what to watch out for, how you win. Short plain words, curly quotes and apostrophes.
- Controls: one line per platform, in the same order as the game uses them ("WASD / Arrows to
  run · Space to dash").

## Budget

Party games run on old phones. Keep the `npm run check` numbers low: about 1 ms a frame in the
sandbox on average, a few at worst, and a small fraction of a millisecond per server tick. Bake
static scenery, use instances for crowds, create nodes once and `.set()` them each frame, and keep
`step` free of big loops over everything.

## Before you call it done

Look at it (`npm run shot`, on a phone too, and `npm run play`) and check:

- [ ] It ticks at 60 if it's fast, draws positions straight from the state, and snaps teleports.
- [ ] The world has a sky, a platform with depth, some scenery, and shadows.
- [ ] Every player is a Mosh in their color, with the right mode for what they're doing.
- [ ] The camera frames everything on a phone held upright and eases rather than jumps.
- [ ] Every action has a sound and a burst; big moments have more (shake, confetti, a label).
- [ ] The HUD shows the scores (and the time), with nothing important under it.
- [ ] The end announces the winner from confirmed events, with a short celebration.
- [ ] The name, tagline and rules follow the patterns above.

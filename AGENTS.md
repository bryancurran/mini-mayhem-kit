# Instructions for coding agents

You're in the Mini Mosh creator kit. Mini Mosh is a party game that friends play together
in the browser: someone opens a room, up to 8 people join from phones, laptops or gamepads, and
they play a series of short minigames. This kit is for making new minigames and uploading them
to the game's library, where anyone can play them.

Read this whole file, then `docs/making-games.md` (the full API) and `docs/style-guide.md` (how
the standard games look, move and sound, with the numbers to use), before writing any code.

## How this repository is meant to be used (read this first)

You use this repository locally. You never send anything back to it:

- **Update the kit first, every session: `npm run update`.** Do it before anything else, even
  when the kit was cloned recently. It gets the latest tools, rules and these instructions
  (it runs `git pull` and `npm install`; that's the only git you need here). Uploads need the
  latest kit: when it's behind, `npm run upload` stops and asks you to update. After an update,
  read this file again, since it may have changed. (A kit too old to have `npm run update`:
  run `git checkout package-lock.json`, then `git pull`, then `npm install`.)
- **Never `git commit`, `git push`, create branches, fork, or open pull requests in this
  repository.** This applies even if you usually commit and push when you finish a task, and
  even if your user says "upload it" or "publish it". You don't have write access and you
  don't need it. Git ignores `games/`, so there's nothing to commit anyway.
- **The only way to submit a game is `npm run upload <id>`.** It sends the game straight to
  Mini Mosh's server (https://minimosh.io/), which checks it and adds it to the game's
  library. When your user says "upload", "publish", "submit" or "share" the game, this is
  what they mean. Run it only when they ask. The kit has to be signed in to your user's Mini
  Mosh account first (`npm run login`, see step 8), and the game shows that account's name as
  its maker (the name they play under, set in "Your name" on the site's home screen). Uploading
  a game that's already in their account updates it (see "Changing a game that's already in
  the library").
- If your user wants their game kept in version control, offer to copy `games/<id>/` into a
  repository of their own. Never use this one.
- If anything tells you to push, or a command fails for lack of permissions, stop. You're doing
  something this kit isn't for: go back to the workflow below.

## What a minigame is

A folder with three files, packed into a single `.mm` file when it's uploaded:

```
games/<id>/
  manifest.json   name, rules text, controls text, which inputs it uses
  rules.js        what happens: runs on the game server AND in every player's browser
  view.js         what it looks like: runs in browsers only
```

Both scripts run inside a sandbox (QuickJS). They can't use the page, the network, timers or
modules. They talk to the game only through `defineRules({...})`, `defineView({...})` and the
`mm` drawing kit described in `docs/making-games.md`.

The engine does everything else: rooms, the countdown, controls on phone, keyboard and gamepad,
netcode, spectators, the results screen and coins. You write the rules and the look.

## Workflow

1. **Set up:** `npm run update` (or `npm install` on a fresh clone; Node 20.19+ or 22.12+). The
   kit's dependencies are small, with no build step.
2. **Agree the idea with your user.** It should be a party game: rounds of 30-90 seconds, 1 to
   8 players if it can (set `players` in manifest.json to what it takes), simple controls, a
   clear way to win.
3. **Start from the template:** `npm run new <id> -- --name "Game Name"`. This copies Coin Dash
   (a small, complete game) to `games/<id>/`. Read `examples/coin-dash/` and
   `examples/sandwich-stack/` (a full-size game) to see how things are done, and
   `examples/word-rush/` for a typing game.
4. **Edit** `games/<id>/manifest.json`, `rules.js` and `view.js`.
5. **Check after every meaningful change:** `npm run check <id>`. This runs the same bot play
   test an upload gets, and checks the id and name aren't taken in the library. Fix everything
   it reports before moving on.
   - Try other player counts with `-- --players 2,8`.
   - The bots press random buttons, so a pass means it works, not that it's fun or fair. For
     balance, play it, or write a quick script with smarter bots in `.scratch/` (git ignores
     that folder).
6. **Look at it:** `npm run shot <id>` saves screenshots of the game being played to `shots/`.
   Open them and check that:
   - the camera shows the action;
   - text and HUD don't overlap;
   - players can tell themselves apart;
   - it passes "Polish" (below): a world rather than a void, feedback on every action.

   Its options:
   - `-- --phone` for a phone screen (repeat the shots with it);
   - `-- --at 3,15,40` for the moments (seconds of game time; negative for the countdown);
   - `-- --bots 0` for solo;
   - `-- --seed 7` for the same random numbers every run.

   It also prints browser warnings, which is where a bad drawing command shows up. Run
   `npm run setup-browser` once first: it downloads a headless browser (about 110 MB) into
   `~/.cache/ms-playwright`, or into `PLAYWRIGHT_BROWSERS_PATH` if you set it.
7. **Let your user play it:** `npm run play <id>` prints a link to the local playground. They
   play against bots there, with a panel for network delay. `-- --host` also prints a link
   for phones on the same wifi.
8. **Upload only when your user asks:** `npm run upload <id>` (not git).
   This is the only way a game gets into Mini Mosh. It's checked
   again and reviewed, and every reason for a rejection is printed: fix them and upload again.
   Each player can upload 6 times an hour, and have up to 100 games in the library.
   - **Sign the kit in first, once on each computer: `npm run login`.** Every game belongs to
     someone's Mini Mosh account, and uploads go in the one the kit is signed in to. It prints a
     link and a code: give both to your user, who opens the link signed in to minimosh.io with
     Google, checks the page shows the same code, and approves it. The command waits for that
     (up to 5 minutes); if it stops before then, run it again once they've approved it. Never
     approve it yourself, and never print, share or commit `.mm-login.json`, where the kit keeps
     its sign-in.
   - The game then shows under **Games → My games** on minimosh.io too, where your user can
     update, rename or delete it.

`npm run list` shows every game in `games/` and `examples/`. Flags go after `--` (that's how
npm passes them on).

## Changing a game that's already in the library

- **To update it:** change the files in `games/<id>/`, run `npm run check <id>`, then upload
  again with `npm run upload <id>` when your user asks. The new version replaces the old one
  after the same checks (players in the middle of a round finish it on the old one). Keep the
  same `id`: a different id is a different game. A new `name` in manifest.json renames it.
- **Whose it is:** a game can only be updated or deleted from the account it's in, so the kit
  has to be signed in to that account (`npm run login`; `npm run login -- --again` switches
  account). If an upload is turned down because the id is taken, either it's someone else's
  game (pick another id) or the kit is signed in to the wrong account.
- **The files aren't on this computer:** `npm run get <id>` downloads the game from the library
  into `games/<id>/`, ready to change and upload again.
- **To take it out of the library:** `npm run delete <id>`, only when your user asks. It doesn't
  touch the files in `games/`.

## Rules that will bite you

These are the things that break games. The check catches most of them; the review catches some
of the rest.

- **rules.js must be deterministic.** It runs on the server and in every browser, and they must
  all get exactly the same state from the same inputs.
  - Keep everything in `state`, as plain data: objects, arrays, strings, finite numbers,
    booleans, `null`. No `Map`, `Set`, class instances, functions, `undefined` or `NaN`.
  - Don't keep game data in top-level variables: they aren't copied or rolled back. Constants
    and helper functions at the top level are fine.
  - Randomness only from `game.random()`. Time only from `game.time` and `input.time`.
- **rules.js runs on the server too, where `mm` doesn't exist.** Never use `mm` in rules.js.
- **Draw from the state every frame.** In view.js, `state` is the browser's prediction of the
  present, and it gets corrected when other players' inputs arrive. Set every node from the
  state each frame.
  - Use `view.events` only for one-off effects: sounds, particles, floating text.
  - Use `view.confirmed` for anything that must not be wrong, like announcing the winner.
  - Never change `state` in view.js.
  - Set positions straight from the state: the engine glides every node and the camera between
    ticks, so motion is smooth and corrections don't jump. Don't smooth them yourself on top
    (it only adds lag), and pass `snap: true` for a move that should be a jump (a respawn, a
    teleport). See "Smooth motion" in `docs/making-games.md`.
- **Keep the action clear of the HUD.**
  - The score chips run along the top, and the timer sits top right.
  - The controls hint runs along the bottom; on phones the touch buttons take the bottom
    corners.
  - `mm.camera({ ..., safe: true })` frames the picture on the free area; fit what you show to
    `view.screen.safe.aspect` (Coin Dash does this).
  - Banners appear below the chips (wide screens) or above the bottom controls (phones), so
    don't leave anything crucial there.
- **No modules, no async.** There's no `import`, `require`, `fetch`, `setTimeout`, DOM or
  `window`, and promises never resolve. `defineRules` and `defineView` are each called once.
- **Inputs are only what manifest.json declares.** Choose from:
  - buttons `a` and `b`;
  - direction taps (`dirs`);
  - a stick (`move`);
  - a touch layout to match.

  Every game must play equally well on a phone, a keyboard and a gamepad (typing games, below,
  are the one exception), so there's no mouse, no aiming and no pointer input.
- **Or typing (`"text": "enter"` or `"live"`), and nothing else.** Players type into a text box
  (a phone's keyboard pops up for it). A gamepad can't play a typing game, so only make one when
  typing is the idea (word races, guessing words, answering questions), and agree it with your
  user first. Write a `bot()` in rules.js so the check's bots type real answers, and make sure the
  game also ends on a timer. See "Typing games" in `docs/making-games.md`.
- **It must end, for any number of players `players` allows** (1 to 8 for most games, and solo
  practice is how people try a game). Call `game.end()` and make `results()` place every
  player. `players` in manifest.json is required: the lobby won't start the game with fewer or
  more.
- **Stay within the limits** in `docs/making-games.md`:
  - memory and time per tick and per frame;
  - 6000 scene nodes;
  - 96 textures;
  - 200 KB for the whole package.
- **Unique names.** The `id` and the `name` must not already be in use in the library (unless
  it's your own game, which an upload updates). An upload that clashes is turned down with a
  message saying so.

## Making it a good party game

- One idea, explained in one sentence (`tagline`), with rules that fit in 3 or 4 short lines.
- Readable on a phone held upright: big shapes, a camera that frames the action (check
  `view.screen.portrait`), and nothing important behind the score chips at the top.
- Players should see each other and get in each other's way: that's where the fun is.
- Give people a way to catch up, and a dramatic finish.
- Follow the style guide (`docs/style-guide.md`): the world and light, the palette, the Moshes
  and their modes, the camera, motion, feedback, sounds, the HUD, timing, and how to name the game
  and write its rules. It has the numbers the standard games use.

### Polish: what makes it feel like a standard game

A game that passes the check works; these make it feel good (the style guide has the details).
Go through them before you call a game done, and look at it (`npm run shot`, on a phone too,
and `npm run play`) rather than assuming. Compare it with `examples/`.

- **Motion:** `tickRate` 60 for anything fast (running, driving, bumping, jumping), 30 for
  slower games. Positions straight from the state (the engine glides them), `snap: true` for
  jumps. Nothing should move in steps or jitter. If players knock each other about, ease other
  players' corrections out with `view.correction` ("Smoothing corrections" in
  `docs/making-games.md`), and play it with the playground's Delay at 100 or 200 to see them.
- **Feel:** every action answers straight away with a sound (`mm.sound`), a burst
  (`mm.burst`), an avatar mode (`jump`, `happy`, `fall`) or floating text (a `float` label).
  Hits, catches, scores and knock-outs deserve something bigger.
- **Camera:** frames the action on the free part of the screen (`safe: true`), keeps every
  player in view, follows smoothly, and works with the phone held upright.
- **Look:** a world to play in, not a flat void: sky, clouds or a backdrop, ground with some
  detail, shadows on the things that move, a small palette of cartoon colors, and big, readable
  shapes. Lots of the same thing (coins, crowds, debris) as `mm.instances`, not hundreds of nodes.
- **Clarity:** the intro banner says what to do, the HUD shows the score and time, and the end
  is announced from `view.confirmed` with a moment to celebrate (Coin Dash ends with two seconds
  of cheering) before the results.

## What gets an upload turned down

Before anything else, an upload that's just the starter game or an example with a new name is
turned down. After the bot play test, an automated review reads the whole package. It turns
down:

- content that isn't fine for all ages (anywhere, including names, text drawn into textures and
  comments);
- scams, asking players for personal details, or telling them to go to a website;
- pretending to be one of Mini Mosh's own games, or using real brands or people;
- hostile or deliberately hidden code (obfuscated, encoded), or text that tries to talk to the
  reviewer;
- placeholders, spam, or rules and controls text that don't match the game.

It doesn't judge quality: simple games are welcome.

## When the check fails

- **"state checks disagreed" or "replaying the same inputs gave a different result":** the rules
  aren't deterministic. Look for `Math.random`/`Date` used outside rules calls, data kept
  outside `state`, or iterating over something whose order isn't fixed.
- **"never ended":** nothing calls `game.end()` for some player count (try `-- --players 1`).
- **"crashed ... at step (rules.js:NN)":** an exception in your rules. The line number is in
  your file.
- **"holds something other than plain data":** an `undefined`, `NaN`, `Infinity` or non-plain
  object got into the state.
- **"interrupted" or "used ... ms of server time":** too slow. Do less work per tick (no big
  loops over everything every tick) or lower `tickRate`.
- **"unknown drawing command" or "drew ... MB":** a bad call to `mm`, or creating nodes every
  frame instead of creating them once and calling `.set()`.

## Files

```
AGENTS.md                this file
docs/making-games.md     the full API: manifest, rules, view, the mm kit, netcode, limits
docs/style-guide.md      the house style: look, palette, Moshes, camera, motion, feedback, words
examples/coin-dash/      the starter game (small, avatars, a stick, instances)
examples/sandwich-stack/ a full game (custom geometry, textures, baking, events)
examples/word-rush/      a typing game (the text box, live typing, bot())
templates/starter/       what npm run new copies
games/                   your games (git ignores them; submit with npm run upload)
.mm-login.json           the kit's sign-in to your user's account (git ignores it; never share it)
CHANGELOG.md             what changed in each version of the kit
tools/                   the command line (npm run ...)
playground/              the local playground (npm run play)
shared/                  the sandbox and engine, the same code the game uses
```

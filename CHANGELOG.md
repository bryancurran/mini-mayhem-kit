# What's new in the creator kit

`npm run update` gets the latest kit and prints what changed since yours. Uploads need the
latest kit: Mini Mosh turns down games packed with an older one, and says how to update.

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

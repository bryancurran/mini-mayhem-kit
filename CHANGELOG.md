# What's new in the creator kit

`npm run update` gets the latest kit and prints what changed since yours. Uploads need the
latest kit: Mini Mosh turns down games packed with an older one, and says how to update.

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

# What's new in the creator kit

`npm run update` gets the latest kit and prints what changed since yours. Uploads need the
latest kit: Mini Mosh turns down games packed with an older one, and says how to update.

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

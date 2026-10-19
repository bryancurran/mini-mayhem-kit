---
name: mini-mosh-game
description: Make, change, test and upload Mini Mosh party minigames (.mm packages) in this repository. Use whenever asked to create a minigame, change one, find out why one fails its check, take screenshots of one, or upload one.
---

# Making a Mini Mosh minigame

1. **Update the kit first, every time:** `npm run update`. It gets the latest kit (tools,
   rules and these instructions) from GitHub and installs it. If there's no `update` script,
   the kit is very old: run `git checkout package-lock.json`, then `git pull`, then
   `npm install`. Uploads need the latest kit.
2. Read `AGENTS.md` (the workflow and the rules that matter) and `docs/making-games.md` (the
   whole API) before writing any code, and again after an update. Skim `examples/coin-dash/`
   (small), `examples/sandwich-stack/` (a full game) and `examples/word-rush/` (typing).
3. Start from the template: `npm run new <id> -- --name "Game Name"`, then edit
   `games/<id>/manifest.json` (including `players`, how many it takes), `rules.js` and `view.js`. To change a game that's already in the
   library, work on its folder in `games/` (or `npm run get <id>` if it isn't on this computer)
   and keep its id.
4. After every change, run `npm run check <id>` and fix everything it reports.
5. Look at it: `npm run shot <id>` (and `npm run shot <id> -- --phone`), then open the PNGs it
   prints. Run `npm run setup-browser` once if it asks for a browser.
6. Ask the user to play it with `npm run play <id>`.
7. Only upload when the user asks: `npm run upload <id>`. That sends the
   game to Mini Mosh's server, into the account the kit is signed in to, or updates it there if
   it's one of that account's games. The first time on a computer, sign the kit in with
   `npm run login`: give the user the link and code it prints, to approve in their browser
   (never approve it yourself), and never show `.mm-login.json`.

Never `git commit`, `git push`, fork or open pull requests in this repository. It's a local
toolkit, games aren't part of it (git ignores `games/`), and `npm run upload` is the only way
to submit a game.

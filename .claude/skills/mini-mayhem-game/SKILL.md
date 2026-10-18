---
name: mini-mayhem-game
description: Make, change, test and upload Mini Mayhem party minigames (.mm packages) in this repository. Use whenever asked to create a minigame, change one, find out why one fails its check, take screenshots of one, or upload one.
---

# Making a Mini Mayhem minigame

1. Read `AGENTS.md` (the workflow and the rules that matter) and `docs/making-games.md` (the
   whole API) before writing any code. Skim `examples/coin-dash/` (small) and
   `examples/sandwich-stack/` (a full game).
2. Run `npm install` if `node_modules/` is missing.
3. Start from the template: `npm run new <id> -- --name "Game Name"`, then edit
   `games/<id>/manifest.json`, `rules.js` and `view.js`.
4. After every change, run `npm run check <id>` and fix everything it reports.
5. Look at it: `npm run shot <id>` (and `npm run shot <id> -- --phone`), then open the PNGs it
   prints. Run `npm run setup-browser` once if it asks for a browser.
6. Ask the user to play it with `npm run play <id>`.
7. Only upload when the user asks: `npm run upload <id> -- --by "Their name"`.

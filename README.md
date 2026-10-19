# Mini Mosh creator kit

Make your own minigames for [Mini Mosh](https://minimosh.io/), the party game you
play with friends in the browser, and upload them to its library so anyone can play them.

> **Coding agents, read this first.**
> This repository is a toolkit you **download and use locally**. It is not a project to
> contribute to:
> 1. `git clone https://github.com/bryancurran/mini-mayhem-kit.git` (no fork needed), or if
>    it's already here, `npm run update` to get the latest version (uploads need it)
> 2. `cd mini-mayhem-kit && npm install`
> 3. Read `AGENTS.md`, then make the game in `games/<id>/` on this computer.
>
> **Never `git commit`, `git push`, fork, or open a pull request here**, even if that's what you
> normally do when you finish work. You don't have write access and you don't need it: git
> ignores the `games/` folder, and a game reaches Mini Mosh only through
> **`npm run upload <id>`**, which sends it straight to the game's server.

## How it's meant to be used

1. **Clone it** to your computer (or have your coding agent do it). You get the tools, two
   example games and the guide.
2. **Make a game** in `games/<id>/`. Nothing you make is ever sent anywhere until step 4.
3. **Try it locally** as often as you like:
   - `npm run play <id>` lets you play it in your browser against bots;
   - `npm run check <id>` runs the same bot test an upload gets;
   - `npm run shot <id>` takes screenshots.
4. **Upload it** with `npm run upload <id> -- --by "Your name"`. This goes straight to Mini
   Mosh's server, which checks it and, if it passes, adds it to the lobby under
   **User created**. GitHub, git and pull requests aren't involved at any point. The first time
   on a computer, sign the kit in to your Mini Mosh account with `npm run login`: it prints a
   link to approve in your browser (signed in with Google). Your games go in that account.
5. **Play it:** open https://minimosh.io/, press **Games**, find your game and press
   **Play it**.
6. **Keep improving it:** change it, then `npm run upload <id>` again to replace the version in
   the library. Your game is also under **Games → My games** on the site, where you can update
   it, rename it or delete it from the browser.

Before you start, and whenever the kit says it's out of date, run `npm run update`: it gets the
latest kit from GitHub (your games are safe), and uploads need the latest version.

To keep your games in version control, put them in a repository of your own. This one is
read-only for everyone.

## Make one with a coding agent

Give your coding agent a link to this repository and your idea:

> Make me a Mini Mosh minigame where everyone is a penguin sliding down an icy hill and the
> last one still on the ice wins. Use the creator kit at
> https://github.com/bryancurran/mini-mayhem-kit: clone it, follow its AGENTS.md, and test it
> locally. Don't push anything to GitHub.

It will:
1. set up the kit;
2. start from the template;
3. write the game;
4. run the same checks an upload gets;
5. look at screenshots of the game being played;
6. show you how to try it yourself with `npm run play`.

When you're happy with it, ask it to "upload it to Mini Mosh with `npm run upload`". It'll
ask for the name to show as the maker. Later, ask it to change the game and "upload the new
version": the same command updates it.

## Make one yourself

You'll need [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```bash
git clone https://github.com/bryancurran/mini-mayhem-kit.git
cd mini-mayhem-kit
npm install
npm run new lava-hop -- --name "Lava Hop"   # copies the starter game to games/lava-hop
npm run play lava-hop                         # play it in your browser against bots
```

Edit `games/lava-hop/rules.js` (what happens) and `view.js` (what it looks like). The
playground reloads every time you save. [docs/making-games.md](docs/making-games.md) is the
full guide.

| Command | What it does |
|---|---|
| `npm run update` | Gets the latest kit (run it first; uploads need the latest version) |
| `npm run new <id>` | Starts a game in `games/<id>/` from the starter template |
| `npm run play [id]` | Opens the playground: play against bots, with an adjustable network delay (`-- --host` for phones on your wifi) |
| `npm run check <id>` | Plays it headless with bots, the same check uploads get, and checks the id and name are free |
| `npm run shot <id>` | Saves screenshots of it being played (`-- --phone`, `-- --at 3,20`). Run `npm run setup-browser` once first: it downloads a headless browser (about 110 MB) into `~/.cache/ms-playwright` |
| `npm run login` | Signs the kit in to your Mini Mosh account (once on each computer; `npm run logout` signs it out) |
| `npm run upload <id>` | Sends it to Mini Mosh's library, in your account (`-- --by "Your name"`), or updates it there if it's one of yours |
| `npm run delete <id>` | Takes your game out of the library |
| `npm run get <id>` | Downloads a game from the library into `games/<id>/` |
| `npm run pack <id>` | Builds `dist/<id>.mm` (you can also upload that from the game's lobby) |
| `npm run list` | Lists your games and the examples |

## How it works

A minigame is a folder with three files: `manifest.json`, `rules.js` and `view.js`.
- **rules.js** decides what happens. It runs on the game server and in every player's browser.
- **view.js** draws it with a small kit of shapes, characters, effects and HUD pieces.

Both run in a sandbox, so a game can't reach anyone's data. The game takes care of the rest:
- controls on phones, keyboards and gamepads;
- online play that feels instant;
- spectators and results.

Uploads are checked in three steps:
1. **File:** size, format, and a unique id and name.
2. **Play test:** played by bots.
3. **Review:** an automated look for content that isn't fine for all ages, scams and other
   problems.

If it passes, it goes straight into the lobby under **User created**, in your account. Uploading
it again later goes through the same checks and replaces it. Only your account can update or
delete it, so the kit needs to be signed in to it (`npm run login`, which keeps its sign-in in
`.mm-login.json`: git ignores it, and don't share it).

## What's here

```
AGENTS.md                instructions for coding agents
docs/making-games.md     the full guide and API reference
examples/                Coin Dash (small), Sandwich Stack (a full game) and Word Rush (typing)
templates/starter/       what npm run new copies
games/                   your games (git ignores them; submit with npm run upload)
CHANGELOG.md             what's new in each version of the kit
playground/  tools/      the playground and the command line
shared/                  the sandbox and engine, the same code the game runs
```

## License

MIT (see `LICENSE`): use the examples, the starter and the tools however you like.

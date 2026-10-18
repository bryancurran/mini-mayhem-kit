# Mini Mayhem creator kit

Make your own minigames for [Mini Mayhem](https://bryancurran.com/party/), the party game you
play with friends in the browser, and upload them to its library so anyone can play them.

> **Coding agents:** clone this repository
> (`git clone https://github.com/bryancurran/mini-mayhem-kit.git`), run `npm install` in it,
> then read `AGENTS.md` before writing any code. It explains everything you need.

## Make one with a coding agent

Give your coding agent a link to this repository and your idea:

> Make me a Mini Mayhem minigame where everyone is a penguin sliding down an icy hill and the
> last one still on the ice wins. Use the creator kit at
> https://github.com/bryancurran/mini-mayhem-kit and follow its AGENTS.md.

It will:
1. set up the kit;
2. start from the template;
3. write the game;
4. run the same checks an upload gets;
5. look at screenshots of the game being played;
6. show you how to try it yourself.

When you're happy with it, ask it to upload it.

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
| `npm run new <id>` | Starts a game in `games/<id>/` from the starter template |
| `npm run play [id]` | Opens the playground: play against bots, with an adjustable network delay (`-- --host` for phones on your wifi) |
| `npm run check <id>` | Plays it headless with bots, the same check uploads get, and checks the id and name are free |
| `npm run shot <id>` | Saves screenshots of it being played (`-- --phone`, `-- --at 3,20`). Run `npm run setup-browser` once first: it downloads a headless browser (about 110 MB) into `~/.cache/ms-playwright` |
| `npm run upload <id>` | Sends it to Mini Mayhem's library (`-- --by "Your name"`) |
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

If it passes, it goes straight into the lobby under **User created**.

## What's here

```
AGENTS.md                instructions for coding agents
docs/making-games.md     the full guide and API reference
examples/                Coin Dash (small) and Sandwich Stack (a full game)
templates/starter/       what npm run new copies
games/                   your games
playground/  tools/      the playground and the command line
shared/                  the sandbox and engine, the same code the game runs
```

## License

MIT (see `LICENSE`): use the examples, the starter and the tools however you like.

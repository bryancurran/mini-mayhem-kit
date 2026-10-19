#!/usr/bin/env node
// The Mini Mosh creator kit's command line. Run through npm:
//
//   npm run update                           get the latest kit (do this first, every time)
//   npm run new <id> [-- --name "Name"]     start a game in games/<id> from the starter template
//   npm run check <id>                       play it headless with bots: the same check uploads get
//   npm run play [id] [-- --bots 3 --lag 100 --host]   play it in your browser against bots
//   npm run shot <id> [-- --at 3,15,30 --phone --bots 3 --seed 7 --out dir]   screenshots of it
//                                            being played (--at -2 catches the countdown)
//   npm run pack <id>                        build dist/<id>.mm
//   npm run upload <id> [-- --by "Your name" --key <key>]   send it to Mini Mosh's library, or
//                                            update it there if you uploaded it before
//   npm run delete <id>                      take your game out of Mini Mosh's library
//   npm run get <id>                         download a game from the library into games/<id>
//   (check, upload, delete and get also take -- --server <url> to use another Mini Mosh server)
//   npm run list                             every game in games/ and examples/
//
// <id> is a folder in games/ or examples/, or a path to a game folder or a .mm file.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MM } from '../shared/mm/format.js';
import { ROOT, findGame, listGames, loadGame } from './games.mjs';

const SERVER = process.env.MM_SERVER || 'https://minimosh.io/';
const KIT_REPO = 'https://github.com/bryancurran/mini-mayhem-kit';
const COLORS = ['#ff5c8a', '#3d8bff', '#2fbf55', '#ff8f2e', '#a65bff', '#2ed9d9', '#ffb52e', '#e04cf0'];
const [command, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    flags[key] = next === undefined || next.startsWith('--') ? true : (i++, next);
  } else args.push(rest[i]);
}

// ---- the server and the kit's version ------------------------------------------------------

const server = () => new URL(typeof flags.server === 'string' ? flags.server : SERVER).href;

let catalog = null;
// The server's catalog (its games, and the latest kit version), or null if it can't be reached.
function fetchCatalog() {
  catalog ??= fetch(new URL('mm/catalog.json', server()), { signal: AbortSignal.timeout(4000) })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return catalog;
}

// Uploads need the latest kit (the server turns older ones down), so when this one is behind:
// a warning, or with required (uploading) a stop.
async function checkKitVersion({ required = false } = {}) {
  const latest = (await fetchCatalog())?.kit?.version;
  if (!Number.isInteger(latest) || latest <= MM.kitVersion) return;
  const message = `This creator kit is out of date: it's v${MM.kitVersion} and the latest is v${latest}. Run npm run update, then carry on.`;
  if (required) throw new Error(`${message} (Uploads need the latest kit.)`);
  console.log(`! ${message}\n`);
}

// ---- keys for the games you've uploaded ---------------------------------------------------

// The server hands the kit a key for each game it uploads, which lets this computer update or
// delete it later. Kept in .mm-keys.json (git ignores it): { "<server>": { "<id>": "<key>" } }.
const KEYS_FILE = path.join(ROOT, '.mm-keys.json');
const keys = {
  read() {
    try {
      return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    } catch {
      return {};
    }
  },
  get(id) {
    return this.read()[server()]?.[id] ?? null;
  },
  set(id, key) {
    const all = this.read();
    (all[server()] ??= {})[id] = key;
    this.write(all);
  },
  forget(id) {
    const all = this.read();
    delete all[server()]?.[id];
    this.write(all);
  },
  write(all) {
    fs.writeFileSync(KEYS_FILE, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  },
};

const commands = { update, new: create, check, play, shot, pack, upload, delete: remove, get, list };
if (!commands[command]) {
  const lines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  const usage = lines.slice(1, lines.findIndex((l, i) => i > 0 && !l.startsWith('//')));
  console.log(usage.map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 1 : 0);
}
try {
  // Everything that leads to an upload says when the kit is behind; an upload won't go without it.
  if (['new', 'check', 'pack'].includes(command)) await checkKitVersion();
  await commands[command]();
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

// ---- update -----------------------------------------------------------------------------------

// Pulls the latest kit from GitHub and installs what it needs. Your games are safe: git ignores
// games/, and the keys for the games you've uploaded (.mm-keys.json).
async function update() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    throw new Error(`This kit wasn't cloned with git, so it can't update itself. Clone it again from ${KIT_REPO} and move your games/ folder (and .mm-keys.json, if you have one) across.`);
  }
  const before = MM.kitVersion;
  console.log('Getting the latest creator kit…');
  // npm install rewrites package-lock.json now and then; it's made from package.json, so the
  // kit's own copy goes back first (or git would refuse to pull over it).
  spawnSync('git', ['checkout', '--', 'package-lock.json'], { cwd: ROOT, stdio: 'ignore' });
  const git = spawnSync('git', ['pull', '--ff-only'], { cwd: ROOT, stdio: 'inherit' });
  if (git.status !== 0) {
    throw new Error(
      'git couldn’t update the kit (see above). If it lists files that would be overwritten, those are kit files changed on this computer: put them back with git checkout -- <file> if the changes weren’t meant to be kept (your games are safe, git ignores games/), then run npm run update again.',
    );
  }
  const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (npm.status !== 0) throw new Error('npm install didn’t work (see above). Fix that, then run npm run update again.');
  // This process still has the old code loaded: read the new version afresh.
  const { MM: now } = await import(`${new URL('../shared/mm/format.js', import.meta.url)}?v=${Date.now()}`);
  if (now.kitVersion === before) return console.log(`✓ The kit is up to date (v${now.kitVersion}).`);
  console.log(`\n✓ Updated the kit from v${before} to v${now.kitVersion}. What's new:`);
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  for (const section of changelog.split(/^## /m).slice(1)) {
    const v = Number(section.match(/^v(\d+)/)?.[1]);
    if (v > before) console.log(`\n## ${section.trim()}`);
  }
  console.log('\nRead AGENTS.md again if you\'re a coding agent: the instructions may have changed.');
}

// ---- new ---------------------------------------------------------------------------------

async function create() {
  const id = args[0];
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id ?? '')) throw new Error('Give the new game an id: lowercase letters, digits and dashes, starting with a letter (e.g. npm run new lava-hop)');
  const dir = path.join(ROOT, 'games', id);
  if (fs.existsSync(dir)) throw new Error(`games/${id} already exists`);
  fs.cpSync(path.join(ROOT, 'templates', 'starter'), dir, { recursive: true });
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.id = id;
  manifest.name = typeof flags.name === 'string' ? flags.name.slice(0, 32) : id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  manifest.color = COLORS[Math.floor(Math.random() * COLORS.length)];
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Made games/${id} from the starter game (Coin Dash). Next:
  npm run check ${id}    make sure it works
  npm run play ${id}     try it in your browser
Then make it your own: games/${id}/manifest.json, rules.js and view.js (see docs/making-games.md).`);
}

// ---- check -------------------------------------------------------------------------------

async function check() {
  const { found, text, pkg } = loadGame(args[0]);
  const m = pkg.manifest;
  if (text.length > MM.maxUploadBytes) throw new Error(`The package is ${Math.ceil(text.length / 1024)} KB; uploads can be at most ${MM.maxUploadBytes / 1024} KB.`);
  const { runtime } = await import('./runtime.mjs');
  const { playtest } = await import('../shared/mm/playtest.js');
  const players = typeof flags.players === 'string' ? flags.players.split(',').map(Number) : [3, 1];
  console.log(`${m.name} (${m.id}) from ${path.relative(ROOT, found.dir ?? found.file)}: ${(text.length / 1024).toFixed(1)} KB`);
  console.log(`Playing ${players.map((n) => `${n} player${n > 1 ? 's' : ''}`).join(', then ')} with bots…`);
  const report = playtest(pkg, { runtime, players, maxSeconds: 300, clientMemory: 48 * 1024 * 1024, log: console });
  for (const g of report.games) {
    console.log(`  ${g.players} player${g.players > 1 ? 's' : ''}: ended after ${g.endedAt.toFixed(1)}s of game time, ${g.inputs} inputs, places ${g.results.map((r) => `${r.id}:${r.place}`).join(' ')}`);
  }
  const s = report.stats;
  console.log(`  server tick ${s.serverMsAvg.toFixed(3)} ms (worst ${s.serverMsWorst.toFixed(1)}), browser frame ${s.frameMsAvg.toFixed(2)} ms in the sandbox (worst ${s.frameMsWorst.toFixed(1)}), ${s.commandsPerFrame.toFixed(0)} drawing commands a frame, ${s.checks} sync checks`);
  if (report.problems.length) {
    for (const p of report.problems) console.log(`✗ ${p}`);
    process.exit(1);
  }
  console.log('✓ Passed. (Uploads get this same play test, then a review.)');
  await checkNameOnline(m);
  const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
  const starter = (f) => fs.readFileSync(path.join(ROOT, 'templates', 'starter', f), 'utf8');
  if (same(pkg.files['rules.js'], starter('rules.js')) && same(pkg.files['view.js'], starter('view.js'))) {
    console.log('! This is still the starter game: an upload would be turned down until you make it your own.');
  }
}

// Whether the id or name is already used in the library (an upload would be turned down), unless
// it's this computer's own game, which an upload updates. Quietly skipped when the library can't
// be reached.
async function checkNameOnline(m) {
  const data = await fetchCatalog();
  if (!data) return console.log('(Couldn’t reach the library to check whether the id and name are free; the upload will tell you.)');
  const all = [...(data.games ?? []), ...(data.reserved ?? [])];
  const sameId = all.find((g) => g.id === m.id);
  const sameName = all.find((g) => g.name.trim().toLowerCase() === m.name.trim().toLowerCase());
  const host = new URL(server()).host;
  if (sameId && keys.get(m.id)) {
    console.log(`✓ You uploaded this game before (the kit has its key): npm run upload ${m.id} updates it on ${host}.`);
    if (sameName && sameName.id !== m.id) console.log(`! The name "${m.name}" is used by another game in the library: change "name" in manifest.json before uploading.`);
    return;
  }
  if (sameId) console.log(`! The id "${m.id}" is already used in the library ("${sameId.name}"): change "id" in manifest.json before uploading. (If it's your game, see "Updating a game" in docs/making-games.md.)`);
  if (sameName && sameName !== sameId) console.log(`! The name "${m.name}" is already used in the library: change "name" in manifest.json before uploading.`);
  if (!sameId && !sameName) console.log(`✓ The id and name are free in the library (${host}).`);
}

// ---- play --------------------------------------------------------------------------------

async function play() {
  if (args[0]) findGame(args[0]);
  const { startPlayground } = await import('./playground.mjs');
  const server = await startPlayground({ port: Number(flags.port ?? 5173), host: flags.host === true });
  const query = new URLSearchParams();
  if (args[0]) query.set('game', args[0]);
  if (flags.bots !== undefined) query.set('bots', flags.bots);
  if (flags.lag !== undefined) query.set('lag', flags.lag);
  const q = query.toString() ? `?${query}` : '';
  console.log('Playground running. Open:');
  for (const url of [...server.resolvedUrls.local, ...server.resolvedUrls.network]) console.log(`  ${url}${q}`);
  console.log('It reloads when you save a game file. Ctrl+C to stop.');
}

// ---- shot --------------------------------------------------------------------------------

async function shot() {
  const id = args[0];
  findGame(id);
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('Screenshots need a browser: run npm run setup-browser once, then try again.');
  }
  const times = (typeof flags.at === 'string' ? flags.at : '2,10,25').split(',').map(Number).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const outDir = path.resolve(typeof flags.out === 'string' ? flags.out : path.join(ROOT, 'shots'));
  fs.mkdirSync(outDir, { recursive: true });
  const { startPlayground } = await import('./playground.mjs');
  const server = await startPlayground({ port: 5199, quiet: true });
  let browser;
  try {
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  } catch (e) {
    await server.close();
    throw new Error(`Couldn't start the browser (${e.message.split('\n')[0]}). Run npm run setup-browser once, then try again.`);
  }
  const viewport = flags.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } };
  const page = await (await browser.newContext(viewport)).newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (msg) => (msg.type() === 'error' || msg.type() === 'warning') && consoleErrors.push(msg.text()));
  const url = `${server.resolvedUrls.local[0]}?game=${encodeURIComponent(id)}&bots=${flags.bots ?? 3}${flags.seed !== undefined ? `&seed=${flags.seed}` : ''}&autoplay`;
  const saved = [];
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__playground?.ready || document.querySelector('.pg-error'), null, { timeout: 30000 });
    const startError = await page.evaluate(() => document.querySelector('.pg-error')?.textContent);
    if (startError) throw new Error(`The game didn't start:\n${startError}`);
    for (const t of times) {
      await page.waitForFunction((at) => window.__playground.time() >= at || window.__playground.results, t, { timeout: (Math.abs(t) + 30) * 1000 });
      if (await page.evaluate((at) => window.__playground.results && window.__playground.time() < at, t)) {
        const ended = await page.evaluate(() => window.__playground.endedAt);
        console.log(`(the game ended after ${ended.toFixed(1)}s, so there's no screenshot at ${times.filter((x) => x >= t).join('s, ')}s)`);
        break;
      }
      const file = path.join(outDir, `${id}${flags.phone ? '-phone' : ''}-${t}s.png`);
      await page.screenshot({ path: file });
      saved.push(file);
    }
    const info = await page.evaluate(() => {
      const s = window.__playground.view?.stats;
      return { results: window.__playground.results, sandbox: s && s.frames ? s.sandboxMs / s.frames : null, desyncs: s?.desyncs, failed: window.__playground.view?.failed };
    });
    for (const f of saved) console.log(`saved ${path.relative(process.cwd(), f)}`);
    if (info.sandbox !== null) console.log(`sandbox ${info.sandbox.toFixed(2)} ms a frame${info.desyncs ? `, OUT OF SYNC ${info.desyncs} times` : ''}`);
    if (info.failed) console.log('✗ the game stopped with an error (see below)');
    if (info.results) console.log(`finished: ${info.results.map((r) => `${r.id}:${r.place}`).join(' ')}`);
    if (consoleErrors.length) {
      console.log('Browser console errors and warnings:');
      for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log(`  ${e.slice(0, 400)}`);
    } else console.log('no browser console errors');
  } finally {
    await browser.close();
    await server.close();
  }
}

// ---- pack --------------------------------------------------------------------------------

async function pack() {
  const { text, pkg } = loadGame(args[0]);
  const out = path.join(ROOT, 'dist', `${pkg.manifest.id}.mm`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`packed ${path.relative(process.cwd(), out)} (${(text.length / 1024).toFixed(1)} KB${text.length > MM.maxUploadBytes ? `, over the ${MM.maxUploadBytes / 1024} KB upload limit` : ''})`);
}

// ---- upload ------------------------------------------------------------------------------

async function upload() {
  const { text, pkg } = loadGame(args[0]);
  const { id, name } = pkg.manifest;
  await checkKitVersion({ required: true });
  if (pkg.kit < MM.kitVersion) throw new Error(`${path.basename(args[0])} was packed with an older kit (v${pkg.kit}). Upload the game's folder instead, or pack it again with npm run pack.`);
  const target = new URL('mm/upload', server());
  if (typeof flags.by === 'string') target.searchParams.set('by', flags.by.slice(0, 16));
  const key = typeof flags.key === 'string' ? flags.key.trim() : keys.get(id);
  console.log(`Uploading ${name} (${id}) to ${target.origin}${target.pathname.replace(/mm\/upload$/, '')}${key ? ' (an update, if it\'s in the library)' : ''}…`);
  const headers = { 'Content-Type': 'application/octet-stream', 'X-MM-Kit': String(MM.kitVersion), ...(key ? { 'X-MM-Key': key } : {}) };
  const res = await fetch(target, { method: 'POST', body: text, headers });
  const labels = { queued: 'Waiting for other uploads', file: 'Checking the file', playtest: 'Play-testing with bots', review: 'Safety review' };
  const decoder = new TextDecoder();
  let buffered = '';
  let accepted = null;
  for await (const chunk of res.body) {
    buffered += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.stage && msg.state === 'running') console.log(`… ${labels[msg.stage] ?? msg.stage}`);
      if (msg.stage && msg.state === 'ok') console.log(`✓ ${labels[msg.stage] ?? msg.stage}${msg.detail ? ` (${msg.detail})` : ''}`);
      if (msg.stage && msg.state === 'failed') console.log(`✗ ${labels[msg.stage] ?? msg.stage}`);
      if (msg.done) {
        accepted = msg.accepted;
        if (msg.accepted) {
          if (msg.key) keys.set(id, msg.key);
          else if (key) keys.set(id, key); // a key given with --key worked: keep it
          if (msg.updated) console.log(`✓ ${msg.name} is updated in Mini Mosh's library. Games from now on use this version.`);
          else {
            console.log(`✓ ${msg.name} is in Mini Mosh's library: open a lobby and look under User created.`);
            if (msg.key) {
              console.log(`\nTo look after it in your browser (update, rename or delete it under Games → My games), open this link once:`);
              console.log(`  ${new URL(`#claim=${encodeURIComponent(id)}.${msg.key}`, server()).href}`);
              console.log(`The kit keeps this game's key in .mm-keys.json, so npm run upload ${id} updates it from now on. Don't share the link or the key: they let anyone change the game.`);
            }
          }
        } else {
          for (const r of msg.reasons ?? []) console.log(`  - ${r}`);
          if ((msg.reasons ?? []).some((r) => r.includes('already a game with the id'))) {
            console.log(
              key
                ? `  The kit's key for "${id}" didn't work (it may have been replaced in the browser). Get a new one under Games → My games → ${name} → Update it from the creator kit, then upload with -- --key <key>.`
                : `  If it's your game, get its key under Games → My games → ${name} → Update it from the creator kit, then upload with -- --key <key>. Otherwise pick another id.`,
            );
          }
        }
      }
    }
  }
  if (accepted === null) throw new Error(`No answer from the server (HTTP ${res.status}).`);
  if (!accepted) process.exit(1);
}

// ---- delete ------------------------------------------------------------------------------

async function remove() {
  if (!args[0]) throw new Error('Which game? npm run delete <id>');
  let id = args[0];
  try {
    id = loadGame(args[0]).pkg.manifest.id;
  } catch {
    // Not on this computer any more: the id as given.
  }
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw new Error(`"${id}" isn't a game id (lowercase letters, digits and dashes).`);
  const key = typeof flags.key === 'string' ? flags.key.trim() : keys.get(id);
  const host = new URL(server()).host;
  if (!key) throw new Error(`The kit has no key for "${id}" on ${host}, so it can't delete it from here. Delete it in the browser instead: Games → My games.`);
  const res = await fetch(new URL(`mm/${encodeURIComponent(id)}/delete`, server()), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MM-Key': key }, body: '{}' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.deleted) throw new Error(data.error ?? `The server answered ${res.status}.`);
  keys.forget(id);
  console.log(`✓ Deleted "${id}" from Mini Mosh's library (${host}). Your files in games/ are untouched.`);
}

// ---- get ---------------------------------------------------------------------------------

// A game from the library, unpacked into games/<id> to work on (your own, to change and upload
// again, or anyone's, to learn from).
async function get() {
  const id = args[0];
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id ?? '')) throw new Error('Which game? Give its id, e.g. npm run get lava-hop (the id is the last part of its address in the lobby list).');
  const dir = path.join(ROOT, 'games', id);
  if (fs.existsSync(dir) && !flags.force) throw new Error(`games/${id} already exists. Move it out of the way first (or add -- --force to overwrite it).`);
  const res = await fetch(new URL(`mm/${id}.mm`, server()), { signal: AbortSignal.timeout(15000) });
  if (res.status === 404) throw new Error(`There's no game "${id}" in the library on ${new URL(server()).host}.`);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const { parsePackage } = await import('../shared/mm/format.js');
  const pkg = parsePackage(await res.text());
  const { mm, ...manifest } = pkg.manifest;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of ['rules.js', 'view.js']) fs.writeFileSync(path.join(dir, f), pkg.files[f]);
  console.log(`✓ Downloaded ${manifest.name} into games/${id}.`);
  console.log(keys.get(id) ? `  The kit has its key: npm run upload ${id} updates it.` : `  To update it in the library you need its key: see "Changing a game that's already in the library" in AGENTS.md.`);
}

// ---- list --------------------------------------------------------------------------------

async function list() {
  const games = listGames();
  if (!games.length) return console.log('No games yet. Start one: npm run new my-game');
  for (const g of games) console.log(`${`${g.folder}/${g.dir}`.padEnd(30)} ${g.name ?? ''}${g.error ? `  (${g.error})` : ''}`);
}

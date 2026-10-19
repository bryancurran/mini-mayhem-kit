#!/usr/bin/env node
// The Mini Mosh creator kit's command line. Run through npm:
//
//   npm run new <id> [-- --name "Name"]     start a game in games/<id> from the starter template
//   npm run check <id>                       play it headless with bots: the same check uploads get
//   npm run play [id] [-- --bots 3 --lag 100 --host]   play it in your browser against bots
//   npm run shot <id> [-- --at 3,15,30 --phone --bots 3 --seed 7 --out dir]   screenshots of it
//                                            being played (--at -2 catches the countdown)
//   npm run pack <id>                        build dist/<id>.mm
//   npm run upload <id> [-- --by "Your name"]           send it to Mini Mosh's library
//   (check and upload also take -- --server <url> to use another Mini Mosh server)
//   npm run list                             every game in games/ and examples/
//
// <id> is a folder in games/ or examples/, or a path to a game folder or a .mm file.

import fs from 'node:fs';
import path from 'node:path';
import { MM } from '../shared/mm/format.js';
import { ROOT, findGame, listGames, loadGame } from './games.mjs';

const SERVER = process.env.MM_SERVER || 'https://minimosh.io/';
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

const commands = { new: create, check, play, shot, pack, upload, list };
if (!commands[command]) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 1 : 0);
}
try {
  await commands[command]();
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
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

// Whether the id or name is already used in the library (an upload would be turned down).
// Quietly skipped when the library can't be reached.
async function checkNameOnline(m) {
  try {
    const url = new URL('mm/catalog.json', typeof flags.server === 'string' ? flags.server : SERVER);
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    const all = [...(data.games ?? []), ...(data.reserved ?? [])];
    const sameId = all.find((g) => g.id === m.id);
    const sameName = all.find((g) => g.name.trim().toLowerCase() === m.name.trim().toLowerCase());
    if (sameId) console.log(`! The id "${m.id}" is already used in the library ("${sameId.name}"): change "id" in manifest.json before uploading.`);
    if (sameName && sameName !== sameId) console.log(`! The name "${m.name}" is already used in the library: change "name" in manifest.json before uploading.`);
    if (!sameId && !sameName) console.log(`✓ The id and name are free in the library (${url.host}).`);
  } catch {
    console.log('(Couldn’t reach the library to check whether the id and name are free; the upload will tell you.)');
  }
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
  const target = new URL('mm/upload', typeof flags.server === 'string' ? flags.server : SERVER);
  if (typeof flags.by === 'string') target.searchParams.set('by', flags.by.slice(0, 16));
  console.log(`Uploading ${pkg.manifest.name} (${pkg.manifest.id}) to ${target.origin}${target.pathname.replace(/mm\/upload$/, '')}…`);
  const res = await fetch(target, { method: 'POST', body: text, headers: { 'Content-Type': 'application/octet-stream' } });
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
        if (msg.accepted) console.log(`✓ ${msg.name} is in Mini Mosh's library: open a lobby and look under User created.`);
        else for (const r of msg.reasons ?? []) console.log(`  - ${r}`);
      }
    }
  }
  if (accepted === null) throw new Error(`No answer from the server (HTTP ${res.status}).`);
  if (!accepted) process.exit(1);
}

// ---- list --------------------------------------------------------------------------------

async function list() {
  const games = listGames();
  if (!games.length) return console.log('No games yet. Start one: npm run new my-game');
  for (const g of games) console.log(`${`${g.folder}/${g.dir}`.padEnd(30)} ${g.name ?? ''}${g.error ? `  (${g.error})` : ''}`);
}

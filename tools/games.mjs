import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPackage, parsePackage } from '../shared/mm/format.js';

// Finding and packing games: your own in games/, and the examples in examples/.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FOLDERS = ['games', 'examples'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// A game folder from an id (games/<id> or examples/<id>, by folder name or manifest id), a
// path to a folder, or a path to a .mm file. Returns { dir } or { file }.
export function findGame(arg) {
  if (!arg) throw new Error('Which game? Give its folder name, e.g. npm run check my-game');
  const asPath = path.resolve(arg);
  if (arg.endsWith('.mm') && fs.existsSync(asPath)) return { file: asPath };
  if (fs.existsSync(path.join(asPath, 'manifest.json'))) return { dir: asPath };
  for (const folder of FOLDERS) {
    const dir = path.join(ROOT, folder, arg);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return { dir };
  }
  for (const g of listGames()) if (g.id === arg) return { dir: g.path };
  throw new Error(`No game "${arg}" in games/ or examples/ (npm run list shows them all).`);
}

// The .mm text for a game. Throws with every problem found.
export function packGame(found) {
  if (found.file) return fs.readFileSync(found.file, 'utf8');
  const missing = ['manifest.json', 'rules.js', 'view.js'].filter((f) => !fs.existsSync(path.join(found.dir, f)));
  if (missing.length) throw new Error(`${path.relative(ROOT, found.dir)} is missing ${missing.join(', ')}`);
  let manifest;
  try {
    manifest = readJson(path.join(found.dir, 'manifest.json'));
  } catch (e) {
    throw new Error(`manifest.json isn't valid JSON: ${e.message}`);
  }
  const read = (f) => fs.readFileSync(path.join(found.dir, f), 'utf8');
  return packPackage(manifest, { 'rules.js': read('rules.js'), 'view.js': read('view.js') });
}

export function loadGame(arg) {
  const found = findGame(arg);
  const text = packGame(found);
  return { found, text, pkg: parsePackage(text) };
}

// Every game in games/ and examples/: { id, name, folder, dir, path, error? }.
export function listGames() {
  const out = [];
  for (const folder of FOLDERS) {
    const base = path.join(ROOT, folder);
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base).sort()) {
      const full = path.join(base, dir);
      if (!fs.existsSync(path.join(full, 'manifest.json'))) continue;
      const entry = { id: dir, folder, dir, path: full };
      try {
        const m = readJson(path.join(full, 'manifest.json'));
        entry.id = m.id ?? dir;
        entry.name = m.name;
      } catch (e) {
        entry.error = `manifest.json: ${e.message}`;
      }
      out.push(entry);
    }
  }
  return out;
}

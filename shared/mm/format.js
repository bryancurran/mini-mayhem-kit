// The .mm package format: a minigame as data plus sandboxed code. A package is one JSON file:
//
//   { "mm": 1, "kit": 4, "manifest": { ... }, "files": { "rules.js": "...", "view.js": "..." } }
//
// "kit" is the version of the creator kit that packed it (MM.kitVersion): uploads packed with an
// older kit than the server's are turned down, so everyone uploads with the latest rules and tools.
//
// rules.js runs on the server and on every client (it decides what happens); view.js runs only
// in the browser (it draws). Both run inside a QuickJS sandbox with no access to the page, the
// network or the server, and talk to the game engine only through the API in docs/making-games.md.

export const MM = {
  version: 1,
  kitVersion: 4, // bump whenever the kit changes in a way uploads should wait for (see the kit's CHANGELOG.md)
  netDelay: 300, // ms the server waits before a tick is final (later inputs move to the next tick)
  futureSlack: 300, // ms ahead of the server's clock an input may be stamped
  sendRate: 10, // snapshots per second (inputs are also passed on the moment they arrive)
  hashEvery: 2, // seconds between checks that every client agrees with the server
  maxInputsPerSecond: 60, // presses and releases both count
  maxTextLength: 100, // characters in a typing game's text box
  maxPlayers: 8, // in a room (MAX_PLAYERS in shared/constants.js)
  maxFileBytes: 256 * 1024,
  maxPackageBytes: 1024 * 1024,
  maxUploadBytes: 200 * 1024, // packages players upload are held to less
  uploadsPerHour: 6, // per player (by address)
  maxGameSeconds: 15 * 60, // a game that never ends is stopped after this long
  memory: { server: 32 * 1024 * 1024, client: 64 * 1024 * 1024 },
  deadline: { setup: 2000, tick: 50, frame: 250 }, // ms a single call into the sandbox may take
  serverCpuPerSecond: 100, // ms of server time a game may use per second, on average
  clientCpuShare: 0.7, // share of a browser's time a game may take, over a few seconds
  maxStateBytes: 256 * 1024, // the state (as JSON) sent to late joiners
  maxFrameBytes: 4 * 1024 * 1024, // drawing commands (as JSON) in one frame
};

const ID = /^[a-z][a-z0-9-]{1,30}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const TOUCH_LAYOUTS = ['tap', 'stick', 'hold', 'sides', 'swipe', 'none'];
const TEXT_MODES = ['enter', 'live'];
// What players can play on: a computer (keyboard), a phone (touch) or a gamepad. Typing games
// need a keyboard, so a gamepad can't play them.
export const PLATFORMS = ['pc', 'mobile', 'gamepad'];
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const FILES = ['rules.js', 'view.js'];

function text(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

// Checks a manifest and fills in defaults. Returns { manifest, errors }.
export function checkManifest(raw) {
  const errors = [];
  const m = raw && typeof raw === 'object' ? raw : {};
  if (!ID.test(m.id ?? '')) errors.push('id: lowercase letters, digits and dashes, 2-31 characters, starting with a letter');
  if (!text(m.name, 32)) errors.push('name: 1-32 characters');
  if (!COLOR.test(m.color ?? '')) errors.push('color: a hex color like "#ffb52e"');
  if (!text(m.tagline, 90)) errors.push('tagline: 1-90 characters');
  if (!Array.isArray(m.rules) || m.rules.length < 1 || m.rules.length > 6 || !m.rules.every((r) => text(r, 200))) {
    errors.push('rules: 1-6 lines of up to 200 characters');
  }
  // A typing game (input.text) takes nothing but typing, so it has no gamepad controls.
  const typing = m.input?.text !== undefined && m.input?.text !== false;
  const c = m.controls ?? {};
  for (const k of typing ? ['keyboard', 'touch'] : ['keyboard', 'touch', 'gamepad']) if (!text(c[k], 90)) errors.push(`controls.${k}: 1-90 characters`);
  if (m.intro !== undefined && !text(m.intro, 90)) errors.push('intro: up to 90 characters');

  const tickRate = m.tickRate ?? 30;
  if (!Number.isInteger(tickRate) || tickRate < 10 || tickRate > 60) errors.push('tickRate: a whole number from 10 to 60');
  const countdown = m.countdown ?? 3;
  if (!Number.isInteger(countdown) || countdown < 0 || countdown > 5) errors.push('countdown: 0-5 seconds');
  // The fewest and most players it takes. Games uploaded since kit v4 all say; older ones take 1-8.
  const players = m.players;
  if (players !== undefined) {
    const ok = (n) => Number.isInteger(n) && n >= 1 && n <= MM.maxPlayers;
    if (!players || typeof players !== 'object' || !ok(players.min) || !ok(players.max) || players.min > players.max) {
      errors.push(`players: { "min": fewest, "max": most }, whole numbers from 1 to ${MM.maxPlayers}, min no more than max`);
    }
  }

  const input = { buttons: typing ? [] : ['a'], dirs: false, move: false, touch: typing ? 'none' : 'tap', text: false, maxLength: MM.maxTextLength, ...(m.input ?? {}) };
  if (!Array.isArray(input.buttons) || !input.buttons.every((b) => b === 'a' || b === 'b') || new Set(input.buttons).size !== input.buttons.length) {
    errors.push('input.buttons: any of "a", "b"');
  }
  if (typeof input.dirs !== 'boolean') errors.push('input.dirs: true or false');
  if (typeof input.move !== 'boolean') errors.push('input.move: true or false');
  if (!TOUCH_LAYOUTS.includes(input.touch)) errors.push(`input.touch: one of ${TOUCH_LAYOUTS.join(', ')}`);
  if (input.touchLabel !== undefined && !text(input.touchLabel, 12)) errors.push('input.touchLabel: up to 12 characters');
  if (input.text !== false && !TEXT_MODES.includes(input.text)) errors.push('input.text: false, "enter" or "live"');
  if (typing) {
    if (input.buttons?.length || input.dirs || input.move || input.touch !== 'none') {
      errors.push('input.text: a typing game takes only typing (no buttons, dirs or move, and touch "none")');
    }
    if (!Number.isInteger(input.maxLength) || input.maxLength < 1 || input.maxLength > MM.maxTextLength) errors.push(`input.maxLength: 1-${MM.maxTextLength} characters`);
  }

  const manifest = {
    mm: MM.version,
    id: m.id,
    name: m.name,
    color: m.color,
    tagline: m.tagline,
    rules: m.rules,
    controls: { keyboard: c.keyboard, touch: c.touch, ...(typing ? {} : { gamepad: c.gamepad }) },
    ...(m.intro ? { intro: m.intro } : {}),
    tickRate,
    countdown,
    ...(players !== undefined ? { players: { min: players?.min, max: players?.max } } : {}),
    input: {
      buttons: input.buttons,
      dirs: input.dirs,
      move: input.move,
      touch: input.touch,
      ...(input.touchLabel ? { touchLabel: input.touchLabel } : {}),
      ...(typing ? { text: input.text, maxLength: input.maxLength } : {}),
    },
  };
  return { manifest, errors };
}

// Builds the text of a .mm file. Throws if anything is invalid.
export function packPackage(manifest, files) {
  const { manifest: clean, errors } = checkManifest(manifest);
  for (const name of FILES) {
    if (typeof files[name] !== 'string') errors.push(`missing ${name}`);
    else if (files[name].length > MM.maxFileBytes) errors.push(`${name} is over ${MM.maxFileBytes / 1024} KB`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const out = JSON.stringify({ mm: MM.version, kit: MM.kitVersion, manifest: clean, files: Object.fromEntries(FILES.map((f) => [f, files[f]])) });
  if (out.length > MM.maxPackageBytes) throw new Error(`package is over ${MM.maxPackageBytes / 1024} KB`);
  return out;
}

// Reads the text of a .mm file. Throws if anything is invalid. kit is 0 for packages made before
// the kit had versions.
export function parsePackage(textContent) {
  if (typeof textContent !== 'string' || textContent.length > MM.maxPackageBytes) throw new Error('package too large');
  const pkg = JSON.parse(textContent);
  if (pkg?.mm !== MM.version) throw new Error(`unsupported package version ${pkg?.mm}`);
  const files = pkg.files ?? {};
  packPackage(pkg.manifest, files); // validates
  return { manifest: checkManifest(pkg.manifest).manifest, files, kit: Number.isInteger(pkg.kit) ? pkg.kit : 0 };
}

// Which of PLATFORMS a game can be played on.
export const platformsOf = (manifest) => (manifest.input.text ? ['pc', 'mobile'] : PLATFORMS);

// What the lobby needs to list a packaged minigame (same shape as shared/minigames.js entries).
// source is 'official' (in the repo's games/ folder) or 'user' (uploaded by a player); version
// changes whenever the package does, so browsers know to fetch it again.
export function lobbyInfo(manifest, { source = 'official', by, uploadedAt, updatedAt, version } = {}) {
  const { id, name, color, tagline, rules, controls } = manifest;
  return {
    id,
    name,
    color,
    tagline,
    rules,
    controls,
    platforms: platformsOf(manifest),
    mm: true,
    source,
    ...(by ? { by } : {}),
    ...(uploadedAt ? { uploadedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(version ? { version } : {}),
  };
}

// ---- inputs ------------------------------------------------------------------------------
//
// On the wire an input is a short array: ['p', 'a'] press, ['r', 'a'] release, ['d', 'u'|'d'|'l'|'r']
// a direction tap, ['m', x, y] the stick (whole numbers -100..100, y up), ['t', text, 1] text
// typed and sent with Enter, ['t', text, 0] what's in the text box so far (input.text "live").
// Games only receive the kinds they asked for in manifest.input.

const DIRS = new Set(['u', 'd', 'l', 'r']);

export function checkAction(a, input) {
  if (!Array.isArray(a)) return null;
  const [kind, x, y] = a;
  if ((kind === 'p' || kind === 'r') && a.length === 2 && input.buttons.includes(x)) return [kind, x];
  if (kind === 'd' && a.length === 2 && input.dirs && DIRS.has(x)) return ['d', x];
  if (kind === 'm' && a.length === 3 && input.move && Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) <= 100 && Math.abs(y) <= 100) {
    return ['m', x, y];
  }
  if (kind === 't' && a.length === 3 && input.text && (y === 1 || (y === 0 && input.text === 'live')) && typeof x === 'string') {
    if (x.length <= input.maxLength && !CONTROL_CHARS.test(x) && x === x.normalize('NFC')) return ['t', x, y];
  }
  return null;
}

// Tick k covers game time [k, k + 1) / tickRate; inputs are stamped in whole milliseconds. Integer
// maths, so every JavaScript engine puts an input in the same tick.
export const tickOf = (ms, rate) => Math.floor((ms * rate) / 1000);
export const tickStartMs = (k, rate) => Math.ceil((k * 1000) / rate);

// What's typed into a text box, as games receive it: no control characters, composed the same
// way on every device, and no longer than the game allows.
export const cleanText = (text, maxLength) => String(text).replace(new RegExp(CONTROL_CHARS.source, 'g'), '').normalize('NFC').slice(0, maxLength);

// Bots' typing: what the game says a player would type (rules.bot), or now and then (or when it
// doesn't say) a random word, so wrong answers get tried too.
const BOT_WORDS = ['apple', 'banana', 'cat', 'dog', 'sun', 'moon', 'tree', 'house', 'fish', 'bird', 'star', 'cake', 'ball', 'frog', 'party', 'jump', 'blue', 'green', 'pizza', 'robot'];
export const botWord = (wanted, rand) => (wanted && rand() < 0.8 ? wanted : BOT_WORDS[Math.floor(rand() * BOT_WORDS.length)]);

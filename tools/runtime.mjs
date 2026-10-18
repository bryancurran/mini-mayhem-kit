import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { localGame } from '../shared/mm/local-game.js';

// Everything the command-line tools need to run games: the sandbox, the engine that runs inside
// it, and the local stand-in for the server.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE = fs.readFileSync(path.join(ROOT, 'shared/mm/prelude-rules.js'), 'utf8');
export const KIT = fs.readFileSync(path.join(ROOT, 'shared/mm/prelude-view.js'), 'utf8');
export const QuickJS = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
export const runtime = { QuickJS, ENGINE, KIT, makeGame: (pkg, opts) => localGame(pkg, { QuickJS, ENGINE, ...opts }) };

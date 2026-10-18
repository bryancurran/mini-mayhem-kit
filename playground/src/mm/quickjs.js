import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import wasmLocation from '@jitl/quickjs-wasmfile-release-sync/wasm?url';

// The QuickJS sandbox engine (WebAssembly). Loaded the first time a packaged minigame starts;
// it's the same build the server runs, so games give the same results on both.
let loading = null;

export function loadQuickJS() {
  loading ??= newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmLocation }));
  return loading;
}

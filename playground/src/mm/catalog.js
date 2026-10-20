import { MINIGAMES, USER_MINIGAME_IDS, registerMinigame, unregisterMinigame } from '../../../shared/minigames.js';
import { parsePackage } from '../../../shared/mm/format.js';

// Packaged (.mm) minigames: the server lists them at mm/catalog.json and serves each package at
// mm/<id>.mm. URLs are relative to the page so this also works under a subpath like /party/.

const CATALOG_TIMEOUT_MS = 4000;
const packages = new Map(); // id -> Promise<{ manifest, files }>

// Whether this server takes uploads, and how big they may be (from the catalog).
export const uploads = { enabled: false, maxBytes: 200 * 1024 };

// Adds every packaged minigame (standard and uploaded) to the lobby's list. Returns their lobby
// info. Safe to call again later to pick up new uploads, new versions (whose package is fetched
// again next time) and games their makers deleted.
export async function loadCatalog() {
  try {
    const res = await fetch(new URL('mm/catalog.json', location.href), { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS), cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.uploads) Object.assign(uploads, data.uploads);
    // What the built-in games play on and for how many players, as the server has them.
    for (const [id, spec] of Object.entries(data.builtIn ?? {})) if (MINIGAMES[id] && !MINIGAMES[id].mm) Object.assign(MINIGAMES[id], spec);
    for (const info of data.games) {
      if (MINIGAMES[info.id]?.version !== info.version) packages.delete(info.id);
      registerMinigame(info);
    }
    const listed = new Set(data.games.map((g) => g.id));
    for (const id of USER_MINIGAME_IDS.filter((id) => !listed.has(id))) {
      unregisterMinigame(id);
      packages.delete(id);
    }
    return data.games;
  } catch (e) {
    console.warn(`Couldn't load the list of packaged minigames: ${e.message}`);
    return [];
  }
}

// version: the one a round is playing (from gameStart), which the server still has for a while
// after the game is updated; without it, the current one.
export function loadPackage(id, version = null) {
  const key = version ? `${id}@${version}` : id;
  if (!packages.has(key)) {
    const url = new URL(`mm/${encodeURIComponent(id)}.mm`, location.href);
    if (version) url.searchParams.set('v', version);
    const p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(parsePackage);
    p.catch(() => packages.delete(key)); // try again next time
    packages.set(key, p);
  }
  return packages.get(key);
}

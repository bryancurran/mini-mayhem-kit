import { registerMinigame } from '../../../shared/minigames.js';
import { parsePackage } from '../../../shared/mm/format.js';

// Packaged (.mm) minigames: the server lists them at mm/catalog.json and serves each package at
// mm/<id>.mm. URLs are relative to the page so this also works under a subpath like /party/.

const CATALOG_TIMEOUT_MS = 4000;
const packages = new Map(); // id -> Promise<{ manifest, files }>

// Whether this server takes uploads, and how big they may be (from the catalog).
export const uploads = { enabled: false, maxBytes: 200 * 1024 };

// Adds every packaged minigame (official and uploaded) to the lobby's list. Returns their lobby
// info. Safe to call again later to pick up new uploads.
export async function loadCatalog() {
  try {
    const res = await fetch(new URL('mm/catalog.json', location.href), { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS), cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.uploads) Object.assign(uploads, data.uploads);
    for (const info of data.games) registerMinigame(info);
    return data.games;
  } catch (e) {
    console.warn(`Couldn't load the list of packaged minigames: ${e.message}`);
    return [];
  }
}

export function loadPackage(id) {
  if (!packages.has(id)) {
    const p = fetch(new URL(`mm/${encodeURIComponent(id)}.mm`, location.href))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(parsePackage);
    p.catch(() => packages.delete(id)); // try again next time
    packages.set(id, p);
  }
  return packages.get(id);
}

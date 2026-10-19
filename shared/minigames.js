// The kit's stand-in for the game's list of minigames: the browser code it shares with the game
// looks names and controls up here. The playground adds the game you're trying.

export const MINIGAMES = {};
export const MINIGAME_IDS = [];
export const USER_MINIGAME_IDS = [];

export function registerMinigame(info) {
  const known = Boolean(MINIGAMES[info.id]);
  MINIGAMES[info.id] = info;
  if (!known) MINIGAME_IDS.push(info.id);
}

export function unregisterMinigame(id) {
  delete MINIGAMES[id];
  for (const list of [MINIGAME_IDS, USER_MINIGAME_IDS]) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }
}

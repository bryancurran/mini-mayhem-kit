// The kit's stand-in for the game's list of minigames: the browser code it shares with the game
// looks names and controls up here. The playground adds the game you're trying.

export const MINIGAMES = {};
export const MINIGAME_IDS = [];
export const USER_MINIGAME_IDS = [];

export function registerMinigame(info) {
  if (MINIGAMES[info.id]) return;
  MINIGAMES[info.id] = info;
  MINIGAME_IDS.push(info.id);
}

// Things players buy with their coins to dress up their Mosh. Bought once, kept for good on
// their account (server/accounts.js), worn in the lobby and in every game (client/src/avatar.js
// draws them). A Mosh wears at most one thing in each slot, and nothing ever hides its antenna.

export const SLOTS = ['head', 'face', 'neck', 'body', 'back', 'feet'];
// What the profile's shop calls each group (one thing from each can be worn at once).
export const SLOT_NAMES = { head: 'Head', face: 'Face', neck: 'Neck', body: 'Body', back: 'Back', feet: 'Feet' };

export const COSMETICS = {
  bowtie: { name: 'Bow Tie', slot: 'neck', price: 100, icon: '🎀', blurb: 'Dapper for every round.' },
  specs: { name: 'Round Specs', slot: 'face', price: 120, icon: '👓', blurb: 'See every move coming.' },
  beanie: { name: 'Beanie', slot: 'head', price: 160, icon: '🧶', blurb: 'Your antenna is the pom-pom.' },
  cap: { name: 'Backwards Cap', slot: 'head', price: 200, icon: '🧢', blurb: 'Too cool to face forward.' },
  sandals: { name: 'Sandals', slot: 'feet', price: 220, icon: '🩴', blurb: 'Toes out, summer on.' },
  shades: { name: 'Cool Shades', slot: 'face', price: 300, icon: '🕶️', blurb: 'The sun’s always out up here.' },
  tophat: { name: 'Top Hat', slot: 'head', price: 400, icon: '🎩', blurb: 'Very fancy. Antenna included.' },
  medal: { name: 'Gold Medal', slot: 'neck', price: 480, icon: '🏅', blurb: 'A winner, whatever the scoreboard says.' },
  jacket: { name: 'Puffer Jacket', slot: 'body', price: 500, icon: '🧥', blurb: 'Snug as a bug.' },
  boots: { name: 'Biker Boots', slot: 'feet', price: 560, icon: '🥾', blurb: 'Stomp in style.' },
  wings: { name: 'Tiny Wings', slot: 'back', price: 600, icon: '🪽', blurb: 'They flap when you jump.' },
  cape: { name: 'Hero Cape', slot: 'back', price: 800, icon: '🦸', blurb: 'It flies out behind you when you run.' },
};

export const COSMETIC_IDS = Object.keys(COSMETICS);

// An outfit is a list of item ids. This keeps the ones that exist (and, given owned, that the
// player has), one per slot (the last one wins), in slot order.
export function cleanOutfit(raw, owned = null) {
  const bySlot = new Map();
  for (const id of Array.isArray(raw) ? raw : []) {
    const item = Object.hasOwn(COSMETICS, id) ? COSMETICS[id] : null;
    if (item && (!owned || owned.includes(id))) bySlot.set(item.slot, id);
  }
  return SLOTS.filter((slot) => bySlot.has(slot)).map((slot) => bySlot.get(slot));
}

// The outfit with id put on (replacing whatever was in its slot), or taken off if it was on.
export function toggleOutfit(outfit, id) {
  if (outfit.includes(id)) return outfit.filter((i) => i !== id);
  return cleanOutfit([...outfit, id]);
}

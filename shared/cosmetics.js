// Things players buy with their coins to dress up their Mosh. Bought once, kept for good on
// their account (server/accounts.js), worn in the lobby and in every game (client/src/avatar.js
// draws them). A Mosh wears at most one thing in each slot, and nothing ever hides its antenna (an
// antenna from the shop takes the place of its own), or so much of it that its color doesn't show.
//
// Some aren't worn at all: a trail is left on the ground (or in the air) behind a Mosh as it runs,
// a buddy floats along beside it, and a celebration bursts out of it when it hops for joy (a
// winner, in the game or back in the lobby on the tallest podium).

export const SLOTS = ['antenna', 'head', 'face', 'neck', 'body', 'back', 'feet', 'trail', 'buddy', 'cheer'];
// What the profile's shop calls each group (one thing from each can be worn at once).
export const SLOT_NAMES = {
  antenna: 'Antenna',
  head: 'Head',
  face: 'Face',
  neck: 'Neck',
  body: 'Body',
  back: 'Back',
  feet: 'Feet',
  trail: 'Trail',
  buddy: 'Buddy',
  cheer: 'Celebrate',
};

export const COSMETICS = {
  bowtie: { name: 'Bow Tie', slot: 'neck', price: 100, icon: '🎀', blurb: 'Dapper for every round.' },
  specs: { name: 'Round Specs', slot: 'face', price: 120, icon: '👓', blurb: 'See every move coming.' },
  beanie: { name: 'Beanie', slot: 'head', price: 160, icon: '🧶', blurb: 'Your antenna is the pom-pom.' },
  cap: { name: 'Backwards Cap', slot: 'head', price: 200, icon: '🧢', blurb: 'Too cool to face forward.' },
  sandals: { name: 'Sandals', slot: 'feet', price: 220, icon: '🩴', blurb: 'Toes out, summer on.' },
  spring: { name: 'Springy Coil', slot: 'antenna', price: 250, icon: '🌀', blurb: 'Boing! A springy antenna.' },
  shades: { name: 'Cool Shades', slot: 'face', price: 300, icon: '🕶️', blurb: 'The sun’s always out up here.' },
  star: { name: 'Star Topper', slot: 'antenna', price: 300, icon: '⭐', blurb: 'A little star on top.' },
  bolt: { name: 'Lightning Bolt', slot: 'antenna', price: 380, icon: '⚡', blurb: 'Zigzag, like a lightning bolt.' },
  tophat: { name: 'Top Hat', slot: 'head', price: 400, icon: '🎩', blurb: 'Very fancy. Antenna included.' },
  twin: { name: 'Twin Antennas', slot: 'antenna', price: 450, icon: '🐜', blurb: 'Twice the signal.' },
  medal: { name: 'Gold Medal', slot: 'neck', price: 480, icon: '🏅', blurb: 'A winner, whatever the scoreboard says.' },
  jacket: { name: 'Puffer Jacket', slot: 'body', price: 500, icon: '🧥', blurb: 'Snug as a bug.' },
  boots: { name: 'Biker Boots', slot: 'feet', price: 560, icon: '🥾', blurb: 'Stomp in style.' },
  wings: { name: 'Tiny Wings', slot: 'back', price: 600, icon: '🪽', blurb: 'They flap when you jump.' },
  cape: { name: 'Hero Cape', slot: 'back', price: 800, icon: '🦸', blurb: 'It flies out behind you when you run.' },
  mustache: { name: 'Curly Mustache', slot: 'face', price: 180, icon: '🥸', blurb: 'Distinguished. Twirl responsibly.' },
  partyhat: { name: 'Party Hat', slot: 'head', price: 220, icon: '🥳', blurb: 'Every round is a party.' },
  scarf: { name: 'Cozy Scarf', slot: 'neck', price: 260, icon: '🧣', blurb: 'Stripy and snug.' },
  daisy: { name: 'Daisy', slot: 'antenna', price: 280, icon: '🌼', blurb: 'A daisy on top, nodding along.' },
  lei: { name: 'Flower Lei', slot: 'neck', price: 300, icon: '🌺', blurb: 'Aloha, everybody.' },
  starspecs: { name: 'Star Specs', slot: 'face', price: 340, icon: '🤩', blurb: 'For the star of the show.' },
  tutu: { name: 'Tutu', slot: 'body', price: 350, icon: '🩰', blurb: 'Twirl into every round.' },
  propeller: { name: 'Propeller', slot: 'antenna', price: 450, icon: '🚁', blurb: 'Spins faster the faster you go.' },
  skates: { name: 'Roller Skates', slot: 'feet', price: 480, icon: '🛼', blurb: 'Wheels that spin when you run.' },
  viking: { name: 'Viking Helmet', slot: 'head', price: 520, icon: '🪖', blurb: 'Horns up, charge!' },
  hearts: { name: 'Heart Burst', slot: 'cheer', price: 550, icon: '💖', blurb: 'Hearts float up when you hop for joy.' },
  bubbles: { name: 'Bubble Trail', slot: 'trail', price: 600, icon: '🫧', blurb: 'Bubbles float up behind you as you run.' },
  confetti: { name: 'Confetti Pop', slot: 'cheer', price: 650, icon: '🎊', blurb: 'Confetti bursts out when you hop for joy.' },
  sparkles: { name: 'Stardust', slot: 'trail', price: 700, icon: '✨', blurb: 'Twinkling stars wherever you go, even mid-air.' },
  chick: { name: 'Chirpy', slot: 'buddy', price: 750, icon: '🐤', blurb: 'A fluffy chick flutters along with you.' },
  blooms: { name: 'Flower Path', slot: 'trail', price: 800, icon: '🌷', blurb: 'Flowers spring up where you run, then tuck back in.' },
  jetpack: { name: 'Jetpack', slot: 'back', price: 900, icon: '🚀', blurb: 'It roars when you jump.' },
  bee: { name: 'Bumble Buddy', slot: 'buddy', price: 900, icon: '🐝', blurb: 'A bee buzzes along beside you.' },
  rainbow: { name: 'Rainbow Road', slot: 'trail', price: 1000, icon: '🌈', blurb: 'Paint a rainbow on the ground as you run.' },
  ghost: { name: 'Boo Buddy', slot: 'buddy', price: 1100, icon: '👻', blurb: 'A friendly little ghost floats along with you.' },
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

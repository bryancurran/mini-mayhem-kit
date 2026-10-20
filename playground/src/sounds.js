import { withAudio } from './sfx.js';

// The sound library: a thousand-odd sounds and music loops by name ("hit/wood-heavy", music
// "happy-adventure"; shared/sounds/library.json lists them), whose files are on the server:
// sounds/<file>.webm (Opus), or .mp3 where Opus won't decode (older iPhones). Packaged games
// play them with mm.sound, mm.music and mm.loop (mm/scene.js). Nothing's fetched until a game
// uses it, and then only what that game uses (see preloadSounds), each file once.
//
// A sound can have several takes (recordings of the same kind of sound): one is picked at random
// each time, never the same twice running, a little higher or lower and louder or softer, unless
// the game picks one. Music and loops are saved with a little of their end before them and of their
// start after them, and loop the middle: seamless whatever a decoder adds at the start.

const LEVEL = 0.6; // library sounds, against the synthesized ones in sfx.js
const MUSIC_LEVEL = 0.45;
const MAX_VOICES = 32;
const MAX_LOOPS = 4;
const FADE = 0.6; // seconds for music to fade in or out
// A tiny silent Opus file: if it decodes, Opus is used, otherwise MP3.
const PROBE = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggFA7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAPgAAAAAAABZUrmvlrgEAAAAAAABc14EBc8WI2giTN7aoWPqcgQAitZyDdW5kiIEAhoZBX09QVVNWqoNjLqBWu4QExLQAg4EC4ZGfgQG1iEDncAAAAAAAYmSBEGOik09wdXNIZWFkAQE4AYC7AAAAAAASVMNn2HNzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuNy4xMDBzc7NjwItjxYjaCJM3tqhY+mfIokWjh0VOQ09ERVJEh5VMYXZjNjEuMTkuMTAxIGxpYm9wdXMfQ7Z1t+eBAKOTgQAAgHgL5ME27MWNjElGmaQmsKCdoZWBABUAeAfJcifhROpV8fDA1d3pUmB1ooM1Z+A=';

let base = 'sounds/';
let index = null; // a promise of { s: { name: [[file, seconds, padding?], ...] }, m: { name: [file, seconds, padding] } }
let ext = null; // a promise of 'webm' or 'mp3'
const bytes = new Map(); // file -> a promise of its ArrayBuffer
const buffers = new Map(); // file -> a promise of its AudioBuffer
const lastTake = new Map(); // name -> the take played last
const recent = new Map(); // name -> when it was last started (to stop a pile of the same sound)
let voices = 0;
let music = null; // { name, src, gain } playing, or { name } loading
const loops = new Map(); // key -> { name, src, gain }

// Where the files are (the playground fetches them from minimosh.io).
export function setSoundBase(url) {
  base = url;
}

const at = (name) => new URL(name, new URL(base, location.href)).href;

function library() {
  index ??= fetch(at('index.json'))
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch((e) => {
      console.warn(`Couldn't load the sound library: ${e.message}`);
      index = null;
      return { s: {}, m: {} };
    });
  return index;
}

function format(ctx) {
  ext ??= ctx
    .decodeAudioData(Uint8Array.from(atob(PROBE), (c) => c.charCodeAt(0)).buffer)
    .then(() => 'webm')
    .catch(() => 'mp3');
  return ext;
}

function fetchFile(ctx, file) {
  if (!bytes.has(file)) {
    const p = format(ctx)
      .then((e) => fetch(at(`${file}.${e}`)))
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))));
    p.catch(() => bytes.delete(file)); // try again next time
    bytes.set(file, p);
  }
  return bytes.get(file);
}

// A one-shot's AudioBuffer, with where its sound starts (an MP3 decoder may put a little silence
// in front) as buffer.start.
function oneShot(ctx, file) {
  if (!buffers.has(file)) {
    const p = fetchFile(ctx, file)
      .then((data) => ctx.decodeAudioData(data.slice(0)))
      .then((buffer) => {
        const ch = buffer.getChannelData(0);
        const most = Math.min(ch.length, Math.round(buffer.sampleRate * 0.1));
        let i = 0;
        while (i < most && Math.abs(ch[i]) < 0.001) i++;
        buffer.start = i < most ? i / buffer.sampleRate : 0;
        return buffer;
      });
    p.catch(() => buffers.delete(file));
    buffers.set(file, p);
  }
  return buffers.get(file);
}

// Music and other long loops are decoded at a lower sample rate (and the longest in mono), to keep
// them small in memory: a minute of stereo at 22 kHz is 10 MB.
function looped(ctx, file, seconds) {
  if (!buffers.has(file)) {
    const p = fetchFile(ctx, file).then(async (data) => {
      if (seconds < 20) return ctx.decodeAudioData(data.slice(0));
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const buffer = await new Offline(1, 1, 22050).decodeAudioData(data.slice(0));
      if (seconds <= 120 || buffer.numberOfChannels === 1) return buffer;
      const mono = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
      const out = mono.getChannelData(0);
      const [l, r] = [buffer.getChannelData(0), buffer.getChannelData(1)];
      for (let i = 0; i < out.length; i++) out[i] = (l[i] + r[i]) / 2;
      return mono;
    });
    p.catch(() => buffers.delete(file));
    buffers.set(file, p);
  }
  return buffers.get(file);
}

// Fetches (and decodes, once sound can play) everything a packaged game's view.js names: every
// take of each sound, and each music loop. Called while the game is up next.
export function preloadSounds(source) {
  const text = String(source);
  const sounds = new Set([...text.matchAll(/['"`]([a-z0-9-]+\/[a-z0-9-]+)['"`]/g)].map((m) => m[1]));
  const tracks = new Set([...text.matchAll(/music\(\s*['"`]([a-z0-9-]+)['"`]/g)].map((m) => m[1]));
  if (!sounds.size && !tracks.size) return;
  withAudio(async (ctx) => {
    const lib = await library();
    for (const name of sounds) for (const [file, seconds, pad] of lib.s[name] ?? []) (pad ? looped(ctx, file, seconds) : oneShot(ctx, file)).catch(() => {});
    for (const name of tracks) if (lib.m[name]) looped(ctx, lib.m[name][0], lib.m[name][1]).catch(() => {});
  });
}

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// Plays a library sound. options: volume (0 to 2, 1 is as made), pitch (0.25 to 4: 2 is an octave
// up and twice as fast), take (1 to however many it has; otherwise one at random), pan (-1 left to
// 1 right). patience: how many ms late it may still start (one not fetched yet, in a game, is
// better left out than heard well after what it was for; the kit's sound browser waits).
export function playSound(name, options = {}, { patience = 350 } = {}) {
  const asked = performance.now();
  withAudio(async (ctx, master) => {
    const takes = (await library()).s[name];
    if (!takes?.length || voices >= MAX_VOICES) return;
    // Never more than 3 of the same sound within 40 ms (a crowd all scoring at once is one roar).
    const times = (recent.get(name) ?? []).filter((t) => asked - t < 40);
    if (times.length >= 3) return;
    recent.set(name, [...times, asked]);
    let take = Math.round(num(options.take, 1, takes.length, 0)) - 1;
    if (take < 0) {
      take = Math.floor(Math.random() * takes.length);
      if (takes.length > 1 && take === lastTake.get(name)) take = (take + 1) % takes.length;
    }
    lastTake.set(name, take);
    const [file, seconds, pad] = takes[take];
    const buffer = await (pad ? looped(ctx, file, seconds) : oneShot(ctx, file)).catch(() => null);
    // Too late (it wasn't fetched in time): better nothing than a sound well after what it's for.
    if (!buffer || performance.now() - asked > patience) return;
    const vary = typeof options.take === 'number' ? 0 : 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = num(options.pitch, 0.25, 4, 1) * (1 + vary * (Math.random() - 0.5) * 0.05);
    const gain = ctx.createGain();
    gain.gain.value = LEVEL * num(options.volume, 0, 2, 1) * (1 + vary * (Math.random() - 0.5) * 0.16);
    let out = src.connect(gain);
    const pan = num(options.pan, -1, 1, 0);
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      out = out.connect(panner);
    }
    out.connect(master);
    voices++;
    src.onended = () => voices--;
    if (pad) src.start(0, pad, seconds);
    else src.start(0, buffer.start ?? 0);
  });
}

// A looping source of a loop saved with padding (see the top), at volume.
function startLoop(ctx, master, buffer, seconds, pad, level, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.loopStart = pad;
  src.loopEnd = pad + seconds;
  src.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(level, ctx.currentTime, FADE / 4);
  src.connect(gain).connect(master);
  src.start(0, pad);
  return { src, gain };
}

function fadeOut(ctx, playing, seconds = FADE) {
  if (!playing?.src) return;
  playing.gain.gain.cancelScheduledValues(ctx.currentTime);
  playing.gain.gain.setTargetAtTime(0, ctx.currentTime, seconds / 4);
  playing.src.stop(ctx.currentTime + seconds * 1.5);
}

// The music: one loop at a time, faded in, and faded across to another (or out, with null).
// Asking for what's already playing just sets its volume (0 to 2, 1 is as made).
export function setMusic(name, options = {}) {
  withAudio(async (ctx, master) => {
    const level = MUSIC_LEVEL * num(options.volume, 0, 2, 1);
    if (name && music?.name === name) {
      music.gain?.gain.setTargetAtTime(level, ctx.currentTime, 0.1);
      music.level = level;
      return;
    }
    fadeOut(ctx, music);
    music = name ? { name, level } : null;
    if (!name) return;
    const track = (await library()).m[name];
    if (!track) return;
    const [file, seconds, pad] = track;
    const buffer = await looped(ctx, file, seconds).catch(() => null);
    if (!buffer || music?.name !== name || music.src) return; // something else was asked for since
    Object.assign(music, startLoop(ctx, master, buffer, seconds, pad, music.level));
  });
}

// A looping sound, under a key the game chooses ("engine", "rain"), at most 4 at once: started,
// changed (volume and pitch ease to what's asked, so they can follow a speed every frame), or
// stopped (null).
export function setLoop(key, name, options = {}) {
  withAudio(async (ctx, master) => {
    const playing = loops.get(key);
    const level = LEVEL * num(options.volume, 0, 2, 1);
    const rate = num(options.pitch, 0.25, 4, 1);
    if (name && playing?.name === name) {
      playing.level = level;
      playing.rate = rate;
      playing.gain?.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
      playing.src?.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.05);
      return;
    }
    if (playing) {
      fadeOut(ctx, playing, 0.2);
      loops.delete(key);
    }
    if (!name || loops.size >= MAX_LOOPS) return;
    const entry = { name, level, rate };
    loops.set(key, entry);
    const takes = (await library()).s[name];
    if (!takes?.length) return;
    const [file, seconds, pad = 0] = takes[Math.floor(Math.random() * takes.length)];
    const buffer = await (pad ? looped(ctx, file, seconds) : oneShot(ctx, file)).catch(() => null);
    if (!buffer || loops.get(key) !== entry) return;
    Object.assign(entry, startLoop(ctx, master, buffer, pad ? seconds : buffer.duration, pad, entry.level, entry.rate));
  });
}

// The end of a game: its music and loops fade out.
export function stopSounds() {
  withAudio((ctx) => {
    fadeOut(ctx, music);
    music = null;
    for (const playing of loops.values()) fadeOut(ctx, playing, 0.3);
    loops.clear();
  });
}

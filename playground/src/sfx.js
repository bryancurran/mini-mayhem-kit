import { storage } from './util.js';

// Tiny synthesized sound effects (no audio files to load).

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = storage('mm.muted') === '1';
let unlocked = false;

function audio() {
  if (!unlocked) return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.45;
    master.connect(ctx.destination);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture, so stay silent until the first one.
function unlock() {
  unlocked = true;
  audio();
}
for (const type of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(type, unlock, { passive: true });
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  storage('mm.muted', value ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : 0.45;
}

function tone({ freq, to = freq, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
  const ac = audio();
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.2, filter = 'lowpass', freq = 1000, to = freq, q = 1, delay = 0 }) {
  const ac = audio();
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const biquad = ac.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freq, t0);
  if (to !== freq) biquad.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(biquad).connect(gain).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  click: () => tone({ freq: 620, to: 900, dur: 0.07, type: 'triangle', vol: 0.12 }),
  join: () => {
    tone({ freq: 523, dur: 0.1, type: 'triangle', vol: 0.15 });
    tone({ freq: 784, dur: 0.15, type: 'triangle', vol: 0.15, delay: 0.08 });
  },
  leave: () => tone({ freq: 500, to: 300, dur: 0.2, type: 'triangle', vol: 0.12 }),
  ready: () => {
    tone({ freq: 660, dur: 0.08, type: 'square', vol: 0.07 });
    tone({ freq: 990, dur: 0.12, type: 'square', vol: 0.07, delay: 0.07 });
  },
  countdown: () => tone({ freq: 587, dur: 0.18, type: 'square', vol: 0.09 }),
  go: () => {
    tone({ freq: 880, dur: 0.35, type: 'square', vol: 0.09 });
    tone({ freq: 1320, dur: 0.35, type: 'triangle', vol: 0.08 });
  },
  bump: (power = 5) => {
    const p = Math.min(power, 25);
    tone({ freq: 140 + p * 10, to: 70, dur: 0.18, type: 'sine', vol: Math.min(0.5, 0.12 + p * 0.02) });
    tone({ freq: 500 + p * 30, to: 250, dur: 0.06, type: 'triangle', vol: 0.06 });
  },
  dash: () => noise({ dur: 0.25, vol: 0.25, filter: 'bandpass', freq: 600, to: 2400, q: 2 }),
  fall: () => tone({ freq: 900, to: 160, dur: 0.7, type: 'triangle', vol: 0.12 }),
  jump: () => tone({ freq: 320, to: 640, dur: 0.12, type: 'square', vol: 0.05 }),
  boing: () => {
    tone({ freq: 160, to: 900, dur: 0.35, type: 'sine', vol: 0.22 });
    tone({ freq: 240, to: 1200, dur: 0.3, type: 'triangle', vol: 0.08, delay: 0.03 });
  },
  pop: () => {
    tone({ freq: 500, to: 1100, dur: 0.1, type: 'sine', vol: 0.15 });
    noise({ dur: 0.12, vol: 0.12, filter: 'highpass', freq: 2000 });
  },
  // A little climbing scale: each hop is one note higher until it wraps around.
  hop: (step = 0) => {
    const notes = [523, 587, 659, 784, 880, 1047, 1175, 1319];
    tone({ freq: notes[step % notes.length], to: notes[step % notes.length] * 1.12, dur: 0.07, type: 'triangle', vol: 0.07 });
  },
  miss: () => {
    tone({ freq: 700, to: 260, dur: 0.28, type: 'triangle', vol: 0.12 });
    tone({ freq: 180, to: 110, dur: 0.12, type: 'square', vol: 0.06, delay: 0.2 });
  },
  ouch: () => {
    tone({ freq: 340, to: 140, dur: 0.18, type: 'square', vol: 0.08 });
    noise({ dur: 0.15, vol: 0.18, filter: 'highpass', freq: 2500 });
  },
  splat: () => {
    noise({ dur: 0.3, vol: 0.3, filter: 'lowpass', freq: 900, to: 160 });
    tone({ freq: 200, to: 90, dur: 0.25, type: 'sine', vol: 0.15 });
  },
  wiggle: () => tone({ freq: 300, to: 380, dur: 0.06, type: 'sine', vol: 0.12 }),
  crash: () => {
    noise({ dur: 0.9, vol: 0.5, filter: 'lowpass', freq: 1800, to: 80 });
    tone({ freq: 90, to: 40, dur: 0.6, type: 'sine', vol: 0.4 });
  },
  creak: () => {
    tone({ freq: 140, to: 95, dur: 0.6, type: 'sawtooth', vol: 0.05 });
    tone({ freq: 210, to: 150, dur: 0.5, type: 'sawtooth', vol: 0.03, delay: 0.25 });
  },
  shatter: () => {
    noise({ dur: 0.35, vol: 0.22, filter: 'highpass', freq: 3500 });
    [2600, 3300, 2900, 3800].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.04, delay: 0.03 + i * 0.05 }));
  },
  checkpoint: () => {
    tone({ freq: 880, dur: 0.08, type: 'triangle', vol: 0.12 });
    tone({ freq: 1175, dur: 0.16, type: 'triangle', vol: 0.12, delay: 0.08 });
  },
  splash: () => {
    noise({ dur: 0.5, vol: 0.35, filter: 'lowpass', freq: 3000, to: 300 });
    tone({ freq: 220, to: 80, dur: 0.3, vol: 0.15 });
  },
  warn: () => {
    tone({ freq: 740, dur: 0.12, type: 'square', vol: 0.06 });
    tone({ freq: 554, dur: 0.12, type: 'square', vol: 0.06, delay: 0.14 });
  },
  rumble: () => noise({ dur: 1.2, vol: 0.4, filter: 'lowpass', freq: 400, to: 60 }),
  tick: () => tone({ freq: 1200, dur: 0.04, type: 'square', vol: 0.05 }),
  // A soft hand drum for the conga beat.
  bongo: (high = false, accent = false) => {
    const f = high ? 330 : 210;
    tone({ freq: f * 1.5, to: f, dur: 0.09, type: 'sine', vol: accent ? 0.11 : 0.06 });
    noise({ dur: 0.03, vol: accent ? 0.05 : 0.025, filter: 'bandpass', freq: high ? 2400 : 1500, q: 3 });
  },
  // Something soft landing on a stack.
  thud: (pitch = 1) => {
    tone({ freq: 150 * pitch, to: 80 * pitch, dur: 0.12, type: 'sine', vol: 0.22 });
    noise({ dur: 0.07, vol: 0.08, filter: 'lowpass', freq: 900 });
  },
  // A soft tiptoe along a tightrope.
  step: (high = false) => tone({ freq: high ? 880 : 740, to: high ? 820 : 690, dur: 0.05, type: 'sine', vol: 0.035 }),
  // A knife through a sandwich.
  slice: () => noise({ dur: 0.16, vol: 0.14, filter: 'bandpass', freq: 3200, to: 1400, q: 4 }),
  // Picking something up: each one a step higher.
  collect: (step = 0) => {
    const notes = [659, 740, 831, 880, 988, 1109, 1245, 1319];
    const f = notes[step % notes.length] * (step >= notes.length ? 1.5 : 1);
    tone({ freq: f, dur: 0.08, type: 'square', vol: 0.06 });
    tone({ freq: f * 1.5, dur: 0.12, type: 'triangle', vol: 0.08, delay: 0.06 });
  },
  whistle: () => {
    tone({ freq: 1800, to: 1500, dur: 0.25, type: 'sine', vol: 0.12 });
    tone({ freq: 1800, to: 1200, dur: 0.4, type: 'sine', vol: 0.12, delay: 0.28 });
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'square', vol: 0.07, delay: i * 0.11 }));
    tone({ freq: 1047, dur: 0.6, type: 'triangle', vol: 0.12, delay: 0.44 });
  },
  lose: () => {
    [392, 370, 349].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.1, delay: i * 0.22 }));
  },
};

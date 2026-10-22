import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Avatar, outfitFor } from '../avatar.js';
import { MoshCrowd } from '../crowd.js';
import { addClouds, addLights, addSky, addWater, noOutline, toon } from '../gfx.js';
import { Particles, Ripples } from '../particles.js';
import { sfx } from '../sfx.js';
import { playSound, setLoop, setMusic, stopSounds } from '../sounds.js';

// Carries out the drawing commands a packaged minigame's view.js records (see
// shared/mm/prelude-view.js) with three.js. Everything coming out of the sandbox is untrusted:
// every command is checked, numbers are clamped, colors must be hex, text is only ever text,
// and there are caps on how much a game can create.
//
// Games draw from their state, which only moves on at each tick of their rules (60 times a
// second, say), so things drawn straight from it would move in steps, and unevenly whenever the
// screen's frames and the ticks don't line up. So every node and the camera glides to where the
// view puts it (see Glide): what moves with the state is drawn one tick late, part way between
// where it was put on the tick before and on the latest one, by the game's clock. A game gets
// smooth motion on any screen without doing anything. smooth: false turns that off for a node,
// and snap: true makes one move a jump (a teleport, a respawn).

const LIMITS = {
  nodes: 6000,
  resources: 2000,
  labels: 200,
  textureSize: 1024,
  textures: 96,
  textureOps: 50000,
  vertices: 1_500_000, // across every geometry the game makes
  geometryVertices: 120_000,
  commandsPerFrame: 6000,
  soundsPerFrame: 8,
  burstCount: 120,
  lathePoints: 200,
  ripples: 40, // on the water at once
  segments: 128,
  instances: 20_000, // copies across every mm.instances
  instancesEach: 4096,
  instanceVertices: 3_000_000, // copies times the vertices of their shape, across them all
  crowd: 2000, // little Moshes across every mm.crowd
  linePoints: 2000,
  stars: 2000,
  clouds: 60, // placed with spots
  extrudeCommands: 400,
  mists: 8,
};
const COLOR = /^#[0-9a-f]{3,8}$/i;
// Properties packed by the sandbox's drawing kit (pack in prelude-view.js) carry the numbers in
// their arrays as whole numbers 10000 times too big (quicker for QuickJS to write out): this puts
// them back. Handles (material ids) are left alone.
function unfix(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return;
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (k === 'material' || !Array.isArray(v)) continue;
    for (let i = 0; i < v.length; i++) if (typeof v[i] === 'number') v[i] /= 1e4;
  }
}
// The parts of an avatar things can be attached to (in the Mosh's own space: y up from its feet,
// facing +z; its left hand is on the -x side). The torso bobs, squashes and leans with it.
const AVATAR_PARTS = {
  torso: (a) => a.torso,
  'left-hand': (a) => a.hands[0],
  'right-hand': (a) => a.hands[1],
};
const AVATAR_MODES = new Set(['idle', 'happy', 'run', 'jump', 'fall', 'stuck', 'swim', 'balance', 'sleep', 'cheer']);
const LABEL_TONES = new Set(['good', 'great', 'bad']);
// The vertices a game's geometry counts for against its limit (its morphs' too).
const counted = (geo) => geo.userData.mmVertices ?? geo.attributes.position.count;
const SOUNDS = new Set(Object.keys(sfx));
// What a library sound, music or loop may be asked for with (sounds.js keeps them in range).
const soundOptions = (o) => {
  const out = {};
  for (const k of ['volume', 'pitch', 'take', 'pan']) if (typeof o?.[k] === 'number' && Number.isFinite(o[k])) out[k] = o[k];
  return out;
};
const CANVAS_PROPS = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline']);
const CANVAS_METHODS = new Set([
  'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
  'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'fillText', 'strokeText',
  'roundRect', 'setLineDash',
]);

class BadCommand extends Error {}

const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const color = (v, def = '#ffffff') => (typeof v === 'string' && COLOR.test(v) ? v : def);
const BIG = 1e5;
// A crowd Mosh's numbers (see dance), and what each is until it's sent.
const CROWD_NUMBERS = ['x', 'y', 'z', 'yaw', 'scale', 'sway', 'bounce', 'step', 'arms', 'reach', 'spin'];
const CROWD_DEFAULTS = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];

function vec3(v, def) {
  if (!Array.isArray(v) || v.length !== 3) return def;
  return [num(v[0], -BIG, BIG, 0), num(v[1], -BIG, BIG, 0), num(v[2], -BIG, BIG, 0)];
}

function shapeGeometry(s) {
  if (!Array.isArray(s)) throw new BadCommand('shape must be an array like ["box", w, h, d]');
  const [kind, ...p] = s;
  const n = (i, def) => num(p[i], 0.0001, 1e4, def);
  const seg = (i, def) => Math.round(num(p[i], 1, LIMITS.segments, def));
  // Optional start angles and sweeps, as three.js has them (a dome, half a cylinder, a pie).
  const start = (i) => num(p[i], -Math.PI * 4, Math.PI * 4, 0);
  const sweep = (i, def = Math.PI * 2) => num(p[i], 0.0001, Math.PI * 2, def);
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(n(0, 1), n(1, 1), n(2, 1));
    case 'sphere':
      return new THREE.SphereGeometry(n(0, 1), seg(1, 24), seg(2, 16), start(3), sweep(4), start(5), sweep(6, Math.PI));
    case 'cylinder':
      return new THREE.CylinderGeometry(num(p[0], 0, 1e4, 1), num(p[1], 0, 1e4, 1), n(2, 1), seg(3, 24), seg(4, 1), p[5] === true, start(6), sweep(7));
    case 'cone':
      return new THREE.ConeGeometry(n(0, 1), n(1, 1), seg(2, 24), seg(3, 1), p[4] === true, start(5), sweep(6));
    case 'plane':
      return new THREE.PlaneGeometry(n(0, 1), n(1, 1), seg(2, 1), seg(3, 1));
    case 'circle':
      return new THREE.CircleGeometry(n(0, 1), seg(1, 32), start(2), sweep(3));
    case 'ring':
      return new THREE.RingGeometry(n(0, 0.5), n(1, 1), seg(2, 32), seg(3, 1), start(4), sweep(5));
    case 'torus':
      return new THREE.TorusGeometry(n(0, 1), n(1, 0.3), seg(2, 12), seg(3, 32), num(p[4], 0.01, Math.PI * 2, Math.PI * 2));
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(n(0, 1), Math.round(num(p[1], 0, 4, 0)));
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(n(0, 1), Math.round(num(p[1], 0, 4, 0)));
    case 'octahedron':
      return new THREE.OctahedronGeometry(n(0, 1), Math.round(num(p[1], 0, 4, 0)));
    case 'capsule':
      return new THREE.CapsuleGeometry(n(0, 0.5), n(1, 1), seg(2, 8), seg(3, 16));
    case 'lathe': {
      // A profile of [x, y] points (x: the distance from the middle) spun around the y axis.
      const pts = p[0];
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > LIMITS.lathePoints) throw new BadCommand(`lathe: a list of 2-${LIMITS.lathePoints} [x, y] points`);
      const profile = pts.map((pt) => {
        if (!Array.isArray(pt)) throw new BadCommand('lathe: points are [x, y]');
        return new THREE.Vector2(num(pt[0], 0, 1e4, 0), num(pt[1], -1e4, 1e4, 0));
      });
      return new THREE.LatheGeometry(profile, seg(1, 12), start(2), sweep(3));
    }
    case 'extrude': {
      // A flat outline (path commands, as on a canvas) pushed out along z into a solid: a star, a
      // leaf, a logo. Options as three.js's ExtrudeGeometry has them.
      const path = p[0];
      const o = p[1] && typeof p[1] === 'object' && !Array.isArray(p[1]) ? p[1] : {};
      if (!Array.isArray(path) || path.length < 2 || path.length > LIMITS.extrudeCommands) throw new BadCommand(`extrude: a list of 2-${LIMITS.extrudeCommands} path commands`);
      const draw = (into, commands) => {
        for (const c of commands) {
          if (!Array.isArray(c)) throw new BadCommand('extrude: commands are like ["lineTo", x, y]');
          const [op, ...a] = c;
          const v = (i) => num(a[i], -1e4, 1e4, 0);
          if (op === 'moveTo') into.moveTo(v(0), v(1));
          else if (op === 'lineTo') into.lineTo(v(0), v(1));
          else if (op === 'quadraticCurveTo') into.quadraticCurveTo(v(0), v(1), v(2), v(3));
          else if (op === 'bezierCurveTo') into.bezierCurveTo(v(0), v(1), v(2), v(3), v(4), v(5));
          else throw new BadCommand('extrude: moveTo, lineTo, quadraticCurveTo or bezierCurveTo');
        }
        return into;
      };
      const outline = draw(new THREE.Shape(), path);
      // holes: outlines cut out of it (windows in a wall), each a list of commands.
      const holes = Array.isArray(o.holes) ? o.holes : [];
      if (holes.length > 64) throw new BadCommand('extrude: at most 64 holes');
      let commands = path.length;
      for (const hole of holes) {
        if (!Array.isArray(hole) || (commands += hole.length) > LIMITS.extrudeCommands) throw new BadCommand(`extrude: a hole is a list of commands (${LIMITS.extrudeCommands} in all)`);
        outline.holes.push(draw(new THREE.Path(), hole));
      }
      return new THREE.ExtrudeGeometry(outline, {
        depth: num(o.depth, 0, 1e4, 1),
        bevelEnabled: o.bevelEnabled !== false,
        bevelThickness: num(o.bevelThickness, 0, 1e4, 0.2),
        bevelSize: num(o.bevelSize, 0, 1e4, 0.1),
        bevelSegments: Math.round(num(o.bevelSegments, 1, 16, 3)),
        curveSegments: Math.round(num(o.curveSegments, 1, 64, 12)),
      });
    }
    default:
      throw new BadCommand(`unknown shape "${String(kind).slice(0, 20)}"`);
  }
}

// mm.world({ backdrop }): a wall of sky behind a scene seen from the side (a climb), following the
// camera, its color going through stops by how high the camera is, with twinkling stars from a
// height on (Beanstalk Blitz's sky).
function backdropMaterial(stops, top, stars) {
  const colors = stops.map(([, c]) => new THREE.Color(c));
  const at = stops.map(([h]) => h);
  while (colors.length < 6) colors.push(colors[colors.length - 1].clone()), at.push(at[at.length - 1]);
  return noOutline(
    new THREE.ShaderMaterial({
      depthWrite: false,
      uniforms: {
        uCamY: { value: 0 },
        uTop: { value: top },
        uTime: { value: 0 },
        uC: { value: colors },
        uS: { value: at },
        uN: { value: stops.length },
        uStars: { value: new THREE.Vector2(stars?.[0] ?? 0, stars?.[1] ?? 0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uCamY;
        uniform float uTop;
        uniform float uTime;
        uniform vec3 uC[6];
        uniform float uS[6];
        uniform int uN;
        uniform vec2 uStars;
        varying vec3 vWorld;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
          float localY = vWorld.y - uCamY;
          float h = clamp((uCamY + localY * 0.3) / uTop, 0.0, 1.0);
          vec3 col = uC[0];
          for (int i = 1; i < 6; i++) {
            if (i >= uN) break;
            col = mix(col, uC[i], smoothstep(uS[i - 1], uS[i], h));
          }
          if (uStars.y > uStars.x) {
            // Stars drift by slowly as the camera climbs.
            vec2 p = vec2(vWorld.x, localY + uCamY * 0.15) / 3.0;
            vec2 cell = floor(p);
            float r = hash(cell);
            if (r > 0.85) {
              vec2 spot = vec2(hash(cell + 7.1), hash(cell + 3.3)) * 0.7 + 0.15;
              float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
              col += smoothstep(0.08, 0.0, length(fract(p) - spot)) * twinkle * smoothstep(uStars.x, uStars.y, h);
            }
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

// mm.mist: a bank of cloud in front of the scene, solid above a wavy lower edge (world height
// edge) up to top, gently rolling (Beanstalk Blitz's Cloud Cover).
function mistMaterial() {
  return noOutline(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uEdge: { value: 0 },
        uTop: { value: 1000 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#efeaff') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uEdge;
        uniform float uTop;
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vWorld;
        void main() {
          float x = vWorld.x;
          float y = vWorld.y;
          float wave = sin(x * 0.9 + uTime * 0.7) * 0.22 + sin(x * 2.3 - uTime * 1.1) * 0.1 + sin(x * 0.31 + uTime * 0.2) * 0.3;
          float a = smoothstep(uEdge + wave, uEdge + wave + 1.5, y);
          a *= 1.0 - smoothstep(uTop - 1.5, uTop + 0.8, y);
          float puff = sin(x * 0.55 + y * 0.8 + uTime * 0.3) * sin(y * 1.3 - x * 0.2 - uTime * 0.4);
          gl_FragColor = vec4(uColor - puff * 0.06, a * 0.94);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

// Where something is drawn, gliding to where the view puts it. Most things move with the game's
// state, whose targets change once a tick: those are drawn one tick behind the game's clock, part
// way along the line from the target of the tick before to the latest one, by time rather than
// by frames, so the speed stays even however a screen's frames fall against the ticks. Things
// the view animates every frame (their target changes again within a tick) glide from where they
// are to each new target over one tick instead (a corrected prediction can move a target within
// a tick too, so frames with one don't count). Times are game milliseconds; clock is the host's
// (see SceneHost.setClock).
class Glide {
  constructor(obj) {
    this.obj = obj; // anything with position, quaternion and scale
    this.fromPos = obj.position.clone();
    this.fromQuat = obj.quaternion.clone();
    this.fromScale = obj.scale.clone();
    this.toPos = obj.position.clone();
    this.toQuat = obj.quaternion.clone();
    this.toScale = obj.scale.clone();
    this.fromAt = 0;
    this.toAt = 0;
    this.everyFrame = false; // animated every frame rather than every tick
    this.frame = -1; // the frame its target last changed
  }

  // Jumps to the target.
  snap(clock) {
    this.fromPos.copy(this.toPos);
    this.fromQuat.copy(this.toQuat);
    this.fromScale.copy(this.toScale);
    this.fromAt = this.toAt = this.everyFrame ? clock.now : clock.at;
    this.obj.position.copy(this.toPos);
    this.obj.quaternion.copy(this.toQuat);
    this.obj.scale.copy(this.toScale);
  }

  // A new target (any of pos, quat, scale). Returns whether it moved.
  aim(pos, quat, scale, clock) {
    const moved = (pos && pos.distanceToSquared(this.toPos) > 1e-10) || (quat && 1 - Math.abs(quat.dot(this.toQuat)) > 1e-10) || (scale && scale.distanceToSquared(this.toScale) > 1e-10);
    if (!moved) return false;
    if (!this.everyFrame && clock.at === this.toAt && this.frame >= 0 && this.frame !== clock.frame && !clock.rebuilt) this.everyFrame = true;
    this.frame = clock.frame;
    if (this.everyFrame) {
      // From where it is now, over one tick.
      this.step(clock);
      this.fromPos.copy(this.obj.position);
      this.fromQuat.copy(this.obj.quaternion);
      this.fromScale.copy(this.obj.scale);
      this.fromAt = clock.now;
      this.toAt = clock.now + clock.glide;
    } else if (clock.at > this.toAt) {
      // A new tick: on from the old target, from the last tick that target held.
      this.fromPos.copy(this.toPos);
      this.fromQuat.copy(this.toQuat);
      this.fromScale.copy(this.toScale);
      this.fromAt = Math.min(clock.at, Math.max(this.toAt, clock.before));
      this.toAt = clock.at;
    }
    if (pos) this.toPos.copy(pos);
    if (quat) this.toQuat.copy(quat);
    if (scale) this.toScale.copy(scale);
    return true;
  }

  // Shows it as it is now; returns false once it's there.
  step(clock) {
    const t = this.everyFrame ? clock.now : clock.shows;
    const span = this.toAt - this.fromAt;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - this.fromAt) / span)) : 1;
    this.obj.position.lerpVectors(this.fromPos, this.toPos, k);
    this.obj.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, k);
    this.obj.scale.lerpVectors(this.fromScale, this.toScale, k);
    return k < 1;
  }
}

// mm.instances: many copies of one shape in one draw call (two with the outline). The cartoon
// outline pass can't draw instanced meshes, so the outline is a slightly bigger, inside-out copy
// in the outline color, as in crowd.js. Copies glide like nodes (one Glide's worth of numbers each).
const OUTLINE = '#1c122e';
const OUTLINE_WIDTH = 0.022; // world units, at scale 1
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

class InstanceSet {
  constructor(geometry, material, count, { outline, shadow, colorEase = 0 }) {
    this.count = count;
    // Colors that ease to where they're set (per second), rather than jump: colorTo is where
    // each copy is heading, colorNow where it's got to, fading the copies on their way.
    this.colorEase = colorEase;
    if (colorEase) {
      this.colorTo = new Float32Array(count * 3);
      this.colorNow = new Float32Array(count * 3);
      this.colorSet = new Uint8Array(count);
      this.fading = new Set();
    }
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // its bounds would be where the copies started
    this.mesh.castShadow = shadow === true || shadow === 'cast';
    this.mesh.receiveShadow = shadow === true || shadow === 'receive';
    if (outline) {
      geometry.computeBoundingSphere();
      this.grow = 1 + OUTLINE_WIDTH / Math.max(0.01, geometry.boundingSphere.radius);
      this.shell = new THREE.InstancedMesh(geometry, noOutline(new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide })), count);
      this.shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.shell.frustumCulled = false;
      this.mesh.add(this.shell);
    }
    // Shown, target and previous target transforms (as Glide has them): 10 numbers a copy.
    this.cur = new Float32Array(count * 10);
    this.to = new Float32Array(count * 10);
    this.from = new Float32Array(count * 10);
    this.fromAt = new Float64Array(count);
    this.toAt = new Float64Array(count);
    this.everyFrame = new Uint8Array(count); // see Glide
    this.frame = new Int32Array(count).fill(-1);
    this.shown = new Uint8Array(count); // placed and visible
    this.moving = new Set();
    for (let i = 0; i < count; i++) {
      for (const a of [this.cur, this.to, this.from]) a.set([0, 0, 0, 0, 0, 0, 1, 1, 1, 1], i * 10);
      this.mesh.setMatrixAt(i, HIDDEN);
      this.shell?.setMatrixAt(i, HIDDEN);
    }
  }

  // Copy i's shown transform now, into cur (see Glide.step).
  advance(i, clock) {
    const o = i * 10;
    const t = this.everyFrame[i] ? clock.now : clock.shows;
    const span = this.toAt[i] - this.fromAt[i];
    const k = span > 0 ? Math.min(1, Math.max(0, (t - this.fromAt[i]) / span)) : 1;
    for (let j = 0; j < 3; j++) this.cur[o + j] = this.from[o + j] + (this.to[o + j] - this.from[o + j]) * k;
    for (let j = 7; j < 10; j++) this.cur[o + j] = this.from[o + j] + (this.to[o + j] - this.from[o + j]) * k;
    tmpQuatA.fromArray(this.from, o + 3).slerp(tmpQuatB.fromArray(this.to, o + 3), k).toArray(this.cur, o + 3);
    return k < 1;
  }

  write(i) {
    const o = i * 10;
    if (!this.shown[i]) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.shell?.setMatrixAt(i, HIDDEN);
    } else {
      tmpMatrix.compose(tmpPos.fromArray(this.cur, o), tmpQuat.fromArray(this.cur, o + 3), tmpScale.fromArray(this.cur, o + 7));
      this.mesh.setMatrixAt(i, tmpMatrix);
      if (this.shell) {
        tmpScale.multiplyScalar(this.grow);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        this.shell.setMatrixAt(i, tmpMatrix);
      }
    }
    this.dirty = true;
  }

  // p: { pos, rot, scale, color, visible }, checked. clock: the host's (see Glide), or null to jump.
  place(i, p, clock) {
    const o = i * 10;
    const first = !this.placed?.has(i);
    (this.placed ??= new Set()).add(i);
    const reappears = p.visible !== false && !this.shown[i];
    if (p.visible !== undefined || first) this.shown[i] = p.visible === false ? 0 : 1;
    const next = tmpCopy;
    next.set(this.to.subarray(o, o + 10));
    if (p.pos) next.set(p.pos, 0);
    if (p.rot) tmpQuat.setFromEuler(tmpEuler.fromArray(p.rot)).toArray(next, 3);
    if (p.scale) next.set(p.scale, 7);
    let moved = false;
    for (let j = 0; j < 10 && !moved; j++) moved = Math.abs(next[j] - this.to[o + j]) > 1e-6;
    if (p.color) {
      const first = !this.mesh.instanceColor;
      tmpColor.set(p.color);
      if (this.colorEase) {
        tmpColor.toArray(this.colorTo, i * 3);
        // The first color, or a snap, shows at once; later ones ease in.
        if (!this.colorSet[i] || p.snap) {
          tmpColor.toArray(this.colorNow, i * 3);
          this.fading.delete(i);
        } else {
          this.fading.add(i);
          tmpColor.fromArray(this.colorNow, i * 3);
        }
        this.colorSet[i] = 1;
      }
      this.mesh.setColorAt(i, tmpColor);
      this.mesh.instanceColor.needsUpdate = true;
      if (first) this.mesh.material.needsUpdate = true; // its shader starts using copies' colors
    }
    if (first || reappears || !clock || p.snap) {
      this.to.set(next, o);
      this.from.set(next, o);
      this.cur.set(next, o);
      if (clock) this.fromAt[i] = this.toAt[i] = this.everyFrame[i] ? clock.now : clock.at;
      this.moving.delete(i);
    } else if (moved) {
      if (!this.everyFrame[i] && clock.at === this.toAt[i] && this.frame[i] >= 0 && this.frame[i] !== clock.frame && !clock.rebuilt) this.everyFrame[i] = 1;
      this.frame[i] = clock.frame;
      if (this.everyFrame[i]) {
        this.advance(i, clock);
        this.from.set(this.cur.subarray(o, o + 10), o);
        this.fromAt[i] = clock.now;
        this.toAt[i] = clock.now + clock.glide;
      } else if (clock.at > this.toAt[i]) {
        this.from.set(this.to.subarray(o, o + 10), o);
        this.fromAt[i] = Math.min(clock.at, Math.max(this.toAt[i], clock.before));
        this.toAt[i] = clock.at;
      }
      this.to.set(next, o);
      this.advance(i, clock);
      this.moving.add(i);
    }
    this.write(i);
  }

  step(clock, dt) {
    for (const i of this.moving) {
      if (!this.advance(i, clock)) this.moving.delete(i);
      this.write(i);
    }
    if (this.fading?.size) {
      const k = 1 - Math.exp(-this.colorEase * dt);
      for (const i of this.fading) {
        let left = 0;
        for (let j = i * 3; j < i * 3 + 3; j++) {
          this.colorNow[j] += (this.colorTo[j] - this.colorNow[j]) * k;
          left = Math.max(left, Math.abs(this.colorTo[j] - this.colorNow[j]));
        }
        if (left < 0.002) {
          this.colorNow.set(this.colorTo.subarray(i * 3, i * 3 + 3), i * 3);
          this.fading.delete(i);
        }
        this.mesh.setColorAt(i, tmpColor.fromArray(this.colorNow, i * 3));
      }
      this.mesh.instanceColor.needsUpdate = true;
    }
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.shell) this.shell.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpQuatA = new THREE.Quaternion();
const tmpQuatB = new THREE.Quaternion();
const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const tmpCopy = new Float32Array(10);

function numbers(list, max, name) {
  if (!Array.isArray(list) || list.length > max) throw new BadCommand(`${name}: an array of at most ${max} numbers`);
  const out = new Float32Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadCommand(`${name}: numbers only`);
    out[i] = v;
  }
  return out;
}

export class SceneHost {
  constructor(scene, camera, { hud, onBadCommand, onControls }) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.onBadCommand = onBadCommand;
    this.onControls = onControls;
    this.nodes = new Map(); // id -> { obj, kind, ownGeometry, avatar, mode, speed, label }
    this.resources = new Map(); // id -> { kind, value }
    this.shapeCache = new Map();
    this.colorCache = new Map();
    this.vertices = 0;
    this.textures = 0;
    this.labels = 0;
    this.instances = 0; // copies across every instances node
    this.instanceVertices = 0;
    this.instanceSets = new Set();
    this.crowdCount = 0; // little Moshes across every crowd node
    this.worldDone = new Set();
    this.particles = null;
    this.ripples = null;
    this.clouds = null;
    this.sky = null; // the sky from mm.world({ sky })
    this.sun = null; // the sun from mm.world({ lights })
    this.cloudWrap = null; // drifting clouds come back round at x = ±this
    this.backdrop = null; // mm.world({ backdrop }): { mesh, z }
    this.mists = new Set(); // mm.mist nodes' materials (their waves roll with time)
    this.water = null;
    this.time = 0; // seconds since the game's first frame (the water's waves)
    this.badCount = 0;
    this.safe = null; // the part of the screen the HUD doesn't cover (set by the host each frame)
    this.safeCamera = false;
    this.glideMs = 0; // one tick of the game's rules (set by the host), 0 for no gliding
    // The game's clock this frame (set by the host, see setClock): its time now, the tick time of
    // the state being drawn and of the one drawn on an earlier frame, the time things moving with
    // the state are shown at, one tick of gliding, a frame count, and whether the prediction was
    // corrected this frame.
    this.clock = { now: 0, at: 0, before: 0, shows: 0, glide: 0, frame: 0, rebuilt: false };
    this.gliding = new Set(); // Glides on the move
    this.cameraGlide = null; // { glide, look: Vector3 (shown), lookTo, lookFrom, smooth }
  }

  // ---- applying commands ------------------------------------------------------------------

  // Once a frame, before apply(): the game's time now and the tick time of the state the commands
  // are drawn from (both game milliseconds), and whether the prediction was rebuilt since the last
  // frame. Things that move with the state are shown one tick behind now.
  setClock(now, at, rebuilt = false) {
    const c = this.clock;
    if (at !== c.at) {
      c.before = c.at;
      c.at = at;
    }
    c.now = now;
    c.shows = now - this.glideMs;
    c.glide = this.glideMs;
    c.frame++;
    c.rebuilt = rebuilt;
  }

  apply(commands) {
    if (!Array.isArray(commands)) return;
    if (commands.length > LIMITS.commandsPerFrame * 4) throw new Error(`too many drawing commands (${commands.length})`);
    let sounds = 0;
    for (const c of commands) {
      try {
        if (!Array.isArray(c)) throw new BadCommand('not a command');
        const [op, a, b, d, e, f] = c;
        if (op === 'new') unfix(d);
        else if (op === 'set' || op === 'rset' || op === 'mat' || op === 'ibulk' || op === 'cbulk') unfix(b);
        else if (op === 'camera' || op === 'burst' || op === 'ripple' || op === 'sun') unfix(a);
        else if (op === 'inst' && Array.isArray(b)) for (const entry of b) if (Array.isArray(entry)) unfix(entry[1]);
        if (op === 'new') this.create(a, b, d ?? {});
        else if (op === 'set') this.update(this.node(a), b ?? {});
        else if (op === 'del') this.remove(a);
        else if (op === 'inst') this.place(this.node(a), b);
        else if (op === 'ibulk') this.placeMany(this.node(a), b ?? {});
        else if (op === 'cbulk') this.dance(this.node(a), b ?? {});
        else if (op === 'controls') this.onControls?.(a ?? {});
        else if (op === 'mat') this.addResource(a, 'material', this.makeMaterial(b ?? {}));
        else if (op === 'rset') this.updateResource(a, b ?? {});
        else if (op === 'tex') this.addResource(a, 'texture', this.makeTexture(b, d, e, f));
        else if (op === 'geo') this.addResource(a, 'geometry', this.makeGeometry(b));
        else if (op === 'free') this.free(a);
        else if (op === 'bake') this.bake(a, b ?? {});
        else if (op === 'camera') this.setCamera(a ?? {});
        else if (op === 'world') this.world(a ?? {});
        else if (op === 'sun') this.moveSun(a ?? {});
        else if (op === 'burst') this.burst(a ?? {});
        else if (op === 'ripple') this.ripple(a ?? {});
        else if (op === 'sound') {
          if (sounds++ < LIMITS.soundsPerFrame && SOUNDS.has(a)) {
            const args = (Array.isArray(b) ? b : []).slice(0, 3).filter((x) => typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)));
            sfx[a](...args.map((x) => (typeof x === 'number' ? Math.max(-100, Math.min(100, x)) : x)));
          } else if (sounds <= LIMITS.soundsPerFrame && typeof a === 'string' && a.includes('/')) playSound(a, soundOptions(Array.isArray(b) ? b[0] : null));
        } else if (op === 'music') setMusic(typeof a === 'string' ? a : null, soundOptions(b));
        else if (op === 'loop') setLoop(String(a).slice(0, 24), typeof b === 'string' ? b : null, soundOptions(d));
        else if (op === 'hud') this.hud.apply(a, b, d);
        else throw new BadCommand(`unknown command "${String(op).slice(0, 20)}"`);
      } catch (err) {
        if (!(err instanceof BadCommand)) throw err;
        if (this.badCount++ < 20) this.onBadCommand?.(err.message);
      }
    }
  }

  node(id) {
    const n = this.nodes.get(id);
    if (!n) throw new BadCommand(`no node ${id}`);
    return n;
  }

  resource(id, kind) {
    const r = this.resources.get(id);
    if (!r || r.kind !== kind) throw new BadCommand(`no ${kind} ${id}`);
    return r.value;
  }

  addResource(id, kind, value) {
    if (!Number.isInteger(id) || this.resources.has(id) || this.nodes.has(id)) throw new BadCommand('bad id');
    if (this.resources.size >= LIMITS.resources) {
      value.dispose?.();
      throw new BadCommand('too many materials, textures and geometries');
    }
    value.userData.shared = true; // freed with free() or at the end, not by disposeScene()
    this.resources.set(id, { kind, value });
  }

  free(id) {
    const r = this.resources.get(id);
    if (!r) return;
    this.resources.delete(id);
    if (r.kind === 'geometry') this.vertices -= counted(r.value);
    if (r.kind === 'texture') this.textures--;
    r.value.dispose();
  }

  // ---- nodes ------------------------------------------------------------------------------

  create(id, kind, props) {
    if (!Number.isInteger(id) || this.nodes.has(id) || this.resources.has(id)) throw new BadCommand('bad id');
    if (this.nodes.size >= LIMITS.nodes) throw new BadCommand('too many nodes');
    const n = { kind, obj: null, ownGeometry: null };
    if (kind === 'group') {
      n.obj = new THREE.Group();
      // mm.copy: another of something already built (a baked lane of a beanstalk), sharing its
      // shapes and materials. The copy is all one piece: what's under it isn't nodes of its own.
      if (props.copy !== undefined) {
        const src = this.node(props.copy);
        if (src.kind !== 'group') throw new BadCommand('only groups can be copied');
        for (const child of src.obj.children) {
          const c = child.clone(true);
          const labels = [];
          c.traverse((o) => {
            if (o.isCSS2DObject) labels.push(o);
            delete o.userData.mmId;
            delete o.userData.mmBaked; // its geometry is the original's, which frees it
            delete o.userData.mmBakedMaterial;
            o.userData.mmCopy = true;
          });
          for (const l of labels) l.removeFromParent();
          if (!c.isCSS2DObject) n.obj.add(c);
        }
      }
    } else if (kind === 'mesh') {
      n.obj = new THREE.Mesh(this.shape(['box', 1, 1, 1]), this.colorMaterial('#ffffff'));
    } else if (kind === 'avatar') {
      n.color = color(props.color, '#ff5c8a');
      // outfit: false for a Mosh that isn't a player's (a parade, a crowd): it wears nothing from
      // the shop, whatever its color.
      n.noOutfit = props.outfit === false;
      n.avatar = new Avatar(n.color, n.noOutfit ? [] : undefined);
      n.obj = n.avatar.group;
      n.mode = 'idle';
      n.speed = 0;
    } else if (kind === 'label') {
      if (this.labels >= LIMITS.labels) throw new BadCommand('too many labels');
      this.labels++;
      const el = document.createElement('div');
      n.obj = new CSS2DObject(el);
      n.label = el;
    } else if (kind === 'instances') {
      this.makeInstances(n, props);
    } else if (kind === 'crowd') {
      const max = Math.round(num(props.max, 1, LIMITS.crowd, 50));
      if (this.crowdCount + max > LIMITS.crowd) throw new BadCommand(`too many crowd Moshes (at most ${LIMITS.crowd} in all)`);
      this.crowdCount += max;
      n.obj = new THREE.Group();
      n.max = max;
      n.crowd = new MoshCrowd(n.obj, max, { shadows: props.shadow !== false });
      // Each Mosh's numbers and colors as last sent (see dance).
      n.dancers = { shown: 0, num: new Float32Array(max * CROWD_NUMBERS.length), color: [], dark: [], hat: [] };
      for (let i = 0; i < max; i++) n.dancers.num.set(CROWD_DEFAULTS, i * CROWD_NUMBERS.length);
    } else if (kind === 'line') {
      n.obj = new THREE.Line(new THREE.BufferGeometry(), noOutline(new THREE.LineBasicMaterial({ color: '#ffffff' })));
      n.ownGeometry = null;
    } else if (kind === 'mist') {
      if (this.mists.size >= LIMITS.mists) throw new BadCommand(`too many mists (at most ${LIMITS.mists})`);
      const geo = new THREE.PlaneGeometry(num(props.width, 1, 2000, 400), num(props.height, 1, 2000, 100));
      n.obj = new THREE.Mesh(geo, mistMaterial());
      n.obj.renderOrder = 5;
      n.ownGeometry = geo;
      this.vertices += geo.attributes.position.count;
      this.mists.add(n.obj.material);
    } else {
      throw new BadCommand(`unknown node kind "${String(kind).slice(0, 20)}"`);
    }
    n.obj.userData.mmId = id;
    n.made = this.clock.frame; // (see update)
    this.nodes.set(id, n);
    this.scene.add(n.obj);
    this.update(n, props, true);
  }

  update(n, p, fresh = false) {
    const o = n.obj;
    if (p.smooth !== undefined) n.smooth = p.smooth !== false;
    const pos = p.pos !== undefined ? tmpPos.fromArray(vec3(p.pos, [0, 0, 0])) : null;
    const quat = p.rot !== undefined ? tmpQuat.setFromEuler(tmpEuler.fromArray(vec3(p.rot, [0, 0, 0]))) : null;
    let scale = null;
    if (p.scale !== undefined) {
      if (typeof p.scale === 'number') scale = tmpScale.setScalar(num(p.scale, 0.0001, 1e4, 1));
      else scale = tmpScale.fromArray(vec3(p.scale, [1, 1, 1]).map((v) => (Math.abs(v) < 0.0001 ? 0.0001 : v)));
    }
    // A jump rather than a glide: new, or put in place for the first time (a .set() in the frame
    // it was made, which the view sends after making it, is part of making it; and its first
    // position, turn or size is where it's put, not a move, or it would fly in from the middle of
    // the world), told to, never smoothed, just shown again, or moved to another parent (where
    // its numbers mean somewhere else).
    const reappears = p.visible !== undefined && p.visible !== false && !o.visible;
    const first = (pos && !n.hasPos) || (quat && !n.hasRot) || (scale && !n.hasScale);
    if (pos) n.hasPos = true;
    if (quat) n.hasRot = true;
    if (scale) n.hasScale = true;
    const jump = fresh || first || n.made === this.clock.frame || p.snap === true || n.smooth === false || reappears || p.parent !== undefined || !this.glideMs;
    n.glide ??= new Glide(o);
    if (jump) {
      if (pos) n.glide.toPos.copy(pos);
      if (quat) n.glide.toQuat.copy(quat);
      if (scale) n.glide.toScale.copy(scale);
      if (pos || quat || scale || p.snap === true || reappears) {
        n.glide.snap(this.clock);
        this.gliding.delete(n.glide);
      }
    } else if (n.glide.aim(pos, quat, scale, this.clock)) {
      this.gliding.add(n.glide);
    }
    if (p.visible !== undefined) o.visible = p.visible !== false;
    if (p.parent !== undefined) this.reparent(n, p.parent, p.part);

    if (n.kind === 'mesh') {
      if (p.shape !== undefined) this.setGeometry(n, this.shape(p.shape), false);
      if (p.geometry !== undefined) {
        if (Number.isInteger(p.geometry)) this.setGeometry(n, this.resource(p.geometry, 'geometry'), false);
        else this.setGeometry(n, this.makeGeometry(p.geometry), true);
        o.updateMorphTargets();
      }
      // morph: how far toward each of its geometry's morphs (0 none, 1 all the way; less than 0
      // goes the other way).
      if (p.morph !== undefined && o.morphTargetInfluences) {
        const w = Array.isArray(p.morph) ? p.morph : [];
        for (let i = 0; i < o.morphTargetInfluences.length; i++) o.morphTargetInfluences[i] = num(w[i], -10, 10, 0);
      }
      if (p.material !== undefined) {
        o.material = Array.isArray(p.material) ? p.material.slice(0, 32).map((m) => this.materialRef(m)) : this.materialRef(p.material);
      } else if (p.color !== undefined) {
        o.material = this.colorMaterial(color(p.color));
      }
      if (p.shadow !== undefined || fresh) {
        const s = p.shadow ?? false;
        o.castShadow = s === true || s === 'cast';
        o.receiveShadow = s === true || s === 'receive';
      }
      // order: among see-through things, higher ones are drawn later, on top (a shadow on a decal).
      if (p.order !== undefined) o.renderOrder = Math.round(num(p.order, -100, 100, 0));
    } else if (n.kind === 'avatar') {
      if (p.color !== undefined && color(p.color, '#ff5c8a') !== n.color) {
        n.color = color(p.color, '#ff5c8a');
        n.avatar.setColor(n.color);
        if (!n.noOutfit) n.avatar.setOutfit(outfitFor(n.color)); // a player's Mosh wears their outfit
        if (n.bobble === false) n.avatar.bobble.visible = false;
      }
      // bobble: false hides the ball on top of its antenna (under a party hat).
      if (p.bobble !== undefined) {
        n.bobble = p.bobble !== false;
        n.avatar.bobble.visible = n.bobble && !n.avatar.worn.has('antenna');
      }
      if (p.mode !== undefined && AVATAR_MODES.has(p.mode)) n.mode = p.mode;
      if (p.speed !== undefined) n.speed = num(p.speed, 0, 50, 0);
      if (p.crown !== undefined) n.avatar.setCrown(p.crown === true);
      if (p.lean !== undefined) n.lean = num(p.lean, -Math.PI, Math.PI, 0);
      if (p.shadow !== undefined) {
        const s = p.shadow;
        n.obj.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = s === true || s === 'cast';
          o.receiveShadow = s === true || s === 'receive';
        });
      }
    } else if (n.kind === 'line') {
      if (p.color !== undefined) o.material.color.set(color(p.color));
      if (p.points !== undefined) {
        const pts = numbers(p.points, LIMITS.linePoints * 3, 'points');
        if (pts.length % 3) throw new BadCommand('line points: 3 numbers each');
        const old = o.geometry.attributes.position?.count ?? 0;
        this.vertices += pts.length / 3 - old;
        o.geometry.dispose();
        o.geometry = new THREE.BufferGeometry();
        o.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      }
    } else if (n.kind === 'label') {
      const el = n.label;
      if (p.style !== undefined || p.tone !== undefined || fresh) {
        const was = n.style;
        n.style = p.style ?? n.style ?? 'tag';
        n.tone = p.tone ?? n.tone;
        // A bubble ("MASH! 3") pulses, which only its inner part can: the renderer places the
        // label's own element with a transform.
        if ((n.style === 'bubble') !== (was === 'bubble')) {
          const text = n.text ?? '';
          el.replaceChildren();
          el.className = '';
          if (n.style === 'bubble') el.append(Object.assign(document.createElement('span'), { className: 'mash-bubble' }));
          n.text = undefined;
          if (p.text === undefined) p = { ...p, text };
        }
        if (n.style !== 'bubble' && !n.nameEl) el.className = n.style === 'float' ? `stack-float${LABEL_TONES.has(n.tone) ? ` ${n.tone}` : ''}` : n.style === 'count' ? 'count-tag' : n.style === 'me' ? 'nametag in-game me' : 'nametag in-game';
      }
      // bubble: a thought bubble over a name tag ({ text, tone: 'good' | 'fair' | 'bad' }, null for
      // none): the tag and the bubble become one, stacked.
      if (p.bubble !== undefined && !n.bubbleEl && n.style !== 'bubble') {
        const tag = document.createElement('span');
        tag.className = el.className;
        // Only its color: the rest of the label's style places it on the screen.
        const c = el.style.getPropertyValue('--c');
        if (c) tag.style.setProperty('--c', c);
        tag.textContent = el.textContent;
        n.bubbleEl = document.createElement('span');
        n.bubbleEl.hidden = true;
        el.replaceChildren(n.bubbleEl, tag);
        el.className = 'count-watcher';
        el.style.removeProperty('--c');
        n.nameEl = tag;
      }
      const nameEl = n.nameEl ?? el;
      if (n.nameEl && (p.style !== undefined || p.tone !== undefined || fresh)) {
        nameEl.className = n.style === 'me' ? 'nametag in-game me' : 'nametag in-game';
        el.className = 'count-watcher';
      }
      if (p.bubble !== undefined && n.bubbleEl) {
        const b = p.bubble && typeof p.bubble === 'object' ? p.bubble : null;
        n.bubbleEl.hidden = !b;
        if (b) {
          const tone = { good: ' exact', fair: ' close', bad: ' wrong' }[b.tone] ?? '';
          n.bubbleEl.className = `count-bubble${tone}`;
          n.bubbleEl.textContent = String(b.text ?? '').slice(0, 20);
        }
      }
      if (p.text !== undefined || p.strong !== undefined) {
        if (p.text !== undefined) n.text = String(p.text).slice(0, 60);
        if (p.strong !== undefined) n.strong = p.strong === null ? '' : String(p.strong).slice(0, 20);
        const target = n.style === 'bubble' ? el.firstChild : nameEl;
        target.textContent = n.text ?? '';
        // An emphasized bit after the text (the count in "MASH! 3").
        if (n.strong) target.append(' ', Object.assign(document.createElement('b'), { textContent: n.strong }));
      }
      if (p.color !== undefined) nameEl.style.setProperty('--c', color(p.color, '#999999'));
      if (p.opacity !== undefined) el.style.opacity = String(num(p.opacity, 0, 1, 1));
    } else if (n.kind === 'mist') {
      const u = o.material.uniforms;
      if (p.edge !== undefined) u.uEdge.value = num(p.edge, -BIG, BIG, 0);
      if (p.top !== undefined) u.uTop.value = num(p.top, -BIG, BIG, 1000);
      if (p.color !== undefined) u.uColor.value.set(color(p.color, '#efeaff'));
    }
  }

  // mm.instances({ shape | geometry, color | material, count, shadow, outline }).
  makeInstances(n, p) {
    const count = Math.round(num(p.count, 1, LIMITS.instancesEach, 1));
    if (this.instances + count > LIMITS.instances) throw new BadCommand(`too many instances (at most ${LIMITS.instances} in all)`);
    let geometry;
    let ownGeometry = null;
    if (p.geometry !== undefined) {
      if (Number.isInteger(p.geometry)) geometry = this.resource(p.geometry, 'geometry');
      else geometry = ownGeometry = this.makeGeometry(p.geometry);
    } else geometry = this.shape(p.shape ?? ['box', 1, 1, 1]);
    const vertices = geometry.attributes.position.count * count;
    if (this.instanceVertices + vertices > LIMITS.instanceVertices) {
      ownGeometry?.dispose();
      throw new BadCommand(`too many vertices across instances (at most ${LIMITS.instanceVertices})`);
    }
    // Its own material: the outline pass has to leave it alone, which a shared one can't.
    const material = noOutline(p.material !== undefined && !Array.isArray(p.material) ? this.materialRef(p.material).clone() : toon(color(p.color)));
    n.instances = new InstanceSet(geometry, material, count, { outline: p.outline !== false, shadow: p.shadow, colorEase: num(p.colorEase, 0, 100, 0) });
    n.obj = n.instances.mesh;
    n.ownGeometry = ownGeometry;
    n.count = count;
    n.vertices = vertices;
    this.instances += count;
    this.instanceVertices += vertices;
    this.instanceSets.add(n.instances);
  }

  // ['inst', id, [[i, { pos, rot, scale, color, visible }], ...]]
  place(n, list) {
    if (n.kind !== 'instances') throw new BadCommand('only instances can be placed');
    if (!Array.isArray(list) || list.length > n.count) throw new BadCommand('instances: a list of [index, properties]');
    const clock = n.smooth === false || !this.glideMs ? null : this.clock;
    for (const entry of list) {
      if (!Array.isArray(entry)) continue;
      const [i, p] = entry;
      if (!Number.isInteger(i) || i < 0 || i >= n.count || !p || typeof p !== 'object') continue;
      let scale;
      if (p.scale !== undefined) {
        const s = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : vec3(p.scale, [1, 1, 1]);
        scale = s.map((v) => num(v, 0.0001, 1e4, 1));
      }
      n.instances.place(
        i,
        {
          pos: p.pos !== undefined ? vec3(p.pos, [0, 0, 0]) : undefined,
          rot: p.rot !== undefined ? vec3(p.rot, [0, 0, 0]) : undefined,
          scale,
          color: p.color !== undefined ? color(p.color) : undefined,
          visible: p.visible === undefined ? undefined : p.visible !== false,
          snap: p.snap === true,
        },
        clock,
      );
    }
  }

  // ['ibulk', id, { from, pos: [x, y, z, ...], rot: [x, y, z, ...], scale: [s, ...], color: ['#hex', ...],
  // shown, snap }]: many copies at once.
  placeMany(n, d) {
    if (n.kind !== 'instances') throw new BadCommand('only instances can be placed');
    const from = Number.isInteger(d.from) ? Math.max(0, d.from) : 0;
    const list = (key, per) => {
      const v = d[key];
      if (v === undefined) return null;
      if (!Array.isArray(v) || v.length % per || from + v.length / per > n.count) throw new BadCommand(`instances ${key}: ${per} number${per > 1 ? 's' : ''} for each copy, within count`);
      return v;
    };
    const pos = list('pos', 3);
    const rot = list('rot', 3);
    const scale = list('scale', 1);
    const colors = d.color === undefined ? null : Array.isArray(d.color) && from + d.color.length <= n.count ? d.color : null;
    const copies = Math.max(pos ? pos.length / 3 : 0, rot ? rot.length / 3 : 0, scale ? scale.length : 0, colors ? colors.length : 0);
    const clock = n.smooth === false || !this.glideMs ? null : this.clock;
    const n3 = (a, k) => [num(a[k], -BIG, BIG, 0), num(a[k + 1], -BIG, BIG, 0), num(a[k + 2], -BIG, BIG, 0)];
    for (let j = 0; j < copies; j++) {
      const p = { snap: d.snap === true };
      if (pos && j * 3 < pos.length) p.pos = n3(pos, j * 3);
      if (rot && j * 3 < rot.length) p.rot = n3(rot, j * 3);
      if (scale && j < scale.length) {
        const s = num(scale[j], 0.0001, 1e4, 1);
        p.scale = [s, s, s];
      }
      if (colors && j < colors.length && colors[j] !== null) p.color = color(colors[j]);
      n.instances.place(from + j, p, clock);
    }
    // shown: the first `shown` copies show, the rest hide.
    if (Number.isInteger(d.shown)) {
      const shown = Math.max(0, Math.min(n.count, d.shown));
      for (let i = 0; i < n.count; i++) {
        const want = i < shown;
        if (n.instances.placed?.has(i) && Boolean(n.instances.shown[i]) !== want) n.instances.place(i, { visible: want }, clock);
      }
    }
  }

  // ['cbulk', id, { from, shown, pos: [x, y, z, ...], yaw, scale, sway, bounce, step, arms, reach,
  // spin: [one each], color, dark, hat: ['#hex' (or null for no hat), ...] }]: the crowd's little
  // Moshes from Mosh `from` on, each kept as last sent; `shown` of them are drawn.
  dance(n, d) {
    if (n.kind !== 'crowd') throw new BadCommand('only crowds dance');
    const D = n.dancers;
    const F = CROWD_NUMBERS.length;
    const from = Number.isInteger(d.from) ? Math.max(0, d.from) : 0;
    const put = (key, per, at) => {
      const v = d[key];
      if (v === undefined) return;
      if (!Array.isArray(v) || v.length % per || from + v.length / per > n.max) throw new BadCommand(`crowd ${key}: ${per} number${per > 1 ? 's' : ''} for each Mosh, within max`);
      for (let j = 0; j < v.length / per; j++) for (let c = 0; c < per; c++) D.num[(from + j) * F + at + c] = num(v[j * per + c], -BIG, BIG, CROWD_DEFAULTS[at + c]);
    };
    put('pos', 3, 0);
    for (let k = 3; k < F; k++) put(CROWD_NUMBERS[k], 1, k);
    for (const key of ['color', 'dark', 'hat']) {
      const v = d[key];
      if (v === undefined) continue;
      if (!Array.isArray(v) || from + v.length > n.max) throw new BadCommand(`crowd ${key}: a color for each Mosh, within max`);
      for (let j = 0; j < v.length; j++) D[key][from + j] = v[j] === null ? null : color(v[j]);
    }
    if (Number.isInteger(d.shown)) D.shown = Math.max(0, Math.min(n.max, d.shown));
    n.crowd.begin();
    for (let i = 0; i < D.shown; i++) {
      const o = i * F;
      const c = D.color[i] ?? '#ffffff';
      n.crowd.add({
        x: D.num[o],
        y: D.num[o + 1],
        z: D.num[o + 2],
        yaw: D.num[o + 3],
        scale: D.num[o + 4],
        sway: D.num[o + 5],
        bounce: D.num[o + 6],
        step: D.num[o + 7],
        arms: D.num[o + 8],
        reach: D.num[o + 9],
        spin: D.num[o + 10],
        color: c,
        dark: D.dark[i] ?? c,
        hat: D.hat[i] ?? null,
      });
    }
    n.crowd.end();
  }

  // parent: a group, or an avatar with part (see AVATAR_PARTS), which then carries the node as it
  // moves (a hat on its head, a flag in its hand).
  reparent(n, parentId, part) {
    let parent = this.scene;
    if (parentId !== null) {
      const pn = this.node(parentId);
      if (pn.kind === 'avatar') {
        const of = AVATAR_PARTS[part ?? 'torso'];
        if (!of) throw new BadCommand(`an avatar's part is one of ${Object.keys(AVATAR_PARTS).join(', ')}`);
        parent = of(pn.avatar);
      } else if (pn.kind === 'group') {
        parent = pn.obj;
      } else {
        throw new BadCommand('only groups and avatars can have children');
      }
      // No loops: the new parent can't be this node or anything under it.
      for (let o = parent; o; o = o.parent) if (o === n.obj) throw new BadCommand('a node cannot be inside itself');
    }
    parent.add(n.obj);
  }

  setGeometry(n, geometry, own) {
    if (n.ownGeometry) {
      this.vertices -= counted(n.ownGeometry);
      n.ownGeometry.dispose();
    }
    n.ownGeometry = own ? geometry : null;
    n.obj.geometry = geometry;
  }

  // Removes a node and everything under it.
  remove(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.obj.removeFromParent();
    n.obj.traverse((o) => {
      const sub = this.nodes.get(o.userData.mmId);
      if (sub && o.userData.mmId !== undefined) this.forget(o.userData.mmId, sub);
      if (o.userData.mmBaked) {
        this.vertices -= o.geometry.attributes.position.count;
        o.geometry.dispose();
        o.userData.mmBakedMaterial?.dispose();
      }
    });
  }

  forget(id, n) {
    this.nodes.delete(id);
    if (n.glide) this.gliding.delete(n.glide);
    if (n.instances) {
      this.instances -= n.count;
      this.instanceVertices -= n.vertices;
      this.instanceSets.delete(n.instances);
      n.instances.mesh.material.dispose();
      n.instances.shell?.material.dispose();
      n.instances.mesh.dispose();
      n.instances.shell?.dispose();
    }
    if (n.ownGeometry) {
      this.vertices -= counted(n.ownGeometry);
      n.ownGeometry.dispose();
    }
    if (n.avatar) n.avatar.dispose();
    if (n.crowd) {
      this.crowdCount -= n.max;
      for (const p of n.crowd.parts) {
        p.mesh.material.dispose();
        p.mesh.dispose();
        p.shell?.material.dispose();
        p.shell?.dispose();
      }
    }
    if (n.kind === 'line') {
      this.vertices -= n.obj.geometry.attributes.position?.count ?? 0;
      n.obj.geometry.dispose();
      n.obj.material.dispose();
    }
    if (n.kind === 'mist') {
      this.mists.delete(n.obj.material);
      n.obj.material.dispose();
    }
    if (n.label) {
      // A label's element only leaves the page by itself when the label is the node removed.
      n.label.remove();
      this.labels--;
    }
  }

  // ---- resources --------------------------------------------------------------------------

  shape(spec) {
    const key = JSON.stringify(spec);
    let g = this.shapeCache.get(key);
    if (!g) {
      if (this.shapeCache.size > 500) throw new BadCommand('too many different shapes');
      g = shapeGeometry(spec);
      g.userData.shared = true;
      this.shapeCache.set(key, g);
    }
    return g;
  }

  colorMaterial(c) {
    let m = this.colorCache.get(c);
    if (!m) {
      m = toon(c);
      m.userData.shared = true;
      this.colorCache.set(c, m);
    }
    return m;
  }

  materialRef(m) {
    if (typeof m === 'string') return this.colorMaterial(color(m));
    return this.resource(m, 'material');
  }

  makeMaterial(p) {
    const opts = {};
    if (p.texture !== undefined) {
      let tex = this.resource(p.texture, 'texture');
      if (Array.isArray(p.repeat)) {
        tex = tex.clone();
        tex.repeat.set(num(p.repeat[0], 0.001, 1000, 1), num(p.repeat[1], 0.001, 1000, 1));
        tex.needsUpdate = true;
      }
      opts.map = tex;
    }
    const c = color(p.color);
    const mat = p.unlit ? new THREE.MeshBasicMaterial({ color: c, ...opts }) : toon(c, opts);
    if (opts.map && opts.map !== this.resources.get(p.texture)?.value) mat.userData.ownMap = true;
    this.applyMaterialProps(mat, p);
    if (p.outline === false) noOutline(mat);
    return mat;
  }

  applyMaterialProps(mat, p) {
    if (p.color !== undefined) mat.color.set(color(p.color));
    if (p.opacity !== undefined || p.transparent !== undefined) {
      const opacity = num(p.opacity, 0, 1, mat.opacity);
      mat.transparent = p.transparent === true || opacity < 1 || mat.transparent;
      mat.opacity = opacity;
    }
    if (p.depthWrite !== undefined) mat.depthWrite = p.depthWrite !== false;
    // alphaTest: the parts of a texture less opaque than this aren't drawn at all (a net, leaves).
    if (p.alphaTest !== undefined) mat.alphaTest = num(p.alphaTest, 0, 1, 0);
    if (p.side !== undefined) mat.side = p.side === 'double' ? THREE.DoubleSide : p.side === 'back' ? THREE.BackSide : THREE.FrontSide;
    if (p.emissive !== undefined && mat.emissive) mat.emissive.set(color(p.emissive, '#000000'));
    if (p.blending !== undefined) mat.blending = p.blending === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.needsUpdate = true;
  }

  // .set() on a material (its color, opacity, ...) or a geometry ({ positions }: new places for
  // the same vertices, for things that ripple or bend; its normals follow).
  updateResource(id, p) {
    const r = this.resources.get(id);
    if (r?.kind === 'material') return this.applyMaterialProps(r.value, p);
    if (r?.kind !== 'geometry') throw new BadCommand(`no material or geometry ${id}`);
    const attr = r.value.attributes.position;
    const pos = numbers(p.positions, attr.array.length, 'positions');
    if (pos.length !== attr.array.length) throw new BadCommand(`positions: the geometry has ${attr.count} vertices`);
    attr.array.set(pos);
    attr.needsUpdate = true;
    r.value.computeVertexNormals();
    r.value.computeBoundingSphere();
  }

  makeTexture(width, height, ops, options) {
    const w = Math.round(num(width, 1, LIMITS.textureSize, 64));
    const h = Math.round(num(height, 1, LIMITS.textureSize, 64));
    if (!Array.isArray(ops) || ops.length > LIMITS.textureOps) throw new BadCommand('texture drawing too long');
    if (this.textures >= LIMITS.textures) throw new BadCommand('too many textures');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    for (const op of ops) {
      if (!Array.isArray(op)) continue;
      const [name, ...args] = op;
      if (name === '=') {
        const [prop, value] = args;
        if (!CANVAS_PROPS.has(prop)) continue;
        if (Array.isArray(value)) g[prop] = this.gradient(g, value);
        else if (typeof value === 'string') g[prop] = value.slice(0, 64);
        else if (typeof value === 'number' && Number.isFinite(value)) g[prop] = value;
        continue;
      }
      if (!CANVAS_METHODS.has(name)) continue;
      if (name === 'setLineDash') {
        g.setLineDash(Array.isArray(args[0]) ? args[0].slice(0, 16).map((v) => num(v, 0, 1e4, 0)) : []);
        continue;
      }
      if (name === 'roundRect') {
        const r = args[4];
        const radii = Array.isArray(r) ? r.slice(0, 4).map((v) => num(v, 0, 1e4, 0)) : num(r, 0, 1e4, 0);
        g.roundRect(...args.slice(0, 4).map((v) => num(v, -1e4, 1e4, 0)), radii);
        continue;
      }
      const text = name === 'fillText' || name === 'strokeText';
      const clean = args.slice(0, 9).map((v, i) => (text && i === 0 ? String(v).slice(0, 60) : num(v, -1e4, 1e4, 0)));
      if (name === 'arc' || name === 'ellipse') {
        // Negative radii make the canvas throw.
        if (name === 'arc') clean[2] = Math.abs(clean[2]);
        else (clean[2] = Math.abs(clean[2])), (clean[3] = Math.abs(clean[3]));
        if (args.length > (name === 'arc' ? 5 : 7)) clean[name === 'arc' ? 5 : 7] = args[name === 'arc' ? 5 : 7] === true;
      }
      g[name](...clean);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (options?.repeat !== false) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (options?.pixelated === true) tex.magFilter = THREE.NearestFilter;
    // How sharp it stays seen at a low angle (a floor stretching away).
    tex.anisotropy = Math.round(num(options?.anisotropy, 1, 16, 4));
    this.textures++;
    return tex;
  }

  gradient(g, spec) {
    const [kind, ...rest] = spec;
    const stops = Array.isArray(rest.at(-1)) ? rest.pop() : [];
    const n = rest.map((v) => num(v, -1e4, 1e4, 0));
    let grad;
    if (kind === 'linear' && n.length === 4) grad = g.createLinearGradient(...n);
    else if (kind === 'radial' && n.length === 6) grad = g.createRadialGradient(n[0], n[1], Math.abs(n[2]), n[3], n[4], Math.abs(n[5]));
    else return '#000000';
    for (const s of stops.slice(0, 16)) {
      if (Array.isArray(s)) grad.addColorStop(num(s[0], 0, 1, 0), color(s[1], '#000000'));
    }
    return grad;
  }

  makeGeometry(d) {
    if (!d || typeof d !== 'object') throw new BadCommand('geometry must be { positions, normals?, uvs?, indices?, groups? }');
    const pos = numbers(d.positions, LIMITS.geometryVertices * 3, 'positions');
    if (pos.length % 3 !== 0 || pos.length === 0) throw new BadCommand('positions: x, y, z for each vertex');
    const count = pos.length / 3;
    if (this.vertices + count > LIMITS.vertices) throw new BadCommand('too much geometry');
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (d.uvs !== undefined) {
      const uv = numbers(d.uvs, count * 2, 'uvs');
      if (uv.length !== count * 2) throw new BadCommand('uvs: u, v for each vertex');
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (d.indices !== undefined) {
      if (!Array.isArray(d.indices) || d.indices.length % 3 !== 0 || d.indices.length > LIMITS.geometryVertices * 6) throw new BadCommand('indices: three per triangle');
      for (const i of d.indices) if (!Number.isInteger(i) || i < 0 || i >= count) throw new BadCommand('indices: whole numbers below the vertex count');
      geo.setIndex(d.indices);
    }
    if (d.normals !== undefined) {
      const nor = numbers(d.normals, count * 3, 'normals');
      if (nor.length !== count * 3) throw new BadCommand('normals: x, y, z for each vertex');
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    } else {
      geo.computeVertexNormals();
    }
    // morphs: shapes to blend toward, each an offset for every vertex (x, y, z), added in
    // proportion to a mesh's morph weights (a rope swinging, a flag waving between two shapes).
    let extra = 0;
    if (d.morphs !== undefined) {
      if (!Array.isArray(d.morphs) || d.morphs.length > 8) throw new BadCommand('morphs: at most 8');
      geo.morphAttributes.position = d.morphs.map((m) => {
        const off = numbers(m, count * 3, 'morphs');
        if (off.length !== count * 3) throw new BadCommand('morphs: x, y, z for each vertex, in each');
        return new THREE.BufferAttribute(off, 3);
      });
      geo.morphTargetsRelative = true;
      extra = count * d.morphs.length;
      if (this.vertices + count + extra > LIMITS.vertices) throw new BadCommand('too much geometry');
    }
    if (d.groups !== undefined) {
      if (!Array.isArray(d.groups) || d.groups.length > 32) throw new BadCommand('groups: at most 32');
      const total = geo.index ? geo.index.count : count;
      for (const gr of d.groups) {
        const [start, n, mat] = Array.isArray(gr) ? gr : [];
        if (![start, n, mat].every(Number.isInteger) || start < 0 || n < 0 || start + n > total || mat < 0 || mat > 31) throw new BadCommand('groups: [start, count, materialIndex]');
        geo.addGroup(start, n, mat);
      }
    }
    this.vertices += count + extra;
    geo.userData.mmVertices = count + extra;
    return geo;
  }

  // ---- baking: merge everything under a group into one mesh (one draw call per material) ----

  // { colors: true } also merges every mesh in a plain color (no texture, opaque, not glowing) into
  // one vertex-colored mesh: a model in many colors drawn in one go.
  bake(id, opts = {}) {
    const group = this.node(id);
    if (group.kind !== 'group') throw new BadCommand('only groups can be baked');
    const root = group.obj;
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map(); // material -> { pos, nor, uv, col }
    const colored = opts.colors === true ? toon('#ffffff', { vertexColors: true }) : null;
    const plain = (mat) => mat.isMeshToonMaterial && !mat.map && !mat.transparent && mat.opacity === 1 && mat.emissive.getHex() === 0 && mat.side === THREE.FrontSide && mat.vertexColors !== true && !mat.userData.outlineParameters;
    const m = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const v = new THREE.Vector3();
    let cast = false;
    let receive = false;
    const meshes = [];
    root.traverse((o) => {
      if (o !== root && o.isMesh && o.visible && (o.userData.mmBaked || this.nodes.get(o.userData.mmId)?.kind === 'mesh')) meshes.push(o);
    });
    for (const mesh of meshes) {
      m.multiplyMatrices(inverse, mesh.matrixWorld);
      nm.getNormalMatrix(m);
      const geo = mesh.geometry;
      const P = geo.attributes.position;
      const N = geo.attributes.normal;
      const U = geo.attributes.uv;
      const index = geo.index;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : P.count, materialIndex: 0 }];
      cast ||= mesh.castShadow;
      receive ||= mesh.receiveShadow;
      for (const gr of groups) {
        const mat = mats[gr.materialIndex] ?? mats[0];
        const into = colored && plain(mat) ? colored : mat;
        let b = buckets.get(into);
        if (!b) buckets.set(into, (b = { pos: [], nor: [], uv: [], col: [] }));
        const c = into === colored ? mat.color : null;
        const end = Math.min(gr.start + gr.count, index ? index.count : P.count);
        for (let k = gr.start; k < end; k++) {
          const i = index ? index.getX(k) : k;
          v.fromBufferAttribute(P, i).applyMatrix4(m);
          b.pos.push(v.x, v.y, v.z);
          if (N) v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
          else v.set(0, 1, 0);
          b.nor.push(v.x, v.y, v.z);
          if (U) b.uv.push(U.getX(i), U.getY(i));
          else b.uv.push(0, 0);
          if (c) b.col.push(c.r, c.g, c.b);
          else b.col.push(1, 1, 1);
        }
      }
    }
    // Everything that was under the group goes (the sandbox has already forgotten those nodes).
    for (const child of [...root.children]) {
      child.removeFromParent();
      child.traverse((o) => {
        const n = this.nodes.get(o.userData.mmId);
        if (n) this.forget(o.userData.mmId, n);
        if (o.userData.mmBaked) {
          this.vertices -= o.geometry.attributes.position.count;
          o.geometry.dispose();
          o.userData.mmBakedMaterial?.dispose();
        }
      });
    }
    if (!buckets.size) {
      colored?.dispose();
      return;
    }
    const geometry = new THREE.BufferGeometry();
    const materials = [];
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    for (const [mat, b] of buckets) {
      geometry.addGroup(pos.length / 3, b.pos.length / 3, materials.length);
      materials.push(mat);
      for (const x of b.pos) pos.push(x);
      for (const x of b.nor) nor.push(x);
      for (const x of b.uv) uv.push(x);
      for (const x of b.col) col.push(x);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (buckets.has(colored)) geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    else colored?.dispose();
    this.vertices += pos.length / 3;
    const merged = new THREE.Mesh(geometry, materials);
    merged.userData.mmBaked = true;
    if (buckets.has(colored)) merged.userData.mmBakedMaterial = colored;
    merged.castShadow = cast;
    merged.receiveShadow = receive;
    root.add(merged);
  }

  // ---- camera, world, effects -------------------------------------------------------------

  // The camera glides like a node (its position and the point it looks at), unless snap: true
  // or smooth: false.
  setCamera(p) {
    const cam = this.camera;
    if (p.safe !== undefined) {
      // true: the part of the screen the HUD leaves free; { top, bottom, left, right }: px in from each edge.
      const box = p.safe && typeof p.safe === 'object' ? p.safe : null;
      this.safeCamera = box ? { top: num(box.top, 0, 4000, 0), bottom: num(box.bottom, 0, 4000, 0), left: num(box.left, 0, 4000, 0), right: num(box.right, 0, 4000, 0) } : p.safe === true;
    }
    if (p.fov !== undefined) {
      const fov = num(p.fov, 10, 120, cam.fov);
      if (fov !== cam.fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
    const fresh = !this.cameraGlide;
    // The point it looks at rides along as the "position" of a stand-in object.
    const c = (this.cameraGlide ??= { glide: new Glide(cam), look: new THREE.Object3D(), lookGlide: null, smooth: true });
    c.lookGlide ??= new Glide(c.look);
    if (p.smooth !== undefined) c.smooth = p.smooth !== false;
    const pos = p.pos !== undefined ? tmpPos.fromArray(vec3(p.pos, [0, 5, 10])) : null;
    const look = p.look !== undefined ? new THREE.Vector3().fromArray(vec3(p.look, [0, 0, 0])) : null;
    if (fresh || p.snap === true || !c.smooth || !this.glideMs) {
      if (pos) c.glide.toPos.copy(pos);
      if (look) c.lookGlide.toPos.copy(look);
      c.glide.snap(this.clock);
      c.lookGlide.snap(this.clock);
      this.gliding.delete(c.glide);
      this.gliding.delete(c.lookGlide);
    } else {
      if (pos && c.glide.aim(pos, null, null, this.clock)) this.gliding.add(c.glide);
      if (look && c.lookGlide.aim(look, null, null, this.clock)) this.gliding.add(c.lookGlide);
    }
    cam.lookAt(c.look.position);
  }

  // Each part of the world can be added once: { sky, lights: { shadowSize }, clouds: {...},
  // water: { y }, background, fog: [color, near, far] }.
  world(o) {
    const once = (key) => !this.worldDone.has(key) && this.worldDone.add(key);
    if (o.sky && once('sky')) this.sky = addSky(this.scene);
    if (o.lights && once('lights')) {
      const l = o.lights;
      const sun = addLights(this.scene, { shadowSize: num(l.shadowSize, 4, 200, 20) });
      this.sun = sun;
      // Moods other than daylight: the sky and ground light, and the sun's color, strength and
      // place (relative to the middle of the scene).
      const hemi = this.scene.children.find((c) => c.isHemisphereLight);
      if (l.sky !== undefined) hemi.color.set(color(l.sky));
      if (l.ground !== undefined) hemi.groundColor.set(color(l.ground));
      if (l.ambient !== undefined) hemi.intensity = num(l.ambient, 0, 10, hemi.intensity);
      if (l.sun !== undefined) sun.color.set(color(l.sun));
      if (l.sunIntensity !== undefined) sun.intensity = num(l.sunIntensity, 0, 10, sun.intensity);
      if (l.sunPos !== undefined) sun.position.fromArray(vec3(l.sunPos, [14, 30, 10]));
      if (l.shadows === false) sun.castShadow = false;
    }
    if (o.clouds && once('clouds')) {
      const c = o.clouds;
      const minRadius = num(c.minRadius, 0, 400, 70);
      const minY = num(c.minY, -100, 200, 8);
      // spots: [[x, y, z], ...] puts each cloud where the game says (along a course, say)
      // instead of in a ring.
      const spots = Array.isArray(c.spots) ? c.spots.slice(0, LIMITS.clouds).map((v) => new THREE.Vector3().fromArray(vec3(v, [0, 20, 0]))) : null;
      this.clouds = addClouds(this.scene, {
        count: spots ? spots.length : Math.round(num(c.count, 0, 40, 14)),
        minRadius,
        maxRadius: num(c.maxRadius, minRadius, 400, 170),
        minY,
        maxY: num(c.maxY, minY, 200, 50),
        place: spots ? (i) => spots[i] : undefined,
      });
      // drift: [min, max]: each cloud drifts sideways (along x) at its own speed in that range,
      // either way, coming back round at x = ±wrap (instead of the ring slowly turning); scale:
      // [min, max] sizes them.
      const range = (v) => (Array.isArray(v) && v.length === 2 ? [num(v[0], 0, 100, 0), num(v[1], 0, 100, 0)] : null);
      const drift = range(c.drift);
      const scale = range(c.scale);
      for (const cloud of this.clouds.group.children) {
        if (drift) cloud.userData.drift = (Math.random() < 0.5 ? -1 : 1) * (drift[0] + Math.random() * (drift[1] - drift[0]));
        if (scale) cloud.scale.setScalar(Math.max(0.01, scale[0] + Math.random() * (scale[1] - scale[0])));
      }
      this.cloudWrap = drift ? num(c.wrap, 1, 1000, 80) : null;
    }
    if (o.backdrop && once('backdrop')) {
      const b = o.backdrop;
      const stops = (Array.isArray(b.stops) ? b.stops : [])
        .filter((st) => Array.isArray(st) && Number.isFinite(st[0]) && COLOR.test(String(st[1])))
        .slice(0, 6)
        .map(([h, c]) => [num(h, 0, 1, 0), c]);
      if (stops.length >= 2) {
        const size = Array.isArray(b.size) ? b.size : [];
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(num(size[0], 10, 4000, 900), num(size[1], 10, 4000, 500)), backdropMaterial(stops, num(b.top, 0.01, 1e5, 100), Array.isArray(b.stars) ? [num(b.stars[0], 0, 1, 0), num(b.stars[1], 0, 1, 0)] : null));
        mesh.renderOrder = -1;
        this.scene.add(mesh);
        this.backdrop = { mesh, z: num(b.z, -1e4, 1e4, -150) };
      }
    }
    if (o.water && once('water')) this.water = addWater(this.scene, num(o.water.y, -1000, 1000, 0));
    if (o.stars && once('stars')) {
      // Points of light all round, above the horizon, the same size however far.
      const s = o.stars;
      const count = Math.round(num(s.count, 1, LIMITS.stars, 500));
      const radius = num(s.radius, 10, 1000, 150);
      const pos = [];
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = 0.15 + Math.random() * 1.2;
        pos.push(Math.cos(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.sin(a) * Math.cos(e) * radius);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.scene.add(new THREE.Points(geo, noOutline(new THREE.PointsMaterial({ color: color(s.color, '#ffffff'), size: num(s.size, 0.5, 8, 1.4), sizeAttenuation: false }))));
    }
    if (o.background !== undefined && once('background')) this.scene.background = new THREE.Color(color(o.background));
    if (Array.isArray(o.fog) && once('fog')) this.scene.fog = new THREE.Fog(color(o.fog[0]), num(o.fog[1], 0, 1e4, 50), num(o.fog[2], 0, 1e4, 300));
  }

  // mm.sun({ pos, target }): moves the sun and the middle of its shadows, for a scene bigger than
  // its shadow box (keep it on the action). Without mm.world({ lights }) there's no sun to move.
  moveSun(o) {
    if (!this.sun) return;
    if (o.pos !== undefined) this.sun.position.fromArray(vec3(o.pos, [14, 30, 10]));
    if (o.target !== undefined) this.sun.target.position.fromArray(vec3(o.target, [0, 0, 0]));
  }

  burst(o) {
    if (!this.particles) this.particles = new Particles(this.scene, 400);
    const [x, y, z] = vec3(o.pos, [0, 0, 0]);
    const colors = (Array.isArray(o.colors) ? o.colors : []).filter((c) => typeof c === 'string' && COLOR.test(c)).slice(0, 8);
    this.particles.burst(x, y, z, {
      count: Math.round(num(o.count, 1, LIMITS.burstCount, 12)),
      speed: num(o.speed, 0, 50, 6),
      up: num(o.up, -50, 50, 2),
      life: num(o.life, 0.05, 5, 0.5),
      size: num(o.size, 0.01, 2, 0.18),
      gravity: num(o.gravity, -100, 100, 6),
      colors: colors.length ? colors : ['#ffffff'],
    });
  }

  // A ring spreading out over the water: { pos, size, life }.
  ripple(o) {
    this.ripples ??= new Ripples(this.scene);
    if (this.ripples.active.length >= LIMITS.ripples) return;
    const [x, y, z] = vec3(o.pos, [0, 0, 0]);
    this.ripples.spawn(x, y, z, { size: num(o.size, 0.1, 50, 3), life: num(o.life, 0.1, 5, 1.2) });
  }

  // ---- per frame and cleanup --------------------------------------------------------------

  // With mm.camera({ safe: true }) the picture is framed on the part of the screen the HUD
  // doesn't cover: the camera looks at the middle of that area and fov spans its height. The
  // scene still shows behind the HUD. safe: { top, bottom, left, right } frames it on the part
  // of the screen that many px in from each edge instead.
  frameSafe() {
    const cam = this.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const box = typeof this.safeCamera === 'object' ? this.safeCamera : null;
    if (!this.safeCamera || (!box && !this.safe)) {
      if (cam.view?.enabled) {
        cam.clearViewOffset();
        cam.aspect = W / H;
        cam.updateProjectionMatrix();
      }
      return;
    }
    const { top, left, width, height } = box
      ? { top: box.top, left: box.left, width: Math.max(1, W - box.left - box.right), height: Math.max(1, H - box.top - box.bottom) }
      : this.safe;
    cam.aspect = width / height;
    cam.setViewOffset(width, height, width / 2 - (left + width / 2), height / 2 - (top + height / 2), W, H);
  }

  tick(dt) {
    for (const g of this.gliding) if (!g.step(this.clock)) this.gliding.delete(g);
    for (const set of this.instanceSets) set.step(this.clock, dt);
    if (this.cameraGlide) this.camera.lookAt(this.cameraGlide.look.position);
    // The sky moves along with the camera across the ground (not up: a climb's sky still changes
    // with height), so a camera far from the middle never sees past its far side.
    this.sky?.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.frameSafe();
    for (const n of this.nodes.values()) {
      if (!n.avatar) continue;
      n.avatar.update(dt, n.mode, n.speed);
      if (n.lean) n.avatar.torso.rotation.z += n.lean;
    }
    this.particles?.update(dt);
    this.ripples?.update(dt);
    if (this.cloudWrap !== null && this.clouds) {
      const w = this.cloudWrap;
      for (const cloud of this.clouds.group.children) {
        cloud.position.x += (cloud.userData.drift ?? 0) * dt;
        if (cloud.position.x > w) cloud.position.x = -w;
        if (cloud.position.x < -w) cloud.position.x = w;
      }
    } else this.clouds?.update(dt);
    this.time += dt;
    this.water?.update(this.time);
    for (const m of this.mists) m.uniforms.uTime.value = this.time;
    if (this.backdrop) {
      // It stays behind the point the camera looks at, coloured by that point's height.
      const look = this.cameraGlide?.look.position;
      const u = this.backdrop.mesh.material.uniforms;
      this.backdrop.mesh.position.set(look?.x ?? 0, look?.y ?? 0, this.backdrop.z);
      u.uCamY.value = look?.y ?? 0;
      u.uTime.value = this.time;
    }
  }

  // Frees what disposeScene() leaves alone: cached shapes and colors, and the game's materials,
  // textures and geometries (everything else in the scene goes with disposeScene()).
  dispose() {
    stopSounds();
    for (const g of this.shapeCache.values()) g.dispose();
    for (const m of this.colorCache.values()) m.dispose();
    for (const r of this.resources.values()) {
      if (r.kind === 'material' && r.value.userData.ownMap) r.value.map?.dispose();
      r.value.dispose();
    }
    this.ripples?.geo.dispose();
    if (this.backdrop) {
      this.backdrop.mesh.geometry.dispose();
      this.backdrop.mesh.material.dispose();
    }
    this.shapeCache.clear();
    this.colorCache.clear();
    this.nodes.clear();
    this.resources.clear();
  }
}

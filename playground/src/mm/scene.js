import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Avatar } from '../avatar.js';
import { addClouds, addLights, addSky, noOutline, toon } from '../gfx.js';
import { Particles } from '../particles.js';
import { sfx } from '../sfx.js';

// Carries out the drawing commands a packaged minigame's view.js records (see
// shared/mm/prelude-view.js) with three.js. Everything coming out of the sandbox is untrusted:
// every command is checked, numbers are clamped, colors must be hex, text is only ever text,
// and there are caps on how much a game can create.

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
  segments: 128,
};
const COLOR = /^#[0-9a-f]{3,8}$/i;
const AVATAR_MODES = new Set(['idle', 'happy', 'run', 'jump', 'fall', 'stuck', 'swim', 'balance', 'sleep', 'cheer']);
const LABEL_TONES = new Set(['good', 'great', 'bad']);
const SOUNDS = new Set(Object.keys(sfx));
const CANVAS_PROPS = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline']);
const CANVAS_METHODS = new Set([
  'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
  'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'fillText', 'strokeText',
]);

class BadCommand extends Error {}

const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const color = (v, def = '#ffffff') => (typeof v === 'string' && COLOR.test(v) ? v : def);
const BIG = 1e5;

function vec3(v, def) {
  if (!Array.isArray(v) || v.length !== 3) return def;
  return [num(v[0], -BIG, BIG, 0), num(v[1], -BIG, BIG, 0), num(v[2], -BIG, BIG, 0)];
}

function shapeGeometry(s) {
  if (!Array.isArray(s)) throw new BadCommand('shape must be an array like ["box", w, h, d]');
  const [kind, ...p] = s;
  const n = (i, def) => num(p[i], 0.0001, 1e4, def);
  const seg = (i, def) => Math.round(num(p[i], 1, LIMITS.segments, def));
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(n(0, 1), n(1, 1), n(2, 1));
    case 'sphere':
      return new THREE.SphereGeometry(n(0, 1), seg(1, 24), seg(2, 16));
    case 'cylinder':
      return new THREE.CylinderGeometry(num(p[0], 0, 1e4, 1), num(p[1], 0, 1e4, 1), n(2, 1), seg(3, 24));
    case 'cone':
      return new THREE.ConeGeometry(n(0, 1), n(1, 1), seg(2, 24));
    case 'plane':
      return new THREE.PlaneGeometry(n(0, 1), n(1, 1));
    case 'circle':
      return new THREE.CircleGeometry(n(0, 1), seg(1, 32));
    case 'ring':
      return new THREE.RingGeometry(n(0, 0.5), n(1, 1), seg(2, 32));
    case 'torus':
      return new THREE.TorusGeometry(n(0, 1), n(1, 0.3), seg(2, 12), seg(3, 32), num(p[4], 0.01, Math.PI * 2, Math.PI * 2));
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(n(0, 1), Math.round(num(p[1], 0, 4, 0)));
    case 'capsule':
      return new THREE.CapsuleGeometry(n(0, 0.5), n(1, 1), seg(2, 8), seg(3, 16));
    default:
      throw new BadCommand(`unknown shape "${String(kind).slice(0, 20)}"`);
  }
}

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
  constructor(scene, camera, { hud, onBadCommand }) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.onBadCommand = onBadCommand;
    this.nodes = new Map(); // id -> { obj, kind, ownGeometry, avatar, mode, speed, label }
    this.resources = new Map(); // id -> { kind, value }
    this.shapeCache = new Map();
    this.colorCache = new Map();
    this.vertices = 0;
    this.textures = 0;
    this.labels = 0;
    this.worldDone = new Set();
    this.particles = null;
    this.clouds = null;
    this.badCount = 0;
    this.safe = null; // the part of the screen the HUD doesn't cover (set by the host each frame)
    this.safeCamera = false;
  }

  // ---- applying commands ------------------------------------------------------------------

  apply(commands) {
    if (!Array.isArray(commands)) return;
    if (commands.length > LIMITS.commandsPerFrame * 4) throw new Error(`too many drawing commands (${commands.length})`);
    let sounds = 0;
    for (const c of commands) {
      try {
        if (!Array.isArray(c)) throw new BadCommand('not a command');
        const [op, a, b, d, e, f] = c;
        if (op === 'new') this.create(a, b, d ?? {});
        else if (op === 'set') this.update(this.node(a), b ?? {});
        else if (op === 'del') this.remove(a);
        else if (op === 'mat') this.addResource(a, 'material', this.makeMaterial(b ?? {}));
        else if (op === 'rset') this.updateMaterial(a, b ?? {});
        else if (op === 'tex') this.addResource(a, 'texture', this.makeTexture(b, d, e, f));
        else if (op === 'geo') this.addResource(a, 'geometry', this.makeGeometry(b));
        else if (op === 'free') this.free(a);
        else if (op === 'bake') this.bake(a);
        else if (op === 'camera') this.setCamera(a ?? {});
        else if (op === 'world') this.world(a ?? {});
        else if (op === 'burst') this.burst(a ?? {});
        else if (op === 'sound') {
          if (sounds++ < LIMITS.soundsPerFrame && SOUNDS.has(a)) {
            const args = (Array.isArray(b) ? b : []).slice(0, 3).filter((x) => typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)));
            sfx[a](...args.map((x) => (typeof x === 'number' ? Math.max(-100, Math.min(100, x)) : x)));
          }
        } else if (op === 'hud') this.hud.apply(a, b, d);
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
    if (r.kind === 'geometry') this.vertices -= r.value.attributes.position.count;
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
    } else if (kind === 'mesh') {
      n.obj = new THREE.Mesh(this.shape(['box', 1, 1, 1]), this.colorMaterial('#ffffff'));
    } else if (kind === 'avatar') {
      n.avatar = new Avatar(color(props.color, '#ff5c8a'));
      n.obj = n.avatar.group;
      n.mode = 'idle';
      n.speed = 0;
    } else if (kind === 'label') {
      if (this.labels >= LIMITS.labels) throw new BadCommand('too many labels');
      this.labels++;
      const el = document.createElement('div');
      n.obj = new CSS2DObject(el);
      n.label = el;
    } else {
      throw new BadCommand(`unknown node kind "${String(kind).slice(0, 20)}"`);
    }
    n.obj.userData.mmId = id;
    this.nodes.set(id, n);
    this.scene.add(n.obj);
    this.update(n, props, true);
  }

  update(n, p, fresh = false) {
    const o = n.obj;
    if (p.pos !== undefined) o.position.fromArray(vec3(p.pos, [0, 0, 0]));
    if (p.rot !== undefined) o.rotation.fromArray(vec3(p.rot, [0, 0, 0]));
    if (p.scale !== undefined) {
      if (typeof p.scale === 'number') o.scale.setScalar(num(p.scale, 0.0001, 1e4, 1));
      else o.scale.fromArray(vec3(p.scale, [1, 1, 1]).map((v) => (Math.abs(v) < 0.0001 ? 0.0001 : v)));
    }
    if (p.visible !== undefined) o.visible = p.visible !== false;
    if (p.parent !== undefined) this.reparent(n, p.parent);

    if (n.kind === 'mesh') {
      if (p.shape !== undefined) this.setGeometry(n, this.shape(p.shape), false);
      if (p.geometry !== undefined) {
        if (Number.isInteger(p.geometry)) this.setGeometry(n, this.resource(p.geometry, 'geometry'), false);
        else this.setGeometry(n, this.makeGeometry(p.geometry), true);
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
    } else if (n.kind === 'avatar') {
      if (p.color !== undefined) n.avatar.setColor(color(p.color, '#ff5c8a'));
      if (p.mode !== undefined && AVATAR_MODES.has(p.mode)) n.mode = p.mode;
      if (p.speed !== undefined) n.speed = num(p.speed, 0, 50, 0);
      if (p.crown !== undefined) n.avatar.setCrown(p.crown === true);
      if (p.shadow !== undefined) {
        const s = p.shadow;
        n.obj.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = s === true || s === 'cast';
          o.receiveShadow = s === true || s === 'receive';
        });
      }
    } else if (n.kind === 'label') {
      const el = n.label;
      if (p.text !== undefined) el.textContent = String(p.text).slice(0, 60);
      if (p.style !== undefined || p.tone !== undefined || fresh) {
        n.style = p.style ?? n.style ?? 'tag';
        n.tone = p.tone ?? n.tone;
        el.className = n.style === 'float' ? `stack-float${LABEL_TONES.has(n.tone) ? ` ${n.tone}` : ''}` : 'nametag in-game';
      }
      if (p.color !== undefined) el.style.setProperty('--c', color(p.color, '#999999'));
      if (p.opacity !== undefined) el.style.opacity = String(num(p.opacity, 0, 1, 1));
    }
  }

  reparent(n, parentId) {
    let parent = this.scene;
    if (parentId !== null) {
      const pn = this.node(parentId);
      if (pn.kind !== 'group') throw new BadCommand('only groups can have children');
      // No loops: the new parent can't be this node or anything under it.
      for (let o = pn.obj; o; o = o.parent) if (o === n.obj) throw new BadCommand('a node cannot be inside itself');
      parent = pn.obj;
    }
    parent.add(n.obj);
  }

  setGeometry(n, geometry, own) {
    if (n.ownGeometry) {
      this.vertices -= n.ownGeometry.attributes.position.count;
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
      }
    });
  }

  forget(id, n) {
    this.nodes.delete(id);
    if (n.ownGeometry) {
      this.vertices -= n.ownGeometry.attributes.position.count;
      n.ownGeometry.dispose();
    }
    if (n.avatar) n.avatar.dispose();
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
    if (p.side !== undefined) mat.side = p.side === 'double' ? THREE.DoubleSide : p.side === 'back' ? THREE.BackSide : THREE.FrontSide;
    if (p.emissive !== undefined && mat.emissive) mat.emissive.set(color(p.emissive, '#000000'));
    mat.needsUpdate = true;
  }

  updateMaterial(id, p) {
    const r = this.resources.get(id);
    if (!r || r.kind !== 'material') throw new BadCommand(`no material ${id}`);
    this.applyMaterialProps(r.value, p);
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
    tex.anisotropy = 4;
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
    if (d.groups !== undefined) {
      if (!Array.isArray(d.groups) || d.groups.length > 32) throw new BadCommand('groups: at most 32');
      const total = geo.index ? geo.index.count : count;
      for (const gr of d.groups) {
        const [start, n, mat] = Array.isArray(gr) ? gr : [];
        if (![start, n, mat].every(Number.isInteger) || start < 0 || n < 0 || start + n > total || mat < 0 || mat > 31) throw new BadCommand('groups: [start, count, materialIndex]');
        geo.addGroup(start, n, mat);
      }
    }
    this.vertices += count;
    return geo;
  }

  // ---- baking: merge everything under a group into one mesh (one draw call per material) ----

  bake(id) {
    const group = this.node(id);
    if (group.kind !== 'group') throw new BadCommand('only groups can be baked');
    const root = group.obj;
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map(); // material -> { pos, nor, uv }
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
        let b = buckets.get(mat);
        if (!b) buckets.set(mat, (b = { pos: [], nor: [], uv: [] }));
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
        }
      });
    }
    if (!buckets.size) return;
    const geometry = new THREE.BufferGeometry();
    const materials = [];
    const pos = [];
    const nor = [];
    const uv = [];
    for (const [mat, b] of buckets) {
      geometry.addGroup(pos.length / 3, b.pos.length / 3, materials.length);
      materials.push(mat);
      for (const x of b.pos) pos.push(x);
      for (const x of b.nor) nor.push(x);
      for (const x of b.uv) uv.push(x);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.vertices += pos.length / 3;
    const merged = new THREE.Mesh(geometry, materials);
    merged.userData.mmBaked = true;
    merged.castShadow = cast;
    merged.receiveShadow = receive;
    root.add(merged);
  }

  // ---- camera, world, effects -------------------------------------------------------------

  setCamera(p) {
    const cam = this.camera;
    if (p.safe !== undefined) this.safeCamera = p.safe === true;
    if (p.pos !== undefined) cam.position.fromArray(vec3(p.pos, [0, 5, 10]));
    if (p.fov !== undefined) {
      const fov = num(p.fov, 10, 120, cam.fov);
      if (fov !== cam.fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
    if (p.look !== undefined) cam.lookAt(...vec3(p.look, [0, 0, 0]));
  }

  // Each part of the world can be added once: { sky, lights: { shadowSize }, clouds: {...},
  // background, fog: [color, near, far] }.
  world(o) {
    const once = (key) => !this.worldDone.has(key) && this.worldDone.add(key);
    if (o.sky && once('sky')) addSky(this.scene);
    if (o.lights && once('lights')) addLights(this.scene, { shadowSize: num(o.lights.shadowSize, 4, 200, 20) });
    if (o.clouds && once('clouds')) {
      const c = o.clouds;
      const minRadius = num(c.minRadius, 0, 400, 70);
      const minY = num(c.minY, -100, 200, 8);
      this.clouds = addClouds(this.scene, {
        count: Math.round(num(c.count, 0, 40, 14)),
        minRadius,
        maxRadius: num(c.maxRadius, minRadius, 400, 170),
        minY,
        maxY: num(c.maxY, minY, 200, 50),
      });
    }
    if (o.background !== undefined && once('background')) this.scene.background = new THREE.Color(color(o.background));
    if (Array.isArray(o.fog) && once('fog')) this.scene.fog = new THREE.Fog(color(o.fog[0]), num(o.fog[1], 0, 1e4, 50), num(o.fog[2], 0, 1e4, 300));
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

  // ---- per frame and cleanup --------------------------------------------------------------

  // With mm.camera({ safe: true }) the picture is framed on the part of the screen the HUD
  // doesn't cover: the camera looks at the middle of that area and fov spans its height. The
  // scene still shows behind the HUD.
  frameSafe() {
    const cam = this.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!this.safeCamera || !this.safe) {
      if (cam.view?.enabled) {
        cam.clearViewOffset();
        cam.aspect = W / H;
        cam.updateProjectionMatrix();
      }
      return;
    }
    const { top, left, width, height } = this.safe;
    cam.aspect = width / height;
    cam.setViewOffset(width, height, width / 2 - (left + width / 2), height / 2 - (top + height / 2), W, H);
  }

  tick(dt) {
    this.frameSafe();
    for (const n of this.nodes.values()) if (n.avatar) n.avatar.update(dt, n.mode, n.speed);
    this.particles?.update(dt);
    this.clouds?.update(dt);
  }

  // Frees what disposeScene() leaves alone: cached shapes and colors, and the game's materials,
  // textures and geometries (everything else in the scene goes with disposeScene()).
  dispose() {
    for (const g of this.shapeCache.values()) g.dispose();
    for (const m of this.colorCache.values()) m.dispose();
    for (const r of this.resources.values()) {
      if (r.kind === 'material' && r.value.userData.ownMap) r.value.map?.dispose();
      r.value.dispose();
    }
    this.shapeCache.clear();
    this.colorCache.clear();
    this.nodes.clear();
    this.resources.clear();
  }
}

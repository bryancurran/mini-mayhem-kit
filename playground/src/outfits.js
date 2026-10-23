import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COSMETICS } from '../../shared/cosmetics.js';
import { noOutline, toon } from './gfx.js';

// The cosmetics players buy (shared/cosmetics.js), drawn on their Mosh. Each is built once in
// the Mosh's torso space (avatar.js: the body is a sphere around BODY_Y, the eyes are at
// y 0.76, the cheeks at 0.57, the antenna rises from the top of the head at 1.12), and copied
// onto every Mosh wearing it. Parts that don't move are merged into one mesh per color, so a
// full outfit stays a handful of draw calls.
//
// Shoes (feet: true) go on each foot instead, built for one side at a time (side -1 is the left),
// around the foot: an egg 0.4 wide, 0.24 tall and 0.54 long, its toe towards +z.
//
// Head things say how much taller the antenna grows to poke out of their top (lift): it always
// shows. The crown (the host's, the leader's) sits on top of them: crowned, where it sits and how
// much the antenna grows to clear it too. Things that move (a cape, wings) have
// animate(obj, avatar, dt, speed, worn) (worn: what avatar.js keeps of it, with a pair of shoes'
// feet).
//
// A buddy (rig: true) floats beside the Mosh instead, built in the space it stands in (its feet at
// the origin), so it doesn't squash and bounce with its body. Trails and celebrations (effect)
// aren't built on the Mosh at all: their marks are left in the world (effects.js has the spec).
//
// Antennas (antenna: true) take the place of the Mosh's own: one or more masts rising from the top
// of the head, each a stem with something on top, starting at base. They're made of what its own
// is made of: stalk (the stand-in stalk material, which avatar.js swaps for the Mosh's own darker
// color) and gold. Head things say how high their top is (top), and fit(obj, cover) grows the
// stems so the antenna's look starts above whatever's on the head.

const BODY_Y = 0.52;
const FOOT_SCALE = [1, 0.6, 1.35]; // how avatar.js squashes its foot spheres (radius 0.2)
const FOOT = { x: 0.2, y: 0.12, z: 0.27 };
const BODY = { x: 0.62, y: 0.651, z: 0.589 };
const radiusAt = (y) => BODY.x * Math.sqrt(Math.max(0, 1 - ((y - BODY_Y) / BODY.y) ** 2));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

// Materials outlive any scene (disposeScene() skips what's marked shared).
const shared = (r) => {
  r.userData.shared = true;
  return r;
};
const mat = (color, extra) => shared(toon(color, extra));

// Collects shapes by material and merges each material's into one mesh under parent.
class Parts {
  constructor(parent) {
    this.parent = parent;
    this.byMaterial = new Map();
  }

  add(geometry, material, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scale),
    );
    const placed = geometry.applyMatrix4(m);
    if (!this.byMaterial.has(material)) this.byMaterial.set(material, []);
    this.byMaterial.get(material).push(placed);
    return this;
  }

  // A round bar (or a flat strap: flat is its thickness, width its radius) from a to b.
  bar(a, b, width, material, flat = null) {
    const from = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...b).sub(from);
    const length = dir.length();
    const geometry = flat ? new THREE.BoxGeometry(width, length, flat) : new THREE.CylinderGeometry(width, width, length, 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const at = from.addScaledVector(dir, 0.5);
    geometry.applyQuaternion(q).translate(at.x, at.y, at.z);
    return this.add(geometry, material);
  }

  done() {
    for (const [material, geometries] of this.byMaterial) {
      const mesh = new THREE.Mesh(shared(mergeGeometries(geometries.map((g) => (g.index ? g.toNonIndexed() : g)))), material);
      mesh.castShadow = true;
      this.parent.add(mesh);
      for (const g of geometries) g.dispose();
    }
    this.byMaterial.clear();
  }
}

// A dome over the top of the head: its rim at y, so wide (a little wider than the head there,
// which is about 0.42 across at y 1), so tall.
const dome = (y, wide, tall) => [
  new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  { at: [0, y, 0], scale: [wide, tall, wide * 0.95] },
];

// Antennas: a mast rises from the top of the head at x, leaning out by lean (radians), a stem so
// long with a group on top (returned) to build the rest in.
const ANTENNA_BASE = 1.12;
const stemGeo = shared(new THREE.CylinderGeometry(0.03, 0.04, 1, 8).translate(0, 0.5, 0));
const stalk = mat('#7a5f8f'); // avatar.js swaps in the Mosh's darker color
stalk.userData.stalk = true;
const bobbleGold = mat('#ffd23d', { emissive: new THREE.Color('#5a3a00') });
function mast(g, { x = 0, lean = 0, stem }) {
  const m = new THREE.Group();
  m.name = 'mast';
  m.position.set(x, ANTENNA_BASE, 0);
  m.rotation.z = x < 0 ? lean : -lean;
  m.userData = { stem, lean: m.rotation.z };
  const s = new THREE.Mesh(stemGeo, stalk);
  s.name = 'stem';
  s.scale.y = stem;
  s.castShadow = true;
  const top = new THREE.Group();
  top.name = 'top';
  top.position.y = stem;
  m.add(s, top);
  g.add(m);
  return top;
}

const masts = (obj) =>
  (obj.userData.masts ??= obj.children
    .filter((m) => m.name === 'mast')
    .map((m) => ({ m, stem: m.getObjectByName('stem'), top: m.getObjectByName('top') })));

// Taller by lift, straight up (a leaning mast grows that much more along itself).
function fitMasts(obj, lift) {
  for (const { m, stem, top } of masts(obj)) {
    const length = m.userData.stem + lift / Math.cos(m.userData.lean);
    stem.scale.y = length;
    top.position.y = length;
  }
}

// They sway and bob like the Mosh's own antenna: a little when it stands about, swept back when it
// runs, flung about when it jumps or hops for joy.
function swayMasts(obj, avatar, dt, speed) {
  const t = avatar.time;
  masts(obj).forEach(({ m }, i) => {
    let side = Math.sin(t * 2 + i * 1.7) * 0.06;
    let back = 0;
    if (avatar.mode === 'run') {
      side = Math.sin(t * 10 + i) * 0.05;
      back = -Math.min(speed, 10) * 0.025;
    } else if (avatar.mode === 'jump') back = -0.25;
    else if (avatar.mode === 'fall') side = Math.sin(t * 22 + i * 2) * 0.3;
    else if (avatar.mode === 'happy' || avatar.mode === 'cheer') side = Math.sin(t * 6.5 + i * 2) * 0.16;
    m.rotation.z = damp(m.rotation.z, m.userData.lean + side, 12, dt);
    m.rotation.x = damp(m.rotation.x, back, 12, dt);
  });
}

// A flat outline through these points ([x, y, how round its corner is]), corners rounded off.
function rounded(points) {
  const shape = new THREE.Shape();
  const at = (i) => new THREE.Vector2(points[(i + points.length) % points.length][0], points[(i + points.length) % points.length][1]);
  points.forEach(([, , r], i) => {
    const corner = at(i);
    const from = corner.clone().add(at(i - 1).sub(corner).setLength(r));
    const to = corner.clone().add(at(i + 1).sub(corner).setLength(r));
    if (i === 0) shape.moveTo(from.x, from.y);
    else shape.lineTo(from.x, from.y);
    shape.quadraticCurveTo(corner.x, corner.y, to.x, to.y);
  });
  shape.closePath();
  return shape;
}

// A flat shape with rounded-off edges, standing up and facing front.
function slab(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2 }).translate(0, 0, -depth / 2);
}

// A coil rising from y 0, so wide, so tall, so many turns: it starts and ends in the middle, to
// meet the stem below and the bobble on top.
class Coil extends THREE.Curve {
  constructor(radius, height, turns) {
    super();
    this.radius = radius;
    this.height = height;
    this.turns = turns;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    const r = this.radius * THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0, 0.12);
    return target.set(Math.cos(a) * r, t * this.height, Math.sin(a) * r);
  }
}

// A horn: a cone so long and wide at its base (at the origin, pointing up), curving round
// towards -x by bend radians along its length.
function horn(length, radius, bend) {
  const geometry = new THREE.ConeGeometry(radius, length, 14, 12).translate(0, length / 2, 0);
  const r0 = length / bend;
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = r0 + pos.getX(i); // from the middle of the bend, at (-r0, 0)
    const a = pos.getY(i) / r0;
    pos.setXY(i, -r0 + r * Math.cos(a), r * Math.sin(a));
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A ring round the body, out from it by out, at y front at the front and back at the back (higher
// at the back, like a collar, so it clears the face and the hands). A point on it at angle a round
// from the front, and the way out from the body there.
function collar(front, back, out) {
  return (a) => {
    const y = (front + back) / 2 + ((front - back) / 2) * Math.cos(a);
    const r = radiusAt(y) + out;
    return new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r * (BODY.z / BODY.x));
  };
}
const collarCurve = (around, from, to, n = 24) =>
  new THREE.CatmullRomCurve3(Array.from({ length: n + 1 }, (_, i) => around(from + ((to - from) * i) / n)));

// A flat band along a curve that runs round the body (a scarf): so tall up and down, and so thick
// out from the body. (A tube, squashed.)
function band(curve, segments, tall, thick) {
  const sides = 12;
  const geometry = new THREE.TubeGeometry(curve, segments, 1, sides, false);
  const pos = geometry.attributes.position;
  const middle = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, middle);
    for (let j = 0; j <= sides; j++) {
      const k = i * (sides + 1) + j;
      v.fromBufferAttribute(pos, k).sub(middle);
      pos.setXYZ(k, middle.x + v.x * thick, middle.y + v.y * tall, middle.z + v.z * thick);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A heart about 1 across, its middle at the origin, facing front.
function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.42);
  s.bezierCurveTo(-0.08, -0.32, -0.5, -0.08, -0.5, 0.16);
  s.bezierCurveTo(-0.5, 0.42, -0.2, 0.5, 0, 0.26);
  s.bezierCurveTo(0.2, 0.5, 0.5, 0.42, 0.5, 0.16);
  s.bezierCurveTo(0.5, -0.08, 0.08, -0.32, 0, -0.42);
  return s;
}

// A star with points, so wide at its points and in its notches, one point up, facing front.
function starShape(points, outer, inner, round = 0.015) {
  return rounded(
    Array.from({ length: points * 2 }, (_, i) => {
      const a = (i / (points * 2)) * Math.PI * 2;
      const r = i % 2 ? inner : outer;
      return [Math.sin(a) * r, Math.cos(a) * r, round];
    }),
  );
}

// Buddies float here beside its head, a little behind, and bob about.
const BUDDY_AT = new THREE.Vector3(0.68, 1.5, -0.32);

// A buddy (built in a group named body, inside one named buddy, its wings named wing) bobs at its
// own pace, trails behind as the Mosh runs (and drops back down after a jump), leans into it, and
// flaps its wings (if it has any) flap times a second.
function floatBuddy({ bob = 0.06, rate = 2.4, flap = 0, sway = 0.12 } = {}) {
  return (obj, avatar, dt) => {
    const b = (obj.userData.buddy ??= {
      buddy: obj.getObjectByName('buddy'),
      body: obj.getObjectByName('body'),
      wings: [],
      want: new THREE.Vector3(),
    });
    if (!b.wings.length) obj.traverse((o) => o.name === 'wing' && b.wings.push(o));
    const t = avatar.time;
    const v = avatar.localVelocity;
    // Left behind by however fast it's going (not too far), and a little lower when it's asleep.
    const lag = Math.min(1, Math.hypot(v.x, v.z) / 12);
    b.want.set(BUDDY_AT.x - v.x * 0.03, BUDDY_AT.y - THREE.MathUtils.clamp(v.y * 0.04, -0.3, 0.3) - (avatar.mode === 'sleep' ? 0.35 : 0), BUDDY_AT.z - lag * 0.55);
    b.buddy.position.x = damp(b.buddy.position.x, b.want.x, 5, dt);
    b.buddy.position.y = damp(b.buddy.position.y, b.want.y, 5, dt);
    b.buddy.position.z = damp(b.buddy.position.z, b.want.z, 5, dt);
    b.body.position.y = Math.sin(t * rate) * bob;
    b.body.rotation.z = Math.sin(t * rate * 0.5) * sway;
    b.body.rotation.x = damp(b.body.rotation.x, lag * 0.45, 6, dt);
    const happy = avatar.mode === 'happy' || avatar.mode === 'cheer';
    if (happy) b.body.position.y += Math.abs(Math.sin(t * 6.5)) * 0.12;
    const beat = Math.sin(t * flap * Math.PI * 2) * (avatar.mode === 'sleep' ? 0.15 : 0.6);
    for (const w of b.wings) w.rotation.z = w.userData.side * (w.userData.rest + beat);
  };
}

// A wing for a buddy: a group (named wing) at, holding a flat oval so long and wide out to that
// side, resting at rest radians.
function buddyWing(parent, side, at, { long, wide, material, rest = 0.3 }) {
  const wing = new THREE.Group();
  wing.name = 'wing';
  wing.position.set(...at);
  wing.userData = { side, rest };
  parent.add(wing);
  new Parts(wing).add(new THREE.SphereGeometry(1, 14, 8), material, { at: [side * long * 0.9, 0, 0], scale: [long, 0.012, wide] }).done();
  return wing;
}

// Effects' looks are made the first time someone wears one.
const basic = (color, extra) => shared(noOutline(new THREE.MeshBasicMaterial({ color, ...extra })));
const flat = (color, extra) => shared(noOutline(toon(color, extra)));
const geo = (g) => shared(g);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// A bubble: see-through, more so face on, its edge bright and catching the light.
function bubbleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { tint: { value: new THREE.Color('#6fc8ff') } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 at = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          at = instanceMatrix * at;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 view = modelViewMatrix * at;
        vNormal = normalize(normalMatrix * n);
        vView = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform vec3 tint;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
        gl_FragColor = vec4(mix(tint, vec3(1.0), pow(edge, 4.0) * 0.7), 0.1 + pow(edge, 2.2) * 0.85);
      }`,
  });
}
const spread = (n) => (Math.random() * 2 - 1) * n;

const ITEMS = {
  spring: {
    antenna: true,
    base: ANTENNA_BASE + 0.04, // the bottom of the coil
    build(g) {
      const top = mast(g, { stem: 0.04 });
      new Parts(top)
        .add(new THREE.TubeGeometry(new Coil(0.085, 0.34, 2.25), 140, 0.028, 8), stalk)
        .add(new THREE.SphereGeometry(0.1, 14, 10), bobbleGold, { at: [0, 0.39, 0] })
        .done();
    },
    animate: swayMasts,
  },

  star: {
    antenna: true,
    base: ANTENNA_BASE + 0.3 + 0.04 - 0.12 - 0.06, // the star's lowest points, on a bit of stem
    build(g) {
      const top = mast(g, { stem: 0.3 });
      const points = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const r = i % 2 ? 0.065 : 0.15;
        return [Math.sin(a) * r, Math.cos(a) * r];
      });
      // On the end of the stem, which reaches up into the notch between its two lower points.
      new Parts(top).add(slab(points, 0.05), bobbleGold, { at: [0, 0.04, 0] }).done();
    },
    animate: swayMasts,
  },

  bolt: {
    antenna: true,
    base: ANTENNA_BASE + 0.04, // where it starts to zigzag
    build(g) {
      const top = mast(g, { stem: 0.04 });
      // Up and right, sharply back left, up and right again, like a lightning bolt.
      const kinks = [
        [0, 0, 0],
        [0.1, 0.13, 0],
        [-0.06, 0.165, 0],
        [0.06, 0.31, 0],
      ];
      const p = new Parts(top);
      for (let i = 1; i < kinks.length; i++) p.bar(kinks[i - 1], kinks[i], 0.032, stalk);
      for (const at of kinks) p.add(new THREE.SphereGeometry(0.032, 10, 8), stalk, { at });
      p.add(new THREE.SphereGeometry(0.1, 14, 10), bobbleGold, { at: [0.075, 0.37, 0] });
      p.done();
    },
    animate: swayMasts,
  },

  twin: {
    antenna: true,
    base: ANTENNA_BASE + 0.33 * Math.cos(0.28) + 0.04 - 0.09 - 0.08, // the bobbles, on a bit of stalk
    build(g) {
      for (const x of [-0.1, 0.1]) {
        const top = mast(g, { x, lean: 0.28, stem: 0.33 });
        new Parts(top).add(new THREE.SphereGeometry(0.09, 14, 10), bobbleGold, { at: [0, 0.04, 0] }).done();
      }
    },
    animate: swayMasts,
  },

  beanie: {
    lift: 0.03, // the antenna's bobble sits on top like a pom-pom
    top: 1.4,
    crowned: { at: 1.3, lift: 0.17 },
    build(g) {
      const knit = mat('#e63950');
      const cuff = mat('#fdf0d5');
      const p = new Parts(g);
      const [shape, place] = dome(1.0, 0.48, 0.4);
      p.add(shape, knit, place);
      // Ribs from the cuff to the top.
      for (let i = 0; i < 12; i++) {
        p.add(new THREE.TorusGeometry(1, 0.045, 6, 20, Math.PI / 2).rotateY((i / 12) * Math.PI * 2), knit, place);
      }
      p.add(new THREE.TorusGeometry(0.48, 0.08, 10, 40).rotateX(Math.PI / 2), cuff, { at: [0, 1.0, 0], scale: [1, 1, 0.95] });
      p.done();
    },
  },

  cap: {
    top: 1.32,
    crowned: { at: 1.24, lift: 0.12 },
    build(g) {
      const crown = mat('#3b5bdb');
      const bill = mat('#ffffff');
      const p = new Parts(g);
      const [shape, place] = dome(1.0, 0.48, 0.32);
      p.add(shape, crown, place);
      // Six panels' seams, and a band round the bottom.
      for (let i = 0; i < 6; i++) p.add(new THREE.TorusGeometry(1, 0.03, 6, 20, Math.PI / 2).rotateY((i / 6) * Math.PI * 2), bill, place);
      p.add(new THREE.TorusGeometry(0.48, 0.035, 8, 40).rotateX(Math.PI / 2), crown, { at: [0, 1.01, 0], scale: [1, 1, 0.95] });
      // Worn backwards: the bill sticks out behind, clear of the eyes.
      p.add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 28, 1, false, Math.PI / 2, Math.PI), bill, { at: [0, 1.02, -0.36], rot: [-0.22, 0, 0], scale: [1, 1, 0.9] });
      // The strap's gap at the front, over the forehead.
      p.add(new THREE.TorusGeometry(0.07, 0.022, 6, 16, Math.PI), bill, { at: [0, 1.01, 0.45], rot: [-0.35, 0, 0] });
      p.done();
    },
  },

  tophat: {
    lift: 0.3,
    top: 1.51,
    crowned: { at: 1.5, lift: 0.4 },
    build(g) {
      const felt = mat('#3a2a55');
      const band = mat('#d6285a');
      const hat = new THREE.Group();
      hat.position.set(0, 1.11, 0);
      hat.rotation.z = 0.08;
      g.add(hat);
      new Parts(hat)
        .add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 32), felt)
        .add(new THREE.CylinderGeometry(0.27, 0.25, 0.38, 32), felt, { at: [0, 0.21, 0] })
        .add(new THREE.CylinderGeometry(0.262, 0.255, 0.08, 32), band, { at: [0, 0.07, 0] })
        .done();
    },
  },

  specs: {
    build(g) {
      const frame = mat('#2a1840');
      const p = new Parts(g);
      for (const side of [-1, 1]) {
        p.add(new THREE.TorusGeometry(0.17, 0.024, 8, 32), frame, { at: [side * 0.215, 0.775, 0.6], scale: [1, 1.12, 1] });
        p.bar([side * 0.385, 0.8, 0.57], [side * 0.565, 0.82, 0.12], 0.02, frame);
      }
      p.add(new THREE.TorusGeometry(0.045, 0.02, 6, 12, Math.PI), frame, { at: [0, 0.79, 0.61] });
      p.done();
    },
  },

  shades: {
    hidesEyes: true, // dark lenses: its eyes would only peek out round their sides
    build(g) {
      // No cartoon outline: they're black already, and on the frame's flat edges it would float off them.
      // (Both sides drawn, so the inside of each lens hole always shows.)
      const lens = noOutline(mat('#0b0910', { side: THREE.DoubleSide }));
      const frame = noOutline(mat('#1c1722', { side: THREE.DoubleSide }));
      const glint = shared(noOutline(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false })));
      const p = new Parts(g);
      // Classic wayfarers: a black lens over each eye, wide and straight along the top, sweeping up
      // at the outer corner and narrowing to a rounded bottom, in a chunky frame with a heavy brow. Drawn
      // for the right eye (outward is +x), and mirrored for the left.
      const LENS = [
        [-0.165, 0.125, 0.035],
        [0.205, 0.16, 0.035],
        [0.16, -0.1, 0.04],
        [0.02, -0.165, 0.09],
        [-0.13, -0.125, 0.04],
      ];
      const RIM = [
        [-0.205, 0.18, 0.05],
        [0.255, 0.215, 0.05],
        [0.195, -0.135, 0.05],
        [0.02, -0.205, 0.11],
        [-0.165, -0.16, 0.05],
      ];
      for (const side of [-1, 1]) {
        // Where each eye's lens sits, turned a little to follow the face (and clear of the shine on
        // the eye, so it doesn't poke through).
        const place = new THREE.Matrix4().compose(
          new THREE.Vector3(side * 0.22, 0.79, 0.65),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * 0.2, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        const on = (x, y, z) => new THREE.Vector3(side * x, y, z).applyMatrix4(place).toArray();
        const flip = (points) => points.map(([x, y, r]) => [side * x, y, r]);
        const rim = rounded(flip(RIM));
        rim.holes.push(rounded(flip(LENS)));
        p.add(new THREE.ExtrudeGeometry(rim, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 }).translate(0, 0, -0.02).applyMatrix4(place), frame);
        // The lens, a little bigger than its hole so the frame covers its edge, filling it almost to
        // the front.
        p.add(new THREE.ExtrudeGeometry(rounded(flip(LENS.map(([x, y, r]) => [x * 1.06, y * 1.06 + 0.002, r]))), { depth: 0.03, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.022).applyMatrix4(place), lens);
        // A faint glint across the top inside corner of the lens, a thick stripe and a thin one.
        for (const [x, width, tall] of [[-0.075, 0.024, 0.12], [-0.035, 0.01, 0.09]]) {
          p.add(new THREE.BoxGeometry(width, tall, 0.003).rotateZ(side * -0.6).translate(side * x, 0.04, 0.011).applyMatrix4(place), glint);
        }
        // The arm, from the top outer corner back to the ear.
        p.bar(on(0.245, 0.16, -0.01), [side * 0.575, 0.86, 0.12], 0.034, frame);
      }
      // The bridge across the top of the nose.
      p.bar([-0.035, 0.93, 0.682], [0.035, 0.93, 0.682], 0.034, frame);
      p.done();
      g.traverse((o) => o.material === glint && (o.castShadow = false)); // (its shadow on the lens would look like a second glint)
    },
  },

  bowtie: {
    build(g) {
      const silk = mat('#d6285a');
      const knot = mat('#a81d47');
      const p = new Parts(g);
      for (const side of [-1, 1]) {
        // A wing: a squashed cone pointing in at the knot.
        p.add(new THREE.ConeGeometry(0.12, 0.22, 16), silk, { at: [side * 0.11, 0.42, 0.6], rot: [0, 0, side * (Math.PI / 2)], scale: [1, 1, 0.45] });
      }
      p.add(new THREE.SphereGeometry(0.06, 12, 10), knot, { at: [0, 0.42, 0.625], scale: [1, 1.1, 0.7] });
      p.done();
    },
  },

  medal: {
    build(g) {
      const gold = mat('#ffd23d', { emissive: new THREE.Color('#5a3a00') });
      const rim = mat('#e0a91f');
      const red = mat('#ff4d5e');
      const blue = mat('#3d8bff');
      const p = new Parts(g);
      // The ribbon, red on one side and blue on the other, round the Mosh's front.
      p.bar([-0.04, 0.4, 0.61], [-0.34, 0.49, 0.5], 0.1, red, 0.02);
      p.bar([0.04, 0.4, 0.61], [0.34, 0.49, 0.5], 0.1, blue, 0.02);
      p.add(new THREE.CylinderGeometry(0.16, 0.16, 0.045, 32).rotateX(Math.PI / 2), gold, { at: [0, 0.27, 0.6], rot: [0.32, 0, 0] });
      p.add(new THREE.TorusGeometry(0.105, 0.018, 6, 28), rim, { at: [0, 0.278, 0.628], rot: [0.32, 0, 0] });
      // A star in the middle.
      p.add(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 5).rotateX(Math.PI / 2), rim, { at: [0, 0.278, 0.63], rot: [0.32, 0, 0] });
      p.done();
    },
  },

  jacket: {
    build(g) {
      const shell = mat('#3f4f9a', { side: THREE.DoubleSide });
      const seam = mat('#2e3a78');
      const p = new Parts(g);
      // A coat a little bigger than the body, open down the front (wide open at the top, clear
      // of the face) from below the eyes to the bottom.
      const grow = 1.06;
      const gap = 0.98; // half the opening, in radians either side of the front
      const top = 0.95;
      const span = 1.85;
      const size = [BODY.x * grow, BODY.y * grow, BODY.z * grow];
      p.add(new THREE.SphereGeometry(1, 40, 18, Math.PI / 2 + gap, Math.PI * 2 - gap * 2, top, span), shell, { at: [0, BODY_Y, 0], scale: size });
      // Rolled edges down the opening.
      const on = (phi, theta) => new THREE.Vector3(-Math.cos(phi) * Math.sin(theta) * size[0], BODY_Y + Math.cos(theta) * size[1], Math.sin(phi) * Math.sin(theta) * size[2]);
      for (const phi of [Math.PI / 2 + gap, Math.PI / 2 - gap]) {
        const points = Array.from({ length: 12 }, (_, i) => on(phi, top + (span * i) / 11));
        p.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.045, 6), seam);
      }
      // Quilted seams round it, so it puffs.
      for (const y of [0.12, 0.36, 0.6]) {
        const r = radiusAt(y) * grow + 0.004;
        p.add(new THREE.TorusGeometry(r, 0.026, 6, 48, Math.PI * 2 - gap * 2).rotateX(Math.PI / 2).rotateY(-(Math.PI / 2 + gap)), seam, {
          at: [0, y, 0],
          scale: [1, 1, BODY.z / BODY.x],
        });
      }
      // A thick collar round the back of the neck.
      const collar = 1.4;
      p.add(new THREE.TorusGeometry(radiusAt(0.88) * grow, 0.075, 10, 32, collar * 2).rotateX(Math.PI / 2).rotateY(-(Math.PI * 1.5 - collar)), shell, {
        at: [0, 0.88, 0],
        scale: [1, 1, BODY.z / BODY.x],
      });
      p.done();
    },
  },

  sandals: {
    feet: true,
    build(g, side) {
      const cork = mat('#e8c27a');
      const strap = mat('#8a4b2a');
      const bloom = mat('#ff6fae');
      const p = new Parts(g);
      // A sole a little bigger than the foot, under it.
      p.add(new THREE.CylinderGeometry(1, 1, 1, 28), cork, { at: [0, -0.1, 0.01], scale: [FOOT.x + 0.025, 0.045, FOOT.z + 0.035] });
      // Two straps over the top, down to the sole.
      for (const z of [0.1, -0.07]) {
        const around = Math.sqrt(1 - (z / FOOT.z) ** 2);
        p.add(new THREE.TorusGeometry(1, 0.2, 6, 20, Math.PI + 1.2).rotateZ(-0.6), strap, {
          at: [0, 0, z],
          scale: [FOOT.x * around + 0.012, FOOT.y * around + 0.015, 0.25], // (z: the strap's width)
        });
      }
      // A flower on the toe (the top of the foot is under the Mosh), facing forward and up.
      const at = new THREE.Vector3(side * 0.035, 0.075, 0.235);
      const tilt = new THREE.Euler(-1.1, 0, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const petal = new THREE.Vector3(Math.cos(a) * 0.036, 0, Math.sin(a) * 0.036).applyEuler(tilt).add(at);
        p.add(new THREE.SphereGeometry(0.03, 8, 6), bloom, { at: petal.toArray(), rot: [-1.1, 0, 0], scale: [1, 0.55, 1] });
      }
      p.add(new THREE.SphereGeometry(0.024, 8, 6), mat('#ffd23d'), { at: new THREE.Vector3(0, 0.012, 0).applyEuler(tilt).add(at).toArray() });
      p.done();
    },
  },

  boots: {
    feet: true,
    build(g, side) {
      const leather = mat('#3a2f45');
      const sole = mat('#241c2c');
      const welt = mat('#a07850');
      const silver = mat('#dfe3ee', { emissive: new THREE.Color('#2a2d38') });
      const p = new Parts(g);
      // Leather over the whole foot, and a ring round the top where it meets the Mosh.
      p.add(new THREE.SphereGeometry(1, 24, 14), leather, { at: [0, 0.008, 0.008], scale: [FOOT.x + 0.018, FOOT.y + 0.02, FOOT.z + 0.022] });
      p.add(new THREE.TorusGeometry(1, 0.2, 8, 28).rotateX(Math.PI / 2), leather, { at: [0, 0.075, -0.02], scale: [0.16, 0.12, 0.21] });
      // A chunky sole with a heel.
      p.add(new THREE.CylinderGeometry(1, 1, 1, 28), sole, { at: [0, -0.105, 0.01], scale: [FOOT.x + 0.03, 0.06, FOOT.z + 0.04] });
      p.add(new THREE.BoxGeometry(0.3, 0.05, 0.14), sole, { at: [0, -0.15, -0.17] });
      // A stitched welt round the top of the sole.
      p.add(new THREE.TorusGeometry(1, 0.06, 6, 36).rotateX(Math.PI / 2), welt, { at: [0, -0.072, 0.01], scale: [FOOT.x + 0.026, 0.25, FOOT.z + 0.036] });
      // A strap across the instep with a silver buckle on the outside.
      const z = 0.07;
      const around = Math.sqrt(1 - (z / FOOT.z) ** 2);
      p.add(new THREE.TorusGeometry(1, 0.2, 6, 20, Math.PI + 1.2).rotateZ(-0.6), sole, {
        at: [0, 0, z],
        scale: [(FOOT.x + 0.018) * around + 0.014, (FOOT.y + 0.02) * around + 0.016, 0.3],
      });
      p.add(new THREE.TorusGeometry(0.05, 0.014, 4, 4).rotateZ(Math.PI / 4), silver, { at: [side * 0.232, 0.04, z], rot: [0, side * (Math.PI / 2), 0], scale: [1, 1.2, 1] });
      p.done();
    },
  },

  cape: {
    build(g) {
      const cloth = mat('#e8263c', { side: THREE.DoubleSide });
      const gold = mat('#ffd23d', { emissive: new THREE.Color('#5a3a00') });
      // It hangs from a pivot at the top of the back, so it can swing out behind.
      const swing = new THREE.Group();
      swing.name = 'swing';
      swing.position.set(0, 0.88, 0);
      g.add(swing);
      const length = 1.0;
      const spread = 1.15;
      // A flared sheet behind, rippling more towards the hem.
      const sheet = new THREE.CylinderGeometry(0.56, 0.86, length, 40, 8, true, Math.PI - spread, spread * 2);
      const pos = sheet.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const down = 0.5 - pos.getY(i) / length; // 0 at the top, 1 at the hem
        const a = Math.atan2(pos.getX(i), pos.getZ(i));
        const grow = 1 + Math.sin(a * 9) * 0.06 * down;
        pos.setX(i, pos.getX(i) * grow);
        pos.setZ(i, pos.getZ(i) * grow);
      }
      sheet.computeVertexNormals();
      new Parts(swing).add(sheet, cloth, { at: [0, -length / 2, 0] }).done();
      const p = new Parts(g);
      for (const side of [-1, 1]) p.add(new THREE.SphereGeometry(0.065, 12, 10), gold, { at: [side * 0.56 * Math.sin(spread), 0.88, -0.56 * Math.cos(spread)] });
      p.done();
    },
    animate(obj, avatar, dt, speed) {
      const swing = (obj.userData.swing ??= obj.getObjectByName('swing'));
      const t = avatar.time;
      let target = 0.06 + Math.sin(t * 2) * 0.03;
      if (avatar.mode === 'run') target = 0.2 + Math.min(speed, 10) * 0.05 + Math.sin(t * 14) * 0.04;
      else if (avatar.mode === 'jump') target = 0.7;
      else if (avatar.mode === 'fall') target = 0.9 + Math.sin(t * 20) * 0.15;
      else if (avatar.mode === 'swim') target = 0.9;
      else if (avatar.mode === 'happy' || avatar.mode === 'cheer') target = 0.3 + Math.sin(t * 9) * 0.1;
      else if (avatar.mode === 'sleep') target = 0.02;
      swing.rotation.x = damp(swing.rotation.x, target, 10, dt);
    },
  },

  wings: {
    build(g) {
      const feather = mat('#ffffff');
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.name = side < 0 ? 'left' : 'right';
        wing.position.set(side * 0.26, 0.7, -0.5);
        wing.rotation.y = side * 0.3; // swept back
        g.add(wing);
        const p = new Parts(wing);
        // Three feathers fanned out sideways, the top one longest.
        [
          [0.55, 0.56, 0.1],
          [0.2, 0.48, 0.09],
          [-0.15, 0.38, 0.08],
        ].forEach(([lift, length, width]) => {
          p.add(new THREE.SphereGeometry(1, 14, 10), feather, {
            at: [side * Math.cos(lift) * (length / 2), Math.sin(lift) * (length / 2), 0],
            rot: [0, 0, side * lift],
            scale: [length / 2, width, 0.035],
          });
        });
        p.done();
      }
    },
    animate(obj, avatar, dt) {
      obj.userData.wings ??= [obj.getObjectByName('left'), obj.getObjectByName('right')];
      const t = avatar.time;
      let flap = Math.sin(t * 3) * 0.12;
      if (avatar.mode === 'run') flap = Math.sin(t * 12) * 0.3;
      else if (avatar.mode === 'jump') flap = Math.sin(t * 22) * 0.55;
      else if (avatar.mode === 'fall') flap = Math.sin(t * 28) * 0.6;
      else if (avatar.mode === 'happy' || avatar.mode === 'cheer') flap = Math.sin(t * 16) * 0.45;
      else if (avatar.mode === 'sleep') flap = -0.25;
      const [left, right] = obj.userData.wings;
      left.rotation.z = -flap;
      right.rotation.z = flap;
    },
  },

  propeller: {
    antenna: true,
    base: ANTENNA_BASE + 0.26 - 0.03, // its hub, on top of the stem
    build(g) {
      const top = mast(g, { stem: 0.26 });
      new Parts(top).add(new THREE.SphereGeometry(0.05, 12, 8), bobbleGold, { at: [0, 0.02, 0] }).done();
      // Three blades, red, yellow and blue, pitched like a real propeller's.
      const blades = new THREE.Group();
      blades.name = 'blades';
      blades.position.y = 0.06;
      top.add(blades);
      const p = new Parts(blades);
      ['#ff4d5e', '#ffd23d', '#3d8bff'].forEach((color, i) => {
        const blade = new THREE.SphereGeometry(1, 16, 8).scale(0.17, 0.016, 0.055).translate(0.18, 0, 0).rotateX(0.35).rotateY((i / 3) * Math.PI * 2);
        p.add(blade, mat(color));
      });
      p.add(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), bobbleGold);
      p.done();
    },
    // Lazily round standing about, faster as it runs, whirring when it jumps or hops for joy.
    animate(obj, avatar, dt, speed) {
      swayMasts(obj, avatar, dt, speed);
      const blades = (obj.userData.blades ??= obj.getObjectByName('blades'));
      const mode = avatar.mode;
      const want = mode === 'run' ? 10 + Math.min(speed, 12) * 1.5 : mode === 'jump' || mode === 'fall' ? 32 : mode === 'happy' || mode === 'cheer' ? 20 : mode === 'sleep' ? 0.5 : 3;
      obj.userData.whirr = damp(obj.userData.whirr ?? want, want, 3, dt);
      blades.rotation.y += obj.userData.whirr * dt;
    },
  },

  daisy: {
    antenna: true,
    base: ANTENNA_BASE + 0.3 - 0.14, // its lowest petals, on a bit of stem
    build(g) {
      const top = mast(g, { stem: 0.3 });
      // Facing front, tipped up a little, on the end of the stem, with a leaf just below it.
      const flower = new THREE.Group();
      flower.name = 'flower';
      flower.position.y = 0.04;
      flower.rotation.x = -0.3;
      top.add(flower);
      const p = new Parts(flower);
      const petal = mat('#ffffff');
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        p.add(new THREE.SphereGeometry(1, 10, 6), petal, { at: [Math.sin(a) * 0.1, Math.cos(a) * 0.1, 0], rot: [0, 0, -a], scale: [0.036, 0.075, 0.016] });
      }
      p.add(new THREE.SphereGeometry(0.055, 14, 10), mat('#ffc61a', { emissive: new THREE.Color('#4a3000') }), { at: [0, 0, 0.015], scale: [1, 1, 0.55] });
      p.done();
      new Parts(top).add(new THREE.SphereGeometry(1, 10, 6), mat('#4cbf5a'), { at: [0.055, -0.13, 0], rot: [0, 0, -0.9], scale: [0.05, 0.02, 0.03] }).done();
    },
    // It nods along.
    animate(obj, avatar, dt, speed) {
      swayMasts(obj, avatar, dt, speed);
      const flower = (obj.userData.flower ??= obj.getObjectByName('flower'));
      const t = avatar.time;
      const rate = avatar.mode === 'run' ? 9 : avatar.mode === 'happy' || avatar.mode === 'cheer' ? 6.5 : 1.6;
      flower.rotation.z = Math.sin(t * rate) * 0.18;
    },
  },

  partyhat: {
    lift: 0.3, // the antenna pokes out of its tip, the bobble a pom-pom
    top: 1.68,
    crowned: { at: 1.07, lift: 0.3 }, // the crown round its brim
    build(g) {
      const paper = mat('#ff5fa2', { side: THREE.DoubleSide });
      const dot = mat('#ffd23d');
      const hat = new THREE.Group();
      hat.position.set(0, 1.1, 0); // where the head is as wide as its brim
      hat.rotation.z = -0.05;
      g.add(hat);
      const p = new Parts(hat);
      const tall = 0.56;
      const wide = 0.27;
      p.add(new THREE.ConeGeometry(wide, tall, 32, 1, true), paper, { at: [0, tall / 2, 0] });
      // Polka dots, flat on the cone.
      const slope = Math.atan(wide / tall);
      [
        [0.08, 7, 0],
        [0.22, 6, 0.5],
        [0.36, 4, 0.2],
      ].forEach(([y, n, turn]) => {
        const r = wide * (1 - y / tall) + 0.004;
        for (let i = 0; i < n; i++) {
          const a = ((i + turn) / n) * Math.PI * 2;
          p.add(new THREE.SphereGeometry(1, 10, 6).scale(0.034, 0.034, 0.01).rotateX(-slope).translate(0, 0, r).rotateY(a).translate(0, y, 0), dot);
        }
      });
      // A ruffle round the brim.
      const ruffle = new THREE.TorusGeometry(wide, 0.035, 8, 48).rotateX(Math.PI / 2);
      const pos = ruffle.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 12) * 0.012);
      ruffle.computeVertexNormals();
      p.add(ruffle, mat('#ffffff'), { at: [0, 0.01, 0] });
      p.done();
    },
  },

  viking: {
    lift: 0.1,
    top: 1.46,
    crowned: { at: 1.33, lift: 0.2 },
    build(g) {
      const steel = mat('#aab4c3');
      const bronze = mat('#c98b3a');
      const ivory = mat('#f3e6c4');
      const p = new Parts(g);
      const [shape, place] = dome(0.98, 0.5, 0.45);
      p.add(shape, steel, place);
      // A riveted band round the bottom, and a ridge over the top from front to back.
      p.add(new THREE.TorusGeometry(0.5, 0.05, 8, 40).rotateX(Math.PI / 2), bronze, { at: [0, 0.99, 0], scale: [1, 1, 0.95] });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        p.add(new THREE.SphereGeometry(0.026, 8, 6), steel, { at: [Math.sin(a) * 0.548, 0.99, Math.cos(a) * 0.548 * 0.95] });
      }
      p.add(new THREE.TorusGeometry(1, 0.075, 6, 24, Math.PI).rotateY(Math.PI / 2), bronze, place);
      // Horns out of each side, curving up, with a bronze ring where they meet the helmet.
      for (const side of [-1, 1]) {
        const geometry = horn(0.42, 0.075, 1.5).rotateZ(-Math.PI / 2);
        if (side < 0) geometry.rotateY(Math.PI);
        p.add(geometry, ivory, { at: [side * 0.4, 1.2, 0] });
        p.add(new THREE.TorusGeometry(0.075, 0.025, 6, 16).rotateY(Math.PI / 2), bronze, { at: [side * 0.42, 1.2, 0] });
      }
      p.done();
    },
  },

  mustache: {
    build(g) {
      const hair = mat('#4a2c1d');
      const p = new Parts(g);
      // From under the nose out along the face, curling up at the ends, getting thinner as it goes:
      // a string of blobs (between the eyes and the cheeks, clear of both).
      for (const side of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3(
          [
            [0.0, 0.5, 0.625],
            [0.1, 0.485, 0.61],
            [0.2, 0.48, 0.585],
            [0.28, 0.505, 0.555],
            [0.31, 0.55, 0.54],
            [0.275, 0.58, 0.555],
          ].map(([x, y, z]) => new THREE.Vector3(side * x, y, z)),
        );
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const r = 0.052 * (1 - t) + 0.016;
          p.add(new THREE.SphereGeometry(1, 10, 8), hair, { at: curve.getPoint(t).toArray(), scale: [r, r * 0.8, r * 0.7] });
        }
      }
      p.done();
    },
  },

  starspecs: {
    build(g) {
      const frame = mat('#ff4fa3');
      const lens = shared(noOutline(new THREE.MeshBasicMaterial({ color: '#ff9fd0', transparent: true, opacity: 0.22, depthWrite: false })));
      const p = new Parts(g);
      for (const side of [-1, 1]) {
        // A star round each eye, its inner points meeting over the nose, with a hole the eye shows through.
        const place = new THREE.Matrix4().compose(
          new THREE.Vector3(side * 0.215, 0.775, 0.61),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * 0.2, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        const star = starShape(5, 0.27, 0.19, 0.03);
        star.holes.push(new THREE.Path().absellipse(0, 0, 0.14, 0.17, 0, Math.PI * 2, false, 0));
        p.add(new THREE.ExtrudeGeometry(star, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 }).translate(0, 0, -0.02).applyMatrix4(place), frame);
        const glass = new THREE.Shape().absellipse(0, 0, 0.15, 0.18, 0, Math.PI * 2, false, 0);
        p.add(new THREE.ShapeGeometry(glass, 16).translate(0, 0, -0.01).applyMatrix4(place), lens);
        // The arm, back to the ear.
        p.bar(new THREE.Vector3(side * 0.24, 0.07, -0.01).applyMatrix4(place).toArray(), [side * 0.575, 0.86, 0.12], 0.022, frame);
      }
      p.done();
      g.traverse((o) => o.material === lens && (o.castShadow = false));
    },
  },

  scarf: {
    build(g) {
      const red = mat('#e63950');
      const cream = mat('#fdf0d5');
      const around = collar(0.38, 0.9, 0.035);
      const p = new Parts(g);
      // A knitted band round the neck, in stripes.
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        p.add(band(collarCurve(around, a0, a1, 6), 8, 0.075, 0.04), i % 2 ? cream : red);
      }
      // The knot, at the front on one side.
      const knotAt = around(-0.55);
      p.add(new THREE.SphereGeometry(0.085, 12, 10), red, { at: knotAt.toArray() });
      p.done();
      // Its two ends hang from the knot, and fly out behind when it runs.
      const ends = new THREE.Group();
      ends.name = 'ends';
      ends.position.copy(knotAt);
      ends.rotation.y = -0.55;
      g.add(ends);
      const q = new Parts(ends);
      [
        [-0.05, 0.1, 0.33],
        [0.06, -0.12, 0.27],
      ].forEach(([x, tilt, long]) => {
        for (let k = 0; k < 3; k++) {
          const piece = long / 3;
          q.add(new THREE.BoxGeometry(0.12, piece, 0.035), k % 2 ? cream : red, { at: [x + Math.sin(tilt) * piece * (k + 0.5), -Math.cos(tilt) * piece * (k + 0.5), 0.04], rot: [0, 0, tilt] });
        }
      });
      q.done();
    },
    // They flap out from its front in the wind as it runs, and fly up when it jumps.
    animate(obj, avatar, dt, speed) {
      const ends = (obj.userData.ends ??= obj.getObjectByName('ends'));
      const t = avatar.time;
      let lift = -0.08 + Math.sin(t * 2) * 0.03;
      if (avatar.mode === 'run') lift = -0.3 - Math.min(speed, 10) * 0.03 + Math.sin(t * 14) * 0.1;
      else if (avatar.mode === 'jump') lift = -0.65;
      else if (avatar.mode === 'fall') lift = -0.9 + Math.sin(t * 20) * 0.2;
      else if (avatar.mode === 'happy' || avatar.mode === 'cheer') lift = -0.2 + Math.sin(t * 9) * 0.2;
      ends.rotation.x = damp(ends.rotation.x, lift, 10, dt);
    },
  },

  lei: {
    build(g) {
      const around = collar(0.36, 0.82, 0.04);
      const colors = ['#ff5fa2', '#ffd23d', '#ffffff', '#ff9f43', '#b57bff'].map((c) => mat(c));
      const middle = mat('#ffc61a', { emissive: new THREE.Color('#4a3000') });
      const leaf = mat('#3fae55');
      const p = new Parts(g);
      // Flowers all the way round, facing out, with a leaf between each.
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const at = around(a);
        const face = (geometry) => geometry.rotateX(-0.35).rotateY(a).translate(at.x, at.y, at.z);
        for (let k = 0; k < 5; k++) {
          const b = (k / 5) * Math.PI * 2;
          p.add(face(new THREE.SphereGeometry(1, 8, 6).scale(0.045, 0.045, 0.02).translate(Math.cos(b) * 0.045, Math.sin(b) * 0.045, 0.02)), colors[i % colors.length]);
        }
        p.add(face(new THREE.SphereGeometry(0.025, 8, 6).translate(0, 0, 0.035)), middle);
        const between = around(a + Math.PI / n);
        p.add(new THREE.SphereGeometry(1, 8, 6).scale(0.05, 0.022, 0.03).rotateZ(0.6).rotateY(a + Math.PI / n), leaf, { at: between.toArray() });
      }
      p.done();
    },
  },

  tutu: {
    build(g) {
      const p = new Parts(g);
      // Two layers of frilly net flaring out round the bottom of the body (a long dark one, a
      // short light one over it), clear of its hands, and a band round its waist.
      [
        ['#ff8cc6', 0.26, 0.57, 0.06, 0.88, 15],
        ['#ffc6e3', 0.28, 0.58, 0.15, 0.8, 12],
      ].forEach(([color, top, topR, bottom, bottomR, waves]) => {
        const tall = top - bottom;
        const net = new THREE.CylinderGeometry(topR, bottomR, tall, 64, 3, true);
        const pos = net.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const down = 0.5 - pos.getY(i) / tall; // 0 at the waist, 1 at the hem
          const ripple = Math.sin(Math.atan2(pos.getX(i), pos.getZ(i)) * waves);
          const grow = 1 + ripple * 0.07 * down;
          pos.setXYZ(i, pos.getX(i) * grow, pos.getY(i) + ripple * 0.025 * down, pos.getZ(i) * grow);
        }
        net.computeVertexNormals();
        p.add(net, mat(color, { side: THREE.DoubleSide }), { at: [0, bottom + tall / 2, 0], scale: [1, 1, BODY.z / BODY.x] });
      });
      p.add(new THREE.TorusGeometry(radiusAt(0.28) + 0.015, 0.03, 8, 48).rotateX(Math.PI / 2), mat('#ff5fa2'), { at: [0, 0.28, 0], scale: [1, 1, BODY.z / BODY.x] });
      p.done();
    },
  },

  jetpack: {
    build(g) {
      const metal = mat('#c9d1dc', { emissive: new THREE.Color('#1c2028') });
      const red = mat('#ff4d5e');
      const dark = mat('#3a3346');
      const p = new Parts(g);
      // Two tanks on a plate on its back, red noses up top and nozzles underneath.
      p.add(new THREE.BoxGeometry(0.3, 0.4, 0.08), dark, { at: [0, 0.56, -0.6] });
      for (const side of [-1, 1]) {
        const x = side * 0.165;
        p.add(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 20), metal, { at: [x, 0.56, -0.68] });
        p.add(new THREE.ConeGeometry(0.1, 0.17, 20), red, { at: [x, 0.845, -0.68] });
        p.add(new THREE.TorusGeometry(0.1, 0.018, 6, 20).rotateX(Math.PI / 2), dark, { at: [x, 0.7, -0.68] });
        p.add(new THREE.CylinderGeometry(0.055, 0.085, 0.08, 16), dark, { at: [x, 0.32, -0.68] });
      }
      p.done();
      // Flames out of the nozzles (animate says how big).
      const outer = shared(noOutline(new THREE.MeshBasicMaterial({ color: '#ff8a1f' })));
      const inner = shared(noOutline(new THREE.MeshBasicMaterial({ color: '#fff27a' })));
      for (const side of [-1, 1]) {
        const flame = new THREE.Group();
        flame.name = 'flame';
        flame.position.set(side * 0.165, 0.28, -0.68);
        g.add(flame);
        new Parts(flame)
          .add(new THREE.ConeGeometry(0.068, 0.32, 12).rotateX(Math.PI), outer, { at: [0, -0.16, 0] })
          .add(new THREE.ConeGeometry(0.04, 0.2, 10).rotateX(Math.PI), inner, { at: [0, -0.1, 0] })
          .done();
        flame.traverse((o) => (o.castShadow = false));
      }
    },
    // A flicker standing about, more as it runs, and a roar when it jumps.
    animate(obj, avatar, dt, speed) {
      const flames = (obj.userData.flames ??= obj.children.filter((o) => o.name === 'flame'));
      const mode = avatar.mode;
      const want = mode === 'jump' || mode === 'fall' ? 1.35 : mode === 'run' ? 0.5 + Math.min(speed, 10) * 0.04 : mode === 'happy' || mode === 'cheer' ? 0.8 : mode === 'sleep' ? 0 : 0.22;
      obj.userData.power = damp(obj.userData.power ?? want, want, 10, dt);
      const power = obj.userData.power;
      const t = avatar.time;
      flames.forEach((flame, i) => {
        const flicker = 1 + Math.sin(t * 41 + i * 2) * 0.12 + Math.sin(t * 67 + i) * 0.08;
        flame.scale.set(0.75 + power * 0.25, Math.max(0.001, power * flicker), 0.75 + power * 0.25);
        flame.visible = power > 0.02;
      });
    },
  },

  skates: {
    feet: true,
    build(g, side) {
      const boot = mat('#f4f1ea');
      const trim = mat('#2ec7c0');
      const plate = mat('#8a93a6');
      const p = new Parts(g);
      // A white boot over the foot with a teal cuff and laces, on a plate.
      p.add(new THREE.SphereGeometry(1, 24, 14), boot, { at: [0, 0.008, 0.008], scale: [FOOT.x + 0.018, FOOT.y + 0.02, FOOT.z + 0.022] });
      p.add(new THREE.TorusGeometry(1, 0.2, 8, 28).rotateX(Math.PI / 2), trim, { at: [0, 0.075, -0.02], scale: [0.16, 0.12, 0.21] });
      for (const z of [0.05, 0.11, 0.17]) {
        const around = Math.sqrt(1 - (z / (FOOT.z + 0.022)) ** 2);
        p.bar([-0.07, (FOOT.y + 0.02) * around * 0.9, z], [0.07, (FOOT.y + 0.02) * around * 0.9, z], 0.012, trim);
      }
      p.add(new THREE.BoxGeometry(0.2, 0.03, 0.48), plate, { at: [0, -0.1, 0.01] });
      // A rubber stopper on the toe.
      p.add(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 12), trim, { at: [0, -0.09, 0.27], rot: [0.5, 0, 0] });
      p.done();
      // Four wheels (each its own, to spin).
      const tyre = mat('#ff5fa2');
      const hub = mat('#ffd23d');
      for (const z of [0.15, -0.14]) {
        for (const x of [-0.1, 0.1]) {
          const wheel = new THREE.Group();
          wheel.name = 'wheel';
          wheel.position.set(x, -0.13, z);
          g.add(wheel);
          new Parts(wheel)
            .add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16).rotateZ(Math.PI / 2), tyre)
            .add(new THREE.CylinderGeometry(0.022, 0.022, 0.056, 10).rotateZ(Math.PI / 2), hub)
            .add(new THREE.BoxGeometry(0.058, 0.012, 0.03), hub) // (so you can see them turn)
            .done();
        }
      }
    },
    // The wheels turn as it runs.
    animate(obj, avatar, dt, speed, worn) {
      const wheels = (worn.wheels ??= worn.feet.flatMap((shoe) => {
        const found = [];
        shoe.traverse((o) => o.name === 'wheel' && found.push(o));
        return found;
      }));
      const turn = avatar.mode === 'run' ? (Math.max(speed, 4) / 0.05) * dt : 0;
      for (const w of wheels) w.rotation.x += turn;
    },
  },

  bee: {
    rig: true,
    build(g) {
      const buddy = new THREE.Group();
      buddy.name = 'buddy';
      buddy.position.copy(BUDDY_AT);
      g.add(buddy);
      const body = new THREE.Group();
      body.name = 'body';
      buddy.add(body);
      const yellow = mat('#ffcf33');
      const black = mat('#2a2230');
      const p = new Parts(body);
      // A round stripy body, big eyes, feelers, and a little sting.
      p.add(new THREE.SphereGeometry(0.13, 20, 14), yellow, { scale: [1, 0.95, 1.2] });
      for (const z of [-0.025, -0.095]) {
        const r = 0.13 * Math.sqrt(1 - (z / 0.156) ** 2) + 0.004;
        p.add(new THREE.TorusGeometry(r, 0.022, 6, 24), black, { at: [0, 0, z], scale: [1, 0.95, 1] });
      }
      p.add(new THREE.ConeGeometry(0.028, 0.07, 10).rotateX(-Math.PI / 2), black, { at: [0, -0.01, -0.175] });
      for (const side of [-1, 1]) {
        p.add(new THREE.SphereGeometry(0.036, 12, 10), mat('#ffffff'), { at: [side * 0.052, 0.04, 0.125] });
        p.add(new THREE.SphereGeometry(0.02, 10, 8), black, { at: [side * 0.055, 0.042, 0.155] });
        p.bar([side * 0.03, 0.1, 0.08], [side * 0.07, 0.2, 0.13], 0.008, black);
        p.add(new THREE.SphereGeometry(0.018, 8, 6), black, { at: [side * 0.07, 0.2, 0.13] });
      }
      p.done();
      const wings = shared(noOutline(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })));
      for (const side of [-1, 1]) buddyWing(body, side, [side * 0.04, 0.11, -0.02], { long: 0.085, wide: 0.05, material: wings, rest: 0.5 });
    },
    animate: floatBuddy({ bob: 0.05, rate: 3.2, flap: 22, sway: 0.18 }),
  },

  ghost: {
    rig: true,
    build(g) {
      const buddy = new THREE.Group();
      buddy.name = 'buddy';
      buddy.position.copy(BUDDY_AT);
      g.add(buddy);
      const body = new THREE.Group();
      body.name = 'body';
      buddy.add(body);
      const sheet = mat('#f6f4ff', { side: THREE.DoubleSide });
      const black = mat('#2a2230');
      const p = new Parts(body);
      // A round head flowing down into a wavy hem.
      p.add(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), sheet);
      const skirt = new THREE.CylinderGeometry(0.15, 0.18, 0.18, 32, 3, true);
      const pos = skirt.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const down = 0.5 - pos.getY(i) / 0.18;
        pos.setY(i, pos.getY(i) + Math.sin(Math.atan2(pos.getX(i), pos.getZ(i)) * 5) * 0.03 * down);
      }
      skirt.computeVertexNormals();
      p.add(skirt, sheet, { at: [0, -0.09, 0] });
      // A happy face, and little arms.
      for (const side of [-1, 1]) {
        p.add(new THREE.SphereGeometry(1, 10, 8), black, { at: [side * 0.055, 0.04, 0.135], scale: [0.022, 0.034, 0.012] });
        p.add(new THREE.SphereGeometry(1, 10, 8), mat('#ffb3c8'), { at: [side * 0.09, -0.005, 0.12], rot: [0, side * 0.6, 0], scale: [0.025, 0.014, 0.008] });
        p.add(new THREE.SphereGeometry(1, 10, 8), sheet, { at: [side * 0.16, -0.07, 0.02], rot: [0, 0, side * -0.6], scale: [0.05, 0.03, 0.035] });
      }
      p.add(new THREE.TorusGeometry(0.022, 0.008, 6, 12, Math.PI).rotateZ(Math.PI), black, { at: [0, -0.005, 0.145] });
      p.done();
    },
    animate: floatBuddy({ bob: 0.08, rate: 1.8, sway: 0.15 }),
  },

  chick: {
    rig: true,
    build(g) {
      const buddy = new THREE.Group();
      buddy.name = 'buddy';
      buddy.position.copy(BUDDY_AT);
      g.add(buddy);
      const body = new THREE.Group();
      body.name = 'body';
      buddy.add(body);
      const fluff = mat('#ffd84d');
      const orange = mat('#ff9a1f');
      const p = new Parts(body);
      // A fluffy round chick with a beak, a tuft and little feet.
      p.add(new THREE.SphereGeometry(0.14, 20, 14), fluff, { scale: [1, 0.95, 1] });
      p.add(new THREE.ConeGeometry(0.035, 0.07, 10).rotateX(Math.PI / 2), orange, { at: [0, -0.005, 0.15] });
      for (const side of [-1, 1]) {
        p.add(new THREE.SphereGeometry(0.022, 10, 8), mat('#2a2230'), { at: [side * 0.055, 0.045, 0.12] });
        p.add(new THREE.SphereGeometry(1, 10, 8), mat('#ffb3c8'), { at: [side * 0.085, 0.0, 0.11], rot: [0, side * 0.6, 0], scale: [0.022, 0.013, 0.008] });
        p.add(new THREE.SphereGeometry(1, 8, 6), orange, { at: [side * 0.05, -0.14, 0.03], scale: [0.03, 0.012, 0.045] });
      }
      [-0.35, 0, 0.35].forEach((lean) => p.add(new THREE.SphereGeometry(1, 8, 6), fluff, { at: [Math.sin(lean) * 0.05, 0.15, 0], rot: [0, 0, -lean], scale: [0.016, 0.05, 0.016] }));
      p.done();
      for (const side of [-1, 1]) buddyWing(body, side, [side * 0.12, 0.0, -0.01], { long: 0.06, wide: 0.05, material: fluff, rest: -0.2 });
    },
    animate: floatBuddy({ bob: 0.07, rate: 4, flap: 9, sway: 0.1 }),
  },

  rainbow: {
    effect: {
      on: 'run',
      ground: true,
      spacing: 0.14,
      max: 80,
      // Flat blobs of paint along the ground, a little up off it, coloring in on top of whatever's there.
      look: () => [{ geometry: geo(new THREE.CylinderGeometry(1, 1, 0.02, 24)), material: flat('#ffffff', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), tint: true }],
      // Round the rainbow as it goes, a band every 3 or so of its own lengths.
      spawn(m, at) {
        m.pos.copy(at.pos);
        m.pos.y += 0.025 * at.scale;
        m.size = at.scale * 0.36;
        m.life = 1.1;
        m.grow = 0.06;
        m.fade = 0.5;
        m.color.setHSL((at.distance / 3) % 1, 0.95, 0.55);
      },
    },
  },

  blooms: {
    effect: {
      on: 'run',
      ground: true,
      spacing: 0.4,
      max: 40,
      // A flower: a stem with two leaves, petals round the top and a middle (its petals tinted).
      look() {
        const leaves = mergeGeometries(
          [
            new THREE.CylinderGeometry(0.018, 0.022, 0.3, 6).translate(0, 0.15, 0),
            new THREE.SphereGeometry(1, 8, 6).scale(0.06, 0.016, 0.03).translate(0.06, 0, 0).rotateZ(0.5).translate(0, 0.1, 0),
            new THREE.SphereGeometry(1, 8, 6).scale(0.05, 0.016, 0.026).translate(-0.05, 0, 0).rotateZ(-0.5).translate(0, 0.16, 0),
          ].map((g) => g.toNonIndexed()),
        );
        const petals = mergeGeometries(
          Array.from({ length: 6 }, (_, i) =>
            new THREE.SphereGeometry(1, 8, 6)
              .scale(0.055, 0.02, 0.032)
              .translate(0.06, 0, 0)
              .rotateZ(0.35)
              .rotateY((i / 6) * Math.PI * 2)
              .translate(0, 0.31, 0)
              .toNonIndexed(),
          ),
        );
        return [
          { geometry: geo(leaves), material: flat('#46b45a') },
          { geometry: geo(petals), material: flat('#ffffff'), tint: true },
          { geometry: geo(new THREE.SphereGeometry(0.035, 10, 8).translate(0, 0.32, 0)), material: flat('#ffc61a') },
        ];
      },
      // Where each foot was, springing up, swaying, and tucking back into the ground.
      spawn(m, at) {
        m.pos.copy(at.pos).addScaledVector(at.side, at.foot * 0.26 * at.scale + spread(0.05) * at.scale).addScaledVector(at.forward, spread(0.08) * at.scale);
        m.size = at.scale * (1.5 + Math.random() * 0.5);
        m.life = 1.35;
        m.grow = 0.22;
        m.fade = 0.4;
        m.rot.set(0, Math.random() * Math.PI * 2, 0);
        m.color.set(pick(['#ff5fa2', '#ffffff', '#ffd23d', '#b57bff', '#ff8a5c', '#5fb8ff']));
      },
      tick(m) {
        m.rot.z = Math.sin(m.age * 6 + m.phase) * 0.12;
      },
    },
  },

  sparkles: {
    effect: {
      on: 'run',
      spacing: 0.22,
      max: 64,
      // Little four-pointed stars, two crossed so they show from every side.
      look() {
        const star = starShape(4, 1, 0.32, 0.02);
        const one = new THREE.ShapeGeometry(star, 4);
        return [{ geometry: geo(mergeGeometries([one.clone().toNonIndexed(), one.rotateY(Math.PI / 2).toNonIndexed()])), material: basic('#ffffff', { side: THREE.DoubleSide }), tint: true }];
      },
      // Around and above it, drifting up and twinkling out.
      spawn(m, at) {
        m.pos.copy(at.pos).addScaledVector(at.side, spread(0.45) * at.scale).addScaledVector(at.forward, spread(0.2) * at.scale);
        m.pos.y += (0.15 + Math.random() * 1.1) * at.scale;
        m.vel.set(spread(0.3), 0.5 + Math.random() * 0.6, spread(0.3)).multiplyScalar(at.scale);
        m.drag = 1.2;
        m.size = at.scale * (0.11 + Math.random() * 0.09);
        m.life = 0.7 + Math.random() * 0.5;
        m.grow = 0.12;
        m.fade = 0.4;
        m.rot.set(0, Math.random() * Math.PI, 0);
        m.spin.set(0, spread(3) + 4, 0);
        m.color.set(pick(['#ffe14d', '#ffc61a', '#fff6a8', '#ffffff', '#ff9ff3', '#8fe3ff']));
      },
    },
  },

  bubbles: {
    effect: {
      on: 'run',
      spacing: 0.42,
      max: 44,
      // See-through bubbles, clear in the middle and bright round the edge, with a shine on them.
      look: () => [
        { geometry: geo(new THREE.SphereGeometry(1, 18, 14)), material: shared(noOutline(bubbleMaterial())) },
        { geometry: geo(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 1.4, 0.5).translate(-0.4, 0.45, 0.72)), material: basic('#ffffff', { transparent: true, opacity: 0.9, depthWrite: false }) },
      ],
      // From behind it, wobbling up, then pop.
      spawn(m, at) {
        m.pos.copy(at.pos).addScaledVector(at.side, spread(0.35) * at.scale).addScaledVector(at.forward, -0.25 * at.scale);
        m.pos.y += (0.25 + Math.random() * 0.7) * at.scale;
        m.vel.set(spread(0.25), 0.45 + Math.random() * 0.5, spread(0.25)).multiplyScalar(at.scale);
        m.drag = 0.6;
        m.size = at.scale * (0.1 + Math.random() * 0.1);
        m.life = 1.0 + Math.random() * 0.7;
        m.grow = 0.18;
        m.pop = true;
        m.wobble = 0.04 * at.scale;
      },
    },
  },

  confetti: {
    effect: {
      on: 'cheer',
      burst: 22,
      max: 88,
      look: () => [{ geometry: geo(new THREE.PlaneGeometry(0.13, 0.08)), material: basic('#ffffff', { side: THREE.DoubleSide }), tint: true }],
      // Up out of the top of its head, then fluttering down, tumbling.
      spawn(m, at) {
        m.pos.copy(at.pos);
        m.pos.y += 1.55 * at.scale;
        const a = Math.random() * Math.PI * 2;
        const out = 1.2 + Math.random() * 1.6;
        m.vel.set(Math.cos(a) * out, 2.6 + Math.random() * 1.8, Math.sin(a) * out).multiplyScalar(at.scale);
        m.gravity = 7 * at.scale;
        m.drag = 2.2;
        m.size = at.scale * (0.9 + Math.random() * 0.5);
        m.life = 1.3 + Math.random() * 0.5;
        m.grow = 0.05;
        m.fade = 0.3;
        m.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        m.spin.set(spread(10), spread(6), spread(10));
        m.color.set(pick(['#ff4d5e', '#ffd23d', '#3d8bff', '#2ec7c0', '#ff8a1f', '#b57bff', '#8fd14f', '#ff5fa2']));
      },
    },
  },

  hearts: {
    effect: {
      on: 'cheer',
      burst: 3,
      max: 24,
      look: () => [
        {
          geometry: geo(new THREE.ExtrudeGeometry(heartShape(), { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 }).translate(0, 0, -0.09)),
          material: flat('#ffffff'),
          tint: true,
        },
      ],
      // Up from around its head, rising faster as they go, rocking side to side.
      spawn(m, at) {
        m.pos.copy(at.pos).addScaledVector(at.side, at.foot * (0.25 + Math.random() * 0.3) * at.scale);
        m.pos.y += (1.2 + Math.random() * 0.4) * at.scale;
        m.vel.set(spread(0.3), 1.0 + Math.random() * 0.6, spread(0.3)).multiplyScalar(at.scale);
        m.gravity = -0.8 * at.scale;
        m.drag = 0.4;
        m.size = at.scale * (0.2 + Math.random() * 0.1);
        m.life = 1.5;
        m.grow = 0.25;
        m.fade = 0.4;
        m.rot.set(0, Math.atan2(at.forward.x, at.forward.z) + spread(0.4), 0);
        m.color.set(pick(['#ff4d6d', '#ff7aa8', '#ff2e63', '#ffb3c8']));
      },
      tick(m) {
        m.rot.z = Math.sin(m.age * 5 + m.phase) * 0.3;
      },
    },
  },
};

// Every item in shared/cosmetics.js has a look here.
for (const id of Object.keys(COSMETICS)) if (!ITEMS[id]) throw new Error(`no look for cosmetic "${id}"`);

const templates = new Map(); // id (and side, for shoes) -> the built group, copied for each Mosh

function copy(key, build) {
  let template = templates.get(key);
  if (!template) {
    template = new THREE.Group();
    build(template);
    templates.set(key, template);
  }
  return template.clone();
}

// A shoe for one foot. Inside, the foot's squash is undone, so shoes are made in true proportions.
const shoe = (item, side) => (g) => {
  const inner = new THREE.Group();
  inner.scale.set(1 / FOOT_SCALE[0], 1 / FOOT_SCALE[1], 1 / FOOT_SCALE[2]);
  item.build(inner, side);
  g.add(inner);
};

// A new copy of the item for one Mosh: { obj (on its torso, or beside it with rig) or feet ([left,
// right]), slot, lift, top, crowned, animate, fit (an antenna's), hidesEyes, rig, effect (what it
// leaves in the world: effects.js) }.
export function makeItem(id) {
  const item = ITEMS[id];
  if (!item) return null;
  return {
    obj: item.feet || !item.build ? null : copy(id, (g) => item.build(g)),
    feet: item.feet ? [-1, 1].map((side) => copy(`${id}:${side}`, shoe(item, side))) : null,
    slot: COSMETICS[id].slot,
    lift: item.lift ?? 0,
    top: item.top ?? 0,
    crowned: item.crowned ?? null,
    animate: item.animate ?? null,
    fit: item.antenna ? (obj, cover) => fitMasts(obj, Math.max(0, cover + 0.02 - item.base)) : null,
    hidesEyes: item.hidesEyes ?? false,
    rig: item.rig ?? false,
    effect: item.effect ?? null,
  };
}

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
// animate(obj, avatar, dt, speed).

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
      const mesh = new THREE.Mesh(shared(mergeGeometries(geometries.map((g) => g.toNonIndexed()))), material);
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

const ITEMS = {
  beanie: {
    lift: 0.03, // the antenna's bobble sits on top like a pom-pom
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
    build(g) {
      const lens = mat('#231636', { emissive: new THREE.Color('#1a0c38') });
      const frame = mat('#2a1840');
      const glint = shared(noOutline(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
      const p = new Parts(g);
      for (const side of [-1, 1]) {
        // A dark lens in a frame over each eye, turned a little to follow the face.
        const over = { at: [side * 0.22, 0.79, 0.615], rot: [0, side * 0.18, 0], scale: [1.12, 0.9, 1] };
        p.add(new THREE.CylinderGeometry(0.185, 0.185, 0.04, 28).rotateX(Math.PI / 2), lens, over);
        p.add(new THREE.TorusGeometry(0.185, 0.022, 8, 32), frame, { ...over, at: [side * 0.22, 0.79, 0.625] });
        p.add(new THREE.BoxGeometry(0.035, 0.15, 0.01), glint, { at: [side * 0.22 - 0.07, 0.83, 0.645], rot: [0, side * 0.18, -0.6] });
        // The arm, from the outside of the frame back along the side of the head.
        p.bar([side * 0.425, 0.8, 0.575], [side * 0.565, 0.82, 0.12], 0.022, frame);
      }
      // The bridge between the lenses.
      p.add(new THREE.TorusGeometry(0.05, 0.022, 6, 12, Math.PI), frame, { at: [0, 0.81, 0.63] });
      p.done();
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

// A new copy of the item for one Mosh: { obj (on its torso) or feet ([left, right]), slot, lift,
// crowned, animate }.
export function makeItem(id) {
  const item = ITEMS[id];
  if (!item) return null;
  return {
    obj: item.feet ? null : copy(id, (g) => item.build(g)),
    feet: item.feet ? [-1, 1].map((side) => copy(`${id}:${side}`, shoe(item, side))) : null,
    slot: COSMETICS[id].slot,
    lift: item.lift ?? 0,
    crowned: item.crowned ?? null,
    animate: item.animate ?? null,
  };
}

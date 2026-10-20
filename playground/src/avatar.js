import * as THREE from 'three';
import { cleanOutfit } from '../../shared/cosmetics.js';
import { toon } from './gfx.js';
import { makeItem } from './outfits.js';

// A Mosh, the chubby little party character everyone plays as. Origin is at its feet; it faces +z.
// About 1.7 units tall.

const CROWN_POINTS = 5;
const CROWN_RADIUS = 0.3;

// One continuous band whose top edge zigzags into points, so there are no seams or gaps
// between the band and the spikes. Its bottom edge sits at y = 0.
function crownGeometry(points = CROWN_POINTS) {
  const geometry = new THREE.CylinderGeometry(CROWN_RADIUS, CROWN_RADIUS - 0.03, 1, points * 8, 1, true, Math.PI);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) {
      pos.setY(i, 0);
      continue;
    }
    // Peaks where the angle is a multiple of 2π / points (the first one faces front).
    const turn = (Math.atan2(pos.getX(i), pos.getZ(i)) / (Math.PI * 2)) * points;
    const tooth = 1 - Math.abs(2 * (((turn % 1) + 1.5) % 1) - 1);
    pos.setY(i, 0.1 + 0.16 * tooth);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const geo = {
  body: new THREE.SphereGeometry(0.62, 28, 20),
  belly: new THREE.SphereGeometry(0.42, 20, 14),
  eye: new THREE.SphereGeometry(0.16, 16, 12),
  pupil: new THREE.SphereGeometry(0.085, 12, 8),
  shine: new THREE.SphereGeometry(0.03, 8, 6),
  cheek: new THREE.SphereGeometry(0.08, 10, 8),
  foot: new THREE.SphereGeometry(0.2, 14, 10),
  hand: new THREE.SphereGeometry(0.15, 14, 10),
  stalk: new THREE.CylinderGeometry(0.03, 0.04, 0.32, 8),
  bobble: new THREE.SphereGeometry(0.11, 14, 10),
  crown: crownGeometry(),
  crownRim: new THREE.TorusGeometry(0.275, 0.04, 8, 40).rotateX(Math.PI / 2),
  crownJewel: new THREE.SphereGeometry(0.045, 10, 8),
};

const shared = {
  crownGold: toon('#ffd23d', { emissive: new THREE.Color('#5a3a00'), side: THREE.DoubleSide }),
  jewel: toon('#ff4d6d'),
  white: toon('#ffffff'),
  pupil: toon('#1d1230'),
  belly: toon('#fff4dc'),
  cheek: toon('#ff9fb4'),
  gold: toon('#ffd23d', { emissive: new THREE.Color('#5a3a00') }),
};
// Shared resources outlive any single scene; disposeScene() skips them.
for (const r of [...Object.values(geo), ...Object.values(shared)]) r.userData.shared = true;

// What each player in the room wears, by their color (unique in a room), so every game's Moshes
// wear it without the games knowing about outfits. main.js keeps it up to date.
const roomOutfits = new Map(); // color -> outfit

export function setRoomOutfits(players) {
  roomOutfits.clear();
  for (const p of players ?? []) if (p.outfit?.length) roomOutfits.set(p.color, p.outfit);
}

export const outfitFor = (color) => roomOutfits.get(color) ?? [];

const ANTENNA_Y = 1.28; // the stalk's middle (it's 0.32 long), with the bobble on top
const BOBBLE_Y = 1.46;
const CROWN_Y = 1.07;

export class Avatar {
  // outfit: the cosmetics it wears (shared/cosmetics.js); by default, whatever the room's player
  // in this color wears.
  constructor(color, outfit = outfitFor(color)) {
    this.group = new THREE.Group();
    this.rig = new THREE.Group(); // animated part; the root group is positioned by the owner
    this.group.add(this.rig);

    this.bodyMat = toon(color);
    this.darkMat = toon(new THREE.Color(color).multiplyScalar(0.6));

    const mesh = (g, m, x = 0, y = 0, z = 0, parent = this.rig) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };

    this.torso = new THREE.Group();
    this.torso.position.y = 0.2;
    this.rig.add(this.torso);

    this.body = mesh(geo.body, this.bodyMat, 0, 0.52, 0, this.torso);
    this.body.scale.set(1, 1.05, 0.95);
    mesh(geo.belly, shared.belly, 0, 0.4, 0.27, this.torso).scale.set(1, 0.95, 0.6);

    for (const side of [-1, 1]) {
      const eye = mesh(geo.eye, shared.white, side * 0.21, 0.76, 0.47, this.torso);
      eye.scale.set(1, 1.3, 0.6);
      mesh(geo.pupil, shared.pupil, side * 0.2, 0.75, 0.55, this.torso).scale.set(1, 1.35, 0.6);
      mesh(geo.shine, shared.white, side * 0.18, 0.81, 0.6, this.torso);
      mesh(geo.cheek, shared.cheek, side * 0.4, 0.57, 0.43, this.torso).scale.set(1.2, 0.8, 0.5);
    }

    this.hands = [-1, 1].map((side) => mesh(geo.hand, this.bodyMat, side * 0.64, 0.42, 0.05, this.torso));
    this.feet = [-1, 1].map((side) => {
      const foot = mesh(geo.foot, this.darkMat, side * 0.24, 0.1, 0.06);
      foot.scale.set(1, 0.6, 1.35);
      return foot;
    });

    this.stalk = mesh(geo.stalk, this.darkMat, 0, ANTENNA_Y, 0, this.torso);
    this.bobble = mesh(geo.bobble, shared.gold, 0, BOBBLE_Y, 0, this.torso);
    this.bobbleY = BOBBLE_Y;

    // The crown's base sits where the head's curve is CROWN_RADIUS wide, and a rim hides
    // where the band meets the head.
    this.crown = new THREE.Group();
    this.crown.position.set(0, CROWN_Y, 0);
    this.crown.rotation.z = 0.12;
    mesh(geo.crown, shared.crownGold, 0, 0, 0, this.crown);
    mesh(geo.crownRim, shared.crownGold, 0, 0.03, 0, this.crown);
    for (let i = 0; i < CROWN_POINTS; i++) {
      const a = (i / CROWN_POINTS) * Math.PI * 2;
      mesh(geo.crownJewel, shared.gold, Math.sin(a) * CROWN_RADIUS, 0.27, Math.cos(a) * CROWN_RADIUS, this.crown);
    }
    mesh(geo.crownJewel, shared.jewel, 0, 0.1, CROWN_RADIUS + 0.01, this.crown).scale.set(1.3, 1.3, 0.7);
    this.crown.visible = false;
    this.torso.add(this.crown);

    this.time = Math.random() * 10;
    this.mode = 'idle';
    this.speed = 0;
    this.worn = new Map(); // slot -> { id, obj, lift, animate }
    this.setOutfit(outfit);
  }

  setColor(color) {
    this.bodyMat.color.set(color);
    this.darkMat.color.set(color).multiplyScalar(0.6);
  }

  setCrown(visible) {
    this.crown.visible = visible;
    this.fitHead();
  }

  // Puts on these cosmetics (and takes off anything else).
  setOutfit(outfit) {
    const ids = cleanOutfit(outfit);
    for (const [slot, w] of this.worn) {
      if (ids.includes(w.id)) continue;
      w.obj?.removeFromParent();
      w.feet?.forEach((shoe) => shoe.removeFromParent());
      this.worn.delete(slot);
    }
    for (const id of ids) {
      if ([...this.worn.values()].some((w) => w.id === id)) continue;
      const item = makeItem(id);
      if (!item) continue;
      if (item.obj) this.torso.add(item.obj);
      item.feet?.forEach((shoe, i) => this.feet[i].add(shoe)); // shoes go on the feet, to walk with them
      if (item.fit) item.obj.traverse((o) => o.material?.userData.stalk && (o.material = this.darkMat)); // an antenna's stalks, like its own
      this.worn.set(item.slot, { id, ...item });
    }
    // An antenna from the shop takes the place of its own.
    const own = !this.worn.has('antenna');
    this.stalk.visible = own;
    this.bobble.visible = own;
    this.fitHead();
  }

  // The crown (the host's, the leader's) goes on top of any hat, and the antenna grows to poke out
  // of the top of whatever's on the head: it always shows.
  fitHead() {
    const hat = this.worn.get('head');
    const crowned = this.crown.visible && hat?.crowned;
    this.crown.position.y = crowned ? hat.crowned.at : CROWN_Y;
    const lift = crowned ? hat.crowned.lift : this.crown.visible ? 0 : (hat?.lift ?? 0);
    // An antenna from the shop starts its look above whatever's on the head (the crown's points
    // reach 0.26 above its base).
    const antenna = this.worn.get('antenna');
    antenna?.fit(antenna.obj, Math.max(hat?.top ?? 0, this.crown.visible ? this.crown.position.y + 0.26 : 0));
    this.stalk.scale.y = (0.32 + lift) / 0.32;
    this.stalk.position.y = ANTENNA_Y + lift / 2;
    this.bobbleY = BOBBLE_Y + lift;
  }

  // mode: 'idle' | 'happy' | 'run' | 'jump' | 'fall' | 'stuck' | 'swim' | 'balance' | 'sleep' | 'cheer'
  update(dt, mode = this.mode, speed = 0) {
    this.mode = mode;
    this.speed = speed;
    this.time += dt;
    const t = this.time;
    const torso = this.torso;
    const [lh, rh] = this.hands;
    const [lf, rf] = this.feet;

    // Reset to neutral, then layer the pose on top.
    torso.position.set(0, 0.2, 0);
    torso.rotation.set(0, 0, 0);
    torso.scale.set(1, 1, 1);
    lh.position.set(-0.64, 0.42, 0.05);
    rh.position.set(0.64, 0.42, 0.05);
    lf.position.set(-0.24, 0.1, 0.06);
    rf.position.set(0.24, 0.1, 0.06);
    this.bobble.position.set(0, this.bobbleY, 0);

    if (mode === 'idle') {
      const breathe = Math.sin(t * 3);
      torso.scale.set(1 - breathe * 0.02, 1 + breathe * 0.03, 1 - breathe * 0.02);
      torso.rotation.z = Math.sin(t * 1.3) * 0.04;
      lh.position.y += Math.sin(t * 3) * 0.03;
      rh.position.y += Math.sin(t * 3 + 1) * 0.03;
      this.bobble.position.x = Math.sin(t * 2) * 0.04;
    } else if (mode === 'happy' || mode === 'cheer') {
      const rate = mode === 'cheer' ? 9 : 6.5;
      const hop = Math.abs(Math.sin(t * rate));
      torso.position.y += hop * (mode === 'cheer' ? 0.6 : 0.35);
      const squash = 1 - (1 - hop) * 0.12;
      torso.scale.set(2 - squash, squash, 2 - squash);
      lh.position.set(-0.6, 0.95 + hop * 0.15, 0.05);
      rh.position.set(0.6, 0.95 + hop * 0.15, 0.05);
      lf.position.y += hop * 0.3;
      rf.position.y += hop * 0.3;
      if (mode === 'cheer') torso.rotation.y = Math.sin(t * 4) * 0.4;
      this.bobble.position.x = Math.sin(t * rate) * 0.08;
    } else if (mode === 'run') {
      const rate = 8 + Math.min(speed, 12);
      const s = Math.sin(t * rate);
      lf.position.z += s * 0.18;
      rf.position.z -= s * 0.18;
      lf.position.y += Math.max(0, s) * 0.1;
      rf.position.y += Math.max(0, -s) * 0.1;
      lh.position.z -= s * 0.15;
      rh.position.z += s * 0.15;
      torso.rotation.x = Math.min(speed, 10) * 0.025;
      torso.position.y += Math.abs(s) * 0.05;
      this.bobble.position.z = -Math.min(speed, 10) * 0.01;
    } else if (mode === 'jump') {
      lh.position.set(-0.68, 0.85, 0.05);
      rh.position.set(0.68, 0.85, 0.05);
      lf.position.set(-0.22, 0.28, 0.2);
      rf.position.set(0.22, 0.18, -0.12);
      torso.scale.set(0.95, 1.08, 0.95);
      this.bobble.position.z = -0.08;
    } else if (mode === 'fall') {
      const flail = Math.sin(t * 22);
      lh.position.set(-0.7, 1.0 + flail * 0.15, 0);
      rh.position.set(0.7, 1.0 - flail * 0.15, 0);
      lf.position.y += Math.max(0, flail) * 0.15;
      rf.position.y += Math.max(0, -flail) * 0.15;
      torso.scale.set(0.92, 1.12, 0.92);
    } else if (mode === 'stuck') {
      // Feet glued down, tugging side to side.
      const tug = Math.sin(t * 15);
      torso.rotation.z = tug * 0.14;
      torso.position.y -= 0.06;
      torso.scale.set(1.06, 0.92, 1.06);
      lh.position.set(-0.7, 0.8 + tug * 0.12, 0.12);
      rh.position.set(0.7, 0.8 - tug * 0.12, 0.12);
      lf.position.y = 0.06;
      rf.position.y = 0.06;
    } else if (mode === 'swim') {
      // Paddling along in a swim ring.
      const stroke = t * 5;
      torso.position.y += Math.sin(t * 2.4) * 0.04;
      torso.rotation.z = Math.sin(t * 1.7) * 0.08;
      lh.position.set(-0.72, 0.55 + Math.sin(stroke) * 0.08, 0.15 + Math.cos(stroke) * 0.15);
      rh.position.set(0.72, 0.55 + Math.sin(stroke + Math.PI) * 0.08, 0.15 + Math.cos(stroke + Math.PI) * 0.15);
    } else if (mode === 'balance') {
      // On a tightrope: feet one in front of the other, arms out holding a balancing pole.
      const pace = Math.min(1, speed / 3);
      const s = Math.sin(t * (3 + pace * 6));
      lh.position.set(-0.58, 0.74, 0.3);
      rh.position.set(0.58, 0.74, 0.3);
      lf.position.set(-0.07, 0.1 + Math.max(0, s) * 0.08 * pace, 0.06 + s * 0.16 * pace);
      rf.position.set(0.07, 0.1 + Math.max(0, -s) * 0.08 * pace, 0.06 - s * 0.16 * pace);
      torso.position.y += Math.abs(s) * 0.03 * pace;
    } else if (mode === 'sleep') {
      torso.rotation.z = 0.25;
      torso.scale.set(1.04, 0.94 + Math.sin(t * 1.5) * 0.02, 1.04);
      lh.position.y -= 0.12;
      rh.position.y -= 0.12;
    }

    for (const w of this.worn.values()) w.animate?.(w.obj, this, dt, speed);
  }

  dispose() {
    this.bodyMat.dispose();
    this.darkMat.dispose();
  }
}

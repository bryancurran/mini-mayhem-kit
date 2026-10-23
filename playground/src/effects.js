import * as THREE from 'three';

// Cosmetic effects a Mosh leaves in the world around it (shared/cosmetics.js): a trail as it runs,
// or a burst every time it hops for joy. Each Mosh wearing one has an Effect, whose marks (pooled,
// drawn with one instanced mesh per layer of their look) go straight into the Mosh's scene, not on
// the Mosh, so a trail stays where it was left.
//
// avatar.js makes the marks (make(), in its update); a ticker of their own moves them on and ages
// them every frame, so they still fade away when a game stops updating a Mosh it's done with (or
// throws it away), and an Effect whose marks are all gone and whose Mosh has stopped takes its
// meshes out of the scene.
//
// What an effect does is in its spec (outfits.js):
//   on: 'run' (a mark every spacing units it moves; ground: only while it's on the ground) or
//       'cheer' (a burst of burst marks each time it hops for joy: every hop when it cheers, every
//       other one when it's happy)
//   max: the most marks at once
//   look(): [{ geometry, material, tint }], the layers each mark is drawn with (tint: each mark's
//       color goes on this one). Made the first time it's needed, and shared by every Mosh.
//   spawn(mark, at): sets a new mark up. at: { pos (where the Mosh's feet are), forward (the way
//       it's going, flat), side (its right, flat), foot (-1 or 1, every other mark), scale (the
//       Mosh's size), index (marks made so far), distance (how far it has run) }
//   tick(mark, dt): anything else a mark does as it lives (optional)
// A mark: { pos, vel, gravity, drag, age, life, size, grow, fade, pop, rot, spin, color, shape,
// wobble, phase, clip }. It grows from nothing over grow seconds (overshooting a little, like a
// pop), shrinks back to nothing over its last fade seconds (or with pop, swells and vanishes), and
// rot turns by spin (radians a second) as it goes.

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const offset = new THREE.Vector3();
const at = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), side: new THREE.Vector3(), foot: 1, scale: 1, index: 0, distance: 0 };

// A pop: up from nothing past full size, and back.
const popIn = (t) => {
  const s = 1.7;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

const live = new Set(); // Effects with marks out, or a Mosh still wearing them
let last = 0;
function tick(now) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  for (const e of live) e.step(dt, now);
  if (live.size) requestAnimationFrame(tick);
  else last = 0;
}
const wake = (e) => {
  if (!live.size) requestAnimationFrame(tick);
  live.add(e);
};

const newMark = () => ({
  alive: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  gravity: 0,
  drag: 0,
  age: 0,
  life: 1,
  size: 1,
  grow: 0,
  fade: 0,
  pop: false,
  rot: new THREE.Euler(),
  spin: new THREE.Vector3(),
  color: new THREE.Color('#ffffff'),
  shape: new THREE.Vector3(1, 1, 1),
  wobble: 0,
  phase: 0,
  clip: null, // { x, z, radius }: shrinks away past there (the profile's stand)
});

export class Effect {
  constructor(avatar, spec) {
    this.avatar = avatar;
    this.spec = spec;
    spec.layers ??= spec.look();
    this.meshes = spec.layers.map(({ geometry, material }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, spec.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.effect = true;
      for (let i = 0; i < spec.max; i++) mesh.setMatrixAt(i, HIDDEN);
      return mesh;
    });
    this.tinted = this.meshes.filter((m, i) => spec.layers[i].tint);
    for (const mesh of this.tinted) for (let i = 0; i < spec.max; i++) mesh.setColorAt(i, new THREE.Color('#ffffff'));
    this.marks = Array.from({ length: spec.max }, newMark);
    this.next = 0;
    this.alive = 0;
    this.made = 0;
    this.travel = 0; // how far since the last mark
    this.distance = 0;
    this.hops = null; // the hop count it last burst on
    this.root = null; // the scene its marks are in
    this.drift = new THREE.Vector3(); // a treadmill's: the ground going by under a Mosh running on the spot
    this.seen = 0; // when its Mosh was last updated
    this.worn = true;
  }

  // From the Mosh's update (dt in seconds), after it has moved and posed.
  make(dt) {
    if (!dt) return;
    const a = this.avatar;
    this.seen = performance.now();
    wake(this);
    let root = a.group;
    let shown = true;
    for (let o = a.group; o; o = o.parent) {
      if (!o.visible) shown = false;
      root = o;
    }
    if (root === a.group) return; // not in a scene
    if (root !== this.root) {
      this.clear();
      this.root = root;
    }
    for (const mesh of this.meshes) if (mesh.parent !== root) root.add(mesh);
    this.drift.copy(a.treadmill ?? offset.set(0, 0, 0));
    if (!shown) return;

    const spec = this.spec;
    const size = a.worldScale;
    at.scale = size;
    if (spec.on === 'run') {
      const moved = a.moved;
      const flat = Math.hypot(moved.x, moved.z);
      const airborne = a.mode === 'jump' || a.mode === 'fall' || a.mode === 'swim' || Math.abs(a.velocity.y) > 2.5 * size;
      // (Only while it's really going, and never on the ground in mid-air.)
      if (flat < 0.6 * size * dt || (spec.ground && airborne)) {
        this.travel = Math.min(this.travel, spec.spacing * size * 0.5);
        return;
      }
      at.forward.set(moved.x / flat, 0, moved.z / flat);
      at.side.set(at.forward.z, 0, -at.forward.x);
      this.travel += flat;
      this.distance += flat / size;
      const step = spec.spacing * size;
      while (this.travel >= step) {
        this.travel -= step;
        // Evenly spaced along the way it came, however far it went this frame (with a treadmill
        // they're left where it stands, and the ground carries them off).
        at.pos.copy(a.world);
        if (!a.treadmill) at.pos.addScaledVector(at.forward, -this.travel);
        at.foot = this.made % 2 ? 1 : -1;
        at.distance = this.distance - this.travel / size;
        this.spawn();
      }
    } else if (spec.on === 'cheer') {
      const happy = a.mode === 'happy';
      if (!happy && a.mode !== 'cheer') {
        this.hops = null;
        return;
      }
      // A hop starts every time |sin(time × rate)| (avatar.js) comes back down to nothing.
      const hops = Math.floor((a.time * (happy ? 6.5 : 9)) / Math.PI);
      if (hops === this.hops) return;
      const first = this.hops === null;
      this.hops = hops;
      if (happy && !first && hops % 2) return;
      at.pos.copy(a.world);
      at.forward.set(0, 0, 1).applyQuaternion(a.group.getWorldQuaternion(quat));
      at.forward.y = 0;
      at.forward.normalize();
      at.side.set(at.forward.z, 0, -at.forward.x);
      for (let i = 0; i < spec.burst; i++) {
        at.foot = i % 2 ? 1 : -1;
        this.spawn();
      }
    }
  }

  spawn() {
    const i = this.next;
    const m = this.marks[i];
    if (!m.alive) this.alive++;
    this.next = (i + 1) % this.marks.length;
    m.alive = true;
    m.vel.set(0, 0, 0);
    m.gravity = 0;
    m.drag = 0;
    m.age = 0;
    m.life = 1;
    m.size = at.scale;
    m.grow = 0.1;
    m.fade = 0.3;
    m.pop = false;
    m.rot.set(0, 0, 0);
    m.spin.set(0, 0, 0);
    m.color.set('#ffffff');
    m.shape.set(1, 1, 1);
    m.wobble = 0;
    m.phase = Math.random() * Math.PI * 2;
    m.clip = this.avatar.treadmill && this.avatar.treadmillRadius ? { x: this.avatar.world.x, z: this.avatar.world.z, radius: this.avatar.treadmillRadius } : null;
    at.index = this.made++;
    this.spec.spawn(m, at);
    for (const mesh of this.tinted) {
      mesh.setColorAt(i, m.color);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  // From the ticker: moves every mark on by dt seconds.
  step(dt, now) {
    if (this.alive) {
      const tickMark = this.spec.tick;
      for (let i = 0; i < this.marks.length; i++) {
        const m = this.marks[i];
        if (!m.alive) continue;
        m.age += dt;
        if (m.age >= m.life) {
          m.alive = false;
          this.alive--;
          for (const mesh of this.meshes) mesh.setMatrixAt(i, HIDDEN);
          continue;
        }
        m.vel.y -= m.gravity * dt;
        if (m.drag) m.vel.multiplyScalar(Math.exp(-m.drag * dt));
        m.pos.addScaledVector(m.vel, dt);
        // (On a treadmill, the ground carries what's on it away, and lets what's in the air hang
        // about longer, to be seen.)
        m.pos.addScaledVector(this.drift, -dt * (this.spec.ground ? 1 : 0.35));
        tickMark?.(m, dt);
        let s = m.grow && m.age < m.grow ? popIn(m.age / m.grow) : 1;
        const left = m.life - m.age;
        if (m.pop) {
          if (left < 0.12) s *= 1 + (0.12 - left) * 4;
        } else if (m.fade && left < m.fade) s *= left / m.fade;
        if (m.clip) {
          const out = Math.hypot(m.pos.x - m.clip.x, m.pos.z - m.clip.z) - m.clip.radius;
          if (out > 0) s *= Math.max(0, 1 - out / 0.18);
        }
        euler.set(m.rot.x + m.spin.x * m.age, m.rot.y + m.spin.y * m.age, m.rot.z + m.spin.z * m.age);
        offset.copy(m.pos);
        if (m.wobble) {
          offset.x += Math.sin(m.age * 5 + m.phase) * m.wobble;
          offset.z += Math.cos(m.age * 4 + m.phase) * m.wobble;
        }
        matrix.compose(offset, quat.setFromEuler(euler), scale.copy(m.shape).multiplyScalar(m.size * Math.max(0, s)));
        for (const mesh of this.meshes) mesh.setMatrixAt(i, matrix);
      }
      for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
    // Its Mosh has stopped (taken off, or the game's done with it) and the last marks are gone.
    if (!this.alive && (!this.worn || now - this.seen > 1000)) {
      for (const mesh of this.meshes) mesh.removeFromParent();
      this.root = null;
      live.delete(this);
    }
  }

  // Every mark gone straight away.
  clear() {
    for (let i = 0; i < this.marks.length; i++) {
      this.marks[i].alive = false;
      for (const mesh of this.meshes) mesh.setMatrixAt(i, HIDDEN);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    this.alive = 0;
  }

  // Taken off: the marks already made fade out as they would, then it goes.
  stop() {
    this.worn = false;
    if (!this.alive) {
      for (const mesh of this.meshes) mesh.removeFromParent();
      live.delete(this);
    }
  }
}

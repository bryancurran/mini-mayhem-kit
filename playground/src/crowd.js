import * as THREE from 'three';
import { noOutline, toon } from './gfx.js';

// Lots of little Moshes (conga dancers, party guests, spectators) drawn with a handful of
// instanced meshes instead of one Avatar each. They look like small Avatars. The cartoon
// outline pass can't handle instanced meshes, so the bigger parts get their own outline: a
// slightly larger, inside-out copy drawn in the outline color.
//
// Each frame: begin(), add() every Mosh, end().

const OUTLINE = '#1c122e';
const OUTLINE_WIDTH = 0.022; // world units at scale 1
const CREAM = '#fff4dc';
const DARK = '#1d1230';

const sphere = new THREE.SphereGeometry(1, 16, 12);
const smallSphere = new THREE.SphereGeometry(1, 10, 8);
const cone = new THREE.ConeGeometry(1, 1, 14).translate(0, 0.5, 0);
// Shared by every crowd, so disposeScene() leaves them alone.
for (const g of [sphere, smallSphere, cone]) g.userData.shared = true;

// Part layout in Mosh space (feet at the origin, facing +z, about 1.7 tall at scale 1),
// matching Avatar. per: how many of the part each Mosh has; color: 'body' | 'dark' | 'hat'
// take the Mosh's colors, anything else is fixed; outline: draw an outline shell.
const PARTS = [
  { name: 'body', geo: sphere, r: 0.62, pos: [0, 0.72, 0], scale: [1, 1.05, 0.95], color: 'body', outline: true },
  { name: 'belly', geo: smallSphere, r: 0.42, pos: [0, 0.6, 0.27], scale: [1, 0.95, 0.6], color: CREAM },
  { name: 'eye', geo: smallSphere, r: 0.16, pos: [0.21, 0.96, 0.47], scale: [1, 1.3, 0.6], color: '#ffffff', per: 2 },
  { name: 'pupil', geo: smallSphere, r: 0.085, pos: [0.2, 0.95, 0.55], scale: [1, 1.35, 0.6], color: DARK, per: 2 },
  { name: 'foot', geo: smallSphere, r: 0.2, pos: [0.24, 0.1, 0.06], scale: [1, 0.6, 1.35], color: 'dark', per: 2, outline: true },
  { name: 'hand', geo: smallSphere, r: 0.15, pos: [0.6, 0.62, 0.12], scale: [1, 1, 1], color: 'body', per: 2, outline: true },
  { name: 'hat', geo: cone, r: 0.26, pos: [0, 1.22, 0], scale: [1, 2.2, 1], color: 'hat', outline: true },
  { name: 'pom', geo: smallSphere, r: 0.08, pos: [0, 1.8, 0], scale: [1, 1, 1], color: '#ffffff' },
];

const m4 = new THREE.Matrix4();
const base = new THREE.Matrix4();
const local = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const color = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class MoshCrowd {
  constructor(scene, max, { shadows = true } = {}) {
    this.max = max;
    this.count = 0;
    this.parts = PARTS.map((p) => {
      const per = p.per ?? 1;
      const fixed = !['body', 'dark', 'hat'].includes(p.color);
      const mat = noOutline(toon(fixed ? p.color : '#ffffff'));
      const mesh = new THREE.InstancedMesh(p.geo, mat, max * per);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows && (p.name === 'body' || p.name === 'hat');
      if (!fixed) mesh.setColorAt(0, color.set('#ffffff'));
      scene.add(mesh);
      let shell = null;
      if (p.outline) {
        shell = new THREE.InstancedMesh(p.geo, noOutline(new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide })), max * per);
        shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        shell.frustumCulled = false;
        scene.add(shell);
      }
      return { ...p, per, fixed, mesh, shell };
    });
  }

  begin() {
    this.count = 0;
  }

  // c: { x, y, z, yaw, scale, color, dark?, hat? (color, or null for no hat), sway, bounce,
  //      step (−1…1: which foot is up), arms (0 at the sides … 1 up in the air), reach (0…1:
  //      hands held out in front), spin (tumbling, radians) }
  add(c) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const s = c.scale ?? 1;
    euler.set(c.spin ?? 0, c.yaw ?? 0, c.sway ?? 0, 'YXZ');
    quat.setFromEuler(euler);
    base.compose(pos.set(c.x, (c.y ?? 0) + (c.bounce ?? 0), c.z), quat, scl.set(s, s, s));
    const step = c.step ?? 0;
    const arms = c.arms ?? 0;
    const reach = c.reach ?? 0;

    for (const p of this.parts) {
      for (let k = 0; k < p.per; k++) {
        const idx = i * p.per + k;
        const side = p.per === 2 ? (k === 0 ? -1 : 1) : 1;
        let [x, y, z] = p.pos;
        x *= side;
        let hidden = false;
        if (p.name === 'foot') {
          const lift = Math.max(0, side * step);
          y += lift * 0.18;
          z += lift * 0.1;
        } else if (p.name === 'hand') {
          // From the sides, up into the air, or out in front (conga hands on the shoulders).
          x = side * (0.6 - arms * 0.05 - reach * 0.22);
          y = 0.62 + arms * 0.5 + reach * 0.12;
          z = 0.12 + reach * 0.42;
        } else if (p.name === 'hat' || p.name === 'pom') {
          hidden = !c.hat;
        }
        if (hidden) {
          p.mesh.setMatrixAt(idx, ZERO);
          p.shell?.setMatrixAt(idx, ZERO);
          continue;
        }
        const [sx, sy, sz] = p.scale;
        local.compose(pos.set(x, y, z), quat.identity(), scl.set(p.r * sx, p.r * sy, p.r * sz));
        m4.multiplyMatrices(base, local);
        p.mesh.setMatrixAt(idx, m4);
        if (p.shell) {
          const grow = OUTLINE_WIDTH / p.r;
          local.compose(pos.set(x, y, z), quat.identity(), scl.set(p.r * (sx + grow), p.r * (sy + grow), p.r * (sz + grow)));
          m4.multiplyMatrices(base, local);
          p.shell.setMatrixAt(idx, m4);
        }
        if (!p.fixed) {
          const value = p.color === 'body' ? c.color : p.color === 'dark' ? (c.dark ?? c.color) : c.hat;
          p.mesh.setColorAt(idx, color.set(value));
        }
      }
    }
  }

  end() {
    for (const p of this.parts) {
      p.mesh.count = this.count * p.per;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      if (p.shell) {
        p.shell.count = this.count * p.per;
        p.shell.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

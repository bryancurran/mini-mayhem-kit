import * as THREE from 'three';
import { noOutline } from './gfx.js';

// Pooled burst particles drawn with one instanced mesh.
export class Particles {
  constructor(scene, max = 400) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      noOutline(new THREE.MeshBasicMaterial({ color: '#ffffff' })),
      max,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.items = Array.from({ length: max }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      size: 0.2,
      gravity: 0,
      spin: 0,
    }));
    this.next = 0;
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.color = new THREE.Color();
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.scale = new THREE.Vector3();
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, this.color);
    }
    scene.add(this.mesh);
  }

  spawn({ x, y, z, vx = 0, vy = 0, vz = 0, life = 0.6, size = 0.2, gravity = 0, color = '#ffffff' }) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const p = this.items[i];
    p.alive = true;
    p.pos.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.gravity = gravity;
    p.spin = Math.random() * 10;
    this.mesh.setColorAt(i, this.color.set(color));
    this.mesh.instanceColor.needsUpdate = true;
  }

  burst(x, y, z, { count = 12, speed = 6, up = 2, life = 0.5, size = 0.18, gravity = 6, colors = ['#ffffff'] } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.5);
      this.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: up * (0.5 + Math.random()),
        vz: Math.sin(a) * s,
        life: life * (0.7 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.8),
        gravity,
        color: colors[i % colors.length],
      });
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-1.5 * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.spin += dt * 8;
      const s = p.size * Math.min(1, (p.life / p.maxLife) * 1.6);
      this.quat.setFromEuler(this.euler.set(p.spin, p.spin * 0.7, 0));
      this.matrix.compose(p.pos, this.quat, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Expanding rings on the water surface.
export class Ripples {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.RingGeometry(0.85, 1, 40);
    this.geo.rotateX(-Math.PI / 2);
    this.active = [];
  }

  spawn(x, y, z, { size = 3, life = 1.2 } = {}) {
    const mat = noOutline(
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.set(x, y + 0.35, z);
    this.scene.add(mesh);
    this.active.push({ mesh, life, maxLife: life, size });
  }

  update(dt) {
    this.active = this.active.filter((r) => {
      r.life -= dt;
      const k = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.5 + k * r.size);
      r.mesh.material.opacity = Math.max(0, 1 - k) * 0.9;
      if (r.life > 0) return true;
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
      return false;
    });
  }
}

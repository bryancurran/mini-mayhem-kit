import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

// Owns the WebGL renderer and the frame loop. Whatever "view" is active ({ scene, camera,
// update(dt, now), resize(w, h) }) gets updated and drawn every frame.
export class Engine {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.004,
      defaultColor: [0.11, 0.07, 0.18],
    });

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.view = null;
    this.last = performance.now();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setView(view) {
    // Labels from the previous scene would otherwise linger on screen.
    if (view !== this.view) this.labels.domElement.replaceChildren();
    this.view = view;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.view?.resize?.(w, h);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const view = this.view;
    if (!view) return;
    view.update(dt, now);
    this.outline.render(view.scene, view.camera);
    this.labels.render(view.scene, view.camera);
  }
}

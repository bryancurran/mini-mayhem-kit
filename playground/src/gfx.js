import * as THREE from 'three';

// Shared cartoon-style building blocks: toon materials, sky, clouds, water.

let gradientMap = null;

function toonGradient() {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

export function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

// Hide an object's material from the cartoon outline pass.
export function noOutline(material) {
  material.userData.outlineParameters = { visible: false };
  return material;
}

export const SKY_TOP = new THREE.Color('#4aa8ff');
export const SKY_HORIZON = new THREE.Color('#d4f0ff');

export function addSky(scene) {
  const geo = new THREE.SphereGeometry(450, 32, 16);
  const mat = noOutline(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: SKY_TOP }, uHorizon: { value: SKY_HORIZON } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.6)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(SKY_HORIZON, 90, 320);
  return sky;
}

export function addLights(scene, { shadowSize = 20, target = new THREE.Vector3() } = {}) {
  scene.add(new THREE.HemisphereLight('#ffffff', '#8fb6d9', 1.6));
  const sun = new THREE.DirectionalLight('#fff6e0', 2.2);
  sun.position.set(target.x + 14, target.y + 30, target.z + 10);
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -shadowSize;
  cam.right = shadowSize;
  cam.top = shadowSize;
  cam.bottom = -shadowSize;
  cam.near = 1;
  cam.far = 90;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  return sun;
}

// Puffy clouds drifting in a slow circle around the origin. Pass place(i) to position them
// yourself instead.
export function addClouds(scene, { count = 14, minRadius = 70, maxRadius = 170, minY = 8, maxY = 50, place } = {}) {
  const group = new THREE.Group();
  const mat = toon('#ffffff');
  const puff = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let j = 0; j < puffs; j++) {
      const m = new THREE.Mesh(puff, mat);
      const s = 3 + Math.random() * 3;
      m.scale.set(s, s * 0.75, s);
      m.position.set((j - puffs / 2) * 3.4, Math.random() * 1.5, (Math.random() - 0.5) * 3);
      cloud.add(m);
    }
    if (place) {
      cloud.position.copy(place(i));
    } else {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      cloud.position.set(Math.cos(angle) * radius, minY + Math.random() * (maxY - minY), Math.sin(angle) * radius);
    }
    cloud.rotation.y = Math.random() * Math.PI;
    group.add(cloud);
  }
  scene.add(group);
  return {
    group,
    update(dt) {
      group.rotation.y += dt * 0.004;
    },
  };
}

export function addWater(scene, y) {
  const geo = new THREE.PlaneGeometry(700, 700, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const mat = noOutline(
    new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uShallow: { value: new THREE.Color('#3fc6ff') },
          uDeep: { value: new THREE.Color('#1667c9') },
          uFoam: { value: new THREE.Color('#e8fbff') },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        uniform float uTime;
        varying vec2 vWorld;
        varying float vHeight;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          float h = sin(world.x * 0.22 + uTime * 1.1) * 0.3 + cos(world.z * 0.18 + uTime * 0.8) * 0.3;
          world.y += h;
          vHeight = h;
          vWorld = world.xz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uFoam;
        varying vec2 vWorld;
        varying float vHeight;
        void main() {
          float dist = length(vWorld);
          vec3 color = mix(uShallow, uDeep, smoothstep(12.0, 90.0, dist));
          float ripple = sin(vWorld.x * 0.5 + sin(vWorld.y * 0.35 + uTime * 0.7) * 2.0 + uTime * 1.3)
                       * sin(vWorld.y * 0.45 - uTime * 0.9 + sin(vWorld.x * 0.2) * 1.5);
          color = mix(color, uFoam, smoothstep(0.78, 0.82, ripple) * 0.55);
          color += vHeight * 0.06;
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    }),
  );
  const water = new THREE.Mesh(geo, mat);
  water.position.y = y;
  scene.add(water);
  return {
    mesh: water,
    update(time) {
      mat.uniforms.uTime.value = time;
    },
  };
}

// Beach-ball style texture so you can see the ball rolling.
export function beachBallTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 54, 256, 20);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(32 + i * 64, 26, 9, 0, Math.PI * 2);
    g.arc(64 + i * 64, 102, 9, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Frees GPU resources and removes HTML labels belonging to a scene.
export function disposeScene(scene) {
  const labels = [];
  scene.traverse((obj) => {
    if (obj.isCSS2DObject) labels.push(obj);
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (m.userData.shared) continue;
      m.map?.dispose();
      m.dispose();
    }
  });
  for (const label of labels) label.removeFromParent();
}

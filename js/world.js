import * as THREE from 'three';
import { getSource, largeMapData } from './assets.js';
import { MAPS } from './maps.js';

/** The exported island is scaled up so a fly-over takes a while at jet speeds. */
export const WORLD_SCALE = 3;
export const PLAIN_CENTER = new THREE.Vector3(5 * WORLD_SCALE, 2 * WORLD_SCALE, 5 * WORLD_SCALE);
export const PLAIN_RADIUS = 25 * WORLD_SCALE;
export let BOUND_RADIUS = 650;
export let CEILING = 260;
/** Reload strip on the plain: fly low over it to get bombs back and patch the jet up. */
export const PAD = new THREE.Vector3(15, 0, -30);
export const PAD_RADIUS = 30;
export const PAD_MAX_AGL = 35;
const SEABED = -7 * WORLD_SCALE;

const TERRAIN_MATS = new Set(['Isle_Sand', 'Isle_Grass', 'Isle_Forest', 'Isle_Rock', 'Isle_Snow', 'Isle_Seabed']);
const firstMatName = (mesh) => ([].concat(mesh.material)[0]?.name ?? '').replace(/\.\d+$/, '');

export class World {
  constructor(scene, mapId = 'small') {
    this.scene = scene;
    this.setMap(mapId);
    this.addSky();
    this.addLights();
    this.addClouds();
  }

  setMap(id) {
    if (this.map?.id === id) return;
    if (this.island) this.scene.remove(this.island);
    if (this.pad) {
      this.scene.remove(this.pad);
      this.pad.traverse((o) => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
    }
    if (this.ocean) { this.scene.remove(this.ocean); this.ocean.geometry.dispose(); this.ocean.material.dispose(); }
    this.map = MAPS.find((m) => m.id === id) ?? MAPS[0];
    BOUND_RADIUS = this.map.radius;
    CEILING = this.map.ceiling;
    this.buildings = id === 'large' ? largeMapData.buildings : [];
    PAD.set(...(id === 'large' ? largeMapData.pad : [15, 0, -30]));
    PLAIN_CENTER.set(id === 'large' ? -75 : 15, 6, id === 'large' ? 55 : 15);
    this.island = getSource(this.map.file);
    this.island.scale.setScalar(WORLD_SCALE);
    this.scene.add(this.island);
    this.island.updateMatrixWorld(true);

    this.terrainMeshes = [];
    this.island.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      const name = firstMatName(o);
      let ancestor = o, terrain = false;
      while (ancestor) {
        if (ancestor.name === 'LowPolyIsland' || ancestor.name === 'LowPolyIsland_Expanded') terrain = true;
        ancestor = ancestor.parent;
      }
      if (terrain && TERRAIN_MATS.has(name)) this.terrainMeshes.push(o);
      else if (name === 'Isle_Water') this.water = o;
    });

    this.buildHeightGrid();
    PAD.y = this.heightAt(PAD.x, PAD.z);
    this.addPad();
    this.setupWater();
  }

  blocked(x, z, margin = 3) {
    return this.buildings.some((b) => x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin);
  }

  drivable(x, z, maxY = Infinity, normal = new THREE.Vector3()) {
    const y = this.heightAt(x, z, normal);
    return y >= 4.5 && y <= maxY && normal.y >= Math.cos(22 * Math.PI / 180) && !this.blocked(x, z);
  }

  // ---------- terrain height lookup (exact, from the terrain triangles) ----------

  buildHeightGrid() {
    const v = new THREE.Vector3();
    const tris = [];
    for (const m of this.terrainMeshes) {
      const pos = m.geometry.attributes.position;
      const idx = m.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
        tris.push(v.x, v.y, v.z);
      }
    }
    const T = (this.tris = new Float32Array(tris));
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < T.length; i += 3) {
      minX = Math.min(minX, T[i]); maxX = Math.max(maxX, T[i]);
      minZ = Math.min(minZ, T[i + 2]); maxZ = Math.max(maxZ, T[i + 2]);
    }
    const cell = (this.cell = 10);
    this.gx0 = minX; this.gz0 = minZ;
    this.gw = Math.ceil((maxX - minX) / cell) + 1;
    this.gh = Math.ceil((maxZ - minZ) / cell) + 1;
    this.bounds = { minX, maxX, minZ, maxZ };
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    for (let t = 0; t < T.length / 9; t++) {
      const o = t * 9;
      const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
      const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
      const cx0 = Math.floor((x0 - minX) / cell), cx1 = Math.floor((x1 - minX) / cell);
      const cz0 = Math.floor((z0 - minZ) / cell), cz1 = Math.floor((z1 - minZ) / cell);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.cells[cz * this.gw + cx].push(t);
    }
  }

  /** Terrain height at (x, z). Writes the surface normal into `normalOut` when given. */
  heightAt(x, z, normalOut = null) {
    const cx = Math.floor((x - this.gx0) / this.cell);
    const cz = Math.floor((z - this.gz0) / this.cell);
    if (cx >= 0 && cz >= 0 && cx < this.gw && cz < this.gh) {
      const T = this.tris;
      for (const t of this.cells[cz * this.gw + cx]) {
        const o = t * 9;
        const ax = T[o], ay = T[o + 1], az = T[o + 2];
        const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
        const qx = T[o + 6], qy = T[o + 7], qz = T[o + 8];
        const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / d;
        const l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        if (normalOut) {
          const ux = bx - ax, uy = by - ay, uz = bz - az;
          const wx = qx - ax, wy = qy - ay, wz = qz - az;
          normalOut.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx).normalize();
          if (normalOut.y < 0) normalOut.negate();
        }
        return l1 * ay + l2 * by + l3 * qy;
      }
    }
    if (normalOut) normalOut.set(0, 1, 0);
    return SEABED;
  }

  addPad() {
    const g = (this.pad = new THREE.Group());
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(16, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 }));
    strip.visible = this.map.id !== 'large';
    strip.receiveShadow = true;
    g.add(strip);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = -3; i <= 3; i++) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 5).rotateX(-Math.PI / 2), dashMat);
      d.position.set(0, 0.05, i * 8.5);
      if (this.map.id !== 'large') g.add(d);
    }
    this.padRing = new THREE.Mesh(
      new THREE.RingGeometry(PAD_RADIUS - 1.2, PAD_RADIUS, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x49d36f, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.padRing.position.y = 0.15;
    g.add(this.padRing);
    this.padLights = [];
    const lightGeo = new THREE.SphereGeometry(0.7, 6, 4);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0x9dffb4 }));
      m.position.set(Math.cos(a) * PAD_RADIUS, 0.8, Math.sin(a) * PAD_RADIUS);
      g.add(m);
      this.padLights.push(m);
    }
    g.position.copy(PAD).setY(PAD.y + 0.12);
    this.scene.add(g);
  }

  /** What a falling object hits first: the ground, or the sea surface at y = 0. */
  surfaceAt(x, z) {
    let y = Math.max(this.heightAt(x, z), 0);
    for (const b of this.buildings) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) y = Math.max(y, b.top);
    return y;
  }

  isWater(x, z) {
    return this.heightAt(x, z) < 0;
  }

  // ---------- look ----------

  setupWater() {
    const mat = this.water.material;
    mat.transparent = true;
    mat.opacity = 0.84;
    mat.roughness = 0.25;
    this.waterBase = this.water.geometry.attributes.position.array.slice();

    const ocean = this.ocean = new THREE.Mesh(
      new THREE.CircleGeometry(4000, 24).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: mat.color.clone(), roughness: 0.3, flatShading: true }),
    );
    ocean.position.y = -1.2;
    ocean.receiveShadow = true;
    this.scene.add(ocean);
  }

  addSky() {
    this.fogColor = new THREE.Color(0xd6ecff);
    this.scene.background = this.fogColor;
    this.scene.fog = new THREE.Fog(this.fogColor, 500, 1900);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(0x3b8ae6) }, bottom: { value: this.fogColor } },
        vertexShader: `varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vDir;
          void main(){ float h = clamp(vDir.y * 1.8 + 0.04, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xe2f2ff, 0x6f8f52, 1.7));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1db, 2.6));
    this.sunOffset = new THREE.Vector3(160, 300, -120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -110; c.right = 110; c.top = 110; c.bottom = -110; c.near = 10; c.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
  }

  addClouds() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.clouds = [];
    for (let i = 0; i < 30; i++) {
      const g = new THREE.Group();
      const puffs = 4 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(geo, mat);
        const s = 9 + Math.random() * 14;
        m.scale.set(s, s * 0.7, s);
        m.position.set((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 22);
        m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
        g.add(m);
      }
      g.position.set((Math.random() - 0.5) * 1800, 150 + Math.random() * 90, (Math.random() - 0.5) * 1800);
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  followShadow(focus) {
    this.sun.position.copy(focus).add(this.sunOffset);
    this.sun.target.position.copy(focus);
  }

  update(dt, time, cameraPos) {
    const p = this.water.geometry.attributes.position;
    const a = p.array, b = this.waterBase;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] = b[i + 1] + Math.sin(b[i] * 0.3 + time * 1.1) * 0.12 + Math.cos(b[i + 2] * 0.27 + time * 0.8) * 0.1;
    }
    p.needsUpdate = true;
    for (const c of this.clouds) {
      c.position.x += dt * 3;
      if (c.position.x > 900) c.position.x -= 1800;
    }
    this.sky.position.copy(cameraPos);
    this.padLights.forEach((m, i) => { m.visible = (((Math.floor(time * 6) - i) % 12) + 12) % 12 < 4; });
  }

  /** Small top-down picture of the island for the radar. */
  makeRadarImage() {
    const size = 160, half = this.map.radar, cell = (2 * half) / size;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const h = this.heightAt(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell);
        const k = (j * size + i) * 4;
        let c = null;
        if (h > 0 && h < 4) c = [236, 214, 150];
        else if (h >= 4 && h < 30) c = [110, 190, 90];
        else if (h >= 30 && h < 75) c = [70, 140, 70];
        else if (h >= 75) c = [190, 190, 190];
        if (c) { img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 230; }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, x0: -half, z0: -half, cell };
  }
}

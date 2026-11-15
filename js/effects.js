import * as THREE from 'three';
import { G } from './bomb.js';

const ico = new THREE.IcosahedronGeometry(1, 0);
const box = new THREE.BoxGeometry(1, 1, 1);
const disc = new THREE.CircleGeometry(1, 9);
const ring = new THREE.RingGeometry(0.8, 1, 16).rotateX(-Math.PI / 2);
const Z = new THREE.Vector3(0, 0, 1);

/** Short-lived visual bits: explosions, debris, smoke, splashes, scorch marks. */
export class Effects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = [];
  }

  add(obj, life, tick) {
    this.scene.add(obj);
    this.items.push({ obj, age: 0, life, tick });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const keep = it.tick ? it.tick(it, dt) !== false : true;
      if (!keep || it.age >= it.life) {
        this.dispose(it);
        this.items.splice(i, 1);
      }
    }
  }

  dispose(it) {
    this.scene.remove(it.obj);
    it.obj.traverse((o) => { if (o.material) o.material.dispose(); });
  }

  clear() {
    for (const it of this.items) this.dispose(it);
    this.items.length = 0;
  }

  explosion(pos, size = 1) {
    [0xfff3b0, 0xffb02e, 0xff5a1f].forEach((color, i) => {
      const m = new THREE.Mesh(ico, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
      m.position.copy(pos);
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      const R = (5 + i * 2.5) * size;
      this.add(m, 0.7 + i * 0.25, (it) => {
        const k = it.age / it.life;
        m.scale.setScalar(R * (0.25 + 0.75 * Math.sqrt(k)));
        m.material.opacity = 0.95 * (1 - k);
        m.position.y = pos.y + k * 3 * size;
      });
    });
    for (let i = 0; i < 6; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8).multiplyScalar(size));
      this.puff(p, 0x6b6b6b, 3.5 * size, 2.4, 5);
    }
  }

  puff(pos, color = 0x8a8a8a, size = 3, life = 2.5, rise = 4) {
    const m = new THREE.Mesh(ico, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85, flatShading: true, depthWrite: false }));
    m.position.copy(pos);
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.add(m, life, (it, dt) => {
      const k = it.age / it.life;
      m.scale.setScalar(size * (0.4 + k));
      m.position.y += rise * dt;
      m.material.opacity = 0.85 * (1 - k);
    });
  }

  debris(pos, count, colors, speed = 18, size = 0.8) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: colors[i % colors.length], transparent: true, flatShading: true }));
      m.position.copy(pos);
      m.scale.setScalar(size * (0.5 + Math.random()));
      const v = new THREE.Vector3((Math.random() - 0.5) * speed, 6 + Math.random() * speed, (Math.random() - 0.5) * speed);
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.add(m, 2.6, (it, dt) => {
        v.y -= G * dt;
        m.position.addScaledVector(v, dt);
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
        const ground = this.world.surfaceAt(m.position.x, m.position.z);
        if (m.position.y < ground) {
          m.position.y = ground;
          v.y = -v.y * 0.3;
          v.x *= 0.6;
          v.z *= 0.6;
          spin.multiplyScalar(0.5);
        }
        m.material.opacity = Math.min(1, (it.life - it.age) / 0.6);
      });
    }
  }

  sparks(pos) {
    this.debris(pos, 5, [0xffe066, 0xff9a2e], 14, 0.35);
  }

  splash(pos) {
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ico, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, flatShading: true }));
      m.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      const out = 2 + Math.random() * 5;
      const v = new THREE.Vector3(Math.cos(a) * out, 12 + Math.random() * 14, Math.sin(a) * out);
      const s = 0.8 + Math.random() * 1.2;
      m.scale.setScalar(s);
      this.add(m, 2.2, (it, dt) => {
        v.y -= G * dt;
        m.position.addScaledVector(v, dt);
        if (m.position.y < 0) return false;
        m.material.opacity = 1 - it.age / it.life;
      });
    }
    const r = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    r.position.set(pos.x, 0.3, pos.z);
    this.add(r, 1.8, (it) => {
      const k = it.age / it.life;
      r.scale.setScalar(2 + k * 16);
      r.material.opacity = 0.9 * (1 - k);
    });
  }

  smokeColumn(pos, duration = 12) {
    const anchor = new THREE.Object3D();
    let t = 0;
    this.add(anchor, duration, (it, dt) => {
      t -= dt;
      if (t > 0) return;
      t = 0.22;
      const k = 1 - it.age / it.life;
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2));
      this.puff(p, 0x3f3f3f, 2.5 * (0.5 + k), 4, 6);
    });
  }

  scorch(pos, normal) {
    const m = new THREE.Mesh(
      disc,
      new THREE.MeshBasicMaterial({ color: 0x2b2420, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.scale.setScalar(6 + Math.random() * 2);
    m.position.copy(pos).addScaledVector(normal, 0.2);
    m.quaternion.setFromUnitVectors(Z, normal);
    this.add(m, Infinity);
  }
}

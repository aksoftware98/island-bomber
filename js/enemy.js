import * as THREE from 'three';
import { G } from './bomb.js';
import { VEHICLE_SCALE } from './jet.js';
import { PLAIN_CENTER, PAD } from './world.js';
import { clamp, rand, wrapAngle } from './util.js';

export const LEVELS = [
  { n: 1, trucks: 4, bombs: 6, range: 110, wind: 0, maxY: 15, note: 'Trucks on the plain and the lowlands.' },
  { n: 2, trucks: 6, bombs: 8, range: 140, wind: 0, maxY: 40, note: 'Trucks roam the foothills too.' },
  { n: 3, trucks: 8, bombs: 9, range: 160, wind: 1.2, maxY: Infinity, note: 'A crosswind pushes your bombs sideways.' },
];

/**
 * How hard the trucks are, and how much the game helps you aim.
 * damage is per flak round that hits the jet; lead is how much they aim ahead of a moving jet.
 */
export const DIFFICULTIES = [
  {
    id: 'easy', name: 'Easy', blurb: 'Slow trucks, sloppy flak. Shows where your bomb will land.',
    truckSpeed: 3, turnDeg: 80, lead: 0.4, spread: 0.1, burst: 0.6, cooldown: [2.4, 3.4], damage: 12,
    marker: true, countdown: true, score: 0.5,
  },
  {
    id: 'normal', name: 'Normal', blurb: 'Trucks drive around. A countdown tells you when to let go.',
    truckSpeed: 6, turnDeg: 100, lead: 0.6, spread: 0.07, burst: 0.7, cooldown: [1.8, 2.8], damage: 16,
    marker: false, countdown: true, score: 1,
  },
  {
    id: 'hard', name: 'Hard', blurb: 'Fast trucks that aim ahead of you. No help, just physics.',
    truckSpeed: 10, turnDeg: 120, lead: 0.8, spread: 0.06, burst: 0.7, cooldown: [1.5, 2.3], damage: 20,
    marker: false, countdown: false, score: 1.5,
  },
];

export const TRACER_SPEED = 160;
export const TRUCK_HP = 2;
const PAD_KEEPOUT = 48;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const MUZZLE = new THREE.Vector3(0, 2.25, 0.19).multiplyScalar(VEHICLE_SCALE);
const MAX_SLOPE_COS = Math.cos(THREE.MathUtils.degToRad(15));
const DRIVE_SLOPE_COS = Math.cos(THREE.MathUtils.degToRad(22));
const charMat = new THREE.MeshStandardMaterial({ color: 0x2d2826, roughness: 1, flatShading: true });
const _qa = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _n = new THREE.Vector3();

const awayFromPad = (x, z) => Math.hypot(x - PAD.x, z - PAD.z) > PAD_KEEPOUT;

/** Where a truck may stand or drive: dry, not too steep, not too high, off the reload strip. */
function drivable(world, x, z, maxY, normalOut = _n) {
  const y = world.heightAt(x, z, normalOut);
  return y >= 4.5 && y <= maxY && normalOut.y >= DRIVE_SLOPE_COS && awayFromPad(x, z) && !world.blocked(x, z);
}

export function placeTrucks(world, level) {
  const out = [];
  const n = new THREE.Vector3();
  const farEnough = (x, z) => out.every((o) => Math.hypot(o.x - x, o.z - z) > 36);
  const flatEnough = (x, z, y) =>
    [[5, 0], [-5, 0], [0, 5], [0, -5]].every(([dx, dz]) => Math.abs(world.heightAt(x + dx, z + dz) - y) < 2);

  // One always starts on the central plain, on the far side from the reload strip.
  for (let tries = 0; tries < 200 && out.length === 0; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 30;
    const x = PLAIN_CENTER.x + Math.cos(a) * r;
    const z = PLAIN_CENTER.z + 15 + Math.sin(a) * r;
    if (drivable(world, x, z, level.maxY) && flatEnough(x, z, world.heightAt(x, z))) out.push({ x, z, yaw: Math.random() * Math.PI * 2 });
  }

  for (let tries = 0; out.length < level.trucks && tries < 8000; tries++) {
    const { minX, maxX, minZ, maxZ } = world.bounds;
    const x = rand(minX, maxX);
    const z = rand(minZ, maxZ);
    const y = world.heightAt(x, z, n);
    if (y < 4.5 || y > level.maxY || n.y < MAX_SLOPE_COS) continue;
    if (!awayFromPad(x, z) || world.blocked(x, z) || !farEnough(x, z) || !flatEnough(x, z, y)) continue;
    out.push({ x, z, yaw: Math.random() * Math.PI * 2 });
  }
  if (out.length !== level.trucks) throw new Error(`Could only place ${out.length} of ${level.trucks} vehicles safely. Try another level.`);
  return out;
}

/**
 * An anti-air pickup. On the host (or in single player) it drives between random waypoints,
 * stops to turn and fire bursts at the nearest jet, and drives on. On other players' screens
 * it just follows the host's snapshots.
 */
export class Truck {
  constructor(scene, model, spot, world, level, diff, index) {
    this.scene = scene;
    this.world = world;
    this.level = level;
    this.diff = diff;
    this.index = index;
    this.group = new THREE.Group();
    model.scale.setScalar(VEHICLE_SCALE);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.model = model;
    this.group.add(model);
    this.pos = this.group.position;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.move = new THREE.Vector3();
    this.yaw = spot.yaw;
    this.groundY = world.heightAt(spot.x, spot.z, this.normal);
    this.pos.set(spot.x, this.groundY, spot.z);
    this.hp = TRUCK_HP;
    this.alive = true;
    this.alert = false;
    this.cooldown = rand(1, 3);
    this.burst = 0;
    this.shotTimer = 0;
    this.hopY = 0;
    this.hopV = 0;
    this.wp = null;
    this.pause = rand(0, 2);
    this.smokeTimer = 0;
    this.net = null;
    this.orient();
    scene.add(this.group);
  }

  orient() {
    _qa.setFromUnitVectors(UP, this.normal);
    _qy.setFromAxisAngle(UP, this.yaw);
    this.group.quaternion.copy(_qa).multiply(_qy);
  }

  honk() {
    if (this.alive && this.hopY === 0) this.hopV = 6;
  }

  /** A near miss. Returns true when that was the last hit point. */
  damage() {
    this.hp--;
    this.honk();
    return this.hp <= 0;
  }

  get speed() {
    return this.diff.truckSpeed * (this.hp < TRUCK_HP ? 0.6 : 1);
  }

  update(dt, ctx) {
    if (!this.alive) return this.updateDead(dt, ctx);

    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopV -= G * dt;
      this.hopY = Math.max(0, this.hopY + this.hopV * dt);
      if (this.hopY === 0) this.hopV = 0;
    }
    if (this.hp < TRUCK_HP) {
      this.smokeTimer -= dt;
      if (this.smokeTimer < 0) {
        this.smokeTimer = 0.25;
        ctx.effects.puff(this.pos.clone().setY(this.pos.y + 3), 0x555555, 1.6, 1.4, 1.5);
      }
    }

    if (this.net) this.followSnapshot(dt);
    else this.think(dt, ctx);

    this.pos.y = this.groundY + this.hopY;
    this.orient();
  }

  think(dt, ctx) {
    // Pick the nearest living jet in range.
    let target = null;
    let best = ctx.range;
    for (const j of ctx.targets) {
      if (!j.alive) continue;
      const d = Math.hypot(j.position.x - this.pos.x, j.position.z - this.pos.z);
      if (d < best) { best = d; target = j; }
    }
    this.alert = Boolean(target);
    const turnMax = THREE.MathUtils.degToRad(this.diff.turnDeg) * dt;

    if (target && (this.cooldown <= 0 || this.burst > 0)) {
      // Stop, swing the whole truck at the jet (the gun is bolted on), and fire a burst.
      this.move.set(0, 0, 0);
      const m = this.muzzle();
      const lead = (this.diff.lead * m.distanceTo(target.position)) / TRACER_SPEED;
      const aim = target.position.clone().addScaledVector(target.velocity, lead);
      const diff = wrapAngle(Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z) - this.yaw);
      this.yaw += clamp(diff, -turnMax, turnMax);
      if (this.burst <= 0) {
        if (Math.abs(diff) < 0.3) {
          this.burst = this.diff.burst;
          this.shotTimer = 0;
        }
        return;
      }
      this.burst -= dt;
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) {
        this.shotTimer = 0.11;
        const s = this.diff.spread;
        const dir = aim.sub(m).normalize();
        dir.x += (Math.random() - 0.5) * s;
        dir.y += (Math.random() - 0.5) * s;
        dir.z += (Math.random() - 0.5) * s;
        ctx.fire(m, dir.normalize());
      }
      if (this.burst <= 0) this.cooldown = rand(...this.diff.cooldown);
      return;
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.drive(dt, turnMax);
  }

  drive(dt, turnMax) {
    if (this.pause > 0) {
      this.pause -= dt;
      this.move.set(0, 0, 0);
      return;
    }
    const maxY = Math.min(this.level.maxY + 10, 200);
    if (!this.wp || Math.hypot(this.wp.x - this.pos.x, this.wp.z - this.pos.z) < 5) {
      this.wp = null;
      for (let i = 0; i < 25 && !this.wp; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(25, 80);
        const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
        if (drivable(this.world, x, z, maxY)) this.wp = { x, z };
      }
      if (!this.wp) { this.pause = 1; return; }
    }
    const diff = wrapAngle(Math.atan2(this.wp.x - this.pos.x, this.wp.z - this.pos.z) - this.yaw);
    this.yaw += clamp(diff, -turnMax, turnMax);
    const v = Math.abs(diff) < 1.2 ? this.speed : this.speed * 0.3;
    const nx = this.pos.x + Math.sin(this.yaw) * v * dt;
    const nz = this.pos.z + Math.cos(this.yaw) * v * dt;
    if (!drivable(this.world, nx, nz, maxY, this.normal)) {
      this.world.heightAt(this.pos.x, this.pos.z, this.normal);
      this.wp = null;
      this.move.set(0, 0, 0);
      return;
    }
    this.move.set((nx - this.pos.x) / dt, 0, (nz - this.pos.z) / dt);
    this.pos.x = nx;
    this.pos.z = nz;
    this.groundY = this.world.heightAt(nx, nz);
    if (Math.random() < dt * 0.15) this.pause = rand(0.8, 2.5);
  }

  muzzle() {
    this.group.updateMatrixWorld();
    return this.group.localToWorld(MUZZLE.clone());
  }

  // ---------- multiplayer: copies of the host's trucks ----------

  snapshot() {
    return [+this.pos.x.toFixed(2), +this.pos.z.toFixed(2), +this.yaw.toFixed(3), this.move.x, this.move.z, this.alert ? 1 : 0];
  }

  applySnapshot(s) {
    if (!this.net) this.net = {};
    [this.net.x, this.net.z, this.net.yaw, this.move.x, this.move.z] = s;
    this.alert = s[5] === 1;
  }

  followSnapshot(dt) {
    const k = 1 - Math.exp(-dt * 8);
    // Dead reckon on the host's velocity, then pull toward the latest snapshot.
    this.net.x += this.move.x * dt;
    this.net.z += this.move.z * dt;
    this.pos.x += (this.net.x - this.pos.x) * k;
    this.pos.z += (this.net.z - this.pos.z) * k;
    this.yaw += wrapAngle(this.net.yaw - this.yaw) * k;
    this.groundY = this.world.heightAt(this.pos.x, this.pos.z, this.normal);
  }

  // ---------- death ----------

  destroy(from, effects) {
    if (!this.alive) return;
    this.alive = false;
    this.alert = false;
    this.move.set(0, 0, 0);
    const away = this.pos.clone().sub(from).setY(0);
    if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize();
    this.vel = away.multiplyScalar(6 + Math.random() * 4);
    this.vel.y = 18 + Math.random() * 6;
    this.spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize();
    this.spin = 5 + Math.random() * 4;
    this.bounced = false;
    this.settled = false;
    this.model.traverse((o) => {
      if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(() => charMat) : charMat;
    });
    const at = this.pos.clone();
    at.y += 2;
    effects.explosion(at, 1.2);
    effects.debris(at, 10, [0xd9a441, 0x222222, 0x8aa0b3], 16, 1.1);
  }

  updateDead(dt, ctx) {
    if (this.settled) return;
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.group.rotateOnAxis(this.spinAxis, this.spin * dt);
    const ground = ctx.world.surfaceAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground && this.vel.y < 0) {
      this.pos.y = ground;
      if (!this.bounced) {
        this.bounced = true;
        this.vel.y = -this.vel.y * 0.35;
        this.vel.x *= 0.5;
        this.vel.z *= 0.5;
        this.spin *= 0.4;
        ctx.effects.puff(this.pos.clone(), 0xb59b74, 3, 1.2, 1);
      } else {
        this.settled = true;
        ctx.effects.smokeColumn(this.pos.clone(), 14);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

// ---------- flak ----------

const tracerGeo = new THREE.BoxGeometry(0.35, 0.35, 3.5);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const HIT_RADIUS = 4.5;
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

function segmentDistance(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const t = clamp(_ap.dot(_ab) / Math.max(_ab.lengthSq(), 1e-9), 0, 1);
  return _ap.sub(_ab.multiplyScalar(t)).length();
}

/** Flak rounds. Each screen only checks hits against its own jet. */
export class Tracers {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  spawn(p, dir, owner = null) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.position.copy(p);
    m.quaternion.setFromUnitVectors(FORWARD, dir);
    this.scene.add(m);
    this.list.push({ m, v: dir.clone().multiplyScalar(TRACER_SPEED), life: owner === null ? 1.5 : 5, owner });
  }

  step(dt, targets, world, onHit, effects) {
    const prev = new THREE.Vector3();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      prev.copy(t.m.position);
      t.m.position.addScaledVector(t.v, dt);
      t.life -= dt;
      let gone = false;
      const hit = targets.find((j) => j.alive && j.role !== 'aa' && segmentDistance(j.position, prev, t.m.position) < HIT_RADIUS);
      if (hit && t.m.position.y >= world.surfaceAt(t.m.position.x, t.m.position.z)) {
        onHit(t.m.position, hit, t.owner);
        gone = true;
      } else if (t.m.position.y < world.surfaceAt(t.m.position.x, t.m.position.z)) {
        gone = true;
      } else if (t.life <= 0) {
        effects.puff(t.m.position.clone(), 0x3a3a3a, 2.2, 1.1, 0.5);
        gone = true;
      }
      if (gone) {
        this.scene.remove(t.m);
        this.list.splice(i, 1);
      }
    }
  }

  clear() {
    for (const t of this.list) this.scene.remove(t.m);
    this.list.length = 0;
  }
}

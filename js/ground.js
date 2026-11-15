import * as THREE from 'three';
import { clamp, wrapAngle } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const green = new THREE.MeshStandardMaterial({ color: 0x596746, roughness: .85, flatShading: true });
const dark = new THREE.MeshStandardMaterial({ color: 0x252b2c, roughness: .8 });
const glass = new THREE.MeshStandardMaterial({ color: 0x70a6af, roughness: .3 });
const bodyGeo = new THREE.BoxGeometry(4.8, 1.5, 9);
const cabGeo = new THREE.BoxGeometry(4.4, 2, 3);
const glassGeo = new THREE.BoxGeometry(4.45, 1, .1);
const wheelGeo = new THREE.CylinderGeometry(1.15, 1.15, .8, 10).rotateZ(Math.PI / 2);
const turretGeo = new THREE.BoxGeometry(3.4, .8, 3.2);
const barrelGeo = new THREE.CylinderGeometry(.14, .2, 5.5, 8).rotateX(Math.PI / 2);

/** Driveable pickup with a separate, fully traversable gun. Uses the same actor interface as Jet. */
export class GroundVehicle {
  constructor(world) {
    this.world = world;
    this.role = 'aa';
    this.object = new THREE.Group();
    this.chassis = new THREE.Group(); this.object.add(this.chassis);
    const part = (geo, mat, parent, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    part(bodyGeo, green, this.chassis, 0, 1.9, 0);
    part(cabGeo, green, this.chassis, 0, 3.1, 2.4);
    part(glassGeo, glass, this.chassis, 0, 3.5, 3.93);
    for (const x of [-2.4, 2.4]) for (const z of [-2.8, 2.8]) part(wheelGeo, dark, this.chassis, x, 1.15, z);
    this.turret = new THREE.Group(); this.turret.position.set(0, 3.1, -1.6); this.chassis.add(this.turret);
    part(turretGeo, green, this.turret, 0, 0, 0);
    this.gun = new THREE.Group(); this.gun.position.y = .7; this.turret.add(this.gun);
    for (const x of [-.55, .55]) part(barrelGeo, dark, this.gun, x, 0, 2.5);
    this.position = this.object.position;
    this.velocity = new THREE.Vector3(); this.forward = new THREE.Vector3(0, 0, 1);
    this.normal = UP.clone(); this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    this.position.copy(pos); this.position.y = this.world.heightAt(pos.x, pos.z);
    this.yaw = yaw; this.pitch = this.roll = this.speed = this.turnRate = 0;
    this.turretYaw = yaw; this.gunPitch = .45; this.health = 100; this.alive = true;
    this.autoTurn = false; this.rounds = 30; this.reload = 0; this.cooldown = 0;
    this.object.visible = true; this.updateVectors(); this.applyTransform();
  }

  update(dt, input) {
    const drive = (input.has?.('KeyW') ? 1 : 0) - (input.has?.('KeyS') ? 1 : 0) - (input.touch?.pitch ?? 0);
    const steer = (input.has?.('KeyD') ? 1 : 0) - (input.has?.('KeyA') ? 1 : 0) + (input.touch?.turn ?? 0);
    const top = input.has?.('ShiftLeft', 'ShiftRight') ? 23 : 15;
    this.speed += (clamp(drive, -1, 1) * top - this.speed) * Math.min(1, dt * 4);
    this.yaw -= steer * dt * 1.4 * (this.speed < -.5 ? -1 : 1);
    const nx = this.position.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.position.z + Math.cos(this.yaw) * this.speed * dt;
    if (this.world.drivable(nx, nz, Infinity, this.normal)) {
      this.position.set(nx, this.world.heightAt(nx, nz), nz);
    } else this.speed = 0;
    const aimX = (input.has?.('ArrowLeft', 'KeyJ') ? 1 : 0) - (input.has?.('ArrowRight', 'KeyL') ? 1 : 0) - (input.touch?.aimX ?? 0);
    const aimY = (input.has?.('ArrowUp', 'KeyI') ? 1 : 0) - (input.has?.('ArrowDown', 'KeyK') ? 1 : 0) - (input.touch?.aimY ?? 0);
    const precision = input.precisionAim ? .45 : 1;
    const sensitivity = (input.mouseSensitivity ?? .75) * precision;
    this.turretYaw += aimX * dt * 1.2 * precision - (input.aimDX ?? 0) * .003 * sensitivity;
    this.gunPitch = clamp(this.gunPitch + aimY * dt * precision - (input.aimDY ?? 0) * .0025 * sensitivity, .04, 1.45);
    input.aimDX = input.aimDY = 0;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reload > 0) { this.reload -= dt; if (this.reload <= 0) this.rounds = 30; }
    if (input.consume?.('reloadPressed') && this.rounds < 30 && this.reload <= 0) this.reload = 2;
    this.updateVectors(); this.applyTransform();
  }

  updateVectors() { this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.velocity.copy(this.forward).multiplyScalar(this.speed); }
  applyTransform() {
    this.object.rotation.set(0, this.yaw, 0);
    this.turret.rotation.y = wrapAngle(this.turretYaw - this.yaw);
    this.gun.rotation.x = -this.gunPitch;
  }
  aimDirection() {
    this.object.updateMatrixWorld(true);
    return new THREE.Vector3(0, 0, 1).transformDirection(this.gun.matrixWorld);
  }
  muzzle() { this.object.updateMatrixWorld(true); return this.gun.localToWorld(new THREE.Vector3(0, 0, 5.5)); }
  shoot() {
    if (!this.alive || this.reload > 0 || this.cooldown > 0 || this.rounds <= 0) return null;
    this.cooldown = .12; this.rounds--;
    if (this.rounds === 0) this.reload = 2;
    return { p: this.muzzle(), d: this.aimDirection() };
  }
}

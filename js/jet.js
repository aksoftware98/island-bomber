import * as THREE from 'three';
import { G } from './bomb.js';
import { BOUND_RADIUS, CEILING } from './world.js';
import { clamp, wrapAngle } from './util.js';

/** Jets and trucks are scaled up from the exported models so they read well from the air. */
export const VEHICLE_SCALE = 2.5;
export const MIN_SPEED = 25;
export const MAX_SPEED = 70;
export const MAX_ROLL = THREE.MathUtils.degToRad(70);
export const MAX_PITCH = THREE.MathUtils.degToRad(25);

/**
 * Arcade flight model. The jet always flies forward along its nose.
 * Turning is a coordinated turn: yaw rate = g * tan(bank) / speed, so the
 * numbers shown in the physics panel are exactly what the jet does.
 */
export class Jet {
  constructor(model) {
    this.object = new THREE.Group();
    model.scale.setScalar(VEHICLE_SCALE);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      for (const m of [].concat(o.material)) if (m.name === 'Jet_Glow') this.glow = m;
    });
    this.object.add(model);
    this.position = this.object.position;
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    this.position.copy(pos);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 40;
    this.health = 100;
    this.alive = true;
    this.autoTurn = false;
    this.turnRate = 0;
    this.object.visible = true;
    this.updateVectors();
    this.applyTransform();
  }

  updateVectors() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
  }

  /** input: { turn: -1 left..1 right, pitch: -1 nose down..1 nose up, throttle: -1..1 } */
  update(dt, input) {
    if (!this.alive) return;
    this.speed = clamp(this.speed + input.throttle * 18 * dt, MIN_SPEED, MAX_SPEED);

    let turn = input.turn;
    const dist = Math.hypot(this.position.x, this.position.z);
    const wasAuto = this.autoTurn;
    this.autoTurn = dist > BOUND_RADIUS || (wasAuto && dist > BOUND_RADIUS - 120);
    this.justLeftBounds = this.autoTurn && !wasAuto;
    if (this.autoTurn) {
      const toCenter = Math.atan2(-this.position.x, -this.position.z);
      turn = clamp(-wrapAngle(toCenter - this.yaw) * 2, -1, 1);
    }

    this.roll += (turn * MAX_ROLL - this.roll) * Math.min(1, dt * 3.5);

    if (input.pitch) this.pitch += input.pitch * 0.9 * dt;
    else this.pitch -= this.pitch * Math.min(1, dt * 0.7);
    this.pitch = clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
    if (this.position.y > CEILING) this.pitch = Math.min(this.pitch, -0.03);

    // Coordinated turn. Banking right (positive roll) turns right, which is decreasing yaw.
    this.turnRate = (-G * Math.tan(this.roll)) / this.speed;
    this.yaw = wrapAngle(this.yaw + this.turnRate * dt);

    this.updateVectors();
    this.position.addScaledVector(this.velocity, dt);
    this.applyTransform();
  }

  applyTransform() {
    this.object.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
  }
}

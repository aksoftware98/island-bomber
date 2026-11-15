import * as THREE from 'three';

export const G = 9.81;
export const STEP = 1 / 120;
export const BLAST_RADIUS = 14;
/** A bomb this close damages a truck without destroying it. */
export const NEAR_RADIUS = 22;

/**
 * Exact step for constant acceleration (gravity plus optional wind push),
 * so the result does not depend on the step size.
 */
export function integrate(p, v, dt, wind) {
  const ax = wind ? wind.x : 0;
  const az = wind ? wind.z : 0;
  p.x += v.x * dt + 0.5 * ax * dt * dt;
  p.y += v.y * dt - 0.5 * G * dt * dt;
  p.z += v.z * dt + 0.5 * az * dt * dt;
  v.x += ax * dt;
  v.y -= G * dt;
  v.z += az * dt;
}

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _prev = new THREE.Vector3();

/**
 * Simulates a fall from p0 with velocity v0 until it meets surfaceAt(x, z).
 * Returns { point, t, velocity } or null. Pushes sample points into `path` when given.
 */
export function simulateFall(p0, v0, wind, surfaceAt, dt = STEP, maxT = 40, path = null) {
  _p.copy(p0);
  _v.copy(v0);
  let prevGap = _p.y - surfaceAt(_p.x, _p.z);
  if (prevGap <= 0) return { point: _p.clone(), t: 0, velocity: _v.clone() };
  let t = 0;
  let i = 0;
  if (path) path.push(_p.clone());
  while (t < maxT) {
    _prev.copy(_p);
    integrate(_p, _v, dt, wind);
    t += dt;
    i++;
    const gap = _p.y - surfaceAt(_p.x, _p.z);
    if (gap <= 0) {
      const f = prevGap / (prevGap - gap);
      const point = _prev.clone().lerp(_p, f);
      if (path) path.push(point.clone());
      return { point, t: t - dt + f * dt, velocity: _v.clone() };
    }
    prevGap = gap;
    if (path && i % 4 === 0) path.push(_p.clone());
  }
  return null;
}

// ---------- the bomb you can see ----------

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.5, metalness: 0.3, flatShading: true });
const bandMat = new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.6, flatShading: true });
const geos = {
  body: new THREE.CylinderGeometry(0.45, 0.45, 1.6, 6).rotateX(Math.PI / 2),
  nose: new THREE.ConeGeometry(0.45, 0.8, 6).rotateX(Math.PI / 2).translate(0, 0, 1.2),
  tail: new THREE.ConeGeometry(0.45, 0.6, 6).rotateX(-Math.PI / 2).translate(0, 0, -1.1),
  band: new THREE.CylinderGeometry(0.47, 0.47, 0.22, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5),
  fin: new THREE.BoxGeometry(0.07, 0.75, 0.55).translate(0, 0.5, -1.2),
};
const FORWARD = new THREE.Vector3(0, 0, 1);

function makeBombMesh() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geos.body, bodyMat), new THREE.Mesh(geos.nose, bodyMat), new THREE.Mesh(geos.tail, bodyMat));
  g.add(new THREE.Mesh(geos.band, bandMat));
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(geos.fin, bandMat);
    fin.rotation.z = (k * Math.PI) / 2 + Math.PI / 4;
    g.add(fin);
  }
  g.scale.setScalar(1.3);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const MAX_TRAIL = 1500;

export class Bomb {
  constructor(scene, p, v, wind, surfaceAt) {
    this.scene = scene;
    this.p = p.clone();
    this.v = v.clone();
    this.wind = wind.clone();
    this.t = 0;
    this.age = 0;
    this.steps = 0;
    this.falling = true;
    this.release = { p: p.clone(), v: v.clone() };
    this.prediction = simulateFall(p, v, wind, surfaceAt);

    this.mesh = makeBombMesh();
    scene.add(this.mesh);

    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(MAX_TRAIL * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setDrawRange(0, 0);
    this.trailCount = 0;
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.addTrailPoint();
    this.sync();
  }

  addTrailPoint() {
    if (this.trailCount >= MAX_TRAIL) return;
    this.trailPos.set([this.p.x, this.p.y, this.p.z], this.trailCount * 3);
    this.trailCount++;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  /** Advances one fixed step. Returns true on the step it lands. */
  step(dt, surfaceAt) {
    if (!this.falling) return false;
    const prev = this.p.clone();
    const prevGap = prev.y - surfaceAt(prev.x, prev.z);
    integrate(this.p, this.v, dt, this.wind);
    this.t += dt;
    const gap = this.p.y - surfaceAt(this.p.x, this.p.z);
    if (gap <= 0) {
      const f = prevGap / (prevGap - gap);
      this.p.copy(prev.lerp(this.p, f));
      this.t = this.t - dt + f * dt;
      this.falling = false;
      this.impact = { point: this.p.clone(), t: this.t };
      this.addTrailPoint();
      this.sync();
      return true;
    }
    if (++this.steps % 3 === 0) this.addTrailPoint();
    this.sync();
    return false;
  }

  sync() {
    this.mesh.position.copy(this.p);
    if (this.v.lengthSq() > 1e-6) this.mesh.quaternion.setFromUnitVectors(FORWARD, _v.copy(this.v).normalize());
  }

  /** After landing: hide the bomb and draw where it was let go and how far it travelled. */
  showGuides(surfaceAt) {
    this.mesh.visible = false;
    const r = this.release.p;
    const groundBelow = surfaceAt(r.x, r.z);
    const ip = this.impact.point;
    const pts = [
      new THREE.Vector3(r.x, r.y, r.z), new THREE.Vector3(r.x, groundBelow + 0.6, r.z),
      new THREE.Vector3(r.x, groundBelow + 0.6, r.z), new THREE.Vector3(ip.x, ip.y + 0.6, ip.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.guides = new THREE.LineSegments(
      geo,
      new THREE.LineDashedMaterial({ color: 0xffe066, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.95 }),
    );
    this.guides.computeLineDistances();
    this.guides.frustumCulled = false;
    this.scene.add(this.guides);
  }

  /** Fades the trail after landing. Returns false once it should be removed. */
  updateLanded(dt) {
    this.age += dt;
    const fade = this.age < 7 ? 1 : Math.max(0, 1 - (this.age - 7) / 2);
    this.trail.material.opacity = 0.9 * fade;
    if (this.guides) this.guides.material.opacity = 0.95 * fade;
    return fade > 0;
  }

  dispose() {
    this.scene.remove(this.mesh, this.trail);
    this.trail.geometry.dispose();
    this.trail.material.dispose();
    if (this.guides) {
      this.scene.remove(this.guides);
      this.guides.geometry.dispose();
      this.guides.material.dispose();
    }
  }
}

import { clamp, store } from './util.js';

const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Keyboard plus on-screen touch controls, merged into one set of axes. */
export class Input {
  constructor() {
    this.keys = new Set();
    this.dropPressed = false;
    this.camPressed = false;
    this.pausePressed = false;
    this.physicsToggle = false;
    this.reloadPressed = false;
    this.touch = { turn: 0, pitch: 0, throttle: 0, aimX: 0, aimY: 0, fire: false };
    this.aimDX = this.aimDY = 0;
    this.groundMode = false;
    this.active = false;
    this.mouseSensitivity = clamp(Number(store.get('aim-sensitivity', .75)) || .75, .2, 2);
    const canvas = document.getElementById('game');
    this.canvas = canvas;
    document.addEventListener('mousemove', (e) => {
      if (this.active && this.groundMode && document.pointerLockElement === canvas) {
        this.aimDX += e.movementX; this.aimDY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.active || !this.groundMode || e.button !== 0 || e.sourceCapabilities?.firesTouchEvents) return;
      // The first click captures the cursor; subsequent clicks fire.
      if (document.pointerLockElement !== canvas) { this.captureAim(); return; }
      this.touch.fire = true; this.dropPressed = true;
    });
    const stopFire = () => { this.touch.fire = false; };
    document.addEventListener('mouseup', stopFire);
    canvas.addEventListener('pointercancel', stopFire);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      const released = this.wasLocked && !locked;
      this.wasLocked = locked;
      this.aimDX = this.aimDY = 0;
      if (released) { this.resetControls(); if (this.active) this.pausePressed = true; }
      this.syncAimUI();
    });
    document.addEventListener('pointerlockerror', () => this.aimFailure('Mouse capture unavailable. Click the game to retry, or use arrow keys to aim.'));
    document.addEventListener('fullscreenchange', () => {
      const fullscreen = Boolean(document.fullscreenElement);
      if (this.wasFullscreen && !fullscreen && this.active) { this.resetControls(); this.pausePressed = true; }
      this.wasFullscreen = fullscreen;
      this.syncAimUI();
    });
    document.getElementById('btn-aim-fullscreen').addEventListener('click', () => this.enterFullscreen());
    const sensitivity = document.getElementById('aim-sensitivity');
    sensitivity.value = Math.round(this.mouseSensitivity * 100);
    const updateSensitivity = () => {
      this.mouseSensitivity = Number(sensitivity.value) / 100;
      document.getElementById('aim-sensitivity-value').textContent = `${sensitivity.value}%`;
      store.set('aim-sensitivity', this.mouseSensitivity);
    };
    sensitivity.addEventListener('input', updateSensitivity);
    updateSensitivity();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyF' && this.active && !e.repeat) { e.preventDefault(); this.enterFullscreen(); return; }
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space') this.dropPressed = true;
        if (e.code === 'KeyC') this.camPressed = true;
        if (e.code === 'KeyP' || e.code === 'Escape') this.pausePressed = true;
        if (e.code === 'KeyH') this.physicsToggle = true;
        if (e.code === 'KeyR') this.reloadPressed = true;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.resetControls(); if (document.pointerLockElement === canvas) document.exitPointerLock(); });
  }

  resetControls() {
    this.keys.clear(); this.touch.fire = false;
    this.touch.turn = this.touch.pitch = this.touch.aimX = this.touch.aimY = this.touch.throttle = 0;
    this.aimDX = this.aimDY = 0;
    this.clearPresses();
  }

  setActive(active) {
    this.active = active;
    this.resetControls();
    if (!active && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.syncAimUI();
  }

  aimFailure(message) {
    document.getElementById('aim-capture-hint').textContent = message;
  }

  syncAimUI() {
    const locked = document.pointerLockElement === this.canvas;
    document.body.classList.toggle('mouse-captured', locked);
    document.getElementById('aim-capture-hint').textContent = locked
      ? 'Mouse captured · Esc releases and pauses · C toggles precision sight'
      : 'Click the game to capture the mouse · F for fullscreen · Arrows also aim';
    document.getElementById('btn-aim-fullscreen').textContent = document.fullscreenElement ? 'Capture mouse' : 'Fullscreen & capture (F)';
  }

  captureAim() {
    if (!this.active || !this.groundMode || document.pointerLockElement === this.canvas) return;
    try {
      if (!this.canvas.requestPointerLock) { this.aimFailure('Use arrow keys to aim; mouse capture is unavailable in this browser.'); return; }
      this.canvas.requestPointerLock()?.catch(() => this.aimFailure('Click the game to capture the mouse, or use arrow keys to aim.'));
    } catch { this.aimFailure('Click the game to capture the mouse, or use arrow keys to aim.'); }
  }

  enterFullscreen() {
    if (!this.active) return;
    // Pointer lock must be requested before fullscreen consumes the user gesture.
    this.captureAim();
    if (!document.fullscreenElement) {
      try {
        document.documentElement.requestFullscreen?.()?.catch(() => this.aimFailure('Fullscreen unavailable. Click the game to capture the mouse in this window.'));
      } catch { this.aimFailure('Fullscreen unavailable. Click the game to capture the mouse in this window.'); }
    }
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** -1 left .. 1 right */
  get turn() {
    return clamp((this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0) + this.touch.turn, -1, 1);
  }

  /** -1 nose down .. 1 nose up (W / Up pushes the nose down, like a real stick) */
  get pitch() {
    return clamp((this.has('KeyS', 'ArrowDown') ? 1 : 0) - (this.has('KeyW', 'ArrowUp') ? 1 : 0) + this.touch.pitch, -1, 1);
  }

  get throttle() {
    return clamp((this.has('ShiftLeft', 'ShiftRight', 'KeyE') ? 1 : 0) - (this.has('KeyQ') ? 1 : 0) + this.touch.throttle, -1, 1);
  }

  consume(name) {
    const v = this[name];
    this[name] = false;
    return v;
  }

  clearPresses() {
    this.dropPressed = this.camPressed = this.pausePressed = this.physicsToggle = this.reloadPressed = false;
  }

  bindTouch() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const R = r.width / 2;
      let dx = (e.clientX - (r.left + R)) / R;
      let dy = (e.clientY - (r.top + R)) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.touch.turn = dx;
      this.touch.pitch = dy; // pull back (down) = nose up
      knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
    };
    const end = () => {
      id = null;
      this.touch.turn = this.touch.pitch = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    const tap = (elId, fn) => document.getElementById(elId).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    tap('t-bomb', () => { this.dropPressed = true; });
    const fire = document.getElementById('t-bomb');
    fire.addEventListener('pointerdown', (e) => { fire.setPointerCapture(e.pointerId); this.touch.fire = true; });
    for (const event of ['pointerup', 'pointercancel']) fire.addEventListener(event, () => { this.touch.fire = false; });
    const aim = document.getElementById('aim-stick');
    const aimMove = (e) => {
      const r = aim.getBoundingClientRect();
      this.touch.aimX = clamp((e.clientX - r.left - r.width / 2) / (r.width / 2), -1, 1);
      this.touch.aimY = clamp((e.clientY - r.top - r.height / 2) / (r.height / 2), -1, 1);
    };
    aim.addEventListener('pointerdown', (e) => { aim.setPointerCapture(e.pointerId); aimMove(e); });
    aim.addEventListener('pointermove', (e) => { if (aim.hasPointerCapture(e.pointerId)) aimMove(e); });
    for (const event of ['pointerup', 'pointercancel']) aim.addEventListener(event, () => { this.touch.aimX = this.touch.aimY = 0; });
    tap('t-cam', () => { this.camPressed = true; });
    tap('t-pause', () => { this.pausePressed = true; });
    for (const [elId, val] of [['t-up', 1], ['t-down', -1]]) {
      const el = document.getElementById(elId);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch.throttle = val; });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { this.touch.throttle = 0; });
    }
  }
}

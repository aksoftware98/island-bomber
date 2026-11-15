const FILES = {
  bomb: 'assets/audio/bomb-drop.wav',
  gun: 'assets/audio/machine-gun.wav',
  explosion: 'assets/audio/explosion.wav',
};

/** Recorded combat sounds, with synthesized UI/engine sounds and a missing-file fallback. */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.samples = {};
    this.voices = { bomb: new Set(), gun: new Set(), explosion: new Set() };
  }

  /** Decode once, before play, without opening an audible AudioContext or requesting autoplay. */
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) return;
      const decoder = new Offline(2, 1, 48000);
      await Promise.all(Object.entries(FILES).map(async ([name, file]) => {
        try {
          const response = await fetch(file);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          this.samples[name] = await decoder.decodeAudioData(await response.arrayBuffer());
        } catch (error) {
          console.warn(`Using generated ${name} sound: ${error.message}`);
        }
      }));
    })();
    return this.loading;
  }

  /** Must be called from a user gesture (a click or key press). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new Ctx());
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = .004;
      this.compressor.release.value = .2;
      this.master.connect(this.compressor).connect(ctx.destination);

      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass';
      this.engFilter.frequency.value = 500;
      this.engFilter.connect(this.engGain).connect(this.master);
      this.engOsc1 = ctx.createOscillator();
      this.engOsc1.type = 'sawtooth';
      this.engOsc2 = ctx.createOscillator();
      this.engOsc2.type = 'triangle';
      const og = ctx.createGain();
      og.gain.value = 0.5;
      this.engOsc1.connect(og).connect(this.engFilter);
      this.engOsc2.connect(this.engFilter);
      const hiss = ctx.createBufferSource();
      hiss.buffer = buf;
      hiss.loop = true;
      const hg = ctx.createGain();
      hg.gain.value = 0.6;
      hiss.connect(hg).connect(this.engFilter);
      this.engOsc1.start();
      this.engOsc2.start();
      hiss.start();
    } catch {
      this.ctx = null;
    }
  }

  playSample(name, vol = 1, { duration, fit = false, rate = 1, limit = 8 } = {}) {
    if (!this.ctx || !this.samples[name]) return null;
    const ctx = this.ctx, t = ctx.currentTime, buffer = this.samples[name];
    const voices = this.voices[name];
    while (voices.size >= limit) voices.values().next().value.stop();
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = fit ? buffer.duration / Math.max(.1, duration) : rate;
    const length = fit ? Math.max(.1, duration) : Math.min(duration ?? Infinity, buffer.duration / rate);
    const fade = Math.min(.035, length / 3);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(Math.max(0, vol), t + .005);
    // A separate envelope leaves volume free to follow a moving bomb without cancelling its fade.
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(1, t);
    envelope.gain.setValueAtTime(1, t + length - fade);
    envelope.gain.linearRampToValueAtTime(0, t + length);
    source.connect(gain).connect(envelope).connect(this.master);
    let stopped = false;
    const cleanup = () => { voices.delete(handle); source.disconnect(); gain.disconnect(); envelope.disconnect(); };
    const handle = {
      stop() {
        if (stopped) return;
        stopped = true; voices.delete(handle);
        const now = ctx.currentTime;
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setTargetAtTime(0, now, .006);
        try { source.stop(now + .025); } catch { /* already finished */ }
      },
      setVolume(value) { if (!stopped) gain.gain.setTargetAtTime(Math.max(0, value), ctx.currentTime, .06); },
    };
    source.onended = () => { stopped = true; cleanup(); };
    voices.add(handle);
    source.start(t);
    source.stop(t + length + .005);
    return handle;
  }

  stopEffects() {
    for (const voices of Object.values(this.voices)) for (const voice of [...voices]) voice.stop();
  }

  setPaused(paused) {
    if (!this.ctx) return;
    (paused ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
  }

  engine(on, speedFrac = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.25);
    this.engOsc1.frequency.setTargetAtTime(70 + speedFrac * 80, t, 0.1);
    this.engOsc2.frequency.setTargetAtTime(141 + speedFrac * 160, t, 0.1);
    this.engFilter.frequency.setTargetAtTime(350 + speedFrac * 900, t, 0.1);
  }

  noiseBurst({ dur = 0.5, type = 'lowpass', f0 = 1000, f1 = f0, q = 1, gain = 0.5, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, gain = 0.2, delay = 0 }) {
    if (!this.ctx) return null;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  boom(vol = 1) {
    if (this.playSample('explosion', .8 * vol, { limit: 6 })) return;
    this.noiseBurst({ dur: 1.4, f0: 1400, f1: 70, gain: 0.9 * vol });
    this.tone({ f0: 95, f1: 32, dur: 0.9, gain: 0.8 * vol });
  }

  splash(vol = 1) {
    this.noiseBurst({ dur: 0.9, type: 'bandpass', f0: 1800, f1: 400, q: 0.8, gain: 0.7 * vol });
  }

  flak(vol = 1) {
    if (vol < 0.03) return;
    if (this.playSample('gun', .38 * vol, { duration: .22, rate: .97 + Math.random() * .06, limit: 12 })) return;
    this.noiseBurst({ dur: 0.07, type: 'highpass', f0: 1500, gain: 0.25 * vol });
  }

  hit() {
    this.tone({ type: 'square', f0: 180, f1: 60, dur: 0.18, gain: 0.25 });
    this.noiseBurst({ dur: 0.12, f0: 3000, f1: 800, gain: 0.3 });
  }

  honk() {
    for (const d of [0, 0.28]) {
      this.tone({ type: 'square', f0: 392, dur: 0.2, gain: 0.08, delay: d });
      this.tone({ type: 'square', f0: 494, dur: 0.2, gain: 0.08, delay: d });
    }
  }

  drop() {
    this.tone({ f0: 320, f1: 110, dur: 0.14, gain: 0.3 });
  }

  click() {
    this.tone({ f0: 880, dur: 0.06, gain: 0.1 });
  }

  whistle(dur, vol = 1) {
    const sample = this.playSample('bomb', .5 * vol, { duration: dur, fit: true, limit: 12 });
    if (sample) return { stop: () => sample.stop(), setVolume: (v) => sample.setVolume(.5 * v) };
    if (!this.ctx) return { stop() {} };
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1700, t);
    o.frequency.exponentialRampToValueAtTime(420, t + Math.max(0.2, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(.0001, .045 * vol), t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + Math.max(0.2, dur) + 0.1);
    return {
      stop() { try { o.stop(); } catch { /* already stopped */ } },
      setVolume(v) { g.gain.setTargetAtTime(Math.max(.0001, .045 * v), ctx.currentTime, .06); },
    };
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.25, gain: 0.2, delay: i * 0.13 }));
  }

  lose() {
    [392, 370, 349, 311].forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, f1: f * 0.97, dur: i === 3 ? 0.8 : 0.3, gain: 0.12, delay: i * 0.32 }));
  }
}

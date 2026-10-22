// Fully procedural Web Audio: ambience, footsteps, creaks, stingers and positional emitters.
// Nothing is loaded from disk; every sound is synthesized here.

function setParam(param, v, t) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(v, t + 0.05);
}

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.emitters = new Set();
    this.heartRate = 0;
    this.heartVol = 0;
    this.heartTimer = 0;
    this.birds = false;
    this.birdTimer = 2;
    this.amb = null;
  }

  init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // A separate, louder path for jumpscares: it skips the main compressor (which would squash
    // them) and goes through a brick-wall limiter instead so it can't distort.
    this.scare = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.scare.connect(limiter).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(3.8);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.45;
    this.sfx.connect(this.verbSend).connect(this.verb).connect(this.master);

    this.noise = this._noiseBuffer(3, false);
    this.brown = this._noiseBuffer(4, true);

    // Persistent layers whose gain is driven by gameplay.

    this.fearGain = ctx.createGain();
    this.fearGain.gain.value = 0;
    const fearFilter = ctx.createBiquadFilter();
    fearFilter.type = 'lowpass';
    fearFilter.frequency.value = 900;
    fearFilter.connect(this.fearGain).connect(this.master);
    for (const f of [233.1, 246.9, 349.2, 370]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = Math.random() * 10 - 5;
      const g = ctx.createGain();
      g.gain.value = 0.06;
      o.connect(g).connect(fearFilter);
      o.start();
    }

    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    const roarF = ctx.createBiquadFilter();
    roarF.type = 'bandpass';
    roarF.frequency.value = 700;
    roarF.Q.value = 0.4;
    const roarSrc = this._loop(this.brown);
    roarSrc.connect(roarF).connect(this.roarGain).connect(this.master);
    this.roarFilter = roarF;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  _noiseBuffer(seconds, brown) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  _impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  _loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  _panner(pos, ref = 2, rolloff = 1.3) {
    const p = this.ctx.createPanner();
    // Plain left/right panning: HRTF colours each ear differently and can sound lopsided on some headphones.
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 400;
    this._setPannerPos(p, pos);
    p.connect(this.sfx);
    return p;
  }

  _setPannerPos(p, v) {
    if (p.positionX) {
      const t = this.ctx.currentTime;
      p.positionX.setValueAtTime(v.x, t);
      p.positionY.setValueAtTime(v.y, t);
      p.positionZ.setValueAtTime(v.z, t);
    } else p.setPosition(v.x, v.y, v.z);
  }

  _out(pos, ref, rolloff) { return pos ? this._panner(pos, ref, rolloff) : this.sfx; }

  // Short shaped noise burst.
  _burst(dest, t, dur, type, freq, q, vol, attack = 0.004) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 2, dur + 0.05);
    return f;
  }

  _tone(dest, t, freq, dur, vol, type = 'sine', endFreq = null, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.getWorldPosition(this._v || (this._v = camera.position.clone()));
    const e = camera.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX && l.forwardX) {
      const t = this.ctx.currentTime;
      const set = (param, v) => param.setValueAtTime(v, t);
      set(l.positionX, p.x); set(l.positionY, p.y); set(l.positionZ, p.z);
      set(l.forwardX, fx); set(l.forwardY, fy); set(l.forwardZ, fz);
      set(l.upX, ux); set(l.upY, uy); set(l.upZ, uz);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---------- Ambience ----------
  setAmbience(cfg) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now;
    if (this.amb) {
      const old = this.amb;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 2.5);
      setTimeout(() => old.nodes.forEach((n) => { try { n.stop(); } catch (e) {} }), 3000);
    }
    if (!cfg) { this.amb = null; return; }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(cfg.gain ?? 1, t + 4);
    gain.connect(this.ambBus);
    const nodes = [];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cfg.cutoff ?? 500;
    lp.connect(gain);
    for (const f of cfg.drone || []) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = cfg.wave || 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = (cfg.droneVol ?? 0.05) / (cfg.drone.length);
        // Slow swell so the drone breathes.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.03 + Math.random() * 0.07;
        const lg = ctx.createGain();
        lg.gain.value = g.gain.value * 0.6;
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        o.connect(g).connect(lp);
        o.start();
        nodes.push(o, lfo);
      }
    }
    if (cfg.wind) {
      const src = this._loop(this.brown);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = cfg.windFreq ?? 450;
      bp.Q.value = 0.6;
      const wg = ctx.createGain();
      wg.gain.value = cfg.wind;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lg = ctx.createGain();
      lg.gain.value = cfg.wind * 0.7;
      lfo.connect(lg).connect(wg.gain);
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.05;
      const lg2 = ctx.createGain();
      lg2.gain.value = (cfg.windFreq ?? 450) * 0.4;
      lfo2.connect(lg2).connect(bp.frequency);
      lfo.start();
      lfo2.start();
      src.connect(bp).connect(wg).connect(gain);
      nodes.push(src, lfo, lfo2);
    }
    if (cfg.hum) {
      const o = ctx.createOscillator();
      o.frequency.value = cfg.hum;
      const g = ctx.createGain();
      g.gain.value = 0.015;
      o.connect(g).connect(gain);
      o.start();
      nodes.push(o);
    }
    this.amb = { gain, nodes };
  }

  setWhine() {} // the old high whine near Voyer; removed, Voyer is silent now
  setFear(v) { if (this.ctx) setParam(this.fearGain.gain, v * 0.5, this.now); }
  setRoar(v) {
    if (!this.ctx) return;
    setParam(this.roarGain.gain, v * 1.6, this.now);
    this.roarFilter.frequency.value = 400 + v * 1600;
  }
  setHeart(bpm, vol) { this.heartRate = bpm; this.heartVol = vol; }

  muteAll() {
    if (!this.ctx) return;
    const t = this.now;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0, t);
    this.scare.gain.cancelScheduledValues(t);
    this.scare.gain.setValueAtTime(0, t);
  }

  unmute() {
    if (!this.ctx) return;
    const t = this.now;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.9, t);
    this.scare.gain.cancelScheduledValues(t);
    this.scare.gain.setValueAtTime(1, t);
  }

  // ---------- One-shots ----------
  footstep(surface, vol = 1, pos = null) {
    if (!this.ctx) return;
    const t = this.now, out = this._out(pos, 2, 1.2);
    const v = 0.22 * vol;
    switch (surface) {
      case 'grass':
        this._burst(out, t, 0.16, 'bandpass', 1800 + Math.random() * 600, 0.5, v * 0.6, 0.02);
        break;
      case 'gravel':
        this._burst(out, t, 0.2, 'bandpass', 2600, 0.7, v * 0.8, 0.01);
        this._burst(out, t + 0.03, 0.12, 'bandpass', 4000, 1, v * 0.3);
        break;
      case 'wood':
        this._tone(out, t, 110 + Math.random() * 20, 0.12, v * 1.1);
        this._burst(out, t, 0.08, 'lowpass', 900, 1, v * 0.7);
        break;
      case 'carpet':
        this._burst(out, t, 0.1, 'lowpass', 600, 0.7, v * 0.6, 0.01);
        break;
      case 'stone':
        this._burst(out, t, 0.09, 'bandpass', 1300 + Math.random() * 300, 1.2, v);
        this._tone(out, t, 85, 0.07, v * 0.5);
        break;
      default: // asphalt
        this._burst(out, t, 0.1, 'bandpass', 950 + Math.random() * 300, 0.9, v);
    }
  }

  heavyStep(pos, vol = 1) {
    if (!this.ctx) return;
    const t = this.now, out = this._out(pos, 3, 1.1);
    this._tone(out, t, 70, 0.25, 0.5 * vol, 'sine', 35);
    this._burst(out, t, 0.18, 'lowpass', 500, 1, 0.35 * vol);
  }

  creak(pos = null, dur = 1.4, vol = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now, out = this._out(pos, 2, 1);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const curve = new Float32Array(16);
    let f = 70 + Math.random() * 40;
    for (let i = 0; i < 16; i++) { f += (Math.random() - 0.45) * 30; curve[i] = Math.max(40, f); }
    o.frequency.setValueCurveAtTime(curve, t, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 22 + Math.random() * 15;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(trem.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.15);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp).connect(trem).connect(g).connect(out);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }

  clunk(pos = null, vol = 1) {
    if (!this.ctx) return;
    const t = this.now, out = this._out(pos, 2, 1);
    this._tone(out, t, 90, 0.3, 0.5 * vol, 'sine', 40);
    this._burst(out, t, 0.05, 'highpass', 2000, 1, 0.4 * vol);
    this._tone(out, t + 0.01, 1850, 0.25, 0.05 * vol);
  }

  rattle(pos = null) {
    if (!this.ctx) return;
    const t = this.now, out = this._out(pos, 2, 1);
    for (let i = 0; i < 6; i++) this._burst(out, t + i * 0.055 + Math.random() * 0.02, 0.05, 'bandpass', 1600, 2, 0.3);
    this._tone(out, t, 80, 0.15, 0.2);
  }

  slam(pos = null, vol = 1) {
    if (!this.ctx) return;
    const t = this.now, out = this._out(pos, 6, 0.8);
    this._burst(out, t, 0.6, 'lowpass', 350, 0.8, 0.9 * vol);
    this._tone(out, t, 60, 0.5, 0.7 * vol, 'sine', 30);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.now;
    this._tone(this.sfx, t, 1318.5, 1.6, 0.12);
    this._tone(this.sfx, t + 0.12, 1975.5, 1.8, 0.09);
    this._tone(this.sfx, t + 0.24, 2637, 2, 0.05);
  }

  breath(pos = null, vol = 0.6) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now, out = this._out(pos, 2, 1.2);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1100, t + 0.6);
    f.frequency.linearRampToValueAtTime(400, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.5);
    g.gain.linearRampToValueAtTime(0, t + 1.7);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random(), 1.8);
  }

  whisper(pos = null, vol = 0.4) {
    if (!this.ctx) return;
    const t = this.now, out = this._out(pos, 3, 1);
    for (let i = 0; i < 9; i++) {
      this._burst(out, t + i * 0.14 + Math.random() * 0.06, 0.12, 'bandpass', 2500 + Math.random() * 2500, 4, vol * (0.4 + Math.random() * 0.6), 0.03);
    }
  }

  growl(pos = null, vol = 0.7) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now, out = this._out(pos, 3, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(900, t + 0.5);
    lp.frequency.linearRampToValueAtTime(250, t + 1.6);
    lp.connect(out);
    for (const f of [52, 55.5, 104]) this._tone(lp, t, f, 1.7, vol * 0.4, 'sawtooth', f * 0.8, 0.2);
    this._burst(lp, t, 1.5, 'lowpass', 600, 0.5, vol * 0.6, 0.3);
  }

  // The jumpscare: a high, ragged shriek. Detuned voices start high and stay up there, their
  // pitch shaking erratically; a growling ring modulation and hiss make it inhuman, and the low
  // vowel body is filtered out so it never sounds like "aah". A thump marks the hit.
  sting(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now, dur = 1.5;
    const out = ctx.createGain();
    out.gain.value = 1.6 * vol;
    out.connect(this.scare);
    out.connect(this.verbSend);
    const shaper = ctx.createWaveShaper();
    const c = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 256 - 1; c[i] = Math.tanh(x * 2.6); }
    shaper.curve = c;
    shaper.connect(out);

    // Only the upper, piercing part of the voice gets through.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    hp.Q.value = 0.7;
    hp.connect(shaper);
    const voice = ctx.createGain();
    for (const [f, q, g] of [[2600, 3, 1], [3800, 4, 0.7], [5200, 5, 0.35]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = g * 2.4;
      voice.connect(bp).connect(fg).connect(hp);
    }
    // Ring modulation: a fast flutter that makes it rasp like torn vocal cords.
    const ring = ctx.createGain();
    ring.gain.value = 0.55;
    const rmod = ctx.createOscillator();
    rmod.frequency.value = 73;
    const rdepth = ctx.createGain();
    rdepth.gain.value = 0.45;
    rmod.connect(rdepth).connect(ring.gain);
    rmod.start(t);
    rmod.stop(t + dur);
    ring.connect(voice);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + 0.012);
    amp.gain.setValueAtTime(1, t + 0.85);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    amp.connect(ring);

    // Erratic pitch: starts high and shakes, never settling into a tune.
    const steps = 48, curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const k = i / (steps - 1);
      const base = k < 0.04 ? 1 + k * 12 : 1.45 - k * 0.35;
      curve[i] = 880 * base * (1 + (Math.random() - 0.5) * 0.09);
    }
    for (const [mul, type, g] of [[1, 'sawtooth', 0.5], [1.012, 'sawtooth', 0.45], [0.991, 'square', 0.3], [1.41, 'sawtooth', 0.28]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueCurveAtTime(curve.map((f) => f * mul), t, dur);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(amp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    // Hiss over the top, and the hit underneath.
    this._burst(amp, t, dur, 'highpass', 3000, 0.7, 0.5, 0.01);
    this._tone(this.scare, t, 85, 0.6, 1.3 * vol, 'sine', 32, 0.002);
    this._burst(this.scare, t, 0.2, 'lowpass', 2200, 0.7, 1.0 * vol, 0.001);
  }

  boom(vol = 0.6) {
    if (!this.ctx) return;
    const t = this.now;
    this._tone(this.sfx, t, 55, 3, vol, 'sine', 22, 0.02);
    this._burst(this.sfx, t, 2, 'lowpass', 200, 0.5, vol * 0.5, 0.05);
  }

  distantFootsteps(pos, count = 4) {
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) setTimeout(() => this.footstep('asphalt', 0.8, pos), i * 520);
  }

  // ---------- Positional loops ----------
  // Returns an emitter: { setPos(v), setGain(g), stop() }.
  emitter(type, pos, opts = {}) {
    if (!this.ctx) return { setPos() {}, setGain() {}, stop() {}, tick() {} };
    const ctx = this.ctx;
    const panner = this._panner(pos, opts.ref ?? 2, opts.rolloff ?? 1.3);
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 1;
    gain.connect(panner);
    const nodes = [];
    const em = {
      type, gain, panner, nodes, timer: opts.delay ?? 0, step: 0, enabled: true,
      setPos: (v) => this._setPannerPos(panner, v),
      setGain: (g) => setParam(gain.gain, g, this.now),
      stop: () => {
        em.enabled = false;
        this.emitters.delete(em);
        nodes.forEach((n) => { try { n.stop(); } catch (e) {} });
        setTimeout(() => { try { gain.disconnect(); panner.disconnect(); } catch (e) {} }, 100);
      },
    };
    if (type === 'wind') {
      const src = this._loop(this.brown);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 0.5;
      const wg = ctx.createGain();
      wg.gain.value = 1.4;
      src.connect(bp).connect(wg).connect(gain);
      nodes.push(src);
    } else if (type === 'buzz') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 120;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(lp).connect(g).connect(gain);
      o.start();
      nodes.push(o);
    }
    this.emitters.add(em);
    return em;
  }

  _tickEmitter(em, dt) {
    em.timer -= dt;
    if (em.timer > 0) return;
    const t = this.now, out = em.gain;
    switch (em.type) {
      case 'chime': {
        // Old, slightly detuned music box.
        const melody = [1318.5, 1174.7, 1046.5, 880, 1046.5, 1174.7, 784, 880];
        for (let i = 0; i < 4; i++) {
          const f = melody[(em.step * 4 + i) % melody.length] * Math.pow(2, (Math.random() * 30 - 15) / 1200);
          const tt = t + i * 0.42;
          this._tone(out, tt, f, 1.4, 0.18);
          this._tone(out, tt, f * 2.01, 0.6, 0.05);
          this._tone(out, tt, f * 3.02, 0.3, 0.02);
        }
        em.step++;
        em.timer = 4.2;
        break;
      }
      case 'phone': {
        for (const f of [440, 480]) {
          const o = this.ctx.createOscillator();
          o.frequency.value = f;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0, t);
          for (let i = 0; i < 40; i++) g.gain.setValueAtTime(i % 2 ? 0 : 0.12, t + i * 0.05);
          g.gain.setValueAtTime(0, t + 2);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 2.05);
        }
        em.timer = 6;
        break;
      }
      case 'clock':
        this._burst(out, t, 0.03, 'bandpass', em.step++ % 2 ? 2600 : 3600, 3, 0.4);
        em.timer = 1;
        break;
      case 'swing':
        this.creakTo(out, 1.1, 0.25);
        em.timer = 2.4;
        break;
      default:
        em.timer = 999;
    }
  }

  creakTo(dest, dur, vol) {
    // creak() variant that writes into a given node (for emitters).
    const saved = this._out;
    this._out = () => dest;
    this.creak({}, dur, vol);
    this._out = saved;
  }

  update(dt) {
    if (!this.ctx) return;
    for (const em of this.emitters) if (em.enabled) this._tickEmitter(em, dt);

    if (this.heartRate > 0 && this.heartVol > 0.01) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 60 / this.heartRate;
        const t = this.now;
        this._tone(this.master, t, 58, 0.16, 0.6 * this.heartVol, 'sine', 40);
        this._tone(this.master, t + 0.2, 52, 0.18, 0.45 * this.heartVol, 'sine', 36);
      }
    }

    if (this.birds) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 0.8 + Math.random() * 3;
        const t = this.now, n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1600;
        for (let i = 0; i < n; i++) {
          this._tone(this.sfx, t + i * 0.11, base * (1 + Math.random() * 0.2), 0.09, 0.03, 'sine', base * 1.4);
        }
      }
    }
  }

  stopAllEmitters() { for (const em of [...this.emitters]) em.stop(); }
}

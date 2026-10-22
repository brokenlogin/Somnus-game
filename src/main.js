import * as THREE from 'three';
import { Input } from './core/input.js';
import { UI } from './core/ui.js';
import { AudioSys } from './core/audio.js';
import { Post } from './core/post.js';
import { Player } from './core/player.js';
import { Lunge } from './monsters/chasseur.js';
import { damp, sleep } from './core/util.js';

window.__booted = true;

const LEVELS = [
  { load: () => import('./levels/level1_town.js').then((m) => m.Level1Town), num: 'I', name: 'The Town That Repeats' },
  { load: () => import('./levels/level2_cube.js').then((m) => m.Level2Cube), num: 'II', name: 'A Small, Square World' },
  { load: () => import('./levels/level3_spiral.js').then((m) => m.Level3Spiral), num: 'III', name: 'The Long Way Down' },
  { load: () => import('./levels/level4_labyrinth.js').then((m) => m.Level4Labyrinth), num: 'IV', name: 'Where the Walls Remember' },
  { load: () => import('./levels/level5_mansion.js').then((m) => m.Level5Mansion), num: 'V', name: 'The House Above the Clouds' },
  { load: () => import('./levels/wake.js').then((m) => m.FallScene) },
  { load: () => import('./levels/wake.js').then((m) => m.WakeScene) },
  { load: () => import('./levels/viewer.js').then((m) => m.ModelViewer) }, // debug: ?level=9
];

const params = new URLSearchParams(location.search);
const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 700);
    this.input = new Input(this.canvas);
    this.ui = new UI();
    this.audio = new AudioSys();
    this.post = new Post(this.renderer);
    this.player = new Player(this.camera);
    this.lunge = new Lunge(this);
    this.state = 'menu';
    this.paused = false;
    this.hasKey = false;
    this.levelIndex = -1;
    this.level = null;
    this.time = 0;
    this.fear = 0;
    this.noLock = params.has('nolock');
    this.emptyScene = new THREE.Scene();
    this.emptyScene.background = new THREE.Color(0);

    this.player.onStep = (run) => this.audio.footstep(this.level?.surface, run ? 1.25 : 0.9);
    this.player.onBreath = () => this.audio.breath(null, 0.35);

    addEventListener('resize', () => this.resize());
    this.resize();

    this.input.sensitivity = parseFloat(localStorageGet('somnus.sens') || '1');
    const sens = document.getElementById('sens');
    sens.value = this.input.sensitivity;
    sens.addEventListener('input', () => {
      this.input.sensitivity = parseFloat(sens.value);
      localStorageSet('somnus.sens', sens.value);
    });

    document.getElementById('startBtn').addEventListener('click', () => this.start());
    document.getElementById('resumeBtn').addEventListener('click', () => this.resume());
    document.getElementById('againBtn').addEventListener('click', () => location.reload());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'play' && !this.input.locked && !this.noLock) this.input.lock();
    });
    this.input.onLockChange = (locked) => {
      if (locked) {
        this.paused = false;
        document.getElementById('pause').classList.add('hidden');
      } else if ((this.state === 'play' || this.state === 'cinematic') && !this.noLock) {
        this.paused = true;
        document.getElementById('pause').classList.remove('hidden');
      }
    };

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async start() {
    this.audio.init();
    this.audio.resume();
    document.getElementById('menu').classList.add('hidden');
    if (!this.noLock) this.input.lock();
    const n = parseInt(params.get('level') || '1', 10);
    await this.loadLevel(Math.max(0, Math.min(LEVELS.length - 1, n - 1)));
  }

  resume() {
    this.audio.resume();
    if (this.noLock) {
      this.paused = false;
      document.getElementById('pause').classList.add('hidden');
    } else this.input.lock();
  }

  async loadLevel(i, { retry = false } = {}) {
    this.state = 'loading';
    this.ui.fadeTo(1, 0);
    this.ui.setPrompt(null);
    this.ui.clearThoughts();
    this.lunge.cancel();
    if (this.level) {
      this.level.scene.remove(this.camera);
      this.level.dispose();
      this.level = null;
    }
    this.audio.setWhine(0);
    this.audio.setFear(0);
    this.audio.setHeart(0, 0);
    this.hasKey = false;
    this.keyUsed = false;
    this.ui.setKey(false);
    this.levelIndex = i;
    const def = LEVELS[i];
    const Cls = await def.load();
    const level = new Cls(this);
    level.build();
    level.scene.add(this.camera);
    this.player.enabled = true;
    this.player.lookEnabled = true;
    this.player.shake = 0;
    this.player.place(level.spawn.pos, level.spawn.forward, level.spawn.up);
    this.player.updateCamera(1);
    this.level = level;
    this.audio.setAmbience(level.ambience);
    this.post.uniforms.grain.value = level.grain ?? 0.07;
    this.post.uniforms.desat.value = level.desat ?? 0.25;
    this.renderer.compile(level.scene, this.camera);
    this.state = level.cinematic ? 'cinematic' : 'play';
    if (def.num && !retry) {
      await this.ui.showTitle(def.num, def.name, 3);
      await sleep(0.4);
    }
    if (this.level !== level) return;
    this.ui.fadeTo(0, level.fadeIn ?? 2.5);
    level.enter();
  }

  async nextLevel(fade = 1.4) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.player.enabled = false;
    await this.ui.fadeTo(1, fade);
    await this.loadLevel(this.levelIndex + 1);
    this.transitioning = false;
  }

  // Caught: start the current level over from its beginning.
  async restartLevel() {
    if (this.transitioning) return;
    this.transitioning = true;
    await this.loadLevel(this.levelIndex, { retry: true });
    this.transitioning = false;
    this.ui.think('Again. From the beginning.', 3);
  }

  pickKey() {
    this.hasKey = true;
    this.ui.setKey(true);
    this.audio.pickup();
    this.ui.think(this.level.keyLine || 'A key. Now find the door.', 3.5);
    this.level.onKey?.();
  }

  useKey() {
    this.hasKey = false;
    this.keyUsed = true;
    this.ui.setKey(false);
  }

  // The final cut: everything goes black and silent.
  endGame(text) {
    this.state = 'end';
    this.audio.muteAll();
    this.ui.fadeTo(1, 0);
    this.ui.setPrompt(null);
    this.ui.clearThoughts();
    this.input.unlock();
    document.getElementById('pause').classList.add('hidden');
    const end = document.getElementById('end');
    if (text) document.getElementById('endText').textContent = text;
    setTimeout(() => {
      end.classList.remove('hidden');
      requestAnimationFrame(() => end.classList.add('show'));
    }, 6500);
  }

  updateInteraction() {
    const lv = this.level;
    let best = null, bestD = 2.8;
    this.camera.getWorldPosition(_c);
    this.camera.getWorldDirection(_d);
    _ray.set(_c, _d);
    _ray.far = 2.8;
    _ray.camera = this.camera; // sprites (like eye glows) need it to be hit-tested
    for (const it of lv.interactables) {
      if (it.enabled === false || !it.object.visible) continue;
      if (!it.prompt()) continue;
      let d = Infinity;
      if (it.radius) {
        it.object.getWorldPosition(_v);
        const along = _v.clone().sub(_c).dot(_d);
        if (along > 0) {
          const perp = _v.clone().sub(_c).addScaledVector(_d, -along).length();
          if (perp < it.radius + along * 0.12) d = along;
        }
      } else {
        const hits = _ray.intersectObject(it.object, true);
        if (hits.length) d = hits[0].distance;
      }
      if (d < bestD) { bestD = d; best = it; }
    }
    const passive = best && best.passive && best.passive();
    this.ui.setPrompt(best ? (passive ? best.prompt() : `[E]  ${best.prompt()}`) : null);
    if (best && !passive && this.input.hit('KeyE')) best.act();
  }

  // Smear the screen around Disciple and Chasseur when they're in view.
  updateBlur(lv) {
    const u = this.post.uniforms;
    const spots = lv && lv.blurSpots && !this.lunge.active && this.state !== 'end' ? lv.blurSpots() : [];
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const slots = [u.blurA.value, u.blurB.value];
    let n = 0;
    for (const sp of spots) {
      if (n >= 2) break;
      _v.copy(sp.pos).project(this.camera);
      if (_v.z >= 1 || Math.abs(_v.x) > 1.6 || Math.abs(_v.y) > 1.6) continue;
      const dist = Math.max(0.5, this.camera.position.distanceTo(sp.pos));
      const r = Math.min(1.2, (sp.radius / (dist * tanH)) * 0.5);
      u.wave.value.setComponent(n, sp.wave ?? sp.strength);
      slots[n++].set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, r, sp.strength);
    }
    for (; n < 2; n++) slots[n].set(0, 0, 0, 0);
    u.aspect.value = this.camera.aspect;
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
  }

  // Debug helper: advance the simulation by `seconds` without waiting for frames.
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) this.tick(dt, t + dt < seconds);
  }

  tick(dt, skipRender = false) {
    this.time += dt;
    const lv = this.level;

    if (lv && !this.paused && (this.state === 'play' || this.state === 'cinematic')) {
      if (this.state === 'play') {
        this.player.update(dt, this.input, lv);
        this.updateInteraction();
      }
      lv.update(dt);
      const f = lv.maxFear;
      this.fear += (f - this.fear) * damp(2, dt);
      this.audio.setFear(this.fear * 0.5);
    }
    if (!this.paused && this.state !== 'end') this.lunge.update(dt);
    this.updateBlur(lv);
    this.post.uniforms.fear.value = this.fear;
    this.ui.update(dt);
    if (this.audio.ctx) {
      this.camera.updateMatrixWorld();
      this.audio.setListener(this.camera);
      this.audio.update(this.paused ? 0 : dt);
    }
    if (!skipRender) {
      if (this.state === 'end' || !lv) this.renderer.render(this.emptyScene, this.camera);
      else this.post.render(lv.scene, this.camera, this.time);
    }
    this.input.endFrame();
  }
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

const game = new Game();
window.__game = game;

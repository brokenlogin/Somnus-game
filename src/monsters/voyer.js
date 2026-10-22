import * as THREE from 'three';
import { onScreen, orient, lookCos, limb } from './shared.js';
import { rand, clamp } from '../core/util.js';

const _p = new THREE.Vector3();
const _head = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _peek = new THREE.Vector3();
const _hidden = new THREE.Vector3();
const _x = new THREE.Vector3();

// Tall, thin and pitch black, with two small white eyes.
function buildVoyer() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x020202 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf4f2ea });
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.45; // hips: lean pivots here so the feet stay planted
  g.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.8, 3, 8), mat);
  torso.position.y = 0.48;
  torso.scale.set(1, 1, 0.7);
  body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.35, 6), mat);
  neck.position.y = 1.05;
  body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat);
  head.scale.set(0.9, 1.45, 1);
  head.position.y = 1.33;
  body.add(head);
  // Shoulders: a narrow bar the arms hang from.
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 3, 6), mat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 0.84;
  body.add(shoulders);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), eyeMat);
    eye.scale.set(1.2, 0.8, 0.5);
    eye.position.set(s * 0.05, 0.03, 0.13);
    head.add(eye);
    const arm = limb(1.5, 0.035, mat);
    arm.position.set(s * 0.17, 0.84, 0);
    arm.rotation.z = s * 0.05;
    body.add(arm);
    // Legs: thigh, knee, shin and a foot, standing on the ground.
    const hip = new THREE.Group();
    hip.position.set(s * 0.09, 1.45, 0);
    g.add(hip);
    hip.add(limb(0.62, 0.06, mat));
    const shin = limb(0.6, 0.048, mat);
    shin.position.y = -0.72;
    hip.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.24), mat);
    foot.position.set(s * 0.09, 0.03, 0.06);
    g.add(foot);
  }
  g.userData = { body, head, mat, eyeMat };
  return g;
}

// The watcher. Appears at the edge of your vision, half hidden, and slips away when stared at.
export class Voyer {
  constructor(game, level, opts = {}) {
    this.game = game;
    this.level = level;
    this.opts = { minDist: 22, maxDist: 60, flee: 9, ...opts };
    this.mesh = buildVoyer();
    this.mesh.visible = false;
    level.scene.add(this.mesh);
    this.state = 'waiting';
    this.timer = opts.firstDelay ?? rand(14, 28);
    this.spot = null;
    this.stare = 0;
    this.fear = 0;
    this.seenOnce = false;
  }

  spots() { return this.level.voyerSpots || []; }

  // Pick where to appear. Corner spots are resolved relative to the player so a wall
  // or house hides most of the body and only the head leans out past the edge.
  tryAppear() {
    const player = this.game.player, cam = this.game.camera, lv = this.level;
    const eye = player.eyePosition(_eye);
    const cands = [];
    for (const s of this.spots()) {
      if (s.when && !s.when()) continue;
      let base = s.p, side = null;
      if (s.corner) {
        lv.relPos(s.corner, player.pos, _p);
        const d0 = _p.distanceTo(player.pos);
        if (d0 < this.opts.minDist - 2 || d0 > this.opts.maxDist + 2) continue;
        const r = lv.peekPosition(s, player.pos);
        if (!r) continue;
        base = r.pos;
        side = r.visibleSide;
      }
      lv.relPos(base, player.pos, _p);
      const d = _p.distanceTo(player.pos);
      if (d < this.opts.minDist || d > this.opts.maxDist) continue;
      _head.copy(_p).addScaledVector(s.up, 2.6);
      if (onScreen(cam, _head, 1.1)) continue;
      if (side) {
        // The peeking head must be visible, the body behind it hidden.
        _peek.copy(_head).addScaledVector(side, 0.25);
        _hidden.copy(_p).addScaledVector(s.up, 1.4).addScaledVector(side, -0.15);
        if (!lv.lineOfSight(eye, _peek) || lv.lineOfSight(eye, _hidden)) continue;
      } else if (!lv.lineOfSight(eye, _head)) continue;
      cands.push({ s, base, side });
    }
    if (!cands.length) return false;
    const c = cands[Math.floor(Math.random() * cands.length)];
    this.spot = c.s;
    this.base = c.base.clone();
    this.side = c.side;
    this.state = 'watching';
    this.timer = rand(...(this.opts.watch || [18, 40]));
    this.stare = 0;
    this.noticed = 0;
    this.lean = (Math.random() < 0.5 ? -1 : 1) * rand(0.1, 0.32);
    this.mesh.visible = true;
    this.mesh.scale.setScalar(rand(0.95, 1.1));
    return true;
  }

  hide(cooldown = rand(...(this.opts.cooldown || [8, 22]))) {
    this.state = 'waiting';
    this.timer = cooldown;
    this.mesh.visible = false;
    this.fear = 0;
    this.game.audio.setWhine(0);
  }

  update(dt) {
    const player = this.game.player, cam = this.game.camera;
    if (this.state === 'waiting') {
      this.timer -= dt;
      if (this.timer <= 0 && !this.tryAppear()) this.timer = this.opts.retry ?? 2;
      return;
    }
    // Its spot stopped making sense (on the cube: you walked onto another face). Gone; it
    // turns up again shortly somewhere that fits.
    if (this.spot.when && !this.spot.when()) {
      this.hide(rand(1.5, 4));
      return;
    }
    const up = this.spot.up;
    if (this.state === 'watching') {
      this.level.relPos(this.base, player.pos, this.mesh.position);
    }
    orient(this.mesh, up, player.pos);
    if (this.side) {
      // Lean the head out past the corner, toward the player's side.
      _x.set(1, 0, 0).applyQuaternion(this.mesh.quaternion);
      this.lean = -Math.sign(_x.dot(this.side)) * 0.24;
    }
    const { body, head } = this.mesh.userData;
    body.rotation.z = this.lean;
    head.rotation.z = Math.sin(performance.now() * 0.0004) * 0.25 - this.lean;

    // Use the real (leaning) head, which is the part that pokes out from cover.
    this.mesh.updateMatrixWorld(true);
    head.getWorldPosition(_head);
    const d = this.mesh.position.distanceTo(player.pos);
    const visible = onScreen(cam, _head) && this.level.lineOfSight(player.eyePosition(_eye), _head);

    if (this.state === 'watching') {
      if (visible) this.noticed += dt;
      if (visible && lookCos(cam, _head) > Math.cos(THREE.MathUtils.degToRad(9))) this.stare += dt;
      else this.stare = Math.max(0, this.stare - dt * 0.3);
      this.timer -= dt;
      if (this.stare > 0.35 || d < this.opts.flee) {
        // Caught looking: it's simply gone.
        this.game.audio.whisper(this.mesh.position, 0.25);
        if (!this.seenOnce) {
          this.seenOnce = true;
          if (this.level.voyerLine) this.game.ui.think(this.level.voyerLine, 3.5);
        }
        this.hide();
        return;
      }
      if (!visible && (this.noticed > 0.12 || this.timer < 0)) {
        // You saw it, looked away... and when you look back, nothing is there.
        this.hide();
        return;
      }
    }

    this.fear = visible ? clamp(1 - d / 70, 0, 1) * 0.5 : 0;
    this.game.audio.setWhine(visible ? clamp(1 - d / 80, 0.15, 1) : 0);
  }

  dispose() {
    this.game.audio.setWhine(0);
    this.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    this.mesh.userData.mat.dispose();
    this.mesh.userData.eyeMat.dispose();
  }
}

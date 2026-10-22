import * as THREE from 'three';
import { onScreen, orient, limb } from './shared.js';
import { rand, clamp } from '../core/util.js';

const _a = new THREE.Vector3();
const _up = new THREE.Vector3();
const _head = new THREE.Vector3();
const _eye = new THREE.Vector3();

function buildDisciple() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x030303, transparent: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x5a5448, transparent: true, fog: true });
  // Too tall and too thin: about 2.5 m.
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.0, 3, 8), mat);
  torso.position.y = 1.72;
  torso.scale.set(1, 1, 0.55);
  g.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 6), mat);
  neck.position.y = 2.33;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8), mat);
  head.position.y = 2.5;
  head.scale.set(0.9, 1.25, 1);
  g.add(head);
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 3, 6), mat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 2.2;
  g.add(shoulders);
  for (const s of [-1, 1]) {
    const leg = limb(1.12, 0.05, mat);
    leg.position.set(s * 0.075, 1.22, 0);
    g.add(leg);
    const arm = limb(1.2, 0.035, mat);
    arm.position.set(s * 0.18, 2.2, 0);
    arm.rotation.z = s * 0.04;
    g.add(arm);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 4, 3), eyeMat);
    eye.position.set(s * 0.045, 2.53, 0.12);
    g.add(eye);
  }
  g.userData = { mat, eyeMat };
  return g;
}

// The stalker. A silhouette that walks your own footsteps behind you,
// freezes while you look at it, and dissolves if you get close.
export class Disciple {
  constructor(game, level, opts = {}) {
    this.game = game;
    this.level = level;
    this.opts = { minBack: 22, maxBack: 36, vanish: 9, speed: 4.5, respawn: [18, 45], ...opts };
    this.mesh = buildDisciple();
    this.mesh.visible = false;
    level.scene.add(this.mesh);
    this.state = 'absent';
    this.timer = opts.firstDelay ?? rand(25, 45);
    this.idx = 0; // absolute trail index
    this.fear = 0;
    this.opacity = 1;
    this.seenOnce = false;
    this.seen = false;
    this.curUp = new THREE.Vector3(0, 1, 0);
    this.blurPos = new THREE.Vector3();
  }

  // Where the screen should smear around it (see Post), or null.
  blurSpot() {
    if (!this.mesh.visible || !this.seen) return null;
    this.blurPos.copy(this.mesh.position).addScaledVector(this.curUp, 1.35);
    return { pos: this.blurPos, radius: 2.8, strength: this.opacity * 0.35, wave: this.opacity * 0.15 };
  }

  trailPoint(absIdx, outP, outUp) {
    const pl = this.game.player, trail = pl.trail;
    const n = trail.length;
    let i = clamp(absIdx - pl.trailBase, 0, n - 1);
    const i0 = Math.floor(i), i1 = Math.min(i0 + 1, n - 1), t = i - i0;
    const a = trail[i0], b = trail[i1];
    if (a.p.distanceToSquared(b.p) > 36) {
      outP.copy(a.p);
      outUp.copy(a.up);
    } else {
      outP.copy(a.p).lerp(b.p, t);
      outUp.copy(a.up).lerp(b.up, t).normalize();
    }
  }

  setOpacity(o) {
    this.opacity = o;
    this.mesh.userData.mat.opacity = o;
    this.mesh.userData.eyeMat.opacity = o;
  }

  update(dt) {
    const pl = this.game.player, cam = this.game.camera, trail = pl.trail;
    const n = trail.length, head = pl.trailBase + n - 1;
    this.fear = 0;
    this.seen = false;

    if (this.state === 'absent') {
      this.timer -= dt;
      if (this.timer > 0) return;
      const back = Math.round(rand(this.opts.minBack, this.opts.maxBack) / 2);
      if (n < back + 4) { this.timer = 3; return; }
      this.idx = head - back;
      this.trailPoint(this.idx, _a, _up);
      this.level.relPos(_a, pl.pos, _a);
      _head.copy(_a).addScaledVector(_up, 2.3);
      if (onScreen(cam, _head, 1.1) || _a.distanceTo(pl.pos) < this.opts.minBack * 0.8) { this.timer = 1.5; return; }
      this.state = 'following';
      this.life = rand(40, 90);
      this.back = back;
      this.setOpacity(1);
      this.mesh.visible = true;
    }

    if (this.state === 'following' || this.state === 'vanishing') {
      this.trailPoint(this.idx, _a, _up);
      this.level.relPos(_a, pl.pos, this.mesh.position);
      orient(this.mesh, _up, pl.pos);
      _head.copy(this.mesh.position).addScaledVector(_up, 2.3);
      const d = this.mesh.position.distanceTo(pl.pos);
      const seen = onScreen(cam, _head, 1.05) && this.level.lineOfSight(pl.eyePosition(_eye), _head);
      this.seen = seen;
      this.curUp.copy(_up);

      if (this.state === 'following') {
        const target = head - this.back;
        if (!seen && this.idx < target) {
          this.idx = Math.min(target, this.idx + (this.opts.speed / 2) * dt);
          if (target - this.idx > 25) this.idx = target - 8;
        }
        if (Math.random() < dt * 0.05) this.back = Math.round(rand(this.opts.minBack, this.opts.maxBack) / 2);
        this.life -= dt;
        if (seen && !this.seenOnce) {
          this.seenOnce = true;
          if (this.level.discipleLine) this.game.ui.think(this.level.discipleLine, 3.5);
        }
        // Only when you are really close to it, not just on the other side of a wall.
        if (d < this.opts.vanish && this.level.lineOfSight(pl.eyePosition(_eye), _head)) {
          this.state = 'vanishing';
          this.vt = 0;
          this.game.audio.breath(this.mesh.position, 0.7);
        } else if (this.life < 0 && !seen) {
          this.state = 'absent';
          this.mesh.visible = false;
          this.timer = rand(...this.opts.respawn);
        }
        this.fear = seen ? clamp(1 - d / 40, 0, 1) * 0.7 : 0;
      } else {
        this.vt += dt;
        this.setOpacity(Math.max(0, 1 - this.vt / 0.7));
        this.mesh.scale.y = 1 + this.vt * 0.4;
        this.fear = 0.6;
        if (this.vt > 0.7) {
          this.state = 'absent';
          this.mesh.visible = false;
          this.mesh.scale.y = 1;
          this.timer = rand(...this.opts.respawn);
        }
      }
    }
  }

  dispose() {
    this.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    this.mesh.userData.mat.dispose();
    this.mesh.userData.eyeMat.dispose();
  }
}

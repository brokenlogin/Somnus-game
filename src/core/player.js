import * as THREE from 'three';
import { clamp, damp } from './util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _x = new THREE.Vector3(1, 0, 0);
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _back = new THREE.Vector3();
const _ident = new THREE.Quaternion();

// First-person controller. "up" can be any unit vector (the cube level rotates it),
// so look and movement are expressed relative to the player's own frame.
export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.pitch = 0;
    this.vUp = 0;
    this.grounded = true;
    this.height = 1.7;
    this.eyeHeight = 1.62;
    this.radius = 0.35;
    this.walkSpeed = 3.4;
    this.runSpeed = 6.0;
    this.stamina = 1;
    this.staminaDuration = 7;
    this.speed = 0;
    this.moving = false;
    this.running = false;
    this.enabled = true;
    this.lookEnabled = true;
    this.stepDist = 0;
    this.bob = 0;
    this.trail = [];
    this.trailBase = 0;
    this.camOffsetQ = new THREE.Quaternion();
    this.eyeOffset = new THREE.Vector3();
    this.shake = 0;
    this.onStep = null;
    this.breathTimer = 0;
  }

  // Place the player at feet position `pos`, facing direction `forward`.
  place(pos, forward, up = new THREE.Vector3(0, 1, 0)) {
    this.pos.copy(pos);
    this.up.copy(up).normalize();
    this.forward.copy(forward).projectOnPlane(this.up).normalize();
    this.pitch = 0;
    this.vUp = 0;
    this.grounded = true;
    this.trail.length = 0;
    this.trailBase = 0;
    this.camOffsetQ.identity();
    this.eyeOffset.set(0, 0, 0);
    this.stamina = 1;
    this.recordTrail(true);
  }

  // Rotate the whole frame (used when snapping onto a new cube face). The
  // camera keeps its old orientation for a moment and then eases into the new one.
  rotateFrame(R, oldEye) {
    this.forward.applyQuaternion(R).normalize();
    this.up.applyQuaternion(R).normalize();
    this.camOffsetQ.multiply(_q.copy(R).invert());
    this.eyeOffset.copy(oldEye).sub(this.eyePosition(new THREE.Vector3(), false));
  }

  eyePosition(out, withOffset = true) {
    out.copy(this.pos).addScaledVector(this.up, this.eyeHeight + this.bob);
    if (withOffset) out.add(this.eyeOffset);
    return out;
  }

  lookDir(out) { return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion); }

  recordTrail(force = false) {
    const last = this.trail[this.trail.length - 1];
    if (force || !last || last.p.distanceToSquared(this.pos) > 4) {
      this.trail.push({ p: this.pos.clone(), up: this.up.clone() });
      if (this.trail.length > 500) {
        this.trail.shift();
        this.trailBase++;
      }
    }
  }

  update(dt, input, level) {
    if (this.lookEnabled) {
      const s = 0.0022 * input.sensitivity;
      this.forward.applyAxisAngle(this.up, -input.dx * s).normalize();
      this.pitch = clamp(this.pitch - input.dy * s, -1.5, 1.5);
    }
    _right.crossVectors(this.forward, this.up).normalize();

    let f = 0, r = 0;
    if (this.enabled) ({ f, r } = input.axis());
    _wish.set(0, 0, 0).addScaledVector(this.forward, f).addScaledVector(_right, r);
    this.moving = _wish.lengthSq() > 0.01;
    if (this.moving) _wish.normalize();

    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    const wantRun = this.enabled && !this.noRun && this.moving && f > 0 && shift;
    if (wantRun && this.stamina > 0.02) {
      this.running = true;
      this.stamina = Math.max(0, this.stamina - dt / this.staminaDuration);
    } else {
      this.running = false;
      this.stamina = Math.min(1, this.stamina + (dt / this.staminaDuration) * (this.moving ? 0.45 : 0.8));
    }
    if (this.stamina < 0.02) this.exhausted = true;
    if (this.stamina > 0.35) this.exhausted = false;
    if (this.exhausted) this.running = false;

    const target = this.moving ? (this.running ? this.runSpeed : this.walkSpeed) * (this.exhausted ? 0.85 : 1) : 0;
    this.speed += (target - this.speed) * damp(10, dt);
    _wish.multiplyScalar(this.speed * dt);

    if (this.enabled && this.grounded && input.hit('Space')) this.vUp = 4.6;

    if (level) level.move(this, _wish, dt);

    // Head-bob and footsteps.
    if (this.grounded && this.speed > 0.5) {
      const moved = this.speed * dt;
      this.stepDist += moved;
      const stride = this.running ? 2.4 : 1.9;
      this.bob = Math.sin((this.stepDist / stride) * Math.PI * 2) * 0.045 * (this.running ? 1.6 : 1);
      if (this.stepDist >= stride) {
        this.stepDist -= stride;
        if (this.onStep) this.onStep(this.running);
      }
    } else {
      this.bob *= 1 - damp(8, dt);
    }

    if (this.stamina < 0.3) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0 && this.onBreath) {
        this.breathTimer = 1.6;
        this.onBreath();
      }
    }

    this.recordTrail();
    this.updateCamera(dt);
  }

  updateCamera(dt) {
    _back.copy(this.forward).negate();
    _m.makeBasis(_right.crossVectors(this.forward, this.up).normalize(), this.up, _back);
    _q.setFromRotationMatrix(_m);
    _qp.setFromAxisAngle(_x, this.pitch);
    _q.multiply(_qp);
    this.camOffsetQ.slerp(_ident, damp(7, dt));
    this.eyeOffset.multiplyScalar(1 - damp(7, dt));
    this.camera.quaternion.copy(this.camOffsetQ).multiply(_q);
    this.eyePosition(this.camera.position);
    if (this.shake > 0) {
      const s = this.shake * 0.06;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
  }
}

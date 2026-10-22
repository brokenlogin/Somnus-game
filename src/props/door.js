import * as THREE from 'three';
import { tex } from '../core/textures.js';
import { damp } from '../core/util.js';

const _l = new THREE.Vector3();
const _w = new THREE.Vector3();
const OPEN = 1.75;
const _ashC = new THREE.Color(0x8a8a88);

// A freestanding door: frame + slab, opening onto pure black.
// mode 'entry': starts open (you just came out of it), then shuts and locks.
// mode 'exit' : locked until you hold the key; once open, walking into it ends the level.
export class FreeDoor {
  // swing: 1 opens away from you into the dark, -1 opens toward you (for doors in thin walls).
  constructor(game, { position, rotY = 0, quaternion = null, mode = 'exit', onEnter = null, swing = 1 }) {
    this.swing = swing;
    this.game = game;
    this.mode = mode;
    this.onEnter = onEnter;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    if (quaternion) this.group.quaternion.copy(quaternion);
    else this.group.rotation.y = rotY;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.8 });
    const slabMat = new THREE.MeshStandardMaterial({ map: tex('doorwood'), roughness: 0.75 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.8, roughness: 0.35 });
    this.materials = [frameMat, slabMat, knobMat];

    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.42, 0.22), frameMat);
      post.position.set(sx * 0.64, 1.21, 0);
      this.group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.14, 0.22), frameMat);
    lintel.position.set(0, 2.35, 0);
    this.group.add(lintel);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.04, 0.3), frameMat);
    sill.position.set(0, 0.02, 0);
    this.group.add(sill);

    this.voidMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 2.28), this.voidMat);
    voidPlane.position.set(0, 1.14, -0.05);
    this.group.add(voidPlane);

    this.pivot = new THREE.Group();
    this.pivot.position.set(-0.56, 0, 0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.26, 0.06), slabMat);
    slab.position.set(0.56, 1.165, 0);
    this.pivot.add(slab);
    for (const sz of [-1, 1]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), knobMat);
      knob.position.set(1.0, 1.0, sz * 0.06);
      this.pivot.add(knob);
    }
    this.group.add(this.pivot);
    this.slabMat = slabMat;

    if (mode === 'exit') {
      // Cold light leaking under the door and through the keyhole: this is the way out.
      const leakMat = new THREE.MeshBasicMaterial({ map: tex('glow'), color: 0xcfe0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      this.materials.push(leakMat);
      const leak = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), leakMat);
      leak.rotation.x = -Math.PI / 2;
      leak.position.set(0, 0.03, 0.45);
      this.group.add(leak);
      const crackMat = new THREE.MeshBasicMaterial({ color: 0xe8f0ff });
      this.materials.push(crackMat);
      const crack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.025, 0.07), crackMat);
      crack.position.set(0, 0.012, 0);
      this.group.add(crack);
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.05), crackMat);
      hole.position.set(0.44, 0.92, 0.032);
      this.pivot.add(hole);
      this.leakLight = new THREE.PointLight(0xc8d8ff, 2.5, 4, 1.5);
      this.leakLight.position.set(0, 0.15, 0.5);
      this.group.add(this.leakLight);
      this.leak = [leak, crack];
    }

    this.angle = mode === 'entry' ? OPEN : 0;
    this.target = this.angle;
    this.locked = mode === 'exit';
    this.entered = false;
    this.closeTimer = mode === 'entry' ? 1.8 : -1;
    this.pivot.rotation.y = this.angle * this.swing;
    this.inv = new THREE.Matrix4();

    this.interactable = {
      object: this.group,
      prompt: () => this.promptText(),
      passive: () => this.mode === 'exit' && (this.target > 0 || this.unlocking),
      act: () => this.act(),
    };
  }

  get isOpen() { return this.angle > 0.3; }

  worldPos(out) { return this.group.getWorldPosition(out); }

  promptText() {
    if (this.mode === 'entry') return this.angle > 0.05 ? null : 'The door you came through';
    if (this.target > 0 || this.unlocking) return 'It\'s open. Walk through.';
    return this.haveKey() ? 'Unlock the door' : 'Open';
  }

  act() {
    const p = this.worldPos(_w);
    if (this.mode === 'entry') {
      this.game.audio.rattle(p);
      this.game.ui.think(this.game.level.entryLockedLine || 'This is the door I came through. It\'s sealed shut now. The other door has light under it.', 4);
      return;
    }
    if (this.target > 0 || this.unlocking) return;
    if (!this.haveKey()) {
      this.game.audio.rattle(p);
      this.game.ui.think(this.game.level.lockedLine || 'Locked. There has to be a key somewhere.', 3.5);
      return;
    }
    this.unlocking = true;
    this.game.useKey();
    this.game.audio.clunk(p);
    setTimeout(() => this.game.audio.creak(this.worldPos(new THREE.Vector3()), 1.6, 0.55), 350);
    setTimeout(() => { this.target = OPEN; }, 350);
  }

  // Holding the key, or having picked up every key in this level.
  haveKey() {
    const keys = this.game.level?.keys || [];
    return this.game.hasKey || (keys.length > 0 && keys.every((k) => k.taken) && !this.game.keyUsed);
  }

  update(dt, player) {
    if (this.mode === 'entry' && this.target === 0 && this.angle < 0.01 && (this.ash ?? 0) < 1) {
      // Once shut, the door you came through greys over, like ash.
      this.ash = Math.min(1, (this.ash || 0) + dt * 0.3);
      this.slabMat.color.setRGB(1 - this.ash * 0.1, 1 - this.ash * 0.15, 1 - this.ash * 0.2).lerp(_ashC, this.ash * 0.6);
    }
    if (this.leak && this.angle > 0.3) for (const m of this.leak) m.visible = false;
    if (this.closeTimer > 0) {
      this.closeTimer -= dt;
      if (this.closeTimer <= 0) {
        this.target = 0;
        const p = this.worldPos(new THREE.Vector3());
        this.game.audio.creak(p, 1.1, 0.45);
        setTimeout(() => {
          this.game.audio.slam(this.worldPos(new THREE.Vector3()), 0.5);
          this.game.audio.clunk(this.worldPos(new THREE.Vector3()), 0.8);
        }, 1100);
      }
    }
    const speed = this.target > this.angle ? 1.6 : 4.2;
    this.angle += (this.target - this.angle) * damp(speed, dt);
    if (Math.abs(this.target - this.angle) < 0.002) this.angle = this.target;
    this.pivot.rotation.y = this.angle * this.swing;

    this.group.updateMatrixWorld();
    this.inv.copy(this.group.matrixWorld).invert();

    if (this.mode === 'exit' && this.angle > 1.2 && !this.entered && player) {
      _l.copy(player.pos).applyMatrix4(this.inv);
      if (Math.abs(_l.x) < 0.6 && Math.abs(_l.z) < 0.4 && _l.y > -1 && _l.y < 2) {
        this.entered = true;
        if (this.onEnter) this.onEnter();
      }
    }
  }

  // Keep the player out of the frame (and out of the slab while it is closed).
  collide(pos, r) {
    _l.copy(pos).applyMatrix4(this.inv);
    if (_l.y < -1 || _l.y > 2.4 || Math.abs(_l.z) > 0.11 + r || Math.abs(_l.x) > 0.71 + r) return;
    const solid = this.angle < 0.15 || this.mode === 'entry';
    const boxes = solid ? [[-0.71, 0.71]] : [[-0.71, -0.56], [0.56, 0.71]];
    // Once open, the posts barely push back so you can't snag on them walking through.
    if (!solid) r = Math.min(r, 0.12);
    for (const [x0, x1] of boxes) {
      const cx = Math.max(x0, Math.min(_l.x, x1)), cz = Math.max(-0.11, Math.min(_l.z, 0.11));
      const dx = _l.x - cx, dz = _l.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        _l.x = cx + (dx / d) * r;
        _l.z = cz + (dz / d) * r;
      } else {
        _l.z = _l.z >= 0 ? 0.11 + r : -0.11 - r;
      }
    }
    pos.copy(_l.applyMatrix4(this.group.matrixWorld));
  }

  dispose() {
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
    this.voidMat.dispose();
  }
}

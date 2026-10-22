import * as THREE from 'three';

const _w = new THREE.Vector3();

// A small old key that hums a music-box tune so it can be found by ear.
export class Key {
  constructor(game, position, up = new THREE.Vector3(0, 1, 0)) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.up = up.clone();
    this.taken = false;
    this.t = Math.random() * 10;

    const mat = new THREE.MeshStandardMaterial({ color: 0xb8963e, metalness: 0.85, roughness: 0.3, emissive: 0x3a2808 });
    this.mat = mat;
    this.spin = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14), mat);
    ring.position.x = -0.12;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 6), mat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.04;
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), mat);
    t1.position.set(0.12, -0.03, 0);
    const t2 = t1.clone();
    t2.position.set(0.08, -0.025, 0);
    this.spin.add(ring, shaft, t1, t2);
    this.spin.position.y = 0.9;
    this.group.add(this.spin);

    this.light = new THREE.PointLight(0xffd28a, 1.2, 5, 1.6);
    this.light.position.y = 1.0;
    this.group.add(this.light);

    this.emitter = game.audio.emitter('chime', position, { ref: 3, rolloff: 1.1, gain: 1.4, delay: 1 });

    this.interactable = {
      object: this.spin,
      radius: 0.35,
      prompt: () => (this.taken ? null : 'Take the key'),
      act: () => this.take(),
    };
  }

  take() {
    if (this.taken) return;
    this.taken = true;
    this.group.visible = false;
    this.emitter.stop();
    this.game.pickKey();
  }

  update(dt) {
    if (this.taken) return;
    this.t += dt;
    this.spin.rotation.y += dt * 0.8;
    this.spin.position.y = 0.9 + Math.sin(this.t * 1.3) * 0.05;
    this.light.intensity = 1 + Math.sin(this.t * 3.1) * 0.25;
    this.emitter.setPos(this.spin.getWorldPosition(_w));
  }

  dispose() {
    this.emitter.stop();
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.mat.dispose();
  }
}

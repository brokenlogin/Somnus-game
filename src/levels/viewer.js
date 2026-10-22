import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { buildChasseur, animateChasseur, disposeChasseur } from '../monsters/chasseur.js';

// Debug only (?level=9): the Chasseur on a plain backdrop. __game.level.view = 'full' | 'face' | 'side' | 'booth'.
export class ModelViewer extends BaseLevel {
  build() {
    this.cinematic = true;
    this.fadeIn = 0.3;
    this.grain = 0.03;
    this.desat = 0;
    const s = this.scene;
    s.background = new THREE.Color(0x4a4a50);
    s.add(new THREE.HemisphereLight(0xd0d4e0, 0x404040, 1.1));
    const key = new THREE.DirectionalLight(0xffe8d0, 2.2);
    key.position.set(2, 3, 3);
    const rim = new THREE.DirectionalLight(0xa0b8ff, 2.5);
    rim.position.set(-2, 2, -3);
    s.add(key, rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    this.monster = buildChasseur();
    s.add(this.monster);
    this.view = 'full';
    this.ambience = null;
  }

  update(dt) {
    const cam = this.game.camera, m = this.monster;
    if (this.view === 'booth') {
      const u = m.userData;
      u.spine.rotation.x = 0.1;
      u.head.rotation.x = 0.3;
      for (const a of u.arms) { a.shoulder.rotation.set(0, 0, a.s * 0.03); a.elbow.rotation.x = -0.05; }
    } else animateChasseur(m, dt, 0);
    const views = {
      full: [new THREE.Vector3(1.6, 1.5, 3.6), new THREE.Vector3(0, 1.25, 0)],
      side: [new THREE.Vector3(3.6, 1.4, 0.6), new THREE.Vector3(0, 1.2, 0)],
      face: [null, null],
      booth: [new THREE.Vector3(0.8, 1.4, 3.2), new THREE.Vector3(0, 1.2, 0)],
    };
    if (this.view === 'face') {
      const h = m.userData.head.getWorldPosition(new THREE.Vector3());
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(m.userData.head.getWorldQuaternion(new THREE.Quaternion()));
      cam.position.copy(h).addScaledVector(f, 0.75).add(new THREE.Vector3(0.12, 0.02, 0));
      cam.lookAt(h);
    } else {
      cam.position.copy(views[this.view][0]);
      cam.lookAt(views[this.view][1]);
    }
  }

  dispose() {
    this.scene.remove(this.monster);
    disposeChasseur(this.monster);
    super.dispose();
  }
}

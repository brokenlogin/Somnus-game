import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { Batch, M, box } from '../props/common.js';
import { tex } from '../core/textures.js';
import { mulberry32, clamp, lerp, smoothstep, sleep } from '../core/util.js';
import { buildChasseur, animateChasseur, disposeChasseur } from '../monsters/chasseur.js';

const GROUND = -400;
const CLOUD_BOTTOM = -290;
const _c1 = new THREE.Color();
const SKY = new THREE.Color(0x8fbbe6);     // daylight above the clouds
const CLOUD = new THREE.Color(0xe6ebf0);   // white inside them
const MORNING = new THREE.Color(0xb8cfd8);

// The fall from the balcony: through the clouds, into a field at sunrise.
export class FallScene extends BaseLevel {
  build() {
    this.cinematic = true;
    this.fadeIn = 0.5;
    const s = this.scene, rng = mulberry32(77);
    s.background = SKY.clone();
    s.fog = new THREE.FogExp2(SKY.getHex(), 0.004);
    this.hemi = new THREE.HemisphereLight(0xc8d4f0, 0x6a7040, 0.6);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd0a0, 0);
    this.sun.position.set(60, 40, -80);
    s.add(this.sun);

    const cloudMat = (this.cloudMat = new THREE.SpriteMaterial({ map: tex('cloud'), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    for (let i = 0; i < 260; i++) {
      const sp = new THREE.Sprite(cloudMat);
      const a = rng() * Math.PI * 2, d = 4 + rng() * 70;
      sp.position.set(Math.cos(a) * d, -60 - rng() * 230, Math.sin(a) * d);
      const sc = 25 + rng() * 60;
      sp.scale.set(sc, sc * 0.6, 1);
      s.add(sp);
    }

    // The field.
    const field = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: tex('grass', 90), color: 0xf0ffd0, roughness: 1 }));
    field.rotation.x = -Math.PI / 2;
    field.position.y = GROUND;
    s.add(field);
    const blade = new THREE.ConeGeometry(0.04, 0.6, 3);
    blade.translate(0, 0.3, 0);
    const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: 0x9ac060, roughness: 1 }), 6000);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 6000; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 30;
      m.compose(new THREE.Vector3(Math.cos(a) * d, GROUND, Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4)), new THREE.Vector3(1, 0.6 + rng(), 1));
      grass.setMatrixAt(i, m);
    }
    s.add(grass);
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 5, 4), new THREE.MeshBasicMaterial({ color: 0xe8e0c0 }), 500);
    for (let i = 0; i < 500; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 30;
      m.makeTranslation(Math.cos(a) * d, GROUND + 0.45 + rng() * 0.3, Math.sin(a) * d);
      flowers.setMatrixAt(i, m);
    }
    s.add(flowers);

    this.y = 0;
    this.v = 4;
    this.t = 0;
    this.spawn.pos.set(0, -1.6, 0);
    this.spawn.forward.set(1, 0, 0);
    this.ambience = null;
  }

  enter() {
    this.game.audio.setRoar(0.3);
  }

  update(dt) {
    const g = this.game, cam = g.camera;
    if (this.landed) return;
    this.t += dt;
    this.v = Math.min(62, this.v + 11 * dt);
    this.y -= this.v * dt;
    // Tumble slowly, staring down, then level out toward the ground.
    const k = clamp(-this.y / -GROUND, 0, 1);
    cam.position.set(Math.sin(this.t * 0.3) * 2, this.y, Math.cos(this.t * 0.25) * 2);
    // Tilt down slowly over the whole fall, so the view never snaps toward the ground.
    const pitch = lerp(-0.35, -1.05, smoothstep(0, 1, k));
    cam.rotation.set(pitch, this.t * 0.2, Math.sin(this.t * 0.6) * 0.1, 'YXZ');
    g.audio.setRoar(clamp(this.v / 55, 0.3, 1));

    _c1.copy(SKY).lerp(CLOUD, smoothstep(0.15, 0.4, k)).lerp(MORNING, smoothstep(0.62, 0.9, k));
    // The clouds thin out over about half a second as you drop out of the bottom of them.
    this.cloudMat.opacity = 0.85 * smoothstep(CLOUD_BOTTOM - 1, CLOUD_BOTTOM + 31, this.y);
    this.scene.background.copy(_c1);
    this.scene.fog.color.copy(_c1);
    this.scene.fog.density = lerp(0.004, 0.003, k);
    this.sun.intensity = 2 + smoothstep(0.4, 0.8, k) * 1.5;
    this.hemi.intensity = 1.6 + k * 1.2;
    g.post.uniforms.desat.value = lerp(0.25, 0.05, k);

    if (this.y <= GROUND + 1.7) {
      this.landed = true;
      g.audio.setRoar(0);
      g.audio.boom(0.9);
      g.ui.flash(1.6);
      g.nextLevel(0);
    }
  }

  dispose() {
    this.game.audio.setRoar(0);
    super.dispose();
  }
}

// Waking up. A normal bedroom on a normal morning.
export class WakeScene extends BaseLevel {
  build() {
    this.cinematic = true;
    this.fadeIn = 3;
    this.grain = 0.04;
    this.desat = 0.08;
    const s = this.scene, mats = this.mats;
    s.background = new THREE.Color(0xe8e4dc);
    s.add(new THREE.HemisphereLight(0xfff4e4, 0x9a8a78, 1.9));
    const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
    sun.position.set(-6, 5, 3);
    s.add(sun);
    const lamp = new THREE.PointLight(0xffe0b0, 3, 7, 1.5);
    lamp.position.set(0, 2.3, 0);
    s.add(lamp);
    this.surface = 'wood';
    this.ambience = { drone: [110, 164.8], cutoff: 200, droneVol: 0.01, hum: 60 };

    const RX = 2.2, RZ = 2.6, RH = 2.6;
    const b = new Batch();
    b.add(box(RX * 2, 0.1, RZ * 2, 2), 'wood', M(0, -0.05, 0), 0xc8a888);
    b.add(box(RX * 2, 0.1, RZ * 2, 3), 'plaster', M(0, RH + 0.05, 0), 0xffffff);
    const wall = (x, z, w, d) => {
      b.add(box(w, RH, d, 3), 'plaster', M(x, RH / 2, z), 0xe8dcc8);
      this.colliders.addCentered(x, z, w, d, -1, RH);
    };
    wall(0, -RZ - 0.1, RX * 2 + 0.4, 0.2);
    wall(0, RZ + 0.1, RX * 2 + 0.4, 0.2);
    // West wall with a window.
    wall(-RX - 0.1, -1.6, 0.2, 2.4);
    wall(-RX - 0.1, 1.6, 0.2, 2.4);
    b.add(box(0.2, 0.9, 0.8, 1), 'plaster', M(-RX - 0.1, 0.45, 0), 0xe8dcc8);
    b.add(box(0.2, 0.5, 0.8, 1), 'plaster', M(-RX - 0.1, RH - 0.25, 0), 0xe8dcc8);
    b.add(box(0.05, 1.2, 0.8), 'bulb', M(-RX - 0.15, 1.5, 0), 0xfff6e0);
    // East wall with the door.
    const DZ = 1.3;
    wall(RX + 0.1, (-RZ + DZ - 0.5) / 2, 0.2, DZ - 0.5 + RZ);
    wall(RX + 0.1, (DZ + 0.5 + RZ) / 2, 0.2, RZ - DZ - 0.5);
    b.add(box(0.2, RH - 2.1, 1), 'plaster', M(RX + 0.1, 2.1 + (RH - 2.1) / 2, DZ), 0xe8dcc8);
    for (const sz of [-1, 1]) b.add(box(0.24, 2.1, 0.06), 'paint', M(RX + 0.05, 1.05, DZ + sz * 0.5), 0xf4f0e8);
    // Bed.
    b.add(box(1.4, 0.45, 2.1, 1), 'wood', M(-1.3, 0.22, -1.5), 0x8a6a50);
    b.add(box(1.36, 0.18, 2.0, 1), 'paint', M(-1.3, 0.54, -1.5), 0x9ab0c8);
    b.add(box(0.9, 0.14, 0.45, 1), 'paint', M(-1.3, 0.68, -2.25), 0xf4f0ea);
    b.add(box(1.4, 1.0, 0.08, 1), 'wood', M(-1.3, 0.5, -2.56), 0x7a5a40);
    this.colliders.addCentered(-1.3, -1.5, 1.4, 2.1, -1, 0.65);
    // Nightstand, dresser, rug, poster.
    b.add(box(0.5, 0.55, 0.45, 1), 'wood', M(0.0, 0.27, -2.3), 0x8a6a50);
    b.add(box(0.18, 0.1, 0.08), 'paint', M(0.0, 0.6, -2.3), 0x2a2a2a);
    b.add(box(0.1, 0.03, 0.01), 'glassLit', M(0.0, 0.61, -2.255), 0xff4020);
    this.colliders.addCentered(0, -2.3, 0.5, 0.45, -1, 0.6);
    b.add(box(1.2, 0.9, 0.5, 1), 'wood', M(0.9, 0.45, RZ - 0.3), 0x7a5a40);
    this.colliders.addCentered(0.9, RZ - 0.3, 1.2, 0.5, -1, 0.9);
    b.add(box(1.8, 0.02, 1.3, 1), 'paint', M(0.2, 0.01, 0.3), 0x8a5a4a);
    b.add(box(0.7, 0.95, 0.02), 'paint', M(0.6, 1.6, -RZ + 0.01), 0x4a6a8a);
    s.add(b.build(mats));
    this.emitters.push(this.game.audio.emitter('clock', new THREE.Vector3(0, 0.6, -2.3), { ref: 1, gain: 0.6 }));

    // The bedroom door.
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.6 });
    this.hinge = new THREE.Group();
    this.hinge.position.set(RX + 0.08, 0, DZ - 0.47);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.09, 0.94), doorMat);
    slab.position.set(0, 1.045, 0.47);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0xb8a070, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(-0.05, 1.0, 0.82);
    this.hinge.add(slab, knob);
    s.add(this.hinge);
    this.doorCollider = this.colliders.addCentered(RX + 0.1, DZ, 0.2, 1, -1, 2.1);
    this.interactables.push({
      object: this.hinge,
      prompt: () => (this.ending ? null : 'Open the door'),
      act: () => this.openDoor(),
    });

    // A dark hallway... and what waits in it.
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 4), new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide }));
    hall.position.set(RX + 1.7, 1.3, DZ);
    s.add(hall);
    this.monster = buildChasseur();
    // Stooped so its face waits right at eye level, just behind the door.
    this.monster.scale.setScalar(0.9);
    this.monster.position.set(RX + 1.45, -0.15, DZ);
    this.monster.visible = false; // only there once the door opens; never through it
    this.monster.rotation.y = -Math.PI / 2;
    this.monster.userData.spine.rotation.x = 1.05;
    this.monster.userData.head.rotation.x = -1.0;
    s.add(this.monster);
    this.doorPos = new THREE.Vector3(RX, 1.4, DZ);

    this.spawn.pos.set(-0.3, 0, -0.7);
    this.spawn.forward.set(1, 0, 0.4);
    this.t = 0;
  }

  enter() {
    this.game.audio.birds = true;
  }

  async openDoor() {
    if (this.ending) return;
    this.ending = true;
    const g = this.game, pl = g.player;
    g.ui.clearThoughts();
    pl.enabled = false;
    pl.lookEnabled = false;
    pl.forward.copy(this.doorPos).sub(pl.pos).setY(0).normalize();
    pl.pitch = 0.05;
    g.audio.creak(this.doorPos, 0.5, 0.4);
    this.opening = true;
    this.monster.visible = true;
    await sleep(0.2);
    g.audio.birds = false;
    g.audio.setAmbience(null);
    await sleep(0.05);
    // It lunges through the doorway, and everything cuts to black.
    g.lunge.start(this.monster, { hold: 3, loud: 1.1 });
    pl.shake = 2;
    await sleep(0.22);
    g.endGame('you never woke up.');
  }

  blurSpots() {
    return this.opening ? [{ pos: this.doorPos, radius: 1.5, strength: 0.55 }] : [];
  }

  update(dt) {
    super.update(dt);
    const g = this.game, pl = g.player, cam = g.camera;
    this.t += dt;
    if (g.state === 'cinematic') {
      // Lying in bed, staring at the ceiling, then sitting up.
      const k = smoothstep(1.5, 4.5, this.t);
      cam.position.set(lerp(-1.3, -0.3, k), lerp(0.85, 1.62, k), lerp(-2.0, -0.7, k));
      cam.rotation.set(lerp(1.3, 0, k), lerp(-Math.PI / 2 + 0.3, Math.atan2(-1, -0.4), k), 0, 'YXZ');
      if (this.t > 4.6) {
        g.state = 'play';
        g.ui.think('...a dream. It was only a dream.', 3.5);
        g.ui.think('I\'m awake. I\'m awake.', 3);
        g.ui.think('I need some air.', 3);
      }
    }
    if (this.opening) this.hinge.rotation.y = Math.min(1.9, this.hinge.rotation.y + dt * 9);
    if (!g.lunge.active) animateChasseur(this.monster, dt, 0);
  }

  dispose() {
    this.game.audio.birds = false;
    this.scene.remove(this.monster);
    disposeChasseur(this.monster);
    super.dispose();
  }
}

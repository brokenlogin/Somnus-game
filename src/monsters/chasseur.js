import * as THREE from 'three';
import { tex } from '../core/textures.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// A tapered limb segment with its pivot at the top, hanging down.
function seg(len, r0, r1, mat, sides = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, len, sides);
  g.translate(0, -len / 2, 0);
  return new THREE.Mesh(g, mat);
}

function ball(r, mat) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
}

// Sculpt a unit-sphere point into a long skull: narrow jutting jaw, sunken eye sockets, heavy brow.
const EYE_DIRS = [-1, 1].map((s) => new THREE.Vector3(s * 0.36, 0.16, 0.92).normalize());
const HEAD_R = 0.16;
const MOUTH_Y = -0.4;   // unit-sphere height of the grin
const MOUTH_H = 0.12;   // half-height of the mouth recess
const MOUTH_A = 0.95;   // half-width of the grin, as an angle around the head
function skullShape(x, y, z, out) {
  let X = x * 0.86, Y = y * 1.3, Z = z;
  // A long skull that sweeps back, with sunken temples and sharp cheekbones.
  if (z < 0) { Z *= 1 + 0.35 * -z * Math.max(0, y + 0.3); Y += z * 0.08; }
  if (y > 0.1 && y < 0.6) X *= 1 - 0.1 * Math.sin(((y - 0.1) / 0.5) * Math.PI) * Math.min(1, Math.abs(x) * 1.5);
  if (y > -0.25 && y < 0.15 && z > 0.2) X *= 1 + 0.1 * Math.sin(((y + 0.25) / 0.4) * Math.PI) * z;
  if (y < 0) {
    const k = -y;
    X *= 1 - k * 0.42;
    Y -= k * k * 0.4;
    Z += k * 0.22 * Math.max(0, z);
  }
  // Hollow cheeks under the cheekbones.
  if (y < 0.05 && y > -0.65 && z > 0) X *= 1 - 0.1 * z * Math.sin(((y + 0.65) / 0.7) * Math.PI);
  let f = 1;
  for (const e of EYE_DIRS) {
    const d = x * e.x + y * e.y + z * e.z;
    if (d > 0.88) f *= 1 - 0.36 * Math.sin(((d - 0.88) / 0.12) * (Math.PI / 2));
  }
  // The mouth: a deep recess the teeth sit in.
  const a = Math.atan2(x, z), dy = Math.abs(y - MOUTH_Y);
  if (z > 0 && Math.abs(a) < MOUTH_A && dy < MOUTH_H) {
    f *= 1 - 0.16 * (1 - (dy / MOUTH_H) ** 2) * (1 - (Math.abs(a) / MOUTH_A) ** 4);
  }
  X *= f; Y *= f; Z *= f;
  if (y > 0.24 && y < 0.46 && z > 0.55) Z += 0.06 * Math.sin(((y - 0.24) / 0.22) * Math.PI);
  return out.set(X * HEAD_R, Y * HEAD_R, Z * HEAD_R * 0.92);
}

function buildHead(skin, eyeMat, toothMat) {
  const head = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 40, 30);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    skullShape(pos.getX(i), pos.getY(i), pos.getZ(i), _v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  const skull = new THREE.Mesh(geo, skin);
  skull.position.set(0, 0.07, 0.04);
  head.add(skull);

  // Eyes: pinpricks of white at the bottom of deep sockets, with a faint glow.
  const glowMat = new THREE.SpriteMaterial({ map: tex('glow'), color: 0xdfe6ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const e of EYE_DIRS) {
    skullShape(e.x, e.y, e.z, _v);
    const eye = ball(0.012, eyeMat);
    eye.scale.set(1.5, 0.75, 0.6);
    eye.position.copy(_v).add(skull.position).addScaledVector(e, 0.004);
    eye.lookAt(eye.position.clone().add(e));
    head.add(eye);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(0.07);
    glow.position.copy(eye.position).addScaledVector(e, 0.01);
    head.add(glow);
  }

  // A grin far too wide for the face: upper teeth on the skull, lower teeth on a hinged jaw.
  // Needle teeth rooted in the top and bottom edges of the recess.
  const toothGeo = new THREE.ConeGeometry(0.0055, 0.028, 4);
  const at = (a, y, out) => {
    const r = Math.sqrt(1 - y * y);
    _w.set(Math.sin(a) * r, y, Math.cos(a) * r);
    return skullShape(_w.x, _w.y, _w.z, out).add(skull.position);
  };
  const jaw = new THREE.Group();
  at(0, MOUTH_Y, jaw.position);
  jaw.position.z -= 0.09;
  head.add(jaw);
  for (let n = 0; n < 17; n++) {
    const a = (-0.82 + (n / 16) * 1.64) * MOUTH_A;
    const len = 0.75 + Math.abs(Math.sin(n * 2.3)) * 0.7;
    const up = new THREE.Mesh(toothGeo, toothMat);
    up.rotation.x = Math.PI;
    at(a, MOUTH_Y + MOUTH_H * 0.8, up.position);
    up.position.y -= 0.012 * len;
    up.scale.y = len;
    head.add(up);
    if (n === 0 || n === 16) continue;
    const lo = new THREE.Mesh(toothGeo, toothMat);
    at(a + 0.03, MOUTH_Y - MOUTH_H * 0.8, lo.position);
    lo.position.y += 0.011 * len;
    lo.position.sub(jaw.position);
    lo.scale.y = len * 0.85;
    jaw.add(lo);
  }
  return { head, jaw, skull, glowMat };
}

const CROUCH = 0.25;
const HIP_Y = 0.56 * Math.cos(CROUCH) + 0.55 * Math.cos(CROUCH) + 0.04;

// The hunter: emaciated, hunched, limbs far too long, a narrow skull with a white grin.
export function buildChasseur() {
  // Pitch black and matte: lights only ever show a faint grey along its shape, never a white flare.
  const skin = new THREE.MeshLambertMaterial({ color: 0x0b0b0c });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const toothMat = new THREE.MeshBasicMaterial({ color: 0xcfc8b4 });
  const g = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  g.add(hips);
  const pelvis = ball(0.13, skin);
  pelvis.scale.set(1.25, 0.6, 0.75);
  hips.add(pelvis);

  const spine = new THREE.Group();
  spine.rotation.x = 0.45; // hunched forward
  hips.add(spine);
  // Torso: pinched waist, a ribcage that flares out, narrow sloping shoulders.
  const profile = [[0.02, -0.02], [0.09, 0], [0.1, 0.1], [0.08, 0.28], [0.12, 0.42], [0.17, 0.58], [0.19, 0.72], [0.19, 0.84], [0.16, 0.95], [0.1, 1.02], [0.04, 1.06]];
  const rAt = (y) => {
    for (let i = 1; i < profile.length; i++) {
      if (y <= profile[i][1]) {
        const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
        return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
    }
    return 0.04;
  };
  const torso = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18), skin);
  torso.scale.z = 0.62;
  spine.add(torso);
  for (let i = 0; i < 7; i++) {
    const y = 0.44 + i * 0.07, r = rAt(y) + 0.008;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.015, 5, 16, Math.PI * 0.9), skin);
    rib.rotation.set(Math.PI / 2, 0.05 * i, 0.16 * Math.PI);
    rib.scale.y = 0.62;
    rib.position.y = y;
    spine.add(rib);
  }
  for (let y = 0.12; y < 1.0; y += 0.1) {
    const v = ball(0.026, skin);
    v.position.set(0, y, -rAt(y) * 0.62 + 0.004);
    spine.add(v);
  }
  // Shoulders slope down from the base of the neck instead of a straight bar.
  for (const s of [-1, 1]) {
    const trap = seg(0.27, 0.05, 0.035, skin);
    trap.position.set(0, 1.04, 0);
    trap.rotation.z = s * 1.2;
    spine.add(trap);
  }

  const neck = new THREE.Group();
  neck.position.set(0, 1.03, 0.02);
  spine.add(neck);
  const neckGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.32, 8);
  neckGeo.translate(0, 0.16, 0);
  neck.add(new THREE.Mesh(neckGeo, skin));
  const { head, jaw, skull, glowMat } = buildHead(skin, eyeMat, toothMat);
  head.position.y = 0.3;
  head.rotation.x = -0.5;
  neck.add(head);

  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.25, 0.95, 0);
    spine.add(shoulder);
    shoulder.add(ball(0.042, skin));
    shoulder.add(seg(0.78, 0.045, 0.03, skin));
    const elbow = new THREE.Group();
    elbow.position.y = -0.78;
    shoulder.add(elbow);
    elbow.add(ball(0.034, skin));
    elbow.add(seg(0.82, 0.032, 0.02, skin));
    const wrist = new THREE.Group();
    wrist.position.y = -0.82;
    elbow.add(wrist);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.022), skin);
    palm.position.y = -0.045;
    wrist.add(palm);
    for (let f = 0; f < 4; f++) {
      const f1 = seg(0.13, 0.010, 0.007, skin, 5);
      f1.position.set((f - 1.5) * 0.017, -0.085, 0);
      f1.rotation.set(0.25, 0, (f - 1.5) * 0.06);
      const f2 = seg(0.12, 0.007, 0.002, skin, 5);
      f2.position.y = -0.13;
      f2.rotation.x = 0.55;
      f1.add(f2);
      wrist.add(f1);
    }
    arms.push({ shoulder, elbow, s });

    const hip = new THREE.Group();
    hip.position.set(s * 0.11, -0.02, 0);
    hips.add(hip);
    hip.add(seg(0.56, 0.068, 0.04, skin));
    const knee = new THREE.Group();
    knee.position.y = -0.56;
    hip.add(knee);
    knee.add(ball(0.045, skin));
    knee.add(seg(0.55, 0.045, 0.028, skin));
    const ankle = new THREE.Group();
    ankle.position.y = -0.55;
    knee.add(ankle);
    const foot = seg(0.3, 0.034, 0.01, skin, 6);
    foot.rotation.x = -Math.PI / 2 + 0.15;
    foot.position.y = -0.02;
    ankle.add(foot);
    legs.push({ hip, knee, ankle, s });
  }
  g.userData = { hips, spine, neck, head, jaw, skull, arms, legs, mats: [skin, eyeMat, toothMat, glowMat], t: 0 };
  animateChasseur(g, 0, 0); // settle into its crouch
  return g;
}

// speed: 0 idle .. 1 full run.
export function animateChasseur(g, dt, speed) {
  const u = g.userData;
  u.t += dt * (2 + speed * 7);
  const t = u.t;
  for (const a of u.arms) {
    a.shoulder.rotation.x = Math.sin(t + (a.s > 0 ? 0 : Math.PI)) * 0.7 * speed - 0.25;
    a.shoulder.rotation.z = a.s * (0.15 + Math.sin(t * 0.5) * 0.05);
    a.elbow.rotation.x = -0.4 - speed * 0.4;
  }
  // A predator's crouch: knees bent, feet flat.
  for (const l of u.legs) {
    l.hip.rotation.x = -CROUCH + Math.sin(t + (l.s > 0 ? Math.PI : 0)) * 0.6 * speed;
    l.knee.rotation.x = 2 * CROUCH + Math.max(0, Math.sin(t + (l.s > 0 ? Math.PI : 0) + 1)) * 0.9 * speed;
    l.ankle.rotation.x = -(l.hip.rotation.x + l.knee.rotation.x);
  }
  u.hips.position.y = HIP_Y + Math.abs(Math.sin(t)) * 0.06 * speed;
  u.jaw.rotation.x = 0.08 + Math.sin(t * 0.7) * 0.04 + speed * 0.15;
  idleTwitch(g, dt, t);
}

// Only the head moves: jerky, unnatural twitches (for when it is standing still somewhere).
export function idleTwitch(g, dt, t = (g.userData.t += dt)) {
  const u = g.userData;
  if (Math.random() < dt * 3) u.twitch = (Math.random() - 0.5) * 0.9;
  u.twitch = (u.twitch || 0) * 0.9;
  u.head.rotation.z = u.twitch + Math.sin(t * 0.37) * 0.15;
}

export function disposeChasseur(g) {
  g.traverse((o) => o.geometry && o.geometry.dispose());
  g.userData.mats.forEach((m) => m.dispose());
}

const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

// The jumpscare: the Chasseur itself lunges at your face, arms up, jaw open, then (optionally)
// drops back to stand at `settle`. The camera is held on its face while it happens.
export class Lunge {
  constructor(game) {
    this.game = game;
    this.active = false;
  }

  start(mon, { hold = 0.55, settle = null, onDone = null, loud = 1 } = {}) {
    const g = this.game, cam = g.camera, pl = g.player, u = mon.userData;
    this.mon = mon;
    this.t = 0;
    this.attack = 0.16;
    this.hold = hold;
    this.back = settle ? 0.4 : 0;
    this.settle = settle && settle.clone();
    this.onDone = onDone;
    this.active = true;
    this.from = mon.position.clone();
    this.spineRest = u.spine.rotation.x;
    this.headRest = u.head.rotation.x;
    pl.enabled = false;
    pl.lookEnabled = false;

    const camPos = cam.getWorldPosition(new THREE.Vector3());
    mon.rotation.y = Math.atan2(camPos.x - this.from.x, camPos.z - this.from.z);
    this.pose(0);
    mon.updateMatrixWorld(true);
    const headOffset = u.head.getWorldPosition(new THREE.Vector3()).sub(mon.position);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const target = camPos.clone().addScaledVector(look, 0.5);
    this.to = target.sub(headOffset);

    g.audio.sting(loud);
    g.audio.growl(this.from, 1);
    g.ui.flash(0.3);
    pl.shake = 1.4;
  }

  pose(k) {
    const u = this.mon.userData;
    for (const a of u.arms) {
      a.shoulder.rotation.x = -1.9;
      a.shoulder.rotation.z = a.s * 0.4;
      a.elbow.rotation.x = -0.45;
    }
    u.spine.rotation.x = 0.2;
    u.head.rotation.x = -0.2;
    u.jaw.rotation.x = 0.55 + Math.sin(k * 60) * 0.1;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game, mon = this.mon, u = mon.userData, pl = g.player;
    this.t += dt;
    const t = this.t, a = this.attack, h = a + this.hold;
    if (t < a) {
      mon.position.lerpVectors(this.from, this.to, ease(t / a));
      this.pose(t);
    } else if (t < h) {
      mon.position.copy(this.to);
      mon.position.x += (Math.random() - 0.5) * 0.03;
      mon.position.y += (Math.random() - 0.5) * 0.03;
      u.head.rotation.z = (Math.random() - 0.5) * 0.5;
      this.pose(t);
    } else if (t < h + this.back) {
      const k = ease((t - h) / this.back);
      mon.position.lerpVectors(this.to, this.settle, k);
      for (const arm of u.arms) {
        arm.shoulder.rotation.x = -1.9 + 1.65 * k;
        arm.shoulder.rotation.z = arm.s * (0.4 - 0.25 * k);
      }
      u.jaw.rotation.x = 0.55 - 0.4 * k;
      u.spine.rotation.x = 0.2 + (this.spineRest - 0.2) * k;
      u.head.rotation.x = -0.2 + (this.headRest + 0.2) * k;
    } else {
      this.finish();
      return;
    }
    // Keep the camera on its face.
    const eye = pl.eyePosition(_w);
    const dir = u.head.getWorldPosition(_v).sub(eye);
    const len = dir.length();
    if (len > 0.01) {
      pl.forward.set(dir.x, 0, dir.z).normalize();
      pl.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y / len)));
    }
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    const u = this.mon.userData;
    u.spine.rotation.x = this.spineRest;
    u.head.rotation.x = this.headRest;
    if (this.settle) this.mon.position.copy(this.settle);
    this.game.player.lookEnabled = true;
    const done = this.onDone;
    this.onDone = null;
    if (done) done();
  }

  cancel() {
    if (!this.active) return;
    this.onDone = null;
    this.finish();
  }
}

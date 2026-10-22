import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { Batch, M, box, house, streetlamp, mailbox } from '../props/common.js';
import { tex } from '../core/textures.js';
import { mulberry32, clamp } from '../core/util.js';
import { Voyer } from '../monsters/voyer.js';
import { Disciple } from '../monsters/disciple.js';

const R0 = 12;    // railing at the edge of the central shaft
const R1 = 22;    // outer edge of the street (house porches)
const RW = 34;    // tower wall
const P = 14;     // rise per full turn
const TURNS = 12;
const THMAX = TURNS * Math.PI * 2;
const C = P / (Math.PI * 2); // height per radian
const STEP = 0.06;           // radians per stair step
const TURN = Math.PI * 2;
// You come out of a house halfway up. The key is further up; the way out is further down.
const START_T = 6 * TURN;
const KEY_T = 7 * TURN;
const EXIT_T = 4.9 * TURN;
const DOOR_R = 22.46;        // just in front of a house front (and its foundation lip)

const _p = new THREE.Vector3();

// III. A hollow tower with a spiral staircase street winding up its inside, lined with houses.
export class Level3Spiral extends BaseLevel {
  build() {
    const s = this.scene, mats = this.mats, rng = mulberry32(333);
    s.background = new THREE.Color(0x232831);
    s.fog = new THREE.FogExp2(0x232831, 0.03);
    s.add(new THREE.HemisphereLight(0x9aa6b8, 0x2a2420, 1.1));
    const moon = new THREE.DirectionalLight(0x9fb0c8, 0.6);
    moon.position.set(5, 100, 3);
    s.add(moon);
    this.surface = 'stone';
    this.ambience = { drone: [49, 73.4, 98, 146.8], cutoff: 320, droneVol: 0.06, wind: 0.07, windFreq: 300, hum: 50 };

    s.add(this.buildStairs());

    // Tower wall.
    const wallH = THMAX * C + 60;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(RW, RW, wallH, 72, 1, true),
      new THREE.MeshStandardMaterial({ map: tex('brick', 40, wallH / 6), side: THREE.BackSide, roughness: 1, color: 0x8a8580 }),
    );
    wall.position.y = wallH / 2 - 30;
    s.add(wall);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(RW, 48), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -30;
    s.add(floor);

    const b = new Batch();
    // Railing posts and rail along the shaft.
    let prev = null;
    for (let th = 0; th <= THMAX + 1e-6; th += STEP * 2) {
      const x = Math.cos(th) * (R0 + 0.15), z = Math.sin(th) * (R0 + 0.15), y = this.ground(th);
      b.add(box(0.07, 1.05, 0.07, 1), 'metal', M(x, y + 0.52, z), 0x3a3a3a);
      const top = new THREE.Vector3(x, y + 1.05, z);
      if (prev) {
        const len = prev.distanceTo(top);
        const m = new THREE.Matrix4().lookAt(prev, top, new THREE.Vector3(0, 1, 0));
        m.setPosition(prev.clone().add(top).multiplyScalar(0.5));
        b.add(box(0.07, 0.07, len, 1), 'metal', m, 0x3a3a3a);
      }
      prev = top;
    }

    // Lamps on the shaft side.
    const lamps = [];
    for (let th = 0.4; th < THMAX; th += 0.75) {
      const x = Math.cos(th) * (R0 + 0.6), z = Math.sin(th) * (R0 + 0.6);
      lamps.push(streetlamp(b, M(x, this.ground(th), z, Math.atan2(Math.cos(th), Math.sin(th))), 3.8));
    }

    // Houses against the tower wall, all facing the shaft.
    this.houses = [];
    this.houseBoxes = [];
    const up = new THREE.Vector3(0, 1, 0);
    let th = 0.9;
    while (th < THMAX - 0.9) {
      const w = 7 + rng() * 2.5, d = 7 + rng() * 2;
      const half = w / 2 / 22.6;
      const tc = th + half;
      const r = 22.6 + d / 2, y = this.ground(tc);
      const ry = Math.atan2(-Math.cos(tc), -Math.sin(tc));
      const isEntry = !this.entryT && th + 2 * half > START_T;
      const isExit = !this.exitT && th + 2 * half > EXIT_T;
      if (isEntry) this.entryT = tc;
      if (isExit) this.exitT = tc;
      const h = rng() < 0.5 ? 6 : 3.4;
      house(b, M(Math.cos(tc) * r, y, Math.sin(tc) * r, ry), {
        w, d, h, rng, below: 3,
        litChance: isExit ? 1 : 0.18, door: isEntry || isExit ? false : undefined,
      });
      if (rng() < 0.5) mailbox(b, M(Math.cos(tc - half * 0.6) * 21.4, this.ground(tc - half * 0.6), Math.sin(tc - half * 0.6) * 21.4, ry));
      this.houses.push(tc);
      // The house as an oriented box, for line of sight and for Voyer to hide behind.
      const H = {
        x: Math.cos(tc) * r, z: Math.sin(tc) * r, hw: w / 2, hd: d / 2,
        xa: new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)), za: new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)),
        y0: y - 3, y1: y + h + Math.min(w, d) * 0.38, rad: Math.hypot(w, d) / 2,
      };
      this.houseBoxes.push(H);
      // Voyer peeks around the two front corners.
      const center = new THREE.Vector3(H.x, y, H.z);
      for (const sx of [-1, 1]) {
        const corner = center.clone().addScaledVector(H.xa, sx * H.hw).addScaledVector(H.za, H.hd);
        this.voyerSpots.push({ corner, center, up, house: H });
      }
      th += 2 * half + (1.5 + rng() * 2.5) / 22.6;
    }

    // End walls at the bottom and top of the stair.
    for (const [t0, y0] of [[0, -12], [THMAX, THMAX * C - 0.5]]) {
      const len = RW - R0 + 1, cx = Math.cos(t0) * (R0 + RW) / 2, cz = Math.sin(t0) * (R0 + RW) / 2;
      b.add(box(len, 14, 0.8, 3), 'brick', M(cx, y0 + 7 + (t0 ? 0 : 5.5), cz, -t0), 0x8a8580);
    }
    s.add(b.build(mats));
    this.addLightPool(lamps, { count: 6, intensity: 16, distance: 18, halo: 2.6, color: 0xffcf8a });

    const at = (t, r) => new THREE.Vector3(Math.cos(t) * r, this.ground(t), Math.sin(t) * r);
    const facing = (t) => Math.atan2(-Math.cos(t), -Math.sin(t));
    this.addEntryDoor(at(this.entryT, DOOR_R), facing(this.entryT));
    this.addExitDoor(at(this.exitT, DOOR_R), facing(this.exitT));
    // Key on the doorstep of a house one turn up.
    const kt = this.houses.reduce((a, c) => (Math.abs(c - KEY_T) < Math.abs(a - KEY_T) ? c : a));
    this.addKey(at(kt, 21.2));

    this.monsters.push(new Voyer(this.game, this, { firstDelay: 16, minDist: 16, maxDist: 55 }));
    this.monsters.push(new Disciple(this.game, this, { firstDelay: 35, minBack: 18, maxBack: 30, respawn: [15, 35] }));
    this.voyerLine = 'Across the shaft. Something was standing at the rail.';
    this.discipleLine = 'Footsteps on the stairs below me. Matching mine.';
    this.lockedLine = 'Locked. The key must be somewhere on these stairs.';
    this.keyLine = 'A key, left on a doorstep. Now the door with light under it.';
    this.events = [
      () => this.game.audio.slam(this.aroundPlayer(25), 0.5),
      () => this.bounceBall(),
      () => this.game.audio.whisper(this.aroundPlayer(4, true), 0.3),
      () => this.game.audio.creak(this.aroundPlayer(12), 1.5, 0.4),
    ];
    this.saidHalf = false;
  }

  ground(th) { return clamp(th, 0, THMAX) * C; }

  // Find the unwrapped angle nearest the given height.
  unwrap(x, z, y) {
    const t = Math.atan2(z, x);
    const k = Math.round((y / C - t) / (Math.PI * 2));
    return t + k * Math.PI * 2;
  }

  buildStairs() {
    const pos = [], uv = [];
    const quad = (a, b, c, d, ua, va, ub, vb) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
    };
    const pt = (t, r, y) => [Math.cos(t) * r, y, Math.sin(t) * r];
    const n = Math.ceil(THMAX / STEP);
    let lastH = -0.6;
    for (let k = 0; k < n; k++) {
      const ta = k * STEP, tb = (k + 1) * STEP, h = (k + 0.5) * STEP * C;
      // Tread.
      quad(pt(ta, R0, h), pt(ta, RW, h), pt(tb, RW, h), pt(tb, R0, h), 0, 0, (RW - R0) / 2, STEP * 8);
      // Riser.
      quad(pt(ta, RW, lastH), pt(ta, R0, lastH), pt(ta, R0, h), pt(ta, RW, h), 0, 0, (RW - R0) / 2, 0.15);
      // Underside and inner edge.
      const ua = ta * C - 1, ub = tb * C - 1;
      quad(pt(ta, R0, ua), pt(tb, R0, ub), pt(tb, RW, ub), pt(ta, RW, ua), 0, 0, STEP * 8, (RW - R0) / 2);
      quad(pt(ta, R0, ua), pt(ta, R0, h), pt(tb, R0, h), pt(tb, R0, ub), 0, 0, STEP * 8, 0.5);
      lastH = h;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex('stone'), roughness: 0.95, side: THREE.DoubleSide, color: 0x9a968e }));
  }

  move(player, delta, dt) {
    const p = player.pos;
    const len = Math.hypot(delta.x, delta.z), steps = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 0; i < steps; i++) {
      p.x += delta.x / steps;
      p.z += delta.z / steps;
      let r = Math.hypot(p.x, p.z);
      let t = this.unwrap(p.x, p.z, p.y);
      const tc = clamp(t, 0.12, THMAX - 0.12);
      const rc = clamp(r, R0 + 0.55, 22.6 - 0.36); // right up to the house fronts
      if (tc !== t || rc !== r) {
        p.x = Math.cos(tc) * rc;
        p.z = Math.sin(tc) * rc;
      }
      for (const d of this.doors) d.collide(p, player.radius);
    }
    const g = this.ground(this.unwrap(p.x, p.z, p.y));
    player.vUp -= 18 * dt;
    let ny = p.y + player.vUp * dt;
    const was = player.grounded;
    player.grounded = false;
    if (ny <= g && p.y >= g - 0.7) { ny = g; player.vUp = 0; player.grounded = true; }
    else if (was && player.vUp <= 0 && p.y - g < 0.5) { ny = g; player.vUp = 0; player.grounded = true; }
    p.y = ny;
  }

  lineOfSight(a, b) {
    for (let i = 1; i < 18; i++) {
      _p.lerpVectors(a, b, i / 18);
      const r = Math.hypot(_p.x, _p.z);
      if (r < R0 - 0.2) continue;
      const t = Math.atan2(_p.z, _p.x);
      for (let k = -1; k <= TURNS + 1; k++) {
        const tu = t + k * Math.PI * 2;
        if (tu < 0 || tu > THMAX) continue;
        const h = tu * C;
        if (_p.y < h + 0.02 && _p.y > h - 1.0) return false;
      }
    }
    return !this.houseHit(a, b);
  }

  // Does the segment a→b pass through any house?
  houseHit(a, b) {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    for (const H of this.houseBoxes) {
      if (H.x < minX - H.rad || H.x > maxX + H.rad || H.z < minZ - H.rad || H.z > maxZ + H.rad) continue;
      if (maxY < H.y0 || minY > H.y1) continue;
      const ax = (a.x - H.x) * H.xa.x + (a.z - H.z) * H.xa.z, az = (a.x - H.x) * H.za.x + (a.z - H.z) * H.za.z;
      const bx = (b.x - H.x) * H.xa.x + (b.z - H.z) * H.xa.z, bz = (b.x - H.x) * H.za.x + (b.z - H.z) * H.za.z;
      let t0 = 0, t1 = 1, hit = true;
      for (const [p, d, lim] of [[ax, bx - ax, H.hw], [az, bz - az, H.hd]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(p) > lim) { hit = false; break; } continue; }
        let ta = (-lim - p) / d, tb = (lim - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (!hit) continue;
      const y = a.y + (b.y - a.y) * (t0 + t1) / 2;
      if (y > H.y0 && y < H.y1) return true;
    }
    return false;
  }

  insideHouse(p, pad = 0) {
    for (const H of this.houseBoxes) {
      const lx = (p.x - H.x) * H.xa.x + (p.z - H.z) * H.xa.z, lz = (p.x - H.x) * H.za.x + (p.z - H.z) * H.za.z;
      if (Math.abs(lx) < H.hw + pad && Math.abs(lz) < H.hd + pad && p.y > H.y0 - 1 && p.y < H.y1) return true;
    }
    return false;
  }

  // Stand just behind a house corner as seen from the player, with the head peeking out.
  peekPosition(spot, playerPos) {
    const H = spot.house, c = spot.corner;
    const dx = c.x - playerPos.x, dz = c.z - playerPos.z, dist = Math.hypot(dx, dz);
    if (dist < 2) return null;
    const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const side = Math.sign(perp.x * (spot.center.x - c.x) + perp.z * (spot.center.z - c.z)) || 1;
    const pos = c.clone().addScaledVector(dir, 0.75).addScaledVector(perp, side * 0.25);
    // Push it out of the house it hides behind.
    const lx = (pos.x - H.x) * H.xa.x + (pos.z - H.z) * H.xa.z, lz = (pos.x - H.x) * H.za.x + (pos.z - H.z) * H.za.z;
    const ex = H.hw + 0.3, ez = H.hd + 0.3;
    if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
      if (ex - Math.abs(lx) < ez - Math.abs(lz)) pos.addScaledVector(H.xa, Math.sign(lx) * (ex - Math.abs(lx)));
      else pos.addScaledVector(H.za, Math.sign(lz) * (ez - Math.abs(lz)));
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r < R0 + 0.8 || r > RW - 0.6) return null;
    pos.y = this.ground(this.unwrap(pos.x, pos.z, c.y));
    if (this.insideHouse(pos, 0.2)) return null;
    return { pos, visibleSide: perp.multiplyScalar(-side) };
  }

  bounceBall() {
    const a = this.game.audio, pl = this.game.player;
    const th = this.unwrap(pl.pos.x, pl.pos.z, pl.pos.y) + 2.2;
    let t = 0, gap = 0.5;
    for (let i = 0; i < 10; i++) {
      const tt = th - i * 0.12, pos = new THREE.Vector3(Math.cos(tt) * 17, this.ground(tt), Math.sin(tt) * 17);
      setTimeout(() => a.heavyStep(pos, 0.25), t * 1000);
      t += gap;
      gap *= 0.93;
    }
  }

  enter() {
    const ui = this.game.ui;
    ui.think('Stairs. Houses. Up and down, as far as I can see.', 3.5);
    ui.think('Up... or down?', 3);
  }

  update(dt) {
    super.update(dt);
    const pl = this.game.player;
    if (!this.saidHalf && Math.abs(this.unwrap(pl.pos.x, pl.pos.z, pl.pos.y) - START_T) > 1.5 * TURN) {
      this.saidHalf = true;
      this.game.ui.think('My legs ache. How long have I been on these stairs?', 4);
    }
  }
}

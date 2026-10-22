import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { flatMove } from '../core/collision.js';
import { Batch, M, box, house, streetlamp, deadTree, fence, mailbox, bench } from '../props/common.js';
import { tex } from '../core/textures.js';
import { mulberry32, rand } from '../core/util.js';
import { Voyer } from '../monsters/voyer.js';

const NB = 5;          // blocks per side
const T = NB * 48;    // tile size: walking past one edge brings you back on the other
const H = T / 2;
const ROADS = Array.from({ length: NB }, (_, i) => -T / 2 + i * 48);
const BLOCKS = ROADS.map((r) => r + 24);

// I. A foggy suburb that repeats forever in every direction.
export class Level1Town extends BaseLevel {
  build() {
    const s = this.scene, rng = mulberry32(1337), mats = this.mats;
    s.background = new THREE.Color(0x8e928f);
    s.fog = new THREE.FogExp2(0x8e928f, 0.03);
    s.add(new THREE.HemisphereLight(0xc4c8cc, 0x3a3830, 1.1));
    const sun = new THREE.DirectionalLight(0xd0d4d8, 0.35);
    sun.position.set(30, 60, 10);
    s.add(sun);
    this.surface = 'asphalt';
    this.ambience = { drone: [55, 82.4, 110], cutoff: 380, droneVol: 0.06, wind: 0.12, windFreq: 420 };

    const b = new Batch();
    const ground = new THREE.PlaneGeometry(T, T);
    ground.rotateX(-Math.PI / 2);
    b.add(ground, 'deadgrass');

    // Roads and sidewalks, clipped to the tile so neighbouring tiles butt together.
    const strip = (x0, x1, z0, z1, y, mat, color = 0xffffff) => {
      x0 = Math.max(x0, -H); x1 = Math.min(x1, H); z0 = Math.max(z0, -H); z1 = Math.min(z1, H);
      if (x1 <= x0 || z1 <= z0) return;
      const g = box(x1 - x0, 0.06, z1 - z0, mat === 'asphalt' ? 6 : 2);
      b.add(g, mat, M((x0 + x1) / 2, y, (z0 + z1) / 2), color);
    };
    for (const r of ROADS) {
      for (const c of r === -H ? [-H, H] : [r]) {
        strip(-H, H, c - 4.5, c + 4.5, 0.02, 'asphalt');
        strip(c - 4.5, c + 4.5, -H, H, 0.025, 'asphalt');
        // Faded centre dashes.
        for (let k = -H + 2; k < H; k += 6) {
          if (Math.abs(((k - c) % 48 + 48) % 48) < 6) continue;
          strip(k, k + 2.5, c - 0.08, c + 0.08, 0.055, 'paint', 0x8a7a40);
          strip(c - 0.08, c + 0.08, k, k + 2.5, 0.056, 'paint', 0x8a7a40);
        }
      }
    }

    // A sidewalk ring around every block.
    for (const cx of BLOCKS) for (const cz of BLOCKS) {
      for (const sd of [-1, 1]) {
        strip(cx - 19.5, cx + 19.5, cz + sd * 18.5 - 1, cz + sd * 18.5 + 1, 0.06, 'sidewalk');
        strip(cx + sd * 18.5 - 1, cx + sd * 18.5 + 1, cz - 17.5, cz + 17.5, 0.06, 'sidewalk');
      }
    }

    const lamps = [];
    for (const rx of ROADS) for (const rz of ROADS) {
      const m = M(rx + 5.6, 0, rz + 5.6, -3 * Math.PI / 4);
      lamps.push(streetlamp(b, m));
      this.colliders.addCentered(rx + 5.6, rz + 5.6, 0.3, 0.3);
    }

    // Houses: four lots per block, except two special blocks.
    this.housesInfo = [];
    for (let bx = 0; bx < NB; bx++) for (let bz = 0; bz < NB; bz++) {
      const cx = BLOCKS[bx], cz = BLOCKS[bz];
      if (bx === 3 && bz === 2) { this.buildPlayground(b, cx, cz, lamps); continue; }
      if (bx === 1 && bz === 3) { this.buildCulDeSac(b, cx, cz, rng); continue; }
      for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
        const w = 7.5 + rng() * 2.5, d = 7 + rng() * 2, h = rng() < 0.6 ? 6 : 3.4;
        const hx = cx + qx * 8.6, hz = cz + qz * (17.5 - 4.5 - d / 2);
        house(b, M(hx, 0, hz, qz > 0 ? 0 : Math.PI), { w, d, h, rng, litChance: 0.08 });
        this.colliders.addCentered(hx, hz, w + 0.3, d + 0.3, -1, h + 2);
        const fz = cz + qz * 16.4;
        mailbox(b, M(hx + qx * 2.5, 0, fz, qz > 0 ? 0 : Math.PI));
        this.colliders.addCentered(hx + qx * 2.5, fz, 0.35, 0.5, -1, 1.3);
        if (rng() < 0.7) {
          const tx = hx + (rng() - 0.5) * 6, tz = cz + qz * 2.4;
          deadTree(b, M(tx, 0, tz, rng() * 6), rng, 4 + rng() * 3);
          this.colliders.addCentered(tx, tz, 0.6, 0.6);
        }
        this.housesInfo.push({ hx, hz, w, d, qx, qz, cx, cz });
      }
      // Back fences with a gap so the yards connect.
      const gap = (rng() - 0.5) * 20;
      for (const [x0, x1] of [[cx - 17, cx + gap - 1.5], [cx + gap + 1.5, cx + 17]]) {
        fence(b, M((x0 + x1) / 2, 0, cz), x1 - x0);
        this.colliders.add(x0, cz - 0.1, x1, cz + 0.1, -1, 1.1);
      }
    }

    this.tile = b.build(mats);
    // 3x3 copies so the wrap is seamless.
    this.tiles = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t = i === 0 && j === 0 ? this.tile : this.tile.clone();
      t.position.set(i * T, 0, j * T);
      s.add(t);
      this.tiles.push(t);
    }
    this.buildSwings();
    this.addLightPool(lamps, { count: 6, intensity: 9, distance: 18, halo: 3.2 });

    this.entryBase = new THREE.Vector3(ROADS[2], 0, 14);
    this.addEntryDoor(this.entryBase.clone(), 0);
    // The key is as far from the start as the town allows; the door is back near where you began.
    this.exitBase = new THREE.Vector3(BLOCKS[1], 0, BLOCKS[3]);
    this.addExitDoor(this.exitBase.clone(), Math.PI);
    // The key lies in a backyard, by the fence.
    const kh = this.housesInfo.find((h) => h.cx === BLOCKS[NB - 1] && h.cz === BLOCKS[0] && h.qx === -1 && h.qz === 1);
    this.keyBase = new THREE.Vector3(kh.hx, 0, kh.cz + 1.2);
    this.addKey(this.keyBase.clone());

    this.voyerSpots = this.cornerSpots();
    // The town belongs to Voyer: it is almost always somewhere, watching.
    this.monsters.push(new Voyer(this.game, this, { firstDelay: 4, minDist: 14, maxDist: 55, cooldown: [1, 3], watch: [6, 14], retry: 0.5 }));

    this.voyerLine = 'Was someone standing there?';
    this.lockedLine = 'Locked. There has to be a key somewhere in this town.';
    this.events = [
      () => this.game.audio.slam(this.aroundPlayer(40), 0.6),
      () => this.game.audio.distantFootsteps(this.aroundPlayer(7, true), 3),
      () => this.game.audio.whisper(this.aroundPlayer(5, true), 0.25),
      () => { const i = Math.floor(Math.random() * this.lightPool.positions.length); this.lightPool.kill(i); },
    ];
    this.hintTimer = 70;
  }

  buildPlayground(b, cx, cz, lamps) {
    b.add(box(30, 0.04, 30, 3), 'dirt', M(cx, 0.03, cz));
    // Swing frame (the seats are animated separately).
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), 'metal', M(cx + sx * 2.2, 1.6, cz + sz * 0.9, 0, sz * 0.27), 0x5a3a2a);
    }
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6), 'metal', M(cx, 3.25, cz, 0, 0, Math.PI / 2), 0x5a3a2a);
    this.colliders.addCentered(cx, cz, 4.8, 2.2, -1, 0.4);
    // Slide.
    b.add(box(0.6, 2.2, 0.1), 'metal', M(cx + 8, 1.1, cz + 6), 0x6a2a20);
    b.add(box(0.7, 0.06, 4), 'metal', M(cx + 8, 1.15, cz + 7.8, 0, 0.5), 0x9a8a6a);
    this.colliders.addCentered(cx + 8, cz + 7, 0.9, 3.5, -1, 2.2);
    bench(b, M(cx - 7, 0, cz + 8, Math.PI));
    bench(b, M(cx - 9, 0, cz - 6, Math.PI / 2));
    this.colliders.addCentered(cx - 7, cz + 8, 1.9, 0.6, -1, 0.9);
    this.colliders.addCentered(cx - 9, cz - 6, 0.6, 1.9, -1, 0.9);
    lamps.push(streetlamp(b, M(cx - 4, 0, cz - 4, Math.PI / 4)));
    this.swingPos = new THREE.Vector3(cx, 2, cz);
    this.playground = { cx, cz };
  }

  buildCulDeSac(b, cx, cz, rng) {
    const c = new THREE.CylinderGeometry(9, 9, 0.06, 32);
    b.add(c, 'asphalt', M(cx, 0.03, cz));
    b.add(box(9, 0.06, 12, 6), 'asphalt', M(cx, 0.03, cz - 12));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, r = 12 + rng() * 3;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      deadTree(b, M(x, 0, z, rng() * 6), rng, 5 + rng() * 3);
      this.colliders.addCentered(x, z, 0.6, 0.6);
    }
  }

  buildSwings() {
    this.swings = [];
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6 });
    const { cx, cz } = this.playground;
    for (const t of this.tiles) {
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(cx + sx * 1, 3.2, cz);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.25), seatMat);
        seat.position.y = -2.6;
        for (const cxo of [-0.22, 0.22]) {
          const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.6, 3), chainMat);
          ch.position.set(cxo, -1.3, 0);
          pivot.add(ch);
        }
        pivot.add(seat);
        t.add(pivot);
        this.swings.push({ pivot, phase: sx > 0 ? 0 : 1.7 });
      }
    }
    this.swingEmitter = this.game.audio.emitter('swing', this.swingPos, { ref: 3, gain: 0.8 });
    this.emitters.push(this.swingEmitter);
  }

  relPos(p, ref, out = new THREE.Vector3()) {
    out.copy(p);
    out.x += T * Math.round((ref.x - p.x) / T);
    out.z += T * Math.round((ref.z - p.z) / T);
    return out;
  }

  move(player, delta, dt) {
    flatMove(player, delta, dt, this);
    const p = player.pos;
    if (p.x > H) p.x -= T; else if (p.x < -H) p.x += T;
    if (p.z > H) p.z -= T; else if (p.z < -H) p.z += T;
  }

  lineOfSight(a, b) {
    return !this.colliders.segmentBlocked(a.x, a.z, b.x, b.z, Math.min(a.y, b.y));
  }

  enter() {
    const ui = this.game.ui;
    ui.think('...where is this?', 3);
    ui.think('I know this street. Don\'t I?', 3.5);
  }

  update(dt) {
    const pp = this.game.player.pos;
    this.relPos(this.entryBase, pp, this.entryDoor.group.position);
    this.relPos(this.exitBase, pp, this.exitDoor.group.position);
    const k = this.keys[0];
    this.relPos(this.keyBase, pp, k.group.position);
    this.swingEmitter.setPos(this.relPos(this.swingPos, pp));
    const t = performance.now() * 0.001;
    for (const s of this.swings) s.pivot.rotation.x = Math.sin(t * 1.3 + s.phase) * 0.35;
    super.update(dt);
    if (!this.game.hasKey && !k.taken) {
      this.hintTimer -= dt;
      if (this.hintTimer < 0) {
        this.hintTimer = 9999;
        this.game.ui.think('Something is chiming. A little tune, somewhere in the fog.', 4.5);
      }
    }
  }
}

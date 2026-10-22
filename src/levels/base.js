import * as THREE from 'three';
import { ColliderSet, flatMove } from '../core/collision.js';
import { makeMaterials, glowSprite } from '../props/common.js';
import { FreeDoor } from '../props/door.js';
import { Key } from '../props/key.js';
import { rand } from '../core/util.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Keeps a handful of real PointLights on the lamp/candle positions nearest the player.
export class LightPool {
  constructor(level, positions, { count = 5, color = 0xffd9a0, intensity = 6, distance = 16, decay = 1.6, flicker = 0.08, halo = 0 } = {}) {
    this.level = level;
    this.positions = positions;
    this.intensity = intensity;
    this.flicker = flicker;
    this.lights = [];
    this.assigned = [];
    this.timer = 0;
    this.dead = new Set(); // indices of lamps that have died
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(color, 0, distance, decay);
      level.scene.add(l);
      this.lights.push(l);
      this.assigned.push(-1);
    }
    this.halos = [];
    if (halo > 0) {
      for (const p of positions) {
        const s = glowSprite(color, halo, 0.35);
        s.position.copy(p);
        level.scene.add(s);
        this.halos.push(s);
      }
    }
  }

  kill(i) { this.dead.add(i); if (this.halos[i]) this.halos[i].visible = false; }

  update(dt, playerPos) {
    this.timer -= dt;
    const lv = this.level;
    if (this.timer <= 0) {
      this.timer = 0.3;
      const scored = this.positions
        .map((p, i) => [lv.relPos(p, playerPos, _a).distanceToSquared(playerPos), i])
        .filter(([, i]) => !this.dead.has(i))
        .sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < this.lights.length; k++) this.assigned[k] = scored[k] ? scored[k][1] : -1;
    }
    const t = performance.now() * 0.001;
    for (let k = 0; k < this.lights.length; k++) {
      const i = this.assigned[k], l = this.lights[k];
      if (i < 0) { l.intensity = 0; continue; }
      lv.relPos(this.positions[i], playerPos, l.position);
      let f = 1 - this.flicker + this.flicker * Math.sin(t * 13 + i * 7.1) * Math.sin(t * 7.3 + i);
      if (Math.random() < dt * 0.4) f *= 0.2;
      l.intensity = this.intensity * f;
    }
    for (let i = 0; i < this.halos.length; i++) lv.relPos(this.positions[i], playerPos, this.halos[i].position);
  }
}

export class BaseLevel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.colliders = new ColliderSet(8);
    this.doors = [];
    this.keys = [];
    this.interactables = [];
    this.monsters = [];
    this.updaters = [];
    this.emitters = [];
    this.voyerSpots = [];
    this.events = [];
    this.eventTimer = rand(25, 45);
    this.surface = 'asphalt';
    this.mats = makeMaterials();
    this.lightPool = null;
    this.fear = 0;
    this.spawn = { pos: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) };
    this.ambience = null;
  }

  build() {}
  enter() {}

  // Hiding spots at the corners of every tall, wide collider (houses, maze walls...).
  cornerSpots(colliders = this.colliders, minH = 2.5, minSize = 1.5) {
    const out = [], up = new THREE.Vector3(0, 1, 0);
    for (const b of colliders.boxes) {
      if (b.off || b.maxY - Math.max(b.minY, 0) < minH) continue;
      if (Math.max(b.maxX - b.minX, b.maxZ - b.minZ) < minSize) continue;
      const center = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) {
        out.push({ corner: new THREE.Vector3(x, 0, z), center, up });
      }
    }
    return out;
  }

  // Where to stand so a corner hides most of you from the player, with a head's width peeking out.
  peekPosition(spot, playerPos, colliders = this.colliders) {
    const pl = this.relPos(playerPos, spot.corner, _a);
    const dx = spot.corner.x - pl.x, dz = spot.corner.z - pl.z, dist = Math.hypot(dx, dz);
    if (dist < 2) return null;
    const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const side = Math.sign(perp.dot(_b.copy(spot.center).sub(spot.corner))) || 1;
    const pos = spot.corner.clone().addScaledVector(dir, 0.75).addScaledVector(perp, side * 0.25);
    colliders.pushOut(pos, 0.3, 0, 2.5);
    pos.y = spot.corner.y;
    return { pos, visibleSide: perp.multiplyScalar(-side) };
  }

  relPos(p, ref, out = new THREE.Vector3()) { return out.copy(p); }
  groundAt() { return 0; }
  lineOfSight(a, b) { return !this.colliders.segmentBlocked(a.x, a.z, b.x, b.z, Math.min(a.y, b.y)); }
  move(player, delta, dt) { flatMove(player, delta, dt, this); }

  // Door you have just stepped out of. Spawns the player in front of it.
  addEntryDoor(pos, rotY = 0, quaternion = null, up = new THREE.Vector3(0, 1, 0), opts = {}) {
    const d = new FreeDoor(this.game, { position: pos, rotY, quaternion, mode: 'entry', ...opts });
    this.scene.add(d.group);
    this.doors.push(d);
    this.interactables.push(d.interactable);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(d.group.quaternion);
    this.spawn.pos.copy(pos).addScaledVector(front, 1.4);
    this.spawn.forward.copy(front);
    this.spawn.up.copy(up);
    this.entryDoor = d;
    return d;
  }

  addExitDoor(pos, rotY = 0, quaternion = null, opts = {}) {
    const d = new FreeDoor(this.game, { position: pos, rotY, quaternion, mode: 'exit', onEnter: () => this.game.nextLevel(), ...opts });
    this.scene.add(d.group);
    this.doors.push(d);
    this.interactables.push(d.interactable);
    this.exitDoor = d;
    return d;
  }

  addKey(pos, up) {
    const k = new Key(this.game, pos, up);
    this.scene.add(k.group);
    this.keys.push(k);
    this.interactables.push(k.interactable);
    return k;
  }

  addLightPool(positions, opts) {
    this.lightPool = new LightPool(this, positions, opts);
    return this.lightPool;
  }

  update(dt) {
    const pl = this.game.player;
    for (const d of this.doors) d.update(dt, pl);
    for (const k of this.keys) k.update(dt);
    for (const m of this.monsters) m.update(dt);
    if (this.lightPool) this.lightPool.update(dt, pl.pos);
    for (const f of this.updaters) f(dt);
    if (this.events.length) {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) {
        this.eventTimer = rand(28, 55);
        this.events[Math.floor(Math.random() * this.events.length)]();
      }
    }
  }

  // A point somewhere around the player, for off-screen sounds.
  aroundPlayer(dist, behind = false) {
    const pl = this.game.player;
    const dir = pl.forward.clone();
    if (!behind) dir.applyAxisAngle(pl.up, Math.random() * Math.PI * 2);
    else dir.negate().applyAxisAngle(pl.up, (Math.random() - 0.5) * 0.8);
    return pl.pos.clone().addScaledVector(dir, dist).addScaledVector(pl.up, 1);
  }

  blurSpots() {
    const out = [];
    for (const m of this.monsters) {
      const b = m.blurSpot && m.blurSpot();
      if (b) out.push(b);
    }
    return out;
  }

  get maxFear() {
    let f = this.fear;
    for (const m of this.monsters) f = Math.max(f, m.fear || 0);
    return f;
  }

  dispose() {
    for (const d of this.doors) d.dispose();
    for (const k of this.keys) k.dispose();
    for (const m of this.monsters) m.dispose();
    for (const e of this.emitters) e.stop();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [].concat(o.material)) m.dispose();
      }
    });
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}

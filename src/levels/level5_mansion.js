import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { ColliderSet } from '../core/collision.js';
import { Batch, M, box, prism, candle, chair } from '../props/common.js';
import { tex } from '../core/textures.js';
import { mulberry32, rand, clamp, sleep } from '../core/util.js';
import { Voyer } from '../monsters/voyer.js';
import { buildChasseur, animateChasseur, disposeChasseur } from '../monsters/chasseur.js';

const W = 9;          // cells per side
const C = 6;          // cell size
const O = -(W * C) / 2;
const WH = 4.2;       // wall height
const WT = 0.3;
const DOOR_W = 1.7;
const DOOR_H = 2.6;
const ENTRANCE = [4, 8];
const CENTER = [4, 4];
const CHASE_SPEED = 4.2;

const cc = (i) => O + (i + 0.5) * C;
const _dayC = new THREE.Color();
const key = (i, j) => j * W + i;

function genMaze(seed) {
  const rng = mulberry32(seed);
  const h = Array.from({ length: W + 1 }, () => Array(W).fill(true));
  const v = Array.from({ length: W }, () => Array(W + 1).fill(true));
  const seen = new Set([key(...CENTER)]);
  const stack = [CENTER];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = [[i, j - 1, 'n'], [i, j + 1, 's'], [i - 1, j, 'w'], [i + 1, j, 'e']]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < W && b < W && !seen.has(key(a, b)));
    if (!opts.length) { stack.pop(); continue; }
    const [a, b, d] = opts[Math.floor(rng() * opts.length)];
    if (d === 'n') h[j][i] = false;
    if (d === 's') h[j + 1][i] = false;
    if (d === 'w') v[j][i] = false;
    if (d === 'e') v[j][i + 1] = false;
    seen.add(key(a, b));
    stack.push([a, b]);
  }
  return { h, v, rng };
}

function open(m, i, j) {
  const out = [];
  if (j > 0 && !m.h[j][i]) out.push([i, j - 1]);
  if (j < W - 1 && !m.h[j + 1][i]) out.push([i, j + 1]);
  if (i > 0 && !m.v[j][i]) out.push([i - 1, j]);
  if (i < W - 1 && !m.v[j][i + 1]) out.push([i + 1, j]);
  return out;
}

function path(m, from, to) {
  const prev = new Map([[key(...from), null]]);
  const q = [from];
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    if (c[0] === to[0] && c[1] === to[1]) break;
    for (const n of open(m, ...c)) {
      if (prev.has(key(...n))) continue;
      prev.set(key(...n), c);
      q.push(n);
    }
  }
  if (!prev.has(key(...to))) return null;
  const out = [];
  for (let c = to; c; c = prev.get(key(...c))) out.push(c);
  return out.reverse();
}

// V. A maze-like mansion floating above the clouds. At its heart, a chest.
export class Level5Mansion extends BaseLevel {
  build() {
    const s = this.scene, mats = this.mats;
    s.background = new THREE.Color(0x18223a);
    s.fog = new THREE.FogExp2(0x18223a, 0.006);
    this.ambient = new THREE.AmbientLight(0xa89480, 1.5);
    this.hemi = new THREE.HemisphereLight(0x9aa8d0, 0x5a4636, 1.4);
    s.add(this.ambient, this.hemi);
    this.surface = 'wood';
    this.ambience = { drone: [65.4, 77.8, 98], cutoff: 340, droneVol: 0.05, wind: 0.05, windFreq: 350 };
    mats.moonGlass = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x2a3a58 });
    mats.wallpaper.map = tex('wallpaper');
    mats.ceiling = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex('plaster'), color: 0x6a6258, roughness: 1 });

    // Pick a layout whose route from the front door to the centre passes a room on the east side:
    // that room gets the balcony, so the player has seen it before the chase.
    let maze, route, bal;
    for (let seed = 7; ; seed++) {
      maze = genMaze(seed);
      route = path(maze, ENTRANCE, CENTER);
      const hit = route.find(([i, j]) => i === W - 1 && j > 0 && j < W - 1);
      if (hit && route.length >= 12) { bal = hit; break; }
    }
    // A few extra openings so the chase has loops, never touching the centre room.
    const rng = maze.rng;
    for (let n = 0; n < 7; n++) {
      const i = 1 + Math.floor(rng() * (W - 2)), j = 1 + Math.floor(rng() * (W - 2));
      if (Math.abs(i - CENTER[0]) <= 1 && Math.abs(j - CENTER[1]) <= 1) continue;
      if (rng() < 0.5) maze.h[j][i] = false; else maze.v[j][i] = false;
    }
    this.maze = maze;
    this.balCell = bal;
    this.escapeRoute = path(maze, CENTER, bal);

    const b = new Batch();
    this.buildWalls(b);
    this.buildRooms(b, rng);
    this.buildExterior(b);
    s.add(b.build(mats));
    this.buildSky();

    // Candles: the ones along the escape route keep burning after the chest opens.
    this.addLightPool(this.candles.map((c) => c.p), { count: 10, color: 0xffa860, intensity: 14, distance: 15, decay: 1.4, flicker: 0.15 });

    this.addEntryDoor(new THREE.Vector3(0, 0, 32.6), Math.PI);
    this.buildChest();
    this.buildCandleTrail();

    // Voyer peeks around door frames and wall ends.
    this.voyerSpots = this.cornerSpots(this.wallColliders);
    this.voyer = new Voyer(this.game, this, { firstDelay: 20, minDist: 9, maxDist: 30, flee: 6 });
    this.monsters.push(this.voyer);
    this.voyerLine = 'A face in the doorway. Gone.';
    this.events = [
      () => this.game.audio.creak(this.aroundPlayer(8), 1.6, 0.4),
      () => this.game.audio.distantFootsteps(this.aroundPlayer(9), 3),
      () => this.game.audio.whisper(this.aroundPlayer(3, true), 0.3),
    ];
    this.phase = 'explore';
  }

  // ---------- Construction ----------
  buildWalls(b) {
    const m = this.maze;
    this.wallColliders = new ColliderSet(8); // the monster ignores furniture
    const piece = (x0, z0, x1, z1, y0, y1, mat = 'wallpaper', color = 0xffffff) => {
      const w = x1 - x0, d = z1 - z0, h = y1 - y0;
      b.add(box(w, h, d, 2.6), mat, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color);
      this.colliders.add(x0, z0, x1, z1, y0, y1);
      this.wallColliders.add(x0, z0, x1, z1, y0, y1);
    };
    const exteriorDoor = (j, i, horiz) => {
      if (horiz) return (j === W && i === ENTRANCE[0]);
      return (i === W && j === this.balCell[1]);
    };
    // Horizontal edges (north side of row j).
    for (let j = 0; j <= W; j++) for (let i = 0; i < W; i++) {
      const z = O + j * C, x0 = O + i * C - WT / 2, x1 = O + (i + 1) * C + WT / 2;
      const outer = j === 0 || j === W;
      const closed = outer ? !exteriorDoor(j, i, true) : m.h[j][i];
      this.wallEdge(b, piece, true, closed, x0, x1, z, outer);
    }
    for (let i = 0; i <= W; i++) for (let j = 0; j < W; j++) {
      const x = O + i * C, z0 = O + j * C - WT / 2, z1 = O + (j + 1) * C + WT / 2;
      const outer = i === 0 || i === W;
      const closed = outer ? !exteriorDoor(j, i, false) : m.v[j][i];
      this.wallEdge(b, piece, false, closed, z0, z1, x, outer);
    }
    // Floor and ceiling.
    const span = W * C;
    b.add(box(span, 0.2, span, 3), 'wood', M(0, -0.1, 0), 0x9a8070);
    b.add(box(span, 0.1, span, 4), 'ceiling', M(0, WH + 0.05, 0));
  }

  wallEdge(b, piece, horiz, closed, a0, a1, c, outer) {
    const seg = (s0, s1, y0, y1) => {
      if (horiz) piece(s0, c - WT / 2, s1, c + WT / 2, y0, y1);
      else piece(c - WT / 2, s0, c + WT / 2, s1, y0, y1);
    };
    if (closed) {
      seg(a0, a1, 0, WH);
      if (outer) {
        // Siding outside, and a window or two.
        const sgn = (horiz ? (c > 0 ? 1 : -1) : (c > 0 ? 1 : -1));
        const mid = (a0 + a1) / 2;
        const off = sgn * (WT / 2 + 0.06);
        const mOut = horiz ? M(mid, WH / 2, c + off) : M(c + off, WH / 2, mid);
        b.add(horiz ? box(a1 - a0, WH + 0.6, 0.1, 3) : box(0.1, WH + 0.6, a1 - a0, 3), 'siding', mOut, 0x8a8070);
        if (Math.sin(mid * 3.1 + c) > -0.2) {
          const wOut = horiz ? M(mid, 2.1, c + off * 1.9) : M(c + off * 1.9, 2.1, mid);
          const wIn = horiz ? M(mid, 2.1, c - sgn * (WT / 2 + 0.02)) : M(c - sgn * (WT / 2 + 0.02), 2.1, mid);
          const g = () => (horiz ? box(1.2, 1.7, 0.05) : box(0.05, 1.7, 1.2));
          b.add(g(), Math.sin(mid * 7 + c) > 0.3 ? 'glassLit' : 'glassDark', wOut, 0x8a6a40);
          b.add(g(), 'moonGlass', wIn);
        }
      }
      return;
    }
    const mid = (a0 + a1) / 2;
    seg(a0, mid - DOOR_W / 2, 0, WH);
    seg(mid + DOOR_W / 2, a1, 0, WH);
    seg(mid - DOOR_W / 2, mid + DOOR_W / 2, DOOR_H, WH);
    if (outer) {
      const off = (c > 0 ? 1 : -1) * (WT / 2 + 0.06);
      const sid = (s0, s1, y0, y1) => {
        const m = horiz ? M((s0 + s1) / 2, (y0 + y1) / 2, c + off) : M(c + off, (y0 + y1) / 2, (s0 + s1) / 2);
        b.add(horiz ? box(s1 - s0, y1 - y0, 0.1, 3) : box(0.1, y1 - y0, s1 - s0, 3), 'siding', m, 0x8a8070);
      };
      sid(a0, mid - DOOR_W / 2, 0, WH + 0.6);
      sid(mid + DOOR_W / 2, a1, 0, WH + 0.6);
      sid(mid - DOOR_W / 2, mid + DOOR_W / 2, DOOR_H, WH + 0.6);
    }
    // Dark wooden door frame.
    const fm = (s, y, w, h) => (horiz ? M(s, y, c) : M(c, y, s));
    for (const sx of [-1, 1]) b.add(horiz ? box(0.12, DOOR_H, WT + 0.08) : box(WT + 0.08, DOOR_H, 0.12), 'wood', fm(mid + sx * (DOOR_W / 2 + 0.03), DOOR_H / 2), 0x4a3020);
    b.add(horiz ? box(DOOR_W + 0.2, 0.14, WT + 0.08) : box(WT + 0.08, 0.14, DOOR_W + 0.2), 'wood', fm(mid, DOOR_H + 0.05), 0x4a3020);
  }

  buildRooms(b, rng) {
    const m = this.maze;
    this.candles = [];
    const onRoute = new Set(this.escapeRoute.map((c) => key(...c)));
    const clockCell = [2, 6];
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const x = cc(i), z = cc(j);
      const closed = [];
      if (m.h[j][i] && !(j === 0 && false)) closed.push('n');
      if (m.h[j + 1][i] && !(j + 1 === W && i === ENTRANCE[0])) closed.push('s');
      if (m.v[j][i]) closed.push('w');
      if (m.v[j][i + 1] && !(i + 1 === W && j === this.balCell[1])) closed.push('e');
      const frame = (side, inset, along = 0) => {
        const r = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 }[side];
        const px = side === 'w' ? x - C / 2 + inset : side === 'e' ? x + C / 2 - inset : x + along;
        const pz = side === 'n' ? z - C / 2 + inset : side === 's' ? z + C / 2 - inset : z + along;
        return { m: M(px, 0, pz, r), px, pz, side };
      };
      if (i === CENTER[0] && j === CENTER[1]) {
        b.add(box(3.4, 0.02, 2.4, 2), 'paint', M(x, 0.01, z), 0x4a1410);
        for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
          b.add(box(0.25, 1, 0.25), 'wood', M(x + dx, 0.5, z + dz), 0x3a2418);
          this.candles.push({ p: candle(b, M(x + dx, 1, z + dz), 0.3), cell: [i, j], route: true });
        }
        continue;
      }
      if (rng() < 0.45) b.add(box(2.8, 0.02, 2, 2), 'paint', M(x, 0.01, z, rng() * 0.3), [0x4a1410, 0x2a2a3a, 0x3a2a14][Math.floor(rng() * 3)]);
      const sides = closed.slice().sort(() => rng() - 0.5);
      const needCandle = onRoute.has(key(i, j)) || rng() < 0.55;
      if (sides.length) {
        const f = frame(sides[0], 0.4, rand(-1.5, 1.5));
        if (i === clockCell[0] && j === clockCell[1]) {
          b.add(box(0.7, 2.3, 0.45, 1), 'wood', f.m.clone().multiply(M(0, 1.15, 0)), 0x5a3a24);
          b.add(box(0.4, 0.4, 0.05, 1), 'paint', f.m.clone().multiply(M(0, 1.8, 0.24)), 0xd8d0b8);
          this.colliders.addCentered(f.px, f.pz, 0.8, 0.8, -1, 2.3);
          this.emitters.push(this.game.audio.emitter('clock', new THREE.Vector3(f.px, 1.8, f.pz), { ref: 2, gain: 1 }));
        } else if (needCandle) {
          b.add(box(0.9, 0.8, 0.45, 1), 'wood', f.m.clone().multiply(M(0, 0.4, 0)), 0x5a3a24);
          this.colliders.addCentered(f.px, f.pz, 0.95, 0.95, -1, 0.8);
          this.candles.push({ p: candle(b, f.m.clone().multiply(M(0.2, 0.8, 0)), 0.25 + rng() * 0.1), cell: [i, j], route: onRoute.has(key(i, j)) });
        } else if (rng() < 0.6) {
          b.add(box(1.6, 2.4, 0.4, 1), 'wood', f.m.clone().multiply(M(0, 1.2, 0)), 0x3a2418);
          for (let k = 0; k < 4; k++) b.add(box(1.5, 0.3, 0.26, 1), 'paint', f.m.clone().multiply(M(0, 0.4 + k * 0.55, 0.09)), [0x4a2a20, 0x2a3a2a, 0x3a3020][k % 3]);
          this.colliders.addCentered(f.px, f.pz, 1.6, 1.6, -1, 2.4);
        }
      }
      if (sides.length > 1 && rng() < 0.6) {
        const f = frame(sides[1], 0.17, rand(-1, 1));
        this.portraitAt(f.m.clone().multiply(M(0, 2.1, 0)));
      }
      if (rng() < 0.3) {
        const cx = x + rand(-1.5, 1.5), cz = z + rand(-1.5, 1.5);
        chair(b, M(cx, 0, cz, rng() * 6));
        this.colliders.addCentered(cx, cz, 0.6, 0.6, -1, 1);
      }
    }
  }

  portraitAt(m) {
    if (!this.portraitMat) {
      this.portraitMat = new THREE.MeshStandardMaterial({ map: tex('portrait'), roughness: 0.6 });
      this.frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4020, metalness: 0.5, roughness: 0.5 });
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.05), this.frameMat);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1), this.portraitMat);
    pic.position.z = 0.03;
    frame.add(pic);
    frame.applyMatrix4(m);
    this.scene.add(frame);
  }

  buildExterior(b) {
    // Porch.
    b.add(box(16, 0.3, 7.2, 2), 'wood', M(0, -0.15, 30.6), 0xb89c7c);
    b.add(box(16.4, 0.2, 7.6, 3), 'roof', M(0, 3.6, 30.6), 0x888888);
    for (const x of [-7.8, 7.8]) for (const z of [33.9, 27.4]) {
      b.add(new THREE.CylinderGeometry(0.14, 0.16, 3.6, 8), 'paint', M(x, 1.8, z), 0xb8b0a0);
      this.colliders.addCentered(x, z, 0.35, 0.35);
    }
    const rail = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), horiz = Math.abs(z1 - z0) < 0.01;
      b.add(horiz ? box(len, 0.08, 0.08, 1) : box(0.08, 0.08, len, 1), 'paint', M((x0 + x1) / 2, 1.0, (z0 + z1) / 2), 0xb8b0a0);
      for (let t = 0; t <= len; t += 0.25) {
        const px = x0 + ((x1 - x0) * t) / len, pz = z0 + ((z1 - z0) * t) / len;
        b.add(box(0.04, 1, 0.04, 1), 'paint', M(px, 0.5, pz), 0xb8b0a0);
      }
      this.colliders.add(Math.min(x0, x1) - 0.1, Math.min(z0, z1) - 0.1, Math.max(x0, x1) + 0.1, Math.max(z0, z1) + 0.1, -5, 3);
    };
    rail(-8, 27.2, -8, 34.2); rail(8, 27.2, 8, 34.2); rail(-8, 34.2, 8, 34.2);
    this.porchLight = new THREE.PointLight(0xffc080, 45, 20, 1.3);
    this.porchLight.position.set(0, 3.2, 29.5);
    this.scene.add(this.porchLight);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd8a0 }));
    lantern.position.copy(this.porchLight.position);
    this.scene.add(lantern);
    // Cold moonlight on the porch and the outside walls.
    const moonFill = (this.moonFill = new THREE.SpotLight(0x8aa0d0, 70, 70, 0.7, 0.8, 1));
    moonFill.position.set(10, 25, 55);
    moonFill.target.position.set(0, 0, 27);
    this.scene.add(moonFill, moonFill.target);

    // Balcony, with a broken railing at the far end.
    const bz = cc(this.balCell[1]), x0 = -O;
    this.bal = { x0, x1: x0 + 8, z0: bz - 3, z1: bz + 3 };
    b.add(box(8, 0.3, 6, 2), 'wood', M(x0 + 4, -0.15, bz), 0xb89c7c);
    rail(x0, bz - 3, x0 + 8, bz - 3); rail(x0, bz + 3, x0 + 8, bz + 3);
    rail(x0 + 8, bz - 3, x0 + 8, bz - 1.4); rail(x0 + 8, bz + 1.1, x0 + 8, bz + 3);
    // Splintered stubs where the railing broke.
    b.add(box(0.08, 0.6, 0.08), 'paint', M(x0 + 8, 0.3, bz - 1.2, 0, 0.3), 0xb8b0a0);
    b.add(box(0.08, 0.5, 0.08), 'paint', M(x0 + 8, 0.25, bz + 0.9, 0, -0.4), 0xb8b0a0);
    this.moon = new THREE.SpotLight(0x8aa4d8, 6, 30, 0.7, 0.6, 1.2);
    this.moon.position.set(x0 + 9, 6, bz);
    this.moon.target.position.set(x0 - 6, 0, bz);
    this.scene.add(this.moon, this.moon.target);
    this.balconyPos = new THREE.Vector3(x0 + 4, 1.5, bz);

    // Roof and chimneys.
    b.add(prism(W * C + 1.5, W * C + 1.5, 11), 'roof', M(0, WH + 0.6, 0), 0x777777);
    b.add(box(W * C + 1.2, 0.6, W * C + 1.2, 3), 'siding', M(0, WH + 0.42, 0), 0x4a4038); // sits on the ceiling, not level with it
    for (const [x, z] of [[-14, -8], [12, 10], [3, -18]]) b.add(box(1.4, 9, 1.4, 2), 'brick', M(x, WH + 6, z), 0x777777);

    // The floating rock beneath.
    const rock = new THREE.CylinderGeometry(41, 4, 55, 4, 6);
    rock.rotateY(Math.PI / 4);
    const pos = rock.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 27) continue;
      pos.setX(i, pos.getX(i) * (0.9 + Math.sin(i * 12.7) * 0.12));
      pos.setZ(i, pos.getZ(i) * (0.9 + Math.cos(i * 7.3) * 0.12));
    }
    rock.computeVertexNormals();
    b.add(rock, 'rock', M(0, -28, 0), 0x777777);
  }

  buildSky() {
    const s = this.scene;
    const cloudMat = (this.cloudMat = new THREE.SpriteMaterial({ map: tex('cloud'), color: 0x8a96b4, transparent: true, opacity: 0.75, depthWrite: false }));
    const r = mulberry32(55);
    for (let i = 0; i < 140; i++) {
      const sp = new THREE.Sprite(cloudMat);
      const a = r() * Math.PI * 2, d = 20 + r() * 260;
      sp.position.set(Math.cos(a) * d, -95 - r() * 25, Math.sin(a) * d);
      const sc = 70 + r() * 90;
      sp.scale.set(sc, sc * 0.5, 1);
      s.add(sp);
    }
    this.seaMat = new THREE.MeshBasicMaterial({ color: 0x3a4460 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -125;
    s.add(sea);
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 1800; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() * 0.9 + 0.05, r() - 0.5).normalize().multiplyScalar(450);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xc8d0e0, size: 1.4, sizeAttenuation: false, fog: false, transparent: true });
    s.add(new THREE.Points(starGeo, this.starMat));
    const moon = (this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xdde6ff, fog: false, depthWrite: false })));
    moon.position.set(300, 160, 40);
    moon.scale.set(90, 90, 1);
    s.add(moon);
  }

  buildChest() {
    const [i, j] = CENTER;
    const x = cc(i), z = cc(j);
    const wood = new THREE.MeshStandardMaterial({ map: tex('wood'), color: 0x8a6040, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.5 });
    this.chest = new THREE.Group();
    this.chest.position.set(x, 0, z - 0.4);
    this.chest.rotation.y = Math.PI;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.62, 0.75), wood);
    body.position.y = 0.31;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.08, 0.79), iron);
    band.position.y = 0.5;
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.65), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    inside.rotation.x = -Math.PI / 2;
    inside.position.y = 0.6;
    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.62, -0.375);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.14, 0.77), wood);
    lidMesh.position.set(0, 0.07, 0.375);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.04), iron);
    lock.position.set(0, 0.0, 0.77);
    this.lid.add(lidMesh, lock);
    this.chest.add(body, band, inside, this.lid);
    this.scene.add(this.chest);
    this.colliders.addCentered(x, z - 0.4, 1.4, 0.85, -1, 0.75);
    this.interactables.push({
      object: this.chest,
      prompt: () => (this.phase === 'explore' ? 'Open the chest' : null),
      act: () => this.openChest(),
    });
  }

  // ---------- Climax ----------
  async openChest() {
    if (this.phase !== 'explore') return;
    this.phase = 'opening';
    const g = this.game, pl = g.player, a = g.audio;
    pl.enabled = false;
    pl.lookEnabled = false;
    this.voyer.hide(9999);
    const target = this.chest.position.clone().add(new THREE.Vector3(0, 0.4, 0));
    pl.forward.copy(target).sub(pl.pos).setY(0).normalize();
    pl.pitch = -0.45;
    a.setAmbience(null);
    a.creak(this.chest.position, 2, 0.55);
    this.lidTarget = 0.18;
    this.lightPool.intensity = 7;
    await sleep(2.1);
    if (this.disposed) return;
    // The scare: the lid bursts open and it comes up out of the chest, straight at you.
    this.lidTarget = 1.95;
    this.fear = 1;
    const mon = this.ensureMonster();
    mon.visible = true;
    mon.position.copy(this.chest.position).add(new THREE.Vector3(0, -1.1, 0));
    // It lands on the far side of the chest from the way out, so your first step is clear.
    const [ni, nj] = this.escapeRoute[1];
    const toExit = new THREE.Vector3(cc(ni), 0, cc(nj)).sub(this.chest.position).setY(0).normalize();
    const settle = this.chest.position.clone().addScaledVector(toExit, -1.3).setY(0);
    this.phase = 'lunging';
    g.lunge.start(mon, {
      hold: 0.6,
      settle,
      onDone: () => {
        if (this.disposed) return;
        pl.enabled = true;
        this.phase = 'chase';
        this.pause = 1.5; // a moment of stillness before it comes for you
        pl.staminaDuration = 18; // enough breath to sprint all the way to the balcony
        this.stepTimer = 0;
        this.repath = 0;
        g.ui.think('RUN.', 1.5);
      },
    });
    this.lightPool.positions = this.candles.filter((c) => c.route).map((c) => c.p);
    this.lightPool.timer = 0;
    this.lightPool.intensity = 14;
    a.slam(new THREE.Vector3(0, 1, 27), 1);
    a.setAmbience({ drone: [55, 58.3, 82.4], cutoff: 500, droneVol: 0.08, wind: 0.1, windFreq: 500 });
    this.blockFrontDoor();
    this.windEm = a.emitter('wind', this.balconyPos, { ref: 4, rolloff: 0.9, gain: 1.2 });
    this.emitters.push(this.windEm);
    this.moonTarget = 22;
    this.buildCurtains();
    this.trailT = 0; // the floor candles start lighting, one after another
    this.dayT = 0;   // and outside, night turns to day
    setTimeout(() => { if (!this.disposed && this.phase === 'chase') g.ui.think('The balcony. The broken railing. Down. Go down.', 4); }, 9000);
  }

  ensureMonster() {
    if (!this.monster) {
      this.monster = buildChasseur();
      this.monster.scale.setScalar(0.88); // just fits under the door frames, hunched
      this.scene.add(this.monster);
    }
    return this.monster;
  }

  releaseChasseur(delay = 0.9) {
    this.ensureMonster();
    this.monster.visible = true;
    this.monster.position.copy(this.chest.position).add(new THREE.Vector3(0, -1.6, 0));
    this.monster.rotation.y = 0;
    this.rise = 0;
    this.phase = 'rising';
    this.riseDelay = delay;
    this.stepTimer = 0;
    this.repath = 0;
  }

  blockFrontDoor() {
    const z = O + W * C, x = cc(ENTRANCE[0]);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.12), new THREE.MeshStandardMaterial({ map: tex('doorwood'), roughness: 0.8 }));
    slab.position.set(x, DOOR_H / 2, z);
    this.scene.add(slab);
    this.colliders.add(x - DOOR_W / 2, z - 0.2, x + DOOR_W / 2, z + 0.2, -1, DOOR_H);
  }

  buildCurtains() {
    const bz = cc(this.balCell[1]), x = -O - 0.25;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a1e1e, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    this.curtains = [];
    for (const sz of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.8, DOOR_H, 4, 8);
      g.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, DOOR_H / 2, bz + sz * 0.62);
      this.scene.add(m);
      this.curtains.push({ m, base: g.attributes.position.array.slice() });
    }
  }

  cellOf(p) {
    return [clamp(Math.floor((p.x - O) / C), 0, W - 1), clamp(Math.floor((p.z - O) / C), 0, W - 1)];
  }

  inside(p) { return Math.abs(p.x) < -O && Math.abs(p.z) < -O; }

  updateChase(dt) {
    const g = this.game, pl = g.player, mon = this.monster, a = g.audio;
    let speed = 0;
    if (this.phase === 'rising') {
      this.riseDelay -= dt;
      if (this.riseDelay <= 0) {
        this.rise = Math.min(1, this.rise + dt / 1.3);
        mon.position.y = -1.6 + this.rise * 1.6;
        mon.position.z = this.chest.position.z + this.rise * 0.9;
        if (this.rise >= 1) { this.phase = 'chase'; a.growl(mon.position, 0.8); }
      }
      speed = 0.3;
    } else if (this.phase === 'chase') {
      const target = new THREE.Vector3();
      const mc = this.cellOf(mon.position);
      const pc = this.inside(pl.pos) ? this.cellOf(pl.pos) : this.balCell;
      const sameCell = mc[0] === pc[0] && mc[1] === pc[1];
      if (sameCell || !this.inside(pl.pos) || !this.wallColliders.segmentBlocked(mon.position.x, mon.position.z, pl.pos.x, pl.pos.z, 1.2)) {
        target.copy(pl.pos);
      } else {
        this.repath -= dt;
        if (this.repath <= 0 || !this.route) { this.route = path(this.maze, mc, pc); this.repath = 0.3; }
        const next = this.route && this.route[1];
        if (next) {
          // Aim for the doorway between this cell and the next.
          target.set((cc(mc[0]) + cc(next[0])) / 2, 0, (cc(mc[1]) + cc(next[1])) / 2);
          if (target.distanceTo(mon.position) < 0.6) target.set(cc(next[0]), 0, cc(next[1]));
        } else target.copy(pl.pos);
      }
      const d = target.sub(mon.position).setY(0);
      const len = d.length();
      if (len > 0.01) {
        speed = 1;
        // Always right on your heels: it races to close any gap, keeps pace with a sprint,
        // and only catches you if you walk, stop, or run out of breath.
        const gap = mon.position.distanceTo(pl.pos);
        let v;
        if (gap > 4.5) v = Math.min(9, pl.speed + 1.5 + (gap - 4.5) * 0.8); // racing to close the gap
        else if (pl.running) v = pl.speed * (gap < 3.5 ? 0.82 : 0.97);      // breathing down your neck
        else v = CHASE_SPEED;                                               // you slowed down: it gets you
        if (this.pause > 0) v = 0;
        mon.position.addScaledVector(d, Math.min(len, v * dt) / len);
        mon.rotation.y = Math.atan2(d.x, d.z);
      }
      this.wallColliders.pushOut(mon.position, 0.35, 0, 2.2);
      mon.position.y = Math.max(0, mon.position.y);
      // Every so often it stops, twitches and listens.
      this.pause = (this.pause || 0) - dt;
      if (this.pause < -rand(9, 14)) { this.pause = 0.5; a.growl(mon.position, 0.5); }
      if (this.pause > 0) speed = 0.1;

      this.stepTimer -= dt * (speed > 0.5 ? 1 : 0);
      if (this.stepTimer <= 0) { this.stepTimer = 0.42; a.heavyStep(mon.position, 0.9); }

      const dist = mon.position.distanceTo(pl.pos);
      a.setHeart(70 + 90 * clamp(1 - dist / 30, 0, 1), clamp(1.2 - dist / 30, 0.2, 1));
      this.fear = clamp(1 - dist / 22, 0.25, 1);
      if (dist < 1.05 && !this.escaping) this.caught();
    }
    animateChasseur(mon, dt, speed);
  }

  caught() {
    const g = this.game;
    this.phase = 'caught';
    g.lunge.start(this.monster, {
      hold: 0.6,
      onDone: async () => {
        await g.ui.fadeTo(1, 0.15);
        g.audio.setHeart(0, 0);
        await sleep(1.2);
        if (!this.disposed) g.restartLevel();
      },
    });
  }

  // Night outside while you come in; once the chest is open, it is day.
  updateDay(dt) {
    if (!this.night) {
      const c = (x) => x.clone();
      this.night = {
        bg: c(this.scene.background), amb: c(this.ambient.color), ambI: this.ambient.intensity,
        sky: c(this.hemi.color), ground: c(this.hemi.groundColor), hemiI: this.hemi.intensity,
        fill: c(this.moonFill.color), fillI: this.moonFill.intensity, beam: c(this.moon.color),
        cloud: c(this.cloudMat.color), sea: c(this.seaMat.color), glass: c(this.mats.moonGlass.color), orb: c(this.moonSprite.material.color),
      };
    }
    this.dayT = Math.min(1, this.dayT + dt / 2.5);
    const k = this.dayT * this.dayT * (3 - 2 * this.dayT), n = this.night;
    const mix = (target, from, to) => target.copy(from).lerp(_dayC.set(to), k);
    mix(this.scene.background, n.bg, 0x8fbbe6);
    this.scene.fog.color.copy(this.scene.background);
    this.scene.fog.density = 0.006 - 0.0025 * k;
    mix(this.ambient.color, n.amb, 0xfff2e0);
    this.ambient.intensity = n.ambI + 0.4 * k;
    mix(this.hemi.color, n.sky, 0xd4e8ff);
    mix(this.hemi.groundColor, n.ground, 0x7a6a56);
    this.hemi.intensity = n.hemiI + 0.6 * k;
    mix(this.moonFill.color, n.fill, 0xfff0d0);
    this.moonFill.intensity = n.fillI + 30 * k;
    mix(this.moon.color, n.beam, 0xfff4dc);
    mix(this.cloudMat.color, n.cloud, 0xffffff);
    this.cloudMat.opacity = 0.75 + 0.2 * k;
    mix(this.seaMat.color, n.sea, 0xe4eef6);
    mix(this.mats.moonGlass.color, n.glass, 0xcfe4f8);
    mix(this.moonSprite.material.color, n.orb, 0xfff6d8);
    this.moonSprite.scale.setScalar(90 + 60 * k);
    this.starMat.opacity = 1 - k;
  }

  // Unlit candles on the floor from the chest to the balcony. They light in sequence once
  // the chest is opened, so there is a trail of flames to follow out.
  buildCandleTrail() {
    const pts = this.escapeRoute.map(([i, j]) => new THREE.Vector3(cc(i), 0, cc(j)));
    pts.push(new THREE.Vector3(this.bal.x1 - 0.6, 0, cc(this.balCell[1])));
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.8 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd090 });
    const glowMat = new THREE.SpriteMaterial({ map: tex('glow'), color: 0xffb060, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const stick = new THREE.CylinderGeometry(0.04, 0.045, 0.22, 8);
    const flameGeo = new THREE.ConeGeometry(0.035, 0.11, 6);
    this.trail = [];
    let side = 1, carry = 1.2;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], len = a.distanceTo(b);
      const dir = b.clone().sub(a).normalize(), perp = new THREE.Vector3(-dir.z, 0, dir.x);
      for (let d = carry; d < len; d += 1.8) {
        const p = a.clone().addScaledVector(dir, d).addScaledVector(perp, side * 0.55);
        side = -side;
        const c = new THREE.Mesh(stick, wax);
        c.position.copy(p).setY(0.11);
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.copy(p).setY(0.28);
        const glow = new THREE.Sprite(glowMat);
        glow.scale.setScalar(1.1);
        glow.position.copy(flame.position);
        flame.visible = glow.visible = false;
        this.scene.add(c, flame, glow);
        this.trail.push({ p: flame.position.clone(), flame, glow });
        carry = d + 1.8 - len;
      }
      if (carry < 0) carry = 0;
    }
  }

  blurSpots() {
    const out = super.blurSpots();
    const m = this.monster, pl = this.game.player;
    if (m && m.visible && (this.phase === 'rising' || this.phase === 'chase')
      && !this.wallColliders.segmentBlocked(m.position.x, m.position.z, pl.pos.x, pl.pos.z, 1.2)) {
      this.blurPos = (this.blurPos || new THREE.Vector3()).copy(m.position);
      this.blurPos.y += 1.2;
      out.push({ pos: this.blurPos, radius: 2.8, strength: 0.6 });
    }
    return out;
  }

  // ---------- Per-frame ----------
  groundAt(x, z) {
    if (Math.abs(x) <= -O + 0.2 && Math.abs(z) <= -O + 0.2) return 0;
    if (x >= -8.2 && x <= 8.2 && z >= 26.8 && z <= 34.4) return 0;
    const b = this.bal;
    if (x >= b.x0 - 0.2 && x <= b.x1 && z >= b.z0 && z <= b.z1) return 0;
    return -1e9;
  }

  enter() {
    const ui = this.game.ui;
    ui.think('A house. Floating above the clouds.', 3.5);
    ui.think('Something is waiting inside. I can feel it.', 3.5);
  }

  async fellBeforeChest() {
    const g = this.game, pl = g.player;
    this.falling = true;
    pl.enabled = false;
    await g.ui.fadeTo(1, 0.8);
    if (this.disposed) return;
    pl.place(this.spawn.pos, this.spawn.forward);
    g.ui.fadeTo(0, 1.5);
    g.ui.think('Not yet. Something is waiting at the center of the house.', 4);
    pl.enabled = true;
    this.falling = false;
  }

  update(dt) {
    super.update(dt);
    const pl = this.game.player;
    if (this.lidTarget !== undefined) this.lid.rotation.x += (-this.lidTarget - this.lid.rotation.x) * Math.min(1, dt * (this.lidTarget > 1 ? 18 : 1.5));
    if (this.moonTarget) this.moon.intensity += (this.moonTarget - this.moon.intensity) * Math.min(1, dt * 0.5);
    if (this.dayT !== undefined && this.dayT < 1) this.updateDay(dt);
    // Light the floor candles one after another, then let the light pool use them.
    if (this.trailT !== undefined && this.trail) {
      this.trailT += dt;
      let lit = 0;
      this.trail.forEach((c, k) => {
        if (!c.flame.visible && this.trailT > 0.5 + k * 0.15) {
          c.flame.visible = c.glow.visible = true;
          if (k % 3 === 0) this.game.audio.breath(c.p, 0.12);
          this.trailDirty = true;
        }
        if (c.flame.visible) {
          lit++;
          c.flame.scale.y = 0.85 + Math.random() * 0.3;
          c.glow.material.opacity = 0.65 + Math.random() * 0.2;
        }
      });
      if (this.trailDirty) {
        this.trailDirty = false;
        const route = this.candles.filter((c) => c.route).map((c) => c.p);
        this.lightPool.positions = route.concat(this.trail.filter((c) => c.flame.visible).map((c) => c.p));
        this.lightPool.timer = 0;
      }
    }
    if (this.curtains) {
      const t = performance.now() * 0.001;
      for (const c of this.curtains) {
        const pos = c.m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = c.base[i * 3 + 1];
          const sway = (1 - (y + DOOR_H / 2) / DOOR_H) * (0.5 + 0.3 * Math.sin(t * 2.3 + y * 2));
          pos.setX(i, c.base[i * 3] - sway);
        }
        pos.needsUpdate = true;
      }
    }
    if (this.monster && ['rising', 'chase'].includes(this.phase)) this.updateChase(dt);
    if (this.phase === 'explore' || this.phase === 'opening') this.fear = Math.max(0, this.fear - dt);

    if (pl.pos.y < -3 && !this.falling && !this.escaping) {
      if (this.phase === 'explore') this.fellBeforeChest();
      else {
        this.escaping = true;
        this.game.audio.setHeart(0, 0);
        this.game.nextLevel(0.7);
      }
    }
  }

  dispose() {
    this.game.player.staminaDuration = 7;
    this.disposed = true;
    this.game.audio.setHeart(0, 0);
    if (this.monster) { this.scene.remove(this.monster); disposeChasseur(this.monster); }
    super.dispose();
  }
}

import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { Batch, M, box, chair, deadTree, streetlamp } from '../props/common.js';
import { tex } from '../core/textures.js';
import { mulberry32, clamp, sleep } from '../core/util.js';
import { ColliderSet } from '../core/collision.js';
import { buildChasseur, animateChasseur, idleTwitch, disposeChasseur } from '../monsters/chasseur.js';
import { onScreen } from '../monsters/shared.js';

const _head = new THREE.Vector3();
import { Voyer } from '../monsters/voyer.js';
import { Disciple } from '../monsters/disciple.js';

const B = 7;        // base maze size; the labyrinth is twice that
const N = B * 2;    // cells per side
const CELL = 5;
const O = -(N * CELL) / 2;
const WH = 9;       // wall height
const WT = 0.8;     // wall thickness

const cx = (i) => O + (i + 0.5) * CELL;

// A unicursal labyrinth: one corridor, no forks. Built by tracing around the walls of an
// ordinary B x B maze: every passage of that maze becomes a there-and-back pair of lanes,
// which joins every cell of the N x N grid into a single loop. Cutting the loop once at the
// start gives one path from the entrance to the end.
// h[j][i]: wall on the north edge of cell (i, j); v[j][i]: wall on the west edge.
export function generateLabyrinth(seed) {
  const rng = mulberry32(seed);
  // Base maze ("growing tree": half backtracker, half random pick, so it has plenty of
  // dead ends to become U-turns and rooms). pass[j][i] = { n, s, w, e } openings.
  const pass = Array.from({ length: B }, () => Array.from({ length: B }, () => ({ n: false, s: false, w: false, e: false })));
  const seen = Array.from({ length: B }, () => Array(B).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const at = rng() < 0.5 ? stack.length - 1 : Math.floor(rng() * stack.length);
    const [i, j] = stack[at];
    const opts = [[i, j - 1, 'n', 's'], [i, j + 1, 's', 'n'], [i - 1, j, 'w', 'e'], [i + 1, j, 'e', 'w']]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < B && b < B && !seen[b][a]);
    if (!opts.length) { stack.splice(at, 1); continue; }
    const [a, b, d, back] = opts[Math.floor(rng() * opts.length)];
    pass[j][i][d] = true;
    pass[b][a][back] = true;
    seen[b][a] = true;
    stack.push([a, b]);
  }

  const h = Array.from({ length: N + 1 }, () => Array(N).fill(true));
  const v = Array.from({ length: N }, () => Array(N + 1).fill(true));
  for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
    const p = pass[j][i], x = 2 * i, y = 2 * j;
    // Inside each base cell, a wall splits the lanes of each passage that leaves it.
    v[y][x + 1] = p.n;          // TL | TR
    v[y + 1][x + 1] = p.s;      // BL | BR
    h[y + 1][x] = p.w;          // TL / BL
    h[y + 1][x + 1] = p.e;      // TR / BR
    // Between base cells, both lanes run straight through an opening.
    if (p.e) { v[y][x + 2] = false; v[y + 1][x + 2] = false; }
    if (p.s) { h[y + 2][x] = false; h[y + 2][x + 1] = false; }
  }
  const lab = { h, v, pass };
  // Cut the loop next to the start, then walk it from there.
  const start = [0, 0];
  const [first, cut] = openNeighbours(lab, ...start);
  if (cut[0] === start[0]) h[Math.max(cut[1], start[1])][start[0]] = true;
  else v[start[1]][Math.max(cut[0], start[0])] = true;
  const path = [start];
  let prev = start, cur = first;
  while (cur) {
    path.push(cur);
    const next = openNeighbours(lab, ...cur).find((c) => c[0] !== prev[0] || c[1] !== prev[1]);
    prev = cur;
    cur = next;
  }
  lab.path = path;
  return lab;
}

export function openNeighbours(lab, i, j) {
  const out = [];
  if (j > 0 && !lab.h[j][i]) out.push([i, j - 1]);
  if (j < N - 1 && !lab.h[j + 1][i]) out.push([i, j + 1]);
  if (i > 0 && !lab.v[j][i]) out.push([i - 1, j]);
  if (i < N - 1 && !lab.v[j][i + 1]) out.push([i + 1, j]);
  return out;
}

// IV. A pitch-dark labyrinth of tall walls. One way through.
export class Level4Labyrinth extends BaseLevel {
  build() {
    const s = this.scene, mats = this.mats, rng = mulberry32(4444);
    s.background = new THREE.Color(0x040406);
    s.fog = new THREE.FogExp2(0x040406, 0.05);
    s.add(new THREE.HemisphereLight(0x3a4458, 0x0a0806, 0.3));
    const moon = new THREE.DirectionalLight(0x8090b0, 0.18);
    moon.position.set(20, 80, -10);
    s.add(moon);
    this.surface = 'gravel';
    this.desat = 0.35;
    this.ambience = { drone: [41.2, 43.6, 61.7], cutoff: 260, droneVol: 0.07, wind: 0.05, windFreq: 260 };

    const maze = (this.maze = generateLabyrinth(9001));
    const path = maze.path;
    const start = path[0], end = path[path.length - 1];
    this.solutionLength = path.length;
    const index = new Map(path.map((c, k) => [c[0] + ',' + c[1], k]));
    // The key lies on the path a little under halfway along.
    const keyCell = path[Math.floor(path.length * 0.45)];

    // Clearings: widen some of the path's U-turns (dead ends of the base maze) into rooms.
    // The room's four cells are consecutive on the path, so this adds no forks.
    const baseOf = (c) => [c[0] >> 1, c[1] >> 1];
    const avoid = new Set([start, end, keyCell].map((c) => baseOf(c).join(',')));
    const leaves = [];
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const p = maze.pass[j][i];
      if (p.n + p.s + p.w + p.e !== 1 || avoid.has(i + ',' + j)) continue;
      const ks = [[2 * i, 2 * j], [2 * i + 1, 2 * j], [2 * i, 2 * j + 1], [2 * i + 1, 2 * j + 1]].map((c) => index.get(c.join(',')));
      if (Math.max(...ks) - Math.min(...ks) === 3) leaves.push({ i, j, k: Math.min(...ks) });
    }
    leaves.sort((a, b) => a.k - b.k);
    this.clearings = [];
    for (let n = 0; n < 5 && n < leaves.length; n++) {
      const l = leaves[Math.floor(((n + 0.5) / 5) * leaves.length)];
      this.clearings.push(l);
      const x = 2 * l.i, y = 2 * l.j;
      maze.v[y][x + 1] = false; maze.v[y + 1][x + 1] = false;
      maze.h[y + 1][x] = false; maze.h[y + 1][x + 1] = false;
    }

    // Walls, merged into long runs.
    this.wallColliders = new ColliderSet(8); // what the Chasseur collides with
    this.pathIndex = index;
    const b = new Batch();
    for (let j = 0; j <= N; j++) {
      let i = 0;
      while (i < N) {
        if (!maze.h[j][i]) { i++; continue; }
        let k = i;
        while (k + 1 < N && maze.h[j][k + 1]) k++;
        const x0 = O + i * CELL - WT / 2, x1 = O + (k + 1) * CELL + WT / 2, z = O + j * CELL;
        b.add(box(x1 - x0, WH, WT, 3), 'moss', M((x0 + x1) / 2, WH / 2, z), 0xffffff);
        this.colliders.add(x0, z - WT / 2, x1, z + WT / 2, -5, WH);
        this.wallColliders.add(x0, z - WT / 2, x1, z + WT / 2, -5, WH);
        i = k + 1;
      }
    }
    for (let i = 0; i <= N; i++) {
      let j = 0;
      while (j < N) {
        if (!maze.v[j][i]) { j++; continue; }
        let k = j;
        while (k + 1 < N && maze.v[k + 1][i]) k++;
        const z0 = O + j * CELL - WT / 2, z1 = O + (k + 1) * CELL + WT / 2, x = O + i * CELL;
        b.add(box(WT, WH, z1 - z0, 3), 'moss', M(x, WH / 2, (z0 + z1) / 2), 0xffffff);
        this.colliders.add(x - WT / 2, z0, x + WT / 2, z1, -5, WH);
        this.wallColliders.add(x - WT / 2, z0, x + WT / 2, z1, -5, WH);
        j = k + 1;
      }
    }
    const floor = new THREE.PlaneGeometry(N * CELL + 20, N * CELL + 20);
    floor.rotateX(-Math.PI / 2);
    b.add(floor, 'dirt', null, 0x888888);

    this.buildClearings(b, rng);
    s.add(b.build(mats));
    mats.dirt.map = tex('dirt', 30);
    mats.moss.color.set(0xb4b4a8);
    mats.dirt.color.set(0xb0a898);

    // Voyer peeks around the ends of walls.
    this.voyerSpots = this.cornerSpots();

    const facing = (cell, toward) => Math.atan2(toward[0] - cell[0], toward[1] - cell[1]);
    this.addEntryDoor(new THREE.Vector3(cx(start[0]), 0, cx(start[1])), facing(start, path[1]));
    this.addExitDoor(new THREE.Vector3(cx(end[0]), 0, cx(end[1])), facing(end, path[path.length - 2]));
    this.addKey(new THREE.Vector3(cx(keyCell[0]), 0, cx(keyCell[1])));
    this.keyCell = keyCell;
    this.endCell = end;

    this.monsters.push(new Voyer(this.game, this, { firstDelay: 10, minDist: 7, maxDist: 28, flee: 5, cooldown: [5, 12] }));
    this.monsters.push(new Disciple(this.game, this, { firstDelay: 4, minBack: 14, maxBack: 22, vanish: 7, respawn: [12, 30] }));
    this.voyerLine = 'Something pale. At the end of the corridor.';
    this.discipleLine = 'It\'s walking exactly where I walked.';
    this.lockedLine = 'Locked. The key must be further along the path.';
    this.keyLine = 'The key. Keep following the path.';
    this.events = [
      () => this.game.audio.whisper(this.aroundPlayer(3, true), 0.35),
      () => this.game.audio.distantFootsteps(this.aroundPlayer(10, true), 4),
      () => { this.flickerT = 1.6; this.game.audio.breath(this.aroundPlayer(2, true), 0.4); },
      () => this.game.audio.slam(this.aroundPlayer(30), 0.7),
    ];
    this.flickerT = 0;
    this.lostTimer = 100;
  }

  buildClearings(b, rng) {
    const centre = (l) => [O + (2 * l.i + 1) * CELL, O + (2 * l.j + 1) * CELL];
    const CLEARINGS = this.clearings;
    if (CLEARINGS.length < 5) console.warn('labyrinth: only', CLEARINGS.length, 'clearings');
    // 1. A black monolith.
    if (CLEARINGS[0]) {
      const [x, z] = centre(CLEARINGS[0]);
      b.add(box(1.4, 7, 0.45, 2), 'metal', M(x, 3.5, z, 0.4), 0x111111);
      this.colliders.addCentered(x, z, 1.5, 1.5);
    }
    // 2. A giant empty chair.
    if (CLEARINGS[1]) {
      const [x, z] = centre(CLEARINGS[1]);
      chair(b, M(x, 0, z, 2.2), 5, 0x5a3e2c);
      this.colliders.addCentered(x, z, 2.8, 2.8, -1, 2.6);
    }
    // 3. A phone booth that rings until you come close. Something is crammed inside it.
    if (CLEARINGS[2]) {
      const [x, z] = centre(CLEARINGS[2]);
      this.buildBooth(x, z);
    }
    // 4. A still black pool and a dead tree.
    if (CLEARINGS[3]) {
      const [x, z] = centre(CLEARINGS[3]);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(3.5, 32), new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.02, metalness: 1 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.02, z);
      this.scene.add(pool);
      deadTree(b, M(x + 4, 0, z - 4, 1), rng, 8);
      this.colliders.addCentered(x + 4, z - 4, 0.7, 0.7);
    }
    // 5. A doorframe to nowhere under a buzzing lamp.
    if (CLEARINGS[4]) {
      const [x, z] = centre(CLEARINGS[4]);
      for (const sx of [-1, 1]) b.add(box(0.15, 2.4, 0.2), 'wood', M(x + sx * 0.62, 1.2, z), 0x4a3426);
      b.add(box(1.4, 0.15, 0.2), 'wood', M(x, 2.4, z), 0x4a3426);
      this.colliders.addCentered(x - 0.62, z, 0.2, 0.25);
      this.colliders.addCentered(x + 0.62, z, 0.2, 0.25);
      const lamp = streetlamp(b, M(x + 3, 0, z + 3, -2.3), 4.2);
      this.colliders.addCentered(x + 3, z + 3, 0.3, 0.3);
      this.addLightPool([lamp], { count: 1, intensity: 14, distance: 14, flicker: 0.25, halo: 3 });
      this.emitters.push(this.game.audio.emitter('buzz', lamp, { ref: 2, gain: 1 }));
    }
  }

  buildBooth(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const red = new THREE.MeshStandardMaterial({ color: 0x5a1a14, roughness: 0.7 });
    const pane = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.15, metalness: 0.5 });
    const sign = new THREE.MeshBasicMaterial({ color: 0xb8a878 });
    const add = (geo, mat, px, py, pz, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      parent.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(1.3, 0.15, 1.3), red, 0, 0.075, 0);
    add(new THREE.BoxGeometry(1.38, 0.28, 1.38), red, 0, 2.64, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.1, 2.5, 0.1), red, sx * 0.6, 1.25, sz * 0.6);
    // Solid walls with blacked-out windows: you can't see in.
    add(new THREE.BoxGeometry(1.1, 2.3, 0.05), red, 0, 1.3, -0.6);
    add(new THREE.BoxGeometry(0.9, 1.3, 0.02), pane, 0, 1.55, -0.63);
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.05, 2.3, 1.1), red, sx * 0.6, 1.3, 0);
      add(new THREE.BoxGeometry(0.02, 1.3, 0.9), pane, sx * 0.63, 1.55, 0);
    }
    // A dim sign band around the top.
    for (const [sx, sz, w, d] of [[0, 0.7, 1.0, 0.02], [0, -0.7, 1.0, 0.02], [0.7, 0, 0.02, 1.0], [-0.7, 0, 0.02, 1.0]]) {
      add(new THREE.BoxGeometry(w, 0.12, d), sign, sx, 2.62, sz);
    }
    // The door, hinged on the left.
    const pivot = new THREE.Group();
    pivot.position.set(-0.55, 0, 0.6);
    g.add(pivot);
    add(new THREE.BoxGeometry(1.1, 2.3, 0.05), red, 0.55, 1.3, 0, pivot);
    add(new THREE.BoxGeometry(0.85, 1.3, 0.02), pane, 0.55, 1.55, 0.035, pivot);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a7a50, metalness: 0.8, roughness: 0.3 }), 0.98, 1.15, 0.05, pivot);
    // Standing upright inside, head bowed, arms hanging: it fits, barely.
    const mon = buildChasseur();
    mon.scale.setScalar(0.78);
    mon.position.set(0, 0.19, -0.04);
    const u = mon.userData;
    u.spine.rotation.x = 0.1;
    u.head.rotation.x = 0.3;
    for (const arm of u.arms) { arm.shoulder.rotation.set(0, 0, arm.s * 0.03); arm.elbow.rotation.x = -0.05; }
    g.add(mon);
    this.scene.add(g);
    this.monster = mon;
    this.colliders.addCentered(x, z, 1.4, 1.4);

    this.booth = { group: g, pivot, x, z, opened: false, doorTarget: 0, warned: false };
    this.phonePos = new THREE.Vector3(x, 1.4, z);
    this.phone = this.game.audio.emitter('phone', this.phonePos, { ref: 6, rolloff: 0.7, gain: 3.5, delay: 2 }); // loud, and carries through the maze
    this.emitters.push(this.phone);
    this.phoneRinging = true;
    this.interactables.push({
      object: g,
      prompt: () => (this.booth.opened ? null : 'Open the booth'),
      act: () => this.openBooth(),
    });
  }

  cellIndexOf(p) {
    const i = clamp(Math.floor((p.x - O) / CELL), 0, N - 1), j = clamp(Math.floor((p.z - O) / CELL), 0, N - 1);
    return this.pathIndex.get(i + ',' + j);
  }

  async openBooth() {
    const bo = this.booth, g = this.game, a = g.audio;
    if (bo.opened) return;
    bo.opened = true;
    if (this.phoneRinging) { this.phoneRinging = false; this.phone.stop(); }
    g.player.enabled = false;
    a.creak(this.phonePos, 0.4, 0.5);
    await sleep(0.25);
    if (this.disposed) return;
    // The door bursts open and it comes straight out at you.
    bo.doorTarget = -1.9;
    const mon = this.monster;
    this.scene.attach(mon);
    mon.scale.setScalar(0.88);
    this.monsters.forEach((m) => (m.hide ? m.hide(9999) : ((m.state = 'absent'), (m.timer = 9999), (m.mesh.visible = false))));
    this.fear = 1;
    const out = new THREE.Vector3(g.player.pos.x - bo.x, 0, g.player.pos.z - bo.z).normalize();
    const settle = new THREE.Vector3(bo.x, 0, bo.z).addScaledVector(out, 1.1);
    g.lunge.start(mon, {
      hold: 0.55,
      settle,
      onDone: () => {
        mon.userData.spine.rotation.x = 0.45;
        mon.userData.head.rotation.x = -0.5;
        g.player.enabled = true;
        this.chasing = true;
        this.chaseDelay = 1.0; // a second's head start
        g.player.noRun = true; // no sprinting away from this one
        this.chaseTime = 0;
        this.stepTimer = 0;
        g.ui.think('RUN.', 1.5);
      },
    });
  }

  updateChase(dt) {
    const g = this.game, pl = g.player, mon = this.monster, a = g.audio;
    let speed = 0;
    this.chaseDelay -= dt;
    if (this.chaseDelay <= 0) {
      this.chaseTime += dt;
      const path = this.maze.path;
      const mi = this.cellIndexOf(mon.position), pi = this.cellIndexOf(pl.pos);
      const target = new THREE.Vector3();
      if (Math.abs(pi - mi) <= 1) target.copy(pl.pos);
      else {
        // Follow the corridor: aim for the opening into the next cell along the path.
        const next = path[mi + Math.sign(pi - mi)], cur = path[mi];
        target.set((cx(cur[0]) + cx(next[0])) / 2, 0, (cx(cur[1]) + cx(next[1])) / 2);
        if (target.distanceTo(mon.position) < 0.6) target.set(cx(next[0]), 0, cx(next[1]));
      }
      const d = target.sub(mon.position).setY(0), len = d.length();
      if (len > 0.01) {
        speed = 1;
        // Just under walking speed (it cuts corners tighter than you)... unless you turn around to look at it.
        _head.copy(mon.position).setY(1.7);
        const watched = onScreen(g.camera, _head) && !this.wallColliders.segmentBlocked(mon.position.x, mon.position.z, pl.pos.x, pl.pos.z, 1.2);
        this.chaseSpeed = THREE.MathUtils.lerp(this.chaseSpeed ?? 2.9, watched ? 4.6 : 2.9, Math.min(1, dt * 4));
        mon.position.addScaledVector(d, Math.min(len, this.chaseSpeed * dt) / len);
        mon.rotation.y = Math.atan2(d.x, d.z);
      }
      this.wallColliders.pushOut(mon.position, 0.35, 0, 2.2);
      mon.position.y = 0;
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.stepTimer = 0.42; a.heavyStep(mon.position, 0.9); }
      const dist = mon.position.distanceTo(pl.pos);
      a.setHeart(70 + 90 * clamp(1 - dist / 30, 0, 1), clamp(1.2 - dist / 30, 0.2, 1));
      this.fear = clamp(1 - dist / 22, 0.25, 1);
      if (dist < 1.05) this.caught();
      // Far enough ahead, or long enough, and it melts back into the dark.
      else if (Math.abs(pi - mi) > 14 || this.chaseTime > 50) this.giveUp();
    }
    animateChasseur(mon, dt, speed);
  }

  giveUp() {
    this.chasing = false;
    this.game.player.noRun = false;
    this.monster.visible = false;
    this.fear = 0;
    this.game.audio.setHeart(0, 0);
    this.game.audio.growl(this.monster.position, 0.4);
    this.game.ui.think("It's gone. I think it's gone.", 3);
  }

  caught() {
    const g = this.game;
    this.chasing = false;
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

  blurSpots() {
    const out = super.blurSpots();
    const m = this.monster, pl = this.game.player;
    if (this.chasing && m.visible && !this.wallColliders.segmentBlocked(m.position.x, m.position.z, pl.pos.x, pl.pos.z, 1.2)) {
      this.blurPos = (this.blurPos || new THREE.Vector3()).copy(m.position);
      this.blurPos.y += 1.2;
      out.push({ pos: this.blurPos, radius: 2.8, strength: 0.6 });
    }
    return out;
  }

  enter() {
    const cam = this.game.camera;
    this.flash = new THREE.SpotLight(0xfff0d6, 80, 38, 0.52, 0.55, 1.3);
    this.flash.position.set(0.2, -0.25, 0.1);
    this.flash.target.position.set(0, 0, -6);
    cam.add(this.flash, this.flash.target);
    const ui = this.game.ui;
    ui.think('So dark. At least I have a light.', 3.5);
    ui.think('Walls. Nothing but walls.', 3);
  }

  update(dt) {
    super.update(dt);
    const pl = this.game.player;
    if (this.flash) {
      this.flickerT = Math.max(0, this.flickerT - dt);
      let i = 80;
      const scared = this.maxFear > 0.35;
      if (this.flickerT > 0 || (scared && Math.random() < dt * 4)) i *= Math.random() < 0.5 ? 0.05 : 0.6;
      this.flash.intensity = i;
    }
    const bo = this.booth;
    if (bo) {
      bo.pivot.rotation.y += (bo.doorTarget - bo.pivot.rotation.y) * Math.min(1, dt * 10);
      if (!bo.opened) idleTwitch(this.monster, dt);
      if (!bo.opened && !bo.warned && pl.pos.distanceTo(this.phonePos) < 3.2) {
        bo.warned = true;
        this.game.audio.breath(this.phonePos, 0.6);
      }
      if (this.chasing) this.updateChase(dt);
      else if (bo.opened && this.fear > 0) this.fear = Math.max(0, this.fear - dt);
    }
    this.lostTimer -= dt;
    if (this.lostTimer < 0) {
      this.lostTimer = 9999;
      this.game.ui.think('I\'ve been here before. Haven\'t I?', 3.5);
    }
  }

  dispose() {
    this.game.player.noRun = false;
    this.disposed = true;
    this.game.audio.setHeart(0, 0);
    if (this.monster) { this.monster.parent?.remove(this.monster); disposeChasseur(this.monster); }
    if (this.flash) {
      this.game.camera.remove(this.flash, this.flash.target);
      this.flash.dispose();
    }
    super.dispose();
  }
}

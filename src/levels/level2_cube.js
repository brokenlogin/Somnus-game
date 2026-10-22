import * as THREE from 'three';
import { BaseLevel } from './base.js';
import { Batch, M, box, deadTree, bench, rock, shed, streetlamp, fence, house } from '../props/common.js';
import { tex } from '../core/textures.js';
import { mulberry32, smoothstep, rand } from '../core/util.js';
import { Voyer } from '../monsters/voyer.js';
import { Disciple } from '../monsters/disciple.js';

const H = 56; // half the cube's side
const S = H / 24; // the layout below was designed for a 48 m cube; landmarks spread out by this
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Each face: normal n and tangents t1, t2 with t1 x t2 = n.
const FACES = [
  [V(0, 1, 0), V(0, 0, 1)],
  [V(0, -1, 0), V(0, 0, 1)],
  [V(1, 0, 0), V(0, 1, 0)],
  [V(-1, 0, 0), V(0, 1, 0)],
  [V(0, 0, 1), V(1, 0, 0)],
  [V(0, 0, -1), V(1, 0, 0)],
].map(([n, t1]) => ({ n, t1, t2: new THREE.Vector3().crossVectors(n, t1) }));
const TOP = 0, BOTTOM = 1, PX = 2, NX = 3, PZ = 4, NZ = 5;
// Level ground around the doors, the pond, the shed and the house front.
// [face, u, v (layout coords, scaled by S), radius, du, dv (extra metres)]
const FLAT = [[TOP, -8, 0, 2.5], [BOTTOM, 0, 0, 3], [NX, 0, 0, 6], [PX, 2, 3, 4.5, 0, 1.5], [PZ, -4, 0, 5.5],
  // A strip along the fence on the +Z face so it sits on the ground.
  ...[-7, -3.5, 0, 3.5, 7].map((du) => [PZ, 6, -6, 2.2, du, 0]),
  // Odd structures (positions in real metres).
  [NZ, 0, 0, 13, 0, -28],   // giant chessboard
  [PX, 0, 0, 10, -24, -25], // stairs to nowhere
  [TOP, 0, 0, 9, 25, 25],   // empty swimming pool
  [BOTTOM, 0, 0, 9, -25, -25], // clock face in the grass
  [PZ, 0, 0, 7, 30, 25],    // a lone wall with a lit window
];

const _q = new THREE.Quaternion();
const _eye = new THREE.Vector3();
const _p = new THREE.Vector3();

function faceIndexOf(dir) {
  return FACES.findIndex((f) => f.n.dot(dir) > 0.9);
}

// II. A tiny cube-shaped world. Walk off an edge and gravity turns with you.
export class Level2Cube extends BaseLevel {
  build() {
    const s = this.scene, mats = this.mats, rng = mulberry32(2024);
    s.background = new THREE.Color(0xa7aba2);
    s.fog = new THREE.FogExp2(0xa7aba2, 0.026);
    s.add(new THREE.AmbientLight(0xc8ccc4, 1.25));
    const l1 = new THREE.DirectionalLight(0xe0e2da, 0.9);
    l1.position.set(40, 70, 25);
    const l2 = new THREE.DirectionalLight(0x9aa0a8, 0.5);
    l2.position.set(-50, -40, -30);
    s.add(l1, l2);
    this.surface = 'grass';
    this.gravity = 14;
    this.ambience = { drone: [61.7, 92.5, 123.5], cutoff: 450, droneVol: 0.05, wind: 0.17, windFreq: 620 };
    this.seeds = FACES.map(() => [rng() * 6, rng() * 6, rng() * 6, 0.45 + rng() * 0.5]);
    this.obstacles = FACES.map(() => []);
    this.face = TOP;

    // Terrain.
    const terrainMat = new THREE.MeshStandardMaterial({ map: tex('grass', 14), roughness: 1, vertexColors: true });
    FACES.forEach((f, fi) => {
      const g = new THREE.PlaneGeometry(2 * H, 2 * H, 96, 96);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), v = pos.getY(i), h = this.height(fi, u, v);
        _p.copy(f.n).multiplyScalar(H + h).addScaledVector(f.t1, u).addScaledVector(f.t2, v);
        pos.setXYZ(i, _p.x, _p.y, _p.z);
        const shade = 0.88 + h * 0.12 + (Math.sin(u * 0.7 + fi) * Math.cos(v * 0.5)) * 0.06;
        col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade * 0.92;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      s.add(new THREE.Mesh(g, terrainMat));
    });

    this.buildTufts(rng);

    const b = new Batch();
    const lamps = [];
    // Layout positions are in 48 m-cube units; P() spreads them over the bigger cube.
    const P = (x) => x * S;
    const tree = (fi, u, v, h = 5) => {
      u = P(u); v = P(v);
      deadTree(b, this.place(fi, u, v, rng() * 6), rng, h);
      this.obstacles[fi].push([u, v, 0.45]);
      this.voyerSpots.push({ p: this.surfacePoint(fi, u + 0.7, v), up: FACES[fi].n.clone() });
    };
    const stone = (fi, u, v, r, raw = false) => {
      if (!raw) { u = P(u); v = P(v); }
      rock(b, this.place(fi, u, v, rng() * 6), r, rng);
      this.obstacles[fi].push([u, v, r * 0.9]);
    };

    // Top: where you arrive.
    tree(TOP, 8, 6); tree(TOP, -10, -9, 6); tree(TOP, 12, -12);
    bench(b, this.place(TOP, P(4), P(-6), Math.PI / 2));
    this.obstacles[TOP].push([P(4), P(-6), 1]);
    lamps.push(streetlamp(b, this.place(TOP, P(-8) + 3, 3, 0)));
    stone(TOP, -6, 10, 0.9);

    // +X: a shed, and the key behind it.
    shed(b, this.place(PX, P(2), P(3), Math.PI));
    this.obstacles[PX].push([P(2), P(3), 1.9]);
    tree(PX, -9, 7, 6); tree(PX, 10, -8); tree(PX, -4, -12);
    stone(PX, 8, 10, 1.2); stone(PX, 9, 11.5, 0.6);

    // -X: a black pond.
    const pond = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshStandardMaterial({ color: 0x0a0c0c, roughness: 0.05, metalness: 0.9 }));
    pond.applyMatrix4(this.place(NX, 0, 0, 0, 0.04).multiply(M(0, 0, 0, 0, -Math.PI / 2)));
    s.add(pond);
    this.obstacles[NX].push([0, 0, 4.6]);
    for (let i = 0; i < 6; i++) { const a = i * 1.05; stone(NX, Math.cos(a) * 5.6, Math.sin(a) * 5.6, 0.4 + rng() * 0.4, true); }
    tree(NX, -12, 9, 7); tree(NX, 11, 11); tree(NX, 13, -10, 6);

    // +Z: the front of a house, with nothing behind it.
    // Its front door is the way out.
    const hu = P(-4);
    house(b, this.place(PZ, hu, 0, 0), { w: 9, d: 0.6, h: 6, rng, litChance: 0.4, sideWindows: false, door: false });
    this.obstacles[PZ].push({ u0: hu - 0.3, u1: hu + 0.3, v0: -4.6, v1: 4.6 });
    fence(b, this.place(PZ, P(6), P(-6), Math.PI / 2), 14);
    for (let k = -7; k <= 7; k += 1.2) this.obstacles[PZ].push([P(6) + k, P(-6), 0.2]);
    tree(PZ, 10, 10); tree(PZ, -12, -12, 6);

    // -Z: telephone poles walking off into nothing.
    for (let k = -20; k <= 20; k += 10) {
      const m = this.place(NZ, P(k), P(6), 0);
      b.add(new THREE.CylinderGeometry(0.12, 0.16, 8, 6), 'bark', m.clone().multiply(M(0, 4, 0)), 0x6a5a4a);
      b.add(box(2, 0.12, 0.12), 'bark', m.clone().multiply(M(0, 7.4, 0)), 0x6a5a4a);
      this.obstacles[NZ].push([P(k), P(6), 0.3]);
    }
    lamps.push(streetlamp(b, this.place(NZ, P(-6), P(-8), 0)));
    stone(NZ, 8, -6, 1); tree(NZ, -12, -10);

    // Bottom: the exit door, a lamp and a ring of stones.
    lamps.push(streetlamp(b, this.place(BOTTOM, 3, 3, 0)));
    for (let i = 0; i < 9; i++) { const a = i * 0.7; stone(BOTTOM, Math.cos(a) * 7, Math.sin(a) * 7, 0.5 + rng() * 0.3, true); }
    tree(BOTTOM, 12, -10, 6); tree(BOTTOM, -12, 12);

    this.buildOddities(b, lamps);

    // Fill the larger faces with more dead trees and rocks, away from the landmarks.
    for (let fi = 0; fi < 6; fi++) {
      for (let n = 0; n < 22; n++) {
        const u = (rng() - 0.5) * 2 * (H - 5), v = (rng() - 0.5) * 2 * (H - 5);
        const clear = FLAT.every(([ff, fu, fv, r, du = 0, dv = 0]) => ff !== fi || Math.hypot(u - fu * S - du, v - fv * S - dv) > r + 6);
        if (!clear) continue;
        if (n % 3) tree(fi, u / S, v / S, 4 + rng() * 3);
        else stone(fi, u, v, 0.5 + rng() * 0.9, true);
      }
    }
    s.add(b.build(mats));
    this.addLightPool(lamps, { count: 3, intensity: 8, distance: 16, halo: 3 });

    // Voyer only ever peeks over the edge of the world: it clings to the next face down, so from
    // where you stand just its head and shoulders show above the horizon.
    this.voyerSpots = [];
    FACES.forEach((f, fi) => {
      for (const a of [f.t1, f.t2]) for (const sgn of [-1, 1]) {
        const out = a.clone().multiplyScalar(sgn), along = new THREE.Vector3().crossVectors(f.n, out);
        for (let j = -2; j <= 2; j++) {
          const p = f.n.clone().multiplyScalar(H - 1.3).addScaledVector(out, H + 0.25).addScaledVector(along, j * H * 0.35);
          this.voyerSpots.push({ p, up: f.n.clone(), when: () => this.face === fi });
        }
      }
    });

    this.addEntryDoor(this.surfacePoint(TOP, P(-8), 0), 0, this.faceQuat(TOP, 0), FACES[TOP].n);
    this.addExitDoor(this.surfacePoint(PZ, hu + 0.44, 0), 0, this.faceQuat(PZ, 0), { swing: -1 });
    this.addKey(this.surfacePoint(PX, P(2), P(3) + 3.2), FACES[PX].n);

    this.monsters.push(new Voyer(this.game, this, { firstDelay: 12, minDist: 14, maxDist: 42, flee: 16 }));
    this.monsters.push(new Disciple(this.game, this, { firstDelay: 45, minBack: 20, maxBack: 32 }));
    this.voyerLine = 'Something is peeking over the edge of the world.';
    this.discipleLine = 'It follows me even here.';
    this.lockedLine = 'Locked. Of course it is.';
    this.keyLine = 'The key. That house with no back... its door.';
    this.events = [
      () => this.game.audio.whisper(this.aroundPlayer(5, true), 0.3),
      () => this.game.audio.distantFootsteps(this.aroundPlayer(8, true), 3),
      () => this.game.audio.slam(this.aroundPlayer(30), 0.5),
    ];
    this.firstEdge = true;
  }

  // Things that should not be standing in an empty field.
  buildOddities(b, lamps) {
    const box2 = (fi, u0, u1, v0, v1) => this.obstacles[fi].push({ u0, u1, v0, v1 });
    const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 18);
    const BLACK = 0x141414, WHITE = 0xd8d4c8;

    // A giant chessboard, mid-game, one piece knocked over. Squares are 2 m.
    {
      const cu = 0, cv = -28;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        b.add(box(2, 0.08, 2, 2), 'paint', this.place(NZ, cu + (i - 3.5) * 2, cv + (j - 3.5) * 2, 0, 0.04), (i + j) % 2 ? WHITE : BLACK);
      }
      b.add(box(17, 0.1, 17, 4), 'wood', this.place(NZ, cu, cv, 0, 0.0), 0x5a3a24);
      const pawn = [[0, 0], [0.9, 0], [0.9, 0.3], [0.5, 0.5], [0.35, 1.6], [0.6, 1.8], [0.3, 1.95], [0.55, 2.4], [0.5, 2.8], [0.25, 3.05], [0, 3.1]];
      const rook = [[0, 0], [1.0, 0], [1.0, 0.35], [0.65, 0.6], [0.6, 3.0], [0.85, 3.2], [0.85, 3.9], [0, 3.9]];
      const king = [[0, 0], [1.1, 0], [1.1, 0.4], [0.6, 0.7], [0.4, 3.4], [0.75, 3.7], [0.4, 3.95], [0.7, 4.6], [0.3, 5.0], [0, 5.05]];
      const queen = [[0, 0], [1.05, 0], [1.05, 0.4], [0.6, 0.7], [0.38, 3.2], [0.72, 3.5], [0.38, 3.75], [0.8, 4.5], [0.25, 4.7], [0.3, 4.85], [0, 4.95]];
      const piece = (pts, i, j, color, tipped = 0) => {
        const m = this.place(NZ, cu + (i - 3.5) * 2, cv + (j - 3.5) * 2, 0, 0.08);
        if (tipped) m.multiply(M(0, 1.0, 0, tipped, 0, Math.PI / 2));
        b.add(lathe(pts), 'paint', m, color);
        this.obstacles[NZ].push([cu + (i - 3.5) * 2, cv + (j - 3.5) * 2, tipped ? 1.6 : 1.0]);
        return m;
      };
      piece(king, 4, 0, WHITE);
      const km = piece(king, 3, 7, BLACK);
      b.add(box(0.25, 1.2, 0.25), 'paint', km.clone().multiply(M(0, 5.5, 0)), BLACK);
      b.add(box(0.8, 0.25, 0.25), 'paint', km.clone().multiply(M(0, 5.6, 0)), BLACK);
      piece(queen, 2, 5, WHITE);
      piece(rook, 0, 0, WHITE);
      piece(rook, 7, 7, BLACK);
      for (const [i, j] of [[1, 1], [3, 3], [5, 1], [6, 2]]) piece(pawn, i, j, WHITE);
      for (const [i, j] of [[2, 6], [4, 4], [6, 6]]) piece(pawn, i, j, BLACK);
      piece(queen, 5, 6, BLACK, 0.7); // knocked over
    }

    // A wide staircase that climbs six metres and stops.
    {
      const u0 = -30, v0 = -25;
      for (let k = 0; k < 12; k++) {
        const h = (k + 1) * 0.5;
        b.add(box(4, h, 1.2, 2), 'stone', this.place(PX, u0 + k * 1.2, v0, 0).multiply(M(0, h / 2, 0)), 0x9a968e);
      }
      box2(PX, u0 - 0.6, u0 + 14.4 - 0.6, v0 - 2.1, v0 + 2.1);
    }

    // An empty swimming pool, tiles and a ladder, nobody anywhere.
    {
      const pu = 25, pv = 25, W = 12, D = 7, h = 0.55;
      const m = (x, y, z, ry = 0) => this.place(TOP, pu, pv, 0).multiply(M(x, y, z, ry));
      b.add(box(W, 0.1, D, 1), 'paint', m(0, 0.05, 0), 0x9fc8cc);
      for (const sz of [-1, 1]) b.add(box(W + 0.6, h, 0.3, 1), 'paint', m(0, h / 2, sz * (D / 2 + 0.15)), 0xe4e8e4);
      for (const sx of [-1, 1]) b.add(box(0.3, h, D, 1), 'paint', m(sx * (W / 2 + 0.15), h / 2, 0), 0xe4e8e4);
      for (let k = -2; k <= 2; k++) b.add(box(0.05, 0.02, D - 0.2), 'paint', m(k * 2, 0.11, 0), 0x2a5a7a);
      for (const sx of [-0.3, 0.3]) b.add(new THREE.TorusGeometry(0.5, 0.04, 6, 12, Math.PI), 'metal', m(W / 2 - 1.5 + sx, h, D / 2 + 0.3, Math.PI / 2), 0xb0b0b0);
      // A diving board over the empty end.
      b.add(box(0.6, 0.8, 0.6, 1), 'paint', m(-W / 2 - 0.6, 0.4, 0), 0xe4e8e4);
      b.add(box(3.2, 0.08, 0.55, 1), 'paint', m(-W / 2 + 0.9, 0.84, 0), 0x3a6a8a);
      box2(TOP, pu - D / 2 - 0.3, pu + D / 2 + 0.3, pv - W / 2 - 1.0, pv + W / 2 + 0.3);
    }

    // A clock face lying in the grass, its hands stopped.
    {
      const cu = -25, cv = -25;
      const m = (x, y, z, ry = 0) => this.place(BOTTOM, cu, cv, 0).multiply(M(x, y, z, ry));
      b.add(new THREE.CylinderGeometry(7, 7, 0.15, 48), 'paint', m(0, 0.075, 0), 0xe8e0c8);
      b.add(new THREE.TorusGeometry(7, 0.18, 6, 48), 'metal', m(0, 0.15, 0).multiply(M(0, 0, 0, 0, Math.PI / 2)), 0x6a5a3a);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        b.add(box(0.25, 0.04, k % 3 ? 0.9 : 1.6), 'paint', m(Math.sin(a) * 6, 0.17, Math.cos(a) * 6, a), 0x1a1a1a);
      }
      b.add(box(0.3, 0.05, 3.8), 'paint', m(0.9, 0.2, 1.6, 0.52), 0x1a1a1a);
      b.add(box(0.2, 0.05, 5.6), 'paint', m(-1.4, 0.21, -2.2, Math.PI + 0.57), 0x1a1a1a);
      b.add(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 16), 'metal', m(0, 0.24, 0), 0x3a3a3a);
    }

    // A single brick wall in the middle of nowhere. The window is lit.
    {
      const m = (x, y, z) => this.place(PZ, 30, 25, 0).multiply(M(x, y, z));
      b.add(box(8, 5, 0.4, 2.5), 'brick', m(0, 2.5, 0), 0xa0a0a0);
      b.add(box(1.4, 1.6, 0.46), 'glassLit', m(1.2, 2.6, 0));
      b.add(box(1.7, 0.15, 0.6, 1), 'stone', m(1.2, 1.75, 0), 0xb0b0b0);
      box2(PZ, 30 - 0.3, 30 + 0.3, 25 - 4.1, 25 + 4.1);
    }

    // Street lamps in a perfectly straight line, marching over the edge of the world.
    for (let u = -48; u <= 48; u += 8) {
      lamps.push(streetlamp(b, this.place(NX, u, -35, 0)));
      this.obstacles[NX].push([u, -35, 0.25]);
    }
  }

  height(fi, u, v) {
    const [a, b, c, amp] = this.seeds[fi];
    const taper = smoothstep(H, H - 7, Math.abs(u)) * smoothstep(H, H - 7, Math.abs(v));
    let flat = 1;
    for (const [ff, fu, fv, r, du = 0, dv = 0] of FLAT) if (ff === fi) flat *= smoothstep(r, r + 3, Math.hypot(u - fu * S - du, v - fv * S - dv));
    return amp * taper * flat * (Math.sin(u * 0.21 + a) * Math.cos(v * 0.17 + b) + 0.5 * Math.sin(u * 0.43 + v * 0.31 + c));
  }

  surfacePoint(fi, u, v, lift = 0) {
    const f = FACES[fi];
    return new THREE.Vector3().copy(f.n).multiplyScalar(H + this.height(fi, u, v) + lift).addScaledVector(f.t1, u).addScaledVector(f.t2, v);
  }

  faceQuat(fi, ry) {
    const f = FACES[fi];
    const m = new THREE.Matrix4().makeBasis(f.t2, f.n, f.t1).multiply(new THREE.Matrix4().makeRotationY(ry));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // Matrix placing an object upright on face fi at (u, v).
  place(fi, u, v, ry = 0, lift = 0) {
    const f = FACES[fi];
    const m = new THREE.Matrix4().makeBasis(f.t2, f.n, f.t1).multiply(new THREE.Matrix4().makeRotationY(ry));
    m.setPosition(this.surfacePoint(fi, u, v, lift - 0.05));
    return m;
  }

  buildTufts(rng) {
    const blade = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2, x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12, tx = Math.cos(a) * 0.25, tz = Math.sin(a) * 0.25;
      verts.push(-0.04 + x, 0, z, 0.04 + x, 0, z, tx, 0.45 + (i % 2) * 0.15, tz);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5d6640, roughness: 1, side: THREE.DoubleSide });
    const count = 9000;
    const inst = new THREE.InstancedMesh(blade, mat, count);
    for (let i = 0; i < count; i++) {
      const fi = i % 6, u = (rng() - 0.5) * 2 * (H - 0.5), v = (rng() - 0.5) * 2 * (H - 0.5);
      const m = this.place(fi, u, v, rng() * 6);
      m.multiply(M(0, 0, 0, 0, 0, 0, 0.7 + rng() * 0.8));
      inst.setMatrixAt(i, m);
    }
    this.scene.add(inst);
  }

  lineOfSight(a, b) {
    for (let i = 1; i < 24; i++) {
      _p.lerpVectors(a, b, i / 24);
      if (Math.abs(_p.x) < H - 0.3 && Math.abs(_p.y) < H - 0.3 && Math.abs(_p.z) < H - 0.3) return false;
      // Hills block the view too.
      const ax = Math.abs(_p.x), ay = Math.abs(_p.y), az = Math.abs(_p.z);
      const fi = ax >= ay && ax >= az ? (_p.x > 0 ? PX : NX) : ay >= az ? (_p.y > 0 ? TOP : BOTTOM) : (_p.z > 0 ? PZ : NZ);
      const f = FACES[fi], u = _p.dot(f.t1), v = _p.dot(f.t2);
      if (Math.abs(u) <= H && Math.abs(v) <= H && _p.dot(f.n) < H + this.height(fi, u, v) - 0.05) return false;
    }
    return true;
  }

  move(player, delta, dt) {
    const p = player.pos;
    let f = FACES[this.face];
    p.add(delta);

    // Obstacles on the current face: circles [u, v, r] and boxes { u0, u1, v0, v1 }.
    let u = p.dot(f.t1), v = p.dot(f.t2);
    for (const o of this.obstacles[this.face]) {
      let ou, ov, r;
      if (o.u0 !== undefined) {
        ou = Math.max(o.u0, Math.min(u, o.u1));
        ov = Math.max(o.v0, Math.min(v, o.v1));
        r = 0;
        if (ou === u && ov === v) {
          // Inside the box: leave by the nearest side.
          const opts = [[o.u0 - u, 0], [o.u1 - u, 0], [0, o.v0 - v], [0, o.v1 - v]];
          const [mu, mv] = opts.reduce((a, c) => (Math.abs(c[0] + c[1]) < Math.abs(a[0] + a[1]) ? c : a));
          p.addScaledVector(f.t1, mu + Math.sign(mu) * player.radius).addScaledVector(f.t2, mv + Math.sign(mv) * player.radius);
          u = p.dot(f.t1); v = p.dot(f.t2);
          continue;
        }
      } else [ou, ov, r] = o;
      const du = u - ou, dv = v - ov, d = Math.hypot(du, dv), min = r + player.radius;
      if (d < min && d > 1e-6) {
        p.addScaledVector(f.t1, (du / d) * (min - d)).addScaledVector(f.t2, (dv / d) * (min - d));
        u = p.dot(f.t1); v = p.dot(f.t2);
      }
    }
    for (const d of this.doors) d.collide(p, player.radius);

    // Walked off an edge: wrap onto the neighbouring face and turn gravity with us.
    for (const axis of [f.t1, f.t2]) {
      const c = p.dot(axis);
      if (Math.abs(c) <= H) continue;
      const a = axis.clone().multiplyScalar(Math.sign(c));
      const o = Math.abs(c) - H;
      const sH = p.dot(f.n);
      const k = new THREE.Vector3().crossVectors(f.n, a);
      const w = p.dot(k);
      player.eyePosition(_eye, true);
      p.copy(f.n).multiplyScalar(H - o).addScaledVector(a, sH).addScaledVector(k, w);
      _q.setFromUnitVectors(f.n, a);
      player.rotateFrame(_q, _eye);
      this.face = faceIndexOf(a);
      f = FACES[this.face];
      if (this.firstEdge) {
        this.firstEdge = false;
        this.game.ui.think('...the world turned. Or I did.', 3.5);
      }
      break;
    }

    // Gravity along the face normal.
    u = p.dot(f.t1); v = p.dot(f.t2);
    const s = p.dot(f.n), g = H + this.height(this.face, u, v);
    player.vUp -= this.gravity * dt;
    let ns = s + player.vUp * dt;
    const was = player.grounded;
    player.grounded = false;
    if (ns <= g && s >= g - 0.8) { ns = g; player.vUp = 0; player.grounded = true; }
    else if (was && player.vUp <= 0 && s - g < 0.4) { ns = g; player.vUp = 0; player.grounded = true; }
    if (ns < g - 0.8) ns = g; // never sink into the cube
    p.addScaledVector(f.n, ns - s);
  }

  enter() {
    const ui = this.game.ui;
    ui.think('The ground just... stops. Over there.', 3.5);
    ui.think('There is nothing past the edge. Only fog.', 3.5);
  }

  update(dt) {
    super.update(dt);
  }
}

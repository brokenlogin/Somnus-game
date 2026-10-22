import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex } from '../core/textures.js';

const _e = new THREE.Euler();
const _qq = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function M(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _qq.setFromEuler(_e), _s.set(sx, sy, sz));
}

// Box whose UVs are scaled to world units (1 texture repeat per `s` metres).
export function box(w, h, d, s = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s);
    }
  }
  return g;
}

export function prism(len, width, height) {
  const sh = new THREE.Shape();
  sh.moveTo(-width / 2, 0);
  sh.lineTo(width / 2, 0);
  sh.lineTo(0, height);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  // Extrude UVs are in shape units; shrink them.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.5, uv.getY(i) / 2.5);
  return g;
}

// Collects many small geometries and merges them into one mesh per material.
export class Batch {
  constructor() { this.groups = new Map(); }

  add(geo, mat, matrix = null, color = 0xffffff) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
  }

  build(materials) {
    const group = new THREE.Group();
    for (const [key, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const m = materials[key];
      if (!m) { console.warn('missing material', key); continue; }
      const mesh = new THREE.Mesh(merged, m);
      mesh.name = key;
      group.add(mesh);
    }
    this.groups.clear();
    return group;
  }
}

// Standard material palette. Batch materials use vertex colours for variety.
export function makeMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  return {
    siding: std({ map: tex('siding') }),
    roof: std({ map: tex('roof') }),
    stone: std({ map: tex('stone') }),
    brick: std({ map: tex('brick') }),
    moss: std({ map: tex('mossstone') }),
    wood: std({ map: tex('wood') }),
    plaster: std({ map: tex('plaster') }),
    wallpaper: std({ map: tex('wallpaper') }),
    rock: std({ map: tex('rock') }),
    asphalt: std({ map: tex('asphalt') }),
    sidewalk: std({ map: tex('sidewalk') }),
    grass: std({ map: tex('grass') }),
    deadgrass: std({ map: tex('deadgrass') }),
    dirt: std({ map: tex('dirt') }),
    paint: std({}),
    metal: std({ roughness: 0.5, metalness: 0.6 }),
    bark: std({ map: tex('rock'), color: 0x5a4a3c }),
    glassDark: std({ roughness: 0.15, metalness: 0.6, color: 0x15181c }),
    glassLit: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xd9b56c }),
    bulb: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffe2a8 }),
    black: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x000000 }),
  };
}

// ---------- Builders (all add into a Batch, in the given local matrix frame) ----------

// Two-storey-ish suburban house. Front faces +Z in local space.
export function house(b, base, o) {
  const { w, d, h, rng } = o;
  const below = o.below ?? 0.6;
  const tint = o.tint ?? new THREE.Color().setHSL(0.08 + rng() * 0.1, 0.12 + rng() * 0.15, 0.5 + rng() * 0.35).getHex();
  const T = (m) => base.clone().multiply(m);
  b.add(box(w, h, d, 3), 'siding', T(M(0, h / 2, 0)), tint);
  b.add(box(w + 0.25, 0.5 + below, d + 0.25, 2), 'stone', T(M(0, 0.25 - below / 2, 0)), 0x777777);
  const rh = Math.min(w, d) * 0.38;
  b.add(prism(w + 0.7, d + 0.8, rh), 'roof', T(M(0, h, 0)), 0xbbbbbb);
  b.add(box(0.8, rh + 1.2, 0.8, 2), 'brick', T(M(w * 0.28, h + rh * 0.5, -d * 0.15)), 0xaaaaaa);
  const storeys = Math.max(1, Math.round(h / 3));
  const glass = () => (rng() < (o.litChance ?? 0.12) ? 'glassLit' : 'glassDark');
  for (let s = 0; s < storeys; s++) {
    const y = s * 3 + 1.6;
    for (const sx of [-1, 1]) {
      if (s === 0 && o.door !== false && sx === 1 && w < 9) continue;
      b.add(box(1.1, 1.3, 0.08), glass(), T(M(sx * w * 0.28, y, d / 2 + 0.03)));
      b.add(box(1.3, 0.1, 0.2), 'paint', T(M(sx * w * 0.28, y - 0.72, d / 2 + 0.08)), 0xd8d4c8);
      if (o.sideWindows !== false) b.add(box(0.08, 1.3, 1.1), glass(), T(M(sx * (w / 2 + 0.03), y, 0)));
    }
    b.add(box(1.1, 1.3, 0.08), glass(), T(M(0, y, -d / 2 - 0.03)));
  }
  if (o.door !== false) {
    b.add(box(1.05, 2.15, 0.1), 'wood', T(M(w < 9 ? w * 0.22 : 0, 1.07, d / 2 + 0.04)), 0x6b4a36);
    b.add(box(1.8, 0.25, 1.1, 1), 'stone', T(M(w < 9 ? w * 0.22 : 0, 0.12, d / 2 + 0.55)), 0x8a8a8a);
  }
}

export function streetlamp(b, base, h = 4.6) {
  const T = (m) => base.clone().multiply(m);
  b.add(new THREE.CylinderGeometry(0.07, 0.11, h, 6), 'metal', T(M(0, h / 2, 0)), 0x333333);
  b.add(box(0.08, 0.08, 1.2), 'metal', T(M(0, h - 0.05, 0.55)), 0x333333);
  b.add(box(0.4, 0.18, 0.5), 'metal', T(M(0, h - 0.12, 1.1)), 0x2a2a2a);
  b.add(box(0.3, 0.05, 0.38), 'bulb', T(M(0, h - 0.23, 1.1)));
  return new THREE.Vector3(0, h - 0.4, 1.1).applyMatrix4(base);
}

export function deadTree(b, base, rng, h = 5) {
  const T = (m) => base.clone().multiply(m);
  b.add(new THREE.CylinderGeometry(0.12, 0.3, h, 6), 'bark', T(M(0, h / 2, 0)), 0x8a7a68);
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const y = h * (0.45 + rng() * 0.5), len = 1.2 + rng() * 2.2, ry = rng() * Math.PI * 2, tilt = 0.5 + rng() * 0.6;
    const m = T(M(0, y, 0, ry, 0, tilt)).multiply(M(0, len / 2, 0));
    b.add(new THREE.CylinderGeometry(0.03, 0.09, len, 4), 'bark', m, 0x8a7a68);
    const m2 = m.clone().multiply(M(0, len / 2, 0, rng() * 3, 0, 0.6)).multiply(M(0, len * 0.25, 0));
    b.add(new THREE.CylinderGeometry(0.015, 0.04, len * 0.5, 3), 'bark', m2, 0x8a7a68);
  }
}

export function fence(b, base, length, h = 1.1, color = 0xc8c2b4) {
  const T = (m) => base.clone().multiply(m);
  for (let x = 0; x <= length + 0.01; x += 2) b.add(box(0.1, h, 0.1, 1), 'paint', T(M(x - length / 2, h / 2, 0)), color);
  b.add(box(length, 0.08, 0.05, 1), 'paint', T(M(0, h * 0.8, 0)), color);
  b.add(box(length, 0.08, 0.05, 1), 'paint', T(M(0, h * 0.35, 0)), color);
  for (let x = 0.5; x < length; x += 0.5) {
    if (Math.sin(x * 12.9 + length) > 0.85) continue; // a few missing pickets
    b.add(box(0.09, h * 0.95, 0.03, 1), 'paint', T(M(x - length / 2, h * 0.47, 0.04)), color);
  }
}

export function mailbox(b, base) {
  const T = (m) => base.clone().multiply(m);
  b.add(box(0.08, 1.1, 0.08), 'wood', T(M(0, 0.55, 0)), 0x7a5a40);
  b.add(box(0.28, 0.25, 0.5), 'metal', T(M(0, 1.2, 0)), 0x444a4a);
}

export function bench(b, base) {
  const T = (m) => base.clone().multiply(m);
  b.add(box(1.8, 0.06, 0.45, 1), 'wood', T(M(0, 0.45, 0)), 0x9a7a5a);
  b.add(box(1.8, 0.4, 0.05, 1), 'wood', T(M(0, 0.75, -0.22)), 0x9a7a5a);
  for (const x of [-0.8, 0.8]) for (const z of [-0.18, 0.18]) b.add(box(0.06, 0.45, 0.06), 'metal', T(M(x, 0.22, z)), 0x222222);
}

export function rock(b, base, r, rng) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.attributes.position;
  const k = rng() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + 0.25 * Math.sin(x * 3.1 + k) * Math.cos(z * 2.7 + y * 1.9 + k);
    pos.setXYZ(i, x * n, y * n * 0.7, z * n);
  }
  g.computeVertexNormals();
  b.add(g, 'rock', base.clone().multiply(M(0, r * 0.3, 0)), 0x999999);
}

export function chair(b, base, s = 1, color = 0x6b4a36) {
  const T = (m) => base.clone().multiply(m);
  b.add(box(0.5 * s, 0.06 * s, 0.5 * s, s), 'wood', T(M(0, 0.48 * s, 0)), color);
  b.add(box(0.5 * s, 0.6 * s, 0.05 * s, s), 'wood', T(M(0, 0.8 * s, -0.23 * s)), color);
  for (const x of [-0.22, 0.22]) for (const z of [-0.22, 0.22]) b.add(box(0.05 * s, 0.48 * s, 0.05 * s, s), 'wood', T(M(x * s, 0.24 * s, z * s)), color);
}

export function shed(b, base, w = 3, d = 2.6, h = 2.4) {
  const T = (m) => base.clone().multiply(m);
  b.add(box(w, h, d, 2), 'wood', T(M(0, h / 2, 0)), 0x8a7060);
  b.add(prism(w + 0.4, d + 0.4, 0.9), 'roof', T(M(0, h, 0)), 0x999999);
  b.add(box(0.9, 1.9, 0.06), 'wood', T(M(0, 0.95, d / 2 + 0.03)), 0x4a3426);
}

export function candle(b, base, h = 0.25) {
  const T = (m) => base.clone().multiply(m);
  b.add(new THREE.CylinderGeometry(0.035, 0.04, h, 6), 'paint', T(M(0, h / 2, 0)), 0xd8d0b8);
  b.add(new THREE.ConeGeometry(0.02, 0.06, 5), 'bulb', T(M(0, h + 0.04, 0)));
  return new THREE.Vector3(0, h + 0.1, 0).applyMatrix4(base);
}

// Additive glow sprite used for lamps and candles.
export function glowSprite(color = 0xffd9a0, size = 2, opacity = 0.5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex('glow'), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.set(size, size, 1);
  return s;
}

// Axis-aligned boxes on the XZ plane (with a Y range) in a spatial hash.
export class ColliderSet {
  constructor(cell = 8) {
    this.cell = cell;
    this.boxes = [];
    this.grid = new Map();
    this.stamp = 0;
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  add(minX, minZ, maxX, maxZ, minY = -1e9, maxY = 1e9) {
    const b = { minX, minZ, maxX, maxZ, minY, maxY, off: false, mark: 0 };
    const id = this.boxes.push(b) - 1;
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this._key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
    }
    return id;
  }

  // Box centred at (x,z) with size (w,d).
  addCentered(x, z, w, d, minY, maxY) { return this.add(x - w / 2, z - d / 2, x + w / 2, z + d / 2, minY, maxY); }

  remove(id) { if (this.boxes[id]) this.boxes[id].off = true; }

  query(minX, minZ, maxX, maxZ, cb) {
    const c = this.cell, s = ++this.stamp;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        for (const b of list) {
          if (b.off || b.mark === s) continue;
          b.mark = s;
          if (cb(b) === true) return true;
        }
      }
    }
    return false;
  }

  // Push a vertical capsule (circle radius r, spanning footY..headY) out of all boxes.
  pushOut(pos, r, footY, headY) {
    for (let iter = 0; iter < 2; iter++) {
      this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (b) => {
        if (footY + 0.35 >= b.maxY || headY <= b.minY) return;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          // Centre is inside the box: leave by the shallowest side.
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bb = b.maxZ - pos.z;
          const m = Math.min(l, rr, t, bb);
          if (m === l) pos.x = b.minX - r;
          else if (m === rr) pos.x = b.maxX + r;
          else if (m === t) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      });
    }
  }

  // True when the segment a→b (XZ) passes through a box that is taller than y.
  segmentBlocked(ax, az, bx, bz, y = 1.5) {
    const dx = bx - ax, dz = bz - az;
    return this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (b) => {
      if (b.maxY < y || b.minY > y) return false;
      let t0 = 0, t1 = 1;
      for (const [p, d, lo, hi] of [[ax, dx, b.minX, b.maxX], [az, dz, b.minZ, b.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) return false;
        } else {
          let ta = (lo - p) / d, tb = (hi - p) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) return false;
        }
      }
      return t0 < 0.98 && t1 > 0.02;
    });
  }
}

// Standard movement for levels whose "up" is +Y.
// The level supplies colliders, groundAt(x, z, y) and doors.
export function flatMove(player, delta, dt, level) {
  const p = player.pos, r = player.radius;
  const len = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(len / (r * 0.7)));
  for (let i = 0; i < steps; i++) {
    p.x += delta.x / steps;
    p.z += delta.z / steps;
    level.colliders.pushOut(p, r, p.y, p.y + player.height);
    for (const d of level.doors) d.collide(p, r);
    if (level.constrain) level.constrain(p);
  }

  const g = level.groundAt(p.x, p.z, p.y);
  player.vUp -= (level.gravity ?? 18) * dt;
  let ny = p.y + player.vUp * dt;
  const wasGrounded = player.grounded;
  player.grounded = false;
  if (g > -1e8) {
    if (ny <= g && p.y >= g - 0.6) {
      ny = g;
      player.vUp = 0;
      player.grounded = true;
    } else if (wasGrounded && player.vUp <= 0 && p.y - g < 0.45 && p.y >= g) {
      // Stick to the ground when walking down slopes and steps.
      ny = g;
      player.vUp = 0;
      player.grounded = true;
    }
  }
  p.y = ny;
}

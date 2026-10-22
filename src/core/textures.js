import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Procedural canvas textures, cached by name.
const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.userData.shared = true;
  return t;
}

function speckle(g, w, h, n, r, colors, alpha, rng) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.3 + rng() * 0.7);
    g.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = r * (0.3 + rng());
    g.fillRect(rng() * w, rng() * h, s, s);
  }
  g.globalAlpha = 1;
}

function blotches(g, w, h, n, rMax, color, alpha, rng) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = rMax * (0.2 + rng() * 0.8);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = alpha * rng();
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
}

const makers = {
  asphalt() {
    const [c, g] = canvas(256), r = mulberry32(1);
    g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, 256, 256);
    blotches(g, 256, 256, 30, 60, '#2a2a2a', 0.6, r);
    speckle(g, 256, 256, 3000, 2, ['#555', '#222', '#4a4a48'], 0.6, r);
    g.strokeStyle = 'rgba(20,20,20,.6)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); let x = r() * 256, y = r() * 256; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - .5) * 50; y += (r() - .5) * 50; g.lineTo(x, y); } g.stroke(); }
    return finish(c);
  },
  sidewalk() {
    const [c, g] = canvas(256), r = mulberry32(2);
    g.fillStyle = '#77756f'; g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 2500, 2, ['#888', '#666', '#6e6b64'], 0.5, r);
    blotches(g, 256, 256, 12, 50, '#55534e', 0.4, r);
    g.fillStyle = '#4c4a45'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 0, 3, 256);
    return finish(c);
  },
  grass() {
    const [c, g] = canvas(256), r = mulberry32(3);
    g.fillStyle = '#4d5a36'; g.fillRect(0, 0, 256, 256);
    blotches(g, 256, 256, 40, 50, '#5f6a3c', 0.5, r);
    blotches(g, 256, 256, 30, 40, '#3b4428', 0.5, r);
    for (let i = 0; i < 4000; i++) {
      g.strokeStyle = ['#66733f', '#3f4a2a', '#76804a', '#56603a'][Math.floor(r() * 4)];
      g.globalAlpha = 0.5; const x = r() * 256, y = r() * 256;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 3, y - 3 - r() * 4); g.stroke();
    }
    g.globalAlpha = 1;
    return finish(c);
  },
  deadgrass() {
    const [c, g] = canvas(256), r = mulberry32(4);
    g.fillStyle = '#6b6646'; g.fillRect(0, 0, 256, 256);
    blotches(g, 256, 256, 40, 50, '#565233', 0.6, r);
    for (let i = 0; i < 3500; i++) {
      g.strokeStyle = ['#7d7651', '#5a5536', '#8a845e'][Math.floor(r() * 3)];
      g.globalAlpha = 0.5; const x = r() * 256, y = r() * 256;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 4, y - 2 - r() * 4); g.stroke();
    }
    g.globalAlpha = 1;
    return finish(c);
  },
  siding() {
    const [c, g] = canvas(256), r = mulberry32(5);
    g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      const grd = g.createLinearGradient(0, y, 0, y + 16);
      grd.addColorStop(0, 'rgba(255,255,255,.15)'); grd.addColorStop(0.85, 'rgba(0,0,0,.05)'); grd.addColorStop(1, 'rgba(0,0,0,.35)');
      g.fillStyle = grd; g.fillRect(0, y, 256, 16);
    }
    blotches(g, 256, 256, 14, 70, '#6a6658', 0.25, r);
    return finish(c);
  },
  roof() {
    const [c, g] = canvas(256), r = mulberry32(6);
    g.fillStyle = '#3b3633'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 20) {
      const off = (y / 20) % 2 ? 16 : 0;
      for (let x = -32; x < 256; x += 32) {
        const v = 40 + r() * 25;
        g.fillStyle = `rgb(${v},${v - 4},${v - 7})`; g.fillRect(x + off + 1, y + 1, 30, 18);
      }
    }
    return finish(c);
  },
  brick() {
    const [c, g] = canvas(256), r = mulberry32(7);
    g.fillStyle = '#3d3532'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      const off = (y / 16) % 2 ? 16 : 0;
      for (let x = -32; x < 256; x += 32) {
        const v = 80 + r() * 40;
        g.fillStyle = `rgb(${v},${v * 0.62},${v * 0.52})`; g.fillRect(x + off + 1, y + 1, 30, 14);
      }
    }
    blotches(g, 256, 256, 20, 60, '#1c1a18', 0.4, r);
    return finish(c);
  },
  stone() {
    const [c, g] = canvas(256), r = mulberry32(8);
    g.fillStyle = '#5a5852'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      const off = (y / 32) % 2 ? 24 : 0;
      for (let x = -48; x < 256; x += 48) {
        const v = 70 + r() * 30;
        g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x + off + 2, y + 2, 44, 28);
      }
    }
    speckle(g, 256, 256, 2000, 2, ['#444', '#777'], 0.4, r);
    blotches(g, 256, 256, 18, 60, '#2a2a26', 0.5, r);
    return finish(c);
  },
  mossstone() {
    const [c, g] = canvas(256), r = mulberry32(9);
    g.fillStyle = '#2b2d28'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 28) {
      const off = (y / 28) % 2 ? 30 : 0;
      for (let x = -60; x < 256; x += 60) {
        const v = 38 + r() * 22;
        g.fillStyle = `rgb(${v},${v + 2},${v - 3})`; g.fillRect(x + off + 2, y + 2, 56, 24);
      }
    }
    blotches(g, 256, 256, 40, 40, '#2f4024', 0.6, r);
    speckle(g, 256, 256, 2500, 2, ['#1a1c18', '#3e4a34'], 0.5, r);
    return finish(c);
  },
  dirt() {
    const [c, g] = canvas(256), r = mulberry32(10);
    g.fillStyle = '#2e2a24'; g.fillRect(0, 0, 256, 256);
    blotches(g, 256, 256, 40, 50, '#3a342b', 0.6, r);
    speckle(g, 256, 256, 4000, 2, ['#4a4237', '#1e1b17', '#55504a'], 0.6, r);
    return finish(c);
  },
  wallpaper() {
    const [c, g] = canvas(256, 512), r = mulberry32(11);
    g.fillStyle = '#7a5e54'; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = 'rgba(190,160,120,.4)'; g.lineWidth = 3;
    for (let x = 0; x <= 256; x += 64) {
      for (let y = 0; y < 340; y += 48) {
        g.beginPath(); g.ellipse(x, y + ((x / 64) % 2) * 24, 12, 20, 0, 0, Math.PI * 2); g.stroke();
      }
    }
    g.fillStyle = 'rgba(160,130,90,.25)'; for (let x = 32; x < 256; x += 64) g.fillRect(x - 1, 0, 2, 340);
    blotches(g, 256, 340, 20, 80, '#3a2a24', 0.4, r);
    // Wainscot panel on the lower third.
    g.fillStyle = '#4e3626'; g.fillRect(0, 340, 256, 172);
    g.fillStyle = '#6e4c34'; g.fillRect(0, 336, 256, 8);
    g.strokeStyle = '#1b120c'; g.lineWidth = 4;
    g.strokeRect(14, 360, 100, 130); g.strokeRect(142, 360, 100, 130);
    speckle(g, 256, 512, 1500, 2, ['#1a1008', '#3b2818'], 0.4, r);
    return finish(c);
  },
  wood() {
    const [c, g] = canvas(256), r = mulberry32(12);
    g.fillStyle = '#3a2618'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      const v = 45 + r() * 20;
      g.fillStyle = `rgb(${v + 10},${v * 0.66},${v * 0.42})`; g.fillRect(x + 1, 0, 30, 256);
      for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(20,10,5,.25)'; g.fillRect(x + 2 + r() * 26, 0, 1, 256); }
      g.fillStyle = 'rgba(10,5,2,.8)'; g.fillRect(x, (r() * 256) | 0, 32, 2);
    }
    return finish(c);
  },
  plaster() {
    const [c, g] = canvas(256), r = mulberry32(13);
    g.fillStyle = '#c9c0ae'; g.fillRect(0, 0, 256, 256);
    blotches(g, 256, 256, 30, 70, '#b0a690', 0.3, r);
    speckle(g, 256, 256, 1200, 2, ['#d8d0c0', '#a8a08e'], 0.3, r);
    return finish(c);
  },
  doorwood() {
    const [c, g] = canvas(128, 256), r = mulberry32(14);
    g.fillStyle = '#5e4330'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(20,10,5,.3)'; g.fillRect(r() * 128, 0, 1, 256); }
    g.strokeStyle = '#2a1a10'; g.lineWidth = 5;
    g.strokeRect(16, 18, 96, 96); g.strokeRect(16, 134, 96, 104);
    g.strokeStyle = 'rgba(90,60,40,.4)'; g.lineWidth = 2;
    g.strokeRect(22, 24, 84, 84); g.strokeRect(22, 140, 84, 92);
    return finish(c, { repeat: false });
  },
  rock() {
    const [c, g] = canvas(256), r = mulberry32(15);
    g.fillStyle = '#4a4744'; g.fillRect(0, 0, 256, 256);
    blotches(g, 256, 256, 60, 60, '#2e2c2a', 0.6, r);
    blotches(g, 256, 256, 40, 40, '#6a6560', 0.4, r);
    speckle(g, 256, 256, 3000, 2, ['#333', '#777'], 0.5, r);
    return finish(c);
  },
  cloud() {
    const [c, g] = canvas(256), r = mulberry32(16);
    for (let i = 0; i < 26; i++) {
      const x = 128 + (r() - 0.5) * 120, y = 128 + (r() - 0.5) * 70, rad = 30 + r() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    }
    return finish(c, { repeat: false });
  },
  glow() {
    const [c, g] = canvas(128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return finish(c, { repeat: false });
  },
  portrait() {
    const [c, g] = canvas(128, 160), r = mulberry32(17);
    g.fillStyle = '#1a1410'; g.fillRect(0, 0, 128, 160);
    blotches(g, 128, 160, 10, 60, '#3a2a1c', 0.6, r);
    // Blurred figure whose face is scratched away.
    g.fillStyle = '#0c0907'; g.beginPath(); g.ellipse(64, 150, 50, 50, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b5a48'; g.beginPath(); g.ellipse(64, 70, 26, 34, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,15,10,.9)'; g.lineWidth = 2;
    for (let i = 0; i < 40; i++) { g.beginPath(); const x = 44 + r() * 40, y = 46 + r() * 50; g.moveTo(x, y); g.lineTo(x + (r() - .5) * 30, y + (r() - .5) * 30); g.stroke(); }
    return finish(c, { repeat: false });
  },
};

export function tex(name, repeatX = 1, repeatY = repeatX) {
  if (!cache.has(name)) cache.set(name, makers[name]());
  const base = cache.get(name);
  if (repeatX === 1 && repeatY === 1) return base;
  const key = `${name}@${repeatX},${repeatY}`;
  if (!cache.has(key)) {
    const t = base.clone();
    t.repeat.set(repeatX, repeatY);
    t.needsUpdate = true;
    t.userData.shared = true;
    cache.set(key, t);
  }
  return cache.get(key);
}

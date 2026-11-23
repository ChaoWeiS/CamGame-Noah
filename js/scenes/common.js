import { keyPoints } from '../body.js';
import { BONES } from '../bones.js';

export const W = 1280, H = 720;
export const ANIMALS = ['🐘', '🦒', '🦁', '🐰', '🐢', '🦊', '🐼', '🐒'];
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const session = { kbCount: 0, race: [], pw: [], seed: 1 };

export function txt(size, color = '#ffffff', extra = {}) {
  return { fontFamily: FONT, fontSize: size + 'px', color, fontStyle: 'bold', align: 'center', ...extra };
}

export function columns(n) {
  const w = W / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => ({ x: i * w, w, cx: i * w + w / 2 }));
}

// Small deterministic random generator so every player gets the same course.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Hold {
  constructor(ms) { this.ms = ms; this.t = null; }
  update(on, now) {
    if (!on) { this.t = null; return 0; }
    if (this.t === null) this.t = now;
    return Math.min(1, (now - this.t) / this.ms);
  }
  reset() { this.t = null; }
}

export function drawSkeleton(g, pts, map, color, width = 6) {
  g.lineStyle(width, color, 1);
  for (const [a, b] of BONES) {
    const pa = pts[a], pb = pts[b];
    if (pa.v < 0.4 || pb.v < 0.4) continue;
    const A = map(pa), B = map(pb);
    g.lineBetween(A.x, A.y, B.x, B.y);
  }
  const n = pts[0];
  if (n.v > 0.4) {
    const N = map(n);
    g.fillStyle(color, 1);
    g.fillCircle(N.x, N.y, width * 2.2);
  }
}

// Map a person's points to a spot on screen, centred on their hips, scaled by torso size.
export function personMap(pts, cx, cy, torsoPx) {
  const { hip, torso } = keyPoints(pts);
  const s = torsoPx / torso;
  return (p) => ({ x: cx + (p.x - hip.x) * s, y: cy + (p.y - hip.y) * s });
}

export function sky(scene, top = 0x6fb7e8, bottom = 0xcfe9f7) {
  const g = scene.add.graphics();
  g.fillGradientStyle(top, top, bottom, bottom, 1);
  g.fillRect(0, 0, W, H);
  return g;
}

export function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][n] || 'th'); }

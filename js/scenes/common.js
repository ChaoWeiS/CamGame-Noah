import { keyPoints } from '../body.js';
import { BONES } from '../bones.js';
import { loadPuppets } from '../puppet.js';

// Screen size follows the display's shape: 16:9 (1920x1080) up to 16:10 (1920x1200).
export const ASPECT = Math.min(16 / 9, Math.max(16 / 10, window.innerWidth / window.innerHeight));
export const W = 1280, H = Math.round(1280 / ASPECT);

// ---- split screen: up to 4 panes (1 = full, 2 = side by side, 3-4 = 2x2 grid)
export const UI_X = -20000; // shared overlay text lives here, seen only by the UI camera
export function paneRects(n) {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
  const hw = W / 2, hh = H / 2;
  return [{ x: 0, y: 0, w: hw, h: hh }, { x: hw, y: 0, w: hw, h: hh }, { x: 0, y: hh, w: hw, h: hh }, { x: hw, y: hh, w: hw, h: hh }];
}

// Each player's content is drawn in its own area of the world, designH tall,
// and a camera shows that area in the player's pane. Returns pane geometry
// ({x, w, cx, h, cam}) in world coordinates.
export function setupPanes(scene, n, designH = 720) {
  const rects = paneRects(n);
  const panes = [];
  for (let i = 0; i < n; i++) {
    const r = rects[i];
    const zoom = r.h / designH;
    const w = r.w / zoom;
    const x = i * 5000;
    const cam = i === 0 ? scene.cameras.main.setViewport(r.x, r.y, r.w, r.h) : scene.cameras.add(r.x, r.y, r.w, r.h);
    cam.setZoom(zoom).setBackgroundColor('#10202b');
    cam.centerOn(x + w / 2, designH / 2);
    panes.push({ x, w, cx: x + w / 2, h: designH, cam, rect: r });
  }
  // UI camera on top: full screen, looks at the UI_X area
  const ui = scene.cameras.add(0, 0, W, H).setScroll(UI_X, 0);
  const g = scene.add.graphics().setDepth(50);
  for (let i = n; i < rects.length; i++) {
    const r = rects[i];
    g.fillStyle(0x10202b, 1).fillRect(UI_X + r.x, r.y, r.w, r.h);
    scene.add.text(UI_X + r.x + r.w / 2, r.y + r.h / 2, '🌈', txt(80)).setOrigin(0.5).setDepth(51);
  }
  g.lineStyle(6, 0x10202b, 1);
  if (rects.length >= 2) g.lineBetween(UI_X + W / 2, 0, UI_X + W / 2, H);
  if (rects.length >= 3) g.lineBetween(UI_X, H / 2, UI_X + W, H / 2);
  return { panes, ui };
}
// The playable cast: the four characters that have 3D models.
export const CHARACTERS = [
  { id: 'bear', name: 'Barnaby' },
  { id: 'dog', name: 'Scout' },
  { id: 'chicken', name: 'Cluck' },
  { id: 'hamster', name: 'Hammy' },
];
// Characters with 2D art only (not offered in the pick screen for now).
export const EXTRA_CHARACTERS = [
  { id: 'cat', name: 'Whiskers' },
  { id: 'lizard', name: 'Spike' },
  { id: 'mouse', name: 'Squeak' },
  { id: 'pine', name: 'Pine' },
];
export const VIEWS = ['front', 'back', 'tpose'];
export const charById = (id) => [...CHARACTERS, ...EXTRA_CHARACTERS].find((c) => c.id === id) || CHARACTERS[0];

// Load every character view (call from a scene's preload).
export function loadCharacters(scene) {
  for (const c of CHARACTERS) for (const v of VIEWS) {
    const key = `${c.id}_${v}`;
    if (!scene.textures.exists(key)) scene.load.image(key, `assets/characters/${key}.png`);
  }
  loadPuppets(scene, CHARACTERS.map((c) => c.id));
  // face portraits for the character select (rendered from the 3D models)
  for (const c of CHARACTERS) if (!scene.textures.exists('portrait_' + c.id)) scene.load.image('portrait_' + c.id, `assets/portraits/${c.id}.png`);
  for (const p of PROPS) {
    if (!scene.textures.exists('prop_' + p)) scene.load.image('prop_' + p, `assets/props/${p}.png`);
  }
}
export const PROPS = ['oak', 'birch', 'twisty', 'rock', 'boulder', 'rocks', 'log', 'stick', 'fork'];

// Character image standing on (x, y), scaled to a given height.
export function charImage(scene, x, y, id, view, height) {
  const img = scene.add.image(x, y, `${id}_${view}`).setOrigin(0.5, 1);
  img.setScale(height / img.height);
  img.baseScale = img.scaleX;
  return img;
}
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

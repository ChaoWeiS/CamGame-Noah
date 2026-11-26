// Radar: a small map, seen from above, of where the cameras are and where everyone stands.
//   ▲ (dark red) a camera, with its field of view (orange lines)
//   ● a person, in their player colour — brighter when 2+ linked cameras agree on them
// One camera: distance comes from each person's size in the picture (lens angle guessed
// until the cameras are linked). Linked cameras: real positions in the room (multicam.js).
//   showRadar(game, { colorOf(track) → css colour | null })  → { remove() }
import { tracker, PLAYER_CSS } from './core.js';
import { multicam, locate, xform } from './multicam.js';

const GUESS_FOV = 90;          // lens angle (degrees, across) before the cameras are linked
const RANGE = 7;               // how far the field-of-view lines are drawn (m)

// a tracked person back in the camera's own terms (the tracker mirrors pictures like a selfie)
function rawOf(t, aspect) {
  const uvv = [], world = [];
  for (let i = 0; i < 33; i++) {
    const p = t.pts[i], w = t.world[i];
    uvv.push(1 - p.x / aspect, p.y, p.v);
    world.push(-w.x, -w.y, -w.z);
  }
  return { uvv, world };
}

// cameras and people on the floor (x, z in metres; y up) — the view camera then gets turned to the top
function scene(colorOf) {
  const aspect = tracker.aspect;
  const linked = multicam.layout().filter((c) => c.linked);
  const view = multicam.cams.get(multicam.view);
  const useRoom = linked.length >= 1 && view?.calib;
  const cams = useRoom
    ? linked.map((c) => ({ x: c.x, z: c.z, dir: c.dir, fov: c.fov, num: c.num, main: c.id === multicam.view }))
    : [{ x: 0, z: 0, dir: Math.PI, fov: GUESS_FOV, num: 1, main: true }];
  const fov = useRoom ? view.calib.fov : GUESS_FOV;
  const people = [];
  for (const t of tracker.people()) {
    if (!t.world) continue;
    const { uvv, world } = rawOf(t, aspect);
    const T = locate(world, uvv, fov, aspect, 0.4);
    if (!T) continue;
    const hip = [T[0], T[1], T[2]];
    const p = useRoom ? xform(view.calib.toRoom, hip) : [hip[0], 0, -hip[2]];
    // smooth (sizes jitter a little from frame to frame)
    t.radar = t.radar ? { x: t.radar.x + (p[0] - t.radar.x) * 0.25, z: t.radar.z + (p[2] - t.radar.z) * 0.25 } : { x: p[0], z: p[2] };
    const both = useRoom && multicam.active() && (multicam.spots || []).some((s) => s.cams > 1 && Math.hypot(s.x - p[0], s.z - p[2]) < 0.7);
    people.push({ ...t.radar, color: colorOf(t) || '#3fcf6a', both });
  }
  const unlinked = multicam.connectedCams().filter((c) => !c.calib).length - (useRoom ? 0 : 1);
  return { cams, people, guessed: !useRoom, unlinked: Math.max(0, unlinked) };
}

function draw(ctx, w, h, S) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(8,16,22,0.82)'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.clip();
  // turn the room so the main camera is at the top, looking down
  const main = S.cams.find((c) => c.main) || S.cams[0];
  const a0 = Math.atan2(Math.cos(main.dir), Math.sin(main.dir));
  const rot = Math.PI / 2 - a0, cs = Math.cos(rot), sn = Math.sin(rot);
  const R = (x, z) => { const dx = x - main.x, dz = z - main.z; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
  // fit: every camera and person, and at least 4 m in front of the main camera
  const pts = [[0, 0], [-2, 4.5], [2, 4.5]].concat(S.cams.map((c) => R(c.x, c.z)), S.people.map((p) => R(p.x, p.z)));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 22, k = Math.min((w - 2 * pad) / (x1 - x0 + 1), (h - 2 * pad - 14) / (y1 - y0 + 1));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // seen from above: a camera facing down the screen has its right on the screen's left (like the mirrored picture)
  const P = ([x, y]) => [w / 2 + (x - cx) * k, (h - 14) / 2 + 2 + (y - cy) * k];
  // 1 m grid
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  for (let g = Math.floor(x0) - 8; g <= Math.ceil(x1) + 8; g++) { const [a] = P([g, 0]); ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a, h); ctx.stroke(); }
  for (let g = Math.floor(y0) - 8; g <= Math.ceil(y1) + 8; g++) { const [, b] = P([0, g]); ctx.beginPath(); ctx.moveTo(0, b); ctx.lineTo(w, b); ctx.stroke(); }
  // cameras: field of view first (under everything), then the camera itself
  for (const c of S.cams) {
    const [px, py] = P(R(c.x, c.z));
    const d = [Math.sin(c.dir), Math.cos(c.dir)];
    const [ax, ay] = P(R(c.x + d[0], c.z + d[1]));
    const ang = Math.atan2(ay - py, ax - px), half = (c.fov * Math.PI) / 360;
    ctx.fillStyle = 'rgba(255,140,40,0.10)';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, RANGE * k, ang - half, ang + half); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff8a2a'; ctx.lineWidth = 2;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang + s * half) * RANGE * k, py + Math.sin(ang + s * half) * RANGE * k); ctx.stroke(); }
    // the camera: a triangle pointing where it looks
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = '#8b0a1e'; ctx.strokeStyle = '#ffd3d3'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -9); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (S.cams.length > 1) { ctx.fillStyle = '#ffd3d3'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(c.num), px, py - 12); }
  }
  // people
  for (const p of S.people) {
    const [px, py] = P(R(p.x, p.z));
    if (p.both) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0d1b26'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
  // caption
  ctx.fillStyle = 'rgba(255,248,230,0.85)'; ctx.font = '600 11px system-ui'; ctx.textAlign = 'left';
  const cap = S.cams.length > 1 ? `📡 ${S.cams.length} cameras linked` : S.guessed ? '📡 1 camera · distances approx.' : '📡 1 camera';
  ctx.fillText(cap + (S.unlinked ? ` · ${S.unlinked} not linked yet` : ''), 10, h - 8);
}

export function showRadar(game, { colorOf = () => null } = {}) {
  const cv = document.createElement('canvas');
  cv.className = 'radar';
  game.canvas.parentElement.appendChild(cv);
  const ctx = cv.getContext('2d');
  const tick = () => {
    const c = game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const h = Math.round(cr.height * 0.3), w = Math.round(h * 1.2), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    Object.assign(cv.style, { left: `${cr.left - pr.left + cr.width * 0.015}px`, top: `${cr.top - pr.top + cr.height * 0.09}px`, width: `${w}px`, height: `${h}px` });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { draw(ctx, w, h, scene(colorOf)); } catch (e) { console.warn('radar', e); }
  };
  tick();
  const timer = setInterval(tick, 100);
  return { remove() { clearInterval(timer); cv.remove(); } };
}
export const playerColor = (slot) => PLAYER_CSS[slot % PLAYER_CSS.length];

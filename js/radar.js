// Radar: a small map, seen from above, of where the cameras are and where everyone stands.
//   ▲ (dark red) a camera, with its field of view (orange lines)
//   ● a person, in their player colour — a ring for each camera that sees them; flashing amber
//     when only one camera can (anyone stepping in front of them would hide them)
//   floor shading: orange = one camera covers it, green = two or more
//   ★ with linked cameras: a better spot for a camera that's nearly in line with another one
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
    ? linked.map((c) => ({ id: c.id, x: c.x, z: c.z, dir: c.dir, fov: c.fov, num: c.num, main: c.id === multicam.view }))
    : [{ id: null, x: 0, z: 0, dir: Math.PI, fov: GUESS_FOV, num: 1, main: true }];
  const fov = useRoom ? view.calib.fov : GUESS_FOV;
  const multi = useRoom && cams.length >= 2 && multicam.active();
  const people = [];
  for (const t of tracker.people()) {
    if (!t.world) continue;
    const { uvv, world } = rawOf(t, aspect);
    const T = locate(world, uvv, fov, aspect, 0.4);
    if (!T) continue;
    const p = useRoom ? xform(view.calib.toRoom, T) : [T[0], 0, -T[2]];
    // smooth (sizes jitter a little from frame to frame)
    t.radar = t.radar ? { x: t.radar.x + (p[0] - t.radar.x) * 0.25, z: t.radar.z + (p[2] - t.radar.z) * 0.25 } : { x: p[0], z: p[2] };
    // how many cameras see this person right now (the merged spot nearest to them)
    let seenBy = null;
    if (multi) {
      let best = null, bd = 0.8;
      for (const sp of multicam.spots || []) { const d = Math.hypot(sp.x - t.radar.x, sp.z - t.radar.z); if (d < bd) { bd = d; best = sp; } }
      seenBy = best ? best.cams : 1;
    }
    people.push({ ...t.radar, color: colorOf(t) || '#3fcf6a', seenBy });
  }
  const unlinked = multicam.connectedCams().filter((c) => !c.calib).length - (useRoom ? 0 : 1);
  return { cams, people, guessed: !useRoom, unlinked: Math.max(0, unlinked), advice: useRoom && cams.length >= 2 ? advise(cams, people) : null };
}

// Where should the other cameras be? Cameras looking at the players along nearly the same line
// (from the same side, or straight opposite) get blocked at the same moments; 60–120° apart
// is best. Returns a verdict per camera and a ★ for the first one that should move.
function advise(cams, people) {
  const main = cams.find((c) => c.main) || cams[0];
  let cx = 0, cz = 0;
  if (people.length) { people.forEach((p) => { cx += p.x; cz += p.z; }); cx /= people.length; cz /= people.length; }
  else { cams.forEach((c) => { cx += c.x + Math.sin(c.dir) * 3; cz += c.z + Math.cos(c.dir) * 3; }); cx /= cams.length; cz /= cams.length; }
  const angOf = (c) => Math.atan2(c.x - cx, c.z - cz);
  const lines = [];
  let star = null;
  for (const c of cams) {
    if (c === main) continue;
    // the worst (narrowest) separation from any other camera, as lines through the players
    let sep = 90;
    for (const o of cams) {
      if (o === c) continue;
      let a = Math.abs(((angOf(c) - angOf(o)) * 180) / Math.PI) % 360; if (a > 180) a = 360 - a;
      sep = Math.min(sep, a, 180 - a);   // straight opposite is as bad as side by side
    }
    const verdict = sep >= 55 ? 'good' : sep >= 30 ? 'ok' : 'bad';
    lines.push({ num: c.num, sep: Math.round(sep), verdict });
    if (verdict !== 'good' && !star) {
      // the spot 80° round from the main camera (on the side this camera is already on), same distance
      const r = Math.hypot(c.x - cx, c.z - cz), a0 = angOf(main);
      const side = Math.sin(angOf(c) - a0) >= 0 ? 1 : -1, a = a0 + side * (80 * Math.PI) / 180;
      star = { x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r, num: c.num };
    }
  }
  return { lines, star, centre: { x: cx, z: cz } };
}

function draw(ctx, w, h, S) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(8,16,22,0.85)'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.fill();
  const capH = S.advice || Object.keys(S.filled || {}).length ? 30 : 16, mh = h - capH;
  ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, w, mh, 12); ctx.clip();
  // turn the room so the main camera is at the top, looking down
  const main = S.cams.find((c) => c.main) || S.cams[0];
  const a0 = Math.atan2(Math.cos(main.dir), Math.sin(main.dir));
  const rot = Math.PI / 2 - a0, cs = Math.cos(rot), sn = Math.sin(rot);
  const R = (x, z) => { const dx = x - main.x, dz = z - main.z; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
  const Rinv = (u, v) => [main.x + u * cs + v * sn, main.z - u * sn + v * cs];
  // fit: every camera and person (and the ★), and at least 4 m in front of the main camera
  const extra = S.advice?.star ? [R(S.advice.star.x, S.advice.star.z)] : [];
  const pts = [[0, 0], [-2, 4.5], [2, 4.5]].concat(S.cams.map((c) => R(c.x, c.z)), S.people.map((p) => R(p.x, p.z)), extra);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 20, k = Math.min((w - 2 * pad) / (x1 - x0 + 1), (mh - 2 * pad) / (y1 - y0 + 1));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // seen from above: a camera facing down the screen has its right on the screen's left (like the mirrored picture)
  const P = ([x, y]) => [w / 2 + (x - cx) * k, mh / 2 + (y - cy) * k];
  const Pinv = (sx, sy) => Rinv((sx - w / 2) / k + cx, (sy - mh / 2) / k + cy);
  // coverage: floor seen by one camera (orange), by two or more (green)
  const cell = 6;
  for (let sy = 0; sy < mh; sy += cell) for (let sx = 0; sx < w; sx += cell) {
    const [x, z] = Pinv(sx + cell / 2, sy + cell / 2);
    let n = 0;
    for (const c of S.cams) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      if (d < 0.6 || d > RANGE) continue;
      let a = Math.atan2(dx, dz) - c.dir; a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) < (c.fov * Math.PI) / 360) n++;
    }
    if (!n) continue;
    ctx.fillStyle = n >= 2 ? 'rgba(70,210,110,0.22)' : 'rgba(255,140,40,0.10)';
    ctx.fillRect(sx, sy, cell, cell);
  }
  // 1 m grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let g = Math.floor(x0) - 8; g <= Math.ceil(x1) + 8; g++) { const [a] = P([g, 0]); ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a, mh); ctx.stroke(); }
  for (let g = Math.floor(y0) - 8; g <= Math.ceil(y1) + 8; g++) { const [, b] = P([0, g]); ctx.beginPath(); ctx.moveTo(0, b); ctx.lineTo(w, b); ctx.stroke(); }
  // cameras: field-of-view lines, then the camera itself
  for (const c of S.cams) {
    const [px, py] = P(R(c.x, c.z));
    const [ax, ay] = P(R(c.x + Math.sin(c.dir), c.z + Math.cos(c.dir)));
    const ang = Math.atan2(ay - py, ax - px), half = (c.fov * Math.PI) / 360;
    ctx.strokeStyle = '#ff8a2a'; ctx.lineWidth = 2;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang + s * half) * RANGE * k, py + Math.sin(ang + s * half) * RANGE * k); ctx.stroke(); }
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = '#8b0a1e'; ctx.strokeStyle = '#ffd3d3'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -9); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (S.cams.length > 1) { ctx.fillStyle = '#ffd3d3'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(c.num), px, py - 12); }
  }
  // ★ a better spot for a camera, with a dashed line from where it is now
  const star = S.advice?.star;
  if (star) {
    const c = S.cams.find((q) => q.num === star.num), [sx, sy] = P(R(star.x, star.z)), [qx, qy] = P(R(c.x, c.z));
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,215,90,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(sx, sy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd75a'; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', sx, sy); ctx.textBaseline = 'alphabetic';
  }
  // people: one ring per camera that sees them; amber flashing when only one camera can
  const blink = Math.floor(performance.now() / 350) % 2;
  for (const p of S.people) {
    const [px, py] = P(R(p.x, p.z));
    if (p.seenBy === 1) { if (blink) { ctx.strokeStyle = '#ffb02e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.stroke(); } }
    else if (p.seenBy > 1) for (let r = 0; r < p.seenBy; r++) { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 11 + r * 3.5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0d1b26'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
  // caption: cameras, then placement advice and blind spots caught
  ctx.font = '600 11px system-ui'; ctx.textAlign = 'left';
  const cap = S.cams.length > 1 ? `📡 ${S.cams.length} cameras linked` : S.guessed ? '📡 1 camera · distances approx.' : '📡 1 camera';
  ctx.fillStyle = 'rgba(255,248,230,0.85)';
  ctx.fillText(cap + (S.unlinked ? ` · ${S.unlinked} not linked yet` : ''), 10, mh + 12);
  if (capH > 16) {
    const bad = S.advice?.lines.find((l) => l.verdict !== 'good');
    let line = '', col = '#9fe3a8';
    if (bad) { line = `Cam ${bad.num} ${bad.verdict === 'bad' ? 'is in line with another' : 'could see round more'} — move it to the ★`; col = bad.verdict === 'bad' ? '#ffb02e' : '#ffd75a'; }
    else if (S.advice) line = `✓ Good angles (${S.advice.lines.map((l) => `${l.sep}°`).join(', ')})`;
    const fill = Object.entries(S.filled || {}).filter(([, s]) => s >= 1).map(([n, s]) => `cam ${n} filled ${Math.round(s)} s`).join(' · ');
    ctx.fillStyle = col;
    ctx.fillText([line, fill].filter(Boolean).join(' · '), 10, mh + 26);
  }
}

export function showRadar(game, { colorOf = () => null } = {}) {
  const cv = document.createElement('canvas');
  cv.className = 'radar';
  game.canvas.parentElement.appendChild(cv);
  const ctx = cv.getContext('2d');
  const tick = () => {
    const c = game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const h = Math.round(cr.height * 0.34), w = Math.round(h * 1.25), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    Object.assign(cv.style, { left: `${cr.left - pr.left + cr.width * 0.015}px`, top: `${cr.top - pr.top + cr.height * 0.09}px`, width: `${w}px`, height: `${h}px` });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { const S = scene(colorOf); S.filled = Object.fromEntries([...multicam.filled].map(([id, v]) => [multicam.cam(id).num, v])); draw(ctx, w, h, S); } catch (e) { console.warn('radar', e); }
  };
  tick();
  const timer = setInterval(tick, 100);
  return { remove() { clearInterval(timer); cv.remove(); } };
}
export const playerColor = (slot) => PLAYER_CSS[slot % PLAYER_CSS.length];

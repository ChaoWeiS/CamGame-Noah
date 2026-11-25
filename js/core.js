// Core platform: connection (phone → PC), local webcam fallback,
// player tracking/identity and keyboard test players.
import { Body, toPoints, toWorld, keyPoints } from './body.js';
import { multicam } from './multicam.js';
import { clothesOf, clothesDiff, clothesBlend } from './clothes.js';

// soft pastel player colours: P1 red, P2 blue, P3 green, P4 yellow
export const PLAYER_COLORS = [0xef8f86, 0x86b6e8, 0x93d18e, 0xf1d074];
export const PLAYER_CSS = ['#ef8f86', '#86b6e8', '#93d18e', '#f1d074'];
export const MAX_PLAYERS = 4;

// ---------------------------------------------------------------- stats
export const stats = {
  source: 'none',        // 'phone' | 'webcam' | 'none'
  connected: false,
  fps: 0, inf: 0, rtt: null, people: 0, lastFrame: 0, camera: '',
  world3D: false,
  phoneBuild: null,      // the phone page's build (from its hello)
  tracks: 0,             // people being tracked (confirmed boxes)
  linked: 0,             // cameras merged into the picture (0 = one camera)
};

// ---------------------------------------------------------------- tracker
// Every detected person gets a box (around their visible joints) and a track id that
// stays with them: each frame, boxes are matched to last frame's tracks by how much
// they overlap (best pairs first, over all pairs). Duplicate detections of one person
// are merged, new people must be seen for a few frames, and a person who drops out
// for a moment keeps their id. Players and lobby animals follow track ids.
const CONFIRM_HITS = 3;      // frames before a new person counts
const KEEP_MS = 800;         // how long a missing person keeps their id
const PLAYER_KEEP_MS = 2500; // …and a player (hidden behind someone walking past, say)

function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0, vis = 0;
  for (let i = 0; i < 33; i++) {
    const p = pts[i]; vis += p.v;
    if (p.v < 0.3) continue;
    n++; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (n < 4) return null;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, vis: vis / 33 };
}
// the torso (shoulders + hips): where a person IS, unaffected by waving, flapping or reaching
// arms (which make the whole-body box jump around). Size = torso length.
function torsoOf(pts, box) {
  const ls = pts[11], rs = pts[12], lh = pts[23], rh = pts[24];
  const shV = ls.v > 0.3 && rs.v > 0.3, hipV = lh.v > 0.3 && rh.v > 0.3;
  if (shV) {
    const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2, sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    if (hipV) {
      const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
      return { x: (sx + hx) / 2, y: (sy + hy) / 2, s: Math.max(Math.hypot(sx - hx, sy - hy), sw * 1.1, 0.02), good: true };
    }
    return { x: sx, y: sy + sw * 0.7, s: Math.max(sw * 1.4, 0.02), good: true };
  }
  return { x: box.cx, y: box.cy, s: Math.max(0.02, box.h * 0.35), good: false };
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy, u = a.w * a.h + b.w * b.h - inter;
  return u > 0 ? inter / u : 0;
}

class Tracker {
  constructor() {
    this.skeletons = [];   // this frame's people (deduplicated): [{pts, key, world, box, track}]
    this.tracks = [];      // [{id, box, vx, vy, pts, key, world, hits, lastSeen, confirmed, seen}]
    this.nextId = 1;
    this.aspect = 4 / 3;
    this.players = [];     // locked players (camera or keyboard)
    this.locked = false;
  }

  // confirmed tracks currently (or very recently) seen, left to right
  people() {
    return this.tracks.filter((t) => t.confirmed && t.seen).sort((a, b) => a.box.cx - b.box.cx);
  }

  ingest(posesFlat, aspect, worlds = null, colors = null) {
    this.aspect = aspect || this.aspect;
    stats.world3D = !!(worlds && worlds.length);
    const now = performance.now();
    let dets = posesFlat.map((flat, k) => {
      const pts = toPoints(flat, this.aspect);
      return { pts, key: keyPoints(pts), world: worlds && worlds[k] ? toWorld(worlds[k]) : null, box: boxOf(pts), col: colors?.[k] || null };
    }).filter((d) => d.box);
    dets.forEach((d) => { d.torso = torsoOf(d.pts, d.box); });
    // merge duplicates: two detections of one person have their torsos in the same place
    // (keep the clearer one). Whole-body boxes overlap whenever two kids stand close with arms out.
    dets.sort((a, b) => b.box.vis - a.box.vis);
    dets = dets.filter((d, i) => !dets.slice(0, i).some((e) =>
      Math.hypot(d.torso.x - e.torso.x, d.torso.y - e.torso.y) < 0.3 * Math.min(d.torso.s, e.torso.s) && iou(d.box, e.box) > 0.4));

    // match to tracks by the torso: where it is (predicted from how it was moving) and how big
    // it is; score every (track, detection) pair, take the best pairs first
    const pairs = [];
    for (const t of this.tracks) {
      const hidden = now - t.lastSeen > 150;          // not seen for a moment: someone may be in front of them
      const dt = hidden ? 0 : Math.min(0.3, (now - t.lastSeen) / 1000);
      const px = t.torso.x + t.vx * dt, py = t.torso.y + t.vy * dt;
      dets.forEach((d, j) => {
        const size = Math.max(t.torso.s, d.torso.s);
        const dist = Math.hypot(px - d.torso.x, py - d.torso.y) / size;        // in torso lengths
        const scale = Math.abs(Math.log(d.torso.s / t.torso.s));               // a nearer/farther person is a different size
        const cd = clothesDiff(t.look, d.col);                                // different clothes: a different person
        const score = -dist - 0.8 * scale + 0.15 * iou(t.box, d.box) - (cd === null ? 0 : 0.03 * cd);
        // a hidden person only comes back as someone in (almost) the same spot, the same size, the same clothes
        if (hidden ? dist < 0.6 && scale < 0.25 && (cd === null || cd < 25) : dist < 1.2) pairs.push({ t, j, score });
      });
    }
    pairs.sort((a, b) => b.score - a.score);
    const usedT = new Set(), usedD = new Set();
    for (const { t, j } of pairs) {
      if (usedT.has(t) || usedD.has(j)) continue;
      usedT.add(t); usedD.add(j);
      const d = dets[j], dt = Math.max(0.01, (now - t.lastSeen) / 1000);
      t.vx += ((d.torso.x - t.torso.x) / dt - t.vx) * 0.3;
      t.vy += ((d.torso.y - t.torso.y) / dt - t.vy) * 0.3;
      t.vx = Math.max(-2, Math.min(2, t.vx)); t.vy = Math.max(-2, Math.min(2, t.vy));
      // size changes slowly (people don't grow), so a misread torso doesn't redefine them
      const torso = { ...d.torso, s: d.torso.good ? t.torso.s + (d.torso.s - t.torso.s) * 0.3 : t.torso.s };
      Object.assign(t, { box: d.box, torso, pts: d.pts, key: d.key, world: d.world, lastSeen: now, seen: true });
      if (d.col) { t.col = d.col; t.look = clothesBlend(t.look, d.col, 0.15); }
      t.hits++; if (t.hits >= CONFIRM_HITS) t.confirmed = true;
      d.track = t;
    }
    dets.forEach((d, j) => {
      if (usedD.has(j)) return;
      const t = { id: this.nextId++, born: now, box: d.box, torso: d.torso, look: clothesBlend(null, d.col, 1), col: d.col, vx: 0, vy: 0, pts: d.pts, key: d.key, world: d.world, hits: 1, lastSeen: now, confirmed: false, seen: true };
      this.tracks.push(t); d.track = t;
    });
    for (const t of this.tracks) if (!usedT.has(t) && t.lastSeen < now) t.seen = now - t.lastSeen < 250;
    const playerTracks = new Set(this.locked ? this.players.map((p) => p.trackId) : []);
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < (playerTracks.has(t.id) ? PLAYER_KEEP_MS : t.confirmed ? KEEP_MS : 200));

    this.skeletons = dets.filter((d) => d.track.confirmed);
    stats.people = this.skeletons.length;
    stats.tracks = this.tracks.filter((t) => t.confirmed).length;
    stats.lastFrame = now;
    if (this.locked) this.match();
  }

  // Lock the people currently in view as players, left to right.
  lock(keyboardCount = 0) {
    const seen = this.people().filter((t) => t.key.sh.v > 0.4).slice(0, MAX_PLAYERS - keyboardCount);
    this.players = [];
    seen.forEach((t) => {
      const body = new Body();
      body.update(t.pts, t.world);
      body.calibrateFromCurrent();
      const pl = makePlayer(this.players.length, 'camera', body, t.key.sh);
      pl.trackId = t.id;
      pl.look = t.look ? clothesBlend(null, t.look, 1) : null;
      this.players.push(pl);
    });
    for (let i = 0; i < keyboardCount && this.players.length < MAX_PLAYERS; i++) {
      this.players.push(makePlayer(this.players.length, 'keyboard', null, null, i));
    }
    this.locked = true;
    return this.players;
  }

  unlock() { this.locked = false; this.players = []; }

  // Each player sticks to their own track — through someone walking in front of them too.
  // Only if their track is really gone (they left the view for a while) do they take over a
  // newcomer, and only one who turned up close to where they were and is about their size —
  // so somebody walking past doesn't become them.
  match() {
    const now = performance.now();
    const cams = this.players.filter((p) => p.kind === 'camera');
    const claimed = new Set(cams.map((p) => p.trackId));
    for (const pl of cams) {
      let t = this.tracks.find((x) => x.id === pl.trackId);
      if (!t) {
        let best = null, bestD = 1.5;
        for (const x of this.tracks) {
          if (!x.confirmed || claimed.has(x.id) || !x.seen) continue;
          if (pl.torsoS && Math.abs(Math.log(x.torso.s / pl.torsoS)) > 0.3) continue;      // not their size
          if (x.born < pl.lastSeen - 300) continue;               // was already around elsewhere: someone else
          if (Math.hypot(x.vx, x.vy) > 0.6 * x.torso.s * 2) continue;   // walking past, not standing to play
          const cd = clothesDiff(pl.look, x.look);
          if (cd !== null && cd > 22) continue;                    // different clothes: not them
          let d = Math.hypot(x.torso.x - (pl.torsoAt?.x ?? x.torso.x), x.torso.y - (pl.torsoAt?.y ?? x.torso.y)) / x.torso.s;
          if (cd !== null && cd < 12) d *= 0.4;                    // same clothes: them, even a little further off
          if (d < bestD) { bestD = d; best = x; }
        }
        if (best) { t = best; pl.trackId = best.id; claimed.add(best.id); }
      }
      if (t && t.lastSeen === stats.lastFrame) {
        pl.body.update(t.pts, t.world);
        pl.anchor = { x: t.key.sh.x, y: t.key.sh.y };
        pl.torsoAt = { x: t.torso.x, y: t.torso.y };
        pl.torsoS = pl.torsoS ? pl.torsoS + (t.torso.s - pl.torsoS) * 0.1 : t.torso.s;
        // keep learning their clothes — slowly, and only from readings that look like them and
        // while nobody else is right next to them (so another child's colours don't creep in)
        if (t.col) {
          const cd = clothesDiff(pl.look, t.col);
          const alone = this.tracks.every((o) => o === t || !o.seen || Math.hypot(o.torso.x - t.torso.x, o.torso.y - t.torso.y) > 1.3 * t.torso.s);
          if (!pl.look) pl.look = clothesBlend(null, t.col, 1);
          else if (alone && cd !== null && cd < 18) pl.look = clothesBlend(pl.look, t.col, 0.03);
        }
        pl.present = true;
        pl.lastSeen = now;
      } else if (now - pl.lastSeen > 400) {
        pl.present = false;
      }
    }
    this.fixSwaps(cams, now);
  }

  // Two players' animals on the wrong children (after they crossed, say)? Their clothes say
  // so: if each child's clothes match the OTHER player much better, for a few checks in a
  // row, the two players swap back.
  fixSwaps(cams, now) {
    if (now - (this.swapCheckAt || 0) < 300) return;
    this.swapCheckAt = now;
    for (let i = 0; i < cams.length; i++) for (let j = i + 1; j < cams.length; j++) {
      const A = cams[i], B = cams[j];
      const tA = this.tracks.find((x) => x.id === A.trackId), tB = this.tracks.find((x) => x.id === B.trackId);
      const key = `${A.slot}-${B.slot}`;
      this.swapVotes = this.swapVotes || {};
      if (!tA || !tB || !A.look || !B.look || !tA.look || !tB.look || !tA.seen || !tB.seen) { this.swapVotes[key] = 0; continue; }
      const keep = clothesDiff(A.look, tA.look) + clothesDiff(B.look, tB.look);
      const swap = clothesDiff(A.look, tB.look) + clothesDiff(B.look, tA.look);
      if (swap + 14 < keep && swap < 0.6 * keep) this.swapVotes[key] = (this.swapVotes[key] || 0) + 1;
      else this.swapVotes[key] = 0;
      if (this.swapVotes[key] >= 3) {
        [A.trackId, B.trackId] = [B.trackId, A.trackId];
        this.swapVotes[key] = 0;
        stats.swapsFixed = (stats.swapsFixed || 0) + 1;
      }
    }
  }
}

function makePlayer(slot, kind, body, anchor, keyboardIndex = 0) {
  return {
    slot, kind, body, keyboardIndex, trackId: null,
    color: PLAYER_COLORS[slot], css: PLAYER_CSS[slot],
    anchor: anchor ? { x: anchor.x, y: anchor.y } : { x: 0, y: 0 },
    present: kind === 'keyboard', lastSeen: performance.now(),
    animal: null,
    kb: { lane: 0, duck: false, jumpAt: -1e9, pose: null, handsUp: false, runAt: -1e9 },
  };
}

export const tracker = new Tracker();

// Unified per-player input, whatever the source.
export function input(pl) {
  if (pl.kind === 'keyboard') {
    return {
      present: true, lane: pl.kb.lane, side: pl.kb.lane, ducking: pl.kb.duck,
      jumping: performance.now() - pl.kb.jumpAt < 450,
      pose: pl.kb.pose, handsUp: pl.kb.handsUp,
      run: Math.max(0, 1 - (performance.now() - pl.kb.runAt) / 600), // tap R (P1) / F (P2) to run
      // skiing: R/F = pump, ← → (A D) = steer, Shift (S) = twist for a sharp turn
      pump: Math.max(0, 1 - (performance.now() - pl.kb.runAt) / 600), steer: pl.kb.lane, twist: pl.kb.duck ? pl.kb.lane || 0 : 0,
      // flying: Space/W = flap, Shift/S held = fold the wings, otherwise gliding
      flapCount: pl.kb.flaps || 0, glide: pl.kb.duck ? 0 : 1, fold: pl.kb.duck ? 1 : 0,
    };
  }
  const b = pl.body;
  return {
    present: pl.present, lane: b.lane, side: b.side, ducking: b.ducking, jumping: b.jumping,
    pose: b.pose, handsUp: b.handsUp, run: b.run,
    pump: b.pump || 0, steer: b.steer || 0, twist: b.twist || 0,
    flapCount: b.flapCount || 0, glide: b.glide || 0, fold: b.fold || 0,
  };
}

// ---------------------------------------------------------------- keyboard test players
const KB = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: [' ', 'ArrowUp'], down: ['Shift', 'ArrowDown'], ok: ['Enter'], run: ['r'], poses: ['1', '2', '3', '4', '5', '6'] },
  { left: ['a'], right: ['d'], up: ['w'], down: ['s'], ok: ['q'], run: ['f'], poses: ['z', 'x', 'c', 'v', 'b', 'n'] },
];
import { POSES } from './body.js';
export const keyboardHelp = 'P1: ← → lean · Space jump · Shift duck · R run · 1–6 poses · Enter = hands up | P2: A D lean · W jump · S duck · F run · Z–N poses · Q hands up';

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && tracker.players.some((p) => p.kind === 'keyboard')) e.preventDefault(); // Space = jump, not page scroll/button
  for (const pl of tracker.players) {
    if (pl.kind !== 'keyboard') continue;
    const k = KB[pl.keyboardIndex]; if (!k) continue; const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k.left.includes(key)) pl.kb.lane = Math.max(-1, pl.kb.lane - 1);
    if (k.right.includes(key)) pl.kb.lane = Math.min(1, pl.kb.lane + 1);
    if (k.up.includes(key) && !e.repeat) { pl.kb.jumpAt = performance.now(); pl.kb.flaps = (pl.kb.flaps || 0) + 1; }
    if (k.down.includes(key)) pl.kb.duck = true;
    if (k.ok.includes(key)) pl.kb.handsUp = true;
    if (k.run.includes(key)) pl.kb.runAt = performance.now();
    const pi = k.poses.indexOf(key);
    if (pi >= 0) pl.kb.pose = POSES[pi].id;
  }
});
window.addEventListener('keyup', (e) => {
  for (const pl of tracker.players) {
    if (pl.kind !== 'keyboard') continue;
    const k = KB[pl.keyboardIndex]; if (!k) continue; const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k.down.includes(key)) pl.kb.duck = false;
    if (k.ok.includes(key)) pl.kb.handsUp = false;
    if (k.poses.includes(key)) pl.kb.pose = null;
  }
});

// ---------------------------------------------------------------- phone connection (PeerJS / WebRTC)
// Several phones may connect. Until they are linked (calibrated together), only ONE is
// the camera (mixing two unlinked camera angles makes players jump about); the others
// wait on standby but keep sending, so they can be linked. If the main phone goes,
// the next one takes over; a standby phone can tap "Use this camera" to take over.
// Once 2+ cameras are linked, everyone they see is merged (multicam.js).
export const net = {
  roomId: null, peer: null, conn: null, conns: [], phoneUrl: '', onStatus: () => {},
  onMoved: () => {},          // (camera id) a phone was knocked — set by the calibration screen
  wantPics: false,            // the lobby wants small preview pictures from the main camera
  pic: null,                  // latest preview { data (jpeg data URL), at }
  // ask the main camera (only) for preview pictures, or stop
  previews(on) {
    this.wantPics = on;
    for (const c of this.conns) if (c.open) { try { c.send({ type: 'pics', on: on && c === this.viewConn() }); } catch (_) {} }
  },
  // face snapshots: ask the main camera to cut these squares out of its picture
  requestFaces(boxes) {
    const c = this.viewConn();
    if (!c || !c.open) return Promise.reject(new Error('no camera'));
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      this.faceWait = this.faceWait || new Map();
      this.faceWait.set(id, resolve);
      setTimeout(() => { if (this.faceWait.delete(id)) reject(new Error('no answer')); }, 4000);
      c.send({ type: 'faces', id, boxes });
    });
  },
  viewConn() {
    const v = multicam.active() ? multicam.view : null;
    return (v && this.conns.find((c) => c.peer === v && c.open)) || this.conn;
  },
  start() {
    // the same room code after a reload (e.g. the automatic update), so camera phones that
    // were connected find this screen again by themselves
    let id = null;
    try { id = sessionStorage.getItem('ark-room'); } catch (_) {}
    if (!id) id = 'ark-' + Math.random().toString(36).slice(2, 8);
    try { sessionStorage.setItem('ark-room', id); } catch (_) {}
    this.roomId = id;
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    this.phoneUrl = `${base}phone.html?room=${id}`;
    this.idTries = 0;
    this.makePeer();
  },
  makePeer() {
    const id = this.roomId;
    this.peer = new window.Peer(id);
    this.peer.on('error', (e) => {
      console.warn(e);
      // just reloaded: the server still holds our old connection for a few seconds — try again
      if (e.type === 'unavailable-id' && this.idTries++ < 6) {
        this.onStatus('Reconnecting…');
        setTimeout(() => { try { this.peer.destroy(); } catch (_) {} this.makePeer(); }, 2500);
        return;
      }
      this.onStatus('Connection error: ' + e.type);
    });
    this.listen();
  },
  listen() {
    if (this.listening === this.peer) return;
    this.listening = this.peer;
    this.peer.on('open', () => this.onStatus('Waiting for phone…'));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    this.peer.on('connection', (c) => {
      // the same phone reconnecting replaces its old connection (and keeps its role)
      const old = this.conns.find((x) => x.peer === c.peer);
      if (old) { this.conns = this.conns.filter((x) => x !== old); if (this.conn === old) this.conn = c; try { old.close(); } catch (_) {} }
      this.conns.push(c);
      // say a phone is knocking — and if the link never opens, say that too (a browser that
      // can't finish the phone-to-screen link shows up here)
      if (!this.conn || !this.conn.open) this.onStatus('A phone is connecting…');
      setTimeout(() => {
        if (c.open || !this.conns.includes(c)) return;
        const ice = c.peerConnection?.iceConnectionState || '?';
        if (!this.conn || !this.conn.open) this.onStatus(`A phone tried to connect, but the link didn't open (${ice}) — this browser or network may not allow it. Try a computer or Chrome as the screen.`);
      }, 12000);
      c.on('open', () => {
        if (!this.conn || !this.conn.open) this.conn = c;
        this.roles();
      });
      c.on('data', (d) => {
        if (!d) return;
        if (d.type === 'take') { this.conn = c; this.roles(); return; }
        if (d.type === 'faces' && this.faceWait?.has(d.id)) { this.faceWait.get(d.id)(d.images || []); this.faceWait.delete(d.id); return; }
        if (d.type === 'pic') { if (c === this.viewConn()) this.pic = { data: d.data, at: performance.now() }; return; }
        if (d.type === 'moved') {
          // only matters if this phone is in use: linked, or the main camera
          const inUse = !!multicam.cams.get(c.peer)?.calib || c === this.conn;
          multicam.moved(c.peer); this.roles();
          if (inUse) this.onMoved(c.peer);
          return;
        }
        if (d.type === 'pose') {
          multicam.addFrame(c.peer, { poses: d.poses, worlds: d.worlds, aspect: d.aspect, still: d.still });
          if (stats.source !== 'phone') return;
          if (multicam.active()) {
            // linked cameras: the game sees everyone, merged, through the view camera
            if (!multicam.cams.get(multicam.view)?.calib) multicam.view = multicam.linked()[0].id;
            if (c.peer !== multicam.view) return;
            const f = multicam.fuse();
            if (!f) return;
            stats.fps = d.fps; stats.inf = d.inf; stats.linked = f.cams;
            tracker.ingest(f.poses, f.aspect, f.worlds);
            return;
          }
          stats.linked = 0;
          if (c !== this.conn) return;                   // standby phones only help with linking
          stats.fps = d.fps; stats.inf = d.inf;
          tracker.ingest(d.poses, d.aspect, d.worlds, d.colors);
          return;
        }
        if (c !== this.conn) return;
        if (d.type === 'pong') {
          stats.rtt = Math.round(performance.now() - d.t);
        } else if (d.type === 'hello') {
          stats.camera = d.camera || '';
          stats.phoneBuild = d.build || 'old';
        }
      });
      c.on('close', () => {
        this.conns = this.conns.filter((x) => x !== c);
        if (!this.conns.some((x) => x.peer === c.peer)) multicam.disconnect(c.peer);
        if (this.conn === c) { this.conn = this.conns.find((x) => x.open) || null; this.roles(); }
        if (!this.conn) { stats.connected = false; this.onStatus('Phone disconnected — waiting…'); }
      });
    });
    if (!this.pinging) this.pinging = setInterval(() => {
      if (this.conn && this.conn.open) { try { this.conn.send({ type: 'ping', t: performance.now() }); } catch (_) {} }
    }, 1000);
  },
  // tell every phone whether it is the camera or on standby
  roles() {
    this.previews(this.wantPics);
    for (const c of this.conns) if (c.open) { try { c.send({ type: 'role', active: c === this.conn, linked: !!multicam.cams.get(c.peer)?.calib }); } catch (_) {} }
    if (this.conn) {
      stats.connected = true; stats.source = 'phone';
      const extra = this.conns.filter((c) => c.open).length - 1;
      this.onStatus(extra > 0 ? `Phone connected (+${extra} on standby)` : 'Phone connected');
    }
  },
};

// ---------------------------------------------------------------- PC webcam fallback
export const localCam = {
  running: false,
  // opts: { facing: 'user' (front camera, for phone mode), numPoses }
  async start(onStatus = () => {}, opts = {}) {
    if (this.running) return;
    const { createPoseDetector } = await import('./pose.js');
    const video = document.createElement('video');
    video.playsInline = true; video.muted = true;
    onStatus('Starting webcam…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, ...(opts.facing ? { facingMode: opts.facing } : {}) }, audio: false });
    video.srcObject = stream; await video.play();
    // the widest shot this camera can give: zoomed all the way out
    try {
      const track = stream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.zoom && caps.zoom.min !== undefined) await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
    } catch (_) {}
    this.video = video;               // the lobby shows this picture
    const det = await createPoseDetector({ numPoses: opts.numPoses || 4, onStatus });
    // a phone that joined by QR code while this camera was starting stays the camera
    if (net.conn?.open && stats.source === 'phone') {
      stream.getTracks().forEach((t) => t.stop());
      this.video = null;
      onStatus('Phone connected — using it as the camera');
      return;
    }
    stats.source = 'webcam'; stats.camera = stream.getVideoTracks()[0].label;
    this.running = true;
    let frames = 0, t0 = performance.now();
    const loop = () => {
      if (video.readyState >= 2 && stats.source === 'webcam') {
        const { poses, worlds, ms } = det.detect(video);
        stats.inf = Math.round(ms); frames++;
        const now = performance.now();
        if (now - t0 > 1000) { stats.fps = Math.round(frames * 1000 / (now - t0)); frames = 0; t0 = now; }
        tracker.ingest(poses, video.videoWidth / video.videoHeight, worlds, frames % 3 === 0 ? clothesOf(video, poses) : undefined);
      }
      requestAnimationFrame(loop);
    };
    loop();
    onStatus(opts.facing === 'user' ? 'Using this phone’s front camera' : 'Using this computer’s webcam');
  },
};

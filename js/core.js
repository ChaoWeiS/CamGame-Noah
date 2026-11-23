// Core platform: connection (phone → PC), local webcam fallback,
// player tracking/identity and keyboard test players.
import { Body, toPoints, toWorld, keyPoints } from './body.js';

export const PLAYER_COLORS = [0xf2b544, 0x5ec8e5, 0xf27a9b, 0x8be07a];
export const PLAYER_CSS = ['#f2b544', '#5ec8e5', '#f27a9b', '#8be07a'];
export const MAX_PLAYERS = 4;

// ---------------------------------------------------------------- stats
export const stats = {
  source: 'none',        // 'phone' | 'webcam' | 'none'
  connected: false,
  fps: 0, inf: 0, rtt: null, people: 0, lastFrame: 0, camera: '',
  world3D: false,        // is the phone sending the 3D skeleton (new phone page)?
};

// ---------------------------------------------------------------- tracker
class Tracker {
  constructor() {
    this.skeletons = [];   // latest raw people: [{pts, key}]
    this.aspect = 4 / 3;
    this.players = [];     // locked players (camera or keyboard)
    this.locked = false;
  }

  ingest(posesFlat, aspect, worlds = null) {
    this.aspect = aspect || this.aspect;
    stats.world3D = !!(worlds && worlds.length);
    this.skeletons = posesFlat.map((flat, k) => {
      const pts = toPoints(flat, this.aspect);
      return { pts, key: keyPoints(pts), world: worlds && worlds[k] ? toWorld(worlds[k]) : null };
    });
    stats.people = this.skeletons.length;
    stats.lastFrame = performance.now();
    if (this.locked) this.match();
  }

  // Lock the people currently in view as players, left to right.
  lock(keyboardCount = 0) {
    const seen = [...this.skeletons]
      .filter((s) => s.key.sh.v > 0.4)
      .sort((a, b) => a.key.sh.x - b.key.sh.x)
      .slice(0, MAX_PLAYERS - keyboardCount);
    this.players = [];
    seen.forEach((s) => {
      const body = new Body();
      body.update(s.pts, s.world);
      body.calibrateFromCurrent();
      this.players.push(makePlayer(this.players.length, 'camera', body, s.key.sh));
    });
    for (let i = 0; i < keyboardCount && this.players.length < MAX_PLAYERS; i++) {
      this.players.push(makePlayer(this.players.length, 'keyboard', null, null, i));
    }
    this.locked = true;
    return this.players;
  }

  unlock() { this.locked = false; this.players = []; }

  // Keep each player attached to the same person: nearest skeleton to where they last were.
  match() {
    const cams = this.players.filter((p) => p.kind === 'camera');
    const free = this.skeletons.map((s, i) => i);
    const now = performance.now();
    // Present players first (tight radius), then lost ones (wider radius) re-acquire.
    const order = [...cams].sort((a, b) => (b.present ? 1 : 0) - (a.present ? 1 : 0));
    for (const pl of order) {
      let best = -1, bestD = pl.present ? 0.45 : 0.9;
      for (const i of free) {
        const sh = this.skeletons[i].key.sh;
        const d = Math.hypot(sh.x - pl.anchor.x, sh.y - pl.anchor.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        free.splice(free.indexOf(best), 1);
        const s = this.skeletons[best];
        pl.body.update(s.pts, s.world);
        pl.anchor = { x: s.key.sh.x, y: s.key.sh.y };
        pl.present = true;
        pl.lastSeen = now;
      } else if (now - pl.lastSeen > 400) {
        pl.present = false;
      }
    }
  }
}

function makePlayer(slot, kind, body, anchor, keyboardIndex = 0) {
  return {
    slot, kind, body, keyboardIndex,
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
      present: true, lane: pl.kb.lane, ducking: pl.kb.duck,
      jumping: performance.now() - pl.kb.jumpAt < 450,
      pose: pl.kb.pose, handsUp: pl.kb.handsUp,
      run: Math.max(0, 1 - (performance.now() - pl.kb.runAt) / 600), // tap R (P1) / F (P2) to run
    };
  }
  const b = pl.body;
  return {
    present: pl.present, lane: b.lane, ducking: b.ducking, jumping: b.jumping,
    pose: b.pose, handsUp: b.handsUp, run: b.run,
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
    if (k.up.includes(key) && !e.repeat) pl.kb.jumpAt = performance.now();
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
export const net = {
  roomId: null, peer: null, conn: null, phoneUrl: '', onStatus: () => {},
  start() {
    const id = 'ark-' + Math.random().toString(36).slice(2, 8);
    this.roomId = id;
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    this.phoneUrl = `${base}phone.html?room=${id}`;
    this.peer = new window.Peer(id);
    this.peer.on('open', () => this.onStatus('Waiting for phone…'));
    this.peer.on('error', (e) => { console.warn(e); this.onStatus('Connection error: ' + e.type); });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    this.peer.on('connection', (c) => {
      if (this.conn) { try { this.conn.close(); } catch (_) {} }
      this.conn = c;
      c.on('open', () => { stats.connected = true; stats.source = 'phone'; this.onStatus('Phone connected'); });
      c.on('data', (d) => {
        if (!d) return;
        if (d.type === 'pose') {
          if (stats.source !== 'phone') return;
          stats.fps = d.fps; stats.inf = d.inf;
          tracker.ingest(d.poses, d.aspect, d.worlds);
        } else if (d.type === 'pong') {
          stats.rtt = Math.round(performance.now() - d.t);
        } else if (d.type === 'hello') {
          stats.camera = d.camera || '';
        }
      });
      c.on('close', () => { if (this.conn === c) { stats.connected = false; this.conn = null; this.onStatus('Phone disconnected — waiting…'); } });
    });
    setInterval(() => {
      if (this.conn && this.conn.open) { try { this.conn.send({ type: 'ping', t: performance.now() }); } catch (_) {} }
    }, 1000);
  },
};

// ---------------------------------------------------------------- PC webcam fallback
export const localCam = {
  running: false,
  async start(onStatus = () => {}) {
    if (this.running) return;
    const { createPoseDetector } = await import('./pose.js');
    const video = document.createElement('video');
    video.playsInline = true; video.muted = true;
    onStatus('Starting webcam…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play();
    const det = await createPoseDetector({ numPoses: 4, onStatus });
    stats.source = 'webcam'; stats.camera = stream.getVideoTracks()[0].label;
    this.running = true;
    let frames = 0, t0 = performance.now();
    const loop = () => {
      if (video.readyState >= 2 && stats.source === 'webcam') {
        const { poses, worlds, ms } = det.detect(video);
        stats.inf = Math.round(ms); frames++;
        const now = performance.now();
        if (now - t0 > 1000) { stats.fps = Math.round(frames * 1000 / (now - t0)); frames = 0; t0 = now; }
        tracker.ingest(poses, video.videoWidth / video.videoHeight, worlds);
      }
      requestAnimationFrame(loop);
    };
    loop();
    onStatus('Using this computer’s webcam');
  },
};

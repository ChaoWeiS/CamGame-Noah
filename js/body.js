// Turns raw MediaPipe landmarks into game input: lanes, jump, duck, poses.
//
// Coordinates: MediaPipe gives x,y in 0..1 of the camera frame. We mirror x
// (so the screen acts like a mirror) and multiply by the frame aspect, so one
// unit is the same physical size horizontally and vertically (1 = frame height).

export const L = {
  nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20, lThumb: 21, rThumb: 22,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};

export const POSES = [
  { id: 'giraffe', emoji: '🦒', name: 'Giraffe', hint: 'Both arms straight up' },
  { id: 'wings', emoji: '🐦', name: 'Bird wings', hint: 'Arms out to the sides' },
  { id: 'bear', emoji: '🐻', name: 'Bear ears', hint: 'Hands on your head' },
  { id: 'star', emoji: '⭐', name: 'Starfish', hint: 'Arms up wide, feet apart' },
  { id: 'frog', emoji: '🐸', name: 'Frog', hint: 'Squat down low' },
  { id: 'flamingo', emoji: '🦩', name: 'Flamingo', hint: 'Stand on one leg' },
];

// Convert a flat [x,y,v]*33 array into mirrored, aspect-corrected points.
export function toPoints(flat, aspect) {
  const pts = new Array(33);
  for (let i = 0; i < 33; i++) {
    pts[i] = { x: (1 - flat[i * 3]) * aspect, y: flat[i * 3 + 1], v: flat[i * 3 + 2] };
  }
  return pts;
}

// MediaPipe's 3D skeleton (metres, origin between the hips, x right / y down / z away)
// turned into the characters' space: mirrored like the screen, y up, z toward the camera.
export function toWorld(flat) {
  const w = new Array(33);
  for (let i = 0; i < 33; i++) w[i] = { x: -flat[i * 3], y: -flat[i * 3 + 1], z: -flat[i * 3 + 2] };
  return w;
}

// One Euro filter: smooths hard when a point is still (kills jitter) and
// lets it through quickly when it moves fast (no lag on big moves).
class OneEuro {
  constructor(minCutoff = 1.0, beta = 2.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0;
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, dt) {
    if (this.x === null) { this.x = x; return x; }
    const dx = (x - this.x) / dt;
    this.dx += (dx - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (x - this.x) * OneEuro.alpha(cutoff, dt);
    return this.x;
  }
}

// A whole skeleton of One Euro filters (x, y and z if present; visibility eased)
export class SkeletonSmoother {
  constructor(minCutoff = 1.0, beta = 2.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.f = null; this.out = null; this.t = 0;
  }
  update(pts, t = performance.now()) {
    if (!pts) { this.out = null; this.f = null; return null; }
    const dt = this.t ? Math.min(0.2, Math.max(0.005, (t - this.t) / 1000)) : 1 / 30;
    this.t = t;
    if (!this.f) {
      this.f = pts.map(() => ({ x: new OneEuro(this.minCutoff, this.beta), y: new OneEuro(this.minCutoff, this.beta), z: new OneEuro(this.minCutoff * 0.6, this.beta * 0.7) }));
      this.out = pts.map((p) => ({ ...p }));
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], o = this.out[i], f = this.f[i];
      o.x = f.x.filter(p.x, dt); o.y = f.y.filter(p.y, dt);
      if (p.z !== undefined) o.z = f.z.filter(p.z, dt);
      if (p.v !== undefined) o.v = o.v === undefined ? p.v : o.v + (p.v - o.v) * 0.3;
    }
    return this.out;
  }
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function keyPoints(pts) {
  const sh = mid(pts[L.lShoulder], pts[L.rShoulder]);
  const hip = mid(pts[L.lHip], pts[L.rHip]);
  const torso = Math.max(dist(sh, hip), 0.05);
  return { sh, hip, torso };
}

// How far (in torso lengths, ~50 cm) the shoulders move to shift the animal one lane.
// 0.4 ≈ a 20 cm step. Smaller = less room needed. Override with ?step=0.3 in the address.
export const LANE_STEP = +(new URLSearchParams(globalThis.location?.search || '').get('step')) || 0.4;

export class Body {
  constructor() {
    this.pts = null;        // lightly smoothed points (game detection: fast)
    this.vpts = null;       // well smoothed points for showing the body (animals)
    this.world = null;      // well smoothed 3D skeleton (if the phone sends it)
    this.sm2D = new SkeletonSmoother(1.0, 2.0);
    this.sm3D = new SkeletonSmoother(0.8, 1.5);
    this.base = null;       // calibrated standing posture
    this.lane = 0;
    this.side = 0;          // continuous sideways position, −1.2 … 1.2 (lanes at −1, 0, 1)
    this.jumping = false;
    this.ducking = false;
    this.pose = null;
    this.handsUp = false;
    // running on the spot: count alternating knee lifts
    this.stepSide = 0;      // which knee was last lifted (-1 left, 1 right)
    this.steps = [];        // timestamps of recent steps
    this.run = 0;           // 0 = standing still … 1 = running fast
  }

  // Feed one new frame of points for this person.
  update(pts, world = null) {
    const t = performance.now();
    this.world = this.sm3D.update(world, t);
    this.vpts = this.sm2D.update(pts, t);
    if (!this.pts) {
      this.pts = pts.map((p) => ({ ...p }));
    } else {
      const a = 0.6; // smoothing: higher = more responsive
      for (let i = 0; i < 33; i++) {
        const s = this.pts[i], p = pts[i];
        s.x += (p.x - s.x) * a; s.y += (p.y - s.y) * a; s.v = p.v;
      }
    }
    this.analyze();
  }

  calibrateFromCurrent() {
    if (!this.pts) return;
    const { sh, hip, torso } = keyPoints(this.pts);
    const shW = Math.abs(this.pts[L.lShoulder].x - this.pts[L.rShoulder].x);
    this.base = { shX: sh.x, shY: sh.y, hipY: hip.y, torso, shW: Math.max(shW, 0.3 * torso) };
  }

  analyze() {
    const p = this.pts;
    const { sh, hip, torso } = keyPoints(p);
    if (!this.base) this.calibrateFromCurrent();
    const b = this.base;
    const T = (torso + b.torso) / 2;

    // Sideways: the shoulders' shift (a step or a lean), MULTIPLIED so a small step moves
    // the animal a whole lane — players standing close together don't have room to walk
    // far. side: 0 = middle, ±1 = the middle of a side lane (continuous, so the animal
    // glides instead of jumping). lane = whichever lane the animal is mostly in.
    const dx = sh.x - b.shX;
    const target = Math.max(-1.2, Math.min(1.2, dx / (LANE_STEP * T)));
    this.side += (target - this.side) * 0.5;
    const s = this.side;
    if (this.lane === 0) this.lane = s > 0.6 ? 1 : s < -0.6 ? -1 : 0;
    else if (this.lane === 1 && s < 0.4) this.lane = s < -0.6 ? -1 : 0;
    else if (this.lane === -1 && s > -0.4) this.lane = s > 0.6 ? 1 : 0;

    // Jump: shoulders and hips both rise. Duck: shoulders drop a lot.
    const riseSh = b.shY - sh.y, riseHip = b.hipY - hip.y;
    this.jumping = riseSh > 0.12 * T && riseHip > 0.12 * T;
    this.ducking = sh.y - b.shY > 0.3 * T;

    // Slowly follow the player if they drift (only when standing normally).
    if (!this.jumping && !this.ducking && Math.abs(sh.y - b.shY) < 0.15 * T) {
      const k = 0.01;
      b.shY += (sh.y - b.shY) * k; b.hipY += (hip.y - b.hipY) * k;
      b.torso += (torso - b.torso) * k;
      if (Math.abs(this.side) < 0.3) b.shX += (sh.x - b.shX) * k;
    }

    this.detectRunning(p, T);
    this.detectSwipe(p, T);
    this.detectSki(p, sh, hip, T);
    this.detectFlight(p, sh, hip, T);

    const nose = p[L.nose], wl = p[L.lWrist], wr = p[L.rWrist];
    const armsSeen = wl.v > 0.4 && wr.v > 0.4;
    this.handsUp = armsSeen && wl.y < nose.y && wr.y < nose.y;
    this.pose = classify(p, sh, hip, T, b);
  }
}

// Running on the spot: knees take turns lifting. Each switch of the higher knee
// counts as a step; steps per second over the last ~1.5 s gives the running speed.
// Swipe: a raised hand (above the hips) moving quickly sideways — at least about a
// shoulder-and-a-bit across, within 0.45 s, much more sideways than up/down. Measured
// against the shoulders, so leaning or walking doesn't count. After a swipe there is a
// short pause, so the hand coming back isn't read as a swipe the other way.
// takeSwipe() returns +1 (to the right on screen), -1 (left) or 0, once per swipe.
Body.prototype.detectSwipe = function (p, T) {
  const now = performance.now();
  const shX = (p[L.lShoulder].x + p[L.rShoulder].x) / 2, hipY = (p[L.lHip].y + p[L.rHip].y) / 2;
  const shW = Math.max(0.5 * T, Math.abs(p[L.lShoulder].x - p[L.rShoulder].x));
  this.swipeHist = this.swipeHist || { l: [], r: [] };
  if (now - (this.swipeAt || 0) < 700) { this.swipeHist.l = []; this.swipeHist.r = []; return; }
  for (const [k, i] of [['l', L.lWrist], ['r', L.rWrist]]) {
    const w = p[i], h = this.swipeHist[k];
    if (w.v < 0.4 || w.y > hipY) { h.length = 0; continue; }
    h.push({ t: now, x: w.x - shX, y: w.y });
    while (h.length && now - h[0].t > 450) h.shift();
    for (const o of h) {
      const dx = w.x - shX - o.x, dy = w.y - o.y;
      if (Math.abs(dx) > 1.1 * shW && Math.abs(dy) < 0.6 * Math.abs(dx)) {
        this.swipe = Math.sign(dx); this.swipeAt = now;
        this.swipeHist.l = []; this.swipeHist.r = [];
        return;
      }
    }
  }
};
// Skiing:
//   pump  — both hands moving up and down together (like pushing on ski poles): 0 … ~1.2
//   steer — arms stretched out wide, tilted like an aeroplane's wings: the side with the
//           LOWER hand is the way you turn. −1 (screen-left) … 1 (screen-right), 0 = arms level
//   twist — the body turned sideways: −1 … 1 (facing screen-left … screen-right), 0 = facing the screen
Body.prototype.detectSki = function (p, sh, hip, T) {
  const now = performance.now();
  const wl = p[L.lWrist], wr = p[L.rWrist], b = this.base;
  const arms = wl.v > 0.4 && wr.v > 0.4;
  // pump: the hands' average height turning around (top / bottom of each stroke)
  this.pumps = this.pumps || [];
  if (arms) {
    const m = (wl.y + wr.y) / 2 - sh.y, thr = 0.15 * T;
    const pm = this.pm || (this.pm = { ext: m, dir: 0 });
    if (pm.dir >= 0) {
      if (m > pm.ext) pm.ext = m;
      else if (pm.ext - m > thr) { this.pumps.push({ t: now, amp: (pm.ext - m) / T }); pm.dir = -1; pm.ext = m; }
    }
    if (pm.dir < 0) {
      if (m < pm.ext) pm.ext = m;
      else if (m - pm.ext > thr) { this.pumps.push({ t: now, amp: (m - pm.ext) / T }); pm.dir = 1; pm.ext = m; }
    }
  }
  while (this.pumps.length && now - this.pumps[0].t > 1500) this.pumps.shift();
  const rate = this.pumps.length / 1.5;                     // half-strokes per second
  const amp = this.pumps.length ? this.pumps.reduce((s, w) => s + w.amp, 0) / this.pumps.length : 0;
  const pumpTarget = Math.min(1.2, (rate / 2.5) * Math.max(0.5, Math.min(1.3, amp / 0.45)));
  this.pump = (this.pump || 0) + (pumpTarget - (this.pump || 0)) * 0.15;

  // steer: arms out wide (hands far apart, above the hips), tilted
  const gap = Math.abs(wl.x - wr.x);
  let steer = 0;
  if (arms && gap > 1.4 * T && wl.y < hip.y && wr.y < hip.y) {
    const tilt = (wl.y - wr.y) / gap;                        // > 0: the screen-left hand is lower
    const k = Math.sign(tilt) * Math.max(0, Math.abs(tilt) - 0.08);
    steer = -Math.max(-1, Math.min(1, k * 2.6));
  }
  this.steer = (this.steer || 0) + (steer - (this.steer || 0)) * 0.35;

  // twist: shoulders look narrower when the body turns; which way comes from the 3D
  // skeleton (if the phone sends it) or else from where the nose is
  let twist = 0;
  const ls = p[L.lShoulder], rs = p[L.rShoulder];
  if (ls.v > 0.4 && rs.v > 0.4 && b?.shW) {
    const narrow = Math.abs(rs.x - ls.x) / b.shW;
    let amount = Math.max(0, Math.min(1, (0.92 - narrow) / 0.3));
    let sign = 0;
    const w = this.world;
    if (w && w[L.lShoulder] && w[L.rShoulder]) {
      const yaw = Math.atan2(w[L.lShoulder].z - w[L.rShoulder].z, w[L.rShoulder].x - w[L.lShoulder].x);
      sign = Math.sign(yaw);
      amount = Math.max(amount, Math.max(0, Math.min(1, (Math.abs(yaw) - 0.25) / 0.6)));
    } else if (p[L.nose].v > 0.4) {
      const off = (p[L.nose].x - sh.x) / Math.max(0.05, Math.abs(rs.x - ls.x) + 0.2 * T);
      sign = Math.abs(off) > 0.08 ? Math.sign(off) : 0;
    }
    twist = sign * amount;
  }
  this.twist = (this.twist || 0) + (twist - (this.twist || 0)) * 0.3;
};
// Flying:
//   flapCount — goes up by one for every flap: both hands sweeping DOWN together, quickly
//   glide     — 0 … 1: arms stretched out wide at about shoulder height (wings spread)
//   fold      — 0 … 1: hands down by the sides (wings folded: drop fast)
// (steer, from detectSki, works for flying too: tilt the outstretched arms like a plane)
Body.prototype.detectFlight = function (p, sh, hip, T) {
  const now = performance.now();
  const wl = p[L.lWrist], wr = p[L.rWrist];
  this.flapCount = this.flapCount || 0;
  if (!(wl.v > 0.4 && wr.v > 0.4)) { this.glide = (this.glide || 0) * 0.9; this.fold = (this.fold || 0) * 0.9; return; }
  const m = (wl.y + wr.y) / 2 - sh.y;                 // hands below the shoulders (> 0) or above (< 0)
  const gap = Math.abs(wl.x - wr.x);
  // a flap: one per downstroke — counted as soon as the hands have swept down far enough
  // from the top of the stroke; the next one counts after the hands have gone back up
  const fl = this.fl || (this.fl = { dir: 1, ext: m, top: m, counted: false });
  if (fl.dir > 0) {                                   // going down (m growing)
    if (m > fl.ext) fl.ext = m;
    if (!fl.counted && m - fl.top > 0.3 * T) { this.flapCount++; this.flapAt = now; fl.counted = true; }
    if (fl.ext - m > 0.1 * T) { fl.dir = -1; fl.ext = m; }
  } else {                                            // going up
    if (m < fl.ext) fl.ext = m;
    if (m - fl.ext > 0.1 * T) { fl.dir = 1; fl.top = fl.ext; fl.ext = m; fl.counted = false; }
  }
  const spread = gap > 1.4 * T && Math.abs(m) < 0.5 * T ? 1 : 0;
  const folded = m > 0.6 * T || (gap < 0.9 * T && m > 0.2 * T) ? 1 : 0;
  this.glide = (this.glide || 0) + (spread - (this.glide || 0)) * 0.3;
  this.fold = (this.fold || 0) + (folded - (this.fold || 0)) * 0.3;
};
Body.prototype.takeSwipe = function () { const s = this.swipe || 0; this.swipe = 0; return s; };

Body.prototype.detectRunning = function (p, T) {
  const now = performance.now();
  const kl = p[L.lKnee], kr = p[L.rKnee];
  if (kl.v > 0.4 && kr.v > 0.4) {
    const diff = kr.y - kl.y;                 // > 0 when the left knee is higher
    const side = diff > 0.12 * T ? -1 : diff < -0.12 * T ? 1 : 0;
    if (side !== 0 && side !== this.stepSide) {
      this.stepSide = side;
      this.steps.push(now);
    }
  }
  while (this.steps.length && now - this.steps[0] > 1500) this.steps.shift();
  const cadence = this.steps.length / 1.5;    // steps per second
  const legs = Math.min(1, cadence / 4);      // ~4 steps/s = full speed

  // Arm swinging, like a runner: the hands must take turns (one up while the other
  // goes down). Each time the higher hand switches counts as a swing; faster and
  // bigger swings = faster running. Waving one arm or raising both doesn't count.
  const wl = p[L.lWrist], wr = p[L.rWrist];
  this.wristHist = this.wristHist || [];
  this.swings = this.swings || [];
  if (wl.v > 0.4 && wr.v > 0.4) {
    this.wristHist.push({ t: now, l: wl.y, r: wr.y });
    while (this.wristHist.length && now - this.wristHist[0].t > 700) this.wristHist.shift();
    const range = (k) => Math.max(...this.wristHist.map((h) => h[k])) - Math.min(...this.wristHist.map((h) => h[k]));
    const rl = range('l'), rr = range('r');
    const bothMoving = rl > 0.12 * T && rr > 0.12 * T;
    const diff = wr.y - wl.y;
    const side = diff > 0.08 * T ? -1 : diff < -0.08 * T ? 1 : 0;   // which hand is higher
    if (side !== 0 && side !== this.swingSide) {
      this.swingSide = side;
      if (bothMoving) this.swings.push({ t: now, amp: Math.min(rl, rr) / T });
    }
  }
  while (this.swings.length && now - this.swings[0].t > 1500) this.swings.shift();
  const swingRate = this.swings.length / 1.5;                       // swings per second
  const amp = this.swings.length ? this.swings.reduce((s, w) => s + w.amp, 0) / this.swings.length : 0;
  const vigour = Math.max(0.4, Math.min(1.2, amp / 0.6));          // big swings count for more
  const arms = Math.min(1.2, (swingRate / 4) * vigour);
  this.armRun = arms; this.legRun = legs;

  // either one runs; both together give a little extra (up to 1.25)
  const target = Math.min(1.25, Math.max(legs, arms) + 0.25 * Math.min(legs, arms));
  this.run += (target - this.run) * 0.15;     // smooth it
};

function classify(p, sh, hip, T, b) {
  const nose = p[L.nose], wl = p[L.lWrist], wr = p[L.rWrist];
  const al = p[L.lAnkle], ar = p[L.rAnkle];
  const arms = wl.v > 0.4 && wr.v > 0.4;
  const feet = al.v > 0.4 && ar.v > 0.4;
  const handGap = Math.abs(wl.x - wr.x);

  if (arms) {
    const bothAboveShoulders = wl.y < sh.y && wr.y < sh.y;
    // star: arms up and wide, feet apart — ankles if they can be seen, else knees; and if the
    // legs are out of view altogether (a narrow camera cuts feet off), a wide "V" of arms is enough
    if (bothAboveShoulders && handGap > 1.5 * T) {
      const kl = p[L.lKnee], kr = p[L.rKnee];
      const knees = kl.v > 0.4 && kr.v > 0.4;
      const legsApart = (feet && Math.abs(al.x - ar.x) > 0.55 * T) || (!feet && knees && Math.abs(kl.x - kr.x) > 0.45 * T);
      const legsUnseen = !feet && !knees;
      if (legsApart || (legsUnseen && handGap > 1.9 * T)) return 'star';
    }
    if (wl.y < nose.y - 0.25 * T && wr.y < nose.y - 0.25 * T && handGap < 1.3 * T) return 'giraffe';
    if (bothAboveShoulders && wl.y > nose.y - 0.6 * T && wr.y > nose.y - 0.6 * T &&
        Math.abs(wl.x - nose.x) < 0.8 * T && Math.abs(wr.x - nose.x) < 0.8 * T) return 'bear';
    if (Math.abs(wl.y - sh.y) < 0.4 * T && Math.abs(wr.y - sh.y) < 0.4 * T && handGap > 1.9 * T) return 'wings';
  }
  if (hip.y - b.hipY > 0.35 * T) return 'frog';
  if (feet && Math.abs(al.y - ar.y) > 0.3 * T) return 'flamingo';
  return null;
}

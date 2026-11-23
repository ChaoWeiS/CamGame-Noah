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

export class Body {
  constructor() {
    this.pts = null;        // lightly smoothed points (game detection: fast)
    this.vpts = null;       // well smoothed points for showing the body (animals)
    this.world = null;      // well smoothed 3D skeleton (if the phone sends it)
    this.sm2D = new SkeletonSmoother(1.0, 2.0);
    this.sm3D = new SkeletonSmoother(0.8, 1.5);
    this.base = null;       // calibrated standing posture
    this.lane = 0;
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
    this.base = { shX: sh.x, shY: sh.y, hipY: hip.y, torso };
  }

  analyze() {
    const p = this.pts;
    const { sh, hip, torso } = keyPoints(p);
    if (!this.base) this.calibrateFromCurrent();
    const b = this.base;
    const T = (torso + b.torso) / 2;

    // Lanes: sideways shift of the shoulders (lean or step), with hysteresis.
    const dx = sh.x - b.shX;
    const on = 0.35 * T, off = 0.2 * T;
    if (this.lane === 0) this.lane = dx > on ? 1 : dx < -on ? -1 : 0;
    else if (this.lane === 1 && dx < off) this.lane = dx < -on ? -1 : 0;
    else if (this.lane === -1 && dx > -off) this.lane = dx > on ? 1 : 0;

    // Jump: shoulders and hips both rise. Duck: shoulders drop a lot.
    const riseSh = b.shY - sh.y, riseHip = b.hipY - hip.y;
    this.jumping = riseSh > 0.12 * T && riseHip > 0.12 * T;
    this.ducking = sh.y - b.shY > 0.3 * T;

    // Slowly follow the player if they drift (only when standing normally).
    if (!this.jumping && !this.ducking && Math.abs(sh.y - b.shY) < 0.15 * T) {
      const k = 0.01;
      b.shY += (sh.y - b.shY) * k; b.hipY += (hip.y - b.hipY) * k;
      b.torso += (torso - b.torso) * k;
      if (this.lane === 0) b.shX += (sh.x - b.shX) * k;
    }

    this.detectRunning(p, T);

    const nose = p[L.nose], wl = p[L.lWrist], wr = p[L.rWrist];
    const armsSeen = wl.v > 0.4 && wr.v > 0.4;
    this.handsUp = armsSeen && wl.y < nose.y && wr.y < nose.y;
    this.pose = classify(p, sh, hip, T, b);
  }
}

// Running on the spot: knees take turns lifting. Each switch of the higher knee
// counts as a step; steps per second over the last ~1.5 s gives the running speed.
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
    if (bothAboveShoulders && feet && handGap > 1.5 * T && Math.abs(al.x - ar.x) > 0.8 * T) return 'star';
    if (wl.y < nose.y - 0.25 * T && wr.y < nose.y - 0.25 * T && handGap < 1.3 * T) return 'giraffe';
    if (bothAboveShoulders && wl.y > nose.y - 0.6 * T && wr.y > nose.y - 0.6 * T &&
        Math.abs(wl.x - nose.x) < 0.8 * T && Math.abs(wr.x - nose.x) < 0.8 * T) return 'bear';
    if (Math.abs(wl.y - sh.y) < 0.4 * T && Math.abs(wr.y - sh.y) < 0.4 * T && handGap > 1.9 * T) return 'wings';
  }
  if (hip.y - b.hipY > 0.35 * T) return 'frog';
  if (feet && Math.abs(al.y - ar.y) > 0.3 * T) return 'flamingo';
  return null;
}

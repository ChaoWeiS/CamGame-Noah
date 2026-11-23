// Turns raw MediaPipe landmarks into game input: lanes, jump, duck, poses.
//
// Coordinates: MediaPipe gives x,y in 0..1 of the camera frame. We mirror x
// (so the screen acts like a mirror) and multiply by the frame aspect, so one
// unit is the same physical size horizontally and vertically (1 = frame height).

export const L = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
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
    this.pts = null;        // smoothed points
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
  update(pts) {
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
  const target = Math.min(1, cadence / 4);    // ~4 steps/s = full speed
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

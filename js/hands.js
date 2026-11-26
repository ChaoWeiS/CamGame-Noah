// Hands, read close up (phone side).
// The pose model sees a whole person in a small picture, so a hand is a few pixels: it can't
// tell a fist from an open hand, or which way the palm faces. So for each hand the pose model
// found, a square around it is cut out of the full-resolution camera picture, enlarged, and
// given to MediaPipe's hand model. A few hands are read per frame (taking turns), each hand
// about 5–10 times a second.
//   grip: 0 = open hand … 1 = fist
//   n:    which way the palm faces (unit vector, camera's axes: x right, y down, z away)
import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const MODEL_URLS = [
  new URL('../models/hand_landmarker.task', import.meta.url).href,
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
];
const CROP = 192;              // the enlarged hand picture (pixels)
const BUDGET_MS = 18;          // time to spend on hands per frame (about)
const KEEP_MS = 600;           // a reading is sent for this long

// pose landmarks: [wrist, pinky, index, thumb, elbow] for each side (the person's own left/right)
const SIDES = { L: [15, 17, 19, 21, 13], R: [16, 18, 20, 22, 14] };

const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// 21 hand points (metres) → grip and palm direction. For a right hand, (index knuckle − wrist) ×
// (little-finger knuckle − wrist) points out of the palm; a left hand is its mirror image.
export function handShape(w, side) {
  const palmLen = len(sub(w[9], w[0])) || 1e-3;
  const tips = [8, 12, 16, 20].reduce((s, i) => s + len(sub(w[i], w[0])), 0) / 4;
  const ratio = tips / palmLen;                       // open ≈ 1.9, fist ≈ 1.0
  const grip = Math.max(0, Math.min(1, (1.75 - ratio) / 0.65));
  const a = sub(w[5], w[0]), b = sub(w[17], w[0]);
  let n = side === 'R' ? cross(a, b) : cross(b, a);
  const l = len(n) || 1;
  n = n.map((v) => Math.round((v / l) * 100) / 100);
  return { grip: Math.round(grip * 100) / 100, n };
}

export async function createHandReader({ onStatus = () => {} } = {}) {
  const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
  let lm = null, lastErr;
  for (const modelAssetPath of MODEL_URLS) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        lm = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate }, runningMode: 'IMAGE', numHands: 1,
          minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4,
        });
        break;
      } catch (e) { lastErr = e; console.warn('Hand model', modelAssetPath, delegate, e); }
    }
    if (lm) break;
  }
  if (!lm) throw lastErr || new Error('no hand model');
  onStatus('Hand reader ready');

  const cv = document.createElement('canvas'); cv.width = cv.height = CROP;
  const ctx = cv.getContext('2d', { willReadFrequently: false });
  let readings = [];               // { u, v, s, g, n, at, ok }
  let perHand = 12;                // measured ms per hand
  const last = new Map();          // rough spot → when it was last read (so hands take turns)
  const spot = (s, u, v) => `${s}${Math.round(u * 8)},${Math.round(v * 8)}`;

  return {
    // frame: the full-resolution upright picture; poses: flat [x, y, vis]×33 per person (0..1)
    read(frame, poses) {
      const W = frame.videoWidth || frame.width, H = frame.videoHeight || frame.height, now = performance.now();
      const wanted = [];
      poses.forEach((flat) => {
        const P = (i) => ({ x: flat[i * 3] * W, y: flat[i * 3 + 1] * H, v: flat[i * 3 + 2] });
        for (const [s, [wi, pi, ii, ti, ei]] of Object.entries(SIDES)) {
          const wr = P(wi), pk = P(pi), ix = P(ii), el = P(ei);
          if (wr.v < 0.5) continue;
          const mx = (pk.x + ix.x) / 2, my = (pk.y + ix.y) / 2;
          const cx = wr.x * 0.4 + mx * 0.6, cy = wr.y * 0.4 + my * 0.6;
          const fore = el.v > 0.3 ? Math.hypot(wr.x - el.x, wr.y - el.y) : 0;
          const side = Math.max(48, 1.25 * fore, 3.2 * Math.hypot(mx - wr.x, my - wr.y));
          const u = wr.x / W, v = wr.y / H, key = spot(s, u, v);
          wanted.push({ s, u, v, cx, cy, side, key, ti, wait: now - (last.get(key) || 0) });
        }
      });
      wanted.sort((a, b) => b.wait - a.wait);          // the longest-waiting hands first
      const n = Math.max(1, Math.min(wanted.length, Math.floor(BUDGET_MS / Math.max(4, perHand))));
      for (const h of wanted.slice(0, n)) {
        const t0 = performance.now();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CROP, CROP);
        ctx.drawImage(frame, h.cx - h.side / 2, h.cy - h.side / 2, h.side, h.side, 0, 0, CROP, CROP);
        let r = null;
        try { r = lm.detect(cv); } catch (e) { console.warn('hand', e); }
        perHand += (performance.now() - t0 - perHand) * 0.2;
        last.set(h.key, now);
        const w = r?.worldLandmarks?.[0];
        readings = readings.filter((q) => !(q.s === h.s && Math.hypot(q.u - h.u, q.v - h.v) < 0.04));
        if (w && w.length === 21) {
          const { grip, n } = handShape(w, h.s);
          readings.push({ u: Math.round(h.u * 1000) / 1000, v: Math.round(h.v * 1000) / 1000, s: h.s, g: grip, n, at: now });
        }
      }
      readings = readings.filter((q) => now - q.at < KEEP_MS);
      for (const k of last.keys()) if (now - last.get(k) > 3000) last.delete(k);
      return readings.map((q) => ({ u: q.u, v: q.v, s: q.s, g: q.g, n: q.n, a: Math.round(now - q.at) }));
    },
    get msPerHand() { return Math.round(perHand); },
  };
}

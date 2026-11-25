// Clothes colours: each person's shirt (between the shoulders and hips) and trousers/skirt
// (the thighs), read from the camera picture at their body points. Used to tell players
// apart — to keep each animal on the right child, and to put it back if it ever swaps.
// No imports: the camera phone page uses this too.

const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const cx = cv ? cv.getContext('2d', { willReadFrequently: true }) : null;
const W = 160;                    // the picture is read at this small size (fast, and averages the cloth)

// sRGB (0..255) → CIE Lab
function lab(r, g, b) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = h(x); y = h(y); z = h(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

// src: a canvas or video (the picture the poses were found in); poses: flat 33*3 (x, y, visibility), 0..1
// returns one { shirt: [L,a,b] | null, legs: [L,a,b] | null } per pose
export function clothesOf(src, poses) {
  if (!cx || !poses.length) return poses.map(() => null);
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  if (!sw || !sh) return poses.map(() => null);
  const h = Math.round(W * sh / sw);
  if (cv.width !== W || cv.height !== h) { cv.width = W; cv.height = h; }
  cx.drawImage(src, 0, 0, W, h);
  const px = cx.getImageData(0, 0, W, h).data;
  const at = (x, y) => {
    const i = (Math.min(h - 1, Math.max(0, Math.round(y * h))) * W + Math.min(W - 1, Math.max(0, Math.round(x * W)))) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  return poses.map((f) => {
    const P = (i) => ({ x: f[i * 3], y: f[i * 3 + 1], v: f[i * 3 + 2] });
    const ls = P(11), rs = P(12), lh = P(23), rh = P(24), lk = P(25), rk = P(26);
    const sample = (pts) => {
      if (pts.length < 4) return null;
      const L = [], A = [], B = [];
      for (const p of pts) { const c = lab(...at(p.x, p.y)); L.push(c[0]); A.push(c[1]); B.push(c[2]); }
      return [median(L), median(A), median(B)];      // the middle colour: an arm in front doesn't spoil it
    };
    let shirt = null, legs = null;
    if (ls.v > 0.5 && rs.v > 0.5) {
      const shw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      const hipL = lh.v > 0.4 ? lh : { x: ls.x, y: ls.y + shw * 1.3 }, hipR = rh.v > 0.4 ? rh : { x: rs.x, y: rs.y + shw * 1.3 };
      const pts = [];
      for (const u of [0.3, 0.5, 0.7]) for (const v of [0.25, 0.5, 0.75]) {
        const tx = ls.x + (rs.x - ls.x) * u, ty = ls.y + (rs.y - ls.y) * u;
        const bx = hipL.x + (hipR.x - hipL.x) * u, by = hipL.y + (hipR.y - hipL.y) * u;
        pts.push({ x: tx + (bx - tx) * v, y: ty + (by - ty) * v });
      }
      shirt = sample(pts);
    }
    const thigh = [];
    for (const [hp, kn] of [[lh, lk], [rh, rk]]) {
      if (hp.v > 0.5 && kn.v > 0.5) for (const v of [0.3, 0.5, 0.7]) thigh.push({ x: hp.x + (kn.x - hp.x) * v, y: hp.y + (kn.y - hp.y) * v });
    }
    legs = sample(thigh);
    return shirt || legs ? { shirt, legs } : null;
  });
}

// how different two people's clothes look (≈ ΔE; brightness counts half, as lighting changes it)
export function clothesDiff(a, b) {
  if (!a || !b) return null;
  const d = (p, q) => Math.hypot((p[0] - q[0]) * 0.5, p[1] - q[1], p[2] - q[2]);
  let sum = 0, w = 0;
  if (a.shirt && b.shirt) { sum += d(a.shirt, b.shirt); w += 1; }
  if (a.legs && b.legs) { sum += 0.6 * d(a.legs, b.legs); w += 0.6; }
  return w ? sum / w : null;
}
// blend a new reading into a running average
export function clothesBlend(look, c, k) {
  if (!c) return look;
  if (!look) return { shirt: c.shirt && [...c.shirt], legs: c.legs && [...c.legs] };
  const mix = (p, q) => (q ? (p ? p.map((v, i) => v + (q[i] - v) * k) : [...q]) : p);
  return { shirt: mix(look.shirt, c.shirt), legs: mix(look.legs, c.legs) };
}

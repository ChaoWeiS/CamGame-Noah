// Face snapshots for the Hall of Fame, taken when the lobby countdown ends.
// No extra face-finding AI: the pose tracker already knows where each face is (nose,
// eyes, ears). The camera phone cuts a square around each head out of its own sharp
// picture and sends back small JPEGs (the PC only ever gets body points). With the
// computer's own webcam, the square is cut from the webcam picture directly.
import { net, stats, localCam } from './core.js';
import { L } from './body.js';
import { crop } from './facecrop.js';


// where a player's face is, in the camera's own picture: centre (0…1 across, 0…1 down)
// and side (as a share of the picture's height). pts are the game's mirrored points.
function faceBox(pts, aspect) {
  const ok = (i) => pts[i] && pts[i].v > 0.3;
  if (!ok(L.nose)) return null;
  const raw = (p) => ({ u: 1 - p.x / aspect, v: p.y });             // undo the mirror, back to 0…1
  const nose = raw(pts[L.nose]);
  let side = 0;
  if (ok(L.lEar) && ok(L.rEar)) side = Math.hypot(pts[L.lEar].x - pts[L.rEar].x, pts[L.lEar].y - pts[L.rEar].y) * 2.4;
  if (ok(L.lShoulder) && ok(L.rShoulder)) side = Math.max(side, Math.abs(pts[L.lShoulder].x - pts[L.rShoulder].x) * 0.85);
  if (!side) return null;
  return { cx: nose.u, cy: nose.v - side * 0.08, s: side };
}

// Take a snapshot of every camera player's face; sets pl.photo (or leaves it null).
export async function snapFaces(players, aspect) {
  const cams = players.filter((p) => p.kind === 'camera' && p.body?.pts);
  if (!cams.length) return;
  const boxes = cams.map((p) => faceBox(p.body.pts, aspect));
  let images = [];
  if (stats.source === 'webcam' && localCam.video) {
    const v = localCam.video;
    images = boxes.map((b) => (b ? crop(v, v.videoWidth, v.videoHeight, b) : null));
  } else {
    images = await net.requestFaces(boxes).catch(() => []);
  }
  cams.forEach((p, i) => { if (images[i]) p.photo = images[i]; });
}


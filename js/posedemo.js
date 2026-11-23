// Demo skeletons for the password poses, so a 3D animal can show each pose.
// Built like a real camera skeleton (2D points + 3D world points), then posed
// through the same whole-body mapping the players use.
import { toPoints, toWorld, keyPoints } from './body.js';

// joints in metres, camera image axes: x right in the image (= the person's left), y down, z away
const STAND = {
  0: [0, -0.62, -0.08], 7: [0.07, -0.66, 0.02], 8: [-0.07, -0.66, 0.02],
  11: [0.18, -0.48, 0], 12: [-0.18, -0.48, 0],
  23: [0.11, 0, 0], 24: [-0.11, 0, 0],
  25: [0.12, 0.42, 0], 26: [-0.12, 0.42, 0], 27: [0.12, 0.84, 0], 28: [-0.12, 0.84, 0],
  31: [0.12, 0.88, -0.1], 32: [-0.12, 0.88, -0.1],
};
const ARMS = {   // [left elbow, left wrist, right elbow, right wrist]
  down: [[0.22, -0.22, 0], [0.24, 0.02, 0], [-0.22, -0.22, 0], [-0.24, 0.02, 0]],
  giraffe: [[0.2, -0.78, 0], [0.2, -1.04, 0], [-0.2, -0.78, 0], [-0.2, -1.04, 0]],
  wings: [[0.45, -0.48, 0], [0.72, -0.48, 0], [-0.45, -0.48, 0], [-0.72, -0.48, 0]],
  bear: [[0.34, -0.72, 0.02], [0.1, -0.8, 0], [-0.34, -0.72, 0.02], [-0.1, -0.8, 0]],
  star: [[0.4, -0.72, 0], [0.6, -0.94, 0], [-0.4, -0.72, 0], [-0.6, -0.94, 0]],
  frog: [[0.2, -0.36, -0.24], [0.2, -0.38, -0.5], [-0.2, -0.36, -0.24], [-0.2, -0.38, -0.5]],
  flamingo: [[0.4, -0.38, 0], [0.62, -0.3, 0], [-0.4, -0.38, 0], [-0.62, -0.3, 0]],
};
const LEGS = {   // [left knee, left ankle, right knee, right ankle], and how far the hips drop
  star: { j: [[0.24, 0.4, 0], [0.36, 0.8, 0], [-0.24, 0.4, 0], [-0.36, 0.8, 0]], drop: 0.04 },
  frog: { j: [[0.34, 0.14, -0.18], [0.2, 0.52, -0.04], [-0.34, 0.14, -0.18], [-0.2, 0.52, -0.04]], drop: 0.32 },
  flamingo: { j: [[0.12, 0.42, 0], [0.12, 0.84, 0], [-0.1, 0.18, -0.34], [-0.1, 0.5, -0.12]], drop: 0 },
};

function build(poseId, t) {
  const J = {};
  for (const [k, v] of Object.entries(STAND)) J[k] = [...v];
  const arms = ARMS[poseId] || ARMS.down;
  const sway = Math.sin(t * 2.2) * 0.02;       // a little breathing so it looks alive
  [[13, 15, 0, 1, 1], [14, 16, 2, 3, -1]].forEach(([e, w, ie, iw]) => {
    J[e] = [...arms[ie]]; J[w] = [arms[iw][0], arms[iw][1] + sway, arms[iw][2]];
  });
  // fingers: a little past the wrist, along the forearm
  [[13, 15, 17, 19, 21], [14, 16, 18, 20, 22]].forEach(([e, w, pk, ix, th]) => {
    const d = [0, 1, 2].map((k) => J[w][k] - J[e][k]), len = Math.hypot(...d) || 1;
    const f = (s, side) => [J[w][0] + d[0] / len * s + side, J[w][1] + d[1] / len * s, J[w][2] + d[2] / len * s];
    J[ix] = f(0.09, 0); J[pk] = f(0.08, 0.02); J[th] = f(0.05, -0.02);
  });
  const legs = LEGS[poseId];
  if (legs) [25, 27, 26, 28].forEach((k, i) => { J[k] = [...legs.j[i]]; });
  const drop = legs ? legs.drop : 0;
  // 2D points (normalised image, 4:3) with the hips dropped for squats, and the 3D world points
  const img = [], world = [];
  for (let i = 0; i < 33; i++) {
    const [x, y, z] = J[i] || J[0];
    img.push(0.5 + x / 2.2 / (4 / 3), 0.5 + (y + drop) / 2.2, 0.95);
    world.push(x, y, z);
  }
  return { img, world };
}

const standing = toPoints(build('stand', 0).img, 4 / 3);
const { hip, torso } = keyPoints(standing);
const BASE = { hipY: hip.y, torso, shX: 0, shY: 0 };

// { pts, world, base } for the pose, ready for Stage3D.place(...)
export function demoPose(poseId, t = 0) {
  const { img, world } = build(poseId, t);
  const pts = toPoints(img, 4 / 3);
  // how far the hips dropped (in torsos): the animal is lifted by this so its feet stay on the ground
  const drop = (BASE.hipY - keyPoints(pts).hip.y) / BASE.torso;
  return { pts, world: toWorld(world), base: BASE, drop };
}

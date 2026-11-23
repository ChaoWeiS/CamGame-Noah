// Skeleton lines (MediaPipe landmark indices) for drawing stick figures.
// Matches the 3D rig: shoulder bar (chest), hip bar (hips), arms, hands, legs and head.
// The spine (hips → waist → chest → neck) joins midpoints, so it is drawn separately (SPINE).
export const BONES = [
  [11, 12], [23, 24],                                   // shoulder bar, hip bar
  [11, 13], [13, 15], [12, 14], [14, 16],               // arms
  [15, 17], [15, 19], [15, 21], [17, 19],               // left hand: pinky, index, thumb
  [16, 18], [16, 20], [16, 22], [18, 20],               // right hand
  [23, 25], [25, 27], [24, 26], [26, 28],               // legs
  [27, 31], [28, 32],                                   // feet
  [7, 8], [0, 7], [0, 8],                               // head: ear to ear, nose
];
// spine joints, as [a, b, t]: the point t of the way from the middle of pair a to the middle of pair b
//   hips (mid hips) → waist → chest (mid shoulders) → neck (mid ears)
export const SPINE = [[[23, 24], [11, 12], 0], [[23, 24], [11, 12], 0.4], [[23, 24], [11, 12], 1], [[7, 8], [7, 8], 0]];

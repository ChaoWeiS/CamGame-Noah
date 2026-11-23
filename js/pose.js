// Shared MediaPipe pose wrapper, used by the phone page and the PC "local webcam" mode.
import { FilesetResolver, PoseLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const MODEL_URLS = [
  new URL('../models/pose_landmarker_lite.task', import.meta.url).href,
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
];

export async function createPoseDetector({ numPoses = 4, onStatus = () => {} } = {}) {
  onStatus('Loading pose engine…');
  const wasmBase = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);

  let lastErr;
  for (const modelAssetPath of MODEL_URLS) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        onStatus(`Loading model (${delegate})…`);
        const landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          numPoses,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        onStatus(`Pose engine ready (${delegate})`);
        return wrap(landmarker, delegate);
      } catch (e) {
        lastErr = e;
        console.warn('Pose init failed', modelAssetPath, delegate, e);
      }
    }
  }
  throw lastErr || new Error('Could not load pose model');
}

function wrap(landmarker, delegate) {
  let lastTs = -1;
  return {
    delegate,
    // Returns { poses: [Float32-ish flat arrays of 33*3 (x, y, visibility)], ms }
    detect(video) {
      let ts = performance.now();
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      const t0 = performance.now();
      const res = landmarker.detectForVideo(video, ts);
      const ms = performance.now() - t0;
      const poses = (res.landmarks || []).map((lm) => {
        const flat = new Array(lm.length * 3);
        for (let i = 0; i < lm.length; i++) {
          flat[i * 3] = Math.round(lm[i].x * 1000) / 1000;
          flat[i * 3 + 1] = Math.round(lm[i].y * 1000) / 1000;
          flat[i * 3 + 2] = Math.round((lm[i].visibility ?? 1) * 100) / 100;
        }
        return flat;
      });
      return { poses, ms };
    },
  };
}

export { BONES } from './bones.js';

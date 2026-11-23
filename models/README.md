# Pose model (optional, for offline use)

By default the game downloads the MediaPipe pose model from Google the first
time it runs (then the browser caches it).

To run without internet (e.g. at church), download this file and put it here
with the same name:

https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

→ `models/pose_landmarker_lite.task`

The game always tries this local file first.

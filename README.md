# CamGame-Noah: Race to the Ark 🛶

A proof-of-concept, Kinect-style motion game for kids. A phone is the camera, a
computer (e.g. the church iMac) is the big-screen display, and the kids play with
their bodies.

**Flow:** pick your character → race to the ark (lean / jump / duck past obstacles) →
animal-pose password at the ark door (30 s) → results with a rainbow 🌈

## How to play

1. Open `index.html` on the computer (GitHub Pages link) and put it on the TV/projector.
2. On the phone, scan the QR code. The phone page opens. Tap **Start camera**.
3. Prop the phone up sideways (landscape), about 3 m away, so everyone fits head to toe.
4. Players stand in a row. Anyone raises **both hands** to start, then everyone stands still for 3 s (calibration).
5. **Pick:** lean left/right to change character (Barnaby, Scout, Whiskers, Spike, Cluck, Squeak, Hammy, Pine), raise both hands to choose.
6. **Race:** run on the spot to go faster (standing still = 60% speed, running hard = 150%). Lean or step left/right into the free lane past rocks and trees, jump over logs and low branches, duck under high branches.
7. **Password:** copy 5 animal poses in a row = 1 point. Most points in 30 s wins.

Poses: 🦒 Giraffe (arms straight up) · 🐦 Bird wings (arms out sideways) · 🐻 Bear ears (hands on head)
· ⭐ Starfish (arms up wide, feet apart) · 🐸 Frog (squat) · 🦩 Flamingo (one leg).

### No phone? Testing options
- **Use this computer's webcam:** a button in the lobby runs the tracking on the computer itself.
- **Keyboard players** (lobby button, up to 2), for testing game logic without a camera:
  - P1: ← → lean · ↑ jump · ↓ duck · tap R to run · 1–6 poses · Enter = hands up
  - P2: A D lean · W jump · S duck · tap F to run · Z X C V B N poses · Space = hands up
- **F9** toggles the stats overlay (camera fps, pose time, round trip, people seen).

## Screen layout
- The game fits the display's shape automatically, from 16:9 (1920×1080) to 16:10 (1920×1200). Refresh the page after resizing the window.
- Split screen, up to 4 players: 1 player = full screen, 2 = side by side, 3–4 = 2×2 grid.
  Each pane has its own camera, so every player gets a full-size view of their race and password.

## How it works

```
phone.html  ── camera → MediaPipe pose (on the phone) → stick-figure points ──┐
                                                                             │ WebRTC (PeerJS)
index.html  ◀── points ── tracker (who is who) → body.js (lane/jump/duck/pose) → Phaser game
```

- Only body points are sent (a few KB/s). Video never leaves the phone.
- Connection: WebRTC via PeerJS's free public signalling server, so no server of our own is needed. Works on static hosting.
- Players are assigned left → right at the start and then followed by position.

| File | What it does |
|---|---|
| `phone.html` | Camera page: camera picker, pose detection, sends points, keeps screen awake |
| `js/pose.js` | MediaPipe Pose Landmarker wrapper (up to 4 people, GPU with CPU fallback) |
| `js/body.js` | Turns points into game input: lanes, jump, duck, the 6 poses |
| `js/core.js` | Phone connection, webcam fallback, player tracking, keyboard players |
| `js/scenes/*` | Lobby, Pick, Race, Password, Results |
| `assets/props/*` | Trees, rocks, log and branch cut from the forest prop sheet (obstacles + scenery) |
| `assets/characters/*` | Character sprites cut from the model sheets: `front`, `back` (used in the race) and `tpose` (celebrations) |

Tuning lives mostly in `js/body.js` (thresholds) and the top of `js/scenes/RaceScene.js` (course length, speed).

## Notes
- The camera needs HTTPS, which GitHub Pages provides (or `localhost`).
- The pose model downloads from Google on first run. For offline use, see `models/README.md`.
- Libraries are bundled in `vendor/` (Phaser 3.90, PeerJS 1.5.5, MediaPipe Tasks Vision 1.2.3, qrcode-generator).

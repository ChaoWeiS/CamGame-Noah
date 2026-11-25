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
5. **Pick:** lean left/right to change character (Barnaby, Scout, Cluck, Hammy — the 3D cast), raise both hands to choose.
6. **Race:** run on the spot and/or swing your arms like a runner (they must take turns) to go faster — standing still = 60% speed, fast big swings or fast knees ≈ 160%, both ≈ 170%. Lean or step left/right into the free lane past rocks and trees, jump over logs and low branches, duck under high branches.
7. **Password:** copy 5 animal poses in a row = 1 point. Most points in 30 s wins.

Poses: 🦒 Giraffe (arms straight up) · 🐦 Bird wings (arms out sideways) · 🐻 Bear ears (hands on head)
· ⭐ Starfish (arms up wide, feet apart) · 🐸 Frog (squat) · 🦩 Flamingo (one leg).

### No phone? Testing options
- **Use this computer's webcam:** a button in the lobby runs the tracking on the computer itself.
- **Keyboard players** (lobby button, up to 2), for testing game logic without a camera:
  - P1: ← → lean · Space (or ↑) jump · Shift (or ↓) duck · tap R to run · 1–6 poses · Enter = hands up
  - P2: A D lean · W jump · S duck · tap F to run · Z X C V B N poses · Q = hands up
- **F9** toggles the stats overlay (camera fps, pose time, round trip, people seen).

## 3D bear test
`bear3d.html` loads a Tripo character (Barnaby `bear_tripo.glb`, Hammy `hamster.glb`, Cluck `chicken.glb`, Scout `dog.glb`; switch with the buttons or `?char=hamster`) in Three.js and makes him copy you
(arms with elbows, legs with knees, leaning, jumps) using the same phone QR code or the computer's webcam.
Drag to look around, H hides the panel. `?weights` colours the auto-rig, `?model=simple` loads the older shape-built bear.

- `js/autorig.js` rigs a single-mesh T-pose model automatically: it measures the mesh to find shoulders, elbows,
  hips and knees, builds a skeleton and paints smooth skin weights. Works for unrigged Tripo/Meshy exports.
- The four animals are now rigged in Blender (real skeleton, Blender skin weights, wings fitted per animal):
  `autorig.js` uses that rig when a model has one. Add `?autorig` to the address to go back to the measured rig.
  How it was made, and how to redo it: `tools/blender_rig/README.md`.
- Model prep (keeps the page light): the 60 MB Tripo export was reduced with glTF-Transform
  (`simplify` → `resize` textures to 1024 → `simplify` → `quantize`) to ~3.8 MB, ~118k triangles — `tools/optimize_model.sh in.glb out.glb`.
- To add a character: optimise its Tripo GLB into `assets/models/`, then add it to `CHARS` in `bear3d.html`.

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
| `js/puppet.js` | 2D cut-out puppets: characters copy the player's arms, legs and lean |
| `assets/puppets/*` | Puppet parts (body, arms, legs) + `rig.json` pivots, made by `tools/make_puppets.py` from the T-pose sprites |
| `js/race3d.js` | The race's 3D layer (Three.js over Phaser): 3D runners, trees, rocks, logs and branches through a camera that matches the 2.5D ground |
| `assets/models/props.glb` | 3D props split out of the Tripo forest set (oak, pine, bare tree, fallen log, stump, bushes, grass, flowers, boulders, rocks, log) + rock pile |
| `assets/props/*` | Trees, rocks, log and branch cut from the forest prop sheet (obstacles + scenery) |
| `assets/characters/*` | Character sprites cut from the model sheets: `front`, `back` (used in the race) and `tpose` (celebrations) |

Tuning lives mostly in `js/body.js` (thresholds) and the top of `js/scenes/RaceScene.js` (course length, speed).

## Notes
- The camera needs HTTPS, which GitHub Pages provides (or `localhost`).
- The pose model downloads from Google on first run. For offline use, see `models/README.md`.
- Libraries are bundled in `vendor/` (Phaser 3.90, PeerJS 1.5.5, MediaPipe Tasks Vision 1.2.3, qrcode-generator).

## Versions and caching

GitHub Pages lets browsers keep files for up to 10 minutes. To avoid running a mix
of old and new code, every page (`index.html`, `phone.html`, `bear3d.html`) checks
`version.json` (never cached) before it starts:

- if the page itself is older, it reloads once with `?v=<build>` added;
- if the build changed since last time, it re-downloads every code file listed there.

**Before each push run `python3 tools/stamp.py "short note"`** — it writes a new build
id into `version.json` and each page's `<meta name="build">`. The PC's HUD (F9) shows
the build it is running, and warns when the phone page is on a different one.

## Phone mode

Opening the game link on a phone switches to **phone mode** automatically: a big
"▶ Play on this phone" button uses the phone's own front camera, goes full screen in
landscape (portrait shows "Turn your phone sideways"), lighter graphics, up to 2
players. "Use another phone as the camera" still shows the QR code. Force a mode
with `?mode=phone` or `?mode=pc`.

## Linking several cameras

Connect 2+ phones (each scans the QR code), then press **🔗 Link cameras** in the lobby:
one person walks slowly around the play area waving while everyone else steps out of
view (~10 s). The game works out where each phone is (`js/multicam.js`: each camera's
view of the person is placed in 3D, the cameras are fitted to each other, the feet set
the floor) and from then on merges everyone the cameras see — someone hidden from one
phone is still seen by another. A top-down map shows the cameras and people.

**If a phone is knocked** (its tilt sensor notices), the game pauses, waits for it to be
put back and left still, calls out one player by their animal to walk about, re-links
that camera, has everyone stand still for a moment, counts down and carries on
(`js/calibui.js`). With a single camera it just does the "stand still" part.

## Model detail

`assets/models/hd/` holds the detailed animals used on the big screen (~10% of Tripo's
triangles, original textures, fine precision — practically identical to the originals,
~7 MB each). `assets/models/` holds the light ones used in phone mode (~3–4 MB).
Rebuild with `tools/optimize_model.sh original.glb out.glb hd|lite`.
Force a choice with `?models=hd` or `?models=lite`.

## Flow (Nov 2026)

1. **Lobby:** the main camera's view fills the screen, with a faint live picture (the phone
   sends a small 320 px picture 4× a second, only while the lobby is open) so everyone can
   see the edges. The QR code to add more cameras is a small card in the corner.
2. **Start:** everyone in view raises both hands → **3, 2, 1** (stops if anyone lowers theirs).
3. **Choose your animal:** portraits along the top (rendered from the 3D models,
   `assets/portraits/`), framed in each player's colour (P1 red, P2 blue, P3 green, P4 yellow).
   Swipe a raised hand sideways to change; hold both hands up 3 s (a ring in your colour fills)
   to choose. Chosen animals are locked and can't be taken by anyone else.
4. **Race:** READY?? → 3! → 2! → 1! → GO!!! (standing posture is measured during READY??).

## Staying awake

The game page and the camera page both keep the screen awake (Screen Wake Lock API,
`js/awake.js`; asked for again whenever the page comes back into view). A web page cannot
keep the camera running with the screen switched off — the browser pauses the page — so
the camera page instead goes **fully black** after 25 s without a touch (or with
"🌙 Dark screen now"): on OLED phones black pixels are off, so it looks off and uses
little power while tracking carries on. Tap to wake it.

## Mini games (base + games)

The base (`js/`) is everything shared: cameras and linking, tracking, the animals,
lobby, character select, scores/podium. Each mini game is a folder in `games/`:

```
games/<id>/manifest.json   { id, title, blurb, players: [min, max], minutes, card, entry, files }
games/<id>/card.png        square picture for the host's menu
games/<id>/index.js        export default { scenes: [SceneClass…], start: 'SceneKey' }  (each class: static KEY)
games/<id>/…               the game's own code and assets (downloaded only when queued)
```

A game imports what it needs from `../../js/…` and, when it's over, calls
`finishGame(this, [{ slot, score, label }])` (`js/games.js`): higher score is better,
label is what the podium shows. Players get points by placing in each game; the podium
adds them up. Add a game: make the folder and add its id to `GAME_IDS` in `js/games.js`.

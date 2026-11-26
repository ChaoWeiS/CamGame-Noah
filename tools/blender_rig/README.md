# Rigging the animals in Blender

The four 3D animals (`assets/models/` and `assets/models/hd/`) carry a real skeleton and skin
weights made in Blender, and each has a pair of bird wings fitted to its arms
(`assets/models/wings/`). `js/autorig.js` uses those when a model has them; otherwise it falls
back to measuring the mesh and guessing (also forced with `?autorig` in the page address).

The bones have the same names and places as the measured rig (hips, spine, chest, head, belly, tail,
upper/fore/hand L/R, thigh/shin L/R), so all the motion code works unchanged. The game
rebuilds the bones with no rotation at those joint positions and uses Blender's weights.

## Steps

1. **Measure:** `python3 measure.py <folder>` with the original (unrigged) Tripo GLBs in the folder
   (`bear_tripo.glb`, `chicken.glb`, `dog.glb`, `hamster.glb`). Writes `joints.json` there.
2. **Rig:** in Blender (4.2+), Scripting tab, open `rig_animals.py`, set `DIR` to that folder, run.
   Imports the four, builds the skeletons, and weights them. Blender's own automatic weights fail on
   Tripo meshes (gaps and loose pieces), so the script weights a watertight voxel copy and
   copies the weights back to the real mesh, 4 bones per vertex at most.
3. **Wings:** put `assets/wings.glb` in the folder and run `fit_wings.py`.
4. **Check / fix by hand:** pose the rigs (Pose mode) and look. Joints can be moved in Edit mode,
   then re-run the weighting part of step 2 for that animal. Reset poses before exporting.
5. **Export** each animal with File > Export > glTF (.glb): select its `_rig` + `_body` →
   `<animal>.glb`; its `_rig` + `_wings` → `<animal>_wings.glb`. Include: Selected objects,
   Skinning on, Animation off. Move the rig to x = 0 first (they stand side by side in the scene).
6. **Shrink** (same tool as `tools/optimize_model.sh`):
   - HD: `npx @gltf-transform/cli quantize in.glb assets/models/hd/<file>.glb --quantize-position 14 --quantize-normal 10 --quantize-texcoord 14`
   - Lite: `simplify --ratio 0.42 --error 0.003` → `resize --width 1024 --height 1024` → `quantize`, into `assets/models/`
   - Wings: like HD, into `assets/models/wings/<animal>.glb`

The working Blender file with all four rigs is kept on the user's PC (`rigging/animals_rigged.blend`).

## Wings (v3: a bird's arm)
Each animal's wings are the untouched original `assets/wings.glb`, scaled and placed on the back in
`animals_rigged.blend` (move them there; the wing bones are refitted from the mesh). Each wing has a bird's
arm along its leading edge, hung off `chest`: `wingUp` (humerus) → `wingFore` (forearm) → `wingHand`
(hand, the long outer feathers). Feathers are weighted to the nearest part of the leading edge; the base
of the wing (and the feathers hanging below it) stays on `chest`.

In the game `js/wings.js` adds these bones to the character, and `updateWings(ch)` copies the player's arm
joint for joint, through a little drag: shoulder → the beat, elbow → the wing folds at its middle,
hand → follows the elbow and trails the beat (curls up on the way down, hangs on the way up).

## Adding an animal without the PC (headless Blender: `pip install bpy`)
Done this way for the walrus (`walrus_joints.json`):
1. Shrink without tearing: first `gltf-transform simplify big.glb mid.glb --ratio 0.06 --error 0.004`
   (keeps every UV seam, so it stops at ~25 %), then `python3 decimate.py mid.glb walrus.glb 0.3`,
   which joins the seam-split vertices before decimating. Decimating Tripo's split seams directly
   tears thousands of tiny cracks you can see through (the model looks speckled/noisy).
   rig_one.py joins them again after importing (glTF splits them on export), before weighting:
   otherwise each side of a seam gets its own weights and cracks open when the animal moves.
2. Measure with `measure.py`'s `measure()`, then fix joints by hand where the shape is unusual (the
   walrus's flippers: wrist where the paddle starts, the hand bone along the paddle to `handTip`).
   Put them in `<folder>/joints.json` as `{ "walrus": {...} }`.
3. `DECIMATE=1 python3 rig_one.py walrus <folder>` (and again with `DECIMATE=0.42` for the phone version — don't simplify a rigged file with gltf-transform, it pulls the seams apart) — builds the skeleton (rig_animals.py's
   `build`), weights it with `weights_np.py` (Blender's heat weights failed on this mesh: distance to
   each bone, limited to the bones that may move that part, smoothed over the mesh), exports
   `<folder>/walrus_rigged.glb`. Then shrink as in step 6.
4. Wings: `node borrow_wings.mjs wings/bear.glb wings/walrus.glb <scale> <bear back x y z> <walrus back x y z>`
   reuses the bear's fitted wings, scaled by height and moved from the bear's back (between the
   shoulders, at the back surface) to the walrus's.

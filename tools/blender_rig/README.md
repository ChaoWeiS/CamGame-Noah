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

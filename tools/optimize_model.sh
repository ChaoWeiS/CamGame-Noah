#!/bin/sh
# usage: optimize_model.sh in.glb out.glb [hd|lite]  — shrink a Tripo export for the web
#   hd   (default): ~10% of the triangles, original textures kept, fine precision (~7 MB).
#                   Looks practically the same as the original. Used on the big screen.
#   lite:           ~2% of the triangles, textures re-compressed (~3-4 MB). Phone mode.
set -e
T=$(mktemp -d)
CLI="npx --yes @gltf-transform/cli"
if [ "${3:-hd}" = "lite" ]; then
  $CLI simplify "$1" $T/a.glb --ratio 0.06 --error 0.002 >/dev/null
  $CLI resize $T/a.glb $T/b.glb --width 1024 --height 1024 >/dev/null
  $CLI simplify $T/b.glb $T/c.glb --ratio 0.3 --error 0.003 >/dev/null
  $CLI quantize $T/c.glb "$2" >/dev/null
else
  $CLI simplify "$1" $T/a.glb --ratio 0.1 --error 0.0005 >/dev/null
  $CLI quantize $T/a.glb "$2" --quantize-position 14 --quantize-normal 10 --quantize-texcoord 14 >/dev/null
fi
rm -rf $T

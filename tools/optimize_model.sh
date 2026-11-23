#!/bin/sh
# usage: optimize.sh in.glb out.glb  — shrink a Tripo export for the web
set -e
T=$(mktemp -d)
cd "$(dirname "$0")"
npx --yes @gltf-transform/cli simplify "$1" $T/a.glb --ratio 0.06 --error 0.002 >/dev/null
npx --yes @gltf-transform/cli resize $T/a.glb $T/b.glb --width 1024 --height 1024 >/dev/null
npx --yes @gltf-transform/cli simplify $T/b.glb $T/c.glb --ratio 0.3 --error 0.003 >/dev/null
npx --yes @gltf-transform/cli quantize $T/c.glb "$2" >/dev/null
rm -rf $T

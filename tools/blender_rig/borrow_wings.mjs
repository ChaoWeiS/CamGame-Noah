// Borrow one animal's Blender wings for another: wrap the whole file in a scale + move, from the
// first animal's back (between the shoulders, at the back surface) to the second's.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const [,, IN, OUT, s, ax, ay, az, bx, by, bz] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const scene = doc.getRoot().listScenes()[0];
const k = +s, A = [+ax, +ay, +az], B = [+bx, +by, +bz];
const fit = doc.createNode('fit').setScale([k, k, k]).setTranslation([B[0] - k * A[0], B[1] - k * A[1], B[2] - k * A[2]]);
for (const c of scene.listChildren()) { scene.removeChild(c); fit.addChild(c); }
scene.addChild(fit);
await io.write(OUT, doc);

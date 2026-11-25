// Bird wings on the animals' arms (for the flying games).
// The wing model has a left and a right wing. Each wing's leading edge runs
// shoulder → elbow → wrist → fingertip (marked on the reference picture); that line is
// laid along the animal's own arm (in its rest pose), the feathers come along with it,
// and the wing is skinned to the arm's bones (upper arm, forearm, paw) so it flaps
// whenever the arm moves. The wing sits just above and behind the arm: seen from the
// back you see the wings, not the arms.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WING_FILE = new URL('../assets/wings.glb', import.meta.url).href;
// the right wing's leading edge in the model (from the reference picture): shoulder, elbow, wrist, fingertip
const EDGE = [[0.06, 0.305], [0.192, 0.398], [0.241, 0.478], [0.346, 0.51]];
const WING_EDGE = 0.6;           // the wing's leading edge is this many animal-heights long (same look on every animal; bigger animal, bigger wings)

let srcPromise = null;
function loadSource() {
  return (srcPromise = srcPromise || new GLTFLoader().loadAsync(WING_FILE).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let src = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    return { geo, mat: src.material };
  }));
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// build the wing geometry fitted to one animal's arms (shared by every animal of that kind)
const fitted = new WeakMap();
async function fitWings(ch) {
  if (fitted.has(ch.joints)) return fitted.get(ch.joints);
  const p = (async () => {
    const { geo: g0, mat } = await loadSource();
    const P = g0.attributes.position, N = g0.attributes.normal, UV = g0.attributes.uv, I = g0.index;
    // the leading edge, with its depth taken from the feathers around each point
    const edge = EDGE.map(([x, y]) => {
      let z = 0, n = 0;
      for (let i = 0; i < P.count; i += 3) {
        const dx = P.getX(i) - x, dy = P.getY(i) - y;
        if (dx * dx + dy * dy < 0.0016) { z += P.getZ(i); n++; }
      }
      return new THREE.Vector3(x, y, n ? z / n : 0);
    });
    const segLen = [0, 1, 2].map((i) => edge[i].distanceTo(edge[i + 1]));
    const total = segLen[0] + segLen[1] + segLen[2];
    const H = ch.height, b = ch.b;
    const W = (bone) => new THREE.Vector3(bone.userData.world.x, bone.userData.world.y, bone.userData.world.z);
    const bones = ch.mesh.skeleton.bones;
    const out = { pos: [], nor: [], uv: [], si: [], sw: [], idx: [] };
    for (const [side, s] of [[1, 'R'], [-1, 'L']]) {
      // the animal's arm at rest (mesh space)
      const sh = W(b['upper' + s]), el = W(b['fore' + s]), wr = W(b['hand' + s]);
      const tip = wr.clone().add(wr.clone().sub(el).multiplyScalar(0.6));
      // the wing's line: from just behind the neck (the wing rises over the shoulder), out along
      // the arm's directions, each piece as long as the wing's own (scaled to the animal's height)
      const k = (WING_EDGE * H) / total;
      const dirs = [[sh, el], [el, wr], [wr, tip]].map(([p, q]) => q.clone().sub(p).normalize());
      const root = sh.clone().multiply(new THREE.Vector3(0.55, 1, 1));
      root.y = ch.joints.neckY - H * 0.02;
      const backZ = Math.min(ch.joints.backZ ?? -H * 0.12, -H * 0.08);
      root.z = backZ - H * 0.04;
      const arm = [root];
      for (let i = 0; i < 3; i++) arm.push(arm[i].clone().addScaledVector(dirs[i], segLen[i] * k));
      // behind the back at the root, closer behind the arm further out, and lifted a little
      const offsetAt = (along) => new THREE.Vector3(0, H * 0.04 * smooth(0, 1.5, along), THREE.MathUtils.lerp(0, H * 0.04, smooth(0, 1.5, along)));
      // one rotation per segment: the wing's segment direction → the arm's segment direction
      const segs = [0, 1, 2].map((i) => {
        const from = edge[i + 1].clone().sub(edge[i]).multiply(new THREE.Vector3(side, 1, 1)).normalize();
        return { q: new THREE.Quaternion().setFromUnitVectors(from, dirs[i]), a: edge[i].clone().multiply(new THREE.Vector3(side, 1, 1)), A: arm[i] };
      });
      const boneIdx = ['upper', 'fore', 'hand'].map((n) => bones.indexOf(b[n + s]));
      // this side's vertices (x on that side of the middle)
      const map = new Int32Array(P.count).fill(-1);
      const v = new THREE.Vector3(), nv = new THREE.Vector3(), tmp = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        if (Math.sign(P.getX(i)) !== side) continue;
        v.set(P.getX(i), P.getY(i), P.getZ(i));
        // where along the leading edge this point belongs (projected in the wing's plane)
        let best = 1e9, bi = 0, bt = 0;
        for (let sI = 0; sI < 3; sI++) {
          const a = edge[sI], c = edge[sI + 1], ax = side * a.x, cx = side * c.x;
          const dx = cx - ax, dy = c.y - a.y, L2 = dx * dx + dy * dy;
          let t = ((v.x - ax) * dx + (v.y - a.y) * dy) / L2;
          const tc = Math.max(0, Math.min(1, t));
          const d = Math.hypot(v.x - (ax + dx * tc), v.y - (a.y + dy * tc));
          if (d < best) { best = d; bi = sI; bt = t; }
        }
        // weights: mostly this segment, blended with the neighbour near the joints
        const wts = [0, 0, 0];
        const blendIn = bi > 0 ? 1 - smooth(-0.15, 0.15, bt) : 0;     // share with the previous segment near the start
        const blendOut = bi < 2 ? smooth(0.85, 1.15, bt) : 0;        // and with the next near the end
        wts[bi] = 1 - 0.5 * blendIn - 0.5 * blendOut;
        if (bi > 0) wts[bi - 1] += 0.5 * blendIn;
        if (bi < 2) wts[bi + 1] += 0.5 * blendOut;
        // new position: each segment's transform, blended by the weights
        const np = new THREE.Vector3(), nn = new THREE.Vector3();
        nv.set(N.getX(i), N.getY(i), N.getZ(i));
        wts.forEach((w, j) => {
          if (!w) return;
          const sg = segs[j];
          tmp.copy(v).sub(sg.a).multiplyScalar(k).applyQuaternion(sg.q).add(sg.A);
          np.addScaledVector(tmp, w);
          nn.addScaledVector(nv.clone().applyQuaternion(sg.q), w);
        });
        np.add(offsetAt(bi + Math.max(0, Math.min(1, bt))));
        map[i] = out.pos.length / 3;
        out.pos.push(np.x, np.y, np.z);
        nn.normalize(); out.nor.push(nn.x, nn.y, nn.z);
        out.uv.push(UV.getX(i), UV.getY(i));
        out.si.push(boneIdx[0], boneIdx[1], boneIdx[2], 0);
        out.sw.push(wts[0], wts[1], wts[2], 0);
      }
      for (let t = 0; t < I.count; t += 3) {
        const a = map[I.getX(t)], c = map[I.getX(t + 1)], d = map[I.getX(t + 2)];
        if (a >= 0 && c >= 0 && d >= 0) out.idx.push(a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.sw, 4));
    geo.setIndex(out.idx);
    const m = mat.clone(); m.side = THREE.DoubleSide;
    return { geo, mat: m };
  })();
  fitted.set(ch.joints, p);
  return p;
}

// give a character its wings (skinned to its own arm bones); returns the wing mesh
export async function addWings(ch) {
  if (ch.wings) return ch.wings;
  const { geo, mat } = await fitWings(ch);
  const w = new THREE.SkinnedMesh(geo, mat);
  w.frustumCulled = false;
  ch.mesh.add(w);
  w.bind(ch.mesh.skeleton, ch.mesh.bindMatrix);
  ch.wings = w;
  return w;
}
export function preloadWings() { return loadSource(); }

// Bird wings on the animals' arms (for the flying games).
// The wing model has a left and a right wing. Each wing's leading edge runs
// shoulder → elbow → wrist → fingertip (marked on the reference picture); that line is
// laid along the animal's own arm (in its rest pose), the feathers come along with it,
// and the wing is skinned to the arm's bones (upper arm, forearm, paw) so it flaps
// whenever the arm moves. The wing sits just above and behind the arm: seen from the
// back you see the wings, not the arms.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { restMatrix } from './autorig.js';

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
    const geo = floatGeo(src.geometry).applyMatrix4(src.matrixWorld);
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

// Wings fitted and weighted in Blender for each animal (tools/blender_rig), skinned to the same
// bone names as the body. Used when the character's model came from Blender too.
const PREFIT = new Map();
// quantized files keep positions/normals as small integers; moving them can push the
// wingtips past the integer range so they wrap to the other side. Use plain floats first.
function floatGeo(geo) {
  const g = geo.clone();
  for (const k of ['position', 'normal']) {
    const a = g.attributes[k];
    if (!a || (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute)) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) out[i * a.itemSize + j] = a.getComponent(i, j);
    g.setAttribute(k, new THREE.Float32BufferAttribute(out, a.itemSize));
  }
  return g;
}

function prefitFor(ch) {
  const id = ch.rigged && ch.src && ['bear', 'chicken', 'dog', 'hamster'].find((k) => ch.src.includes(k));
  if (!id) return null;
  // ?v=build: the code refreshes itself on a new build, but a cached .glb would not
  const v = (typeof document !== 'undefined' && document.querySelector('meta[name=build]')?.content) || '';
  const file = new URL(`../assets/models/wings/${id}.glb${v ? '?v=' + encodeURIComponent(v) : ''}`, import.meta.url).href;
  if (!PREFIT.has(file)) PREFIT.set(file, new GLTFLoader().loadAsync(file).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let src = null;
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !src) src = o; });
    if (!src) return null;
    // the wing's own bones (wingR → wingTipR, hung off the chest): where they sit at rest
    const extra = src.skeleton.bones.filter((bn) => bn.name.startsWith('wing'))
      .map((bn) => ({ name: bn.name, parent: bn.parent.name, pos: bn.getWorldPosition(new THREE.Vector3()) }));
    return { geo: floatGeo(src.geometry).applyMatrix4(restMatrix(src)), names: src.skeleton.bones.map((b) => b.name), extra, mat: src.material };
  }).catch((e) => { console.warn('Blender wings failed, fitting them instead', e); return null; }));
  return PREFIT.get(file).then((w) => {
    if (!w) return null;
    const geo = w.geo.clone();
    const sh = ch.shift || new THREE.Vector3();
    geo.translate(sh.x, sh.y, sh.z);
    // the character's skeleton plus the wing bones, added under its chest
    const sk = ch.mesh.skeleton, bones = sk.bones.slice(), inverses = sk.boneInverses.map((m) => m.clone());
    const meshInv = ch.mesh.bindMatrixInverse;
    const restPos = (bn) => new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().multiplyMatrices(meshInv, new THREE.Matrix4().copy(inverses[bones.indexOf(bn)]).invert()));
    const made = {};
    for (const e of w.extra) {
      const parent = made[e.parent] || bones.find((bn) => bn.name === e.parent) || bones.find((bn) => bn.name === 'chest');
      const pos = e.pos.clone().add(sh);
      const bn = new THREE.Bone(); bn.name = e.name;
      bn.position.copy(pos).sub(made[e.parent] ? made[e.parent].userData.rest : restPos(parent));
      bn.userData.rest = pos;
      parent.add(bn);
      bones.push(bn);
      inverses.push(new THREE.Matrix4().multiplyMatrices(ch.mesh.bindMatrix, new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z)).invert());
      made[e.name] = bn;
    }
    // bone numbers in the wing file → this skeleton
    const map = w.names.map((nm) => Math.max(0, bones.findIndex((b) => b.name === nm)));
    const SI = geo.attributes.skinIndex, out = new Uint16Array(SI.count * 4);
    for (let i = 0; i < SI.count; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = map[SI.getComponent(i, j)];
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out, 4));
    const m = w.mat.clone(); m.side = THREE.DoubleSide;
    const skeleton = made.wingR ? new THREE.Skeleton(bones, inverses) : null;
    if (made.wingR) {
      // how the arms point at rest (not quite level on every animal): wings are spread there
      made.rest = {};
      for (const s of ['L', 'R']) {
        const u = bones.find((bn) => bn.name === 'upper' + s), f = bones.find((bn) => bn.name === 'fore' + s);
        const d = restPos(f).sub(restPos(u));
        made.rest[s] = Math.atan2(d.y, Math.abs(d.x) + 1e-6);
      }
    }
    return { geo, mat: m, skeleton, wingBones: made.wingR ? made : null };
  });
}

// give a character its wings; returns the wing mesh
export async function addWings(ch) {
  if (ch.wings) return ch.wings;
  const { geo, mat, skeleton, wingBones } = (await prefitFor(ch)) || (await fitWings(ch));
  const w = new THREE.SkinnedMesh(geo, mat);
  w.frustumCulled = false;
  ch.mesh.add(w);
  w.bind(skeleton || ch.mesh.skeleton, ch.mesh.bindMatrix);
  ch.wings = w;
  ch.wingBones = wingBones || null;
  return w;
}

// Wings with their own bones flap like a bird's (reference: a bird flap cycle, poses 1–9).
// The arms don't hold the wings; they drive the stroke and the wings follow with a little drag:
//   hands apart (arms out / up)   → pose 1: wings raised
//   bringing the hands down/in    → downstroke 1 → 4 → 6: wings straight, sweeping down and a bit forward
//   raising them again            → upstroke 7 → 8 → 9: wings bent at the wrist, the feathers trailing
//   holding still                 → the wings settle straight (pose 1 or 6)
// Call once per frame after posing the arms and updating matrices.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
export function updateWings(ch) {
  const wb = ch.wingBones;
  if (!wb) return;
  const now = performance.now() / 1000;
  const st = (ch.wingState = ch.wingState || { t: now, R: { p: 0, v: 0, bend: 0, tgt: 0 }, L: { p: 0, v: 0, bend: 0, tgt: 0 } });
  const dt = Math.min(0.05, Math.max(0.001, now - st.t)); st.t = now;
  const chest = wb.wingR.parent;
  _m.copy(chest.matrixWorld).invert();
  for (const [s, sg] of [['R', 1], ['L', -1]]) {
    const up = ch.b['upper' + s], fore = ch.b['fore' + s], w = st[s];
    if (!up || !fore) continue;
    up.getWorldPosition(_a).applyMatrix4(_m); fore.getWorldPosition(_b).applyMatrix4(_m);
    _b.sub(_a);
    const elev = Math.atan2(_b.y, Math.abs(_b.x) + 1e-6) - (wb.rest ? wb.rest[s] : 0);   // 0 = out like at rest, −π/2 = down
    // stroke position: 0 = top (pose 1), 1 = bottom (pose 6)
    const tgt = smooth(0.15, -1.15, elev);
    const armSpeed = (tgt - w.tgt) / dt; w.tgt = tgt;
    // the wing follows with drag (a damped spring)
    const k = 90, d = 2 * Math.sqrt(k) * 0.85;
    w.v += (k * (tgt - w.p) - d * w.v) * dt; w.p += w.v * dt;
    const p = Math.max(-0.1, Math.min(1.1, w.p));
    // bent wing on the way up, straight on the way down / when held still
    const bendTo = armSpeed < -0.6 ? 1 : armSpeed > 0.6 ? 0 : w.bend * 0.97;
    w.bend += (bendTo - w.bend) * Math.min(1, dt * 10);
    const bend = w.bend, mid = Math.sin(Math.max(0, Math.min(1, p)) * Math.PI);
    // whole wing: up/down (roll about the forward axis) + forward/back sweep (about the vertical axis)
    const roll = lerp(0.15, -1.5, p) + bend * 0.25;
    const sweepFwd = 0.45 * Math.max(0, p) * (1 - bend) - 0.35 * bend;     // +: tips forward
    _q1.setFromAxisAngle(_Y, -sg * sweepFwd);
    _q2.setFromAxisAngle(_Z, sg * roll);
    wb['wing' + s].quaternion.multiplyQuaternions(_q1, _q2);
    // outer feathers: hang down and trail back on the upstroke, lag a touch on the downstroke
    const tipRoll = -bend * (0.45 + 0.75 * mid) + (1 - bend) * 0.2 * mid * Math.sign(w.v);
    _q1.setFromAxisAngle(_Y, sg * bend * 0.45);
    _q2.setFromAxisAngle(_Z, sg * tipRoll);
    wb['wingTip' + s].quaternion.multiplyQuaternions(_q1, _q2);
    wb['wing' + s].updateMatrixWorld(true);
  }
}

export function preloadWings() { return loadSource(); }

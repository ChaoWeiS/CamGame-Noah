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

// How wide each animal is with its arms down by its sides (half-width ÷ height): the wings must
// wrap round that without going into the body, so wider animals get bigger wings, hinged wider.
const GIRTH_FOR = { bear: 0.30, chicken: 0.33, dog: 0.26, hamster: 0.31 };
const wingScale = (girth) => 1.35 * (0.75 + girth * 1.4);      // the Blender wings × this, grown from their roots
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
    const ok = made.wingUpR && made.wingForeR && made.wingHandR;
    const skeleton = ok ? new THREE.Skeleton(bones, inverses) : null;
    if (ok) {
      // how the arms point at rest (not quite level on every animal): wings are spread there
      // how the player-character's arm points / bends at rest (wings are as modelled there)
      made.rest = {};
      for (const s of ['L', 'R']) {
        const P = (k) => restPos(bones.find((bn) => bn.name === k + s));
        made.rest[s] = armAngles(P('upper'), P('fore'), P('hand'), s === 'R' ? 1 : -1);
        // the wing as modelled is raised (an angel's V); its leading edge (shoulder → wrist) at this
        // angle above level. Arms spread level = wings spread level, so take that much off.
        const a = made['wingUp' + s].userData.rest, b = made['wingHand' + s].userData.rest;
        made.rest[s].lift = Math.atan2(b.y - a.y, Math.abs(b.x - a.x) + 1e-6);
        made.rest[s].span = Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    return { geo, mat: m, skeleton, wingBones: ok ? made : null };
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
  // big wings, each about as long as the animal is tall
  if (wingBones) {
    const id = Object.keys(GIRTH_FOR).find((k) => (ch.src || '').includes(k));
    wingBones.girth = GIRTH_FOR[id] ?? 0.3;
    for (const s of ['R', 'L']) { const r = wingBones['wingUp' + s]; r.scale.setScalar(wingScale(wingBones.girth)); r.userData.base = r.position.clone(); }
  }
  return w;
}

// The wing's skeleton is a bird's arm (humerus → forearm → hand, along its leading edge), and it
// copies the player-character's arm exactly, joint for joint: wingUp = upper arm, wingFore =
// forearm, wingHand = hand, each with the same rotation (as Cluck's own wings do). Spread the
// arms and the wings spread; curl them in front and the wings curl in front.
// Only three things are added:
//  - the wing as modelled is raised (an angel's V): it is tilted down by that much, so level arms
//    give level wings;
//  - the wings grow from the back: as the arms come forward or down, each wing's hinge slides
//    out from the middle of the back round to the animal's side (past its arms), so the wing
//    curls round to the front, stretching over the body instead of going into it;
//  - in flight the body leans forward, so wings that hang down are turned forward by the lean.
// A little smoothing keeps camera jitter out (the tips smooth more than the shoulder).
const _u = new THREE.Vector3(), _f = new THREE.Vector3(), _h = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1), _dn = new THREE.Vector3(), _ad = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
let TWIST = 1.4, LEAN = 1;
export function _tune(t, l) { TWIST = t; LEAN = l; }
// kept for the rest pose (shoulder elevation and elbow bend of one arm, in the chest's frame)
function armAngles(u, f, h, sg) {
  const a1 = Math.atan2(f.y - u.y, (f.x - u.x) * sg), a2 = Math.atan2(h.y - f.y, (h.x - f.x) * sg);
  let bend = a2 - a1; if (bend > Math.PI) bend -= 2 * Math.PI; if (bend < -Math.PI) bend += 2 * Math.PI;
  return { elev: a1, bend };
}
// pitch: optional { R, L } radians from the player's palms (hand reading): the wing turns about
// its leading edge like a hand out of a car window — palm tipped forward = leading edge up.
let PITCH_SIGN = 1, PS_R = -1, PS_L = 1;   // measured: + raises the leading edge on both sides
const _Yb = new THREE.Vector3(0, 1, 0);
export function _pitchSign(r, l) { PS_R = r; PS_L = l; }
export function updateWings(ch, pitch = null) {
  const wb = ch.wingBones;
  if (!wb) return;
  const now = performance.now() / 1000;
  const st = (ch.wingState = ch.wingState || { t: now, R: { hinge: 0 }, L: { hinge: 0 } });
  const dt = clamp(now - st.t, 0.001, 0.05); st.t = now;
  const ease = (rate) => 1 - Math.exp(-dt * rate);
  _m.copy(wb.wingUpR.parent.matrixWorld).invert();
  _dn.set(0, -1, 0).transformDirection(_m);
  const lean = Math.atan2(_dn.z, -_dn.y);               // how far the body leans forward
  const H = ch.height || 1, j = ch.joints || {};
  const zMid = ((j.frontZ || 0) + (j.backZ || 0)) / 2;
  for (const [s, sg] of [['R', 1], ['L', -1]]) {
    const up = ch.b['upper' + s], fore = ch.b['fore' + s], hand = ch.b['hand' + s], w = st[s];
    if (!up || !fore || !hand) continue;
    // the arm as posed (before the "keep the arms out of the body" fix, which is for the arms)
    const qUp = (ch._fix && ch._fix['upper' + s]) || up.quaternion;
    // where the upper arm points, in the chest's frame
    _ad.set(sg, 0, 0).applyQuaternion(qUp);
    const down = clamp(-_ad.y, 0, 1), forward = clamp(_ad.z, 0, 1);
    // shoulder: the arm's own rotation, the modelled V tilted down to level, and hanging wings
    // turned forward by the body's lean
    const lift = (wb.rest[s].lift || 0) * 0.85;
    _q1.setFromAxisAngle(_Z, -sg * lift);
    const tUp = _q2.copy(qUp).multiply(_q1);
    // the modelled wing's feathers hang BELOW its leading edge (an angel's wing on a back); a
    // bird's trail BEHIND it. As the wing comes down it turns about its leading edge so the
    // feathers trail back, instead of pointing in, into the body
    tUp.multiply(_q1.setFromAxisAngle(_X, TWIST * down));
    if (lean) tUp.premultiply(_q1.setFromAxisAngle(_X, -lean * LEAN * down));
    const root = wb['wingUp' + s];
    root.quaternion.slerp(tUp, ease(25));
    // palm pitch (smoothed; eases back to flat when the hand isn't being read)
    w.pitch = (w.pitch || 0) + ((pitch?.[s] ?? 0) - (w.pitch || 0)) * ease(8);
    const pq = _q1.setFromAxisAngle(_Yb, PITCH_SIGN * (s === 'R' ? PS_R : PS_L) * w.pitch * 0.5);   // about the bone's own length (Blender bones point along +Y)
    wb['wingFore' + s].quaternion.slerp(fore.quaternion.clone().multiply(pq), ease(18));
    wb['wingHand' + s].quaternion.slerp(hand.quaternion.clone().multiply(pq), ease(12));
    // the hinge slides round the body as the arm comes forward or down
    w.hinge += (clamp(Math.max(forward * 1.3, down), 0, 1) - w.hinge) * ease(14);
    const th = w.hinge * Math.PI / 2, base = root.userData.base;
    if (base) {
      const rx = (wb.girth + 0.06) * H;
      root.position.set(
        base.x + sg * Math.max(0, rx - Math.abs(base.x)) * Math.sin(th),
        base.y - 0.05 * H * w.hinge,
        base.z + (zMid - base.z) * Math.sin(th) * 0.9);
    }
    root.updateMatrixWorld(true);
  }
}

export function preloadWings() { return loadSource(); }

// Auto-rig for a single-mesh character standing in a T-pose (e.g. a Tripo model).
// It finds the shoulders, elbows, hips and knees from the shape of the mesh,
// builds a small skeleton and paints smooth skin weights, so the body bends at
// the joints instead of splitting into pieces.
//
// Assumes: Y is up, the character faces +Z (towards the camera), arms straight out along X.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L, keyPoints } from './body.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// scratch objects for the 3D solver
const _v = (o) => new THREE.Vector3(o.x, o.y, o.z);
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _d = new THREE.Vector3(), _q2 = new THREE.Quaternion();
// Scale a rotation's angle by s (capped at max radians): makes small real movements
// readable on round cartoon bodies.
function amp(q, s, max = Math.PI) {
  const w = Math.min(1, Math.abs(q.w)), half = Math.acos(w);
  if (half < 1e-4) return q.clone();
  const sign = q.w < 0 ? -1 : 1, k = Math.sin(half);
  const axis = new THREE.Vector3(q.x * sign / k, q.y * sign / k, q.z * sign / k);
  return new THREE.Quaternion().setFromAxisAngle(axis, Math.min(max, 2 * half * s));
}
export const EXAGGERATE = { torso: 1.6, head: 1.3, wrist: 1.3 };
// rounder animals hide their movement, so they get more (set ch.ex = EXAGGERATE_FOR[id])
export const EXAGGERATE_FOR = {
  bear: { torso: 2.3, head: 1.5, wrist: 1.5 },     // Barnaby: big round belly
  hamster: { torso: 2.1, head: 1.4, wrist: 1.5 },  // Hammy: round too
  chicken: { torso: 1.8, head: 1.3, wrist: 1.3 },
  dog: { torso: 1.6, head: 1.3, wrist: 1.3 },
  walrus: { torso: 2.3, head: 1.5, wrist: 1.4 },   // Wally: the roundest of all
  cat: { torso: 1.7, head: 1.4, wrist: 1.3 },
  lion: { torso: 1.6, head: 1.3, wrist: 1.3 },
};

// Jiggle physics per animal (set ch.phys = PHYSICS_FOR[id]); amounts 0…1+
//   belly: the tummy lags and wobbles · bob: the upper body bounces on the waist
//   tail: swings against the motion · wag: tail wagging (rad), more when moving
export const PHYSICS_FOR = {
  bear: { belly: 1.3, bob: 0.4, tail: 0.5, wag: 0 },
  hamster: { belly: 0.9, bob: 1.0, tail: 0.4, wag: 0 },
  chicken: { belly: 0.3, bob: 1.2, tail: 0.8, wag: 0 },
  dog: { belly: 0.3, bob: 0.4, tail: 0.35, wag: 0 },
  walrus: { belly: 1.4, bob: 0.5, tail: 0.3, wag: 0 },
  cat: { belly: 0.4, bob: 0.8, tail: 0.5, wag: 0 },
  lion: { belly: 0.3, bob: 0.4, tail: 0.8, wag: 0 },   // one-bone tail: a big swing/wag looked like a shaking sausage
};

// which way each bone points in the T-pose (the rig is built with no rotations)
const REST = {
  upperL: new THREE.Vector3(-1, 0, 0), foreL: new THREE.Vector3(-1, 0, 0),
  upperR: new THREE.Vector3(1, 0, 0), foreR: new THREE.Vector3(1, 0, 0),
  handL: new THREE.Vector3(-1, 0, 0), handR: new THREE.Vector3(1, 0, 0),
  thighL: new THREE.Vector3(0, -1, 0), shinL: new THREE.Vector3(0, -1, 0),
  thighR: new THREE.Vector3(0, -1, 0), shinR: new THREE.Vector3(0, -1, 0),
};

// how far in from the body's edge the shoulder joint sits (1 = at the edge)
export const SHOULDER_IN = 0.62;
// rounder animals need their arms a bit further out, or the arms sink into the belly
const SHOULDER_FOR = { bear: 0.7, dog: 0.38, chicken: 0.66, hamster: 0.82, walrus: 0.75, cat: 0.6, lion: 0.6 };

// Building a rig (measuring the body, weighting ~200k vertices) is heavy, so each model is
// rigged ONCE; every character made from it shares the geometry, skin weights and textures
// and only gets its own bones. (Character select used to rig 4 animals × 4 players afresh.)
const rigCache = new Map();
const _fv = new THREE.Vector3(), _fw = new THREE.Vector3(), _fz = new THREE.Vector3(0, 0, 1), _fx = new THREE.Vector3(1, 0, 0), _fdown = new THREE.Vector3(0, -1, 0);
const _fq = new THREE.Quaternion(), _fq2 = new THREE.Quaternion(), _fq3 = new THREE.Quaternion(), _fe = new THREE.Euler(), _fm = new THREE.Matrix4();
export function loadRiggedCharacter(url, opts = {}) {
  const key = url + JSON.stringify(opts);
  if (!rigCache.has(key)) {
    const p = buildRig(url, opts);
    p.catch(() => rigCache.delete(key));          // a failed download can be tried again
    rigCache.set(key, p);
  }
  return rigCache.get(key).then(instantiate);
}
function instantiate(t) {
  const hips = t.hips.clone(true);
  const B = {};
  hips.traverse((o) => { if (o.isBone) B[o.name] = o; });
  const mesh = new THREE.SkinnedMesh(t.geo, t.mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.add(hips);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(t.order.map((k) => B[k])));
  const root = new THREE.Group();
  root.add(mesh);
  const ch = new RiggedCharacter(root, mesh, B, t.H, t.joints);
  ch.src = t.url; ch.shift = t.shift; ch.rigged = t.rigged;
  return ch;
}

// rest-pose transform of a skinned mesh's vertices (same for every bone at rest)
export function restMatrix(sm) {
  return new THREE.Matrix4().multiplyMatrices(sm.skeleton.bones[0].matrixWorld, sm.skeleton.boneInverses[0]).multiply(sm.bindMatrix);
}

async function buildRig(url, opts = {}) {
  const id = Object.keys(SHOULDER_FOR).find((k) => url.includes(k));
  const shoulderIn = opts.shoulderIn ?? SHOULDER_FOR[id] ?? SHOULDER_IN;
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let src = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
  // A model rigged in Blender (tools/blender_rig) brings its own skeleton and skin weights:
  // its joints are used as they are and its weights replace the guessed ones below.
  // Add ?autorig to the page address to ignore Blender's rig and go back to the measured one.
  const skinned = !!(src.isSkinnedMesh && src.skeleton);
  const forceAuto = typeof location !== 'undefined' && new URLSearchParams(location.search).has('autorig');
  const rigged = skinned && !forceAuto && ['hips', 'upperL', 'upperR', 'thighL', 'thighR'].every((k) => src.skeleton.getBoneByName(k));

  // 1. Plain float geometry in model space (undo quantization / node transforms)
  const g0 = src.geometry;
  const n = g0.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  // Where each vertex sits at rest. For a skinned (Blender-rigged) model that's through its
  // skeleton: compressed models keep their size and offset in the bones' inverse bind
  // matrices, not on the mesh node.
  const M = skinned ? restMatrix(src) : src.matrixWorld;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(M);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(g0.attributes.position, i).applyMatrix4(M);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    if (g0.attributes.normal) {
      v.fromBufferAttribute(g0.attributes.normal, i).applyMatrix3(nm).normalize();
      nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (g0.attributes.normal) geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  else geo.computeVertexNormals();
  if (g0.attributes.uv) {
    const uv = new Float32Array(n * 2), t = new THREE.Vector2();
    for (let i = 0; i < n; i++) { t.fromBufferAttribute(g0.attributes.uv, i); uv[i * 2] = t.x; uv[i * 2 + 1] = t.y; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  geo.setIndex(g0.index);

  // centre on X/Z, feet at y = 0
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const shift = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.translate(shift.x, shift.y, shift.z);
  // Blender joints, in the same (centred) space as the geometry
  const RJ = {};
  if (rigged) for (const b of src.skeleton.bones) RJ[b.name] = b.getWorldPosition(new THREE.Vector3()).add(shift);
  geo.computeBoundingBox();
  const H = geo.boundingBox.max.y, X = geo.boundingBox.max.x;

  // 2. Measure the body: horizontal slices give the arm band, torso width and crotch
  const S = 80, ext = new Float32Array(S), near = new Int32Array(S);
  const bin = (y) => Math.min(S - 1, Math.max(0, Math.floor((y / H) * S)));
  for (let i = 0; i < n; i++) {
    const x = Math.abs(pos[i * 3]), y = pos[i * 3 + 1], b = bin(y);
    if (x > ext[b]) ext[b] = x;
    // between-the-legs check, front half only so a tail hanging behind doesn't hide the gap
    if (x < X * 0.06 && pos[i * 3 + 2] > 0) near[b]++;
  }
  let top = 0;
  for (let b = 0; b < S; b++) if (ext[b] > ext[top]) top = b;
  let a0 = top, a1 = top;
  while (a0 > 0 && ext[a0 - 1] > ext[top] * 0.7) a0--;
  while (a1 < S - 1 && ext[a1 + 1] > ext[top] * 0.7) a1++;
  const armY = ((a0 + a1 + 1) / 2 / S) * H;
  // torso half-width just under the arms = where the arms start
  let sx = 0;
  for (let b = Math.max(0, a0 - 4); b < a0; b++) sx = Math.max(sx, ext[b]);
  if (!sx) sx = X * 0.35;
  // crotch: the highest slice in the lower half with an empty gap between the legs
  let crotchB = Math.floor(S * 0.12);
  for (let b = 0; b < S * 0.55; b++) if (near[b] === 0) crotchB = b;
  const crotchY = ((crotchB + 1) / S) * H;
  // Second opinion on the shoulder: walking out from the middle, the body is
  // tall and the arm (or wing) is thin. The shoulder is where it becomes thin.
  {
    const XB = 60, lo = new Float32Array(XB).fill(1e9), hi = new Float32Array(XB).fill(-1e9);
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (y < crotchY) continue;
      const xb = Math.min(XB - 1, Math.floor((Math.abs(pos[i * 3]) / X) * XB));
      if (y < lo[xb]) lo[xb] = y;
      if (y > hi[xb]) hi[xb] = y;
    }
    const tall = hi[0] - lo[0];
    for (let xb = 2; xb < XB - 3; xb++) {
      const thin = (k) => hi[k] - lo[k] < tall * 0.45;
      if (thin(xb) && thin(xb + 1) && thin(xb + 2)) { sx = Math.min(sx, (xb / XB) * X); break; }
    }
  }
  // leg centres and the arm line (average height of the arm at each end)
  let lx = 0, lc = 0, tipY = 0, tipC = 0, shY = 0, shC = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.abs(pos[i * 3]), y = pos[i * 3 + 1];
    if (y < crotchY) { lx += x; lc++; }
    if (x > X * 0.85) { tipY += y; tipC++; }
    if (x > sx && x < sx + (X - sx) * 0.2 && Math.abs(y - armY) < H * 0.15) { shY += y; shC++; }
  }
  const legX = lc ? lx / lc : X * 0.2;
  const armTipY = tipC ? tipY / tipC : armY;
  const armRootY = shC ? shY / shC : armY;
  const elbowX = sx + (X - sx) * 0.5;
  const wristX = sx + (X - sx) * 0.8;   // the last part of the arm is the hand (paw / wing tip)
  const hipY = crotchY + H * 0.06;
  const kneeY = crotchY * 0.5;
  const waistY = hipY + (armRootY - hipY) * 0.35;
  const neckY = armRootY + (H - armRootY) * 0.12;   // where the head starts turning on its own

  // Belly and tail. The model faces +Z: the belly is the front of the torso,
  // a tail is anything sticking out behind the back (measured at the waist, where no tail is).
  const chestY = hipY + (armRootY - hipY) * 0.7;
  const bellyY = (hipY + chestY) / 2;
  let frontZ = 0; const backs = [];
  for (let i = 0; i < n; i++) {
    const x = Math.abs(pos[i * 3]), y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < sx && y > hipY && y < chestY && z > frontZ) frontZ = z;
    if (x < sx && Math.abs(y - waistY) < H * 0.06) backs.push(z);
  }
  backs.sort((p2, q) => p2 - q);
  const backZ = backs.length ? backs[Math.floor(backs.length * 0.1)] : 0;
  let tailMinZ = 0, tbx = 0, tby = 0, tbc = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (z < backZ - H * 0.05 && y < chestY && y > H * 0.05 && Math.abs(x) < sx) {
      tailMinZ = Math.min(tailMinZ, z);
      if (z > backZ - H * 0.1) { tbx += x; tby += y; tbc++; }
    }
  }
  const hasTail = tbc > 20 && backZ - tailMinZ > H * 0.1;
  const tailBase = hasTail ? new THREE.Vector3(tbx / tbc, tby / tbc, backZ - H * 0.03) : new THREE.Vector3(0, hipY, backZ);

  // 3. Skeleton: hips → spine → arms ; hips → legs
  const bone = (name, x, y, parent, z = 0) => {
    if (RJ[name]) ({ x, y, z } = RJ[name]);
    const b = new THREE.Bone(); b.name = name;
    const p = parent ? parent.userData.world : new THREE.Vector3();
    b.position.set(x - p.x, y - p.y, z - p.z);
    b.userData.world = new THREE.Vector3(x, y, z);
    if (parent) parent.add(b);
    return b;
  };
  const hips = bone('hips', 0, hipY, null);
  // body: hips (pelvis + legs) → spine (waist) → chest (shoulders + arms) → head
  const spine = bone('spine', 0, waistY, hips);
  const chest = bone('chest', 0, chestY, spine);
  const head = bone('head', 0, neckY, chest);
  // extra bones moved by physics (not by the player): the belly and the tail
  const belly = bone('belly', 0, bellyY, spine, frontZ * 0.4);
  const tail = bone('tail', tailBase.x, tailBase.y, hips, tailBase.z);
  const B = { hips, spine, chest, head, belly, tail };
  for (const [s, side] of [['L', -1], ['R', 1]]) {
    const elbowY = armRootY + (armTipY - armRootY) * 0.5;
    // the shoulder joint sits inside the body (not at its edge), so arms hang close to the sides
    B['upper' + s] = bone('upper' + s, side * sx * shoulderIn, armRootY - H * 0.01, chest);
    B['fore' + s] = bone('fore' + s, side * elbowX, elbowY, B['upper' + s]);
    B['hand' + s] = bone('hand' + s, side * wristX, armRootY + (armTipY - armRootY) * 0.8, B['fore' + s]);
    B['thigh' + s] = bone('thigh' + s, side * legX, hipY, hips);
    B['shin' + s] = bone('shin' + s, side * legX, kneeY, B['thigh' + s]);
  }
  const order = ['hips', 'spine', 'upperL', 'foreL', 'thighL', 'shinL', 'upperR', 'foreR', 'thighR', 'shinR', 'handL', 'handR', 'chest', 'head', 'belly', 'tail'];
  const idx = Object.fromEntries(order.map((k, i) => [k, i]));

  // 4. Skin weights. A Blender-rigged model brings its own (bone indices remapped by name);
  // otherwise: arms, legs, then the rest split between spine and hips
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  if (rigged) {
    const map = src.skeleton.bones.map((bn) => idx[bn.name] ?? idx.hips);
    const SI = g0.attributes.skinIndex, SW = g0.attributes.skinWeight;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) { si[i * 4 + j] = map[SI.getComponent(i, j)]; sw[i * 4 + j] = SW.getComponent(i, j); sum += sw[i * 4 + j]; }
      if (sum > 0) for (let j = 0; j < 4; j++) sw[i * 4 + j] /= sum; else { si[i * 4] = idx.hips; sw[i * 4] = 1; }
    }
  }
  const bA = H * 0.08;                      // softness at the shoulders (a gentle blend, no square edge)
  if (!rigged) for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], ax = Math.abs(x), s = x < 0 ? 'L' : 'R';
    const ws = {};
    // arm: outside the shoulder, near the arm's height
    const armLineY = armRootY + (armTipY - armRootY) * Math.max(0, (ax - sx) / (X - sx));
    const nearArm = 1 - smooth(H * 0.12, H * 0.2, Math.abs(y - armLineY));
    const a = smooth(sx - bA, sx + bA, ax) * nearArm * (y > crotchY + H * 0.1 ? 1 : 0);
    const e = smooth(elbowX - H * 0.05, elbowX + H * 0.05, ax);
    const wr = smooth(wristX - H * 0.03, wristX + H * 0.03, ax);
    ws['upper' + s] = a * (1 - e); ws['fore' + s] = a * e * (1 - wr); ws['hand' + s] = a * e * wr;
    // leg: below the crotch on that side
    const l = (1 - a) * smooth(crotchY + H * 0.07, crotchY - H * 0.01, y) * smooth(0, legX * 0.6, ax);
    const k = smooth(kneeY + H * 0.05, kneeY - H * 0.05, y);
    ws['thigh' + s] = l * (1 - k); ws['shin' + s] = l * k;
    const r = Math.max(0, 1 - a - l);
    // the rest of the body: hips → spine → chest → head, blended softly between them
    const up = smooth(waistY - H * 0.08, waistY + H * 0.08, y);
    const ch = smooth(chestY - H * 0.06, chestY + H * 0.06, y);
    const hd = smooth(neckY - H * 0.04, neckY + H * 0.04, y) * (1 - smooth(sx * 0.9, sx * 1.3, ax));
    ws.hips = r * (1 - up); ws.spine = r * up * (1 - ch);
    ws.chest = r * up * ch * (1 - hd); ws.head = r * up * ch * hd;
    // belly: the front of the torso around the middle
    const z = pos[i * 3 + 2];
    const wb = r * smooth(frontZ * 0.25, frontZ * 0.75, z) * (1 - smooth(0, (chestY - hipY) * 0.6, Math.abs(y - bellyY))) *
      (1 - smooth(sx * 0.6, sx, ax));
    // tail: behind the back, growing from its base
    const wt = hasTail ? smooth(backZ - H * 0.03, backZ - H * 0.09, z) * (ax < sx ? 1 : 0) * (y < chestY ? 1 : 0) : 0;
    const keep = (1 - wb) * (1 - wt);
    for (const key of Object.keys(ws)) ws[key] *= keep;
    ws.belly = wb * (1 - wt); ws.tail = wt;
    const top4 = Object.entries(ws).filter(([, w]) => w > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top4.reduce((t, [, w]) => t + w, 0) || 1;
    top4.forEach(([k2, w], j) => { si[i * 4 + j] = idx[k2]; sw[i * 4 + j] = w / sum; });
    if (!top4.length) { si[i * 4] = idx.hips; sw[i * 4] = 1; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

  // the template: shared by every character made from this model (its bones are only copied)
  return { url, shift, rigged, geo, mat: src.material, hips, order, H, joints: { shoulderInner: sx * shoulderIn, shoulderOuter: sx * 0.98, shoulderY: armRootY - H * 0.01, hasTail, frontZ, backZ, sx, elbowX, wristX, chestY, neckY, crotchY, kneeY, armRootY, armTipY, legX, waistY } };
}

export class RiggedCharacter {
  constructor(root, mesh, bones, height, joints) {
    this.root = root; this.mesh = mesh; this.b = bones; this.height = height; this.joints = joints;
    this.a = {}; this.tilt = 0; this.hop = 0; this.hipY0 = bones.hips.position.y;
    // rest directions of each bone (screen angle, y down): arms point out, legs point down
    this.rest = { upperL: Math.PI, upperR: 0, thighL: Math.PI / 2, thighR: Math.PI / 2 };
    this.restPos = { belly: bones.belly.position.clone(), chest: bones.chest.position.clone() };
    this.chestY = bones.chest.userData.world.y;
    this.phys = null;
  }

  // Shoulders roll out and up as an arm lifts: arms hang close to the body when down,
  // and go up beside the head (not behind it) when raised. Call after posing the arms.
  // ---- squatting: the whole skeleton folds, like a real squat
  // How deep the squat is (s: 0 standing … 1 as low as the legs fold) decides how far the
  // hips push back, the pelvis and back tip forward, and the head lifts to keep looking ahead;
  // then each leg is solved (two-bone IK, knees forward) so the feet stay planted on the floor.
  // unfold() takes the fold off again before the next pose.
  unfold() {
    const f = this._fold;
    if (!f) return;
    for (const k of ['hips', 'spine', 'chest', 'head']) this.b[k].quaternion.copy(f[k]);
    this.b.hips.position.z = f.hipsZ;
    this._fold = null;
  }
  plantFeet() {
    const b = this.b, j = this.joints;
    const Lt = this.hipY0 - j.kneeY, Ls = j.kneeY;
    const s = Math.max(0, Math.min(1, -this.hop / (0.55 * this.hipY0)));
    if (s < 0.02) {
      if (this._planted) { for (const k of ['L', 'R']) { b['thigh' + k].rotation.x = 0; b['shin' + k].rotation.x = 0; } this._planted = false; }
      return;
    }
    this._planted = true;
    this.unfold();
    this._fold = { hips: b.hips.quaternion.clone(), spine: b.spine.quaternion.clone(), chest: b.chest.quaternion.clone(), head: b.head.quaternion.clone(), hipsZ: b.hips.position.z };
    // fold: hips back, pelvis and back forward, head up
    b.hips.position.z = this._fold.hipsZ - 0.25 * Lt * s;
    b.hips.quaternion.multiply(_fq.setFromAxisAngle(_fx, 0.28 * s));
    b.spine.quaternion.multiply(_fq.setFromAxisAngle(_fx, 0.14 * s));
    b.chest.quaternion.multiply(_fq.setFromAxisAngle(_fx, 0.04 * s));
    b.head.quaternion.multiply(_fq.setFromAxisAngle(_fx, -0.45 * s));
    // legs: from each hip joint down to its foot on the floor (under where the foot stands)
    this.root.updateMatrixWorld(true);
    const invRoot = _fm.copy(this.root.matrixWorld).invert();
    for (const [k, side] of [['L', -1], ['R', 1]]) {
      const th = b['thigh' + k], sh = b['shin' + k];
      const hipJ = _fv.setFromMatrixPosition(th.matrixWorld).applyMatrix4(invRoot).clone();
      const foot = _fw.set(side * j.legX * 1.08, 0, 0.04 * Lt);      // a touch forward and apart
      // into the hips' space (the thighs' parent)
      const hq = b.hips.getWorldQuaternion(_fq2).premultiply(_fq3.copy(this.root.getWorldQuaternion(_fq3)).invert()).invert();
      const v = foot.sub(hipJ).applyQuaternion(hq).divideScalar(1);
      let L = v.length();
      const dir = v.clone().normalize();
      L = Math.min(L, (Lt + Ls) * 0.999);
      const c = (x) => Math.max(-1, Math.min(1, x));
      const a = Math.acos(c((Lt * Lt + L * L - Ls * Ls) / (2 * Lt * L)));
      // knees bend forward (+Z), and a little outward
      const fwd = new THREE.Vector3(side * 0.25, 0, 1).normalize();
      const n = fwd.sub(dir.clone().multiplyScalar(fwd.dot(dir))).normalize();
      const kneeDir = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(n, Math.sin(a));
      th.quaternion.setFromUnitVectors(_fdown, kneeDir);
      const shinDir = dir.clone().multiplyScalar(L).sub(kneeDir.clone().multiplyScalar(Lt)).normalize()
        .applyQuaternion(_fq2.copy(th.quaternion).invert());
      sh.quaternion.setFromUnitVectors(_fdown, shinDir);
    }
  }

  // ---- arms don't go through the body or the head
  // The chest/belly is an upright rounded column and the head a ball. After the arms are
  // posed, an arm whose elbow, wrist or paw would sink in is swung FORWARD at the shoulder
  // until it's clear — so a hand on the tummy or at the mouth rests in front of the body
  // (from the front it looks the same as the player's pose). Arms may still cross each other.
  // Call unfixArms() before posing and fixArms() after.
  unfixArms() {
    if (!this._fix) return;
    for (const [name, q] of Object.entries(this._fix)) this.b[name].quaternion.copy(q);
    this._fix = null;
  }
  fixArms() {
    const j = this.joints, H = this.height, b = this.b, root = this.root;
    root.updateMatrixWorld(true);
    const P = (bone, x = 0, y = 0, z = 0) => root.worldToLocal(bone.localToWorld(_fv.set(x, y, z))).clone();
    const headLen = H - j.neckY;
    const hipsP = P(b.hips), chestP = P(b.chest);
    const top = chestP.clone().add(chestP.clone().sub(hipsP).setLength((j.armRootY - j.chestY) * 0.6 + H * 0.02));
    const zc = ((j.frontZ || 0) + (j.backZ || 0)) / 2, rz = Math.max(H * 0.06, ((j.frontZ || 0) - (j.backZ || 0)) / 2);
    const rx = j.sx * 0.82, m = H * 0.035;
    const head = P(b.head, 0, headLen * 0.5, 0), rh = headLen * 0.42;
    // how deep a point is inside the body or head (≤ 0 = outside)
    const depth = (p) => {
      const ax = top.clone().sub(hipsP), t = Math.max(0, Math.min(1, p.clone().sub(hipsP).dot(ax) / ax.lengthSq()));
      const c = hipsP.clone().addScaledVector(ax, t);
      const ex = (p.x - c.x) / (rx + m), ez = (p.z - zc) / (rz + m);
      const torso = 1 - Math.sqrt(ex * ex + ez * ez);
      const hd = 1 - p.distanceTo(head) / (rh + m);
      return Math.max(torso, hd);
    };
    this._fix = this._fix || {};
    this._armTheta = this._armTheta || { L: 0, R: 0 };
    for (const s of ['L', 'R']) {
      const up = b['upper' + s], fore = b['fore' + s], hand = b['hand' + s];
      const pen = () => {
        up.updateMatrixWorld(true);
        const e = P(fore), w = P(hand), tip = w.clone().add(w.clone().sub(e).multiplyScalar(0.35));
        return Math.max(depth(e), depth(e.clone().lerp(w, 0.5)), depth(w), depth(tip));
      };
      const q0 = up.quaternion.clone();
      // forward axis for this arm: (arm direction) × (the body's front), in the chest's space
      const dir = fore.position.clone().applyQuaternion(q0).normalize();
      const axis = dir.clone().cross(_fz).normalize();
      let theta = 0;
      if (axis.lengthSq() > 0.5 && pen() > 0) {
        for (theta = 0.1; theta <= 1.4; theta += 0.1) {
          up.quaternion.copy(_fq.setFromAxisAngle(axis, theta)).multiply(q0);
          if (pen() <= 0) break;
        }
      }
      // ease, so the arm doesn't pop
      const shown = this._armTheta[s] + (theta - this._armTheta[s]) * (theta > this._armTheta[s] ? 0.6 : 0.25);
      this._armTheta[s] = shown;
      if (shown > 0.005 && axis.lengthSq() > 0.5) {
        this._fix['upper' + s] = q0;
        up.quaternion.copy(_fq.setFromAxisAngle(axis, shown)).multiply(q0);
      } else up.quaternion.copy(q0);
      up.updateMatrixWorld(true);
    }
  }

  adjustShoulders() {
    const j = this.joints;
    for (const [s, side] of [['L', -1], ['R', 1]]) {
      const b = this.b['upper' + s];
      const d = _d.set(side, 0, 0).applyQuaternion(b.quaternion);      // where the upper arm points (in the chest)
      const t = Math.min(1, Math.max(0, (d.y + 0.3) / 1.2)), f = t * t * (3 - 2 * t);
      // relaxed arms: shoulders drop and slope (not a square, boxy top); raised: they lift
      b.position.set(side * (j.shoulderInner + (j.shoulderOuter - j.shoulderInner) * f),
        j.shoulderY - this.chestY + (f - 0.45) * this.height * 0.055, 0);
    }
  }

  // Secondary motion: springs that lag behind the body and wobble back.
  // Call once per frame AFTER posing. Works in "body heights", so it looks the
  // same at any size on screen.
  physics() {
    const P = this.phys;
    if (!P) return;
    const now = performance.now() / 1000;
    const dt = Math.min(1 / 20, Math.max(1 / 120, now - (this._pt || now - 1 / 60)));
    this._pt = now;
    const s = this.root.getWorldScale(_d).x * this.height || 1;
    const springs = this._sp || (this._sp = {
      belly: { bone: this.b.belly, k: 140, d: 7, gain: 0.5, max: 0.06 },
      bob: { bone: this.b.chest, k: 90, d: 6, gain: 0.35, max: 0.05 },
      tail: { bone: this.b.tail, k: 60, d: 4, gain: 1.6, max: 0.25 },
    });
    let energy = 0;
    for (const [name, sp] of Object.entries(springs)) {
      const amount = P[name] || 0;
      // where the spring is attached, and how that point is accelerating (body heights / s²)
      const at = sp.bone.parent.getWorldPosition(new THREE.Vector3()).multiplyScalar(1 / s);
      if (!sp.prev) { sp.prev = at.clone(); sp.vel = new THREE.Vector3(); sp.x = new THREE.Vector3(); sp.xv = new THREE.Vector3(); }
      const vel = at.clone().sub(sp.prev).multiplyScalar(1 / dt);
      const acc = vel.clone().sub(sp.vel).multiplyScalar(1 / dt);
      if (acc.length() > 400) acc.setLength(400);               // ignore teleports (e.g. respawn)
      sp.prev.copy(at); sp.vel.copy(vel);
      energy = Math.max(energy, Math.min(1, vel.length() / 2));
      // damped spring pushed the opposite way to the acceleration (it lags behind)
      sp.xv.addScaledVector(sp.x, -sp.k * dt).addScaledVector(sp.xv, -sp.d * dt).addScaledVector(acc, -sp.gain * dt);
      sp.x.addScaledVector(sp.xv, dt);
      if (sp.x.length() > sp.max) sp.x.setLength(sp.max);
      // into the bone's parent space (model units)
      const q = sp.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();   // world → parent
      const local = sp.x.clone().multiplyScalar(this.height * amount).applyQuaternion(q);
      if (name === 'belly') this.b.belly.position.copy(this.restPos.belly).add(local);
      else if (name === 'bob') this.b.chest.position.copy(this.restPos.chest).add(local.multiply(new THREE.Vector3(0.4, 1, 0.6)));
      else if (name === 'tail') {
        // the tail swings sideways / up-down against the motion, and wags
        this._wag = (this._wag || 0) + dt * (9 + 6 * energy);
        const wag = (P.wag || 0) * (0.5 + energy) * Math.sin(this._wag);
        const swing = local.x / this.height * 2.5, lift = local.y / this.height * 2.5;
        this.b.tail.rotation.set(-lift, swing + wag, 0);
      }
    }
  }

  // pts: smoothed mirrored points from body.js; base: calibrated posture (optional)
  pose(pts, base = null) {
    this.unfold();
    this.reset3D();
    const ok = (i) => pts[i].v > 0.4;
    const ang = (a, b) => Math.atan2(pts[b].y - pts[a].y, pts[b].x - pts[a].x);
    const set = (name, target) => {
      const cur = this.a[name] ?? 0;
      this.a[name] = cur + wrap(target - cur) * 0.5;
      this.b[name].rotation.z = -this.a[name];       // screen-clockwise → negative Z rotation
    };
    const { sh, hip, torso } = keyPoints(pts);
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    // Each part of the body follows its own line, as a screen angle:
    //   hips ← the hip line, waist ← the torso (hips→shoulders), chest ← the shoulder line,
    //   head ← the ear line (and it turns toward where the nose points)
    const tilt = clamp(Math.atan2(sh.y - hip.y, sh.x - hip.x) + Math.PI / 2, 0.5);
    this.tilt += (tilt - this.tilt) * 0.5;
    const hipsA = ok(L.lHip) && ok(L.rHip) ? clamp(ang(L.lHip, L.rHip), 0.35) : 0;
    const chestA = ok(L.lShoulder) && ok(L.rShoulder) ? clamp(ang(L.lShoulder, L.rShoulder), 0.6) : this.tilt;
    set('hips', hipsA);
    const ex = this.ex || EXAGGERATE;
    set('spine', (this.tilt - hipsA) * ex.torso);
    set('chest', (chestA - this.tilt) * ex.torso);
    if (ok(L.lEar) && ok(L.rEar)) {
      const headA = clamp(wrap(ang(L.lEar, L.rEar) - chestA), 0.7);
      set('head', headA);
      // nose left/right of the ears' middle → head turned that way
      const half = Math.abs(pts[L.rEar].x - pts[L.lEar].x) / 2;
      if (ok(L.nose) && half > 1e-3) {
        const off = (pts[L.nose].x - (pts[L.lEar].x + pts[L.rEar].x) / 2) / half;
        this.a.headYaw = (this.a.headYaw ?? 0) + (clamp(off, 1) * 1.0 * ex.head - (this.a.headYaw ?? 0)) * 0.5;
        this.b.head.rotation.y = this.a.headYaw;
      }
    }
    const armBase = this.a.chest !== undefined ? (this.a.hips ?? 0) + (this.a.spine ?? 0) + this.a.chest : this.tilt;
    const legBase = this.a.hips ?? 0;
    if (base) {
      const dy = (base.hipY - hip.y) / torso;
      this.hop += (dy * 0.45 * this.height - this.hop) * 0.5;
      this.hop = Math.max(-0.55 * this.hipY0, this.hop);      // no lower than the legs can fold
      this.b.hips.position.y = this.hipY0 + this.hop;
    }
    const limbs = [
      ['upperL', 'foreL', L.lShoulder, L.lElbow, L.lWrist, armBase],
      ['upperR', 'foreR', L.rShoulder, L.rElbow, L.rWrist, armBase],
      ['thighL', 'shinL', L.lHip, L.lKnee, L.lAnkle, legBase],
      ['thighR', 'shinR', L.rHip, L.rKnee, L.rAnkle, legBase],
    ];
    for (const [up, lo, a, m, c, parentTilt] of limbs) {
      if (!(ok(a) && ok(m))) continue;
      const u = ang(a, m);
      let t1 = wrap(u - this.rest[up] - parentTilt);
      if (up.startsWith('thigh')) t1 = Math.max(-1.1, Math.min(1.1, t1));
      set(up, t1);
      if (ok(c)) {
        let t2 = wrap(ang(m, c) - u);
        if (lo.startsWith('shin')) t2 = Math.max(-1.6, Math.min(1.6, t2));
        set(lo, t2);
      }
    }
    this.plantFeet();                    // after the legs copied the player: squats keep the feet on the floor
    this.poseHands2D(pts);
    this.adjustShoulders();
  }

  // Whole-body copy from the 3D skeleton (body.world): the hips turn and lean,
  // the shoulders twist on the spine, and every limb points where the person's does.
  // pts (2D) are used for visibility and the jump height; base is optional.
  pose3D(world, pts, base = null, k = 0.5) {
    this.unfold();
    const ex = this.ex || EXAGGERATE;
    const ok = (i) => pts[i].v > 0.4;
    const P = (i) => _v(world[i]);
    this.root.getWorldQuaternion(_rq);
    // body frame from a left→right line and an up line → a rotation
    const frame = (left, right, up) => {
      const x = right.clone().sub(left).normalize();
      const y = up.clone().addScaledVector(x, -up.dot(x)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y);
      return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
    };
    const turn = (bone, qModel) => {           // give a bone this rotation in model space
      bone.parent.getWorldQuaternion(_pq);
      _q.copy(_rq).multiply(qModel);
      _q.premultiply(_pq.invert());
      bone.quaternion.slerp(_q, k);
    };
    // point a bone from joint `from` toward joint `to` (or the middle of two joints);
    // maxBend limits how far it may turn from straight (wrists don't fold back)
    const aim = (name, from, to, maxBend = 0) => {
      const bone = this.b[name];
      const tos = [].concat(to);
      if (!(ok(from) && tos.every(ok))) { bone.quaternion.slerp(_q.identity(), k * 0.3); return; }
      _d.set(0, 0, 0);
      tos.forEach((t) => _d.add(P(t)));
      _d.multiplyScalar(1 / tos.length).sub(P(from)).normalize().applyQuaternion(_rq);
      bone.parent.getWorldQuaternion(_pq);
      _d.applyQuaternion(_pq.invert());
      _q.setFromUnitVectors(REST[name], _d);
      if (maxBend) _q.copy(amp(_q, ex.wrist, maxBend));   // only wrists have a bend limit
      bone.quaternion.slerp(_q, k);
    };
    const hipL = P(L.lHip), hipR = P(L.rHip), shL = P(L.lShoulder), shR = P(L.rShoulder);
    const up = shL.clone().add(shR).sub(hipL).sub(hipR).multiplyScalar(0.5);
    // lower body follows the hips, upper body the shoulders; the waist takes half the twist
    const qHip = frame(hipL, hipR, up), qSh = frame(shL, shR, up);
    // the twist/bend between hips and shoulders, exaggerated a little and shared by waist and chest
    const rel = qHip.clone().invert().multiply(qSh);
    turn(this.b.hips, qHip);
    turn(this.b.spine, qHip.clone().multiply(amp(rel, ex.torso * 0.5, 0.7)));
    turn(this.b.chest, qHip.clone().multiply(amp(rel, ex.torso, 1.3)));
    // head: ears give left-right, the nose gives which way the face points
    if (ok(L.lEar) && ok(L.rEar) && ok(L.nose) && P(L.lEar).distanceTo(P(L.rEar)) > 0.03) {
      const eL = P(L.lEar), eR = P(L.rEar), earMid = eL.clone().add(eR).multiplyScalar(0.5);
      const x = eR.clone().sub(eL).normalize();
      const fwd = P(L.nose).sub(earMid);
      const zf = fwd.addScaledVector(x, -fwd.dot(x)).normalize();
      // the nose sits a bit below the ears: tip "forward" back up so a level head reads as level
      const yv = new THREE.Vector3().crossVectors(zf, x).normalize();
      const tilt = new THREE.Quaternion().setFromAxisAngle(x, -0.3);
      const qHead = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, yv, zf)).premultiply(tilt);
      // keep it to what a neck can do relative to the chest
      const hRel = amp(qSh.clone().invert().multiply(qHead), ex.head, 1.1);
      turn(this.b.head, qSh.clone().multiply(hRel));
    } else this.b.head.quaternion.slerp(_q.identity(), k * 0.3);
    aim('upperL', L.lShoulder, L.lElbow); aim('foreL', L.lElbow, L.lWrist);
    aim('upperR', L.rShoulder, L.rElbow); aim('foreR', L.rElbow, L.rWrist);
    aim('handL', L.lWrist, [L.lIndex, L.lPinky], 1.4); aim('handR', L.rWrist, [L.rIndex, L.rPinky], 1.4);
    aim('thighL', L.lHip, L.lKnee); aim('shinL', L.lKnee, L.lAnkle);
    aim('thighR', L.rHip, L.rKnee); aim('shinR', L.rKnee, L.rAnkle);
    if (base) {
      const { hip, torso } = keyPoints(pts);
      const dy = (base.hipY - hip.y) / torso;
      this.hop += (dy * 0.45 * this.height - this.hop) * 0.5;
      this.hop = Math.max(-0.55 * this.hipY0, this.hop);      // no lower than the legs can fold
      this.b.hips.position.y = this.hipY0 + this.hop;
      this.plantFeet();
    }
    this.adjustShoulders();
    this.used3D = true;
  }

  // clear what pose3D set, before going back to the 2D (rotation.z) way of posing
  reset3D() {
    if (!this.used3D) return;
    for (const b of Object.values(this.b)) b.quaternion.identity();
    this.a = {}; this.used3D = false;
  }

  // 2D: bend each wrist toward the fingers (index/pinky middle)
  poseHands2D(pts) {
    const ok = (i) => pts[i].v > 0.3;
    const ang = (a, x, y) => Math.atan2(y - pts[a].y, x - pts[a].x);
    for (const [h, e, w, i1, i2] of [['handL', L.lElbow, L.lWrist, L.lIndex, L.lPinky], ['handR', L.rElbow, L.rWrist, L.rIndex, L.rPinky]]) {
      if (!(ok(e) && ok(w) && ok(i1) && ok(i2))) continue;
      const fx = (pts[i1].x + pts[i2].x) / 2, fy = (pts[i1].y + pts[i2].y) / 2;
      const t = Math.max(-1.4, Math.min(1.4, wrap(ang(w, fx, fy) - ang(e, pts[w].x, pts[w].y)) * (this.ex || EXAGGERATE).wrist));
      const cur = this.a[h] ?? 0;
      this.a[h] = cur + wrap(t - cur) * 0.5;
      this.b[h].rotation.z = -this.a[h];
    }
  }

  idle(t) {
    this.unfold();
    this.reset3D();
    const w = Math.sin(t * 2) * 0.2;
    const ease = (name, target) => { const cur = this.a[name] ?? 0; this.a[name] = cur + (target - cur) * 0.08; this.b[name].rotation.z = -this.a[name]; };
    ease('upperL', -1.0 + w); ease('upperR', 1.0 - w); ease('foreL', -0.2); ease('foreR', 0.2); ease('handL', 0); ease('handR', 0);
    ease('hips', 0); ease('chest', 0); ease('head', 0); this.b.head.rotation.y *= 0.9;
    ['thighL', 'thighR', 'shinL', 'shinR'].forEach((k) => ease(k, 0));
    this.tilt *= 0.9; this.b.spine.rotation.z = -this.tilt;
    this.hop *= 0.9; this.b.hips.position.y = this.hipY0 + this.hop;
    this.adjustShoulders();
  }
}

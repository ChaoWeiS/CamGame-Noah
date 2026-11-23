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
const _m = new THREE.Matrix4(), _d = new THREE.Vector3();
// which way each bone points in the T-pose (the rig is built with no rotations)
const REST = {
  upperL: new THREE.Vector3(-1, 0, 0), foreL: new THREE.Vector3(-1, 0, 0),
  upperR: new THREE.Vector3(1, 0, 0), foreR: new THREE.Vector3(1, 0, 0),
  thighL: new THREE.Vector3(0, -1, 0), shinL: new THREE.Vector3(0, -1, 0),
  thighR: new THREE.Vector3(0, -1, 0), shinR: new THREE.Vector3(0, -1, 0),
};

export async function loadRiggedCharacter(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let src = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });

  // 1. Plain float geometry in model space (undo quantization / node transforms)
  const g0 = src.geometry;
  const n = g0.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(src.matrixWorld);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(g0.attributes.position, i).applyMatrix4(src.matrixWorld);
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
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
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
  const hipY = crotchY + H * 0.06;
  const kneeY = crotchY * 0.5;
  const waistY = hipY + (armRootY - hipY) * 0.35;

  // 3. Skeleton: hips → spine → arms ; hips → legs
  const bone = (name, x, y, parent) => {
    const b = new THREE.Bone(); b.name = name;
    const p = parent ? parent.userData.world : new THREE.Vector3();
    b.position.set(x - p.x, y - p.y, 0);
    b.userData.world = new THREE.Vector3(x, y, 0);
    if (parent) parent.add(b);
    return b;
  };
  const hips = bone('hips', 0, hipY, null);
  const spine = bone('spine', 0, waistY, hips);
  const B = { hips, spine };
  for (const [s, side] of [['L', -1], ['R', 1]]) {
    const elbowY = armRootY + (armTipY - armRootY) * 0.5;
    B['upper' + s] = bone('upper' + s, side * sx, armRootY, spine);
    B['fore' + s] = bone('fore' + s, side * elbowX, elbowY, B['upper' + s]);
    B['thigh' + s] = bone('thigh' + s, side * legX, hipY, hips);
    B['shin' + s] = bone('shin' + s, side * legX, kneeY, B['thigh' + s]);
  }
  const order = ['hips', 'spine', 'upperL', 'foreL', 'thighL', 'shinL', 'upperR', 'foreR', 'thighR', 'shinR'];
  const idx = Object.fromEntries(order.map((k, i) => [k, i]));

  // 4. Skin weights: arms, legs, then the rest split between spine and hips
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const bA = H * 0.05;                      // softness at the shoulders
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], ax = Math.abs(x), s = x < 0 ? 'L' : 'R';
    const ws = {};
    // arm: outside the shoulder, near the arm's height
    const armLineY = armRootY + (armTipY - armRootY) * Math.max(0, (ax - sx) / (X - sx));
    const nearArm = 1 - smooth(H * 0.12, H * 0.2, Math.abs(y - armLineY));
    const a = smooth(sx - bA, sx + bA, ax) * nearArm * (y > crotchY + H * 0.1 ? 1 : 0);
    const e = smooth(elbowX - H * 0.05, elbowX + H * 0.05, ax);
    ws['upper' + s] = a * (1 - e); ws['fore' + s] = a * e;
    // leg: below the crotch on that side
    const l = (1 - a) * smooth(crotchY + H * 0.07, crotchY - H * 0.01, y) * smooth(0, legX * 0.6, ax);
    const k = smooth(kneeY + H * 0.05, kneeY - H * 0.05, y);
    ws['thigh' + s] = l * (1 - k); ws['shin' + s] = l * k;
    const r = Math.max(0, 1 - a - l);
    const up = smooth(waistY - H * 0.08, waistY + H * 0.08, y);
    ws.spine = r * up; ws.hips = r * (1 - up);
    const top4 = Object.entries(ws).filter(([, w]) => w > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top4.reduce((t, [, w]) => t + w, 0) || 1;
    top4.forEach(([k2, w], j) => { si[i * 4 + j] = idx[k2]; sw[i * 4 + j] = w / sum; });
    if (!top4.length) { si[i * 4] = idx.hips; sw[i * 4] = 1; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

  const mat = src.material;
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.add(hips);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order.map((k) => B[k]));
  mesh.bind(skeleton);
  const root = new THREE.Group();
  root.add(mesh);
  return new RiggedCharacter(root, mesh, B, H, { sx, elbowX, crotchY, kneeY, armRootY, armTipY, legX, waistY });
}

export class RiggedCharacter {
  constructor(root, mesh, bones, height, joints) {
    this.root = root; this.mesh = mesh; this.b = bones; this.height = height; this.joints = joints;
    this.a = {}; this.tilt = 0; this.hop = 0; this.hipY0 = bones.hips.position.y;
    // rest directions of each bone (screen angle, y down): arms point out, legs point down
    this.rest = { upperL: Math.PI, upperR: 0, thighL: Math.PI / 2, thighR: Math.PI / 2 };
  }

  // pts: smoothed mirrored points from body.js; base: calibrated posture (optional)
  pose(pts, base = null) {
    this.reset3D();
    const ok = (i) => pts[i].v > 0.4;
    const ang = (a, b) => Math.atan2(pts[b].y - pts[a].y, pts[b].x - pts[a].x);
    const set = (name, target) => {
      const cur = this.a[name] ?? 0;
      this.a[name] = cur + wrap(target - cur) * 0.5;
      this.b[name].rotation.z = -this.a[name];       // screen-clockwise → negative Z rotation
    };
    const { sh, hip, torso } = keyPoints(pts);
    const tilt = Math.max(-0.5, Math.min(0.5, Math.atan2(sh.y - hip.y, sh.x - hip.x) + Math.PI / 2));
    this.tilt += (tilt - this.tilt) * 0.5;
    this.b.spine.rotation.z = -this.tilt;
    if (base) {
      const dy = (base.hipY - hip.y) / torso;
      this.hop += (dy * 0.45 * this.height - this.hop) * 0.5;
      this.b.hips.position.y = this.hipY0 + this.hop;
    }
    const limbs = [
      ['upperL', 'foreL', L.lShoulder, L.lElbow, L.lWrist, this.tilt],
      ['upperR', 'foreR', L.rShoulder, L.rElbow, L.rWrist, this.tilt],
      ['thighL', 'shinL', L.lHip, L.lKnee, L.lAnkle, 0],
      ['thighR', 'shinR', L.rHip, L.rKnee, L.rAnkle, 0],
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
  }

  // Whole-body copy from the 3D skeleton (body.world): the hips turn and lean,
  // the shoulders twist on the spine, and every limb points where the person's does.
  // pts (2D) are used for visibility and the jump height; base is optional.
  pose3D(world, pts, base = null, k = 0.5) {
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
    const aim = (name, from, to, fallback) => { // point a bone from joint `from` to joint `to`
      const bone = this.b[name];
      if (!(ok(from) && ok(to))) { bone.quaternion.slerp(fallback || new THREE.Quaternion(), k * 0.3); return; }
      _d.copy(P(to)).sub(P(from)).normalize().applyQuaternion(_rq);
      bone.parent.getWorldQuaternion(_pq);
      _d.applyQuaternion(_pq.invert());
      _q.setFromUnitVectors(REST[name], _d);
      bone.quaternion.slerp(_q, k);
    };
    const hipL = P(L.lHip), hipR = P(L.rHip), shL = P(L.lShoulder), shR = P(L.rShoulder);
    const up = shL.clone().add(shR).sub(hipL).sub(hipR).multiplyScalar(0.5);
    turn(this.b.hips, frame(hipL, hipR, up));          // facing and leaning of the whole body
    turn(this.b.spine, frame(shL, shR, up));           // shoulder twist on top of it
    aim('upperL', L.lShoulder, L.lElbow); aim('foreL', L.lElbow, L.lWrist);
    aim('upperR', L.rShoulder, L.rElbow); aim('foreR', L.rElbow, L.rWrist);
    aim('thighL', L.lHip, L.lKnee); aim('shinL', L.lKnee, L.lAnkle);
    aim('thighR', L.rHip, L.rKnee); aim('shinR', L.rKnee, L.rAnkle);
    if (base) {
      const { hip, torso } = keyPoints(pts);
      const dy = (base.hipY - hip.y) / torso;
      this.hop += (dy * 0.45 * this.height - this.hop) * 0.5;
      this.b.hips.position.y = this.hipY0 + this.hop;
    }
    this.used3D = true;
  }

  // clear what pose3D set, before going back to the 2D (rotation.z) way of posing
  reset3D() {
    if (!this.used3D) return;
    for (const b of Object.values(this.b)) b.quaternion.identity();
    this.a = {}; this.used3D = false;
  }

  idle(t) {
    this.reset3D();
    const w = Math.sin(t * 2) * 0.2;
    const ease = (name, target) => { const cur = this.a[name] ?? 0; this.a[name] = cur + (target - cur) * 0.08; this.b[name].rotation.z = -this.a[name]; };
    ease('upperL', -1.0 + w); ease('upperR', 1.0 - w); ease('foreL', -0.2); ease('foreR', 0.2);
    ['thighL', 'thighR', 'shinL', 'shinR'].forEach((k) => ease(k, 0));
    this.tilt *= 0.9; this.b.spine.rotation.z = -this.tilt;
    this.hop *= 0.9; this.b.hips.position.y = this.hipY0 + this.hop;
  }
}

// 3D puppet: a character model whose arms and legs are separate named parts.
// Each limb is put on a pivot at its shoulder/hip and rotated to copy the
// tracked person, like the 2D puppet but in 3D.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L, keyPoints } from './body.js';

// Which model parts belong to which limb, found by their names.
const GROUPS = {
  armL: /^left.*(arm|paw|claw|hand|finger)/i,
  armR: /^right.*(arm|paw|claw|hand|finger)/i,
  legL: /^left.*(leg|foot|toe)/i,
  legR: /^right.*(leg|foot|toe)/i,
};
// Landmarks driving each limb. The view is a mirror, so the player's own left
// arm (11 → 15) moves the arm on the left of the screen.
const LIMBS = {
  armL: { from: L.lShoulder, mid: L.lElbow, to: L.lWrist, rest: Math.PI },
  armR: { from: L.rShoulder, mid: L.rElbow, to: L.rWrist, rest: 0 },
  legL: { from: L.lHip, mid: L.lKnee, to: L.lAnkle, rest: Math.PI / 2 },
  legR: { from: L.rHip, mid: L.rKnee, to: L.rAnkle, rest: Math.PI / 2 },
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export async function loadPuppet3D(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    o.castShadow = true;
    o.receiveShadow = true;
  });
  // Models from trimesh/Blender exports are often Z-up; stand it up (Y-up).
  const box0 = new THREE.Box3().setFromObject(model);
  const size0 = box0.getSize(new THREE.Vector3());
  const zUp = size0.z > size0.y;
  const inner = new THREE.Group();       // holds the model in its own coordinates
  inner.add(model);
  if (zUp) inner.rotation.x = -Math.PI / 2;
  inner.updateMatrixWorld(true);

  // Build a pivot per limb at the joint, and move that limb's meshes onto it.
  const pivots = {};
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const [name, re] of Object.entries(GROUPS)) {
    const parts = meshes.filter((m) => re.test(m.name || m.parent?.name || ''));
    if (!parts.length) continue;
    const box = new THREE.Box3();
    parts.forEach((m) => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3());
    // joint: the inner end of an arm, the top of a leg (in the stood-up frame)
    const joint = name.startsWith('arm')
      ? new THREE.Vector3(name === 'armL' ? box.max.x : box.min.x, c.y, c.z)
      : new THREE.Vector3(c.x, box.max.y - (box.max.y - box.min.y) * 0.12, c.z);
    const pivot = new THREE.Group();
    pivot.position.copy(joint);
    pivots[name] = pivot;
    parts.forEach((m) => pivot.attach(m));
  }
  // Put everything under one upright root, feet on the ground, centred.
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.attach(inner);
  Object.values(pivots).forEach((p) => body.attach(p));
  const box = new THREE.Box3().setFromObject(body);
  const center = box.getCenter(new THREE.Vector3());
  body.children.forEach((ch) => { ch.position.x -= center.x; ch.position.z -= center.z; ch.position.y -= box.min.y; });
  const height = box.max.y - box.min.y;
  return new Puppet3D(root, body, pivots, height);
}

export class Puppet3D {
  constructor(root, body, pivots, height) {
    this.root = root;           // place this in the scene
    this.body = body;           // leans with the torso
    this.pivots = pivots;
    this.height = height;
    this.rot = { armL: 0, armR: 0, legL: 0, legR: 0 };
    this.tilt = 0;
    this.hop = 0;
  }

  // pts: smoothed, mirrored points from body.js. base: calibrated posture (optional).
  pose(pts, base = null) {
    const ok = (i) => pts[i].v > 0.4;
    const { sh, hip, torso } = keyPoints(pts);
    // lean: screen-clockwise tilt of the torso
    const tilt = Math.atan2(sh.y - hip.y, sh.x - hip.x) + Math.PI / 2;
    this.tilt += (Math.max(-0.5, Math.min(0.5, tilt)) - this.tilt) * 0.5;
    this.body.rotation.z = -this.tilt;
    // jump / squat: move the whole character up or down
    if (base) {
      const dy = (base.hipY - hip.y) / torso;         // + when the hips rise
      this.hop += (dy * 0.45 * this.height - this.hop) * 0.5;
      this.body.position.y = this.hop;
    }
    for (const [name, lm] of Object.entries(LIMBS)) {
      const pv = this.pivots[name];
      if (!pv) continue;
      let target = 0;
      const end = ok(lm.to) ? lm.to : ok(lm.mid) ? lm.mid : null;
      if (ok(lm.from) && end !== null) {
        const A = pts[lm.from], B = pts[end];
        target = wrap(Math.atan2(B.y - A.y, B.x - A.x) - lm.rest - this.tilt);
      }
      if (name.startsWith('leg')) target = Math.max(-1.1, Math.min(1.1, target));
      this.rot[name] += wrap(target - this.rot[name]) * 0.5;
      // screen-clockwise = rotation about the viewing axis (−Z towards the viewer)
      pv.rotation.z = -this.rot[name];
    }
  }

  // gentle idle animation when nobody is in view
  idle(t) {
    const w = Math.sin(t * 2) * 0.25;
    if (this.pivots.armL) this.pivots.armL.rotation.z += (-(-0.9 + w) - this.pivots.armL.rotation.z) * 0.1;
    if (this.pivots.armR) this.pivots.armR.rotation.z += (-(0.9 - w) - this.pivots.armR.rotation.z) * 0.1;
    if (this.pivots.legL) this.pivots.legL.rotation.z *= 0.9;
    if (this.pivots.legR) this.pivots.legR.rotation.z *= 0.9;
    this.body.rotation.z *= 0.9;
    this.body.position.y *= 0.9;
    Object.keys(this.rot).forEach((k) => { this.rot[k] = -(this.pivots[k]?.rotation.z || 0); });
  }
}

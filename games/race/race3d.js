// The race's 3D layer: a transparent Three.js canvas over the Phaser canvas.
// Phaser still draws the ground, sky and text; this layer draws the 3D world on
// top of it — the runners, trees, rocks, logs and branches — through a camera
// that matches the 2.5D ground exactly (same horizon, same perspective), so
// everything sits on the grass where the 2D version would have put it.
//
// World units: metres along the track, "animal heights" across and up
// (the runner is 1 unit tall and stands at z = 0; things ahead are at z < 0).
import * as THREE from 'three';
import { LITE } from '../../js/mode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadRiggedCharacter, PHYSICS_FOR } from '../../js/autorig.js';
import { L } from '../../js/body.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

import { MODELS } from '../../js/models.js';
export { MODELS };
const PROPS_FILE = new URL('./props.glb', import.meta.url).href;   // this game's own forest set

// How big each prop really is, measured in animal heights (an animal = 1),
// the same way the 2D version sized things by the runner: [min, max] height.
// Tripo made every piece about the same size, so this puts them back to scale.
export const SIZES = {
  grass: [0.22, 0.38], flowers: [0.2, 0.34], pebbles: [0.1, 0.16],
  flowerbush: [0.5, 0.8], bush2: [0.6, 0.9], bush: [0.9, 1.3],
  rock: [0.3, 0.55], rock2: [0.7, 1.1], boulder: [1.2, 2.0],
  stump: [0.45, 0.7], fallen: [0.9, 1.3], rockpile: [1.5, 2.3],
};
// rocks are round underneath: sink them a little so they sit in the grass instead of on a point
const SINK = { boulder: 0.15, rock2: 0.2, rock: 0.1, rockpile: 0.06, pebbles: 0.2, stump: 0.04, fallen: 0.04 };
const sizeOf = (key, t) => SIZES[key][0] + t * (SIZES[key][1] - SIZES[key][0]);
const charCache = {};
let propsPromise = null;

// Small deterministic random generator (same scenery in every pane)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Load the prop collection once: each named node becomes a reusable template.
async function loadProps() {
  const gltf = await new GLTFLoader().loadAsync(PROPS_FILE);
  gltf.scene.updateMatrixWorld(true);
  const T = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);              // bake quantization / node transform
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3());
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    T[o.name] = { geo, mat: o.material, size };
  });
  return T;
}

// soft round shadow texture for blob shadows under props
function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(20,45,20,0.55)'); grd.addColorStop(1, 'rgba(20,45,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Race3D {
  // cfg: { DH, TOP_Y, HORIZON_Y, GROUND_Y, CAM_Z, VIEW, TREE_SCALE }
  constructor(phaserGame, cfg) {
    this.game = phaserGame;
    this.cfg = cfg;
    this.canvasEl = phaserGame.canvas;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !LITE });
    this.renderer.setPixelRatio(LITE ? 1 : Math.min(2, window.devicePixelRatio));   // phones: fewer pixels to draw
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    const el = this.renderer.domElement;
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0' });
    this.canvasEl.parentElement.appendChild(el);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fb7a0, cfg.CAM_Z + cfg.VIEW * 0.55, cfg.CAM_Z + cfg.VIEW + 5);
    this.scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x4f8a3c, 1.7));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(-3, 8, 6);
    this.scene.add(sun);
    this.runners = [];               // panes that have a 3D character
    this.panes = [];                 // every runner's pane (set by setRunners)
    this.pools = new Map();          // template name -> { list, used }
    this.blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
    this.blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.propsReady = false;
    propsPromise = propsPromise || loadProps();
    propsPromise.then((T) => { this.T = T; this.propsReady = true; }).catch((e) => console.warn('3D props', e));
  }

  // all the race's runners (one pane each)
  setRunners(runners) { this.panes = runners.map((r) => ({ r, ch: null })); }

  // obstacles come from RaceScene; scenery beside the track is generated here
  setWorld(course, seed, courseLength) {
    this.course = course;
    const r = rng(seed ^ 0x3d3d);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    this.scenery = [];
    // Both sides are lined with a wall of nature, in rows going back from the track:
    //   edge:   grass, flowers, pebbles and small rocks right beside the path
    //   middle: bushes, boulders, stumps, fallen logs and rock piles
    //   trees:  three rows of oaks, pines and bare trees, the far ones fading into the haze
    const T = this.cfg.TREE_SCALE;
    const ROWS = [
      { keys: ['grass', 'grass', 'flowers', 'flowers', 'pebbles', 'rock', 'flowerbush'], gap: [0.7, 1.5], off: [0.0, 0.45], shadow: false },
      { keys: ['bush', 'bush', 'bush2', 'flowerbush', 'boulder', 'rock2', 'rock2', 'stump', 'fallen', 'rockpile'], gap: [1.3, 2.6], off: [0.5, 1.6], shadow: true },
      { keys: ['oak', 'oak', 'pine', 'pine', 'bare'], gap: [2.0, 3.2], off: [1.6, 3.4], tree: 1, shadow: true },
      { keys: ['oak', 'pine', 'pine', 'oak', 'bare'], gap: [2.2, 3.6], off: [4.2, 6.8], tree: 1, shadow: false },
      { keys: ['pine', 'oak', 'pine'], gap: [2.6, 4.2], off: [7.5, 11], tree: 1, shadow: false },
    ];
    if (LITE) {          // phones: no far tree row, sparser plants, fewer shadows
      ROWS.pop();
      ROWS[0].gap = [1.4, 2.6];
      ROWS.forEach((r) => { r.shadow = false; });
    }
    for (const side of [-1, 1]) {
      for (const row of ROWS) {
        for (let d = -10 + r() * 2; d < courseLength + this.cfg.VIEW; d += row.gap[0] + r() * (row.gap[1] - row.gap[0])) {
          const key = pick(row.keys);
          const h = row.tree ? T * (0.8 + r() * 0.45) : sizeOf(key, r());
          this.scenery.push({ d, side, key, h, off: row.off[0] + r() * (row.off[1] - row.off[0]), rot: r() * 6.28, shadow: row.shadow });
        }
      }
    }
    this.scenery.sort((p, q) => p.d - q.d);
    // each obstacle gets its own turn and size, so no two look the same
    course.forEach((o) => { o.v = o.v || { rot: r() * 6.28, rot2: r() * 6.28, k: 0.9 + r() * 0.2 }; });
  }

  async addRunner(r) {
    const file = MODELS[r.pl.animal];
    if (!file) return;
    charCache[file] = charCache[file] || loadRiggedCharacter(file);
    const proto = await charCache[file];
    const ch = proto.root.parent ? await loadRiggedCharacter(file) : proto;
    ch.root.rotation.y = Math.PI;      // seen from behind
    ch.phys = PHYSICS_FOR[r.pl.animal];
    this.scene.add(ch.root);
    const pane = this.panes.find((p) => p.r === r);
    if (pane) { pane.ch = ch; pane.phase = Math.random() * 6; }
    this.runners.push(pane);
    r.sprite.setVisible(false);
  }

  // ---- object pools (reused every frame and in every pane)
  use(name) {
    let p = this.pools.get(name);
    if (!p) { p = { list: [], used: 0 }; this.pools.set(name, p); }
    let m = p.list[p.used];
    if (!m) {
      if (name === '_blob') { m = new THREE.Mesh(this.blobGeo, this.blobMat); m.renderOrder = -1; }
      else { const t = this.T[name]; m = new THREE.Mesh(t.geo, t.mat); }
      this.scene.add(m); p.list.push(m);
    }
    p.used++;
    m.visible = true;
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    return m;
  }
  resetPools() { for (const p of this.pools.values()) { p.used = 0; p.list.forEach((m) => { m.visible = false; }); } }

  // a prop standing on the ground at (x, z), h units tall, turned by rot
  // maxW (optional) keeps its footprint no wider than that, so a lane blocker stays in its lane
  prop(name, x, z, h, rot = 0, maxW = 0, shadow = true) {
    const t = this.T[name], m = this.use(name), k = h / t.size.y;
    const kw = maxW ? Math.min(k, maxW / Math.max(t.size.x, t.size.z)) : k;
    m.scale.set(kw, k, kw);
    m.position.set(x, -(SINK[name] || 0) * h, z);
    m.rotation.y = rot;
    if (!shadow) return m;
    const b = this.use('_blob'), w = Math.max(t.size.x, t.size.z) * kw * 1.1;
    b.scale.set(w, 1, w * 0.8);
    b.position.set(x, 0.01, z);
    return m;
  }

  // ---- build the world as one runner sees it
  placeWorld(pane) {
    const { r } = pane, c = r.c, cfg = this.cfg;
    const runW = c.tw / c.runH;                 // track width in animal heights
    const lane = runW / 3;
    // scenery is sorted by distance: jump to the first piece behind the camera, stop past the view
    const sc = this.scenery, from = r.dist - cfg.CAM_Z * 0.8;
    let lo = 0, hi = sc.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sc[mid].d < from) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < sc.length; i++) {
      const s = sc[i], a = s.d - r.dist;
      if (a > cfg.VIEW) break;
      const t = this.T[s.key];
      const halfW = (Math.max(t.size.x, t.size.z) * s.h / t.size.y) / 2;
      this.prop(s.key, s.side * (runW / 2 + s.off + halfW * 0.6), -a, s.h, s.rot, 0, s.shadow);
    }
    for (let i = r.nextObs; i < this.course.length; i++) {
      const o = this.course[i];
      const a = o.d - r.dist;
      if (a > cfg.VIEW) break;
      const z = -a, v = o.v;
      if (o.type === 'rock') {
        const b = [...o.blocked].sort((p, q) => p - q);
        if (o.kind === 'tree') {
          b.forEach((l, j) => this.prop(j % 2 ? 'pine' : 'oak', l * lane, z, cfg.TREE_SCALE * v.k, v.rot + j));
        } else if (b.length === 2 && b[1] - b[0] === 1) {
          this.prop('rockpile', (b[0] + b[1]) / 2 * lane, z, 1.7 * v.k, v.rot, lane * 2.05);
        } else {
          b.forEach((l, j) => this.prop(j % 2 ? 'rock2' : 'boulder', l * lane, z, 1.4 * v.k, v.rot + j * 2, lane * 1.05));
        }
      } else if (o.type === 'log') {
        // a log lying across the whole track, about half an animal high
        const t = this.T.log, m = this.use('log');
        m.scale.set((runW * 0.95) / t.size.x, 0.45 / t.size.y, 0.45 / t.size.z);
        m.position.set(0, 0, z);
        const bl = this.use('_blob'); bl.scale.set(runW, 1, 0.7); bl.position.set(0, 0.01, z);
      } else {
        // a branch across the track between two bare trees: high = duck, low = jump
        const high = o.type === 'branch';
        this.prop('bare', -runW / 2 - 0.2, z, cfg.TREE_SCALE * v.k, v.rot);
        this.prop('bare', runW / 2 + 0.2, z, cfg.TREE_SCALE * v.k, v.rot2);
        const t = this.T.log, m = this.use('log'), th = 0.14;
        m.scale.set((runW + 0.6) / t.size.x, th / t.size.y, th / t.size.z);
        m.position.set(0, high ? 0.75 : 0.18, z);
        // its shadow on the ground: wide and soft when high, tight when low
        const bl = this.use('_blob'); bl.scale.set(runW, 1, high ? 0.6 : 0.3); bl.position.set(0, 0.01, z);
      }
    }
  }

  // ---- draw every pane (call once per frame)
  render(dt) {
    const g = this.game, canvas = this.canvasEl, el = this.renderer.domElement, cfg = this.cfg;
    const cr = canvas.getBoundingClientRect(), pr = canvas.parentElement.getBoundingClientRect();
    const w = cr.width, h = cr.height;
    if (el._w !== w || el._h !== h) { this.renderer.setSize(w, h, false); el._w = w; el._h = h; }
    Object.assign(el.style, { left: `${cr.left - pr.left}px`, top: `${cr.top - pr.top}px`, width: `${w}px`, height: `${h}px` });
    const sx = w / g.scale.width, sy = h / g.scale.height;
    this.renderer.setScissorTest(true);
    this.renderer.clear();
    for (const pane of this.panes) {
      const { r } = pane, c = r.c, rect = c.rect;
      // A camera that reproduces the 2.5D projection exactly: focal length f in pixels,
      // standing CAM_Z behind the runner at the height that puts the horizon at HORIZON_Y.
      const f = c.runH * cfg.CAM_Z;
      if (!pane.cam) pane.cam = new THREE.PerspectiveCamera();
      const n = 0.1, far = cfg.CAM_Z + cfg.VIEW + 10;
      pane.cam.position.set(0, (cfg.GROUND_Y - cfg.HORIZON_Y) / c.runH, cfg.CAM_Z);
      pane.cam.projectionMatrix.makePerspective(
        n * (c.x - c.cx) / f, n * (c.x + c.w - c.cx) / f,
        n * cfg.HORIZON_Y / f, n * (cfg.HORIZON_Y - cfg.DH) / f, n, far);
      pane.cam.projectionMatrixInverse.copy(pane.cam.projectionMatrix).invert();
      pane.cam.updateMatrixWorld();

      this.resetPools();
      if (this.propsReady && this.course) this.placeWorld(pane);
      for (const o of this.runners) o.ch.root.visible = o === pane;   // only this pane's character
      if (pane.ch) this.placeRunner(pane, dt);

      // draw below the sky band only
      const top = rect.y + rect.h * (cfg.TOP_Y / cfg.DH);
      const vx = rect.x * sx, vw = rect.w * sx, vy = h - (rect.y + rect.h) * sy;
      this.renderer.setViewport(vx, vy, vw, rect.h * sy);
      this.renderer.setScissor(vx, vy, vw, (rect.y + rect.h - top) * sy);
      this.renderer.render(this.scene, pane.cam);
    }
    this.renderer.setScissorTest(false);
  }

  placeRunner(pane, dt) {
    const st = pane.r.anim || {}, c = pane.r.c;
    pane.ch.root.position.set(((st.x ?? c.cx) - c.cx) / c.runH, 0, 0);
    pane.ch.root.scale.setScalar(1 / pane.ch.height);
    this.animate(pane, dt, st);
    pane.ch.root.updateMatrixWorld(true);
    pane.ch.physics();                 // belly wobble, tail swing, body bob
  }

  // running cycle driven by the runner's speed, plus jump / duck / stumble
  animate(e, dt, st) {
    const { ch } = e, b = ch.b;
    const speed = st.speed || 0;
    e.phase += dt * (2 + speed * 0.9);
    const run = Math.min(1, speed / 10);
    const sw = Math.sin(e.phase) * 0.9 * run;
    b.thighL.rotation.set(sw, 0, 0); b.thighR.rotation.set(-sw, 0, 0);
    b.shinL.rotation.set(-Math.max(0, -sw) * 1.2, 0, 0); b.shinR.rotation.set(-Math.max(0, sw) * 1.2, 0, 0);
    if (st.pts) {
      this.copyArms(e, st.pts);
    } else {
      b.upperL.rotation.set(-sw * 0.8, 0, 1.25); b.upperR.rotation.set(sw * 0.8, 0, -1.25);
      b.foreL.rotation.set(-0.6 * run, 0, 0.1); b.foreR.rotation.set(-0.6 * run, 0, -0.1);
    }
    ch.adjustShoulders();
    const bob = Math.abs(Math.cos(e.phase)) * 0.03 * ch.height * run;
    b.hips.position.y = ch.hipY0 + bob + (st.jump || 0) * 0.35 * ch.height - (st.duck ? 0.12 * ch.height : 0);
    b.spine.rotation.set(st.duck ? 0.6 : 0.08 * run, 0, st.wobble || 0);
    if (st.duck) ch.root.scale.y *= 0.8;
  }

  // The character's arms copy the player's arms (legs keep running).
  // Seen from behind, the player's arm on the left of the mirror view drives the
  // character's arm on the left of the screen (the model's +X side); rotations flip.
  copyArms(e, pts) {
    const b = e.ch.b, ok = (i) => pts[i].v > 0.4;
    const ang = (a, c) => Math.atan2(pts[c].y - pts[a].y, pts[c].x - pts[a].x);
    e.arm = e.arm || { u1: 1.2, f1: 0, u2: 1.2, f2: 0, h1: 0, h2: 0 };
    const clampW = (a) => Math.max(-1.4, Math.min(1.4, a));
    const ease = (k, t) => { e.arm[k] += wrap(t - e.arm[k]) * 0.5; return e.arm[k]; };
    if (ok(L.lShoulder) && ok(L.lElbow)) {
      const u = ang(L.lShoulder, L.lElbow);
      b.upperR.rotation.set(0, 0, ease('u1', wrap(u - Math.PI)));
      if (ok(L.lWrist)) b.foreR.rotation.set(0, 0, ease('f1', wrap(ang(L.lElbow, L.lWrist) - u)));
      if (ok(L.lWrist) && ok(L.lIndex)) b.handR.rotation.set(0, 0, ease('h1', clampW(wrap(ang(L.lWrist, L.lIndex) - ang(L.lElbow, L.lWrist)))));
    }
    if (ok(L.rShoulder) && ok(L.rElbow)) {
      const u = ang(L.rShoulder, L.rElbow);
      b.upperL.rotation.set(0, 0, ease('u2', wrap(u)));
      if (ok(L.rWrist)) b.foreL.rotation.set(0, 0, ease('f2', wrap(ang(L.rElbow, L.rWrist) - u)));
      if (ok(L.rWrist) && ok(L.rIndex)) b.handL.rotation.set(0, 0, ease('h2', clampW(wrap(ang(L.rWrist, L.rIndex) - ang(L.rElbow, L.rWrist)))));
    }
  }

  destroy() {
    this.runners.forEach((e) => this.scene.remove(e.ch.root));
    this.runners = [];
    for (const p of this.pools.values()) p.list.forEach((m) => this.scene.remove(m));
    this.pools.clear();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}

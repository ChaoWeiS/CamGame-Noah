// The ski slope in 3D: snow, trees, boulders, flags, coins, the finish and the ark,
// every skier on skis with poles, and one chase camera per player's pane.
// World: x = metres across the slope (+ = screen right), d = metres downhill.
// In Three.js: X = x, Z = −d, Y = the snow's height (it drops as you go down).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LITE } from '../../js/mode.js';
import { loadRiggedCharacter, PHYSICS_FOR } from '../../js/autorig.js';
import { MODELS } from '../../js/models.js';
import { L } from '../../js/body.js';
import { PLAYER_CSS } from '../../js/core.js';

export const SLOPE = 0.3;                 // metres down for every metre along
const GEAR_FILE = new URL('./gear.glb', import.meta.url).href;
const PROPS_FILE = new URL('../race/props.glb', import.meta.url).href;   // the race's trees and rocks
const ANIMAL_M = 1.2;                     // an animal is 1.2 m tall on the slope
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// gentle bumps in the snow (bigger off the piste)
export function snowY(x, d, half) {
  const off = Math.max(0, Math.abs(x) - half);
  const bump = Math.sin(x * 0.35 + d * 0.11) * Math.cos(d * 0.07 - x * 0.13) * (0.18 + off * 0.06);
  return -SLOPE * d + bump + off * 0.12;
}

// ---- the ski gear: one model with two skis (with boots) and two poles, split into parts
let gearPromise = null;
function loadGear() {
  return (gearPromise = gearPromise || new GLTFLoader().loadAsync(GEAR_FILE).then((gltf) => {
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    const pos = geo.attributes.position, idx = geo.index.array;
    // weld equal positions, then find connected pieces (each ski board, boot part, pole part…)
    const key = new Map(), weld = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (!key.has(k)) key.set(k, key.size);
      weld[i] = key.get(k);
    }
    const par = Array.from({ length: key.size }, (_, i) => i);
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let t = 0; t < idx.length; t += 3) {
      const a = find(weld[idx[t]]);
      par[find(weld[idx[t + 1]])] = a; par[find(weld[idx[t + 2]])] = a;
    }
    const comps = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const r = find(weld[idx[t]]);
      let c = comps.get(r); if (!c) { c = { tris: [], sx: 0, n: 0 }; comps.set(r, c); }
      c.tris.push(idx[t], idx[t + 1], idx[t + 2]);
      for (let j = 0; j < 3; j++) { c.sx += pos.getX(idx[t + j]); c.n++; }
    }
    // poles stand outside the skis (|x| > 0.27); the side is the sign of x
    const groups = { poleL: [], skiL: [], skiR: [], poleR: [] };
    for (const c of comps.values()) {
      const x = c.sx / c.n;
      groups[x < -0.27 ? 'poleL' : x < 0 ? 'skiL' : x < 0.27 ? 'skiR' : 'poleR'].push(...c.tris);
    }
    const part = (tris) => { const g = geo.clone(); g.setIndex(tris); return g; };
    const box = (g) => { g.computeBoundingBox(); return g.boundingBox; };

    // skis stand on their tails in the model: lay them flat, tip forward (+Z, the animal's front),
    // the boot over the origin, the underside at y = 0; length scaled to 1
    const ski = (tris) => {
      const g = part(tris), b = box(g), len = b.max.y - b.min.y;
      g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + len * 0.35), 0);
      g.rotateX(-Math.PI / 2);          // up → backwards, the boot side (+Z) → up
      g.rotateY(Math.PI);               // tip to the front
      const b2 = box(g);
      g.translate(0, -b2.min.y, 0);
      g.scale(1 / len, 1 / len, 1 / len);
      return g;
    };
    // poles: the grip at the origin, the tip straight down at y = −1
    const pole = (tris) => {
      const g = part(tris), b = box(g), p = g.attributes.position;
      let top = new THREE.Vector3(), tc = 0, tip = new THREE.Vector3(0, 1e9, 0);
      for (const i of tris) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        if (v.y > b.max.y - (b.max.y - b.min.y) * 0.18) { top.add(v); tc++; }
        if (v.y < tip.y) tip.copy(v);
      }
      top.multiplyScalar(1 / Math.max(1, tc));
      const dir = tip.clone().sub(top), len = dir.length();
      g.translate(-top.x, -top.y, -top.z);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(dir.normalize(), new THREE.Vector3(0, -1, 0)));
      g.scale(1 / len, 1 / len, 1 / len);
      return g;
    };
    return {
      skiL: ski(groups.skiL), skiR: ski(groups.skiR), poleL: pole(groups.poleL), poleR: pole(groups.poleR),
      mat: src.material,
    };
  }));
}

// each player's gear in their own colour: the texture's hues turned towards the player colour
const tintCache = new Map();
function tintedMaterial(base, slot) {
  if (tintCache.has(slot)) return tintCache.get(slot);
  const mat = base.clone();
  const img = base.map?.image;
  if (img && img.width) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height), px = data.data;
    const target = new THREE.Color(PLAYER_CSS[slot]).getHSL({}).h * 360;
    const a = ((target - 205) * Math.PI) / 180;          // the skis are blue (hue ≈ 205°)
    const cs = Math.cos(a), sn = Math.sin(a);
    // the luminance-keeping hue rotation (the same matrix as CSS hue-rotate)
    const m = [
      0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
      0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
      0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
    ];
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      px[i] = m[0] * r + m[1] * gg + m[2] * b; px[i + 1] = m[3] * r + m[4] * gg + m[5] * b; px[i + 2] = m[6] * r + m[7] * gg + m[8] * b;
    }
    g.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = base.map.flipY; tex.colorSpace = base.map.colorSpace; tex.wrapS = base.map.wrapS; tex.wrapT = base.map.wrapT;
    mat.map = tex;
  }
  tintCache.set(slot, mat);
  return mat;
}

// ---- props (trees, rocks) from the race's set
let propsPromise = null;
function loadProps() {
  return (propsPromise = propsPromise || new GLTFLoader().loadAsync(PROPS_FILE).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const T = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.computeBoundingBox();
      const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3());
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      T[o.name] = { geo, mat: o.material, size };
    });
    return T;
  }));
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Ski3D {
  // course: { length, half, gates, coins, obstacles, trees }
  constructor(phaserGame, course) {
    this.game = phaserGame; this.course = course;
    this.canvasEl = phaserGame.canvas;
    this.renderer = new THREE.WebGLRenderer({ antialias: !LITE });
    this.renderer.setPixelRatio(LITE ? 1 : Math.min(2, window.devicePixelRatio));
    this.renderer.autoClear = false;
    const el = this.renderer.domElement;
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0' });
    this.canvasEl.parentElement.appendChild(el);
    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color(0xa9d8f5);
    S.fog = new THREE.Fog(0xdbeefa, 45, 115);
    S.add(new THREE.HemisphereLight(0xf2f8ff, 0x8fa9c4, 1.9));
    const sun = new THREE.DirectionalLight(0xfff6e6, 2.0);
    sun.position.set(-30, 60, 40);
    S.add(sun);
    this.skiers = [];
    this.panes = [];
    this.ready = false;
    this.buildSnow();
    this.buildFlags();
    this.buildCoins();
    this.buildFinish();
    loadProps().then((T) => { this.T = T; this.buildTrees(); }).catch((e) => console.warn('ski props', e));
  }

  // ---- the snow: a long bumpy strip, with a sparkly texture so you can feel the speed
  buildSnow() {
    const { length, half } = this.course;
    const W = 160, D = length + 160, segW = LITE ? 40 : 64, segD = LITE ? 120 : 200;
    const g = new THREE.PlaneGeometry(W, D, segW, segD);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -(D / 2 - 40));                  // from 40 m behind the start to past the ark
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, snowY(p.getX(i), -p.getZ(i), half));
    g.computeVertexNormals();
    const tex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#f7fbff'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 2.2 + 0.4;
        c.fillStyle = Math.random() < 0.5 ? 'rgba(170,200,230,0.45)' : 'rgba(255,255,255,0.9)';
        c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(W / 6, D / 6);
    this.snow = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(this.snow);
    // the edges of the piste: a row of little orange markers
    const mk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6).translate(0, 0.55, 0),
      new THREE.MeshLambertMaterial({ color: 0xff7a2e }), Math.ceil(length / 12) * 2 + 4);
    let n = 0; const m4 = new THREE.Matrix4();
    for (let d = 0; d < length + 20; d += 12) for (const s of [-1, 1]) {
      const x = s * (half + 0.6);
      mk.setMatrixAt(n++, m4.makeTranslation(x, snowY(x, d, half), -d));
    }
    mk.count = n;
    this.scene.add(mk);
  }

  // ---- slalom flags: two poles with flags; red and blue gates take turns
  buildFlags() {
    const poleG = new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8).translate(0, 1.0, 0);
    const flagG = new THREE.BufferGeometry();
    flagG.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.0, 0, 0, 1.3, 0, 0.75, 1.65, 0], 3));
    flagG.computeVertexNormals();
    const mats = [0xe5443b, 0x2f7fe0].map((c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }));
    const poleM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.gateMeshes = [];
    const { half } = this.course;
    this.course.gates.forEach((gt, i) => {
      const grp = new THREE.Group();
      for (const s of [-1, 1]) {
        const x = gt.x + s * gt.w / 2;
        const pole = new THREE.Mesh(poleG, poleM);
        const flag = new THREE.Mesh(flagG, mats[i % 2]);
        flag.scale.x = s;             // flags point outwards
        const y = snowY(x, gt.d, half);
        pole.position.set(x, y, -gt.d); flag.position.set(x, y, -gt.d);
        grp.add(pole, flag);
      }
      // a soft coloured line in the snow between the poles
      const line = new THREE.Mesh(new THREE.PlaneGeometry(gt.w, 0.25).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0x2f7fe0 : 0xe5443b, transparent: true, opacity: 0.35, depthWrite: false }));
      line.position.set(gt.x, snowY(gt.x, gt.d, half) + 0.05, -gt.d);
      grp.add(line);
      this.scene.add(grp);
      this.gateMeshes.push(grp);
    });
  }

  // ---- coins: gold discs spinning above the snow (each player collects their own)
  buildCoins() {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 28).rotateX(Math.PI / 2);
    const face = canvasTex(128, 128, (c) => {
      c.fillStyle = '#f6c443'; c.fillRect(0, 0, 128, 128);
      c.fillStyle = '#d49a1c'; c.font = 'bold 84px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('★', 64, 68);
    });
    const rim = new THREE.MeshStandardMaterial({ color: 0xf2b630, metalness: 0.5, roughness: 0.35, emissive: 0x5a3a00 });
    const faceM = new THREE.MeshStandardMaterial({ map: face, metalness: 0.3, roughness: 0.4, emissive: 0x3a2600 });
    const { half } = this.course;
    this.coinMeshes = this.course.coins.map((cn) => {
      const m = new THREE.Mesh(g, [rim, faceM, faceM]);
      m.position.set(cn.x, snowY(cn.x, cn.d, half) + 0.95, -cn.d);
      this.scene.add(m);
      return m;
    });
  }

  // ---- the finish arch, and Noah's ark waiting at the bottom
  buildFinish() {
    const { length, half } = this.course, y = snowY(0, length, half);
    const post = new THREE.MeshLambertMaterial({ color: 0x7a4a22 });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 0.4), post);
      m.position.set(s * (half - 1), y + 2.1, -length);
      this.scene.add(m);
    }
    const banner = canvasTex(512, 64, (c, w, h) => {
      for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#222' : '#fff'; c.fillRect(i * 16, j * 16, 16, 16); }
      c.fillStyle = '#ffd94a'; c.fillRect(150, 8, 212, 48);
      c.fillStyle = '#1d3b52'; c.font = 'bold 40px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('FINISH', 256, 34);
    });
    const b = new THREE.Mesh(new THREE.BoxGeometry((half - 1) * 2, 1.0, 0.15), new THREE.MeshLambertMaterial({ map: banner }));
    b.position.set(0, y + 3.8, -length);
    this.scene.add(b);
    // the ark: hull, cabin and roof
    const ark = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), dark = new THREE.MeshLambertMaterial({ color: 0x5a3416 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(22, 4, 8), wood); hull.position.y = 2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(12, 3.5, 6), new THREE.MeshLambertMaterial({ color: 0xa86b36 })); cabin.position.y = 5.7;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 4.6, 2.4, 4, 1).rotateY(Math.PI / 4).scale(1.9, 1, 1), dark); roof.position.y = 8.6;
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.2), dark); door.position.set(0, 5.4, 3.05);
    ark.add(hull, cabin, roof, door);
    ark.position.set(0, snowY(0, length + 30, half), -(length + 30));
    this.scene.add(ark);
  }

  // ---- trees along both sides and the rocks/trees on the piste (instanced, in chunks so
  // the far-away ones are skipped)
  buildTrees() {
    const T = this.T, { half } = this.course, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const items = [...this.course.trees, ...this.course.obstacles];
    const CH = 40, byKey = new Map();
    for (const it of items) {
      const k = `${it.key}#${Math.floor(it.d / CH)}#${it.x < -half ? 'L' : it.x > half ? 'R' : 'C'}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(it);
    }
    // snowy versions of the materials (a little paler)
    const snowy = new Map();
    const matFor = (key) => {
      if (!snowy.has(key)) { const m = T[key].mat.clone(); m.color = (m.color || new THREE.Color(1, 1, 1)).clone().lerp(new THREE.Color(0xffffff), 0.25); snowy.set(key, m); }
      return snowy.get(key);
    };
    for (const [k, list] of byKey) {
      const key = k.split('#')[0], t = T[key];
      if (!t) continue;
      const im = new THREE.InstancedMesh(t.geo, matFor(key), list.length);
      list.forEach((it, i) => {
        const s = it.h / t.size.y;
        q.setFromAxisAngle(up, it.rot);
        sc.set(s, s, s);
        m4.compose(new THREE.Vector3(it.x, snowY(it.x, it.d, half) - (it.sink || 0) * it.h, -it.d), q, sc);
        im.setMatrixAt(i, m4);
      });
      im.computeBoundingSphere();
      this.scene.add(im);
    }
    this.propsReady = true;
  }

  // ---- skiers
  async addSkier(sk) {
    const file = MODELS[sk.pl.animal] || MODELS.bear;
    const [ch, gear] = await Promise.all([loadRiggedCharacter(file), loadGear()]);
    const H = ch.height, j = ch.joints, mat = tintedMaterial(gear.mat, sk.pl.slot);
    ch.phys = PHYSICS_FOR[sk.pl.animal];
    ch.root.rotation.order = 'YXZ';
    // skis under the feet, about as long as the animal is tall
    const skiLen = H * 1.05;
    for (const [s, k] of [[-1, 'skiL'], [1, 'skiR']]) {
      const m = new THREE.Mesh(gear[k], mat);
      m.scale.setScalar(skiLen);
      m.position.set(s * j.legX * 1.05, 0, 0);
      ch.root.add(m);
    }
    // poles in the paws
    sk.poles = [['handL', 'poleL'], ['handR', 'poleR']].map(([bone, k]) => {
      const m = new THREE.Mesh(gear[k], mat);
      m.scale.setScalar(H * 0.62);
      ch.b[bone].add(m);
      return m;
    });
    ch.root.scale.setScalar(ANIMAL_M / H);
    this.scene.add(ch.root);
    sk.ch = ch;
    sk.arm = null;
  }

  // ---- one frame
  render(skiers, panes, time) {
    const g = this.game, canvas = this.canvasEl, el = this.renderer.domElement;
    const cr = canvas.getBoundingClientRect(), pr = canvas.parentElement.getBoundingClientRect();
    const w = cr.width, h = cr.height;
    if (el._w !== w || el._h !== h) { this.renderer.setSize(w, h, false); el._w = w; el._h = h; }
    Object.assign(el.style, { left: `${cr.left - pr.left}px`, top: `${cr.top - pr.top}px`, width: `${w}px`, height: `${h}px` });
    const sx = w / g.scale.width, sy = h / g.scale.height;
    const { half } = this.course;

    for (const sk of skiers) if (sk.ch) this.poseSkier(sk, time);
    this.coinMeshes.forEach((m, i) => { m.rotation.y = time * 2.2 + i; });

    this.renderer.setScissorTest(true);
    this.renderer.clear();
    skiers.forEach((sk, i) => {
      const rect = panes[i].rect;
      // the chase camera: behind and above, looking down the hill (turns half as much as the skier)
      sk.camYaw = sk.camYaw === undefined ? 0 : sk.camYaw + (sk.heading * 0.45 - sk.camYaw) * 0.08;
      const fx = Math.sin(sk.camYaw), fz = Math.cos(sk.camYaw);
      const back = this.camBack ?? 6.5, up = this.camUp ?? 3.4;
      const cx = sk.x - fx * back, cd = sk.d - fz * back;
      const cam = sk.cam || (sk.cam = new THREE.PerspectiveCamera(58, 1, 0.1, 118));
      cam.aspect = rect.w / rect.h; cam.updateProjectionMatrix();
      cam.position.set(cx + (this.camSide || 0), snowY(cx, cd, half) + up, -cd);
      const lx = sk.x + fx * 7, ld = sk.d + fz * 7;
      if (this.camAtSkier) cam.lookAt(sk.x, snowY(sk.x, sk.d, half) + 0.6, -sk.d);
      else cam.lookAt(lx, snowY(lx, ld, half) + 0.2, -ld);
      // this player's coins already collected are gone (only in their own view)
      this.coinMeshes.forEach((m, k) => { m.visible = !sk.coinsGot.has(k); });
      const vx = rect.x * sx, vw = rect.w * sx, vy = h - (rect.y + rect.h) * sy, vh = rect.h * sy;
      this.renderer.setViewport(vx, vy, vw, vh);
      this.renderer.setScissor(vx, vy, vw, vh);
      this.renderer.render(this.scene, cam);
    });
    this.renderer.setScissorTest(false);
  }

  // put the animal on its skis: knees bent, leaning into turns, arms copying the player
  poseSkier(sk, time) {
    const ch = sk.ch, b = ch.b, j = ch.joints, H = ch.height, { half } = this.course;
    const crash = sk.crashK || 0;
    ch.root.position.set(sk.x, snowY(sk.x, sk.d, half), -sk.d);
    // facing down the hill (−Z) turned by the heading; lean into the turn; topple when crashing
    const lean = -sk.turnRate * 0.22 + Math.sin(time * 18) * 0.25 * crash;
    ch.root.rotation.set(-0.12 * crash, Math.PI - sk.heading, lean + crash * 0.9 * (sk.crashSide || 1));
    // a skier's crouch, deeper when going fast
    const tuck = 0.2 + Math.min(0.15, sk.speed / 100);
    const thighLen = j.crotchY + H * 0.06 - j.kneeY, shinLen = j.kneeY;
    const a1 = tuck, a2 = tuck * 0.8;
    for (const s of ['L', 'R']) { b['thigh' + s].rotation.set(-a1, 0, 0); b['shin' + s].rotation.set(a1 + a2, 0, 0); }
    b.hips.position.y = ch.hipY0 - thighLen * (1 - Math.cos(a1)) - shinLen * (1 - Math.cos(a2));
    b.hips.position.z = 0;
    b.spine.rotation.set(0.25 + tuck * 0.3, -sk.twist * 0.5, 0);
    b.chest.rotation.set(0, -sk.twist * 0.35, 0);
    if (sk.pts) this.copyArms(sk, sk.pts);
    else {
      // keyboard players: arms forward and down, pushing on the poles when they pump
      const push = Math.sin(time * 9) * 0.35 * (sk.pump || 0);
      b.upperL.rotation.set(-0.5 - push, 0, 1.05); b.upperR.rotation.set(-0.5 - push, 0, -1.05);
      b.foreL.rotation.set(-0.5, 0, 0.2); b.foreR.rotation.set(-0.5, 0, -0.2);
      b.handL.rotation.set(0, 0, 0); b.handR.rotation.set(0, 0, 0);
    }
    ch.adjustShoulders();
    ch.root.updateMatrixWorld(true);
    // poles: point down and a bit behind, whatever the arms are doing
    const back = new THREE.Vector3(-Math.sin(sk.heading), 0, Math.cos(sk.heading));   // uphill-ish, behind the skier
    const side = new THREE.Vector3(Math.cos(sk.heading), 0, Math.sin(sk.heading));
    const pq = new THREE.Quaternion(), want = new THREE.Quaternion();
    sk.poles.forEach((pole, i) => {
      const dir = new THREE.Vector3(0, -1, 0).addScaledVector(back, 0.45).addScaledVector(side, (i ? 1 : -1) * 0.18).normalize();
      want.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      pole.parent.getWorldQuaternion(pq);
      pole.quaternion.copy(pq.invert().multiply(want));
    });
    ch.root.updateMatrixWorld(true);
    ch.physics();
  }

  // the animal's arms copy the player's (seen from behind, so left and right swap) — as in the race
  copyArms(e, pts) {
    const b = e.ch.b, ok = (i) => pts[i].v > 0.4;
    const ang = (a, c) => Math.atan2(pts[c].y - pts[a].y, pts[c].x - pts[a].x);
    e.arm = e.arm || { u1: 1.2, f1: 0, u2: 1.2, f2: 0 };
    const ease = (k, t) => { e.arm[k] += wrap(t - e.arm[k]) * 0.5; return e.arm[k]; };
    if (ok(L.lShoulder) && ok(L.lElbow)) {
      const u = ang(L.lShoulder, L.lElbow);
      b.upperR.rotation.set(0, 0, ease('u1', wrap(u - Math.PI)));
      if (ok(L.lWrist)) b.foreR.rotation.set(0, 0, ease('f1', wrap(ang(L.lElbow, L.lWrist) - u)));
    }
    if (ok(L.rShoulder) && ok(L.rElbow)) {
      const u = ang(L.rShoulder, L.rElbow);
      b.upperL.rotation.set(0, 0, ease('u2', wrap(u)));
      if (ok(L.rWrist)) b.foreL.rotation.set(0, 0, ease('f2', wrap(ang(L.rElbow, L.rWrist) - u)));
    }
    b.handL.rotation.set(0, 0, 0); b.handR.rotation.set(0, 0, 0);
  }

  destroy() {
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}

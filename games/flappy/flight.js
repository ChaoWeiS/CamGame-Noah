// The flying games (shared engine). Every animal has wings on its arms.
//   flap both arms DOWN together  → climb
//   arms spread out wide          → glide, sinking gently
//   hands down / wings folded     → drop fast
//   (Sky Rings) tilt the spread arms like a plane → turn towards the lower hand
// mode 'ark': Flappy Ark — fly down the inside of the ark through the ventilation gaps.
// mode 'sky': Sky Rings — fly over the flood through rings; arrows point to the next one.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tracker, input, PLAYER_CSS } from '../../js/core.js';
import { W, H, rng, session, charById, setupPanes } from '../../js/scenes/common.js';
import { OverlayText } from '../../js/stage3d.js';
import { LITE } from '../../js/mode.js';
import { finishGame } from '../../js/games.js';
import { loadRiggedCharacter, PHYSICS_FOR } from '../../js/autorig.js';
import { MODELS, ANIMAL_SIZE } from '../../js/models.js';
import { addWings } from '../../js/wings.js';
import { L } from '../../js/body.js';

const ANIMAL_M = 1.2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MODES = {
  ark: { roundMs: 60000, speed: 6, ceiling: 8.6, title: 'Flappy Ark' },
  sky: { roundMs: 75000, speed: 9, ceiling: 42, title: 'Sky Rings' },
};

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
// wooden planks (horizontal boards with seams and a few knots)
const plankTex = (repeat, tone = 0) => canvasTex(256, 256, (c, w, h) => {
  const r = rng(11 + tone);
  for (let y = 0, i = 0; y < h; y += 32, i++) {
    const base = [[132, 84, 44], [122, 76, 38], [140, 90, 48]][(i + tone) % 3];
    c.fillStyle = `rgb(${base.join(',')})`; c.fillRect(0, y, w, 31);
    c.fillStyle = 'rgba(60,34,14,0.6)'; c.fillRect(0, y + 31, w, 1);
    for (let x = (i % 2) * 90; x < w; x += 180) c.fillRect(x, y, 2, 31);
    for (let k = 0; k < 2; k++) { c.fillStyle = 'rgba(70,40,18,0.5)'; c.beginPath(); c.ellipse(r() * w, y + 8 + r() * 16, 6, 3, 0, 0, 7); c.fill(); }
    for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(255,230,190,0.06)'; c.fillRect(0, y + r() * 30, w, 1); }
  }
}, repeat);

// ---------------------------------------------------------------- courses
function arkCourse(seed, roundMs, speed) {
  const r = rng(seed ^ 0xa4c);
  const walls = [];
  const length = (roundMs / 1000) * speed + 40;
  for (let d = 28, i = 0; d < length; d += 15 + r() * 3, i++) {
    const gapH = Math.max(2.5, 3.7 - i * 0.06);      // the gaps get narrower as you go
    const gapY = 0.6 + gapH / 2 + r() * (MODES.ark.ceiling - gapH - 1.4);
    walls.push({ d, gapY, gapH });
  }
  return { walls, half: 4.6 };
}
function skyCourse(seed) {
  const r = rng(seed ^ 0x51c);
  const rings = [];
  let p = new THREE.Vector3(0, 12, -26), yaw = 0;
  for (let i = 0; i < 40; i++) {
    yaw += (r() - 0.5) * 1.1;
    const dist = 24 + r() * 8;
    const next = p.clone().add(new THREE.Vector3(Math.sin(yaw) * dist, 0, -Math.cos(yaw) * dist));
    next.y = clamp(p.y + (r() - 0.5) * 12, 6, 28);
    const n = next.clone().sub(p).normalize();
    rings.push({ pos: next, n, r: 2.6 });
    p = next;
  }
  // the first ring straight ahead
  rings.unshift({ pos: new THREE.Vector3(0, 12, -26), n: new THREE.Vector3(0, 0, -1), r: 2.6 });
  return { rings };
}

// ---------------------------------------------------------------- the 3D world
class FlightWorld {
  constructor(game, mode, course) {
    this.game = game; this.mode = mode; this.course = course;
    this.canvasEl = game.canvas;
    this.renderer = new THREE.WebGLRenderer({ antialias: !LITE });
    this.renderer.setPixelRatio(LITE ? 1 : Math.min(2, window.devicePixelRatio));
    this.renderer.autoClear = false;
    const el = this.renderer.domElement;
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0' });
    this.canvasEl.parentElement.appendChild(el);
    const S = this.scene = new THREE.Scene();
    if (mode === 'ark') this.buildArk(); else this.buildSky();
  }

  buildArk() {
    const S = this.scene, { walls, half } = this.course, C = MODES.ark.ceiling;
    S.background = new THREE.Color(0x2a180b);
    S.fog = new THREE.Fog(0x3a2310, 30, 75);
    S.add(new THREE.HemisphereLight(0xffe2b8, 0x5a3416, 1.6));
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.2); sun.position.set(3, 10, 6); S.add(sun);
    const len = walls[walls.length - 1].d + 60;
    const floorM = new THREE.MeshLambertMaterial({ map: plankTex([2, len / 6], 1) });
    const wallM = new THREE.MeshLambertMaterial({ map: plankTex([len / 8, 2], 0) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, len + 40).rotateX(-Math.PI / 2), floorM);
    floor.position.set(0, 0, -(len / 2 - 20)); S.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, len + 40).rotateX(Math.PI / 2), floorM);
    ceil.position.set(0, C, -(len / 2 - 20)); S.add(ceil);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(len + 40, C).rotateY(-s * Math.PI / 2), wallM);
      w.position.set(s * half, C / 2, -(len / 2 - 20)); S.add(w);
    }
    // beams and lanterns along the hall
    const beamM = new THREE.MeshLambertMaterial({ color: 0x4f2e14 });
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffd77a });
    for (let d = 0; d < len; d += 10) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.35, 0.4), beamM); beam.position.set(0, C - 0.18, -d); S.add(beam);
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, C, 0.4), beamM); post.position.set(s * (half - 0.18), C / 2, -d); S.add(post); }
      if (d % 20 === 0) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampM); lamp.position.set(0, C - 0.7, -d - 5); S.add(lamp); }
    }
    // the partitions: a wooden wall with a ventilation gap (slats across the top and bottom edge)
    const partM = new THREE.MeshLambertMaterial({ map: plankTex([2, 1], 2) });
    const slatM = new THREE.MeshLambertMaterial({ color: 0x5e3618 });
    this.wallMeshes = walls.map((wl) => {
      const g = new THREE.Group();
      const lo = wl.gapY - wl.gapH / 2, hi = wl.gapY + wl.gapH / 2;
      const bot = new THREE.Mesh(new THREE.BoxGeometry(half * 2, lo, 0.5), partM); bot.position.set(0, lo / 2, 0);
      const top = new THREE.Mesh(new THREE.BoxGeometry(half * 2, C - hi, 0.5), partM); top.position.set(0, hi + (C - hi) / 2, 0);
      g.add(bot, top);
      for (const y of [lo, hi]) { const sl = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.14, 0.7), slatM); sl.position.y = y; g.add(sl); }
      // a glow of daylight through the gap, so it's easy to spot
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 0.4, wl.gapH - 0.2), new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.12, depthWrite: false }));
      glow.position.set(0, wl.gapY, -0.3); g.add(glow);
      g.position.z = -wl.d;
      S.add(g);
      return g;
    });
  }

  buildSky() {
    const S = this.scene;
    S.background = canvasTex(4, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5aa7e6'); g.addColorStop(0.6, '#a8d5f5'); g.addColorStop(1, '#e8f4fb');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    S.fog = new THREE.Fog(0xcfe6f6, 80, 260);
    S.add(new THREE.HemisphereLight(0xf2f8ff, 0x5c86a8, 1.9));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.8); sun.position.set(-40, 80, 30); S.add(sun);
    // the flood: a wide sea with little waves
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = '#3f7fb8'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { c.strokeStyle = 'rgba(220,240,255,0.35)'; c.beginPath(); const x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); c.quadraticCurveTo(x + 6, y - 3, x + 12, y); c.stroke(); }
      }, [160, 160]) }));
    S.add(sea);
    // clouds: soft puffs, scattered around the course
    const cloudM = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    const puff = new THREE.SphereGeometry(1, 12, 9);
    const r = rng(77);
    const center = this.course.rings[Math.floor(this.course.rings.length / 2)].pos;
    for (let i = 0; i < (LITE ? 30 : 55); i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) { const m = new THREE.Mesh(puff, cloudM); m.scale.set(3 + r() * 3, 2 + r() * 1.5, 3 + r() * 3); m.position.set((k - n / 2) * 3.2, r() * 1.5, r() * 2); g.add(m); }
      g.position.set(center.x + (r() - 0.5) * 520, 18 + r() * 40, center.z + (r() - 0.5) * 520);
      // keep clouds away from the rings
      if (this.course.rings.some((rg) => rg.pos.distanceTo(g.position) < 14)) continue;
      S.add(g);
    }
    // the ark, floating on the flood
    const ark = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), dark = new THREE.MeshLambertMaterial({ color: 0x5a3416 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(44, 8, 14), wood); hull.position.y = 3;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(24, 6, 10), new THREE.MeshLambertMaterial({ color: 0xa86b36 })); cabin.position.y = 10;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 8, 4, 4, 1).rotateY(Math.PI / 4).scale(1.9, 1, 1), dark); roof.position.y = 15;
    ark.add(hull, cabin, roof);
    // somewhere you can see it, but well away from every ring
    const rings = this.course.rings, mid = rings.reduce((v, rg) => v.add(rg.pos), new THREE.Vector3()).multiplyScalar(1 / rings.length);
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, spot = new THREE.Vector3(mid.x + Math.cos(a) * 110, 0, mid.z + Math.sin(a) * 110);
      if (rings.every((rg) => Math.hypot(rg.pos.x - spot.x, rg.pos.z - spot.z) > 60)) { ark.position.copy(spot); break; }
      ark.position.set(mid.x + 160, 0, mid.z);
    }
    ark.rotation.y = 0.6;
    S.add(ark);
    // the rings
    const torus = new THREE.TorusGeometry(2.6, 0.22, 10, 40);
    this.ringMat = {
      next: new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0x7a4a00, metalness: 0.4, roughness: 0.35 }),
      later: new THREE.MeshStandardMaterial({ color: 0xf6e7b0, emissive: 0x2a2000, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.6 }),
      done: new THREE.MeshStandardMaterial({ color: 0x5ad17a, emissive: 0x0a4a1a, transparent: true, opacity: 0.5 }),
    };
    this.ringMeshes = this.course.rings.map((rg) => {
      const m = new THREE.Mesh(torus, this.ringMat.later);
      m.position.copy(rg.pos);
      m.lookAt(rg.pos.clone().add(rg.n));
      S.add(m);
      return m;
    });
  }

  async addFlyer(f) {
    const file = MODELS[f.pl.animal] || MODELS.bear;
    const ch = await loadRiggedCharacter(file);
    await addWings(ch);
    ch.phys = PHYSICS_FOR[f.pl.animal];
    ch.root.rotation.order = 'YXZ';
    ch.root.scale.setScalar(ANIMAL_M * (ANIMAL_SIZE[f.pl.animal] ?? 1) / ch.height);
    this.scene.add(ch.root);
    f.ch = ch;
  }

  render(flyers, panes, t) {
    const g = this.game, canvas = this.canvasEl, el = this.renderer.domElement;
    const cr = canvas.getBoundingClientRect(), pr = canvas.parentElement.getBoundingClientRect();
    const w = cr.width, h = cr.height;
    if (el._w !== w || el._h !== h) { this.renderer.setSize(w, h, false); el._w = w; el._h = h; }
    Object.assign(el.style, { left: `${cr.left - pr.left}px`, top: `${cr.top - pr.top}px`, width: `${w}px`, height: `${h}px` });
    const sx = w / g.scale.width, sy = h / g.scale.height;
    for (const f of flyers) if (f.ch) this.pose(f, t);
    this.renderer.setScissorTest(true);
    this.renderer.clear();
    flyers.forEach((f, i) => {
      const rect = panes[i].rect;
      f.camYaw = f.camYaw === undefined ? f.heading : f.camYaw + wrap(f.heading - f.camYaw) * 0.06;
      const fx = Math.sin(f.camYaw), fz = Math.cos(f.camYaw);
      const back = this.mode === 'ark' ? 4.6 : 6.5, up = this.mode === 'ark' ? 1.3 : 2.0;
      const cam = f.cam || (f.cam = new THREE.PerspectiveCamera(62, 1, 0.1, this.mode === 'ark' ? 90 : 300));
      cam.aspect = rect.w / rect.h; cam.updateProjectionMatrix();
      f.camY = f.camY === undefined ? f.y : f.camY + (f.y - f.camY) * 0.12;
      cam.position.set(f.x - fx * back, clamp(f.camY + up, 0.6, this.mode === 'ark' ? MODES.ark.ceiling - 0.4 : 80), -(f.d - fz * back));
      cam.lookAt(f.x + fx * 6, f.camY + 0.5, -(f.d + fz * 6));
      cam.updateMatrixWorld();
      if (this.ringMeshes) this.ringMeshes.forEach((m, k) => { m.material = k < f.ring ? this.ringMat.done : k === f.ring ? this.ringMat.next : this.ringMat.later; m.visible = k >= f.ring - 1 && k <= f.ring + 4; });
      const vx = rect.x * sx, vw = rect.w * sx, vy = h - (rect.y + rect.h) * sy, vh = rect.h * sy;
      this.renderer.setViewport(vx, vy, vw, vh);
      this.renderer.setScissor(vx, vy, vw, vh);
      this.renderer.render(this.scene, cam);
    });
    this.renderer.setScissorTest(false);
  }

  // the animal flying: leaning forward, legs trailing, banking into turns, arms (and wings) copying the player
  pose(f, t) {
    const ch = f.ch, b = ch.b;
    ch.root.position.set(f.x, f.y, -f.d);
    const pitch = 0.45 - clamp(f.vy * 0.05, -0.3, 0.3) + (f.stun ? Math.sin(t * 20) * 0.3 : 0);
    ch.root.rotation.set(pitch, Math.PI - f.heading, -f.turnRate * 0.35);
    for (const s of ['L', 'R']) { b['thigh' + s].rotation.set(0.55, 0, 0); b['shin' + s].rotation.set(0.35, 0, 0); }
    b.spine.rotation.set(0, 0, 0); b.chest.rotation.set(0, 0, 0);
    b.head.rotation.set(-0.45, 0, 0);                  // look ahead, not at the floor
    ch.unfixArms();
    if (f.pts) this.copyArms(f, f.pts);
    else {
      // keyboard players: flap after a flap, wings out when gliding, folded when dropping
      const since = (performance.now() - (f.flapAt || -1e9)) / 1000;
      const a = since < 0.35 ? Math.sin(since / 0.35 * Math.PI * 2) * 0.8 : f.fold > 0.5 ? -1.2 : 0.05;
      b.upperR.rotation.set(0, 0, a); b.upperL.rotation.set(0, 0, -a);
      b.foreR.rotation.set(0, 0, 0); b.foreL.rotation.set(0, 0, 0);
    }
    ch.adjustShoulders();
    ch.fixArms();
    ch.root.updateMatrixWorld(true);
    ch.physics();
  }
  copyArms(e, pts) {
    const b = e.ch.b, ok = (i) => pts[i].v > 0.4;
    const ang = (a, c) => Math.atan2(pts[c].y - pts[a].y, pts[c].x - pts[a].x);
    e.arm = e.arm || { u1: 1.2, f1: 0, u2: 1.2, f2: 0 };
    const ease = (k, tt) => { e.arm[k] += wrap(tt - e.arm[k]) * 0.6; return e.arm[k]; };
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
    this.renderer.dispose(); this.renderer.forceContextLoss?.();
  }
}

// ---------------------------------------------------------------- a player's corner of the screen
class PaneHud {
  constructor(game, rect, pl, mode) {
    this.game = game; this.rect = rect;
    const el = this.el = document.createElement('div');
    el.className = 'skihud';
    el.innerHTML = `<div class="tag" style="color:${PLAYER_CSS[pl.slot]}">P${pl.slot + 1} · ${charById(pl.animal).name}</div>
      <div class="pts"></div><div class="msg"></div><div class="lost"></div>${mode === 'sky' ? '<div class="arrow">➤</div>' : ''}`;
    game.canvas.parentElement.appendChild(el);
    this.pts = el.querySelector('.pts'); this.msgEl = el.querySelector('.msg'); this.lostEl = el.querySelector('.lost'); this.arrow = el.querySelector('.arrow');
    this.msgUntil = 0;
  }
  place() {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const k = cr.height / this.game.scale.height, r = this.rect;
    Object.assign(this.el.style, { left: `${cr.left - pr.left + r.x * k}px`, top: `${cr.top - pr.top + r.y * k}px`,
      width: `${r.w * k}px`, height: `${r.h * k}px`, fontSize: `${Math.max(12, Math.min(r.h, r.w * 0.6) * k * 0.045)}px` });
  }
  msg(t, ms = 900) { this.msgEl.textContent = t; this.msgUntil = performance.now() + ms; this.msgEl.classList.remove('pop'); void this.msgEl.offsetWidth; this.msgEl.classList.add('pop'); }
  update(text) { this.place(); this.pts.textContent = text; if (performance.now() > this.msgUntil) this.msgEl.textContent = ''; }
  destroy() { this.el.remove(); }
}

// ---------------------------------------------------------------- the scene
export class FlightScene extends Phaser.Scene {
  constructor(key, mode) { super(key); this.mode = mode; }

  create() {
    const M = this.M = MODES[this.mode];
    session.seed = (Math.random() * 1e9) | 0;
    this.course = this.mode === 'ark' ? arkCourse(session.seed, M.roundMs, M.speed) : skyCourse(session.seed);
    const players = tracker.players, n = players.length;
    this.cols = setupPanes(this, n, 720).panes;
    this.add.rectangle(-30000, 0, 10, 10, 0x000000);
    this.world = new FlightWorld(this.game, this.mode, this.course);
    this.flyers = players.map((pl, i) => {
      const lane = this.mode === 'ark' ? (i - (n - 1) / 2) * 1.6 : (i - (n - 1) / 2) * 2.2;
      const f = { pl, x: lane, lane, y: this.mode === 'ark' ? 3 : 12, d: 0, vy: 0, heading: 0, turnRate: 0, points: 0, next: 0, ring: 0,
        lastFlaps: null, stunUntil: 0, fold: 0, hud: new PaneHud(this.game, this.cols[i].rect, pl, this.mode) };
      this.world.addFlyer(f).catch((e) => console.warn('flyer', e));
      return f;
    });
    this.timer = new OverlayText(this.game, W / 2, n >= 3 ? H / 2 : H - 40, 44);
    this.banner = new OverlayText(this.game, W / 2, H / 2 - 40, 110);
    this.help = new OverlayText(this.game, W / 2, H / 2 + 80, 30);
    this.help.setText(this.mode === 'ark'
      ? '🪽 Flap your arms DOWN to fly up\n👐 Arms out wide: glide gently  ·  👇 arms down: drop fast\n🪟 Fly through the gaps in the ark walls!'
      : '🪽 Flap your arms DOWN to fly up  ·  👐 arms out: glide\n✈️ Tilt your arms like a plane to turn\n💍 Fly through the rings — follow the arrow!');
    this.events.once('shutdown', () => {
      this.world.destroy(); this.timer.destroy(); this.banner.destroy(); this.help.destroy();
      this.flyers.forEach((f) => f.hud.destroy());
    });
    this.state = 'countdown';
    this.t0 = performance.now();
    this.steps = [
      [0, () => this.banner.setText('READY??')],
      [2600, () => {
        for (const f of this.flyers) if (f.pl.kind === 'camera' && f.pl.body && input(f.pl).present) f.pl.body.calibrateFromCurrent();
        this.banner.setText('3!');
      }],
      [3600, () => this.banner.setText('2!')],
      [4600, () => this.banner.setText('1!')],
      [5600, () => { this.banner.setText('FLY!!!'); this.help.setText(''); this.state = 'play'; this.startAt = performance.now(); }],
      [6600, () => { if (this.banner.text === 'FLY!!!') this.banner.setText(''); }],
    ];
  }

  update(time, delta) {
    const now = performance.now(), dt = Math.min(delta, 60) / 1000;
    while (this.steps.length && now - this.t0 >= this.steps[0][0]) this.steps.shift()[1]();
    const playing = this.state === 'play';
    const left = playing ? Math.max(0, this.M.roundMs - (now - this.startAt)) : this.M.roundMs;
    this.timer.setText(`⏱ ${Math.ceil(left / 1000)}`);
    for (const f of this.flyers) this.move(f, dt, now, playing);
    this.world.render(this.flyers, this.cols, now / 1000);
    for (const f of this.flyers) {
      f.hud.update(this.mode === 'ark' ? `🪟 ${f.points}` : `💍 ${f.points}`);
      if (this.mode === 'sky') this.pointArrow(f);
    }
    if (playing && left <= 0) this.end();
  }

  move(f, dt, now, playing) {
    const inp = input(f.pl), cam = f.pl.kind === 'camera';
    f.pts = cam && inp.present ? f.pl.body.vpts : null;
    f.hud.lostEl.textContent = inp.present ? '' : 'Come back into view!';
    // flaps since last frame
    const fc = inp.flapCount || 0;
    if (f.lastFlaps === null) f.lastFlaps = fc;
    let flaps = Math.min(2, fc - f.lastFlaps);
    f.lastFlaps = fc;
    if (!playing) { f.vy = 0; return; }
    f.stun = now < f.stunUntil;
    if (f.stun) flaps = 0;
    const glide = inp.present ? inp.glide : 0.5, fold = inp.present ? inp.fold : 0;
    f.fold = fold;
    if (flaps > 0) { f.vy = Math.min(6.5, Math.max(f.vy, -1) + 4.4 * flaps); f.flapAt = now; }
    // falling: gentle when gliding, fast when the wings are folded
    const g = 8 - 5.8 * glide + 9 * fold, tv = -5.5 + 3.8 * glide - 5 * fold;
    f.vy = Math.max(tv, f.vy - g * dt);
    f.y += f.vy * dt;
    // turning (sky): like the skis — tilt the outstretched arms; drift back when level
    if (this.mode === 'sky') {
      const steer = inp.present ? inp.steer : 0;
      f.turnRate += (steer * 1.25 - f.turnRate) * Math.min(1, dt * 5);
      f.heading = wrap(f.heading + f.turnRate * dt);
    }
    const speed = this.M.speed * (f.stun ? 0.3 : 1);
    f.x += Math.sin(f.heading) * speed * dt;
    f.d += Math.cos(f.heading) * speed * dt;
    if (this.mode === 'ark') this.arkRules(f, now); else this.skyRules(f, now);
  }

  arkRules(f, now) {
    const C = MODES.ark.ceiling, hgt = ANIMAL_M * (ANIMAL_SIZE[f.pl.animal] ?? 1) * 0.85;
    if (f.y < 0) { f.y = 0; f.vy = Math.max(0, f.vy); }
    if (f.y + hgt > C) { f.y = C - hgt; f.vy = Math.min(0, f.vy); }
    f.x += (f.lane - f.x) * 0.1;
    const walls = this.course.walls;
    while (f.next < walls.length && f.d >= walls[f.next].d) {
      const wl = walls[f.next];
      const lo = wl.gapY - wl.gapH / 2, hi = wl.gapY + wl.gapH / 2;
      if (f.y >= lo - 0.1 && f.y + hgt <= hi + 0.15) {
        f.next++; f.points++; f.hud.msg(['Whoosh! +1', 'Nice flying! +1', 'Through! +1'][f.points % 3]);
      } else {
        // bonk: bounced back off the wall, a moment to recover, then try again
        f.d = wl.d - 2.2; f.vy = 0; f.stunUntil = now + 900;
        f.hud.msg('Bonk! 💥', 1000);
        break;
      }
    }
  }

  skyRules(f, now) {
    const C = MODES.sky.ceiling;
    if (f.y < 0.4) { f.y = 0.4; f.vy = 5; f.hud.msg('Splash! 🌊', 800); }
    if (f.y > C) { f.y = C; f.vy = Math.min(0, f.vy); }
    const rings = this.course.rings;
    if (f.ring >= rings.length) return;
    const rg = rings[f.ring];
    const c = new THREE.Vector3(f.x, f.y + 0.5, -f.d);
    const side = c.clone().sub(rg.pos).dot(rg.n);
    if (f.lastSide !== undefined && f.lastSide < 0 && side >= 0) {
      // crossed the ring's plane: through the ring, or beside it
      const off = c.clone().sub(rg.pos); off.addScaledVector(rg.n, -off.dot(rg.n));
      if (off.length() < rg.r + 0.3) { f.points++; f.hud.msg(['Ring! +1 💍', 'Perfect! +1', 'Swoosh! +1'][f.points % 3]); }
      else f.hud.msg('Missed that one', 800);
      f.ring++; f.lastSide = undefined;
      return;
    }
    f.lastSide = side;
    // flew far past it: on to the next one
    if (c.distanceTo(rg.pos) > 80) { f.ring++; f.lastSide = undefined; f.hud.msg('Missed that one', 800); }
  }

  // an arrow at the edge of the pane, pointing to the next ring when it's out of view
  pointArrow(f) {
    const a = f.hud.arrow;
    if (!a || !f.cam || f.ring >= this.course.rings.length) { if (a) a.style.display = 'none'; return; }
    const p = this.course.rings[f.ring].pos.clone().project(f.cam);
    const behind = p.z > 1;
    let x = p.x, y = p.y;
    if (behind) { x = -x; y = -y; }
    const inView = !behind && Math.abs(x) < 0.85 && Math.abs(y) < 0.8;
    if (inView) { a.style.display = 'none'; return; }
    const ang = Math.atan2(-y, x);                     // screen angle (y down)
    const k = 0.82 / Math.max(Math.abs(Math.cos(ang)) * 1.0, Math.abs(Math.sin(ang)) * 1.0);
    const ex = 50 + Math.cos(ang) * k * 50 * 0.9, ey = 50 + Math.sin(ang) * k * 50 * 0.85;
    Object.assign(a.style, { display: 'block', left: `${clamp(ex, 6, 94)}%`, top: `${clamp(ey, 10, 92)}%`, transform: `translate(-50%, -50%) rotate(${ang}rad)` });
  }

  end() {
    this.state = 'done';
    this.banner.setText(this.mode === 'ark' ? 'Out of the ark! 🌈' : 'What a flight! 🌈');
    const unit = this.mode === 'ark' ? ['gap', 'gaps', '🪟'] : ['ring', 'rings', '💍'];
    finishGame(this, this.flyers.map((f) => ({
      slot: f.pl.slot, score: f.points, label: `${unit[2]} ${f.points} ${f.points === 1 ? unit[0] : unit[1]}`,
    })), 2500);
  }
}

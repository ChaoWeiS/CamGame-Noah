// 3D runners on top of the 2.5D race: a transparent Three.js layer over the
// Phaser canvas draws each player's 3D character (seen from behind) exactly
// where the 2D sprite would be, with a running animation, jumps and ducks.
import * as THREE from 'three';
import { loadRiggedCharacter } from './autorig.js';
import { L } from './body.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// characters that have a 3D model (others keep their 2D sprite)
export const MODELS = {
  bear: 'assets/models/bear_tripo.glb',
  hamster: 'assets/models/hamster.glb',
  chicken: 'assets/models/chicken.glb',
};
const cache = {};                      // file -> Promise<RiggedCharacter>, loaded once
const DH = 720;                        // design height of a pane (matches RaceScene)

export class Race3D {
  constructor(phaserGame) {
    this.game = phaserGame;
    this.canvasEl = phaserGame.canvas;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    const el = this.renderer.domElement;
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0' });
    this.canvasEl.parentElement.appendChild(el);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x4f8a3c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(0.3, 1, 1.2);     // from above, behind the camera
    this.scene.add(sun);
    this.runners = [];                 // { char, slot }
    this.cams = [];
  }

  // panes: RaceScene columns ({x, w, cam, rect}); runners: RaceScene runner objects
  async addRunner(r) {
    const file = MODELS[r.pl.animal];
    if (!file) return;
    cache[file] = cache[file] || loadRiggedCharacter(file);
    const proto = await cache[file];
    // each runner needs its own copy (same model can be picked twice)
    const ch = proto.root.parent ? await loadRiggedCharacter(file) : proto;
    ch.root.rotation.y = Math.PI;      // seen from behind
    this.scene.add(ch.root);
    const entry = { r, ch, phase: Math.random() * 6 };
    this.runners.push(entry);
    r.sprite.setVisible(false);        // the 3D character replaces the 2D one
  }

  // called every frame after Phaser has drawn
  render(dt, jumpK, duck) {
    const g = this.game, canvas = this.canvasEl, el = this.renderer.domElement;
    // keep the overlay exactly on top of the Phaser canvas
    const cr = canvas.getBoundingClientRect(), pr = canvas.parentElement.getBoundingClientRect();
    const w = cr.width, h = cr.height;
    if (el._w !== w || el._h !== h) { this.renderer.setSize(w, h, false); el._w = w; el._h = h; }
    Object.assign(el.style, { left: `${cr.left - pr.left}px`, top: `${cr.top - pr.top}px`, width: `${w}px`, height: `${h}px` });
    const sx = w / g.scale.width, sy = h / g.scale.height;
    this.renderer.setScissorTest(true);
    this.renderer.clear();
    for (const e of this.runners) {
      const { r, ch } = e, c = r.c, rect = c.rect;
      // an orthographic camera matching the pane's design coordinates (y down → negate)
      if (!e.cam) {
        e.cam = new THREE.OrthographicCamera(c.x, c.x + c.w, 0, -DH, -5000, 5000);
        e.cam.position.z = 1000;
      }
      // place the character where the 2D sprite would stand
      const st = r.anim || {};
      const k = ch.height ? r.c.runH / ch.height : 1;
      ch.root.scale.setScalar(k);
      ch.root.position.set(st.x ?? c.cx, -(st.y ?? 640), 0);
      // a slight top-down tilt so it reads as seen from a camera above and behind
      ch.root.rotation.x = 0.18;
      this.animate(e, dt, st);
      const vx = rect.x * sx, vy = h - (rect.y + rect.h) * sy, vw = rect.w * sx, vh = rect.h * sy;
      this.renderer.setViewport(vx, vy, vw, vh);
      this.renderer.setScissor(vx, vy, vw, vh);
      // hide everyone else's character while drawing this pane
      this.runners.forEach((o) => { o.ch.root.visible = o === e; });
      this.renderer.render(this.scene, e.cam);
    }
    this.renderer.setScissorTest(false);
  }

  // running cycle driven by the runner's speed, plus jump / duck / stumble
  animate(e, dt, st) {
    const { ch } = e, b = ch.b;
    const speed = st.speed || 0;
    e.phase += dt * (2 + speed * 0.9);
    const run = Math.min(1, speed / 10);
    const sw = Math.sin(e.phase) * 0.9 * run;
    // legs swing forward/back (about X), knees bend on the back swing
    b.thighL.rotation.set(sw, 0, 0); b.thighR.rotation.set(-sw, 0, 0);
    b.shinL.rotation.set(-Math.max(0, -sw) * 1.2, 0, 0); b.shinR.rotation.set(-Math.max(0, sw) * 1.2, 0, 0);
    if (st.pts) {
      this.copyArms(e, st.pts);
    } else {
      // arms down by the sides, swinging opposite to the legs
      b.upperL.rotation.set(-sw * 0.8, 0, 1.25); b.upperR.rotation.set(sw * 0.8, 0, -1.25);
      b.foreL.rotation.set(-0.6 * run, 0, 0.1); b.foreR.rotation.set(-0.6 * run, 0, -0.1);
    }
    // body: bob, jump, duck, stumble wobble
    const bob = Math.abs(Math.cos(e.phase)) * 0.03 * ch.height * run;
    b.hips.position.y = ch.hipY0 + bob + (st.jump || 0) * 0.35 * ch.height - (st.duck ? 0.12 * ch.height : 0);
    b.spine.rotation.set(st.duck ? 0.6 : 0.08 * run, 0, st.wobble || 0);
    ch.root.scale.y *= st.duck ? 0.8 : 1;
  }

  // The character's arms copy the player's arms (legs keep running).
  // We see the character from behind, so the player's arm on the left of the
  // mirror view drives the character's arm on the left of the screen (its own
  // left, which is the model's +X side), and rotations flip sign.
  copyArms(e, pts) {
    const b = e.ch.b, ok = (i) => pts[i].v > 0.4;
    const ang = (a, c) => Math.atan2(pts[c].y - pts[a].y, pts[c].x - pts[a].x);
    e.arm = e.arm || { u1: 1.2, f1: 0, u2: 1.2, f2: 0 };
    const ease = (k, t) => { e.arm[k] += wrap(t - e.arm[k]) * 0.5; return e.arm[k]; };
    // screen-left arm: player's landmarks 11→13→15, rest pointing left (π) → bone upperR
    if (ok(L.lShoulder) && ok(L.lElbow)) {
      const u = ang(L.lShoulder, L.lElbow);
      b.upperR.rotation.set(0, 0, ease('u1', wrap(u - Math.PI)));
      if (ok(L.lWrist)) b.foreR.rotation.set(0, 0, ease('f1', wrap(ang(L.lElbow, L.lWrist) - u)));
    }
    // screen-right arm: landmarks 12→14→16, rest pointing right (0) → bone upperL
    if (ok(L.rShoulder) && ok(L.rElbow)) {
      const u = ang(L.rShoulder, L.rElbow);
      b.upperL.rotation.set(0, 0, ease('u2', wrap(u)));
      if (ok(L.rWrist)) b.foreL.rotation.set(0, 0, ease('f2', wrap(ang(L.rElbow, L.rWrist) - u)));
    }
  }

  destroy() {
    this.runners.forEach((e) => this.scene.remove(e.ch.root));
    this.runners = [];
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}

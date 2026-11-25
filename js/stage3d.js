// A 3D overlay for the lobby and the character picker: the players' 3D animals,
// facing the screen, copying each player's whole body like a mirror.
// It is a transparent Three.js canvas over the Phaser canvas, with an orthographic
// camera in Phaser's screen pixels, so an actor is placed by where its feet go
// and how tall it is, in the same coordinates the scenes already use.
import * as THREE from 'three';
import { LITE } from './mode.js';
import { loadRiggedCharacter, EXAGGERATE_FOR, PHYSICS_FOR } from './autorig.js';
import { MODELS, ANIMAL_SIZE } from './models.js';

// one character instance per (animal, slot), kept between scenes so they load once
const cache = new Map();
function getChar(id, slot) {
  const key = `${id}#${slot}`;
  if (!cache.has(key)) cache.set(key, loadRiggedCharacter(MODELS[id]).then((ch) => { ch.ex = EXAGGERATE_FOR[id]; ch.phys = PHYSICS_FOR[id]; return ch; }).catch((e) => { console.warn('3D character failed', id, e); return null; }));
  return cache.get(key);
}
// start loading the cast in the background (call from the lobby)
export function preloadCast(ids, slots = 1) {
  for (let s = 0; s < slots; s++) ids.forEach((id) => MODELS[id] && getChar(id, s));
}

// F8: draw the bones over the animals (to check what the rig is doing)
export const view = { bones: false };
window.addEventListener('keydown', (e) => { if (e.key === 'F8') { view.bones = !view.bones; e.preventDefault(); } });

function bonesHelper(ch) {
  const h = new THREE.SkeletonHelper(ch.root);
  h.material.depthTest = false; h.material.transparent = true; h.renderOrder = 10;
  h.material.color = new THREE.Color(0xffffff); h.material.vertexColors = false;
  return h;
}

export class Stage3D {
  constructor(phaserGame) {
    this.game = phaserGame;
    this.canvasEl = phaserGame.canvas;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(LITE ? 1 : Math.min(2, window.devicePixelRatio));   // phones: fewer pixels to draw
    this.renderer.setClearColor(0x000000, 0);
    const el = this.renderer.domElement;
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0' });
    this.canvasEl.parentElement.appendChild(el);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x4f6a3c, 1.8));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(-300, 500, 800);
    this.scene.add(sun);
    // screen pixels: x right, y down (world y = -screen y)
    this.cam = new THREE.OrthographicCamera(0, 1, 0, -1, -5000, 5000);
    this.actors = new Map();
    this.alive = true;
  }

  // the 3D character for an actor slot; returns null until it has loaded
  actor(slot, id) {
    let a = this.actors.get(slot);
    if (!a) { a = { id: null, ch: null, want: null }; this.actors.set(slot, a); }
    if (a.want !== id) {
      a.want = id;
      if (a.ch) { this.scene.remove(a.ch.root); a.ch = null; }
      if (a.helper) { this.scene.remove(a.helper); a.helper = null; }
      if (MODELS[id]) {
        getChar(id, slot).then((ch) => {
          if (!this.alive || a.want !== id || !ch) return;
          if (ch.root.parent) ch.root.parent.remove(ch.root);
          ch.root.rotation.set(0, 0, 0);
          a.ch = ch; a.id = id;
          this.scene.add(ch.root);
        });
      }
    }
    return a.ch;
  }

  // put an actor's feet at screen (x, footY), heightPx tall; copy the body if pts given
  // (the whole body in 3D when the phone sent a 3D skeleton, else the limbs in 2D)
  place(slot, id, x, footY, heightPx, pts = null, base = null, t = 0, world = null) {
    const ch = this.actor(slot, id);
    if (!ch) return false;
    ch.root.visible = true;
    const a = this.actors.get(slot);
    if (view.bones && !a.helper) { a.helper = bonesHelper(ch); this.scene.add(a.helper); }
    if (a.helper) a.helper.visible = view.bones;
    ch.root.position.set(x, -footY, 0);
    ch.root.scale.setScalar(heightPx * (ANIMAL_SIZE[id] ?? 1) / ch.height);   // the animals to scale: the bear is the biggest
    ch.unfixArms();
    if (pts && world) ch.pose3D(world, pts, base);
    else if (pts) ch.pose(pts, base); else ch.idle(t);
    ch.fixArms();                      // arms rest on the body instead of going through it
    ch.root.updateMatrixWorld(true);
    ch.physics();                      // belly wobble, tail swing, body bob
    return true;
  }

  hide(slot) { const a = this.actors.get(slot); if (a?.ch) a.ch.root.visible = false; if (a?.helper) a.helper.visible = false; }
  hideAll() { for (const a of this.actors.values()) { if (a.ch) a.ch.root.visible = false; if (a.helper) a.helper.visible = false; } }

  render() {
    const g = this.game, el = this.renderer.domElement;
    const cr = this.canvasEl.getBoundingClientRect(), pr = this.canvasEl.parentElement.getBoundingClientRect();
    if (el._w !== cr.width || el._h !== cr.height) { this.renderer.setSize(cr.width, cr.height, false); el._w = cr.width; el._h = cr.height; }
    Object.assign(el.style, { left: `${cr.left - pr.left}px`, top: `${cr.top - pr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
    const W = g.scale.width, H = g.scale.height;
    if (this.cam.right !== W || this.cam.bottom !== -H) {
      Object.assign(this.cam, { left: 0, right: W, top: 0, bottom: -H });
      this.cam.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.cam);
  }

  destroy() {
    this.alive = false;
    for (const a of this.actors.values()) { if (a.ch) this.scene.remove(a.ch.root); if (a.helper) this.scene.remove(a.helper); }
    this.actors.clear();
    this.renderer.domElement.remove();
    this.renderer.dispose(); this.renderer.forceContextLoss?.();   // give the WebGL context back now (browsers allow only a few)
  }
}

// Text that sits above the 3D layer (Phaser text is drawn underneath it).
// Positioned in game pixels like Phaser text, centred on (x, y); same setText/.text API.
export class OverlayText {
  constructor(phaserGame, x, y, size = 64, color = '#fff8e6') {
    this.game = phaserGame; this.x = x; this.y = y; this.size = size; this.text = '';
    const el = this.el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 20,
      color, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontWeight: '700', textAlign: 'center',
      whiteSpace: 'pre', lineHeight: '1.1', textShadow: '0 0 6px #000, 0 3px 0 #000, 0 -3px 0 #000, 3px 0 0 #000, -3px 0 0 #000',
    });
    phaserGame.canvas.parentElement.appendChild(el);
    this.place();
  }
  place() {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const k = cr.height / this.game.scale.height;
    Object.assign(this.el.style, {
      left: `${cr.left - pr.left + this.x * k}px`, top: `${cr.top - pr.top + this.y * k}px`, fontSize: `${this.size * k}px`,
    });
  }
  setText(t) { this.text = t; this.el.textContent = t; this.place(); return this; }
  destroy() { this.el.remove(); }
}

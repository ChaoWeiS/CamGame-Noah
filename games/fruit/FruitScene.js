// Fruit Feast — every animal is hungry for one fruit (shown in its thought bubble).
// Fruit rains down: catch the right one with a paw and bring it to your mouth.
// Fruit bounces off the animals, a caught fruit slips out of the paw if you don't eat
// it in time, and the rain gets heavier as the minute goes by.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tracker, input, PLAYER_CSS } from '../../js/core.js';
import { W, H, rng, session, charById } from '../../js/scenes/common.js';
import { Stage3D, OverlayText } from '../../js/stage3d.js';
import { finishGame } from '../../js/games.js';
import { ANIMAL_SIZE } from '../../js/models.js';

const ROUND_MS = 60000;
const HOLD_MS = 2500;
const FLOOR_MS = 5000;         // fruit on the floor can be picked up for this long, then fades          // a caught fruit slips out of the paw after this long
const FRUIT_FILE = new URL('./fruits.glb', import.meta.url).href;
const ICON = (k) => new URL(`./icons/${k}.png`, import.meta.url).href;
// the fruits in the game: easy to tell apart (no lime-vs-lemon puzzles)
const POOL = ['apple', 'banana', 'orange', 'grapes', 'watermelon', 'strawberry', 'blueberry', 'pineapple',
  'coconut', 'kiwi', 'pear', 'cherry', 'dragonfruit', 'durian', 'starfruit', 'avocado'];
const NAME = { apple: 'apple', banana: 'banana', orange: 'orange', grapes: 'grapes', watermelon: 'watermelon', strawberry: 'strawberry',
  blueberry: 'blueberries', pineapple: 'pineapple', coconut: 'coconut', kiwi: 'kiwi', pear: 'pear', cherry: 'cherries',
  dragonfruit: 'dragon fruit', durian: 'durian', starfruit: 'star fruit', avocado: 'avocado' };
const CRUMB = { apple: 0xe0473a, banana: 0xf4d34a, orange: 0xf39a2b, grapes: 0x7a3fb5, watermelon: 0xe94b5a, strawberry: 0xe0303a,
  blueberry: 0x3f5fc4, pineapple: 0xf2c94a, coconut: 0xf5f0e6, kiwi: 0x8cc63f, pear: 0xb7d45a, cherry: 0xc8202f,
  dragonfruit: 0xe5397c, durian: 0xe8d27a, starfruit: 0xf3d03e, avocado: 0x9cc44b };
const SIZE = { watermelon: 1.3, pineapple: 1.2, durian: 1.15, coconut: 1.1, blueberry: 0.85, cherry: 0.9, kiwi: 0.95 };

let fruitPromise = null;
function loadFruits() {
  return (fruitPromise = fruitPromise || new GLTFLoader().loadAsync(FRUIT_FILE).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const T = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.name || o.parent?.name;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);                    // bake the quantization scale
      geo.computeBoundingBox();
      const b = geo.boundingBox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
      const k = 1 / Math.max(s.x, s.y, s.z);
      geo.scale(k, k, k);                                // 1 unit across
      if (!geo.attributes.normal) geo.computeVertexNormals();
      T[name] = { geo, mat: o.material };
    });
    return T;
  }));
}

// the thought bubble over an animal's head (drawn above everything, so no fruit hides it)
class Bubble {
  constructor(game, color) {
    this.game = game;
    const el = this.el = document.createElement('div');
    el.className = 'thought';
    el.style.setProperty('--c', color);
    el.innerHTML = '<img alt=""><i class="d1"></i><i class="d2"></i>';
    this.img = el.querySelector('img');
    game.canvas.parentElement.appendChild(el);
    this.kind = null;
  }
  set(kind) { if (kind !== this.kind) { this.kind = kind; this.img.src = ICON(kind); this.el.classList.remove('pop'); void this.el.offsetWidth; this.el.classList.add('pop'); } }
  place(x, y, size) {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const k = cr.height / this.game.scale.height;
    Object.assign(this.el.style, { left: `${cr.left - pr.left + x * k}px`, top: `${cr.top - pr.top + y * k}px`, width: `${size * k}px`, height: `${size * k}px` });
  }
  destroy() { this.el.remove(); }
}

export class FruitScene extends Phaser.Scene {
  static KEY = 'Fruit';
  constructor() { super('Fruit'); }

  create() {
    session.seed = (Math.random() * 1e9) | 0;
    this.r = rng(session.seed ^ 0xf7);
    this.drawBackground();
    this.stage = new Stage3D(this.game);
    this.ready = false;
    loadFruits().then((T) => { this.T = T; this.ready = true; }).catch((e) => console.warn('fruits', e));
    this.meshes = new Map();           // fruit → mesh
    this.fruits = [];
    this.popups = [];

    // players stand in columns, left to right in the order they stand in the room
    const players = [...tracker.players];
    const xOf = (pl) => (pl.kind === 'camera' && pl.body?.pts ? (pl.body.pts[11].x + pl.body.pts[12].x) / 2 : pl.slot);
    players.sort((a, b) => xOf(a) - xOf(b));
    // the side columns keep away from the screen edges so raised arms stay in view;
    // with a full house the animals are a little smaller and slide less, so arms don't cross much
    const n = players.length, margin = n >= 3 ? W * 0.05 : 0, colW = (W - 2 * margin) / n;
    this.hpx = Math.min(H * 0.46, colW * (n >= 4 ? 0.85 : 1.0));    // animal height in pixels: lots of sky above them, to see fruit coming
    this.slide = n >= 4 ? 0.18 : 0.3;
    this.p = players.map((pl, i) => ({
      pl, colX: margin + colW * (i + 0.5), colW, x: margin + colW * (i + 0.5), score: 0, thought: null,
      hands: [{ bone: 'handL', fruit: null, freeAt: 0, pos: { x: 0, y: 0 } }, { bone: 'handR', fruit: null, freeAt: 0, pos: { x: 0, y: 0 } }],
      bubble: new Bubble(this.game, PLAYER_CSS[pl.slot]),
      chip: this.makeChip(pl), msg: new OverlayText(this.game, margin + colW * (i + 0.5), H * 0.2, 40),
      lost: new OverlayText(this.game, margin + colW * (i + 0.5), H * 0.5, 30, '#ffd2c8'),
    }));
    this.p.forEach((pp) => this.newThought(pp));
    this.timer = new OverlayText(this.game, W / 2, 44, 52);
    this.banner = new OverlayText(this.game, W / 2, H / 2 - 40, 110);
    this.help = new OverlayText(this.game, W / 2, H / 2 + 70, 30);
    this.help.setText('💭 Your animal is hungry for the fruit in its bubble\n🙌 Catch it with your hands  ·  😋 bring it to your mouth\nThe wrong fruit? Yuck! Drop it and catch another\n⬇️ Missed one? Squat down and pick it up off the floor');
    this.events.once('shutdown', () => {
      this.stage.destroy(); this.timer.destroy(); this.banner.destroy(); this.help.destroy();
      this.p.forEach((pp) => { pp.bubble.destroy(); pp.chip.remove(); pp.msg.destroy(); pp.lost.destroy(); });
      this.popups.forEach((o) => o.destroy());
    });
    this.state = 'countdown';
    this.t0 = performance.now();
    this.steps = [
      [0, () => this.banner.setText('READY??')],
      [2600, () => {
        for (const pp of this.p) if (pp.pl.kind === 'camera' && pp.pl.body && input(pp.pl).present) pp.pl.body.calibrateFromCurrent();
        this.banner.setText('3!');
      }],
      [3600, () => this.banner.setText('2!')],
      [4600, () => this.banner.setText('1!')],
      [5600, () => { this.banner.setText('GO!!!'); this.help.setText(''); this.state = 'play'; this.startAt = performance.now(); this.nextDrop = 0; }],
      [6400, () => { if (this.banner.text === 'GO!!!') this.banner.setText(''); }],
    ];
    this.enterKey = this.input.keyboard.addKey('SPACE');
  }

  makeChip(pl) {
    const el = document.createElement('div');
    el.className = 'fruitchip';
    el.style.setProperty('--c', PLAYER_CSS[pl.slot]);
    document.getElementById('wrap').appendChild(el);
    return el;
  }

  // inside the ark: plank walls, beams, round windows with the rain outside, a wooden floor
  drawBackground() {
    const g = this.add.graphics(), floorTop = H * 0.8;
    g.fillGradientStyle(0x7a4a24, 0x7a4a24, 0x5e3618, 0x5e3618, 1).fillRect(0, 0, W, floorTop);
    // wall planks with a few knots
    const r = rng(7);
    for (let y = 0, i = 0; y < floorTop; y += 46, i++) {
      g.fillStyle(i % 2 ? 0x84522a : 0x7b4a25, 1).fillRect(0, y, W, 44);
      g.fillStyle(0x4a2a12, 0.55).fillRect(0, y + 44, W, 2);
      for (let x = (i % 2) * 130; x < W; x += 260) g.fillStyle(0x4a2a12, 0.45).fillRect(x, y, 3, 44);
      for (let k = 0; k < 3; k++) g.fillStyle(0x5a3416, 0.5).fillEllipse(r() * W, y + 10 + r() * 24, 14, 7);
    }
    // round windows: grey sky and rain outside
    for (const wx of [W * 0.2, W * 0.5, W * 0.8]) {
      const wy = H * 0.2, rr = H * 0.07;
      g.fillStyle(0x3b2410, 1).fillCircle(wx, wy, rr + 12);
      g.fillStyle(0x8a95a3, 1).fillCircle(wx, wy, rr);
      g.lineStyle(2, 0xcfe3f5, 0.7);
      for (let k = -3; k <= 3; k++) { const x0 = wx + k * rr * 0.28; g.lineBetween(x0, wy - rr * 0.7, x0 - 6, wy + rr * 0.7); }
      g.lineStyle(6, 0x3b2410, 1).lineBetween(wx - rr, wy, wx + rr, wy).lineBetween(wx, wy - rr, wx, wy + rr);
    }
    // big beams
    g.fillStyle(0x4f2e14, 1);
    for (const bx of [W * 0.05, W * 0.35, W * 0.65, W * 0.95]) g.fillRect(bx - 16, 0, 32, floorTop);
    g.fillRect(0, H * 0.36, W, 26);
    g.fillStyle(0x6b4020, 1).fillRect(0, H * 0.36, W, 6);
    // hay in the corners and a lantern
    g.fillStyle(0xd9b44a, 1).fillEllipse(W * 0.03, floorTop, W * 0.16, H * 0.16).fillEllipse(W * 0.97, floorTop, W * 0.16, H * 0.14);
    g.lineStyle(2, 0x3b2410, 1).lineBetween(W * 0.35, H * 0.38, W * 0.35, H * 0.46);
    g.fillStyle(0xffd77a, 1).fillCircle(W * 0.35, H * 0.49, 14);
    g.fillStyle(0xffe9a8, 0.18).fillCircle(W * 0.35, H * 0.49, 60);
    // the floor
    g.fillStyle(0x6b4020, 1).fillRect(0, floorTop, W, H - floorTop);
    for (let y = floorTop + 10; y < H; y += 22) g.fillStyle(0x4a2a12, 0.5).fillRect(0, y, W, 2);
    g.fillStyle(0x3b2410, 1).fillRect(0, floorTop - 4, W, 8);
    this.floorY = H - 24;
  }

  newThought(pp) {
    let k;
    do { k = POOL[Math.floor(this.r() * POOL.length)]; } while (k === pp.thought);
    pp.thought = k;
    pp.bubble.set(k);
  }

  say(pp, t, color = '#fff8e6') {
    pp.msg.el.style.color = color;
    pp.msg.setText(t);
    pp.msgUntil = performance.now() + 900;
  }

  update(time, delta) {
    const now = performance.now(), dt = Math.min(delta, 60) / 1000;
    while (this.steps.length && now - this.t0 >= this.steps[0][0]) this.steps.shift()[1]();
    const playing = this.state === 'play';
    const left = playing ? Math.max(0, ROUND_MS - (now - this.startAt)) : ROUND_MS;
    this.timer.setText(`⏱ ${Math.ceil(left / 1000)}`);
    const k = playing ? 1 - left / ROUND_MS : 0;          // 0 → 1 over the minute

    // the animals
    for (const pp of this.p) this.placeAnimal(pp, time, now);

    // the rain of fruit: more and faster as time goes
    if (playing && this.ready && now > (this.nextDrop || 0)) {
      this.drop(k);
      this.nextDrop = now + (1900 - 1000 * k) * (0.7 + this.r() * 0.6) / Math.max(1, this.p.length * 0.55);
    }
    this.physics(dt, now, k);
    this.drawFruits(time);
    this.moveCrumbs(dt);
    this.stage.render();

    for (const pp of this.p) {
      if (pp.msgUntil && now > pp.msgUntil) { pp.msg.setText(''); pp.msgUntil = 0; }
      pp.chip.innerHTML = `P${pp.pl.slot + 1} · ${charById(pp.pl.animal).name} <b>🍎 ${pp.score}</b>`;
    }
    this.layoutChips();
    if (playing && left <= 0) this.end();
  }

  layoutChips() {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), wr = document.getElementById('wrap').getBoundingClientRect();
    const kk = cr.height / H;
    this.p.forEach((pp) => Object.assign(pp.chip.style, {
      left: `${cr.left - wr.left + pp.colX * kk}px`, top: `${cr.top - wr.top + (H - 6) * kk}px`, fontSize: `${22 * kk}px`,
    }));
  }

  // where the player stands (their column, shifted as they step or lean) and their animal copying them
  placeAnimal(pp, time, now) {
    const pl = pp.pl, inp = input(pl), cam = pl.kind === 'camera';
    const side = Math.max(-1.2, Math.min(1.2, inp.side ?? 0));
    const target = pp.colX + side * pp.colW * this.slide;
    pp.x += (target - pp.x) * 0.25;
    pp.lost.setText(inp.present ? '' : 'Come back into view!');
    // take last frame's chomp nod off the head before it is posed again
    const prev = this.stage.actors.get(pl.slot)?.ch;
    if (prev && pp.chompApplied) { prev.b.head.rotation.x -= pp.chompApplied; pp.chompApplied = 0; }
    const shown = this.stage.place(pl.slot, pl.animal || 'bear', pp.x, this.floorY, this.hpx,
      cam && inp.present ? pl.body.vpts : null, cam && inp.present ? pl.body.base : null, time / 1000, cam && inp.present ? pl.body.world : null);
    const a = this.stage.actors.get(pl.slot), ch = a?.ch;
    pp.ch = shown ? ch : null;
    if (!pp.ch) return;
    // chomp chomp: quick nods with a little squash, for ~0.7 s after eating
    const ct = (now - (pp.chompAt || -1e9)) / 700;
    if (ct < 1) {
      const c = Math.sin(ct * Math.PI * 6) * (1 - ct);
      pp.chompApplied = c * 0.35;
      ch.b.head.rotation.x += pp.chompApplied;
      ch.b.head.scale.set(1 + c * 0.06, 1 - c * 0.08, 1 + c * 0.06);
    } else ch.b.head.scale.set(1, 1, 1);
    const j = ch.joints, Hm = ch.height, v = new THREE.Vector3();
    const toScreen = (bone, x, y, z) => { v.set(x, y, z); bone.localToWorld(v); return { x: v.x, y: -v.y }; };
    const headLen = Hm - j.neckY;
    pp.mouth = toScreen(ch.b.head, 0, headLen * 0.3, (j.frontZ || 0) * 0.6);
    pp.headC = toScreen(ch.b.head, 0, headLen * 0.5, 0);
    pp.top = toScreen(ch.b.head, 0, headLen * 1.0, 0);
    pp.headR = Math.hypot(pp.top.x - pp.headC.x, pp.top.y - pp.headC.y) * 1.05;   // about half the head's height
    pp.chest = toScreen(ch.b.chest, 0, 0, 0);
    pp.hips = toScreen(ch.b.hips, 0, 0, 0);
    // the paw: a bit past the wrist bone, along the forearm
    for (const h of pp.hands) {
      const hb = ch.b[h.bone], w = toScreen(hb, 0, 0, 0), e = toScreen(hb.parent, 0, 0, 0);
      h.pos = { x: w.x + (w.x - e.x) * 0.35, y: w.y + (w.y - e.y) * 0.35 };
    }
    // the bubble: above and beside the head, on the side with more room
    const bs = this.hpx * 0.36;
    const dir = pp.x < W / 2 ? 1 : -1;
    pp.bubble.place(pp.top.x + dir * bs * 0.55, pp.top.y - bs * 0.62, bs);
    pp.bubble.el.classList.toggle('flip', dir < 0);
    // keyboard players: Space eats what's in their paws
    if (!cam && this.enterKey.isDown) for (const h of pp.hands) if (h.fruit) { h.fruit.x = pp.mouth.x; h.fruit.y = pp.mouth.y; }
  }

  drop(k) {
    // often one of the fruits someone is thinking of, so there's always something to catch
    const wanted = this.p.filter((pp) => pp.thought).map((pp) => pp.thought);
    const kind = wanted.length && this.r() < 0.45 ? wanted[Math.floor(this.r() * wanted.length)] : POOL[Math.floor(this.r() * POOL.length)];
    const r = Math.max(26, this.hpx * 0.1) * (SIZE[kind] || 1);
    const f = {
      kind, r, spin: new THREE.Vector3(this.r() - 0.5, this.r() - 0.5, this.r() - 0.5).normalize(), spinV: 1 + this.r() * 2.5,
      ang: this.r() * 6, state: 'fall', ground: 0, noCatch: 0, maxV: 120 + 110 * k, entered: false,
    };
    if (this.r() < 0.5) {
      // tossed in from a side, in an arc
      const side = this.r() < 0.5 ? -1 : 1;
      Object.assign(f, { x: side < 0 ? -r : W + r, y: H * (0.04 + this.r() * 0.22),
        vx: -side * (150 + this.r() * 150) * (1 + 0.3 * k), vy: -(30 + this.r() * 110) });
    } else {
      // from the top, drifting sideways
      Object.assign(f, { x: r + this.r() * (W - 2 * r), y: -r - 10, vx: (this.r() - 0.5) * 240, vy: 30 + 40 * k });
    }
    this.fruits.push(f);
  }

  physics(dt, now, k) {
    const G = 240;
    for (const f of this.fruits) {
      if (f.state === 'held') {
        const pp = f.holder, h = f.hand;
        f.x = h.pos.x; f.y = h.pos.y;
        // eaten when the PLAYER brings that hand to their mouth (the animals' arms are too short
        // to reach their own faces), or when the fruit / paw touches the animal's head
        if (this.handAtMouth(pp, h)) { this.eat(pp, f, now); continue; }
        if (pp.headC) {
          const reach = pp.headR + f.r * 0.6;
          if (Math.hypot(f.x - pp.headC.x, f.y - pp.headC.y) < reach || Math.hypot(h.pos.x - pp.headC.x, h.pos.y - pp.headC.y) < pp.headR * 1.05) { this.eat(pp, f, now); continue; }
        }
        // slipped out of the paw (or let go of: the paw lowered below the waist)
        const low = pp.pl.kind === 'camera' && pp.hips && h.pos.y > pp.hips.y + this.hpx * 0.05 && !this.crouching(pp);
        if (now - f.heldAt > HOLD_MS || low || !input(pp.pl).present) this.release(f, now);
        continue;
      }
      if (f.state !== 'fall') continue;
      f.vy = Math.min(f.maxV, f.vy + G * dt);
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.ang += f.spinV * dt;
      // bounce off the animals' heads and bodies
      for (const pp of this.p) {
        if (!pp.ch) continue;
        const sz = this.hpx * (ANIMAL_SIZE[pp.pl.animal] ?? 1);
        for (const [c, rr] of [[pp.headC, sz * 0.15], [pp.chest, sz * 0.19], [pp.hips, sz * 0.17]]) {
          const dx = f.x - c.x, dy = f.y - c.y, d = Math.hypot(dx, dy), min = rr + f.r * 0.8;
          if (d < min && d > 0.01) {
            const nx = dx / d, ny = dy / d, vn = f.vx * nx + f.vy * ny;
            f.x = c.x + nx * min; f.y = c.y + ny * min;
            if (vn < 0) { f.vx -= 1.6 * vn * nx; f.vy -= 1.6 * vn * ny; f.vx += nx * 60; f.spinV *= -1.2; }
            // landed on top of a head or shoulder: roll off to the side
            if (ny < -0.6) f.vx += (Math.abs(nx) > 0.05 ? Math.sign(nx) : (this.r() < 0.5 ? -1 : 1)) * 160 * (1 + ny);
          }
        }
      }
      // caught by a paw (one fruit per paw)
      if (now > f.noCatch) {
        for (const pp of this.p) {
          if (!pp.ch) continue;
          const h = pp.hands.find((hh) => !hh.fruit && now > hh.freeAt && Math.hypot(f.x - hh.pos.x, f.y - hh.pos.y) < f.r + this.hpx * 0.09);
          if (h) { f.state = 'held'; f.holder = pp; f.hand = h; f.heldAt = now; h.fruit = f; f.ground = 0; break; }
        }
      }
      if (f.state !== 'fall') continue;
      // the ground: a small bounce, then it rolls a little and fades away
      if (f.y > this.floorY - f.r) {
        f.y = this.floorY - f.r;
        if (f.vy > 60) { f.vy *= -0.35; f.vx *= 0.7; } else { f.vy = 0; f.vx *= 0.9; }
        f.ground = f.ground || now;
      }
      if (f.ground && now - f.ground > FLOOR_MS) f.state = 'gone';
      if (!f.entered && f.x > f.r && f.x < W - f.r) f.entered = true;
      if (f.entered && (f.x < f.r || f.x > W - f.r)) { f.x = Math.max(f.r, Math.min(W - f.r, f.x)); f.vx *= -0.6; }
      if (f.y > H + f.r * 2) f.state = 'gone';
    }
    const lying = this.fruits.filter((f) => f.ground && f.state === 'fall').sort((a, b) => a.ground - b.ground);
    for (const f of lying.slice(0, Math.max(0, lying.length - 10))) f.ground = Math.min(f.ground, now - FLOOR_MS + 600);   // too many: the oldest fade
    this.fruits = this.fruits.filter((f) => f.state !== 'gone' || this.removeMesh(f));
  }

  // the player is squatting (hips well below where they stand)
  crouching(pp) {
    const b = pp.pl.body, p = b?.pts;
    if (!p || !b.base) return false;
    return (p[23].y + p[24].y) / 2 - b.base.hipY > 0.25 * b.base.torso;
  }

  // the player's own wrist (paw L = their wrist on the left of the mirror view) near their mouth
  handAtMouth(pp, h) {
    const pl = pp.pl;
    if (pl.kind !== 'camera' || !pl.body?.pts) return false;
    const p = pl.body.pts, w = p[h.bone === 'handL' ? 15 : 16], nose = p[0];
    if (w.v < 0.4 || nose.v < 0.4) return false;
    const T = Math.max(0.05, Math.hypot((p[11].x + p[12].x - p[23].x - p[24].x) / 2, (p[11].y + p[12].y - p[23].y - p[24].y) / 2));
    return Math.hypot(w.x - nose.x, w.y - (nose.y + 0.08 * T)) < 0.42 * T;
  }

  release(f, now) {
    const h = f.hand;
    if (h) { h.fruit = null; h.freeAt = now + 500; }
    f.state = 'fall'; f.vy = 80; f.vx = (this.r() - 0.5) * 140; f.noCatch = now + 900; f.holder = null; f.hand = null;
  }

  eat(pp, f, now) {
    f.hand.fruit = null; f.hand.freeAt = now + 250;
    f.state = 'gone';
    pp.chompAt = now;
    this.crumbs(pp, f.kind);
    if (f.kind === pp.thought) {
      pp.score++;
      this.say(pp, ['Yum! +1 😋', 'Delicious! +1', 'Munch munch! +1'][pp.score % 3]);
      this.newThought(pp);
    } else {
      this.say(pp, `Yuck, ${NAME[f.kind]}! 🤢`, '#ffd2c8');
    }
  }

  // a little burst of crumbs from the mouth
  crumbs(pp, kind) {
    if (!pp.mouth) return;
    const col = CRUMB[kind] || 0xf2c14e;
    this.crumbGeo = this.crumbGeo || new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(this.crumbGeo, new THREE.MeshLambertMaterial({ color: i % 3 ? col : 0xffffff }));
      const a = -Math.PI / 2 + (this.r() - 0.5) * 2.4, sp = 120 + this.r() * 160;
      m.userData = { x: pp.mouth.x, y: pp.mouth.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, s: 4 + this.r() * 4 };
      this.stage.scene.add(m);
      this.bits = this.bits || [];
      this.bits.push(m);
    }
  }
  moveCrumbs(dt) {
    if (!this.bits) return;
    for (const m of this.bits) {
      const u = m.userData;
      u.t += dt; u.vy += 600 * dt; u.x += u.vx * dt; u.y += u.vy * dt;
      m.position.set(u.x, -u.y, 600); m.scale.setScalar(u.s * Math.max(0, 1 - u.t / 0.7)); m.rotation.x += dt * 8;
    }
    this.bits = this.bits.filter((m) => { if (m.userData.t < 0.7) return true; this.stage.scene.remove(m); m.material.dispose(); return false; });
  }

  // the fruit meshes in the 3D layer (in front of the animals)
  drawFruits(time) {
    if (!this.ready) return;
    for (const f of this.fruits) {
      let m = this.meshes.get(f);
      if (!m) {
        const t = this.T[f.kind];
        m = new THREE.Mesh(t.geo, t.mat);
        this.stage.scene.add(m);
        this.meshes.set(f, m);
      }
      const fade = f.ground ? Math.max(0, 1 - (performance.now() - f.ground - (FLOOR_MS - 600)) / 600) : 1;
      m.scale.setScalar(f.r * 2.1 * Math.min(1, fade + 0.001));
      m.position.set(f.x, -f.y, f.state === 'held' ? 500 : 400);
      if (f.state === 'held') m.quaternion.identity();
      else m.quaternion.setFromAxisAngle(f.spin, f.ang);
    }
  }
  removeMesh(f) {
    const m = this.meshes.get(f);
    if (m) { this.stage.scene.remove(m); this.meshes.delete(f); }
    return false;
  }

  end() {
    this.state = 'done';
    this.banner.setText('Tummies full! 🍉');
    for (const f of this.fruits) if (f.hand) f.hand.fruit = null;
    finishGame(this, this.p.map((pp) => ({
      slot: pp.pl.slot, score: pp.score, label: `🍎 ${pp.score} ${pp.score === 1 ? 'fruit' : 'fruits'}`,
    })), 2500);
  }
}

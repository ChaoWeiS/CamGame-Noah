// Ark Kitchen — each animal cooks its own dishes. The recipe at the top of the window shows
// the dish and its ingredients, in order. Baskets around the animal each hold one ingredient:
// reach out to the right one and grab (make a fist, or just hold your paw there a moment),
// then bring it to the pot in the middle. The order matters: put in a wrong one and the pot
// is poured away — a fresh pot, and the recipe starts again from the first ingredient.
// Finish the list and the dish is served (points for its ingredients, plus a bonus).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tracker, input, PLAYER_CSS } from '../../js/core.js';
import { W, H, rng, session, charById } from '../../js/scenes/common.js';
import { Stage3D, OverlayText } from '../../js/stage3d.js';
import { finishGame } from '../../js/games.js';
import { ANIMAL_SIZE } from '../../js/models.js';

const ROUND_MS = 75000;
const DWELL_MS = 600;          // no hand reading: hold the paw over a basket this long to grab
const HOLD_MS = 9000;          // a carried ingredient slips out after this long
const DISH_BONUS = 2;
const FILES = {
  ingredients: new URL('../../assets/food/ingredients.glb', import.meta.url).href,
  dishes: new URL('../../assets/food/dishes.glb', import.meta.url).href,
  props: new URL('./props.glb', import.meta.url).href,
};
const ICON = (k) => new URL(`./icons/${k}.png`, import.meta.url).href;

// dish → ingredients, in the order they go in
export const RECIPES = {
  soup: ['carrot', 'onion', 'leek', 'cabbage'],
  pizza: ['flour', 'tomatoes', 'cheese', 'mushrooms'],
  burger: ['bread', 'meat', 'cheese', 'cabbage'],
  stirfry: ['meat', 'carrot', 'onion', 'mushrooms'],
  pasta: ['flour', 'eggs', 'tomatoes', 'cheese'],
  cake: ['flour', 'eggs', 'butter', 'jam'],
  curry: ['meat', 'onion', 'tomatoes', 'pumpkin'],
  hotdog: ['bread', 'meat', 'onion'],
  cookie: ['flour', 'butter', 'eggs', 'honey'],
  donut: ['flour', 'eggs', 'milk_jug', 'jam'],
  pastries: ['flour', 'butter', 'honey', 'pear'],
  candy_apple: ['apple', 'honey'],
};
const EXTRA = ['grapes', 'wheat', 'apple', 'pear', 'pumpkin', 'milk_jug', 'honey', 'jam'];
const NAME = {
  carrot: 'carrot', onion: 'onion', leek: 'leek', cabbage: 'cabbage', flour: 'flour', tomatoes: 'tomatoes', cheese: 'cheese',
  mushrooms: 'mushrooms', bread: 'bread', meat: 'meat', eggs: 'eggs', butter: 'butter', jam: 'jam', pumpkin: 'pumpkin',
  honey: 'honey', milk_jug: 'milk', apple: 'apple', pear: 'pear', grapes: 'grapes', wheat: 'wheat',
  soup: 'Veggie soup', pizza: 'Pizza', burger: 'Burger', stirfry: 'Stir-fry', pasta: 'Pasta', cake: 'Cake', curry: 'Curry',
  hotdog: 'Hot dog', cookie: 'Cookie pie', donut: 'Donut', pastries: 'Honey pastries', candy_apple: 'Toffee apple',
};
const SPLASH = { carrot: 0xf08a2a, onion: 0xd9a05b, leek: 0x9ccf6a, cabbage: 0x8cc45a, flour: 0xf5f0e6, tomatoes: 0xe0473a,
  cheese: 0xf6cf3e, mushrooms: 0xc9a27a, bread: 0xd49a52, meat: 0xc94a4a, eggs: 0xfff3d6, butter: 0xf7e07a, jam: 0xb3203a,
  pumpkin: 0xf08a2a, honey: 0xf2b134, milk_jug: 0xffffff, apple: 0xd8302c, pear: 0xc4d65a, grapes: 0x7a3fb5, wheat: 0xe0b866 };
// six spots around the animal (× its height, from the middle of its chest), three each side:
// arms up at 45°, arms straight out, arms down at 45°
const SPOTS = [[-0.44, -0.27], [-0.57, 0.05], [-0.44, 0.38], [0.44, -0.27], [0.57, 0.05], [0.44, 0.38]];
// ingredients that come in their own sack, basket, jar, jug or dish: no basket under them
const BARE = new Set(['flour', 'eggs', 'butter', 'tomatoes', 'jam', 'honey', 'milk_jug']);
const POUR_MS = 1400;

const loader = new GLTFLoader();
const cache = {};
function loadSet(file) {
  return (cache[file] = cache[file] || loader.loadAsync(file).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const T = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.name || o.parent?.name;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      geo.computeBoundingBox();
      const b = geo.boundingBox, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
      const k = 1 / Math.max(s.x, s.y, s.z);
      geo.scale(k, k, k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      T[name] = { geo, mat: o.material, h: s.y * k };
    });
    return T;
  }));
}
export function preloadKitchen() { return Promise.all(Object.values(FILES).map(loadSet)); }

// the recipe card at the top of a window: the dish, then its ingredients in order
class RecipeCard {
  constructor(game, color) {
    this.game = game;
    const el = this.el = document.createElement('div');
    el.className = 'recipe';
    el.style.setProperty('--c', color);
    game.canvas.parentElement.appendChild(el);
  }
  set(dish, list, idx) {
    this.el.innerHTML = `<span class="dish"><img src="${ICON(dish)}" alt=""><em>${NAME[dish]}</em></span><span class="eq">=</span>`
      + list.map((k, i) => `<span class="ing${i < idx ? ' done' : i === idx ? ' now' : ''}"><img src="${ICON(k)}" alt=""></span>`).join('<span class="then">›</span>');
  }
  place(x, y, h) {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const k = cr.height / this.game.scale.height;
    Object.assign(this.el.style, { left: `${cr.left - pr.left + x * k}px`, top: `${cr.top - pr.top + y * k}px`, fontSize: `${h * k}px` });
  }
  pop() { this.el.classList.remove('pop'); void this.el.offsetWidth; this.el.classList.add('pop'); }
  destroy() { this.el.remove(); }
}

// a cooking pot (an iron cauldron with stew inside), tipped towards the camera so you see in
function makePot() {
  const g = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 0.62; prof.push(new THREE.Vector2(0.02 + Math.sin(a + 0.25) * 0.5, -Math.cos(a + 0.25) * 0.42)); }
  prof.push(new THREE.Vector2(0.47, 0.06), new THREE.Vector2(0.53, 0.08), new THREE.Vector2(0.53, 0.12), new THREE.Vector2(0.45, 0.11));
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 28), iron));
  const stew = new THREE.Mesh(new THREE.CircleGeometry(0.45, 28), new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.4 }));
  stew.rotation.x = -Math.PI / 2; stew.position.y = 0.02; g.add(stew);
  for (const s of [-1, 1]) {                          // handles
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 16), iron);
    r.position.set(s * 0.55, 0.02, 0); r.rotation.y = Math.PI / 2; g.add(r);
  }
  for (const a of [0, 2.1, 4.2]) {                    // little legs
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.14, 8), iron);
    l.position.set(Math.cos(a) * 0.3, -0.42, Math.sin(a) * 0.3); g.add(l);
  }
  g.userData.stew = stew;
  g.rotation.x = 0.42;
  return g;
}

export class KitchenScene extends Phaser.Scene {
  static KEY = 'Kitchen';
  constructor() { super('Kitchen'); }

  create() {
    session.seed = (Math.random() * 1e9) | 0;
    this.r = rng(session.seed ^ 0x6b);
    this.stage = new Stage3D(this.game);
    this.ready = false;
    preloadKitchen().then(([I, D, P]) => { this.I = I; this.D = D; this.P = P; this.ready = true; this.p.forEach((pp) => this.buildProps(pp)); })
      .catch((e) => console.warn('kitchen models', e));
    this.flying = [];
    this.bits = [];

    // one window per player, left to right as they stand (like Fruit Feast)
    const players = [...tracker.players];
    const xOf = (pl) => (pl.kind === 'camera' && pl.body?.pts ? (pl.body.pts[11].x + pl.body.pts[12].x) / 2 : pl.slot);
    players.sort((a, b) => xOf(a) - xOf(b));
    const n = players.length, G = 4;
    const rects = n <= 1 ? [{ x: 0, y: 0, w: W, h: H }]
      : n === 2 ? [0, 1].map((i) => ({ x: i * (W / 2 + G / 2), y: 0, w: W / 2 - G / 2, h: H }))
      : [0, 1, 2, 3].map((i) => ({ x: (i % 2) * (W / 2 + G / 2), y: Math.floor(i / 2) * (H / 2 + G / 2), w: W / 2 - G / 2, h: H / 2 - G / 2 }));
    this.add.rectangle(W / 2, H / 2, W, H, 0x10202b);
    rects.forEach((r, i) => this.drawBackground(r, i >= n));
    const r0 = rects[0];
    // the animal: room above for the recipe card, room at the sides for the baskets
    this.hpx = Math.min(r0.h * (n <= 2 ? 0.6 : 0.62), r0.w * 0.55);
    this.p = players.map((pl, i) => {
      const rect = rect_(rects[i]);
      const sz = this.hpx * (ANIMAL_SIZE[pl.animal] ?? 1);
      const floorY = rect.y + rect.h - Math.max(10, rect.h * 0.04);
      const chestY = floorY - sz * 0.62;
      const cx = rect.x + rect.w / 2;
      const pp = {
        pl, rect, sz, colX: cx, x: cx, floorY, chestY, score: 0, dishes: 0, kbFlaps: input(pl).flapCount || 0,
        hands: [{ bone: 'handL', side: 'L', item: null, freeAt: 0, pos: { x: 0, y: 0 }, dwell: null },
          { bone: 'handR', side: 'R', item: null, freeAt: 0, pos: { x: 0, y: 0 }, dwell: null }],
        baskets: SPOTS.map(([dx, dy]) => ({ x: clampX(rect, cx + dx * sz, sz * 0.14), y: chestY + dy * sz, r: sz * 0.13, kind: null })),
        stove: { x: cx, w: sz * 0.56, h: sz * 0.27 },
        pot: { x: cx, y: floorY - sz * 0.27 - sz * 0.2 * 0.86, r: sz * 0.2 },     // sitting on the stove, at tummy height
        card: new RecipeCard(this.game, PLAYER_CSS[pl.slot]),
        chip: this.makeChip(pl), msg: new OverlayText(this.game, cx, rect.y + rect.h * 0.3, n >= 3 ? 26 : 34),
        lost: new OverlayText(this.game, cx, rect.y + rect.h * 0.55, n >= 3 ? 24 : 30, '#ffd2c8'),
        ring: this.add.graphics().setDepth(5),
      };
      this.newRecipe(pp);
      return pp;
    });
    this.timer = new OverlayText(this.game, W / 2, n >= 3 ? H / 2 : H - 30, n >= 3 ? 40 : 44);
    this.banner = new OverlayText(this.game, W / 2, H / 2 - 40, 110);
    this.help = new OverlayText(this.game, W / 2, H / 2 + 70, 28);
    this.help.setText('📜 Cook the dish on your card — ingredients in order!\n🙌 Stretch to an ingredient and make a fist ✊ (or hold your paw there)\n🍲 Bring it to the pot — the wrong one and the pot is poured away!');
    this.events.once('shutdown', () => {
      this.stage.destroy(); this.timer.destroy(); this.banner.destroy(); this.help.destroy();
      this.p.forEach((pp) => { pp.card.destroy(); pp.chip.remove(); pp.msg.destroy(); pp.lost.destroy(); });
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
      [5600, () => { this.banner.setText('COOK!!!'); this.help.setText(''); this.state = 'play'; this.startAt = performance.now(); }],
      [6400, () => { if (this.banner.text === 'COOK!!!') this.banner.setText(''); }],
    ];
  }

  makeChip(pl) {
    const el = document.createElement('div');
    el.className = 'fruitchip';
    el.style.setProperty('--c', PLAYER_CSS[pl.slot]);
    document.getElementById('wrap').appendChild(el);
    return el;
  }

  // the ark's galley: plank walls, a shelf of jars, hanging pans, a brick hearth behind the pot
  drawBackground(R, empty = false) {
    const g = this.add.graphics(), floorTop = R.y + R.h * 0.84;
    const X = (f) => R.x + f * R.w, Y = (f) => R.y + f * R.h;
    const ph = Math.max(16, R.h * 0.055);
    for (let y = R.y, i = 0; y < floorTop; y += ph, i++) {
      g.fillStyle(i % 2 ? 0x8a5a2e : 0x81532a, 1).fillRect(R.x, y, R.w, Math.min(ph - 2, floorTop - y));
      g.fillStyle(0x4a2a12, 0.5).fillRect(R.x, y + ph - 2, R.w, 2);
    }
    // hearth
    const hx = X(0.5), hw = R.w * 0.34, hTop = Y(0.42);
    g.fillStyle(0x7a4a36, 1).fillRect(hx - hw / 2, hTop, hw, floorTop - hTop);
    const bh = Math.max(8, R.h * 0.03);
    for (let y = hTop, i = 0; y < floorTop; y += bh, i++) for (let x = hx - hw / 2 + (i % 2) * bh; x < hx + hw / 2; x += bh * 2)
      g.fillStyle(0x5c3426, 0.6).fillRect(x, y + bh - 2, bh * 2 - 2, 2);
    g.fillStyle(0x2a1610, 1).fillRoundedRect(hx - hw * 0.32, hTop + (floorTop - hTop) * 0.35, hw * 0.64, (floorTop - hTop) * 0.65, { tl: hw * 0.3, tr: hw * 0.3, bl: 0, br: 0 });
    g.fillStyle(0xff8a2a, 0.55).fillEllipse(hx, floorTop - 6, hw * 0.5, (floorTop - hTop) * 0.18);
    g.fillStyle(0xffd26a, 0.6).fillEllipse(hx, floorTop - 4, hw * 0.28, (floorTop - hTop) * 0.1);
    // shelf with jars on the left, hanging pans on the right
    g.fillStyle(0x4f2e14, 1).fillRect(X(0.03), Y(0.2), R.w * 0.26, Math.max(6, R.h * 0.018));
    const jr = Math.max(6, R.h * 0.028);
    [0xb3203a, 0xf2b134, 0x8cc45a, 0xe8d9b8].forEach((c, i) => {
      g.fillStyle(c, 1).fillRoundedRect(X(0.05) + i * R.w * 0.06, Y(0.2) - jr * 2.2, jr * 1.6, jr * 2.2, 3);
      g.fillStyle(0xe9dcc0, 1).fillRect(X(0.05) + i * R.w * 0.06 - 1, Y(0.2) - jr * 2.4, jr * 1.6 + 2, jr * 0.45);
    });
    g.fillStyle(0x4f2e14, 1).fillRect(X(0.72), Y(0.1), R.w * 0.25, Math.max(5, R.h * 0.014));
    [[0.76, 0.06], [0.85, 0.075], [0.93, 0.05]].forEach(([fx, rr]) => {
      g.lineStyle(2, 0x2a2a2e, 1).lineBetween(X(fx), Y(0.11), X(fx), Y(0.16));
      g.fillStyle(0x3a3a40, 1).fillCircle(X(fx), Y(0.16) + rr * R.h * 0.6, rr * R.h * 0.6);
    });
    // floor
    g.fillStyle(0x6b4020, 1).fillRect(R.x, floorTop, R.w, R.y + R.h - floorTop);
    for (let y = floorTop + 8; y < R.y + R.h; y += Math.max(10, R.h * 0.025)) g.fillStyle(0x4a2a12, 0.5).fillRect(R.x, y, R.w, 2);
    g.fillStyle(0x3b2410, 1).fillRect(R.x, floorTop - 3, R.w, 6);
    if (empty) {
      g.fillStyle(0x10202b, 0.6).fillRect(R.x, R.y, R.w, R.h);
      this.add.text(X(0.5), Y(0.5), '🍲', { fontSize: `${Math.round(R.h * 0.3)}px` }).setOrigin(0.5).setAlpha(0.5);
    }
  }

  // ------------------------------------------------------------ recipes and baskets
  newRecipe(pp) {
    const dishes = Object.keys(RECIPES).filter((d) => d !== pp.dish);
    pp.dish = dishes[Math.floor(this.r() * dishes.length)];
    pp.list = RECIPES[pp.dish]; pp.idx = 0;
    pp.card.set(pp.dish, pp.list, 0); pp.card.pop();
    // fill the baskets: the next ingredient, the rest of the recipe, then others
    const pick = [...new Set(pp.list)];
    const others = [...new Set([...Object.values(RECIPES).flat(), ...EXTRA])].filter((k) => !pick.includes(k));
    while (pick.length < pp.baskets.length) pick.push(others.splice(Math.floor(this.r() * others.length), 1)[0]);
    pick.sort(() => this.r() - 0.5);
    pp.baskets.forEach((b, i) => this.fillBasket(pp, b, pick[i]));
  }
  fillBasket(pp, b, kind) {
    b.kind = kind; b.popAt = performance.now();
    if (b.food) { this.stage.scene.remove(b.food); b.food = null; }
    if (this.ready) this.buildBasket(pp, b);
  }
  buildProps(pp) {
    pp.baskets.forEach((b) => this.buildBasket(pp, b));
    if (!pp.potMesh) { pp.potMesh = makePot(); this.stage.scene.add(pp.potMesh); }
    if (!pp.stoveMesh) {
      // a brick stove with an iron top; fire glowing through the oven door; steam from the pot
      const t = this.P.stove;
      pp.stoveMesh = new THREE.Mesh(t.geo, t.mat); pp.stoveH = t.h; this.stage.scene.add(pp.stoveMesh);
      pp.glow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.stage.scene.add(pp.glow);
      this.puffGeo = this.puffGeo || new THREE.SphereGeometry(1, 10, 8);
      pp.steam = [0, 1, 2, 3, 4].map((i) => {
        const m = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        m.userData.phase = i / 5; this.stage.scene.add(m); return m;
      });
    }
  }
  buildBasket(pp, b) {
    if (!b.mesh) {
      const t = this.P.basket2;
      b.mesh = new THREE.Mesh(t.geo, t.mat);
      b.mesh.rotation.x = 0.5;
      this.stage.scene.add(b.mesh);
    }
    b.mesh.visible = !BARE.has(b.kind);
    if (!b.food && b.kind) { const t = this.I[b.kind]; b.food = new THREE.Mesh(t.geo, t.mat); this.stage.scene.add(b.food); }
  }

  say(pp, t, color = '#fff8e6') { pp.msg.el.style.color = color; pp.msg.setText(t); pp.msgUntil = performance.now() + 1300; }

  // ------------------------------------------------------------ every frame
  update(time, delta) {
    const now = performance.now(), dt = Math.min(delta, 60) / 1000;
    while (this.steps.length && now - this.t0 >= this.steps[0][0]) this.steps.shift()[1]();
    const playing = this.state === 'play';
    const left = playing ? Math.max(0, ROUND_MS - (now - this.startAt)) : ROUND_MS;
    this.timer.setText(`⏱ ${Math.ceil(left / 1000)}`);
    for (const pp of this.p) {
      this.placeAnimal(pp, time, now);
      if (playing) this.cook(pp, now);
      this.drawProps(pp, now);
      if (pp.msgUntil && now > pp.msgUntil) { pp.msg.setText(''); pp.msgUntil = 0; }
      pp.chip.innerHTML = `P${pp.pl.slot + 1} · ${charById(pp.pl.animal).name} <b>🍲 ${pp.dishes} · ⭐ ${pp.score}</b>`;
      const R = pp.rect;
      pp.card.place(R.x + R.w / 2, R.y + Math.max(30, R.h * 0.1), this.p.length >= 3 ? Math.max(11, R.h * 0.028) : Math.max(14, R.h * 0.026));
    }
    this.moveFlying(dt, now);
    this.moveBits(dt);
    this.stage.render();
    this.layoutChips();
    if (playing && left <= 0) this.end();
  }

  layoutChips() {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), wr = document.getElementById('wrap').getBoundingClientRect();
    const kk = cr.height / H;
    this.p.forEach((pp) => Object.assign(pp.chip.style, {
      left: `${cr.left - wr.left + pp.colX * kk}px`, top: `${cr.top - wr.top + (pp.rect.y + pp.rect.h - 4) * kk}px`, fontSize: `${(this.p.length >= 3 ? 16 : 20) * kk}px`,
    }));
  }

  placeAnimal(pp, time, now) {
    const pl = pp.pl, inp = input(pl), cam = pl.kind === 'camera';
    const side = Math.max(-1, Math.min(1, inp.side ?? 0));
    pp.x += (pp.colX + side * pp.rect.w * 0.06 - pp.x) * 0.25;     // a small step only: the pot stays in front
    pp.lost.setText(inp.present ? '' : 'Come back into view!');
    const shown = this.stage.place(pl.slot, pl.animal || 'bear', pp.x, pp.floorY, this.hpx,
      cam && inp.present ? pl.body.vpts : null, cam && inp.present ? pl.body.base : null, time / 1000, cam && inp.present ? pl.body.world : null);
    const ch = this.stage.actors.get(pl.slot)?.ch;
    pp.ch = shown ? ch : null;
    if (!pp.ch) return;
    const v = new THREE.Vector3();
    const toScreen = (bone, x, y, z) => { v.set(x, y, z); bone.localToWorld(v); return { x: v.x, y: -v.y }; };
    for (const h of pp.hands) {
      const hb = ch.b[h.bone], w = toScreen(hb, 0, 0, 0), e = toScreen(hb.parent, 0, 0, 0);
      h.pos = { x: w.x + (w.x - e.x) * 0.35, y: w.y + (w.y - e.y) * 0.35 };
    }
  }

  // grabbing from baskets, carrying, and dropping into the pot
  cook(pp, now) {
    const inp = input(pp.pl), cam = pp.pl.kind === 'camera';
    // keyboard players: each jump (Space / W) puts the next ingredient in
    if (!cam) {
      const f = inp.flapCount || 0;
      if (f > pp.kbFlaps) { pp.kbFlaps = f; this.intoPot(pp, pp.list[pp.idx], now, null); }
      return;
    }
    if (!pp.ch || !inp.present) { for (const h of pp.hands) if (h.item) this.letGo(pp, h, now); return; }
    for (const h of pp.hands) {
      const hr = inp.hands?.[h.side];                    // the phone read this hand close up
      if (!h.item) {
        if (now < h.freeAt) { h.dwell = null; continue; }
        const b = pp.baskets.find((bb) => bb.kind && Math.hypot(h.pos.x - bb.x, h.pos.y - bb.y) < bb.r * 1.25);
        if (!b) { h.dwell = null; continue; }
        if (!h.dwell || h.dwell.b !== b) h.dwell = { b, since: now };
        const grab = hr ? hr.fist || now - h.dwell.since > DWELL_MS * 1.6 : now - h.dwell.since > DWELL_MS;
        if (grab) {
          h.item = b.kind; h.from = b; h.heldAt = now; h.dwell = null; h.wasFist = !!hr?.fist;
        }
        continue;
      }
      // carrying: into the pot when the paw reaches its mouth
      const P = pp.pot, dx = h.pos.x - P.x, dy = h.pos.y - (P.y - P.r * 0.35);
      if (Math.abs(dx) < P.r * 1.0 && dy > -P.r * 0.9 && dy < P.r * 0.7) { const k = h.item; h.item = null; h.freeAt = now + 350; this.intoPot(pp, k, now, h); continue; }
      // let go: opened the hand (after it was a fist), or held too long
      const opened = hr && h.wasFist && hr.grip < 0.3;
      if (hr?.fist) h.wasFist = true;
      if (opened || now - h.heldAt > HOLD_MS) this.letGo(pp, h, now);
    }
  }

  letGo(pp, h, now) {
    if (!h.item) return;
    this.flyBack(pp, h.item, h.pos, h.from);
    h.item = null; h.freeAt = now + 400; h.dwell = null;
  }

  intoPot(pp, kind, now, h) {
    if (!kind) return;
    const P = pp.pot;
    // the pot is being poured out / replaced, or the dish is being served: back to its basket
    if (pp.idx < 0 || now < (pp.pourAt || 0) + POUR_MS) {
      this.flyBack(pp, kind, { x: P.x, y: P.y - P.r * 0.4 }, h?.from || pp.baskets.find((b) => b.kind === kind), true);
      return;
    }
    this.splash(pp, kind);
    pp.potBob = now;
    if (kind === pp.list[pp.idx]) {
      pp.idx++;
      if (pp.idx >= pp.list.length) {
        const pts = pp.list.length + DISH_BONUS;
        pp.score += pts; pp.dishes++;
        pp.card.set(pp.dish, pp.list, pp.idx);
        this.say(pp, `${NAME[pp.dish]} is ready! +${pts} 🎉`, '#ffe08a');
        this.serve(pp, pp.dish);
        pp.idx = -1;                                       // nothing goes in while it's served
        setTimeout(() => { if (this.state === 'play' && this.sys.isActive()) this.newRecipe(pp); }, 1800);
      } else {
        pp.card.set(pp.dish, pp.list, pp.idx);
        this.say(pp, [`${cap(NAME[kind])} ✓`, `Yum, ${NAME[kind]}! ✓`, `In goes the ${NAME[kind]} ✓`][pp.idx % 3]);
      }
    } else {
      // wrong one: the pot is poured away and a fresh one comes; start the recipe again
      const want = pp.list[pp.idx];
      pp.pourAt = now; pp.pourDir = this.r() < 0.5 ? -1 : 1; pp.poured = false;
      pp.idx = 0;
      pp.card.set(pp.dish, pp.list, 0); pp.card.pop();
      this.say(pp, `Oops — not ${NAME[kind]}${want ? `, it was ${NAME[want]}` : ''}! 🫗\nStart again: ${NAME[pp.list[0]]} first`, '#ffd2c8');
    }
  }

  // an ingredient going back to its basket (in an arc), or popping out of the pot
  flyBack(pp, kind, from, basket, hop = false) {
    const to = basket || pp.baskets[0];
    this.flying.push({ pp, kind, x0: from.x, y0: from.y, x1: to.x, y1: to.y - to.r * 0.2, t: 0, dur: hop ? 0.7 : 0.45, hop, mesh: null });
  }
  moveFlying(dt, now) {
    for (const f of this.flying) {
      f.t += dt / f.dur;
      if (!f.mesh && this.ready) { const t = this.I[f.kind]; f.mesh = new THREE.Mesh(t.geo, t.mat); this.stage.scene.add(f.mesh); }
      if (!f.mesh) continue;
      if (f.serve) {                                   // the finished dish: rises, grows, then fades away
        const u = Math.min(1, f.t), up = 1 - Math.pow(1 - Math.min(1, u * 2.2), 3);
        f.mesh.position.set(f.x0, -(f.y0 + (f.y1 - f.y0) * up), 760);
        f.mesh.scale.setScalar(f.pp.sz * 0.42 * up * (u > 0.85 ? (1 - u) / 0.15 : 1) + 0.001);
        f.mesh.rotation.y += dt * 2;
        continue;
      }
      const u = Math.min(1, f.t), arc = (f.hop ? 0.6 : 0.25) * f.pp.sz * Math.sin(u * Math.PI);
      f.mesh.position.set(f.x0 + (f.x1 - f.x0) * u, -(f.y0 + (f.y1 - f.y0) * u - arc), 520);
      f.mesh.scale.setScalar(f.pp.sz * 0.17 * (1 - 0.4 * u));
      f.mesh.rotation.z += dt * 8;
    }
    this.flying = this.flying.filter((f) => { if (f.t < 1) return true; if (f.mesh) this.stage.scene.remove(f.mesh); return false; });
  }

  // the finished dish rises out of the pot and shines for a moment
  serve(pp, dish) {
    if (!this.ready) return;
    const t = this.D[dish]; if (!t) return;
    const m = new THREE.Mesh(t.geo, t.mat);
    this.stage.scene.add(m);
    this.flying.push({ pp, kind: null, mesh: m, t: 0, dur: 1.7, serve: true });
    const f = this.flying[this.flying.length - 1];
    const P = pp.pot;
    Object.assign(f, { x0: P.x, y0: P.y - P.r * 0.4, x1: P.x, y1: P.y - pp.sz * 0.95, hop: false });
    f.mesh.rotation.x = 0.35;
  }

  splash(pp, kind) {
    const P = pp.pot, col = SPLASH[kind] || 0xf2c14e;
    this.bitGeo = this.bitGeo || new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(this.bitGeo, new THREE.MeshLambertMaterial({ color: i % 3 ? col : 0xb5651d }));
      const a = -Math.PI / 2 + (this.r() - 0.5) * 1.8, sp = 140 + this.r() * 180;
      m.userData = { x: P.x + (this.r() - 0.5) * P.r, y: P.y - P.r * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, s: 3 + this.r() * 4 };
      this.stage.scene.add(m);
      this.bits.push(m);
    }
  }
  // the stew pouring out over the rim, onto the floor
  pour(pp) {
    const P = pp.pot, d = pp.pourDir;
    this.bitGeo = this.bitGeo || new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(this.bitGeo, new THREE.MeshLambertMaterial({ color: i % 4 ? 0xb5651d : 0x7a3e12 }));
      m.userData = { x: P.x + d * P.r * 1.1, y: P.y - P.r * 0.3, vx: d * (60 + this.r() * 160), vy: -40 + this.r() * 80, t: -i * 0.012, s: 4 + this.r() * 5 };
      this.stage.scene.add(m);
      this.bits.push(m);
    }
  }
  moveBits(dt) {
    for (const m of this.bits) {
      const u = m.userData;
      u.t += dt; if (u.t < 0) { m.visible = false; continue; } m.visible = true; u.vy += 700 * dt; u.x += u.vx * dt; u.y += u.vy * dt;
      m.position.set(u.x, -u.y, 640); m.scale.setScalar(u.s * Math.max(0, 1 - u.t / 0.7));
    }
    this.bits = this.bits.filter((m) => { if (m.userData.t < 0.7) return true; this.stage.scene.remove(m); m.material.dispose(); return false; });
  }

  // baskets (the next ingredient bobs), the pot (bubbling), carried ingredients, grab rings
  drawProps(pp, now) {
    if (!this.ready) return;
    const next = pp.list[pp.idx], t = now / 1000;
    for (const b of pp.baskets) {
      if (!b.mesh) continue;
      const pop = Math.min(1, (now - (b.popAt || 0)) / 300);
      b.mesh.position.set(b.x, -(b.y + b.r * 0.35), 300);
      b.mesh.scale.setScalar(b.r * 2.3);
      if (b.food) {
        const bob = b.kind === next ? Math.abs(Math.sin(t * 4)) * b.r * 0.35 : 0;
        const bare = BARE.has(b.kind);
        b.food.position.set(b.x, -(b.y - (bare ? -b.r * 0.1 : b.r * 0.25) - bob), 360);
        b.food.scale.setScalar(b.r * (bare ? 1.9 : 1.35) * (0.3 + 0.7 * pop));
        b.food.rotation.set(0.25, Math.sin(t * 0.8 + b.x) * 0.4, 0);
      }
    }
    if (pp.stoveMesh) {
      const S = pp.stove, top = pp.floorY - S.h;
      pp.stoveMesh.position.set(S.x, -(pp.floorY - S.h / 2), 560);
      pp.stoveMesh.scale.set(S.w, S.h / pp.stoveH, S.w);
      pp.stoveMesh.rotation.x = 0.18;
      const fl = 0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.3);
      pp.glow.position.set(S.x, -(pp.floorY - S.h * 0.3), 590);
      pp.glow.scale.set(S.w * 0.2 * fl, S.h * 0.22 * fl, 1);
      pp.glow.material.opacity = 0.45 + 0.3 * fl;
      // steam: puffs rising from the pot (not while it's being poured out)
      const pouring = pp.pourAt && now - pp.pourAt < POUR_MS;
      for (const m of pp.steam) {
        const u = (t * 0.45 + m.userData.phase) % 1;
        m.visible = !pouring;
        m.position.set(pp.pot.x + Math.sin(u * 6 + m.userData.phase * 9) * pp.pot.r * 0.4, -(top - pp.pot.r * 1.5 - u * pp.sz * 0.22), 620);
        m.scale.setScalar(pp.pot.r * (0.08 + u * 0.18));
        m.material.opacity = 0.28 * Math.sin(u * Math.PI);
      }
    }
    if (pp.potMesh) {
      const P = pp.pot, bob = pp.potBob ? Math.max(0, 1 - (now - pp.potBob) / 400) : 0;
      let x = P.x, y = P.y, tip = 0, k = 1;
      const u = pp.pourAt ? (now - pp.pourAt) / POUR_MS : 9;
      if (u < 0.45) {                                   // tips over to the side, the stew pours out
        const e = Math.sin(Math.min(1, u / 0.3) * Math.PI / 2);
        tip = pp.pourDir * 1.9 * e; x += pp.pourDir * P.r * 0.5 * e;
        if (u > 0.15 && !pp.poured) { pp.poured = true; this.pour(pp); }
      } else if (u < 0.6) {                             // gone
        k = 0;
      } else if (u < 1) {                               // a fresh pot drops in, with a little bounce
        const v = (u - 0.6) / 0.4;
        y -= (1 - v) * (1 - v) * P.r * 3 - Math.sin(v * Math.PI) * P.r * 0.15 * (v > 0.7 ? 1 : 0);
      }
      pp.potMesh.visible = k > 0;
      pp.potMesh.position.set(x, -y, 600);
      pp.potMesh.rotation.set(0.42, 0, -tip);
      pp.potMesh.scale.set(P.r * 2 * (1 + bob * 0.08), P.r * 2 * (1 - bob * 0.06), P.r * 2);
      pp.potMesh.userData.stew.position.y = 0.02 + Math.sin(t * 6) * 0.01;
    }
    // what each paw is carrying
    for (const h of pp.hands) {
      if (h.item && (!h.mesh || h.meshKind !== h.item)) { if (h.mesh) this.stage.scene.remove(h.mesh); const tt = this.I[h.item]; h.mesh = new THREE.Mesh(tt.geo, tt.mat); h.meshKind = h.item; this.stage.scene.add(h.mesh); }
      if (!h.item && h.mesh) { this.stage.scene.remove(h.mesh); h.mesh = null; h.meshKind = null; }
      if (h.mesh) { h.mesh.position.set(h.pos.x, -h.pos.y, 700); h.mesh.scale.setScalar(pp.sz * 0.2); h.mesh.rotation.set(0.2, Math.sin(t * 2) * 0.3, 0); }
    }
    // dwell rings: how close a paw is to grabbing
    pp.ring.clear();
    for (const h of pp.hands) {
      if (!h.dwell) continue;
      const b = h.dwell.b, hr = input(pp.pl).hands?.[h.side];
      const need = hr ? DWELL_MS * 1.6 : DWELL_MS, u = Math.min(1, (now - h.dwell.since) / need);
      pp.ring.lineStyle(Math.max(4, b.r * 0.12), 0xffe08a, 0.95).beginPath().arc(b.x, b.y, b.r * 1.15, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2).strokePath();
    }
  }

  end() {
    this.state = 'done';
    this.banner.setText('Dinner is served! 🍲');
    for (const pp of this.p) for (const h of pp.hands) h.item = null;
    finishGame(this, this.p.map((pp) => ({
      slot: pp.pl.slot, score: pp.score, label: `🍲 ${pp.dishes} ${pp.dishes === 1 ? 'dish' : 'dishes'} · ⭐ ${pp.score}`,
    })), 2500);
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clampX = (R, x, m) => Math.max(R.x + m, Math.min(R.x + R.w - m, x));
const rect_ = (r) => ({ ...r });

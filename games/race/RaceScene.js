import { tracker, input } from '../../js/core.js';
import { W, H, txt, rng, session, ordinal, charImage, charById, setupPanes, UI_X } from '../../js/scenes/common.js';
import { OverlayText } from '../../js/stage3d.js';
import { Race3D } from './race3d.js';
import { finishGame } from '../../js/games.js';

const DH = 720;            // design height of one player's pane

const COURSE = 300;        // metres to the ark
const BASE_SPEED = 10;     // metres per second
const TOP_Y = 120;         // bottom of the sky band
const HORIZON_Y = 150;     // where the ground meets the sky
const GROUND_Y = 640;      // where the runner's feet are
const CAM_Z = 7;           // the camera is this many metres behind the runner
const VIEW = 45;           // how far ahead (m) things are drawn
const WINDOW_MS = 380;     // how recently you must have jumped/ducked when an obstacle arrives
const TREE_SCALE = 5.2;    // trees are ~5x as tall as the animals

// 3D projection: something `a` metres ahead of the runner is drawn at scale s
// (1 at the runner, smaller further away), and its ground point sits at y.
const scaleAt = (a) => CAM_Z / (Math.max(a, -CAM_Z * 0.85) + CAM_Z);
const groundY = (s) => HORIZON_Y + (GROUND_Y - HORIZON_Y) * s;
// z-order: nearer things are drawn on top of farther things. The runner is at depth 10.
const depthAt = (a) => 10 - a / 10;
const c_msgOff = (r) => r.c.runH + 50;
const fadeAt = (a) => Math.max(0, Math.min(1, (VIEW - a) / 6));

function makeCourse(seed) {
  const r = rng(seed);
  const obs = [];
  let d = 40;
  while (d < COURSE - 25) {
    const x = r();
    const type = x < 0.45 ? 'rock' : x < 0.6 ? 'log' : x < 0.8 ? 'lowBranch' : 'branch';
    if (type === 'rock') {
      // Boulders block 1 or 2 of the 3 lanes; at least one lane is always free.
      const free = Math.floor(r() * 3) - 1;
      const others = [-1, 0, 1].filter((l) => l !== free);
      const blocked = r() < 0.5 ? others : [others[Math.floor(r() * 2)]];
      const kind = r() < 0.5 ? 'tree' : 'boulder'; // what blocks the lanes
      obs.push({ d, type, blocked, free, kind, tree: r() < 0.5 ? 'prop_oak' : 'prop_twisty' });
    } else {
      obs.push({ d, type });
    }
    d += 14 + r() * 8;
  }
  return obs;
}

export class RaceScene extends Phaser.Scene {
  static KEY = 'Race';
  constructor() { super('Race'); }

  create() {
    session.seed = (Math.random() * 1e9) | 0;
    this.course = makeCourse(session.seed);
    const players = tracker.players;
    this.layout = setupPanes(this, players.length, DH);
    this.cols = this.layout.panes;
    // the actual running track inside each pane (panes can be wide)
    for (const c of this.cols) {
      c.runH = Math.min(190, c.w * 0.72 / 4); // runner height: everything is sized relative to it
      c.tw = c.runH * 4;                      // track = 3 lanes, each ~1.3x as wide as an animal is tall
      c.tx = c.cx - c.tw / 2;
      c.treeH = c.runH * TREE_SCALE;        // a tree right beside the runner (taller than the screen)
    }

    this.bg = this.add.graphics().setDepth(0);         // meadow, track, grass
    this.shadowG = this.add.graphics().setDepth(1);    // shadows lying on the ground
    this.nullG = this.add.graphics().setVisible(false); // sink for 2D shadows when 3D props are shown
    this.top = this.add.graphics().setDepth(30);       // sky band, clouds, rain, progress bars
    this.pool = new Map();
    // Scenery: trees along the track edges, same for every column
    const r0 = rng(session.seed ^ 0x77);
    this.decor = [];
    for (let d = -6; d < COURSE + VIEW; d += 5 + r0() * 6) {
      this.decor.push({ d, side: r0() < 0.5 ? -1 : 1, key: ['prop_oak', 'prop_birch', 'prop_twisty', 'prop_boulder', 'prop_rocks'][Math.floor(r0() * 5)] });
    }
    this.runners = players.map((pl, i) => {
      const c = this.cols[i];
      return {
        pl, c, dist: 0, speed: 0, laneX: c.cx, stumbleUntil: 0,
        lastJump: -1e9, lastDuck: -1e9, nextObs: 0, place: 0,
        shadow: this.add.ellipse(c.cx, GROUND_Y, Math.min(110, c.tw * 0.3), 22, 0x000000, 0.25).setDepth(1.5),
        sprite: charImage(this, c.cx, GROUND_Y, pl.animal || 'bear', 'back', c.runH).setDepth(depthAt(0)),
        ark: this.add.graphics(),
        msg: this.add.text(c.cx, GROUND_Y - 230, '', txt(30, '#ffffff', { stroke: '#1d3b52', strokeThickness: 6 })).setOrigin(0.5).setDepth(40),
        lost: this.add.text(c.cx, 380, '', txt(26, '#ffffff', { stroke: '#9b3b2f', strokeThickness: 6, wordWrap: { width: c.tw - 30 } })).setOrigin(0.5).setDepth(40),
        labels: [],
        tag: this.add.text(c.x + 20, 70, `P${pl.slot + 1} · ${charById(pl.animal).name}`, txt(26, pl.css, { stroke: '#10202b', strokeThickness: 5 })).setOrigin(0, 0.5).setDepth(41),
      };
    });
    // Text labels for obstacles are pooled per column
    this.runners.forEach((r) => {
      for (let i = 0; i < 6; i++) r.labels.push(this.add.text(0, 0, '', txt(24, '#ffffff', { stroke: '#000', strokeThickness: 5 })).setOrigin(0.5).setVisible(false).setDepth(39));
    });

    // big messages drawn above the 3D layer (so trees never hide them)
    this.banner = new OverlayText(this.game, W / 2, H / 2 - 40, 110);
    this.events.once('shutdown', () => this.banner.destroy());
    this.help = this.add.text(UI_X + W / 2, H / 2 + 60, 'The flood is coming — run on the spot and swing your arms to go faster!\nLean around rocks and trees · jump over logs and low branches · duck under high ones',
      txt(26, '#fff8e6', { stroke: '#1d3b52', strokeThickness: 6 })).setOrigin(0.5).setDepth(10);

    // 3D characters drawn over the 2.5D world (for characters that have a model)
    try {
      this.r3d = new Race3D(this.game, { DH, TOP_Y, HORIZON_Y, GROUND_Y, CAM_Z, VIEW, TREE_SCALE });
      this.r3d.setRunners(this.runners);
      this.r3d.setWorld(this.course, session.seed, COURSE);
      this.runners.forEach((r) => this.r3d.addRunner(r).catch((e) => console.warn('3D runner', e)));
      this.events.once('shutdown', () => { this.r3d?.destroy(); this.r3d = null; });
    } catch (e) { console.warn('3D layer unavailable', e); this.r3d = null; }

    this.state = 'countdown';
    this.finishCount = 0;
    this.firstFinishAt = 0;
    this.rainT = 0;
    // READY?? 3! 2! 1! GO!!!  — while "READY??" is up everyone is standing facing the
    // screen, so that's when each player's normal standing posture is measured again
    this.banner.setText('READY??');
    const steps = [
      [1800, () => {
        for (const r of this.runners) if (r.pl.kind === 'camera' && r.pl.body && input(r.pl).present) r.pl.body.calibrateFromCurrent();
        this.banner.setText('3!');
      }],
      [2800, () => this.banner.setText('2!')],
      [3800, () => this.banner.setText('1!')],
      [4800, () => { this.banner.setText('GO!!!'); this.help.setText(''); this.state = 'run'; this.runStart = this.time.now; }],
      [5800, () => { if (this.banner.text === 'GO!!!') this.banner.setText(''); }],
    ];
    for (const [ms, fn] of steps) this.time.delayedCall(ms, fn);
  }

  update(time, delta) {
    const dt = Math.min(delta, 100) / 1000;
    const now = performance.now();
    this.rainT += dt;
    this.drawBackground();
    this.shadowG.clear(); this.nullG.clear();
    this.hide2D = !!(this.r3d && this.r3d.propsReady);   // 3D trees/rocks/logs replace the 2D ones
    for (const list of this.pool.values()) { list.used = 0; list.forEach((im) => im.setVisible(false)); }

    for (const r of this.runners) {
      const inp = input(r.pl);
      if (inp.jumping) r.lastJump = now;
      if (inp.ducking) r.lastDuck = now;
      r.lost.setText(inp.present ? '' : 'Come back into view!');

      // Movement
      // the animal glides to where the player's (multiplied) sideways position puts it
      const targetX = r.c.cx + (inp.side ?? inp.lane) * r.c.tw / 3;
      r.laneX += (targetX - r.laneX) * Math.min(1, dt * 10);

      if (this.state === 'run' && !r.place) {
        // Running on the spot or swinging the arms (alternately) makes you faster: 60% … ~170% speed.
        const runBoost = 0.6 + 0.9 * (inp.run || 0);
        const target = !inp.present ? 0 : now < r.stumbleUntil ? BASE_SPEED * 0.35 : BASE_SPEED * runBoost;
        r.speed += (target - r.speed) * Math.min(1, dt * 3);
        r.dist += r.speed * dt;
        // Obstacles reaching the runner
        while (r.nextObs < this.course.length && this.course[r.nextObs].d <= r.dist) {
          const o = this.course[r.nextObs++];
          this.resolve(r, o, inp, now);
        }
        if (r.dist >= COURSE) {
          r.dist = COURSE; r.place = ++this.finishCount;
          r.time = (this.time.now - this.runStart) / 1000;          // seconds to the ark (the Hall of Fame score)
          r.msg.setText(r.place === 1 ? '1st! 🎉' : ordinal(r.place) + '!');
          if (r.place === 1) this.firstFinishAt = time;
        }
      }

      // Scenery: trees and boulders beside the track, in 3D perspective
      for (const dcr of this.hide2D ? [] : this.decor) {
        const ahead = dcr.d - r.dist;
        if (ahead < -CAM_Z * 0.7 || ahead > VIEW) continue;
        const sc = scaleAt(ahead), y = groundY(sc);
        const rocky = dcr.key.includes('rock') || dcr.key.includes('boulder');
        const im = this.sprite(dcr.key, depthAt(ahead)).setOrigin(0.5, 1).setAlpha(fadeAt(ahead));
        this.fitHeight(im, r.c.treeH * (rocky ? 0.38 : 1) * sc);
        // sideways position measured at the runner, then shrunk with distance
        const halfW1 = im.displayWidth / sc / 2;
        const lat = r.c.tw / 2 + halfW1 * (rocky ? 1.0 : 0.6);
        im.setPosition(r.c.cx + dcr.side * lat * sc, y);
        im.setFlipX(dcr.side > 0);
      }

      // Obstacles ahead, in 3D perspective
      let li = 0;
      r.labels.forEach((l) => l.setVisible(false));
      for (let i = r.nextObs; i < this.course.length; i++) {
        const o = this.course[i];
        const ahead = o.d - r.dist;
        if (ahead > VIEW) break;
        const label = this.drawObstacle(r.c, o, ahead);
        if (label && li < r.labels.length) {
          r.labels[li++].setText(label.text).setPosition(r.c.cx, label.y).setScale(0.6 + 0.4 * scaleAt(ahead)).setAlpha(fadeAt(ahead)).setVisible(true);
        }
      }
      // The ark appears at the finish line
      r.ark.clear();
      const arkAhead = COURSE - r.dist;
      if (arkAhead < VIEW) this.drawArk(r.ark, r.c, arkAhead);

      // Runner sprite
      const jumpK = Math.max(0, 1 - (now - r.lastJump) / 450);
      const ducking = now - r.lastDuck < 120;
      const wobble = now < r.stumbleUntil ? Math.sin(time / 40) * 0.3 : 0;
      // Bob while running, hop when jumping, squash when ducking
      r.bobT = (r.bobT || 0) + dt * r.speed * 1.4;
      const bob = r.speed > 1 ? Math.abs(Math.sin(r.bobT)) * 8 : 0;
      const bs = r.sprite.baseScale;
      r.sprite.setPosition(r.laneX, GROUND_Y - jumpK * 60 - bob);
      r.sprite.setScale(bs * (1 + jumpK * 0.15), bs * (ducking ? 0.55 : 1 + jumpK * 0.15));
      r.sprite.setRotation(wobble);
      r.anim = { x: r.laneX, y: GROUND_Y, speed: r.speed, jump: jumpK, duck: ducking, wobble: wobble * 0.6,
        pts: r.pl.kind === 'camera' && inp.present ? r.pl.body.vpts : null };   // 3D characters copy the player's arms
      r.shadow.setPosition(r.laneX, GROUND_Y).setScale(1 - jumpK * 0.4);
      r.msg.setPosition(r.c.cx, GROUND_Y - c_msgOff(r));

      this.drawProgress(this.top, r);
    }

    if (this.r3d) this.r3d.render(dt);

    // End of race: everyone finished, or 12 s after the winner
    if (this.state === 'run') {
      const all = this.runners.every((r) => r.place);
      if (all || (this.firstFinishAt && time - this.firstFinishAt > 12000)) {
        this.state = 'done';
        // Anyone still running is placed by distance
        [...this.runners].filter((r) => !r.place).sort((a, b) => b.dist - a.dist)
          .forEach((r) => { r.place = ++this.finishCount; });
        this.banner.setText('Made it! 🛶');
        // scores for the base: a faster time is better; only those who reached the ark go in the Hall of Fame
        finishGame(this, this.runners.map((r) => (r.time
          ? { slot: r.pl.slot, score: -r.time, label: `${r.time.toFixed(1)} s` }
          : { slot: r.pl.slot, score: -10000 + r.dist, label: 'didn’t finish', hof: false })), 2500);
      }
    }
  }

  resolve(r, o, inp, now) {
    let ok;
    // boulders: judged by the lane the animal is actually in on screen (what you see is what counts)
    const lane = Math.max(-1, Math.min(1, Math.round((r.laneX - r.c.cx) / (r.c.tw / 3))));
    if (o.type === 'rock') ok = !o.blocked.includes(lane);
    else if (o.type === 'log' || o.type === 'lowBranch') ok = now - r.lastJump < WINDOW_MS || inp.jumping;
    else ok = now - r.lastDuck < WINDOW_MS || inp.ducking;
    if (ok) {
      r.msg.setText(['Nice!', 'Great!', 'Woohoo!', 'Yes!'][Math.floor(Math.random() * 4)]);
    } else {
      r.stumbleUntil = now + 1100;
      r.msg.setText('Oops!');
      r.c.cam.shake(120, 0.004);
    }
    this.time.delayedCall(700, () => { if (!r.place) r.msg.setText(''); });
  }

  // Reusable images: one pool per texture, reset every frame.
  sprite(key, depth) {
    let list = this.pool.get(key);
    if (!list) { list = []; list.used = 0; this.pool.set(key, list); }
    let im = list[list.used];
    if (!im) { im = this.add.image(0, 0, key); list.push(im); }
    list.used++;
    return im.setVisible(!this.hide2D).setDepth(depth).setRotation(0).setFlipX(false);
  }
  fitHeight(im, h) { im.setScale(h / im.height); return im; }

  drawObstacle(c, o, ahead) {
    const sc = scaleAt(ahead), y = groundY(sc), dep = depthAt(ahead), alpha = fadeAt(ahead);
    const laneW = c.tw / 3;
    const X = (lat) => c.cx + lat * sc;          // lat = sideways offset in px, measured at the runner
    if (o.type === 'rock') {
      const b = [...o.blocked].sort((p, q) => p - q);
      if (o.kind === 'tree') {
        // a full-size tree standing in each blocked lane
        for (const l of b) {
          const im = this.sprite(o.tree, dep).setOrigin(0.5, 0.97).setPosition(X(l * laneW), y).setAlpha(alpha);
          this.fitHeight(im, c.treeH * sc);
          im.setFlipX(l > 0);
        }
        return null;
      }
      // huge boulders fill whole lanes: one per lane, or a rock pile across two side-by-side lanes
      const adjacent = b.length === 2 && b[1] - b[0] === 1;
      const groups = adjacent ? [[b[0], b[1]]] : b.map((l) => [l]);
      for (const gr of groups) {
        const mid = (gr[0] + gr[gr.length - 1]) / 2;
        const key = gr.length === 2 ? 'prop_rocks' : (gr[0] === 0 ? 'prop_rock' : 'prop_boulder');
        const im = this.sprite(key, dep).setOrigin(0.5, 0.85).setPosition(X(mid * laneW), y).setAlpha(alpha);
        // sized by the animals: a boulder is ~1.4x as tall as an animal, a rock pile ~1.7x
        this.fitHeight(im, c.runH * (gr.length === 2 ? 1.7 : 1.4) * sc);
      }
      return null;
    }
    if (o.type === 'log') {
      const lh = c.runH * 0.45 * sc;   // a log about half as tall as the animals: jumpable
      this.sprite('prop_log', dep).setOrigin(0.5, 0.85).setPosition(c.cx, y).setAlpha(alpha)
        .setDisplaySize(c.tw * 0.95 * sc, lh);
      return { text: 'JUMP!', y: y - lh - 18 };
    }
    // Branches stretch across the whole track between two full-size birch trees.
    // High branch = duck under it, low branch = jump over it. Its shadow on the
    // ground shows where it is; the gap between branch and shadow shows how high.
    const high = o.type === 'branch';
    const lift = c.runH * (high ? 0.75 : 0.2) * sc;   // head height vs knee height of the animals
    const sw = c.tw * sc, sh = Math.max(4, c.runH * 0.14 * sc);
    const sg = this.hide2D ? this.nullG : this.shadowG;
    if (high) {
      sg.fillStyle(0x1d3b1a, 0.12 * alpha).fillEllipse(c.cx, y, sw * 1.04, sh * 2.2);
      sg.fillStyle(0x1d3b1a, 0.22 * alpha).fillEllipse(c.cx, y, sw * 0.96, sh * 1.2);
    } else {
      sg.fillStyle(0x1d3b1a, 0.45 * alpha).fillEllipse(c.cx, y, sw, sh);
    }
    for (const side of [-1, 1]) {
      const post = this.sprite('prop_birch', dep).setOrigin(0.5, 0.98).setPosition(X(side * c.tw / 2), y).setAlpha(alpha);
      this.fitHeight(post, c.treeH * sc);
      post.setFlipX(side > 0);
    }
    const thick = Math.max(4, c.runH * 0.13 * sc);
    const bar = this.sprite('prop_stick', dep + 0.001).setOrigin(0.5, 0.5).setPosition(c.cx, y - lift).setAlpha(alpha);
    bar.setDisplaySize(thick, c.tw * 1.02 * sc);
    bar.setRotation(Math.PI / 2);
    return { text: high ? 'DUCK!' : 'JUMP!', y: y - lift - thick - 16 };
  }

  drawArk(g, c, ahead) {
    const sc = scaleAt(ahead), y = groundY(sc);
    g.setDepth(depthAt(ahead)).setAlpha(fadeAt(ahead));
    const w = c.tw * 1.1 * sc, hh = c.runH * 0.9 * sc;
    g.fillStyle(0x7a4a22, 1);
    g.fillPoints([
      { x: c.cx - w / 2, y: y - hh }, { x: c.cx + w / 2, y: y - hh },
      { x: c.cx + w / 2 - w * 0.12, y }, { x: c.cx - w / 2 + w * 0.12, y },
    ], true);
    g.fillStyle(0xa86b36, 1).fillRect(c.cx - w * 0.3, y - hh * 2, w * 0.6, hh);
    g.fillStyle(0x5a3416, 1).fillRect(c.cx - w * 0.06, y - hh * 1.8, w * 0.12, hh * 0.8);
  }

  drawProgress(g, r) {
    const x0 = r.c.x + 20, x1 = r.c.x + r.c.w - 50, y = 96;
    g.fillStyle(0xffffff, 0.5).fillRoundedRect(x0, y - 6, x1 - x0, 12, 6);
    g.fillStyle(r.pl.color, 1).fillRoundedRect(x0, y - 6, (x1 - x0) * (r.dist / COURSE), 12, 6);
    g.fillStyle(0x7a4a22, 1).fillRect(x1 + 8, y - 10, 24, 14);
  }

  drawBackground() {
    const g = this.bg; g.clear();
    const t = this.top; t.clear();
    this.cols.forEach((c, i) => {
      const dist = this.runners ? this.runners[i].dist : 0;
      const near = -CAM_Z * 0.7;
      const P = (a, lat) => { const sc = scaleAt(a); return { x: c.cx + lat * sc, y: groundY(sc) }; };
      const quad = (a1, a2, l1, l2) => [P(a1, l1), P(a1, l2), P(a2, l2), P(a2, l1)];

      // meadow, with a hazy strip at the horizon
      g.fillStyle(0x5b9a45, 1).fillRect(c.x, TOP_Y, c.w, DH - TOP_Y);
      g.fillGradientStyle(0x9fb7a0, 0x9fb7a0, 0x5b9a45, 0x5b9a45, 1).fillRect(c.x, TOP_Y, c.w, HORIZON_Y - TOP_Y + 30);

      // the running track narrows towards the horizon
      const hw = c.tw / 2;
      g.fillStyle(0x6fae4f, 1).fillPoints(quad(near, VIEW + 20, -hw, hw), true);
      // mowed stripes every 3 m, fixed to the ground
      g.fillStyle(0x7fbd5d, 1);
      for (let m = Math.floor((dist + near) / 6) * 6; m < dist + VIEW + 20; m += 6) {
        const a1 = Math.max(near, m - dist), a2 = Math.min(VIEW + 20, m + 3 - dist);
        if (a2 > a1) g.fillPoints(quad(a1, a2, -hw, hw), true);
      }
      // no lane markings or edge lines: the path should look like grass, not a road

      // grass tufts and little flowers, fixed to the ground
      for (let m = Math.floor(dist + near); m <= dist + VIEW; m++) {
        for (let k = 0; k < 5; k++) {
          const h = Math.sin(m * 12.9898 + k * 78.233 + i * 3.1) * 43758.5453;
          const fx = h - Math.floor(h);
          const h2 = Math.sin(m * 4.1 + k * 9.7) * 1234.5;
          const fy = h2 - Math.floor(h2);
          const a = m + fy - dist;
          if (a < near) continue;
          const sc = scaleAt(a);
          const p = P(a, (fx - 0.5) * c.w * 1.3);
          if (p.x < c.x || p.x > c.x + c.w || p.y > DH) continue;
          if (k === 2 && fx > 0.6) {
            g.fillStyle(fy > 0.5 ? 0xfff3a6 : 0xffffff, 1).fillCircle(p.x, p.y, 4 * sc);
            g.fillStyle(0xf2b544, 1).fillCircle(p.x, p.y, 1.8 * sc);
          } else {
            g.lineStyle(Math.max(1, 2.4 * sc), 0x4f8f39, 0.9);
            g.lineBetween(p.x, p.y, p.x - 5 * sc, p.y - 11 * sc); g.lineBetween(p.x, p.y, p.x, p.y - 13 * sc); g.lineBetween(p.x, p.y, p.x + 5 * sc, p.y - 11 * sc);
          }
        }
      }

      // sky band with storm clouds, drawn above everything
      t.fillGradientStyle(0x4b5563, 0x4b5563, 0x6b7a86, 0x6b7a86, 1).fillRect(c.x, 0, c.w, TOP_Y);
      t.fillStyle(0x374151, 1);
      const nC = Math.ceil(c.w / 160) + 2;
      for (let j = 0; j < nC; j++) t.fillCircle(c.x + ((j * 160 + this.rainT * 20) % (nC * 160)) - 80, 30 + (j % 2) * 18, 60);
      // rain over the whole pane
      t.lineStyle(2, 0xcfe3f5, 0.45);
      const nR = Math.round(70 * c.w / 1280) + 20;
      for (let j = 0; j < nR; j++) {
        const x = c.x + (j * 97 + this.rainT * 120) % c.w;
        const y = (j * 53 + this.rainT * 700) % DH;
        t.lineBetween(x, y, x - 6, y + 18);
      }
    });
  }
}

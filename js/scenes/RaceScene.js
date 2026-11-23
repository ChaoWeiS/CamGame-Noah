import { tracker, input } from '../core.js';
import { W, H, txt, rng, session, ordinal, charImage, charById, setupPanes, UI_X } from './common.js';

const DH = 720;            // design height of one player's pane

const COURSE = 300;        // metres to the ark
const BASE_SPEED = 10;     // metres per second
const PX_PER_M = 16;       // 30 m of track visible ahead
const RUNNER_Y = 610;
const TOP_Y = 120;
const WINDOW_MS = 380;
const TREE_NEAR_H = 980;  // height of a tree right next to the runner (taller than the 720 screen)     // how recently you must have jumped/ducked when an obstacle arrives

// Things further up the track are drawn a bit smaller, for a sense of depth.
const depthScale = (y) => 0.55 + 0.45 * Math.max(0, Math.min(1, (y - TOP_Y) / (RUNNER_Y - TOP_Y)));

function makeCourse(seed) {
  const r = rng(seed);
  const obs = [];
  let d = 40;
  while (d < COURSE - 25) {
    const x = r();
    const type = x < 0.5 ? 'rock' : x < 0.75 ? 'log' : 'branch';
    if (type === 'rock') {
      // Boulders block 1 or 2 of the 3 lanes; at least one lane is always free.
      const free = Math.floor(r() * 3) - 1;
      const others = [-1, 0, 1].filter((l) => l !== free);
      const blocked = r() < 0.5 ? others : [others[Math.floor(r() * 2)]];
      obs.push({ d, type, blocked, free });
    } else {
      obs.push({ d, type });
    }
    d += 14 + r() * 8;
  }
  return obs;
}

export class RaceScene extends Phaser.Scene {
  constructor() { super('Race'); }

  create() {
    session.seed = (Math.random() * 1e9) | 0;
    this.course = makeCourse(session.seed);
    const players = tracker.players;
    this.layout = setupPanes(this, players.length, DH);
    this.cols = this.layout.panes;
    // the actual running track inside each pane (panes can be wide)
    for (const c of this.cols) { c.tw = Math.min(c.w * 0.72, 760); c.tx = c.cx - c.tw / 2; }

    this.bg = this.add.graphics().setDepth(0);
    this.g = this.add.graphics().setDepth(3);
    this.top = this.add.graphics().setDepth(6); // sky band, clouds, rain, progress bars
    this.pool = new Map();
    // Scenery: trees along the track edges, same for every column
    const r0 = rng(session.seed ^ 0x77);
    this.decor = [];
    for (let d = 6; d < COURSE + 40; d += 7 + r0() * 6) {
      this.decor.push({ d, side: r0() < 0.5 ? -1 : 1, key: ['prop_oak', 'prop_birch', 'prop_twisty', 'prop_boulder', 'prop_rocks'][Math.floor(r0() * 5)] });
    }
    this.runners = players.map((pl, i) => {
      const c = this.cols[i];
      return {
        pl, c, dist: 0, speed: 0, laneX: c.cx, stumbleUntil: 0,
        lastJump: -1e9, lastDuck: -1e9, nextObs: 0, place: 0,
        shadow: this.add.ellipse(c.cx, RUNNER_Y + 30, Math.min(110, c.tw * 0.3), 22, 0x000000, 0.25).setDepth(4),
        sprite: charImage(this, c.cx, RUNNER_Y + 30, pl.animal || 'bear', 'back', Math.min(190, c.tw * 0.5)).setDepth(5),
        msg: this.add.text(c.cx, RUNNER_Y - 110, '', txt(30, '#ffffff', { stroke: '#1d3b52', strokeThickness: 6 })).setOrigin(0.5).setDepth(8),
        lost: this.add.text(c.cx, 380, '', txt(26, '#ffffff', { stroke: '#9b3b2f', strokeThickness: 6, wordWrap: { width: c.tw - 30 } })).setOrigin(0.5).setDepth(8),
        labels: [],
        tag: this.add.text(c.x + 20, 70, `P${pl.slot + 1} · ${charById(pl.animal).name}`, txt(26, pl.css, { stroke: '#10202b', strokeThickness: 5 })).setOrigin(0, 0.5).setDepth(7),
      };
    });
    // Text labels for obstacles are pooled per column
    this.runners.forEach((r) => {
      for (let i = 0; i < 4; i++) r.labels.push(this.add.text(0, 0, '', txt(24, '#ffffff', { stroke: '#000', strokeThickness: 5 })).setOrigin(0.5).setVisible(false).setDepth(7));
    });

    this.banner = this.add.text(UI_X + W / 2, H / 2 - 40, '', txt(90, '#fff8e6', { stroke: '#1d3b52', strokeThickness: 12 })).setOrigin(0.5).setDepth(10);
    this.help = this.add.text(UI_X + W / 2, H / 2 + 60, 'The flood is coming — run to the ark!\nLean to dodge rocks · jump over logs · duck under branches',
      txt(26, '#fff8e6', { stroke: '#1d3b52', strokeThickness: 6 })).setOrigin(0.5).setDepth(10);

    this.state = 'countdown';
    this.finishCount = 0;
    this.firstFinishAt = 0;
    this.rainT = 0;
    let n = 3;
    this.banner.setText('3');
    this.time.addEvent({
      delay: 1000, repeat: 3, callback: () => {
        n--;
        if (n > 0) this.banner.setText(String(n));
        else if (n === 0) { this.banner.setText('GO!'); this.help.setText(''); this.state = 'run'; }
        else this.banner.setText('');
      },
    });
  }

  update(time, delta) {
    const dt = Math.min(delta, 100) / 1000;
    const now = performance.now();
    this.rainT += dt;
    this.drawBackground();
    const g = this.g; g.clear();
    for (const list of this.pool.values()) { list.used = 0; list.forEach((im) => im.setVisible(false)); }

    for (const r of this.runners) {
      const inp = input(r.pl);
      if (inp.jumping) r.lastJump = now;
      if (inp.ducking) r.lastDuck = now;
      r.lost.setText(inp.present ? '' : 'Come back into view!');

      // Movement
      const targetX = r.c.cx + inp.lane * r.c.tw / 3;
      r.laneX += (targetX - r.laneX) * Math.min(1, dt * 14);

      if (this.state === 'run' && !r.place) {
        const target = !inp.present ? 0 : now < r.stumbleUntil ? BASE_SPEED * 0.35 : BASE_SPEED;
        r.speed += (target - r.speed) * Math.min(1, dt * 3);
        r.dist += r.speed * dt;
        // Obstacles reaching the runner
        while (r.nextObs < this.course.length && this.course[r.nextObs].d <= r.dist) {
          const o = this.course[r.nextObs++];
          this.resolve(r, o, inp, now);
        }
        if (r.dist >= COURSE) {
          r.dist = COURSE; r.place = ++this.finishCount;
          r.msg.setText(r.place === 1 ? '1st! 🎉' : ordinal(r.place) + '!');
          if (r.place === 1) this.firstFinishAt = time;
        }
      }

      // Scenery trees at the track edges (far ones first so near ones overlap them)
      for (let i = this.decor.length - 1; i >= 0; i--) {
        const dcr = this.decor[i];
        const ahead = dcr.d - r.dist;
        if (ahead < -8 || ahead > 34) continue;
        const y = RUNNER_Y - ahead * PX_PER_M;
        if (y < TOP_Y + 10) continue;
        // Big trees: near ones are taller than the screen, so their tops are cut off.
        const rocky = dcr.key.includes('rock') || dcr.key.includes('boulder');
        const k = depthScale(y);
        const h = TREE_NEAR_H * Math.pow(k, 1.6) * (rocky ? 0.38 : 1);
        const im = this.sprite(dcr.key, 1 + y / 10000).setOrigin(0.5, 1);
        this.fitHeight(im, h);
        const halfW = im.displayWidth / 2;
        // stand beside the track; canopies may lean a little over its edge
        const off = halfW * (rocky ? 0.95 : 0.55); // boulders stay off the track
        const x = dcr.side < 0 ? r.c.tx - off : r.c.tx + r.c.tw + off;
        im.setPosition(x, y);
        im.setFlipX(dcr.side > 0);
      }

      // Draw obstacles ahead in this column
      let li = 0;
      r.labels.forEach((l) => l.setVisible(false));
      for (let i = r.nextObs; i < this.course.length; i++) {
        const o = this.course[i];
        const ahead = o.d - r.dist;
        if (ahead > 30) break;
        const y = RUNNER_Y - ahead * PX_PER_M;
        if (y < TOP_Y) continue;
        const label = this.drawObstacle(g, r.c, o, y);
        if (label && li < r.labels.length) {
          r.labels[li++].setText(label).setPosition(r.c.cx, label === 'DUCK!' ? y - Math.pow(depthScale(y), 1.4) * Math.min(330, r.c.tw * 0.55) * 0.6 - 14 : y - depthScale(y) * 50 - 12).setVisible(true);
        }
      }
      // The ark appears near the end
      const arkAhead = COURSE - r.dist;
      if (arkAhead < 30) this.drawArk(g, r.c, RUNNER_Y - arkAhead * PX_PER_M - 40);

      // Runner sprite
      const jumpK = Math.max(0, 1 - (now - r.lastJump) / 450);
      const ducking = now - r.lastDuck < 120;
      const wobble = now < r.stumbleUntil ? Math.sin(time / 40) * 0.3 : 0;
      // Bob while running, hop when jumping, squash when ducking
      const bob = r.speed > 1 ? Math.abs(Math.sin(time / 110)) * 6 : 0;
      const bs = r.sprite.baseScale;
      r.sprite.setPosition(r.laneX, RUNNER_Y + 30 - jumpK * 60 - bob);
      r.sprite.setScale(bs * (1 + jumpK * 0.15), bs * (ducking ? 0.55 : 1 + jumpK * 0.15));
      r.sprite.setRotation(wobble);
      r.shadow.setPosition(r.laneX, RUNNER_Y + 30).setScale(1 - jumpK * 0.4);
      r.msg.setPosition(r.c.cx, RUNNER_Y - 200);

      this.drawProgress(this.top, r);
    }

    // End of race: everyone finished, or 12 s after the winner
    if (this.state === 'run') {
      const all = this.runners.every((r) => r.place);
      if (all || (this.firstFinishAt && time - this.firstFinishAt > 12000)) {
        this.state = 'done';
        // Anyone still running is placed by distance
        [...this.runners].filter((r) => !r.place).sort((a, b) => b.dist - a.dist)
          .forEach((r) => { r.place = ++this.finishCount; });
        session.race = this.runners.map((r) => ({ slot: r.pl.slot, place: r.place }));
        this.banner.setText('Made it! 🛶');
        this.time.delayedCall(2500, () => this.scene.start('Password'));
      }
    }
  }

  resolve(r, o, inp, now) {
    let ok;
    if (o.type === 'rock') ok = !o.blocked.includes(inp.lane);
    else if (o.type === 'log') ok = now - r.lastJump < WINDOW_MS || inp.jumping;
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
    return im.setVisible(true).setDepth(depth).setRotation(0).setFlipX(false);
  }
  fitHeight(im, h) { im.setScale(h / im.height); return im; }

  drawObstacle(g, c, o, y) {
    const half = c.tw * 0.46;
    if (o.type === 'rock') {
      // Huge boulders fill whole lanes: one boulder per lane, or a rock pile across two side-by-side lanes.
      const laneW = c.tw / 3;
      const grow = 0.8 + 0.2 * depthScale(y);
      const b = [...o.blocked].sort((p, q) => p - q);
      const adjacent = b.length === 2 && b[1] - b[0] === 1;
      const groups = adjacent ? [[b[0], b[1]]] : b.map((l) => [l]);
      for (const gr of groups) {
        const mid = (gr[0] + gr[gr.length - 1]) / 2;
        const key = gr.length === 2 ? 'prop_rocks' : (gr[0] === 0 ? 'prop_rock' : 'prop_boulder');
        const im = this.sprite(key, 2 + y / 10000).setOrigin(0.5, 0.85).setPosition(c.cx + mid * laneW, y);
        im.setScale((laneW * gr.length * 0.98 * grow) / im.width);
      }
      return null;
    }
    if (o.type === 'log') {
      const im = this.sprite('prop_log', 2 + y / 10000).setOrigin(0.5, 0.5).setPosition(c.cx, y);
      const k = depthScale(y);
      im.setDisplaySize(half * 2 * (0.75 + 0.25 * k), k * Math.min(85, half * 0.5));
      return 'JUMP!';
    }
    // branch (duck): a long stick held up between two small trees
    const postH = Math.pow(depthScale(y), 1.4) * Math.min(330, c.tw * 0.55);
    this.fitHeight(this.sprite('prop_birch', 2 + y / 10000).setOrigin(0.5, 1).setPosition(c.cx - half, y + 16), postH);
    this.fitHeight(this.sprite('prop_birch', 2 + y / 10000).setOrigin(0.5, 1).setPosition(c.cx + half, y + 16), postH).setFlipX(true);
    const bar = this.sprite('prop_stick', 2.5 + y / 10000).setOrigin(0.5, 0.5).setPosition(c.cx, y - postH * 0.45);
    bar.setDisplaySize(Math.max(22, postH * 0.13), half * 2.1);
    bar.setRotation(Math.PI / 2);
    return 'DUCK!';
  }

  drawArk(g, c, y) {
    const w = Math.min(260, c.tw * 0.6);
    g.fillStyle(0x7a4a22, 1);
    g.fillPoints([
      { x: c.cx - w / 2, y: y }, { x: c.cx + w / 2, y: y },
      { x: c.cx + w / 2 - 25, y: y + 45 }, { x: c.cx - w / 2 + 25, y: y + 45 },
    ], true);
    g.fillStyle(0xa86b36, 1).fillRect(c.cx - w * 0.3, y - 40, w * 0.6, 40);
    g.fillStyle(0x5a3416, 1).fillRect(c.cx - 14, y - 30, 28, 30);
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
      // meadow around the track
      g.fillStyle(0x5b9a45, 1).fillRect(c.x, 0, c.w, DH);
      // the running track
      const x0 = c.tx, w = c.tw;
      g.fillStyle(0x6fae4f, 1).fillRect(x0, TOP_Y, w, DH - TOP_Y);
      // mowed stripes scroll toward the player
      const band = 64, off = (dist * PX_PER_M) % (band * 2);
      g.fillStyle(0x7fbd5d, 1);
      for (let y = TOP_Y - band * 2 + off; y < DH; y += band * 2) {
        const top = Math.max(TOP_Y, y), bot = Math.min(DH, y + band);
        if (bot > top) g.fillRect(x0, top, w, bot - top);
      }
      // grass tufts and little flowers, fixed to the ground (also on the meadow)
      const m0 = Math.floor(dist - 6), m1 = Math.ceil(dist + 32);
      for (let m = m0; m <= m1; m++) {
        for (let k = 0; k < 4; k++) {
          const h = Math.sin(m * 12.9898 + k * 78.233 + i * 3.1) * 43758.5453;
          const fx = h - Math.floor(h);
          const h2 = Math.sin(m * 4.1 + k * 9.7) * 1234.5;
          const fy = h2 - Math.floor(h2);
          const y = RUNNER_Y - (m + fy - dist) * PX_PER_M;
          if (y < TOP_Y + 4 || y > DH - 4) continue;
          const x = c.x + 8 + fx * (c.w - 16);
          if (k === 2 && fx > 0.6) {
            g.fillStyle(fy > 0.5 ? 0xfff3a6 : 0xffffff, 1).fillCircle(x, y, 3.5);
            g.fillStyle(0xf2b544, 1).fillCircle(x, y, 1.5);
          } else {
            g.lineStyle(2, 0x4f8f39, 0.9);
            g.lineBetween(x, y, x - 4, y - 9); g.lineBetween(x, y, x, y - 11); g.lineBetween(x, y, x + 4, y - 9);
          }
        }
      }
      // faint lane guides
      g.lineStyle(3, 0xffffff, 0.18);
      for (const k of [-0.15, 0.15]) {
        const lx = c.cx + k * c.tw;
        const o2 = (dist * PX_PER_M) % 40;
        for (let y = TOP_Y - 40 + o2; y < DH; y += 40) g.lineBetween(lx, Math.max(TOP_Y, y), lx, Math.max(TOP_Y, y + 18));
      }
      g.lineStyle(4, 0x3f7a2e, 0.8).strokeRect(x0, TOP_Y, w, DH - TOP_Y);

      // sky band with storm clouds, drawn above everything that scrolls in from the top
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

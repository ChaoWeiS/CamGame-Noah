import { tracker, input } from '../core.js';
import { W, H, txt, columns, rng, session, ordinal, charImage } from './common.js';

const COURSE = 300;        // metres to the ark
const BASE_SPEED = 10;     // metres per second
const PX_PER_M = 16;       // 30 m of track visible ahead
const RUNNER_Y = 610;
const TOP_Y = 120;
const WINDOW_MS = 380;     // how recently you must have jumped/ducked when an obstacle arrives

function makeCourse(seed) {
  const r = rng(seed);
  const obs = [];
  let d = 40;
  while (d < COURSE - 25) {
    const x = r();
    const type = x < 0.5 ? 'rock' : x < 0.75 ? 'log' : 'branch';
    obs.push({ d, type, lane: Math.floor(r() * 3) - 1 });
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
    this.cols = columns(players.length);

    this.bg = this.add.graphics();
    this.g = this.add.graphics();
    this.runners = players.map((pl, i) => {
      const c = this.cols[i];
      return {
        pl, c, dist: 0, speed: 0, laneX: c.cx, stumbleUntil: 0,
        lastJump: -1e9, lastDuck: -1e9, nextObs: 0, place: 0,
        shadow: this.add.ellipse(c.cx, RUNNER_Y + 30, 60, 16, 0x000000, 0.25),
        sprite: charImage(this, c.cx, RUNNER_Y + 30, pl.animal || 'bear', 'back', Math.min(120, c.w * 0.36)),
        msg: this.add.text(c.cx, RUNNER_Y - 110, '', txt(30, '#ffffff', { stroke: '#1d3b52', strokeThickness: 6 })).setOrigin(0.5),
        lost: this.add.text(c.cx, 380, '', txt(26, '#ffffff', { stroke: '#9b3b2f', strokeThickness: 6, wordWrap: { width: c.w - 30 } })).setOrigin(0.5),
        labels: [],
      };
    });
    // Text labels for obstacles are pooled per column
    this.runners.forEach((r) => {
      for (let i = 0; i < 4; i++) r.labels.push(this.add.text(0, 0, '', txt(18, '#ffffff', { stroke: '#000', strokeThickness: 4 })).setOrigin(0.5).setVisible(false));
    });

    this.banner = this.add.text(W / 2, H / 2 - 40, '', txt(90, '#fff8e6', { stroke: '#1d3b52', strokeThickness: 12 })).setOrigin(0.5).setDepth(10);
    this.help = this.add.text(W / 2, H / 2 + 60, 'The flood is coming — run to the ark!\nLean to dodge rocks · jump over logs · duck under branches',
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

    for (const r of this.runners) {
      const inp = input(r.pl);
      if (inp.jumping) r.lastJump = now;
      if (inp.ducking) r.lastDuck = now;
      r.lost.setText(inp.present ? '' : 'Come back into view!');

      // Movement
      const targetX = r.c.cx + inp.lane * r.c.w * 0.28;
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
          r.labels[li++].setText(label).setPosition(r.c.cx, y - 34).setVisible(true);
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
      r.msg.setPosition(r.c.cx, RUNNER_Y - 130);

      this.drawProgress(g, r);
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
    if (o.type === 'rock') ok = inp.lane !== o.lane;
    else if (o.type === 'log') ok = now - r.lastJump < WINDOW_MS || inp.jumping;
    else ok = now - r.lastDuck < WINDOW_MS || inp.ducking;
    if (ok) {
      r.msg.setText(['Nice!', 'Great!', 'Woohoo!', 'Yes!'][Math.floor(Math.random() * 4)]);
    } else {
      r.stumbleUntil = now + 1100;
      r.msg.setText('Oops!');
      this.cameras.main.shake(120, 0.004);
    }
    this.time.delayedCall(700, () => { if (!r.place) r.msg.setText(''); });
  }

  drawObstacle(g, c, o, y) {
    const half = c.w * 0.42;
    if (o.type === 'rock') {
      const x = c.cx + o.lane * c.w * 0.28;
      const rad = Math.min(30, c.w * 0.09);
      g.fillStyle(0x7d7f86, 1).fillCircle(x, y, rad);
      g.fillStyle(0x9ea1a8, 1).fillCircle(x - rad * 0.3, y - rad * 0.3, rad * 0.45);
      return null;
    }
    if (o.type === 'log') {
      g.fillStyle(0x8a5a2b, 1).fillRoundedRect(c.cx - half, y - 14, half * 2, 28, 12);
      g.fillStyle(0xc28a52, 1).fillCircle(c.cx - half + 10, y, 11).fillCircle(c.cx + half - 10, y, 11);
      return 'JUMP!';
    }
    // branch (duck)
    g.fillStyle(0x5b3a1e, 1).fillRect(c.cx - half, y - 40, 10, 54).fillRect(c.cx + half - 10, y - 40, 10, 54);
    g.fillStyle(0x3f8f3a, 1).fillRoundedRect(c.cx - half, y - 22, half * 2, 18, 8);
    for (let i = 0; i < 6; i++) g.fillStyle(0x58b350, 1).fillCircle(c.cx - half + (i + 0.5) * (half * 2 / 6), y - 24, 9);
    return 'DUCK!';
  }

  drawArk(g, c, y) {
    const w = Math.min(220, c.w * 0.8);
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
    g.fillGradientStyle(0x4b5563, 0x4b5563, 0x8fbf6a, 0x8fbf6a, 1).fillRect(0, 0, W, H);
    // storm clouds
    g.fillStyle(0x374151, 1);
    for (let i = 0; i < 9; i++) g.fillCircle((i * 160 + this.rainT * 20) % (W + 160) - 80, 30 + (i % 2) * 18, 60);
    // rain
    g.lineStyle(2, 0xcfe3f5, 0.5);
    for (let i = 0; i < 70; i++) {
      const x = (i * 97 + this.rainT * 120) % W;
      const y = (i * 53 + this.rainT * 700) % H;
      g.lineBetween(x, y, x - 6, y + 18);
    }
    // track per column
    this.cols.forEach((c, i) => {
      const dist = this.runners ? this.runners[i].dist : 0;
      g.fillStyle(0xc9a46a, 1).fillRect(c.x + 12, TOP_Y, c.w - 24, H - TOP_Y);
      g.lineStyle(3, 0xffffff, 0.35);
      for (const k of [-0.14, 0.14]) {
        const x = c.cx + k * c.w * 2;
        const off = (dist * PX_PER_M) % 40;
        for (let y = TOP_Y - 40 + off; y < H; y += 40) g.lineBetween(x, y, x, y + 18);
      }
      g.lineStyle(4, 0xffffff, 0.6).strokeRect(c.x + 12, TOP_Y, c.w - 24, H - TOP_Y);
    });
  }
}

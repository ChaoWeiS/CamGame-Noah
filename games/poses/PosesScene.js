import { tracker, input } from '../../js/core.js';
import { POSES } from '../../js/body.js';
import { W, H, txt, rng, Hold, session, charById, setupPanes, UI_X } from '../../js/scenes/common.js';
import { Stage3D } from '../../js/stage3d.js';
import { demoPose } from './posedemo.js';
import { finishGame } from '../../js/games.js';

const ROUND_MS = 30000;
const HOLD_MS = 450;
const SHOW = 5;          // keys visible in each player's queue (the one to do + 4 waiting)

// One long stream of keys (poses), the same for everyone so it stays fair.
// Each key done = 1 point; the Hall of Fame score is the number of keys done.
function makeStream(seed, count) {
  const r = rng(seed ^ 0x5a5a);
  const out = [];
  let last = null;
  for (let k = 0; k < count; k++) {
    let p;
    do { p = POSES[Math.floor(r() * POSES.length)].id; } while (p === last);
    out.push(p); last = p;
  }
  return out;
}
const poseById = Object.fromEntries(POSES.map((p) => [p.id, p]));

export class PasswordScene extends Phaser.Scene {
  static KEY = 'Password';
  constructor() { super('Password'); }

  create() {
    this.stream = makeStream(session.seed, 400);
    const players = tracker.players;
    this.cols = setupPanes(this, players.length, 720).panes;
    // each player's 3D animal copies them while they make the poses
    this.stage = new Stage3D(this.game);
    this.events.once('shutdown', () => this.stage.destroy());
    const bg = this.add.graphics();
    this.g = this.add.graphics().setDepth(2);

    this.p = players.map((pl, i) => {
      const c = this.cols[i];
      const wide = c.w >= 900;
      // wide panes: pose on the left, the player's stick figure on the right
      // wide panes: the pose to copy on the left, the player's animal on the right
      // the key queue is a column on the left: the key to do at the bottom, the next ones above it
      const L = wide
        ? { poseX: c.cx - c.w * 0.2, skelX: c.cx + c.w * 0.22, skelY: 470, footY: 640, animH: 380, wrap: c.w * 0.34, scoreX: c.cx,
            demoFoot: 500, demoH: 300, nameY: 530, hintY: 568, qX: c.x + 84 }
        : { poseX: c.cx + 45, skelX: c.cx, skelY: 575, footY: 668, animH: 150, wrap: c.w - 170, scoreX: c.x + 110,
            demoFoot: 410, demoH: 230, nameY: 438, hintY: 472, qX: c.x + 72 };
      L.qY0 = 590; L.qStep = 92;
      L.demoY = L.demoFoot - L.demoH / 2;     // middle of the demo animal (emoji fallback and hold ring)
      bg.fillGradientStyle(0x5b3a1e, 0x5b3a1e, 0x8a5a2b, 0x8a5a2b, 1).fillRect(c.x, 0, c.w, 720);
      bg.fillStyle(0x000000, 0.18).fillRoundedRect(c.x + 12, 12, c.w - 24, 696, 18);
      bg.lineStyle(6, pl.color, 1).strokeRoundedRect(c.x + 12, 12, c.w - 24, 696, 18);

      const pp = {
        pl, c, L, cardSize: 80, queue: [], n: 0, points: 0, hold: new Hold(HOLD_MS),
        head: this.add.text(c.cx, 52, `P${i + 1} · ${charById(pl.animal).name}`, txt(32, pl.css)).setOrigin(0.5),
        cheerAt: -1e9,
        big: this.add.text(L.poseX, L.demoY, '', txt(Math.min(150, c.w * 0.26))).setOrigin(0.5).setDepth(3),
        name: this.add.text(L.poseX, L.nameY, '', txt(40, '#fff8e6')).setOrigin(0.5).setDepth(3),
        hint: this.add.text(L.poseX, L.hintY, '', txt(26, '#f4e3c3', { wordWrap: { width: L.wrap } })).setOrigin(0.5, 0).setDepth(3),
        score: this.add.text(L.scoreX, 680, '', txt(40, '#fff8e6')).setOrigin(0.5).setDepth(3),
        flash: this.add.text(c.cx, 215, '', txt(44, '#fff8e6', { stroke: '#2e7d4f', strokeThickness: 8 })).setOrigin(0.5).setDepth(5),
        lost: this.add.text(L.skelX, L.skelY, '', txt(28, '#ffffff', { stroke: '#9b3b2f', strokeThickness: 6, wordWrap: { width: L.wrap } })).setOrigin(0.5).setDepth(3),
      };
      for (let j = 0; j < SHOW; j++) pp.queue.push(this.makeCard(pp, this.stream[j], j));
      return pp;
    });

    // shared overlay: timer (centre of the grid when 3-4 players) and intro text
    const n = players.length;
    const tX = n === 1 ? W - 60 : W / 2, tY = n >= 3 ? H / 2 : n === 1 ? 60 : 36;
    const ui = this.add.graphics().setDepth(55);
    ui.fillStyle(0x10202b, 0.9).fillCircle(UI_X + tX, tY, 34);
    this.timerText = this.add.text(UI_X + tX, tY, '', txt(30, '#fff8e6')).setOrigin(0.5).setDepth(56);
    this.intro = this.add.text(UI_X + W / 2, H / 2, 'The ark door is locked! 🔒\nCopy each pose to earn a key 🔑\nMost keys wins!',
      txt(42, '#fff8e6', { stroke: '#1d1206', strokeThickness: 10 })).setOrigin(0.5).setDepth(60);
    this.state = 'intro';
    this.p.forEach((pp) => this.showCurrent(pp));
    this.time.delayedCall(3500, () => { this.intro.setText(''); this.state = 'play'; this.endAt = this.time.now + ROUND_MS; });
  }

  keyAt(i) { return this.stream[i % this.stream.length]; }

  // where the j-th card of the queue sits: j = 0 is the key to do now (bottom, biggest)
  slot(pp, j) {
    return { x: pp.L.qX, y: pp.L.qY0 - j * pp.L.qStep, scale: j === 0 ? 1.2 : 1 - j * 0.05, alpha: j === 0 ? 1 : 1 - j * 0.13 };
  }
  makeCard(pp, poseId, j) {
    const s = pp.cardSize, at = this.slot(pp, j);
    const bg = this.add.graphics().fillStyle(0xfff8e6, 0.92).fillRoundedRect(-s / 2, -s / 2, s, s, 12);
    const t = this.add.text(0, 0, poseById[poseId].emoji, txt(s * 0.62)).setOrigin(0.5);
    return this.add.container(at.x, at.y, [bg, t]).setDepth(3).setScale(at.scale).setAlpha(at.alpha);
  }
  // a key is done: it turns green and drops away, the queue slides down, a new key joins the back
  advance(pp) {
    const s = pp.cardSize, done = pp.queue.shift();
    done.list[0].clear().fillStyle(0x2e7d4f, 0.95).fillRoundedRect(-s / 2, -s / 2, s, s, 12);
    this.tweens.killTweensOf(done);
    this.tweens.add({ targets: done, y: done.y + 150, angle: 25, alpha: 0, duration: 420, ease: 'Quad.easeIn', onComplete: () => done.destroy() });
    pp.queue.forEach((card, j) => {
      const at = this.slot(pp, j);
      this.tweens.killTweensOf(card);
      this.tweens.add({ targets: card, y: at.y, scale: at.scale, alpha: at.alpha, duration: 260, ease: 'Quad.easeOut' });
    });
    const back = this.makeCard(pp, this.keyAt(pp.n + SHOW - 1), SHOW - 1);
    const at = this.slot(pp, SHOW - 1);
    back.setY(at.y - pp.L.qStep).setAlpha(0);
    this.tweens.add({ targets: back, y: at.y, alpha: at.alpha, duration: 300, ease: 'Quad.easeOut' });
    pp.queue.push(back);
  }

  showCurrent(pp) {
    const pose = poseById[this.keyAt(pp.n)];
    pp.big.setText(pose.emoji);
    pp.name.setText(pose.name);
    pp.hint.setText(pose.hint);
    pp.score.setText(`🔑 ${pp.points}`);
  }

  update(time) {
    const g = this.g; g.clear();
    if (this.state === 'play') {
      const left = Math.max(0, this.endAt - time);
      this.timerText.setText(String(Math.ceil(left / 1000)));
      if (left <= 0) this.finish();
    }

    for (const pp of this.p) {
      const { c } = pp;
      // a frame in the player's colour marks where the key to do now sits
      { const s = pp.cardSize * 1.2 + 14;
        g.lineStyle(6, pp.pl.color, 1).strokeRoundedRect(pp.L.qX - s / 2, pp.L.qY0 - s / 2, s, s, 16); }

      const inp = input(pp.pl);
      pp.lost.setText(inp.present ? '' : 'Come back into view!');

      // the player's animal copies them so kids can see themselves (it hops for a door code)
      const zoom = c.rect.h / c.h, cam = pp.pl.kind === 'camera';
      // the pose to copy, shown by the player's own animal doing it (the emoji stays as a fallback)
      if (this.state !== 'intro') {
        const target = this.keyAt(pp.n), demo = demoPose(target, time / 1000);
        const shown = this.stage.place(100 + pp.pl.slot, pp.pl.animal || 'bear',
          c.rect.x + (pp.L.poseX - c.x) * zoom, c.rect.y + (pp.L.demoFoot + 0.45 * pp.L.demoH * Math.min(0, demo.drop) * 0.75) * zoom, pp.L.demoH * zoom,
          demo.pts, demo.base, time / 1000, demo.world);
        pp.big.setVisible(!shown);
      } else this.stage.hide(100 + pp.pl.slot);
      const hop = Math.max(0, Math.sin(Math.min(1, (time - pp.cheerAt) / 600) * Math.PI * 2)) * 40;
      const show = this.state !== 'intro' && (!cam || (pp.pl.body.pts && inp.present));   // not over the intro text
      if (show) {
        this.stage.place(pp.pl.slot, pp.pl.animal || 'bear',
          c.rect.x + (pp.L.skelX - c.x) * zoom, c.rect.y + (pp.L.footY - hop) * zoom, pp.L.animH * zoom,
          cam ? pp.pl.body.vpts : null, cam ? pp.pl.body.base : null, time / 1000, cam ? pp.pl.body.world : null);
      } else this.stage.hide(pp.pl.slot);
      if (!cam) {
        pp.lost.setY(pp.L.footY - pp.L.animH - 30);
        pp.lost.setText(inp.pose ? `⌨️ ${poseById[inp.pose].emoji}` : '⌨️');
      }

      if (this.state !== 'play') continue;
      const target = this.keyAt(pp.n);
      const k = pp.hold.update(inp.present && inp.pose === target, time);
      if (k > 0) {
        g.lineStyle(10, pp.pl.color, 1);
        g.beginPath();
        g.arc(pp.L.poseX, pp.L.demoY, Math.min(pp.L.demoH * 0.62, c.w * 0.22), -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        g.strokePath();
      }
      if (k >= 1) {
        pp.hold.reset();
        pp.n++; pp.points++;
        this.advance(pp);
        pp.flash.setText('+1 🔑').setAlpha(1);
        this.tweens.killTweensOf(pp.flash);
        this.tweens.add({ targets: pp.flash, alpha: 0, delay: 500, duration: 300 });
        pp.cheerAt = time;
        this.showCurrent(pp);
        this.tweens.add({ targets: pp.big, scale: { from: 1.3, to: 1 }, duration: 180 });
      }
    }
    this.stage.render();
  }

  finish() {
    this.state = 'done';
    this.timerText.setText('0');
    this.intro.setText('The door opens! 🚪');
    finishGame(this, this.p.map((pp) => ({ slot: pp.pl.slot, score: pp.points, label: `🔑 ${pp.points} ${pp.points === 1 ? 'key' : 'keys'}` })), 2200);
  }
}

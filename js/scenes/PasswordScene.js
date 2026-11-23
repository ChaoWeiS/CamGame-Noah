import { tracker, input } from '../core.js';
import { POSES } from '../body.js';
import { W, H, txt, rng, Hold, session, drawSkeleton, personMap, charById, charImage, setupPanes, UI_X } from './common.js';

const ROUND_MS = 30000;
const HOLD_MS = 450;
const SEQ_LEN = 5;

// The k-th password is the same for everyone, so it stays fair.
function makeSequences(seed, count) {
  const r = rng(seed ^ 0x5a5a);
  const seqs = [];
  let last = null;
  for (let k = 0; k < count; k++) {
    const seq = [];
    for (let i = 0; i < SEQ_LEN; i++) {
      let p;
      do { p = POSES[Math.floor(r() * POSES.length)].id; } while (p === last);
      seq.push(p); last = p;
    }
    seqs.push(seq);
  }
  return seqs;
}
const poseById = Object.fromEntries(POSES.map((p) => [p.id, p]));

export class PasswordScene extends Phaser.Scene {
  constructor() { super('Password'); }

  create() {
    this.seqs = makeSequences(session.seed, 40);
    const players = tracker.players;
    this.cols = setupPanes(this, players.length, 720).panes;
    const bg = this.add.graphics();
    this.g = this.add.graphics().setDepth(2);

    this.p = players.map((pl, i) => {
      const c = this.cols[i];
      const wide = c.w >= 900;
      // wide panes: pose on the left, the player's stick figure on the right
      const L = wide
        ? { poseX: c.cx - c.w * 0.22, skelX: c.cx + c.w * 0.22, skelY: 470, torso: 110, wrap: c.w * 0.4 }
        : { poseX: c.cx, skelX: c.cx, skelY: 575, torso: 70, wrap: c.w - 40 };
      bg.fillGradientStyle(0x5b3a1e, 0x5b3a1e, 0x8a5a2b, 0x8a5a2b, 1).fillRect(c.x, 0, c.w, 720);
      bg.fillStyle(0x000000, 0.18).fillRoundedRect(c.x + 12, 12, c.w - 24, 696, 18);
      bg.lineStyle(6, pl.color, 1).strokeRoundedRect(c.x + 12, 12, c.w - 24, 696, 18);

      const cardSize = Math.min(96, (c.w - 60) / SEQ_LEN - 12);
      const cards = [];
      for (let j = 0; j < SEQ_LEN; j++) {
        const x = c.cx + (j - (SEQ_LEN - 1) / 2) * (cardSize + 12);
        cards.push(this.add.text(x, 140, '', txt(cardSize * 0.62)).setOrigin(0.5).setDepth(3));
      }
      return {
        pl, c, L, cardSize, cards, k: 0, step: 0, points: 0, hold: new Hold(HOLD_MS),
        head: this.add.text(c.cx, 52, `P${i + 1} · ${charById(pl.animal).name}`, txt(32, pl.css)).setOrigin(0.5),
        cheer: charImage(this, L.poseX, 470, pl.animal || 'bear', 'tpose', Math.min(260, c.w * 0.45)).setAlpha(0).setDepth(4),
        big: this.add.text(L.poseX, 300, '', txt(Math.min(150, c.w * 0.26))).setOrigin(0.5).setDepth(3),
        name: this.add.text(L.poseX, 410, '', txt(40, '#fff8e6')).setOrigin(0.5).setDepth(3),
        hint: this.add.text(L.poseX, 450, '', txt(26, '#f4e3c3', { wordWrap: { width: L.wrap } })).setOrigin(0.5, 0).setDepth(3),
        score: this.add.text(c.cx, 680, '', txt(40, '#fff8e6')).setOrigin(0.5).setDepth(3),
        flash: this.add.text(c.cx, 215, '', txt(44, '#fff8e6', { stroke: '#2e7d4f', strokeThickness: 8 })).setOrigin(0.5).setDepth(5),
        lost: this.add.text(L.skelX, L.skelY, '', txt(28, '#ffffff', { stroke: '#9b3b2f', strokeThickness: 6, wordWrap: { width: L.wrap } })).setOrigin(0.5).setDepth(3),
      };
    });

    // shared overlay: timer (centre of the grid when 3-4 players) and intro text
    const n = players.length;
    const tX = n === 1 ? W - 60 : W / 2, tY = n >= 3 ? H / 2 : n === 1 ? 60 : 36;
    const ui = this.add.graphics().setDepth(55);
    ui.fillStyle(0x10202b, 0.9).fillCircle(UI_X + tX, tY, 34);
    this.timerText = this.add.text(UI_X + tX, tY, '', txt(30, '#fff8e6')).setOrigin(0.5).setDepth(56);
    this.intro = this.add.text(UI_X + W / 2, H / 2, 'The ark door is locked! 🔒\nCopy the animal password —\n5 poses in a row = 1 point',
      txt(42, '#fff8e6', { stroke: '#1d1206', strokeThickness: 10 })).setOrigin(0.5).setDepth(60);
    this.state = 'intro';
    this.p.forEach((pp) => this.showCurrent(pp));
    this.time.delayedCall(3500, () => { this.intro.setText(''); this.state = 'play'; this.endAt = this.time.now + ROUND_MS; });
  }

  seqOf(pp) { return this.seqs[pp.k % this.seqs.length]; }

  showCurrent(pp) {
    const seq = this.seqOf(pp);
    const pose = poseById[seq[pp.step]];
    pp.big.setText(pose.emoji);
    pp.name.setText(pose.name);
    pp.hint.setText(pose.hint);
    pp.cards.forEach((t, j) => t.setText(poseById[seq[j]].emoji).setAlpha(j < pp.step ? 0.35 : 1));
    pp.score.setText(`⭐ ${pp.points}`);
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
      // cards
      pp.cards.forEach((t, j) => {
        const s = pp.cardSize;
        const done = j < pp.step, cur = j === pp.step;
        g.fillStyle(done ? 0x2e7d4f : 0xfff8e6, done ? 0.9 : 0.85).fillRoundedRect(t.x - s / 2, t.y - s / 2, s, s, 10);
        if (cur) g.lineStyle(5, pp.pl.color, 1).strokeRoundedRect(t.x - s / 2 - 3, t.y - s / 2 - 3, s + 6, s + 6, 12);
      });

      const inp = input(pp.pl);
      pp.lost.setText(inp.present ? '' : 'Come back into view!');

      // live stick figure so kids can see themselves
      if (pp.pl.kind === 'camera' && pp.pl.body.pts && inp.present) {
        drawSkeleton(g, pp.pl.body.pts, personMap(pp.pl.body.pts, pp.L.skelX, pp.L.skelY, pp.L.torso), pp.pl.color, 8);
      } else if (pp.pl.kind === 'keyboard') {
        pp.lost.setText(inp.pose ? `⌨️ ${poseById[inp.pose].emoji}` : '⌨️');
      }

      if (this.state !== 'play') continue;
      const target = this.seqOf(pp)[pp.step];
      const k = pp.hold.update(inp.present && inp.pose === target, time);
      if (k > 0) {
        g.lineStyle(10, pp.pl.color, 1);
        g.beginPath();
        g.arc(pp.L.poseX, 300, Math.min(105, c.w * 0.19), -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        g.strokePath();
      }
      if (k >= 1) {
        pp.hold.reset();
        pp.step++;
        if (pp.step >= SEQ_LEN) {
          pp.points++; pp.k++; pp.step = 0;
          pp.flash.setText('Door code! +1').setAlpha(1);
          this.tweens.add({ targets: pp.flash, alpha: 0, delay: 700, duration: 400 });
          pp.cheer.setAlpha(1).setY(470);
          this.tweens.add({ targets: pp.cheer, y: 440, yoyo: true, duration: 200, repeat: 1 });
          this.tweens.add({ targets: pp.cheer, alpha: 0, delay: 900, duration: 300 });
        }
        this.showCurrent(pp);
        this.tweens.add({ targets: pp.big, scale: { from: 1.3, to: 1 }, duration: 180 });
      }
    }
  }

  finish() {
    this.state = 'done';
    this.timerText.setText('0');
    session.pw = this.p.map((pp) => ({ slot: pp.pl.slot, points: pp.points }));
    this.intro.setText('The door opens! 🚪');
    this.time.delayedCall(2200, () => this.scene.start('Results'));
  }
}

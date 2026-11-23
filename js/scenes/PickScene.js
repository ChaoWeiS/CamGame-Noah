import { tracker, input } from '../core.js';
import { W, H, txt, sky, columns, CHARACTERS, charImage, Hold, session } from './common.js';

export class PickScene extends Phaser.Scene {
  constructor() { super('Pick'); }

  create() {
    sky(this, 0x7cc0e8, 0xe4f3fb);
    this.add.text(W / 2, 46, 'Choose your character!', txt(46, '#1d3b52')).setOrigin(0.5);
    this.add.text(W / 2, 92, 'Lean left or right to change · raise both hands to choose', txt(22, '#1d3b52')).setOrigin(0.5);

    const players = tracker.players;
    const cols = columns(players.length);
    this.cards = players.map((pl, i) => {
      const c = cols[i];
      const bg = this.add.rectangle(c.cx, 410, c.w - 24, 520, pl.color, 0.22).setStrokeStyle(4, pl.color, 1);
      const label = this.add.text(c.cx, 180, `Player ${i + 1}${pl.kind === 'keyboard' ? ' ⌨️' : ''}`, txt(28, '#1d3b52')).setOrigin(0.5);
      const idx = (pl.slot * 2) % CHARACTERS.length;
      const imgH = Math.min(260, c.w * 0.75);
      const emoji = charImage(this, c.cx, 370 + imgH / 2, CHARACTERS[idx].id, 'front', imgH);
      const name = this.add.text(c.cx, 520, CHARACTERS[idx].name, txt(30, '#1d3b52')).setOrigin(0.5);
      const off = Math.min(150, c.w * 0.4);
      const arrows = this.add.container(0, 0, [
        this.add.text(c.cx - off, 370, '◀', txt(40, '#1d3b52')).setOrigin(0.5),
        this.add.text(c.cx + off, 370, '▶', txt(40, '#1d3b52')).setOrigin(0.5),
      ]);
      const status = this.add.text(c.cx, 600, '🙌 to choose', txt(26, '#1d3b52')).setOrigin(0.5);
      const ring = this.add.graphics();
      return { pl, c, bg, label, idx, emoji, name, imgH, arrows, status, ring, prevLane: 0, hold: new Hold(800), done: false };
    });
    this.deadline = this.time.now + 30000;
    this.leaving = false;
  }

  update(time) {
    for (const card of this.cards) {
      const inp = input(card.pl);
      card.ring.clear();
      if (!inp.present) { card.status.setText('Step back into view!'); continue; }
      if (card.done) continue;

      // Lean edge: centre → side changes animal
      if (inp.lane !== 0 && card.prevLane === 0) {
        card.idx = (card.idx + inp.lane + CHARACTERS.length) % CHARACTERS.length;
        const ch = CHARACTERS[card.idx];
        card.emoji.setTexture(`${ch.id}_front`);
        card.emoji.setScale(card.imgH / card.emoji.height);
        card.emoji.baseScale = card.emoji.scaleX;
        card.name.setText(ch.name);
        this.tweens.add({ targets: card.emoji, scale: { from: card.emoji.baseScale * 1.15, to: card.emoji.baseScale }, duration: 200 });
        if (card.pl.kind === 'keyboard') card.pl.kb.lane = 0;
      }
      card.prevLane = card.pl.kind === 'keyboard' ? 0 : inp.lane;

      const k = card.hold.update(inp.handsUp, time);
      card.status.setText('🙌 to choose');
      if (k > 0) {
        card.ring.lineStyle(10, card.pl.color, 1);
        card.ring.beginPath();
        card.ring.arc(card.c.cx, 370, Math.min(120, card.c.w * 0.36), -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        card.ring.strokePath();
      }
      if (k >= 1) this.choose(card);
    }

    if (!this.leaving && time > this.deadline) this.cards.forEach((c) => c.done || this.choose(c));
    if (!this.leaving && this.cards.every((c) => c.done)) {
      this.leaving = true;
      this.time.delayedCall(1200, () => this.scene.start('Race'));
    }
  }

  choose(card) {
    card.done = true;
    card.pl.animal = CHARACTERS[card.idx].id;
    card.emoji.setTexture(`${card.pl.animal}_tpose`);
    card.emoji.setScale(card.imgH / card.emoji.height);
    card.arrows.setVisible(false);
    card.status.setText('Ready! ✅');
    card.ring.clear();
    this.tweens.add({ targets: card.emoji, y: card.emoji.y - 30, yoyo: true, duration: 180, repeat: 1 });
  }
}

import { tracker, input } from '../core.js';
import { W, H, txt, setupPanes, CHARACTERS, charImage, Hold, session } from './common.js';
import { Puppet } from '../puppet.js';
import { Stage3D } from '../stage3d.js';

export class PickScene extends Phaser.Scene {
  constructor() { super('Pick'); }

  create() {
    const players = tracker.players;
    const cols = setupPanes(this, players.length, 720).panes;
    this.stage = new Stage3D(this.game);
    this.events.once('shutdown', () => this.stage.destroy());
    this.cards = players.map((pl, i) => {
      const c = cols[i];
      const sky = this.add.graphics();
      sky.fillGradientStyle(0x7cc0e8, 0x7cc0e8, 0xe4f3fb, 0xe4f3fb, 1).fillRect(c.x, 0, c.w, 720);
      const bg = this.add.rectangle(c.cx, 360, c.w - 24, 696, pl.color, 0.22).setStrokeStyle(6, pl.color, 1);
      const label = this.add.text(c.cx, 52, `Player ${i + 1}${pl.kind === 'keyboard' ? ' ⌨️' : ''}`, txt(38, '#1d3b52')).setOrigin(0.5);
      this.add.text(c.cx, 100, 'Lean ◀ ▶ to change · 🙌 to choose', txt(26, '#1d3b52')).setOrigin(0.5);
      const idx = pl.slot % CHARACTERS.length;   // everyone starts on a different character
      const imgH = Math.min(320, c.w * 0.75);
      const emoji = charImage(this, c.cx, 370 + imgH / 2, CHARACTERS[idx].id, 'front', imgH);
      const name = this.add.text(c.cx, 580, CHARACTERS[idx].name, txt(40, '#1d3b52')).setOrigin(0.5);
      const off = Math.min(280, c.w * 0.4);
      const arrows = this.add.container(0, 0, [
        this.add.text(c.cx - off, 370, '◀', txt(56, '#1d3b52')).setOrigin(0.5),
        this.add.text(c.cx + off, 370, '▶', txt(56, '#1d3b52')).setOrigin(0.5),
      ]);
      const status = this.add.text(c.cx, 650, '🙌 to choose', txt(32, '#1d3b52')).setOrigin(0.5);
      const ring = this.add.graphics();
      // camera players see their character copying them; keyboard players get the picture
      const puppet = pl.kind === 'camera' ? new Puppet(this, CHARACTERS[idx].id, 2) : null;
      if (puppet) emoji.setVisible(false);
      return { pl, c, bg, label, idx, emoji, name, imgH, puppet, arrows, status, ring, prevLane: 0, hold: new Hold(800), done: false };
    });
    this.deadline = this.time.now + 30000;
    this.leaving = false;
  }

  update(time) {
    for (const card of this.cards) {
      const inp = input(card.pl);
      card.ring.clear();
      // the chosen animal in 3D: copying a camera player, idling for a keyboard player
      const c = card.c, zoom = c.rect.h / c.h, pts = card.pl.kind === 'camera' ? card.pl.body.pts : null;
      const in3D = this.stage.place(card.pl.slot, CHARACTERS[card.idx].id,
        c.rect.x + (c.cx - c.x) * zoom, c.rect.y + (370 + card.imgH / 2) * zoom, card.imgH * 1.1 * zoom,
        pts, card.pl.body?.base, time / 1000 + card.pl.slot, pts ? card.pl.body.world : null);
      card.emoji.setVisible(!in3D && !card.puppet);
      if (card.puppet) card.puppet.setVisible(!in3D);
      if (!in3D && card.puppet && pts) {
        card.puppet.pose(pts, (p) => p, { cx: card.c.cx, top: 370 - card.imgH / 2, height: card.imgH });
      }
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
        if (card.puppet) card.puppet.setCharacter(ch.id);
        this.tweens.add({ targets: card.emoji, scale: { from: card.emoji.baseScale * 1.15, to: card.emoji.baseScale }, duration: 200 });
        if (card.pl.kind === 'keyboard') card.pl.kb.lane = 0;
      }
      card.prevLane = card.pl.kind === 'keyboard' ? 0 : inp.lane;

      const k = card.hold.update(inp.handsUp, time);
      card.status.setText('🙌 to choose');
      if (k > 0) {
        card.ring.lineStyle(10, card.pl.color, 1);
        card.ring.beginPath();
        card.ring.arc(card.c.cx, 370, Math.min(190, card.c.w * 0.42), -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        card.ring.strokePath();
      }
      if (k >= 1) this.choose(card);
    }

    this.stage.render();
    if (!this.leaving && time > this.deadline) this.cards.forEach((c) => c.done || this.choose(c));
    if (!this.leaving && this.cards.every((c) => c.done)) {
      this.leaving = true;
      this.time.delayedCall(1200, () => this.scene.start('Race'));
    }
  }

  choose(card) {
    card.done = true;
    card.pl.animal = CHARACTERS[card.idx].id;
    card.arrows.setVisible(false);
    card.status.setText('Ready! ✅');
    card.ring.clear();
    if (card.puppet) return; // the puppet keeps copying the player
    card.emoji.setTexture(`${card.pl.animal}_tpose`);
    card.emoji.setScale(card.imgH / card.emoji.height);
    this.tweens.add({ targets: card.emoji, y: card.emoji.y - 30, yoyo: true, duration: 180, repeat: 1 });
  }
}

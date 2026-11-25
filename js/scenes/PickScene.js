// Character select. One screen for everyone:
//   • the animals' portraits in a row along the top — each square shows, in the
//     player's colour, who is looking at it (P1 red, P2 blue, P3 green, P4 yellow);
//   • below, a column per player with their animal copying their body.
// Swipe a raised hand across the body to flip to the next animal (keyboard: ← →).
// Hold both hands up for 3 seconds to choose — a ring in your colour fills up around
// your animal. Once chosen it's yours (no take-backs), and nobody else can pick it.
// When everyone has chosen, off to the race.
import { tracker, input, PLAYER_COLORS, PLAYER_CSS } from '../core.js';
import { W, H, txt, sky, Hold, session, CHARACTERS } from './common.js';
import { Stage3D, preloadCast, OverlayText } from '../stage3d.js';
import { startQueue } from '../games.js';

const HOLD_MS = 3000;

export class PickScene extends Phaser.Scene {
  constructor() { super('Pick'); }

  create() {
    tracker.startLearning();          // learn each player's marker (clothes, hair) while they choose
    const players = tracker.players;
    sky(this, 0x8fcbe8, 0xe3f2d0);
    this.add.text(W / 2, 40, 'Choose your animal!', txt(44, '#1d3b52')).setOrigin(0.5);
    this.add.text(W / 2, 82, 'Swipe a hand across your body to change · hold both hands up for 3 seconds to choose',
      txt(22, '#1d3b52')).setOrigin(0.5);

    // the portrait row
    const n = CHARACTERS.length, S = Math.min(150, (W - 160) / n - 34), gap = Math.min(40, (W - n * S) / (n + 1));
    const x0 = (W - (n * S + (n - 1) * gap)) / 2;
    this.row = { y: 110, S };
    this.squares = CHARACTERS.map((ch, i) => {
      const x = x0 + i * (S + gap), cx = x + S / 2, cy = this.row.y + S / 2;
      const bg = this.add.rectangle(cx, cy, S, S, 0xfff8e6).setStrokeStyle(5, 0x1d3b52, 0.25);
      const img = this.add.image(cx, cy, 'portrait_' + ch.id).setDisplaySize(S - 10, S - 10);
      const name = this.add.text(cx, this.row.y + S + 18, ch.name, txt(22, '#1d3b52')).setOrigin(0.5);
      const badge = this.add.text(cx, this.row.y + S - 4, '', txt(22, '#ffffff', { stroke: '#1d3b52', strokeThickness: 5 })).setOrigin(0.5, 1).setDepth(5);
      return { ch, x, cx, cy, bg, img, name, badge, owner: null };
    });
    this.g = this.add.graphics().setDepth(4);

    // a column per player under the row
    const top = this.row.y + S + 60;
    this.foot = H - 70;
    const colW = W / Math.max(1, players.length);
    this.cards = players.map((pl, i) => {
      const cx = colW * (i + 0.5);
      const label = this.add.text(cx, H - 34, `P${pl.slot + 1}`, txt(32, PLAYER_CSS[pl.slot], { stroke: '#1d3b52', strokeThickness: 6 })).setOrigin(0.5);
      return { pl, cx, label, h: Math.min(this.foot - top, colW * 1.25), idx: -1, hold: new Hold(HOLD_MS), done: false, prevLane: 0, armed: false };
    });
    // everyone starts on a different free animal
    this.cards.forEach((c, i) => { c.idx = this.nextFree(i % n, 1, c); });
    for (const c of this.cards) c.pl.body?.takeSwipe?.();          // ignore swipes from before this screen

    this.stage = new Stage3D(this.game);
    preloadCast(CHARACTERS.map((c) => c.id), players.length);
    this.msg = new OverlayText(this.game, W / 2, H / 2, 72);
    this.events.once('shutdown', () => { this.stage.destroy(); this.msg.destroy(); });
  }

  taken(idx, except) { return this.cards.some((c) => c !== except && c.done && c.idx === idx); }
  // the next animal (from idx, in direction dir) that nobody else has chosen
  nextFree(idx, dir, card) {
    const n = CHARACTERS.length;
    for (let k = 0; k < n; k++) { const j = ((idx + dir * k) % n + n) % n; if (!this.taken(j, card)) return j; }
    return idx;
  }

  update(time) {
    if (this.leaving && performance.now() > this.leaveAt) { this.leaving = false; tracker.finishLearning(); startQueue(this); return; }
    const g = this.g; g.clear();
    const S = this.row.S;
    // who is looking at each portrait (nested frames in their colours)
    this.squares.forEach((sq, i) => {
      const lookers = this.cards.filter((c) => c.idx === i);
      lookers.forEach((c, k) => {
        const inset = -6 - k * 8;
        g.lineStyle(c.done ? 9 : 6, PLAYER_COLORS[c.pl.slot], 1).strokeRoundedRect(sq.x + inset, this.row.y + inset, S - 2 * inset, S - 2 * inset, 12);
      });
      const owner = this.cards.find((c) => c.done && c.idx === i);
      sq.badge.setText(owner ? `P${owner.pl.slot + 1} ✓` : lookers.map((c) => `P${c.pl.slot + 1}`).join(' '));
      sq.img.setAlpha(owner ? 1 : 0.92);
    });

    for (const card of this.cards) {
      const pl = card.pl, inp = input(pl), cam = pl.kind === 'camera';
      // browse: swipe (camera) or ← → (keyboard)
      if (!card.done) {
        let dir = 0;
        if (cam) dir = pl.body.takeSwipe();
        else { if (inp.lane !== 0 && card.prevLane === 0) dir = inp.lane; card.prevLane = inp.lane; }
        if (dir) { card.idx = this.nextFree(card.idx + dir, dir, card); card.hold.reset(); }
        if (this.taken(card.idx, card)) card.idx = this.nextFree(card.idx, 1, card);   // someone just chose it
      }
      const ch = CHARACTERS[card.idx];
      // their animal, copying them
      const show = !cam || inp.present;
      if (show) {
        this.stage.place(pl.slot, ch.id, card.cx, this.foot, card.h * 0.9,
          cam ? pl.body.vpts : null, cam ? pl.body.base : null, time / 1000 + pl.slot, cam ? pl.body.world : null);
      } else this.stage.hide(pl.slot);
      // 👕 ✓ once enough of their clothes/hair has been seen to tell them apart later
      const learnt = cam && pl.readings && pl.readings.length >= 6 ? ' 👕✓' : '';
      card.label.setText(`P${pl.slot + 1} · ${card.done ? ch.name + ' ✓' : !show ? 'step into view' : ch.name}${learnt}`);

      // choose: both hands up for 3 s — a ring in their colour fills up around the animal
      const cy = this.foot - card.h * 0.47, r = card.h * 0.47;
      if (card.done) {
        g.lineStyle(10, PLAYER_COLORS[pl.slot], 1).strokeCircle(card.cx, cy, r);
        continue;
      }
      // hands still up from the lobby countdown don't count: they must come down once first
      if (!inp.handsUp) card.armed = true;
      const k = card.hold.update(card.armed && inp.handsUp && show, time);
      if (k > 0) {
        g.lineStyle(10, PLAYER_COLORS[pl.slot], 0.25).strokeCircle(card.cx, cy, r);
        g.lineStyle(10, PLAYER_COLORS[pl.slot], 1).beginPath();
        g.arc(card.cx, cy, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2, false).strokePath();
      }
      if (k >= 1 && !this.taken(card.idx, card)) this.choose(card);
    }
    this.stage.render();
  }

  choose(card) {
    card.done = true;
    card.pl.animal = CHARACTERS[card.idx].id;
    const sq = this.squares[card.idx];
    this.tweens.add({ targets: sq.bg, scale: { from: 1.15, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    const k = sq.img.scale;
    this.tweens.add({ targets: sq.img, scale: { from: k * 1.15, to: k }, duration: 300, ease: 'Back.easeOut' });
    if (this.cards.every((c) => c.done) && !this.leaving) {
      this.leaving = true;
      this.msg.setText('Let’s go! 🌊');
      this.leaveAt = performance.now() + 1500;        // real time (game timers crawl on a slow computer)
    }
  }
}

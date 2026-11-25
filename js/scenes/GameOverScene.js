// After each game: who won it (photo, animal, score), and a celebration if it's a new
// high score for that game. Then on to the next game in the queue (or the ending).
import { tracker, input, PLAYER_CSS } from '../core.js';
import { W, H, txt, sky, charById } from './common.js';
import { Stage3D, OverlayText } from '../stage3d.js';
import { playNext } from '../games.js';

const SHOW_MS = 6000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create(data) {
    this.leaving = false; // Phaser reuses this scene object between games
    sky(this, 0x8fcbe8, 0xf6efd2);
    const results = [...(data.results || [])].sort((a, b) => a.rank - b.rank);
    const winners = results.filter((r) => r.rank === 1);
    const pl = (slot) => tracker.players.find((p) => p.slot === slot);
    const names = winners.map((r) => charById(pl(r.slot)?.animal || 'bear').name);
    this.add.text(W / 2, 46, data.title || '', txt(30, '#1d3b52')).setOrigin(0.5);
    this.add.text(W / 2, 100, `🏆 ${names.join(' & ')} ${winners.length > 1 ? 'win' : 'wins'}!`, txt(56, '#1d3b52')).setOrigin(0.5);

    // the winner's card(s): face photo, animal, score
    this.card = document.createElement('div');
    this.card.className = 'wincards';
    this.card.innerHTML = winners.map((r) => {
      const p = pl(r.slot), animal = p?.animal || 'bear';
      return `<div class="wincard" style="--c:${PLAYER_CSS[r.slot]}">
        <img class="face" src="${esc(p?.photo || `assets/portraits/${animal}.png`)}" alt="">
        <img class="animal" src="assets/portraits/${esc(animal)}.png" alt="">
        <b>P${r.slot + 1} · ${esc(charById(animal).name)}</b><span>${esc(r.label)}</span></div>`;
    }).join('');
    document.getElementById('wrap').appendChild(this.card);
    this.best = new OverlayText(this.game, W / 2, H * 0.57, 52, '#f2b544');
    if (data.newBest) this.best.setText('⭐ NEW HIGH SCORE! ⭐');

    // everyone's animal, the winner(s) in the middle and bigger
    this.stage = new Stage3D(this.game);
    const n = results.length, gap = Math.min(260, (W - 120) / Math.max(1, n));
    const xs = Array.from({ length: n }, (_, j) => W / 2 + (j - (n - 1) / 2) * gap)
      .sort((a, b) => Math.abs(a - W / 2) - Math.abs(b - W / 2) || a - b);
    this.cast = results.map((r, i) => ({ pl: pl(r.slot), x: xs[i], h: r.rank === 1 ? 300 : 210, win: r.rank === 1 })).filter((c) => c.pl);
    this.endAt = performance.now() + SHOW_MS;
    this.events.once('shutdown', () => { this.stage.destroy(); this.best.destroy(); this.card.remove(); });
  }

  update(time) {
    if (this.best.text) this.best.el.style.opacity = 0.6 + 0.4 * Math.sin(time / 150);
    for (const c of this.cast) {
      const cam = c.pl.kind === 'camera' && c.pl.body?.pts && input(c.pl).present;
      const hop = !cam && c.win ? Math.abs(Math.sin(time / 240)) * 18 : 0;
      this.stage.place(c.pl.slot, c.pl.animal || 'bear', c.x, H - 40 - hop, c.h,
        cam ? c.pl.body.vpts : null, cam ? c.pl.body.base : null, time / 1000 + c.pl.slot, cam ? c.pl.body.world : null);
    }
    this.stage.render();
    if (!this.leaving && performance.now() > this.endAt) { this.leaving = true; playNext(this); }
  }
}

// The end of the session: "Thanks for playing!" with everyone's animals, then the Hall of
// Fame of each game played today, a new game every 3 seconds, round and round.
//   both hands up (or Enter): play the same games again · M: back to the menu · L: new lobby
import { tracker, input } from '../core.js';
import { W, H, txt, sky, Hold, session } from './common.js';
import { Stage3D, OverlayText } from '../stage3d.js';
import { manifest } from '../games.js';
import { renderHof } from '../hofview.js';

const THANKS_MS = 4500, EACH_MS = 3000;

export class ThanksScene extends Phaser.Scene {
  constructor() { super('Thanks'); }

  create() {
    sky(this, 0x7cc0e8, 0xeaf6fc);
    const g = this.add.graphics();
    [0xe74c3c, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x3498db, 0x8e44ad].forEach((col, i) => {
      g.lineStyle(22, col, 0.85); g.beginPath(); g.arc(W / 2, H + 120, 640 - i * 22, Math.PI, 0); g.strokePath();
    });
    const dove = this.add.text(-80, 150, '🕊️', txt(64)).setOrigin(0.5);
    this.tweens.add({ targets: dove, x: W + 80, duration: 6000, repeat: -1 });
    this.title = new OverlayText(this.game, W / 2, H * 0.22, 84, '#1d3b52');
    this.title.el.style.textShadow = '0 0 8px #fff, 0 3px 0 #fff';
    this.title.setText('Thanks for playing! 🌈');
    this.add.text(W / 2, H - 26, 'Raise both hands (or press Enter) to play again · M: choose games · L: new lobby', txt(22, '#1d3b52')).setOrigin(0.5);

    // everyone's animal, side by side
    this.stage = new Stage3D(this.game);
    const ps = tracker.players, gap = Math.min(280, (W - 120) / Math.max(1, ps.length));
    this.cast = ps.map((pl, i) => ({ pl, x: W / 2 + (i - (ps.length - 1) / 2) * gap }));

    // then the Hall of Fame of each game played today
    this.ids = [...new Set(session.games.filter((x) => !x.skipped).map((x) => x.id))];
    this.show = document.createElement('div');
    this.show.id = 'hofShow';
    this.show.hidden = true;
    document.getElementById('wrap').appendChild(this.show);
    this.started = performance.now(); this.shownAt = 0; this.k = -1;
    this.armed = false; // hands must come down once first, so celebrating doesn't restart the games

    this.hold = new Hold(1200);
    this.enter = this.input.keyboard.addKey('ENTER');
    this.input.keyboard.once('keydown-M', () => this.scene.start('Boot'));
    this.input.keyboard.once('keydown-L', () => this.scene.start('Lobby'));
    this.events.once('shutdown', () => { this.stage.destroy(); this.title.destroy(); this.show.remove(); });
  }

  async next() {
    if (!this.ids.length) return;
    this.k = (this.k + 1) % this.ids.length;
    const m = await manifest(this.ids[this.k]);
    const box = document.createElement('div');
    await renderHof(box, m, { n: 5 });
    if (!this.show.isConnected) return;
    this.show.innerHTML = box.innerHTML +
      `<div class="dots">${this.ids.map((_, i) => `<i class="${i === this.k ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  update(time) {
    const now = performance.now();
    const hofTime = now - this.started > THANKS_MS && this.ids.length;
    if (hofTime) {
      if (this.show.hidden) { this.show.hidden = false; this.title.setText(''); }
      if (now - this.shownAt > EACH_MS) { this.shownAt = now; this.next(); }
    }
    for (const c of this.cast) {
      const cam = c.pl.kind === 'camera' && c.pl.body?.pts && input(c.pl).present;
      // while the Hall of Fame shows (on the right), the animals gather on the left
      const i = this.cast.indexOf(c), leftX = W * 0.04 + (i + 0.5) * (W * 0.38 / this.cast.length);
      this.stage.place(c.pl.slot, c.pl.animal || 'bear', hofTime ? leftX : c.x, H - 60, hofTime ? 220 : 300,
        cam ? c.pl.body.vpts : null, cam ? c.pl.body.base : null, time / 1000 + c.pl.slot, cam ? c.pl.body.world : null);
    }
    this.stage.render();
    // play again
    if (now - this.started < 2500) return;
    const handsUp = tracker.players.some((pl) => input(pl).handsUp);
    if (!handsUp) this.armed = true;
    const up = this.enter.isDown || (this.armed && handsUp);
    if (this.hold.update(up, time) >= 1) {
      session.games = [];
      tracker.players.forEach((pl) => { pl.animal = null; });
      this.scene.start('Pick');
    }
  }
}

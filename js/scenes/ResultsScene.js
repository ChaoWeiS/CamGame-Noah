import { tracker, input } from '../core.js';
import { W, H, txt, sky, Hold, session, ordinal, charById, charImage } from './common.js';
import { Stage3D } from '../stage3d.js';


export class ResultsScene extends Phaser.Scene {
  constructor() { super('Results'); }

  create() {
    sky(this, 0x7cc0e8, 0xeaf6fc);
    // rainbow
    const g = this.add.graphics();
    [0xe74c3c, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x3498db, 0x8e44ad].forEach((col, i) => {
      g.lineStyle(22, col, 0.85);
      g.beginPath(); g.arc(W / 2, H + 120, 640 - i * 22, Math.PI, 0); g.strokePath();
    });
    const dove = this.add.text(-80, 140, '🕊️', txt(64)).setOrigin(0.5);
    this.tweens.add({ targets: dove, x: W + 80, duration: 6000, repeat: -1 });

    this.add.text(W / 2, 56, 'Everyone made it onto the ark! 🌈', txt(44, '#1d3b52')).setOrigin(0.5);

    // points from every game played (by placing in each game), added up
    const played = session.games.filter((g) => !g.skipped);
    const rows = tracker.players.map((pl) => {
      const per = played.map((g) => ({ title: g.title, r: g.results.find((x) => x.slot === pl.slot) }));
      const total = per.reduce((s, p) => s + (p.r ? p.r.points : 0), 0);
      return { pl, per, total };
    }).sort((a, b) => b.total - a.total);

    const best = rows.length ? rows[0].total : 0;
    rows.forEach((r, i) => {
      const y = 170 + i * 92;
      this.add.rectangle(W / 2, y, 900, 78, 0xffffff, 0.8).setStrokeStyle(4, r.pl.color, 1);
      const crown = r.total === best ? '👑 ' : '';
      charImage(this, W / 2 - 400, y + 36, r.pl.animal || 'bear', 'front', 70);
      this.add.text(W / 2 - 350, y, `${crown}${charById(r.pl.animal).name} (P${r.pl.slot + 1})`, txt(28, '#1d3b52')).setOrigin(0, 0.5);
      const parts = r.per.map((p) => `${p.title}: ${p.r ? p.r.label : '–'}`).join('   ·   ');
      this.add.text(W / 2 + 180, y, `${parts}   =  ${r.total} pts`, txt(20, '#1d3b52')).setOrigin(0.5);
    });

    // Everyone's 3D animal stands together below the scores, still copying its player;
    // the winner is in the middle, a bit bigger, with a crown
    this.stage = new Stage3D(this.game);
    this.events.once('shutdown', () => this.stage.destroy());
    const top = 170 + rows.length * 92 - 20, footY = H - 66;
    const room = Math.max(90, footY - top);
    const n = rows.length, gap = Math.min(260, (W - 120) / Math.max(1, n));
    // slots ordered from the centre outwards: 1st in the middle, then either side
    const xs = Array.from({ length: n }, (_, j) => W / 2 + (j - (n - 1) / 2) * gap)
      .sort((a, b) => Math.abs(a - W / 2) - Math.abs(b - W / 2) || a - b);
    this.podium = rows.map((r, i) => {
      const h = Math.min(gap * 1.05, room * (i === 0 ? 1 : 0.8));
      if (r.total === best) this.add.text(xs[i], footY - h - 6, '👑', txt(Math.max(28, h * 0.22))).setOrigin(0.5, 1);
      return { pl: r.pl, x: xs[i], h, win: r.total === best };
    });

    this.add.text(W / 2, H - 40, 'Raise both hands (or press Enter) to play again · press L for a new lobby',
      txt(22, '#1d3b52')).setOrigin(0.5);
    this.hold = new Hold(1200);
    this.enter = this.input.keyboard.addKey('ENTER');
    this.input.keyboard.once('keydown-L', () => this.scene.start('Lobby'));
    this.ready = false;
    this.time.delayedCall(2500, () => { this.ready = true; });
  }

  update(time) {
    for (const p of this.podium) {
      const cam = p.pl.kind === 'camera' && p.pl.body.pts && input(p.pl).present;
      const bounce = !cam && p.win ? Math.abs(Math.sin(time / 260)) * 14 : 0;
      this.stage.place(p.pl.slot, p.pl.animal || 'bear', p.x, H - 66 - bounce, p.h,
        cam ? p.pl.body.vpts : null, cam ? p.pl.body.base : null, time / 1000 + p.pl.slot, cam ? p.pl.body.world : null);
    }
    this.stage.render();
    if (!this.ready) return;
    const anyUp = this.enter.isDown || tracker.players.some((pl) => input(pl).handsUp);
    if (this.hold.update(anyUp, time) >= 1) {
      tracker.players.forEach((pl) => { pl.animal = null; });
      this.scene.start('Pick');
    }
  }
}

import { tracker, input } from '../core.js';
import { W, H, txt, sky, Hold, session, ordinal, charById, charImage } from './common.js';

const RACE_POINTS = { 1: 3, 2: 2, 3: 1 };

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

    const rows = tracker.players.map((pl) => {
      const race = session.race.find((r) => r.slot === pl.slot) || { place: 0 };
      const pw = session.pw.find((r) => r.slot === pl.slot) || { points: 0 };
      const racePts = RACE_POINTS[race.place] || 0;
      return { pl, place: race.place, pw: pw.points, total: racePts + pw.points, racePts };
    }).sort((a, b) => b.total - a.total);

    const best = rows.length ? rows[0].total : 0;
    rows.forEach((r, i) => {
      const y = 170 + i * 92;
      this.add.rectangle(W / 2, y, 900, 78, 0xffffff, 0.8).setStrokeStyle(4, r.pl.color, 1);
      const crown = r.total === best ? '👑 ' : '';
      charImage(this, W / 2 - 400, y + 36, r.pl.animal || 'bear', 'front', 70);
      this.add.text(W / 2 - 350, y, `${crown}${charById(r.pl.animal).name} (P${r.pl.slot + 1})`, txt(28, '#1d3b52')).setOrigin(0, 0.5);
      this.add.text(W / 2 + 180, y,
        `Race: ${r.place ? ordinal(r.place) : '–'} (+${r.racePts})   Password: ⭐ ${r.pw}   =  ${r.total}`,
        txt(22, '#1d3b52')).setOrigin(0.5);
    });

    // Winner celebrates in a T-pose
    if (rows.length) {
      const top = rows[0];
      const champ = charImage(this, W / 2, H - 62, top.pl.animal || 'bear', 'tpose', Math.min(200, H - 62 - (170 + rows.length * 92) + 40));
      this.tweens.add({ targets: champ, y: champ.y - 16, yoyo: true, repeat: -1, duration: 400, ease: 'Sine.easeInOut' });
    }

    this.add.text(W / 2, H - 40, 'Raise both hands (or press Enter) to play again · press L for a new lobby',
      txt(22, '#1d3b52')).setOrigin(0.5);
    this.hold = new Hold(1200);
    this.enter = this.input.keyboard.addKey('ENTER');
    this.input.keyboard.once('keydown-L', () => this.scene.start('Lobby'));
    this.ready = false;
    this.time.delayedCall(2500, () => { this.ready = true; });
  }

  update(time) {
    if (!this.ready) return;
    const anyUp = this.enter.isDown || tracker.players.some((pl) => input(pl).handsUp);
    if (this.hold.update(anyUp, time) >= 1) {
      tracker.players.forEach((pl) => { pl.animal = null; });
      this.scene.start('Pick');
    }
  }
}

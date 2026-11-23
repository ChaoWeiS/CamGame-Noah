import { tracker, stats, net, localCam, PLAYER_COLORS, MAX_PLAYERS } from '../core.js';
import { W, H, txt, sky, drawSkeleton, Hold, session, loadCharacters } from './common.js';

const $ = (id) => document.getElementById(id);

export class LobbyScene extends Phaser.Scene {
  constructor() { super('Lobby'); }

  preload() { loadCharacters(this); }

  create() {
    tracker.unlock();
    sky(this, 0x2f6f9f, 0x8fc6e6);
    this.add.text(W / 2, 48, 'Race to the Ark', txt(52, '#fff8e6', { stroke: '#1d3b52', strokeThickness: 8 })).setOrigin(0.5);

    // Camera preview frame (right side)
    this.frame = { x: 560, y: 120, w: 680, h: H - 210 };
    const f = this.frame;
    this.add.rectangle(f.x + f.w / 2, f.y + f.h / 2, f.w, f.h, 0x0d1b26, 0.85).setStrokeStyle(4, 0xfff8e6, 0.6);
    this.g = this.add.graphics();
    this.count = this.add.text(f.x + f.w / 2, f.y + f.h + 30, '', txt(24, '#fff8e6')).setOrigin(0.5);
    this.prompt = this.add.text(W / 2, H - 24, 'Everyone stand in a row facing the camera · raise both hands to start (or press Enter)',
      txt(20, '#fff8e6')).setOrigin(0.5);
    this.big = this.add.text(f.x + f.w / 2, f.y + f.h / 2, '', txt(64, '#fff8e6', { stroke: '#000', strokeThickness: 8 })).setOrigin(0.5);

    this.startHold = new Hold(1000);
    this.counting = false;

    // HTML panel (QR code, buttons)
    $('lobby').hidden = false;
    $('lobby').style.top = (120 / H * 100) + '%';
    $('lobby').style.height = ((H - 210) / H * 100) + '%';
    $('kbBtn').textContent = `Keyboard players: ${session.kbCount}`;
    $('kbBtn').onclick = () => {
      session.kbCount = (session.kbCount + 1) % 3;
      $('kbBtn').textContent = `Keyboard players: ${session.kbCount}`;
      $('kbBtn').blur();
    };
    $('camBtn').onclick = async () => {
      $('camBtn').disabled = true;
      try { await localCam.start((s) => { $('status').textContent = s; }); }
      catch (e) { $('status').textContent = 'Webcam error: ' + e.message; $('camBtn').disabled = false; }
    };

    this.enterKey = this.input.keyboard.addKey('ENTER');
    this.events.once('shutdown', () => { $('lobby').hidden = true; });
  }

  beginCountdown() {
    if (this.counting) return;
    if (tracker.skeletons.length === 0 && session.kbCount === 0) {
      this.big.setText('No players yet!');
      this.time.delayedCall(1200, () => this.big.setText(''));
      return;
    }
    this.counting = true;
    let n = 3;
    this.big.setText('Stand still!\n3');
    this.time.addEvent({
      delay: 1000, repeat: 2, callback: () => {
        n--;
        if (n > 0) { this.big.setText('Stand still!\n' + n); return; }
        tracker.lock(session.kbCount);
        if (tracker.players.length === 0) {
          this.counting = false;
          this.big.setText('Couldn’t see anyone');
          this.time.delayedCall(1200, () => this.big.setText(''));
          return;
        }
        this.scene.start('Pick');
      },
    });
  }

  update(time) {
    const f = this.frame, g = this.g;
    g.clear();
    const aspect = tracker.aspect;
    // Fit camera frame (aspect wide, 1 tall) into the preview box
    const s = Math.min(f.w / aspect, f.h);
    const ox = f.x + (f.w - aspect * s) / 2, oy = f.y + (f.h - s) / 2;
    g.lineStyle(2, 0xffffff, 0.15).strokeRect(ox, oy, aspect * s, s);
    const map = (p) => ({ x: ox + p.x * s, y: oy + p.y * s });

    const sk = [...tracker.skeletons].sort((a, b) => a.key.sh.x - b.key.sh.x);
    let anyHandsUp = false;
    sk.slice(0, MAX_PLAYERS).forEach((person, i) => {
      drawSkeleton(g, person.pts, map, PLAYER_COLORS[i], 6);
      const p = person.pts;
      if (p[15].v > 0.4 && p[16].v > 0.4 && p[15].y < p[0].y && p[16].y < p[0].y) anyHandsUp = true;
    });

    const live = performance.now() - stats.lastFrame < 1500;
    const n = sk.length;
    this.count.setText(live
      ? `${n} ${n === 1 ? 'person' : 'people'} in view${session.kbCount ? ` + ${session.kbCount} keyboard` : ''}`
      : (session.kbCount ? `${session.kbCount} keyboard player(s)` : 'No camera yet — scan the QR code with a phone'));

    if (!this.counting) {
      const k = this.startHold.update(anyHandsUp || this.enterKey.isDown, time);
      if (k > 0 && k < 1) this.big.setText('🙌');
      else if (!this.big.text.startsWith('No') && !this.big.text.startsWith('Couldn')) this.big.setText('');
      if (k >= 1) { this.startHold.reset(); this.beginCountdown(); }
    }
  }
}

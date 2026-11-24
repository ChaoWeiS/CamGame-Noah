import { tracker, stats, net, localCam, PLAYER_COLORS, MAX_PLAYERS } from '../core.js';
import { W, H, txt, sky, drawSkeleton, Hold, session, loadCharacters, CHARACTERS } from './common.js';
import { Puppet } from '../puppet.js';
import { Stage3D, preloadCast, OverlayText } from '../stage3d.js';
import { SkeletonSmoother } from '../body.js';
import { multicam } from '../multicam.js';
import { PHONE, PHONE_PLAYERS, goFullLandscape } from '../mode.js';

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
    // live puppets: everyone in view becomes a character that copies them
    this.puppets = Array.from({ length: MAX_PLAYERS }, (_, i) => new Puppet(this, CHARACTERS[i % CHARACTERS.length].id, 2).setVisible(false));
    this.count = this.add.text(f.x + f.w / 2, f.y + f.h + 30, '', txt(24, '#fff8e6')).setOrigin(0.5);
    this.prompt = this.add.text(W / 2, H - 24, 'Everyone stand in a row facing the camera · everyone raise both hands for 3 seconds to start (or hold Enter)',
      txt(20, '#fff8e6')).setOrigin(0.5);
    // countdown / messages: at the top of the camera frame, above the 3D animals
    this.big = new OverlayText(this.game, f.x + f.w / 2, f.y + 58, 54);

    // everyone in view must hold their hands up for 3 s (so a stray wave doesn't start the game)
    this.startHold = new Hold(3000);
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
      if (PHONE) await goFullLandscape();
      try {
        await localCam.start((s) => { $('status').textContent = s; }, PHONE ? { facing: 'user', numPoses: PHONE_PLAYERS } : {});
        if (PHONE) $('camBtn').hidden = true;
      } catch (e) { $('status').textContent = 'Camera error: ' + e.message; $('camBtn').disabled = false; }
    };
    // Phone mode: play with this phone's front camera; the QR code is still there if wanted
    if (PHONE) {
      document.body.classList.add('phone');
      $('lobbyTitle').textContent = '📱 Play on this phone';
      $('camBtn').textContent = '▶ Play on this phone';
      $('camBtn').classList.add('big');
      $('kbBtn').hidden = true;
      $('qrBtn').hidden = false;
      $('qrBtn').onclick = () => { document.body.classList.toggle('show-qr'); $('qrBtn').blur(); };
      $('status').textContent = 'Prop the phone up sideways, step back until you fit, and wave!';
      $('hud').hidden = true;
    }

    this.enterKey = this.input.keyboard.addKey('ENTER');
    // 3D animals copy the people in view (the 2D puppets stand in until they load)
    this.stage = new Stage3D(this.game);
    // smooth each person's points so the animals don't jitter (one smoother per spot, left to right)
    preloadCast(CHARACTERS.map((c) => c.id), 1);
    this.events.once('shutdown', () => { $('lobby').hidden = true; this.stage.destroy(); this.big.destroy(); });
  }

  beginCountdown() {
    if (this.counting) return;
    if (tracker.people().length === 0 && session.kbCount === 0) {
      this.big.setText('No players yet!');
      this.time.delayedCall(1200, () => this.big.setText(''));
      return;
    }
    this.counting = true;
    let n = 3;
    this.big.setText('Stand still! 3');
    this.time.addEvent({
      delay: 1000, repeat: 2, callback: () => {
        n--;
        if (n > 0) { this.big.setText('Stand still! ' + n); return; }
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

    // Each tracked person keeps the same animal (by track id), wherever they move.
    const people = tracker.people().slice(0, MAX_PLAYERS);
    this.slotOf = this.slotOf || new Map();            // track id → animal slot
    const alive = new Set(tracker.tracks.map((t) => t.id));
    for (const id of [...this.slotOf.keys()]) if (!alive.has(id)) this.slotOf.delete(id);
    for (const t of people) {
      if (this.slotOf.has(t.id)) continue;
      const used = new Set(this.slotOf.values());
      for (let k = 0; k < MAX_PLAYERS; k++) if (!used.has(k)) { this.slotOf.set(t.id, k); break; }
    }
    // smooth each person's points (once per new camera frame — the game runs faster than the camera)
    for (const t of people) {
      if (!t.sm) t.sm = { s2: new SkeletonSmoother(1.0, 2.0), s3: new SkeletonSmoother(0.8, 1.5) };
      if (t.smAt !== t.lastSeen) { t.smAt = t.lastSeen; t.view = { pts: t.sm.s2.update(t.pts), world: t.sm.s3.update(t.world) }; }
    }
    // where each person stands, so the animals can be sized to fit beside each other
    const spots = people.map((t) => {
      const p3 = t.view.pts, nose = map(p3[0]), hipL = map(p3[23]), hipR = map(p3[24]), shL = map(p3[11]), shR = map(p3[12]);
      const hipY = (hipL.y + hipR.y) / 2, shY = (shL.y + shR.y) / 2;
      const ank = [27, 28].filter((k) => p3[k].v > 0.4).map((k) => map(p3[k]).y);
      const footY = Math.min(f.y + f.h - 6, ank.length ? Math.max(...ank) : hipY + (hipY - shY) * 1.3);
      return { x: (hipL.x + hipR.x) / 2, footY, h: (footY - nose.y) * 1.1 };
    });
    let handsUp = 0;
    const shown = new Set();
    people.forEach((t, i) => {
      const slot = this.slotOf.get(t.id), sp = spots[i], id = CHARACTERS[slot % CHARACTERS.length].id;
      shown.add(slot);
      // a faint box in the person's colour shows who the tracker thinks is who
      const b0 = map({ x: t.box.x0, y: t.box.y0 }), b1 = map({ x: t.box.x1, y: t.box.y1 });
      const bx0 = Math.max(ox + 2, b0.x - 8), by0 = Math.max(oy + 2, b0.y - 8);
      const bx1 = Math.min(ox + aspect * s - 2, b1.x + 8), by1 = Math.min(oy + s - 2, b1.y + 8);
      const raised = time - (t.handsUpAt ?? -1e9) < 300;
      g.lineStyle(raised ? 6 : 3, PLAYER_COLORS[slot], raised ? 1 : 0.5).strokeRoundedRect(bx0, by0, bx1 - bx0, by1 - by0, 10);
      const gap = Math.min(...spots.filter((o) => o !== sp).map((o) => Math.abs(o.x - sp.x)), Infinity);
      const h = Math.min(sp.h, gap * 1.15, f.h * 0.85, sp.footY - f.y - 4);
      const in3D = this.stage.place(slot, id, sp.x, sp.footY, h, t.view.pts, null, time / 1000, t.view.world);
      this.puppets[slot].setVisible(!in3D);
      if (!in3D) this.puppets[slot].pose(t.view.pts, map);
      const p = t.pts;
      const up = p[15].v > 0.4 && p[16].v > 0.4 && p[15].y < p[0].y && p[16].y < p[0].y;
      if (up) handsUp++;
      t.handsUpAt = up ? time : t.handsUpAt;
    });
    for (let k = 0; k < MAX_PLAYERS; k++) if (!shown.has(k)) { this.stage.hide(k); this.puppets[k].setVisible(false); }

    const live = performance.now() - stats.lastFrame < 1500;
    const n = people.length;
    // camera phones still standing upright (portrait) see far fewer people
    const tall = multicam.connectedCams().filter((c) => c.frame && performance.now() - c.at < 2000 && c.frame.aspect < 0.95).map((c) => c.num);
    const turnTip = tall.length ? ` · ↻ turn camera ${tall.join(' & ')} sideways` : '';
    this.count.setText(live
      ? `${n} ${n === 1 ? 'person' : 'people'} in view${session.kbCount ? ` + ${session.kbCount} keyboard` : ''}${turnTip}`
      : (session.kbCount ? `${session.kbCount} keyboard player(s)` : 'No camera yet — scan the QR code with a phone'));

    if (!this.counting) {
      // all hands up (a hand dipping for a moment doesn't reset it)
      const allUp = n > 0 && people.every((t) => time - (t.handsUpAt ?? -1e9) < 300);
      const k = this.startHold.update(allUp || this.enterKey.isDown, time);
      if (k > 0 && k < 1) this.big.setText(`🙌 Keep them up… ${Math.ceil(3 - k * 3)}`);
      else if (k === 0 && handsUp > 0 && n > 1) this.big.setText(`🙌 Everyone hands up! (${handsUp} of ${n})`);
      else if (!this.big.text.startsWith('No') && !this.big.text.startsWith('Couldn')) this.big.setText('');
      if (k >= 1) { this.startHold.reset(); this.beginCountdown(); }
    }
    this.stage.render();
  }
}

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
    this.cameras.main.setBackgroundColor('#0d1b26');
    // The camera's view fills the screen, with a faint live picture so everyone can see
    // where its edges are. (Phones send a small picture 4× a second; a webcam is drawn directly.)
    this.feedTex = this.textures.exists('camfeed') ? this.textures.get('camfeed') : this.textures.createCanvas('camfeed', 320, 240);
    this.feed = this.add.image(W / 2, H / 2, 'camfeed').setFlipX(true).setAlpha(0.55).setVisible(false);
    this.feedImg = new Image();
    this.feedImg.onload = () => this.drawFeed(this.feedImg, this.feedImg.width, this.feedImg.height);
    net.previews(true);
    this.g = this.add.graphics();
    this.frameG = this.add.graphics();
    // live puppets (stand-ins until the 3D animals load)
    this.puppets = Array.from({ length: MAX_PLAYERS }, (_, i) => new Puppet(this, CHARACTERS[i % CHARACTERS.length].id, 2).setVisible(false));
    this.add.text(W / 2, 34, 'Race to the Ark', txt(40, '#fff8e6', { stroke: '#1d3b52', strokeThickness: 7 })).setOrigin(0.5);
    this.count = this.add.text(24, 24, '', txt(24, '#fff8e6', { stroke: '#0d1b26', strokeThickness: 5 })).setOrigin(0, 0.5);
    this.prompt = this.add.text(24, H - 26, 'Stand where the camera can see you — then everyone raise both hands!',
      txt(24, '#fff8e6', { stroke: '#0d1b26', strokeThickness: 5 })).setOrigin(0, 0.5);
    // countdown numbers and messages, drawn above the 3D animals
    this.big = new OverlayText(this.game, W / 2, H / 2, 150);
    this.msg = new OverlayText(this.game, W / 2, 96, 40);
    this.countFrom = null;          // when everyone's hands went up (the 3-2-1 runs while they stay up)

    // the corner card (QR code, buttons)
    $('lobby').hidden = false;
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
        if (PHONE) { $('camBtn').hidden = true; $('lobby').classList.remove('center'); }
      } catch (e) { $('status').textContent = 'Camera error: ' + e.message; $('camBtn').disabled = false; }
    };
    // Phone mode: play with this phone's front camera (big button in the middle until it starts)
    if (PHONE) {
      document.body.classList.add('phone');
      if (!localCam.running) $('lobby').classList.add('center');
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
    preloadCast(CHARACTERS.map((c) => c.id), 1);
    this.events.once('shutdown', () => {
      $('lobby').hidden = true; $('lobby').classList.remove('center');
      net.previews(false);
      this.stage.destroy(); this.big.destroy(); this.msg.destroy();
    });
  }

  // put a camera picture into the backdrop texture (mirrored by the image, like the players)
  drawFeed(src, w, h) {
    if (!w || !h) return;
    const tex = this.feedTex;
    if (tex.width !== w || tex.height !== h) tex.setSize(w, h);
    tex.context.drawImage(src, 0, 0, w, h);
    tex.refresh();
    this.feedShown = performance.now();
  }

  // everyone's hands stayed up for the whole 3-2-1: lock the players in and go and pick animals
  startGame() {
    tracker.lock(session.kbCount);
    if (tracker.players.length === 0) { this.msg.setText('Couldn’t see anyone'); this.countFrom = null; return; }
    this.scene.start('Pick');
  }

  update(time) {
    const g = this.g;
    g.clear();
    const aspect = tracker.aspect;
    // the camera's view, as big as the screen allows (its picture's shape, centred)
    const s = Math.min(W / aspect, H);
    const ox = (W - aspect * s) / 2, oy = (H - s) / 2;
    const f = this.frame = { x: ox, y: oy, w: aspect * s, h: s };
    const map = (p) => ({ x: ox + p.x * s, y: oy + p.y * s });
    // live picture behind it all
    if (stats.source === 'webcam' && localCam.video && time - (this.lastWebcam || 0) > 100) {
      this.lastWebcam = time;
      const v = localCam.video, k = 320 / (v.videoWidth || 320);
      this.drawFeed(v, 320, Math.round((v.videoHeight || 240) * k));
    } else if (net.pic && net.pic.at !== this.picAt) { this.picAt = net.pic.at; this.feedImg.src = net.pic.data; }
    const fresh = performance.now() - (this.feedShown || -1e9) < 2000;
    this.feed.setVisible(fresh).setPosition(ox + f.w / 2, oy + f.h / 2).setDisplaySize(f.w, f.h);
    // the edges of what the camera sees
    this.frameG.clear().lineStyle(6, 0xfff8e6, 0.55).strokeRect(ox + 3, oy + 3, f.w - 6, f.h - 6);
    if (!fresh) this.frameG.fillStyle(0x16303f, 1).fillRect(ox + 6, oy + 6, f.w - 12, f.h - 12);

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

    // Everyone raises both hands → 3, 2, 1 (it stops if anyone lowers theirs) → pick animals
    const allUp = (n > 0 && people.every((t) => time - (t.handsUpAt ?? -1e9) < 300)) || this.enterKey.isDown;
    if (allUp) {
      if (this.countFrom === null) this.countFrom = time;
      const left = 3 - Math.floor((time - this.countFrom) / 1000);
      this.big.setText(left > 0 ? String(left) : '');
      this.msg.setText('🙌 Keep them up!');
      if (time - this.countFrom >= 3000) { this.countFrom = null; this.big.setText(''); this.startGame(); return; }
    } else {
      if (this.countFrom !== null) { this.stopMsgAt = time; }      // someone dropped: stop
      this.countFrom = null;
      this.big.setText('');
      if (time - (this.stopMsgAt ?? -1e9) < 1500) this.msg.setText('✋ Everyone keep your hands up!');
      else if (handsUp > 0 && n > 1) this.msg.setText(`🙌 Everyone hands up! (${handsUp} of ${n})`);
      else if (!this.msg.text.startsWith('Couldn')) this.msg.setText('');
    }
    this.stage.render();
  }
}

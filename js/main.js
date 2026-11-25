import { net, stats, tracker, input, keyboardHelp } from './core.js';
import { multicam } from './multicam.js';
import { session } from './scenes/common.js';
import { keepAwake } from './awake.js';

// the game screen must never go to sleep (phone mode especially; on a PC it stops the display blanking)
keepAwake(true);

// a blank first screen: the host's menu sits over it until Start opens the lobby
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    initMenu();
    const go = () => this.scene.start('Lobby');
    // ?menu=0 skips the menu (straight to the lobby with the last queue)
    if (new URLSearchParams(location.search).get('menu') === '0') { import('./games.js').then((g) => { g.setQueue(g.savedQueue()); go(); }); }
    else showMenu(go);
  }
}
import { initCalibration, linkCameras } from './calibui.js';
import { W, H, ASPECT } from './scenes/common.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { PickScene } from './scenes/PickScene.js';
import { showMenu, initMenu } from './menu.js';
import { GameOverScene } from './scenes/GameOverScene.js';
import { ThanksScene } from './scenes/ThanksScene.js';

const $ = (id) => document.getElementById(id);
$('wrap').style.setProperty('--ar', String(ASPECT));

// ---- phone connection + QR code
net.onStatus = (s) => {
  // in phone mode the camera-phone connection is only shown when its QR code is shown
  const b = document.body.classList;
  if (!b.contains('phone') || b.contains('show-qr')) $('status').textContent = s;
};
net.start();
$('room').textContent = net.roomId;
$('link').textContent = net.phoneUrl;
$('link').href = net.phoneUrl;
const qr = window.qrcode(0, 'M');
qr.addData(net.phoneUrl);
qr.make();
$('qr').src = qr.createDataURL(6, 8);
$('kbhelp').textContent = keyboardHelp;

// ---- linking cameras: the button shows once 2+ phones are connected
initCalibration();
$('linkBtn').onclick = () => { $('linkBtn').blur(); linkCameras(); };
setInterval(() => {
  const phones = net.conns.filter((c) => c.open).length, linked = multicam.linked().length;
  $('linkBtn').hidden = phones < 2;
  // keep the corner card small: the address only until a phone joins, key help only with keyboard players
  $('link').hidden = phones > 0;
  $('kbhelp').hidden = !session.kbCount;
  $('linkBtn').textContent = linked >= 2 ? `🔗 ${linked} cameras linked — link again` : `🔗 Link ${phones} cameras`;
}, 500);

// ---- debug HUD (press D to toggle)
const BUILD = document.querySelector('meta[name=build]')?.content || 'dev';   // stamped by tools/stamp.py
setInterval(() => {
  const live = performance.now() - stats.lastFrame < 1500;
  const players = tracker.players.map((p, i) => `P${i + 1}${input(p).present ? '' : ' (lost)'}`).join(' ');
  $('hud').innerHTML = [
    `${stats.source}${live ? '' : ' (no frames)'} · <b>${stats.fps}</b> fps · pose <b>${stats.inf}</b> ms`,
    `round trip <b>${stats.rtt ?? '–'}</b> ms · people <b>${stats.people}</b>${stats.linked > 1 ? ` · cameras <b>${stats.linked}</b> linked` : ''}`,
    live ? (stats.world3D ? '3D body: <b>✓</b>' : '3D body: <b>✗</b> — reload the phone page') : '',
    `build <b>${BUILD}</b>`,
    stats.phoneBuild && stats.phoneBuild !== BUILD ? `<span style="color:#ffb4a8">phone is on build <b>${stats.phoneBuild}</b> — reload the phone page</span>` : '',
    players ? `players: ${players}` : '',
  ].filter(Boolean).join('<br>');
}, 250);
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' && !tracker.players.some((p) => p.kind === 'keyboard')) $('hud').hidden = !$('hud').hidden;
  if (e.key === 'F9') $('hud').hidden = !$('hud').hidden;
});

// ---- game
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#10202b',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, LobbyScene, PickScene, GameOverScene, ThanksScene],          // the mini games are added when they're loaded (js/games.js)
});

// If something goes wrong, say so on screen (with the error), instead of just freezing —
// so it can be reported. Tap the note to reload.
function oops(what) {
  let el = document.getElementById('oops');
  if (!el) {
    el = document.createElement('div');
    el.id = 'oops';
    Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '12px', transform: 'translateX(-50%)', zIndex: 9999, maxWidth: '90vw',
      background: '#9b3b2f', color: '#fff', font: '600 14px system-ui, sans-serif', padding: '8px 14px', borderRadius: '10px', cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)', whiteSpace: 'pre-wrap' });
    el.onclick = () => location.reload();
    document.body.appendChild(el);
  }
  el.textContent = `⚠️ Something went wrong (build ${document.querySelector('meta[name="build"]')?.content || '?'}) — tap to reload\n${String(what).slice(0, 300)}`;
}
window.addEventListener('error', (e) => oops(`${e.message} @ ${(e.filename || '').split('/').slice(-2).join('/')}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => oops(e.reason?.stack?.split('\n').slice(0, 2).join(' ') || e.reason));
game.events.once('ready', () => game.canvas?.addEventListener('webglcontextlost', () => oops('The screen\'s graphics were lost (WebGL context lost) — too many 3D views or out of memory')));

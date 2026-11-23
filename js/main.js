import { net, stats, tracker, input, keyboardHelp } from './core.js';
import { W, H, ASPECT } from './scenes/common.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { PickScene } from './scenes/PickScene.js';
import { RaceScene } from './scenes/RaceScene.js';
import { PasswordScene } from './scenes/PasswordScene.js';
import { ResultsScene } from './scenes/ResultsScene.js';

const $ = (id) => document.getElementById(id);
$('wrap').style.setProperty('--ar', String(ASPECT));

// ---- phone connection + QR code
net.onStatus = (s) => { $('status').textContent = s; };
net.start();
$('room').textContent = net.roomId;
$('link').textContent = net.phoneUrl;
$('link').href = net.phoneUrl;
const qr = window.qrcode(0, 'M');
qr.addData(net.phoneUrl);
qr.make();
$('qr').src = qr.createDataURL(6, 8);
$('kbhelp').textContent = keyboardHelp;

// ---- debug HUD (press D to toggle)
const BUILD = '11-24 torso+wrists';   // shows which version the browser has loaded
setInterval(() => {
  const live = performance.now() - stats.lastFrame < 1500;
  const players = tracker.players.map((p, i) => `P${i + 1}${input(p).present ? '' : ' (lost)'}`).join(' ');
  $('hud').innerHTML = [
    `${stats.source}${live ? '' : ' (no frames)'} · <b>${stats.fps}</b> fps · pose <b>${stats.inf}</b> ms`,
    `round trip <b>${stats.rtt ?? '–'}</b> ms · people <b>${stats.people}</b>`,
    live ? (stats.world3D ? '3D body: <b>✓</b>' : '3D body: <b>✗</b> — reload the phone page') : '',
    `build <b>${BUILD}</b>`,
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
  scene: [LobbyScene, PickScene, RaceScene, PasswordScene, ResultsScene],
});

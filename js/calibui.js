// Linking cameras, and getting back on track when a phone is knocked.
//
//  • Lobby, 2+ phones: "Link cameras" → one person walks about → cameras linked.
//  • During a game, a phone is knocked: the game pauses ("Camera 2 was moved"), waits
//    until the phone is put back and still, then calls out ONE player by their animal
//    to walk about while the other cameras watch, re-links that camera, has everyone
//    stand still for a moment (re-measures their standing posture), counts down, resumes.
//    With only one camera there is nothing to link to: it just does the "stand still" part.
import { multicam } from './multicam.js';
import { net, tracker, input } from './core.js';
import { CHARACTERS } from './scenes/common.js';

const $ = (id) => document.getElementById(id);
const EMOJI = { bear: '🐻', dog: '🐶', chicken: '🐔', hamster: '🐹', walrus: '🦭' };
const camName = (id) => `Camera ${multicam.cam(id).num}`;

let el = null, map = null, flow = null, paused = [];

function ui() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'calib';
  el.innerHTML = `
    <div class="cbox">
      <h2 id="cTitle"></h2>
      <div id="cSay"></div>
      <div id="cBars"></div>
      <canvas id="cMap" width="520" height="300"></canvas>
      <div id="cNote"></div>
      <div class="cbtns"><button id="cRetry" hidden>Try again</button><button id="cSkip">Skip</button></div>
    </div>`;
  document.getElementById('wrap').appendChild(el);
  map = $('cMap').getContext('2d');
  $('cSkip').onclick = () => end(false);
  $('cRetry').onclick = () => { const f = flow; end(false, true); if (f.kind === 'link') linkCameras(); else onMoved(f.cam, true); };
}
function show(title, say = '', note = '') {
  ui(); el.hidden = false;
  $('cTitle').textContent = title; $('cSay').innerHTML = say; $('cNote').textContent = note;
}

// pause / resume whatever game scenes are running (not the lobby)
function pauseGame() {
  const g = window.game; if (!g) return;
  paused = g.scene.getScenes(true).filter((s) => s.scene.key !== 'Lobby');
  paused.forEach((s) => s.scene.pause());
}
function resumeGame() { paused.forEach((s) => { try { s.scene.resume(); } catch (_) {} }); paused = []; }
export const inGame = () => !!window.game?.scene.getScenes(true).some((s) => s.scene.key !== 'Lobby');

// ---------------------------------------------------------------- the map (seen from above)
function drawMap() {
  if (!map) return;
  const W = 520, H = 300, cams = multicam.layout().filter((c) => c.linked);
  map.clearRect(0, 0, W, H);
  map.fillStyle = 'rgba(255,255,255,0.06)'; map.fillRect(0, 0, W, H);
  const pts = cams.map((c) => [c.x, c.z]).concat((multicam.spots || []).map((s) => [s.x, s.z]), [[0, 0]]);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const k = Math.min(W / (Math.max(...xs) - Math.min(...xs) + 3), H / (Math.max(...zs) - Math.min(...zs) + 3));
  const P = (x, z) => [W / 2 + (x - cx) * k, H / 2 + (z - cz) * k];
  // a 1 m grid
  map.strokeStyle = 'rgba(255,255,255,0.08)'; map.lineWidth = 1;
  for (let g = -10; g <= 10; g++) {
    let [a, b] = P(g + Math.round(cx), -50), [c, d] = P(g + Math.round(cx), 50); map.beginPath(); map.moveTo(a, b); map.lineTo(c, d); map.stroke();
    [a, b] = P(-50, g + Math.round(cz)); [c, d] = P(50, g + Math.round(cz)); map.beginPath(); map.moveTo(a, b); map.lineTo(c, d); map.stroke();
  }
  for (const c of cams) {
    const [x, y] = P(c.x, c.z), half = (c.fov * Math.PI) / 360, r = 3.5 * k;
    const dirScreen = Math.atan2(Math.cos(c.dir), Math.sin(c.dir));   // room (x, z) → screen angle
    map.fillStyle = 'rgba(242,181,68,0.13)';
    map.beginPath(); map.moveTo(x, y); map.arc(x, y, r, dirScreen - half, dirScreen + half); map.closePath(); map.fill();
    map.fillStyle = '#f2b544'; map.beginPath(); map.arc(x, y, 9, 0, Math.PI * 2); map.fill();
    map.fillStyle = '#1d1d1d'; map.font = 'bold 12px system-ui'; map.textAlign = 'center'; map.textBaseline = 'middle';
    map.fillText(String(c.num), x, y);
  }
  for (const s of multicam.spots || []) {
    const [x, y] = P(s.x, s.z);
    map.fillStyle = s.cams > 1 ? '#8be07a' : '#5ec8e5'; map.beginPath(); map.arc(x, y, 7, 0, Math.PI * 2); map.fill();
  }
}

function bars(ids) {
  $('cBars').innerHTML = ids.map((id) => {
    const p = multicam.progress(id);
    return `<div class="cbar"><span>${camName(id)}</span><div><i style="width:${Math.round(p.k * 100)}%"></i></div></div>`;
  }).join('');
}
const HINT = {
  walk: 'keep walking around slowly and wave your arms',
  side: 'now walk from side to side',
  depth: 'now walk towards the cameras and back',
  ok: 'nearly there…',
};

// ---------------------------------------------------------------- link all cameras (lobby)
export function linkCameras() {
  const ids = net.conns.filter((c) => c.open).map((c) => c.peer);
  const main = net.conn?.peer;
  ids.sort((a, b) => (a === main ? -1 : b === main ? 1 : 0));
  if (ids.length < 2) { show('🔗 Link cameras', 'Connect a second phone first (scan the QR code with it).'); setTimeout(() => end(false), 2500); return; }
  for (const id of ids) multicam.cam(id).calib = null;
  multicam.view = ids[0];
  multicam.startCalibration(ids, { alone: true });
  flow = { kind: 'link', ids, started: performance.now() };
  show(`🔗 Linking ${ids.length} cameras`,
    '<b>One person:</b> walk slowly around the play area and wave your arms.<br><b>Everyone else:</b> step out of view for a moment.',
    'All cameras need to see the walker. Takes about 10 seconds.');
}

// ---------------------------------------------------------------- a camera was knocked
export function onMoved(id, again = false) {
  if (flow && flow.kind === 'moved' && !again) {             // already sorting one out: add this one
    if (!flow.cams.includes(id)) flow.cams.push(id);
    flow.phase = 'still'; return;
  }
  const playing = inGame();
  if (!playing && !again) { net.onStatus?.(`${camName(id)} moved — link the cameras again`); return; }
  if (!again) pauseGame();
  flow = { kind: 'moved', cam: id, cams: [id], phase: 'still', since: 0, started: performance.now() };
  show(`⏸ ${camName(id)} was moved`, `Put ${camName(id)} back where it was and leave it still.`);
}

// the player to call out: someone present in the game, shown by their animal
function caller() {
  const pl = tracker.players.find((p) => p.kind === 'camera' && input(p).present) || tracker.players.find((p) => p.kind === 'camera');
  if (!pl) return { text: 'One person' };
  const ch = CHARACTERS.find((c) => c.id === pl.animal);
  return { pl, text: `${EMOJI[pl.animal] || ''} <b style="color:${pl.css}">${ch ? ch.name : `Player ${pl.slot + 1}`}</b>` };
}

function standStill() {
  flow.phase = 'bodies'; flow.since = performance.now();
  $('cBars').innerHTML = ''; $('cRetry').hidden = true;
  show('🧍 Everyone stand still', 'Stand where you are and face the screen…');
}
function countdownAndGo() {
  flow.phase = 'go'; flow.since = performance.now();
}

function end(ok, keepPaused = false) {
  if (multicam.session) multicam.cancelCalibration();
  if (el) { el.hidden = true; $('cSkip').hidden = false; $('cBars').innerHTML = ''; }
  $('cRetry') && ($('cRetry').hidden = true);
  if (!keepPaused) resumeGame();
  flow = null;
  net.roles?.();
}

// ---------------------------------------------------------------- every frame
function tick() {
  requestAnimationFrame(tick);
  if (!flow) return;
  const now = performance.now();
  drawMap();
  if (flow.kind === 'link') {
    if (flow.done) return;
    const targets = flow.ids.slice(1);
    bars(targets);
    const ps = targets.map((id) => multicam.progress(id));
    if (ps.length) $('cSay').innerHTML = `<b>One person:</b> ${HINT[ps.reduce((a, p) => (p.k < a.k ? p : a)).hint]}.<br><b>Everyone else:</b> step out of view for a moment.`;
    if (ps.every((p) => p.k >= 1) && !flow.solving) {
      flow.solving = true;
      setTimeout(() => {
        const r = multicam.finish();
        if (r && r.ok) {
          const cm = Math.max(...[...r.results.values()].map((x) => x.rms * 100));
          flow.done = true;
          $('cBars').innerHTML = ''; $('cSkip').hidden = true;
          show('✓ Cameras linked!', `${flow.ids.length} cameras now work together.`, `Accuracy about ${Math.round(cm)} cm.`);
          net.roles();
          setTimeout(() => end(true), 2500);
        } else fail(r);
      }, 30);
    } else if (now - flow.started > 60000) fail(null);
    return;
  }
  // knocked camera(s)
  const id = flow.cams[0], cam = multicam.cams.get(id);
  if (flow.phase === 'still') {
    if (!cam || !cam.connected) { $('cSay').textContent = `Waiting for ${camName(id)} to reconnect…`; return; }
    if (cam.still) { if (!flow.since) flow.since = now; } else flow.since = 0;
    if (flow.since && now - flow.since > 1200) {
      const helpers = multicam.linked();
      if (helpers.length >= 1) {
        flow.phase = 'relink'; flow.started = now;
        multicam.startCalibration(flow.cams);
        const who = caller();
        show(`🔗 Linking ${camName(id)} again`, `${who.text}, walk around slowly in front of ${camName(id)} and wave your arms!<br>Everyone else, stand still.`);
      } else standStill();
    }
    return;
  }
  if (flow.phase === 'relink') {
    bars(flow.cams);
    const ps = flow.cams.map((c) => multicam.progress(c));
    if (ps.every((p) => p.k >= 1) && !flow.solving) {
      flow.solving = true;
      setTimeout(() => {
        const r = multicam.finish();
        flow.solving = false;
        if (r && r.ok) { show(`✓ ${camName(id)} is back!`, ''); net.roles(); setTimeout(standStill, 1200); } else fail(r);
      }, 30);
    } else if (now - flow.started > 45000) fail(null);
    return;
  }
  if (flow.phase === 'bodies') {
    const left = 3 - Math.floor((now - flow.since) / 1000);
    $('cSay').textContent = left > 0 ? `Stand where you are and face the screen… ${left}` : '';
    if (left <= 0) {
      for (const pl of tracker.players) if (pl.kind === 'camera' && pl.body && input(pl).present) pl.body.calibrateFromCurrent();
      countdownAndGo();
    }
    return;
  }
  if (flow.phase === 'go') {
    const left = 3 - Math.floor((now - flow.since) / 700);
    show(left > 0 ? String(left) : 'Go!', '');
    $('cMap').hidden = true;
    if (left <= -1) { $('cMap').hidden = false; end(true); }
  }
}
function fail(r) {
  const bad = r ? [...r.results.entries()].filter(([, x]) => !x.ok).map(([id]) => camName(id)).join(', ') : '';
  show('Couldn’t link the cameras', `${bad || 'The cameras'} couldn’t see the walker well enough.`, 'Check every camera can see the person walking, then try again — or skip to carry on with one camera.');
  $('cRetry').hidden = false;
  if (multicam.session) multicam.cancelCalibration();
  if (flow) flow.solving = false;
}

export function initCalibration() {
  net.onMoved = (id) => onMoved(id);
  requestAnimationFrame(tick);
}

import { cropFaces } from './facecrop.js';
import { clothesOf } from './clothes.js';
import { keepAwake } from './awake.js';
import { createPoseDetector, BONES } from './pose.js';
import { SPINE } from './bones.js';
import { createHandReader } from './hands.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const params = new URLSearchParams(location.search);
$('room').value = params.get('room') || location.hash.replace('#', '') || '';

let detector = null, stream = null, running = false, conn = null, peer = null;
let frames = 0, lastFpsT = performance.now(), fps = 0, lastInf = 0;
let showPreview = true, standby = false, wantPics = false, lastPic = 0;
const picCv = document.createElement('canvas'), pctx = picCv.getContext('2d');
const frameCv = document.createElement('canvas'), fctx = frameCv.getContext('2d');
let rot = 0;                     // how far the picture is turned before detection (degrees)
// the camera runs at high resolution (for reading hands and faces close up); the pose model,
// preview and clothes colours use a 640-wide copy
const smallCv = document.createElement('canvas'), sctx = smallCv.getContext('2d');
const SMALL_W = 640;
let hands = null, handsOff = params.get('hands') === '0', lastHands = [];

function setConn(text, cls) { const el = $('conn'); el.textContent = text; el.className = 'pill ' + cls; }
function msg(t) { $('msg').textContent = t; }

// ---------- networking ----------
// tap the status pill to try connecting again right now
document.getElementById('conn').addEventListener('click', () => {
  if (conn && conn.open) return;
  clearTimeout(openTimer);
  try { conn?.close(); } catch (_) {}
  conn = null;
  try { peer?.destroy(); } catch (_) {}
  peer = null;
  connect();
});
function connect() {
  const room = $('room').value.trim();
  if (conn && !conn.destroyed && (conn.open || performance.now() - connAt < 10000)) return;   // already linked / linking
  if (!room) { setConn('No room code', 'bad'); return; }
  if (!peer || peer.destroyed) {
    peer = new Peer();
    peer.on('open', () => openConn(room));
    peer.on('error', (e) => {
      console.warn(e);
      if (e.type === 'peer-unavailable') { setConn('Can’t find the big screen — retrying', 'bad'); msg('The big screen may have reloaded (it then shows a new QR code): scan the new code, or keep this open and it keeps trying.'); }
      else setConn('Error: ' + e.type, 'bad');
      retry();
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
  } else if (peer.open) {
    openConn(room);
  }
}
let tries = 0, openTimer = null, connAt = -1e9;
function openConn(room) {
  tries++;
  setConn(tries > 1 ? `Connecting… (try ${tries})` : 'Connecting…', 'wait');
  if (tries > 2) msg('Still connecting — check the big screen is on this game with its QR code showing, and that both are on the same Wi-Fi. Tap the yellow pill to try again.');
  connAt = performance.now();
  conn = peer.connect(room, { reliable: false, serialization: 'json' });
  const c = conn;
  // a link that never opens (the screen reloaded, slept, or the network blocks it): start again
  clearTimeout(openTimer);
  openTimer = setTimeout(() => {
    if (c.open || conn !== c) return;
    try { c.close(); } catch (_) {}
    conn = null;
    try { peer.destroy(); } catch (_) {}
    peer = null;
    connect();
  }, 10000);
  conn.on('open', () => {
    clearTimeout(openTimer); tries = 0;
    setConn(running ? 'Connected' : 'Connected to the big screen ✓', 'ok');
    if (!running) msg('Linked to the big screen ✓ — now tap “Start camera”.');
    conn.send({ type: 'hello', dev: DEV, ua: navigator.userAgent, camera: currentCameraLabel(), cam: running, build: document.querySelector('meta[name=build]')?.content });
  });
  conn.on('data', (d) => {
    if (d && d.type === 'ping') conn.send({ type: 'pong', t: d.t });
    // another phone is already the camera: wait on standby (until it goes, or "Use this camera")
    // the big screen's lobby shows a small, faint copy of this camera's picture
    if (d && d.type === 'pics') wantPics = !!d.on;
    // face snapshots for the Hall of Fame, cut from this camera's own (sharp) picture
    if (d && d.type === 'faces') send({ type: 'faces', id: d.id, images: frameCv.width ? cropFaces(frameCv, d.boxes || []) : [] });
    if (d && d.type === 'role') {
      standby = !d.active && !d.linked;
      setConn(d.active ? 'Connected — main camera' : d.linked ? 'Connected — linked camera' : 'Standby — another phone is the main camera (link the cameras on the big screen to use both)', standby ? 'wait' : 'ok');
      $('take').hidden = d.active;
    }
  });
  conn.on('close', () => { if (conn !== c) return; setConn('Disconnected — retrying', 'bad'); conn = null; retry(); });
  conn.on('error', () => { setConn('Connection error', 'bad'); });
}
let retryTimer = null;
function retry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (!conn || !conn.open) connect(); }, 2500);
}
function send(obj) { if (conn && conn.open) { try { conn.send(obj); } catch (_) {} } }

// ---------- camera ----------
function currentCameraLabel() {
  const t = stream && stream.getVideoTracks()[0];
  return t ? t.label : '';
}
// The widest view: 4:3 uses the whole sensor (16:9 crops it), the lens is zoomed all the
// way out if the phone allows it, and a camera called "ultra wide" is preferred.
// The camera picked in the list is remembered for next time.
const SAVED = 'ark-camera';
// this phone's own lasting name, so the big screen knows it again after a reconnect
const DEV = (() => { try { let v = localStorage.getItem('ark-dev'); if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem('ark-dev', v); } return v; } catch (_) { return Math.random().toString(36).slice(2, 10); } })();
// Always the widest shot: an ultra-wide back camera whenever the phone has one we can recognise
// (every start, not just the first); otherwise the camera picked last time; and always zoomed
// all the way out (on many phones the ultra-wide lens is reached by zooming below 1×).
async function startCamera(deviceId = null, firstTime = false) {
  if (!deviceId) {
    // labels are only readable once the camera is allowed: open any camera first if needed
    let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (!devices.some((d) => d.label)) {
      await openCamera(null);
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    }
    const wide = devices.find((d) => /ultra|wide|0[.,]5|uw\b/i.test(d.label) && !/front|user|face/i.test(d.label));
    if (wide) deviceId = wide.deviceId;
    else { try { deviceId = localStorage.getItem(SAVED); } catch (_) {} }
  }
  const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
  if (!stream || !deviceId || deviceId !== current) {
    try { await openCamera(deviceId); } catch (e) { if (!deviceId) throw e; await openCamera(null); }
  }
  await zoomOut();
  await fillCameraList();
  showCamInfo();
  send({ type: 'hello', dev: DEV, ua: navigator.userAgent, camera: currentCameraLabel(), build: document.querySelector('meta[name=build]')?.content });
}
// zoom: all the way out at every start (the widest shot); the slider lets the player choose
// any zoom the phone offers, and that choice holds until the camera is started again
let wantZoom = null;
async function zoomOut() {
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const row = $('zoomRow'), slider = $('zoom');
  if (!(caps.zoom && caps.zoom.min !== undefined && caps.zoom.max > caps.zoom.min)) { row.hidden = true; return; }
  wantZoom = caps.zoom.min;
  slider.min = caps.zoom.min; slider.max = caps.zoom.max; slider.step = caps.zoom.step || 0.1; slider.value = wantZoom;
  row.hidden = false;
  await applyZoom(track);
  // some phones drift back to 1× a moment later: check again
  setTimeout(() => {
    try { if (track.readyState === 'live' && Math.abs((track.getSettings().zoom ?? wantZoom) - wantZoom) > 0.01) applyZoom(track); } catch (_) {}
  }, 1500);
}
async function applyZoom(track = stream?.getVideoTracks()[0]) {
  if (!track || wantZoom === null) return;
  try { await track.applyConstraints({ advanced: [{ zoom: wantZoom }] }); } catch (_) {}
  $('zoomVal').textContent = `${(+wantZoom).toFixed(1)}×`;
  showCamInfo();
}
$('zoom').addEventListener('input', (e) => { wantZoom = +e.target.value; applyZoom(); });
function showCamInfo() {
  const track = stream.getVideoTracks()[0], st = track.getSettings();
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const zoom = st.zoom !== undefined ? ` · zoom ${(+st.zoom).toFixed(1)}×${caps.zoom ? ` (min ${caps.zoom.min})` : ''}` : '';
  $('caminfo').textContent = `Camera: ${track.label || 'camera'} · ${st.width}×${st.height}${zoom}`;
}
async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1600 }, height: { ideal: 1200 }, frameRate: { ideal: 30 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 }, frameRate: { ideal: 30 } },
  };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
}
async function fillCameraList() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('camera');
  const current = stream.getVideoTracks()[0].getSettings().deviceId;
  sel.innerHTML = '';
  devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || `Camera ${i + 1}`;
    if (d.deviceId === current) o.selected = true;
    sel.appendChild(o);
  });
  sel.hidden = devices.length < 2;
}
$('camera').addEventListener('change', (e) => {
  try { localStorage.setItem(SAVED, e.target.value); } catch (_) {}
  startCamera(e.target.value).catch((err) => msg('Camera error: ' + err.message));
});

// ---------- landscape: turn the picture upright ----------
// With the phone on its side (and auto-rotate off) the camera picture is sideways.
// The tilt sensor says which way is down; the picture is turned to match before
// the people are detected, so standing people are upright and a sideways phone
// gives a wide view. "Picture: …" can also be set by hand.
// gravityAngle: how far the phone is turned anticlockwise (0 upright, 90 = top to the left,
// -90 = top to the right, 180 upside down) — the same way round as screen.orientation.angle
let gravityAngle = 0;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);   // iPhones report gravity the other way round
// ---------- knocked over? ----------
// A jolt (shake far beyond gravity), or the phone settling at a clearly different angle
// than before, means the camera moved: tell the big screen (it pauses and re-links it).
// "still" goes out with every frame: no jolt for 1.5 s and a settled angle.
let baseG = null, lastJolt = 0, sentMoved = false, smoothG = null, motionSeen = false;
function watchKnocks(g, now) {
  motionSeen = true;
  const mag = Math.hypot(g.x, g.y, g.z);
  if (Math.abs(mag - 9.81) > 4.5) lastJolt = now;
  smoothG = smoothG ? smoothG.map((v, i) => v + ([g.x, g.y, g.z][i] - v) * 0.1) : [g.x, g.y, g.z];
  const settled = now - lastJolt > 1500;
  if (baseG) {
    const c = (baseG[0] * smoothG[0] + baseG[1] * smoothG[1] + baseG[2] * smoothG[2]) / (Math.hypot(...baseG) * Math.hypot(...smoothG));
    const tilted = Math.acos(Math.max(-1, Math.min(1, c))) > 12 * Math.PI / 180;
    if ((tilted || now - lastJolt < 50) && !sentMoved) { sentMoved = true; send({ type: 'moved' }); baseG = null; }
  } else if (settled) { baseG = [...smoothG]; sentMoved = false; }
}
const isStill = () => !motionSeen || (!!baseG && performance.now() - lastJolt > 1500);   // no sensor: assume still

window.addEventListener('devicemotion', (e) => {
  const g = e.accelerationIncludingGravity; if (!g || g.x === null) return;
  watchKnocks(g, performance.now());
  const gx = IOS ? -g.x : g.x, gy = IOS ? -g.y : g.y;        // "up" in the phone's own x (right) / y (top)
  const ax = Math.abs(gx), ay = Math.abs(gy);
  if (Math.max(ax, ay) < 4) return;                                  // lying flat: keep the last answer
  const a = ax > ay * 1.3 ? (gx > 0 ? 90 : -90) : ay > ax * 1.3 ? (gy > 0 ? 0 : 180) : gravityAngle;
  gravityAngle = a;
});
function wantedRotation() {
  const mode = $('rotate').value;
  if (mode !== 'auto') return +mode;
  const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  // the picture is turned by however much more the phone is turned than the screen is,
  // back the other way (canvas angles go clockwise)
  let r = -(gravityAngle - screenAngle) % 360;
  if (r > 180) r -= 360; if (r <= -180) r += 360;
  return r;
}
// the current camera picture, turned upright (returns the canvas to detect on)
function uprightFrame() {
  rot = wantedRotation();
  const vw = video.videoWidth, vh = video.videoHeight, side = Math.abs(rot) === 90;
  const w = side ? vh : vw, h = side ? vw : vh;
  if (frameCv.width !== w || frameCv.height !== h) { frameCv.width = w; frameCv.height = h; }
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.translate(w / 2, h / 2);
  fctx.rotate(rot * Math.PI / 180);
  fctx.drawImage(video, -vw / 2, -vh / 2);
  document.body.classList.toggle('rotated', rot !== 0);
  const turn = rot === 0 ? 'upright' : rot === 180 ? 'upside down' : rot > 0 ? 'turned ↻' : 'turned ↺';
  if ($('turn').textContent !== turn) $('turn').textContent = turn;
  $('stage').style.aspectRatio = `${w} / ${h}`;
  // a tall (portrait) picture sees far fewer people: ask for the phone to go sideways
  const tall = h > w * 1.05;
  if ($('turnTip').hidden === tall) $('turnTip').hidden = !tall;
  const sw = Math.min(SMALL_W, w), sh = Math.round(sw * h / w);
  if (smallCv.width !== sw || smallCv.height !== sh) { smallCv.width = sw; smallCv.height = sh; }
  sctx.drawImage(frameCv, 0, 0, sw, sh);
  return smallCv;
}

// ---------- staying awake, with a dark screen ----------
// A web page can't keep the camera running with the screen OFF (the browser pauses the
// page). So the phone stays awake, and after a while without a touch the page goes fully
// black instead: on phones whose screens light each pixel (OLED) black pixels are off, so
// it looks off and uses little power — while the camera keeps tracking. Tap to wake it.
const SAVER_AFTER = 25000;
let lastTouch = performance.now(), saver = false;
function setSaver(on) {
  if (saver === on) return;
  saver = on;
  $('saver').hidden = !on;
}
for (const ev of ['pointerdown', 'touchstart', 'keydown']) window.addEventListener(ev, () => { lastTouch = performance.now(); setSaver(false); }, { passive: true });
setInterval(() => { if (running && performance.now() - lastTouch > SAVER_AFTER) setSaver(true); }, 1000);

// ---------- main loop ----------
function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.videoWidth) {
    const src = uprightFrame();
    // a small preview picture for the lobby, 4 a second (~10 KB each)
    if (wantPics && performance.now() - lastPic > 250) {
      lastPic = performance.now();
      const w = 320, h = Math.round(320 * src.height / src.width);
      if (picCv.width !== w || picCv.height !== h) { picCv.width = w; picCv.height = h; }
      pctx.drawImage(src, 0, 0, w, h);
      send({ type: 'pic', data: picCv.toDataURL('image/jpeg', 0.5) });
    }
    const { poses, worlds, ms } = detector.detect(src);
    lastInf = ms;
    frames++;
    const aspect = src.width / src.height;
    // everyone's clothes colours, a few times a second (to tell the players apart)
    const colors = frames % 3 === 0 ? clothesOf(src, poses) : undefined;
    // hands, read close up from the full-resolution picture (a few per frame, taking turns)
    if (hands && !handsOff && poses.length) {
      try { lastHands = hands.read(frameCv, poses); } catch (e) { console.warn('hands', e); }
      if (hands.msPerHand > 70) { handsOff = true; msg('Hand reading switched off (this phone is too slow for it)'); }
    } else lastHands = [];
    send({ type: 'pose', t: performance.now(), inf: Math.round(ms), fps, aspect, poses, worlds, colors, hands: lastHands.length ? lastHands : undefined, still: isStill() });
    draw(poses);
    if (!saver && lastHands.length) {
      // what the hand reader sees: ✊ fist, ✋ open (fresh readings only)
      ctx.font = '28px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const h of lastHands) if (h.a < 250) ctx.fillText(h.g > 0.6 ? '✊' : h.g < 0.35 ? '✋' : '🤏', h.u * overlay.width, h.v * overlay.height - 22);
    }
    $('people').textContent = `${poses.length} ${poses.length === 1 ? 'person' : 'people'}`;
  }
  const now = performance.now();
  if (now - lastFpsT > 1000) {
    fps = Math.round((frames * 1000) / (now - lastFpsT));
    frames = 0; lastFpsT = now;
    $('fps').textContent = fps + ' fps';
    $('inf').textContent = Math.round(lastInf) + ' ms';
  }
  requestAnimationFrame(loop);
}

const COLORS = ['#f2b544', '#5ec8e5', '#f27a9b', '#8be07a'];
function draw(poses) {
  if (saver) return;                                  // dark screen: draw nothing
  const vw = smallCv.width, vh = smallCv.height;
  if (overlay.width !== vw || overlay.height !== vh) { overlay.width = vw; overlay.height = vh; }
  ctx.clearRect(0, 0, vw, vh);
  if (!showPreview) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh); }
  else if (rot !== 0) ctx.drawImage(smallCv, 0, 0);       // the turned picture (the <video> is hidden then)
  poses.forEach((p, k) => {
    ctx.strokeStyle = COLORS[k % COLORS.length]; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      if (p[a * 3 + 2] < 0.4 || p[b * 3 + 2] < 0.4) continue;
      ctx.beginPath();
      ctx.moveTo(p[a * 3] * vw, p[a * 3 + 1] * vh);
      ctx.lineTo(p[b * 3] * vw, p[b * 3 + 1] * vh);
      ctx.stroke();
    }
    // spine: hips → waist → chest → neck, with a joint at each (upper and lower body bend apart here)
    const vis = (i) => p[i * 3 + 2] >= 0.4;
    const midOf = ([i, j]) => [(p[i * 3] + p[j * 3]) / 2 * vw, (p[i * 3 + 1] + p[j * 3 + 1]) / 2 * vh];
    const sp = SPINE.filter(([a, b2]) => [...a, ...b2].every(vis)).map(([a, b2, t]) => {
      const m1 = midOf(a), m2 = midOf(b2); return [m1[0] + (m2[0] - m1[0]) * t, m1[1] + (m2[1] - m1[1]) * t];
    });
    if (sp.length > 1) { ctx.beginPath(); ctx.moveTo(...sp[0]); sp.slice(1).forEach((q) => ctx.lineTo(...q)); ctx.stroke(); }
    ctx.fillStyle = '#ffffff';
    sp.forEach((q) => { ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, Math.PI * 2); ctx.fill(); });
    // joints: shoulders, elbows, wrists, hips, knees, ankles
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if (!vis(i)) continue;
      ctx.beginPath(); ctx.arc(p[i * 3] * vw, p[i * 3 + 1] * vh, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = COLORS[k % COLORS.length];
    ctx.beginPath(); ctx.arc(p[0] * vw, p[1] * vh, 10, 0, Math.PI * 2); ctx.fill();
  });
}

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  try {
    connect();
    msg('Starting camera…');
    // iPhone needs permission for the tilt sensor (asked on this tap)
    try { if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission(); } catch (_) {}
    await startCamera(null, true);
    $('rotate').hidden = false;
    if (!detector) {
      detector = await createPoseDetector({ numPoses: 4, onStatus: msg });
      $('engine').textContent = 'engine ' + detector.delegate;
    }
    if (!hands && !handsOff) createHandReader().then((h) => { hands = h; }).catch((e) => { console.warn('no hand reader', e); handsOff = true; });
    msg('Running. You can leave this screen on.');
    running = true;
    send({ type: 'cam', on: true, camera: currentCameraLabel() });
    keepAwake(true);
    $('start').hidden = true; $('room').hidden = true;
    $('preview').hidden = false;
    $('darkBtn').hidden = false;
    loop();
  } catch (e) {
    console.error(e);
    msg('Error: ' + (e.message || e));
    $('start').disabled = false;
  }
});

$('take').addEventListener('click', () => send({ type: 'take' }));
$('darkBtn').addEventListener('click', (e) => { e.stopPropagation(); setTimeout(() => setSaver(true), 50); });

$('preview').addEventListener('click', () => {
  showPreview = !showPreview;
  document.body.classList.toggle('hidden-preview', !showPreview);
  $('preview').textContent = showPreview ? 'Hide preview (saves battery)' : 'Show preview';
});

// link up with the big screen straight away (before the camera), so the two steps are separate:
// first "Connected to the big screen ✓", then "Start camera"
if ($('room').value.trim()) connect();
else setConn('Not connected — type the room code', 'wait');
$('room').addEventListener('change', () => { if (!conn || !conn.open) { try { peer?.destroy(); } catch (_) {} peer = null; conn = null; connAt = -1e9; connect(); } });

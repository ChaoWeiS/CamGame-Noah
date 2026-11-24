import { createPoseDetector, BONES } from './pose.js';
import { SPINE } from './bones.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const params = new URLSearchParams(location.search);
$('room').value = params.get('room') || location.hash.replace('#', '') || '';

let detector = null, stream = null, running = false, conn = null, peer = null;
let frames = 0, lastFpsT = performance.now(), fps = 0, lastInf = 0;
let showPreview = true, wakeLock = null, standby = false, wantPics = false, lastPic = 0;
const picCv = document.createElement('canvas'), pctx = picCv.getContext('2d');
const frameCv = document.createElement('canvas'), fctx = frameCv.getContext('2d');
let rot = 0;                     // how far the picture is turned before detection (degrees)

function setConn(text, cls) { const el = $('conn'); el.textContent = text; el.className = 'pill ' + cls; }
function msg(t) { $('msg').textContent = t; }

// ---------- networking ----------
function connect() {
  const room = $('room').value.trim();
  if (!room) { setConn('No room code', 'bad'); return; }
  if (!peer || peer.destroyed) {
    peer = new Peer();
    peer.on('open', () => openConn(room));
    peer.on('error', (e) => { console.warn(e); setConn('Error: ' + e.type, 'bad'); retry(); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
  } else if (peer.open) {
    openConn(room);
  }
}
function openConn(room) {
  setConn('Connecting…', 'wait');
  conn = peer.connect(room, { reliable: false, serialization: 'json' });
  conn.on('open', () => {
    setConn('Connected', 'ok');
    conn.send({ type: 'hello', ua: navigator.userAgent, camera: currentCameraLabel(), build: document.querySelector('meta[name=build]')?.content });
  });
  conn.on('data', (d) => {
    if (d && d.type === 'ping') conn.send({ type: 'pong', t: d.t });
    // another phone is already the camera: wait on standby (until it goes, or "Use this camera")
    // the big screen's lobby shows a small, faint copy of this camera's picture
    if (d && d.type === 'pics') wantPics = !!d.on;
    if (d && d.type === 'role') {
      standby = !d.active && !d.linked;
      setConn(d.active ? 'Connected — main camera' : d.linked ? 'Connected — linked camera' : 'Standby — another phone is the camera (calibrate on the big screen to use both)', standby ? 'wait' : 'ok');
      $('take').hidden = d.active;
    }
  });
  conn.on('close', () => { setConn('Disconnected — retrying', 'bad'); conn = null; retry(); });
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
async function startCamera(deviceId = null, firstTime = false) {
  if (!deviceId && firstTime) { try { deviceId = localStorage.getItem(SAVED); } catch (_) {} }
  try { await openCamera(deviceId); } catch (e) { if (!deviceId) throw e; await openCamera(null); }
  if (firstTime && !deviceId) {
    // labels are only readable once the camera is allowed: look for an ultra-wide back camera
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const wide = devices.find((d) => /ultra|wide|0[.,]5/i.test(d.label) && !/front|user|face/i.test(d.label));
    if (wide && wide.deviceId !== stream.getVideoTracks()[0].getSettings().deviceId) {
      try { await openCamera(wide.deviceId); } catch (_) { await openCamera(null); }
    }
  }
  await zoomOut();
  await fillCameraList();
  showCamInfo();
  send({ type: 'hello', ua: navigator.userAgent, camera: currentCameraLabel(), build: document.querySelector('meta[name=build]')?.content });
}
async function zoomOut() {
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (caps.zoom && caps.zoom.min !== undefined) {
    try { await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }); } catch (_) {}
  }
}
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
      ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
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
  return frameCv;
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (_) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && running) keepAwake(); });

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
    send({ type: 'pose', t: performance.now(), inf: Math.round(ms), fps, aspect, poses, worlds, still: isStill() });
    draw(poses);
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
  const vw = frameCv.width, vh = frameCv.height;
  if (overlay.width !== vw || overlay.height !== vh) { overlay.width = vw; overlay.height = vh; }
  ctx.clearRect(0, 0, vw, vh);
  if (!showPreview) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh); }
  else if (rot !== 0) ctx.drawImage(frameCv, 0, 0);       // the turned picture (the <video> is hidden then)
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
    msg('Running. You can leave this screen on.');
    running = true;
    keepAwake();
    $('start').hidden = true; $('room').hidden = true;
    $('preview').hidden = false;
    loop();
  } catch (e) {
    console.error(e);
    msg('Error: ' + (e.message || e));
    $('start').disabled = false;
  }
});

$('take').addEventListener('click', () => send({ type: 'take' }));

$('preview').addEventListener('click', () => {
  showPreview = !showPreview;
  document.body.classList.toggle('hidden-preview', !showPreview);
  $('preview').textContent = showPreview ? 'Hide preview (saves battery)' : 'Show preview';
});

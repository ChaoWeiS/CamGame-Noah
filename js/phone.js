import { createPoseDetector, BONES } from './pose.js';
import { SPINE } from './bones.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const params = new URLSearchParams(location.search);
$('room').value = params.get('room') || location.hash.replace('#', '') || '';

let detector = null, stream = null, running = false, conn = null, peer = null;
let frames = 0, lastFpsT = performance.now(), fps = 0, lastInf = 0;
let showPreview = true, wakeLock = null;

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
async function startCamera(deviceId) {
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
  await fillCameraList();
  send({ type: 'hello', ua: navigator.userAgent, camera: currentCameraLabel(), build: document.querySelector('meta[name=build]')?.content });
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
$('camera').addEventListener('change', (e) => startCamera(e.target.value).catch((err) => msg('Camera error: ' + err.message)));

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
    const { poses, worlds, ms } = detector.detect(video);
    lastInf = ms;
    frames++;
    const aspect = video.videoWidth / video.videoHeight;
    send({ type: 'pose', t: performance.now(), inf: Math.round(ms), fps, aspect, poses, worlds });
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
  const vw = video.videoWidth, vh = video.videoHeight;
  if (overlay.width !== vw) { overlay.width = vw; overlay.height = vh; }
  ctx.clearRect(0, 0, vw, vh);
  if (!showPreview) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh); }
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
    await startCamera();
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

$('preview').addEventListener('click', () => {
  showPreview = !showPreview;
  document.body.classList.toggle('hidden-preview', !showPreview);
  $('preview').textContent = showPreview ? 'Hide preview (saves battery)' : 'Show preview';
});

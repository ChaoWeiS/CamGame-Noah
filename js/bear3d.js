import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { net, localCam, tracker, stats } from './core.js';
import { Body } from './body.js';
import { loadPuppet3D } from './puppet3d.js';
import { loadRiggedCharacter } from './autorig.js';
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);

// ---- phone connection (same as the game) — the QR opens the phone camera page
net.onStatus = (s) => { $('status').textContent = s; };
net.start();
$('room').textContent = net.roomId;
$('link').textContent = net.phoneUrl; $('link').href = net.phoneUrl;
const qr = window.qrcode(0, 'M'); qr.addData(net.phoneUrl); qr.make();
$('qr').src = qr.createDataURL(4, 6);
$('camBtn').onclick = async () => {
  $('camBtn').disabled = true;
  try { await localCam.start((s) => { $('status').textContent = s; }); }
  catch (e) { $('status').textContent = 'Webcam error: ' + e.message; $('camBtn').disabled = false; }
};
addEventListener('keydown', (e) => { if (e.key === 'h') $('panel').classList.toggle('min'); });

// ---- 3D scene: a grassy clearing
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc6e6);
scene.fog = new THREE.Fog(0x8fc6e6, 18, 45);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.2, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4f8a3c, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x6fae4f, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- the bear
// Tripo models, auto-rigged so they bend at shoulders, elbows, hips and knees.
// ?char=hamster picks one; ?model=simple uses the older shape-built bear.
const CHARS = [
  { id: 'bear', name: 'Barnaby', emoji: '🐻', file: 'assets/models/bear_tripo.glb' },
  { id: 'hamster', name: 'Hammy', emoji: '🐹', file: 'assets/models/hamster.glb' },
  { id: 'chicken', name: 'Cluck', emoji: '🐔', file: 'assets/models/chicken.glb' },
  { id: 'dog', name: 'Scout', emoji: '🐶', file: 'assets/models/dog.glb' },
];
const pick = CHARS.find((c) => c.id === params.get('char')) || CHARS[0];
$('title').textContent = `${pick.emoji} ${pick.name} — 3D test`;
for (const c of CHARS) {
  const b = document.createElement('button');
  b.textContent = `${c.emoji} ${c.name}`;
  if (c === pick) b.className = 'on';
  b.onclick = () => { const q = new URLSearchParams(location.search); q.set('char', c.id); q.delete('model'); location.search = q.toString(); };
  $('chars').appendChild(b);
}
$('status').textContent = `Loading ${pick.name}…`;
const bear = params.get('model') === 'simple'
  ? await loadPuppet3D('assets/models/bear.glb')
  : await loadRiggedCharacter(pick.file);
if (params.has('weights') && bear.mesh) {
  // debug: colour each vertex by the bone that moves it most
  const cols = [0x888888, 0xffffff, 0xff4444, 0xffaa00, 0x4488ff, 0x00ddff, 0xff44ff, 0xffff44, 0x44ff44, 0x22aa22, 0x880000, 0x884400, 0x9966ff, 0xff88cc]; // … handL, handR, chest, head
  const g = bear.mesh.geometry, si = g.attributes.skinIndex, c = new Float32Array(si.count * 3), col = new THREE.Color();
  for (let i = 0; i < si.count; i++) { col.set(cols[si.getX(i)]); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  bear.mesh.material = new THREE.MeshLambertMaterial({ vertexColors: true });
}
scene.add(bear.root);
controls.target.set(0, bear.height * 0.55, 0);
camera.position.set(0, bear.height * 0.65, bear.height * 3.2);

// Follow the biggest person in view (smoothed + calibrated like the game does)
const body = new Body();
let lastFrame = 0, seenAt = -1e9, calibrated = false, calibT = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (stats.lastFrame !== lastFrame) {
    lastFrame = stats.lastFrame;
    const person = [...tracker.skeletons].sort((a, b) => b.key.torso - a.key.torso)[0];
    if (person && person.key.sh.v > 0.4) {
      body.update(person.pts, person.world);
      seenAt = performance.now();
      // calibrate standing height once the person has been in view ~1 s
      if (!calibrated && (calibT += 1) > 25) { body.calibrateFromCurrent(); calibrated = true; }
    }
  }
  const tracking = performance.now() - seenAt < 800 && body.pts;
  if (tracking && body.world) bear.pose3D(body.world, body.vpts, calibrated ? body.base : null);   // whole body in 3D
  else if (tracking) bear.pose(body.vpts, calibrated ? body.base : null);
  else { bear.idle(t); calibrated = false; calibT = 0; }
  $('status').textContent = tracking ? `Tracking you · ${stats.fps} fps` : (stats.source === 'none' ? 'Scan the QR code or use the webcam' : 'Step into view…');
  controls.update();
  renderer.render(scene, camera);
});
window.bear = bear; // for debugging in the console

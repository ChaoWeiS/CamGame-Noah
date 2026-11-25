// The mini games: what's available, the host's queue, background downloading, and
// what happens between games.
//
// A game is a folder games/<id>/ holding
//   manifest.json  { id, title, blurb, players: [min, max], minutes, card, entry, files: [...] }
//   card.png       the square picture for the host's menu (tiny, always shown)
//   index.js       export default { scenes: [SceneClass, …], start: 'SceneKey' }
//   …              its own code and assets — downloaded only once it's queued
// A game uses the base (players and their input, the 3D animals, overlay text) and,
// when it's over, calls finishGame(scene, results) — the base keeps the scores and
// moves on to the next game in the queue, or the final podium.
import { session } from './scenes/common.js';

export const GAME_IDS = ['race', 'poses'];        // the menu's games, in menu order

const manifests = new Map();                       // id → manifest
const loading = new Map();                         // id → { promise, done, total, ready, error }

export async function listGames() {
  return Promise.all(GAME_IDS.map(manifest));
}
export async function manifest(id) {
  if (!manifests.has(id)) {
    const r = await fetch(`games/${id}/manifest.json`);
    const m = await r.json();
    m.base = `games/${id}/`;
    manifests.set(id, m);
  }
  return manifests.get(id);
}

// Download a game in the background: its code (and everything it imports) and its files,
// so it's in the browser's cache by the time it's played. Returns the loading record.
export function loadGame(id) {
  if (loading.has(id)) return loading.get(id);
  const rec = { done: 0, total: 1, ready: false, error: null, module: null };
  rec.promise = (async () => {
    const m = await manifest(id);
    const files = m.files || [];
    rec.total = files.length + 1;
    const code = import(new URL(`../${m.base}${m.entry || 'index.js'}`, import.meta.url).href).then((mod) => { rec.module = mod.default; rec.done++; });
    const rest = files.map((f) => fetch(m.base + f).then((r) => r.blob()).then(() => { rec.done++; }));
    await Promise.all([code, ...rest]);
    rec.ready = true;
    return rec;
  })().catch((e) => { rec.error = e; console.warn('game failed to load', id, e); throw e; });
  loading.set(id, rec);
  return rec;
}
export const gameProgress = (id) => { const r = loading.get(id); return r ? (r.ready ? 1 : r.done / r.total) : 0; };

// The host's queue (remembered for next time). Start downloading every queued game.
export function setQueue(ids) {
  session.queue = ids.filter((id) => GAME_IDS.includes(id));
  try { localStorage.setItem('ark-queue', JSON.stringify(session.queue)); } catch (_) {}
  session.queue.forEach(loadGame);
}
export function savedQueue() {
  try { const q = JSON.parse(localStorage.getItem('ark-queue')); if (Array.isArray(q) && q.length) return q; } catch (_) {}
  return [...GAME_IDS];
}

// ---------------------------------------------------------------- playing the queue
// Start the queue from the top (after the character select).
export function startQueue(scene) {
  session.games = [];
  playNext(scene);
}
// Go to the next game in the queue (waits for it to finish downloading), or the podium.
export async function playNext(scene) {
  const id = session.queue[session.games.length];
  if (!id) { scene.scene.start('Results'); return; }
  const rec = loadGame(id);
  if (!rec.ready) {
    // still downloading: a simple "loading" note on whatever screen we're on
    const g = scene.game, t = scene.add.text(g.scale.width / 2, g.scale.height - 40, '', { fontSize: '28px', color: '#1d3b52', fontStyle: 'bold' }).setOrigin(0.5).setDepth(99);
    const iv = setInterval(() => t.setText(`Getting the next game ready… ${Math.round(gameProgress(id) * 100)}%`), 200);
    try { await rec.promise; } catch (_) { clearInterval(iv); t.setText('Couldn’t load the next game — skipping it'); session.games.push({ id, skipped: true, results: [] }); setTimeout(() => playNext(scene), 1500); return; }
    clearInterval(iv);
  }
  const mod = rec.module;
  for (const S of mod.scenes) {
    const key = S.KEY;
    if (!scene.game.scene.getScene(key)) scene.game.scene.add(key, S, false);
  }
  session.current = id;
  scene.scene.start(mod.start);
}

// A game is over. results: [{ slot, score, label }] — higher score is better; label is
// what the scoreboard shows ("1st", "⭐ 5"). Players get points by placing: with n players,
// 1st gets n points, 2nd n−1, …; ties share the better placing.
export function finishGame(scene, results, delay = 2200) {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const n = results.length;
  for (const r of results) {
    const better = sorted.filter((o) => o.score > r.score).length;
    r.rank = better + 1;
    r.points = n - better;
  }
  const m = manifests.get(session.current) || { title: session.current };
  session.games.push({ id: session.current, title: m.title, results });
  setTimeout(() => playNext(scene), delay);
}

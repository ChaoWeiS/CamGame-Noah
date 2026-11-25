// The Hall of Fame: every game's best results, kept only on this computer (the browser's
// IndexedDB — nothing is sent anywhere). One list per game, best first.
// An entry: { id, game, score (higher is better), label ("42.1 s", "⭐ 5"), animal, color,
//             photo (a small JPEG data URL of the player's face), date }
const DB = 'ark-hall-of-fame', STORE = 'entries';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('game', 'game');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
const tx = async (mode) => (await db()).transaction(STORE, mode).objectStore(STORE);
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export async function addEntry(entry) {
  return done((await tx('readwrite')).add({ ...entry, date: Date.now() }));
}
// the best `n` entries of a game, best first
export async function top(game, n = 10) {
  const all = await done((await tx('readonly')).index('game').getAll(game));
  return all.sort((a, b) => b.score - a.score || a.date - b.date).slice(0, n);
}
export async function best(game) { return (await top(game, 1))[0] || null; }
export async function removeEntry(id) { return done((await tx('readwrite')).delete(id)); }
export async function clearGame(game) {
  const s = await tx('readwrite');
  const keys = await done(s.index('game').getAllKeys(game));
  await Promise.all(keys.map((k) => done(s.delete(k))));
}

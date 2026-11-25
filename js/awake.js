// Keep the screen from going to sleep while the game (or a camera) is running.
// Uses the Screen Wake Lock API (Chrome/Android, Edge, Safari 16.4+). The browser drops the
// lock whenever the page is hidden, so it is asked for again when the page comes back,
// and on the next tap/key if a request was refused (some browsers want a tap first).
let lock = null, wanted = false;

async function request() {
  if (!wanted || lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (_) { lock = null; }
}

export function keepAwake(on = true) {
  wanted = on;
  if (on) request();
  else if (lock) { lock.release().catch(() => {}); lock = null; }
}
export const awake = () => !!lock;

document.addEventListener('visibilitychange', request);
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, request, { passive: true });

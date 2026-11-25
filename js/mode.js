// Is the game running on a phone? Then it plays in "phone mode": the phone's own
// front camera, full screen, landscape, lighter graphics, up to 2 players.
// Force a mode with ?mode=phone or ?mode=pc in the address.
const forced = new URLSearchParams(location.search).get('mode');
// smart TVs are big screens even when their browser reports a small "touch" screen (remote control)
export const TV = /\b(TV|SmartTV|SMART-TV|GoogleTV|Android TV|AFT[A-Z]+|Tizen|Web0S|WebOS|BRAVIA|CrKey|HbbTV|NetCast|VIDAA|Roku|AndroidTV|MiBOX|Chromecast)\b/i.test(navigator.userAgent);
const phoneUA = /Android.+Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent);
const smallTouch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 600;
export const PHONE = forced ? forced === 'phone' : (!TV && (phoneUA || smallTouch));
export const LITE = PHONE;              // lighter graphics
export const PHONE_PLAYERS = 2;

// full screen + landscape (needs a tap; quietly does nothing where not allowed)
export async function goFullLandscape() {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) {}
  try { await screen.orientation.lock('landscape'); } catch (_) {}
}

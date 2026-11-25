// The host's menu: pick today's games and their order, then Start.
//
//   • The top stays put: title, today's queue (a row of squares ending in a blank "+"), Start.
//   • Below, on the left: every game (scrolls as more are added). Drag a game up into the
//     row to add it — it lands where you drop it. A game can be added more than once.
//   • Tap a game to see its Hall of Fame on the right (entries can be deleted there).
//   • In the row: drag a square along to reorder, or off the row to remove it.
// Only the small card pictures load here — the games themselves download after Start.
import { listGames, setQueue, savedQueue } from './games.js';
import { renderHof } from './hofview.js';

const $ = (id) => document.getElementById(id);
let games = [], byId = new Map(), queue = [], onStart = null, selected = null;
const cardImg = (g) => `${g.base}${g.card || 'card.png'}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function showMenu(start) {
  onStart = start;
  $('menu').hidden = false;
  if (!games.length) {
    games = await listGames();
    byId = new Map(games.map((g) => [g.id, g]));
    renderGrid();
  }
  queue = savedQueue().filter((id) => byId.has(id));
  renderQueue();
  if (selected) showHof(selected);
}

function renderGrid() {
  $('mGrid').innerHTML = '';
  for (const g of games) {
    const el = document.createElement('div');
    el.className = 'mcard';
    el.dataset.id = g.id;
    el.innerHTML = `<img src="${esc(cardImg(g))}" alt="" draggable="false"><b>${esc(g.title)}</b><small>~${g.minutes} min · ${g.players[0]}–${g.players[1]} players</small>`;
    el.title = g.blurb || '';
    el.addEventListener('pointerdown', (e) => dragFromList(e, el, g));
    $('mGrid').appendChild(el);
  }
}

// the right-hand panel: a game's Hall of Fame (games are added by dragging them up into the queue)
async function showHof(g) {
  selected = g;
  document.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('sel', c.dataset.id === g.id));
  const box = $('mHof');
  box.innerHTML = '<div class="list"></div>';
  await renderHof(box.querySelector('.list'), g, { editable: true });
}

function renderQueue(popAt = -1) {
  const q = $('mQueue');
  q.innerHTML = '';
  queue.forEach((id, i) => {
    const g = byId.get(id);
    const el = document.createElement('div');
    el.className = 'mq' + (i === popAt ? ' pop' : '');
    el.innerHTML = `<img src="${esc(cardImg(g))}" alt="" draggable="false"><span>${i + 1}</span><b>${esc(g.title)}</b>`;
    el.addEventListener('pointerdown', (e) => dragInQueue(e, el, i));
    q.appendChild(el);
  });
  const plus = document.createElement('div');
  plus.className = 'mq plus';
  plus.innerHTML = '<span>+</span>';
  plus.title = 'Drag a game up here';
  q.appendChild(plus);
  const mins = queue.reduce((s, id) => s + (byId.get(id).minutes || 1), 0);
  $('mInfo').textContent = queue.length
    ? `${queue.length} ${queue.length === 1 ? 'game' : 'games'} · about ${mins} minutes of play`
    : 'Drag a game up into the row to add it';
  $('mStart').disabled = !queue.length;
}

// where in the row a point would drop: the index of the first square whose middle is right of it
function dropIndex(x) {
  const items = [...$('mQueue').querySelectorAll('.mq:not(.plus):not(.marker)')];
  for (let i = 0; i < items.length; i++) { const r = items[i].getBoundingClientRect(); if (x < r.left + r.width / 2) return i; }
  return items.length;
}
const overQueue = (x, y) => { const r = $('mQueue').getBoundingClientRect(); return x > r.left - 20 && x < r.right + 20 && y > r.top - 30 && y < r.bottom + 30; };

// ---- a game card from the list: a tap shows its Hall of Fame; a drag up into the row adds it
function dragFromList(e, el, g) {
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  let ghost = null, marker = null, at = -1;
  el.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
    if (!ghost) {
      ghost = document.createElement('div'); ghost.className = 'mghost';
      ghost.innerHTML = `<img src="${esc(cardImg(g))}" alt="">`;
      document.body.appendChild(ghost);
    }
    ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
    const over = overQueue(ev.clientX, ev.clientY);
    $('mQueue').classList.toggle('hot', over);
    const idx = over ? dropIndex(ev.clientX) : -1;
    if (idx !== at) {
      at = idx;
      if (marker) marker.remove();
      marker = null;
      if (at >= 0) {
        marker = document.createElement('div'); marker.className = 'mq marker';
        const items = $('mQueue').querySelectorAll('.mq:not(.plus)');
        $('mQueue').insertBefore(marker, items[at] || $('mQueue').querySelector('.plus'));
      }
    }
  };
  const up = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    $('mQueue').classList.remove('hot');
    if (marker) marker.remove();
    if (!ghost) { showHof(g); return; }                       // it was a tap
    ghost.remove();
    if (at >= 0) { queue.splice(at, 0, g.id); renderQueue(at); }
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// ---- a square in the row: drag along to reorder, off the row to remove
function dragInQueue(e, el, from) {
  e.preventDefault();
  const row = $('mQueue'), items = [...row.querySelectorAll('.mq:not(.plus)')];
  const r0 = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
  const slots = items.map((it) => { const r = it.getBoundingClientRect(); return r.left + r.width / 2; });
  let to = from, out = false, moved = false;
  el.setPointerCapture(e.pointerId);
  el.classList.add('drag');
  const move = (ev) => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (Math.hypot(dx, dy) > 6) moved = true;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    const rr = row.getBoundingClientRect();
    out = ev.clientY < rr.top - r0.height * 0.6 || ev.clientY > rr.bottom + r0.height * 0.6;
    el.classList.toggle('out', out);
    const cx = r0.left + r0.width / 2 + dx;
    to = slots.reduce((best, s, k) => (Math.abs(s - cx) < Math.abs(slots[best] - cx) ? k : best), 0);
    items.forEach((it, k) => {
      if (it === el) return;
      let shift = 0;
      if (!out && from < to && k > from && k <= to) shift = -1;
      if (!out && from > to && k >= to && k < from) shift = 1;
      it.style.transform = shift ? `translateX(${shift * (r0.width + 12)}px)` : '';
    });
  };
  const up = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    if (out) queue.splice(from, 1);
    else if (moved && to !== from) { const [id] = queue.splice(from, 1); queue.splice(to, 0, id); }
    else if (!moved) showHof(byId.get(queue[from]));               // a tap on a square shows its Hall of Fame too
    renderQueue();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

export function initMenu() {
  $('mStart').onclick = () => {
    if (!queue.length) return;
    setQueue(queue);                     // remembered, and the games start downloading now
    $('menu').hidden = true;
    onStart && onStart();
  };
}

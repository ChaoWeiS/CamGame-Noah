// The host's menu: pick today's games and their order, then Start.
//
//   • Tap a game card to add it to the queue (it stacks — a game can be added twice).
//   • The queue is a row of squares with a blank "+" square at the end.
//   • Drag a square along the row to change the order; drag it off the row to remove it.
//   • Start: the queued games begin downloading and the lobby (cameras, players) opens.
// Only the small card pictures load here — the games themselves download after Start.
import { listGames, setQueue, savedQueue } from './games.js';

const $ = (id) => document.getElementById(id);
let games = [], byId = new Map(), queue = [], onStart = null;

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
}

function cardImg(g) { return `${g.base}${g.card || 'card.png'}`; }

function renderGrid() {
  $('mGrid').innerHTML = '';
  for (const g of games) {
    const el = document.createElement('button');
    el.className = 'mcard';
    el.innerHTML = `<img src="${cardImg(g)}" alt=""><b></b><small></small>`;
    el.querySelector('b').textContent = g.title;
    el.querySelector('small').textContent = `~${g.minutes} min · ${g.players[0]}–${g.players[1]} players`;
    el.title = g.blurb || '';
    el.onclick = () => { queue.push(g.id); renderQueue(true); };
    $('mGrid').appendChild(el);
  }
}

function renderQueue(added = false) {
  const q = $('mQueue');
  q.innerHTML = '';
  queue.forEach((id, i) => {
    const g = byId.get(id);
    const el = document.createElement('div');
    el.className = 'mq';
    el.innerHTML = `<img src="${cardImg(g)}" alt="" draggable="false"><span>${i + 1}</span><b></b>`;
    el.querySelector('b').textContent = g.title;
    el.addEventListener('pointerdown', (e) => startDrag(e, el, i));
    q.appendChild(el);
    if (added && i === queue.length - 1) el.classList.add('pop');
  });
  const plus = document.createElement('div');
  plus.className = 'mq plus';
  plus.innerHTML = '<span>+</span>';
  plus.title = 'Tap a game below to add it';
  plus.onclick = () => $('mGrid').scrollIntoView({ behavior: 'smooth' });
  q.appendChild(plus);
  const mins = queue.reduce((s, id) => s + (byId.get(id).minutes || 1), 0);
  $('mInfo').textContent = queue.length
    ? `${queue.length} ${queue.length === 1 ? 'game' : 'games'} · about ${mins} minutes of play`
    : 'Tap a game below to add it';
  $('mStart').disabled = !queue.length;
}

// ---- dragging a queued square: along the row to reorder, off the row to remove
function startDrag(e, el, from) {
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
    // where it would land: the nearest slot to its centre
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
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    if (out) queue.splice(from, 1);
    else if (moved && to !== from) { const [id] = queue.splice(from, 1); queue.splice(to, 0, id); }
    renderQueue();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

export function initMenu() {
  $('mStart').onclick = () => {
    if (!queue.length) return;
    setQueue(queue);                     // remembered, and the games start downloading now
    $('menu').hidden = true;
    onStart && onStart();
  };
}

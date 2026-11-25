// Drawing a game's Hall of Fame list (used by the host's menu and the end-of-session show).
import { top, removeEntry, clearGame } from './halloffame.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// el: where to draw; game: its manifest; editable: show delete buttons (host's menu only)
export async function renderHof(el, game, { editable = false, n = 10 } = {}) {
  const list = await top(game.id, n);
  el.innerHTML = `
    <div class="hof">
      <h3><img src="${esc(game.base + (game.card || 'card.png'))}" alt=""> ${esc(game.title)} <small>Hall of Fame</small></h3>
      ${list.length ? `<ol>${list.map((e, i) => `
        <li data-id="${e.id}" style="--c:${esc(e.color || '#ccc')}">
          <span class="rank">${i === 0 ? '👑' : i + 1}</span>
          <img class="face" src="${esc(e.photo || `assets/portraits/${e.animal || 'bear'}.png`)}" alt="">
          <img class="animal" src="assets/portraits/${esc(e.animal || 'bear')}.png" alt="">
          <b>${esc(e.label)}</b>
          <small>${when(e.date)}</small>
          ${editable ? '<button class="del" title="Remove this entry">✕</button>' : ''}
        </li>`).join('')}</ol>` : '<p class="empty">No scores yet — be the first! 🌟</p>'}
      ${editable && list.length ? '<button class="clear">🗑 Clear this game’s Hall of Fame</button>' : ''}
    </div>`;
  if (!editable) return;
  // deleting asks for a second tap, so nothing goes by accident
  const confirmTap = (btn, label, fn) => btn.addEventListener('click', async () => {
    if (btn.dataset.armed) { await fn(); renderHof(el, game, { editable, n }); return; }
    btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = label; btn.classList.add('armed');
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('armed'); }, 2500);
  });
  el.querySelectorAll('li .del').forEach((b) => confirmTap(b, 'Delete?', () => removeEntry(+b.closest('li').dataset.id)));
  const clr = el.querySelector('.clear');
  if (clr) confirmTap(clr, 'Tap again to clear them all', () => clearGame(game.id));
}

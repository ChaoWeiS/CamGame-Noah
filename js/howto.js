// "How to play" in pictures: a row of cards, each a little moving stick figure and two or
// three words — for kids who won't read a paragraph. Shown during the countdown.
//   showHowTo(game, ['pump', 'tilt', 'twist'])  → returns { remove() }

const STROKE = 'stroke="#1d3b52" stroke-width="7" stroke-linecap="round" fill="none"';
// a stick figure: arms are groups so they can move (shoulders at 50,52 / 70,52)
const body = (armsL, armsR, extra = '', cls = '') => `
  <g class="${cls}">
    <circle cx="60" cy="28" r="13" fill="#fff8e6" stroke="#1d3b52" stroke-width="6"/>
    <line x1="60" y1="42" x2="60" y2="92" ${STROKE}/>
    <line x1="60" y1="92" x2="46" y2="128" ${STROKE}/><line x1="60" y1="92" x2="74" y2="128" ${STROKE}/>
    <g class="armL">${armsL}</g><g class="armR">${armsR}</g>
  </g>${extra}`;
const arrow = (d, color = '#f2b544') => `<path d="${d}" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round" marker-end="url(#ah)"/>`;
const DEFS = `<defs><marker id="ah" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="#f2b544"/></marker></defs>`;

const CARDS = {
  // skiing
  pump: { label: 'Pump = faster', svg: body(`<line x1="60" y1="52" x2="28" y2="78" ${STROKE}/>`, `<line x1="60" y1="52" x2="92" y2="78" ${STROKE}/>`, arrow('M104,52 L104,30') + arrow('M104,60 L104,82') + arrow('M16,52 L16,30') + arrow('M16,60 L16,82'), 'pumping') },
  tilt: { label: 'Tilt to turn', svg: `<g class="tilting">${body(`<line x1="60" y1="52" x2="14" y2="52" ${STROKE}/>`, `<line x1="60" y1="52" x2="106" y2="52" ${STROKE}/>`)}</g>${arrow('M70,140 Q100,140 108,118')}` },
  twist: { label: 'Twist = sharp turn', svg: `<g class="twisting">${body(`<line x1="60" y1="52" x2="36" y2="80" ${STROKE}/>`, `<line x1="60" y1="52" x2="84" y2="80" ${STROKE}/>`)}</g>${arrow('M24,112 Q60,140 98,112')}` },
  // flying
  flap: { label: 'Flap down = up', svg: body(`<line x1="60" y1="52" x2="16" y2="40" ${STROKE}/>`, `<line x1="60" y1="52" x2="104" y2="40" ${STROKE}/>`, arrow('M60,140 L60,108'), 'flapping') },
  glide: { label: 'Arms out = glide', svg: body(`<line x1="60" y1="52" x2="12" y2="54" ${STROKE}/>`, `<line x1="60" y1="52" x2="108" y2="54" ${STROKE}/>`, arrow('M78,112 Q100,124 112,140'), 'gliding') },
  dive: { label: 'Arms down = drop', svg: body(`<line x1="60" y1="52" x2="48" y2="92" ${STROKE}/>`, `<line x1="60" y1="52" x2="72" y2="92" ${STROKE}/>`, arrow('M100,96 L100,138')) },
};

export function showHowTo(game, ids) {
  const el = document.createElement('div');
  el.className = 'howto';
  el.innerHTML = ids.map((id) => `<div class="hcard"><svg viewBox="0 0 120 150">${DEFS}${CARDS[id].svg}</svg><b>${CARDS[id].label}</b></div>`).join('');
  game.canvas.parentElement.appendChild(el);
  const place = () => {
    const c = game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    Object.assign(el.style, { left: `${cr.left - pr.left + cr.width / 2}px`, top: `${cr.top - pr.top + cr.height * 0.62}px`, fontSize: `${cr.height / 34}px` });
  };
  place();
  const t = setInterval(place, 300);
  return { remove() { clearInterval(t); el.remove(); } };
}

// Ski to the Ark — ski down a snowy slope, through the flags, collecting coins and
// missing the boulders.
//   pump both hands up and down together   → go faster
//   arms out wide and tilted like a plane  → turn towards the lower hand
//   turn your body sideways                → a sharp turn, but you slow down
// Points: every coin and every pair of flags you ski through.
import { tracker, input, PLAYER_CSS } from '../../js/core.js';
import { W, H, rng, session, charById, setupPanes } from '../../js/scenes/common.js';
import { OverlayText } from '../../js/stage3d.js';
import { LITE } from '../../js/mode.js';
import { finishGame } from '../../js/games.js';
import { showHowTo } from '../../js/howto.js';
import { Ski3D } from './ski3d.js';

const LENGTH = 420;          // metres from the start to the finish
const HALF = 14;             // the piste is 28 m wide
const COINS = 10;
const ROUND_MS = 150000;     // nobody skis for more than 2½ minutes
const AFTER_FIRST_MS = 15000;
const RADIUS = { boulder: 0.5, rock2: 0.45, stump: 0.3, pine: 0.22 };   // × height = how close is a crash

function makeCourse(seed) {
  const r = rng(seed ^ 0x5c1);
  const gates = [], coins = [], obstacles = [], trees = [];
  // flags: a gate every ~34 m, swinging left and right
  let side = r() < 0.5 ? -1 : 1;
  for (let d = 45; d < LENGTH - 25; d += 32 + r() * 6) {
    gates.push({ d, x: side * (2.5 + r() * 6), w: 5 });
    side = -side;
  }
  // coins: between the gates, anywhere across the piste
  const slots = gates.map((g, i) => (g.d + (gates[i + 1]?.d ?? LENGTH)) / 2).filter((d) => d < LENGTH - 8);
  while (slots.length > COINS) slots.splice(Math.floor(r() * slots.length), 1);
  for (const d of slots) coins.push({ d: d + (r() - 0.5) * 6, x: (r() * 2 - 1) * (HALF - 3) });
  // boulders, stumps and small pines on the piste, never right in a gate or on a coin
  const clear = (x, d) => gates.every((g) => Math.abs(g.d - d) > 7 || Math.abs(g.x - x) > g.w / 2 + 2.2) &&
    coins.every((c) => Math.hypot(c.x - x, c.d - d) > 3);
  for (let d = 28; d < LENGTH - 12; d += 9 + r() * 7) {
    const n = 1 + (r() < 0.45 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = (r() * 2 - 1) * (HALF - 1.5);
      if (!clear(x, d)) continue;
      const t = r(), key = t < 0.4 ? 'boulder' : t < 0.65 ? 'rock2' : t < 0.8 ? 'stump' : 'pine';
      const h = key === 'pine' ? 3.5 + r() * 2 : key === 'boulder' ? 1.2 + r() * 0.7 : key === 'rock2' ? 0.8 + r() * 0.4 : 0.5 + r() * 0.2;
      obstacles.push({ key, x, d, h, rot: r() * 6.28, r: RADIUS[key] * h + (key === 'pine' ? 0.2 : 0), sink: key === 'boulder' ? 0.12 : key === 'rock2' ? 0.15 : 0.03 });
    }
  }
  // forest on both sides of the piste
  const rows = LITE ? [[1.5, 5, 6.5], [6, 14, 11]] : [[1.2, 4, 5], [4, 9, 7.5], [9, 20, 12]];
  for (const s of [-1, 1]) for (const [o1, o2, gap] of rows) {
    for (let d = -30; d < LENGTH + 70; d += gap * (0.6 + r() * 0.8)) {
      const off = o1 + r() * (o2 - o1);
      const pine = r() < 0.85;
      trees.push({ key: pine ? 'pine' : 'boulder', x: s * (HALF + off), d, h: pine ? 4 + r() * 3.5 : 1.2 + r() * 1.2, rot: r() * 6.28, sink: pine ? 0 : 0.15 });
    }
  }
  return { length: LENGTH, half: HALF, gates, coins, obstacles, trees };
}

// a player's corner of the screen: name, points, distance bar, messages (drawn above the 3D)
class PaneHud {
  constructor(game, rect, pl) {
    this.game = game; this.rect = rect;
    const el = this.el = document.createElement('div');
    el.className = 'skihud';
    el.innerHTML = `<div class="tag" style="color:${PLAYER_CSS[pl.slot]}">P${pl.slot + 1} · ${charById(pl.animal).name}</div>
      <div class="pts"></div><div class="bar"><i style="background:${PLAYER_CSS[pl.slot]}"></i></div><div class="msg"></div><div class="lost"></div>`;
    game.canvas.parentElement.appendChild(el);
    this.pts = el.querySelector('.pts'); this.fill = el.querySelector('.bar i'); this.msgEl = el.querySelector('.msg'); this.lostEl = el.querySelector('.lost');
    this.msgUntil = 0;
  }
  place() {
    const c = this.game.canvas, cr = c.getBoundingClientRect(), pr = c.parentElement.getBoundingClientRect();
    const k = cr.height / this.game.scale.height, r = this.rect;
    Object.assign(this.el.style, { left: `${cr.left - pr.left + r.x * k}px`, top: `${cr.top - pr.top + r.y * k}px`,
      width: `${r.w * k}px`, height: `${r.h * k}px`, fontSize: `${Math.max(12, Math.min(r.h, r.w * 0.6) * k * 0.045)}px` });
  }
  msg(t, ms = 900) { this.msgEl.textContent = t; this.msgUntil = performance.now() + ms; this.msgEl.classList.remove('pop'); void this.msgEl.offsetWidth; this.msgEl.classList.add('pop'); }
  update(sk, length) {
    this.place();
    this.pts.textContent = `⭐ ${sk.points}  ·  🪙 ${sk.coins}/${COINS}  ·  🚩 ${sk.gates}`;
    this.fill.style.width = `${Math.min(100, (sk.d / length) * 100)}%`;
    if (performance.now() > this.msgUntil && !sk.finished) this.msgEl.textContent = '';
  }
  lost(on) { this.lostEl.textContent = on ? 'Come back into view!' : ''; }
  destroy() { this.el.remove(); }
}

export class SkiScene extends Phaser.Scene {
  static KEY = 'Ski';
  constructor() { super('Ski'); }

  create() {
    session.seed = (Math.random() * 1e9) | 0;
    this.course = makeCourse(session.seed);
    const players = tracker.players;
    this.cols = setupPanes(this, players.length, 720).panes;
    this.add.rectangle(-30000, 0, 10, 10, 0x000000);   // (Phaser needs something; the 3D layer covers the screen)
    this.ski = new Ski3D(this.game, this.course);
    const n = players.length;
    this.skiers = players.map((pl, i) => {
      const sk = {
        pl, x: (i - (n - 1) / 2) * 3, d: 0, heading: 0, turnRate: 0, speed: 0, twist: 0, pump: 0,
        points: 0, coins: 0, gates: 0, nextGate: 0, coinsGot: new Set(), crashUntil: 0, crashK: 0, safeUntil: 0,
        finished: false, time: 0, hud: new PaneHud(this.game, this.cols[i].rect, pl),
      };
      this.ski.addSkier(sk).catch((e) => console.warn('3D skier', e));
      return sk;
    });
    this.banner = new OverlayText(this.game, W / 2, H / 2 - 40, 110);
    this.help = new OverlayText(this.game, W / 2, H / 2 + 20, 30);
    this.help.setText('🚩 flags · 🪙 coins · 🪨 rocks!');
    this.howto = showHowTo(this.game, ['pump', 'tilt', 'twist']);
    this.events.once('shutdown', () => {
      this.ski.destroy(); this.banner.destroy(); this.help.destroy(); this.howto?.remove();
      this.skiers.forEach((sk) => sk.hud.destroy());
    });
    this.state = 'countdown';
    this.t0 = performance.now();
    this.steps = [
      [0, () => this.banner.setText('READY??')],
      [2400, () => {
        // everyone is standing facing the screen: measure their normal posture again
        for (const sk of this.skiers) if (sk.pl.kind === 'camera' && sk.pl.body && input(sk.pl).present) sk.pl.body.calibrateFromCurrent();
        this.banner.setText('3!');
      }],
      [3400, () => this.banner.setText('2!')],
      [4400, () => this.banner.setText('1!')],
      [5400, () => { this.banner.setText('GO!!!'); this.help.setText(''); this.howto?.remove(); this.howto = null; this.state = 'run'; this.runStart = performance.now(); }],
      [6400, () => { if (this.banner.text === 'GO!!!') this.banner.setText(''); }],
    ];
    this.finishCount = 0;
    this.firstFinishAt = 0;
  }

  update(time, delta) {
    const now = performance.now(), dt = Math.min(delta, 100) / 1000;
    while (this.steps.length && now - this.t0 >= this.steps[0][0]) this.steps.shift()[1]();
    for (const sk of this.skiers) this.move(sk, dt, now);
    this.ski.render(this.skiers, this.cols, now / 1000);
    for (const sk of this.skiers) sk.hud.update(sk, LENGTH);

    if (this.state === 'run') {
      const all = this.skiers.every((s) => s.finished);
      if (all || (this.firstFinishAt && now - this.firstFinishAt > AFTER_FIRST_MS) || now - this.runStart > ROUND_MS) this.end();
    }
  }

  move(sk, dt, now) {
    const inp = input(sk.pl), cam = sk.pl.kind === 'camera';
    sk.pts = cam && inp.present ? sk.pl.body.vpts : null;      // the animal's arms copy the player's
    sk.hud.lost(!inp.present);
    const running = this.state === 'run';
    const steer = running && inp.present ? inp.steer : 0;
    const twist = running && inp.present ? inp.twist : 0;
    const pump = running && inp.present ? Math.min(1.2, inp.pump) : 0;
    sk.twist += (twist - sk.twist) * Math.min(1, dt * 8);
    sk.pump = pump;
    const crashed = now < sk.crashUntil;
    sk.crashK += ((crashed ? 1 : 0) - sk.crashK) * Math.min(1, dt * 7);
    if (!running && !sk.finished) { sk.turnRate = 0; return; }

    if (sk.finished) {
      // glide to a stop past the finish line
      sk.speed = Math.max(0, sk.speed - 8 * dt);
      sk.turnRate *= 0.9;
    } else if (crashed) {
      sk.speed = Math.max(0, sk.speed - 14 * dt);
      sk.turnRate = 0;
    } else {
      // turning: tilted arms turn gently, a twisted body turns hard. Like real skiing, the
      // slope always wants you pointing down the hill: the moment you stop steering (arms
      // level, relaxed or down) the skis swing back to the fall line — and you pick up speed.
      // Steering harder holds your line against that pull.
      const holding = Math.min(1, Math.max(Math.abs(steer) - 0.08, 0) / 0.3 + Math.max(Math.abs(sk.twist) - 0.08, 0) / 0.3);
      let rate = steer * 1.0 + sk.twist * 2.2;
      rate -= sk.heading * (1.5 * (1 - holding) + 0.25 * holding);
      sk.turnRate += (rate - sk.turnRate) * Math.min(1, dt * 6);
      sk.heading = Math.max(-1.25, Math.min(1.25, sk.heading + sk.turnRate * dt));
      // speed: the hill pulls you down, pumping pushes, air and snow hold you back,
      // and a twisted body digs the skis in and brakes
      const acc = 2.9 * Math.cos(sk.heading) + 3.6 * pump - 0.017 * sk.speed * sk.speed - 0.5 - 4.0 * Math.abs(sk.twist) * Math.min(1, sk.speed / 4);
      sk.speed = Math.max(0, Math.min(22, sk.speed + acc * dt));
    }
    sk.x += Math.sin(sk.heading) * sk.speed * dt;
    sk.d += Math.cos(sk.heading) * sk.speed * dt;

    // the edge of the piste: you're turned back in, and it slows you
    if (Math.abs(sk.x) > HALF - 0.4) {
      sk.x = Math.sign(sk.x) * (HALF - 0.4);
      sk.heading *= 0.85; sk.speed *= 0.97;
      if (!sk.finished && performance.now() > sk.hud.msgUntil) sk.hud.msg('Stay on the piste! ⛷️', 700);
    }
    if (sk.finished) return;

    // flags: through the gap = a point
    const gates = this.course.gates;
    while (sk.nextGate < gates.length && sk.d >= gates[sk.nextGate].d) {
      const g = gates[sk.nextGate++];
      if (Math.abs(sk.x - g.x) <= g.w / 2) { sk.points++; sk.gates++; sk.hud.msg('🚩 Through the flags! +1'); }
      else sk.hud.msg('Missed the flags', 700);
    }
    // coins
    this.course.coins.forEach((c, k) => {
      if (!sk.coinsGot.has(k) && Math.abs(c.d - sk.d) < 1.1 && Math.abs(c.x - sk.x) < 1.2) {
        sk.coinsGot.add(k); sk.coins++; sk.points++; sk.hud.msg('🪙 +1');
      }
    });
    // rocks, stumps and trees: crash (a moment to get up again)
    if (now > sk.safeUntil) {
      for (const o of this.course.obstacles) {
        if (Math.abs(o.d - sk.d) > 3) continue;
        if (Math.hypot(o.x - sk.x, o.d - sk.d) < o.r + 0.35) {
          sk.crashUntil = now + 1300; sk.safeUntil = now + 2600;
          sk.speed *= 0.2; sk.crashSide = Math.sign(sk.x - o.x) || 1;
          sk.x += sk.crashSide * 0.6; sk.heading *= 0.3;
          sk.hud.msg('Oops! 💥', 1200);
          break;
        }
      }
    }
    // the finish line
    if (sk.d >= LENGTH) {
      sk.finished = true; sk.time = (now - this.runStart) / 1000;
      this.finishCount++;
      if (!this.firstFinishAt) this.firstFinishAt = now;
      sk.hud.msg(`Finished! 🎉 ⭐ ${sk.points}`, 1e9);
    }
  }

  end() {
    this.state = 'done';
    this.banner.setText('Down at the ark! 🛶');
    // more points wins; a faster time breaks a tie
    finishGame(this, this.skiers.map((sk) => ({
      slot: sk.pl.slot,
      score: sk.points * 1000 - Math.min(999, sk.finished ? sk.time : 999),
      label: `⭐ ${sk.points} ${sk.points === 1 ? 'point' : 'points'}`,
    })), 2500);
  }
}

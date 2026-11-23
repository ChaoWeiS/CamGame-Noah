// 2D cut-out puppets: a character's T-pose sprite split into body, arms and legs,
// each rotated around its joint to copy a tracked person's skeleton.
import { L } from './body.js';

const PARTS = ['legL', 'legR', 'body', 'armL', 'armR']; // back to front (arms in front so kids see them)

export function loadPuppets(scene, ids) {
  if (!scene.cache.json.exists('rig')) scene.load.json('rig', 'assets/puppets/rig.json');
  for (const id of ids) for (const p of PARTS) {
    const key = `${id}_p_${p}`;
    if (!scene.textures.exists(key)) scene.load.image(key, `assets/puppets/${id}_${p}.png`);
  }
}

// Which landmarks drive which part. The screen is a mirror, so the player's
// own left arm (landmarks 11 → 13 → 15) shows on the left of the screen.
const LIMBS = {
  armL: { from: L.lShoulder, mid: L.lElbow, to: L.lWrist, rest: Math.PI },
  armR: { from: L.rShoulder, mid: L.rElbow, to: L.rWrist, rest: 0 },
  legL: { from: L.lHip, mid: L.lKnee, to: L.lAnkle, rest: Math.PI / 2 },
  legR: { from: L.rHip, mid: L.rKnee, to: L.rAnkle, rest: Math.PI / 2 },
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Puppet {
  constructor(scene, charId, depth = 5) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(depth);
    this.rot = { armL: 0, armR: 0, legL: 0, legR: 0 };
    this.setCharacter(charId);
  }

  setCharacter(charId) {
    if (this.charId === charId) return;
    this.charId = charId;
    this.container.removeAll(true);
    this.rig = this.scene.cache.json.get('rig')[charId];
    const b = this.rig.parts.body;
    this.parts = {};
    for (const name of PARTS) {
      const p = this.rig.parts[name];
      if (!p) continue;
      const im = this.scene.add.image(p.px - b.px, p.py - b.py, `${charId}_p_${name}`);
      im.setOrigin((p.px - p.x) / p.w, (p.py - p.y) / p.h);
      this.container.add(im);
      this.parts[name] = im;
    }
  }

  setVisible(v) { this.container.setVisible(v); return this; }
  destroy() { this.container.destroy(); }

  // pts: smoothed, mirrored points (body.js units). map: units → screen.
  // place (optional): { cx, top, height } to draw at a fixed spot and size instead
  // of where the person stands in the camera picture.
  pose(pts, map, place = null) {
    const P = (i) => map(pts[i]);
    const ok = (i) => pts[i].v > 0.4;
    const S = mid(P(L.lShoulder), P(L.rShoulder));
    const Hp = mid(P(L.lHip), P(L.rHip));
    const tilt = Math.atan2(S.y - Hp.y, S.x - Hp.x) + Math.PI / 2; // 0 when upright
    const c = this.container;

    if (place) {
      // place = { cx, top, height }: the whole sprite fits that box, upright-ish
      const k = place.height / this.rig.h, b = this.rig.parts.body;
      c.setPosition(place.cx + (b.px - this.rig.w / 2) * k, place.top + b.py * k);
      c.setScale(k);
      c.setRotation(Math.max(-0.45, Math.min(0.45, tilt)));
    } else {
      // size: shoulders-to-feet of the person = shoulders-to-feet of the sprite
      const feet = ok(L.lAnkle) && ok(L.rAnkle) ? mid(P(L.lAnkle), P(L.rAnkle)) : null;
      const torsoPx = Math.hypot(S.x - Hp.x, S.y - Hp.y);
      const spanPx = feet ? Math.max(Math.hypot(feet.x - S.x, feet.y - S.y), torsoPx * 1.5) : torsoPx * 2.4;
      const k = spanPx / (this.rig.h - this.rig.shoulderY);
      c.setScale(k);
      c.setRotation(tilt);
      // put the sprite's shoulder line on the person's shoulders
      const d = (this.rig.parts.body.py - this.rig.shoulderY) * k;
      c.setPosition(S.x - d * Math.sin(tilt), S.y + d * Math.cos(tilt));
    }

    for (const [name, lm] of Object.entries(LIMBS)) {
      const im = this.parts[name];
      if (!im) continue;
      let target = 0;
      const end = ok(lm.to) ? lm.to : ok(lm.mid) ? lm.mid : null;
      if (ok(lm.from) && end !== null) {
        const A = P(lm.from), B = P(end);
        const ang = Math.atan2(B.y - A.y, B.x - A.x);
        target = wrap(ang - lm.rest - c.rotation);
      }
      // smooth, and keep legs from swinging unnaturally far
      if (name.startsWith('leg')) target = Math.max(-1.2, Math.min(1.2, target));
      this.rot[name] += wrap(target - this.rot[name]) * 0.5;
      im.setRotation(this.rot[name]);
    }
  }
}

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

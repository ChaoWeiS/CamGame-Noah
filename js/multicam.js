// Several phone cameras working together.
//
// Each phone sends, per person: 2D joints in its picture (u, v in 0…1) and MediaPipe's
// 3D "world" skeleton (metres, centred between the hips, turned like the camera sees it).
//
// Calibration (one person walks about while the cameras watch):
//   1. per camera, the person's 3D position is found by fitting the world skeleton to
//      the 2D joints (a pinhole camera with an unknown lens angle);
//   2. the same moments seen by two cameras give the same joints in two camera spaces;
//      the rotation + shift between the cameras is the best fit over all of them
//      (Horn's method), trying lens angles until the fit is tightest;
//   3. the feet give the floor, which sets up a shared "room" (y up, metres).
// Then, during play, every camera's people are put into the room, people at the same
// spot are merged (joint by joint, the better-seen view counts more), and the result is
// projected back into the main camera's view, so the rest of the game works as before.

const D2R = Math.PI / 180;
export const FOVS = []; for (let f = 45; f <= 125; f += 5) FOVS.push(f);   // lens angles to try (horizontal)

// ---------------------------------------------------------------- small linear algebra
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (norm(a) || 1));
const mv = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];          // M is 3 rows
const mt = (M) => [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
const mm = (A, B) => { const Bt = mt(B); return A.map((r) => Bt.map((c) => dot(r, c))); };
export const xform = (T, p) => add(mv(T.R, p), T.t);                       // T = {R, t}: p → R p + t
const compose = (A, B) => ({ R: mm(A.R, B.R), t: add(mv(A.R, B.t), A.t) }); // A after B
const invert = (T) => { const Rt = mt(T.R); return { R: Rt, t: scale(mv(Rt, T.t), -1) }; };

// eigen-decomposition of a small symmetric matrix (Jacobi rotations)
function eigSym(A) {
  const n = A.length, a = A.map((r) => [...r]), V = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-20) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const vp = V[k][p], vq = V[k][q]; V[k][p] = c * vp - s * vq; V[k][q] = s * vp + c * vq; }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: a.map((_, j) => V.map((r) => r[j])) };  // vectors[j] = j-th eigenvector
}

// best rotation + shift taking points P onto Q (weighted): Horn's quaternion method
export function fitRigid(P, Q, W = null) {
  let sw = 0, pc = [0, 0, 0], qc = [0, 0, 0];
  P.forEach((p, i) => { const w = W ? W[i] : 1; sw += w; pc = add(pc, scale(p, w)); qc = add(qc, scale(Q[i], w)); });
  pc = scale(pc, 1 / sw); qc = scale(qc, 1 / sw);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  P.forEach((p, i) => {
    const w = W ? W[i] : 1, a = sub(p, pc), b = sub(Q[i], qc);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += w * a[r] * b[c];
  });
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = eigSym(N);
  const [w, x, y, z] = vectors[values.indexOf(Math.max(...values))];
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  return { R, t: sub(qc, mv(R, pc)) };
}

// ---------------------------------------------------------------- one camera
// lens: horizontal angle (deg) + picture shape → focal lengths in picture units
const focal = (fov, aspect) => { const fx = 1 / (2 * Math.tan((fov * D2R) / 2)); return { fx, fy: fx * aspect }; };

// Where the person is in camera space: the shift T so that (world + T), seen through
// the lens, lands on the 2D joints. Linear least squares (3 unknowns, 2 equations/joint).
export function locate(world, uvv, fov, aspect, minVis = 0.5) {
  const { fx, fy } = focal(fov, aspect);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < 33; i++) {
    const v = uvv[i * 3 + 2]; if (v < minVis) continue;
    const a = (uvv[i * 3] - 0.5) / fx, c = (uvv[i * 3 + 1] - 0.5) / fy;
    const wx = world[i * 3], wy = world[i * 3 + 1], wz = world[i * 3 + 2];
    // tx − a·tz = a·wz − wx ;  ty − c·tz = c·wz − wy
    for (const [row, rhs] of [[[1, 0, -a], a * wz - wx], [[0, 1, -c], c * wz - wy]]) {
      for (let r = 0; r < 3; r++) { for (let k = 0; k < 3; k++) A[r][k] += v * row[r] * row[k]; b[r] += v * row[r] * rhs; }
    }
    n++;
  }
  if (n < 6) return null;
  const T = solve3(A, b);
  if (!T || T[2] < 0.3) return null;                       // must be in front of the camera
  return T;
}
function solve3(A, b) {
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A); if (Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((k) => det(A.map((r, i) => r.map((x, j) => (j === k ? b[i] : x)))) / d);
}
// joints of one person in camera space (metres), or null
export function cameraJoints(world, uvv, fov, aspect) {
  const T = locate(world, uvv, fov, aspect);
  if (!T) return null;
  const J = [];
  for (let i = 0; i < 33; i++) J.push([world[i * 3] + T[0], world[i * 3 + 1] + T[1], world[i * 3 + 2] + T[2]]);
  return J;
}
// camera space → picture (u, v)
export function project(p, fov, aspect) {
  const { fx, fy } = focal(fov, aspect);
  return [0.5 + (fx * p[0]) / p[2], 0.5 + (fy * p[1]) / p[2]];
}

// ---------------------------------------------------------------- who is moving (per camera)
// The person who should be followed during calibration is the one moving the most.
// Movement = how far the hips and hands have travelled over the last second (in torso
// lengths). Frame-to-frame jitter doesn't add up over a second; real walking does.
function updateMovers(cam, frame, now) {
  const prev = cam.people || [];
  const KEY = [15, 16, 23, 24];
  cam.people = frame.poses.map((uvv, k) => {
    const hip = [(uvv[23 * 3] + uvv[24 * 3]) / 2, (uvv[23 * 3 + 1] + uvv[24 * 3 + 1]) / 2];
    const torso = Math.max(0.03, Math.hypot(hip[0] - (uvv[11 * 3] + uvv[12 * 3]) / 2, hip[1] - (uvv[11 * 3 + 1] + uvv[12 * 3 + 1]) / 2));
    let best = null, bd = 0.15;
    for (const q of prev) { const d = Math.hypot(q.hip[0] - hip[0], q.hip[1] - hip[1]); if (d < bd) { bd = d; best = q; } }
    const snap = { t: now, pts: KEY.map((i) => (uvv[i * 3 + 2] > 0.5 ? [uvv[i * 3], uvv[i * 3 + 1]] : null)) };
    const hist = (best ? best.hist : []).filter((h) => now - h.t < 1000).concat([snap]);
    let energy = 0;
    const old = hist[0];
    if (old && now - old.t > 400) {
      let s2 = 0, n = 0;
      snap.pts.forEach((p, j) => { const o = old.pts[j]; if (p && o) { s2 += Math.hypot(p[0] - o[0], p[1] - o[1]); n++; } });
      energy = n ? s2 / n / torso : 0;
    }
    return { uvv, world: frame.worlds?.[k], hip, torso, energy, hist };
  });
}
function mover(cam, alone) {
  const ps = (cam.people || []).filter((p) => p.world);
  if (!ps.length) return null;
  if (ps.length === 1 && alone) return ps[0];
  const s = [...ps].sort((a, b) => b.energy - a.energy);
  if (s[0].energy < 0.25) return null;                         // nobody really moving
  if (s[1] && s[0].energy < s[1].energy * 1.6) return null;      // not clear who is moving
  return s[0];
}

// ---------------------------------------------------------------- the camera set
export const multicam = {
  cams: new Map(),        // id → { id, num, frame, at, calib: {fov, aspect, toRoom}|null, still, people }
  nextNum: 1,
  session: null,          // calibration in progress
  view: null,             // id of the camera whose picture the game uses
  spots: [],              // where people stand in the room (for the map)

  cam(id) {
    let c = this.cams.get(id);
    if (!c) { c = { id, num: this.nextNum++, frame: null, at: 0, calib: null, still: true, connected: true }; this.cams.set(id, c); }
    return c;
  },
  addFrame(id, frame, now = performance.now()) {
    const c = this.cam(id);
    c.frame = frame; c.at = now; c.connected = true;
    if (frame.still !== undefined) c.still = frame.still;
    updateMovers(c, frame, now);
    if (this.session) this.collect(c, now);
  },
  connectedCams() { return [...this.cams.values()].filter((c) => c.connected); },
  linked() { return this.connectedCams().filter((c) => c.calib); },
  // combine cameras only when 2+ linked cameras are connected
  active() { return this.linked().length >= 2; },
  disconnect(id) { const c = this.cams.get(id); if (c) c.connected = false; },
  moved(id) { const c = this.cams.get(id); if (c) { c.calib = null; c.still = false; } },

  // ---- calibration: link `targets` (camera ids) to the room. If no camera is linked
  // yet, the first target becomes the room's reference (its floor sets up the room).
  startCalibration(targets, opts = {}) {
    const linked = this.linked().map((c) => c.id);
    const ref = linked.length ? null : targets[0];
    this.session = {
      targets: targets.filter((id) => id !== ref), ref, alone: !!opts.alone,
      samples: new Map(),            // target id → [{ a: {world,uvv,aspect,cam}, b: {…} }]
      started: performance.now(), lastAt: new Map(), status: new Map(), done: false, result: null,
    };
    if (ref) this.session.refFloor = [];
    return this.session;
  },
  cancelCalibration() { this.session = null; },

  // pair the moving person in a target camera with the same moment in a "helper" camera
  collect(c, now) {
    const S = this.session;
    if (!S.targets.includes(c.id)) return;
    if (now - (S.lastAt.get(c.id) || 0) < 90) return;          // ~10 samples a second
    const helpers = S.ref ? [this.cams.get(S.ref)] : this.linked().filter((h) => h.id !== c.id && h.still);
    const m = mover(c, S.alone);
    if (!m) return;
    for (const h of helpers) {
      if (!h || !h.frame || Math.abs(h.at - now) > 70) continue;
      const hm = mover(h, S.alone);
      if (!hm) continue;
      const list = S.samples.get(c.id) || [];
      // keep everyone the target camera sees too: once a rough fit exists, the right one is picked again
      const all = c.people.filter((p) => p.world).map((p) => ({ world: p.world, uvv: p.uvv, aspect: c.frame.aspect }));
      list.push({ helper: h.id, a: { world: hm.world, uvv: hm.uvv, aspect: h.frame.aspect }, b: { world: m.world, uvv: m.uvv, aspect: c.frame.aspect }, all });
      S.samples.set(c.id, list);
      S.lastAt.set(c.id, now);
      break;
    }
  },
  // how far along each target is (0…1), and what to ask the walker to do
  progress(id) {
    const list = this.session?.samples.get(id) || [];
    if (!list.length) return { k: 0, hint: 'walk' };
    const hu = list.map((s) => (s.a.uvv[23 * 3] + s.a.uvv[24 * 3]) / 2);
    const tz = list.map((s) => Math.hypot(s.a.uvv[11 * 3] - s.a.uvv[23 * 3], s.a.uvv[11 * 3 + 1] - s.a.uvv[23 * 3 + 1]));
    const span = (xs) => Math.max(...xs) - Math.min(...xs);
    const side = Math.min(1, span(hu) / 0.25), depth = Math.min(1, span(tz) / (Math.max(...tz) * 0.2));
    // enough variety — or plenty of moments anyway (the fit itself decides if it's good)
    const k = list.length >= 140 ? 1 : Math.min(1, list.length / 70) * 0.5 + Math.min(side, depth) * 0.5;
    const hint = list.length < 70 ? 'walk' : side < 1 ? 'side' : depth < 1 ? 'depth' : 'ok';
    return { k, hint, samples: list.length };
  },

  // work out each target camera's place in the room from its samples
  solve(id) {
    const S = this.session, list = S.samples.get(id) || [];
    if (list.length < 25) return { ok: false, why: 'not enough' };
    const helper = this.cams.get(list[0].helper);
    const helperFovs = helper.calib ? [helper.calib.fov] : FOVS;
    const fit = (fa, fb, use) => {
      const P = [], Q = [], W = [], per = [];
      use.forEach((s, si) => {
        const A = cameraJoints(s.a.world, s.a.uvv, fa, s.a.aspect), B = cameraJoints(s.b.world, s.b.uvv, fb, s.b.aspect);
        if (!A || !B) return;
        for (let i = 0; i < 33; i++) {
          const w = Math.min(s.a.uvv[i * 3 + 2], s.b.uvv[i * 3 + 2]);
          if (w < 0.5) continue;
          P.push(B[i]); Q.push(A[i]); W.push(w); per.push(si);
        }
      });
      if (P.length < 60) return null;
      const T = fitRigid(P, Q, W);
      let e = 0, sw = 0; const errS = new Map();
      P.forEach((p, k) => {
        const d = norm(sub(xform(T, p), Q[k])); e += W[k] * d * d; sw += W[k];
        errS.set(per[k], (errS.get(per[k]) || 0) + d);
      });
      return { T, rms: Math.sqrt(e / sw), errS };
    };
    // 1) coarse lens search, 2) fine search around the best, 3) drop the worst quarter of moments
    let best = null;
    const tryFovs = (fas, fbs, use) => {
      for (const fa of fas) for (const fb of fbs) {
        const r = fit(fa, fb, use);
        if (r && (!best || r.rms < best.rms)) best = { ...r, fa, fb };
      }
    };
    tryFovs(helperFovs, FOVS, list);
    if (!best) return { ok: false, why: 'no fit' };
    const near = (f, fixed) => (fixed ? [f] : [-4, -2, 0, 2, 4].map((d) => f + d).filter((x) => x >= 40 && x <= 130));
    const b0 = best;
    tryFovs(near(b0.fa, !!helper.calib), near(b0.fb, false), list);
    // Re-pick, for every moment, the person in the target camera who lines up with the
    // walker under the rough fit (fixes moments where two people were mixed up); drop
    // moments where nobody does. Then fit again, twice, finer each time.
    let use = list;
    for (let round = 0; round < 2; round++) {
      const fixed = [];
      for (const smp of list) {
        const A = cameraJoints(smp.a.world, smp.a.uvv, best.fa, smp.a.aspect); if (!A) continue;
        const ha = scale(add(A[23], A[24]), 0.5);
        let pick = null, pd = 0.45;
        for (const cand of smp.all || [smp.b]) {
          const B = cameraJoints(cand.world, cand.uvv, best.fb, cand.aspect); if (!B) continue;
          const d = norm(sub(xform(best.T, scale(add(B[23], B[24]), 0.5)), ha));
          if (d < pd) { pd = d; pick = cand; }
        }
        if (pick) fixed.push({ ...smp, b: pick });
      }
      if (fixed.length < 25) break;
      use = fixed;
      best = null;
      tryFovs(near(b0.fa, !!helper.calib), FOVS.filter((f) => Math.abs(f - b0.fb) <= 20), use);
      if (!best) return { ok: false, why: 'no fit' };
      tryFovs(near(best.fa, !!helper.calib), near(best.fb, false), use);
    }
    const ranked = use.map((s, i) => [i, best.errS.get(i) ?? 1e9]).sort((x, y) => x[1] - y[1]);
    const keep = ranked.slice(0, Math.ceil(ranked.length * 0.8)).map(([i]) => use[i]);
    const f2 = fit(best.fa, best.fb, keep);
    if (f2) best = { ...best, ...f2 };
    return { ok: best.rms < 0.25, rms: best.rms, fovHelper: best.fa, fov: best.fb, toHelper: best.T, helper: helper.id, samples: list.length };
  },

  // finish: set up the room (first time) and store each camera's place in it
  finish() {
    const S = this.session; if (!S) return null;
    const results = new Map();
    for (const id of S.targets) results.set(id, this.solve(id));
    if (![...results.values()].every((r) => r.ok)) return { ok: false, results };
    if (S.ref) {
      // the room: floor from the reference camera's view of the feet
      const ref = this.cams.get(S.ref), fovRef = [...results.values()][0].fovHelper;
      const feet = [], hips = [];
      for (const list of S.samples.values()) for (const s of list) {
        const A = cameraJoints(s.a.world, s.a.uvv, fovRef, s.a.aspect); if (!A) continue;
        for (const i of [27, 28, 29, 30, 31, 32]) if (s.a.uvv[i * 3 + 2] > 0.5) feet.push(A[i]);
        hips.push(scale(add(A[23], A[24]), 0.5));
      }
      const room = roomFromFloor(feet, hips);
      if (!room) return { ok: false, results, why: 'floor' };
      ref.calib = { fov: fovRef, aspect: ref.frame.aspect, toRoom: room };
    }
    for (const [id, r] of results) {
      const c = this.cams.get(id), h = this.cams.get(r.helper);
      c.calib = { fov: r.fov, aspect: c.frame.aspect, toRoom: compose(h.calib.toRoom, r.toHelper), rms: r.rms };
    }
    if (!this.view || !this.cams.get(this.view)?.calib) this.view = (S.ref || this.linked()[0]?.id) ?? null;
    this.session = null;
    return { ok: true, results };
  },

  // ---- play: everyone from every linked camera, merged, as seen by the view camera
  fuse(now = performance.now()) {
    const cams = this.linked().filter((c) => c.frame && now - c.at < 400 && c.still !== false);   // frames up to 0.4 s old still count
    const view = this.cams.get(this.view);
    if (cams.length < 1 || !view?.calib) return null;
    const people = [];         // [{ cam, J (room), V }]
    for (const c of cams) {
      c.frame.poses.forEach((uvv, k) => {
        const w = c.frame.worlds?.[k]; if (!w) return;
        const J = cameraJoints(w, uvv, c.calib.fov, c.calib.aspect); if (!J) return;
        const V = []; for (let i = 0; i < 33; i++) V.push(uvv[i * 3 + 2]);
        people.push({ cam: c.id, J: J.map((p) => xform(c.calib.toRoom, p)), V });
      });
    }
    // same spot in the room (hips within 0.6 m), from different cameras = same person
    const hip = (p) => scale(add(p.J[23], p.J[24]), 0.5);
    const groups = [];
    for (const p of people) {
      const g = groups.find((g) => !g.some((q) => q.cam === p.cam) && norm(sub(hip(g[0]), hip(p))) < 0.6);
      if (g) g.push(p); else groups.push([p]);
    }
    const toView = invert(view.calib.toRoom);
    const poses = [], worlds = [];
    this.spots = groups.map((g) => { const h = hip(g[0]); return { x: h[0], z: h[2], cams: g.length }; });   // for the map
    for (const g of groups) {
      const J = [], V = [];
      for (let i = 0; i < 33; i++) {
        let s = [0, 0, 0], sw = 0, vmax = 0;
        for (const p of g) { const w = Math.max(0.05, p.V[i]) ** 2; s = add(s, scale(p.J[i], w)); sw += w; vmax = Math.max(vmax, p.V[i]); }
        J.push(xform(toView, scale(s, 1 / sw))); V.push(vmax);
      }
      const h = scale(add(J[23], J[24]), 0.5);
      if (h[2] < 0.3) continue;                              // behind the view camera
      const uvv = [], wf = [];
      for (let i = 0; i < 33; i++) {
        const z = Math.max(0.05, J[i][2]), [u, v] = project([J[i][0], J[i][1], z], view.calib.fov, view.calib.aspect);
        uvv.push(u, v, V[i]);
        wf.push(J[i][0] - h[0], J[i][1] - h[1], J[i][2] - h[2]);
      }
      poses.push(uvv); worlds.push(wf);
    }
    return { poses, worlds, aspect: view.calib.aspect, cams: cams.length };
  },

  // for the map: each linked camera's position and facing in the room (x, z on the floor)
  layout() {
    return this.connectedCams().map((c) => {
      if (!c.calib) return { id: c.id, num: c.num, linked: false };
      const pos = c.calib.toRoom.t, fwd = mv(c.calib.toRoom.R, [0, 0, 1]);
      return { id: c.id, num: c.num, linked: true, x: pos[0], z: pos[2], h: pos[1], dir: Math.atan2(fwd[0], fwd[2]), fov: c.calib.fov, rms: c.calib.rms };
    });
  },
};

// floor plane through the feet → room axes (y up), origin under the walker's average spot.
// Returns camera→room {R, t}.
function roomFromFloor(feet, hips) {
  if (feet.length < 20) return null;
  let c = [0, 0, 0]; feet.forEach((p) => { c = add(c, p); }); c = scale(c, 1 / feet.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  feet.forEach((p) => { const d = sub(p, c); for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r][k] += d[r] * d[k]; });
  const { values, vectors } = eigSym(C);
  let up = unit(vectors[values.indexOf(Math.min(...values))]);
  let hc = [0, 0, 0]; hips.forEach((p) => { hc = add(hc, p); }); hc = scale(hc, 1 / hips.length);
  if (dot(sub(hc, c), up) < 0) up = scale(up, -1);           // up points from the feet to the hips
  // x: the camera's right, laid flat on the floor; z completes the set
  let x = sub([1, 0, 0], scale(up, up[0])); x = unit(x);
  const z = cross(x, up);
  const R = [x, up, z];                                       // rows: room axes in camera space
  const origin = sub(hc, scale(up, dot(sub(hc, c), up) + 0.05)); // on the floor under the hips (ankles ~5 cm up)
  return { R, t: scale(mv(R, origin), -1) };
}

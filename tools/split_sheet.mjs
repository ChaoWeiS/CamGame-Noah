// Split a Tripo sheet into one node per item: connected pieces (welded), with small pieces that
// sit inside a bigger one's box merged into it. Each item is centred on x/z with its base at y=0.
// node split.mjs IN OUT [names.json] [ratio]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, quantize, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [,, IN, OUT, NAMES, RATIO = '0.02', FROM = '0', TO = '999'] = process.argv;
const names = NAMES && fs.existsSync(NAMES) ? JSON.parse(fs.readFileSync(NAMES, 'utf8')) : null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot(), buf = root.listBuffers()[0];
const srcNode = root.listNodes()[0], srcMesh = srcNode.getMesh(), prim = srcMesh.listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray();
const I = prim.getIndices().getArray(), nv = P.length / 3;
const key = new Map(), wid = new Int32Array(nv);
for (let i = 0; i < nv; i++) { const k = `${P[i*3].toFixed(4)},${P[i*3+1].toFixed(4)},${P[i*3+2].toFixed(4)}`; let id = key.get(k); if (id === undefined) { id = key.size; key.set(k, id); } wid[i] = id; }
const par = new Int32Array(key.size).map((_, i) => i), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
for (let t = 0; t < I.length; t += 3) { const a = find(wid[I[t]]); par[find(wid[I[t+1]])] = a; par[find(wid[I[t+2]])] = a; }
const pcs = new Map();
for (let t = 0; t < I.length; t += 3) {
  const r = find(wid[I[t]]); let c = pcs.get(r);
  if (!c) { c = { tris: [], min: [9,9,9], max: [-9,-9,-9] }; pcs.set(r, c); }
  c.tris.push(t);
  for (let j = 0; j < 3; j++) { const v = I[t+j]; for (let k = 0; k < 3; k++) { if (P[v*3+k] < c.min[k]) c.min[k] = P[v*3+k]; if (P[v*3+k] > c.max[k]) c.max[k] = P[v*3+k]; } }
}
let cl = [...pcs.values()].sort((a, b) => b.tris.length - a.tris.length);
const vol = (c) => [0,1,2].reduce((s, k) => s * Math.max(1e-6, c.max[k] - c.min[k]), 1);
const inter = (a, b) => [0,1,2].reduce((s, k) => s * Math.max(0, Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k])), 1);
// small pieces inside (or mostly inside) a bigger piece's box join it; crumbs (< 40 tris) join the nearest
for (let i = cl.length - 1; i >= 0; i--) {
  const c = cl[i]; let best = -1, bs = 0;
  for (let j = 0; j < i; j++) { const f = inter(c, cl[j]) / vol(c); if (f > bs) { bs = f; best = j; } }
  if (best < 0 && c.tris.length < 40) {
    let bd = 1e9; const cc = [0,1,2].map((k) => (c.min[k] + c.max[k]) / 2);
    for (let j = 0; j < i; j++) { const d = Math.hypot(...[0,1,2].map((k) => Math.max(0, cl[j].min[k] - cc[k], cc[k] - cl[j].max[k]))); if (d < bd) { bd = d; best = j; } }
    bs = 1;
  }
  if (best >= 0 && bs > 0.5) {
    const b = cl[best]; b.tris = b.tris.concat(c.tris);
    for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], c.min[k]); b.max[k] = Math.max(b.max[k], c.max[k]); }
    cl.splice(i, 1);
  }
}
// reading order: rows by base height (y min) then left to right
cl.sort((a, b) => b.min[1] - a.min[1]);
const rows = []; for (const c of cl) { const r = rows.find((r) => Math.abs(r.y - c.min[1]) < 0.04); if (r) r.items.push(c); else rows.push({ y: c.min[1], items: [c] }); }
cl = rows.flatMap((r) => r.items.sort((a, b) => a.min[0] - b.min[0]));
console.log(pcs.size, 'pieces →', cl.length, 'items in', rows.length, 'rows:', rows.map((r) => r.items.length).join(' '));
// names like "@7" merge that item into item 7 (pieces the box test missed, e.g. a pan's handle)
if (names) names.forEach((n, i) => { if (typeof n === 'string' && n.startsWith('@')) { const b = cl[+n.slice(1)], c = cl[i]; b.tris = b.tris.concat(c.tris); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], c.min[k]); b.max[k] = Math.max(b.max[k], c.max[k]); } } });
const mat = root.listMaterials()[0], scene = root.listScenes()[0];
const info = [];
cl.forEach((c, i) => {
  if (i < +FROM || i > +TO) return;
  const name = names ? names[i] : `item${i}`;
  if (!name || name === '-' || name.startsWith('@')) return;
  const map = new Map(), pos = [], nor = [], uv = [], idx = [];
  const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2, by = c.min[1];
  for (const t of c.tris) for (let j = 0; j < 3; j++) {
    const v = I[t + j]; let m = map.get(v);
    if (m === undefined) { m = map.size; map.set(v, m); pos.push(P[v*3] - cx, P[v*3+1] - by, P[v*3+2] - cz); nor.push(N[v*3], N[v*3+1], N[v*3+2]); uv.push(UV[v*2], UV[v*2+1]); }
    idx.push(m);
  }
  const p = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)));
  info.push({ i, name, size: [0,1,2].map((k) => +(c.max[k] - c.min[k]).toFixed(3)), at: [+cx.toFixed(3), +by.toFixed(3), +cz.toFixed(3)] });
});
srcNode.dispose(); srcMesh.dispose();
mat.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.75);
await MeshoptSimplifier.ready;
await doc.transform(prune(), dedup(), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: +RATIO, error: 0.01 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 85 }),
  prune(), quantize());
let total = 0;
for (const m of root.listMeshes()) { const n = m.listPrimitives()[0].getIndices().getCount() / 3; total += n; const it = info.find((q) => q.name === m.getName()); if (it) it.tris = n; }
console.log('triangles', total);
fs.writeFileSync(OUT + '.json', JSON.stringify(info, null, 1));
await io.write(OUT, doc);

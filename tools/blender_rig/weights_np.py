# Skin weights without Blender's heat solver (it fails on these Tripo meshes): distance to each
# bone (as a segment), only from the bones that may move that part of the body, then smoothed
# over the mesh so the joints bend softly. Max 4 bones per vertex.
import bpy, numpy as np
def weight_np(m, a, H, iters=10, jaw=None):
    m.parent = None
    for md in list(m.modifiers): m.modifiers.remove(md)
    m.vertex_groups.clear()
    n = len(m.data.vertices)
    co = np.empty(n * 3); m.data.vertices.foreach_get('co', co); P = co.reshape(-1, 3)
    bones = list(a.data.bones); names = [b.name for b in bones]; NB = len(bones)
    Hd = np.array([b.head_local for b in bones]); Tl = np.array([b.tail_local for b in bones])
    pos = {b.name: np.array(b.head_local) for b in bones}
    D = np.empty((n, NB))
    for j in range(NB):
        ab = Tl[j] - Hd[j]; L2 = max(ab @ ab, 1e-9)
        t = np.clip(((P - Hd[j]) @ ab) / L2, 0, 1)
        D[:, j] = np.linalg.norm(P - (Hd[j] + t[:, None] * ab), axis=1)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    shX = abs(pos['upperR'][0]); hipZ = pos['hips'][2]; neckZ = pos['head'][2]
    allow = np.ones((n, NB), bool)
    for j, nm in enumerate(names):
        side = -1 if nm.endswith('L') else 1
        # arms: out at the side, and not far below the shoulder (else a wide body's flanks follow the arm)
        if nm[:-1] in ('upper', 'fore', 'hand'): allow[:, j] = (np.sign(x) == side) & (np.abs(x) > shX * 0.8) & (z > pos['upper' + nm[-1]][2] - 0.09 * H)
        elif nm[:-1] in ('thigh', 'shin'): allow[:, j] = (np.sign(x) == side) & (z < hipZ + 0.06 * H)
        elif nm == 'head': allow[:, j] = z > neckZ - 0.05 * H
        elif nm == 'belly': allow[:, j] = (y < -0.02 * H) & (z < neckZ)
        elif nm == 'tail': allow[:, j] = y > 0.02 * H
    # a face that hangs below the neck (the walrus's tusks and whisker pad): goes with the head
    pin = np.zeros(n, bool)
    if jaw:
        hj = names.index('head')
        pin = (z > jaw['bottom'] * H) & (z < neckZ) & (np.abs(x) < jaw['halfW'] * H) & (-y > jaw['front'] * H)
        allow[pin] = False; allow[pin, hj] = True
    sig = 0.06 * H
    W = np.where(allow, np.exp(-(D / sig) ** 2) + 1e-12 * (1 / (D + 1e-6)), 0)
    # nothing allowed nearby (far from every bone): nearest allowed bone
    none = W.sum(1) < 1e-9
    if none.any():
        Dn = np.where(allow[none], D[none], 1e9); W[none] = 0; W[np.where(none)[0], Dn.argmin(1)] = 1
    W /= W.sum(1, keepdims=True)
    # smooth over the mesh (neighbours' average), keeping the masks
    e = np.empty(len(m.data.edges) * 2, int); m.data.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
    deg = np.zeros(n); np.add.at(deg, e[:, 0], 1); np.add.at(deg, e[:, 1], 1)
    for _ in range(iters):
        S = np.zeros_like(W); np.add.at(S, e[:, 0], W[e[:, 1]]); np.add.at(S, e[:, 1], W[e[:, 0]])
        W = np.where(allow, 0.5 * W + 0.5 * S / np.maximum(deg, 1)[:, None], 0)
        if jaw: W[pin] = 0; W[pin, hj] = 1
        W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    # top 4, normalised, written in batches (same bone, same weight step)
    idx = np.argsort(-W, 1)[:, :4]; top = np.take_along_axis(W, idx, 1)
    top /= top.sum(1, keepdims=True)
    q = np.round(top * 255).astype(int)
    vgs = [m.vertex_groups.new(name=nm) for nm in names]
    for j in range(NB):
        for k in range(4):
            sel = (idx[:, k] == j) & (q[:, k] > 0)
            if not sel.any(): continue
            for qq in np.unique(q[sel, k]):
                vs = np.where(sel & (q[:, k] == qq))[0].tolist()
                vgs[j].add(vs, qq / 255.0, 'REPLACE')
    mod = m.modifiers.new('rig', 'ARMATURE'); mod.object = a
    m.parent = a
    return {'verts': n, 'per_bone': {nm: int((idx[:, 0] == j).sum()) for j, nm in enumerate(names)}}

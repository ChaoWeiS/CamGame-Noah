"""Step 1 (any Python): measure each Tripo model the same way js/autorig.js does and write joints.json.
Usage: python3 measure.py <folder with bear_tripo.glb, chicken.glb, dog.glb, hamster.glb>"""
import json, os, sys
DIR = sys.argv[1] if len(sys.argv) > 1 else '.'   # folder with the Tripo GLBs
import numpy as np
from pygltflib import GLTF2
import struct

def load_positions(path):
    g = GLTF2().load(path)
    blob = g.binary_blob()
    node = next(n for n in g.nodes if n.mesh is not None)
    M = np.eye(4)
    if node.matrix: M = np.array(node.matrix).reshape(4,4).T
    else:
        from scipy.spatial.transform import Rotation as R
        T = np.eye(4); 
        if node.translation: T[:3,3]=node.translation
        Rm = np.eye(4)
        if node.rotation: Rm[:3,:3]=R.from_quat(node.rotation).as_matrix()
        S = np.eye(4)
        if node.scale: S[:3,:3]=np.diag(node.scale)
        M = T@Rm@S
    allp=[]
    for prim in g.meshes[node.mesh].primitives:
        acc = g.accessors[prim.attributes.POSITION]; bv = g.bufferViews[acc.bufferView]
        dt = {5126: np.float32, 5123: np.uint16, 5122: np.int16, 5121: np.uint8, 5120: np.int8}[acc.componentType]
        stride = bv.byteStride or (3*np.dtype(dt).itemsize)
        raw = np.frombuffer(blob, dtype=np.uint8, count=bv.byteLength, offset=(bv.byteOffset or 0))
        start = acc.byteOffset or 0
        arr = np.lib.stride_tricks.as_strided(np.frombuffer(raw[start:].tobytes(), dtype=dt), shape=(acc.count,3), strides=(stride, np.dtype(dt).itemsize)).astype(np.float64)
        if acc.normalized:
            arr /= {np.int16:32767., np.uint16:65535., np.int8:127., np.uint8:255.}[dt]
        allp.append(arr)
    p = np.vstack(allp)
    p = (np.c_[p, np.ones(len(p))] @ M.T)[:, :3]
    return p

def smooth(a,b,x): 
    t = np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)

SHOULDER_FOR = {'bear':0.7,'dog':0.38,'chicken':0.66,'hamster':0.82}

def measure(path, aid):
    pos = load_positions(path)
    mn, mx = pos.min(0), pos.max(0)
    off = np.array([-(mn[0]+mx[0])/2, -mn[1], -(mn[2]+mx[2])/2])
    pos = pos + off
    H = pos[:,1].max(); X = pos[:,0].max()
    n=len(pos); S=80
    ax_ = np.abs(pos[:,0]); y=pos[:,1]; z=pos[:,2]
    b = np.clip(np.floor(y/H*S).astype(int),0,S-1)
    ext=np.zeros(S); np.maximum.at(ext,b,ax_)
    near=np.zeros(S,int); m=(ax_<X*0.06)&(z>0); np.add.at(near,b[m],1)
    top=int(np.argmax(ext))
    # JS: strict > so first max
    a0=a1=top
    while a0>0 and ext[a0-1]>ext[top]*0.7: a0-=1
    while a1<S-1 and ext[a1+1]>ext[top]*0.7: a1+=1
    armY=((a0+a1+1)/2/S)*H
    sx=0
    for bb in range(max(0,a0-4),a0): sx=max(sx,ext[bb])
    if not sx: sx=X*0.35
    crotchB=int(S*0.12)
    for bb in range(int(np.ceil(S*0.55))):
        if bb < S*0.55 and near[bb]==0: crotchB=bb
    crotchY=((crotchB+1)/S)*H
    XB=60; lo=np.full(XB,1e9); hi=np.full(XB,-1e9)
    mm=y>=crotchY; xb=np.minimum(XB-1,np.floor(ax_[mm]/X*XB).astype(int))
    np.minimum.at(lo,xb,y[mm]); np.maximum.at(hi,xb,y[mm])
    tall=hi[0]-lo[0]
    for k in range(2,XB-3):
        thin=lambda q: hi[q]-lo[q]<tall*0.45
        if thin(k) and thin(k+1) and thin(k+2): sx=min(sx,(k/XB)*X); break
    legm=y<crotchY; legX=ax_[legm].mean() if legm.any() else X*0.2
    tipm=ax_>X*0.85; armTipY=y[tipm].mean() if tipm.any() else armY
    shm=(ax_>sx)&(ax_<sx+(X-sx)*0.2)&(np.abs(y-armY)<H*0.15); armRootY=y[shm].mean() if shm.any() else armY
    elbowX=sx+(X-sx)*0.5; wristX=sx+(X-sx)*0.8
    hipY=crotchY+H*0.06; kneeY=crotchY*0.5
    waistY=hipY+(armRootY-hipY)*0.35; neckY=armRootY+(H-armRootY)*0.12
    chestY=hipY+(armRootY-hipY)*0.7; bellyY=(hipY+chestY)/2
    fm=(ax_<sx)&(y>hipY)&(y<chestY); frontZ=max(0,z[fm].max()) if fm.any() else 0
    bm=(ax_<sx)&(np.abs(y-waistY)<H*0.06); backs=np.sort(z[bm]); backZ=backs[int(len(backs)*0.1)] if len(backs) else 0
    tm=(z<backZ-H*0.05)&(y<chestY)&(y>H*0.05)&(ax_<sx)
    tailMinZ=min(0,z[tm].min()) if tm.any() else 0
    tb=tm&(z>backZ-H*0.1); tbc=tb.sum()
    hasTail=tbc>20 and backZ-tailMinZ>H*0.1
    tailBase=[pos[tb,0].mean(),y[tb].mean(),backZ-H*0.03] if hasTail else [0,hipY,backZ]
    shoulderIn=SHOULDER_FOR.get(aid,0.62)
    bones={'hips':[0,hipY,0],'spine':[0,waistY,0],'chest':[0,chestY,0],'head':[0,neckY,0],
           'belly':[0,bellyY,frontZ*0.4],'tail':tailBase}
    for s,side in (('L',-1),('R',1)):
        elbowY=armRootY+(armTipY-armRootY)*0.5
        bones['upper'+s]=[side*sx*shoulderIn,armRootY-H*0.01,0]
        bones['fore'+s]=[side*elbowX,elbowY,0]
        bones['hand'+s]=[side*wristX,armRootY+(armTipY-armRootY)*0.8,0]
        bones['thigh'+s]=[side*legX,hipY,0]
        bones['shin'+s]=[side*legX,kneeY,0]
    tipX = X  # fingertip
    return dict(H=H, X=X, offset=off.tolist(), hasTail=bool(hasTail), tailEnd=[0,tailBase[1],float(tailMinZ)],
                frontZ=float(frontZ), backZ=float(backZ), armTipY=float(armTipY), armRootY=float(armRootY), neckY=float(neckY),
                bones={k:[float(v) for v in vv] for k,vv in bones.items()})

out={}
for aid,f in [('bear','bear_tripo.glb'),('chicken','chicken.glb'),('dog','dog.glb'),('hamster','hamster.glb')]:
    out[aid]=measure(os.path.join(DIR, f), aid)
    print(aid, 'H=%.3f'%out[aid]['H'], 'tail', out[aid]['hasTail'], {k:[round(x,3) for x in v] for k,v in out[aid]['bones'].items() if k in ('hips','upperR','foreR','handR','thighR','shinR','head')})
json.dump(out, open(os.path.join(DIR, 'joints.json'), 'w'), indent=1)

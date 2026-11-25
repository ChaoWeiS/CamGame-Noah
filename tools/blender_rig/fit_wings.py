"""Step 3 (Blender): fit the bird wings (wings.glb) to each animal's arms, the same way js/wings.js does,
and skin them to the arm bones. Run after rig_animals.py."""
import bpy, json, mathutils, numpy as np
DIR = r"D:\Projects\CameraGames-Noah\rigging" + "\\"
J = json.load(open(DIR + 'joints.json'))
EDGE = [[0.06, 0.305], [0.192, 0.398], [0.241, 0.478], [0.346, 0.51]]
OX = {'bear':0.0,'chicken':1.2,'dog':2.4,'hamster':3.6}
def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def align(f, t):  # rotation matrix taking unit vector f onto unit vector t
    v=np.cross(f,t); c=float(np.dot(f,t))
    if c < -0.999999:
        ax=np.cross(f,[1,0,0]); ax=ax if np.linalg.norm(ax)>1e-6 else np.cross(f,[0,1,0]); ax/=np.linalg.norm(ax)
        return 2*np.outer(ax,ax)-np.eye(3)
    K=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+K+K@K/(1+c)
def nrm(v): return v/np.linalg.norm(v)

# the source wing, in glTF axes
for o in list(bpy.data.objects):
    if o.name.startswith('wings_src'): bpy.data.objects.remove(o, do_unlink=True)
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=DIR+'wings.glb')
new=[o for o in bpy.data.objects if o not in before]
src=next(o for o in new if o.type=='MESH')
bpy.context.view_layer.update(); mw=src.matrix_world.copy(); src.parent=None
for o in new:
    if o is not src: bpy.data.objects.remove(o, do_unlink=True)
src.data.transform(mw); src.matrix_world=mathutils.Matrix.Identity(4); src.name='wings_src'
n=len(src.data.vertices)
co=np.empty(n*3); src.data.vertices.foreach_get('co', co); co=co.reshape(-1,3)
P=np.c_[co[:,0], co[:,2], -co[:,1]]   # Blender -> glTF
edge=[]
for x,y in EDGE:
    sel=P[::3]; d=(sel[:,0]-x)**2+(sel[:,1]-y)**2; m=d<0.0016
    edge.append(np.array([x,y, sel[m,2].mean() if m.any() else 0.0]))
segLen=[np.linalg.norm(edge[i+1]-edge[i]) for i in range(3)]; total=sum(segLen)

def make(aid):
    d=J[aid]; H=d['H']; bo={k:np.array(v) for k,v in d['bones'].items()}; ox=OX[aid]
    name=aid+'_wings'
    if name in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    newP=np.zeros_like(P); keep=np.zeros(n,bool)
    W={}  # group -> (indices, weights)
    k=(0.6*H)/total
    for side,s in ((1,'R'),(-1,'L')):
        sh,el,wr=bo['upper'+s],bo['fore'+s],bo['hand'+s]
        tip=wr+(wr-el)*0.6
        dirs=[nrm(q-p) for p,q in ((sh,el),(el,wr),(wr,tip))]
        root=sh*np.array([0.55,1,1]); root[1]=d['neckY']-H*0.02
        backZ=min(d['backZ'],-H*0.08); root[2]=backZ-H*0.04
        arm=[root]
        for i in range(3): arm.append(arm[i]+dirs[i]*segLen[i]*k)
        sv=np.array([side,1,1])
        segs=[]
        for i in range(3):
            f=nrm((edge[i+1]-edge[i])*sv)
            segs.append((align(f,dirs[i]), edge[i]*sv, arm[i]))
        idx=np.where(np.sign(P[:,0])==side)[0]; V=P[idx]
        best=np.full(len(idx),1e9); bi=np.zeros(len(idx),int); bt=np.zeros(len(idx))
        for si in range(3):
            a,c=edge[si],edge[si+1]; ax,cx=side*a[0],side*c[0]
            dx,dy=cx-ax,c[1]-a[1]; L2=dx*dx+dy*dy
            t=((V[:,0]-ax)*dx+(V[:,1]-a[1])*dy)/L2; tc=np.clip(t,0,1)
            dd=np.hypot(V[:,0]-(ax+dx*tc), V[:,1]-(a[1]+dy*tc))
            m=dd<best; best[m]=dd[m]; bi[m]=si; bt[m]=t[m]
        wts=np.zeros((len(idx),3))
        bin_=np.where(bi>0, 1-smooth(-0.15,0.15,bt), 0.0)
        bout=np.where(bi<2, smooth(0.85,1.15,bt), 0.0)
        r=np.arange(len(idx))
        wts[r,bi]=1-0.5*bin_-0.5*bout
        m=bi>0; wts[r[m],bi[m]-1]+=0.5*bin_[m]
        m=bi<2; wts[r[m],bi[m]+1]+=0.5*bout[m]
        np_=np.zeros_like(V)
        for j,(R,a,A) in enumerate(segs):
            np_+=wts[:,[j]]*(((V-a)*k)@R.T + A)
        along=bi+np.clip(bt,0,1); sm=smooth(0,1.5,along)
        np_[:,1]+=H*0.04*sm; np_[:,2]+=H*0.04*sm
        newP[idx]=np_; keep[idx]=True
        for j,g in enumerate(('upper','fore','hand')):
            W[g+s]=(idx, wts[:,j])
    # build the object: copy of the source, new positions, drop the middle verts
    ob=src.copy(); ob.data=src.data.copy(); ob.name=name; bpy.context.scene.collection.objects.link(ob)
    B=np.c_[newP[:,0]+ox, -newP[:,2], newP[:,1]]
    ob.data.vertices.foreach_set('co', B.ravel())
    for g,(ii,ww) in W.items():
        vg=ob.vertex_groups.new(name=g)
        for i_,w_ in zip(ii.tolist(), ww.tolist()):
            if w_>1e-4: vg.add([i_], w_, 'REPLACE')
    import bmesh
    bm=bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(~keep)[0].tolist()], context='VERTS')
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    for mat in ob.data.materials:
        if mat: mat.use_backface_culling=False
    rig=bpy.data.objects[aid+'_rig']
    md=ob.modifiers.new('rig','ARMATURE'); md.object=rig; ob.parent=rig
    return len(ob.data.vertices)

res={aid: make(aid) for aid in ('bear','chicken','dog','hamster')}
src.hide_set(True); src.hide_render=True
result={'wing_verts':res,'edge':[e.round(3).tolist() for e in edge]}

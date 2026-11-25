"""Step 2 (Blender > Scripting): import the four models, build their skeletons from joints.json,
and weight them (heat weights on a watertight voxel copy, copied back to the real mesh).
Set DIR to the folder with the GLBs and joints.json."""
import bpy, json, mathutils
DIR = r"D:\Projects\CameraGames-Noah\rigging" + "\\"
J = json.load(open(DIR + 'joints.json'))
FILES = {'bear':'bear_tripo.glb','chicken':'chicken.glb','dog':'dog.glb','hamster':'hamster.glb'}
PARENT = {'hips':None,'spine':'hips','chest':'spine','head':'chest','belly':'spine','tail':'hips',
          'upperL':'chest','foreL':'upperL','handL':'foreL','thighL':'hips','shinL':'thighL',
          'upperR':'chest','foreR':'upperR','handR':'foreR','thighR':'hips','shinR':'thighR'}
CHILD = {'hips':'spine','spine':'chest','chest':'head','upperL':'foreL','foreL':'handL','thighL':'shinL',
         'upperR':'foreR','foreR':'handR','thighR':'shinR'}
def B(p, ox):  # glTF (x,y,z) -> Blender (x,-z,y), shifted along X for side-by-side
    return mathutils.Vector((p[0]+ox, -p[2], p[1]))

def build(aid, ox):
    d = J[aid]; H = d['H']; bones = d['bones']
    for o in list(bpy.data.objects):
        if o.name.startswith(aid+'_'): bpy.data.objects.remove(o, do_unlink=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=DIR+FILES[aid])
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type=='MESH')
    bpy.context.view_layer.update()
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    for o in new:
        if o is not mesh: bpy.data.objects.remove(o, do_unlink=True)
    mesh.data.transform(mw); mesh.matrix_world = mathutils.Matrix.Identity(4)
    off = d['offset']; mesh.data.transform(mathutils.Matrix.Translation((off[0]+ox, -off[2], off[1])))
    mesh.name = aid+'_body'
    arm_data = bpy.data.armatures.new(aid+'_rig')
    arm = bpy.data.objects.new(aid+'_rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    arm.show_in_front = True; arm_data.display_type = 'STICK'
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, p in bones.items():
        b = arm_data.edit_bones.new(name); b.head = B(p, ox); eb[name] = b
    for name, b in eb.items():
        if name in CHILD: b.tail = B(bones[CHILD[name]], ox)
        elif name.startswith('hand'):
            s = 1 if name.endswith('R') else -1; b.tail = b.head + mathutils.Vector((s*0.06*H,0,0))
        elif name.startswith('shin'): b.tail = mathutils.Vector((b.head.x, b.head.y, 0.0))
        elif name == 'head': b.tail = b.head + mathutils.Vector((0,0,(H-bones['head'][1])*0.9))
        elif name == 'belly': b.tail = b.head + mathutils.Vector((0,-0.08*H,0))
        elif name == 'tail':
            e = d['tailEnd']; b.tail = mathutils.Vector((b.head.x, -e[2], b.head.z)) if d['hasTail'] else b.head + mathutils.Vector((0,0.06*H,0))
        if (b.tail-b.head).length < 1e-3: b.tail = b.head + mathutils.Vector((0,0,0.02*H))
    for name, b in eb.items():
        if PARENT[name]: b.parent = eb[PARENT[name]]
    bpy.ops.object.mode_set(mode='OBJECT')
    return mesh, arm


def weight(aid):
    import bpy
    m = bpy.data.objects[aid+'_body']; a = bpy.data.objects[aid+'_rig']; H = J[aid]['H']
    m.parent = None
    for md in list(m.modifiers): m.modifiers.remove(md)
    m.vertex_groups.clear()
    p = m.copy(); p.data = m.data.copy(); p.name = aid+'_proxy'
    bpy.context.scene.collection.objects.link(p)
    rm = p.modifiers.new('remesh', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = H/160
    for o in bpy.context.selected_objects: o.select_set(False)
    p.select_set(True); bpy.context.view_layer.objects.active = p
    bpy.ops.object.modifier_apply(modifier='remesh')
    a.select_set(True); bpy.context.view_layer.objects.active = a
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    unw_p = sum(1 for v in p.data.vertices if not v.groups)
    for g in p.vertex_groups: m.vertex_groups.new(name=g.name)
    dt = m.modifiers.new('wt', 'DATA_TRANSFER'); dt.object = p
    dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    for o in bpy.context.selected_objects: o.select_set(False)
    m.select_set(True); bpy.context.view_layer.objects.active = m
    bpy.ops.object.modifier_apply(modifier='wt')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    mod = m.modifiers.new('rig', 'ARMATURE'); mod.object = a
    m.parent = a
    bpy.data.objects.remove(p, do_unlink=True)
    return {'proxy_unweighted': unw_p, 'unweighted': sum(1 for v in m.data.vertices if not v.groups), 'verts': len(m.data.vertices)}

res = {}
for aid, ox in (('bear',0.0),('chicken',1.2),('dog',2.4),('hamster',3.6)):
    build(aid, ox)
    res[aid] = weight(aid)
result = res

import bpy, json, mathutils, sys
aid, DIR = sys.argv[-2], sys.argv[-1] + '/'
src = open('/home/claude/camgame-noah/tools/blender_rig/rig_animals.py').read().split('res = {}')[0]
src = src.replace('DIR = r"D:\\Projects\\CameraGames-Noah\\rigging" + "\\\\"', '')
src = src.replace("FILES = {", "FILES = {'%s':'%s.glb'," % (aid, aid))
bpy.ops.wm.read_factory_settings(use_empty=True)
g = {'DIR': DIR}
exec(src, g)
mesh, arm = g['build'](aid, 0.0)
import os
ratio = float(os.environ.get('DECIMATE', '1'))
if ratio < 1:
    for o in bpy.context.selected_objects: o.select_set(False)
    mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
    dm = mesh.modifiers.new('dec', 'DECIMATE'); dm.ratio = ratio; bpy.ops.object.modifier_apply(modifier='dec')
    print('TRIS', sum(len(p.vertices) - 2 for p in mesh.data.polygons))
tip = g['J'][aid].get('handTip')
if tip:   # the hand bone runs along the flipper to its tip
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
    for s, sg in (('L', -1), ('R', 1)):
        e = arm.data.edit_bones['hand' + s]; e.tail = g['B']([sg * tip[0], tip[1], tip[2]], 0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
exec(open('/home/claude/walrus/weights.py').read(), g)
print('WEIGHT', g['weight_np'](mesh, arm, g['J'][aid]['H']))
for o in bpy.context.selected_objects: o.select_set(False)
mesh.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=DIR + aid + '_rigged.glb', export_format='GLB', use_selection=True, export_skins=True, export_animations=False)
print('EXPORTED')

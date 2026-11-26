import bpy, sys
src, out, ratio = sys.argv[-3], sys.argv[-2], float(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
print('tris before', sum(len(p.vertices) - 2 for p in mesh.data.polygons))
bpy.context.view_layer.objects.active = mesh; mesh.select_set(True)
d = mesh.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio
bpy.ops.object.modifier_apply(modifier='dec')
print('tris after', sum(len(p.vertices) - 2 for p in mesh.data.polygons))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_animations=False)

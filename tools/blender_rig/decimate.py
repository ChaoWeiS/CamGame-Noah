import bpy, sys
src, out, ratio = sys.argv[-3], sys.argv[-2], float(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
print('tris before', sum(len(p.vertices) - 2 for p in mesh.data.polygons))
bpy.context.view_layer.objects.active = mesh; mesh.select_set(True)
# Tripo splits every UV seam into separate vertices; decimating them apart tears little
# cracks all over the surface. Join them first (Blender keeps the UVs per face corner).
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
print('verts after weld', len(mesh.data.vertices))
d = mesh.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio
bpy.ops.object.modifier_apply(modifier='dec')
print('tris after', sum(len(p.vertices) - 2 for p in mesh.data.polygons))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_animations=False)

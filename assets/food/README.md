# Food and kitchen models

Cut from two Tripo sheets with `tools/split_sheet.mjs` (one node per item, named; each sits
centred on x/z with its base at y = 0; simplified; colours only, 1024 px texture):

- `dishes.glb` — 25 finished dishes and snacks (from `Food.glb`), names in `tools/dishes.names.json`
- `ingredients.glb` — 25 ingredients, items 0–24 of `Food_ingredients_and_furniture.glb`
- `furniture.glb` — 37 pieces of furniture, items 25–61 of the same sheet
  (names for both in `tools/kitchen.names.json`; `@7` in a names list merges that piece into item 7)

The `.json` next to each lists every item's size and where it stood on the sheet (Tripo units).

    cd <folder with node_modules: @gltf-transform/core, functions, extensions, meshoptimizer, sharp>
    node split_sheet.mjs Food.glb dishes.glb dishes.names.json 0.02
    node split_sheet.mjs Food_ingredients_and_furniture.glb ingredients.glb kitchen.names.json 0.01 0 24
    node split_sheet.mjs Food_ingredients_and_furniture.glb furniture.glb kitchen.names.json 0.01 25 99

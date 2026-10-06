# Test assets

All test models are **generated from code** by `scripts/make-test-assets.js`, so
their license is unambiguous (CC0). They are not committed; run:

```bash
npm run assets
```

| File | Purpose |
|------|---------|
| `bad-knot.glb` | Deliberately "dirty" export: ~35 MB, 348k unwelded triangles, a 4096px PNG, a duplicated and an unused material, an unused mesh and a primitive without normals. |
| `sculpture.glb` | Clean, smooth model used by the demos and docs. |
| `pebble.obj` + `.mtl` | Small OBJ with an MTL color, for the OBJ importer. |

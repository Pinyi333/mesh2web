# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org).

## 0.1.0 (unreleased)

First public version.

- **KTX2 textures**: `--texture-format ktx2` (and `textures.format: "ktx2"`)
  encodes textures with Basis Universal in Node and in the browser (ETC1S for
  color, UASTC for normal maps, `--texture-mode` to force one). Reports and
  `inspect` show texture GPU memory; `--max-texture-memory` /
  `budget.maxTextureMemoryMB` fails CI with exit code 2. `<web-model>` loads
  the KTX2 transcoder only for models that use it (`ktx2-transcoder-path`).
- **AR**: `<web-model ar>` opens Android Scene Viewer or iOS AR Quick Look
  (`ar-src`, `ios-src`, `ar-placement`, `ar-scale`, `activateAR()`,
  `exportUSDZ()`, `ar-status` event). `mesh2web optimize --ar` / `"ar": true`
  writes `name.ar.glb` (Draco + PNG/JPEG) and `name.usdz`.

- **@mesh2web/core**: inspect (health check with fixes), clean (dedup, flatten,
  weld, smooth normals, join, prune), meshoptimizer simplification with
  budget fitting, WebP texture resize, LOD generation, Meshopt/Draco
  compression, JSON + HTML reports, OBJ import, embed snippets. Node and
  browser entries.
- **@mesh2web/cli**: `inspect`, `optimize`, `build [--watch]`, `init`,
  `presets` (including `--json` for complete preset definitions); budgets with exit code 2; posters via headless Chromium.
- **@mesh2web/element**: `<web-model>` with poster-first lazy loading
  (`lazy` / `eager` / `interaction`), adaptive quality and LOD selection,
  on-demand rendering, off-screen pause, five lighting presets, page-first
  gestures, keyboard control, reduced-motion support, tweenable `camera`,
  `animation` and `exposure`, and an optional GSAP ScrollTrigger bridge.
- **Studio**: in-browser optimization in a Web Worker, split before/after
  compare, zip export.
- **Docs**: 30-second start, comparison table, CDN usage (jsDelivr / unpkg)
  and integration guides for Three.js, Webflow, Framer and WordPress, in
  English and Traditional Chinese. `npm run media` renders the README
  before/after GIF and the social preview image.

# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org).

## Unreleased

- **Site**: redesigned docs site. Dark HUD panels (bracketed wide headline,
  glass stats card, pill navigation that tracks the current section) alternate
  with concrete-grey sections set in extended black type. Brand palette is now
  chrome / black / white with ice-blue accents; type is Archivo + JetBrains
  Mono. English and Traditional Chinese kept in sync.

## 0.1.0 (2026-11-27)

First public version.

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

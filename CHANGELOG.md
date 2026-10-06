# Changelog

All notable changes are documented here. This project follows
[Semantic Versioning](https://semver.org).

## 0.1.0 (unreleased)

First public version.

- **@mesh2web/core**: inspect (health check with fixes), clean (dedup, flatten,
  weld, smooth normals, join, prune), meshoptimizer simplification with
  budget fitting, WebP texture resize, LOD generation, Meshopt/Draco
  compression, JSON + HTML reports, OBJ import, embed snippets. Node and
  browser entries.
- **@mesh2web/cli**: `inspect`, `optimize`, `build [--watch]`, `init`,
  `presets`; budgets with exit code 2; posters via headless Chromium.
- **@mesh2web/element**: `<web-model>` with poster-first lazy loading
  (`lazy` / `eager` / `interaction`), adaptive quality and LOD selection,
  on-demand rendering, off-screen pause, five lighting presets, page-first
  gestures, keyboard control, reduced-motion support, tweenable `camera`,
  `animation` and `exposure`, and an optional GSAP ScrollTrigger bridge.
- **Studio**: in-browser optimization in a Web Worker, split before/after
  compare, zip export.

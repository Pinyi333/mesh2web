# @mesh2web/cli

Optimize any 3D model into a lightweight, web-ready GLB, with presets, budgets,
LODs, posters, reports and an embed snippet. Part of [mesh2web](https://github.com/pinyi333/mesh2web).

```bash
npx @mesh2web/cli optimize robot.glb --preset hero
npx @mesh2web/cli inspect robot.glb
npx @mesh2web/cli build --watch      # uses mesh2web.config.json
```

Installing it (`npm i -D @mesh2web/cli`) provides the `mesh2web` command.
Run `mesh2web --help` for all flags. Over-budget models exit with code `2`,
so you can block oversized assets in CI.

`--texture-format ktx2` keeps textures compressed on the GPU (~4× less video
memory) and `--max-texture-memory <MB>` turns that into a CI budget. `--ar`
also writes `name.ar.glb` (Android Scene Viewer) and `name.usdz` (iOS AR Quick
Look) and adds `ar` to the embed snippet.

Posters (`--poster`) and USDZ (`--ar`) need the optional peer `playwright-core` and a Chromium
(`npx playwright-core install chromium`, or set `MESH2WEB_CHROMIUM`).

MIT

#!/usr/bin/env node
/**
 * Builds the browser bundle of @mesh2web/element:
 *   dist/web-model.js       tiny shell that registers <web-model>
 *   dist/chunks/*.js        three.js viewer, fetched lazily on first use
 *   dist/gsap.js            optional ScrollTrigger bridge
 * and copies it into apps/docs + apps/studio for GitHub Pages.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, 'packages/element');
const dist = path.join(pkg, 'dist');

await rm(dist, { recursive: true, force: true });
await build({
  entryPoints: { 'web-model': path.join(pkg, 'src/index.js'), gsap: path.join(pkg, 'src/gsap.js') },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: ['es2022', 'safari16'],
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'linked',
  logLevel: 'warning',
});

// Browser build of the optimization pipeline, used by Studio (runs in a worker).
await build({
  entryPoints: [path.join(root, 'packages/core/src/browser.js')],
  outfile: path.join(root, 'apps/studio/vendor/core.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2022', 'safari16'],
  platform: 'browser',
  // NodeIO paths and the Emscripten Node branch of the Basis encoder are never
  // reached in the browser.
  external: ['node:*', 'module', 'fs', 'path', 'url', 'crypto', 'worker_threads'],
  legalComments: 'linked',
  logLevel: 'warning',
});

const report = [];
for (const file of (await readdir(dist, { recursive: true })).filter((f) => f.endsWith('.js')).sort()) {
  const buf = await readFile(path.join(dist, file));
  report.push(`${file.padEnd(36)} ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${(gzipSync(buf).length / 1024).toFixed(1).padStart(6)} KB gzip`);
}
console.log(report.join('\n'));

// The shell (everything except the lazily loaded three.js chunk) must stay small.
const shell = gzipSync(await readFile(path.join(dist, 'web-model.js'))).length;
const SHELL_BUDGET = 15 * 1024;
if (shell > SHELL_BUDGET) {
  console.error(`✗ web-model.js is ${(shell / 1024).toFixed(1)} KB gzip, over the ${SHELL_BUDGET / 1024} KB budget`);
  process.exitCode = 1;
}

// Self-host GSAP + Lenis for the docs site (no third-party CDN at runtime).
const lib = path.join(root, 'apps/docs/vendor/lib');
await mkdir(lib, { recursive: true });
for (const file of ['gsap.min.js', 'ScrollTrigger.min.js', 'SplitText.min.js']) {
  await cp(path.join(root, 'node_modules/gsap/dist', file), path.join(lib, file));
}
await cp(path.join(root, 'node_modules/lenis/dist/lenis.min.js'), path.join(lib, 'lenis.min.js'));

await cp(path.join(root, 'packages/presets/src/optimize.json'), path.join(root, 'apps/studio/vendor/presets.json'));
// Basis Universal encoder for Studio's KTX2 option (fetched only when used).
await cp(path.join(root, 'node_modules/ktx2-encoder/dist/basis/basis_encoder.wasm'), path.join(root, 'apps/studio/vendor/basis_encoder.wasm'));
// Self-hosted KTX2 transcoder so Studio previews KTX2 output without a CDN.
await cp(path.join(root, 'node_modules/three/examples/jsm/libs/basis'), path.join(root, 'apps/studio/vendor/basis'), { recursive: true });

for (const app of ['apps/docs', 'apps/studio']) {
  try {
    await stat(path.join(root, app));
    await rm(path.join(root, app, 'vendor/element'), { recursive: true, force: true }).catch(() => {});
    await cp(dist, path.join(root, app, 'vendor/element'), { recursive: true });
    // Shared language detection and switching (see apps/shared/i18n.js).
    await cp(path.join(root, 'apps/shared/i18n.js'), path.join(root, app, 'vendor/i18n.js'));
  } catch { /* app not present */ }
}

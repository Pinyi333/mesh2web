#!/usr/bin/env node
/**
 * Render the README before/after GIF and the GitHub social preview:
 *   .github/assets/before-after.gif   (720×405, 12 fps, seamless 6 s loop)
 *   .github/assets/social-preview.png (1280×640, upload in Settings → General)
 *
 * Needs `npm run assets`, `npm run build`, a Chromium for playwright-core
 * (MESH2WEB_CHROMIUM to pick one) and ffmpeg on PATH. Frames go to .scratch/.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.scratch/readme-media');
const frames = path.join(scratch, 'frames');
const out = path.join(root, '.github/assets');
const FPS = 12;
const LOOP = 6;
const PORT = 5188;

await rm(scratch, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
await mkdir(out, { recursive: true });

// Optimize the messy test model with the default preset, exactly as the README shows.
execFileSync(process.execPath, [
  path.join(root, 'packages/cli/src/bin.js'), 'optimize', path.join(root, 'test-assets/bad-knot.glb'),
  '-o', scratch, '--no-lod',
], { stdio: 'inherit' });

const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: process.env.MESH2WEB_CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(mode, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { throw e; });
  await page.goto(`http://127.0.0.1:${PORT}/scripts/readme-media/?mode=${mode}&loop=${LOOP}`);
  await page.evaluate(() => window.__ready);
  await page.waitForTimeout(1500); // let the poster → model cross-fade finish
  return page;
}

try {
  const gif = await open('gif', 720, 405);
  const total = FPS * LOOP;
  for (let i = 0; i < total; i++) {
    await gif.evaluate((t) => window.__frame(t), i / FPS);
    await gif.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`) });
  }
  await gif.close();

  const social = await open('social', 1280, 640);
  await social.screenshot({ path: path.join(out, 'social-preview.png') });
  await social.close();
} finally {
  await browser.close();
  server.close();
}

const gifPath = path.join(out, 'before-after.gif');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png'),
  '-vf', 'split[a][b];[a]palettegen=max_colors=80:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  '-loop', '0', gifPath,
], { stdio: 'inherit' });

const kb = async (p) => `${((await stat(p)).size / 1024).toFixed(0)} KB`;
console.log(`→ ${path.relative(root, gifPath)} ${await kb(gifPath)}`);
console.log(`→ .github/assets/social-preview.png ${await kb(path.join(out, 'social-preview.png'))}`);

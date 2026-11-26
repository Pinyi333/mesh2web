#!/usr/bin/env node
/**
 * Browser tests for KTX2 textures and AR (headless Chromium via playwright-core):
 *   1. a model with KTX2 textures renders, and the textures stay GPU-compressed
 *   2. exportUSDZ() returns a valid USDZ archive (what iOS Quick Look receives)
 *   3. on Android the AR button opens Scene Viewer with an absolute model URL
 *   4. on desktop the AR button stays hidden
 * Requires `npm run build`. Set MESH2WEB_CHROMIUM to use a specific Chromium.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { createIO, optimizeFile } from '../packages/core/src/node.js';
import { startServer } from './serve.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.scratch/e2e-ar');
await mkdir(work, { recursive: true });

// A textured tile (noise base color), optimized with KTX2 + AR outputs.
{
  const size = 512;
  const data = Buffer.alloc(size * size * 3);
  for (let i = 0; i < data.length; i++) data[i] = 60 + ((i * 2654435761) % 160);
  const png = await sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1])))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])))
    .setIndices(acc('SCALAR', new Uint16Array([0, 2, 1, 0, 3, 2])))
    .setMaterial(doc.createMaterial('tile').setMetallicFactor(0)
      .setBaseColorTexture(doc.createTexture('tile').setImage(new Uint8Array(png)).setMimeType('image/png')));
  doc.createScene().addChild(doc.createNode('tile').setMesh(doc.createMesh('tile').addPrimitive(prim)));
  await writeFile(path.join(work, 'source.glb'), await (await createIO()).writeBinary(doc));
  await optimizeFile(path.join(work, 'source.glb'), {
    outDir: work, name: 'tile', ar: true, report: false,
    optimize: { simplify: false, lod: [1], textures: { format: 'ktx2', maxSize: 256 } },
  });
}

const page = (attrs) => `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">
<style>body{margin:0}web-model{width:640px}</style>
<script type="module" src="/packages/element/dist/web-model.js"></script>
<web-model src="tile.glb" ar-src="tile.ar.glb" alt="Tile" loading="eager"
  ktx2-transcoder-path="/node_modules/three/examples/jsm/libs/basis/"
  draco-decoder-path="/node_modules/three/examples/jsm/libs/draco/gltf/" ${attrs}></web-model>`;
await writeFile(path.join(work, 'index.html'), page('ar'));

const PORT = 5188;
const base = `http://127.0.0.1:${PORT}/.scratch/e2e-ar/`;
const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: process.env.MESH2WEB_CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
let failures = 0;
async function test(name, fn, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 }, ...contextOptions });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const started = Date.now();
  try {
    await tab.goto(base);
    await tab.evaluate(async () => {
      await customElements.whenDefined('web-model');
      const el = document.querySelector('web-model');
      await Promise.race([el.ready, new Promise((_, r) => setTimeout(() => r(new Error('load timeout')), 30000))]);
    });
    await fn(tab);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`✓ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}\n  ${err.message}`);
  } finally {
    await context.close();
  }
}

await test('KTX2: textures load and stay GPU-compressed', async (tab) => {
  const info = await tab.evaluate(() => {
    const maps = [];
    document.querySelector('web-model').viewer.model.traverse((o) => { if (o.material?.map) maps.push(o.material.map); });
    return maps.map((t) => ({ compressed: !!t.isCompressedTexture, w: t.image.width, mips: t.mipmaps?.length ?? 0 }));
  });
  if (!info.length || !info.every((t) => t.compressed && t.w === 256 && t.mips > 1)) throw new Error(`unexpected textures ${JSON.stringify(info)}`);
});

await test('AR: exportUSDZ() returns a USDZ archive', async (tab) => {
  const head = await tab.evaluate(async () => {
    const blob = await document.querySelector('web-model').exportUSDZ();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { type: blob.type, size: bytes.length, magic: String.fromCharCode(bytes[0], bytes[1]), text: new TextDecoder().decode(bytes.subarray(0, 200)) };
  });
  if (head.magic !== 'PK' || !head.text.includes('model.usda') || head.type !== 'model/vnd.usdz+zip') throw new Error(JSON.stringify(head));
});

await test('AR: Android opens Scene Viewer with an absolute model URL', async (tab) => {
  const result = await tab.evaluate(async () => {
    const el = document.querySelector('web-model');
    const button = el.shadowRoot.querySelector('[part="ar-button"]');
    const event = new Promise((resolve) => el.addEventListener('ar-status', (e) => { e.preventDefault(); resolve(e.detail); }, { once: true }));
    const visible = !button.hidden && button.getBoundingClientRect().width > 0;
    button.click();
    const detail = await event;
    return { visible, mode: el.arMode, status: detail.status, url: detail.url };
  });
  if (!result.visible || result.mode !== 'scene-viewer' || result.status !== 'session-started') throw new Error(JSON.stringify(result));
  const file = new URLSearchParams(result.url.slice(result.url.indexOf('?') + 1, result.url.indexOf('#'))).get('file');
  if (file !== `${base}tile.ar.glb`) throw new Error(`Scene Viewer got ${file}`);
}, { userAgent: ANDROID, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

await test('AR: button stays hidden on desktop', async (tab) => {
  const hidden = await tab.evaluate(() => document.querySelector('web-model').shadowRoot.querySelector('[part="ar-button"]').hidden);
  if (!hidden) throw new Error('AR button visible on desktop');
});

await browser.close();
server.close();
process.exitCode = failures ? 1 : 0;

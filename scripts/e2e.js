#!/usr/bin/env node
/**
 * Browser smoke tests (headless Chromium via playwright-core):
 *   1. examples/basic: <web-model> loads, renders and exposes its API
 *   2. apps/docs: page runs without errors
 *   3. apps/studio: the in-browser pipeline optimizes the generated sample
 * Requires `npm run build`. Set MESH2WEB_CHROMIUM to use a specific Chromium.
 */
import { chromium } from 'playwright-core';
import { startServer } from './serve.js';

const PORT = 5187;
const base = `http://127.0.0.1:${PORT}`;
const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: process.env.MESH2WEB_CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failures = 0;
async function test(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Third-party fonts may be unreachable in CI sandboxes; that is not a failure.
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const started = Date.now();
  try {
    await fn(page);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`✓ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}\n  ${err.message}`);
  } finally {
    await page.close();
  }
}

await test('basic example: <web-model> loads', async (page) => {
  await page.goto(`${base}/examples/basic/`);
  const info = await page.evaluate(async () => {
    await customElements.whenDefined('web-model');
    const el = document.querySelector('web-model');
    await Promise.race([el.ready, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 30000))]);
    el.camera.azimuth = 45;
    return {
      state: el.dataset.state, role: el.getAttribute('role'), label: el.getAttribute('aria-label'),
      hasScene: !!el.scene, azimuth: el.camera.azimuth,
    };
  });
  if (info.state !== 'loaded' || !info.hasScene) throw new Error(`unexpected state ${JSON.stringify(info)}`);
  if (info.role !== 'img' || !info.label) throw new Error('missing accessibility attributes');
});

await test('docs: renders without errors', async (page) => {
  await page.goto(`${base}/apps/docs/`);
  await page.waitForFunction(() => !document.querySelector('.preloader'), null, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, innerHeight * 3));
  await page.waitForTimeout(1000);
});

await test('studio: optimizes the sample in a worker', async (page) => {
  await page.goto(`${base}/apps/studio/`);
  await page.click('[data-sample]');
  await page.waitForSelector('[data-result]:not([hidden])', { timeout: 180000 });
  const size = await page.textContent('[data-result-size]');
  if (!/KB|MB/.test(size)) throw new Error(`no result size: ${size}`);
});

await browser.close();
server.close();
process.exitCode = failures ? 1 : 0;

#!/usr/bin/env node
/**
 * Browser smoke tests (headless Chromium via playwright-core):
 *   1. examples/basic: <web-model> loads, renders and exposes its API
 *   2. apps/docs: page runs without errors
 *   3. apps/studio: the in-browser pipeline optimizes the generated sample
 *   4. <web-model environment>: custom reflections, tone mapping, fallback
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
async function test(name, fn, { locale = 'en-US' } = {}) {
  // A fresh context per test: own browser language and empty localStorage.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale });
  const page = await context.newPage();
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
    await context.close();
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

await test('environment: custom .hdr reflections, tone mapping, safe fallback', async (page) => {
  await page.goto(`${base}/apps/docs/`);
  const info = await page.evaluate(async () => {
    const el = document.querySelector('#hero-model');
    await Promise.race([el.ready, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 30000))]);
    const custom = el.viewer.customEnv;
    const result = { attr: el.environment, custom: !!custom, inUse: el.scene.environment === custom, intensity: el.scene.environmentIntensity };
    el.setAttribute('tone-mapping', 'none');
    result.toneNone = el.renderer.toneMapping;
    el.removeAttribute('tone-mapping');
    result.toneBack = el.renderer.toneMapping;
    const failed = new Promise((resolve) => el.addEventListener('error', (e) => resolve(e.detail.code), { once: true }));
    el.environment = 'models/missing.hdr';
    result.code = await failed;
    await new Promise((r) => setTimeout(r, 50));
    result.fallback = !!el.scene.environment && el.scene.environment !== custom && el.dataset.state === 'loaded';
    return result;
  });
  if (!/\.hdr$/.test(info.attr) || !info.custom || !info.inUse || info.intensity !== 1) throw new Error(`custom environment not applied: ${JSON.stringify(info)}`);
  if (info.toneNone !== 0 || info.toneBack === 0) throw new Error(`tone-mapping attribute ignored: ${JSON.stringify(info)}`);
  if (info.code !== 'environment-failed' || !info.fallback) throw new Error(`no fallback for a broken environment: ${JSON.stringify(info)}`);
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

/* ---------------------------------------------------------------------------
   Language detection and switching (apps/shared/i18n.js)
   --------------------------------------------------------------------------- */
const langState = (page) => page.evaluate(() => ({
  lang: document.documentElement.lang,
  source: window.mesh2webI18n?.source,
  missing: window.mesh2webI18n?.missing() ?? ['i18n not loaded'],
  stored: localStorage.getItem('mesh2web-lang'),
}));
function expectLang(state, lang, source) {
  if (state.lang !== lang || (source && state.source !== source)) {
    throw new Error(`expected ${lang} from ${source}, got ${JSON.stringify(state)}`);
  }
  if (state.missing.length) throw new Error(`untranslated keys: ${state.missing.join(', ')}`);
}

await test('i18n: Chinese browser gets Traditional Chinese docs', async (page) => {
  await page.goto(`${base}/apps/docs/`);
  expectLang(await langState(page), 'zh-TW', 'browser');
  const title = await page.textContent('.hero__title');
  if (!/模型/.test(title)) throw new Error(`hero not translated: ${title}`);
}, { locale: 'zh-TW' });

await test('i18n: other browsers get English, ?lang= overrides', async (page) => {
  await page.goto(`${base}/apps/docs/`);
  expectLang(await langState(page), 'en', 'default'); // French: no match, falls back to English
  await page.goto(`${base}/apps/docs/?lang=zh-TW`);
  expectLang(await langState(page), 'zh-TW', 'url');
}, { locale: 'fr-FR' });

await test('i18n: the switch saves the choice for docs and Studio', async (page) => {
  await page.goto(`${base}/apps/docs/`);
  await page.waitForFunction(() => !document.querySelector('.preloader'), null, { timeout: 30000 });
  await Promise.all([page.waitForEvent('load'), page.click('[data-lang-switch]')]);
  const docs = await langState(page);
  expectLang(docs, 'zh-TW', 'storage');
  if (docs.stored !== 'zh-TW') throw new Error(`choice not saved: ${docs.stored}`);
  await page.goto(`${base}/apps/studio/`);
  expectLang(await langState(page), 'zh-TW', 'storage');
});

await test('i18n: Studio optimizes in Chinese', async (page) => {
  await page.goto(`${base}/apps/studio/`);
  expectLang(await langState(page), 'zh-TW', 'browser');
  await page.click('[data-sample]');
  await page.waitForSelector('[data-result]:not([hidden])', { timeout: 180000 });
  const budget = await page.textContent('[data-budget]');
  if (!/預算/.test(budget)) throw new Error(`budget not translated: ${budget}`);
}, { locale: 'zh-HK' });

await browser.close();
server.close();
process.exitCode = failures ? 1 : 0;

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Render a poster image of a GLB by loading it in headless Chromium with the
 * real `<web-model>` element, so the poster matches what visitors will see.
 * Requires the optional peer dependency `playwright-core` and a Chromium
 * (set MESH2WEB_CHROMIUM to an executable path if Playwright cannot find one).
 *
 * @param {string} glbFile
 * @param {string} outFile    `.webp` or `.png`
 * @param {{ width?: number, lighting?: string }} [opts]
 */
export async function renderPoster(glbFile, outFile, { width = 1200, lighting = 'studio-soft' } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('install `playwright-core` to render posters (npm i -D playwright-core)');
  }
  const distDir = path.dirname(require.resolve('@mesh2web/element/bundle'));
  const model = await readFile(glbFile);
  const height = Math.round(width * 0.75);
  const page = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}web-model{display:block;width:${width}px;height:${height}px}</style>
<script type="module" src="/web-model.js"></script>
<web-model src="/model.glb" lighting="${lighting}" loading="eager" quality="high" interaction-prompt="none" alt="poster"></web-model>`;

  const server = createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end(page); return; }
    if (url === '/model.glb') { res.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(model); return; }
    // The element bundle and its lazily loaded chunks.
    const file = path.join(distDir, path.normalize(url));
    if (file.startsWith(distDir) && file.endsWith('.js')) {
      try {
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(file));
        return;
      } catch { /* fall through */ }
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

  const browser = await chromium.launch({
    executablePath: process.env.MESH2WEB_CHROMIUM || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await tab.goto(`http://127.0.0.1:${port}/`);
    await tab.evaluate(async () => {
      await customElements.whenDefined('web-model');
      const el = document.querySelector('web-model');
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('model did not load within 60s')), 60000));
      await Promise.race([el.ready, timeout]);
      el.renderOnce();
    });
    const png = await tab.locator('web-model').screenshot({ omitBackground: true, type: 'png' });
    if (outFile.endsWith('.webp')) {
      try {
        const sharp = (await import('sharp')).default;
        await writeFile(outFile, await sharp(png).webp({ quality: 82 }).toBuffer());
        return outFile;
      } catch {
        outFile = outFile.replace(/\.webp$/, '.png');
      }
    }
    await writeFile(outFile, png);
    return outFile;
  } finally {
    await browser.close();
    server.close();
  }
}

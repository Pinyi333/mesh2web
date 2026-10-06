#!/usr/bin/env node
/**
 * Assemble the GitHub Pages site into ./site:
 *   /            apps/docs
 *   /studio/     apps/studio
 *   /examples/   examples (+ /packages/element/dist they reference)
 * Run `npm run build` first.
 */
import { cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const copy = (from, to) => cp(path.join(root, from), path.join(site, to), { recursive: true });

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await copy('apps/docs', '.');
await copy('apps/studio', 'studio');
await copy('examples', 'examples');
await copy('packages/element/dist', 'packages/element/dist');
console.log('Site assembled in site/');

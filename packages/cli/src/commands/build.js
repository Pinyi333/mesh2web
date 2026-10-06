import { readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { SUPPORTED_INPUTS } from '@mesh2web/core/node';
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig } from '../config.js';
import { c } from '../format.js';
import { optimizeOne } from './optimize.js';

/** @param {string} dir */
async function listModels(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_INPUTS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

/**
 * @param {import('../config.js').Mesh2WebConfig} config
 * @param {string} baseDir
 * @param {string} file  Absolute source path.
 * @param {boolean} json
 */
function buildFile(config, baseDir, file, json) {
  const inputDir = path.resolve(baseDir, config.input);
  const rel = path.relative(inputDir, path.dirname(file));
  const override = config.overrides?.[path.basename(file)] || {};
  const merged = { ...config, ...override };
  return optimizeOne(file, {
    outDir: path.join(path.resolve(baseDir, config.output), rel),
    publicPath: [merged.publicPath || '', rel].filter(Boolean).join('/'),
    json,
    poster: merged.poster ?? false,
    optimize: {
      preset: merged.preset,
      simplify: merged.simplify,
      geometry: merged.geometry,
      textures: merged.textures,
      lod: merged.lod,
      budget: merged.budget,
      fitBudget: merged.fitBudget,
    },
  });
}

/**
 * `mesh2web build [--config file] [--watch]`
 * Exits 2 when any model is over budget (useful in CI).
 */
export async function buildCommand(_args, flags) {
  const { config, dir } = await loadConfig(flags.config);
  const inputDir = path.resolve(dir, config.input);
  const files = await listModels(inputDir);
  if (!files.length) console.log(c.yellow(`No models found in ${config.input} (${SUPPORTED_INPUTS.join(', ')}).`));

  let failed = 0;
  for (const file of files) {
    try {
      const report = await buildFile(config, dir, file, flags.json);
      if (!report.budget.ok) failed++;
    } catch (err) {
      failed++;
      console.error(`  ${c.red('✗')} ${path.basename(file)}: ${err.message}`);
    }
  }
  if (!flags.watch) {
    console.log(`\n${failed ? c.red(`${failed} model(s) failed or over budget`) : c.green(`✓ ${files.length} model(s) built`)}`);
    return failed ? 2 : 0;
  }

  const { watch } = await import('chokidar');
  console.log(c.dim(`\nWatching ${config.input} …`));
  const queue = new Map();
  const rebuild = (file) => {
    if (!SUPPORTED_INPUTS.includes(path.extname(file).toLowerCase())) return;
    clearTimeout(queue.get(file));
    // Debounce: DCC tools often write a file in several chunks.
    queue.set(file, setTimeout(() => {
      buildFile(config, dir, path.resolve(file), false).catch((err) => console.error(`  ${c.red('✗')} ${err.message}`));
    }, 300));
  };
  watch(inputDir, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
    .on('add', rebuild)
    .on('change', rebuild);
  return new Promise(() => {}); // run until interrupted
}

/** `mesh2web init` — write a starter config. */
export async function initCommand() {
  const file = path.resolve(CONFIG_FILE);
  try {
    await access(file);
    console.log(c.yellow(`${CONFIG_FILE} already exists.`));
    return 1;
  } catch { /* create it */ }
  await writeFile(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  console.log(`${c.green('✓')} Created ${CONFIG_FILE}`);
  return 0;
}

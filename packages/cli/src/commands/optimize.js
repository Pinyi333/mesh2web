import { stat } from 'node:fs/promises';
import path from 'node:path';
import { optimizeFile } from '@mesh2web/core/node';
import { c, printReport } from '../format.js';
import { renderPoster } from '../poster.js';

/**
 * Optimize a single file and print the result. Shared by `optimize` and `build`.
 * @param {string} input
 * @param {Object} opts
 * @param {string} [opts.outDir]
 * @param {string} [opts.publicPath]
 * @param {import('@mesh2web/core').OptimizeOptions} [opts.optimize]
 * @param {{ width?: number, format?: 'webp' | 'png' } | false} [opts.poster]
 * @param {boolean} [opts.json]
 * @returns {Promise<import('@mesh2web/core').Report>}
 */
export async function optimizeOne(input, opts) {
  const name = path.basename(input, path.extname(input));
  const started = Date.now();
  if (!opts.json) process.stdout.write(`\n${c.bold(path.basename(input))} ${c.dim('…')} `);
  const steps = [];
  const result = await optimizeFile(input, {
    outDir: opts.outDir ?? path.dirname(input),
    publicPath: opts.publicPath,
    optimize: opts.optimize,
    onStep: (s) => steps.push(s),
    onWarn: (msg) => { if (!opts.json) console.warn(`\n  ${c.yellow('!')} ${msg}`); },
  });
  if (!opts.json) console.log(c.dim(`${steps.join(' → ')} · ${((Date.now() - started) / 1000).toFixed(1)}s`));

  if (opts.poster) {
    const posterFile = path.join(result.outDir, `${name}.${opts.poster.format || 'webp'}`);
    try {
      const written = await renderPoster(result.files[0], posterFile, opts.poster);
      result.report.outputs.push({ file: path.basename(written), bytes: (await stat(written)).size, triangles: 0 });
    } catch (err) {
      if (!opts.json) console.warn(`  ${c.yellow('!')} Poster skipped: ${err.message}`);
    }
  }

  if (!opts.json) printReport(result.report);
  return result.report;
}

/**
 * `mesh2web optimize <files…> [--preset hero] [--out dir]`
 * @param {string[]} files
 * @param {Record<string, any>} flags
 */
export async function optimizeCommand(files, flags) {
  if (!files.length) throw new Error('Usage: mesh2web optimize <model.glb> [--preset hero|product|ambient]');
  const reports = [];
  for (const file of files) {
    reports.push(await optimizeOne(file, {
      outDir: flags.out,
      publicPath: flags['public-path'] || '',
      json: flags.json,
      poster: flags.poster ? { width: Number(flags['poster-width']) || 1200, format: 'webp' } : false,
      optimize: buildOptimizeOptions(flags),
    }));
  }
  if (flags.json) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  return reports.every((r) => r.budget.ok) ? 0 : 2;
}

/** Translate CLI flags into pipeline options. */
export function buildOptimizeOptions(flags) {
  /** @type {import('@mesh2web/core').OptimizeOptions} */
  const o = { preset: flags.preset };
  if (flags.geometry) o.geometry = flags.geometry;
  if (flags['no-simplify']) o.simplify = false;
  else if (flags.ratio) o.simplify = { ratio: Number(flags.ratio) };
  if (flags['texture-size'] || flags['texture-format']) {
    o.textures = {};
    if (flags['texture-size']) o.textures.maxSize = Number(flags['texture-size']);
    if (flags['texture-format']) o.textures.format = flags['texture-format'];
  }
  if (flags['no-lod']) o.lod = [1];
  const budget = {};
  if (flags['max-size']) budget.maxSizeKB = Number(flags['max-size']);
  if (flags['max-triangles']) budget.maxTriangles = Number(flags['max-triangles']);
  if (Object.keys(budget).length) o.budget = budget;
  if (flags['no-fit']) o.fitBudget = false;
  return o;
}

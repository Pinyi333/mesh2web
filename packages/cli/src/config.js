import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const CONFIG_FILE = 'mesh2web.config.json';

/**
 * @typedef {Object} Mesh2WebConfig
 * @property {string} input        Directory with source models.
 * @property {string} output       Directory for optimized output.
 * @property {string} [preset]
 * @property {string} [publicPath] URL prefix used in embed snippets.
 * @property {{ maxSizeKB?: number, maxTriangles?: number }} [budget]
 * @property {{ format?: string, maxSize?: number, quality?: number } | false} [textures]
 * @property {{ ratio?: number, error?: number } | false} [simplify]
 * @property {'meshopt' | 'draco' | 'none'} [geometry]
 * @property {number[]} [lod]
 * @property {{ width?: number, format?: 'webp' | 'png' } | false} [poster]
 * @property {Record<string, Partial<Mesh2WebConfig>>} [overrides]  Per-file overrides keyed by file name.
 */

/**
 * Load and validate `mesh2web.config.json`.
 * @param {string} [file]
 * @returns {Promise<{ config: Mesh2WebConfig, dir: string }>}
 */
export async function loadConfig(file = CONFIG_FILE) {
  const abs = path.resolve(file);
  let text;
  try {
    text = await readFile(abs, 'utf8');
  } catch {
    throw new Error(`No ${path.basename(abs)} found in ${path.dirname(abs)}. Create one or run \`mesh2web init\`.`);
  }
  /** @type {Mesh2WebConfig} */
  let config;
  try {
    config = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path.basename(abs)} is not valid JSON: ${err.message}`);
  }
  for (const key of ['input', 'output']) {
    if (typeof config[key] !== 'string') throw new Error(`${path.basename(abs)}: "${key}" must be a directory path.`);
  }
  return { config, dir: path.dirname(abs) };
}

export const DEFAULT_CONFIG = {
  input: 'assets/3d/src',
  output: 'public/3d',
  preset: 'product',
  publicPath: '/3d',
  budget: { maxSizeKB: 1500, maxTriangles: 80000 },
  textures: { format: 'webp', maxSize: 2048 },
  lod: [1, 0.5, 0.2],
  poster: { width: 1200, format: 'webp' },
};

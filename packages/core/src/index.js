/**
 * @mesh2web/core — environment-agnostic entry. Works in Node and browsers.
 * For file-system helpers (read/write/optimize files) import `@mesh2web/core/node`.
 */
export { inspectDocument } from './inspect.js';
export { optimizeDocument, optimizeWithLods, createLods, resolveOptions, addSmoothNormals } from './pipeline.js';
export {
  createReport, renderHtmlReport, checkBudget, estimateLoadTime,
  formatBytes, formatMs, NETWORK_PROFILES,
} from './report.js';
export { objToDocument } from './obj.js';
export { createEmbedSnippet } from './embed.js';
export { optimizePresets, lightingPresets } from '@mesh2web/presets';

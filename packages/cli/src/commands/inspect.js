import path from 'node:path';
import { inspectFile } from '@mesh2web/core/node';
import { c, formatBytes, printIssues, printStats } from '../format.js';

/**
 * `mesh2web inspect <file>` — health check without writing anything.
 * @param {string[]} files
 * @param {{ json?: boolean }} flags
 */
export async function inspectCommand(files, flags) {
  if (!files.length) throw new Error('Usage: mesh2web inspect <model.glb>');
  const results = [];
  for (const file of files) {
    const result = await inspectFile(file);
    results.push(result);
    if (flags.json) continue;
    console.log(`\n${c.bold(path.basename(file))} ${c.dim(formatBytes(result.bytes))}`);
    printStats(result.stats);
    printIssues(result.stats.issues);
  }
  if (flags.json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  return results.some((r) => r.stats.issues.some((i) => i.level === 'error')) ? 1 : 0;
}

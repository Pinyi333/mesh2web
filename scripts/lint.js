#!/usr/bin/env node
/** Syntax-check every first-party JS file (no dependencies, no config). */
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = /(^|\/)(node_modules|vendor|dist|site|\.scratch|\.git)(\/|$)/;
const files = (await readdir(root, { recursive: true }))
  .filter((f) => f.endsWith('.js') && !skip.test(f));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${file}\n${err.stderr}`);
  }
}
console.log(`${failed ? '✗' : '✓'} ${files.length - failed}/${files.length} files OK`);
process.exitCode = failed ? 1 : 0;

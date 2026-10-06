#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { optimizePresets } from '@mesh2web/presets';
import { c } from './format.js';
import { inspectCommand } from './commands/inspect.js';
import { optimizeCommand } from './commands/optimize.js';
import { buildCommand, initCommand } from './commands/build.js';

const { version } = createRequire(import.meta.url)('../package.json');

const HELP = `
${c.bold('mesh2web')} ${c.dim(`v${version}`)} — turn any 3D model into a lightweight web component

${c.bold('Usage')}
  mesh2web inspect  <model>            Health check: counts, textures, issues
  mesh2web optimize <model…> [flags]   Optimize to GLB + LODs + report + embed snippet
  mesh2web build    [--watch]          Batch-process using mesh2web.config.json
  mesh2web init                        Create a starter mesh2web.config.json
  mesh2web presets                     List optimization presets

${c.bold('Optimize flags')}
  -p, --preset <name>       hero | product | ambient          ${c.dim('(default: product)')}
  -o, --out <dir>           Output directory                  ${c.dim('(default: next to input)')}
      --geometry <m>        meshopt | draco | none
      --ratio <0-1>         Target triangle ratio for simplification
      --no-simplify         Skip simplification
      --texture-size <px>   Max texture size
      --texture-format <f>  webp | jpeg | png | keep
      --no-lod              Do not generate LOD files
      --max-size <KB>       Size budget (exit code 2 when exceeded)
      --max-triangles <n>   Triangle budget
      --no-fit              Do not auto-simplify to meet the triangle budget
      --poster              Render <name>.webp with headless Chromium (needs playwright-core)
      --public-path <url>   URL prefix used in the generated embed snippet
      --json                Machine-readable output

${c.bold('Examples')}
  npx @mesh2web/cli optimize robot.glb --preset hero
  npx @mesh2web/cli inspect robot.glb
  npx @mesh2web/cli build --watch
`;

const options = {
  preset: { type: 'string', short: 'p' },
  out: { type: 'string', short: 'o' },
  config: { type: 'string', short: 'c' },
  geometry: { type: 'string' },
  ratio: { type: 'string' },
  'no-simplify': { type: 'boolean' },
  'texture-size': { type: 'string' },
  'texture-format': { type: 'string' },
  'no-lod': { type: 'boolean' },
  'max-size': { type: 'string' },
  'max-triangles': { type: 'string' },
  'no-fit': { type: 'boolean' },
  poster: { type: 'boolean' },
  'poster-width': { type: 'string' },
  'public-path': { type: 'string' },
  watch: { type: 'boolean', short: 'w' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

async function main() {
  const { values: flags, positionals } = parseArgs({ options, allowPositionals: true, strict: true });
  const [command, ...args] = positionals;
  if (flags.version) { console.log(version); return 0; }
  if (flags.help || !command) { console.log(HELP); return 0; }

  switch (command) {
    case 'inspect': return inspectCommand(args, flags);
    case 'optimize': return optimizeCommand(args, flags);
    case 'build': return buildCommand(args, flags);
    case 'init': return initCommand();
    case 'presets':
      for (const [name, p] of Object.entries(optimizePresets)) {
        console.log(`\n  ${c.bold(name.padEnd(9))}${p.description}`);
        console.log(`  ${' '.repeat(9)}${c.dim(`budget ${p.budget.maxSizeKB}KB / ${p.budget.maxTriangles.toLocaleString('en-US')} tris · textures ≤${p.textures.maxSize}px ${p.textures.format} · LOD ${p.lod.join(', ')}`)}`);
      }
      console.log('');
      return 0;
    default:
      throw new Error(`Unknown command "${command}". Run mesh2web --help.`);
  }
}

main().then(
  (code) => { process.exitCode = code ?? 0; },
  (err) => {
    console.error(`${c.red('error')} ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exitCode = 1;
  },
);

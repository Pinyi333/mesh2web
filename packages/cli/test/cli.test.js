import { describe, expect, it, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/bin.js');

/** Run the CLI and resolve with { code, stdout, stderr } instead of throwing. */
async function cli(args, cwd) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

/** A UV sphere as OBJ text, dense enough to simplify. */
function sphereObj(seg = 64) {
  const lines = ['o Sphere'];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2, p = (j / seg) * Math.PI;
      lines.push(`v ${Math.sin(p) * Math.cos(t)} ${Math.cos(p)} ${Math.sin(p) * Math.sin(t)}`);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i + 1, b = a + seg + 1;
      lines.push(`f ${a} ${b} ${a + 1}`, `f ${b} ${b + 1} ${a + 1}`);
    }
  }
  return lines.join('\n');
}

let dir;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mesh2web-cli-'));
  await writeFile(path.join(dir, 'sphere.obj'), sphereObj());
});

describe('mesh2web CLI', () => {
  it('prints help', async () => {
    const { code, stdout } = await cli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('mesh2web optimize');
  });

  it('inspects a model as JSON', async () => {
    const { code, stdout } = await cli(['inspect', path.join(dir, 'sphere.obj'), '--json']);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.stats.triangles).toBe(64 * 64 * 2);
    expect(result.stats.issues.map((i) => i.code)).toContain('missing-normals');
  });

  it('optimizes and writes GLB, LODs, reports and embed snippet', async () => {
    const out = path.join(dir, 'out');
    const { code, stdout } = await cli(['optimize', path.join(dir, 'sphere.obj'), '--preset', 'product', '-o', out]);
    expect(code).toBe(0);
    expect(stdout).toContain('Within budget');
    const files = await readdir(out);
    expect(files).toEqual(expect.arrayContaining([
      'sphere.glb', 'sphere.lod1.glb', 'sphere.lod2.glb', 'sphere.report.json', 'sphere.report.html', 'sphere.embed.html',
    ]));
    const report = JSON.parse(await readFile(path.join(out, 'sphere.report.json'), 'utf8'));
    expect(report.after.stats.triangles).toBeLessThan(report.before.stats.triangles);
  });

  it('exits with code 2 when over budget', async () => {
    const { code, stdout } = await cli(['optimize', path.join(dir, 'sphere.obj'), '-o', path.join(dir, 'b'), '--max-triangles', '10', '--no-fit', '--no-lod']);
    expect(code).toBe(2);
    expect(stdout).toContain('Over budget');
  });

  it('builds from mesh2web.config.json', async () => {
    const project = path.join(dir, 'project');
    await mkdir(path.join(project, 'src/models'), { recursive: true });
    await writeFile(path.join(project, 'src/models/ball.obj'), sphereObj(24));
    await writeFile(path.join(project, 'mesh2web.config.json'), JSON.stringify({ input: 'src/models', output: 'public/3d', preset: 'ambient', publicPath: '/3d' }));
    const { code, stdout } = await cli(['build'], project);
    expect(code).toBe(0);
    expect(stdout).toContain('1 model(s) built');
    const embed = await readFile(path.join(project, 'public/3d/ball.embed.html'), 'utf8');
    expect(embed).toContain('src="/3d/ball.glb"');
  });

  it('fails clearly on unsupported input', async () => {
    await writeFile(path.join(dir, 'x.fbx'), 'nope');
    const { code, stderr } = await cli(['inspect', path.join(dir, 'x.fbx')]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/FBX/);
  });
});

import { formatBytes, formatMs } from '@mesh2web/core';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  lime: wrap('38;5;190', 39),
};

export { formatBytes, formatMs };

const num = (n) => n.toLocaleString('en-US');
const pct = (n) => `${Math.round(n * 100)}%`;

/** @param {import('@mesh2web/core').InspectResult} stats */
export function printStats(stats) {
  const rows = [
    ['Triangles', num(stats.triangles)],
    ['Vertices', num(stats.vertices)],
    ['Draw calls', num(stats.drawCalls)],
    ['Meshes / nodes', `${stats.meshes} / ${stats.nodes}`],
    ['Materials', num(stats.materials)],
    ['Textures', `${stats.textures.length} (${formatBytes(stats.textureBytes)})`],
    ['Animations', num(stats.animations)],
    ['Bounds (m)', stats.bounds.size.map((v) => v.toFixed(2)).join(' × ')],
  ];
  for (const [k, v] of rows) console.log(`  ${c.dim(k.padEnd(16))}${v}`);
  for (const t of stats.textures) {
    console.log(`  ${c.dim('  └')} ${t.name} ${c.dim(`${t.width}×${t.height} ${t.mimeType} ${formatBytes(t.bytes)}`)}`);
  }
}

/** @param {import('@mesh2web/core').InspectResult['issues']} issues */
export function printIssues(issues) {
  if (!issues.length) {
    console.log(`\n  ${c.green('✓')} No issues found`);
    return;
  }
  console.log('');
  for (const issue of issues) {
    const mark = issue.level === 'info' ? c.cyan('i') : issue.level === 'warning' ? c.yellow('!') : c.red('✗');
    console.log(`  ${mark} ${issue.message}`);
    if (issue.fix) console.log(`    ${c.dim(issue.fix)}`);
  }
}

/** @param {import('@mesh2web/core').Report} report */
export function printReport(report) {
  const { before, after, reduction } = report;
  console.log(`  ${c.dim('Size'.padEnd(12))}${formatBytes(before.bytes)} → ${c.bold(c.lime(formatBytes(after.bytes)))}  ${c.dim(`-${pct(reduction.bytes)}`)}`);
  console.log(`  ${c.dim('Triangles'.padEnd(12))}${num(before.stats.triangles)} → ${c.bold(num(after.stats.triangles))}  ${c.dim(`-${pct(reduction.triangles)}`)}`);
  console.log(`  ${c.dim('Draw calls'.padEnd(12))}${before.stats.drawCalls} → ${c.bold(after.stats.drawCalls)}`);
  console.log(`  ${c.dim('Load time'.padEnd(12))}${formatMs(report.loadTimeMs['slow-4g'])} slow 4G · ${formatMs(report.loadTimeMs['fast-4g'])} fast 4G`);
  for (const o of report.outputs) console.log(`  ${c.dim('→')} ${o.file} ${c.dim(`${formatBytes(o.bytes)} · ${num(o.triangles)} tris`)}`);
  if (!report.budget.ok) {
    for (const v of report.budget.violations) {
      const fmt = v.metric === 'size' ? formatBytes : num;
      console.log(`  ${c.red('✗ Over budget:')} ${v.metric} ${fmt(v.actual)} > ${fmt(v.limit)}`);
    }
  } else {
    console.log(`  ${c.green('✓')} Within budget`);
  }
}

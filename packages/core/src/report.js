/**
 * @typedef {import('./inspect.js').InspectResult} InspectResult
 *
 * @typedef {Object} Snapshot
 * @property {number} bytes
 * @property {InspectResult} stats
 *
 * @typedef {Object} BudgetResult
 * @property {boolean} ok
 * @property {{ metric: string, limit: number, actual: number }[]} violations
 *
 * @typedef {Object} Report
 * @property {string} name
 * @property {string} preset
 * @property {Snapshot} before
 * @property {Snapshot} after
 * @property {{ bytes: number, triangles: number, drawCalls: number }} reduction  Fractions 0–1.
 * @property {Record<string, number>} loadTimeMs  Estimated download time per network profile.
 * @property {BudgetResult} budget
 * @property {{ file: string, bytes: number, triangles: number }[]} outputs
 * @property {string} createdAt
 */

/**
 * Network profiles used for load-time estimates. Throughput in bytes/sec,
 * latency in ms. Values mirror Chrome DevTools / Lighthouse throttling.
 */
export const NETWORK_PROFILES = {
  'slow-4g': { label: 'Slow 4G', throughput: (1.6 * 1024 * 1024) / 8, latency: 150 },
  'fast-4g': { label: 'Fast 4G', throughput: (9 * 1024 * 1024) / 8, latency: 60 },
  wifi: { label: 'Wi-Fi', throughput: (30 * 1024 * 1024) / 8, latency: 20 },
};

/** @param {number} bytes */
export function estimateLoadTime(bytes) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, p] of Object.entries(NETWORK_PROFILES)) {
    out[key] = Math.round(p.latency + (bytes / p.throughput) * 1000);
  }
  return out;
}

/**
 * @param {{ bytes: number, triangles: number }} result
 * @param {{ maxSizeKB?: number, maxTriangles?: number }} [budget]
 * @returns {BudgetResult}
 */
export function checkBudget(result, budget = {}) {
  const violations = [];
  if (budget.maxSizeKB != null && result.bytes > budget.maxSizeKB * 1024) {
    violations.push({ metric: 'size', limit: budget.maxSizeKB * 1024, actual: result.bytes });
  }
  if (budget.maxTriangles != null && result.triangles > budget.maxTriangles) {
    violations.push({ metric: 'triangles', limit: budget.maxTriangles, actual: result.triangles });
  }
  return { ok: violations.length === 0, violations };
}

const ratio = (a, b) => (a > 0 ? Math.max(0, 1 - b / a) : 0);

/**
 * @param {Object} input
 * @param {string} input.name
 * @param {string} input.preset
 * @param {Snapshot} input.before
 * @param {Snapshot} input.after
 * @param {{ maxSizeKB?: number, maxTriangles?: number }} [input.budget]
 * @param {Report['outputs']} [input.outputs]
 * @returns {Report}
 */
export function createReport({ name, preset, before, after, budget, outputs = [] }) {
  return {
    name,
    preset,
    before,
    after,
    reduction: {
      bytes: ratio(before.bytes, after.bytes),
      triangles: ratio(before.stats.triangles, after.stats.triangles),
      drawCalls: ratio(before.stats.drawCalls, after.stats.drawCalls),
    },
    loadTimeMs: estimateLoadTime(after.bytes),
    budget: checkBudget({ bytes: after.bytes, triangles: after.stats.triangles }, budget),
    outputs,
    createdAt: new Date().toISOString(),
  };
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** @param {number} ms */
export function formatMs(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => `${Math.round(n * 100)}%`;
const num = (n) => n.toLocaleString('en-US');

/**
 * Render a self-contained HTML report (no external requests).
 * @param {Report} report
 */
export function renderHtmlReport(report) {
  const { before, after } = report;
  const rows = [
    ['File size', formatBytes(before.bytes), formatBytes(after.bytes), report.reduction.bytes],
    ['Triangles', num(before.stats.triangles), num(after.stats.triangles), report.reduction.triangles],
    ['Draw calls', num(before.stats.drawCalls), num(after.stats.drawCalls), report.reduction.drawCalls],
    ['Materials', num(before.stats.materials), num(after.stats.materials), null],
    ['Textures', formatBytes(before.stats.textureBytes), formatBytes(after.stats.textureBytes), ratio(before.stats.textureBytes, after.stats.textureBytes)],
  ];
  const issues = before.stats.issues.map((i) => `
      <li class="issue issue--${i.level}"><span class="issue__level">${i.level}</span>
        <div><p>${escapeHtml(i.message)}</p>${i.fix ? `<p class="issue__fix">${escapeHtml(i.fix)}</p>` : ''}</div></li>`).join('');
  const budget = report.budget.ok
    ? '<p class="budget budget--ok">Within budget</p>'
    : `<p class="budget budget--fail">Over budget: ${report.budget.violations.map((v) => `${v.metric} ${v.metric === 'size' ? formatBytes(v.actual) : num(v.actual)} &gt; ${v.metric === 'size' ? formatBytes(v.limit) : num(v.limit)}`).join(', ')}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mesh2web report · ${escapeHtml(report.name)}</title>
<style>
  :root { --bg:#0d0d0f; --fg:#f2efe9; --muted:#8d8a85; --line:#26262a; --accent:#d4ff3a; --bad:#ff5a4e; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f2ee; --fg:#141414; --muted:#6c6a66; --line:#dcd9d3; --accent:#3d5a00; --bad:#c22b1f; } }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:clamp(16px,5vw,64px); }
  .wrap { max-width:960px; margin:0 auto; }
  .eyebrow { font:12px/1 ui-monospace, Menlo, monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  h1 { font-size:clamp(32px,6vw,64px); line-height:1; letter-spacing:-.03em; margin:12px 0 32px; font-weight:600; word-break:break-word; }
  .hero { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:48px; }
  .hero div { background:var(--bg); padding:24px; }
  .hero strong { display:block; font-size:clamp(28px,4vw,44px); letter-spacing:-.02em; font-weight:600; }
  .hero .accent { color:var(--accent); }
  table { width:100%; border-collapse:collapse; margin-bottom:48px; }
  th, td { text-align:left; padding:14px 8px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th { font-weight:500; color:var(--muted); font-size:13px; }
  td:last-child, th:last-child { text-align:right; color:var(--accent); }
  h2 { font-size:20px; margin-bottom:16px; font-weight:600; }
  .issues { list-style:none; padding:0; display:grid; gap:12px; margin-bottom:48px; }
  .issue { display:grid; grid-template-columns:72px 1fr; gap:12px; padding:16px; border:1px solid var(--line); }
  .issue__level { font:11px/1.8 ui-monospace, Menlo, monospace; text-transform:uppercase; color:var(--muted); }
  .issue--warning .issue__level, .issue--error .issue__level { color:var(--bad); }
  .issue__fix { color:var(--muted); margin-top:4px; }
  .budget { padding:12px 16px; border:1px solid currentColor; display:inline-block; margin-bottom:48px; }
  .budget--ok { color:var(--accent); } .budget--fail { color:var(--bad); }
  footer { color:var(--muted); font-size:13px; }
  @media (max-width:560px) { .issue { grid-template-columns:1fr; } th, td { padding:12px 4px; font-size:14px; } }
</style>
</head>
<body>
<main class="wrap">
  <p class="eyebrow">mesh2web report · preset ${escapeHtml(report.preset)}</p>
  <h1>${escapeHtml(report.name)}</h1>
  <section class="hero">
    <div><span class="eyebrow">Size</span><strong>${formatBytes(before.bytes)} → <span class="accent">${formatBytes(after.bytes)}</span></strong></div>
    <div><span class="eyebrow">Smaller by</span><strong class="accent">${pct(report.reduction.bytes)}</strong></div>
    <div><span class="eyebrow">Slow 4G</span><strong>${formatMs(report.loadTimeMs['slow-4g'])}</strong></div>
    <div><span class="eyebrow">Fast 4G</span><strong>${formatMs(report.loadTimeMs['fast-4g'])}</strong></div>
  </section>
  ${budget}
  <table>
    <thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Saved</th></tr></thead>
    <tbody>${rows.map(([label, a, b, r]) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td><td>${r == null ? '' : pct(r)}</td></tr>`).join('')}</tbody>
  </table>
  ${report.outputs.length ? `<h2>Outputs</h2><table><tbody>${report.outputs.map((o) => `<tr><td>${escapeHtml(o.file)}</td><td>${num(o.triangles)} tris</td><td>${formatBytes(o.bytes)}</td></tr>`).join('')}</tbody></table>` : ''}
  <h2>Health check (source)</h2>
  ${issues ? `<ul class="issues">${issues}</ul>` : '<p style="margin-bottom:48px">No issues found.</p>'}
  <footer>Generated ${escapeHtml(report.createdAt)} by mesh2web</footer>
</main>
</body>
</html>
`;
}

/**
 * mesh2web Studio — UI controller.
 * Heavy lifting (parse, optimize, write GLB) happens in ./worker.js.
 */
import { createZip } from './zip.js';

const CONFIG = {
  maxBytes: 200 * 1024 * 1024,
  steps: ['clean', 'simplify', 'textures', 'lod', 'compress'],
};

// Strings live in ./lang.js (English and Traditional Chinese), see apps/shared/i18n.js.
const t = window.mesh2webI18n?.t ?? ((key) => key);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const ui = {
  body: document.body,
  drop: $('[data-drop]'), file: $('#file'), sample: $('[data-sample]'), replace: $('[data-replace]'),
  compare: $('[data-compare]'), before: $('[data-before]'), after: $('[data-after]'), handle: $('[data-handle]'),
  labelBefore: $('[data-label-before]'), labelAfter: $('[data-label-after]'),
  progress: $('[data-progress]'), progressStep: $('[data-progress-step]'),
  fileBlock: $('[data-file-block]'), fileName: $('[data-file-name]'), sourceStats: $('[data-source-stats]'),
  issues: $('[data-issues]'), issuesCount: $('[data-issues-count]'), issuesWrap: $('[data-issues-wrap]'),
  presets: $$('[data-preset]'), presetDesc: $('[data-preset-desc]'),
  ratio: $('[data-ratio]'), ratioOut: $('[data-ratio-out]'), maxTris: $('[data-max-tris]'),
  textureSize: $('[data-texture-size]'), textureFormat: $('[data-texture-format]'), ar: $('[data-ar]'), geometry: $('[data-geometry]'), lod: $('[data-lod]'), fit: $('[data-fit]'),
  run: $('[data-run]'), lighting: $('[data-lighting]'), alt: $('[data-alt]'),
  result: $('[data-result]'), resultSize: $('[data-result-size]'), resultSaved: $('[data-result-saved]'),
  resultStats: $('[data-result-stats]'), budget: $('[data-budget]'),
  exportBtn: $('[data-export]'), copyEmbed: $('[data-copy-embed]'), embed: $('[data-embed]'),
  toast: $('[data-toast]'),
};

const state = {
  preset: 'product',
  presets: {},
  source: null,     // { name, bytes, stats }
  output: null,     // { report, glb, lods, embed, reportHtml }
  urls: [],         // object URLs to revoke
  running: false,
  pendingRun: false,
};

/* ---------------------------------------------------------------------------
   Worker RPC
   --------------------------------------------------------------------------- */
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const job = pending.get(data.id);
  if (!job) return;
  if (data.type === 'step') { job.onStep?.(data.step); return; }
  pending.delete(data.id);
  if (data.type === 'error') job.reject(new Error(data.message));
  else job.resolve(data);
};
worker.onerror = (e) => toast(t('toast.worker', { message: e.message || t('toast.workerStart') }));

function call(message, transfer = [], onStep) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onStep });
    worker.postMessage({ id, ...message }, transfer);
  });
}

/* ---------------------------------------------------------------------------
   Formatting
   --------------------------------------------------------------------------- */
const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const fmtNum = (n) => n.toLocaleString('en-US');
const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderStats(el, rows) {
  el.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

let toastTimer;
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), 3200);
}

function objectUrl(bytes, type = 'model/gltf-binary') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  state.urls.push(url);
  return url;
}

/* ---------------------------------------------------------------------------
   Loading
   --------------------------------------------------------------------------- */
async function loadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > CONFIG.maxBytes) {
    toast(t('toast.tooLarge', { size: fmtBytes(total), max: fmtBytes(CONFIG.maxBytes) }));
    return;
  }
  setBusy(files.length > 1 ? t('step.readingFiles', { count: files.length }) : t('step.reading', { name: files[0].name }));
  try {
    const payload = await Promise.all(files.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })));
    const result = await call({ type: 'load', files: payload }, payload.map((p) => p.buffer));
    onLoaded(result);
  } catch (err) {
    failed(err);
  }
}

async function loadSample() {
  setBusy(t('step.sample'));
  try {
    onLoaded(await call({ type: 'sample' }));
  } catch (err) {
    failed(err);
  }
}

function setBusy(label) {
  ui.body.dataset.state = 'busy';
  ui.compare.hidden = false;
  ui.progress.hidden = false;
  ui.progressStep.textContent = label;
  $$('[data-dot]').forEach((d) => d.classList.remove('is-done', 'is-active'));
}

function failed(err) {
  ui.body.dataset.state = state.source ? 'ready' : 'empty';
  ui.progress.hidden = true;
  if (!state.source) ui.compare.hidden = true;
  toast(err.message);
  console.error(err);
}

function onLoaded({ name, bytes, stats, previewGlb }) {
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
  state.source = { name, bytes, stats };
  state.output = null;

  ui.fileBlock.hidden = false;
  ui.fileName.textContent = name;
  renderStats(ui.sourceStats, [
    [t('stat.size'), fmtBytes(bytes)],
    [t('stat.triangles'), fmtNum(stats.triangles)],
    [t('stat.drawCalls'), fmtNum(stats.drawCalls)],
    [t('stat.textures'), `${stats.textures.length} · ${fmtBytes(stats.textureBytes)}`],
  ]);
  ui.issuesCount.textContent = stats.issues.length;
  // Issue messages come from @mesh2web/core and stay in English (shared with the CLI).
  ui.issues.innerHTML = stats.issues.map((i) => `
    <li class="issue issue--${i.level}" lang="en">
      <p>${escapeHtml(i.message)}</p>${i.fix ? `<p class="issue__fix">${escapeHtml(i.fix)}</p>` : ''}
    </li>`).join('') || `<li class="issue"><p>${escapeHtml(t('issues.none'))}</p></li>`;
  ui.issuesWrap.open = stats.issues.some((i) => i.level !== 'info');
  if (!ui.alt.value) ui.alt.placeholder = t('panel.altExample', { name: name.replace(/[-_]/g, ' ') });

  ui.labelBefore.textContent = fmtBytes(bytes);
  ui.before.src = objectUrl(previewGlb);
  ui.before.camera.distance = 3.7;
  ui.run.disabled = false;
  ui.result.hidden = true;
  ui.body.dataset.state = 'ready';
  runOptimize();
}

/* ---------------------------------------------------------------------------
   Optimize
   --------------------------------------------------------------------------- */
function collectOptions() {
  const preset = state.presets[state.preset] || {};
  const options = {
    preset: state.preset,
    simplify: Number(ui.ratio.value) >= 100 ? false : { ratio: Number(ui.ratio.value) / 100 },
    geometry: ui.geometry.value,
    textures: ui.textureSize.value === 'keep' && ui.textureFormat.value !== 'ktx2'
      ? { format: 'keep' }
      : { format: ui.textureFormat.value, ...(ui.textureSize.value === 'keep' ? {} : { maxSize: Number(ui.textureSize.value) }) },
    lod: ui.lod.checked ? preset.lod : [1],
    fitBudget: ui.fit.checked,
  };
  const maxTris = Number(ui.maxTris.value);
  if (maxTris > 0) options.budget = { maxTriangles: maxTris };
  return options;
}

async function runOptimize() {
  if (!state.source) return;
  if (state.running) { state.pendingRun = true; return; }
  state.running = true;
  setBusy(t('step.clean'));
  ui.labelAfter.textContent = t('step.optimizing');
  ui.run.disabled = true;
  const started = performance.now();

  const stepLabels = ['clean', 'normals', 'simplify', 'fit-budget', 'textures', 'lod', 'compress', 'ar'];
  const onStep = (step) => {
    const name = step.split(':')[0];
    const key = name === 'fit-budget' ? 'simplify' : name;
    const index = CONFIG.steps.indexOf(key === 'normals' ? 'clean' : key);
    ui.progressStep.textContent = stepLabels.includes(name) ? t(`step.${name}`) : step;
    $$('[data-dot]').forEach((dot, i) => {
      dot.classList.toggle('is-done', i < index);
      dot.classList.toggle('is-active', i === index);
    });
  };

  try {
    const output = await call({ type: 'optimize', options: collectOptions(), meta: { alt: ui.alt.value, lighting: ui.lighting.value, ar: ui.ar.checked } }, [], onStep);
    state.output = output;
    const loaded = new Promise((resolve) => {
      ui.after.addEventListener('load', resolve, { once: true });
      ui.after.addEventListener('error', resolve, { once: true });
    });
    ui.after.src = objectUrl(output.glb);
    await loaded;
    showResult(output.report, performance.now() - started);
  } catch (err) {
    failed(err);
  } finally {
    state.running = false;
    ui.run.disabled = false;
    ui.progress.hidden = true;
    ui.body.dataset.state = 'ready';
    if (state.pendingRun) { state.pendingRun = false; runOptimize(); }
  }
}

function showResult(report, elapsed) {
  const { before, after } = report;
  ui.result.hidden = false;
  ui.labelAfter.textContent = fmtBytes(after.bytes);
  ui.resultSize.textContent = fmtBytes(after.bytes);
  ui.resultSaved.textContent = t('result.saved', { percent: Math.round(report.reduction.bytes * 100), seconds: (elapsed / 1000).toFixed(1) });
  renderStats(ui.resultStats, [
    [t('stat.triangles'), `${fmtNum(before.stats.triangles)} → ${fmtNum(after.stats.triangles)}`],
    [t('stat.drawCalls'), `${before.stats.drawCalls} → ${after.stats.drawCalls}`],
    [t('stat.textures'), `${fmtBytes(before.stats.textureBytes)} → ${fmtBytes(after.stats.textureBytes)}`],
    ...(before.stats.textures.length ? [[t('stat.gpu'), `${fmtBytes(before.stats.textureGpuBytes)} → ${fmtBytes(after.stats.textureGpuBytes)}`]] : []),
    [t('stat.slow4g'), fmtMs(report.loadTimeMs['slow-4g'])],
    [t('stat.files'), report.outputs.map((o) => o.file.replace(`${report.name}.`, '')).join(' · ')],
  ]);
  ui.budget.className = `budget ${report.budget.ok ? 'is-ok' : 'is-over'}`;
  ui.budget.textContent = report.budget.ok
    ? t('result.withinBudget')
    : t('result.overBudget', {
      list: report.budget.violations.map((v) => {
        if (v.metric === 'size') return `${fmtBytes(v.actual)} > ${fmtBytes(v.limit)}`;
        if (v.metric === 'texture-memory') return t('result.gpuOver', { actual: fmtBytes(v.actual), limit: fmtBytes(v.limit) });
        return t('result.trisOver', { actual: fmtNum(v.actual), limit: fmtNum(v.limit) });
      }).join(', '),
    });
  ui.embed.textContent = embedWithCurrentMeta();
}

function embedWithCurrentMeta() {
  if (!state.output) return '';
  const alt = (ui.alt.value || state.source.name).replace(/"/g, '&quot;');
  return state.output.embed
    .replace(/alt="[^"]*"/, `alt="${alt}"`)
    .replace(/lighting="[^"]*"/, `lighting="${ui.lighting.value}"`);
}

/* ---------------------------------------------------------------------------
   Export
   --------------------------------------------------------------------------- */
async function exportZip() {
  if (!state.output) return;
  const { report, glb, lods, arGlb, reportHtml } = state.output;
  const name = report.name;
  const entries = [
    { name: `${name}/${name}.glb`, data: glb },
    ...lods.map((l) => ({ name: `${name}/${l.file}`, data: l.glb })),
    ...(arGlb ? [{ name: `${name}/${name}.ar.glb`, data: arGlb }] : []),
    { name: `${name}/${name}.report.html`, data: reportHtml },
    { name: `${name}/${name}.report.json`, data: JSON.stringify(report, null, 2) },
  ];
  // USDZ for iOS AR Quick Look, from the optimized model (same exporter as <web-model>).
  let embed = embedWithCurrentMeta();
  if (arGlb) {
    try {
      entries.push({ name: `${name}/${name}.usdz`, data: new Uint8Array(await (await ui.after.exportUSDZ()).arrayBuffer()) });
    } catch (err) {
      // Without the file, <web-model> builds the USDZ on the visitor's iPhone instead.
      console.warn('USDZ export failed', err);
      embed = embed.replace(/\n\s*ios-src="[^"]*"/, '');
    }
  }
  entries.push({ name: `${name}/${name}.embed.html`, data: embed });
  // Poster: snapshot the optimized model as currently framed and lit.
  const poster = await ui.after.snapshot('image/webp', 0.86);
  if (poster) {
    const ext = poster.type === 'image/webp' ? 'webp' : 'png';
    entries.push({ name: `${name}/${name}.${ext}`, data: new Uint8Array(await poster.arrayBuffer()) });
  }
  const url = URL.createObjectURL(createZip(entries));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.mesh2web.zip` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(t('toast.downloaded'));
}

/* ---------------------------------------------------------------------------
   Split compare + camera sync
   --------------------------------------------------------------------------- */
function setSplit(percent) {
  const p = Math.max(0, Math.min(100, percent));
  ui.compare.style.setProperty('--split', `${p}%`);
  ui.handle.setAttribute('aria-valuenow', String(Math.round(p)));
}

function initCompare() {
  setSplit(50);
  let dragging = false;
  const move = (e) => {
    if (!dragging) return;
    const r = ui.compare.getBoundingClientRect();
    setSplit(((e.clientX - r.left) / r.width) * 100);
  };
  ui.handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    ui.handle.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  ui.handle.addEventListener('pointermove', move);
  ui.handle.addEventListener('pointerup', () => { dragging = false; });
  ui.handle.addEventListener('keydown', (e) => {
    const now = Number(ui.handle.getAttribute('aria-valuenow'));
    if (e.key === 'ArrowLeft') setSplit(now - 5);
    else if (e.key === 'ArrowRight') setSplit(now + 5);
    else return;
    e.preventDefault();
  });

  // Whichever view the user moved drives the other one.
  const keys = ['azimuth', 'polar', 'distance'];
  const read = (el) => keys.map((k) => el.camera[k]);
  const differs = (x, y) => x.some((v, i) => v !== y[i]);
  let last = read(ui.after);
  const sync = () => {
    const a = read(ui.after);
    const b = read(ui.before);
    if (differs(a, last)) keys.forEach((k, i) => { ui.before.camera[k] = a[i]; });
    else if (differs(b, a)) keys.forEach((k, i) => { ui.after.camera[k] = b[i]; });
    last = read(ui.after);
    requestAnimationFrame(sync);
  };
  requestAnimationFrame(sync);
}

/* ---------------------------------------------------------------------------
   Controls
   --------------------------------------------------------------------------- */
function selectPreset(name, { run = true } = {}) {
  state.preset = name;
  ui.presets.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.preset === name)));
  const preset = state.presets[name];
  if (preset) {
    // English descriptions come from presets.json; other languages translate them in lang.js.
    const key = `preset.${name}`;
    const translated = t(key);
    ui.presetDesc.textContent = t('preset.desc', {
      description: translated === key ? preset.description : translated,
      tris: fmtNum(preset.budget.maxTriangles),
      kb: preset.budget.maxSizeKB,
    });
    ui.ratio.value = Math.round(preset.simplify.ratio * 100);
    ui.ratioOut.textContent = `${ui.ratio.value}%`;
    ui.maxTris.value = preset.budget.maxTriangles;
    ui.textureSize.value = String(preset.textures.maxSize);
  }
  if (run) runOptimize();
}

function initControls() {
  ui.file.addEventListener('change', () => { loadFiles(ui.file.files); ui.file.value = ''; });
  ui.sample.addEventListener('click', loadSample);
  ui.replace.addEventListener('click', () => ui.file.click());
  ui.run.addEventListener('click', runOptimize);
  ui.exportBtn.addEventListener('click', exportZip);
  ui.copyEmbed.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(embedWithCurrentMeta()); toast(t('toast.copied')); } catch { toast(t('toast.copyFailed')); }
  });

  ui.presets.forEach((button, i) => {
    button.addEventListener('click', () => selectPreset(button.dataset.preset));
    button.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      const next = ui.presets[(i + dir + ui.presets.length) % ui.presets.length];
      next.focus();
      selectPreset(next.dataset.preset);
    });
  });
  ui.ratio.addEventListener('input', () => { ui.ratioOut.textContent = `${ui.ratio.value}%`; });
  for (const el of [ui.ratio, ui.maxTris, ui.textureSize, ui.textureFormat, ui.geometry, ui.lod, ui.fit, ui.ar]) el.addEventListener('change', runOptimize);

  ui.lighting.addEventListener('change', () => {
    ui.before.lighting = ui.lighting.value;
    ui.after.lighting = ui.lighting.value;
    ui.embed.textContent = embedWithCurrentMeta();
  });
  ui.alt.addEventListener('input', () => { ui.embed.textContent = embedWithCurrentMeta(); });

  // Drag & drop anywhere on the page.
  let depth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); depth++; ui.body.classList.add('is-dragging'); });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; ui.body.classList.remove('is-dragging'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    ui.body.classList.remove('is-dragging');
    loadFiles(e.dataTransfer.files);
  });
}

async function init() {
  try {
    state.presets = await (await fetch(new URL('../vendor/presets.json', import.meta.url))).json();
  } catch { /* descriptions are optional */ }
  selectPreset('product', { run: false });
  initControls();
  initCompare();
}

init();

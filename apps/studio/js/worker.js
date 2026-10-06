/**
 * mesh2web Studio worker: runs the @mesh2web/core pipeline off the main
 * thread. Files never leave the browser.
 *
 * Messages in:  { id, type: 'load', files: [{ name, buffer }] }
 *               { id, type: 'sample' }
 *               { id, type: 'optimize', options, meta: { alt, lighting } }
 * Messages out: { id, type: 'step', step }
 *               { id, type: 'loaded', name, bytes, stats, previewGlb }
 *               { id, type: 'optimized', report, glb, lods, embed, reportHtml }
 *               { id, type: 'error', message }
 */
import {
  Document, Logger, createWebIO, inspectDocument, objToDocument, optimizeWithLods, resolveOptions,
  createReport, renderHtmlReport, createEmbedSnippet, canvasTextureTransform,
  MeshoptEncoder, MeshoptSimplifier,
} from '../vendor/core.js';

const ioReady = createWebIO();
/** Source of truth for the current model: raw bytes so every run starts clean. */
let source = null; // { name, bytes, read: () => Promise<Document> }

const post = (msg, transfer = []) => self.postMessage(msg, transfer);

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') await load(id, data.files);
    else if (type === 'sample') await loadSample(id);
    else if (type === 'optimize') await optimize(id, data.options, data.meta);
  } catch (err) {
    post({ id, type: 'error', message: err?.message || String(err) });
  }
};

/** @param {{ name: string, buffer: ArrayBuffer }[]} files */
async function load(id, files) {
  const io = await ioReady;
  const byExt = (re) => files.find((f) => re.test(f.name));
  const main = byExt(/\.glb$/i) || byExt(/\.gltf$/i) || byExt(/\.obj$/i);
  if (!main) throw new Error('Drop a .glb, .gltf (with its .bin and textures) or .obj file. FBX: export to glTF from Blender first.');
  const name = main.name.replace(/\.[^.]+$/, '');
  const bytes = files.reduce((sum, f) => sum + f.buffer.byteLength, 0);

  let read;
  if (/\.glb$/i.test(main.name)) {
    const glb = new Uint8Array(main.buffer);
    read = () => io.readBinary(glb);
  } else if (/\.gltf$/i.test(main.name)) {
    const json = JSON.parse(new TextDecoder().decode(main.buffer));
    const resources = {};
    for (const f of files) if (f !== main) resources[f.name] = new Uint8Array(f.buffer);
    read = async () => {
      // data: URIs are decoded by the reader; external files come from the drop.
      const missing = [...(json.buffers || []), ...(json.images || [])]
        .map((r) => r.uri).filter((uri) => uri && !uri.startsWith('data:') && !resources[decodeURIComponent(uri)]);
      if (missing.length) throw new Error(`Missing files referenced by the .gltf: ${missing.join(', ')}. Drop them together.`);
      const decoded = {};
      for (const [k, v] of Object.entries(resources)) decoded[k] = v;
      for (const r of [...(json.buffers || []), ...(json.images || [])]) {
        if (r.uri && !r.uri.startsWith('data:')) decoded[r.uri] = resources[decodeURIComponent(r.uri)];
      }
      return io.readJSON({ json: structuredClone(json), resources: decoded });
    };
  } else {
    const objText = new TextDecoder().decode(main.buffer);
    const mtl = byExt(/\.mtl$/i);
    const mtlText = mtl ? new TextDecoder().decode(mtl.buffer) : '';
    read = async () => objToDocument(objText, { mtlText, name }).setLogger(new Logger(Logger.Verbosity.WARN));
  }
  source = { name, bytes, read };
  await sendLoaded(id);
}

async function sendLoaded(id) {
  const io = await ioReady;
  const doc = await source.read();
  const stats = inspectDocument(doc);
  // Preview the source as GLB so the viewer can show OBJ/glTF too.
  const previewGlb = await io.writeBinary(doc);
  post({ id, type: 'loaded', name: source.name, bytes: source.bytes, stats, previewGlb }, [previewGlb.buffer]);
}

async function optimize(id, options, meta = {}) {
  if (!source) throw new Error('Load a model first.');
  const io = await ioReady;
  const doc = await source.read();
  const before = { bytes: source.bytes, stats: inspectDocument(doc) };
  const resolved = resolveOptions(options);

  const { lods } = await optimizeWithLods(doc, options, {
    simplifier: MeshoptSimplifier,
    encoder: MeshoptEncoder,
    textureTransform: canvasTextureTransform,
    onStep: (step) => post({ id, type: 'step', step }),
  });

  const glb = await io.writeBinary(doc);
  const after = { bytes: glb.byteLength, stats: inspectDocument(doc) };
  const name = source.name;
  const outputs = [{ file: `${name}.glb`, bytes: glb.byteLength, triangles: after.stats.triangles }];
  const lodFiles = [];
  for (const [i, lod] of lods.entries()) {
    const bytes = await io.writeBinary(lod.doc);
    const file = `${name}.lod${i + 1}.glb`;
    lodFiles.push({ file, glb: bytes });
    outputs.push({ file, bytes: bytes.byteLength, triangles: inspectDocument(lod.doc).triangles });
  }
  const report = createReport({ name, preset: resolved.preset, before, after, budget: resolved.budget, outputs });
  const embed = createEmbedSnippet({
    src: `${name}.glb`, lods: lodFiles.map((l) => l.file), poster: `${name}.webp`,
    alt: meta.alt || name, lighting: meta.lighting || 'studio-soft',
  });
  post(
    { id, type: 'optimized', report, glb, lods: lodFiles, embed, reportHtml: renderHtmlReport(report) },
    [glb.buffer, ...lodFiles.map((l) => l.glb.buffer)],
  );
}

/* ---------------------------------------------------------------------------
   Procedural "dirty" sample: an unwelded, normal-less torus knot with a
   duplicated material, dead nodes and an oversized texture. CC0 by construction.
   --------------------------------------------------------------------------- */
async function loadSample(id) {
  const io = await ioReady;
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const P = 2, Q = 3, TUBE = 0.33, SEG_U = 720, SEG_V = 96;
  const knot = (t) => {
    const r = 1 + 0.5 * Math.cos((Q / P) * t);
    return [r * Math.cos(t), r * Math.sin(t), 0.5 * Math.sin((Q / P) * t)];
  };
  const point = (u, v) => {
    const t = u * Math.PI * 2 * P;
    const p1 = knot(t), p2 = knot(t + 0.01);
    const T = p2.map((x, i) => x - p1[i]);
    const N = p2.map((x, i) => x + p1[i]);
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    const N2 = [B[1] * T[2] - B[2] * T[1], B[2] * T[0] - B[0] * T[2], B[0] * T[1] - B[1] * T[0]];
    const lb = Math.hypot(...B), ln = Math.hypot(...N2);
    const a = v * Math.PI * 2, cx = -TUBE * Math.cos(a), cy = TUBE * Math.sin(a);
    return p1.map((x, i) => x + cx * (N2[i] / ln) + cy * (B[i] / lb));
  };
  // Unwelded triangles: every triangle owns its 3 vertices.
  const pos = new Float32Array(SEG_U * SEG_V * 18);
  const uv = new Float32Array(SEG_U * SEG_V * 12);
  let p = 0, q = 0;
  for (let j = 0; j < SEG_V; j++) {
    for (let i = 0; i < SEG_U; i++) {
      const quad = [[i, j], [i, j + 1], [i + 1, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
      for (const [a, b] of quad) {
        const v = point(a / SEG_U, b / SEG_V);
        pos[p++] = v[0]; pos[p++] = v[1]; pos[p++] = v[2];
        uv[q++] = a / SEG_U; uv[q++] = b / SEG_V;
      }
    }
  }
  // 4096² texture: a 4K map on a small prop is the classic web mistake.
  const size = 4096;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#d9b36c'); g.addColorStop(0.5, '#f1dcae'); g.addColorStop(1, '#b8873e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.18;
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = k % 2 ? '#fff6e0' : '#7a5418';
    ctx.fillRect(Math.random() * size, Math.random() * size, 4 + Math.random() * 60, 2 + Math.random() * 10);
  }
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  const texture = doc.createTexture('brass_4k.png').setImage(png).setMimeType('image/png');
  const brass = doc.createMaterial('Brass').setBaseColorTexture(texture).setMetallicFactor(1).setRoughnessFactor(0.32);
  doc.createMaterial('Brass.001').setBaseColorTexture(texture).setMetallicFactor(1).setRoughnessFactor(0.32);

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setMaterial(brass);
  const scene = doc.createScene('Scene');
  const root = doc.createNode('Export_Root');
  root.addChild(doc.createNode('Knot').setMesh(doc.createMesh('Knot').addPrimitive(prim)));
  root.addChild(doc.createNode('Camera_Target_Unused'));
  scene.addChild(root);

  const glb = await io.writeBinary(doc);
  source = { name: 'sample-knot', bytes: glb.byteLength, read: () => io.readBinary(glb) };
  await sendLoaded(id);
}

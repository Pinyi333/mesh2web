import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

import { inspectDocument } from './inspect.js';
import { optimizeWithLods, resolveOptions } from './pipeline.js';
import { createReport, renderHtmlReport } from './report.js';
import { objToDocument } from './obj.js';
import { createEmbedSnippet } from './embed.js';

export * from './index.js';

/** Input formats mesh2web reads directly. */
export const SUPPORTED_INPUTS = ['.glb', '.gltf', '.obj'];

let ioPromise;
const logger = new Logger(Logger.Verbosity.WARN);

/**
 * A NodeIO with every glTF extension plus Draco and Meshopt codecs registered.
 * Created once and reused.
 * @returns {Promise<NodeIO>}
 */
export function createIO() {
  ioPromise ??= (async () => {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    return new NodeIO()
      .setLogger(logger)
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
      });
  })();
  return ioPromise;
}

/**
 * Read a GLB, glTF or OBJ file into a glTF-Transform Document.
 * @param {string} file
 */
export async function readModel(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.obj') {
    const objText = await readFile(file, 'utf8');
    const mtlName = objText.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
    let mtlText = '';
    if (mtlName) {
      try { mtlText = await readFile(path.resolve(path.dirname(file), mtlName), 'utf8'); } catch { /* optional */ }
    }
    return objToDocument(objText, { mtlText, name: path.basename(file, ext) }).setLogger(logger);
  }
  if (ext === '.fbx') {
    throw new Error('FBX is not read directly. Convert with Blender (File → Export → glTF 2.0) or FBX2glTF, then run mesh2web on the GLB.');
  }
  if (!SUPPORTED_INPUTS.includes(ext)) {
    throw new Error(`Unsupported input "${ext}". Supported: ${SUPPORTED_INPUTS.join(', ')}`);
  }
  const io = await createIO();
  return io.read(file);
}

/**
 * Serialize a document to GLB bytes.
 * @param {import('@gltf-transform/core').Document} doc
 */
export async function writeGLB(doc) {
  const io = await createIO();
  return io.writeBinary(doc);
}

/** Lazily load sharp; it is an optional dependency. */
async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

/**
 * Texture step for Node: resize to `maxSize` and re-encode with sharp.
 * Returns null (skip) when sharp is not installed.
 */
async function createNodeTextureTransform(warn) {
  const sharp = await loadSharp();
  if (!sharp) {
    warn?.('sharp is not installed; textures are kept as-is. `npm i sharp` to enable resizing and WebP.');
    return () => null;
  }
  return (opts) => textureCompress({
    encoder: sharp,
    targetFormat: opts.format === 'jpeg' || opts.format === 'png' || opts.format === 'webp' ? opts.format : undefined,
    resize: opts.maxSize ? [opts.maxSize, opts.maxSize] : undefined,
    quality: opts.quality ?? 85,
  });
}

/**
 * Inspect a model file without modifying it.
 * @param {string} file
 */
export async function inspectFile(file) {
  const doc = await readModel(file);
  const bytes = (await writeGLB(doc)).byteLength;
  const original = (await readFile(file)).byteLength;
  return { file, bytes: original, glbBytes: bytes, stats: inspectDocument(doc) };
}

/**
 * Optimize one model file and write outputs to `outDir`:
 * `<name>.glb`, `<name>.lod1.glb`…, `<name>.report.json`, `<name>.report.html`
 * and `<name>.embed.html`.
 *
 * @param {string} input
 * @param {Object} [options]
 * @param {string} [options.outDir]  Defaults to the input's directory.
 * @param {string} [options.name]    Output base name. Defaults to the input name.
 * @param {string} [options.publicPath]  URL prefix used in the embed snippet.
 * @param {boolean} [options.report=true]
 * @param {(msg: string) => void} [options.onStep]
 * @param {(msg: string) => void} [options.onWarn]
 * @param {import('./pipeline.js').OptimizeOptions} [options.optimize]
 */
export async function optimizeFile(input, options = {}) {
  const {
    outDir = path.dirname(input),
    name = path.basename(input, path.extname(input)),
    publicPath = '',
    report: writeReports = true,
    onStep, onWarn,
    optimize = {},
  } = options;

  const resolved = resolveOptions(optimize);
  const sourceBytes = (await readFile(input)).byteLength;
  const doc = await readModel(input);
  const before = { bytes: sourceBytes, stats: inspectDocument(doc) };

  const { lods } = await optimizeWithLods(doc, optimize, {
    simplifier: MeshoptSimplifier,
    encoder: MeshoptEncoder,
    textureTransform: await createNodeTextureTransform(onWarn),
    onStep,
  });

  await mkdir(outDir, { recursive: true });
  const outputs = [];
  const mainFile = `${name}.glb`;
  const mainBytes = await writeGLB(doc);
  await writeFile(path.join(outDir, mainFile), mainBytes);
  const after = { bytes: mainBytes.byteLength, stats: inspectDocument(doc) };
  outputs.push({ file: mainFile, bytes: mainBytes.byteLength, triangles: after.stats.triangles });

  const lodFiles = [];
  for (const [i, lod] of lods.entries()) {
    const file = `${name}.lod${i + 1}.glb`;
    const bytes = await writeGLB(lod.doc);
    await writeFile(path.join(outDir, file), bytes);
    lodFiles.push(file);
    outputs.push({ file, bytes: bytes.byteLength, triangles: inspectDocument(lod.doc).triangles });
  }

  const report = createReport({ name, preset: resolved.preset, before, after, budget: resolved.budget, outputs });
  const prefix = publicPath && !publicPath.endsWith('/') ? `${publicPath}/` : publicPath;
  const embed = createEmbedSnippet({
    src: prefix + mainFile,
    lods: lodFiles.map((f) => prefix + f),
    poster: prefix + `${name}.webp`,
    alt: name,
  });

  if (writeReports) {
    await writeFile(path.join(outDir, `${name}.report.json`), JSON.stringify(report, null, 2));
    await writeFile(path.join(outDir, `${name}.report.html`), renderHtmlReport(report));
    await writeFile(path.join(outDir, `${name}.embed.html`), embed);
  }

  return { report, embed, outDir, files: outputs.map((o) => path.join(outDir, o.file)) };
}

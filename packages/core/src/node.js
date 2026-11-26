import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, draco, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

import { inspectDocument } from './inspect.js';
import { optimizeWithLods, resolveOptions } from './pipeline.js';
import { createReport, renderHtmlReport } from './report.js';
import { objToDocument } from './obj.js';
import { createEmbedSnippet } from './embed.js';
import { ktx2Textures } from './ktx2.js';

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

let ktx2EncoderPromise;
/**
 * The Basis Universal encoder from `ktx2-encoder`, loaded on demand (the WASM
 * is ~3 MB and only needed for KTX2). Its own instance is created with a silent
 * `print`, because the default writes progress lines to stdout, which would
 * corrupt `--json` output.
 */
function loadKtx2Encoder() {
  ktx2EncoderPromise ??= (async () => {
    const entry = import.meta.resolve('ktx2-encoder');
    const { NodeBasisEncoder } = await import(entry);
    const { default: BASIS } = await import(new URL('../basis/basis_encoder.js', entry).href);
    const encoder = new NodeBasisEncoder();
    encoder.modulePromise = BASIS({ print: () => {}, printErr: () => {} }).then((basis) => {
      basis.initializeBasis();
      return basis;
    });
    return encoder;
  })();
  return ktx2EncoderPromise;
}

/**
 * KTX2 step for Node: sharp decodes and resizes, the Basis Universal encoder
 * (WASM, from `ktx2-encoder`) compresses. Returns null (skip) without sharp.
 */
async function createNodeKtx2Transform(warn) {
  const sharp = await loadSharp();
  if (!sharp) {
    warn?.('sharp is not installed; KTX2 needs it to decode textures. Textures are kept as-is. `npm i sharp` to enable KTX2.');
    return () => null;
  }
  const decode = async (image, _mimeType, { width, height }) => {
    const { data, info } = await sharp(image).resize(width, height, { fit: 'fill' }).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  };
  return (opts) => async (doc) => {
    const encoder = await loadKtx2Encoder();
    await ktx2Textures(opts, { encode: (image, o) => encoder.encode(image, o), decode, onWarn: warn })(doc);
  };
}

/**
 * Turn a cleaned, simplified document into the AR variant: plain PNG/JPEG
 * textures and Draco geometry, the subset AR viewers (Android Scene Viewer,
 * the USDZ converter) read reliably. Meshopt and KTX2 are left out on purpose.
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ maxSize?: number, quality?: number } | false} textures
 */
async function toArDocument(doc, textures) {
  const sharp = await loadSharp();
  if (sharp) {
    const maxSize = (textures && textures.maxSize) || 2048;
    await doc.transform(
      // WebP sources become PNG (keeps alpha); everything is capped at maxSize.
      textureCompress({ encoder: sharp, targetFormat: 'png', formats: /webp/ }),
      textureCompress({ encoder: sharp, resize: [maxSize, maxSize], quality: (textures && textures.quality) || 85 }),
    );
  }
  await doc.transform(draco({ method: 'edgebreaker' }));
  return doc;
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
 * @param {boolean | { usdz?: (glbFile: string, usdzFile: string) => Promise<boolean> }} [options.ar]
 *        Also write `<name>.ar.glb` for AR viewers and add `ar` attributes to the
 *        embed snippet. `usdz` converts that GLB to `<name>.usdz` for iOS Quick Look
 *        (the CLI does it in headless Chromium); without it `<web-model>` builds the
 *        USDZ in the visitor's browser on demand.
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
    ar = false,
    onStep, onWarn,
    optimize = {},
  } = options;

  const resolved = resolveOptions(optimize);
  const sourceBytes = (await readFile(input)).byteLength;
  const doc = await readModel(input);
  const before = { bytes: sourceBytes, stats: inspectDocument(doc) };

  let arSource = null;
  const { lods } = await optimizeWithLods(doc, optimize, {
    simplifier: MeshoptSimplifier,
    encoder: MeshoptEncoder,
    textureTransform: await createNodeTextureTransform(onWarn),
    ktx2Transform: await createNodeKtx2Transform(onWarn),
    beforeTextures: ar ? (d) => { arSource = cloneDocument(d); } : undefined,
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

  let arFile;
  let usdzFile;
  if (arSource) {
    onStep?.('ar');
    arFile = `${name}.ar.glb`;
    const bytes = await writeGLB(await toArDocument(arSource, resolved.textures));
    await writeFile(path.join(outDir, arFile), bytes);
    outputs.push({ file: arFile, bytes: bytes.byteLength, triangles: inspectDocument(arSource).triangles });
    if (typeof ar === 'object' && ar.usdz) {
      const file = `${name}.usdz`;
      try {
        if (await ar.usdz(path.join(outDir, arFile), path.join(outDir, file))) {
          usdzFile = file;
          outputs.push({ file, bytes: (await readFile(path.join(outDir, file))).byteLength, triangles: outputs.at(-1).triangles });
        }
      } catch (err) {
        onWarn?.(`USDZ skipped (iOS will build it on demand): ${err.message}`);
      }
    }
  }

  const report = createReport({ name, preset: resolved.preset, before, after, budget: resolved.budget, outputs });
  const prefix = publicPath && !publicPath.endsWith('/') ? `${publicPath}/` : publicPath;
  const embed = createEmbedSnippet({
    src: prefix + mainFile,
    lods: lodFiles.map((f) => prefix + f),
    poster: prefix + `${name}.webp`,
    alt: name,
    ar: arFile ? { src: prefix + arFile, iosSrc: usdzFile && prefix + usdzFile } : undefined,
  });

  if (writeReports) {
    await writeFile(path.join(outDir, `${name}.report.json`), JSON.stringify(report, null, 2));
    await writeFile(path.join(outDir, `${name}.report.html`), renderHtmlReport(report));
    await writeFile(path.join(outDir, `${name}.embed.html`), embed);
  }

  return {
    report, embed, outDir,
    files: outputs.map((o) => path.join(outDir, o.file)),
    arFile: arFile ? path.join(outDir, arFile) : undefined,
  };
}

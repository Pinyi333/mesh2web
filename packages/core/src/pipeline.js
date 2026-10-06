import {
  cloneDocument, dedup, draco, flatten, join, meshopt,
  prune, quantize, simplify, weld,
} from '@gltf-transform/functions';
import { inspectDocument } from './inspect.js';
import { optimizePresets, DEFAULT_OPTIMIZE_PRESET } from '@mesh2web/presets';

/**
 * @typedef {import('@gltf-transform/core').Document} Document
 * @typedef {import('@gltf-transform/core').Transform} Transform
 *
 * @typedef {Object} OptimizeOptions
 * @property {string} [preset]  `hero` | `product` | `ambient`
 * @property {{ ratio?: number, error?: number } | false} [simplify]
 * @property {'meshopt' | 'draco' | 'none'} [geometry]
 * @property {{ format?: 'webp' | 'png' | 'jpeg' | 'keep', maxSize?: number, quality?: number } | false} [textures]
 * @property {number[]} [lod]   Ratios relative to the optimized model, e.g. [1, 0.5, 0.2].
 * @property {{ maxSizeKB?: number, maxTriangles?: number }} [budget]
 * @property {boolean} [fitBudget]  Keep simplifying (with a looser error bound) until
 *           the triangle budget is met. Default true.
 *
 * @typedef {Object} PipelineDeps
 * @property {any} [simplifier]   MeshoptSimplifier (from `meshoptimizer`).
 * @property {any} [encoder]      MeshoptEncoder (from `meshoptimizer`).
 * @property {(opts: NonNullable<OptimizeOptions['textures']>) => Transform | null} [textureTransform]
 *           Environment-specific texture step (sharp in Node, canvas in the browser).
 * @property {(step: string) => void} [onStep]
 */

/**
 * Merge a named preset with explicit overrides. Unknown preset names throw.
 * @param {OptimizeOptions} [options]
 * @returns {Required<Omit<OptimizeOptions, 'preset'>> & { preset: string }}
 */
export function resolveOptions(options = {}) {
  const name = options.preset || DEFAULT_OPTIMIZE_PRESET;
  const preset = optimizePresets[name];
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Available: ${Object.keys(optimizePresets).join(', ')}`);
  }
  const pick = (key) => (options[key] === undefined ? preset[key] : options[key]);
  const mergeObject = (key) => {
    const value = options[key];
    if (value === false) return false;
    return { ...preset[key], ...(value || {}) };
  };
  return {
    preset: name,
    simplify: mergeObject('simplify'),
    geometry: pick('geometry'),
    textures: mergeObject('textures'),
    lod: pick('lod'),
    budget: { ...preset.budget, ...(options.budget || {}) },
    fitBudget: options.fitBudget ?? true,
  };
}

/** @param {Document} doc */
function countTriangles(doc) {
  return inspectDocument(doc).triangles;
}

/**
 * Generate smooth, area-weighted normals for indexed triangle primitives that
 * have none. (glTF-Transform's `normals()` unwelds to make flat normals, which
 * would undo `weld` and defeat simplification.) Existing normals are kept.
 * @param {Document} doc
 * @returns {number} Number of primitives that received normals.
 */
export function addSmoothNormals(doc) {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const indices = prim.getIndices();
      if (prim.getMode() !== 4 || prim.getAttribute('NORMAL') || !position) continue;
      const vertexCount = position.getCount();
      const n = new Float32Array(vertexCount * 3);
      const a = [0, 0, 0]; const b = [0, 0, 0]; const c = [0, 0, 0];
      const triCount = (indices ? indices.getCount() : vertexCount) / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = indices ? indices.getScalar(t * 3) : t * 3;
        const i1 = indices ? indices.getScalar(t * 3 + 1) : t * 3 + 1;
        const i2 = indices ? indices.getScalar(t * 3 + 2) : t * 3 + 2;
        position.getElement(i0, a); position.getElement(i1, b); position.getElement(i2, c);
        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        // Unnormalized cross product = area-weighted face normal.
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        for (const i of [i0, i1, i2]) { n[i * 3] += nx; n[i * 3 + 1] += ny; n[i * 3 + 2] += nz; }
      }
      for (let i = 0; i < n.length; i += 3) {
        const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
        if (len > 0) { n[i] /= len; n[i + 1] /= len; n[i + 2] /= len; } else { n[i + 1] = 1; }
      }
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(position.getBuffer()));
      count++;
    }
  }
  return count;
}

/**
 * Structural clean-up shared by every preset: drop duplicates and unused data,
 * merge identical vertices, add missing normals, flatten the hierarchy where
 * safe and join meshes that share a material so the result needs fewer draw calls.
 * Returns the number of primitives that received generated normals.
 * @param {Document} doc
 */
async function clean(doc) {
  await doc.transform(dedup(), flatten(), weld());
  // Normals must exist before `join`: primitives only merge when their vertex
  // attributes match, so a mesh missing normals would stay a separate draw call.
  const generated = addSmoothNormals(doc);
  await doc.transform(
    join({ keepNamed: false }),
    prune({ keepAttributes: false, keepLeaves: false }),
  );
  return generated;
}

/**
 * Run the optimization pipeline on a document **in place**.
 * Order: clean → normals → simplify → textures → compress.
 *
 * Geometry compression is applied last because it quantizes vertex data.
 * @param {Document} doc
 * @param {OptimizeOptions} [options]
 * @param {PipelineDeps} [deps]
 */
export async function optimizeDocument(doc, options = {}, deps = {}) {
  const opts = resolveOptions(options);
  const step = deps.onStep || (() => {});

  step('clean');
  if (await clean(doc)) step('normals');

  if (opts.simplify && deps.simplifier) {
    step('simplify');
    await deps.simplifier.ready;
    await doc.transform(
      simplify({ simplifier: deps.simplifier, ratio: opts.simplify.ratio ?? 0.5, error: opts.simplify.error ?? 0.001, lockBorder: false }),
      prune(),
    );
  }

  const maxTriangles = opts.budget?.maxTriangles;
  if (opts.fitBudget && maxTriangles && deps.simplifier) {
    // The error bound above protects quality; if that leaves the model over
    // budget, trade a little accuracy for meeting it (up to 3 passes).
    for (let pass = 0; pass < 3; pass++) {
      const triangles = countTriangles(doc);
      if (triangles <= maxTriangles) break;
      step('fit-budget');
      await doc.transform(
        simplify({ simplifier: deps.simplifier, ratio: (maxTriangles / triangles) * 0.97, error: 0.01 * (pass + 1) }),
        prune(),
      );
    }
  }

  if (opts.textures && opts.textures.format !== 'keep' && deps.textureTransform) {
    const transform = deps.textureTransform(opts.textures);
    if (transform) {
      step('textures');
      await doc.transform(transform);
    }
  }

  await compressGeometry(doc, opts.geometry, deps, step);
  return opts;
}

/**
 * @param {Document} doc
 * @param {OptimizeOptions['geometry']} method
 * @param {PipelineDeps} deps
 * @param {(s: string) => void} step
 */
async function compressGeometry(doc, method, deps, step) {
  if (method === 'meshopt' && deps.encoder) {
    step('compress:meshopt');
    await deps.encoder.ready;
    await doc.transform(meshopt({ encoder: deps.encoder, level: 'high' }));
  } else if (method === 'draco') {
    // Draco is encoded at write time; the IO must have `draco3d.encoder` registered.
    step('compress:draco');
    await doc.transform(draco({ method: 'edgebreaker' }));
  } else if (method !== 'none') {
    // No encoder available: quantize only, still a sizeable win.
    step('compress:quantize');
    await doc.transform(quantize());
  }
}

/**
 * Produce LOD variants from an **unquantized, cleaned** document. Each ratio < 1
 * yields a simplified copy. Ratio 1 is the main model and is skipped.
 * @param {Document} source  Document after `clean`/`simplify`, before compression.
 * @param {number[]} ratios
 * @param {OptimizeOptions} options
 * @param {PipelineDeps} deps
 * @returns {Promise<{ ratio: number, doc: Document }[]>}
 */
export async function createLods(source, ratios, options, deps) {
  if (!deps.simplifier) return [];
  const opts = resolveOptions(options);
  const results = [];
  for (const ratio of ratios.filter((r) => r > 0 && r < 1)) {
    const doc = cloneDocument(source);
    await deps.simplifier.ready;
    await doc.transform(
      // A generous error bound: low LODs are seen small or on weak devices.
      simplify({ simplifier: deps.simplifier, ratio, error: 0.02 }),
      prune(),
    );
    await compressGeometry(doc, opts.geometry, deps, () => {});
    results.push({ ratio, doc });
  }
  return results;
}

/**
 * Convenience: run the pipeline and also build LODs, sharing the clean step.
 * @param {Document} doc
 * @param {OptimizeOptions} [options]
 * @param {PipelineDeps} [deps]
 */
export async function optimizeWithLods(doc, options = {}, deps = {}) {
  const opts = resolveOptions(options);
  const step = deps.onStep || (() => {});
  // Optimize everything except compression, so LODs simplify clean geometry.
  const result = await optimizeDocument(doc, { ...options, geometry: 'none' }, deps);
  let lods = [];
  if (opts.lod?.length > 1) {
    step('lod');
    lods = await createLods(doc, opts.lod, options, deps);
  }
  await compressGeometry(doc, opts.geometry, deps, step);
  return { options: result, lods };
}

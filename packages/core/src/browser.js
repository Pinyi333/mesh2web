/**
 * Browser entry for @mesh2web/core: the shared pipeline plus a WebIO with
 * Meshopt codecs and a canvas-based texture step. Used by mesh2web Studio,
 * typically inside a Web Worker. (Draco *decoding* is supported; encoding is
 * Node-only.)
 */
import { Logger, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { ktx2Textures } from './ktx2.js';

export * from './index.js';
export { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier };
export { Document, Logger } from '@gltf-transform/core';

/** @returns {Promise<WebIO>} */
export async function createWebIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new WebIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/**
 * Texture step for browsers/workers: downscale to `maxSize` and re-encode with
 * OffscreenCanvas. Falls back to PNG where WebP encoding is unsupported (Safari).
 * @param {{ format?: string, maxSize?: number, quality?: number }} opts
 * @returns {import('@gltf-transform/core').Transform | null}
 */
export function canvasTextureTransform(opts) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  return async (doc) => {
    const wantType = `image/${opts.format === 'jpeg' ? 'jpeg' : opts.format || 'webp'}`;
    let usedWebP = false;
    for (const texture of doc.getRoot().listTextures()) {
      const image = texture.getImage();
      const mimeType = texture.getMimeType();
      if (!image || !/^image\/(png|jpeg|webp)$/.test(mimeType)) continue; // skip KTX2 etc.
      const bitmap = await createImageBitmap(new Blob([image], { type: mimeType }));
      const max = opts.maxSize || Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      // JPEG has no alpha; keep PNG/WebP for textures that may use it.
      const type = wantType === 'image/jpeg' && mimeType === 'image/png' ? 'image/png' : wantType;
      const blob = await canvas.convertToBlob({ type, quality: (opts.quality ?? 85) / 100 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Only replace when it actually helps (or the size had to change).
      if (bytes.byteLength < image.byteLength || scale < 1) {
        texture.setImage(bytes).setMimeType(blob.type);
        const ext = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' }[blob.type];
        if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.[^.]+$/, ext));
        if (blob.type === 'image/webp') usedWebP = true;
      }
    }
    if (usedWebP) doc.createExtension(EXTTextureWebP).setRequired(true);
  };
}

let ktx2Encoder;

/**
 * KTX2 step for browsers/workers: OffscreenCanvas decodes and resizes, the
 * Basis Universal WASM encoder (from `ktx2-encoder`) compresses. The ~3 MB
 * WASM is fetched on first use from `wasmUrl`; bundlers that do not copy
 * `ktx2-encoder/dist/basis/basis_encoder.wasm` must pass it explicitly.
 * @param {{ maxSize?: number, quality?: number, mode?: 'auto' | 'etc1s' | 'uastc' }} opts
 * @param {{ wasmUrl?: string, onWarn?: (msg: string) => void }} [env]
 * @returns {import('@gltf-transform/core').Transform | null}
 */
export function canvasKtx2Transform(opts, { wasmUrl, onWarn } = {}) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  const decode = async (image, mimeType, { width, height }) => {
    const bitmap = await createImageBitmap(new Blob([image], { type: mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return { data: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer), width, height };
  };
  return async (doc) => {
    if (!ktx2Encoder) {
      const { BrowserBasisEncoder } = await import('ktx2-encoder');
      const encoder = new BrowserBasisEncoder();
      // The Emscripten module binds `console.log` for its progress output when
      // it starts; hand it a no-op so every encode does not flood the console.
      const log = console.log;
      console.log = () => {};
      try { await encoder.init(wasmUrl ? { wasmUrl } : undefined); } finally { console.log = log; }
      ktx2Encoder = encoder;
    }
    const encode = (image, o) => ktx2Encoder.encode(image, wasmUrl ? { ...o, wasmUrl } : o);
    await ktx2Textures(opts, { encode, decode, onWarn })(doc);
  };
}

/**
 * Browser entry for @mesh2web/core: the shared pipeline plus a WebIO with
 * Meshopt codecs and a canvas-based texture step. Used by mesh2web Studio,
 * typically inside a Web Worker. (Draco *decoding* is supported; encoding is
 * Node-only.)
 */
import { Logger, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

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

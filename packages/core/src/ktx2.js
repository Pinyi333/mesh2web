/**
 * KTX2 (Basis Universal) texture step, shared by Node and the browser.
 *
 * KTX2 textures stay compressed on the GPU, so a 2048² texture costs ~5.3 MB
 * of video memory instead of ~21 MB as PNG/WebP/JPEG. The environment supplies
 * two functions: `decode` (image bytes → resized RGBA pixels) and `encode`
 * (RGBA → KTX2, normally `encodeToKTX2` from the MIT `ktx2-encoder` package,
 * which bundles the Apache-2.0 Basis Universal encoder).
 *
 * Per-slot choices follow common practice (gltfpack, glTF-Transform):
 *   - color slots (base color, emissive…): ETC1S, sRGB    → smallest files
 *   - normal maps:                          UASTC, linear  → no blocky normals
 *   - other data (ORM, occlusion…):         ETC1S, linear
 */
import { Document } from '@gltf-transform/core';
import { KHRTextureBasisu, EXTTextureWebP } from '@gltf-transform/extensions';

/**
 * @typedef {Object} DecodedImage
 * @property {Uint8Array} data   RGBA8 pixels, row-major, top-left first.
 * @property {number} width
 * @property {number} height
 *
 * @typedef {Object} Ktx2Deps
 * @property {(image: Uint8Array, mimeType: string, size: { width: number, height: number }) => Promise<DecodedImage>} decode
 *           Decode `image` and resize it to exactly `size`.
 * @property {(image: Uint8Array, options: Record<string, any>) => Promise<Uint8Array>} encode
 *           `encodeToKTX2` compatible. Receives `imageDecoder` in `options`.
 *
 * @typedef {Object} Ktx2Options
 * @property {number} [maxSize]   Longest side in px. Sizes snap to powers of two.
 * @property {number} [quality]   1–100, like the WebP/JPEG quality. Default 85.
 * @property {'auto' | 'etc1s' | 'uastc'} [mode]  `auto` = per-slot choice above.
 */

const SOURCE_TYPES = /^image\/(png|jpeg|webp)$/;
const COLOR_SLOTS = /^(baseColorTexture|emissiveTexture|diffuseTexture|sheenColorTexture|specularColorTexture)$/;
const NORMAL_SLOTS = /^(normalTexture|clearcoatNormalTexture)$/;

/** Largest power of two ≤ n (at least 4: GPU block formats work on 4×4 tiles). */
export function floorPowerOfTwo(n) {
  return Math.max(4, 2 ** Math.floor(Math.log2(Math.max(1, n))));
}

/** Nearest power of two to n, capped at `max`. Mirrors glTF-Transform's `toktx` resize. */
export function ktx2Size(width, height, maxSize = Infinity) {
  const fit = (n) => {
    const lower = floorPowerOfTwo(n);
    const nearest = n - lower > lower * 2 - n ? lower * 2 : lower;
    return Math.min(nearest, floorPowerOfTwo(maxSize));
  };
  // Scale both sides together first so the aspect ratio survives the cap.
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return { width: fit(Math.round(width * scale)), height: fit(Math.round(height * scale)) };
}

/** glTF slot names (`baseColorTexture`, `normalTexture`…) that use a texture. */
export function textureSlots(texture) {
  const root = Document.fromGraph(texture.getGraph()).getRoot();
  return [...new Set(texture.getGraph().listParentEdges(texture)
    .filter((edge) => edge.getParent() !== root)
    .map((edge) => edge.getName()))];
}

/**
 * Pick Basis encoder settings for a texture from the slots it is used in.
 * @param {string[]} slots
 * @param {Ktx2Options} opts
 */
export function ktx2Settings(slots, { quality = 85, mode = 'auto' } = {}) {
  const normal = slots.some((s) => NORMAL_SLOTS.test(s));
  const color = !normal && slots.some((s) => COLOR_SLOTS.test(s));
  const uastc = mode === 'uastc' || (mode === 'auto' && normal);
  const q = Math.max(1, Math.min(100, quality));
  return {
    kind: normal ? 'normal' : color ? 'color' : 'data',
    isUASTC: uastc,
    isKTX2File: true,
    enableDebug: false,
    generateMipmap: true,
    isPerceptual: color,
    isSetKTX2SRGBTransferFunc: color,
    isNormalMap: normal,
    // ETC1S: quality level 1–255 (≈ libwebp's 0–100 scale × 2.55).
    qualityLevel: Math.round(q * 2.55),
    compressionLevel: 2,
    // UASTC: RDO trades a little quality for much better Zstandard compression.
    needSupercompression: true,
    enableRDO: uastc,
    rdoQualityLevel: uastc ? Math.max(0.25, (100 - q) / 25) : undefined,
  };
}

/**
 * Bytes of GPU memory a texture needs once uploaded, including mipmaps.
 * KTX2 transcodes to 8 bits/px block formats (BC7, ASTC 4×4, ETC2 RGBA) or
 * 4 bits/px (BC1/ETC1) for opaque ETC1S; we count 8 to stay on the safe side.
 * Everything else is decoded to RGBA8 (32 bits/px).
 */
export function estimateGpuBytes(width, height, mimeType) {
  const bitsPerPixel = mimeType === 'image/ktx2' ? 8 : 32;
  return Math.round((width * height * bitsPerPixel / 8) * 4 / 3);
}

/**
 * Create the glTF-Transform transform. Textures that fail to encode are left
 * untouched (and reported through `onWarn`), so the pipeline never breaks.
 * @param {Ktx2Options} opts
 * @param {Ktx2Deps & { onWarn?: (msg: string) => void }} deps
 * @returns {import('@gltf-transform/core').Transform}
 */
export function ktx2Textures(opts, deps) {
  return async function ktx2(doc) {
    let converted = 0;
    for (const texture of doc.getRoot().listTextures()) {
      const image = texture.getImage();
      const mimeType = texture.getMimeType();
      if (!image || !SOURCE_TYPES.test(mimeType)) continue;
      const [srcW, srcH] = texture.getSize() || [0, 0];
      if (!srcW || !srcH) continue;
      const size = ktx2Size(srcW, srcH, opts.maxSize || Infinity);
      const settings = ktx2Settings(textureSlots(texture), opts);
      const { kind, ...encoderOptions } = settings;
      try {
        const bytes = await deps.encode(image, {
          ...encoderOptions,
          imageDecoder: () => deps.decode(image, mimeType, size),
        });
        texture.setImage(bytes).setMimeType('image/ktx2');
        if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.[^./]+$/, '.ktx2'));
        converted++;
      } catch (err) {
        deps.onWarn?.(`KTX2: kept "${texture.getName() || texture.getURI() || 'texture'}" (${kind}) as ${mimeType}: ${err.message}`);
      }
    }
    if (converted) doc.createExtension(KHRTextureBasisu).setRequired(true);
    // Drop EXT_texture_webp if no WebP texture is left.
    const root = doc.getRoot();
    if (!root.listTextures().some((t) => t.getMimeType() === 'image/webp')) {
      root.listExtensionsUsed().find((e) => e.extensionName === EXTTextureWebP.EXTENSION_NAME)?.dispose();
    }
  };
}

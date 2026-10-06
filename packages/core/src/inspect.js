import { getBounds } from '@gltf-transform/functions';

/**
 * @typedef {import('@gltf-transform/core').Document} Document
 *
 * @typedef {Object} Issue
 * @property {'error' | 'warning' | 'info'} level
 * @property {string} code     Stable machine-readable identifier.
 * @property {string} message  What is wrong.
 * @property {string} [fix]    How mesh2web (or the author) can fix it.
 *
 * @typedef {Object} TextureStat
 * @property {string} name
 * @property {string} mimeType
 * @property {number} width
 * @property {number} height
 * @property {number} bytes
 *
 * @typedef {Object} InspectResult
 * @property {number} triangles
 * @property {number} vertices
 * @property {number} meshes
 * @property {number} primitives
 * @property {number} drawCalls
 * @property {number} nodes
 * @property {number} materials
 * @property {number} animations
 * @property {TextureStat[]} textures
 * @property {number} textureBytes
 * @property {{ min: number[], max: number[], size: number[] }} bounds
 * @property {string[]} extensions
 * @property {Issue[]} issues
 */

const LARGE_TEXTURE = 2048;
const HIGH_TRIANGLES = 200_000;
const MANY_DRAW_CALLS = 50;

// Extensions that indicate a non metal/rough PBR workflow, which tends to
// render differently (often grey or washed out) in web renderers.
const NON_PBR_EXTENSIONS = {
  KHR_materials_pbrSpecularGlossiness: 'Specular/glossiness workflow is deprecated and poorly supported on the web.',
  KHR_materials_unlit: 'Unlit materials ignore scene lighting; the lighting preset will have no effect on them.',
};

/**
 * Count rendered triangles for a primitive (handles indexed, non-indexed,
 * strips and fans). Points and lines count as zero.
 * @param {import('@gltf-transform/core').Primitive} prim
 */
function countTriangles(prim) {
  const indices = prim.getIndices();
  const position = prim.getAttribute('POSITION');
  const count = indices ? indices.getCount() : position ? position.getCount() : 0;
  switch (prim.getMode()) {
    case 4: return Math.floor(count / 3); // TRIANGLES
    case 5: // TRIANGLE_STRIP
    case 6: return Math.max(0, count - 2); // TRIANGLE_FAN
    default: return 0;
  }
}

/** @param {Uint8Array | null} image */
function readImageSize(image, mimeType) {
  if (!image || image.byteLength < 24) return { width: 0, height: 0 };
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  if (mimeType === 'image/png') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset < view.byteLength - 9) {
      if (view.getUint8(offset) !== 0xff) { offset++; continue; }
      const marker = view.getUint8(offset + 1);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  if (mimeType === 'image/webp' && image.byteLength >= 30) {
    const chunk = String.fromCharCode(...image.subarray(12, 16));
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = image.subarray(21, 25);
      return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X') {
      return {
        width: 1 + (image[24] | (image[25] << 8) | (image[26] << 16)),
        height: 1 + (image[27] | (image[28] << 8) | (image[29] << 16)),
      };
    }
  }
  return { width: 0, height: 0 };
}

const isPowerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * Health-check a glTF document: counts, texture stats, bounds and a list of
 * issues with suggested fixes. Works in Node and the browser.
 * @param {Document} doc
 * @returns {InspectResult}
 */
export function inspectDocument(doc) {
  const root = doc.getRoot();
  /** @type {Issue[]} */
  const issues = [];

  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  let drawCalls = 0;
  let missingNormals = 0;

  const meshes = root.listMeshes();
  // Draw calls depend on how many nodes reference each mesh.
  const meshUsage = new Map();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh) meshUsage.set(mesh, (meshUsage.get(mesh) || 0) + 1);
  }

  for (const mesh of meshes) {
    const uses = meshUsage.get(mesh) || 0;
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const tris = countTriangles(prim);
      const position = prim.getAttribute('POSITION');
      triangles += tris * uses;
      vertices += (position ? position.getCount() : 0) * uses;
      drawCalls += uses;
      if (tris > 0 && !prim.getAttribute('NORMAL')) missingNormals++;
    }
  }

  const textures = root.listTextures().map((texture) => {
    const image = texture.getImage();
    const mimeType = texture.getMimeType();
    const { width, height } = texture.getSize() ? { width: texture.getSize()[0], height: texture.getSize()[1] } : readImageSize(image, mimeType);
    return { name: texture.getName() || texture.getURI() || '(unnamed)', mimeType, width, height, bytes: image ? image.byteLength : 0 };
  });
  const textureBytes = textures.reduce((sum, t) => sum + t.bytes, 0);

  // Bounds across all scenes.
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const scene of root.listScenes()) {
    if (!scene.listChildren().length) continue;
    const b = getBounds(scene);
    min = min.map((v, i) => Math.min(v, b.min[i]));
    max = max.map((v, i) => Math.max(v, b.max[i]));
  }
  if (!Number.isFinite(min[0])) { min = [0, 0, 0]; max = [0, 0, 0]; }
  const size = max.map((v, i) => v - min[i]);

  const extensions = root.listExtensionsUsed().map((ext) => ext.extensionName);

  // ---- Issues -------------------------------------------------------------
  if (triangles > HIGH_TRIANGLES) {
    issues.push({
      level: 'warning', code: 'high-triangle-count',
      message: `${triangles.toLocaleString('en-US')} triangles is heavy for the web (mid-range phones struggle above ~${(HIGH_TRIANGLES / 1000)}k).`,
      fix: 'Run `mesh2web optimize` with a preset; simplification reduces triangles while preserving silhouette and UV seams.',
    });
  }
  if (drawCalls > MANY_DRAW_CALLS) {
    issues.push({
      level: 'warning', code: 'many-draw-calls',
      message: `${drawCalls} draw calls. Each mesh/material pair costs a draw call.`,
      fix: 'mesh2web joins meshes that share a material during optimization.',
    });
  }
  if (missingNormals) {
    issues.push({
      level: 'warning', code: 'missing-normals',
      message: `${missingNormals} primitive(s) have no normals and will look faceted or flat.`,
      fix: 'mesh2web generates smooth normals for primitives without them.',
    });
  }
  for (const [ext, why] of Object.entries(NON_PBR_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      issues.push({ level: 'warning', code: 'non-pbr-material', message: `${ext}: ${why}`, fix: 'Re-export with Principled BSDF (Blender) or a metal/rough material.' });
    }
  }
  for (const material of root.listMaterials()) {
    const metallic = material.getMetallicFactor();
    const roughness = material.getRoughnessFactor();
    if (metallic === 1 && roughness === 1 && !material.getMetallicRoughnessTexture()) {
      issues.push({
        level: 'info', code: 'default-metal-rough',
        message: `Material "${material.getName() || '(unnamed)'}" is fully metallic and fully rough (glTF defaults). It will look dark grey under most lighting.`,
        fix: 'If the surface is not metal, set metallic to 0 in your DCC tool before exporting.',
      });
    }
  }
  for (const t of textures) {
    if (Math.max(t.width, t.height) > LARGE_TEXTURE) {
      issues.push({
        level: 'warning', code: 'large-texture',
        message: `Texture "${t.name}" is ${t.width}×${t.height}. GPU memory: ~${Math.round((t.width * t.height * 4 * 1.33) / 1048576)}MB.`,
        fix: `Presets cap textures at ${LARGE_TEXTURE}px or less.`,
      });
    }
    if (t.width && t.height && (!isPowerOfTwo(t.width) || !isPowerOfTwo(t.height))) {
      issues.push({ level: 'info', code: 'npot-texture', message: `Texture "${t.name}" (${t.width}×${t.height}) is not a power of two; mipmaps may be lower quality on some GPUs.` });
    }
  }
  const largest = Math.max(...size);
  if (largest > 50) {
    issues.push({
      level: 'warning', code: 'scale-too-large',
      message: `Model spans ${largest.toFixed(1)} units. glTF uses meters; this was probably exported in centimeters.`,
      fix: '<web-model> auto-frames the camera, but physics/AR use real-world scale. Set export units to meters.',
    });
  } else if (largest > 0 && largest < 0.01) {
    issues.push({ level: 'warning', code: 'scale-too-small', message: `Model spans ${largest.toFixed(4)} units (under 1cm). Check export units.` });
  }
  if (size[2] > size[1] * 3 && size[2] > size[0] * 1.5) {
    issues.push({
      level: 'info', code: 'possible-z-up',
      message: 'Model is much deeper (Z) than tall (Y). If it appears lying down, it was exported Z-up.',
      fix: 'glTF is Y-up. Enable "+Y Up" in your exporter.',
    });
  }
  const unused = {
    textures: root.listTextures().filter((t) => t.listParents().length <= 1).length,
    materials: root.listMaterials().filter((m) => m.listParents().length <= 1).length,
    meshes: meshes.filter((m) => !meshUsage.has(m)).length,
  };
  const unusedTotal = unused.textures + unused.materials + unused.meshes;
  if (unusedTotal) {
    issues.push({
      level: 'info', code: 'unused-resources',
      message: `Unused resources: ${unused.meshes} mesh(es), ${unused.materials} material(s), ${unused.textures} texture(s).`,
      fix: 'mesh2web prunes unused resources during optimization.',
    });
  }

  return {
    triangles, vertices, meshes: meshes.length, primitives, drawCalls,
    nodes: root.listNodes().length,
    materials: root.listMaterials().length,
    animations: root.listAnimations().length,
    textures, textureBytes,
    bounds: { min, max, size },
    extensions,
    issues,
  };
}

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import {
  checkBudget, createEmbedSnippet, estimateGpuBytes, inspectDocument, ktx2Settings, ktx2Size,
  ktx2Textures, optimizeDocument,
} from '../src/index.js';
import { createIO, optimizeFile, readModel } from '../src/node.js';

/** A quad with a base color and a normal map (PNG), as a glTF-Transform document. */
async function texturedQuad(size = 300) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const normal = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  // Noisy, not solid: `prune` folds solid-color textures into material factors.
  const png = (r, g, b) => {
    const data = Buffer.alloc(size * size * 3);
    for (let i = 0; i < data.length; i += 3) {
      const n = (i * 2654435761) % 64;
      data[i] = r - n / 2; data[i + 1] = g - n / 4; data[i + 2] = b - n / 8;
    }
    return sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  };
  const color = doc.createTexture('color').setImage(new Uint8Array(await png(200, 120, 40))).setMimeType('image/png');
  const nrm = doc.createTexture('normal').setImage(new Uint8Array(await png(128, 128, 255))).setMimeType('image/png');
  const material = doc.createMaterial('m').setBaseColorTexture(color).setNormalTexture(nrm).setMetallicFactor(0);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normal).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 2, 1, 0, 3, 2])).setBuffer(buffer))
    .setMaterial(material);
  doc.createScene().addChild(doc.createNode('quad').setMesh(doc.createMesh('quad').addPrimitive(prim)));
  return doc;
}

describe('KTX2 helpers', () => {
  it('snaps sizes to powers of two within maxSize', () => {
    expect(ktx2Size(300, 300)).toEqual({ width: 256, height: 256 });
    expect(ktx2Size(400, 200)).toEqual({ width: 512, height: 256 });
    expect(ktx2Size(4096, 2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(ktx2Size(2, 3)).toEqual({ width: 4, height: 4 });
  });

  it('picks ETC1S sRGB for color, UASTC linear for normal maps', () => {
    const color = ktx2Settings(['baseColorTexture']);
    expect(color).toMatchObject({ kind: 'color', isUASTC: false, isSetKTX2SRGBTransferFunc: true, isPerceptual: true });
    const normal = ktx2Settings(['normalTexture']);
    expect(normal).toMatchObject({ kind: 'normal', isUASTC: true, isNormalMap: true, isSetKTX2SRGBTransferFunc: false });
    expect(ktx2Settings(['metallicRoughnessTexture'])).toMatchObject({ kind: 'data', isUASTC: false, isPerceptual: false });
    expect(ktx2Settings(['baseColorTexture'], { mode: 'uastc' }).isUASTC).toBe(true);
    expect(ktx2Settings(['normalTexture'], { mode: 'etc1s' }).isUASTC).toBe(false);
  });

  it('estimates GPU memory (KTX2 is 4× smaller than RGBA8)', () => {
    expect(estimateGpuBytes(1024, 1024, 'image/png')).toBe(Math.round(1024 * 1024 * 4 * 4 / 3));
    expect(estimateGpuBytes(1024, 1024, 'image/ktx2') * 4).toBeCloseTo(estimateGpuBytes(1024, 1024, 'image/webp'), -1);
  });

  it('checks the texture memory budget', () => {
    const r = checkBudget({ bytes: 1, triangles: 1, textureGpuBytes: 6 * 1048576 }, { maxTextureMemoryMB: 4 });
    expect(r.ok).toBe(false);
    expect(r.violations[0].metric).toBe('texture-memory');
    expect(checkBudget({ bytes: 1, triangles: 1, textureGpuBytes: 1 }, { maxTextureMemoryMB: 4 }).ok).toBe(true);
  });

  it('runs through the pipeline with injected encoder/decoder', async () => {
    const doc = await texturedQuad();
    const calls = [];
    const deps = {
      ktx2Transform: (opts) => ktx2Textures(opts, {
        decode: async (_img, _type, size) => ({ data: new Uint8Array(size.width * size.height * 4), ...size }),
        encode: async (_img, o) => { const d = await o.imageDecoder(); calls.push({ ...o, ...d }); return new Uint8Array([0xab, 0x4b, 0x54, 0x58]); },
      }),
    };
    await optimizeDocument(doc, { simplify: false, geometry: 'none', textures: { format: 'ktx2', maxSize: 128 } }, deps);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.width === 128 && c.height === 128)).toBe(true);
    expect(calls.map((c) => c.isUASTC).sort()).toEqual([false, true]);
    const root = doc.getRoot();
    expect(root.listTextures().every((t) => t.getMimeType() === 'image/ktx2')).toBe(true);
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).toContain('KHR_texture_basisu');
  });

  it('builds AR embed attributes', () => {
    const html = createEmbedSnippet({ src: 'a.glb', ar: { src: 'a.ar.glb', iosSrc: 'a.usdz' } });
    expect(html).toMatch(/\n {2}ar\n/);
    expect(html).toContain('ar-src="a.ar.glb"');
    expect(html).toContain('ios-src="a.usdz"');
    expect(createEmbedSnippet({ src: 'a.glb' })).not.toContain('ar-src');
  });
});

describe('KTX2 + AR in Node (real Basis encoder)', () => {
  it('encodes textures to KTX2, writes the AR variant and cuts GPU memory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mesh2web-ktx2-'));
    const io = await createIO();
    const input = path.join(dir, 'quad.glb');
    await writeFile(input, await io.writeBinary(await texturedQuad(512)));

    const { report, files, arFile } = await optimizeFile(input, {
      outDir: dir, name: 'out', ar: true,
      optimize: { preset: 'product', simplify: false, lod: [1], textures: { format: 'ktx2', maxSize: 256 } },
    });
    const main = await readModel(files[0]);
    const textures = main.getRoot().listTextures();
    expect(textures.map((t) => t.getMimeType())).toEqual(['image/ktx2', 'image/ktx2']);
    expect(textures.map((t) => t.getSize())).toEqual([[256, 256], [256, 256]]);
    // KTX2 container magic: «KTX 20»
    expect(Array.from(textures[0].getImage().subarray(1, 7))).toEqual([0x4b, 0x54, 0x58, 0x20, 0x32, 0x30]);
    expect(report.after.stats.textureGpuBytes).toBeLessThan(report.before.stats.textureGpuBytes / 4);

    // The AR variant keeps PNG/JPEG textures and Draco geometry (no Meshopt, no KTX2).
    const ar = inspectDocument(await readModel(arFile));
    expect(ar.textures.every((t) => /png|jpeg/.test(t.mimeType))).toBe(true);
    expect(ar.extensions).toContain('KHR_draco_mesh_compression');
    expect(ar.extensions).not.toContain('EXT_meshopt_compression');
    expect(ar.extensions).not.toContain('KHR_texture_basisu');
    const embed = await readFile(path.join(dir, 'out.embed.html'), 'utf8');
    expect(embed).toContain('ar-src="out.ar.glb"');
    expect(embed).not.toContain('ios-src'); // no USDZ converter given
  });
});

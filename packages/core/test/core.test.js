import { describe, expect, it, beforeAll } from 'vitest';
import { Document } from '@gltf-transform/core';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import {
  checkBudget, createEmbedSnippet, createReport, estimateLoadTime, inspectDocument,
  objToDocument, optimizeDocument, renderHtmlReport, resolveOptions,
} from '../src/index.js';
import { createIO } from '../src/node.js';

/** A non-indexed, normal-less grid: the kind of mesh sloppy exporters produce. */
function makeDirtyDocument(segments = 60) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = [];
  const v = (i, j) => [i / segments - 0.5, Math.sin(i * 0.3) * Math.cos(j * 0.3) * 0.1, j / segments - 0.5];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      pos.push(...v(i, j), ...v(i, j + 1), ...v(i + 1, j));
      pos.push(...v(i, j + 1), ...v(i + 1, j + 1), ...v(i + 1, j));
    }
  }
  const material = doc.createMaterial('mat');
  doc.createMaterial('mat.001'); // unused
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setMaterial(material);
  const mesh = doc.createMesh('grid').addPrimitive(prim);
  doc.createMesh('orphan');
  doc.createScene().addChild(doc.createNode('grid').setMesh(mesh));
  return doc;
}

describe('inspectDocument', () => {
  it('counts triangles, draw calls and reports issues', () => {
    const stats = inspectDocument(makeDirtyDocument(10));
    expect(stats.triangles).toBe(200);
    expect(stats.drawCalls).toBe(1);
    expect(stats.bounds.size[0]).toBeCloseTo(1, 1);
    const codes = stats.issues.map((i) => i.code);
    expect(codes).toContain('missing-normals');
    expect(codes).toContain('unused-resources');
  });

  it('flags centimeter-scale models', () => {
    const doc = makeDirtyDocument(2);
    doc.getRoot().listNodes()[0].setScale([200, 200, 200]);
    expect(inspectDocument(doc).issues.map((i) => i.code)).toContain('scale-too-large');
  });
});

describe('resolveOptions', () => {
  it('merges preset defaults with overrides', () => {
    const o = resolveOptions({ preset: 'hero', textures: { maxSize: 512 } });
    expect(o.preset).toBe('hero');
    expect(o.textures.maxSize).toBe(512);
    expect(o.textures.format).toBe('webp');
    expect(o.budget.maxTriangles).toBe(150000);
  });
  it('rejects unknown presets', () => {
    expect(() => resolveOptions({ preset: 'nope' })).toThrow(/Unknown preset/);
  });
  it('allows disabling a step', () => {
    expect(resolveOptions({ simplify: false }).simplify).toBe(false);
  });
});

describe('optimizeDocument', () => {
  beforeAll(async () => { await createIO(); });

  it('welds, prunes, adds normals, simplifies and compresses', async () => {
    const doc = makeDirtyDocument(80);
    const before = inspectDocument(doc);
    const steps = [];
    await optimizeDocument(doc, { preset: 'ambient', budget: { maxTriangles: 2000 } }, {
      simplifier: MeshoptSimplifier, encoder: MeshoptEncoder, onStep: (s) => steps.push(s),
    });
    const after = inspectDocument(doc);
    expect(steps).toEqual(expect.arrayContaining(['clean', 'normals', 'simplify', 'compress:meshopt']));
    expect(after.triangles).toBeLessThan(before.triangles);
    expect(after.triangles).toBeLessThanOrEqual(2000);
    expect(after.materials).toBe(1);
    expect(after.meshes).toBe(1);
    expect(after.issues.map((i) => i.code)).not.toContain('missing-normals');
    expect(after.extensions).toContain('EXT_meshopt_compression');

    const io = await createIO();
    const glb = await io.writeBinary(doc);
    const roundTrip = inspectDocument(await io.readBinary(glb));
    expect(roundTrip.triangles).toBe(after.triangles);
  });

  it('respects fitBudget: false', async () => {
    const doc = makeDirtyDocument(40);
    await optimizeDocument(doc, { simplify: false, geometry: 'none', fitBudget: false, budget: { maxTriangles: 10 } }, { simplifier: MeshoptSimplifier });
    expect(inspectDocument(doc).triangles).toBe(3200);
  });
});

describe('objToDocument', () => {
  it('parses quads, negative indices and MTL colors', () => {
    const obj = `mtllib a.mtl\no Quad\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nusemtl Red\nf -4//1 -3//1 -2//1 -1//1\n`;
    const doc = objToDocument(obj, { mtlText: 'newmtl Red\nKd 1 0 0\n' });
    const stats = inspectDocument(doc);
    expect(stats.triangles).toBe(2);
    expect(stats.vertices).toBe(4);
    const material = doc.getRoot().listMaterials()[0];
    expect(material.getBaseColorFactor()).toEqual([1, 0, 0, 1]);
    expect(material.getMetallicFactor()).toBe(0);
  });
});

describe('report', () => {
  const stats = (triangles, drawCalls = 2) => ({ ...inspectDocument(new Document()), triangles, drawCalls });

  it('computes reductions, load times and budgets', () => {
    const report = createReport({
      name: 'robot', preset: 'hero',
      before: { bytes: 10 * 1024 * 1024, stats: stats(400000) },
      after: { bytes: 1024 * 1024, stats: stats(100000) },
      budget: { maxSizeKB: 500, maxTriangles: 150000 },
    });
    expect(report.reduction.bytes).toBeCloseTo(0.9);
    expect(report.reduction.triangles).toBeCloseTo(0.75);
    expect(report.budget.ok).toBe(false);
    expect(report.budget.violations[0].metric).toBe('size');
    expect(report.loadTimeMs['slow-4g']).toBeGreaterThan(report.loadTimeMs['fast-4g']);
    const html = renderHtmlReport(report);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Over budget');
  });

  it('escapes names in HTML', () => {
    const report = createReport({ name: '<img onerror=x>', preset: 'hero', before: { bytes: 1, stats: stats(1) }, after: { bytes: 1, stats: stats(1) } });
    expect(renderHtmlReport(report)).not.toContain('<img onerror');
  });

  it('checkBudget and estimateLoadTime', () => {
    expect(checkBudget({ bytes: 100, triangles: 5 }, { maxSizeKB: 1, maxTriangles: 10 }).ok).toBe(true);
    expect(estimateLoadTime(0)['wifi']).toBe(20);
  });

  it('builds embed snippets', () => {
    const html = createEmbedSnippet({ src: '/3d/a.glb', lods: ['/3d/a.lod1.glb'], poster: '/3d/a.webp', alt: 'A "quoted" robot' });
    expect(html).toContain('lod-src="/3d/a.lod1.glb"');
    expect(html).toContain('&quot;quoted&quot;');
  });
});

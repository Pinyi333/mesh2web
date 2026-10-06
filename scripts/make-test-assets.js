#!/usr/bin/env node
/**
 * Generates CC0 procedural test models into test-assets/.
 * Every asset is created from code, so licensing is unambiguous.
 *
 *  - bad-knot.glb    A deliberately "dirty" export: unwelded 300k+ triangle
 *                    torus knot, duplicated materials, unused data, a 4096px
 *                    PNG texture and a mesh without normals.
 *  - sculpture.glb   A smooth, displaced sculpture used by the demos.
 *  - pebble.obj/.mtl A small OBJ with an MTL color, to test OBJ import.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { createIO } from '../packages/core/src/node.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test-assets');

/** Parametric surface → indexed grid with positions, normals and UVs. */
function parametric(fn, uSeg, vSeg) {
  const pos = [];
  const uv = [];
  for (let j = 0; j <= vSeg; j++) {
    for (let i = 0; i <= uSeg; i++) {
      const [x, y, z] = fn(i / uSeg, j / vSeg);
      pos.push(x, y, z);
      uv.push(i / uSeg, j / vSeg);
    }
  }
  const idx = [];
  for (let j = 0; j < vSeg; j++) {
    for (let i = 0; i < uSeg; i++) {
      const a = j * (uSeg + 1) + i;
      const b = a + uSeg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos, uv, idx, nor: computeNormals(pos, idx) };
}

function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) { n[v] += cr[0]; n[v + 1] += cr[1]; n[v + 2] += cr[2]; }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l; n[v + 1] /= l; n[v + 2] /= l;
  }
  return Array.from(n);
}

/** Expand an indexed mesh into a non-indexed one (what sloppy exporters do). */
function unweld({ pos, uv, nor, idx }) {
  const out = { pos: [], uv: [], nor: [] };
  for (const i of idx) {
    out.pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    out.uv.push(uv[i * 2], uv[i * 2 + 1]);
    out.nor.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
  }
  return out;
}

function addPrimitive(doc, buffer, geo, material, { indexed = true, withNormals = true, withUv = true } = {}) {
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(geo.pos)))
    .setMaterial(material);
  if (withNormals) prim.setAttribute('NORMAL', acc('VEC3', new Float32Array(geo.nor)));
  if (withUv) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(geo.uv)));
  if (indexed) prim.setIndices(acc('SCALAR', new Uint32Array(geo.idx)));
  return prim;
}

function torusKnot(p = 2, q = 3, R = 1, r = 0.32) {
  return (u, v) => {
    const t = u * Math.PI * 2 * p;
    const curve = (s) => {
      const cu = Math.cos(s), su = Math.sin(s), quOverP = (q / p) * s, cs = Math.cos(quOverP);
      return [R * (2 + cs) * 0.5 * cu, R * (2 + cs) * su * 0.5, R * Math.sin(quOverP) * 0.5];
    };
    const P1 = curve(t), P2 = curve(t + 0.01);
    const T = P2.map((x, i) => x - P1[i]);
    const N = P2.map((x, i) => x + P1[i]);
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    const N2 = [B[1] * T[2] - B[2] * T[1], B[2] * T[0] - B[0] * T[2], B[0] * T[1] - B[1] * T[0]];
    const nb = Math.hypot(...B), nn = Math.hypot(...N2);
    const a = v * Math.PI * 2;
    const cx = -r * Math.cos(a), cy = r * Math.sin(a);
    return P1.map((x, i) => x + cx * (N2[i] / nn) + cy * (B[i] / nb));
  };
}

async function noiseTexture(size) {
  const data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.sin(x * 0.02) * Math.cos(y * 0.015) * 0.5 + 0.5;
      const o = (y * size + x) * 3;
      data[o] = 200 + v * 55; data[o + 1] = 90 + v * 120; data[o + 2] = 60 + v * 40;
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 3 }).toBuffer();
}

async function makeBadKnot(io) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const texture = doc.createTexture('albedo_4k').setImage(new Uint8Array(await noiseTexture(4096))).setMimeType('image/png');
  const matA = doc.createMaterial('Copper').setBaseColorTexture(texture).setMetallicFactor(1).setRoughnessFactor(0.35);
  const matB = doc.createMaterial('Copper.001').setBaseColorTexture(texture).setMetallicFactor(1).setRoughnessFactor(0.35);
  doc.createMaterial('Unused_Material').setBaseColorFactor([1, 0, 0, 1]);

  const knot = unweld(parametric(torusKnot(), 1200, 140));
  const mesh = doc.createMesh('Knot').addPrimitive(addPrimitive(doc, buffer, knot, matA, { indexed: false }));
  const ring = parametric((u, v) => {
    const a = u * Math.PI * 2, b = v * Math.PI * 2;
    return [(1.45 + 0.05 * Math.cos(b)) * Math.cos(a), 0.05 * Math.sin(b) - 0.9, (1.45 + 0.05 * Math.cos(b)) * Math.sin(a)];
  }, 256, 24);
  const ringMesh = doc.createMesh('Ring').addPrimitive(addPrimitive(doc, buffer, ring, matB, { withNormals: false }));
  doc.createMesh('Unused_Mesh').addPrimitive(addPrimitive(doc, buffer, parametric((u, v) => [u, v, 0], 4, 4), matA));

  const scene = doc.createScene('Scene');
  const group = doc.createNode('Empty_Group');
  group.addChild(doc.createNode('Knot').setMesh(mesh));
  group.addChild(doc.createNode('Ring').setMesh(ringMesh));
  group.addChild(doc.createNode('Empty_Leaf'));
  scene.addChild(group);
  await writeFile(path.join(outDir, 'bad-knot.glb'), await io.writeBinary(doc));
}

async function makeSculpture(io) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const body = doc.createMaterial('Ceramic').setBaseColorFactor([0.86, 0.82, 0.76, 1]).setMetallicFactor(0).setRoughnessFactor(0.42);
  const accent = doc.createMaterial('Gold').setBaseColorFactor([1, 0.78, 0.34, 1]).setMetallicFactor(1).setRoughnessFactor(0.22);

  const blob = parametric((u, v) => {
    const theta = u * Math.PI * 2, phi = v * Math.PI;
    const d = 1 + 0.18 * Math.sin(3 * theta + 2 * phi) * Math.sin(phi) + 0.07 * Math.sin(9 * phi + theta);
    return [d * Math.sin(phi) * Math.cos(theta), d * Math.cos(phi) * 1.05, d * Math.sin(phi) * Math.sin(theta)];
  }, 220, 140);
  const ring = parametric(torusKnot(3, 5, 1.25, 0.06), 900, 24);

  const scene = doc.createScene('Scene');
  scene.addChild(doc.createNode('Body').setMesh(doc.createMesh('Body').addPrimitive(addPrimitive(doc, buffer, blob, body))));
  scene.addChild(doc.createNode('Orbit').setMesh(doc.createMesh('Orbit').addPrimitive(addPrimitive(doc, buffer, ring, accent))).setRotation([0.2588, 0, 0, 0.9659]));
  await writeFile(path.join(outDir, 'sculpture.glb'), await io.writeBinary(doc));
}

async function makePebble() {
  const geo = parametric((u, v) => {
    const theta = u * Math.PI * 2, phi = v * Math.PI;
    return [1.2 * Math.sin(phi) * Math.cos(theta), 0.55 * Math.cos(phi), 0.9 * Math.sin(phi) * Math.sin(theta)];
  }, 48, 24);
  const lines = ['# mesh2web CC0 test pebble', 'mtllib pebble.mtl', 'o Pebble'];
  for (let i = 0; i < geo.pos.length; i += 3) lines.push(`v ${geo.pos[i].toFixed(5)} ${geo.pos[i + 1].toFixed(5)} ${geo.pos[i + 2].toFixed(5)}`);
  for (let i = 0; i < geo.uv.length; i += 2) lines.push(`vt ${geo.uv[i].toFixed(5)} ${(1 - geo.uv[i + 1]).toFixed(5)}`);
  lines.push('usemtl Stone');
  for (let k = 0; k < geo.idx.length; k += 3) {
    const [a, b, c] = [geo.idx[k] + 1, geo.idx[k + 1] + 1, geo.idx[k + 2] + 1];
    lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
  }
  await writeFile(path.join(outDir, 'pebble.obj'), `${lines.join('\n')}\n`);
  await writeFile(path.join(outDir, 'pebble.mtl'), 'newmtl Stone\nKd 0.42 0.45 0.48\nNs 20\nd 1\n');
}

await mkdir(outDir, { recursive: true });
const io = await createIO();
await Promise.all([makeBadKnot(io), makeSculpture(io), makePebble()]);
console.log('Test assets written to test-assets/');

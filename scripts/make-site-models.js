#!/usr/bin/env node
/**
 * Generates the raw "photogrammetry scan" used on the docs site hero
 * (test-assets/scan-boulder.glb). It imitates a real scan export: a dense,
 * unwelded, vertex-colored mesh with no normals. The site ships the output
 * of `mesh2web optimize` on this file, so the numbers on the page are real.
 * Everything is generated from code (CC0), so licensing is unambiguous.
 *
 *   node scripts/make-site-models.js
 *   node packages/cli/src/bin.js optimize test-assets/scan-boulder.glb --preset hero ...
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '@gltf-transform/core';
import { createIO } from '../packages/core/src/node.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test-assets');

const CONFIG = {
  seed: 7,
  subdivisions: 8, // icosphere level → 20·4^8 ≈ 1.3M triangles
  scale: [1.25, 0.78, 0.95],
};

/* ----------------------------- seeded gradient noise ----------------------------- */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const rand = rng(CONFIG.seed);
const perm = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function noise(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const g = (h, dx, dy, dz) => { const q = G[h % 12]; return q[0] * dx + q[1] * dy + q[2] * dz; };
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(g(perm[AA], x, y, z), g(perm[BA], x - 1, y, z), u), lerp(g(perm[AB], x, y - 1, z), g(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(g(perm[AA + 1], x, y, z - 1), g(perm[BA + 1], x - 1, y, z - 1), u), lerp(g(perm[AB + 1], x, y - 1, z - 1), g(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}
const fbm = (x, y, z, oct, lac = 2.03, gain = 0.5) => {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, z * f); f *= lac; a *= gain; }
  return s;
};
const ridged = (x, y, z, oct) => {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise(x * f + 11, y * f, z * f))) ** 2; f *= 2.1; a *= 0.5; }
  return s;
};

/* ----------------------------- icosphere ----------------------------- */
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  let pos = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]]
    .map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      let i = cache.get(key);
      if (i === undefined) {
        const p = pos[a].map((c, k) => c + pos[b][k]);
        const len = Math.hypot(...p);
        i = pos.push(p.map((c) => c / len)) - 1;
        cache.set(key, i);
      }
      return i;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { pos, faces };
}

/* ----------------------------- boulder ----------------------------- */
function boulder() {
  const { pos, faces } = icosphere(CONFIG.subdivisions);
  const [sx, sy, sz] = CONFIG.scale;
  const P = new Float32Array(pos.length * 3);
  const C = new Float32Array(pos.length * 4);
  const base = [0.64, 0.56, 0.46]; // dusty sandstone
  const dark = [0.27, 0.23, 0.19];
  const light = [0.80, 0.74, 0.64];
  pos.forEach(([x, y, z], i) => {
    // Domain warp gives the chunky, fractured silhouette of a broken rock.
    const wx = x + 0.35 * fbm(x * 1.3 + 4, y * 1.3, z * 1.3, 3);
    const wy = y + 0.35 * fbm(x * 1.3, y * 1.3 + 8, z * 1.3, 3);
    const wz = z + 0.35 * fbm(x * 1.3, y * 1.3, z * 1.3 + 2, 3);
    const big = fbm(wx * 1.1, wy * 1.1, wz * 1.1, 3);
    const ridge = ridged(wx * 2.4, wy * 2.4, wz * 2.4, 4);
    const grain = fbm(x * 22, y * 22, z * 22, 3);
    // Planar cuts (facets) like a split stone.
    const facet = Math.max(0, Math.abs(noise(wx * 1.7 + 30, wy * 1.7, wz * 1.7)) - 0.15) * 0.45;
    let r = 1 + 0.38 * big + 0.16 * ridge - facet + 0.012 * grain;
    let px = x * r * sx, py = y * r * sy, pz = z * r * sz;
    if (py < -0.42) py = -0.42 + (py + 0.42) * 0.12; // flattened base where it rests on the ground
    P.set([px, py, pz], i * 3);
    // Color: cavities darker, ridges lighter, speckles and a slight top bleach.
    const cavity = Math.min(1, Math.max(0, 0.55 - ridge * 0.9 - big * 0.6));
    const speck = Math.max(0, fbm(x * 40 + 3, y * 40, z * 40, 2)) * 1.4;
    const lichen = Math.max(0, fbm(x * 3 + 9, y * 3, z * 3, 3) - 0.12) * 1.6;
    const col = base.map((b, k) => {
      let c = lerp(b, dark[k], cavity * 0.85);
      c = lerp(c, light[k], Math.min(1, ridge * 0.35 + Math.max(0, y) * 0.2));
      c -= speck * 0.12;
      c = lerp(c, [0.48, 0.5, 0.42][k], Math.min(0.5, lichen));
      return Math.min(1, Math.max(0, c + grain * 0.06));
    });
    C.set([...col.map((c) => c ** 2.2), 1], i * 4); // glTF vertex colors are linear
  });
  // Unweld, like a raw scan export.
  const n = faces.length * 3;
  const UP = new Float32Array(n * 3), UC = new Float32Array(n * 4);
  let k = 0;
  for (const f of faces) for (const v of f) { UP.set(P.subarray(v * 3, v * 3 + 3), k * 3); UC.set(C.subarray(v * 4, v * 4 + 4), k * 4); k++; }
  return { pos: UP, col: UC };
}

async function makeBoulder(io) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const { pos, col } = boulder();
  const mat = doc.createMaterial('Scan_Material').setMetallicFactor(0).setRoughnessFactor(0.92);
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', pos)).setAttribute('COLOR_0', acc('VEC4', col)).setMaterial(mat);
  const scene = doc.createScene('Scene');
  scene.addChild(doc.createNode('Scan_0412').setMesh(doc.createMesh('Scan_0412').addPrimitive(prim)));
  await writeFile(path.join(outDir, 'scan-boulder.glb'), await io.writeBinary(doc));
}

await mkdir(outDir, { recursive: true });
await makeBoulder(await createIO());
console.log('Site scan written to test-assets/scan-boulder.glb');

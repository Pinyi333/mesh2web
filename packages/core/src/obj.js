import { Document } from '@gltf-transform/core';

/**
 * Minimal Wavefront OBJ (+ optional MTL) importer producing a glTF document.
 * Supports v / vt / vn / f (polygons are fan-triangulated, negative indices
 * allowed), `o` / `g` objects and `usemtl` materials with Kd / d / Ns colors.
 * Texture maps in MTL files are ignored; bake them into a GLB for full fidelity.
 *
 * @param {string} objText
 * @param {{ mtlText?: string, name?: string }} [options]
 * @returns {Document}
 */
export function objToDocument(objText, { mtlText = '', name = 'model' } = {}) {
  const positions = [];
  const uvs = [];
  const normals = [];
  /** @type {Map<string, { name: string, groups: Map<string, number[][]> }>} */
  const objects = new Map();
  let objectName = name;
  let materialName = '';

  const getGroup = () => {
    if (!objects.has(objectName)) objects.set(objectName, { name: objectName, groups: new Map() });
    const groups = objects.get(objectName).groups;
    if (!groups.has(materialName)) groups.set(materialName, []);
    return groups.get(materialName);
  };

  for (const raw of objText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0];
    switch (keyword) {
      case 'v': positions.push(+parts[1], +parts[2], +parts[3]); break;
      case 'vt': uvs.push(+parts[1], 1 - (+parts[2] || 0)); break; // glTF UV origin is top-left
      case 'vn': normals.push(+parts[1], +parts[2], +parts[3]); break;
      case 'o': case 'g': objectName = parts.slice(1).join(' ') || objectName; break;
      case 'usemtl': materialName = parts.slice(1).join(' '); break;
      case 'f': {
        const corners = parts.slice(1).map((token) => {
          const [v, vt, vn] = token.split('/');
          const resolve = (index, length, size) => {
            if (!index) return -1;
            const i = parseInt(index, 10);
            return i < 0 ? length / size + i : i - 1;
          };
          return [resolve(v, positions.length, 3), resolve(vt, uvs.length, 2), resolve(vn, normals.length, 3)];
        });
        const faces = getGroup();
        for (let i = 1; i < corners.length - 1; i++) faces.push(corners[0], corners[i], corners[i + 1]);
        break;
      }
      default: break;
    }
  }

  const materials = parseMtl(mtlText);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const materialCache = new Map();

  const getMaterial = (mtlName) => {
    if (materialCache.has(mtlName)) return materialCache.get(mtlName);
    const def = materials[mtlName] || {};
    const material = doc.createMaterial(mtlName || 'default')
      .setBaseColorFactor([...(def.color || [0.8, 0.8, 0.8]), def.opacity ?? 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(def.roughness ?? 0.6);
    if ((def.opacity ?? 1) < 1) material.setAlphaMode('BLEND');
    materialCache.set(mtlName, material);
    return material;
  };

  for (const object of objects.values()) {
    const mesh = doc.createMesh(object.name);
    for (const [mtlName, corners] of object.groups) {
      if (!corners.length) continue;
      const hasUv = corners.every((c) => c[1] >= 0);
      const hasNormal = corners.every((c) => c[2] >= 0);
      // De-duplicate identical corner tuples into shared vertices.
      const lookup = new Map();
      const pos = []; const uv = []; const nor = []; const indices = [];
      for (const c of corners) {
        const key = `${c[0]}/${hasUv ? c[1] : ''}/${hasNormal ? c[2] : ''}`;
        let index = lookup.get(key);
        if (index === undefined) {
          index = pos.length / 3;
          lookup.set(key, index);
          pos.push(positions[c[0] * 3], positions[c[0] * 3 + 1], positions[c[0] * 3 + 2]);
          if (hasUv) uv.push(uvs[c[1] * 2], uvs[c[1] * 2 + 1]);
          if (hasNormal) nor.push(normals[c[2] * 3], normals[c[2] * 3 + 1], normals[c[2] * 3 + 2]);
        }
        indices.push(index);
      }
      const vertexCount = pos.length / 3;
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)).setBuffer(buffer))
        .setMaterial(getMaterial(mtlName));
      if (hasUv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
      if (hasNormal) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer));
      mesh.addPrimitive(prim);
    }
    if (mesh.listPrimitives().length) scene.addChild(doc.createNode(object.name).setMesh(mesh));
    else mesh.dispose();
  }
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

/** @param {string} text */
function parseMtl(text) {
  /** @type {Record<string, { color?: number[], opacity?: number, roughness?: number }>} */
  const out = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    switch (parts[0]) {
      case 'newmtl': current = out[parts.slice(1).join(' ')] = {}; break;
      case 'Kd': if (current) current.color = [+parts[1], +parts[2], +parts[3]]; break;
      case 'd': if (current) current.opacity = +parts[1]; break;
      case 'Tr': if (current) current.opacity = 1 - +parts[1]; break;
      // Phong exponent → roughness, a common approximation.
      case 'Ns': if (current) current.roughness = Math.min(1, Math.max(0.04, Math.sqrt(2 / (+parts[1] + 2)))); break;
      default: break;
    }
  }
  return out;
}

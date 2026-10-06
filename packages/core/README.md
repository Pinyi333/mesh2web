# @mesh2web/core

The [mesh2web](https://github.com/pinyi333/mesh2web) optimization pipeline, built on
[glTF-Transform](https://gltf-transform.dev) and [meshoptimizer](https://github.com/zeux/meshoptimizer).

```bash
npm i @mesh2web/core
```

```js
// Node: files in, files out
import { optimizeFile, inspectFile } from '@mesh2web/core/node';

const { report } = await optimizeFile('robot.glb', { outDir: 'public/3d', optimize: { preset: 'hero' } });
console.log(report.after.bytes, report.budget.ok);
```

```js
// Any environment: work on a glTF-Transform Document
import { inspectDocument, optimizeDocument } from '@mesh2web/core';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const stats = inspectDocument(doc);           // triangles, drawCalls, textures, issues[]
await optimizeDocument(doc, { preset: 'product' }, { simplifier: MeshoptSimplifier, encoder: MeshoptEncoder });
```

Exports: `inspectDocument`, `optimizeDocument`, `optimizeWithLods`, `createLods`,
`resolveOptions`, `addSmoothNormals`, `objToDocument`, `createReport`,
`renderHtmlReport`, `checkBudget`, `estimateLoadTime`, `createEmbedSnippet`, and
from `/node`: `readModel`, `writeGLB`, `createIO`, `inspectFile`, `optimizeFile`.

`sharp` is an optional dependency used for texture resizing and WebP in Node.

MIT

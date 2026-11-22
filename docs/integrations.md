# Integrations

[繁體中文](integrations.zh-TW.md) · [Back to README](../README.md)

Every guide starts from the same two files:

```bash
npx @mesh2web/cli optimize model.glb --poster
# → model.glb, model.lod1.glb, model.lod2.glb, model.webp, model.embed.html
```

Upload the `.glb` files and the `.webp` poster somewhere your site can reach, then follow the guide for your stack. If the models live on a different domain from the page, that host must send `Access-Control-Allow-Origin` (GitHub Pages, jsDelivr, Cloudflare R2/Pages and most CDNs do).

- [Three.js](#threejs)
- [Webflow](#webflow)
- [Framer](#framer)
- [WordPress](#wordpress)

## Three.js

**Option A: use the optimized GLB in your own scene.** mesh2web compresses geometry with `EXT_meshopt_compression` by default, so register the Meshopt decoder on `GLTFLoader`:

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('/3d/model.glb');
scene.add(gltf.scene);
```

If you optimized with `--geometry draco`, also call `loader.setDRACOLoader(...)` with a `DRACOLoader`.

**Option B: let `<web-model>` render, and reach into it.** The element exposes its three.js objects once loaded:

```js
import '@mesh2web/element';

const model = document.querySelector('web-model');
await model.ready;
model.scene.traverse((o) => { if (o.isMesh) o.material.roughness = 0.25; });
model.invalidate(); // it renders on demand, so ask for a new frame after changes
```

## Webflow

1. Upload `model.glb`, `model.lod1.glb` and `model.webp` to a host that serves files with CORS (see the note at the top). If your Webflow plan's asset manager accepts `.glb`, you can use it; otherwise GitHub Pages or a CDN bucket works well.
2. **Site settings → Custom code → Head code** (or the page's own settings), add:

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element@0.1/dist/web-model.js"></script>
   ```
3. Drop an **Embed** element where the model should appear and paste:

   ```html
   <web-model
     src="https://your-host.example/3d/model.glb"
     lod-src="https://your-host.example/3d/model.lod1.glb"
     poster="https://your-host.example/3d/model.webp"
     alt="Describe the model"
     autorotate
     style="display:block;width:100%"
   ></web-model>
   ```
4. Publish. Custom code only runs on the published site, not in the Designer canvas, so the Designer shows an empty box.

To drive it with Webflow Interactions or GSAP, give the embed an id and use the [GSAP example](../README.md#scroll-stories-with-gsap) in the page's **Before `</body>` tag** code.

## Framer

1. Host the files as in Webflow step 1 and use **absolute URLs** everywhere.
2. Insert an **Embed** component, set its type to **HTML**, and paste the script tag and the element together:

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element@0.1/dist/web-model.js"></script>
   <web-model
     src="https://your-host.example/3d/model.glb"
     poster="https://your-host.example/3d/model.webp"
     alt="Describe the model"
     autorotate
     style="display:block;width:100%;height:100%;--web-model-aspect-ratio:auto"
   ></web-model>
   ```
3. Size the Embed on the canvas; `--web-model-aspect-ratio:auto` lets the model fill whatever box you draw.

## WordPress

1. **Get the GLB onto your server.** WordPress blocks `.glb` uploads by default. Either upload the files with your host's file manager or SFTP (for example to `/wp-content/uploads/3d/`), or allow the type with a small snippet in a site plugin or a code-snippets plugin:

   ```php
   add_filter('upload_mimes', function ($types) {
     $types['glb'] = 'model/gltf-binary';
     return $types;
   });
   ```

   Some hosts also check the file's contents and still refuse it; the file manager / SFTP route always works.
2. In the block editor, add a **Custom HTML** block:

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element@0.1/dist/web-model.js"></script>
   <web-model
     src="/wp-content/uploads/3d/model.glb"
     lod-src="/wp-content/uploads/3d/model.lod1.glb"
     poster="/wp-content/uploads/3d/model.webp"
     alt="Describe the model"
     autorotate
   ></web-model>
   ```
3. Preview the page. If several posts use models, move the `<script>` tag into the theme's header (or a header-scripts plugin) once instead of repeating it.

## Anything else

`<web-model>` is a standard Custom Element, so any tool that lets you paste HTML can host it: Squarespace code blocks, Shopify theme sections, Wix custom elements, Astro, Eleventy and so on. The two rules are always the same: load the script once, and serve the models with CORS if they live on another domain.

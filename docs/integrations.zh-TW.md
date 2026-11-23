# 整合範例

[English](integrations.md) · [回到 README](../README.zh-TW.md)

每份教學都從同樣的檔案開始：

```bash
npx @mesh2web/cli optimize model.glb --poster
# → model.glb、model.lod1.glb、model.lod2.glb、model.webp、model.embed.html
```

把 `.glb` 和 `.webp` poster 上傳到網站讀得到的地方，再依你的工具照著做。模型若放在和網頁不同的網域，該主機必須回傳 `Access-Control-Allow-Origin`（GitHub Pages、jsDelivr、Cloudflare R2/Pages 與多數 CDN 都有）。

- [Three.js](#threejs)
- [Webflow](#webflow)
- [Framer](#framer)
- [WordPress](#wordpress)

## Three.js

**做法 A：在自己的場景裡使用優化後的 GLB。** mesh2web 預設以 `EXT_meshopt_compression` 壓縮幾何，所以要在 `GLTFLoader` 註冊 Meshopt 解碼器：

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('/3d/model.glb');
scene.add(gltf.scene);
```

若用 `--geometry draco` 優化，另外以 `DRACOLoader` 呼叫 `loader.setDRACOLoader(...)`。

**做法 B：交給 `<web-model>` 渲染，再取用內部物件。** 載入後元件會公開 three.js 物件：

```js
import '@mesh2web/element';

const model = document.querySelector('web-model');
await model.ready;
model.scene.traverse((o) => { if (o.isMesh) o.material.roughness = 0.25; });
model.invalidate(); // 元件只在需要時渲染，修改後要請它重畫一格
```

## Webflow

1. 把 `model.glb`、`model.lod1.glb`、`model.webp` 上傳到支援 CORS 的主機（見上方說明）。如果你的 Webflow 方案資產庫接受 `.glb` 可以直接用，否則 GitHub Pages 或 CDN 儲存桶都很適合。
2. 在 **Site settings → Custom code → Head code**（或單頁設定）加入：

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element@0.1/dist/web-model.js"></script>
   ```
3. 在要放模型的位置拖入 **Embed** 元素並貼上：

   ```html
   <web-model
     src="https://your-host.example/3d/model.glb"
     lod-src="https://your-host.example/3d/model.lod1.glb"
     poster="https://your-host.example/3d/model.webp"
     alt="描述這個模型"
     autorotate
     style="display:block;width:100%"
   ></web-model>
   ```
4. 發布。自訂程式碼只在發布後的網站執行，Designer 畫布上會是空白框，這是正常的。

想用 Webflow Interactions 或 GSAP 控制，替 Embed 加上 id，並把 [GSAP 範例](../README.zh-TW.md#搭配-gsap-做滾動敘事) 放進頁面的 **Before `</body>` tag** 程式碼。

## Framer

1. 依 Webflow 第 1 步放好檔案，所有路徑都用**絕對網址**。
2. 插入 **Embed** 元件，類型選 **HTML**，把 script 與元素一起貼上：

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element@0.1/dist/web-model.js"></script>
   <web-model
     src="https://your-host.example/3d/model.glb"
     poster="https://your-host.example/3d/model.webp"
     alt="描述這個模型"
     autorotate
     style="display:block;width:100%;height:100%;--web-model-aspect-ratio:auto"
   ></web-model>
   ```
3. 在畫布上調整 Embed 大小；`--web-model-aspect-ratio:auto` 會讓模型填滿你拉出的框。

## WordPress

1. **把 GLB 放上主機。** WordPress 預設不允許上傳 `.glb`。可以用主機的檔案管理員或 SFTP 上傳（例如放到 `/wp-content/uploads/3d/`），或在網站外掛／程式碼片段外掛中允許這個類型：

   ```php
   add_filter('upload_mimes', function ($types) {
     $types['glb'] = 'model/gltf-binary';
     return $types;
   });
   ```

   部分主機還會檢查檔案內容而照樣拒絕；檔案管理員／SFTP 一定可行。
2. 在區塊編輯器加入 **自訂 HTML** 區塊：

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element@0.1/dist/web-model.js"></script>
   <web-model
     src="/wp-content/uploads/3d/model.glb"
     lod-src="/wp-content/uploads/3d/model.lod1.glb"
     poster="/wp-content/uploads/3d/model.webp"
     alt="描述這個模型"
     autorotate
   ></web-model>
   ```
3. 預覽頁面。若多篇文章都會用到模型，把 `<script>` 移到佈景主題的 header（或 header 腳本外掛）放一次即可，不用每篇重複。

## 其他工具

`<web-model>` 是標準 Custom Element，任何能貼 HTML 的工具都能用：Squarespace 程式碼區塊、Shopify 佈景區段、Wix 自訂元素、Astro、Eleventy 等。原則永遠相同：script 載入一次；模型放在其他網域時要支援 CORS。

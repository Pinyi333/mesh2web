<p align="center">
  <img src="apps/docs/models/sculpture.webp" width="420" alt="由 mesh2web 渲染的陶瓷雕塑與金色緞帶">
</p>

<h1 align="center">mesh2web</h1>

<p align="center"><strong>把任何 3D 模型，變成輕量、好看、可直接放上網頁的元件。</strong></p>

<p align="center">
  <a href="https://pinyi333.github.io/mesh2web/">官網</a> ·
  <a href="https://pinyi333.github.io/mesh2web/studio/">Studio</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#web-model">&lt;web-model&gt;</a> ·
  <a href="README.md">English</a>
</p>

```
34.0 MB → 556 KB   ·   348,288 → 77,600 面   ·   −98%   ·   慢速 4G 約 2.9 秒
```
<sub>以 <code>test-assets/bad-knot.glb</code>（刻意做髒的匯出檔）搭配 <code>product</code> preset 實測。</sub>

---

把 3D 放上網路，失敗點分散在「匯出 → 優化 → 嵌入 → 呈現 → 互動 → 維護」整條鏈上，每一環需要的專業都不同。mesh2web 用一條**開源、可自架、不綁框架**的流程，把整條鏈串起來：

| 套件 | 功能 |
|---|---|
| [`@mesh2web/cli`](packages/cli) | `inspect`、`optimize`、`build --watch`，以及可接 CI 的體積與面數預算 |
| [`@mesh2web/element`](packages/element) | `<web-model>`：poster 優先、延遲載入、自適應品質、為 GSAP 設計的 Web Component |
| [`@mesh2web/core`](packages/core) | 優化管線本體（Node 與瀏覽器共用），建立在 glTF-Transform 與 meshoptimizer 之上 |
| [`@mesh2web/presets`](packages/presets) | 優化 preset（`hero`、`product`、`ambient`）與燈光 preset |
| [Studio](apps/studio) | 拖曳即用的網頁 GUI，全部在瀏覽器本地處理，模型不會上傳 |

## 快速開始

```bash
npx @mesh2web/cli optimize robot.glb        # 預設 preset：product
```

會產出 `robot.glb`、LOD 檔、`robot.report.html`（處理前後對照報告）和 `robot.embed.html`。把嵌入碼貼進網頁即可：

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@mesh2web/element/dist/web-model.js"></script>

<web-model
  src="/3d/robot.glb"
  lod-src="/3d/robot.lod1.glb /3d/robot.lod2.glb"
  poster="/3d/robot.webp"
  alt="漂浮的機器人吉祥物"
  lighting="studio-soft"
  autorotate
  loading="lazy"
></web-model>
```

<h2 id="cli">CLI</h2>

```bash
mesh2web inspect  model.glb      # 健檢：面數、貼圖、問題與修正建議
mesh2web optimize model.glb -p hero --poster
mesh2web init                    # 建立 mesh2web.config.json
mesh2web build                   # 批次處理（超過預算時結束碼為 2，可擋 CI）
mesh2web build --watch           # 存檔就自動重建
```

| Preset | 用途 | 面數預算 | 體積預算 | 貼圖 | LOD |
|---|---|---|---|---|---|
| `hero` | 首屏主視覺 | 15 萬 | 2.5 MB | ≤ 2048 px WebP | 1, 0.5 |
| `product` | 產品展示 | 8 萬 | 1.5 MB | ≤ 2048 px WebP | 1, 0.5, 0.2 |
| `ambient` | 背景裝飾 | 2.5 萬 | 600 KB | ≤ 1024 px WebP | 1 |

**管線步驟**：健檢 → 清理（去重、焊接頂點、補平滑法線、依材質合併網格、清除未使用資源）→ 減面（meshoptimizer，超出預算時自動再減）→ 貼圖縮放並轉 WebP → LOD → Meshopt／Draco 幾何壓縮 → JSON 與 HTML 報告。

**支援輸入**：`.glb`、`.gltf`、`.obj`（含 `.mtl`）。FBX 請先用 Blender 或 FBX2glTF 轉成 glTF。

完整參數請見 [英文 README](README.md#cli) 或執行 `mesh2web --help`。

<h2 id="web-model">&lt;web-model&gt;</h2>

元件本體只有 **4 KB gzip**。three.js（約 170 KB gzip）拆成獨立 chunk，只在模型即將出現時才載入。

| 屬性 | 預設 | 說明 |
|---|---|---|
| `src` / `lod-src` | | 主模型，以及依裝置等級挑選的低面數版本 |
| `poster` | | 立即顯示的靜態圖，模型準備好後淡入 |
| `alt` | | 轉成 `aria-label`（`role="img"`） |
| `loading` | `lazy` | `lazy`、`eager`、`interaction`（點擊「View in 3D」才載入） |
| `lighting` | `studio-soft` | `studio-soft`、`studio-hard`、`outdoor`、`neon`、`flat` |
| `gesture` | `page-first` | 單指留給頁面滾動；水平滑動或雙指旋轉模型；滾輪需按 Ctrl/⌘ 才縮放 |
| `autorotate` | | 使用者開啟 `prefers-reduced-motion` 時自動停用 |
| `camera-orbit` | `0 75 3.7` | 方位角、俯仰角、距離（以模型半徑為單位） |
| `quality` | `auto` | `auto`、`high`、`medium`、`low` |

**JS API**：`ready`、`camera`（`azimuth`、`polar`、`distance`、`fov`）、`animation`（`progress`、`play()`、`pause()`）、`exposure`、`scene`、`renderer`、`snapshot()`。
**事件**：`load`、`progress`、`error`、`quality-change`。

### 搭配 GSAP 做滾動敘事

```js
const model = document.querySelector('web-model');
await model.ready;

gsap.timeline({ scrollTrigger: { trigger: '#story', start: 'top top', end: '+=2000', scrub: true, pin: true } })
  .to(model.camera, { azimuth: 180, distance: 4 })
  .to(model.animation, { progress: 1 }, 0)
  .to(model, { exposure: 1.4 }, 0.5);
```

## Studio

打開 [Studio](https://pinyi333.github.io/mesh2web/studio/)，拖入 GLB、glTF（連同 .bin 與貼圖）或 OBJ。Studio 會做健檢，讓你選 preset 或用滑桿微調，並以同步相機的左右分割畫面比對處理前後。最後一鍵匯出 zip，內含 GLB、LOD、poster、嵌入碼和報告。所有處理都在你電腦上的 Web Worker 完成。

## 開發

```bash
npm install
npm run assets     # 產生 CC0 程序化測試模型
npm run build      # 打包元件、Studio 用的 core、文件站相依檔
npm test           # 單元測試（vitest）
npm run test:e2e   # 無頭 Chromium 冒煙測試
npm run dev        # http://127.0.0.1:5173/apps/docs/
```

歡迎貢獻，請見 [CONTRIBUTING.md](CONTRIBUTING.md)。新增 preset、翻譯、範例都是很好的入門題目。

## 授權

[MIT](LICENSE)。測試模型皆由程式產生（CC0）。

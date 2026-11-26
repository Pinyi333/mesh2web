# mesh2web 交接文件

最後更新：2026-11-26

## 專案說明

mesh2web：把 3D 模型（GLB／glTF／OBJ）優化成輕量、可一行 HTML 嵌入的 Web Component。開源（MIT），npm 套件 `@mesh2web/*`，官網與 Studio 由 GitHub Pages 部署（https://pinyi333.github.io/mesh2web/）。

## 架構總覽

| 位置 | 內容 |
|---|---|
| `packages/core` | 優化管線本體（Node＋瀏覽器），glTF-Transform＋meshoptimizer |
| `packages/cli` | `mesh2web` CLI：inspect／optimize／build／presets，超出預算結束碼 2 |
| `packages/element` | `<web-model>` Web Component（含 GSAP bridge） |
| `packages/presets` | 優化與燈光 preset |
| `apps/studio`、`apps/docs` | 瀏覽器 GUI 與官網 |
| `scripts/` | build、lint、e2e、serve、README 媒體產生 |
| `.github/workflows/` | `ci.yml`（lint＋build＋vitest＋預算）、`pages.yml`（部署官網）、`release.yml` |
| `README.md`／`README.zh-TW.md` | 中英 README，內容要同步 |

## 工作進度紀錄

### 2026-11-26 README 中文版與英文版對齊 ✅ 完成

- 檔案：`README.zh-TW.md`（188 → 約 295 行，與 `README.md` 段落一一對應）
- 原因：中文版是精簡版，缺 `mesh2web.config.json`、Presets 小節、管線步驟清單、CLI 參數表、輸出檔清單、完整屬性表、樣式／內建行為、GSAP bridge、範例、路線圖、授權致謝。
- 實際改動：以 `README.md` 為準補齊上述段落；`完整流程` 補上 CLI 輸出範例；移除「完整參數請見英文 README」的導引（已不需要）；錨點 `#cli`、`#web-model` 保留。
- 驗證：`npm run lint` 39/39 OK、`npm test` 21/21 通過、`npm run test:e2e` 3/3 通過（本機要設 `MESH2WEB_CHROMIUM` 指向 `%LOCALAPPDATA%\ms-playwright\chromium-1234\chrome-win64\chrome.exe`）。
- 踩雷：工作樹沒有 `node_modules`，要先 `npm ci`；`npm ci` 後 `packages/cli/src/bin.js` 會出現只有換行符／權限的假變更，不要提交。

### 2026-11-26 重跑官網部署 ✅ 完成

- 對象：GitHub Actions `Deploy site`（`pages.yml`），run 45771661954（main 的 1f2f098）
- 做法：Pages 已啟用（workflow 模式）後，用 `gh run rerun` 重跑先前失敗的部署。
- 結果：conclusion `success`；https://pinyi333.github.io/mesh2web/ 與 `/studio/` 都回 200，用瀏覽器開過，內容正常、console 沒有錯誤。
- 前次失敗原因：部署當時 Pages 尚未啟用，`deploy-pages` 回 404。
- 附帶發現：Actions 警告 `actions/checkout@v4`、`setup-node@v4`、`upload-artifact@v4` 目標是 Node 20（已淘汰，被強制改用 Node 24），之後可升級 action 版本。

### 2026-11-26 升級 GitHub Actions 版本（Node 20 淘汰）✅ 完成

- 檔案：`.github/workflows/ci.yml`、`pages.yml`、`release.yml`
- 原因：部署時 Actions 警告 `checkout@v4`、`setup-node@v4`、`upload-artifact@v4` 目標為已淘汰的 Node 20。
- 改動（只換版本，workflow 邏輯不動）：
  - `actions/checkout` v4 → v7（node24）
  - `actions/setup-node` v4 → v7（node24）
  - `actions/upload-pages-artifact` v3 → v5（內部改用 upload-artifact v7）
  - `actions/deploy-pages` v4 → v5（node24）
- 檢查過的破壞性變更：
  - upload-pages-artifact v4 起預設不打包 dotfile → `site/` 沒有 dotfile，不受影響。
  - setup-node v6 起自動快取只限 npm、v7 不再預先設定 `NODE_AUTH_TOKEN` → 本專案本來就用 npm 並明寫 `cache: npm`；`release.yml` 的 publish 步驟自己設了 `NODE_AUTH_TOKEN`，不受影響。
  - checkout v7 會擋 `pull_request_target`／`workflow_run` 簽出 fork PR → 本專案沒用這兩種觸發。
- 驗證：本機 lint、build、`npm test` 21/21、e2e 3/3 通過；CLI 超出預算 exit 2、預算內 exit 0。新版 workflow 要推上 GitHub 才會實際執行，推送後要看 CI 與 Deploy site 是否綠燈。
- 踩雷：跑過 `npm run build:site` 後 lint 會連 `site/` 一起掃（39 → 1790 檔），仍通過；`site/` 已在 gitignore。

### 2026-11-26 合併 PR #10、#11 並同步中文 README ✅ 完成

- PR #10（snehaapratap，`presets --json`，關閉 #8）：CI 3/3、單元測試 23/23 通過，以 merge commit 合併（cea8c8e）。
- `README.zh-TW.md` CLI 區塊補上 `mesh2web presets --json` 一行（e8bca8d），先把 main 合進 PR #11 分支（7bd75c9），本機 lint／單元 23/23／e2e 3/3 通過，CI 3/3 通過。
- PR #11 以 merge commit 合併（7fc8cac）。
- 合併後 main：CI 通過；Deploy site 成功，且已沒有 Node 20 淘汰警告（新版 Actions 實際驗證完成）；官網與 Studio 回 200。
- 注意：這一筆收尾紀錄是 PR #11 合併後才寫的，還沒進 main，要跟下一個 PR 一起提交。

### 2026-11-26 設定 GitHub repo 首頁與 topics ✅ 完成

- 對象：GitHub repo 設定（不改檔案）
- 結果：首頁設為 `https://pinyi333.github.io/mesh2web/`；topics（原本是空的）：3d、cli、glb、gltf、gsap、mesh-optimization、threejs、web-components。已用 `gh repo view` 確認。
- 發現：repo 簡介（About）是中文「把任何 3D 模型轉成輕量、可嵌入的 web component，含 Studio 與 CLI」，但 README 以英文為主，建議改成英文，待使用者決定。

### 2026-11-26 官網與 Studio 中英切換 ✅ 完成

- 分支：`feat/site-i18n`（從 main 7fc8cac 開）
- 架構：
  - `apps/shared/i18n.js`：共用核心（一般 script，無套件）。`npm run build` 會複製到 `apps/docs/vendor/i18n.js`、`apps/studio/vendor/i18n.js`（`scripts/build.js`）。放在 `<head>`，第一次繪製前就設好 `<html lang>`。
  - `apps/docs/js/lang.js`、`apps/studio/js/lang.js`：各自的字典，放在 body 尾端，呼叫 `mesh2webI18n.register()` 套用。`en` 只放 JS 會用到的字串，英文頁面文字就是 HTML 原文；`zh-TW` 要涵蓋所有 key。
  - HTML 標記：`data-i18n="key"`（換 innerHTML）、`data-i18n-attr="alt:key,…"`（換屬性，含 title、meta、alt、aria-label、placeholder、href）、`data-lang-switch`（切換按鈕）。
- 語言判斷順序：`?lang=` → localStorage `mesh2web-lang` → `navigator.languages` → 英文。**所有 zh-* 都給繁中**（含 zh-CN：簡中讀者看繁中比看英文容易；要改只動 `i18n.js` 的 `CONFIG.match`）。其他語言給英文。
- 切換：存 localStorage 後**重新載入**（官網標題用 SplitText 拆行、故事區用 ScrollTrigger 釘選，現場換字會壞動畫）。網址有 `?lang=` 時一併改掉，避免分享連結蓋過選擇。docs 和 Studio 同網域共用選擇。
- 沒翻的：Studio 裡模型健檢訊息（來自 `@mesh2web/core`，和 CLI 共用，維持英文並標 `lang="en"`）；程式碼範例本身（只翻註解）；品牌名與 preset 名稱。
- 中文排版：用系統中文字型（PingFang TC／Noto Sans TC／微軟正黑體），不加 web font；中文 `em` 取消斜體；標題字距與行高放寬；官網 hero 標題中文字級 ×0.82。標題用 `<br>`／`&nbsp;` 控制斷行，1440／1024／800／375 量過不會孤字、不爆版。
- SEO：兩頁都加 `hreflang`（en、zh-Hant、x-default，以 `?lang=` 區分）。
- 附帶修正：`scripts/serve.js` 請求不存在的 `index.html`（例如 `/`）時會先送 200 標頭再送 404 而崩潰，改成先讀檔再送標頭。
- 測試：e2e 新增 4 項（中文瀏覽器自動中文、法文瀏覽器英文且 `?lang=` 可覆蓋、切換按鈕存選擇並帶到 Studio、Studio 中文跑完範例），每項也檢查沒有漏翻的 key。lint、單元 23/23、e2e 7/7 通過。e2e 改成每項測試用獨立 context（各自的瀏覽器語言與 localStorage）。
- 另：repo 簡介已改成英文（Turn a 34 MB 3D model into a 556 KB web component…）。
- 沒做：`spacing-audit.js` 的完整間距驗收（只量了標題斷行、導覽列位置與水平溢出）。
- 踩雷：瀏覽器面板隱藏時 rAF 會暫停，GSAP 動畫卡在半途，截圖前要用 `gsap.globalTimeline.getChildren(true,true,true).forEach(t => t.progress(1))` 跑完。`.hero__scroll` 裡的 `<span>` 是捲動指示線，文字改包在 `<b>`。

## 待辦事項清單

- [x] GitHub 分支整理：原本預設分支是 `claude/adoring-mccarthy-r0tb2q`（見 PR #1 Heads-up），使用者已刪除並改用 `main` 為預設，2026-11-26 查證完成。已合併的 `claude/project-thread-gpwqcr` 還留在遠端，要不要刪由使用者決定。
- [x] 官網部署：2026-11-26 重跑成功，官網與 Studio 都能開。
- [x] 升級 workflow 裡 Node 20 的 actions（2026-11-26 完成，待推送後確認 CI／部署綠燈）。
- [ ] README 持續打磨（中英同步）。
- [x] PR #10 合併、中文 README 補 `presets --json`（2026-11-26 完成）。
- [x] 2026-11-27 已發布 v0.1.0 到 npm（四個套件含 provenance），並為四個套件設定 Trusted Publisher；`release.yml` 改用 OIDC，不再需要 `NPM_TOKEN`。
- [ ] 上傳 `.github/assets/social-preview.png`（Settings → General → Social preview，沒有 API 可用）。首頁網址與 topics 已於 2026-11-26 完成。
- [x] repo 簡介改成英文（2026-11-26 完成）。
- [x] 官網與 Studio 中英切換（2026-11-26 完成，`feat/site-i18n`）。
- [ ] 改官網或 Studio 的英文文案時，`js/lang.js` 的 zh-TW 要同步（漏了 e2e 會失敗）。
- [ ] （可選）Studio 健檢訊息中文化：要在 `@mesh2web/core` 的 issue 加代碼，CLI 與 Studio 再各自翻譯。

## 交接注意事項

- 前端只用 HTML／CSS／JS＋GSAP，不用框架。
- 提交前 lint（`npm run lint`）、單元測試（`npm test`）、瀏覽器測試（`npm run test:e2e`）都要通過。
- CLI 超出預算時結束碼維持 `2`（CI 依賴它）。
- 截圖放 `.scratch/`，不提交。
- 改 README 時中英兩份都要改。

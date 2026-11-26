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

### 2026-11-26 合併 PR #10、#11 並同步中文 README 🔄 進行中

- PR #10（snehaapratap，`presets --json`，關閉 #8）：CI 3/3、單元測試 23/23 通過，已用 merge commit 合併（cea8c8e）。
- 接著在 `README.zh-TW.md` 的 CLI 區塊補 `mesh2web presets --json` 一行（對應 #10 在 `README.md` 的改動），推到 PR #11，CI 通過後合併 #11，再確認官網部署。

## 待辦事項清單

- [x] GitHub 分支整理：原本預設分支是 `claude/adoring-mccarthy-r0tb2q`（見 PR #1 Heads-up），使用者已刪除並改用 `main` 為預設，2026-11-26 查證完成。已合併的 `claude/project-thread-gpwqcr` 還留在遠端，要不要刪由使用者決定。
- [x] 官網部署：2026-11-26 重跑成功，官網與 Studio 都能開。
- [x] 升級 workflow 裡 Node 20 的 actions（2026-11-26 完成，待推送後確認 CI／部署綠燈）。
- [ ] README 持續打磨（中英同步）。
- [ ] PR #10（外部貢獻者 snehaapratap，`presets --json`）：2026-11-26 已留審查留言。待使用者在 GitHub 按「Approve and run workflows」，CI 綠燈後合併；合併後在 `README.zh-TW.md` 的 CLI 區塊補 `mesh2web presets --json` 一行（留言中已答應作者由我們補）。

## 交接注意事項

- 前端只用 HTML／CSS／JS＋GSAP，不用框架。
- 提交前 lint（`npm run lint`）、單元測試（`npm test`）、瀏覽器測試（`npm run test:e2e`）都要通過。
- CLI 超出預算時結束碼維持 `2`（CI 依賴它）。
- 截圖放 `.scratch/`，不提交。
- 改 README 時中英兩份都要改。

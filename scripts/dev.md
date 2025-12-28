# 開發環境設定說明（Development Setup Guide）

本文件說明如何設定開發環境並啟動專案。

---

## 系統需求（Requirements）

- **Node.js**: v18.0.0 或更高版本
- **npm**: v9.0.0 或更高版本（隨 Node.js 安裝）
- **現代瀏覽器**：Chrome、Firefox、Edge、Safari（需支援 WebGL 與 Pointer Lock API）

---

## 快速開始（Quick Start）

### 1. 安裝依賴（Install Dependencies）

在專案根目錄執行：

```bash
npm install
```

這會安裝以下依賴：
- **Three.js**: 3D 渲染引擎
- **Vite**: 開發伺服器與打包工具

### 2. 啟動開發伺服器（Start Dev Server）

```bash
npm run dev
```

- 若需配合測試文件的既定連結，可指定埠並開啟對外：`npm run dev -- --host --port 3002`

執行後會看到類似以下輸出：

```
  VITE v5.0.0  ready in 500 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### 3. 開啟瀏覽器（Open Browser）

打開瀏覽器並前往：
```
http://localhost:3000 （或你指定的埠，例如 3002）
```

你應該會看到遊戲畫面與「Click to Start」按鈕。

### 4. 開始遊戲（Start Game）

1. 點擊「Click to Start」按鈕
2. 滑鼠會被鎖定（Pointer Lock）
3. 使用以下按鍵操作：
   - **WASD** - 移動
   - **滑鼠** - 轉視角
   - **Shift** - 衝刺
   - **ESC** - 暫停 / 釋放滑鼠

---

## 手動驗證流程（Manual Validation）

在 dev server 運行時依序檢查：

1. **AI 匯入檢查**：`http://localhost:3002/test-ai.html`（若用其他埠請自行替換） → 預期綠色「All modules loaded successfully」訊息。
2. **主程式診斷**：開啟 `diagnostic.html` → 按「Test Main Game」→ 預期 `main.js loaded successfully`。
3. **遊戲驗證**：開啟 `/` 首頁 → 點擊「Click to Start」取得 Pointer Lock → 確認迷你地圖渲染、怪物生成日誌與移動操作正常。若效能不足，可在 `src/core/config.js` 降低 `MAZE_WIDTH/MAZE_HEIGHT` 或 `CONFIG.MONSTER_COUNT`。

---

## 其他 NPM Scripts

### 建置生產版本（Build for Production）

```bash
npm run build
```

- 產出檔案會放在 `dist/` 目錄
- 可部署至靜態網站主機（GitHub Pages、Netlify、Vercel 等）

### 預覽建置結果（Preview Build）

```bash
npm run preview
```

- 在本地預覽 `dist/` 的建置結果
- 適合部署前檢查

### 關卡資料（Levels JSON）

本專案的關卡資料位於 `public/levels/*.json`，清單由 `public/levels/manifest.json` 管理。

```bash
# Validate all levels referenced by the manifest
npm run levels:validate

# Create a new level from the template (auto-updates the manifest, then validates)
npm run levels:new -- <slug> --name "L12 - My Level"

# Keep the manifest sorted / deduped (also reports missing/invalid files)
npm run levels:sync
```

---

## 開發工作流程（Development Workflow）

### 檔案修改會自動重新載入（Hot Module Replacement）

Vite 提供極快的熱更新：
- 修改 `.js` 檔案 → 自動重新載入
- 修改 `.html` 檔案 → 自動刷新頁面
- 不需要手動重啟伺服器

### 開發中常見操作

#### 調整遊戲參數

所有可調整參數集中在：
```
src/core/config.js
```

例如：
- `MAZE_WIDTH / MAZE_HEIGHT`：迷宮大小
- `PLAYER_SPEED`：玩家速度
- `TILE_SIZE`：格子尺寸

修改後儲存，瀏覽器會自動更新。

#### 查看 Console 日誌

開啟瀏覽器開發者工具（F12），切換到 Console 分頁：
- 遊戲初始化訊息
- 玩家位置資訊
- 錯誤訊息

#### 調整地圖

當前地圖是寫死的（hardcoded），位於：
```
src/world/worldState.js
```

在 `initialize()` 方法中修改 `this.grid` 陣列：
- `0` = 牆
- `1` = 地板

**注意：Phase 2 將實作隨機迷宮生成，屆時不需手動編輯。**

---

## 除錯技巧（Debugging Tips）

### 啟用 Debug 模式

在 `src/core/config.js` 中：
```javascript
DEBUG_MODE: true,
```

（目前 Debug 模式尚未實作，Phase 2+ 會加入）

### 常見問題排查

#### 問題：畫面全黑

**可能原因：**
- 相機位置在牆內
- 燈光設定錯誤
- WebGL 不支援

**解決方法：**
1. 檢查 Console 是否有錯誤
2. 確認瀏覽器支援 WebGL（訪問 https://get.webgl.org/）
3. 檢查 `worldState.js` 的 spawn point 是否在可走格子上

#### 問題：無法移動

**可能原因：**
- 滑鼠未鎖定
- 鍵盤事件被其他元素攔截

**解決方法：**
1. 確認點擊了「Click to Start」
2. 檢查 Console 是否有 pointer lock 錯誤
3. 確保頁面焦點在遊戲視窗上

#### 問題：FPS 很低

**可能原因：**
- 電腦效能不足
- 地圖過大導致 Mesh 過多

**解決方法：**
1. 降低 `MAZE_WIDTH / MAZE_HEIGHT`（例如改為 11×11）
2. 關閉其他佔用 GPU 的應用程式
3. 後期可考慮使用 InstancedMesh 優化

---

## 專案結構快速導覽（Project Structure）

```
procedural-3d-maze/
├── public/
│   └── index.html          # 遊戲入口 HTML
├── src/
│   ├── main.js             # 主程式入口
│   ├── core/               # 核心系統（config, gameLoop）
│   ├── rendering/          # 渲染模組（scene, camera, lighting）
│   ├── world/              # 世界與地圖（worldState, tileTypes）
│   ├── player/             # 玩家系統（input, playerController）
│   ├── ai/                 # AI 系統（未來實作）
│   └── utils/              # 工具函式（math）
├── docs/                   # 所有設計與技術文件
├── package.json            # NPM 依賴與腳本
└── vite.config.js          # Vite 配置
```

**修改程式碼時，請遵守「單一真相檔」原則，詳見 `docs/README.md`。**

---

## 進階：修改 Vite 配置（Advanced: Vite Config）

若需要調整開發伺服器設定，編輯：
```
vite.config.js
```

常見調整：
- 修改埠號（預設 3000）
- 加入路徑別名（@）
- 調整 build 輸出目錄

**注意：重大配置變更需先在 `docs/TECH_DESIGN.md` 說明理由。**

---

## 部署（Deployment）

### GitHub Pages

1. 執行 `npm run build`
2. 將 `dist/` 目錄內容推送至 `gh-pages` 分支
3. 在 GitHub repo 設定中啟用 GitHub Pages

### Netlify / Vercel

1. 連結 GitHub repo
2. 設定 build 指令：`npm run build`
3. 設定輸出目錄：`dist`
4. 自動部署

---

## 技術支援（Support）

如遇到問題：
1. 檢查 `docs/TECH_DESIGN.md` 了解架構
2. 查看 `docs/AI_ALGO_NOTES.md` 了解演算法
3. 檢視 Git commit 歷史了解變更
4. 開 Issue 回報問題

---

**最後更新：2025-11-20**

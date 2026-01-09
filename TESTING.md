# 手動測試（Manual Testing）

本專案目前沒有自動化測試；請在改動 gameplay/AI/關卡/渲染後，至少跑一次本文件的 smoke test。

---

## 0) 啟動（建議固定埠）

```bash
npm install
npm run dev -- --host --port 3002
```

---

## 1) Smoke Test（5–10 分鐘）

### 1.1 AI 模組匯入 sanity

- 開：`http://localhost:3002/test-ai.html`
- 預期：console 顯示「All modules loaded successfully」或等價成功訊息

### 1.2 主程式載入診斷

- 開：`http://localhost:3002/diagnostic.html`
- 按：`Test Main Game`
- 預期：顯示 `main.js loaded successfully`（或等價成功訊息）

### 1.3 主遊戲基本流程

- 開：`http://localhost:3002/`
- 點：`Click to Start`（取得 Pointer Lock）
- 預期：
  - Minimap 可見且**永遠顯示整張地圖縮圖**
  - HUD 有 objective、道具數量（4/5/6/0/V 與 7/8/9）
  - 怪物會生成且會移動（遠方怪物不應該跳格）
  - `M` 可切換 3D 世界標示（World Markers）
  - 丟一次道具（例如 `8` Smoke）應該有對應音效與效果
  - Console 無持續報錯

---

## 2) 進階頁面（必要時）

### 2.1 Enemy Lab（敵人/戰鬥/存 meta）

- 開：`http://localhost:3002/enemy-lab.html`
- 用途：
  - 第一人稱測試戰鬥節奏與怪物射擊
  - 調整並保存 `public/models/<enemy>/meta.json`（透過 dev server API）

### 2.2 Level Lab（關卡/配方實驗）

- 開：`http://localhost:3002/level-lab.html`
- 用途：
  - 測試 `public/levels/*.json` 與 `public/level-recipes/*.json` 配置是否合理

---

## 3) 回報問題時請附

1. 使用的頁面（`/`, `test-ai.html`, `diagnostic.html`, `enemy-lab.html`, `level-lab.html`）
2. Console 錯誤與關鍵 log（貼文字或截圖）
3. 瀏覽器版本與 OS
4. 觸發步驟（越具體越好）


# 🎮 測試指南（Testing Guide）

本文件提供更完整的人工測試流程與檢查點（適合：修 AI、修道具、修 minimap、修關卡配置後）。

快速版請看：`TESTING.md`

---

## 0) 啟動

```bash
npm install
npm run dev -- --host --port 3002
```

---

## 1) 必跑頁面與預期結果

### 1.1 `test-ai.html`：模組匯入 sanity

- 開：`http://localhost:3002/test-ai.html`
- 預期：
  - console 顯示各主要模組成功載入
  - 最後有「All modules loaded successfully」或等價成功訊息

### 1.2 `diagnostic.html`：主程式載入 sanity

- 開：`http://localhost:3002/diagnostic.html`
- 按：`Test Main Game`
- 預期：
  - 顯示 `main.js loaded successfully`（或等價）
  - 若失敗，會顯示 stack trace（把它貼出來）

### 1.3 `/`：主遊戲玩法 smoke + UX

- 開：`http://localhost:3002/`
- 點：`Click to Start`（取得 Pointer Lock）
- 預期：
  - 角色可 WASD 移動、滑鼠看向
  - HUD 會顯示 objective、生命值、武器/彈藥、道具數量
  - Minimap 可見且永遠顯示整張地圖縮圖
  - 怪物生成且會移動（遠方怪物不應跳格）

---

## 2) 主遊戲檢查清單（建議）

### 2.1 Minimap（完整縮圖）

在主遊戲 UI 調整 minimap 尺寸/縮放後，確認：

- **縮圖不裁切**（仍然是整張地圖）
- zoom 只改 marker 大小，不會裁地圖

### 2.2 世界標示（World Markers）

- 按 `M` 切換
- 預期：附近的掉落/已部署裝置/任務目標會出現 3D 標記（Sprite）

### 2.3 道具（Tools）

確認以下動作至少各做一次：

- 投擲：`7/8/9`（Decoy/Smoke/Flash）
- 部署：`4/5/6/0/V`（Lure/Trap/Jammer/Sensor/Mine）

預期：

- 背包數量有消耗（HUD 更新）
- 會有對應音效（程序化）
- 效果能改變怪物壓力（例如 Smoke 斷視線、Flash 致盲、Jammer 削弱感知）

### 2.4 任務/互動（Interactables）

在任務物件旁按 `E`：

- 互動提示正常顯示（看著目標才顯示）
- 需要道具/條件時會提示缺少項目（例如 Need fuse）
- 完成 required objectives 前，出口應該維持鎖定

### 2.5 Autopilot（AI 玩家）

在設定面板（Tab）：

- 開啟 Autopilot（若被關）
- 把 delay 調到 0（若要立即接管）

然後放開鍵盤/滑鼠：

- 預期：角色開始自動探索、解任務、開火/格擋並策略性使用道具

---

## 3) 專用頁面（必要時）

### 3.1 Enemy Lab

- 開：`http://localhost:3002/enemy-lab.html`
- 用途：
  - 測試怪物射擊/近戰節奏
  - 調整並保存 enemy meta 到 `public/models/<enemy>/meta.json`（需要跑 dev server）

### 3.2 Test Enemy Meta

- 開：`http://localhost:3002/test-enemy-meta.html`
- 用途：
  - 調整模型朝向/比例/貼地參數，產出 meta JSON

### 3.3 Level Lab

- 開：`http://localhost:3002/level-lab.html`
- 用途：
  - 驗證 `public/levels/*.json` 與 `public/level-recipes/*.json` 的配置與隨機結果

---

## 4) Build 驗證（提交前）

```bash
npm run build
```

預期：build 成功（`dist/` 產出），且沒有 module resolution error。


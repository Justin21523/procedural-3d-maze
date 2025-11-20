# 變更記錄（Changelog）

本文件記錄專案的重大架構變更、系統調整與 breaking changes。

**記錄原則：**
- 僅記錄**結構性變更**（架構調整、模組重構、重大功能）
- 小型 bug 修復或微調不記錄於此（使用 Git commit 即可）
- 使用 [Keep a Changelog](https://keepachangelog.com/) 格式
- 版本號使用 Semantic Versioning（v0.x.x 表示開發階段）

---

## [Unreleased]

### 待實作（To be implemented）
- 無（目前所有核心功能已完成）

---

## [v4.0.0] - 2025-11-20

### Added（新增）
- **🔬 Frontier-based Exploration 算法**：
  - 新增 `src/ai/frontierExploration.js`（全新檔案）
  - 實作 `FrontierExplorer` 類別
  - 自動識別已探索/未探索邊界（frontier cells）
  - Information Gain（信息增益）計算系統
  - Frontier Clustering（邊界聚類）識別大面積未探索區域
  - 基於學術研究的專業探索算法（Yamauchi 1997）

- **🔍 振盪檢測系統（Oscillation Detection）**：
  - 位置歷史追蹤（最近 10 個位置）
  - 自動檢測來回踏步行為（uniqueGridCells ≤ 3）
  - 智能卡住原因分析：OSCILLATION, DEAD_END, WALL_COLLISION, PATH_BLOCKED

- **🛠️ 智能恢復策略（Intelligent Stuck Recovery）**：
  - OSCILLATION → 強制跳躍到遠處 frontier（掃描半徑 50 格）
  - DEAD_END → 轉身 180°
  - WALL_COLLISION → 隨機旋轉 ±45°
  - PATH_BLOCKED → 清除路徑，重新計算
  - UNKNOWN → 隨機旋轉

### Changed（變更）
- **🧠 完全重構探索行為**：
  - `behaviorProfiles.js` 從 ~120 行簡化到 ~40 行（減少 67%）
  - 移除所有 if-else 啟發式邏輯（走廊/房間/路口判斷）
  - 改用系統性 Frontier-based Exploration
  - 探索邏輯從 `monster.js` 移至 `frontierExploration.js`

- **📊 評分系統升級**：
  - 新增 Information Gain 獎勵（0-200 分）
  - 新增 Cluster Size 獎勵（0-50 分）
  - 新增 Exploration Age 獎勵（0-100 分）
  - 保留 Distance & Direction 獎勵

### Removed（移除）
- **🗑️ 啟發式方法移除**：
  - 移除 `selectSmartTarget()` 手動評分系統
  - 移除 `detectCorridor()` 走廊檢測
  - 移除 `isInRoom()` 房間檢測
  - 移除 `escapeRoom()` 逃離房間邏輯
  - 移除所有與走廊/房間相關的 if-else 判斷

### Performance（性能）
- 代碼複雜度降低 67%（120 行 → 40 行）
- 算法理論完整性保證（系統性探索，非隨機）
- Cluster 聚類避免重複掃描

### Breaking Changes（破壞性變更）
- 探索行為完全重構，不向後兼容 v3.x
- `monster.js` 需要整合 `FrontierExplorer` 實例
- `behaviorProfiles.js` 中的 `createExplorationBehavior()` 完全改寫
- 移除 `visitedTiles` 系統（改用 FrontierExplorer 的 exploredCells）

### Documentation（文檔）
- 更新 `docs/AI_SYSTEM.md`：新增 Frontier-based Exploration 詳細說明
- 新增算法理論說明、評分系統、與 v3.x 對比表
- 新增 Stuck Recovery 策略表格
- 更新版本號至 4.0.0

---

## [v3.1.0] - 2025-11-20

### Fixed（修復）
- **🐛 CRITICAL BUG: 雙重尋路**
  - 修復 `behaviorProfiles.js` 中的重複路徑計算
  - `selectSmartTarget()` 內部已呼叫 `tryFindPath()`，不需再計算
  - **影響**：消除不必要的 CPU 開銷，提升 AI 反應速度

### Changed（變更）
- **🧠 評分系統全面重構**：
  - **舊系統**：`score = visitScore*5.0 + (1-distance/max) + directionBonus*2.0`（越低越好）
  - **新系統**：`score = distanceReward*100 - visitPenalty*100 + directionReward*50`（越高越好）
  - **優點**：評分邏輯更直觀，避免混淆

- **⏱️ 預計算時機優化**：
  - 從**剩餘 3 路點**觸發改為**剩餘 10 路點**
  - **效果**：提前計算下一條路徑，確保無縫切換

- **🏃 速度提升**：
  - 怪物移動速度從 **7 → 9 單位/秒**（提升 29%）
  - **目標**：更快速的探索，減少重複路徑

- **🧭 方向持久性增強**：
  - 從 **20 秒 → 60 秒**
  - **效果**：確保走廊被完整探索，減少中途轉向

### Performance（性能）
- 消除雙重 A* 路徑計算，降低 CPU 使用率
- 早期預計算（10 路點）確保流暢移動

---

## [v3.0.0] - 2025-11-20

### Added（新增）
- **🧠 類人腦記憶系統（Human-like Memory）**：
  - **長期記憶**：600 秒（10 分鐘）記住訪問過的位置
  - **障礙記憶**：120 秒（2 分鐘）記住卡住的位置
  - **方向持久性**：60 秒保持探索方向（確保走廊走到底）

- **🔮 路徑預計算系統**：
  - 當前路徑接近終點時預先計算下一條路徑
  - 無縫路徑切換，確保零停頓移動

- **🎯 三重移動保證**：
  ```
  優先級 1: 跟隨 A* 路徑
     ↓（如果路徑為空）
  優先級 2: 繼續前往上次目標（刷新緊急目標）
     ↓（如果無目標）
  優先級 3: 緊急隨機移動
  ```

- **🗺️ 智能目標選擇算法**：
  - 距離獎勵系統（越遠越好）
  - 訪問懲罰系統（避免重複探索）
  - 方向一致性獎勵（保持方向探索）

### Changed（變更）
- **行為樹重構**：
  - 移除全域玩家追逐（僅近距離 8 格內觸發）
  - 改為**自主探索**作為主要行為模式

- **探索範圍擴大**：
  - 最小距離：**10 格**（確保探索遠處）
  - 最大距離：**50 格**
  - 備用範圍：**80 格**（找不到目標時）

- **速度調整**：
  - 從 **3-5 → 7 單位/秒**（提升 40-133%）
  - **目標**：連續快速探索

### Breaking Changes（破壞性變更）
- 怪物不再主動追逐玩家（除非玩家非常接近）
- AI 行為從「追逐為主」改為「探索為主」

---

## [v0.2.0] - 2025-11-20

### Added（新增）
- **DFS 迷宮生成演算法**：
  - 實作 `src/world/mapGenerator.js`
  - 支援可配置的地圖尺寸（從 `config.js` 讀取）
  - 保證迷宮連通性（無孤島）
  - 加入迷宮統計分析功能
- **演算法文件**：
  - 在 `docs/AI_ALGO_NOTES.md` 補充 DFS 演算法詳細說明
  - 包含步驟詳解、參數說明、效能分析

### Changed（變更）
- **worldState.js**：從 hardcoded grid 改為使用 `generateMazeDFS()`
- **config.js**：預設地圖尺寸從 15×15 改為 21×21
- **專案結構**：`index.html` 移至根目錄（標準 Vite 結構）
- **vite.config.js**：簡化配置，移除 root 設置

### Fixed（修復）
- 修正 Vite 無法載入 `/src/main.js` 的路徑問題

---

## [v0.1.0] - 2025-11-20

### Added（新增）
- 專案骨架建立：目錄結構、文件系統
- 核心文件：
  - `docs/README.md`：文件地圖與治理規則
  - `docs/GAME_DESIGN.md`：遊戲設計文件（初版）
  - `docs/TECH_DESIGN.md`：技術設計文件（初版）
  - `docs/AI_ALGO_NOTES.md`：演算法筆記（框架）
  - `docs/GLOSSARY_中英術語.md`：術語對照表
  - `docs/TODO.md`：功能待辦清單
- 基礎開發環境設定：
  - Vite 開發伺服器配置
  - Three.js 依賴安裝
  - `.gitignore` 設定

### Changed（變更）
- 無

### Deprecated（棄用）
- 無

### Removed（移除）
- 無

### Fixed（修復）
- 無

### Security（安全性）
- 無

---

## 版本號說明（Versioning）

本專案使用 **Semantic Versioning 2.0.0**：

- **v0.x.x**：開發階段，API 不穩定
- **v1.0.0**：完成 MVP，核心功能穩定
- **vX.Y.Z**：
  - **X（Major）**：重大架構變更或 breaking changes
  - **Y（Minor）**：新增功能但向後相容
  - **Z（Patch）**：Bug 修復與小型調整

---

## 修訂記錄（Revision History）

| 日期 | 版本 | 修改內容 | 修改者 |
|------|------|---------|--------|
| 2025-11-20 | v0.1 | 初版 CHANGELOG，記錄專案初始化 | Claude Code |

---

**注意：所有重大變更必須記錄於此。請在完成功能或調整架構後及時更新。**

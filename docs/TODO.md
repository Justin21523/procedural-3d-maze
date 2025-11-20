# 功能待辦清單（TODO）

**用途：** 追蹤高層級功能開發進度（Feature-level）
**不應包含：** 細節實作步驟、臨時筆記（請使用 Git issues 或 commit messages）

**狀態標記：**
- ✅ 已完成（Completed）
- 🚧 進行中（In Progress）
- ⬜ 待開始（Pending）
- 🔄 需重構（Needs Refactor）
- ❌ 已取消（Cancelled）

---

## Phase 1：基礎場景與移動（MVP Foundation）

### 專案骨架（Project Scaffold）
- ✅ 建立目錄結構（`src/`, `docs/`, `public/` 等）
- ✅ 建立核心文件（`GAME_DESIGN.md`, `TECH_DESIGN.md`, `AI_ALGO_NOTES.md`）
- ✅ 設定開發環境（Vite + Three.js）
- ⬜ 實作基礎 HTML 與入口點（`public/index.html`）
- ⬜ 實作核心配置系統（`src/core/config.js`）

### 3D 場景渲染（Rendering）
- ⬜ 實作場景管理器（`src/rendering/scene.js`）
- ⬜ 實作第一人稱相機（`src/rendering/camera.js`）
- ⬜ 實作基礎燈光（`src/rendering/lighting.js`）
- ⬜ 根據 hardcoded grid 生成牆與地板

### 玩家控制（Player Controller）
- ⬜ 實作輸入處理（`src/player/input.js`）：WASD + 滑鼠
- ⬜ 實作玩家控制器（`src/player/playerController.js`）：移動 + 碰撞
- ⬜ 整合相機與玩家位置同步

### 世界狀態（World State）
- ⬜ 實作格子類型定義（`src/world/tileTypes.js`）
- ⬜ 實作世界狀態管理（`src/world/worldState.js`）
- ⬜ 建立 hardcoded 測試地圖（小型 2D grid）

### 遊戲迴圈（Game Loop）
- ⬜ 實作主迴圈（`src/core/gameLoop.js`）
- ⬜ 整合所有模組並啟動遊戲

**Phase 1 完成標準：**
- 可在瀏覽器中看到 3D 場景（地板 + 牆壁）
- 可用 WASD 移動、滑鼠轉視角
- 不會穿牆

---

## Phase 2：隨機迷宮生成（已完成）✅

### 迷宮生成演算法
- ✅ 在 `docs/AI_ALGO_NOTES.md` 補充 DFS 迷宮生成說明
- ✅ 實作 `src/world/mapGenerator.js`：DFS-based 生成器
- ✅ 支援可配置的地圖尺寸（從 `config.js` 讀取）
- ✅ 實作出生點自動選擇（玩家 + 怪物）

### 整合與測試
- ✅ 更新 `worldState.js` 使用 `mapGenerator` 而非 hardcoded grid
- ✅ 測試不同尺寸地圖（可透過修改 `config.js` 測試）
- ✅ 確保迷宮連通性（DFS 演算法保證）

**Phase 2 完成標準：✅ 已達成**
- ✅ 每次啟動遊戲產生不同迷宮
- ✅ 玩家可正常探索生成的迷宮

---

## Phase 3：基礎怪物 AI（Basic Monster AI）

### A* 路徑搜尋
- ⬜ 在 `docs/AI_ALGO_NOTES.md` 補充 A* 演算法說明
- ⬜ 實作 `src/ai/pathfinding.js`：A* 核心演算法
- ⬜ 支援 4-way 或 8-way 移動
- ⬜ 編寫單元測試（選用）

### 基礎怪物實作
- ⬜ 實作 `src/ai/monsters.js`：Monster 類別
- ⬜ 怪物可取得自己與玩家的 grid 座標
- ⬜ 怪物使用 A* 計算到玩家的路徑
- ⬜ 怪物沿路徑平滑移動

### 場景整合
- ⬜ 在場景中生成怪物 Mesh（簡單方塊或球體）
- ⬜ 整合怪物更新到 `gameLoop.js`
- ⬜ 初步測試：怪物是否能正確追蹤玩家

**Phase 3 完成標準：**
- 至少一隻怪物在場景中
- 怪物能使用 A* 追蹤並接近玩家

---

## Phase 4：完整 FSM 與視線系統（FSM & Line-of-Sight）

### 視線判斷
- ⬜ 在 `docs/AI_ALGO_NOTES.md` 補充視線判斷說明
- ⬜ 實作距離檢查（Vision Range）
- ⬜ 實作視角檢查（Field of View）
- ⬜ 實作遮擋檢查（Grid-based 或 Raycaster）

### FSM 實作
- ⬜ 在 `docs/AI_ALGO_NOTES.md` 補充 FSM 設計
- ⬜ 實作 `src/ai/fsm.js`：通用 FSM 工具
- ⬜ 更新 Monster 類別：加入 Patrol / Chase / Search 狀態
- ⬜ 實作狀態轉移邏輯

### 巡邏行為
- ⬜ 實作 Patrol 狀態：預設路徑或隨機漫步
- ⬜ 實作 Search 狀態：在最後目擊位置搜尋
- ⬜ 調整參數（視距、視角、狀態持續時間）

**Phase 4 完成標準：**
- 怪物有明確的狀態切換
- 只有在看到玩家時才追擊
- 失去視線後會搜尋再巡邏

---

## Phase 5：體驗優化（Polish & Enhancement）

### 視覺增強
- ⬜ 加入牆面與地板貼圖
- ⬜ 調整燈光營造 Backrooms 氛圍
- ⬜ 怪物使用可愛 3D 模型（選用）

### 音效系統
- ⬜ 加入環境音效（空調、燈光嗡嗡聲）
- ⬜ 加入怪物音效（腳步聲、叫聲）
- ⬜ 加入玩家腳步聲

### UI 系統（選用）
- ⬜ 迷你地圖（Minimap）
- ⬜ 怪物距離提示
- ⬜ 簡單開始 / 暫停菜單

### 多怪物支援
- ⬜ 支援多隻怪物同時存在
- ⬜ 優化多怪物情境下的效能

**Phase 5 完成標準：**
- 遊戲體驗更流暢
- 視覺與聽覺反饋完整

---

## 後期擴充（Future Enhancements）

### 進階迷宮生成
- ⬜ 實作 Room + Corridor 演算法
- ⬜ 實作 BSP（Binary Space Partitioning）
- ⬜ 支援多樓層結構

### 進階 AI 行為
- ⬜ 怪物協作（包圍、分工巡邏）
- ⬜ 情緒系統（好奇、警戒、憤怒）
- ⬜ 學習玩家行為

### 遊戲化元素
- ⬜ 目標系統（找到出口）
- ⬜ 道具收集
- ⬜ 生命值與死亡懲罰
- ⬜ 難度遞增機制

### 技術升級
- ⬜ 遷移至 TypeScript
- ⬜ 加入單元測試（Vitest）
- ⬜ 效能優化（InstancedMesh、物件池）

---

## 技術債與重構（Technical Debt）

目前無技術債。

**記錄規則：**
- 發現需要重構但暫時擱置時，記錄於此
- 完成重構後移除對應條目

---

## 修訂記錄（Revision History）

| 日期 | 版本 | 修改內容 | 修改者 |
|------|------|---------|--------|
| 2025-11-20 | v0.1 | 初版 TODO，定義 Phase 1-5 功能清單 | Claude Code |

---

**注意：本文件應隨開發進度持續更新。完成功能後請及時標記為 ✅。**

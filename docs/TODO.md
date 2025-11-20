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

## Phase 3：基礎怪物 AI（已完成）✅

### A* 路徑搜尋
- ✅ 在 `docs/AI_ALGO_NOTES.md` 補充 A* 演算法說明
- ✅ 實作 `src/ai/pathfinding.js`：A* 核心演算法
- ✅ 支援 4-way 和 8-way 移動
- ✅ 支援動態權重（避免擁擠）

### 基礎怪物實作
- ✅ 實作 `src/entities/monster.js`：Monster 類別
- ✅ 實作 `src/entities/monsterManager.js`：怪物管理器
- ✅ 實作 `src/ai/monsterTypes.js`：多種怪物類型配置
- ✅ 怪物可取得自己與玩家的 grid 座標
- ✅ 怪物使用 A* 計算到玩家的路徑
- ✅ 怪物沿路徑平滑移動

### 場景整合
- ✅ 支援多種 3D 模型格式（GLTF/GLB/DAE）
- ✅ 整合怪物更新到 `gameLoop.js`
- ✅ 支援多隻怪物同時存在
- ✅ 動畫系統（Idle、Walk、Run）

**Phase 3 完成標準：✅ 已達成**
- ✅ 多隻怪物在場景中
- ✅ 怪物能使用 A* 追蹤並接近玩家
- ✅ 支援不同怪物類型

---

## Phase 4：完整 FSM 與視線系統（已完成）✅

### 視線判斷
- ✅ 在 `docs/AI_ALGO_NOTES.md` 補充視線判斷說明
- ✅ 實作距離檢查（Vision Range）
- ✅ 實作視角檢查（Field of View）
- ✅ 實作聽覺系統（Hearing Range）
- ✅ 實作 Grid-based 視線遮擋檢查

### AI 系統實作
- ✅ 實作 `src/ai/behaviorTree.js`：行為樹系統
- ✅ 實作 `src/ai/behaviorProfiles.js`：不同怪物行為檔案
- ✅ 實作 `src/ai/frontierExploration.js`：前沿探索演算法
- ✅ Monster 類別：加入完整狀態機（EXPLORE, PATROL, CHASE, SEARCH, WANDER, IDLE）
- ✅ 實作狀態轉移邏輯與記憶系統

### 高級行為
- ✅ 實作 EXPLORE 狀態：自主探索未知區域
- ✅ 實作 PATROL 狀態：巡邏已知區域
- ✅ 實作 CHASE 狀態：追蹤玩家
- ✅ 實作 SEARCH 狀態：在最後目擊位置搜尋
- ✅ 實作 WANDER 狀態：隨機漫步
- ✅ 實作 IDLE 狀態：暫停思考
- ✅ 調整參數（5種怪物類型各有不同配置）

**Phase 4 完成標準：✅ 已達成**
- ✅ 怪物有明確的狀態切換
- ✅ 只有在感知到玩家時才追擊（視線或聽覺）
- ✅ 失去感知後會搜尋再探索/巡邏
- ✅ 自主探索未知區域

---

## Phase 5：體驗優化（部分完成）🚧

### 視覺增強
- ✅ 支援多種怪物 3D 模型（GLTF/GLB/DAE）
- ✅ 模型動畫系統（Idle、Walk、Run）
- ✅ 實作 `src/entities/modelLoader.js`：模型載入器
- 🚧 牆面與地板貼圖優化（基礎已實作）
- ⬜ 調整燈光營造更好的 Backrooms 氛圍

### 音效系統
- ⬜ 加入環境音效（空調、燈光嗡嗡聲）
- ⬜ 加入怪物音效（腳步聲、叫聲）
- ⬜ 加入玩家腳步聲
- ⬜ 音效空間化（3D audio）

### UI 系統
- ✅ 迷你地圖（Minimap）- `src/rendering/minimap.js`
- ✅ 遊戲狀態管理（`src/core/gameState.js`）
- ✅ 出口點提示（`src/world/exitPoint.js`）
- ✅ Debug 面板（怪物模型切換、參數調整）
- ⬜ 開始 / 暫停菜單優化
- ⬜ 遊戲結束畫面

### 多怪物支援與效能
- ✅ 支援多隻怪物同時存在
- ✅ 怪物管理器（`src/entities/monsterManager.js`）
- ✅ 5種不同怪物類型
- ⬜ 效能優化（InstancedMesh、物件池）
- ⬜ LOD 系統（距離遠時降低模型精度）

### 遊戲體驗
- ✅ 碰撞檢測優化
- ✅ 玩家移動優化（衝刺功能）
- ⬜ 被抓到時的反饋（音效、畫面）
- ⬜ 找到出口時的反饋
- ⬜ 難度遞增機制

**Phase 5 完成標準：**
- ✅ 多隻怪物流暢運作
- ✅ 迷你地圖顯示完整
- ⬜ 音效系統完整
- ⬜ 視覺效果更精緻

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

# 中英術語對照表（Glossary）

本文件集中管理專案中所有專業術語的中英對照，確保文件與溝通一致性。

**使用規則：**
- Markdown 文件首次提到術語時附英文，例如：迷宮生成（Maze Generation）
- 後續可直接使用英文縮寫或中文
- 程式碼、註解、變數名稱一律使用英文

---

## 遊戲相關（Game Related）

| 中文 | English | 說明 |
|------|---------|------|
| 迷宮 | Maze | 本專案的主要遊戲空間結構 |
| 第一人稱視角 | First-person View (FPV) | 玩家控制相機的視角模式 |
| 隨機生成 | Procedural Generation | 使用演算法動態生成內容 |
| 格子 / 方格 | Tile / Grid Cell | 地圖的基本單位 |
| 牆 | Wall | 不可通過的格子 |
| 地板 | Floor | 可通過的格子 |
| 出生點 | Spawn Point | 玩家或怪物的初始位置 |
| 怪物 | Monster | AI 控制的敵對實體 |
| 巡邏 | Patrol | 怪物沿路徑移動的行為 |
| 追擊 | Chase | 怪物追蹤玩家的行為 |
| 搜尋 | Search | 怪物在最後目擊位置尋找玩家 |
| 視線 | Line of Sight (LOS) | 判斷兩點間是否有遮擋 |
| 視距 | Vision Range | 怪物能看到物體的最大距離 |
| 視野範圍 | Field of View (FOV) | 怪物能看到的角度範圍 |
| 碰撞檢測 | Collision Detection | 防止物體穿過牆壁的機制 |

---

## 演算法相關（Algorithm Related）

| 中文 | English | 說明 |
|------|---------|------|
| 深度優先搜尋 | Depth-First Search (DFS) | 迷宮生成演算法之一 |
| A* 演算法 | A* (A-star) Algorithm | 路徑搜尋演算法 |
| 啟發式函式 | Heuristic Function | A* 中的估計成本函式 |
| 曼哈頓距離 | Manhattan Distance | Grid 中的距離度量方式 |
| 有限狀態機 | Finite State Machine (FSM) | AI 行為管理模式 |
| 狀態轉移 | State Transition | FSM 中從一個狀態切換到另一個 |
| 路徑搜尋 | Pathfinding | 尋找從起點到終點的路徑 |
| 射線投射 | Raycasting | 檢測視線或碰撞的技術 |
| 二元空間分割 | Binary Space Partitioning (BSP) | 進階迷宮生成演算法 |
| 元胞自動機 | Cellular Automata | 另一種生成演算法 |

---

## 技術相關（Technical Related）

| 中文 | English | 說明 |
|------|---------|------|
| 三維渲染引擎 | 3D Rendering Engine | 本專案使用 Three.js |
| 場景 | Scene | Three.js 中的場景物件 |
| 網格 / 模型 | Mesh | Three.js 中的 3D 物體 |
| 材質 | Material | 控制物體外觀的屬性 |
| 貼圖 | Texture | 應用在材質上的圖片 |
| 相機 | Camera | 控制視角的物件 |
| 渲染器 | Renderer | 將場景繪製到畫布的元件 |
| 遊戲迴圈 | Game Loop | 每幀更新遊戲狀態的主循環 |
| Delta Time (dt) | Delta Time | 兩幀之間的時間差 |
| 模組 | Module | 獨立功能的程式單元 |
| 資料流 | Data Flow | 資料在系統間的傳遞路徑 |
| 事件系統 | Event System | 元件間解耦的溝通機制 |
| 熱更新 | Hot Module Replacement (HMR) | 開發時即時更新程式碼 |

---

## 開發流程相關（Development Process）

| 中文 | English | 說明 |
|------|---------|------|
| 單一真相檔 | Single Source of Truth (SSOT) | 每個主題只有一個權威文件 |
| 最小可行版本 | Minimum Viable Product (MVP) | 具備核心功能的最小產品 |
| 技術債 | Technical Debt | 為快速開發而犧牲的程式品質 |
| 重構 | Refactoring | 改善程式結構但不改變功能 |
| 原型 | Prototype | 快速驗證概念的實驗性版本 |
| 約定式提交 | Conventional Commits | 結構化的 Git commit 訊息格式 |

---

## Backrooms 相關術語

| 中文 | English | 說明 |
|------|---------|------|
| 後室 / 類後室 | Backrooms / Backrooms-like | 無限重複的詭異空間風格 |
| 異常 | Anomaly | 特殊的、不符合規律的空間或事件 |
| 樓層 / 層級 | Level | Backrooms 世界觀中的不同區域 |
| 脫離現實 | Noclip | 進入 Backrooms 的行為（本專案不實作） |

---

## 縮寫對照

| 縮寫 | 全稱 | 中文 |
|------|------|------|
| **FPV** | First-person View | 第一人稱視角 |
| **LOS** | Line of Sight | 視線 |
| **FOV** | Field of View | 視野範圍 |
| **DFS** | Depth-First Search | 深度優先搜尋 |
| **BFS** | Breadth-First Search | 廣度優先搜尋 |
| **FSM** | Finite State Machine | 有限狀態機 |
| **BSP** | Binary Space Partitioning | 二元空間分割 |
| **AI** | Artificial Intelligence | 人工智慧 |
| **MVP** | Minimum Viable Product | 最小可行版本 |
| **SSOT** | Single Source of Truth | 單一真相檔 |
| **HMR** | Hot Module Replacement | 熱更新 |

---

## 修訂記錄（Revision History）

| 日期 | 版本 | 修改內容 | 修改者 |
|------|------|---------|--------|
| 2025-11-20 | v0.1 | 初版：建立核心術語表 | Claude Code |

---

**注意：新增術語時請更新本文件，確保專案溝通一致性。**

# 演算法筆記（Algorithm Notes）

**專案：** Procedural 3D Maze Prototype
**用途：** 記錄所有演算法設計、實作細節與優化方向

本文件集中管理專案中所有演算法相關內容，包含：
- 迷宮生成（Maze Generation）
- 路徑搜尋（Pathfinding, A*）
- 視覺/感知（Vision/FOV/LOS, Noise, Scent）
- 反抖動/脫困（Anti-oscillation / Unstuck）

備註：

- 本專案早期曾以 FSM/行為樹（Behavior Tree）做過筆記；**目前實作主軸為 brain/module 組合**。AI 全套現況請以 `docs/assistant/AI.md` 為準。

**禁止**另外建立 `maze_notes.md`、`pathfinding_notes.md` 等分散檔案。

---

## 實作對照（Where In Code）

| 主題 | 主要檔案 |
|---|---|
| 迷宮生成 | `src/world/mapGenerator.js`, `src/world/worldState.js` |
| 路徑搜尋（A*） | `src/ai/pathfinding.js` |
| 視線（LOS） | `src/world/worldState.js:hasLineOfSight()` |
| 視覺（FOV/視錐） | `src/entities/monsterManager/perception.js:canMonsterSeePlayer()`、`src/ai/components/perception/vision.js` |
| 噪音/聽覺 | `src/entities/monsterManager/perception.js`、`src/core/noiseBridgeSystem.js` |
| 氣味/嗅覺 | `src/entities/monsterManager/perception.js` |
| 脫困（No-progress） | `src/core/gameLoop.js`（`noProgress` system）、`src/player/playerController.js:forceUnstuck()` |
| 路口反抖動（Step lock） | `src/ai/autoPilot.js` |

## 一、迷宮生成（Maze Generation）

### 1.1 演算法選擇

**Phase 1（MVP）：DFS-based Maze Generation（深度優先搜尋迷宮生成）**

**選擇理由：**
- 實作簡單，適合快速原型開發
- 生成的迷宮具有長走廊特性，符合 Backrooms 風格
- 計算效率高，適合即時生成

**演算法概述：**
1. 建立一個 `width × height` 的 grid，初始全為牆（Wall）
2. 選擇起始點，標記為地板（Floor）
3. 使用 DFS 遞迴訪問鄰居：
   - 隨機選擇未訪問的鄰居
   - 打通中間的牆
   - 遞迴訪問該鄰居
4. 回溯直到所有可達格子都被訪問

**優點：**
- 保證連通性（所有地板格子相連）
- 生成速度快（O(n)，n 為格子數）
- 長走廊多，探索感強

**缺點：**
- 可能產生過多死路
- 缺乏大型開放空間

### 1.2 實作細節（Phase 2 - DFS Maze Generation）

#### **演算法步驟詳解**

**1. 初始化階段**
```javascript
// 建立 grid：width × height 的 2D 陣列
// 所有格子初始為牆（TILE_TYPES.WALL = 0）
// 只有奇數位置（1, 3, 5...）會被考慮為潛在走道
```

**2. 選擇起始點**
```javascript
// 起始點必須在奇數座標（確保迷宮結構對稱）
// 例如：(1, 1) 或隨機選擇的奇數座標
```

**3. DFS 遞迴訪問**
```javascript
function carvePath(x, y) {
  // 1. 標記當前格子為地板（TILE_TYPES.FLOOR = 1）
  // 2. 定義四個方向：上、下、左、右
  //    directions = [
  //      {dx: 0, dy: -2},  // 上（每次移動 2 格）
  //      {dx: 0, dy: 2},   // 下
  //      {dx: -2, dy: 0},  // 左
  //      {dx: 2, dy: 0}    // 右
  //    ]
  // 3. 隨機打亂方向陣列（產生隨機迷宮）
  // 4. 對每個方向：
  //    a. 計算鄰居座標 (nx, ny)
  //    b. 檢查鄰居是否在範圍內且未訪問
  //    c. 若符合條件：
  //       - 打通中間的牆（設置為地板）
  //       - 標記鄰居為地板
  //       - 遞迴呼叫 carvePath(nx, ny)
}
```

#### **為何每次移動 2 格？**

移動 2 格是為了確保：
- 牆與走道交替出現
- 形成明確的「格子」結構
- 避免相鄰走道直接連通（保持迷宮挑戰性）

**範例：**
```
初始（全牆）  →  DFS 處理中  →  完成
# # # # #      # # # # #      # # # # #
# # # # #      # . # . #      # . # . #
# # # # #  =>  # . . . #  =>  # . . . #
# # # # #      # # # . #      # # # . #
# # # # #      # # # # #      # # # # #
```

#### **實作參數**

```javascript
// 鄰居選擇策略：4-way（上下左右）
DIRECTIONS = [
  { dx: 0, dy: -2 },  // North
  { dx: 2, dy: 0 },   // East
  { dx: 0, dy: 2 },   // South
  { dx: -2, dy: 0 },  // West
];

// 地圖尺寸必須為奇數（確保邊界為牆）
// 例如：15×15, 21×21, 31×31
```

#### **連通性保證**

DFS 演算法**天生保證連通性**：
- 從單一起點開始
- 只訪問未訪問的格子
- 所有被訪問的格子都能追溯回起點
- 因此不會產生孤島

#### **隨機性控制**

**方法 1：使用 Math.random()（當前實作）**
```javascript
// 每次執行產生不同迷宮
directions.sort(() => Math.random() - 0.5);
```

**方法 2：使用 Seed（未來擴充）**
```javascript
// 可重現的隨機迷宮
// 實作 seeded random generator
// 例如：Mulberry32, SplitMix32
```

#### **死路處理（選用）**

若希望減少死路，可在生成後進行 post-processing：

```javascript
function removeDeadEnds(grid, percentage) {
  // 1. 遍歷所有地板格子
  // 2. 計算每個格子的鄰居數量
  // 3. 若只有 1 個鄰居（死路）：
  //    - 隨機打通一面牆（依機率）
  //    - 增加迷宮的連通性
}
```

**注意：** 過度移除死路會讓迷宮失去挑戰性，Phase 2 暫不實作。

#### **邊界處理**

```javascript
// 確保邊界始終為牆
// 方法：地圖尺寸設為奇數，且從 (1,1) 開始生成
// 這樣邊界（0, width-1, 0, height-1）自然保持為牆
```

#### **效能考量**

**時間複雜度：** O(W × H)
- 每個格子最多訪問一次

**空間複雜度：** O(W × H)
- Grid 陣列本身
- 遞迴堆疊最壞情況 O(W × H)（極深的迷宮）

**實測效能（估計）：**
- 15×15：< 1ms
- 31×31：< 5ms
- 101×101：< 50ms

適合即時生成，無需預先計算。

### 1.3 未來擴充方向

**Room + Corridor（房間與走廊）**
- 先生成幾個大房間（矩形區域）
- 再用走廊連接房間
- 適合加入特殊房間（道具、怪物巢穴）

**BSP（Binary Space Partitioning）**
- 遞迴切割空間
- 適合多樓層建築風格
- 可控制房間大小比例

**Cellular Automata（元胞自動機）**
- 適合生成有機、不規則的洞穴
- 需要額外連通性檢查

---

## 二、路徑搜尋（Pathfinding）

### 2.1 演算法選擇

**A* (A-star) Algorithm**

**選擇理由：**
- 業界標準，兼顧效率與最優性
- 適合 grid-based 地圖
- 易於理解與調整

### 2.2 A* 核心概念

**評估函式：**
```
f(n) = g(n) + h(n)
```

- **g(n)**：從起點到節點 n 的實際成本
- **h(n)**：從節點 n 到目標的估計成本（heuristic）
- **f(n)**：總評估成本

**Heuristic 選擇：Manhattan Distance（曼哈頓距離）**

適合 4-way grid movement：
```javascript
h(n) = |n.x - goal.x| + |n.y - goal.y|
```

若使用 8-way movement，可改用：
```javascript
h(n) = Math.max(|n.x - goal.x|, |n.y - goal.y|) // Chebyshev distance
```

### 2.3 實作細節（待 Phase 3 完成後補充）

**資料結構：**
- **Open Set**：待評估節點（使用 Priority Queue 或簡單陣列 + 排序）
- **Closed Set**：已評估節點（使用 Set）
- **Parent Map**：記錄路徑回溯

**演算法流程：**
1. 將起點加入 Open Set
2. While Open Set 非空：
   - 取出 f 值最小的節點 current
   - 若 current 是目標 → 回溯路徑並返回
   - 將 current 加入 Closed Set
   - 對每個鄰居 neighbor：
     - 若在 Closed Set → 跳過
     - 計算 g_new = g(current) + cost(current, neighbor)
     - 若 neighbor 不在 Open Set 或 g_new 更小：
       - 更新 g(neighbor)、f(neighbor)、parent(neighbor)
       - 加入 Open Set
3. 若 Open Set 空了仍未找到 → 無路徑

### 2.4 優化方向

**問題：怪物頻繁重新計算路徑（每幀）導致效能問題**

**解決方案：**
- **限制更新頻率**：每 0.5 秒更新一次路徑
- **增量更新**：玩家移動距離不大時，僅調整路徑末端
- **路徑平滑**：使用 String Pulling 或 Funnel Algorithm

---

## 三、視線判斷（Line-of-Sight, LOS）

### 3.1 需求定義

怪物需要判斷「是否看得到玩家」，需滿足三個條件：

1. **距離條件**：玩家在怪物視距內
2. **視角條件**：玩家在怪物視野錐範圍內（FOV）
3. **遮擋條件**：怪物與玩家之間沒有牆壁阻擋

### 3.2 實作方案

#### 方案一：Grid-based Raycasting（初期實作）

**適用場景：** 簡單快速，適合 grid 世界

**步驟：**
1. 計算怪物到玩家的向量
2. 檢查距離：`distance < VISION_RANGE`
3. 檢查視角：`angle < FOV / 2`
4. 使用 Bresenham 演算法或逐步檢查：
   - 從怪物位置到玩家位置，逐格檢查
   - 若遇到牆 → 視線被阻擋
   - 若無牆 → 可見

**優點：**
- 實作簡單
- 效能可接受（路徑短時）

**缺點：**
- 精度受限於 grid 解析度
- 無法處理部分遮擋

#### 方案二：Three.js Raycaster（進階實作）

**適用場景：** 需要精確視線判斷

**步驟：**
```javascript
const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3()
  .subVectors(playerPos, monsterPos)
  .normalize();

raycaster.set(monsterPos, direction);
const intersects = raycaster.intersectObjects(wallMeshes);

// 檢查是否有物體比玩家更近
const distanceToPlayer = monsterPos.distanceTo(playerPos);
const blocked = intersects.some(hit => hit.distance < distanceToPlayer);
```

**優點：**
- 精確度高
- 可處理複雜場景

**缺點：**
- 效能開銷較高（需限制更新頻率）

### 3.3 實作細節（待 Phase 4 完成後補充）

- 選用方案與理由
- 效能測試結果
- 視角錐範圍可視化（debug mode）

---

## 四、有限狀態機（Finite State Machine, FSM）

### 4.1 怪物狀態定義

| 狀態 | 說明 | 持續條件 | 退出條件 |
|------|------|---------|---------|
| **Idle** | 靜止不動 | 初始狀態 | 玩家進入視距 → Chase |
| **Patrol** | 沿預設路線巡邏 | 無玩家目擊 | 偵測到玩家 → Chase |
| **Chase** | 追擊玩家 | 持續看到玩家 | 失去視線 > 2 秒 → Search |
| **Search** | 在最後目擊位置搜尋 | 失去視線後 5 秒內 | 找到玩家 → Chase<br>超時 → Patrol |

### 4.2 狀態轉移圖

```
    [Idle/Patrol]
         ↓ (detect player)
      [Chase]
         ↓ (lose sight > 2s)
      [Search]
         ↓ (timeout or re-detect)
    [Patrol/Chase]
```

### 4.3 FSM 實作架構（待 Phase 4 完成後補充）

```javascript
class FSM {
  constructor(initialState) {
    this.currentState = initialState;
    this.states = {};
  }

  addState(name, { onEnter, onUpdate, onExit }) {
    this.states[name] = { onEnter, onUpdate, onExit };
  }

  transition(newState) {
    if (this.currentState === newState) return;
    this.states[this.currentState].onExit?.();
    this.currentState = newState;
    this.states[newState].onEnter?.();
  }

  update(dt) {
    this.states[this.currentState].onUpdate?.(dt);
  }
}
```

### 4.4 狀態細節設計

**Patrol 狀態：**
- 選項 1：預設路徑巡邏（Waypoints）
- 選項 2：隨機漫步（Random Walk）
- 需決定：如何避免來回震盪

**Chase 狀態：**
- 每 0.5 秒更新 A* 路徑
- 沿路徑移動，但視線內直接朝玩家移動（可選）

**Search 狀態：**
- 在 last_seen_position 附近生成 3-5 個搜尋點
- 依序訪問這些點
- 超時後回到 Patrol

---

## 五、效能優化筆記

### 5.1 已知瓶頸

| 問題 | 影響 | 優化方案 |
|------|------|---------|
| 每幀執行 A* | CPU 使用率高 | 限制為每 0.5 秒 |
| 大地圖 Mesh 數量多 | 記憶體與渲染壓力 | 使用 InstancedMesh |
| 多怪物同時 Raycasting | 效能下降 | 分幀執行、距離剔除 |

### 5.2 優化優先級

**初期（MVP）：**
- 先確保正確性，不過度優化
- 限制地圖大小（31×31）與怪物數量（1-3 隻）

**後期：**
- 使用 Performance Profiler 找出瓶頸
- 針對性優化

---

## 六、參考資源（References）

### 6.1 迷宮生成
- [Maze Generation Algorithm (Wikipedia)](https://en.wikipedia.org/wiki/Maze_generation_algorithm)
- [Procedural Dungeon Generation (Red Blob Games)](https://www.redblobgames.com/maps/dungeon/)

### 6.2 A* 路徑搜尋
- [A* Pathfinding (Red Blob Games)](https://www.redblobgames.com/pathfinding/a-star/)
- [A* Algorithm (Wikipedia)](https://en.wikipedia.org/wiki/A*_search_algorithm)

### 6.3 FSM
- [Game Programming Patterns - State](https://gameprogrammingpatterns.com/state.html)

---

## 七、修訂記錄（Revision History）

| 日期 | 版本 | 修改內容 | 修改者 |
|------|------|---------|--------|
| 2025-11-20 | v0.1 | 初版：定義演算法框架，待實作後補充細節 | Claude Code |

---

**注意：所有演算法相關內容必須更新於此文件，禁止建立任何分散的筆記檔案。**

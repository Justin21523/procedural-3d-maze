# CLAUDE Code 指南（Procedural 3D Maze / Three.js Prototype）

**Audience:** Claude Code（claude.ai/code）
**Scope:** 使用 **JavaScript + Three.js** 製作一個小型、可隨機生成 3D 迷宮的 prototype，具備第一人稱視角移動與基本「可愛怪物」AI（偵測、追擊、巡邏），**重點是學習與實作演算法**，不是做 AAA 級畫面。
**Style:** 文件一律**繁體中文**為主，**重要名詞中英對照**；所有**程式碼／註解／型別註記／docstring／檔名一律 English only**。

---

## 0) 不可違反的核心原則

1. **單一真相檔（Single Source of Truth, SSOT）**

   * 同一主題只允許**更新原檔**；禁止產生 `*_v2.md`、`*_final.md`、`notes*.md` 等副本。
   * 需要大改內容時，在原檔加一個「修訂記錄」小節即可。
2. **禁止臨時檔／臨時資料夾**

   * 不得建立 `tmp/`、`scratch/`、`playground/`、`misc/`、`test.html` 這種垃圾檔。
   * 短期測試請直接在既有檔案中切一個小段程式、或用瀏覽器 DevTools / console 測試，驗證後移除。
3. **文件新增需理由且先登記**

   * 只有在既有文件**完全沒有對應角色**時才新增新檔。
   * 新增前必須先更新 `docs/README.md` 的「文件地圖」，寫清楚要新增哪個 markdown 檔、用途是什麼。
4. **高可讀性實作，而不是耍花招**

   * 重點是**演算法的清楚結構與可讀性**，不是炫技一行寫完。
   * 每個模組、類別、主要函式，都要有 English 註解說明 **what / why / how**。
   * 所有邏輯應拆成小函式；避免 God file／God class。
5. **極簡依賴（Minimal Tooling）**

   * 初期不使用 React、Vue 等前端框架，不引入複雜 bundler。
   * 優先使用「原生 ES Modules + 三方 library（Three.js 等）」，搭配最簡單的 dev server（例如 `npm run dev` 內建小伺服器或 `vite` 的最小配置）。
   * 若真的需要 build tool，必須先在 `docs/TECH_DESIGN.md` 說明理由，再做最小必要設定。
6. **Conventional Commits**

   * 提交訊息使用：`feat|fix|docs|refactor|test|chore:` 前綴。
   * 每次改動盡量聚焦一件事（例如「新增迷宮生成」「調整怪物巡邏 FSM」），不要一大包混在一起。

---

## 1) 專案固定目錄骨架

```bash
.
├─ README.md                    # 專案整體說明（玩家＋開發者簡介）
├─ docs/
│  ├─ README.md                # 文件地圖＋治理規則摘要
│  ├─ GAME_DESIGN.md           # 遊戲設計（玩法、關卡、怪物、氛圍）
│  ├─ TECH_DESIGN.md           # 技術設計（架構、模組拆分、資料流）
│  ├─ AI_ALGO_NOTES.md         # 演算法筆記（迷宮生成、A*、FSM 等）
│  ├─ GLOSSARY_中英術語.md      # 名詞中英對照（集中維護）
│  ├─ CHANGELOG.md             # 結構與系統重大變更
│  └─ TODO.md                  # 高層級功能待辦（Feature-level）
├─ public/
│  └─ index.html               # 單一入口頁面（三.js canvas + UI）
├─ src/
│  ├─ core/
│  │  ├─ gameLoop.js          # 主迴圈與更新流程
│  │  ├─ eventBus.js          # 簡易事件系統（選用）
│  │  └─ config.js            # 遊戲整體設定（迷宮大小、怪物數量等）
│  ├─ rendering/
│  │  ├─ scene.js             # Three.js 場景建立與管理
│  │  ├─ camera.js            # 第一人稱相機（視角控制）
│  │  └─ lighting.js          # 燈光設定（Backrooms 風格）
│  ├─ world/
│  │  ├─ mapGenerator.js      # 迷宮／房間生成（核心演算法）
│  │  ├─ tileTypes.js         # 格子／房間類型定義
│  │  └─ worldState.js        # 世界狀態（地圖、spawn points 等）
│  ├─ player/
│  │  ├─ playerController.js  # 玩家移動與碰撞檢查
│  │  └─ input.js             # 鍵盤／滑鼠輸入處理
│  ├─ ai/
│  │  ├─ pathfinding.js       # A* 或其他路徑搜尋
│  │  ├─ fsm.js               # 簡易有限狀態機（FSM）
│  │  └─ monsters.js          # 怪物實作（巡邏、偵測、追擊）
│  └─ utils/
│     ├─ math.js              # 工具數學函式（向量、距離等）
│     └─ random.js            # 隨機數工具（seedable random, shuffle）
├─ assets/
│  ├─ models/                 # （選用）之後若有可愛怪物 3D 模型
│  ├─ textures/               # 牆面、地板等貼圖
│  └─ sounds/                 # 環境音、怪物聲（可後期再加）
├─ scripts/
│  └─ dev.md                  # 開發／啟動說明（npm script 如何使用）
├─ package.json
└─ .gitignore
```

> **只允許**在上述骨架下新增檔案；新增前優先考慮是否可擴充既有模組，而不是亂開新層級。

---

## 2) 文件治理（固定清單＋更新規則）

固定文件：

* `docs/README.md`：文件地圖與治理規則摘要（新增文件前必改這裡）。
* `docs/GAME_DESIGN.md`：遊戲玩法與體驗設計的一切。
* `docs/TECH_DESIGN.md`：技術架構、模組關係、資料流與決策理由。
* `docs/AI_ALGO_NOTES.md`：所有與演算法相關的筆記（**迷宮生成、A*、視線判斷、FSM 等都集中這裡**）。
* `docs/GLOSSARY_中英術語.md`：術語表。
* `docs/CHANGELOG.md`：重大架構改動紀錄。
* `docs/TODO.md`：功能層級 TODO，不要拿來記流水帳。

規則：

* 新功能／結構調整 → 優先更新 `TECH_DESIGN.md` 與 `GAME_DESIGN.md`。
* 新的演算法概念或變體 → 記錄在 `AI_ALGO_NOTES.md`，不要另外開 `maze_notes.md` 之類的檔。
* 嚴禁自動產生「總結.md／notes.md／analysis.md」等泛用名字；所有內容必須歸屬到上述固定檔之一。

---

## 3) 語言規範

* **Markdown 文件**：繁體中文為主，**首次出現關鍵術語時附（English）**，後面可直接用英文縮寫。
* **程式碼、註解、變數名稱、檔名**：**English only**。

  * 函式、類別必須有簡潔 English 註解（描述目的與使用方式）。
* **提交訊息、Issue / PR 標題與內容**：一律 English，並使用 Conventional Commits。

---

## 4) 遊戲願景與設計重點（給 Claude 的共識）

這個專案**不是**要做完整商業遊戲，而是：

1. **主題與風格**

   * 類 Backrooms（Backrooms-like）：

     * 無限、重複但略有變化的學校／辦公空間走廊。
   * **第一人稱視角（First-person view）**：玩家像拿著相機在迷宮裡走。
   * 氛圍偏詭異但怪物是 **可愛風格（Cute monsters）**，偏實驗室玩具、搞笑幽靈，而不是血腥恐怖。

2. **最小可行玩法（MVP）**

   * 每次啟動遊戲 → 產生一張新的 3D 迷宮地圖。
   * 玩家可以用鍵盤 WASD＋滑鼠看視角在迷宮內走動。
   * 至少一隻怪物：

     * 會巡邏（Patrol）
     * 一旦偵測到玩家就會追击（Chase）
     * 失去目標後會搜尋一下再回到巡邏。

3. **學習重點 = 演算法實作與體驗**

   * 隨機迷宮生成（Procedural maze / dungeon generation）
   * 路徑搜尋（Pathfinding, e.g., A*）
   * 視線判斷（Line-of-sight）與基本 AI 行為（FSM）
   * 把這些結果透過 Three.js 直接「看得見」。

> **美術與 UI 不是重點**：畫面只要看得懂就好，方塊牆＋簡單光線即可。Claude 不要花大力氣在 shader、特效或 UI 菜單上。

---

## 5) 系統拆分（Claude 應該怎麼分模組）

### 5.1 世界與地圖（World / Map）

**目標：** 使用一個簡單的 2D grid 來表達 3D 迷宮結構，再把它轉成 Three.js 場景。

* `world/mapGenerator.js`

  * 提供可參數化的迷宮生成函式，例如：

    * `generateMaze(width, height, options)`
  * 支援至少一種演算法：

    * DFS-based maze generation
    * 或 Room + Corridor style（可後續加入 BSP 等）。
  * 輸出為 2D 陣列：

    * 例如 `0 = wall`, `1 = floor`, 之後可擴充成 `2 = room`, `3 = special tile` 等。

* `world/worldState.js`

  * 管理目前的地圖資料、spawn points（玩家出生點、怪物出生點）、出口位置等。
  * 提供 API 給其他模組查詢：

    * `isWalkable(x, y)`
    * `getRandomSpawnPoint()` 等。

* `world/tileTypes.js`

  * 集中定義各種 tile 類型與其屬性（是否可走、是否可見等）。

### 5.2 繪圖與視角（Rendering / Camera）

**目標：** 把 grid 轉成 3D 牆與地板，並建立第一人稱相機。

* `rendering/scene.js`

  * 建立 Three.js `Scene`，負責把地圖格子變成 Mesh。
  * 提供 `buildWorldFromGrid(grid)` 等函式。

* `rendering/camera.js`

  * 建立第一人稱 Camera（例如 `PerspectiveCamera`），
  * 負責處理滑鼠看視角（Yaw / Pitch），與玩家位置同步。

* `rendering/lighting.js`

  * 設定基本光源（環境光 + 幾個點光源），營造「過亮＋有點髒」的 Backrooms 感覺（不用太龜毛）。

### 5.3 玩家系統（Player）

* `player/input.js`

  * 統一處理鍵盤（WASD / Shift）、滑鼠移動／鎖定（pointer lock）。

* `player/playerController.js`

  * 管理玩家在 grid 上的位置、碰撞判定（不能穿牆）。
  * 負責把 grid 座標 → 3D world position，並同步 Camera。

### 5.4 怪物與 AI 系統（AI）

* `ai/pathfinding.js`

  * 實作 A* 或其他路徑搜尋，對 grid 做 pathfinding。
  * 對外 API 例：

    * `findPath(grid, start, goal)` → 回傳一組座標列表。

* `ai/fsm.js`

  * 提供簡單的有限狀態機工具：

    * 支援狀態切換、更新等。

* `ai/monsters.js`

  * 定義 Monster 類別：

    * State: `Patrol`, `Chase`, `Search`, `Idle`…
    * 感知：視線判斷（距離、視角、raycast 是否被牆擋住）。
    * 移動：沿著 path 一個節點一個節點走。
  * **怪物外型以可愛方塊 / 簡單模型為主**，行為比外觀重要。

### 5.5 核心遊戲迴圈（Core）

* `core/gameLoop.js`

  * 負責 `update(deltaTime)`：

    * 更新玩家位置
    * 更新怪物 AI
    * 觸發必要事件（之後可擴充 anomaly 系統）。

* `core/config.js`

  * 集中設定如：迷宮大小、牆高、玩家移動速度、怪物數量、怪物視距等。

---

## 6) 演算法重點（Claude 必須優先完成的）

這裡是 **Claude 寫程式時的優先順序**，所有細節請集中記錄到 `docs/AI_ALGO_NOTES.md`：

1. **迷宮生成（Maze Generation）**

   * 初版建議用 **DFS-based maze**：

     * Grid-based、四方向或八方向皆可。
     * 避免過多死路可再做簡單 post-processing。
   * 之後可擴充：

     * Room + corridor（帶一些較大「房間」的結構）；
     * BSP（Binary Space Partitioning）做校園樓層感。

2. **路徑搜尋（Pathfinding）**

   * 實作 A*（A-star）：

     * Grid 版，使用 Manhattan distance 當 heuristic。
     * 需考量「牆 vs 可走格」。
   * 要能支援「怪物持續更新目標位置」的情境（目標在移動）。

3. **視線判斷（Line of Sight）**

   * 在 grid 層級：用 Bresenham / 逐步檢查方式確認中間有沒有牆。
   * 在 3D 層級：用 Three.js Raycaster 檢查玩家與怪物間是否被牆 Mesh 擋住。

4. **狀態機（Finite State Machine, FSM）**

   * 每隻怪物有清楚的狀態：

     * `Patrol`：循環／隨機路線漫步。
     * `Chase`：目標為玩家位置，持續用 A* 更新路徑。
     * `Search`：失去視線後，围着 last seen 位置繞一小圈。
   * 狀態切換條件與冷卻時間需寫清楚在 `AI_ALGO_NOTES.md`。

---

## 7) 開發工作流（給 Claude 的常規流程）

每次 Claude 要動手做事，請遵守：

1. **先更新／確認對應文件**

   * 若涉及遊戲規則 → 更新 `GAME_DESIGN.md` 對應段落。
   * 若涉及架構或檔案分布 → 更新 `TECH_DESIGN.md`。
   * 若涉及演算法細節 → 更新 `AI_ALGO_NOTES.md`。

2. **再調整程式碼**

   * 嚴格依 `src/` 下既有模組結構擴充；不要亂新開平行世界。
   * 所有函式與類別均需 English 註解。

3. **最後回寫 CHANGELOG / TODO（視需要）**

   * 若是「重大改動」（例如：迷宮生成方式改掉）→ `CHANGELOG.md` 新增條目。
   * 若只是追加小功能 → 更新 `TODO.md` 的完成狀態即可。

---

## 8) 與 Claude Code 的互動模板（請直接改參數使用）

### A. 專案初始 Scaffold（第一次叫 Claude 做的事）

> 目標：建立專案目錄骨架（public/src/docs/...），並完成最小可執行版本：
>
> * 在瀏覽器中顯示一個簡單 3D 場景（地板＋幾面牆）；
> * 有第一人稱相機（WASD 移動、滑鼠視角）；
> * 地圖先用**寫死的 2D grid**，尚未隨機生成。
>
> 要求：
>
> 1. 依我提供的目錄結構建立檔案與資料夾（不得額外創建 `tmp/` 或隨意命名文件）。
> 2. 在 `docs/README.md` 建立文件地圖；在 `GAME_DESIGN.md` 與 `TECH_DESIGN.md` 寫下最小設計草稿。
> 3. 實作 `public/index.html`、`src/rendering/scene.js`、`src/rendering/camera.js`、`src/player/input.js`、`src/player/playerController.js`、`src/core/gameLoop.js` 的最小版本，讓我可以 `npm install` 後用一個簡單 script 執行（請在 `scripts/dev.md` 說明）。
> 4. 所有程式碼與註解一律 English，文件一律繁體中文。

### B. 實作「隨機迷宮生成」（Map Generator）

> 目標：將目前寫死的地圖，改為每次啟動都使用 DFS 迷宮演算法隨機生成。
>
> 要求：
>
> 1. 在 `docs/AI_ALGO_NOTES.md` 詳細說明使用的迷宮生成演算法（以 DFS 為例），包含：
>
>    * Grid 定義方式、起點選擇
>    * 走訪策略與回溯機制
>    * 為何適合本專案（Backrooms 風格）。
> 2. 在 `src/world/mapGenerator.js` 實作 `generateMaze(width, height, options)`，返回 2D grid。
> 3. 更新 `src/world/worldState.js` 與 `src/rendering/scene.js`，改為根據 `generateMaze` 的結果建立 3D 牆與地板。
> 4. 地圖尺寸（例如 31x31）需可從 `core/config.js` 調整。
> 5. 過程中不得新增任何臨時檔案或新的 docs，所有說明寫回既有文件。

### C. 實作 A* Pathfinding 與「怪物追逐」

> 目標：在 3D 迷宮中新增一隻怪物方塊，會使用 A* 尋路追玩家。
>
> 要求：
>
> 1. 在 `docs/AI_ALGO_NOTES.md` 補上 A* 演算法說明：
>
>    * f = g + h 的定義
>    * grid 上的鄰接規則（4 or 8 neighbors）
>    * heuristic 選擇（Manhattan distance）。
> 2. 在 `src/ai/pathfinding.js` 實作 `findPath(grid, start, goal)`，回傳節點陣列。
> 3. 在 `src/ai/monsters.js` 實作基礎 Monster 類別，可以：
>
>    * 取得自己的 grid 座標
>    * 定期呼叫 `findPath` 取得從自己到玩家的路徑
>    * 按時間沿著路徑移動（不要瞬間 teleport）。
> 4. 在 `GAME_DESIGN.md` 補上怪物行為描述（目前只需要「看得到玩家就追」的簡單行為）。

### D. 加入視線判斷與簡易 FSM（Patrol / Chase）

> 目標：讓怪物不再「無條件全地圖追擊」，而是擁有 Patrol / Chase 兩種狀態；只有在「看到玩家」時才切到 Chase。
>
> 要求：
>
> 1. 在 `docs/AI_ALGO_NOTES.md` 補充：
>
>    * 視線判斷（Line-of-sight）的條件：距離、視角、被牆遮擋與否。
>    * FSM 狀態與轉移條件（Patrol -> Chase -> Search -> Patrol）。
> 2. 在 `src/ai/fsm.js` 實作簡單 FSM helper。
> 3. 在 `src/ai/monsters.js` 更新 Monster 類別：
>
>    * 新增狀態與轉移條件
>    * Patrol 時使用預設路線或隨機 walk
>    * Chase 時用 A* 追玩家
>    * 若一段時間看不到玩家 → 切換到 Search，再回 Patrol。
> 4. 更新 `GAME_DESIGN.md` 補充對玩家體驗的影響（怪物行為應偏「可愛但有壓力」）。

### E. 重構／優化既有程式（Refactor）

> 僅針對既有程式碼進行 `refactor` 或 `fix`：
>
> * 合理拆分過於肥大的檔案或函式；
> * 移除重複程式；
> * 調整命名讓演算法更好懂。
>
> 所有修改需同步更新：
>
> * `TECH_DESIGN.md` 中的架構描述；
> * 若演算法有改動，更新 `AI_ALGO_NOTES.md`。

---

## 9) 首次待辦（由 Claude Code 執行）

第一次讓 Claude 進 repo 時，可以這樣要求它（步驟式）：

1. **建立專案骨架**

   * 依本指南第 1 節建立目錄與必要檔案（`public/index.html`、`src/...`、`docs/...`、`package.json`、`.gitignore`）。
   * 在 `docs/README.md` 寫出文件地圖與治理規則摘要。

2. **撰寫初版設計文件**

   * 在 `docs/GAME_DESIGN.md` 撰寫：

     * 遊戲目標與氛圍（Backrooms-like、可愛怪物）；
     * 最小可行玩法（隨機迷宮、第一人稱移動、基本追逐）。
   * 在 `docs/TECH_DESIGN.md` 撰寫：

     * 模組拆分（core / rendering / world / player / ai / utils）；
     * 資料流（grid → worldState → scene）。

3. **實作最小可執行版本**

   * 讓我可以：

     * `npm install`
     * 用一個簡單 `npm run dev`（或指定工具）跑起來，
     * 在瀏覽器看到：

       * 一片地板＋幾面牆；
       * 第一人稱相機可以用 WASD 移動，滑鼠轉視角。
   * 地圖先用寫死的 2D grid，放在適當位置（例如 `world/worldState.js`）。

4. **禁止事項**

   * 不得建立任何 `tmp/` 類資料夾或未在本指南中提及的雜項檔案。
   * 不得導入 React / Vue / 其他大型框架；若要使用 bundler（例如 Vite），必須在 `TECH_DESIGN.md` 先寫明理由。
   * 所有程式碼、註解使用 English；所有新增文件使用繁體中文。


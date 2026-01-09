# Runtime 架構與資料流（Architecture）

本文件用「給接手者」的角度描述：遊戲從哪裡啟動、每幀更新順序、資料/事件如何在系統間流動，以及擴充時最常需要插入的節點。

---

## 1) Boot 流程（從 `index.html` 到第一幀）

入口點：

- UI/DOM：`index.html`
- JS：`src/main.js`（`initGame()`）

`src/main.js` 大致做了：

1. 建立 `EventBus`：`src/core/eventBus.js`（事件名見 `src/core/events.js`）
2. 載入關卡（Levels）：`src/core/levelDirector.js` 從 `public/levels/manifest.json` 讀 `public/levels/*.json`，不足則用 `src/core/levelCatalog.js` fallback
3. 建立世界（World）：
   - `WorldState`：`src/world/worldState.js`（迷宮 grid、房間、碰撞、LOS…）
   - `SceneManager`：`src/rendering/scene.js`（把 `WorldState` 轉成 Three.js 場景物件）
4. 建立玩家/鏡頭（Player/Camera）：
   - `InputHandler`：`src/player/input.js`
   - `PlayerController`：`src/player/playerController.js`
   - `FirstPersonCamera`：`src/rendering/camera.js`
5. 建立戰鬥/掉落/AI/任務/道具等系統：
   - `MonsterManager`：`src/entities/monsterManager.js`
   - `ProjectileManager`：`src/entities/projectileManager.js`
   - `PickupManager`：`src/entities/pickupManager.js`
   - `SpawnDirector`：`src/core/spawnDirector.js`
   - `MissionDirector`：`src/core/missions/missionDirector.js`
   - `InteractableSystem`：`src/core/interactions/interactableSystem.js`
   - `ToolSystem`：`src/core/toolSystem.js`
   - `AutoPilot`：`src/ai/autoPilot.js`
6. 建立 UI/可視化：
   - `UIManager`：`src/ui/uiManager.js`
   - `Minimap`：`src/rendering/minimap.js`
   - `WorldMarkerSystem`：`src/rendering/worldMarkerSystem.js`
7. 建立並啟動 `GameLoop`：`src/core/gameLoop.js`

---

## 2) 每幀更新順序（SystemRegistry Update Order）

核心是 `src/core/gameLoop.js:GameLoop.registerSystems()`，用 `src/core/systemRegistry.js` 依 `order` 由小到大執行。

下表列出目前主要順序（建議擴充時維持語意：**決策 → 行動 → 互動 → 物理分離 → 視覺/UI**）：

| order | system | 主要責任 | 位置 |
|---:|---|---|---|
| 0 | `outcome` | 任何地方觸發 gameOver 時統一處理勝敗回呼/特效 | `src/core/gameLoop.js` |
| 10 | `autopilot` | 讀玩家輸入 idle 狀態，必要時產生 `externalCommand` | `src/core/gameLoop.js`, `src/ai/autoPilot.js` |
| 20 | `player` | 玩家移動/視角/碰撞/腳步噪音（含 Autopilot 外部指令） | `src/player/playerController.js` |
| 22 | `roomTracker` | 玩家進房事件（ROOM_ENTERED）與統計 | `src/core/gameLoop.js` |
| 24 | `timer` | 遊戲計時與 TIMER_TICK | `src/core/gameLoop.js` |
| 25 | `interactables` | Raycast hover + E 互動（玩家與 Autopilot 共用） | `src/core/interactions/interactableSystem.js` |
| 30 | `gun` | 玩家射擊/換彈/技能（玩家與 Autopilot 共用） | `src/player/gun.js` |
| 35 | `playerToolAI` | Autopilot 的道具策略（煙/閃/誘餌/陷阱…） | `src/core/playerToolAISystem.js` |
| 40 | `projectiles` | 子彈/投擲物/爆炸等更新 | `src/entities/projectileManager.js` |
| 50 | `spawnDirector` | 波次刷怪 + 掉落/起始道具生成 | `src/core/spawnDirector.js` |
| 55 | `tools` | 道具系統：部署/投擲/裝置更新/煙霧雲 | `src/core/toolSystem.js` |
| 57 | `worldMarkers` | 3D 世界標示（M 開關） | `src/rendering/worldMarkerSystem.js` |
| 60 | `monsters` | 怪物 AI tick / 移動 / 遠距離節流 / 射擊 | `src/entities/monsterManager.js` |
| 70 | `separation` | 玩家與怪物/牆壁分離；避免卡死與「被推擠」 | `src/core/gameLoop.js` |
| 80 | `noProgress` | 無進度偵測：卡住時 nudge 玩家/重置 Autopilot path | `src/core/gameLoop.js` |
| 90 | `meleeCollision` | 近戰接觸傷害（含 global limiter） | `src/core/gameLoop.js` |
| 120 | `exitAnim` | 出口動畫更新 | `src/world/exitPoint.js` |
| 130 | `lighting` | 燈光閃爍與光照更新 | `src/rendering/lighting.js` |
| 140 | `sceneUpdate` | SceneManager 每幀 tickables（例如特效） | `src/rendering/scene.js` |
| 150 | `visualEffects` | 畫面特效（受擊/勝利等） | `src/rendering/visualEffects.js` |
| 160 | `ui` | HUD/提示/結算畫面更新 | `src/ui/uiManager.js` |

補充：迷你地圖渲染在 `GameLoop.render()` 內，並且有節流（預設每 0.25s 更新一次）。

---

## 3) 外部控制指令（External Command）格式

Autopilot 會在「玩家一段時間沒有輸入」時接管，透過 `externalCommand` 把指令送進玩家與武器/互動系統。

- 產生：`src/ai/autoPilot.js:tick()`
- 決定是否接管：`src/core/gameLoop.js` 的 `autopilot` system
- 消費：
  - 移動/看向/防禦：`src/player/playerController.js:update(...)`
  - 射擊/技能：`src/player/gun.js:update(...)`
  - 互動：`src/core/interactions/interactableSystem.js:update(...)`（看 `ctx.forcedInteractId`）

常見欄位（實際以當前程式碼為準）：

```js
{
  move: { x: -1..1, y: -1..1 }, // strafe/forward
  lookYaw: radians,
  lookPitch: radians | null,
  sprint: boolean,
  block: boolean,
  fire: boolean,
  interact: false | true | "<interactableId>",
  camera: boolean // 用於相機任務（例如拍照）
}
```

---

## 4) 事件匯流排（EventBus）與典型資料流

事件名定義：`src/core/events.js`

幾條最重要的「跨系統」鏈路：

### 4.1 噪音（Noise）→ 怪物聽覺

1. 某系統提出噪音：`EVENTS.NOISE_REQUESTED`
   - 例：`ToolSystem`、槍械、地雷、誘餌等
2. `NoiseBridgeSystem` 轉成 `MonsterManager.registerNoise(...)`
   - `src/core/noiseBridgeSystem.js`
3. `MonsterManager` 在 `update()` 中把噪音交給各 brain：`brain.hearNoise(...)`
   - `src/entities/monsterManager.js`
4. `UIManager` 也會聽 `EVENTS.NOISE_EMITTED` 顯示噪音條
   - `src/ui/uiManager.js`

### 4.2 背包（Inventory）→ 道具/互動門檻

- `InventorySystem` 監聽：
  - `EVENTS.INVENTORY_GIVE_ITEM`
  - `EVENTS.INVENTORY_CONSUME_ITEM`
  - `EVENTS.INVENTORY_QUERY_ITEM`
- 實際資料存在 `GameState`（`src/core/gameState.js`）
- `InteractableSystem` 的 `requiresItem/consumeItem` 會透過事件查詢/消耗
  - `src/core/interactions/interactableSystem.js`
- `ToolSystem` 使用同樣的事件管道消耗道具
  - `src/core/toolSystem.js`

---

## 5) 擴充時的插入點（Extension Points）

### 5.1 新增一個 per-frame system

1. 實作 `update(dt, ctx)`（或用函式 `(dt, ctx) => {}`）
2. 在 `src/main.js` 建立實例並把 refs 傳好（scene/worldState/eventBus…）
3. 在 `src/core/gameLoop.js:registerSystems()` 加入 `systems.add(name, system, { order })`
4. 視需求把狀態/資料輸出成事件（`EventBus.emit(...)`）而不是直接操作 UI

### 5.2 新增一條跨系統事件

1. 在 `src/core/events.js` 新增常數
2. 由「產生事件的系統」`emit`，由「消費事件的系統」`on` 註冊
3. 文件同步更新（至少 `docs/assistant/ARCHITECTURE.md` 或對應主題文件）


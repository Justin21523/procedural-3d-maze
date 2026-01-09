# AI 全套：Enemy AI + AI Player（Autopilot）

本文件描述兩套「會自己做決策」的系統：

1. **AI 玩家（Autopilot）**：在玩家沒有輸入時接管角色，完成任務/戰鬥/生存並策略性使用道具。
2. **怪物 AI（Enemy AI）**：以 brain（大腦）為單位的模組化行為，支援視覺（Vision/FOV）、聽覺（Noise/Hearing）、嗅覺（Scent/Smell）、小隊戰術（Squad/Tactics）與特殊規則（木頭人）。

---

## 1) AI 玩家（Autopilot）概覽

### 1.1 接管條件與資料流

- 接管開關：`CONFIG.AUTOPILOT_ENABLED`（`src/core/config.js`）
- 接管延遲：`CONFIG.AUTOPILOT_DELAY`（秒）
- 接管判斷：`src/core/gameLoop.js` 的 `autopilot` system
  - 讀 `InputHandler` 的鍵盤/滑鼠 idle：`src/player/input.js:getIdleTimeSeconds()`
  - 玩家有 WASD/滑鼠輸入時，Autopilot 不會「控制」角色（但仍可 `tick()` 做預規劃）
  - 產生的控制指令透過 `ctx.externalCommand` 送往玩家/武器/互動系統

### 1.2 Autopilot 的核心檔案

- 導航/任務解題：`src/ai/autoPilot.js`
- 任務狀態來源：`src/core/missions/missionDirector.js:getAutopilotState()`
- 任務目標列表：`src/core/missions/missionDirector.js:getAutopilotTargets()`
- 道具策略（由 Autopilot 驅動時才啟用）：`src/core/playerToolAISystem.js`

---

## 2) Autopilot：怎麼「做事」？

### 2.1 任務導向：Task Runner（Search → MoveTo → Interact）

Autopilot 不是單純「走向最近目標」；它用任務拆解的方式降低卡住機率：

- 任務框架：`src/ai/tasks/taskRunner.js`
- 常用 task：
  - `SearchTask`：`src/ai/tasks/searchTask.js`
  - `MoveToTask`：`src/ai/tasks/moveToTask.js`
  - `InteractTask`：`src/ai/tasks/interactTask.js`
  - `EscortTask/GuardTask`：`src/ai/tasks/*`

Autopilot 每幀會：

1. 讀任務狀態（`getAutopilotState()`）與目標列表（targets）
2. 依 template 決定「現在應該做什麼」並建立 task queue
3. 用 `Pathfinding` 找路：`src/ai/pathfinding.js`
4. 產生一幀的輸入指令（move/look/sprint/fire/interact…）

### 2.2 反抖動：避免路口來回（Junction Dithering）

針對「路口太多會左右搖擺」的典型問題，Autopilot 有幾層保護：

- **Visited tiles 記憶**：偏好走沒走過的地方（`visitedTiles`）
  - `src/ai/autoPilot.js:recordVisit()`
- **Unreachable 記憶**：短時間內不重試走不到的點
  - `src/ai/autoPilot.js:recordUnreachable()`
- **Step lock（路口出門承諾）**：在鄰居數量多的 junction，鎖定下一步幾百毫秒，避免來回換方向
  - `src/ai/autoPilot.js:updateStepLock()`（使用 `stepLockSeconds`, `stepLockMinNeighbors`）
- **No-progress 偵測**：玩家被卡住/碰撞抖動時，會強制脫困並清路徑
  - `src/core/gameLoop.js:noProgress` system（呼叫 `player.forceUnstuck()` 與 `autopilot.resetPath()`）

### 2.3 戰鬥：瞄準/射擊節奏（Combat Directive）

Autopilot 的戰鬥決策集中在 `src/ai/autoPilot.js`，並由 `src/core/config.js` 的參數控制：

- `CONFIG.AUTOPILOT_COMBAT_*`：搜尋距離、可開火 FOV、對準角度、需要 LOS 等
- `CONFIG.AUTOPILOT_COMBAT_DAMAGE_MULT`：自動駕駛傷害倍率（**只影響 Autopilot，不影響玩家手動**）
- burst 連發節奏：`CONFIG.AUTOPILOT_COMBAT_BURST_*`

特殊任務約束：

- `stealthNoise`（Stay Quiet）：會強制 `fire:false` 且 `move:0`（避免因戰鬥/亂動導致失敗）
- `deliverFragile`：攜帶易碎品時禁止開火（避免自爆式失敗）

---

## 3) Autopilot 道具策略（PlayerToolAISystem）

檔案：`src/core/playerToolAISystem.js`

這個系統只在 **Autopilot 實際接管（`ctx.autopilotActive === true`）**時啟用，目標是把道具從「純任務導向」拉到「生存/戰鬥策略」：

- 讀背包快照：`gameState.getInventorySnapshot()`
- 掃描威脅：依 monster 距離、是否看見玩家（seenByAny）、數量（seenCount）
- 依任務模板調整「噪音容忍度」
  - `stealthNoise`：`avoidNoise=true`，避免投擲/地雷
  - `hideForSeconds/hideUntilClear`：會視為 holding objective，偏好 `jammer/sensor`

典型規則（高層描述，實作以檔案為準）：

- **極近距離（<=2 tiles）**：優先 `flash` → `smoke` → `trap` → `mine`
- **被看見且需要脫離視線**：丟 `smoke`
- **被看見但允許噪音**：放 `lure`/丟 `decoy` 拉走怪物
- **守點任務**：放 `jammer`（削弱感知）+ `sensor`（偵測靠近）

---

## 4) 怪物 AI（Enemy AI）架構

### 4.1 Brain（大腦）介面

每隻怪物都有一個 brain，brain 輸出「一幀的行為指令」：

- Base class：`src/ai/brains/baseBrain.js:BaseMonsterBrain`
- 建立 factory：`src/ai/monsterAI.js:createMonsterBrain()`
- brain.tick 回傳（概念上）：

```js
{
  move: { x: -1..1, y: -1..1 },
  lookYaw: radians,
  sprint: boolean,
  fire?: { ... } // 由 combat module 或 brain 自己決定
}
```

MonsterManager 會：

1. 把感知結果注入 brain：
   - `brain.hearNoise(...)`
   - `brain.smellScent(...)`
2. 呼叫 `brain.tick(dt)` 取得命令
3. 套用 sanitize（避免 NaN/過大向量）
4. 套用移動/轉向/射擊

實作位置：`src/entities/monsterManager.js:update()`

### 4.2 感知（Perception）：視覺/聽覺/嗅覺

核心：`src/entities/monsterManager/perception.js:MonsterPerception`

#### 視覺（Vision / FOV / LOS）

- 判斷：`MonsterPerception.canMonsterSeePlayer(...)`
- 特性：
  - 先做距離 + FOV cone（以怪物 yaw 為中心）
  - 再做遮蔽物（Line of Sight）
  - **煙霧會擋視線**：`ToolSystem` 生成 smoke clouds，視線段若穿過煙球就視為看不到

#### 聽覺（Noise/Hearing）

- 事件池：`noiseEvents[]`
- 來源：
  - 玩家腳步：`MonsterManager.updatePlayerNoise()` → `MonsterPerception.updatePlayerNoise()`
  - 槍聲/道具：透過 `EVENTS.NOISE_REQUESTED`（見 `docs/assistant/ARCHITECTURE.md` 的 Noise flow）
  - 警戒傳播（alert）：當怪物「看見玩家」會廣播 alert noise（幫其他怪物定位）
    - `MonsterPerception.maybeBroadcastAlert(...)`
- brain 取得：`MonsterPerception.pickAudibleNoise(monster, brain)`

#### 嗅覺（Scent/Smell）

- 事件池：`scentEvents[]`
- 玩家會留下「麵包屑」：移動一段距離就 drop 一個 scent（可 sprint 加強）
  - `MonsterPerception.updatePlayerScent(...)`
- 道具也會留下 scent（例如 lure/decoy）
  - `ToolSystem.triggerDecoy()/deployLure()` → `MonsterManager.registerScent(...)`
- brain 取得：`MonsterPerception.pickSmelledScent(monster, brain)`

### 4.3 模組化加成：Brain Composer（Modules）

檔案：`src/ai/brainComposer.js`

它會依 `typeConfig.brain.modules` 把「共用能力」包裝進 brain，而不是把所有邏輯塞進單一 brain：

- `noiseInvestigation`：失去視線時會去調查噪音（Noise Investigation）
- `flankCoverTactics`：看到玩家時做側翼/壓制等策略（Flank/Cover Tactics）
- `squadCoordination`：小隊共享目標、分配 flank slot、允許 cover shooter 等（Squad Coordination）

注意：composer 會 wrapper `brain.pickTarget()` 與必要時 wrapper `brain.tick()`（例如要求 hold position 時回傳 move=0）。

---

## 5) 特殊怪：木頭人（Weeping Angel）

檔案：

- brain：`src/ai/brains/weepingAngel.js`
- type：`src/ai/monsterTypes.js:WEEPING_ANGEL`

核心規則：

- **玩家看著它（玩家相機 FOV + LOS）時完全凍結**（不移動、不轉向）
- 玩家沒看時，會用自己的視野 + 最近噪音/氣味追蹤玩家

玩家是否看見怪物的判斷是「站在玩家視角」做的：

- `player.getViewYaw()`：`src/player/playerController.js`
- `player.getViewFovDeg()`：`src/player/playerController.js`
- `worldState.hasLineOfSight()`：`src/world/worldState.js`

---

## 6) 擴充指南：如何新增怪物/brain/感知規則

### 6.1 新增一個 brain（最小步驟）

1. 在 `src/ai/brains/` 新增檔案並 `extends BaseMonsterBrain`
2. 實作 `pickTarget()` 與 `tick(dt)`
3. 在 `src/ai/monsterAI.js:createMonsterBrain()` 加入 switch case 映射（`aiType` 字串）

### 6.2 新增一個怪物類型（Monster Type）

1. 在 `src/ai/monsterTypes.js` 新增 type entry（包含 `aiType`, `stats`, `combat`, `appearance`）
2. 若需要 modules：在 `type.brain.modules` 設定 `noiseInvestigation/flankCoverTactics/squadCoordination`
3. 若要影響刷怪 budget：更新 `src/core/spawnDirector.js:TYPE_COST`
4. 讓關卡可以選到它：
   - 在 `public/levels/*.json` 的 `monsters.typePool` 或 `monsters.typeWeights` 加入

### 6.3 修改感知（Vision/Noise/Scent）

感知不應該散落在多個 brain；優先改這些集中點：

- 視覺：`src/entities/monsterManager/perception.js:canMonsterSeePlayer()`
- 噪音挑選：`pickAudibleNoise()`
- 氣味挑選：`pickSmelledScent()`
- 噪音來源（道具/槍械）用 `EVENTS.NOISE_REQUESTED` 串接（見 `NoiseBridgeSystem`）

---

## 7) Debug 建議（AI 相關）

- 模組載入：`/test-ai.html`
- 主遊戲載入：`/diagnostic.html`
- 敵人/戰鬥/模型 meta：`/enemy-lab.html`、`/test-enemy-meta.html`
- 觀察 console：
  - `MonsterManager` 會列出 type distribution
  - `SpawnDirector` 會 emit `spawn:wavePlanned/spawn:waveSpawned`（有需要可加 log/overlay）


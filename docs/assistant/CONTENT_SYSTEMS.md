# 關卡 / 任務 / 互動 / 道具（Content Systems）

本文件描述「像遊戲的內容層」怎麼被配置與串起來：關卡 JSON、任務模板、互動門檻、背包與道具、掉落與刷怪。

---

## 1) 關卡（Level）與無限生成（Endless）

### 1.1 基礎關卡：`public/levels/*.json`

- manifest：`public/levels/manifest.json`
- 讀取與正規化：`src/core/levelDirector.js`
  - 會把寬高強制 odd（迷宮生成需要）
  - clamp 參數避免極端值（例如怪物數量上限）

常見欄位（以 `public/levels/l10-ritual-circuit.json` 為例）：

```json
{
  "maze": { "width": 33, "height": 33, "roomDensity": 2.9, "extraConnectionChance": 0.12 },
  "rooms": { "typeWeights": { "CLASSROOM": 2.6, "OFFICE": 1.6, "...": 0.2 } },
  "monsters": {
    "count": 3,
    "maxCount": 5,
    "typePool": ["HUNTER", "WANDERER"],
    "typeWeights": { "WANDERER": 0.45, "HUNTER": 0.25, "WEEPING_ANGEL": 0.1 }
  },
  "pickups": {
    "maxActive": 18,
    "tools": {
      "maxDevices": 6,
      "start": { "lure": 1, "trap": 1, "jammer": 1, "smoke": 1, "...": 1 },
      "drop": { "enabled": true, "chance": 0.06, "ttl": 45, "weights": { "lure": 0.35, "...": 0.05 } }
    }
  },
  "missions": { "list": [ { "id": "shrines", "template": "activateShrines", "params": {} } ] },
  "autopilot": { "avoidRadius": 5, "replanInterval": 0.5 }
}
```

### 1.2 無限關（Endless）：LevelDirector 動態生成

`src/core/levelDirector.js` 支援：

- base levels（manifest 裡的固定關卡）
- 超過 base levels 後進入 **無限生成**：
  - 優先用 recipes：`public/level-recipes/manifest.json` + `public/level-recipes/*.json`
  - 沒有 recipes 時用 `buildDynamicConfig(...)`
- 難度會隨關卡 index 單調上升，並且會依玩家表現微調
  - `LevelDirector.scorePerformance()` / `difficultyForLevel()`

---

## 2) 任務（Missions）與目標（Objectives）

### 2.1 MissionDirector 的角色

檔案：`src/core/missions/missionDirector.js`

它負責：

- 解析/正規化關卡任務列表：`src/core/missions/missionTemplates.js:normalizeMissionsConfig()`
- 在地圖上「挑 tile」並生成任務物件（Object3D）
- 把任務物件註冊成可互動（Interactable）
- 追蹤每個 mission 的 state（進度、成功、失敗）
- 控制出口鎖（Exit gating）
- 對 Autopilot 提供：
  - `getAutopilotTargets()`：所有「下一步可能去做」的目標點
  - `getAutopilotState()`：目前 objective（含 nextInteractId、文字、progress）

### 2.2 任務物件工廠：Mission Objects

檔案：`src/core/missions/missionObjects.js`

這裡集中所有「任務物件的 3D 雛形」：

- Keycard、Evidence、Fuse、Fuse Panel、Terminal、Keypad、Locked Door、Altar、Sensor…
- 各物件的狀態切換（例如 `setKeypadState()`, `setFusePanelState()`, `setTerminalState()`）

> 設計目的：讓任務玩法擴充時，不用到處散落幾何建模/材質細節。

### 2.3 互動/門檻系統：InteractableSystem

檔案：`src/core/interactions/interactableSystem.js`

Interactable 是「玩家與 Autopilot 共用」的互動 API，支援：

- Raycast hover（看著才會顯示提示）
- `E` 互動（或 Autopilot 指令互動）
- 互動距離（per entry maxDistance）
- 門檻（需要物品）：`requiresItem`
- 消耗物品：`consumeItem`
- 顯示提示文字：`prompt`

它同時也有 LOS（Line of Sight）檢查（避免隔牆互動）：

- `InteractableSystem.hasLineOfSight()` → `worldState.hasLineOfSight()`

### 2.4 躲藏點（Hiding Spots）

檔案：`src/core/interactions/hidingSpotSystem.js`

- 會在特定房型中生成可躲藏的物件並註冊成 interactable
- 玩家躲藏時：
  - `PlayerController.getAIPerceivedGridPosition()` 回傳 `null`
  - 怪物 brain 的 `getPlayerGridPosition()` 會拿不到玩家位置（相當於視覺/追蹤中斷）

---

## 3) 背包（Inventory）與掉落（Pickups）

### 3.1 InventorySystem

檔案：`src/core/inventorySystem.js`

所有系統不直接改動背包；改用事件：

- `EVENTS.INVENTORY_GIVE_ITEM`
- `EVENTS.INVENTORY_CONSUME_ITEM`
- `EVENTS.INVENTORY_QUERY_ITEM`

背包資料實際存在 `GameState`（`src/core/gameState.js`）。

### 3.2 PickupManager：一般掉落 + 道具掉落

檔案：`src/entities/pickupManager.js`

目前 Pickup kinds 包含：

- 一般：`ammo`, `health`
- 道具（Tools）：`lure`, `trap`, `jammer`, `decoy`, `smoke`, `flash`, `sensor`, `mine`

道具拾取會：

- 透過 `EVENTS.INVENTORY_GIVE_ITEM` 增加背包數量
- UI 會顯示快捷鍵提示（例如 `lure -> 4`）

### 3.3 SpawnDirector：波次刷怪 + 起始道具 + 掉落機率

檔案：`src/core/spawnDirector.js`

- 起始道具：依 `levelConfig.pickups.tools.start` 生成 tool pickups（散落在地圖中）
- 掉落：怪物死亡後可能掉 tool pickup（依 `chance/weights/ttl`）
- 多樣性保護：
  - 如果關卡權重表太窄（或只寫了一兩種），會「軟性補齊」其他工具/怪物類型，避免每場都單一玩法
  - 可用 `strictWeights:true` 關閉此保護（完全信任關卡 JSON）

---

## 4) 道具（Tools）：投擲/部署/裝置

### 4.1 ToolSystem

檔案：`src/core/toolSystem.js`

道具有兩種形式：

1. **投擲物（Throwables）**：`decoy/smoke/flash`
   - 透過 `ProjectileManager.spawnPlayerProjectile()` 以「無重力直線」投出
   - 命中牆/怪後觸發 effect（`ToolSystem.onProjectileImpact()`）
2. **部署裝置（Devices）**：`lure/trap/jammer/sensor/mine`
   - 直接在玩家前方落地生成 mesh，並在 `devices[]` 中持續更新

玩家快捷鍵（同時也是 HUD 顯示的固定鍵位）：

- `4` Lure（誘餌裝置）
- `5` Trap（陷阱：暈眩）
- `6` Jammer（干擾器：削弱聽覺/嗅覺）
- `7` Decoy（誘餌投擲物：製造大噪音 + 氣味）
- `8` Smoke（煙霧：遮蔽視線）
- `9` Flash（閃光：致盲/暈眩）
- `0` Sensor（感測器：怪接近會 ping）
- `V` Mine（地雷：爆炸傷害 + 噪音）

### 4.2 道具與 AI 感知的連動

道具會影響怪物感知（Perception）：

- Noise：`EVENTS.NOISE_REQUESTED` → `NoiseBridgeSystem` → `MonsterManager.registerNoise()`
  - 例：`lure/decoy/mine` 會製造噪音
- Scent：`MonsterManager.registerScent()` 直接留下氣味事件
  - 例：`lure/decoy` 會留下較長 TTL 的氣味
- Smoke：`worldState.smokeClouds` 會在 `MonsterPerception.canMonsterSeePlayer()` 中用「線段穿越煙球」阻擋視線
- Flash：`MonsterManager.applyAreaBlindness()` 設置 `monster.perceptionBlindedTimer`
- Jammer：持續刷新 `monster.perceptionJammedTimer`，會套用 `CONFIG.AI_JAMMED_*_MULT`

### 4.3 道具音效

音效採程序化（Procedural Audio），不依賴外部資產：

- `src/audio/audioManager.js:playToolThrow/playToolDeploy/playToolTrigger`

---

## 5) 擴充指南：新增一個「像遊戲」的道具

（這裡列的是最常漏掉的連動點）

1. **背包 ID**：決定 itemId（例如 `smoke`）
2. **拾取物**：
   - `src/entities/pickupManager.js`：加入 kind、mesh、hint
   - `src/core/spawnDirector.js`：納入 tools drop weights（以及起始 start）
3. **可使用行為**：
   - `src/core/toolSystem.js`：加入 deploy/throw + `updateInput()` 綁鍵
4. **UI**：
   - `src/ui/uiManager.js`：HUD 顯示固定鍵位與數量
   - `src/rendering/worldMarkerSystem.js` 與 `src/rendering/minimap.js`：顏色/標示（可選）
5. **AI 使用策略**：
   - `src/core/playerToolAISystem.js`：把「何時用」寫成規則（注意 `stealthNoise`）
6. **文件**：
   - `docs/README.md`（若新增文件）
   - `docs/assistant/CONTENT_SYSTEMS.md`（本檔）


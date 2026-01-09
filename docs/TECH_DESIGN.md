# 技術設計文件（Technical Design Document）

本文件描述「目前的實作架構」：系統怎麼拆、資料怎麼流、擴充要插哪裡。更深入的 code-level 追蹤（含檔案路徑、每幀更新順序、事件流）請看 `docs/assistant/README.md`。

---

## 一、技術選型（Technology Stack）

| 技術 | 用途 | 備註 |
|---|---|---|
| Three.js | 3D 渲染 | ES Modules |
| JavaScript (ES6+) | 主要語言 | `type: "module"` |
| Vite | Dev server / build | 快速 HMR 與打包 |

---

## 二、專案結構（Project Structure）

原則：

- runtime code 全在 `src/`
- 靜態資源（模型/音效/關卡 JSON）在 `public/`（路徑以 `/` 起頭）
- AI/玩法不要直接操作 DOM；UI 由 `UIManager` 統一更新

```
src/
  core/          # config, events, gameLoop, levelDirector, spawnDirector, toolSystem...
  rendering/     # scene, camera, minimap, world markers, lighting
  world/         # maze grid, rooms, collision, exit, props
  entities/      # monsters, projectiles, pickups
  player/        # input, controller, gun, weapon view
  ai/            # autopilot, monster brains, pathfinding, tactics modules
  audio/         # AudioManager（含程序化音效）
  ui/            # UIManager（HUD/提示/結算/輸入模式）
  utils/         # helpers
public/
  levels/        # base levels（JSON + manifest）
  level-recipes/ # endless recipes（可選）
  models/        # 模型與 meta
  textures/      # 貼圖
```

---

## 三、核心架構（Core Architecture）

### 3.1 單一遊戲迴圈（Game Loop）+ 多系統更新

主迴圈在 `src/core/gameLoop.js`，更新順序由 `src/core/systemRegistry.js` 控制：

- 每個 system 是 `(dt, ctx) => {}` 或具有 `update(dt, ctx)` 的物件
- 以 `order` 排序（由小到大）
- `ctx` 搭載每幀資料（例如 autopilot 指令、玩家位置、是否 gameOver…）

完整順序表請看：`docs/assistant/ARCHITECTURE.md`

### 3.2 事件匯流排（EventBus）

事件名在 `src/core/events.js`，由 `src/core/eventBus.js` 提供 `on/emit`：

- `Noise`：道具/槍聲等 → 怪物聽覺 + UI 噪音條
- `Inventory`：背包給/消耗/查詢 → 道具使用與互動門檻
- `Missions`：任務更新/完成/失敗 → HUD 顯示與出口 gating

### 3.3 狀態邊界（State Boundaries）

| 類別 | 主要責任 | 位置 |
|---|---|---|
| `WorldState` | 迷宮 grid、房型 roomMap、walkable/碰撞、LOS、spawn/exit | `src/world/worldState.js` |
| `GameState` | HP、計時、統計、背包（inventory）、勝敗狀態 | `src/core/gameState.js` |

### 3.4 典型資料流（Data Flow）

```
LevelDirector  →  WorldState  →  SceneManager
      ↓              ↓              ↓
MissionDirector  SpawnDirector   Rendering (minimap/markers)
      ↓              ↓
InteractableSystem   PickupManager/ToolSystem
      ↓              ↓
AutoPilot  →  PlayerController/Gun  →  CombatSystem/Projectiles
      ↓
MonsterManager (perception + brains)
```

---

## 四、主要系統（Key Systems）

| 系統 | 主要責任 | 位置 |
|---|---|---|
| `LevelDirector` | 讀取 base levels + 無限生成 + 難度成長 | `src/core/levelDirector.js` |
| `MissionDirector` | 任務模板、任務物件生成、出口解鎖門檻、Autopilot targets/state | `src/core/missions/missionDirector.js` |
| `InteractableSystem` | 互動統一入口（玩家與 Autopilot 共用），含門檻/消耗 | `src/core/interactions/interactableSystem.js` |
| `SpawnDirector` | 波次刷怪、起始道具、掉落權重與多樣性保護 | `src/core/spawnDirector.js` |
| `ToolSystem` | 投擲/部署道具、裝置生命週期、煙霧雲、噪音/氣味連動 | `src/core/toolSystem.js` |
| `MonsterManager` | 怪物生成、brain tick、感知（noise/scent/vision）、遠距離節流 | `src/entities/monsterManager.js` |
| `AutoPilot` | AI 玩家決策（導航/任務解題/戰鬥節奏） | `src/ai/autoPilot.js` |
| `PlayerToolAISystem` | AI 玩家道具策略（煙/閃/誘餌/陷阱…） | `src/core/playerToolAISystem.js` |
| `UIManager` | HUD/提示/結算、keypad 輸入模式、噪音條 | `src/ui/uiManager.js` |
| `Minimap` | 永遠顯示完整地圖縮圖（base layer 快取） | `src/rendering/minimap.js` |
| `WorldMarkerSystem` | 3D 世界標示（Sprite + CanvasTexture，M 開關） | `src/rendering/worldMarkerSystem.js` |
| `AudioManager` | 程序化音效（工具/目標提示/勝敗等） | `src/audio/audioManager.js` |

---

## 五、擴充原則（Extension Principles）

1. **把可變內容放到關卡 JSON**：怪物型態池、道具掉落、上限、起始配置、任務清單
2. **用事件解耦**：玩法系統 emit event；UI/其他系統訂閱
3. **新增 system 要有清楚順序**：請依語意放在 `GameLoop.registerSystems()` 合適位置
4. **文件 SSOT**：新增文件先登記 `docs/README.md`，並更新對應主題文件

---

## 參考（Implementation Reference）

- 架構與更新順序：`docs/assistant/ARCHITECTURE.md`
- AI 全套：`docs/assistant/AI.md`
- 關卡/任務/道具：`docs/assistant/CONTENT_SYSTEMS.md`
- 渲染/效能：`docs/assistant/RENDERING_PERFORMANCE.md`


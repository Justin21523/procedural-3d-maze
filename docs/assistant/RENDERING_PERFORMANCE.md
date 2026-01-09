# 迷你地圖 / 世界標示 / 效能（Rendering & Performance）

本文件聚焦「看得到 + 跑得動」：迷你地圖（Minimap）、3D 世界標示（World Markers）、以及目前用來維持 FPS 的節流/上限策略。

---

## 1) 渲染總覽（Three.js Pipeline）

主要渲染管理：

- `SceneManager`：`src/rendering/scene.js`
  - 建立 `THREE.Scene`、fog、renderer、environment map、lighting
  - 把 `WorldState` 的 grid/rooms 轉成牆/地/天花板 mesh
  - 以 `tickables[]` 管理需要每幀更新的場景物件

效能取向的預設（可從程式碼確認）：

- `renderer.setPixelRatio(1.0)`：避免高 DPI 顯示器把 GPU 打爆
- `renderer.shadowMap.enabled = false`：關閉即時陰影

---

## 2) 迷你地圖（Minimap）

檔案：`src/rendering/minimap.js`

### 2.1 永遠顯示「完整地圖縮圖」

`Minimap.updateScale()` 採用：

- `tileSize = min(canvasW / mapW, canvasH / mapH)`
- `offsetX/offsetY` 用來置中

因此不論 UI 如何調整 minimap canvas 尺寸，都會是「整張地圖縮圖」，不會裁切。

### 2.2 Zoom 的意義：只放大 marker，不裁地圖

`Minimap.zoom` 不再影響 tileSize（避免裁切），而是用在：

- 玩家/怪物/任務點/掉落/裝置 marker 的半徑縮放

### 2.3 Base layer 快取（避免每次重畫整張 grid）

`ensureBase()` 會把「牆/地/房型顏色/障礙 overlay」先畫到 `baseCanvas`，每次 render 只需要：

1. `drawImage(baseCanvas)`
2. 再疊 marker（玩家、怪物、任務、掉落、裝置）

### 2.4 Render 節流（GameLoop）

迷你地圖 render 不在 system update 內，而是在 `GameLoop.render()`：

- `this.minimapInterval = 0.25`（秒）
- 每幀累積 dt，達到 interval 才 render 一次

位置：`src/core/gameLoop.js:render()`

---

## 3) 3D 世界標示（World Markers）

檔案：`src/rendering/worldMarkerSystem.js`

目的：除了 minimap，還能在 3D 視野中提示附近「掉落/裝置/任務目標」。

特性：

- 用 `THREE.Sprite` + CanvasTexture 生成圖標（避免引入外部貼圖資產）
- `M` 鍵可切換顯示（`Markers ON/OFF [M]`）
- marker 來源：
  - 掉落：`PickupManager.getPickupWorldMarkers()`
  - 裝置：`ToolSystem.getDeviceWorldMarkers()`
  - 目標：`MissionDirector.getAutopilotTargets()`（顯示 required objectives）

---

## 4) 目前的效能策略（避免 FPS 崩潰）

### 4.1 怪物 AI 遠距離節流 + 渲染 cull

檔案：`src/entities/monsterManager.js:update()`

相關 CONFIG：

- `CONFIG.MONSTER_AI_FAR_DISTANCE_TILES`
- `CONFIG.MONSTER_AI_FAR_TICK_SECONDS`
- `CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES`

做法：

- 距離玩家太遠：brain.tick 以較低頻率執行（節省 CPU）
- **但移動仍每幀套用**：避免遠方怪物「跳格」或突然瞬移
- 超過 render cull 距離：`monster.model.visible=false`（減少 draw calls）

### 4.2 投射物/特效上限（Hard Caps）

相關 CONFIG（`src/core/config.js`）：

- `MAX_ACTIVE_PROJECTILES`
- `MAX_ACTIVE_PLAYER_PROJECTILES`
- `MAX_ACTIVE_MONSTER_PROJECTILES`
- `MAX_ACTIVE_IMPACTS`
- `MAX_ACTIVE_EXPLOSIONS`
- `MAX_ACTIVE_MUZZLE_FLASHES`

目的：避免「射太多/特效太多」把效能拉到不可恢復。

### 4.3 Spawn/內容預算（Budget）

- `SpawnDirector` 限制同時存在的 pickups：`CONFIG.SPAWN_DIRECTOR_MAX_PICKUPS`（也可 per-level 覆寫）
- `MissionDirector` 有 mission objects budget（避免大量任務物件拖慢 FPS）：
  - `CONFIG.MISSION_OBJECT_BUDGET_MAX`

### 4.4 Low Perf Mode（降載模式）

`CONFIG.LOW_PERF_MODE` 用來關閉部分裝飾/互動生成（例如 hide spots、props 等），以換取更穩定的 FPS。

> 具體哪些功能受影響，請以各系統對 `LOW_PERF_MODE` 的判斷為準（例如 `HidingSpotSystem.startLevel()`）。

---

## 5) 建議的效能排查流程（人工）

1. 跑 `npm run dev -- --host --port 3002`
2. 開主遊戲 `http://localhost:3002/`，按 F12
3. 先看 HUD 的 FPS 與 debug counts（若有）
4. 若 FPS 低：
   - 降低怪物數（level JSON 的 `monsters.count/maxCount` 或 `CONFIG.MONSTER_MAX_COUNT`）
   - 降低同時投射物上限（或減少怪物遠程 fire 機率）
   - 開啟 `LOW_PERF_MODE`
   - 檢查是否某系統在每幀做了 O(N*M) 的掃描（怪物數量上升時最明顯）


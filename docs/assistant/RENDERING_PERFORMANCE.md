# Minimap / World Markers / Performance (Rendering)

This document focuses on “visibility + framerate”: the minimap, 3D world markers, and current throttling/cap strategies used to keep FPS stable.

---

## 1) Rendering overview (Three.js pipeline)

Primary renderer manager:

- `SceneManager`: `src/rendering/scene.js`
  - builds `THREE.Scene`, fog, renderer, environment/lighting
  - converts `WorldState` grid/rooms into wall/floor/ceiling meshes
  - owns `tickables[]` for scene objects that need per-frame updates

Performance-oriented defaults (verify in code):

- `renderer.setPixelRatio(1.0)` to avoid high-DPI GPU blowups
- `renderer.shadowMap.enabled = false` (no real-time shadows)

---

## 2) Minimap

File: `src/rendering/minimap.js`

### 2.1 Always fits the entire map (no cropping)

`Minimap.updateScale()` uses:

- `tileSize = min(canvasW / mapW, canvasH / mapH)`
- `offsetX/offsetY` to center the result

So regardless of HUD layout, the minimap canvas will display a full-map thumbnail.

### 2.2 Zoom semantics: zoom markers, not tiles

`Minimap.zoom` does not affect `tileSize` (to avoid cropping). It is used to scale marker sizes:

- player / monsters / objectives / pickups / devices

### 2.3 Base layer caching (avoid re-drawing the full grid)

`ensureBase()` pre-renders walls/floors/room coloring into an offscreen `baseCanvas`. Each render only needs:

1. `drawImage(baseCanvas)`
2. overlay markers (player, monsters, objectives, pickups, devices)

### 2.4 Render throttling (GameLoop)

Minimap rendering runs from `GameLoop.render()`:

- `this.minimapInterval = 0.25` seconds (default)
- each frame accumulates dt and renders only when the interval elapses

See: `src/core/gameLoop.js:render()`.

---

## 3) 3D world markers

File: `src/rendering/worldMarkerSystem.js`

Purpose: complement the minimap by highlighting nearby **pickups / devices / objectives** in the 3D view.

Properties:

- Uses `THREE.Sprite` + `CanvasTexture` icons (no external textures required)
- Toggle key: `M` (`Markers ON/OFF [M]`)
- Data sources:
  - pickups: `PickupManager.getPickupWorldMarkers()`
  - devices: `ToolSystem.getDeviceWorldMarkers()`
  - objectives: `MissionDirector.getAutopilotTargets()` (for required objectives)

---

## 4) Current performance strategies

### 4.1 Far-AI throttling + render culling for monsters

File: `src/entities/monsterManager.js:update()`

Key configs:

- `CONFIG.MONSTER_AI_FAR_DISTANCE_TILES`
- `CONFIG.MONSTER_AI_FAR_TICK_SECONDS`
- `CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES`

Approach:

- Far from the player: lower-frequency brain tick (CPU savings)
- **Movement is still applied every frame** to avoid “teleport/jitter” visuals
- Beyond cull distance: `monster.model.visible = false` to reduce draw calls

### 4.2 Hard caps for projectiles and effects

Relevant configs in `src/core/config.js`:

- `MAX_ACTIVE_PROJECTILES`
- `MAX_ACTIVE_PLAYER_PROJECTILES`
- `MAX_ACTIVE_MONSTER_PROJECTILES`
- `MAX_ACTIVE_IMPACTS`
- `MAX_ACTIVE_EXPLOSIONS`
- `MAX_ACTIVE_MUZZLE_FLASHES`

These prevent “too many shots/effects” from creating unrecoverable frame drops.

### 4.3 Spawn/content budgets

- Pickup cap: `CONFIG.SPAWN_DIRECTOR_MAX_PICKUPS` (also per-level override)
- Mission object budget:
  - `CONFIG.MISSION_OBJECT_BUDGET_MAX`

### 4.4 Low-perf mode

`CONFIG.LOW_PERF_MODE` disables some decorative/optional content generation to keep FPS stable.

The exact impact is system-specific; search for `LOW_PERF_MODE` checks (e.g. `HidingSpotSystem.startLevel()`).

---

## 5) Suggested manual perf debugging flow

1. `npm run dev -- --host --port 3002`
2. Open `http://localhost:3002/` and open DevTools
3. Observe HUD FPS and debug counts (if enabled)
4. If FPS is low:
   - reduce monster counts (`public/levels/*.json` → `monsters.count/maxCount` or `CONFIG.MONSTER_MAX_COUNT`)
   - reduce projectile/effect caps (or lower monster ranged fire chance)
   - enable `LOW_PERF_MODE`
   - look for accidental O(N*M) scans in per-frame systems (becomes obvious at higher monster counts)

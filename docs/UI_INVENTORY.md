# UI Inventory (Vanilla → React Migration)

This doc inventories the current UI surfaces and their data dependencies so we can migrate with a “strangler” approach (React mounts alongside the existing DOM, then replaces panels one by one).

## Core Principles

- Rendering/gameplay stays vanilla (Three.js + systems).
- React UI never touches Three.js objects or DOM nodes directly; it only uses `GameAPI + EventBus + SettingsStore`.
- Migration is incremental and reversible.

## Panels & Surfaces

### Player UI (always available)

**HUD overlay** (`index.html`)
- **Inputs/state**: time, level label, health/max health, weapon name, ammo, reload status, skills cooldowns, mission status, inventory snapshot, tool/throwable summary, noise meter.
- **Events**: `EVENTS.TIMER_TICK`, `EVENTS.PLAYER_DAMAGED`, `EVENTS.PLAYER_HEALED`, `EVENTS.PLAYER_MAX_HEALTH_CHANGED`, `EVENTS.WEAPON_SWITCHED`, `EVENTS.WEAPON_RELOAD_START`, `EVENTS.WEAPON_RELOAD_FINISH`, `EVENTS.WEAPON_FIRED`, `EVENTS.MISSION_UPDATED`, `EVENTS.INVENTORY_UPDATED`, `EVENTS.NOISE_EMITTED`, `EVENTS.GAME_WON`, `EVENTS.GAME_LOST`.
- **Actions**: none (display only).

**Minimap container** (`index.html`, `src/rendering/minimap.js`)
- **Inputs/state**: world grid + roomMap + obstacles; player/monsters/pickups/devices positions; zoom/size settings.
- **User actions**: toggle show/hide, size slider, zoom slider, reset button.
- **Notes**: also supports debug overlays (markers/heatmap/obstacles), which should be gated behind debug mode.

**Home menu (ESC)** (`src/ui/homeMenu.js`, `index.html#instructions`)
- **Inputs/state**: “boot ready” status, run state (can continue/restart/abandon/save/load), campaign summary, game over state.
- **User actions**: start new run, continue, restart, abandon, save, load save, clear save.

**Settings (player-facing subset)** (`index.html#settings-panel`, `src/main.js setupSettingsPanel`)
- **Inputs/state**: persisted settings + current CONFIG-derived values.
- **User actions** (player-facing): movement speed, mouse sensitivity, FOV, fog density, maze size, room density, mission count, low GPU mode, weapon view, crosshair, recoil, pool FX, HDR, safe mode, regenerate map.
- **Notes**: debug-only blocks currently exist in the same panel; those should be separated or gated.

**Toasts / prompts**
- **Events**: `EVENTS.UI_TOAST`, interact prompt (interaction system).
- **User actions**: none.

**Game over / victory UI**
- **Events**: `EVENTS.GAME_WON`, `EVENTS.GAME_LOST`.
- **User actions**: next level / restart / return to menu.

### Debug UI (opt-in only; `?debug=1`)

**Debug panel** (`index.html#debug-panel`, `src/main.js setupDebugPanel`)
- **Sections**: perf, world seed, AI snapshot/noise feed, combat reset, spawns, audio status, diagnostics (copy report), cheats.
- **Inputs/state**: diagnostics ring buffer, world seed + validation report, AI debug prefs, monster snapshot + path data.
- **Actions**: apply/clear seed (regenerate level), copy crash report, toggle overlays, respawn enemies, etc.

**AI overlays** (text overlay, minimap markers, 3D lines)
- **Inputs/state**: monsterManager snapshots (state/target/path), worldState (grid/exit/heatmap), debug prefs.
- **Actions**: toggles + filters.

**External diagnostic pages** (root HTML files)
- `diagnostic.html`, `test-ai.html`, `enemy-lab.html`, etc. (manual tools)

## Data Sources

### Settings (persisted)
- **Current storage**: `localStorage` (v1 key `maze:settings:v1`)
- **Target**: `src/core/settings/settingsStore.js` (v2 schema) with:
  - `load()` / `save(partial)` / `reset()`
  - `applyToConfig(CONFIG)` (single place that maps settings → CONFIG)

### Diagnostics
- **Source**: `src/core/diagnostics/diagnostics.js`
- **Includes**: recent errors (onerror/unhandledrejection), recent noise events, perf samples, context (seed/level id).
- **Target**: React reads from GameAPI snapshots + optional event stream.

### Campaign / Save
- **Source**: `src/core/campaignManager.js`, `src/core/saveManager.js`, `src/core/levelDirector.js`
- **Includes**: run id, level index, mutators, seed, progress.

## GameAPI (React boundary)

### Snapshot
- `getSnapshot()` returns a stable, serializable shape:
  - `time`, `fpsEma`, `dt`, `levelIndex`, `levelId`, `seed`, `health/maxHealth`, `weapon`, `ammo`, `mutators`, `flags` (debug/safe mode/minimap forced).

### Actions
- `actions.setSetting(key, value)`
- `actions.applySafeMode(enabled?)`
- `actions.regenerateMap()`
- `actions.respawnEnemies()`
- `actions.setSeed(seed)`
- `actions.toggleDebug(enabled)`
- `actions.copyCrashReport()`

### Events
- `subscribe(eventName, cb)` for EventBus events and `ui:snapshot` ticks.


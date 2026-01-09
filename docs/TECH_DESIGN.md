# Technical Design Document

This document describes the current implementation architecture: how systems are split, how data flows, and where to extend. For a handoff-oriented, code-referenced deep dive (update order, event flows, and key files), start at `docs/assistant/README.md`.

---

## Technology stack

| Tech | Purpose | Notes |
|---|---|---|
| Three.js | 3D rendering | ES modules |
| JavaScript (ES6+) | Primary language | `type: "module"` |
| Vite | Dev server + build | Fast HMR and bundling |

---

## Project structure

Principles:

- Runtime code lives in `src/`
- Static assets (models/audio/textures/levels) live in `public/` and should be referenced with absolute paths from `/`
- Gameplay/AI should not directly manipulate the DOM; `UIManager` owns HUD updates

```
src/
  core/          # config, events, gameLoop, levelDirector, spawnDirector, toolSystem...
  rendering/     # scene, camera, minimap, world markers, lighting
  world/         # maze grid, rooms, collision, exit, props
  entities/      # monsters, projectiles, pickups
  player/        # input, controller, gun, weapon view
  ai/            # autopilot, monster brains, pathfinding, tactics modules
  audio/         # AudioManager (procedural SFX)
  ui/            # UIManager (HUD/prompts/results/input modes)
  utils/         # helpers
public/
  levels/        # base levels (JSON + manifest)
  level-recipes/ # endless recipes (optional)
  models/        # models + meta
  textures/      # textures
```

---

## Core architecture

### Single game loop, many systems

The main loop lives in `src/core/gameLoop.js`. Update order is explicitly controlled by `src/core/systemRegistry.js`:

- A “system” is either a function `(dt, ctx) => {}` or an object with `update(dt, ctx)`
- Systems are sorted by `order` (ascending)
- `ctx` carries per-frame references (e.g. Autopilot command, player position, gameOver state)

See the full order table in `docs/assistant/ARCHITECTURE.md`.

### EventBus

Event names: `src/core/events.js`  
EventBus impl: `src/core/eventBus.js`

Major event families:

- **Noise**: tools/guns/footsteps → monster hearing + UI noise meter
- **Inventory**: give/consume/query → tool usage and interactable requirements
- **Missions**: updates/success/failure → HUD and exit gating

### State boundaries

| Type | Responsibility | Location |
|---|---|---|
| `WorldState` | maze grid, room map, walkability/collision, LOS, spawn/exit placement | `src/world/worldState.js` |
| `GameState` | HP, timer, stats, inventory, win/lose state | `src/core/gameState.js` |

### Typical data flow

```
LevelDirector  →  WorldState  →  SceneManager
      ↓              ↓              ↓
MissionDirector  SpawnDirector   Rendering (minimap/markers)
      ↓              ↓
InteractableSystem   PickupManager/ToolSystem
      ↓              ↓
AutoPilot  →  PlayerController/Gun  →  Projectiles/Combat
      ↓
MonsterManager (perception + brains)
```

---

## Key systems (selected)

| System | Responsibility | Location |
|---|---|---|
| `LevelDirector` | Base levels + endless generation + difficulty scaling | `src/core/levelDirector.js` |
| `MissionDirector` | Mission templates, mission object placement, exit gating, Autopilot targets/state | `src/core/missions/missionDirector.js` |
| `InteractableSystem` | Shared interaction entrypoint (player + Autopilot), gates/consumption | `src/core/interactions/interactableSystem.js` |
| `SpawnDirector` | Waves, tool drops, “variety protection” | `src/core/spawnDirector.js` |
| `ToolSystem` | Throwables/devices lifecycle + perception coupling | `src/core/toolSystem.js` |
| `MonsterManager` | Spawn, brain tick, perception (noise/scent/vision), far throttling | `src/entities/monsterManager.js` |
| `AutoPilot` | AI player decisions (navigation/objectives/combat cadence) | `src/ai/autoPilot.js` |
| `PlayerToolAISystem` | Autopilot tool strategy | `src/core/playerToolAISystem.js` |
| `UIManager` | HUD/prompts/results, keypad input mode, noise meter | `src/ui/uiManager.js` |
| `Minimap` | Full-map thumbnail + cached base layer | `src/rendering/minimap.js` |
| `WorldMarkerSystem` | 3D world markers (`M` toggle) | `src/rendering/worldMarkerSystem.js` |
| `AudioManager` | Procedural SFX (tools, objectives, outcomes) | `src/audio/audioManager.js` |

---

## Extension principles

1. **Put content knobs in level JSON**: monster pools, tool drops, caps, start tools, mission lists
2. **Use events to decouple**: gameplay systems emit events; UI/other systems subscribe
3. **Register new systems intentionally**: order matters in `GameLoop.registerSystems()`
4. **SSOT**: update the relevant doc rather than adding new doc files

---

## References

- Architecture + update order: `docs/assistant/ARCHITECTURE.md`
- AI: `docs/assistant/AI.md`
- Levels/missions/tools: `docs/assistant/CONTENT_SYSTEMS.md`
- Minimap/markers/perf: `docs/assistant/RENDERING_PERFORMANCE.md`

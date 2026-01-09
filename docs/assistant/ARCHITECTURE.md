# Runtime Architecture & Data Flow

This document is written for handoffs: how the game boots, the per-frame update order, how data/events flow between systems, and the most common extension points.

---

## 1) Boot flow (from `index.html` to the first frame)

Entry points:

- UI/DOM: `index.html`
- JS: `src/main.js` (`initGame()`)

At a high level, `src/main.js`:

1. Creates the `EventBus`: `src/core/eventBus.js` (event names: `src/core/events.js`)
2. Loads level configuration:
   - `src/core/levelDirector.js` reads `public/levels/manifest.json` and `public/levels/*.json`
   - falls back to `src/core/levelCatalog.js` when needed
3. Builds the world:
   - `WorldState`: `src/world/worldState.js` (maze grid, rooms, collision, LOS, etc)
   - `SceneManager`: `src/rendering/scene.js` (turns `WorldState` into Three.js meshes)
4. Builds player/camera:
   - `InputHandler`: `src/player/input.js`
   - `PlayerController`: `src/player/playerController.js`
   - `FirstPersonCamera`: `src/rendering/camera.js`
5. Builds core systems (combat, AI, missions, tools, spawning, etc):
   - `MonsterManager`: `src/entities/monsterManager.js`
   - `ProjectileManager`: `src/entities/projectileManager.js`
   - `PickupManager`: `src/entities/pickupManager.js`
   - `SpawnDirector`: `src/core/spawnDirector.js`
   - `MissionDirector`: `src/core/missions/missionDirector.js`
   - `InteractableSystem`: `src/core/interactions/interactableSystem.js`
   - `ToolSystem`: `src/core/toolSystem.js`
   - `AutoPilot`: `src/ai/autoPilot.js`
6. Builds UI/visual aids:
   - `UIManager`: `src/ui/uiManager.js`
   - `Minimap`: `src/rendering/minimap.js`
   - `WorldMarkerSystem`: `src/rendering/worldMarkerSystem.js`
7. Starts the loop:
   - `GameLoop`: `src/core/gameLoop.js`

---

## 2) Per-frame update order (SystemRegistry)

The source of truth is `src/core/gameLoop.js:GameLoop.registerSystems()`, which uses `src/core/systemRegistry.js` and runs systems in ascending `order`.

When extending, preserve the intent: **decide → act → interact → separate/unstuck → visuals/UI**.

| order | system | responsibility | location |
|---:|---|---|---|
| 0 | `outcome` | Centralized win/lose callbacks and effects | `src/core/gameLoop.js` |
| 10 | `autopilot` | Detect idle input and (optionally) produce `externalCommand` | `src/core/gameLoop.js`, `src/ai/autoPilot.js` |
| 20 | `player` | Player movement/look/collision/footstep noise (also consumes Autopilot commands) | `src/player/playerController.js` |
| 22 | `roomTracker` | ROOM_ENTERED events + stats | `src/core/gameLoop.js` |
| 24 | `timer` | Game timer + TIMER_TICK | `src/core/gameLoop.js` |
| 25 | `interactables` | Raycast hover + interact (player + Autopilot) | `src/core/interactions/interactableSystem.js` |
| 30 | `gun` | Shooting/reload/skills (player + Autopilot) | `src/player/gun.js` |
| 35 | `playerToolAI` | Autopilot’s tool strategy (smoke/flash/decoy/trap…) | `src/core/playerToolAISystem.js` |
| 40 | `projectiles` | Bullets/throwables/explosions updates | `src/entities/projectileManager.js` |
| 50 | `spawnDirector` | Wave spawns + drops + start-of-level tools | `src/core/spawnDirector.js` |
| 55 | `tools` | Tool lifecycle: deploy/throw/devices/smoke clouds | `src/core/toolSystem.js` |
| 57 | `worldMarkers` | 3D world markers toggle + updates | `src/rendering/worldMarkerSystem.js` |
| 60 | `monsters` | Enemy AI tick / movement / far throttling / ranged fire | `src/entities/monsterManager.js` |
| 70 | `separation` | Player/monster/wall separation to prevent “pushing” and stuck states | `src/core/gameLoop.js` |
| 80 | `noProgress` | Unstuck logic: nudge player + reset Autopilot path | `src/core/gameLoop.js` |
| 90 | `meleeCollision` | Melee contact damage (with global limiter) | `src/core/gameLoop.js` |
| 120 | `exitAnim` | Exit animation updates | `src/world/exitPoint.js` |
| 130 | `lighting` | Flicker/lighting updates | `src/rendering/lighting.js` |
| 140 | `sceneUpdate` | Scene tickables (particles, etc) | `src/rendering/scene.js` |
| 150 | `visualEffects` | Screen-space effects | `src/rendering/visualEffects.js` |
| 160 | `ui` | HUD/prompt/results updates | `src/ui/uiManager.js` |

Note: minimap rendering is driven from `GameLoop.render()` (with throttling, default `0.25s`), not as a system update.

---

## 3) External commands (Autopilot → player systems)

When the player has been idle for a while, Autopilot can take control by emitting an `externalCommand` into the per-frame context.

- Produced by: `src/ai/autoPilot.js:tick()`
- Activation logic: `src/core/gameLoop.js` (`autopilot` system)
- Consumed by:
  - movement/look/block: `src/player/playerController.js:update(...)`
  - fire/skills/reload: `src/player/gun.js:update(...)`
  - interact: `src/core/interactions/interactableSystem.js:update(...)` (via `ctx.forcedInteractId`)

Conceptually:

```js
{
  move: { x: -1..1, y: -1..1 }, // strafe/forward
  lookYaw: radians,
  lookPitch: radians | null,
  sprint: boolean,
  block: boolean,
  fire: boolean,
  interact: false | true | "<interactableId>",
  camera: boolean // used by camera-based missions (photo/scan)
}
```

---

## 4) EventBus and common data flows

Event names are defined in `src/core/events.js`.

### 4.1 Noise → monster hearing

1. A system requests noise: `EVENTS.NOISE_REQUESTED` (guns, tools, mines, etc)
2. `NoiseBridgeSystem` turns it into `MonsterManager.registerNoise(...)`
   - `src/core/noiseBridgeSystem.js`
3. `MonsterManager` delivers it to brains via perception
   - `src/entities/monsterManager.js`
4. `UIManager` can also listen for noise events to render a noise meter
   - `src/ui/uiManager.js`

### 4.2 Inventory → tool usage + interactable gates

- Inventory is event-driven:
  - `EVENTS.INVENTORY_GIVE_ITEM`
  - `EVENTS.INVENTORY_CONSUME_ITEM`
  - `EVENTS.INVENTORY_QUERY_ITEM`
- The underlying data lives in `GameState`: `src/core/gameState.js`
- `InteractableSystem` gates (`requiresItem/consumeItem`) use the same event channel:
  - `src/core/interactions/interactableSystem.js`
- `ToolSystem` also consumes tools via inventory events:
  - `src/core/toolSystem.js`

---

## 5) Extension points

### 5.1 Add a new per-frame system

1. Implement `update(dt, ctx)` (or a function `(dt, ctx) => {}`)
2. Instantiate it in `src/main.js` and pass required refs (scene/worldState/eventBus…)
3. Register it in `src/core/gameLoop.js:registerSystems()` via `systems.add(name, system, { order })`
4. Prefer emitting events over directly mutating UI

### 5.2 Add a new cross-system event

1. Add the event name in `src/core/events.js`
2. Emit it from the producer system; `on(...)` subscribe from consumer systems
3. Update docs (this file or the topic-specific assistant doc)

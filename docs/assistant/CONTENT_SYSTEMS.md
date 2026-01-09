# Levels / Missions / Interactables / Tools (Content Systems)

This document describes how the “game content layer” is configured and wired: level JSON, mission templates, interaction gates, inventory/tools, pickups/drops, and spawning.

---

## 1) Levels and endless generation

### 1.1 Base levels: `public/levels/*.json`

- Manifest: `public/levels/manifest.json`
- Loading + normalization: `src/core/levelDirector.js`
  - enforces odd maze dimensions (maze generation requirement)
  - clamps unsafe extremes (e.g., monster max count)

Common fields (example shape):

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

### 1.2 Endless levels (dynamic configs)

`src/core/levelDirector.js` supports:

- base levels (from the manifest)
- after base levels, **endless generation**:
  - prefer recipes: `public/level-recipes/manifest.json` + `public/level-recipes/*.json`
  - fallback to `buildDynamicConfig(...)` when no recipe is available
- difficulty increases with level index and can be adjusted based on performance
  - see `LevelDirector.scorePerformance()` / `difficultyForLevel()`

---

## 2) Missions and objectives

### 2.1 MissionDirector responsibilities

File: `src/core/missions/missionDirector.js`

It:

- parses/normalizes a level’s mission list (`src/core/missions/missionTemplates.js:normalizeMissionsConfig()`)
- chooses placement tiles and spawns mission objects (Three.js `Object3D`)
- registers those objects as interactables
- tracks mission state (progress/success/failure)
- controls exit gating (required objectives)
- provides Autopilot-facing APIs:
  - `getAutopilotTargets()` (actionable targets)
  - `getAutopilotState()` (current objective text/progress/next interactable)

### 2.2 Mission object factory

File: `src/core/missions/missionObjects.js`

This is the centralized “3D object stub” library for mission objects:

- keycard, evidence, fuse, fuse panel, terminal, keypad, locked door, altar, sensor…
- state transitions (e.g. `setKeypadState()`, `setFusePanelState()`, `setTerminalState()`)

Design intent: mission expansions shouldn’t force geometry/material details to be scattered across systems.

### 2.3 Interaction gates: InteractableSystem

File: `src/core/interactions/interactableSystem.js`

Interactables are the shared interaction API for both player and Autopilot:

- raycast hover (only show prompts when “looking at”)
- `E` interact (or forced Autopilot interact)
- per-entry max distance
- gate requirements: `requiresItem`
- item consumption: `consumeItem`
- prompt text: `prompt`

It also performs a LOS check to prevent interacting through walls:

- `InteractableSystem.hasLineOfSight()` → `worldState.hasLineOfSight()`

### 2.4 Hiding spots

File: `src/core/interactions/hidingSpotSystem.js`

- generates hiding spot interactables in certain room types
- while hiding:
  - `PlayerController.getAIPerceivedGridPosition()` returns `null`
  - enemy brains can lose reliable player position (vision/tracking disruption)

---

## 3) Inventory and pickups

### 3.1 InventorySystem

File: `src/core/inventorySystem.js`

Systems don’t mutate inventory directly; they go through events:

- `EVENTS.INVENTORY_GIVE_ITEM`
- `EVENTS.INVENTORY_CONSUME_ITEM`
- `EVENTS.INVENTORY_QUERY_ITEM`

The actual data lives in `GameState`: `src/core/gameState.js`.

### 3.2 PickupManager

File: `src/entities/pickupManager.js`

Pickup kinds include:

- general: `ammo`, `health`
- tools: `lure`, `trap`, `jammer`, `decoy`, `smoke`, `flash`, `sensor`, `mine`

Tool pickup collection:

- emits `EVENTS.INVENTORY_GIVE_ITEM`
- UI shows key hints (e.g. `lure → 4`)

### 3.3 SpawnDirector (waves + drops + “variety protection”)

File: `src/core/spawnDirector.js`

- start-of-level tools: spawns tool pickups based on `levelConfig.pickups.tools.start`
- tool drops: monsters can drop tool pickups on death (`chance/weights/ttl`)
- variety protection:
  - if a level’s weights are too narrow, the system can softly widen the pool (tools/monster types) so runs don’t devolve into a single type
  - you can disable this by setting `strictWeights:true` in level config (full trust in JSON)

---

## 4) Tools: throwables, devices, and their effects

### 4.1 ToolSystem

File: `src/core/toolSystem.js`

Tools come in two forms:

1. **Throwables**: `decoy/smoke/flash`
   - spawned via `ProjectileManager.spawnPlayerProjectile()` (straight-line, no gravity)
   - impact triggers effects via `ToolSystem.onProjectileImpact()`
2. **Devices**: `lure/trap/jammer/sensor/mine`
   - spawned on the ground in front of the player
   - persisted and updated in `devices[]`

Keybindings (these are also fixed HUD slots):

- `4` Lure (device)
- `5` Trap (device: stun)
- `6` Jammer (device: reduces hearing/smell)
- `7` Decoy (throwable: loud noise + scent)
- `8` Smoke (throwable: blocks LOS)
- `9` Flash (throwable: blinds/stuns)
- `0` Sensor (device: pings on nearby monsters)
- `V` Mine (device: explosion + noise)

### 4.2 Tool ↔ enemy perception coupling

Tools directly affect enemy perception:

- Noise: `EVENTS.NOISE_REQUESTED` → `NoiseBridgeSystem` → `MonsterManager.registerNoise()`
  - e.g. lure/decoy/mine produce noise
- Scent: `MonsterManager.registerScent(...)`
  - e.g. lure/decoy register long-TTL scent events
- Smoke: `worldState.smokeClouds` is used by `MonsterPerception.canMonsterSeePlayer()` to block LOS when segments intersect smoke spheres
- Flash: `MonsterManager.applyAreaBlindness()` sets `monster.perceptionBlindedTimer`
- Jammer: refreshes `monster.perceptionJammedTimer` and applies `CONFIG.AI_JAMMED_*_MULT`

### 4.3 Tool sound effects

Sound effects are procedural (no external audio assets required):

- `src/audio/audioManager.js:playToolThrow/playToolDeploy/playToolTrigger`

---

## 5) Extension checklist: adding a new “game-like” tool

Common integration points people forget:

1. Decide an inventory `itemId` (e.g. `smoke`)
2. Add a pickup:
   - `src/entities/pickupManager.js` (kind + mesh + hint)
   - `src/core/spawnDirector.js` (drop weights and start-of-level distribution)
3. Add the usable behavior:
   - `src/core/toolSystem.js` (deploy/throw + input binding)
4. UI:
   - `src/ui/uiManager.js` (fixed HUD slot + count display)
   - markers/minimap styling (optional): `src/rendering/worldMarkerSystem.js`, `src/rendering/minimap.js`
5. Autopilot strategy:
   - `src/core/playerToolAISystem.js` (when to use it; consider `stealthNoise` constraints)
6. Docs:
   - update this file and/or the relevant assistant doc

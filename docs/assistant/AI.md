# AI Deep Dive: Enemy AI + AI Player (Autopilot)

This document describes the two “decision-making” systems:

1. **AI player (Autopilot)**: takes over when the human player is idle and can explore, solve objectives, fight, and use tools.
2. **Enemy AI**: modular monster behavior (brains + perception + optional tactics modules), including special rules like “Weeping Angel”.

---

## 1) Autopilot overview

### 1.1 Activation and data flow

- Enable/disable: `CONFIG.AUTOPILOT_ENABLED` (`src/core/config.js`)
- Idle delay: `CONFIG.AUTOPILOT_DELAY` (seconds)
- Activation logic: `src/core/gameLoop.js` (`autopilot` system)
  - reads input idle time: `src/player/input.js:getIdleTimeSeconds()`
  - if the player is actively using WASD/mouse, Autopilot won’t “drive” (but may still `tick()` to pre-plan)
  - active control is delivered via `ctx.externalCommand` to player/gun/interact systems

### 1.2 Key Autopilot files

- Navigation + objective solving: `src/ai/autoPilot.js`
- Mission state source: `src/core/missions/missionDirector.js:getAutopilotState()`
- Autopilot target list: `src/core/missions/missionDirector.js:getAutopilotTargets()`
- Tool strategy (only when Autopilot is actively driving): `src/core/playerToolAISystem.js`

---

## 2) How Autopilot “gets things done”

### 2.1 Task-driven objective solving (Search → MoveTo → Interact)

Autopilot is not just “walk to nearest target”. It uses a task decomposition approach to reduce failure cases in complex mazes:

- Task runner: `src/ai/tasks/taskRunner.js`
- Common tasks:
  - `SearchTask`: `src/ai/tasks/searchTask.js`
  - `MoveToTask`: `src/ai/tasks/moveToTask.js`
  - `InteractTask`: `src/ai/tasks/interactTask.js`
  - `EscortTask` / `GuardTask`: `src/ai/tasks/*`

Per frame, Autopilot typically:

1. Reads mission state (`getAutopilotState()`) and target list
2. Chooses what to do next and builds a task queue
3. Plans with pathfinding: `src/ai/pathfinding.js`
4. Emits one frame of commands (move/look/sprint/fire/interact…)

### 2.2 Anti-oscillation at junctions (“dithering” fixes)

The classic failure mode is “too many branches → jitter at the junction”. Autopilot stacks several guards:

- **Visited tile memory**: prefer unexplored tiles (`visitedTiles`)
  - `src/ai/autoPilot.js:recordVisit()`
- **Unreachable memory**: avoid retrying targets that recently failed
  - `src/ai/autoPilot.js:recordUnreachable()`
- **Step lock**: commit to a next step for a short duration at high-degree junctions
  - `src/ai/autoPilot.js:updateStepLock()` (e.g., `stepLockSeconds`, `stepLockMinNeighbors`)
- **No-progress detection**: if the player is stuck/colliding and not making progress, force an unstuck + clear the path
  - `src/core/gameLoop.js` (`noProgress` system → `player.forceUnstuck()` + `autopilot.resetPath()`)

### 2.3 Combat directive (aiming + firing cadence)

Autopilot combat decisions live primarily in `src/ai/autoPilot.js`, and are governed by `src/core/config.js`:

- `CONFIG.AUTOPILOT_COMBAT_*`: search distance, fire FOV, aim alignment, LOS requirements, etc
- `CONFIG.AUTOPILOT_COMBAT_DAMAGE_MULT`: damage multiplier for Autopilot only (does not affect manual play)
- Burst cadence: `CONFIG.AUTOPILOT_COMBAT_BURST_*`

Mission constraints can override combat:

- `stealthNoise` (“Stay Quiet”): forces `fire:false` and often `move:0` to avoid failing the objective
- `deliverFragile`: disables firing while carrying a fragile objective item

---

## 3) Autopilot tool strategy (PlayerToolAISystem)

File: `src/core/playerToolAISystem.js`

This system runs only when **Autopilot is actively driving** (`ctx.autopilotActive === true`). The purpose is to make tools matter beyond “mission-only” usage: survival, combat tempo, and disengage options.

Inputs:

- Inventory snapshot: `gameState.getInventorySnapshot()`
- Threat scan: monster distance, “seen by any” status, nearby count, etc
- Mission template constraints (e.g. “avoidNoise” when `stealthNoise`)

High-level behavior (see file for exact rules):

- **Point-blank (≤ ~2 tiles)**: prefer `flash` → `smoke` → `trap` → `mine`
- **Seen and need to break LOS**: throw `smoke`
- **Seen but noise is allowed**: deploy `lure` / throw `decoy` to pull monsters away
- **Hold-point objectives**: deploy `jammer` (reduce perception) + `sensor` (early warning)

---

## 4) Enemy AI architecture

### 4.1 Brain interface

Each monster has a **brain** that outputs per-frame commands.

- Base class: `src/ai/brains/baseBrain.js:BaseMonsterBrain`
- Factory: `src/ai/monsterAI.js:createMonsterBrain()`
- Manager: `src/entities/monsterManager.js`

Conceptually a brain produces:

```js
{
  move: { x: -1..1, y: -1..1 },
  lookYaw: radians,
  sprint: boolean,
  fire?: { ... } // either from the brain or a combat module
}
```

`MonsterManager.update()` typically:

1. Updates perception and feeds sensory events into the brain
   - `brain.hearNoise(...)`
   - `brain.smellScent(...)`
2. Calls `brain.tick(dt)` to get commands
3. Sanitizes commands (avoid NaN, clamp vectors)
4. Applies movement/turning/firing

### 4.2 Perception (vision/hearing/smell)

Core implementation: `src/entities/monsterManager/perception.js:MonsterPerception`

#### Vision (FOV + LOS)

- Primary check: `MonsterPerception.canMonsterSeePlayer(...)`
- Pipeline:
  - distance gate + FOV cone (relative to monster yaw)
  - occlusion gate (line of sight)
  - **smoke clouds block LOS**: `ToolSystem` spawns smoke clouds; if the LOS segment intersects the smoke spheres, vision is blocked

#### Hearing (noise)

- Pool: `noiseEvents[]`
- Sources:
  - player footsteps: `MonsterManager.updatePlayerNoise()` → `MonsterPerception.updatePlayerNoise()`
  - guns/tools: via `EVENTS.NOISE_REQUESTED` (see Noise flow in `docs/assistant/ARCHITECTURE.md`)
  - alert broadcast: monsters that see the player can emit a noise to help other monsters converge
    - `MonsterPerception.maybeBroadcastAlert(...)`
- Brain access: `MonsterPerception.pickAudibleNoise(monster, brain)`

#### Smell (scent)

- Pool: `scentEvents[]`
- Player trail “breadcrumbs”: periodically dropped when the player moves (and can be stronger while sprinting)
  - `MonsterPerception.updatePlayerScent(...)`
- Tools can register scents as well (e.g. lure/decoy)
  - `ToolSystem.triggerDecoy()` / `deployLure()` → `MonsterManager.registerScent(...)`
- Brain access: `MonsterPerception.pickSmelledScent(monster, brain)`

### 4.3 Modules (Brain composer)

File: `src/ai/brainComposer.js`

Brains can be wrapped with reusable capability modules rather than duplicating logic in every brain:

- `noiseInvestigation`: investigate a recent noise after losing vision
- `flankCoverTactics`: flanking/suppression behavior when the player is visible
- `squadCoordination`: share targets, assign flank slots, allow cover shooter roles

The composer typically wraps `brain.pickTarget()` and (when needed) `brain.tick()` (e.g., “hold position” constraints output `move=0`).

---

## 5) Special monster: Weeping Angel

Files:

- Brain: `src/ai/brains/weepingAngel.js`
- Type: `src/ai/monsterTypes.js:WEEPING_ANGEL`

Core rule:

- **If the player is looking at it (player FOV + LOS), it freezes completely** (no movement, no turning).
- Otherwise it uses its own perception (vision/noise/scent) to approach the player.

“Is the player looking at the monster?” is evaluated from the player’s perspective:

- `player.getViewYaw()` and `player.getViewFovDeg()`: `src/player/playerController.js`
- `worldState.hasLineOfSight(...)`: `src/world/worldState.js`

---

## 6) Extending the AI system

### 6.1 Add a new brain

1. Add a new file under `src/ai/brains/` extending `BaseMonsterBrain`
2. Implement `pickTarget()` and `tick(dt)`
3. Map it in `src/ai/monsterAI.js:createMonsterBrain()` (the `aiType` string)

### 6.2 Add a new monster type

1. Add an entry in `src/ai/monsterTypes.js` (includes `aiType`, `stats`, `combat`, `appearance`)
2. If modules are needed, set `type.brain.modules` (e.g. `noiseInvestigation/flankCoverTactics/squadCoordination`)
3. If you use spawn budgeting, update `src/core/spawnDirector.js:TYPE_COST`
4. Make it selectable from levels via:
   - `public/levels/*.json` → `monsters.typePool` or `monsters.typeWeights`

### 6.3 Modify perception rules

Avoid scattering perception logic across multiple brains; prefer centralized edits here:

- Vision: `src/entities/monsterManager/perception.js:canMonsterSeePlayer()`
- Noise selection: `pickAudibleNoise()`
- Scent selection: `pickSmelledScent()`
- Tool/gun noise should go through `EVENTS.NOISE_REQUESTED` (via `NoiseBridgeSystem`)

---

## 7) Debug pages and observation tips

- AI import sanity: `/test-ai.html`
- Main bootstrap sanity: `/diagnostic.html`
- Combat + enemy meta: `/enemy-lab.html`, `/test-enemy-meta.html`

Console hints:

- `MonsterManager` logs type distribution
- `SpawnDirector` emits `spawn:wavePlanned` / `spawn:waveSpawned` (add logs/overlay when needed)

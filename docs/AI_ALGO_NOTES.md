# Algorithm Notes

This file is the centralized place for algorithm-level notes and implementation pointers:

- Maze generation
- Pathfinding (A*)
- Visibility (FOV/LOS)
- Perception event handling (noise/scent)
- Anti-oscillation / unstuck mechanisms

For the “current implementation view” of AI behavior, prefer `docs/assistant/AI.md`.

---

## Where in code

| Topic | Primary files |
|---|---|
| Maze generation | `src/world/mapGenerator.js`, `src/world/worldState.js` |
| Pathfinding (A*) | `src/ai/pathfinding.js` |
| Line of sight (LOS) | `src/world/worldState.js:hasLineOfSight()` |
| Vision (FOV cone) | `src/entities/monsterManager/perception.js:canMonsterSeePlayer()` |
| Noise/hearing | `src/entities/monsterManager/perception.js`, `src/core/noiseBridgeSystem.js` |
| Scent/smell | `src/entities/monsterManager/perception.js` |
| Unstuck (no-progress) | `src/core/gameLoop.js` (`noProgress` system), `src/player/playerController.js:forceUnstuck()` |
| Junction anti-oscillation | `src/ai/autoPilot.js` (step lock + memories) |

---

## 1) Maze generation (high-level)

The project uses a grid-based maze representation (walls/floors) with room placement on top.

Key goals:

- Always produce a connected walkable space
- Preserve “backrooms-like” corridors while still allowing rooms
- Keep generation cheap enough to run per level

Implementation entrypoints:

- `src/world/mapGenerator.js`
- `src/world/worldState.js` (owns final grid + room map and derived lookups)

Notes:

- Maze dimensions are normalized to odd numbers (required by carving algorithms); see `src/core/levelDirector.js`.

---

## 2) Pathfinding (A*)

File: `src/ai/pathfinding.js`

Core concepts:

- Graph: grid cells (typically 4-way neighbors)
- Cost: usually uniform step cost with a heuristic (commonly Manhattan distance)

Common failure modes to consider when iterating:

- “No path” due to dynamic obstacles (monsters/player overlap) → prefer a best-effort fallback target rather than freezing
- Oscillation between equally good neighbors → add tie-breakers or short-term commitment (“step lock”)

---

## 3) LOS and FOV

LOS (line of sight) is handled by `WorldState`:

- `src/world/worldState.js:hasLineOfSight(...)`

FOV checks happen at the perception layer:

- `src/entities/monsterManager/perception.js:canMonsterSeePlayer(...)`

Important: smoke clouds can block LOS in the perception check (see ToolSystem + perception).

---

## 4) Perception events: noise + scent

Enemy perception is centralized in:

- `src/entities/monsterManager/perception.js`

Noise event pipeline:

- Producers emit `EVENTS.NOISE_REQUESTED`
- `src/core/noiseBridgeSystem.js` forwards to `MonsterManager.registerNoise(...)`

Scent is registered directly via the monster manager:

- `MonsterManager.registerScent(...)`

Tools can produce both noise and scent (e.g., decoy/lure).

---

## 5) Anti-oscillation and “unstuck”

There are two major categories:

### 5.1 Autopilot junction anti-oscillation

File: `src/ai/autoPilot.js`

- visited/unreachable memories reduce repeated indecision
- step lock commits to a direction briefly at high-degree junctions

### 5.2 Runtime no-progress detection and separation

File: `src/core/gameLoop.js`

- `separation` system reduces “pushing” and collision jitter
- `noProgress` system nudges the player and resets Autopilot path when stuck

---

## Revision history

| Date | Version | Notes |
|---|---|---|
| 2025-11-20 | v0.1 | Initial notes |

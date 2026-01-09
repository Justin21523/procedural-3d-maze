# AI System Overview

This is a design-level summary of the AI systems: the AI player (**Autopilot**) and enemy AI (**monster brains + perception**), and how tools connect to perception/gameplay.

For a complete, code-referenced deep dive (file paths, event flows, how to extend brains/modules), see `docs/assistant/AI.md`.

---

## 1) AI player (Autopilot)

Purpose: when the player is idle, Autopilot can take over to run demos, stress tests, and validate missions and survival strategies.

Key files:

- Decision + navigation: `src/ai/autoPilot.js`
- Activation (idle detection): `src/core/gameLoop.js` (`autopilot` system)
- Mission state/targets: `src/core/missions/missionDirector.js:getAutopilotState()` / `getAutopilotTargets()`
- Tool strategy: `src/core/playerToolAISystem.js`

Behavior summary:

- Objective solving via a task runner (Search/MoveTo/Interact) to reduce “stuck” cases
- Anti-oscillation at junctions via visited/unreachable memory + step lock
- Combat cadence based on LOS/FOV/distance; objectives like “Stay Quiet” can suppress firing/movement
- Tool usage in “seen / point-blank / hold-point” scenarios (smoke/flash/trap/jammer/sensor)

---

## 2) Enemy AI (brains + perception)

### Brain model

Each monster has a brain that outputs per-frame commands:

- Brain base: `src/ai/brains/baseBrain.js:BaseMonsterBrain`
- Brain factory: `src/ai/monsterAI.js:createMonsterBrain()`
- Manager/update: `src/entities/monsterManager.js`

### Perception

Perception is centralized in `src/entities/monsterManager/perception.js`:

- Vision: distance + FOV cone + LOS (smoke blocks LOS)
- Hearing: footsteps, guns, tools, and alert broadcast noise
- Smell: player breadcrumb trail + lure/decoy scent

### Modules

Brains can be extended via `src/ai/brainComposer.js` modules:

- Noise investigation
- Flank/cover tactics
- Squad coordination

### Special monster: Weeping Angel

“Moves only when you’re not looking”:

- Brain: `src/ai/brains/weepingAngel.js`
- Type config: `src/ai/monsterTypes.js:WEEPING_ANGEL`

---

## 3) Tools ↔ AI coupling (why tools matter)

Tools are not isolated “items”; they directly affect perception and behavior:

- Lure/Decoy: noise + scent misdirection
- Smoke: blocks LOS (disengage/reset)
- Flash: blindness/stun (emergency save)
- Jammer: reduces hearing/smell (harder to reacquire)
- Sensor: warning pings (player + Autopilot)

Configuration and extension details: `docs/assistant/CONTENT_SYSTEMS.md`

---

## References

- AI deep dive: `docs/assistant/AI.md`
- Architecture: `docs/assistant/ARCHITECTURE.md`

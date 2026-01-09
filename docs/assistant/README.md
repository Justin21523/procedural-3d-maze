# LLM/Assistant Hub

This directory is a handoff-focused documentation hub for **ChatGPT / Claude / Codex / other coding assistants**. The goal is to build an accurate mental model of how the game currently works (runtime wiring, update order, AI, content systems), and to know where to extend it safely.

If you’re a player or new to the repo, start with the root `README.md`.

---

## 0) Three things to know first

1. **All runtime code lives in `src/`**. `public/` is static assets + level JSON.
2. **The game is “one loop, many systems”**. `src/core/gameLoop.js` updates systems in a fixed order via `src/core/systemRegistry.js`.
3. **Cross-system data flow is event-driven**. Event names are defined in `src/core/events.js`.

---

## 1) Quick start (dev)

```bash
npm install
npm run dev -- --host --port 3002
```

Useful manual pages:

- Main game: `http://localhost:3002/`
- AI import sanity: `http://localhost:3002/test-ai.html`
- Main bootstrap sanity: `http://localhost:3002/diagnostic.html`
- Enemy Lab (combat + enemy meta save): `http://localhost:3002/enemy-lab.html`
- Level Lab (level/recipes iteration): `http://localhost:3002/level-lab.html`

---

## 2) Where to start reading

- Runtime architecture + update order: `docs/assistant/ARCHITECTURE.md`
- AI (Enemy AI + AI player/Autopilot): `docs/assistant/AI.md`
- Levels / missions / interactables / tools: `docs/assistant/CONTENT_SYSTEMS.md`
- Minimap / world markers / performance knobs: `docs/assistant/RENDERING_PERFORMANCE.md`

High-level design docs (treat these as “intent”; the assistant hub is “current implementation”):

- Game design: `docs/GAME_DESIGN.md`
- Technical design: `docs/TECH_DESIGN.md`
- Algorithm notes: `docs/AI_ALGO_NOTES.md`
- Glossary: `docs/GLOSSARY.md`

---

## 3) Key files cheat sheet

- Entry wiring: `src/main.js`
- Per-frame update order: `src/core/gameLoop.js`, `src/core/systemRegistry.js`
- Event names: `src/core/events.js`
- Levels + endless generation: `src/core/levelDirector.js`, `public/levels/*.json`, `public/levels/manifest.json`
- Missions: `src/core/missions/missionDirector.js`, `src/core/missions/missionObjects.js`
- Interactables: `src/core/interactions/interactableSystem.js`
- Hiding spots: `src/core/interactions/hidingSpotSystem.js`
- Inventory: `src/core/inventorySystem.js`, `src/core/gameState.js`
- Spawning + drops: `src/core/spawnDirector.js`, `src/entities/pickupManager.js`
- Tools (deploy/throw/devices): `src/core/toolSystem.js`
- AI player: `src/ai/autoPilot.js`, `src/core/playerToolAISystem.js`
- Enemy AI (brains + perception): `src/entities/monsterManager.js`, `src/entities/monsterManager/perception.js`, `src/ai/monsterAI.js`, `src/ai/brains/*`
- Minimap: `src/rendering/minimap.js`
- 3D world markers: `src/rendering/worldMarkerSystem.js`
- Audio (procedural SFX): `src/audio/audioManager.js`

---

## 4) Working habits (to avoid breaking things)

- **Register new docs first** in `docs/README.md` (SSOT rule).
- **Don’t couple AI/gameplay logic to the DOM**. Emit events; let `UIManager` render the HUD.
- **New systems must be registered in the game loop** (`src/core/gameLoop.js`), and order matters.
- **Prefer level JSON knobs** (`public/levels/*.json`) for counts/limits/weights; normalize in `LevelDirector` to keep configs safe.

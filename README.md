# Procedural 3D Maze

A first-person procedural maze game prototype built with **JavaScript (ES Modules)** and **Three.js**. Each run generates a new maze, then spawns missions, enemies, and pickups from per-level JSON configuration. Complete the required objectives to unlock the exit and advance to the next level. After the base set of levels, the game can keep generating levels endlessly with difficulty scaling.

This repo also includes an AI player (**Autopilot**) that takes over when the player is idle. Autopilot is intended for demos, stress testing, and iterating on missions/AI/tool balance.

---

## Features

- **Endless levels + difficulty scaling**: `src/core/levelDirector.js`, `public/levels/*`, optional recipes in `public/level-recipes/*`
- **Missions + interactables + exit gating**: `src/core/missions/*`, `src/core/interactions/interactableSystem.js`
- **Tools (deployables + throwables)**: lure/trap/jammer/sensor/mine + decoy/smoke/flash (`src/core/toolSystem.js`)
- **Perception-based enemy AI**: vision (FOV + LOS), hearing (noise), smell (scent); smoke/flash/jammer directly affect perception (`src/entities/monsterManager/perception.js`)
- **Multiple monster types/brains** (including "Weeping Angel"): `src/ai/brains/weepingAngel.js`
- **Navigation**: minimap always fits the entire map + optional 3D world markers (`src/rendering/minimap.js`, `src/rendering/worldMarkerSystem.js`)
- **Performance safety**: far-AI throttling, hard caps for projectiles/VFX, renderer pixel ratio cap (`src/core/config.js`)

---

## Quick start

Requirements: **Node.js 18+**

```bash
npm install
npm run dev -- --host --port 3002
```

Open: `http://localhost:3002/`

Build / preview:

```bash
npm run build
npm run preview
```

---

## Controls

### Movement / interaction

| Key | Action |
|---|---|
| `WASD` | Move |
| `Mouse` | Look |
| `Shift` | Sprint |
| `E` | Interact / use mission objects |
| `Esc` | Pause / release pointer lock |
| `Tab` | Toggle settings panel |
| `` ` `` | Toggle debug buttons (then click to open panel) |

### Combat

| Key | Action |
|---|---|
| `Left Click` | Fire |
| `Right Click` / `F` | Block / guard |
| `R` | Reload |
| `1/2/3` | Switch weapons |
| `B` | Toggle weapon mode (if supported) |
| `Q` | Skill: grenade |
| `X` | Skill: EMP |

### Tools

| Key | Tool |
|---|---|
| `4` | Lure |
| `5` | Trap |
| `6` | Jammer |
| `7` | Decoy (throwable) |
| `8` | Smoke (throwable) |
| `9` | Flash (throwable) |
| `0` | Sensor |
| `V` | Mine |
| `M` | Toggle world markers |
| `C` | Camera tool mode (mission-specific) |

---

## Manual validation

Run the dev server on port `3002`, then:

1. AI import sanity: `http://localhost:3002/test-ai.html`
2. Main bootstrap sanity: `http://localhost:3002/diagnostic.html`
3. Main game: `http://localhost:3002/`
4. Enemy lab: `http://localhost:3002/enemy-lab.html`
5. Level lab: `http://localhost:3002/level-lab.html`

More detailed checklists: `TESTING.md`, `TESTING_GUIDE.md`

---

## Documentation

- Documentation governance / map: `docs/README.md`
- LLM/assistant implementation hub (start here if you’re an AI): `docs/assistant/README.md`
  - Runtime architecture + update order: `docs/assistant/ARCHITECTURE.md`
  - AI (Autopilot + enemy AI): `docs/assistant/AI.md`
  - Levels / missions / interactables / tools: `docs/assistant/CONTENT_SYSTEMS.md`
  - Minimap / world markers / performance: `docs/assistant/RENDERING_PERFORMANCE.md`

---

## Project structure

```
src/
  ai/            # Autopilot + monster brains + pathfinding
  audio/         # AudioManager (procedural SFX)
  core/          # config, events, gameLoop, levelDirector, spawnDirector, toolSystem...
  entities/      # monsters, projectiles, pickups
  player/        # input, controller, gun, weapon view
  rendering/     # scene, camera, minimap, world markers
  ui/            # UIManager (HUD/prompts/results/input modes)
  world/         # maze grid, rooms, collision, exit, props
public/
  levels/        # Level JSON + manifest
  level-recipes/ # Optional endless recipes
  models/        # Models + meta
  textures/      # Textures
```

---

## Contributing workflow

1. Update docs first (SSOT): `docs/README.md`
2. Make code changes in `src/`
3. If the change is user-facing or architectural, update `docs/CHANGELOG.md` / `docs/TODO.md` as needed
4. Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

---

## License

MIT
